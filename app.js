'use strict';
/* =====================================================================
   PawTime: shoot-to-save pet memories that fold into a growth timeline.
   Plain JavaScript, no build step, no dependencies.

   Main loop:  shutter tap -> photo shrunk + fingerprinted + saved in
   IndexedDB -> similar photos auto-fold into "moments" -> timeline.
   Sections:  1 helpers   2 storage   3 image pipeline   4 folding
              5 camera    6 timeline  7 viewer           8 sticker studio
              9 sample data   10 settings   11 start-up
   ===================================================================== */

/* ---------- 1. helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthKey = (ts) => dayKey(ts).slice(0, 7);
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
const fmtDay = (ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = (ts) => new Date(ts).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function openSheet(id) { const el = $('#' + id); if (el) el.hidden = false; }
function closeSheet(id) { const el = $('#' + id); if (el) el.hidden = true; }

const TAGS = [
  { id: 'eat', emoji: '🍖', label: 'Eating' },
  { id: 'sleep', emoji: '😴', label: 'Sleeping' },
  { id: 'walk', emoji: '🦮', label: 'Walk' },
  { id: 'silly', emoji: '🤪', label: 'Silly' },
  { id: 'milestone', emoji: '⭐', label: 'Milestone' }
];
const tagEmoji = (id) => (TAGS.find((t) => t.id === id) || {}).emoji || '';

const DEFAULT_SETTINGS = { sim: 10, windowMin: 20 };

const state = {
  photos: [],            // every stored record (photos and stickers)
  profile: null,         // {name, birthday, skipped, demo}
  settings: { ...DEFAULT_SETTINGS },
  filterTag: null,
  rev: 0,                // bumps whenever data or folding settings change
  timelineDirty: true
};

let toastTimer;
function toast(msg, kind = '', ms = 2300) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', kind === 'err');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- 2. storage (IndexedDB, with in-memory fallback) ---------- */
let db = null;
const memStore = { photos: new Map(), meta: new Map() };
let memoryOnly = false;

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open('pawtime', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}
function idb(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let req;
    try { req = fn(os); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const dbPut = (rec) => memoryOnly ? (memStore.photos.set(rec.id, rec), Promise.resolve()) : idb('photos', 'readwrite', (s) => s.put(rec));
const dbDelete = (id) => memoryOnly ? (memStore.photos.delete(id), Promise.resolve()) : idb('photos', 'readwrite', (s) => s.delete(id));
const dbAll = () => memoryOnly ? Promise.resolve([...memStore.photos.values()]) : idb('photos', 'readonly', (s) => s.getAll());
const dbClear = () => memoryOnly ? (memStore.photos.clear(), Promise.resolve()) : idb('photos', 'readwrite', (s) => s.clear());
const metaGet = (key) => memoryOnly ? Promise.resolve(memStore.meta.get(key)) : idb('meta', 'readonly', (s) => s.get(key)).then((r) => r && r.value);
const metaSet = (key, value) => memoryOnly ? (memStore.meta.set(key, value), Promise.resolve()) : idb('meta', 'readwrite', (s) => s.put({ key, value }));

/* ---------- 3. image pipeline ---------- */
async function blobToBitmap(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const u = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('This file is not an image I can read.')); };
    img.src = u;
  });
}
const srcSize = (s) => ({ w: s.width || s.naturalWidth, h: s.height || s.naturalHeight });

function drawScaled(src, maxSide) {
  const { w, h } = srcSize(src);
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const toBlob = (c, type = 'image/jpeg', q = 0.85) =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, q));

/* dHash ("difference hash"): shrink to 9x8 greyscale, then record for every
   pixel whether it is brighter than its right-hand neighbour. 64 yes/no bits
   describe the photo's rough layout; near-identical shots give near-identical
   bits. Stored as 16 hex characters. */
function dHash(src) {
  const mid = drawScaled(src, 72);            // gentle first shrink avoids aliasing
  const c = document.createElement('canvas');
  c.width = 9; c.height = 8;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(mid, 0, 0, 9, 8);
  const d = x.getImageData(0, 0, 9, 8).data;
  const grey = (i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  let hex = '', nibble = 0, n = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const i = (row * 9 + col) * 4;
      nibble = (nibble << 1) | (grey(i) > grey(i + 4) ? 1 : 0);
      if (++n === 4) { hex += nibble.toString(16); nibble = 0; n = 0; }
    }
  }
  return hex;
}
const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
function hamming(a, b) {
  let bits = 0;
  for (let i = 0; i < a.length; i++) bits += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return bits;
}

