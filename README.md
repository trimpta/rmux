# rmux

**tmux for Instagram Reels.** Watch reels in a real browser window; when a reel is semi-interesting but you can't be bothered to sit through it, click **Fork** — a new window opens playing that reel from the start, tiled beside the current one, while your original window moves on. Each window is a full, independent session: scroll, fork again, close whenever. No merge, no rejoin.

## Requirements

- Windows 10/11
- Node.js ≥ 20
- Chrome for Testing — downloaded once by `npm run install-browser` (~180 MB, lives in `./browsers/`, gitignored)

## Quickstart

```bash
npm install
npm run install-browser   # one-time download of Chrome for Testing
npm start
```

1. A Chrome window opens (maximized) at instagram.com/reels — **chromeless** (app mode: no tabs, no URL bar), like a native app. Log in once — the session persists in `./profile/` between runs.
2. Once a reel page is showing, a small **Fork** pill appears in the bottom-left corner.
3. Click it: a new chromeless window opens tiled to the right playing that reel from the start. Your current window stays exactly where it was — scroll on whenever you're ready; focus stays where you clicked.
4. Switch windows by clicking (native). Close any window to end that session — the rest re-tile. Close all windows (or Ctrl+C in the terminal) to quit.

Reset everything, including the login: `npm start -- --fresh`.

Every window is a real browser session: like, comment, scroll comments, mute — all native. The one thing rmux does for you is turn sound on: Instagram starts every reel muted, so each new window auto-unmutes once (see below), and after that it stays out of the way.

## Layout rules

Portrait content, landscape screen: max **3 columns**, full height, priority left → right (lower window index = better slot).

| Windows | Layout |
|---|---|
| 1 | `0` (maximized) |
| 2 | `0 \| 1` |
| 3 | `0 \| 1 \| 2` |
| 4 | `0 \| 1 \| 2/3` |
| 5 | `0 \| 1/2 \| 3/4` |
| 6 | `0/1 \| 2/3 \| 4/5` |
| 7 | `0/1 \| 2/3 \| 4/5/6` |
| 8 | `0/1 \| 2/3/4 \| 5/6/7` |

Columns are distributed as evenly as possible, left-biased — the rightmost column absorbs overflow, so window 0 stays alone longest. Closing a window re-indexes the survivors compactly and re-tiles everything; the last survivor re-maximizes.

## How it works

- **Real Chrome windows** driven by `puppeteer-core` over the DevTools Protocol.
- **Chromeless windows** via Chrome **app mode** (`--app=`): no tab strip, no omnibox. Window 0 is launched in app mode; each fork spawns a short-lived `chrome --app … --user-data-dir <same>` helper that Chrome's process singleton forwards to the running browser, so every window shares one process, one login, and one CDP connection while looking like a PWA.
- **The app-mode start URL is a `data:` URL.** Chrome ignores `--app` for `about:blank` (you get a normal toolbar window), but a `data:` URL yields a real app window that stays chromeless after navigating on to https.
- **Window geometry** via `Browser.getWindowForTarget` + `Browser.setWindowBounds` — runtime moves of already-open windows, no OS-level APIs. The work area is read back from the maximized window, so DPI never skews the math (verified at 150% scaling).
- **Fork** opens a new window in the **same browser context** → log in once, every window shares it.
- **The Fork button** is injected via `evaluateOnNewDocument` into its own Shadow DOM with a click-transparent host: Instagram's CSS/JS can't reach it, it can't block any Instagram UI, and the only thing read from the page is `location.href` when you click. rmux sends **no synthetic input events** for forking — a fork is just opening and navigating a new window.
- **Sound on by default.** Instagram starts every reel muted, and it only flips its persistent mute preference when its own speaker control is clicked (setting `video.muted` directly does not stick — the next reel re-mutes). So, once per window, the injected script clicks that control for you: reels play with sound and the next reel stays unmuted. It's a one-shot — after the nudge it stays out of the way, so a manual mute still sticks.
- **Anti-detection posture:** `--enable-automation` stripped, `navigator.webdriver` kept false (verified), no scraping, no DOM poking.

## Tests

```bash
npm test         # layout algorithm (the table above) + injection contract — no browser
npm run smoke    # full lifecycle against a local page: fork via the real bridge,
                 # tiling, close/reindex, all-closed path (opens real windows briefly)
```

## Dev tools

| Tool | Purpose |
|---|---|
| `npm run probe` | Verifies every CDP window-management assumption on this machine |
| `node tools/appmodecheck.mjs` | Confirms app-mode windows are chromeless, tileable, and openable via a forwarded `chrome --app` process |
| `node tools/autoplaycheck.mjs` | Checks whether audible autoplay is allowed (autoplay-policy flag) |
| `node tools/initcheck.mjs` | Which init-script mechanism actually runs on navigation |
| `node tools/geomcheck.mjs` | Characterises `setWindowBounds` ↔ `getWindowBounds` rounding |
| `node tools/wdcheck.mjs` | `navigator.webdriver` flag checks |
| `node tools/selftest.mjs 15` | Boots the real app against Instagram for 15 s, then shuts down |

## Known issues / notes

- No toolbar by design. Windows are chromeless app windows — there's no URL bar or tab strip to navigate with; move between reels by scrolling, fork, or close windows as usual.
- Windows adds **0–2 px** to requested window sizes (DPI/frame rounding). Edges are exact; adjacent windows may overlap by ~1 px. Imperceptible, intentionally not compensated.
- Chrome enforces a minimum window size (~500 px wide at 150% here) — only relevant at extreme window counts.
- The profile (and your login) lives in `./profile/` — delete it, or run `npm start -- --fresh`, to reset. Only one rmux instance can use a profile at a time.
- `RMUX_CHROME=/path/to/chrome` points rmux at another Chromium; `RMUX_PROFILE=/path/to/profile` at another profile.
- v1 tracks one page per window; extra tabs opened by hand aren't tracked.
- Single monitor. On Linux, native Wayland window positioning is not guaranteed (XWayland is fine); macOS untested.
- If the session log says the Fork button is missing, make sure you're on a reel page (`/reels/…` or `/reel/<code>`)—it stays hidden on login/other pages.
