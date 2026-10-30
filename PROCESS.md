# PROCESS.md

> **Fill in every `TODO` with what really happened before you submit.** The marker is looking for an honest account, not a perfect one. Delete this note when done.

## 1. Starting idea

My group's project, PawTime (SD5911 tutorial), was a whole pet-life-cycle app: memory bank, AI pet videos, sticker studio, keepsake shop and milestone reminders. That is far too much for one small interactive experience, and the brief says one carefully designed interaction is enough.

I narrowed it to the problem that started the whole idea for me: **I photograph my pet constantly, my album fills with dozens of almost-identical photos, I can't bear to delete them, and I can't find a specific moment later.**

My starting design: *shoot inside the app → save automatically → fold similar photos together → show a growth timeline → turn a favourite into a sticker and share it.*

What I deliberately cut: cloud backup, AI video, keepsake shop, reminders, AI auto-tagging. They need a backend, paid services, or a native app, and would have meant several half-finished features.

**Decisions along the way**
- *Installable web app (PWA) instead of a native app:* I can finish, test and share it in the time available, and it still installs on a phone and uses the camera.
- *Fold instead of delete:* my own behaviour is that I never delete, so the app should reduce clutter without asking me to throw anything away.
- *Rule-based "smart" instead of an AI model:* a perceptual hash plus time window runs offline, costs nothing, and is something I can explain line by line.
- *Sample photos drawn in code:* so a marker without a camera (or without a pet) can still see the folding work.

## 2. A design or code change I made

**Change: the sticker preview stays pinned while you edit.**
After the first working version, I ran the app in a headless browser and took screenshots of the Sticker Studio. When I picked a shape or colour near the bottom of the screen, the page scrolled and the sticker preview slid out of view, so I could not see what my tap had done. That breaks the loop of *action → response → feedback*. I made the preview `position: sticky` at the top and sized it relative to the screen height so the controls and the result are visible together.

TODO (optional, add a second change if you made one, e.g. changing the default similarity threshold after testing with real photos of your pet).

## 3. User trial

TODO: fill in. Suggested structure:

- **Who / setup:** e.g. "a classmate who owns a dog, on her own iPhone, using the GitHub Pages link. I gave no instructions."
- **What they tried first:** TODO
- **Where they hesitated or got confused:** TODO (e.g. did they notice the tag buttons? understand the ×5 badge? find the sticker button?)
- **What surprised me:** TODO
- **Improvement I made because of it:** TODO (one concrete change, with the file/function it touched), **or** why I kept the design as it was.
- **Result after the change:** TODO (did the same hesitation go away when they tried again, or what I would test next)

## Note about my commit history

Claude wrote a complete first draft of the whole app in one go before I began committing. I then added it to this repository in **six stages** (1 camera and storage, 2 timeline and folding, 3 moment viewer and sharing, 4 tags and filter, 5 sticker studio, 6 settings and extras). I copied in one stage at a time and ran and tested it before each commit. So the commit dates show **when I added, tested and reviewed each part**, not when the code was first written. I did not change any commit dates. The later commits (user-trial change, README, this file) are my own work.

TODO: confirm this is accurate for you, and add one or two lines on what you actually checked at each stage (for example "tested the camera on my phone before committing stage 1").

## 4. AI tools used

I used **Claude (Anthropic)** as a coding and planning assistant. I did not use any AI model *inside* the app: all "smart" behaviour is ordinary algorithm code (dHash + Laplacian sharpness).

**What Claude did**
- Helped me scope the project: it turned my long feature list into tiers and helped me choose a PWA.
- Wrote the first complete version of the code (HTML, CSS, JavaScript, service worker, icon generator).
- Wrote a headless-browser smoke test (`tests/smoke_test.py`) and ran it; it found a layout problem (section 2) and test timing issues.
- Drafted the first versions of README.md and this file's structure.

**What I did myself**
- TODO: be specific, e.g. chose the idea and priorities, ran the app on my phone, ran the user trial, tuned the thresholds, wrote the trial section, and checked I can explain the main code.

**One suggestion I kept**
Claude suggested detecting similar photos with a **perceptual hash plus a time window** rather than an AI model. I kept it because it works offline for free and I could explain it, and because the sample data showed it folding 35 photos into 11 moments with the sharpest shot as cover.

**One suggestion I changed**
TODO: choose a real one. Honest candidates from my conversation: (a) Claude's first plan was a general "photo → sticker" tool; I redirected it to focus on shoot-to-save and the growth timeline because that is my real problem. (b) Claude proposed the sticker preview as a normal scrolling block; testing showed it scrolled away, so I had it pinned (section 2). Replace or extend with whatever is true for you.

## 5. Where AI got it wrong or needed checking
TODO (optional but valuable): e.g. a bug you found yourself, something that did not work on your phone, or something you rewrote to understand it.

## 6. Code I can explain
`buildMoments()` in `app.js`: it walks photos oldest → newest. A photo joins the current moment if it was taken within the time window **and** its dHash is within the similarity threshold of the previous photo (and not too far from the first). Otherwise it starts a new moment. The timeline renders those moments, so changing the **Similarity** slider changes what the user sees.
