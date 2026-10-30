/* u2net-engine.js
   Runs the "U^2-Net-P" cut-out network in the browser with no AI runtime library.
   - u2netp.json : layer plan (made by tools/convert_u2netp.py)
   - u2netp.bin  : float32 weights
   - conv.wasm   : SIMD convolution kernel (compiled from conv.c); everything else is plain JavaScript.

   Model: U^2-Net-P by Xuebin Qin et al., Apache-2.0 licence (https://github.com/xuebinqin/U-2-Net).
   ONNX export used for conversion: rembg project, MIT licence (https://github.com/danielgatis/rembg).

   const eng = await U2Net.create({ wasmBytes, planJson, weightsBuffer });
   const map = await eng.run(chwInput, H, W, { onProgress, yieldToUI });   // chwInput: Float32Array of 3*H*W, normalised
   -> Float32Array(H*W) with values 0..1 (1 = foreground) */
(function (root) {
  'use strict';

  // smallest module that uses a v128 instruction; validates only where WebAssembly SIMD is supported
  const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  function supported() {
    try { return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE); } catch (e) { return false; }
  }

  function pool2(x, xo, C, H, W, o, oo) {
    const oh = Math.ceil(H / 2), ow = Math.ceil(W / 2);
    for (let c = 0; c < C; c++) {
      const ib = xo + c * H * W, ob = oo + c * oh * ow;
      for (let y = 0; y < oh; y++) {
        const ya = y * 2, yb = Math.min(ya + 1, H - 1);
        for (let xx = 0; xx < ow; xx++) {
          const xa = xx * 2, xb = Math.min(xa + 1, W - 1);
          const a = x[ib + ya * W + xa], b = x[ib + ya * W + xb], c2 = x[ib + yb * W + xa], d = x[ib + yb * W + xb];
          let m = a > b ? a : b; if (c2 > m) m = c2; if (d > m) m = d;
          o[ob + y * ow + xx] = m;
        }
      }
    }
  }

  /* bilinear resize, "pytorch_half_pixel" coordinates, source coordinate clamped at the borders */
  function resize(x, xo, C, H, W, oh, ow, o, oo) {
    const sy = H / oh, sx = W / ow;
    const xi0 = new Int32Array(ow), xi1 = new Int32Array(ow), xf = new Float32Array(ow);
    for (let i = 0; i < ow; i++) {
      let s = ow > 1 ? (i + 0.5) * sx - 0.5 : 0;
      if (s < 0) s = 0; if (s > W - 1) s = W - 1;
      const f = Math.floor(s); xi0[i] = f; xi1[i] = Math.min(f + 1, W - 1); xf[i] = s - f;
    }
    for (let c = 0; c < C; c++) {
      const ib = xo + c * H * W, ob = oo + c * oh * ow;
      for (let j = 0; j < oh; j++) {
        let s = oh > 1 ? (j + 0.5) * sy - 0.5 : 0;
        if (s < 0) s = 0; if (s > H - 1) s = H - 1;
        const f = Math.floor(s), r0 = ib + f * W, r1 = ib + Math.min(f + 1, H - 1) * W, fy = s - f;
        const orow = ob + j * ow;
        for (let i = 0; i < ow; i++) {
          const a = x[r0 + xi0[i]], b = x[r0 + xi1[i]], c2 = x[r1 + xi0[i]], d = x[r1 + xi1[i]];
          const top = a + (b - a) * xf[i], bot = c2 + (d - c2) * xf[i];
          o[orow + i] = top + (bot - top) * fy;
        }
      }
    }
  }

  async function create(cfg) {
    if (!supported()) throw new Error('WebAssembly SIMD is not supported here');
    const plan = typeof cfg.planJson === 'string' ? JSON.parse(cfg.planJson) : cfg.planJson;
    const memory = new WebAssembly.Memory({ initial: 256, maximum: 16384 });   // 16 MB, can grow to 1 GB
    const { instance } = await WebAssembly.instantiate(cfg.wasmBytes, { env: { memory } });
    const ex = instance.exports;
    const baseBytes = (ex.__heap_base.value + 63) & ~63;
    let f32 = new Float32Array(memory.buffer);
    let top = baseBytes / 4;                                    // float index of the next free slot

    function ensure(floats) {
      const bytes = floats * 4;
      if (bytes > memory.buffer.byteLength) memory.grow(Math.ceil((bytes - memory.buffer.byteLength) / 65536));
      if (f32.buffer !== memory.buffer) f32 = new Float32Array(memory.buffer);
    }
    // weights live in wasm memory for the lifetime of the engine
    const wts = new Float32Array(cfg.weightsBuffer);
    const wBase = top; top += (wts.length + 15) & ~15; ensure(top); f32.set(wts, wBase);
    const arenaStart = top;

    let pool = new Map();
    const alloc = (n) => {
      n = (n + 15) & ~15;
      const l = pool.get(n); if (l && l.length) return l.pop();
      const off = top; top += n; ensure(top); return off;
    };
    const release = (off, n) => { n = (n + 15) & ~15; const l = pool.get(n); if (l) l.push(off); else pool.set(n, [off]); };

    async function run(input, H, W, opts) {
      opts = opts || {};
      top = arenaStart; pool = new Map();
      const T = new Array(plan.tensors).fill(null);          // {off, c, h, w}
      const mk = (c, h, w) => ({ off: alloc(c * h * w), c, h, w });
      const inT = mk(3, H, W); f32.set(input, inT.off); T[plan.input] = inT;
      const ops = plan.ops;
      let lastYield = Date.now();
      for (let i = 0; i < ops.length; i++) {
        const p = ops[i];
        let r;
        switch (p.op) {
          case 'conv': {
            const a = T[p.in], K = p.kh, pad = p.dil * (K - 1) / 2;
            const Hp = a.h + 2 * pad, Wp = ((a.w + 7) & ~7) + 2 * pad;
            const sn = a.c * Hp * Wp, scratch = alloc(sn);
            r = mk(p.oc, a.h, a.w);
            ex.pad_planes(a.off * 4, scratch * 4, a.c, a.h, a.w, pad, Hp, Wp);
            ex.conv(scratch * 4, r.off * 4, (wBase + p.w) * 4, (wBase + p.bo) * 4, a.c, p.oc, a.h, a.w, Hp, Wp, K, p.dil, p.relu ? 1 : 0);
            release(scratch, sn);
            break;
          }
          case 'pool': { const a = T[p.in]; r = mk(a.c, Math.ceil(a.h / 2), Math.ceil(a.w / 2)); pool2(f32, a.off, a.c, a.h, a.w, f32, r.off); break; }
          case 'resize': { const a = T[p.in], l = T[p.like]; r = mk(a.c, l.h, l.w); resize(f32, a.off, a.c, a.h, a.w, l.h, l.w, f32, r.off); break; }
          case 'concat': {
            const parts = p.ins.map((t) => T[t]); let c = 0; for (const q of parts) c += q.c;
            r = mk(c, parts[0].h, parts[0].w); let o = r.off;
            for (const q of parts) { const n = q.c * q.h * q.w; f32.copyWithin(o, q.off, q.off + n); o += n; }
            break;
          }
          case 'add': { const a = T[p.a], b = T[p.b]; r = mk(a.c, a.h, a.w); const n = a.c * a.h * a.w; for (let k = 0; k < n; k++) f32[r.off + k] = f32[a.off + k] + f32[b.off + k]; break; }
          case 'sigmoid': { const a = T[p.in]; r = mk(a.c, a.h, a.w); const n = a.c * a.h * a.w; for (let k = 0; k < n; k++) f32[r.off + k] = 1 / (1 + Math.exp(-f32[a.off + k])); break; }
          case 'relu': { const a = T[p.in]; r = mk(a.c, a.h, a.w); const n = a.c * a.h * a.w; for (let k = 0; k < n; k++) { const v = f32[a.off + k]; f32[r.off + k] = v > 0 ? v : 0; } break; }
          default: throw new Error('unknown op ' + p.op);
        }
        T[p.out] = r;
        for (const t of p.free) { const q = T[t]; if (q) { release(q.off, q.c * q.h * q.w); T[t] = null; } }
        if (opts.onProgress) opts.onProgress((i + 1) / ops.length);
        if (opts.yieldToUI && Date.now() - lastYield > 30) { await new Promise((res) => setTimeout(res, 0)); lastYield = Date.now(); }
      }
      const fin = T[plan.output];
      return f32.slice(fin.off, fin.off + fin.c * fin.h * fin.w);
    }
    return { run, plan, memory };
  }

  root.U2Net = { create, supported };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.U2Net;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
