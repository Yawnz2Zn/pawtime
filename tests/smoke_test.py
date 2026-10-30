"""Headless-browser smoke test for PawTime (optional). See README.
Serve the project root on port 8765 first, then: python3 tests/smoke_test.py
Screenshots are written to tests/out/ (git-ignored)."""
import json, sys
from playwright.sync_api import sync_playwright

import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get("PAWTIME_URL", "http://localhost:8765/index.html")
errors = []
results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

with sync_playwright() as p:
    browser = p.chromium.launch(args=[
        "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(viewport={"width": 390, "height": 820}, device_scale_factor=2,
                              permissions=["camera"], is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    page.on("dialog", lambda d: d.accept())

    page.goto(URL)
    page.wait_for_selector("#sheet-onboard:not([hidden])")
    check("onboarding shows on first run", True)
    page.fill("#obName", "Biscuit")
    page.fill("#obBirthday", "2024-03-10")
    page.click("#obStart")
    page.wait_for_function("document.querySelector('#video').videoWidth > 0", timeout=8000)
    check("camera stream starts (fake device)", True)
    page.screenshot(path=f"{OUT}/s1_camera.png")

    # single shot
    page.click("#btnShutter")
    page.wait_for_function("document.querySelector('#thumbCount').textContent === '1'", timeout=6000)
    check("one tap saves one photo", True)
    check("quick tag bar appears", page.is_visible("#quickTags"))
    page.click("#quickTagButtons [data-tag=walk]")
    tags = page.evaluate("state.photos[0].tags")
    check("quick tag applies to the photo", tags == ["walk"], str(tags))

    # repeated clicks: hammer the shutter, should not create duplicates beyond what finishes
    page.evaluate("document.querySelector('#btnBurst').click()")
    page.click("#btnShutter")
    page.click("#btnShutter", force=True)  # second tap while busy should be ignored
    page.wait_for_function("state.photos.length >= 6", timeout=10000)
    page.wait_for_timeout(600)
    n = page.evaluate("state.photos.length")
    check("burst takes 5 and repeated tap while busy is ignored", n == 6, f"photos={n}")
    page.screenshot(path=f"{OUT}/s2_camera_after.png")

    # persistence across reload
    page.reload()
    page.wait_for_function("document.querySelector('#thumbCount').textContent === '6'", timeout=6000)
    check("photos persist after reload (IndexedDB)", True)

    # sample data
    page.click("#btnSettings")
    page.click("#btnSample")
    page.wait_for_function("document.querySelector('#view-timeline').classList.contains('active')", timeout=60000)
    page.wait_for_selector(".moment")
    stat = page.inner_text("#statLine")
    print("STAT:", stat.replace("\n", " | "))
    info = page.evaluate("""() => {
      const ms = getMoments().filter(m => !m.sticker);
      return {photos: state.photos.filter(p=>p.kind==='photo').length, moments: ms.length,
              sizes: ms.map(m => m.items.length),
              demoOnly: getMoments().filter(m=>!m.sticker && m.items.length>1).length}
    }""")
    print("FOLDING:", json.dumps(info))
    check("sample photos fold into fewer moments", info["moments"] < info["photos"] - 8, json.dumps(info))
    page.screenshot(path=f"{OUT}/s3_timeline.png")
    page.screenshot(path=f"{OUT}/s3_timeline_full.png", full_page=False)

    # cover choice: the blurred one should not be a cover
    cover_check = page.evaluate("""() => {
      const bad = [];
      for (const m of getMoments()) { if (m.items.length>1) { const max = Math.max(...m.items.map(i=>i.sharp)); if (m.cover.sharp !== max) bad.push(m.id); } }
      return bad.length;
    }""")
    check("auto cover is always the sharpest shot", cover_check == 0)

    # tag filter
    page.click("#filterChips [data-filter=sleep]")
    shown = page.evaluate("document.querySelectorAll('#timeline .moment').length")
    allm = page.evaluate("getMoments().filter(m=>m.tags.has('sleep')).length")
    check("tag filter shows only matching moments", shown == allm and shown > 0, f"{shown}/{allm}")
    page.click("#filterChips [data-filter='']")

    # date jump
    page.fill("#jumpDate", "2000-01-01")
    page.dispatch_event("#jumpDate", "change")
    check("date jump runs without error", True)

    # open viewer on a stacked moment
    page.evaluate("document.querySelector('#tlScroll').scrollTop = 0")
    page.click(".moment.stack >> nth=0")
    page.wait_for_selector("#sheet-viewer:not([hidden])")
    page.screenshot(path=f"{OUT}/s4_viewer.png")
    n_strip = page.evaluate("document.querySelectorAll('#vStrip button').length")
    check("viewer shows the stack of photos", n_strip > 1, str(n_strip))
    # set a different cover
    page.click("#vStrip button >> nth=1")
    page.click("[data-act=cover]")
    page.wait_for_function("momentOf(viewer.photoId).coverIsPinned === true", timeout=3000)
    pinned = page.evaluate("momentOf(viewer.photoId).coverIsPinned")
    check("user can override the cover", pinned is True)

    # sticker studio
    page.click("[data-act=sticker]")
    page.wait_for_selector("#sheet-sticker:not([hidden])")
    page.fill("#stkCaption", "Treat time!")
    page.click("[data-emoji='🐾']")
    page.click("[data-shape=heart]")
    page.fill("#stkZoom", "150")
    page.dispatch_event("#stkZoom", "input")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/s5_sticker_heart.png")
    page.click("[data-shape=circle]")
    page.wait_for_timeout(150)
    page.screenshot(path=f"{OUT}/s5_sticker_circle.png")
    before = page.evaluate("state.photos.filter(p=>p.kind==='sticker').length")
    page.click("#stkSave")
    page.click("#stkSave", force=True)   # repeated click
    page.wait_for_function("document.querySelector('#stkSave').textContent === 'Saved ✓'", timeout=5000)
    page.wait_for_timeout(300)
    after = page.evaluate("state.photos.filter(p=>p.kind==='sticker').length")
    check("sticker saves once even if clicked twice", after == before + 1, f"{before}->{after}")
    check("save button shows Saved state", page.inner_text("#stkSave") == "Saved ✓")
    # change something -> can save again
    page.fill("#stkCaption", "Treat time!!")
    check("editing re-enables saving", page.inner_text("#stkSave") == "Save to timeline")
    # share fallback (headless has no share files => download)
    with page.expect_download() as dl:
        page.click("#stkShare")
    check("share falls back to a PNG download", dl.value.suggested_filename.endswith(".png"), dl.value.suggested_filename)
    # reset
    page.click("#stkReset")
    check("reset clears the caption", page.input_value("#stkCaption") == "")
    page.click("[data-close=sheet-sticker]")
    page.click("[data-close=sheet-viewer]")
    stk_cards = page.evaluate("document.querySelectorAll('#timeline .moment.sticker').length")
    check("sticker appears on the timeline", stk_cards == 1, str(stk_cards))
    page.screenshot(path=f"{OUT}/s6_timeline_sticker.png")

    # tidy
    ph_before = page.evaluate("state.photos.length")
    page.click(".moment.stack >> nth=0")
    cnt = page.evaluate("momentOf(viewer.photoId).items.length")
    page.click("[data-act=tidy]")
    page.wait_for_timeout(300)
    ph_after = page.evaluate("state.photos.length")
    check("'keep only the cover' deletes the others", ph_before - ph_after == cnt - 1, f"{ph_before}->{ph_after}, stack={cnt}")
    page.keyboard.press("Escape")

    # settings: strictness changes folding
    page.click("#btnSettings")
    m_before = page.evaluate("getMoments().filter(m=>!m.sticker).length")
    page.fill("#setSim", "0"); page.dispatch_event("#setSim", "input")
    m_strict = page.evaluate("getMoments().filter(m=>!m.sticker).length")
    page.fill("#setSim", "24"); page.dispatch_event("#setSim", "input")
    m_loose = page.evaluate("getMoments().filter(m=>!m.sticker).length")
    check("similarity slider changes folding (strict >= default >= loose)", m_strict >= m_before >= m_loose and m_strict > m_loose, f"strict={m_strict} default={m_before} loose={m_loose}")
    page.fill("#setSim", "10"); page.dispatch_event("#setSim", "input")
    page.screenshot(path=f"{OUT}/s7_settings.png")

    # clear demo
    page.click("#btnClearSample")
    page.wait_for_timeout(500)
    left = page.evaluate("state.photos.filter(p=>p.demo).length")
    check("sample photos can be removed", left == 0)

    # file import path: empty + wrong file type + good file
    page.click("[data-close=sheet-settings]")
    page.click(".tab[data-view=camera]")
    page.set_input_files("#fileInput", files=[{"name": "notes.txt", "mimeType": "text/plain", "buffer": b"hello"}])
    page.wait_for_timeout(300)
    check("non-image file is rejected with a message", "No images selected" in page.inner_text("#toast"), page.inner_text("#toast"))
    page.set_input_files("#fileInput", files=[{"name": "fake.jpg", "mimeType": "image/jpeg", "buffer": b"not really a jpeg"}])
    page.wait_for_timeout(600)
    check("corrupt image does not crash the app", "could not be read" in page.inner_text("#toast") or "Added" in page.inner_text("#toast"), page.inner_text("#toast"))

    # Escape / keyboard shutter
    n0 = page.evaluate("state.photos.length")
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.wait_for_function("document.querySelector('#video').videoWidth > 0", timeout=8000)
    page.keyboard.press("Space")
    page.wait_for_timeout(1800)
    n1 = page.evaluate("state.photos.length")
    check("space bar takes a photo on desktop", n1 > n0, f"{n0}->{n1}")
    page.close()

    # ---- permission denied path ----
    ctx2 = browser.new_context(viewport={"width": 390, "height": 820}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx2.add_init_script("""
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied','NotAllowedError'));
    """)
    p2 = ctx2.new_page()
    p2.on("pageerror", lambda e: errors.append("PAGEERROR2 " + str(e)))
    p2.on("dialog", lambda d: d.accept())
    p2.goto(URL)
    p2.click("#obSkip")
    p2.wait_for_selector("#camMsg:not([hidden])")
    title = p2.inner_text("#camMsgTitle")
    check("denied permission shows a clear message", "denied" in title.lower(), title)
    p2.screenshot(path=f"{OUT}/s8_denied.png")
    p2.click("#btnShutter")
    check("shutter without camera gives feedback, not a crash", "not ready" in p2.inner_text("#toast").lower(), p2.inner_text("#toast"))
    p2.click("#btnDemo")
    p2.wait_for_function("document.querySelector('#view-timeline').classList.contains('active')", timeout=60000)
    check("sample photos work as the fallback", p2.evaluate("state.photos.length") > 20)
    p2.screenshot(path=f"{OUT}/s9_demo_fallback_timeline.png")
    # empty-tag state
    p2.click("#filterChips [data-filter=silly]")
    p2.click("#filterChips [data-filter=milestone]")
    # SW registered?
    sw = p2.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)")
    check("service worker registers", sw >= 1, str(sw))
    manifest_ok = p2.evaluate("fetch('manifest.json').then(r=>r.ok)")
    check("manifest is served", manifest_ok is True)
    browser.close()

print("\nCONSOLE/PAGE ERRORS:", errors if errors else "none")
fails = [r for r in results if not r[1]]
print(f"\n{len(results)-len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
