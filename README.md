# PawTime 🐾

**Shoot to save, and your pet's photos organise themselves into a growth timeline.**

A phone-installable web app (PWA) for pet owners whose camera roll is full of near-identical pet photos they can't bear to delete and can never find again. It also turns a favourite photo into a sticker.

- **Live app:** <https://yawnz2zn.github.io/pawtime/> *(open on a phone, then "Add to Home Screen")*
- SD5911 Assignment 3 (An interactive experience). Individual project.

| Timeline | Journey | Choose what to keep | Sticker Studio |
|---|---|---|---|
| ![](docs/02-timeline.png) | ![](docs/03-journey-overview.png) | ![](docs/04-choose-what-to-keep.png) | ![](docs/07-sticker-cutout-card.png) |

*Screenshots use the app's built-in sample pet photos (drawn in code).*

## The idea

I photograph my pet constantly. My album fills with dozens of shots that barely differ, I can't delete any of them, and one specific moment is buried among everyday photos. PawTime's answer is **fold, don't delete**:

1. **Shoot inside the app.** Photos, or **Video** clips up to 60 s. They go to the app's own storage, not the phone gallery.
2. **Similar shots fold into one "moment"**, even when taken separately a few minutes apart. The sharpest shot is the cover. Nothing is deleted unless you choose to; a **Choose what to keep** screen lets you tick what stays.
3. **A growth timeline** (month → day → moment) shows age and "Day N", filters by tag and jumps to a date. The **Journey** page zooms out: years → months → days.
4. **Make a sticker:** automatic pet cut-out with outline, patterned cards, text, emoji, decorations and freehand drawing, then save or share.
5. **中文 / EN:** the top-bar button switches the whole app to Chinese (`i18n.js`). Your own text is never translated.

**Intended user:** pet owners (about 20–35) who treat pets as family and share stickers and memories on chat apps.

### Main interaction

| Step | User action | Program response |
|---|---|---|
| Shoot | Tap the shutter (Burst = 5 shots; Video = tap to start, tap to stop) | Shrinks and fingerprints the photo, saves to IndexedDB; flash, "Saved ✓", counter updates |
| Tag | Tap Eating / Sleeping / Walk / Silly / Milestone | Tags everything just shot |
| Fold | automatic | Groups similar nearby photos, picks the sharpest as cover: "29 photos folded into 10 moments" |
| Find | Scroll, tag chip, date picker, or the Journey page | Filters or jumps; clear message if nothing matches |
| Tidy | Open a stack → *Choose which to keep* | Ticked stay, the rest are deleted after a confirmation |
| Sticker | Cut out, outline, card, text, emoji, draw | Live preview redraws under your finger |
| Save / share | Save to timeline, or Share | Stores a PNG or opens the share sheet (falls back to download) |

### Mistakes and interruptions
The main case I designed for is **camera permission denied or no camera**: the app explains what happened and offers *Try again*, *Choose photos from my gallery* or *Use sample pet photos*. Also handled: repeated shutter taps, corrupt or non-image files, double-saving, share unsupported or cancelled, storage unavailable (private mode warning), and confirmation before every deletion.

## Try it in 30 seconds (no camera needed)
1. Enter a name (or *Skip for now*), then tap **Use sample pet photos**.
2. On the **Timeline**, tap the blue "stacks of similar photos" card and tick what to keep.
3. Open **Journey**: tap a year, a month, a day.
4. Open a photo → **Make a sticker** → **Cut out my pet automatically**, then try Card, Text, Emoji and Draw.

