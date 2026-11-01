# PROCESS.md

1. Starting idea

I photograph my pet constantly. My album fills with dozens of near-identical photos, I can't bear to delete them, and I can't find a specific moment later. PawTime answers that one problem: shoot inside the app → save automatically → fold similar photos → growth timeline → turn a favourite into a sticker and share it. After trying the first version I added a smarter "looks alike" rule, a Journey overview, a more capable Sticker Studio, video recording and a Chinese version.

I left out cloud accounts and family sharing, AI video, a keepsake shop, reminders and auto-tagging: they need a backend or paid services and would have meant several half-finished features instead of one polished interaction.

Decisions

Installable web app (PWA), not native: I can finish, test and share it in the time available, and it still installs and uses the camera.
Fold instead of delete: I never delete my own photos, so the app reduces clutter without asking me to.
Rules for folding, an AI model only for cut-out: a perceptual hash, colour histograms and a time window run offline and I can explain them. Cutting out a pet needs a neural network (U²-Net-P), which runs in the browser so nothing is uploaded.
Chinese version: my family reads Chinese, so there is a 中文 / EN switch.
2. Changes I made
The sticker preview stays pinned. Screenshots of the Sticker Studio showed that choosing a shape near the bottom scrolled the preview out of view, so I could not see what my tap did. I made it position: sticky and sized it to the screen height (style.css).
Folding looks at colour as well as layout, and I choose what to keep. Photos I took separately of the same spot stayed apart because dHash changes a lot when the camera moves. I added colour signatures and a time-aware threshold (re-takes folded: 43% → 77%, wrong merges 4%; README has the test). Because the stronger rule can over-merge, I added Choose what to keep, a tidy card and This one is different (app.js: photoSig2, looksAlike, openPick).
Journey page. My mother asked for an overview: the timeline is good for finding a day but a long scroll after a few months. The new tab goes years → months → days with cover, counts, age and photos per month.
Sticker Studio v2. Text, emoji and decorations became free layers (drag, pinch, rotate, duplicate), plus pet cut-out with outline, card patterns and freehand drawing (sticker.js, vendor/).
Video. My mother told me she records clips as often as she takes photos, and I had forgotten this. I added a Photo / Video switch with a timer, a 60 s limit, a poster frame and playback (app.js, section 5b).
3. User trial

I asked my mother, a pet owner, to try the app on her own phone using the GitHub Pages link. I gave her no instructions and just watched and listened. Three things came out of it, and I changed the app for each:

She did not notice the tag buttons. They were too small to catch her eye, so she never used them. I made them larger and clearer (style.css, commit "Make tag buttons larger after the user did not notice them").
She asked for video. She records short clips of the pet as often as she takes photos, and I had forgotten this completely. I added a Photo / Video switch to the camera, with a timer, a 60-second limit, a poster frame, playback on the timeline and a download option (app.js, section 5b).
She wanted an overview. The timeline is good for finding one day, but she wanted to see the pet's whole story at a glance. I added the Journey tab, which zooms out from years to months to days with a cover photo, counts, age and photos per month (app.js, Journey section).

What surprised me most was the video request: it was an everyday habit that I had never thought of, because I was designing around my own photo problem. The trial also showed me that features I considered obvious (tags) were invisible to someone who had not built the app.

4. Commit history

I built the app with Claude's help and had a working version before I started committing. I then added it in stages (camera and storage, timeline and folding, viewer and sharing, tags, Sticker Studio, cards and drawing, cut-out, settings, smarter grouping, Journey, video, Chinese version), running and checking each one before committing. The commit dates show when I added and checked each part, not when the code was first written. I did not change any dates.

5. AI tools used

I used Claude (Anthropic) as a coding assistant. The only AI model inside the app is the cut-out network (U²-Net-P, Apache 2.0); everything else is ordinary algorithms.

What Claude did: wrote the code from my descriptions (HTML, CSS, JavaScript, service worker, Sticker Studio, i18n), wrote and ran the smoke test, converted the cut-out model to run in the browser, and drafted the README and this file for me to correct.

What I did: came up with the idea and decided what goes in and what stays out; designed the interaction (fold not delete, tags, timeline, Journey, how a sticker is made); reviewed each version on screen and asked for changes (cut-out with outline, free layers, drawing, grouping separately shot photos, choose-what-to-keep, video, Chinese version, with pet-sticker examples as references); split the work into stages and committed them one by one; ran the user trial and decided what to change; set up GitHub and GitHub Pages.

Kept: Claude suggested a perceptual hash plus a time window instead of an AI model for similar photos. I kept it because it works offline and I can explain it. Changed: Claude's first plan was a general "photo → sticker" tool. I redirected it to shoot-to-save and the growth timeline, which is my real problem.

Where AI needed checking: the first sticker preview scrolled away (change 1), and folding missed separately shot photos (change 2); I found both by using the app.

6. Code I can explain

buildMoments() and looksAlike() walk photos oldest → newest. A photo joins the current moment if it is within the time window and photoDistance() is below allowedDistance() for that time gap, for both the previous photo and the first of the stack; otherwise it starts a new moment. The timeline and Journey render these moments, so the Similarity slider changes what you see. stamps() in sticker.js makes the sticker outline by drawing the silhouette around a circle.