/* Sharpness = variance of a Laplacian filter on a small greyscale copy.
   Blurry shots score low, so the sharpest shot becomes the moment's cover. */
function sharpness(src) {
  const c = drawScaled(src, 128);
  const x = c.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = c;
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  let sum = 0, sum2 = 0, n = 0;
  for (let yy = 1; yy < h - 1; yy++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = yy * w + xx;
      const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      sum += v; sum2 += v * v; n++;
    }
  }
  const mean = sum / n;
  return Math.round((sum2 / n - mean * mean) * 10) / 10;
}

/* Turn any image source (canvas, bitmap, <img>) into a stored photo record. */
async function ingestSource(src, opts = {}) {
  const big = drawScaled(src, 1000);
  const small = drawScaled(src, 320);
  const rec = {
    id: uid(),
    ts: opts.ts || Date.now(),
    kind: 'photo',
    blob: await toBlob(big, 'image/jpeg', 0.86),
    thumb: await toBlob(small, 'image/jpeg', 0.8),
    hash: dHash(big),
    sharp: sharpness(big),
    tags: opts.tags ? [...opts.tags] : [],
    pinCover: false,
    demo: !!opts.demo
  };
  await dbPut(rec);
  state.photos.push(rec);
  markChanged();
  return rec;
}
async function ingestFile(file, opts = {}) {
  const bmp = await blobToBitmap(file);
  try {
    return await ingestSource(bmp, { ts: file.lastModified || Date.now(), ...opts });
  } finally { if (bmp.close) bmp.close(); }
}

const urls = new Map();
function urlFor(rec, which = 'blob') {
  const k = rec.id + ':' + which;
  if (!urls.has(k)) urls.set(k, URL.createObjectURL(rec[which]));
  return urls.get(k);
}
function dropUrls(id) {
  for (const k of [id + ':blob', id + ':thumb']) {
    if (urls.has(k)) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); }
  }
}
function markChanged() { state.rev++; state.timelineDirty = true; updateChrome(); }

/* ---------- 5. camera ---------- */
const video = $('#video');
let stream = null, facing = 'environment', camReady = false, burst = false, shooting = false;
let lastBatch = [], quickTagTimer;

function showCamMsg(title, text) {
  $('#camMsgTitle').textContent = title;
  $('#camMsgText').textContent = text;
  $('#camMsg').hidden = false;
  camReady = false;
}
function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null; camReady = false; video.srcObject = null;
}
async function startCamera() {
  stopCamera();
  $('#camMsg').hidden = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const insecure = !window.isSecureContext;
    showCamMsg('Camera not available here',
      insecure ? 'Browsers only allow the camera on secure (https) pages. Open the https link, or use your gallery or the sample photos instead.'
               : 'This browser cannot open the camera. You can still add photos from your gallery or try the sample photos.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
    });
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    await video.play().catch(() => {});
    camReady = true;
  } catch (err) {
    const n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError')
      showCamMsg('Camera permission was denied', 'PawTime needs the camera to shoot. Allow it in your browser or phone settings, then try again. Or add photos from your gallery instead.');
    else if (n === 'NotFoundError' || n === 'OverconstrainedError')
      showCamMsg('No camera found', 'This device has no camera PawTime can use. Add photos from your gallery, or try the sample photos.');
    else if (n === 'NotReadableError' || n === 'AbortError')
      showCamMsg('Camera is busy', 'Another app may be using the camera. Close it and try again.');
    else
      showCamMsg('Could not start the camera', (err && err.message) || 'Something went wrong.');
  }
}
function grabFrame() {
  if (!camReady || !video.videoWidth) throw new Error('Camera is not ready yet');
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}
function flash() {
  const f = $('#flash');
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  if (navigator.vibrate) navigator.vibrate(15);
}
async function shoot() {
  if (shooting) return;                       // repeated taps while saving are ignored
  if (!camReady) { toast('Camera is not ready. Use the options on screen.', 'err'); return; }
  shooting = true;
  $('#btnShutter').classList.add('busy');
  try {
    const count = burst ? 5 : 1;
    const batch = [];
    for (let i = 0; i < count; i++) {
      flash();
      batch.push(await ingestSource(grabFrame()));
      if (i < count - 1) await sleep(260);
    }
    lastBatch = batch;
    afterSave(batch);
  } catch (e) {
    toast('Could not save the photo: ' + (e.message || e), 'err', 3500);
  } finally {
    shooting = false;
    $('#btnShutter').classList.remove('busy');
  }
}
function afterSave(batch) {
  toast(batch.length > 1 ? `Saved ${batch.length} photos ✓` : 'Saved ✓', '', 1500);
}
function updateChrome() {
  const photos = state.photos.filter((p) => p.kind === 'photo');
  $('#thumbCount').textContent = photos.length;
  const latest = photos.sort((a, b) => b.ts - a.ts)[0];
  const img = $('#thumbImg');
  if (latest) { img.src = urlFor(latest, 'thumb'); img.hidden = false; } else { img.hidden = true; }
  const tc = $('#tabCount');
  if (tc) { tc.hidden = photos.length === 0; tc.textContent = photos.length; }
  $('#petBadge').textContent = (state.profile && state.profile.name) ? state.profile.name : 'My pet';
}
async function importFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  if (!files.length) { toast('No images selected. Pick photo files (JPG, PNG, HEIC may not work).', 'err', 3500); return; }
  let ok = 0;
  for (const f of files) {
    try { await ingestFile(f); ok++; toast(`Adding photos… ${ok}/${files.length}`, '', 1200); }
    catch (e) { /* skip unreadable file */ }
  }
  if (ok) {
    toast(`Added ${plural(ok, 'photo')} ✓`);
  }
  else toast('Those files could not be read as images.', 'err', 3500);
  if (ok < files.length && ok) toast(`Added ${ok}, skipped ${files.length - ok} unreadable file(s).`, '', 3500);
}

