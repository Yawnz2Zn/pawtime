/* conv.c - SIMD convolution kernel for the on-device cut-out model.
   Compiled to vendor/conv.wasm (see tools/build_wasm.sh). No libc, no dependencies.
   Layout: tensors are dense float32 planes [channel][row][col]. Inputs are first copied into a
   zero-padded scratch buffer so the inner loops need no bounds checks.
   Computes 4 output channels x 8 pixels at a time with 128-bit SIMD (f32x4). */
#include <wasm_simd128.h>

typedef float f32;
typedef v128_t v4;

#define EXPORT(n) __attribute__((export_name(n)))

EXPORT("pad_planes")
void pad_planes(const f32* in, f32* dst, int C, int H, int W, int p, int Hp, int Wp) {
  for (int c = 0; c < C; c++) {
    f32* d = dst + (long)c * Hp * Wp;
    __builtin_memset(d, 0, (unsigned long)Hp * Wp * sizeof(f32));
    for (int y = 0; y < H; y++) {
      __builtin_memcpy(d + (long)(y + p) * Wp + p, in + ((long)c * H + y) * W, (unsigned long)W * sizeof(f32));
    }
  }
}

static inline v4 splat(f32 v) { return wasm_f32x4_splat(v); }
static inline v4 mla(v4 a, v4 x, v4 y) { return wasm_f32x4_add(a, wasm_f32x4_mul(x, y)); }

EXPORT("conv")
void conv(const f32* P, f32* out, const f32* wts, const f32* bias,
          int C, int OC, int H, int W, int Hp, int Wp, int K, int dil, int relu) {
  const long plane = (long)Hp * Wp;
  const int KK = K * K;
  const v4 zero = wasm_f32x4_splat(0.0f);
  int oc = 0;
  for (; oc + 4 <= OC; oc += 4) {
    const f32* w0 = wts + (long)(oc + 0) * C * KK;
    const f32* w1 = wts + (long)(oc + 1) * C * KK;
    const f32* w2 = wts + (long)(oc + 2) * C * KK;
    const f32* w3 = wts + (long)(oc + 3) * C * KK;
    f32* o0 = out + (long)(oc + 0) * H * W;
    f32* o1 = out + (long)(oc + 1) * H * W;
    f32* o2 = out + (long)(oc + 2) * H * W;
    f32* o3 = out + (long)(oc + 3) * H * W;
    for (int y = 0; y < H; y++) {
      for (int x = 0; x < W; x += 8) {
        v4 a00 = splat(bias[oc]),     a01 = a00;
        v4 a10 = splat(bias[oc + 1]), a11 = a10;
        v4 a20 = splat(bias[oc + 2]), a21 = a20;
        v4 a30 = splat(bias[oc + 3]), a31 = a30;
        for (int ic = 0; ic < C; ic++) {
          const f32* ip = P + (long)ic * plane + (long)y * Wp + x;
          const int wb = ic * KK;
          for (int ky = 0; ky < K; ky++) {
            const f32* r = ip + (long)ky * dil * Wp;
            for (int kx = 0; kx < K; kx++) {
              const int t = wb + ky * K + kx;
              v4 i0 = wasm_v128_load(r + kx * dil);
              v4 i1 = wasm_v128_load(r + kx * dil + 4);
              v4 s0 = wasm_v128_load32_splat(w0 + t);
              v4 s1 = wasm_v128_load32_splat(w1 + t);
              v4 s2 = wasm_v128_load32_splat(w2 + t);
              v4 s3 = wasm_v128_load32_splat(w3 + t);
              a00 = mla(a00, i0, s0); a01 = mla(a01, i1, s0);
              a10 = mla(a10, i0, s1); a11 = mla(a11, i1, s1);
              a20 = mla(a20, i0, s2); a21 = mla(a21, i1, s2);
              a30 = mla(a30, i0, s3); a31 = mla(a31, i1, s3);
            }
          }
        }
        if (relu) {
          a00 = wasm_f32x4_max(a00, zero); a01 = wasm_f32x4_max(a01, zero);
          a10 = wasm_f32x4_max(a10, zero); a11 = wasm_f32x4_max(a11, zero);
          a20 = wasm_f32x4_max(a20, zero); a21 = wasm_f32x4_max(a21, zero);
          a30 = wasm_f32x4_max(a30, zero); a31 = wasm_f32x4_max(a31, zero);
        }
        const long ro = (long)y * W + x;
        if (x + 8 <= W) {
          wasm_v128_store(o0 + ro, a00); wasm_v128_store(o0 + ro + 4, a01);
          wasm_v128_store(o1 + ro, a10); wasm_v128_store(o1 + ro + 4, a11);
          wasm_v128_store(o2 + ro, a20); wasm_v128_store(o2 + ro + 4, a21);
          wasm_v128_store(o3 + ro, a30); wasm_v128_store(o3 + ro + 4, a31);
        } else {
          f32 t0[8], t1[8], t2[8], t3[8];
          wasm_v128_store(t0, a00); wasm_v128_store(t0 + 4, a01);
          wasm_v128_store(t1, a10); wasm_v128_store(t1 + 4, a11);
          wasm_v128_store(t2, a20); wasm_v128_store(t2 + 4, a21);
          wasm_v128_store(t3, a30); wasm_v128_store(t3 + 4, a31);
          for (int i = 0; x + i < W; i++) { o0[ro + i] = t0[i]; o1[ro + i] = t1[i]; o2[ro + i] = t2[i]; o3[ro + i] = t3[i]; }
        }
      }
    }
  }
  for (; oc < OC; oc++) {                       /* leftover output channels, one at a time */
    const f32* w0 = wts + (long)oc * C * KK;
    f32* o0 = out + (long)oc * H * W;
    for (int y = 0; y < H; y++) {
      for (int x = 0; x < W; x += 8) {
        v4 a00 = splat(bias[oc]), a01 = a00;
        for (int ic = 0; ic < C; ic++) {
          const f32* ip = P + (long)ic * plane + (long)y * Wp + x;
          const int wb = ic * KK;
          for (int ky = 0; ky < K; ky++) {
            const f32* r = ip + (long)ky * dil * Wp;
            for (int kx = 0; kx < K; kx++) {
              v4 s0 = wasm_v128_load32_splat(w0 + wb + ky * K + kx);
              a00 = mla(a00, wasm_v128_load(r + kx * dil), s0);
              a01 = mla(a01, wasm_v128_load(r + kx * dil + 4), s0);
            }
          }
        }
        if (relu) { a00 = wasm_f32x4_max(a00, zero); a01 = wasm_f32x4_max(a01, zero); }
        const long ro = (long)y * W + x;
        if (x + 8 <= W) { wasm_v128_store(o0 + ro, a00); wasm_v128_store(o0 + ro + 4, a01); }
        else {
          f32 t0[8]; wasm_v128_store(t0, a00); wasm_v128_store(t0 + 4, a01);
          for (int i = 0; x + i < W; i++) o0[ro + i] = t0[i];
        }
      }
    }
  }
}
