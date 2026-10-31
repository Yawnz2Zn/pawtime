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

/* ---------- 4. folding photos into moments ---------- */
/* THE KEY FUNCTION: connects "user took photos" to "timeline shows folded moments".
   Walk photos oldest -> newest. A photo joins the current moment when it was
   taken within the time window AND its dHash is within `sim` bits of the
   previous photo (and not too far from the moment's first photo). */
function buildMoments() {
  const { sim, windowMin } = state.settings;
  const photos = state.photos.filter((p) => p.kind === 'photo').sort((a, b) => a.ts - b.ts);
  const groups = [];
  let cur = null;
  for (const p of photos) {
    if (cur) {
      const last = cur[cur.length - 1];
      const close = p.ts - last.ts <= windowMin * 60000;
      const alike = hamming(p.hash, last.hash) <= sim && hamming(p.hash, cur[0].hash) <= sim + 6;
      if (close && alike) { cur.push(p); continue; }
    }
    cur = [p];
    groups.push(cur);
  }
  const moments = groups.map((items) => makeMoment(items, false));
  for (const s of state.photos.filter((p) => p.kind === 'sticker')) moments.push(makeMoment([s], true));
  moments.sort((a, b) => a.ts - b.ts);

  // automatic milestones by photo count
  const marks = { 1: 'First memory', 100: '100th photo', 250: '250th photo', 500: '500th photo', 1000: '1000th photo' };
  photos.forEach((p, i) => {
    const label = marks[i + 1];
    if (!label) return;
    const m = moments.find((mm) => mm.items.includes(p));
    if (m) m.milestone = label;
  });
  return moments;
}
function makeMoment(items, sticker) {
  const sorted = [...items].sort((a, b) => a.ts - b.ts);
  const pinned = sorted.find((p) => p.pinCover);
  const sharpest = sorted.reduce((best, p) => (p.sharp > best.sharp ? p : best), sorted[0]);
  const tags = new Set();
  sorted.forEach((p) => p.tags.forEach((t) => tags.add(t)));
  return {
    id: sorted[0].id, items: sorted, ts: sorted[0].ts, sticker,
    cover: pinned || sharpest, coverIsPinned: !!pinned, tags, milestone: null
  };
}
let momentCache = { rev: -1, list: [] };
function getMoments() {
  if (momentCache.rev !== state.rev) momentCache = { rev: state.rev, list: buildMoments() };
  return momentCache.list;
}
const momentOf = (photoId) => getMoments().find((m) => m.items.some((i) => i.id === photoId));

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
  showQuickTags();
}
function showQuickTags() {
  const box = $('#quickTagButtons');
  box.innerHTML = TAGS.map((t) => `<button type="button" data-tag="${t.id}">${t.emoji} ${t.label}</button>`).join('');
  $('#quickTags').hidden = false;
  clearTimeout(quickTagTimer);
  quickTagTimer = setTimeout(() => { $('#quickTags').hidden = true; }, 6000);
}
async function toggleTagOn(items, tagId) {
  const allHave = items.every((p) => p.tags.includes(tagId));
  for (const p of items) {
    p.tags = allHave ? p.tags.filter((t) => t !== tagId) : [...new Set([...p.tags, tagId])];
    await dbPut(p);
  }
  markChanged();
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
    setView('timeline');
  }
  else toast('Those files could not be read as images.', 'err', 3500);
  if (ok < files.length && ok) toast(`Added ${ok}, skipped ${files.length - ok} unreadable file(s).`, '', 3500);
}

