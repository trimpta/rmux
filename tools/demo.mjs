// Scripted demo: opens Instagram Reels and drives rmux the way a person would —
// watch a reel, scroll, fork it off, scroll the source on, fork a duplicate,
// scroll the *other* window, fork from that one, then close windows and watch
// the survivors retile.
//
// It drives the exact bridge the Fork button calls (window.__rmuxForkRequest)
// and scrolls with synthetic wheel events — the only synthetic input in the
// project, and strictly a dev tool. The product sends none (prd.md §8.3).
//
// Requires a logged-in persistent profile (./profile/). The demo opens real
// windows and takes over the screen for a minute.
//
// Run:  node tools/demo.mjs          # normal pace
//       node tools/demo.mjs --fast   # quicker, for a smoke check
import { RmuxApp } from '../src/rmux.js';

const FAST = process.argv.includes('--fast');
const SCALE = FAST ? 0.4 : 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = (ms) => sleep(Math.round(ms * SCALE));
const step = (n, msg) => console.log(`\n[demo] (${n}) ${msg}`);

const app = new RmuxApp({ exitOnShutdown: false });

// The actively playing <video>, or null.
const active = (page) =>
  page
    .evaluate(() => {
      const v = [...document.querySelectorAll('video')].find((x) => !x.paused && x.readyState > 0);
      return v ? { src: v.currentSrc, t: +v.currentTime.toFixed(2), muted: v.muted } : null;
    })
    .catch(() => null);

async function waitForPlaying(page, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const a = await active(page);
    if (a) return a;
    await sleep(400);
  }
  return null;
}

// Give the one-shot auto-unmute a moment to land, so the narration is accurate.
async function waitForSound(page, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let a = await active(page);
  while (a?.muted && Date.now() < deadline) {
    await sleep(300);
    a = await active(page);
  }
  return a;
}

// Scroll a window to the next reel and wait for the playing video to change.
async function scrollToNext(page) {
  const before = await active(page);
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = await page.evaluate(() => ({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight * 0.35) }));
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel({ deltaY: 1400 });
    await sleep(1200);
    const now = await active(page);
    if (now && (!before || now.src !== before.src || now.t < before.t)) return now;
  }
  return await active(page);
}

// Fork the page's current reel through the same channel the button uses.
async function fork(page, expectCount) {
  const url = await page.url();
  const res = await page.evaluate((u) => window.__rmuxForkRequest(u), url);
  const deadline = Date.now() + 15_000;
  while (app.registry.count < expectCount && Date.now() < deadline) await sleep(200);
  return res;
}

const closeWindow = async (index) => {
  const w = app.registry.all[index];
  if (!w) return;
  await w.page.close().catch(() => {});
  await sleep(900);
};

try {
  console.log('[demo] starting rmux…');
  await app.start();

  const w0 = app.registry.all[0];
  step(1, 'waiting for a reel to play in window 0…');
  let a = await waitForPlaying(w0.page);
  if (!a) {
    console.log('[demo] no playing reel found (not logged in? no reels?) — aborting the scripted part.');
  } else {
    a = (await waitForSound(w0.page)) ?? a;
    step(2, `watching the reel${a.muted ? ' (muted)' : ' (with sound)'}…`);
    await wait(4000);

    step(3, 'scrolling window 0 to the next reel…');
    await scrollToNext(w0.page);
    await wait(2500);

    step(4, 'forking this reel → window 1 (source stays put)…');
    await fork(w0.page, 2);
    await waitForPlaying(app.registry.all[1].page);
    await wait(2500);

    step(5, 'scrolling window 0 again — the two sessions now move independently…');
    await scrollToNext(w0.page);
    await wait(1500);

    step(6, 'forking window 0 again → window 2 (a duplicate branch)…');
    await fork(w0.page, 3);
    await waitForPlaying(app.registry.all[2].page);
    await wait(2500);

    step(7, 'scrolling window 1 while 0 and 2 keep playing…');
    await scrollToNext(app.registry.all[1].page);
    await wait(1500);

    step(8, 'forking from window 1 → window 3 (a fork of a fork)…');
    await fork(app.registry.all[1].page, 4);
    await waitForPlaying(app.registry.all[3].page);
    await wait(2500);

    step(9, 'closing window 0 — survivors re-index and retile…');
    await closeWindow(0);
    await wait(2000);

    step(10, 'closing the next window — the last survivor re-maximizes…');
    await closeWindow(0);
    await wait(2000);

    step(11, 'done — two independent sessions still running.');
  }
} catch (err) {
  console.log('[demo] error:', err?.message || err);
} finally {
  console.log('\n[demo] shutting down…');
  await app.shutdown('demo complete').catch(() => {});
  await sleep(500);
  console.log('[demo] exited.');
}
