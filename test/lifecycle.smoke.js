// Full lifecycle smoke test — runs the REAL app against a local page (no
// Instagram): launches Chrome, injects the button + bridge, forks through the
// exact path the button uses, checks priority tiling, close/reindex, and the
// all-windows-closed path.
//
// Run: npm run smoke   (opens real Chrome windows briefly)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RmuxApp } from '../src/rmux.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log('[smoke]', ...args);

test('rmux lifecycle', { timeout: 180_000 }, async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>rmux smoke</title><h1>rmux smoke</h1>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const localUrl = `http://127.0.0.1:${server.address().port}/`;

  const profileDir = mkdtempSync(join(tmpdir(), 'rmux-smoke-'));
  const app = new RmuxApp({
    startUrl: 'about:blank',
    keepAliveOnAllClosed: true,
    exitOnShutdown: false,
    urlFilter: (href) => href.startsWith(localUrl),
    quiet: false,
    profileDir,
    freshProfile: true,
  });

  const boundsOf = async (win) =>
    (await app.browserSession.send('Browser.getWindowBounds', { windowId: win.windowId })).bounds;

  // Windows/Chrome round requested window sizes by 0–2px (DPI/frame rounding);
  // edges are exact. Assert with tolerance — see README known issues.
  const TOL = 3;
  const near = (actual, expected, msg, tol = TOL) =>
    assert.ok(
      Math.abs(actual - expected) <= tol,
      `${msg}: got ${actual}, expected ~${expected} (±${tol})`,
    );

  try {
    await app.start();
    log('started; work area:', JSON.stringify(app.workArea));

    // --- window 0: instrumented page ---
    const w0 = app.registry.all[0];
    await w0.page.goto(localUrl, { waitUntil: 'domcontentloaded' });
    assert.equal(await w0.page.evaluate(() => navigator.webdriver), false, 'navigator.webdriver hidden');
    assert.equal(
      await w0.page.evaluate(() => !!document.getElementById('__rmux_fork_host')),
      true,
      'fork host injected',
    );
    assert.equal(
      await w0.page.evaluate(() => typeof window.__rmuxForkRequest),
      'function',
      'fork bridge exposed',
    );
    log('window #0 instrumented');

    // --- fork via the bridge (the same path the button click uses) ---
    const res1 = await w0.page.evaluate((u) => window.__rmuxForkRequest(u), localUrl);
    assert.equal(res1, 'ok', 'fork returns ok');
    await sleep(600);
    assert.equal(app.registry.count, 2, 'two windows after fork');

    const w1 = app.registry.all[1];
    assert.ok(w1.page.url().startsWith(localUrl), `child navigated (got ${w1.page.url()})`);
    assert.equal(
      await w1.page.evaluate(() => !!document.getElementById('__rmux_fork_host')),
      true,
      'child instrumented',
    );
    log('fork → window #1 OK');

    // --- 2-window layout: full-height halves ---
    await sleep(400);
    const WA = app.workArea;
    const half = Math.round(WA.width / 2);
    const b0 = await boundsOf(w0);
    const b1 = await boundsOf(w1);
    log('2-window bounds:', JSON.stringify(b0), JSON.stringify(b1));
    near(b0.left, WA.x, '#0 left edge');
    near(b0.width, half, '#0 half width');
    near(b0.height, WA.height, '#0 full height');
    near(b1.left, WA.x + half, '#1 starts at the midpoint');
    near(b1.width, WA.width - half, '#1 covers the rest');
    near(b1.height, WA.height, '#1 full height');
    near(b0.left + b0.width, b1.left, 'windows abut (no gap)', 3);
    near(b1.left + b1.width, WA.x + WA.width, 'right edge covered', 3);

    // --- third window ---
    const res2 = await w0.page.evaluate((u) => window.__rmuxForkRequest(u), localUrl);
    assert.equal(res2, 'ok', 'second fork returns ok');
    await sleep(700);
    assert.equal(app.registry.count, 3, 'three windows');
    await sleep(300);
    const widths = [];
    for (const w of app.registry.all) widths.push((await boundsOf(w)).width);
    near(widths.reduce((s, x) => s + x, 0), WA.width, 'widths cover the work area', 8);
    log('3-window widths:', JSON.stringify(widths));

    // --- close the middle window → compact reindex + retile ---
    await app.registry.all[1].page.close();
    await sleep(800);
    assert.equal(app.registry.count, 2, 'two windows after close');
    assert.deepEqual(
      app.registry.all.map((w) => w.index),
      [0, 1],
      'survivors re-indexed compactly',
    );
    const b0b = await boundsOf(app.registry.all[0]);
    const b1b = await boundsOf(app.registry.all[1]);
    log('post-close bounds:', JSON.stringify(b0b), JSON.stringify(b1b));
    near(b0b.width, half, 'survivor retiled after close');
    near(b1b.left, WA.x + half, 'second survivor at the midpoint');

    // --- close everything → all-closed path ---
    for (const w of app.registry.all) await w.page.close().catch(() => {});
    await app.waitForAllClosed();
    assert.equal(app.registry.count, 0, 'no windows left');
    log('all-closed path OK');
  } finally {
    server.close();
    await app.shutdown('smoke complete').catch(() => {});
    await sleep(400);
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});
