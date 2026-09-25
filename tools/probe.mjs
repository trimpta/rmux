// M0 spike — verifies every platform assumption rmux depends on, against the real browser.
// Run: node tools/probe.mjs
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const log = (...a) => console.log('[probe]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveChrome() {
  const base = join(import.meta.dirname, '..', 'browsers', 'chrome');
  if (!existsSync(base)) throw new Error('browsers/chrome not found — run the install command');
  const versions = readdirSync(base).filter((d) => d.startsWith('win64-'));
  if (!versions.length) throw new Error('no win64 chrome found');
  versions.sort().reverse();
  const exe = join(base, versions[0], 'chrome-win64', 'chrome.exe');
  if (!existsSync(exe)) throw new Error('chrome.exe missing at ' + exe);
  return exe;
}

const hardExit = setTimeout(() => { log('TIMEOUT — forcing exit'); process.exit(2); }, 90_000);

// tiny local server for the injection test
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><h1>probe page</h1>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const localUrl = `http://127.0.0.1:${server.address().port}/`;
log('local server:', localUrl);

const profile = mkdtempSync(join(tmpdir(), 'rmux-probe-'));
let browser;
try {
  const chrome = resolveChrome();
  log('chrome exe:', chrome);

  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: false,
    userDataDir: profile,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  log('launched:', await browser.version());
  log('browser.target type:', typeof browser.target);

  // ---- browser-level CDP session ----
  const bs = await browser.target().createCDPSession();
  log('browser CDP session: OK');

  // ---- initial page ----
  const pages = await browser.pages();
  log('initial pages:', pages.length, '| page0 url:', pages[0].url());
  const page0 = pages[0];
  log('navigator.webdriver =', await page0.evaluate(() => navigator.webdriver));

  // ---- target id accessors ----
  const t0 = page0.target();
  log('target instance own props:', Object.getOwnPropertyNames(t0).join(','));
  log('target proto methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(t0)).join(','));
  log('target._targetId =', t0._targetId);
  log('target.targetId() =', typeof t0.targetId === 'function' ? t0.targetId() : '(none)');

  const ps0 = await page0.createCDPSession();
  const ti0 = (await ps0.send('Target.getTargetInfo')).targetInfo;
  log('CDP targetId (page0):', ti0.targetId, '| matches _targetId:', ti0.targetId === t0._targetId);

  // ---- handle mapping ----
  const { windowId: w0, bounds: b0 } = await bs.send('Browser.getWindowForTarget', { targetId: ti0.targetId });
  log('window0 id:', w0, '| bounds:', JSON.stringify(b0));

  // ---- screen info for work-area cross-check ----
  const screenInfo = await page0.evaluate(() => ({
    availL: screen.availLeft, availT: screen.availTop, availW: screen.availWidth, availH: screen.availHeight,
    w: screen.width, h: screen.height, dpr: devicePixelRatio, innerW: innerWidth, innerH: innerHeight,
  }));
  log('screen:', JSON.stringify(screenInfo));

  // ---- maximize semantics (work area source) ----
  await bs.send('Browser.setWindowBounds', { windowId: w0, bounds: { windowState: 'maximized' } });
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    const { bounds } = await bs.send('Browser.getWindowBounds', { windowId: w0 });
    log(`maximize poll ${i}:`, JSON.stringify(bounds));
    if (bounds.windowState === 'maximized') break;
  }

  // ---- create a NEW WINDOW via CDP ----
  const { targetId: newId } = await bs.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  log('Target.createTarget ->', newId);
  await sleep(400);
  log('all targets now:', browser.targets().map((t) => `${t.type()}:${t._targetId}`).join(' | '));

  // waitForTarget AFTER creation (race check): check existing first, then wait
  let target1 = browser.targets().find((t) => t._targetId === newId);
  if (!target1) {
    log('not in existing list — using waitForTarget');
    target1 = await browser.waitForTarget((t) => t._targetId === newId, { timeout: 5000 });
  }
  log('target1 matched:', !!target1, '| type:', target1?.type());
  const page1 = await target1.page();
  log('page1 attached:', !!page1);
  const ti1 = (await (await page1.createCDPSession()).send('Target.getTargetInfo')).targetInfo;
  log('target1 openerId:', ti1.openerId ?? '(none — not a popup)');

  const { windowId: w1, bounds: b1 } = await bs.send('Browser.getWindowForTarget', { targetId: ti1.targetId });
  log('window1 id:', w1, '| bounds:', JSON.stringify(b1), '| distinct from w0:', w0 !== w1);

  // ---- injection channel: init script + exposeFunction across about:blank -> origin ----
  const ps1 = await page1.createCDPSession();
  await ps1.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__probeInitRan = true;' });
  await page1.exposeFunction('__probeBridge', async (x) => 'got:' + x);
  await page1.goto(localUrl, { waitUntil: 'domcontentloaded' });
  log('inject after nav:', await page1.evaluate(() => [window.__probeInitRan === true, typeof window.__probeBridge]));
  log('bridge roundtrip:', await page1.evaluate(() => window.__probeBridge('hi')));
  log('mouse.wheel type:', typeof page1.mouse.wheel);

  // ---- tiling: focus side-effects ----
  const focus = async (tag) => log(`focus ${tag}: p0=${await page0.evaluate(() => document.hasFocus())} p1=${await page1.evaluate(() => document.hasFocus())}`);
  await focus('before tile');
  await bs.send('Browser.setWindowBounds', { windowId: w0, bounds: { windowState: 'normal' } });
  await bs.send('Browser.setWindowBounds', { windowId: w1, bounds: { windowState: 'normal' } });
  await bs.send('Browser.setWindowBounds', { windowId: w0, bounds: { left: 0, top: 0, width: 960, height: 1040 } });
  await bs.send('Browser.setWindowBounds', { windowId: w1, bounds: { left: 960, top: 0, width: 960, height: 1040 } });
  await sleep(400);
  log('readback w0:', JSON.stringify((await bs.send('Browser.getWindowBounds', { windowId: w0 })).bounds));
  log('readback w1:', JSON.stringify((await bs.send('Browser.getWindowBounds', { windowId: w1 })).bounds));
  await focus('after tile');

  // ---- runtime move proof (second move, long after open) ----
  await bs.send('Browser.setWindowBounds', { windowId: w1, bounds: { left: 400, top: 100, width: 900, height: 800 } });
  await sleep(300);
  log('runtime move readback w1:', JSON.stringify((await bs.send('Browser.getWindowBounds', { windowId: w1 })).bounds));

  // ---- focus restore ----
  await page0.bringToFront();
  await sleep(400);
  await focus('after bringToFront(p0)');

  // ---- close detection ----
  const destroyed = [];
  browser.on('targetdestroyed', (t) => destroyed.push(`${t.type()}:${t._targetId}`));
  await page1.close();
  await sleep(600);
  log('targetdestroyed events:', JSON.stringify(destroyed));

  // ---- single window remaximize ----
  await bs.send('Browser.setWindowBounds', { windowId: w0, bounds: { windowState: 'maximized' } });
  await sleep(400);
  log('final w0:', JSON.stringify((await bs.send('Browser.getWindowBounds', { windowId: w0 })).bounds));

  log('ALL PROBES DONE');
} catch (err) {
  log('PROBE ERROR:', err?.stack || err);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch (e) { log('browser close error:', e.message); }
  server.close();
  await sleep(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { log('profile cleanup skipped:', e.code); }
  clearTimeout(hardExit);
  log('exited');
}
