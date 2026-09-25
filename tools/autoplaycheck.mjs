// Does --autoplay-policy=no-user-gesture-required let a fresh window autoplay
// audible media (no user gesture)? Reels are opened by a fork with no gesture,
// so this decides whether the sound fix is a launch flag.
// Run: node tools/autoplaycheck.mjs
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const log = (...a) => console.log('[auto]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const resolveChrome = () => {
  const base = join(import.meta.dirname, '..', 'browsers', 'chrome');
  const v = readdirSync(base).filter((d) => d.startsWith('win64-')).sort().reverse();
  return join(base, v[0], 'chrome-win64', 'chrome.exe');
};

// a real, audible 1s 440Hz WAV so the policy actually applies
function wav(seconds = 1, rate = 44100) {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(30000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const tone = wav();

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/tone')) {
    res.writeHead(200, { 'content-type': 'audio/wav' });
    return res.end(tone);
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>auto</title><audio id="a" src="/tone.wav" preload="auto"></audio>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const EXE = resolveChrome();
async function run(label, extraArgs) {
  const profile = mkdtempSync(join(tmpdir(), 'rmux-auto-'));
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: EXE,
      headless: false,
      userDataDir: profile,
      defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--no-first-run', '--no-default-browser-check', ...extraArgs],
    });
    const page = (await browser.pages())[0];
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(500);
    const result = await page.evaluate(async () => {
      const policy = navigator.getAutoplayPolicy ? navigator.getAutoplayPolicy('media') : 'n/a';
      const a = document.getElementById('a');
      let play = 'ok';
      try { await a.play(); } catch (e) { play = e.name; }
      await new Promise((r) => setTimeout(r, 400));
      return { policy, play, paused: a.paused, muted: a.muted, currentTime: +a.currentTime.toFixed(2) };
    });
    log(`${label}: ${JSON.stringify(result)}`);
  } catch (err) {
    log(`${label}: ERROR ${err.message}`);
  } finally {
    try { await browser?.close(); } catch {}
    await sleep(200);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

await run('default                     ', []);
await run('--autoplay-policy=no-user-… ', ['--autoplay-policy=no-user-gesture-required']);
server.close();