/* ---------- 6. timeline ---------- */
function setView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'camera') startCamera(); else { stopCamera(); const qt = $('#quickTags'); if (qt) qt.hidden = true; }
  if (name === 'timeline') renderTimeline();
}
function ageAt(ts) {
  const bd = state.profile && state.profile.birthday;
  if (!bd) return '';
  const b = new Date(bd + 'T00:00:00'), d = new Date(ts);
  if (d < b) return '';
  let months = (d.getFullYear() - b.getFullYear()) * 12 + d.getMonth() - b.getMonth();
  if (d.getDate() < b.getDate()) months--;
  months = Math.max(0, months);
  const y = Math.floor(months / 12), m = months % 12;
  if (!y && !m) return plural(daysBetween(b.getTime(), ts), 'day') + ' old';
  return [y ? plural(y, 'yr') : '', m ? plural(m, 'mo') : ''].filter(Boolean).join(' ') + ' old';
}
function dayNumber(ts, firstTs) {
  const bd = state.profile && state.profile.birthday;
  if (bd) { const n = daysBetween(new Date(bd + 'T00:00:00').getTime(), ts); if (n >= 0) return { n: n + 1, label: `Day ${n + 1}`, title: 'Days since birthday' }; }
  return { n: daysBetween(firstTs, ts) + 1, label: `Day ${daysBetween(firstTs, ts) + 1}`, title: 'Days since the first memory' };
}
function isBirthday(ts) {
  const bd = state.profile && state.profile.birthday;
  if (!bd) return false;
  const d = new Date(ts), b = new Date(bd + 'T00:00:00');
  return d.getMonth() === b.getMonth() && d.getDate() === b.getDate() && d.getFullYear() > b.getFullYear();
}

