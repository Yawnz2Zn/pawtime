'use strict';
/* =====================================================================
   Sticker Studio (sticker.js)
   Turns a pet photo into a sticker: pick a frame, then add as many text, emoji and
   decoration layers as you like, drag / resize / rotate them, and share the PNG.
   Everything is drawn with the Canvas 2D API, so the preview updates on every touch.

   Sections:  1 state   2 shapes   3 layers (emoji, decor, text)   4 drawing the sticker
              5 touch and mouse handling   6 panels (the controls)   7 save and share
   ===================================================================== */
const Sticker = (() => {
  const cv = $('#stkCanvas');
  const g = cv.getContext('2d');
  const SQ = 512;                                   // a sticker is 512 x 512 px, the usual chat-sticker size
  const CARD_W = 480, CARD_H = 640;                 // a "card" is a patterned 3:4 poster

  /* ---------- 1. state ---------- */
  const SHAPES = [['circle', 'Circle'], ['oval', 'Oval'], ['rounded', 'Rounded'], ['heart', 'Heart'], ['star', 'Star'], ['burst', 'Burst'], ['badge', 'Badge']];
  const ASPECT = { oval: 0.78 };                    // width / height of the frame box (default 1)
  const BORDERS = ['#ffffff', '#fff3b0', '#ffd1e0', '#c9f2d9', '#cfe4ff', '#ffb703', '#ff5d8f', '#3b2f23'];
  const EMOJIS = ['🐾', '❤️', '⭐', '✨', '😂', '🥰', '😍', '😴', '🎂', '🦴', '🐟', '🍖', '🌈', '🌸', '🎀', '👑', '💤', '💢', '‼️', '❓', '🔥', '🎉', '🍓', '☀️'];
  const DECOS = [['star', 'Star', '#ffd43b'], ['sparkle', 'Sparkle', '#ffffff'], ['heart', 'Heart', '#ff6b9d'], ['burst', 'Burst', '#ffe066'],
                 ['bubble', 'Bubble', '#ffffff'], ['paw', 'Paw', '#a47148'], ['cloud', 'Cloud', '#ffffff'], ['flower', 'Flower', '#ff9ecb']];
  const SWATCH = ['#ffffff', '#222222', '#ff3d81', '#ff8c42', '#ffd43b', '#37b24d', '#1c7ed6', '#7048e8', '#ff9ecb', '#a47148'];
  const TEXT_STYLES = [['pop', 'Pop', 'Wow!', '#ff3d81'], ['cute', 'Cute', 'Cutie', '#ff6b9d'], ['meme', 'Meme', 'WHEN TREATS?', '#ffffff'],
                       ['script', 'Script', 'Kitty Kitty', '#d6336c'], ['bubble', 'Bubble', 'Hi!', '#333333'], ['plain', 'Plain', 'Hello', '#333333']];
  const ARIAL_ROUND = '"Arial Rounded MT Bold","Nunito",ui-rounded,"Hiragino Maru Gothic ProN","PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  const st = {
    rec: null, bmp: null, w: SQ, h: SQ,
    shape: 'circle', border: '#ffffff', borderW: 18, edge2: false, edge2Color: '#ff7eb6',
    zoom: 1, panX: 0, panY: 0,
    layers: [], sel: null, nextId: 1,
    tab: 'photo', tool: 'move', dirty: false, savedClean: false, busy: false
    , layout: 'sticker', bg: { pattern: 'dots', c1: '#ff8fb8', c2: '#fff0f6' },
    strokes: [], pen: { kind: 'pen', color: '#ff3d81', w: 8 }
  };
  const zoomMin = () => (st.cutOn ? 0.4 : 1);       // a cut-out may be shrunk, a photo inside a frame may not
  let raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(g, true); }); };
  const redrawNow = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } render(g, true); };
  const touch = () => { st.dirty = true; st.savedClean = false; syncFoot(); };

  /* ---------- 2. shapes ---------- */
  function roundedPoly(x, pts, r) {                 // polygon with softly rounded corners
    const n = pts.length;
    x.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      x.arcTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, r);
    }
    x.closePath();
  }
  function starPts(cx, cy, R, r, n, rot) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, rad = i % 2 ? r : R; pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); }
    return pts;
  }
  function shapePath(x, shape, b) {                 // b = {x, y, w, h}; builds the path, does not paint
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    x.beginPath();
    if (shape === 'circle' || shape === 'oval') x.ellipse(cx, cy, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    else if (shape === 'rounded') {
      const r = Math.min(b.w, b.h) * 0.22;
      x.moveTo(b.x + r, b.y); x.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r); x.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r);
      x.arcTo(b.x, b.y + b.h, b.x, b.y, r); x.arcTo(b.x, b.y, b.x + b.w, b.y, r); x.closePath();
    } else if (shape === 'heart') {
      const { x: X, y: Y, w, h } = b;
      x.moveTo(X + w / 2, Y + h * 0.97);
      x.bezierCurveTo(X - w * 0.12, Y + h * 0.58, X + w * 0.04, Y - h * 0.02, X + w / 2, Y + h * 0.28);
      x.bezierCurveTo(X + w * 0.96, Y - h * 0.02, X + w * 1.12, Y + h * 0.58, X + w / 2, Y + h * 0.97);
      x.closePath();
    } else if (shape === 'star') {
      const R = Math.min(b.w, b.h) / 2 * 1.12; roundedPoly(x, starPts(cx, cy + R * 0.06, R, R * 0.5, 5, -Math.PI / 2), R * 0.07);
    } else if (shape === 'burst') {
      const R = Math.min(b.w, b.h) / 2 * 1.06; roundedPoly(x, starPts(cx, cy, R, R * 0.8, 14, -Math.PI / 2), R * 0.03);
    } else if (shape === 'badge') {
      const R = Math.min(b.w, b.h) / 2 * 0.97, N = 220;
      for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, rad = R * (0.94 + 0.06 * Math.cos(a * 12)); const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad; if (i) x.lineTo(px, py); else x.moveTo(px, py); }
      x.closePath();
    }
  }

  /* ---------- 3. layers: emoji, decor shapes and text ---------- */
  function decoPath(x, kind, s) {                   // path centred on (0,0) inside a box of size s
    x.beginPath();
    if (kind === 'star') roundedPoly(x, starPts(0, s * 0.03, s * 0.52, s * 0.24, 5, -Math.PI / 2), s * 0.05);
    else if (kind === 'burst') roundedPoly(x, starPts(0, 0, s * 0.5, s * 0.36, 14, -Math.PI / 2), s * 0.02);
    else if (kind === 'sparkle') {
      x.moveTo(0, -s / 2); x.quadraticCurveTo(s * 0.04, -s * 0.04, s / 2, 0); x.quadraticCurveTo(s * 0.04, s * 0.04, 0, s / 2);
      x.quadraticCurveTo(-s * 0.04, s * 0.04, -s / 2, 0); x.quadraticCurveTo(-s * 0.04, -s * 0.04, 0, -s / 2); x.closePath();
    } else if (kind === 'heart') {
      x.moveTo(0, s * 0.46); x.bezierCurveTo(-s * 0.66, s * 0.04, -s * 0.42, -s * 0.52, 0, -s * 0.2); x.bezierCurveTo(s * 0.42, -s * 0.52, s * 0.66, s * 0.04, 0, s * 0.46); x.closePath();
    } else if (kind === 'bubble') {
      const w = s, h = s * 0.62, r = s * 0.2, x0 = -w / 2, y0 = -h / 2 - s * 0.06;
      x.moveTo(x0 + r, y0); x.arcTo(x0 + w, y0, x0 + w, y0 + h, r); x.arcTo(x0 + w, y0 + h, x0, y0 + h, r); x.arcTo(x0, y0 + h, x0, y0, r); x.arcTo(x0, y0, x0 + w, y0, r); x.closePath();
      x.moveTo(-s * 0.26, y0 + h - 2); x.lineTo(-s * 0.36, s * 0.5); x.lineTo(-s * 0.02, y0 + h - 2); x.closePath();
    } else if (kind === 'cloud') {
      for (const [cx, cy, r] of [[-0.24, 0.08, 0.2], [0, -0.06, 0.28], [0.25, 0.06, 0.22], [-0.02, 0.12, 0.2]]) { x.moveTo((cx + r) * s, cy * s); x.arc(cx * s, cy * s, r * s, 0, Math.PI * 2); }
    } else if (kind === 'paw') {
      const e = (cx, cy, rx, ry, rot) => { x.moveTo((cx + rx) * s, cy * s); x.ellipse(cx * s, cy * s, rx * s, ry * s, rot, 0, Math.PI * 2); };
      e(0, 0.17, 0.27, 0.22, 0); e(-0.3, -0.06, 0.1, 0.14, -0.4); e(-0.11, -0.25, 0.1, 0.15, -0.12); e(0.11, -0.25, 0.1, 0.15, 0.12); e(0.3, -0.06, 0.1, 0.14, 0.4);
    } else if (kind === 'flower') {
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, cx = Math.cos(a) * s * 0.26, cy = Math.sin(a) * s * 0.26; x.moveTo(cx + s * 0.2, cy); x.arc(cx, cy, s * 0.2, 0, Math.PI * 2); }
    }
  }
  function drawDeco(x, kind, color, s) {
    decoPath(x, kind, s);
    x.save(); x.lineJoin = 'round'; x.lineWidth = s * 0.11; x.strokeStyle = '#ffffff';
    x.shadowColor = 'rgba(0,0,0,.28)'; x.shadowBlur = s * 0.06; x.shadowOffsetY = s * 0.025; x.stroke(); x.restore();
    x.fillStyle = color; x.fill();
    if (kind === 'flower') { x.beginPath(); x.arc(0, 0, s * 0.13, 0, Math.PI * 2); x.fillStyle = '#ffe066'; x.fill(); }
    if (kind === 'bubble') { x.fillStyle = 'rgba(0,0,0,.0)'; }
  }

  const textPx = (l) => 64 * l.s;
  function textFont(l) {
    const px = Math.round(textPx(l));
    switch (l.font) {
      case 'pop': return `italic 900 ${px}px "Arial Black","Impact","Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif`;
      case 'meme': return `900 ${px}px Impact,"Arial Black","Anton","PingFang SC","Microsoft YaHei",sans-serif`;
      case 'script': return `italic 700 ${px}px "Segoe Script","Brush Script MT","Snell Roundhand","Apple Chancery","Comic Sans MS","PingFang SC",cursive`;
      case 'plain': return `600 ${px}px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif`;
      default: return `800 ${px}px ${ARIAL_ROUND}`;   // cute, bubble
    }
  }
  const textValue = (l) => (l.font === 'meme' ? l.text.toUpperCase() : l.text) || ' ';
  function layerBox(l) {                            // unrotated size of a layer, used for hit-testing and the selection frame
    if (l.type === 'emoji') { const s = 100 * l.s * 1.15; return { w: s, h: s }; }
    if (l.type === 'deco') { const s = 120 * l.s * (l.kind === 'bubble' ? 1.15 : 1); return { w: s, h: s * (l.kind === 'bubble' ? 1.0 : 1) }; }
    g.save(); g.font = textFont(l);
    const w = g.measureText(textValue(l)).width; g.restore();
    const px = textPx(l);
    return l.font === 'bubble' ? { w: w + px * 0.9, h: px * 1.9 } : { w: w + px * 0.4, h: px * 1.3 };
  }
  function drawText(x, l) {
    const px = textPx(l), t = textValue(l);
    x.font = textFont(l); x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    if (l.font === 'plain') { x.fillStyle = l.color; x.fillText(t, 0, 0); return; }
    if (l.font === 'meme') {
      x.lineWidth = px * 0.17; x.strokeStyle = '#000'; x.strokeText(t, 0, 0); x.fillStyle = l.color; x.fillText(t, 0, 0); return;
    }
    if (l.font === 'pop') {                         // comic "pop": white sticker edge + chunky offset shadow
      const d = px * 0.07;
      x.lineWidth = px * 0.3; x.strokeStyle = '#fff'; x.strokeText(t, 0, 0);
      for (let i = 5; i >= 1; i--) { x.fillStyle = '#2b1d4a'; x.fillText(t, d * i * 0.5, d * i * 0.5); }
      x.lineWidth = px * 0.1; x.strokeStyle = '#2b1d4a'; x.strokeText(t, 0, 0);
      x.fillStyle = l.color; x.fillText(t, 0, 0); return;
    }
    if (l.font === 'bubble') {
      const w = x.measureText(t).width + px * 0.9, h = px * 1.3, r = h * 0.45, x0 = -w / 2, y0 = -h / 2 - px * 0.1;
      x.beginPath(); x.moveTo(x0 + r, y0); x.arcTo(x0 + w, y0, x0 + w, y0 + h, r); x.arcTo(x0 + w, y0 + h, x0, y0 + h, r); x.arcTo(x0, y0 + h, x0, y0, r); x.arcTo(x0, y0, x0 + w, y0, r); x.closePath();
      x.moveTo(-w * 0.18, y0 + h - 2); x.lineTo(-w * 0.3, y0 + h + px * 0.5); x.lineTo(-w * 0.04, y0 + h - 2); x.closePath();
      x.save(); x.shadowColor = 'rgba(0,0,0,.25)'; x.shadowBlur = px * 0.12; x.shadowOffsetY = px * 0.05; x.lineWidth = px * 0.09; x.strokeStyle = '#2b2b2b'; x.stroke(); x.restore();
      x.fillStyle = '#fff'; x.fill();
      x.fillStyle = l.color; x.fillText(t, 0, y0 + h / 2 + px * 0.03); return;
    }
    // cute and script: soft white sticker edge
    x.save(); x.shadowColor = 'rgba(0,0,0,.25)'; x.shadowBlur = px * 0.1; x.shadowOffsetY = px * 0.04;
    x.lineWidth = px * (l.font === 'script' ? 0.22 : 0.28); x.strokeStyle = '#fff'; x.strokeText(t, 0, 0); x.restore();
    x.fillStyle = l.color; x.fillText(t, 0, 0);
  }
  function drawLayer(x, l) {
    x.save(); x.translate(l.x, l.y); x.rotate(l.r);
    if (l.type === 'emoji') {
      x.font = `${Math.round(100 * l.s)}px ${EMOJI_FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.shadowColor = 'rgba(0,0,0,.22)'; x.shadowBlur = 8 * l.s; x.shadowOffsetY = 3 * l.s; x.fillText(l.ch, 0, 0);
    } else if (l.type === 'deco') drawDeco(x, l.kind, l.color, 120 * l.s);
    else drawText(x, l);
    x.restore();
  }
  function addLayer(props) {
    const n = st.layers.length;
    const l = Object.assign({ id: st.nextId++, x: st.w / 2 + ((n * 37) % 90) - 45, y: st.h / 2 + ((n * 53) % 90) - 45, s: 1, r: 0 }, props);
    st.layers.push(l); st.sel = l.id; touch(); renderLayerPanel(); redraw(); return l;
  }
  const layerById = (id) => st.layers.find((l) => l.id === id);
  function removeLayer(id) { st.layers = st.layers.filter((l) => l.id !== id); if (st.sel === id) st.sel = null; touch(); renderLayerPanel(); redraw(); }
  function select(id) { if (st.sel !== id) { st.sel = id; renderLayerPanel(); } redraw(); }

  /* ---------- 4. drawing the whole sticker ---------- */
  function drawCard(x, W, H) {
    const { pattern: p, c1, c2 } = st.bg;
    x.save();
    x.beginPath(); x.moveTo(40, 0); x.arcTo(W, 0, W, H, 40); x.arcTo(W, H, 0, H, 40); x.arcTo(0, H, 0, 0, 40); x.arcTo(0, 0, W, 0, 40); x.closePath(); x.clip();
    x.fillStyle = c1; x.fillRect(0, 0, W, H);
    if (p === 'gradient') {
      const gr = x.createLinearGradient(0, 0, W, H); gr.addColorStop(0, c1); gr.addColorStop(1, c2); x.fillStyle = gr; x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 40; i++) { x.beginPath(); x.arc((i * 97) % W, (i * 61) % H, 5 + (i % 4) * 3, 0, Math.PI * 2); x.fill(); }
    } else if (p === 'dots') {                      // halftone dots that grow towards the bottom
      x.fillStyle = c2;
      for (let row = 0, y = 12; y < H + 12; row++, y += 22) for (let xx = row % 2 ? 11 : 0; xx < W + 22; xx += 22) { x.beginPath(); x.arc(xx, y, 2.5 + 5 * (y / H), 0, Math.PI * 2); x.fill(); }
    } else if (p === 'gingham') {
      x.fillStyle = c2; x.fillRect(0, 0, W, H);
      x.fillStyle = c1; x.globalAlpha = 0.55;
      for (let i = 0; i < W; i += 80) x.fillRect(i, 0, 40, H);
      for (let j = 0; j < H; j += 80) x.fillRect(0, j, W, 40);
      x.globalAlpha = 1;
    } else if (p === 'plaid') {
      x.fillStyle = c2; x.globalAlpha = 0.5;
      for (let i = 20; i < W; i += 96) { x.fillRect(i, 0, 38, H); } for (let j = 20; j < H; j += 96) { x.fillRect(0, j, W, 38); }
      x.globalAlpha = 0.9; x.fillStyle = '#fff'; for (let i = 62; i < W; i += 96) x.fillRect(i, 0, 4, H); for (let j = 62; j < H; j += 96) x.fillRect(0, j, W, 4);
      x.globalAlpha = 1;
    } else if (p === 'rays') {
      const cx = W / 2, cy = H * 0.46, n = 28;
      for (let i = 0; i < n; i += 2) { x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, Math.hypot(W, H), i * 2 * Math.PI / n, (i + 1) * 2 * Math.PI / n); x.closePath(); x.fillStyle = c2; x.fill(); }
    } else if (p === 'stripes') {
      x.save(); x.translate(W / 2, H / 2); x.rotate(-Math.PI / 6); x.fillStyle = c2;
      for (let i = -900; i < 900; i += 64) x.fillRect(i, -900, 32, 1800);
      x.restore();
    } else if (p === 'stars') {
      x.fillStyle = c2;
      for (let row = 0, y = 30; y < H + 30; row++, y += 70) for (let xx = row % 2 ? 35 : 0; xx < W + 70; xx += 70) { x.beginPath(); roundedPoly(x, starPts(xx, y, 15, 7, 5, -Math.PI / 2), 2); x.fill(); }
    }
    x.restore();
    // soft white frame inside the edge, like a printed sticker card
    x.save(); x.lineWidth = 7; x.strokeStyle = 'rgba(255,255,255,.95)';
    x.beginPath(); x.moveTo(52, 12); x.arcTo(W - 12, 12, W - 12, H - 12, 34); x.arcTo(W - 12, H - 12, 12, H - 12, 34); x.arcTo(12, H - 12, 12, 12, 34); x.arcTo(12, 12, W - 12, 12, 34); x.closePath(); x.stroke(); x.restore();
  }
  function drawStrokes(x) {
    for (const s of st.strokes) {
      const p = s.pts; if (p.length < 2) continue;
      x.save(); x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = s.color;
      const path = () => { x.beginPath(); x.moveTo(p[0], p[1]); if (p.length === 2) x.lineTo(p[0] + 0.01, p[1]); for (let i = 2; i + 1 < p.length; i += 2) x.quadraticCurveTo(p[i - 2], p[i - 1], (p[i - 2] + p[i]) / 2, (p[i - 1] + p[i + 1]) / 2); x.lineTo(p[p.length - 2], p[p.length - 1]); };
      if (s.kind === 'marker') { x.globalAlpha = 0.5; x.lineWidth = s.w * 2.4; path(); x.stroke(); }
      else if (s.kind === 'neon') {
        x.shadowColor = s.color; x.shadowBlur = s.w * 2.4; x.lineWidth = s.w * 1.2; path(); x.stroke(); x.stroke();
        x.shadowBlur = 0; x.strokeStyle = '#ffffff'; x.lineWidth = s.w * 0.42; path(); x.stroke();
      } else { x.lineWidth = s.w; path(); x.stroke(); }
      x.restore();
    }
  }
  function baseArea(W, H) {
    if (st.layout === 'card') return { cx: W / 2, cy: H * 0.46, size: W * 0.74 };
    const m = st.borderW + (st.edge2 ? 9 : 0) + 26;
    return { cx: W / 2, cy: H / 2, size: Math.min(W, H) - 2 * m };
  }
  function frameBox(W, H) {
    const a = baseArea(W, H), asp = ASPECT[st.shape] || 1;
    return { x: a.cx - a.size * asp / 2, y: a.cy - a.size / 2, w: a.size * asp, h: a.size };
  }
  function drawFrame(x, W, H) {
    const b = frameBox(W, H);
    if (st.borderW > 0 || st.edge2) {
      shapePath(x, st.shape, b);
      x.save(); x.lineJoin = 'round';
      x.shadowColor = 'rgba(0,0,0,.3)'; x.shadowBlur = 14; x.shadowOffsetY = 4;
      if (st.edge2) { x.lineWidth = 2 * (st.borderW + 8); x.strokeStyle = st.edge2Color; x.stroke(); x.shadowColor = 'transparent'; }
      x.lineWidth = 2 * st.borderW; x.strokeStyle = st.border; x.stroke();
      x.fillStyle = st.border; x.fill();
      x.restore();
    }
    x.save();
    shapePath(x, st.shape, b); x.clip();
    const iw = st.bmp.width || st.bmp.naturalWidth, ih = st.bmp.height || st.bmp.naturalHeight;
    const k = Math.max(b.w / iw, b.h / ih) * st.zoom, dw = iw * k, dh = ih * k;
    st.panX = clamp(st.panX, -(dw - b.w) / 2, (dw - b.w) / 2); st.panY = clamp(st.panY, -(dh - b.h) / 2, (dh - b.h) / 2);
    x.drawImage(st.bmp, b.x + b.w / 2 - dw / 2 + st.panX, b.y + b.h / 2 - dh / 2 + st.panY, dw, dh);
    x.restore();
  }
  function drawSelection(x, l) {
    const bx = layerBox(l), hs = 14 * (cv.width / Math.max(cv.getBoundingClientRect().width, 1));
    x.save(); x.translate(l.x, l.y); x.rotate(l.r);
    x.lineWidth = 1.6 * hs / 14; x.setLineDash([6 * hs / 14, 5 * hs / 14]); x.strokeStyle = '#1c7ed6'; x.strokeRect(-bx.w / 2, -bx.h / 2, bx.w, bx.h); x.setLineDash([]);
    const handle = (hx, hy, fill, glyph) => {
      x.beginPath(); x.arc(hx, hy, hs, 0, Math.PI * 2); x.fillStyle = fill; x.fill(); x.lineWidth = 2; x.strokeStyle = '#fff'; x.stroke();
      x.fillStyle = '#fff'; x.font = `700 ${Math.round(hs * 1.2)}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(glyph, hx, hy + 1);
    };
    handle(-bx.w / 2, -bx.h / 2, '#e03131', '×');
    handle(bx.w / 2, bx.h / 2, '#1c7ed6', '↻');
    x.restore();
  }
  function render(x, ui) {
    const W = st.w, H = st.h;
    x.clearRect(0, 0, W, H);
    if (!st.bmp) return;
    if (st.layout === 'card') drawCard(x, W, H);
    if (cut.on) drawCut(x, W, H); else
    drawFrame(x, W, H);
    drawStrokes(x);
    for (const l of st.layers) drawLayer(x, l);
    if (ui && st.tool === 'move') { const l = layerById(st.sel); if (l) drawSelection(x, l); }
  }

  /* ---------- 5. touch and mouse ---------- */
  const ptrs = new Map();
  let gesture = null;
  const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  const cssScale = () => cv.width / Math.max(cv.getBoundingClientRect().width, 1);
  function toLocal(l, p) { const dx = p.x - l.x, dy = p.y - l.y, c = Math.cos(-l.r), s = Math.sin(-l.r); return { x: dx * c - dy * s, y: dx * s + dy * c }; }
  function fromLocal(l, q) { const c = Math.cos(l.r), s = Math.sin(l.r); return { x: l.x + q.x * c - q.y * s, y: l.y + q.x * s + q.y * c }; }
  function hitHandle(l, p) {
    const bx = layerBox(l), r = 22 * cssScale();
    const del = fromLocal(l, { x: -bx.w / 2, y: -bx.h / 2 }), xf = fromLocal(l, { x: bx.w / 2, y: bx.h / 2 });
    if (Math.hypot(p.x - del.x, p.y - del.y) < r) return 'del';
    if (Math.hypot(p.x - xf.x, p.y - xf.y) < r) return 'xf';
    return null;
  }
  function hitLayer(p) {
    for (let i = st.layers.length - 1; i >= 0; i--) {
      const l = st.layers[i], q = toLocal(l, p), bx = layerBox(l);
      if (Math.abs(q.x) <= bx.w / 2 && Math.abs(q.y) <= bx.h / 2) return l;
    }
    return null;
  }
  const pair = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) }; };

  cv.addEventListener('pointerdown', (e) => {
    if (!st.bmp) return;
    cv.setPointerCapture(e.pointerId);
    const p = toCanvas(e); ptrs.set(e.pointerId, p);
    if (st.tool === 'draw') { if (ptrs.size === 1) beginStroke(p); return; }
    if (st.tool === 'refine') { if (ptrs.size === 1) refineDown(p); return; }
    if (ptrs.size === 2) {                          // two fingers: pinch to resize and rotate the selected layer, or zoom the photo
      const q = pair(), l = layerById(st.sel);
      gesture = { type: 'pinch', d0: q.d, a0: q.a, layer: l ? l.id : null, s0: l ? l.s : 0, r0: l ? l.r : 0, z0: st.zoom };
      return;
    }
    const sel = layerById(st.sel);
    if (sel) {
      const h = hitHandle(sel, p);
      if (h === 'del') { removeLayer(sel.id); gesture = null; return; }
      if (h === 'xf') { gesture = { type: 'xf', id: sel.id, d0: Math.hypot(p.x - sel.x, p.y - sel.y) || 1, a0: Math.atan2(p.y - sel.y, p.x - sel.x), s0: sel.s, r0: sel.r }; return; }
    }
    const hit = hitLayer(p);
    if (hit) { select(hit.id); gesture = { type: 'drag', id: hit.id, dx: hit.x - p.x, dy: hit.y - p.y }; }
    else { select(null); gesture = { type: 'pan', x: p.x, y: p.y, px: st.panX, py: st.panY }; }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = toCanvas(e); ptrs.set(e.pointerId, p);
    if (st.tool === 'draw') { if (ptrs.size === 1) extendStroke(p); return; }
    if (st.tool === 'refine') { refineMove(p); return; }
    if (!gesture) return;
    if (gesture.type === 'pinch' && ptrs.size >= 2) {
      const q = pair(), l = layerById(gesture.layer);
      if (l) { l.s = clamp(gesture.s0 * q.d / gesture.d0, 0.25, 4); l.r = gesture.r0 + (q.a - gesture.a0); renderLayerPanel(true); }
      else st.zoom = clamp(gesture.z0 * q.d / gesture.d0, zoomMin(), 3);
    } else if (gesture.type === 'drag') { const l = layerById(gesture.id); if (l) { l.x = p.x + gesture.dx; l.y = p.y + gesture.dy; } }
    else if (gesture.type === 'xf') {
      const l = layerById(gesture.id); if (!l) return;
      l.s = clamp(gesture.s0 * (Math.hypot(p.x - l.x, p.y - l.y) / gesture.d0), 0.25, 4);
      l.r = gesture.r0 + (Math.atan2(p.y - l.y, p.x - l.x) - gesture.a0); renderLayerPanel(true);
    } else if (gesture.type === 'pan') { st.panX = gesture.px + (p.x - gesture.x); st.panY = gesture.py + (p.y - gesture.y); }
    touch(); redraw();
  });
  const endPtr = (e) => {
    ptrs.delete(e.pointerId);
    if (st.tool === 'draw') { endStroke(); return; }
    if (st.tool === 'refine') { refineUp(); return; }
    if (ptrs.size < 2 && gesture && gesture.type === 'pinch') gesture = null;
    if (ptrs.size === 0) gesture = null;
  };
  cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);

  let cur = null;                                   // the stroke being drawn
  function beginStroke(p) {
    if (st.pen.kind === 'eraser') { gesture = { type: 'erase' }; eraseAt(p); return; }
    cur = { kind: st.pen.kind, color: st.pen.color, w: st.pen.w, pts: [p.x, p.y] }; st.strokes.push(cur); touch(); redraw();
  }
  function extendStroke(p) {
    if (gesture && gesture.type === 'erase') { eraseAt(p); return; }
    if (!cur) return;
    const n = cur.pts.length;
    if (Math.hypot(p.x - cur.pts[n - 2], p.y - cur.pts[n - 1]) > 2.5) { cur.pts.push(p.x, p.y); redraw(); }
  }
  function endStroke() { cur = null; gesture = null; syncDrawButtons(); }
  function eraseAt(p) {
    const r = 18 * cssScale() / 1.0, before = st.strokes.length;
    st.strokes = st.strokes.filter((s) => { for (let i = 0; i + 1 < s.pts.length; i += 2) if (Math.hypot(s.pts[i] - p.x, s.pts[i + 1] - p.y) < r + s.w) return false; return true; });
    if (st.strokes.length !== before) { touch(); redraw(); }
  }

  /* ---------- 6. panels (the controls under the preview) ---------- */
  const chip = (attr, val, label, on) => `<button type="button" class="chip${on ? ' on' : ''}" ${attr}="${val}">${label}</button>`;
  const swatch = (attr, c, on) => `<button type="button" class="sw${on ? ' on' : ''}" ${attr}="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`;

  function renderLayerPanel(light) {
    const box = $('#stkLayerPanel'), l = layerById(st.sel);
    if (!l) { box.hidden = true; box.innerHTML = ''; return; }
    if (light && !box.hidden) {                     // while resizing by touch, only move the sliders
      const s = $('#lySize'), r = $('#lyRot'); if (s) s.value = l.s; if (r) r.value = Math.round(l.r * 180 / Math.PI); return;
    }
    box.hidden = false;
    let h = '';
    if (l.type === 'text') {
      h += `<div class="field"><input id="lyText" maxlength="28" value="${esc(l.text)}" aria-label="Text"></div>
            <div class="chips">${TEXT_STYLES.map((t) => chip('data-font', t[0], t[1], l.font === t[0])).join('')}</div>
            <div class="swatches">${SWATCH.map((c) => swatch('data-lycolor', c, l.color === c)).join('')}</div>`;
    } else if (l.type === 'deco') {
      h += `<div class="swatches">${['#ffd43b', '#ffffff', '#ff6b9d', '#ff8c42', '#37b24d', '#1c7ed6', '#7048e8', '#a47148', '#222222'].map((c) => swatch('data-lycolor', c, l.color === c)).join('')}</div>`;
    }
    h += `<div class="row2"><label>Size <input id="lySize" type="range" min="0.25" max="4" step="0.01" value="${l.s}"></label>
          <label>Rotate <input id="lyRot" type="range" min="-180" max="180" step="1" value="${Math.round(l.r * 180 / Math.PI)}"></label></div>
          <div class="row3"><button type="button" class="btn btn-sm" data-ly="dup">Duplicate</button><button type="button" class="btn btn-sm" data-ly="front">To front</button><button type="button" class="btn btn-sm btn-danger" data-ly="del">Delete</button></div>`;
    box.innerHTML = h;
  }

  const sizeOut = (id, v) => { const o = $(id); if (o) o.textContent = v; };
  function panelHTML() {
    const t = st.tab;
    if (t === 'photo') {
      let h = `<div class="field"><span class="lbl">Frame</span><div class="chips">${SHAPES.map((s) => chip('data-shape', s[0], s[1], st.shape === s[0])).join('')}</div></div>`;
      if (cut.on || cut.refine) return cutoutPanelHTML();
      h = cutoutPanelHTML() + h;
      h += `<div class="field"><span class="lbl">Border colour</span><div class="swatches">${BORDERS.map((c) => swatch('data-border', c, st.border === c)).join('')}</div></div>
            <div class="field"><label for="stkBorderW">Border width <output id="oBorderW">${st.borderW}</output></label><input id="stkBorderW" type="range" min="0" max="40" value="${st.borderW}"></div>
            <div class="field"><label class="chk"><input id="stkEdge2" type="checkbox" ${st.edge2 ? 'checked' : ''}> Extra outer line</label>
              ${st.edge2 ? `<div class="swatches">${['#ff7eb6', '#ffd43b', '#74c0fc', '#69db7c', '#b197fc', '#ff8787'].map((c) => swatch('data-edge2', c, st.edge2Color === c)).join('')}</div>` : ''}</div>
            <div class="field"><label for="stkZoom">Photo zoom <output id="oZoom">${Math.round(st.zoom * 100)}%</output></label><input id="stkZoom" type="range" min="100" max="300" value="${Math.round(st.zoom * 100)}"></div>
            <p class="hint">Tip: drag the photo to re-position it.</p>`;
      return h;
    }
    if (t === 'text') {
      return `<p class="hint">Tap a style to add text, then type your own and drag it where you want. Add as many as you like.</p>
              <div class="grid-add">${TEXT_STYLES.map((s) => `<button type="button" class="add-btn" data-addtext="${s[0]}"><b>${esc(s[2])}</b><small>${s[1]}</small></button>`).join('')}</div>`;
    }
    if (t === 'decor') {
      return `<span class="lbl">Emoji</span><div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" data-addemoji="${e}">${e}</button>`).join('')}</div>
              <span class="lbl" style="margin-top:12px">Decorations</span><div class="grid-add">${DECOS.map((d) => `<button type="button" class="add-btn" data-adddeco="${d[0]}"><canvas width="64" height="64" data-deco="${d[0]}" data-color="${d[2]}"></canvas><small>${d[1]}</small></button>`).join('')}</div>`;
    }
    if (t === 'draw') {
      const kinds = [['pen', 'Pen'], ['marker', 'Marker'], ['neon', 'Neon'], ['eraser', 'Eraser']];
      return `<div class="chips">${kinds.map((k) => chip('data-pen', k[0], k[1], st.pen.kind === k[0])).join('')}</div>
              <div class="swatches" style="margin-top:10px">${SWATCH.concat(['#74c0fc', '#69db7c']).map((c) => swatch('data-pencolor', c, st.pen.color === c)).join('')}</div>
              <div class="field"><label for="stkPenW">Thickness <output id="oPenW">${st.pen.w}</output></label><input id="stkPenW" type="range" min="2" max="30" value="${st.pen.w}"></div>
              <div class="row3"><button type="button" class="btn btn-sm" data-stroke="undo" ${st.strokes.length ? '' : 'disabled'}>Undo line</button><button type="button" class="btn btn-sm btn-danger" data-stroke="clear" ${st.strokes.length ? '' : 'disabled'}>Clear all lines</button></div>
              <p class="hint">Draw with your finger. Neon makes glowing lines. Eraser removes a whole line when you touch it.</p>`;
    }
    if (t === 'card') {
      const pats = [['dots', 'Halftone'], ['gingham', 'Gingham'], ['plaid', 'Plaid'], ['rays', 'Sun rays'], ['stripes', 'Stripes'], ['stars', 'Stars'], ['gradient', 'Gradient'], ['solid', 'Solid']];
      const pairs = [['#ff8fb8', '#fff0f6'], ['#ffe45e', '#ff9ecb'], ['#6fa8ff', '#e6f0ff'], ['#b6f04a', '#fff59d'], ['#e63946', '#ffffff'], ['#a78bfa', '#ffd6f0'], ['#7fe5c3', '#fff7c2'], ['#ffb347', '#fff3d6']];
      return `<div class="chips">${chip('data-layout', 'sticker', 'Sticker (see-through)', st.layout === 'sticker')}${chip('data-layout', 'card', 'Card (pattern background)', st.layout === 'card')}</div>
              ${st.layout === 'card' ? `<div class="field"><span class="lbl">Pattern</span><div class="chips">${pats.map((p) => chip('data-pattern', p[0], p[1], st.bg.pattern === p[0])).join('')}</div></div>
              <div class="field"><span class="lbl">Colours</span><div class="swatches">${pairs.map((pr) => `<button type="button" class="sw two${st.bg.c1 === pr[0] && st.bg.c2 === pr[1] ? ' on' : ''}" data-pair="${pr[0]},${pr[1]}" style="background:linear-gradient(135deg,${pr[0]} 50%,${pr[1]} 50%)" aria-label="Colours ${pr[0]} and ${pr[1]}"></button>`).join('')}</div></div>`
                : '<p class="hint">A card gives your sticker a printed look: choose a pattern and colours. Switch back to Sticker for a see-through background.</p>'}`;
    }
    return '';
  }
  function renderPanel() {
    $('#stkPanel').innerHTML = panelHTML();
    $$('#stkPanel canvas[data-deco]').forEach((c) => { const x = c.getContext('2d'); x.translate(32, 32); drawDeco(x, c.dataset.deco, c.dataset.color, 40); });
    $$('.stk-tab').forEach((b) => b.classList.toggle('on', b.dataset.stkTab === st.tab));
  }
  function setTab(t) {
    st.tab = t;
    st.tool = 'move';
    st.tool = t === 'draw' ? 'draw' : 'move';
    cv.style.cursor = st.tool === 'draw' ? 'crosshair' : 'grab';
    if (cut.refine && t !== 'photo') leaveRefine(false);
    renderPanel(); redraw();
  }
  function syncFoot() {
    const b = $('#stkSave'); if (!b) return;
    b.textContent = st.savedClean ? 'Saved ✓' : 'Save to timeline';
    b.disabled = st.savedClean || st.busy || !st.bmp;
  }
  function syncDrawButtons() { if (st.tab === 'draw') renderPanel(); }
  function setLayout(next) {
    if (next === st.layout) return;
    const W0 = st.w, H0 = st.h;
    st.layout = next; st.w = next === 'card' ? CARD_W : SQ; st.h = next === 'card' ? CARD_H : SQ;
    cv.width = st.w; cv.height = st.h; cv.style.setProperty('--ar', st.w / st.h);
    for (const l of st.layers) { l.x *= st.w / W0; l.y *= st.h / H0; }
    for (const s of st.strokes) for (let i = 0; i < s.pts.length; i += 2) { s.pts[i] *= st.w / W0; s.pts[i + 1] *= st.h / H0; }
    if (cut.on) rebuildCut();
    touch();
  }

  const panel = $('#stkPanel');
  const sheet = $('#sheet-sticker');
  sheet.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-stk-tab]'); if (!t) return;
    const d = t.dataset;
    if (d.stkTab) { setTab(d.stkTab); return; }
    if (d.shape) { st.shape = d.shape; touch(); renderPanel(); redraw(); return; }
    if (d.border) { st.border = d.border; touch(); renderPanel(); redraw(); return; }
    if (d.edge2) { st.edge2Color = d.edge2; touch(); renderPanel(); redraw(); return; }
    if (d.addemoji) { addLayer({ type: 'emoji', ch: d.addemoji }); return; }
    if (d.adddeco) { const de = DECOS.find((x) => x[0] === d.adddeco); addLayer({ type: 'deco', kind: de[0], color: de[2] }); return; }
    if (d.addtext) { const s = TEXT_STYLES.find((x) => x[0] === d.addtext); addLayer({ type: 'text', font: s[0], text: s[2], color: s[3], s: s[0] === 'meme' ? 0.75 : 1 }); setTimeout(() => { const i = $('#lyText'); if (i) { i.focus(); i.select(); } }, 30); return; }
    const l = layerById(st.sel);
    if (d.font && l) { l.font = d.font; touch(); renderLayerPanel(); redraw(); return; }
    if (d.lycolor && l) { l.color = d.lycolor; touch(); renderLayerPanel(); redraw(); return; }
    if (d.ly && l) {
      if (d.ly === 'del') removeLayer(l.id);
      else if (d.ly === 'front') { st.layers = st.layers.filter((x) => x !== l).concat(l); touch(); redraw(); toast('Moved to front'); }
      else if (d.ly === 'dup') { addLayer(Object.assign({}, l, { id: undefined, x: l.x + 26, y: l.y + 26 })); }
      return;
    }
    if (d.pen) { st.pen.kind = d.pen; renderPanel(); return; }
    if (d.pencolor) { st.pen.color = d.pencolor; if (st.pen.kind === 'eraser') st.pen.kind = 'pen'; renderPanel(); return; }
    if (d.stroke === 'undo') { st.strokes.pop(); touch(); renderPanel(); redraw(); return; }
    if (d.stroke === 'clear') { st.strokes = []; touch(); renderPanel(); redraw(); return; }
    if (d.layout) { setLayout(d.layout); renderPanel(); redraw(); return; }
    if (d.pattern) { st.bg.pattern = d.pattern; touch(); renderPanel(); redraw(); return; }
    if (d.pair) { const [a, b] = d.pair.split(','); st.bg.c1 = a; st.bg.c2 = b; touch(); renderPanel(); redraw(); return; }
    if (cutoutClick(d)) return;
  });
  sheet.addEventListener('input', (e) => {
    const id = e.target.id, l = layerById(st.sel);
    if (id === 'lyText' && l) { l.text = e.target.value; touch(); redraw(); }
    else if (id === 'lySize' && l) { l.s = +e.target.value; touch(); redraw(); }
    else if (id === 'lyRot' && l) { l.r = +e.target.value * Math.PI / 180; touch(); redraw(); }
    else if (id === 'stkBorderW') { st.borderW = +e.target.value; sizeOut('#oBorderW', st.borderW); touch(); redraw(); }
    else if (id === 'stkZoom') { st.zoom = e.target.value / 100; sizeOut('#oZoom', e.target.value + '%'); touch(); redraw(); }
    else if (id === 'stkPenW') { st.pen.w = +e.target.value; sizeOut('#oPenW', st.pen.w); }
    else if (cutoutInput(id, e.target)) { /* handled */ }
  });
  sheet.addEventListener('change', (e) => {
    if (e.target.id === 'stkEdge2') { st.edge2 = e.target.checked; touch(); renderPanel(); redraw(); }
    else if (e.target.id === 'stkShadow') { cut.shadow = e.target.checked; touch(); redraw(); }
  });


  /* ---------- 8. cut-out: find the pet, remove the background, add an outline ---------- */
  const cut = { on: false, busy: false, refine: false, base: null, mask: null, sub: null, comp: null, bb: null, pad: 0,
    outline: 'solid', ocolor: '#ffffff', ocolor2: '#ff7eb6', ow: 14, shadow: true, method: '', undo: [], brush: { mode: 'add', size: 24 }, progress: 0 };
  const cutState = () => cut;
  const BASE_MAX = 768;                              // working size of the photo while cutting out
  let enginePromise = null;
  const loadScript = (src) => new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(el); });
  const fetchOk = (u, kind) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ': HTTP ' + r.status); return r[kind](); });
  function loadEngine() {                            // the AI model is only downloaded the first time it is needed
    if (!enginePromise) {
      enginePromise = (async () => {
        if (!window.U2Net) await loadScript('vendor/u2net-engine.js');
        if (!U2Net.supported()) throw new Error('WebAssembly SIMD is not available in this browser');
        const [wasmBytes, planJson, weightsBuffer] = await Promise.all([fetchOk('vendor/conv.wasm', 'arrayBuffer'), fetchOk('vendor/u2netp.json', 'text'), fetchOk('vendor/u2netp.bin', 'arrayBuffer')]);
        return U2Net.create({ wasmBytes, planJson, weightsBuffer });
      })().catch((e) => { enginePromise = null; throw e; });
    }
    return enginePromise;
  }
  function resetCutout() {
    Object.assign(cut, { on: false, busy: false, refine: false, base: null, mask: null, sub: null, comp: null, bb: null, pad: 0, outline: 'solid', ocolor: '#ffffff', ocolor2: '#ff7eb6', ow: 14, shadow: true, method: '', undo: [], brush: { mode: 'add', size: 24 }, progress: 0 });
    st.cutOn = false;
  }

  /* turn a 0..1 map into a sharp-edged alpha canvas the size of the working photo */
  function maskFromMap(map, mw, mh, W, H) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < map.length; i++) { const v = map[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const sc = hi > lo ? 1 / (hi - lo) : 1;
    const small = document.createElement('canvas'); small.width = mw; small.height = mh;
    const sx = small.getContext('2d'), img = sx.createImageData(mw, mh);
    for (let i = 0; i < map.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = Math.round(clamp((map[i] - lo) * sc, 0, 1) * 255); }
    sx.putImageData(img, 0, 0);
    const m = document.createElement('canvas'); m.width = W; m.height = H;
    const mx = m.getContext('2d', { willReadFrequently: true }); mx.imageSmoothingQuality = 'high'; mx.drawImage(small, 0, 0, W, H);
    const d = mx.getImageData(0, 0, W, H), a = d.data;
    for (let i = 3; i < a.length; i += 4) a[i] = clamp(Math.round((a[i] - 100) * 255 / 70), 0, 255);   // sharpen the soft edge
    mx.putImageData(d, 0, 0);
    return m;
  }
  async function aiMask(base) {
    const eng = await loadEngine(), S = 320;
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(base, 0, 0, S, S);
    const d = x.getImageData(0, 0, S, S).data, { mean, std } = eng.plan;
    let mx = 1; for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]);
    const inp = new Float32Array(3 * S * S);
    for (let i = 0; i < S * S; i++) for (let k = 0; k < 3; k++) inp[k * S * S + i] = (d[i * 4 + k] / mx - mean[k]) / std[k];
    const map = await eng.run(inp, S, S, { yieldToUI: true, onProgress: (p) => { cut.progress = p; const el = $('#cutProg'); if (el) el.textContent = Math.round(p * 100) + '%'; } });
    return maskFromMap(map, S, S, base.width, base.height);
  }

  /* fallback without the AI model: anything unlike the colours along the photo's border is "the pet" */
  function quickMask(base) {
    const S = 160, c = drawScaled(base, S), w = c.width, h = c.height;
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const border = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) { const i = (y * w + x) * 4; border.push([d[i], d[i + 1], d[i + 2]]); }
    let cent = [border[0], border[border.length >> 1], border[border.length - 1]];     // tiny k-means: backgrounds often have 2-3 colours
    for (let it = 0; it < 6; it++) {
      const sum = cent.map(() => [0, 0, 0, 0]);
      for (const p of border) { let b = 0, bd = 1e9; cent.forEach((q, k) => { const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (dd < bd) { bd = dd; b = k; } }); sum[b][0] += p[0]; sum[b][1] += p[1]; sum[b][2] += p[2]; sum[b][3]++; }
      cent = sum.map((s2, k) => (s2[3] ? [s2[0] / s2[3], s2[1] / s2[3], s2[2] / s2[3]] : cent[k]));
    }
    const dist = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { let b = 1e9; for (const q of cent) { const dd = Math.hypot(d[i * 4] - q[0], d[i * 4 + 1] - q[1], d[i * 4 + 2] - q[2]); if (dd < b) b = dd; } dist[i] = b; }
    const hist = new Array(64).fill(0); for (const v of dist) hist[Math.min(63, v >> 2)]++;                   // Otsu threshold on the distance
    let tot = dist.length, sumAll = 0; hist.forEach((n, i) => { sumAll += i * n; });
    let wB = 0, sB = 0, best = 0, thr = 8;
    for (let i = 0; i < 64; i++) { wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sumAll - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = i; } }
    thr = clamp(thr * 4 + 4, 28, 90);
    const bg = new Uint8Array(w * h), q = [];                                                              // flood the background in from the border
    const push = (i) => { if (!bg[i] && dist[i] < thr) { bg[i] = 1; q.push(i); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (q.length) { const i = q.pop(), x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w); }
    const lab = new Int32Array(w * h), sizes = [0]; let n = 0;                                             // keep the biggest object only
    for (let i0 = 0; i0 < w * h; i0++) {
      if (bg[i0] || lab[i0]) continue;
      n++; sizes[n] = 0; lab[i0] = n; const st2 = [i0];
      while (st2.length) { const i = st2.pop(); sizes[n]++; const x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && !bg[j] && !lab[j]) { lab[j] = n; st2.push(j); } }
    }
    let keep = 1; for (let k = 1; k <= n; k++) if (sizes[k] > sizes[keep]) keep = k;
    const map = new Float32Array(w * h); for (let i = 0; i < w * h; i++) map[i] = lab[i] === keep ? 1 : 0;
    return maskFromMap(map, w, h, base.width, base.height);
  }

  function computeBB() {                             // bounding box of the pet inside the mask
    const W = cut.mask.width, H = cut.mask.height, k = Math.min(1, 128 / Math.max(W, H));
    const sw = Math.max(1, Math.round(W * k)), sh = Math.max(1, Math.round(H * k));
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(cut.mask, 0, 0, sw, sh);
    const a = x.getImageData(0, 0, sw, sh).data;
    let x0 = sw, y0 = sh, x1 = -1, y1 = -1, cnt = 0;
    for (let y = 0; y < sh; y++) for (let xx = 0; xx < sw; xx++) if (a[(y * sw + xx) * 4 + 3] > 60) { cnt++; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (cnt < 12) return false;
    cut.bb = { x: x0 / k, y: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
    return true;
  }
  function stamps(dst, sil, pad, r) {                // dilate: draw the silhouette around a circle of radius r
    const n = Math.max(16, Math.min(72, Math.ceil(r * 3)));
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; dst.drawImage(sil, pad + Math.cos(a) * r, pad + Math.sin(a) * r); }
  }
  function rebuildCut() {                            // cut.sub = the pet only; cut.comp = outline + shadow-ready sticker
    if (!cut.base || !cut.mask) return;
    const W = cut.base.width, H = cut.base.height;
    const sub = document.createElement('canvas'); sub.width = W; sub.height = H;
    const sx = sub.getContext('2d'); sx.drawImage(cut.base, 0, 0); sx.globalCompositeOperation = 'destination-in'; sx.drawImage(cut.mask, 0, 0);
    cut.sub = sub;
    const bbMax = Math.max(cut.bb.w, cut.bb.h);
    const unit = bbMax / baseArea(st.w, st.h).size;      // base pixels per output pixel at zoom 1
    const wpx = cut.outline === 'none' ? 0 : cut.ow * unit;
    const pad = Math.ceil(wpx + 6 * unit);
    cut.pad = pad;
    const comp = document.createElement('canvas'); comp.width = W + 2 * pad; comp.height = H + 2 * pad;
    const cx = comp.getContext('2d');
    if (wpx > 0) {
      const tint = (colour) => { const t = document.createElement('canvas'); t.width = W; t.height = H; const tx = t.getContext('2d'); tx.drawImage(cut.mask, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = colour; tx.fillRect(0, 0, W, H); return t; };
      const ring = (colour, r) => { const t = tint(colour); stamps(cx, t, pad, r); cx.drawImage(t, pad, pad); };
      if (cut.outline === 'double') { ring(cut.ocolor2, wpx); ring(cut.ocolor, wpx * 0.55); }
      else if (cut.outline === 'neon') {
        cx.save(); cx.shadowColor = cut.ocolor2; cx.shadowBlur = wpx * 1.4; ring(cut.ocolor2, wpx * 0.9); cx.restore();
        ring('#ffffff', wpx * 0.42);
      } else ring(cut.ocolor, wpx);
    }
    cx.drawImage(sub, pad, pad);
    cut.comp = comp;
  }
  function cutXf(W, H) {                             // where the comp canvas lands inside the sticker
    const a = baseArea(W, H), bb = cut.bb;
    const k = Math.min(a.size / bb.w, a.size / bb.h) * st.zoom;
    const lim = Math.max(W, H) * 0.6;
    st.panX = clamp(st.panX, -lim, lim); st.panY = clamp(st.panY, -lim, lim);
    return { k, ox: a.cx + st.panX - k * (bb.x + bb.w / 2 + cut.pad), oy: a.cy + st.panY - k * (bb.y + bb.h / 2 + cut.pad) };
  }
  function drawCut(x, W, H) {
    if (!cut.comp) return;
    const f = cutXf(W, H);
    if (cut.refine) {                                // show the original dimmed, with the pet bright, so edits are easy to see
      x.save(); x.globalAlpha = 0.4; x.drawImage(cut.base, f.ox + f.k * cut.pad, f.oy + f.k * cut.pad, cut.base.width * f.k, cut.base.height * f.k); x.restore();
      x.drawImage(cut.sub, f.ox + f.k * cut.pad, f.oy + f.k * cut.pad, cut.sub.width * f.k, cut.sub.height * f.k);
      return;
    }
    x.save();
    if (cut.shadow) { x.shadowColor = 'rgba(0,0,0,.32)'; x.shadowBlur = 16; x.shadowOffsetY = 6; }
    x.imageSmoothingQuality = 'high';
    x.drawImage(cut.comp, f.ox, f.oy, cut.comp.width * f.k, cut.comp.height * f.k);
    x.restore();
  }

  /* brush touch-up of the cut-out edge */
  let brushLast = null, brushHist = false;
  function maskPoint(p) { const f = cutXf(st.w, st.h); return { x: (p.x - f.ox) / f.k - cut.pad, y: (p.y - f.oy) / f.k - cut.pad, r: cut.brush.size / f.k }; }
  function paintDot(a, b) {
    const m = cut.mask.getContext('2d');
    m.save(); m.lineCap = 'round'; m.lineJoin = 'round'; m.lineWidth = a.r * 2;
    if (cut.brush.mode === 'add') { m.globalCompositeOperation = 'source-over'; m.strokeStyle = m.fillStyle = '#fff'; }
    else { m.globalCompositeOperation = 'destination-out'; m.strokeStyle = m.fillStyle = '#000'; }
    m.beginPath(); m.moveTo(b.x, b.y); m.lineTo(a.x, a.y); m.stroke(); m.beginPath(); m.arc(a.x, a.y, a.r, 0, Math.PI * 2); m.fill(); m.restore();
  }
  function refineDown(p) {
    const snap = document.createElement('canvas'); snap.width = cut.mask.width; snap.height = cut.mask.height; snap.getContext('2d').drawImage(cut.mask, 0, 0);
    cut.undo.push(snap); if (cut.undo.length > 8) cut.undo.shift();
    brushLast = maskPoint(p); paintDot(brushLast, brushLast); brushHist = true; refreshSub(); redraw();
  }
  function refineMove(p) { if (!brushLast) return; const q = maskPoint(p); paintDot(q, brushLast); brushLast = q; refreshSub(); redraw(); }
  function refineUp() { brushLast = null; if (brushHist) { touch(); brushHist = false; renderPanel(); } }
  function refreshSub() {
    const sx = cut.sub.getContext('2d'); sx.globalCompositeOperation = 'source-over'; sx.clearRect(0, 0, cut.sub.width, cut.sub.height);
    sx.drawImage(cut.base, 0, 0); sx.globalCompositeOperation = 'destination-in'; sx.drawImage(cut.mask, 0, 0); sx.globalCompositeOperation = 'source-over';
  }
  function enterRefine() { cut.refine = true; st.tool = 'refine'; cv.style.cursor = 'crosshair'; renderPanel(); redraw(); }
  function leaveRefine(rebuild) {
    cut.refine = false; st.tool = st.tab === 'draw' ? 'draw' : 'move'; cv.style.cursor = st.tool === 'draw' ? 'crosshair' : 'grab';
    if (rebuild !== false && cut.mask) { computeBB(); rebuildCut(); }
    renderPanel(); redraw();
  }

  async function startCutout() {
    if (cut.busy || !st.bmp) return;
    cut.busy = true; cut.progress = 0; renderPanel();
    try {
      const base = drawScaled(st.bmp, BASE_MAX);
      let mask, method;
      try { mask = await aiMask(base); method = 'AI model running on your phone'; }
      catch (e) { console.warn('AI cut-out not available, using the quick method:', e); mask = quickMask(base); method = 'quick colour-based cut-out (the AI model is not available here)'; }
      cut.base = base; cut.mask = mask; cut.method = method;
      if (!computeBB()) throw new Error('I could not find the pet in this photo. Try one with a plainer background.');
      cut.on = true; st.cutOn = true; cut.undo = []; st.zoom = 1; st.panX = st.panY = 0;
      rebuildCut(); touch();
    } catch (e) { cut.on = false; st.cutOn = false; toast(e.message || String(e), 'err', 4000); }
    finally { cut.busy = false; renderPanel(); redraw(); }
  }
  function stopCutout() { resetCutout(); st.zoom = 1; st.panX = st.panY = 0; touch(); renderPanel(); redraw(); }
  let rebuildTimer = 0;
  const rebuildSoon = () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => { rebuildCut(); redraw(); }, 90); };

  function cutoutPanelHTML() {
    if (cut.busy) return `<div class="busy-box"><div class="spinner"></div><b>Finding your pet…</b> <span id="cutProg">${Math.round(cut.progress * 100)}%</span><p class="hint">The first time takes a few seconds while the cut-out model loads. Everything stays on your phone.</p></div>`;
    if (cut.refine) {
      return `<div class="chips">${chip('data-brush', 'add', '➕ Add back', cut.brush.mode === 'add')}${chip('data-brush', 'erase', '➖ Erase', cut.brush.mode === 'erase')}</div>
              <div class="field"><label for="stkBrush">Brush size <output id="oBrush">${cut.brush.size}</output></label><input id="stkBrush" type="range" min="6" max="60" value="${cut.brush.size}"></div>
              <div class="row3"><button type="button" class="btn btn-sm" data-cut="undo" ${cut.undo.length ? '' : 'disabled'}>Undo</button><button type="button" class="btn btn-sm btn-primary" data-cut="done">Done</button></div>
              <p class="hint">Paint over the picture with your finger. “Erase” removes background that was left on, “Add back” restores a part that was cut off.</p>`;
    }
    if (!cut.on) return `<div class="field"><button type="button" class="btn btn-primary" data-cut="start">✂️ Cut out my pet automatically</button><p class="hint">Removes the background and adds a sticker outline.</p></div>`;
    const styles = [['none', 'No outline'], ['solid', 'Solid'], ['double', 'Double'], ['neon', 'Neon glow']];
    const cols = ['#ffffff', '#fff3b0', '#ffd1e0', '#ffb703', '#ff5d8f', '#74c0fc', '#69db7c', '#3b2f23'];
    const c2 = ['#ff7eb6', '#ffd43b', '#74c0fc', '#69db7c', '#b197fc', '#ff8787', '#2b2d42'];
    const neon = cut.outline === 'neon', dbl = cut.outline === 'double';
    return `<div class="field"><span class="lbl">Outline style</span><div class="chips">${styles.map((s) => chip('data-ostyle', s[0], s[1], cut.outline === s[0])).join('')}</div></div>
            ${cut.outline !== 'none' ? `<div class="field"><span class="lbl">${neon ? 'Glow colour' : dbl ? 'Inner colour' : 'Outline colour'}</span><div class="swatches">${(neon ? c2 : cols).map((c) => swatch(neon ? 'data-ocolor2' : 'data-ocolor', c, (neon ? cut.ocolor2 : cut.ocolor) === c)).join('')}</div></div>
            ${dbl ? `<div class="field"><span class="lbl">Outer colour</span><div class="swatches">${c2.map((c) => swatch('data-ocolor2', c, cut.ocolor2 === c)).join('')}</div></div>` : ''}
            <div class="field"><label for="stkOw">Outline width <output id="oOw">${cut.ow}</output></label><input id="stkOw" type="range" min="2" max="40" value="${cut.ow}"></div>` : ''}
            <div class="field"><label class="chk"><input id="stkShadow" type="checkbox" ${cut.shadow ? 'checked' : ''}> Soft shadow</label></div>
            <div class="field"><label for="stkZoom">Size <output id="oZoom">${Math.round(st.zoom * 100)}%</output></label><input id="stkZoom" type="range" min="40" max="300" value="${Math.round(st.zoom * 100)}"></div>
            <div class="row3"><button type="button" class="btn btn-sm" data-cut="refine">🖌 Fix the edges</button><button type="button" class="btn btn-sm" data-cut="redo">↻ Cut again</button><button type="button" class="btn btn-sm" data-cut="off">Undo cut-out</button></div>
            <p class="hint">Drag to move the pet, pinch to resize. Made with: ${esc(cut.method)}.</p>`;
  }
  function cutoutClick(d) {
    if (d.cut) {
      if (d.cut === 'start' || d.cut === 'redo') { if (d.cut === 'redo') { const keep = { o: cut.outline, c: cut.ocolor, c2: cut.ocolor2, w: cut.ow, s: cut.shadow }; resetCutout(); Object.assign(cut, { outline: keep.o, ocolor: keep.c, ocolor2: keep.c2, ow: keep.w, shadow: keep.s }); } startCutout(); }
      else if (d.cut === 'off') stopCutout();
      else if (d.cut === 'refine') enterRefine();
      else if (d.cut === 'done') leaveRefine(true);
      else if (d.cut === 'undo') { const snap = cut.undo.pop(); if (snap) { const m = cut.mask.getContext('2d'); m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, cut.mask.width, cut.mask.height); m.drawImage(snap, 0, 0); refreshSub(); renderPanel(); redraw(); } }
      return true;
    }
    if (d.brush) { cut.brush.mode = d.brush; renderPanel(); return true; }
    if (d.ostyle) { cut.outline = d.ostyle; touch(); rebuildCut(); renderPanel(); redraw(); return true; }
    if (d.ocolor) { cut.ocolor = d.ocolor; touch(); rebuildCut(); renderPanel(); redraw(); return true; }
    if (d.ocolor2) { cut.ocolor2 = d.ocolor2; touch(); rebuildCut(); renderPanel(); redraw(); return true; }
    return false;
  }
  function cutoutInput(id, el) {
    if (id === 'stkOw') { cut.ow = +el.value; sizeOut('#oOw', cut.ow); touch(); rebuildSoon(); return true; }
    if (id === 'stkBrush') { cut.brush.size = +el.value; sizeOut('#oBrush', cut.brush.size); return true; }
    return false;
  }

  /* ---------- 7. open, reset, save, share ---------- */
  function resetState() {
    Object.assign(st, { shape: 'circle', border: '#ffffff', borderW: 18, edge2: false, edge2Color: '#ff7eb6', zoom: 1, panX: 0, panY: 0, layers: [], sel: null, nextId: 1, tab: 'photo', tool: 'move', dirty: false, savedClean: false, busy: false, w: SQ, h: SQ });
    Object.assign(st, { layout: 'sticker', bg: { pattern: 'dots', c1: '#ff8fb8', c2: '#fff0f6' }, strokes: [], pen: { kind: 'pen', color: '#ff3d81', w: 8 } });
    cv.style.cursor = 'grab';
    resetCutout();
    cv.width = st.w; cv.height = st.h; cv.style.setProperty('--ar', st.w / st.h);
  }
  async function open(rec) {
    try {
      if (st.bmp && st.bmp.close) st.bmp.close();
      st.bmp = await blobToBitmap(rec.blob);
    } catch (e) { toast('Could not open that photo: ' + e.message, 'err'); return; }
    st.rec = rec;
    resetState(); renderPanel(); renderLayerPanel(); syncFoot();
    openSheet('sheet-sticker');
    requestAnimationFrame(redrawNow);
  }
  function reset() {
    if (st.dirty && !confirm('Start over? This clears everything you added to the sticker.')) return;
    resetState(); renderPanel(); renderLayerPanel(); syncFoot(); redrawNow(); toast('Sticker reset');
  }
  function canClose() { return !st.dirty || st.savedClean || confirm('Close without saving this sticker?'); }
  function exportCanvas() {
    const c = document.createElement('canvas'); c.width = st.w; c.height = st.h;
    render(c.getContext('2d'), false); return c;
  }
  async function save() {
    if (st.busy || st.savedClean || !st.bmp) return;     // repeated clicks do nothing
    st.busy = true; syncFoot();
    try {
      const c = exportCanvas();
      const blob = await toBlob(c, 'image/png');
      const rec = { id: uid(), ts: Date.now(), kind: 'sticker', blob, thumb: await toBlob(drawScaled(c, 320), 'image/png'), hash: '0000000000000000', sharp: 0, tags: [], pinCover: false, demo: false, srcId: st.rec && st.rec.id };
      await dbPut(rec); state.photos.push(rec); markChanged();
      st.savedClean = true;
      toast('Sticker saved to your timeline ✓');
    } catch (e) { toast('Could not save the sticker: ' + (e.message || e), 'err', 3500); }
    finally { st.busy = false; syncFoot(); }
  }
  async function share() {
    if (st.busy || !st.bmp) return;
    st.busy = true;
    try {
      const blob = await toBlob(exportCanvas(), 'image/png');
      shareToast(await shareBlob(blob, `pawtime-sticker-${Date.now()}.png`));
    } catch (e) { toast('Could not share: ' + (e.message || e), 'err', 3500); }
    finally { st.busy = false; syncFoot(); }
  }

  window.addEventListener('keydown', (e) => {         // Escape must not throw away unsaved work without asking
    if (e.key === 'Escape' && !sheet.hidden && !canClose()) e.stopImmediatePropagation();
  }, true);
  $('#stkClose').addEventListener('click', () => { if (canClose()) { closeSheet('sheet-sticker'); renderTimeline(); } });
  $('#stkReset').addEventListener('click', reset);
  $('#stkSave').addEventListener('click', save);
  $('#stkShare').addEventListener('click', share);

  return { open, canClose, redrawNow, _st: st, _exportCanvas: exportCanvas,
    _cut: () => cutState(),
    _render: render };
})();
