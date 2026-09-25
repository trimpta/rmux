// Characterizes CDP setWindowBounds -> getWindowBounds deltas on this machine.
// Run: node tools/geomcheck.mjs
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const log = (...a) => console.log('[geo]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resolveChrome = () => {
  const base = join(import.meta.dirname, '..', 'browsers', 'chrome');
  const v = readdirSync(base).filter((d) => d.startsWith('win64-')).sort().reverse();
  return join(base, v[0], 'chrome-win64', 'chrome.exe');
};

const profile = mkdtempSync(join(tmpdir(), 'rmux-geo-'));
const hardExit = setTimeout(() => { log('TIMEOUT'); process.exit(2); }, 90_000);
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: false,
    userDataDir: profile,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  });
  const bs = await browser.target().createCDPSession();
  const page = (await browser.pages())[0];
  const ti = (await (await page.createCDPSession()).send('Target.getTargetInfo')).targetInfo;
  const { windowId } = await bs.send('Browser.getWindowForTarget', { targetId: ti.targetId });
  log('dpr:', await page.evaluate(() => devicePixelRatio));

  await bs.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  await sleep(600);
  const wa = (await bs.send('Browser.getWindowBounds', { windowId })).bounds;
  log('maximized (work area):', JSON.stringify(wa));

  const rects = [
    { left: 100, top: 100, width: 800, height: 600 },
    { left: -7, top: -7, width: 861, height: 1082 },
    { left: -7, top: -7, width: 860, height: 1080 },
    { left: -7, top: -7, width: 862, height: 1084 },
    { left: 0, top: 0, width: 861, height: 1082 },
    { left: 854, top: -7, width: 861, height: 1082 },
    { left: 190, top: 33, width: 861, height: 1010 },
    { left: 100, top: 100, width: 500, height: 400 },
    { left: 100, top: 100, width: 500, height: 400 },
  ];

  for (const r of rects) {
    // alternate maximized/normal to mimic real retile-from-maximized path
    await bs.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
    await sleep(350);
    await bs.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await bs.send('Browser.setWindowBounds', { windowId, bounds: r });
    await sleep(350);
    const got = (await bs.send('Browser.getWindowBounds', { windowId })).bounds;
    log(
      `req ${JSON.stringify(r)} -> got ${JSON.stringify(got)}  d=(` +
        `${(got.left ?? 0) - r.left},${(got.top ?? 0) - r.top},` +
        `${(got.width ?? 0) - r.width},${(got.height ?? 0) - r.height})`,
    );
  }

  log('DONE');
} catch (err) {
  log('ERROR:', err?.stack || err);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch {}
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  clearTimeout(hardExit);
}