function renderTimeline() {
  const all = getMoments();
  const photos = state.photos.filter((p) => p.kind === 'photo');
  const name = state.profile && state.profile.name;

  // headline: how much folding is saving the user
  const stat = $('#statLine');
  if (!photos.length && !all.length) stat.innerHTML = '';
  else {
    const photoMoments = all.filter((m) => !m.sticker).length;
    const newest = Math.max(...state.photos.map((p) => p.ts));
    const age = ageAt(newest);
    stat.innerHTML = `${name ? esc(name) + ' · ' : ''}${plural(photos.length, 'photo')} folded into ${plural(photoMoments, 'moment')}` +
      `<small>${age ? esc(age) + ' · ' : ''}Tap a stack to open it. Nothing is ever deleted automatically.</small>`;
  }

  renderReviewCard(all);
  renderFilterChips(all);

  const list = state.filterTag ? all.filter((m) => m.tags.has(state.filterTag)) : all;
  const host = $('#timeline');
  const empty = $('#emptyState');
  if (!list.length) {
    host.innerHTML = '';
    empty.hidden = false;
    if (!state.photos.length) {
      empty.innerHTML = `<div class="big-emoji">🐾</div><p>Your timeline is empty.<br>Shoot a photo in the Camera tab and it will appear here, already organised.</p>
        <button class="btn btn-primary" id="emptyDemo">Try it with sample pet photos</button>`;
      $('#emptyDemo').onclick = () => loadDemo();
    } else {
      empty.innerHTML = `<p>No moments have this tag yet.</p><button class="btn" id="emptyClear">Show everything</button>`;
      $('#emptyClear').onclick = () => { state.filterTag = null; renderTimeline(); };
    }
    return;
  }
  empty.hidden = true;

  const firstTs = photos.length ? Math.min(...photos.map((p) => p.ts)) : all[0].ts;
  const desc = [...list].sort((a, b) => b.ts - a.ts);
  const byMonth = new Map();
  for (const m of desc) {
    const mk = monthKey(m.ts), dk = dayKey(m.ts);
    if (!byMonth.has(mk)) byMonth.set(mk, new Map());
    const days = byMonth.get(mk);
    if (!days.has(dk)) days.set(dk, []);
    days.get(dk).push(m);
  }

  let html = '';
  for (const [mk, days] of byMonth) {
    const anyTs = [...days.values()][0][0].ts;
    const age = ageAt(new Date(+mk.slice(0, 4), +mk.slice(5, 7), 0, 12).getTime());
    html += `<div class="month-h"><span>${esc(fmtMonth(anyTs))}</span><small>${esc(age)}</small></div>`;
    for (const [dk, ms] of days) {
      const ts = ms[0].ts;
      const nPhotos = ms.reduce((n, m) => n + (m.sticker ? 0 : m.items.length), 0);
      const nMoments = ms.filter((m) => !m.sticker).length;
      const dn = dayNumber(ts, firstTs);
      html += `<section class="day" data-day="${dk}"><div class="day-h"><span class="d">${esc(fmtDay(ts))}</span>
        <span class="pillbox" title="${dn.title}">${dn.label}</span>
        ${isBirthday(ts) ? '<span class="pillbox bday">🎂 Birthday!</span>' : ''}
        ${nPhotos ? `<span class="pillbox fold">${plural(nPhotos, 'photo')} → ${plural(nMoments, 'moment')}</span>` : ''}</div>
        <div class="grid">`;
      for (const m of ms) html += momentCard(m);
      html += '</div></section>';
    }
  }
  host.innerHTML = html + '<div class="end-gap"></div>';
}
function momentCard(m) {
  const n = m.items.length;
  const tags = [...m.tags].filter((t) => t !== 'sticker').map(tagEmoji).join('');
  const label = m.sticker ? 'Sticker' : `Moment of ${plural(n, 'photo')}`;
  return `<button class="moment${n > 1 ? ' stack' : ''}${m.sticker ? ' sticker' : ''}" data-open="${m.cover.id}" aria-label="${label}">
    <img src="${urlFor(m.cover, 'thumb')}" alt="" loading="lazy" decoding="async">
    ${n > 1 ? `<span class="badge count">×${n}</span>` : ''}
    ${m.milestone ? `<span class="badge mile">⭐ ${esc(m.milestone)}</span>` : (m.tags.has('milestone') ? '<span class="badge mile">⭐</span>' : '')}
    ${tags.replace('⭐', '') ? `<span class="badge tags">${tags.replace('⭐', '')}</span>` : ''}
    ${m.sticker ? '<span class="badge stk">sticker</span>' : ''}</button>`;
}
function renderFilterChips(all) {
  if (!state.photos.length) { $('#filterChips').innerHTML = ''; return; }
  const counts = {};
  all.forEach((m) => m.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  $('#filterChips').innerHTML =
    `<button class="chip${state.filterTag ? '' : ' on'}" data-filter="">All</button>` +
    TAGS.map((t) => `<button class="chip${state.filterTag === t.id ? ' on' : ''}" data-filter="${t.id}">${t.emoji} ${t.label}${counts[t.id] ? ' · ' + counts[t.id] : ''}</button>`).join('');
}
function renderReviewCard(all) {
  const card = $('#reviewCard');
  const photoMoments = all.filter((m) => !m.sticker);
  const now = new Date();
  const past = photoMoments.filter((m) => { const d = new Date(m.ts); return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear(); });
  if (past.length) {
    const m = past[past.length - 1];
    const yrs = now.getFullYear() - new Date(m.ts).getFullYear();
    card.innerHTML = `<img src="${urlFor(m.cover, 'thumb')}" alt=""><div><b>On this day, ${plural(yrs, 'year')} ago</b><span>Tap to remember it.</span></div>`;
    card.dataset.open = m.cover.id; card.hidden = false; return;
  }
  const thisMonth = photoMoments.filter((m) => monthKey(m.ts) === monthKey(now.getTime()));
  if (thisMonth.length) {
    const best = thisMonth.reduce((a, b) => (b.items.length > a.items.length ? b : a));
    card.innerHTML = `<img src="${urlFor(best.cover, 'thumb')}" alt=""><div><b>This month: ${plural(thisMonth.length, 'moment')}</b><span>Your biggest one has ${plural(best.items.length, 'photo')}. Tap to open.</span></div>`;
    card.dataset.open = best.cover.id; card.hidden = false; return;
  }
  card.hidden = true;
}
function jumpToDate(value) {
  if (!value) return;
  const days = $$('#timeline .day');
  if (!days.length) { toast('Nothing on the timeline to jump to yet.', 'err'); return; }
  // timeline is newest-first: land on the first day that is on/before the chosen date
  const target = days.find((d) => d.dataset.day <= value) || days[days.length - 1];
  target.scrollIntoView({ block: 'start' });
  if (target.dataset.day === value) toast('Jumped to that day');
  else if (target.dataset.day > value) toast('Nothing on or before that date. Showing your earliest day.', '', 2800);
  else toast('No photos that day. Showing the nearest earlier day.', '', 2800);
}

/* ---------- 7. moment viewer ---------- */
const viewer = { photoId: null };
function openViewer(photoId) { viewer.photoId = photoId; openSheet('sheet-viewer'); renderViewer(); }

function renderViewer() {
  const m = momentOf(viewer.photoId);
  if (!m) { closeSheet('sheet-viewer'); return; }
  const cur = m.items.find((i) => i.id === viewer.photoId) || m.cover;
  viewer.photoId = cur.id;
  $('#vTitle').textContent = m.sticker ? 'Sticker' : (m.items.length > 1 ? `Moment · ${plural(m.items.length, 'photo')}` : 'Photo');
  const stage = $('#vStage');
  stage.className = 'v-stage' + (cur.kind === 'sticker' ? ' sticker' : '');
  stage.innerHTML = `<img src="${urlFor(cur, 'blob')}" alt="Pet photo taken ${esc(fmtDay(cur.ts))}">`;

  $('#vStrip').innerHTML = m.items.length > 1 ? m.items.map((i) =>
    `<button data-pick="${i.id}" class="${i.id === cur.id ? 'on' : ''}" aria-label="Photo at ${fmtTime(i.ts)}"><img src="${urlFor(i, 'thumb')}" alt="">${i.id === m.cover.id ? '<span class="cv" title="Cover">⭐</span>' : ''}</button>`).join('') : '';

  const age = ageAt(cur.ts);
  $('#vInfo').textContent = `${fmtDay(cur.ts)} · ${fmtTime(cur.ts)}${age ? ' · ' + age : ''}` +
    (m.items.length > 1 ? (m.coverIsPinned ? ' · Cover: your pick' : ' · Cover: auto-picked as the sharpest shot') : '');

  if (cur.kind === 'sticker') { $('#vTags').innerHTML = '<span class="muted small">Stickers are not tagged.</span>'; }
  else $('#vTags').innerHTML = TAGS.map((t) => `<button class="chip${m.items.every((p) => p.tags.includes(t.id)) ? ' on' : ''}" data-vtag="${t.id}">${t.emoji} ${t.label}</button>`).join('');

  const acts = [];
  if (cur.kind === 'photo') acts.push(`<button class="btn btn-primary" data-act="sticker">✨ Make a sticker from this photo</button>`);
  if (m.items.length > 1 && cur.id !== m.cover.id) acts.push(`<button class="btn" data-act="cover">⭐ Use this photo as the cover</button>`);
  acts.push(`<button class="btn" data-act="share">⤴ Share / Download</button>`);
  if (m.items.length > 1) acts.push(`<button class="btn" data-act="tidy">🧹 Keep only the cover, delete ${m.items.length - 1} others</button>`);
  acts.push(`<button class="btn btn-danger" data-act="delete">🗑 Delete this ${cur.kind === 'sticker' ? 'sticker' : 'photo'}</button>`);
  $('#vActions').innerHTML = acts.join('');
}
async function removePhotos(ids) {
  for (const id of ids) {
    await dbDelete(id);
    dropUrls(id);
    state.photos = state.photos.filter((p) => p.id !== id);
  }
  markChanged();
}
async function viewerAction(act) {
  const m = momentOf(viewer.photoId);
  if (!m) return;
  const cur = m.items.find((i) => i.id === viewer.photoId) || m.cover;
  if (act === 'sticker') { Sticker.open(cur); return; }
  if (act === 'cover') {
    for (const p of m.items) { p.pinCover = p.id === cur.id; await dbPut(p); }
    markChanged(); renderViewer(); toast('Cover updated ✓'); return;
  }
  if (act === 'share') {
    const res = await shareBlob(cur.blob, `pawtime-${dayKey(cur.ts)}.${cur.kind === 'sticker' ? 'png' : 'jpg'}`);
    shareToast(res); return;
  }
  if (act === 'tidy') {
    const others = m.items.filter((i) => i.id !== m.cover.id);
    if (!confirm(`Delete ${plural(others.length, 'photo')} and keep only the cover? This cannot be undone.`)) return;
    await removePhotos(others.map((o) => o.id));
    viewer.photoId = m.cover.id; renderViewer(); renderTimeline(); toast('Tidied up ✓'); return;
  }
  if (act === 'delete') {
    if (!confirm(`Delete this ${cur.kind}? This cannot be undone.`)) return;
    const next = m.items.find((i) => i.id !== cur.id);
    await removePhotos([cur.id]);
    if (next) { viewer.photoId = next.id; renderViewer(); } else closeSheet('sheet-viewer');
    renderTimeline(); toast('Deleted');
  }
}

/* ---------- sharing ---------- */
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function shareBlob(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'PawTime' });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';     // user closed the share sheet
  }
  downloadBlob(blob, filename);                                // fallback when sharing is unavailable
  return 'downloaded';
}
function shareToast(res) {
  if (res === 'shared') toast('Shared ✓');
  else if (res === 'downloaded') toast('Sharing is not supported here, so it was downloaded instead ✓', '', 3200);
}

