// Validates the chromeless-window architecture rmux will use:
//   window 0  = puppeteer.launch with `--app=data:...` (app mode; no tabs/omnibox)
//   extra win = spawn `chrome --app=data:... --user-data-dir=<same>`; Chrome forwards it
//               to the running browser => shared login, same CDP connection
// Checks: chromeless metric, tileability, discovery of forwarded windows, close detection.
// Run: node tools/appmodecheck.mjs
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const log = (...a) => console.log('[app]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome ignores --app for about:blank (still a toolbar window). A data: URL forces
// a real app window, and it stays chromeless after navigating on to https.
const DATA_URL = 'data:text/html,<title>rmux</title>';

const resolveChrome = () => {
  const base = join(import.meta.dirname, '..', 'browsers', 'chrome');
  const v = readdirSync(base).filter((d) => d.startsWith('win64-')).sort().reverse();
  return join(base, v[0], 'chrome-win64', 'chrome.exe');
};
const chromeExe = resolveChrome();
const profile = mkdtempSync(join(tmpdir(), 'rmux-app-'));
const hardExit = setTimeout(() => { log('TIMEOUT'); process.exit(2); }, 90_000);

const metrics = (page) => page.evaluate(() => ({ chrome: Math.round(window.outerHeight - window.innerHeight) }));

const targetIdOf = (page) =>
  page.target()?._targetId ??
  (typeof page.target()?.targetId === 'function' ? page.target().targetId() : undefined);

const idOf = async (page) =>
  targetIdOf(page) ?? (await (await page.createCDPSession()).send('Target.getTargetInfo')).targetInfo.targetId;

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: chromeExe,
    headless: false,
    userDataDir: profile,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-first-run', '--no-default-browser-check', `--app=${DATA_URL}`],
  });
  const bs = await browser.target().createCDPSession();
  await sleep(1200);

  const pageA = (await browser.pages())[0];
  log('window A url=', pageA.url(), 'metrics=', JSON.stringify(await metrics(pageA)));

  const wA = (await bs.send('Browser.getWindowForTarget', { targetId: await idOf(pageA) })).windowId;
  await bs.send('Browser.setWindowBounds', { windowId: wA, bounds: { windowState: 'normal' } });
  await bs.send('Browser.setWindowBounds', { windowId: wA, bounds: { left: 40, top: 40, width: 800, height: 900 } });
  await sleep(500);
  log('window A tiled ->', JSON.stringify((await bs.send('Browser.getWindowBounds', { windowId: wA })).bounds));

  // forwarded app window (what a fork will do)
  const before = new Set(await browser.pages());
  spawn(chromeExe, [`--app=${DATA_URL}`, `--user-data-dir=${profile}`], { detached: true, stdio: 'ignore' }).unref();

  let pageB = null;
  for (let i = 0; i < 30 && !pageB; i++) {
    await sleep(400);
    pageB = (await browser.pages()).find((p) => !before.has(p));
  }
  log('forwarded --app produced a discoverable window:', !!pageB);
  if (pageB) {
    log('window B metrics=', JSON.stringify(await metrics(pageB)));
    const idB = await idOf(pageB);
    const wB = (await bs.send('Browser.getWindowForTarget', { targetId: idB })).windowId;
    await bs.send('Browser.setWindowBounds', { windowId: wB, bounds: { windowState: 'normal' } });
    await bs.send('Browser.setWindowBounds', { windowId: wB, bounds: { left: 850, top: 40, width: 800, height: 900 } });
    await sleep(500);
    log('window B tiled ->', JSON.stringify((await bs.send('Browser.getWindowBounds', { windowId: wB })).bounds));

    const destroyed = [];
    browser.on('targetdestroyed', (t) => destroyed.push(t._targetId));
    await pageB.close();
    await sleep(700);
    log('window B close fired targetdestroyed:', destroyed.includes(idB));
  }

  // navigate window A to a real URL and confirm it stays chromeless
  await pageA.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch((e) => log('nav:', e.message));
  await sleep(600);
  log('window A after nav url=', pageA.url(), 'metrics=', JSON.stringify(await metrics(pageA)));

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