/* ---------- 6. timeline ---------- */
function setView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'camera') startCamera(); else { stopCamera(); const qt = $('#quickTags'); if (qt) qt.hidden = true; }
}
/* ---------- 11. wiring and start-up ---------- */
function wire() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  $('#btnThumb').addEventListener('click', () => {
  });
  $('#btnShutter').addEventListener('click', shoot);
  $('#btnFlip').addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); });
  $('#btnBurst').addEventListener('click', (e) => {
    burst = !burst; e.currentTarget.setAttribute('aria-pressed', burst);
    e.currentTarget.textContent = burst ? 'Burst: on' : 'Burst: off';
    toast(burst ? 'Burst on: each tap takes 5 photos' : 'Burst off');
  });
  $('#btnRetry').addEventListener('click', startCamera);
  $('#fileInput').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });

  $('#obStart').addEventListener('click', async () => {
    state.profile = { name: $('#obName').value.trim(), birthday: $('#obBirthday').value, skipped: false };
    await metaSet('profile', state.profile); closeSheet('sheet-onboard'); updateChrome(); setView('camera');
  });
  $('#obSkip').addEventListener('click', async () => {
    state.profile = { name: '', birthday: '', skipped: true };
    await metaSet('profile', state.profile); closeSheet('sheet-onboard'); updateChrome(); setView('camera');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const id of ['sheet-sticker', 'sheet-viewer', 'sheet-settings']) {
        const el = $('#' + id);
        if (el && !el.hidden) { closeSheet(id); if (id !== 'sheet-settings') renderTimeline(); break; }
      }
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
    const sheetOpen = $$('.sheet').some((s) => !s.hidden);
    if ((e.key === ' ' || e.key === 'Enter') && !typing && !sheetOpen && $('#view-camera').classList.contains('active') && document.activeElement === document.body) { e.preventDefault(); shoot(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
    else if ($('#view-camera').classList.contains('active') && $$('.sheet').every((s) => s.hidden)) startCamera();
  });
}

async function init() {
  wire();
  try { db = await openDB(); }
  catch (e) { memoryOnly = true; toast('Storage is unavailable in this browser mode: photos will be lost when you close the app.', 'err', 6000); }
  try {
    state.photos = await dbAll();
    state.profile = (await metaGet('profile')) || null;
    state.settings = { ...DEFAULT_SETTINGS, ...((await metaGet('settings')) || {}) };
  } catch (e) { toast('Could not read saved photos: ' + (e.message || e), 'err', 5000); }
  state.rev++; updateChrome();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  if (!state.profile) { openSheet('sheet-onboard'); }
  else setView('camera');
}
init();