/* ---------- 9. sample photos (so anyone can try it without a camera) ---------- */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const SCENES = {
  grass: { top: '#bfe3f2', bot: '#8ccf7e', deco(x) { x.fillStyle = '#ffe9a0'; x.beginPath(); x.arc(660, 110, 58, 0, 7); x.fill(); x.fillStyle = '#6fb764'; x.fillRect(0, 380, 800, 220); } },
  floor: { top: '#f4e6cc', bot: '#d3a977', deco(x) { x.fillStyle = '#bfe0f5'; x.fillRect(90, 60, 210, 170); x.strokeStyle = '#fff'; x.lineWidth = 8; x.strokeRect(90, 60, 210, 170); x.beginPath(); x.moveTo(195, 60); x.lineTo(195, 230); x.stroke(); } },
  sofa:  { top: '#c3d6ee', bot: '#7fa2cf', deco(x) { x.fillStyle = '#6f92c4'; x.fillRect(0, 300, 800, 300); x.fillStyle = '#ee9bb0'; x.beginPath(); x.ellipse(660, 330, 90, 70, 0.3, 0, 7); x.fill(); } },
  bed:   { top: '#f8dde3', bot: '#e3a7b5', deco(x) { x.fillStyle = '#fff4f6'; x.beginPath(); x.ellipse(400, 470, 330, 90, 0, 0, 7); x.fill(); x.fillStyle = '#f0c3cd'; x.beginPath(); x.ellipse(160, 120, 60, 60, 0, 0, 7); x.fill(); } }
};
const POSES = { sit: { x: 400, y: 340, sx: 1, sy: 1, rot: 0 }, lie: { x: 410, y: 430, sx: 1.35, sy: 0.78, rot: 0 }, run: { x: 300, y: 360, sx: 1.05, sy: 0.95, rot: -0.12 } };