## How to run
Plain HTML, CSS and JavaScript, no build step. Serve the folder over `http://` (the camera and service worker don't work on `file://`):
```bash
cd pawtime && python3 -m http.server 8000     # then open http://localhost:8000
```
**On a phone** (needs https): open the GitHub Pages link; iPhone Safari → Share → *Add to Home Screen*; Android Chrome → ⋮ → *Install app*. To deploy: push to GitHub, *Settings → Pages → Deploy from a branch → main / (root)*.

**Optional test:** `tests/smoke_test.py` drives the app in headless Chromium with a fake camera (48 checks).
```bash
pip install playwright && python -m playwright install chromium
python3 -m http.server 8765 &  python3 tests/smoke_test.py
```

## How the "smart" parts work
Everything runs on the phone, offline. **Nothing is uploaded.**

### 1. Folding similar photos (rules, no AI model)
`buildMoments()` and `looksAlike()` in `app.js`. Each photo gets two fingerprints when saved: a **dHash** (64-bit layout; good for bursts, breaks when the camera drifts) and a **colour signature** (`photoSig2`: a colour histogram of the whole picture plus one per quarter, so the same spot matches even if the pet turns its head). `photoDistance()` blends them (30% layout, 35% colour, 35% colour per quarter). A photo joins the current moment if its distance is below an allowed distance that **tightens as the time gap grows** (about 0.34 for seconds apart, 0.18 after an hour), and it must also stay close to the first photo of the stack. The *Similarity* and *Time window* sliders in Settings adjust this. The cover is the sharpest shot (variance of a Laplacian filter) unless the user pins another.

**Why I changed it.** My first rule (dHash within 20 min) missed most re-takes: I take a photo, step sideways and take another a minute later, which isn't a burst. I made 384 test pairs from stock photographs (same scene with drift, zoom, tilt, light change, moved subject, crop, versus different scenes):

| | same scene folded | different scenes wrongly folded |
|---|---|---|
| Old rule | 83 / 192 (43%) | 0 / 192 |
| New rule | 147 / 192 (77%) | 8 / 192 (4%) |

A few wrong merges are acceptable because nothing is deleted, the stack is visible, and *Choose what to keep* / *This one is different* fix them. (The pairs are not pet photos, so real numbers will differ.)

### 2. Cutting the pet out (this one is an AI model)
The button runs **U²-Net-P** in the browser, with no cloud service or AI library. `vendor/` holds the model weights (4.5 MB) converted by my scripts in `vendor/tools/`, a small runner I wrote (`u2net-engine.js`), and the convolution kernel compiled to WebAssembly SIMD (`conv.c` → `conv.wasm`); I checked its output against ONNX Runtime (difference about 0.0001). The model loads on first use and is then cached. Without WebAssembly SIMD the app falls back to a **quick colour-based cut-out** and says so. *Fix the edges* lets you paint parts back or erase them. The outline is made by stamping the silhouette around a circle (solid, double, neon).

## Project structure
```
index.html  style.css  app.js     app shell, styles, main logic (numbered sections)
sticker.js                        Sticker Studio
i18n.js                           English / 中文 switch
vendor/                           cut-out model, WebAssembly kernel, runner, LICENSES.md
manifest.json  service-worker.js  installable + offline
icons/  docs/  tests/             icons, screenshots, smoke test
PROCESS.md                        how I built it, user trial, AI use
```

## Known limitations
- **Video:** 60 s max; not folded, not made into stickers, and **not in the .json backup** (too large), so download clips with *Share / Download*. Format depends on the browser (MP4 on iPhone, WebM on Chrome). Tested with a fake camera, not on a real phone.
- **Data lives only on this device.** Clearing browser data erases it. *Export backup* exists, but there is no import and no cloud backup, so photos are not shared between phones.
- Web camera quality is below the native camera app, and it only runs while the app is open. Needs https (or localhost); on iPhone, add to the Home Screen from Safari.
- **Cut-out** works best with one pet clearly separated from the background; similar-coloured furniture or fluffy fur can leave bits (use *Fix the edges*). Needs WebAssembly SIMD (iOS 16.4+, current Chrome/Edge/Firefox). About 1–3 s on a computer; **not measured on a real phone**.
- Folding is a heuristic: different photos of the same room can occasionally merge, and very different zooms may not.
- Gallery photos use the file's modified time as "taken" time. HEIC may not open in every browser.
- The Chinese wording is my own translation and may read unnaturally in places.

## Future work
Cloud accounts and sharing between family members, backup import, milestone reminders, animated stickers, auto-tagging with an on-device model.

## Credits
- **Concept and design:** my own idea and individual work, built around a problem I have myself.
- **dHash** and colour-histogram comparison are standard public techniques, implemented from scratch; the weights and time-aware thresholds are my own, tuned on the test pairs above.
- **U²-Net-P:** Qin et al., *U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection*, Pattern Recognition 2020, <https://github.com/xuebinqin/U-2-Net>, Apache 2.0. The ONNX export is from **rembg** (<https://github.com/danielgatis/rembg>, MIT). See `vendor/LICENSES.md`.
- **Sample pet photos** are drawn in code (`makeDemoPhoto()`); no external images. **Sticker styles** were inspired by pet-sticker sheets I looked at; all frames, patterns and effects are drawn in code. Emoji use the device's font. No external libraries, fonts or APIs.
- **AI assistance:** I used Claude (Anthropic) as a coding assistant; see [PROCESS.md](PROCESS.md).