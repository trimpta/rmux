// Shared constants + URL predicates. Node side only — the page-side predicate
// is generated from REEL_PATH_RE by src/inject.js (single source of truth).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_NAME = 'rmux';

export const START_URL = 'https://www.instagram.com/reels/';

// Name of the page -> Node bridge installed via page.exposeFunction().
export const FORK_BRIDGE = '__rmuxForkRequest';

// Reel contexts: /reels, /reels/, /reel/<code>/ ... but not a bare /reel
// (no code) or /reel/.
export const REEL_PATH_RE = /^\/(?:reels(?:\/|$)|reel\/[^/]+)/;
// Login / checkpoint contexts where the Fork button stays hidden.
export const LOGIN_PATH_RE = /^\/(accounts|challenge)(\/|$)/;

export const MAX_COLUMNS = 3;
export const DEFAULT_TIMEOUT_MS = 60_000;

// Chrome "app mode" (chromeless: no tab strip, no omnibox) needs a real
// navigation URL — about:blank is ignored and yields a normal toolbar window,
// but a data: URL forces an app window, and it stays chromeless after we
// navigate on to https. Every rmux window (first and forked) starts here.
// Verified in tools/appmodecheck.mjs.
export const APP_WINDOW_URL = 'data:text/html,<title>rmux</title>';

// Verified flags (see tools/probe.mjs + tools/initcheck.mjs):
//  - --enable-automation is stripped via ignoreDefaultArgs
//  - --disable-blink-features=AutomationControlled keeps navigator.webdriver false
//  - --autoplay-policy lets a freshly-forked window (no user gesture) play
//    audible media; with it, the injected auto-unmute cannot be paused by the
//    autoplay policy.
export const CHROME_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-crash-restore-bubble',
  '--disable-blink-features=AutomationControlled',
  '--autoplay-policy=no-user-gesture-required',
];

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Locate the Chrome for Testing executable installed under ./browsers.
 * Override with RMUX_CHROME=/path/to/chrome.exe.
 */
export function resolveChromeExecutable() {
  if (process.env.RMUX_CHROME && existsSync(process.env.RMUX_CHROME)) {
    return process.env.RMUX_CHROME;
  }
  const base = join(PROJECT_ROOT, 'browsers', 'chrome');
  if (existsSync(base)) {
    const versions = readdirSync(base)
      .filter((d) => d.startsWith('win64-'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .reverse();
    for (const version of versions) {
      const exe = join(base, version, 'chrome-win64', 'chrome.exe');
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error('Chrome for Testing not found. Run: npm run install-browser');
}

/**
 * Persistent Chrome profile — keeps the Instagram login between runs.
 * Override with RMUX_PROFILE=/path/to/profile.
 */
export function resolveProfileDir() {
  return process.env.RMUX_PROFILE || join(PROJECT_ROOT, 'profile');
}

export function isReelUrl(href) {
  try {
    const url = new URL(String(href));
    return /(^|\.)instagram\.com$/.test(url.hostname) && REEL_PATH_RE.test(url.pathname);
  } catch {
    return false;
  }
}

export function isLoginUrl(href) {
  try {
    const url = new URL(String(href));
    return /(^|\.)instagram\.com$/.test(url.hostname) && LOGIN_PATH_RE.test(url.pathname);
  } catch {
    return false;
  }
}