async function makeDemoPhoto({ scene, pose, seed, blur = 0, eyesClosed = false, tongue = false }) {
  const r = rng(seed), c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const x = c.getContext('2d'), S = SCENES[scene], P = POSES[pose];
  const g = x.createLinearGradient(0, 0, 0, 600); g.addColorStop(0, S.top); g.addColorStop(1, S.bot);
  x.fillStyle = g; x.fillRect(0, 0, 800, 600); S.deco(x);
  const jx = (r() - 0.5) * 16, jy = (r() - 0.5) * 12, tilt = (r() - 0.5) * 0.08;
  if (blur) x.filter = `blur(${blur}px)`;
  x.save(); x.translate(P.x + jx, P.y + jy); x.rotate(P.rot + tilt); x.scale(P.sx, P.sy);
  const fur = '#c99a58', dark = '#8a5a2b', light = '#f3dcb8';
  x.fillStyle = 'rgba(0,0,0,.14)'; x.beginPath(); x.ellipse(0, 150, 150, 26, 0, 0, 7); x.fill();         // shadow
  x.fillStyle = fur; x.beginPath(); x.ellipse(0, 90, 120, 100, 0, 0, 7); x.fill();                         // body
  x.fillStyle = light; x.beginPath(); x.ellipse(0, 110, 70, 70, 0, 0, 7); x.fill();                        // belly
  x.save(); x.translate(115, 60); x.rotate(0.9 + (r() - 0.5) * 0.3); x.fillStyle = fur; x.beginPath(); x.ellipse(0, 0, 18, 60, 0, 0, 7); x.fill(); x.restore(); // tail
  x.fillStyle = fur; x.beginPath(); x.arc(0, -40, 98, 0, 7); x.fill();                                    // head
  x.fillStyle = dark; for (const s of [-1, 1]) { x.save(); x.translate(s * 82, -92); x.rotate(s * 0.45); x.beginPath(); x.ellipse(0, 0, 30, 56, 0, 0, 7); x.fill(); x.restore(); } // ears
  x.fillStyle = light; x.beginPath(); x.ellipse(0, -8, 52, 42, 0, 0, 7); x.fill();                         // muzzle
  x.fillStyle = '#2b1d12'; x.beginPath(); x.ellipse(0, -26, 17, 12, 0, 0, 7); x.fill();                   // nose
  x.strokeStyle = '#2b1d12'; x.lineWidth = 5; x.lineCap = 'round';
  for (const s of [-1, 1]) {
    if (eyesClosed) { x.beginPath(); x.arc(s * 38, -62, 13, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke(); }
    else { x.fillStyle = '#2b1d12'; x.beginPath(); x.arc(s * 38, -62, 11, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(s * 38 + 4, -66, 3.5, 0, 7); x.fill(); }
  }
  x.beginPath(); x.moveTo(0, -14); x.lineTo(0, 0); x.moveTo(-22, 8); x.quadraticCurveTo(0, 22, 22, 8); x.stroke();   // mouth
  if (tongue) { x.fillStyle = '#ef7d92'; x.beginPath(); x.ellipse(0, 20, 12, 18, 0, 0, 7); x.fill(); }
  x.restore(); x.filter = 'none';
  // a little sensor noise so the pictures look like real photos
  const px = x.getImageData(0, 0, 800, 600), d = px.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 8; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  x.putImageData(px, 0, 0);
  return c;
}
async function loadDemo() {
  const now = new Date();
  const at = (daysAgo, h, m) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.getTime(); };
  // [daysAgo, hour, minute, scene, pose, count, tags, extras]
  const plan = [
    [400, 11, 0, 'bed', 'lie', 1, ['milestone'], {}],
    [365, 10, 0, 'sofa', 'sit', 2, ['milestone', 'eat'], {}],
    [62, 16, 40, 'floor', 'lie', 3, ['sleep'], {}],
    [30, 9, 5, 'grass', 'run', 4, ['walk'], {}],
    [3, 13, 10, 'floor', 'lie', 4, ['sleep'], { blurIdx: 2, closed: true }],
    [1, 8, 30, 'grass', 'run', 2, ['walk'], {}],
    [1, 20, 0, 'sofa', 'sit', 3, ['eat'], {}],
    [0, 9, 10, 'grass', 'sit', 5, ['walk'], { blurIdx: 1 }],
    [0, 14, 20, 'floor', 'lie', 4, ['sleep'], { blurIdx: 0, closed: true }],
    [0, 18, 5, 'sofa', 'run', 1, ['silly'], { tongue: true }]
  ];
  const total = plan.reduce((n, p) => n + p[5], 0);
  let done = 0, seed = 7;
  try {
    for (const [ago, h, m, scene, pose, count, tags, ex] of plan) {
      for (let i = 0; i < count; i++) {
        const canvas = await makeDemoPhoto({ scene, pose, seed: seed++, blur: ex.blurIdx === i ? 5 : 0, eyesClosed: !!ex.closed, tongue: !!ex.tongue });
        await ingestSource(canvas, { ts: at(ago, h, m) + i * 20000, tags, demo: true });
        toast(`Making sample photos… ${++done}/${total}`, '', 1500);
        if (done % 4 === 0) await sleep(0);
      }
    }
  } catch (e) { toast('Could not create sample photos: ' + (e.message || e), 'err', 3500); return; }
  if (!state.profile || (!state.profile.name && !state.profile.birthday)) {
    const bd = new Date(now); bd.setDate(bd.getDate() - 500);
    state.profile = { name: 'Mochi', birthday: dayKey(bd.getTime()), demo: true };
    await metaSet('profile', state.profile);
  }
  closeSheet('sheet-onboard'); closeSheet('sheet-settings');
  setView('timeline');
  toast(`Added ${total} sample photos. Notice how similar shots fold into stacks ✓`, '', 3800);
}
async function clearDemo() {
  const ids = state.photos.filter((p) => p.demo).map((p) => p.id);
  if (!ids.length) { toast('There are no sample photos to remove.'); return; }
  await removePhotos(ids);
  if (state.profile && state.profile.demo) { state.profile = { name: '', birthday: '', skipped: true }; await metaSet('profile', state.profile); }
  renderSettings(); renderTimeline(); toast('Sample photos removed ✓');
}

/* ---------- 10. settings, onboarding, backup ---------- */
function renderSettings() {
  $('#setName').value = (state.profile && state.profile.name) || '';
  $('#setBirthday').value = (state.profile && state.profile.birthday) || '';
  $('#setSim').value = state.settings.sim;
  $('#setWin').value = state.settings.windowMin;
  updateSettingsPreview();
}
function updateSettingsPreview() {
  const s = state.settings;
  $('#setSimOut').textContent = s.sim <= 4 ? 'very strict' : s.sim <= 12 ? 'balanced' : 'very loose';
  $('#setWinOut').textContent = `${s.windowMin} min`;
  const photos = state.photos.filter((p) => p.kind === 'photo').length;
  const moments = getMoments().filter((m) => !m.sticker).length;
  $('#setPreview').textContent = photos ? `Right now: ${plural(photos, 'photo')} → ${plural(moments, 'moment')}.` : 'Take or add some photos to see the effect here.';
}
async function saveProfile() {
  state.profile = { ...(state.profile || {}), name: $('#setName').value.trim(), birthday: $('#setBirthday').value, skipped: false, demo: false };
  await metaSet('profile', state.profile);
  state.rev++; state.timelineDirty = true; updateChrome();
}
async function saveSettings() { await metaSet('settings', state.settings); }
function blobToDataURL(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); }
async function exportBackup() {
  if (!state.photos.length) { toast('Nothing to export yet.', 'err'); return; }
  try {
    toast('Preparing backup…', '', 1500);
    const out = { app: 'PawTime', version: 1, exportedAt: new Date().toISOString(), profile: state.profile, settings: state.settings, photos: [] };
    for (const p of state.photos) out.photos.push({ id: p.id, ts: p.ts, kind: p.kind, tags: p.tags, pinCover: p.pinCover, image: await blobToDataURL(p.blob) });
    downloadBlob(new Blob([JSON.stringify(out)], { type: 'application/json' }), `pawtime-backup-${dayKey(Date.now())}.json`);
    toast('Backup downloaded ✓');
  } catch (e) { toast('Backup failed: ' + (e.message || e), 'err', 3500); }
}
async function wipeAll() {
  if (!confirm('Delete ALL photos, stickers and settings from this device? This cannot be undone.')) return;
  await dbClear();
  for (const k of [...urls.keys()]) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); }
  state.photos = []; state.filterTag = null; state.profile = { name: '', birthday: '', skipped: true };
  await metaSet('profile', state.profile);
  markChanged(); renderSettings(); renderTimeline(); toast('All data deleted');
}

