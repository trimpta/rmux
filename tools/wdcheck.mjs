// Checks the real Chrome command line and webdriver flag fixes.
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const log = (...a) => console.log('[wd]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resolveChrome = () => {
  const base = join(import.meta.dirname, '..', 'browsers', 'chrome');
  const v = readdirSync(base).filter((d) => d.startsWith('win64-')).sort().reverse();
  return join(base, v[0], 'chrome-win64', 'chrome.exe');
};

async function trial(name, extraArgs) {
  const profile = mkdtempSync(join(tmpdir(), 'rmux-wd-'));
  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: false,
    userDataDir: profile,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-first-run', '--no-default-browser-check', ...extraArgs],
  });
  const page = (await browser.pages())[0];
  const args = browser.process().spawnargs;
  log(`[${name}] automation-related args:`, JSON.stringify(args.filter((a) => /automation|blink|webdriver/i.test(a))));
  log(`[${name}] webdriver:`, await page.evaluate(() => navigator.webdriver));
  try { await browser.close(); } catch {}
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

const hardExit = setTimeout(() => { log('TIMEOUT'); process.exit(2); }, 90_000);
try {
  await trial('baseline', []);
  await trial('blink-off', ['--disable-blink-features=AutomationControlled']);
} catch (e) {
  log('ERROR:', e?.stack || e);
  process.exitCode = 1;
} finally {
  clearTimeout(hardExit);
}
