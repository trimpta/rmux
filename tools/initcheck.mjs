// Isolates: (1) which init-script mechanism actually runs on navigation,
// (2) how to clear navigator.webdriver. Run: node tools/initcheck.mjs
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const log = (...a) => console.log('[init]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveChrome() {
  const base = join(import.meta.dirname, '..', 'browsers', 'chrome');
  const versions = readdirSync(base).filter((d) => d.startsWith('win64-')).sort().reverse();
  return join(base, versions[0], 'chrome-win64', 'chrome.exe');
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><h1>t</h1>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const localUrl = `http://127.0.0.1:${server.address().port}/`;

const hardExit = setTimeout(() => { log('TIMEOUT'); process.exit(2); }, 90_000);
const profile = mkdtempSync(join(tmpdir(), 'rmux-init-'));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: false,
    userDataDir: profile,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const p0 = (await browser.pages())[0];

  log('automation-ish default args:', JSON.stringify((await puppeteer.defaultArgs({ headless: false })).filter((a) => a.includes('automation'))));
  log('webdriver at launch:', await p0.evaluate(() => navigator.webdriver));

  // --- Variant A: raw CDP addScriptToEvaluateOnNewDocument, NO Page.enable ---
  {
    await p0.goto('about:blank');
    const s = await p0.createCDPSession();
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__A = true;' });
    await p0.goto(localUrl, { waitUntil: 'domcontentloaded' });
    log('A raw-CDP no-enable:', await p0.evaluate(() => window.__A === true));
    await s.detach().catch(() => {});
  }

  // --- Variant B: raw CDP with Page.enable ---
  {
    await p0.goto('about:blank');
    const s = await p0.createCDPSession();
    await s.send('Page.enable');
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__B = true;' });
    await p0.goto(localUrl, { waitUntil: 'domcontentloaded' });
    log('B raw-CDP with-enable:', await p0.evaluate(() => window.__B === true));
    await s.detach().catch(() => {});
  }

  // --- Variant C: puppeteer page.evaluateOnNewDocument(string) ---
  {
    await p0.goto('about:blank');
    await p0.evaluateOnNewDocument('window.__C = true;');
    await p0.goto(localUrl, { waitUntil: 'domcontentloaded' });
    log('C evaluateOnNewDocument(string):', await p0.evaluate(() => window.__C === true));
  }

  // --- Variant D: puppeteer page.evaluateOnNewDocument(fn) ---
  {
    await p0.goto('about:blank');
    await p0.evaluateOnNewDocument(() => { window.__D = true; });
    await p0.goto(localUrl, { waitUntil: 'domcontentloaded' });
    log('D evaluateOnNewDocument(fn):', await p0.evaluate(() => window.__D === true));
  }

  // --- Variant E: does C persist across a SECOND navigation (about:blank -> local -> local)? ---
  {
    await p0.goto('about:blank');
    await p0.evaluateOnNewDocument('window.__E = (window.__E || 0) + 1;');
    await p0.goto(localUrl, { waitUntil: 'domcontentloaded' });
    const first = await p0.evaluate(() => window.__E);
    await p0.goto(localUrl + '?again=1', { waitUntil: 'domcontentloaded' });
    const second = await p0.evaluate(() => window.__E);
    log('E persistence across 2 navs:', first, '->', second);
  }

  // --- Variant F: webdriver override from init script ---
  {
    await p0.goto('about:blank');
    await p0.evaluateOnNewDocument(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    });
    await p0.goto(localUrl, { waitUntil: 'domcontentloaded' });
    log('F webdriver override:', await p0.evaluate(() => navigator.webdriver));
  }

  log('DONE');
} catch (err) {
  log('ERROR:', err?.stack || err);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch {}
  server.close();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  clearTimeout(hardExit);
}