/* ---------- 11. wiring and start-up ---------- */
function wire() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  $('#btnThumb').addEventListener('click', () => {
    setView('timeline');
  });
  $('#btnShutter').addEventListener('click', shoot);
  $('#btnFlip').addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); });
  $('#btnBurst').addEventListener('click', (e) => {
    burst = !burst; e.currentTarget.setAttribute('aria-pressed', burst);
    e.currentTarget.textContent = burst ? 'Burst: on' : 'Burst: off';
    toast(burst ? 'Burst on: each tap takes 5 photos' : 'Burst off');
  });
  $('#btnRetry').addEventListener('click', startCamera);
  $('#btnDemo').addEventListener('click', loadDemo);
  $('#fileInput').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  $('#quickTagButtons').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tag]'); if (!b || !lastBatch.length) return;
    await toggleTagOn(lastBatch, b.dataset.tag);
    b.classList.toggle('on', lastBatch.every((p) => p.tags.includes(b.dataset.tag)));
    clearTimeout(quickTagTimer); quickTagTimer = setTimeout(() => { $('#quickTags').hidden = true; }, 4000);
  });
  $('#timeline').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openViewer(b.dataset.open); });
  $('#reviewCard').addEventListener('click', (e) => openViewer(e.currentTarget.dataset.open));
  $('#filterChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]'); if (!b) return;
    state.filterTag = b.dataset.filter || null; renderTimeline();
  });
  $('#jumpDate').addEventListener('change', (e) => jumpToDate(e.target.value));

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => { closeSheet(b.dataset.close); if (b.dataset.close === 'sheet-viewer' || b.dataset.close === 'sheet-sticker') renderTimeline(); }));
  $('#vStrip').addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) { viewer.photoId = b.dataset.pick; renderViewer(); } });
  $('#vTags').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-vtag]'); if (!b) return;
    const m = momentOf(viewer.photoId); if (!m) return;
    await toggleTagOn(m.items, b.dataset.vtag); renderViewer();
  });
  $('#vActions').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) viewerAction(b.dataset.act); });

  const openSettings = () => { renderSettings(); openSheet('sheet-settings'); };
  $('#btnSettings').addEventListener('click', openSettings);
  $('#petBadge').addEventListener('click', openSettings);
  $('#setName').addEventListener('change', saveProfile);
  $('#setBirthday').addEventListener('change', async () => { await saveProfile(); renderTimeline(); });
  let simTimer;
  const onFold = () => {
    state.settings.sim = +$('#setSim').value; state.settings.windowMin = +$('#setWin').value;
    state.rev++; state.timelineDirty = true; updateSettingsPreview();
    clearTimeout(simTimer); simTimer = setTimeout(saveSettings, 300);
  };
  $('#setSim').addEventListener('input', onFold); $('#setWin').addEventListener('input', onFold);
  $('#btnSample').addEventListener('click', loadDemo);
  $('#btnClearSample').addEventListener('click', clearDemo);
  $('#btnExport').addEventListener('click', exportBackup);
  $('#btnWipe').addEventListener('click', wipeAll);

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
