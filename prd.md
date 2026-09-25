# rmux — Product Requirements Document

| | |
|---|---|
| **Product** | rmux — a "reels multiplexer" for Instagram |
| **Version** | v1.2 — chromeless app-mode windows + sound on by default (building on v1.1: persistent login, no auto-advance) |
| **Date** | 2025-09-25 |
| **Status** | MVP built & field-verified (2025-09-25) |
| **Platform** | Windows 10/11, single monitor — tiling verified at 150% display scaling |
| **Audience** | Personal tool (single user, accepts flakiness) |

---

## 1. Summary

**rmux** is a tool that turns watching Instagram Reels into a multiplexed, parallel experience — like tmux, but for short-form video.

You watch reels in a real, **chromeless** browser window (Chrome app mode: no tabs, no URL bar). When a reel is *semi-interesting* but you don't have the patience to sit through it, you click **Fork**. rmux opens a new chromeless window playing that exact reel from the start, while your original window stays exactly where it was. Each window is a fully independent session — it can scroll, fork further, and be closed at will. Windows tile themselves on screen according to a priority rule that always gives the oldest windows the best space.

Everything else — liking, commenting, scrolling comments, sound, autoplay — is **native Instagram** in a **real browser**. rmux adds exactly one thing to the page: a small "Fork" button.

---

## 2. Motivation (the origin story)

> I'm watching a reel in window 0. It's semi-interesting and I want to know how it ends, but I don't have the patience to sit there and watch it.
>
> So I split the session: window 0 moves on to the next reel, and window 1 opens playing reel 0 in the background.
>
> Now I have two sessions ongoing. I can keep watching both together, or close one.

*(v1.1 note: the source window no longer auto-advances — the first live session showed that moving the feed under the user was confusing. Fork is purely additive now.)*

The itch being scratched: **curiosity without patience**. Reels are linear, unskippable-without-losing-content, and infinite. rmux lets you bank interesting reels into parallel background sessions while the main feed keeps moving.

---

## 3. Concept & terminology

| Term | Meaning |
|---|---|
| **Window** | A real, top-level browser (Chromium) window controlled by rmux. Each window shows an Instagram Reels page and is a fully independent session. |
| **Session** | What the user experiences in one window: scrollable feed, forkable, closeable. Synonymous with "window" in v1. |
| **Fork** | The core action. Opens a new window at the URL of the reel currently playing in the source window. The reel plays from the start (timestamp resume is future work). The source window stays where it is — no auto-advance (v1.1). |
| **Index / priority** | Windows are numbered 0, 1, 2, … in creation order. Lower index = higher priority = better screen real estate. On any close, survivors are re-indexed to be contiguous (compact), starting at 0. |
| **Column** | A vertical full-height slice of the screen containing one or more windows stacked vertically. |
| **Branch / tree** | The conceptual model: forking creates a child session; closing a window ends its branch. There is **no merge/rejoin**. Operationally v1 tracks a flat ordered list (creation order = priority); the tree is semantics only — no parent-child metadata is tracked in v1. |
| **Tile / retile** | Recomputing and applying window geometry for all windows after any open/close. |

---

## 4. Core interaction model

### 4.1 First launch & login

1. User runs `npm start` in a terminal.
2. rmux launches **headful Chrome for Testing** (downloaded to `./browsers/` via `npm run install-browser`) in **app mode** — window 0 is **chromeless** (no tab strip, no URL bar) — with a **persistent profile** at `./profile/` (gitignored) — the login survives restarts. `npm start -- --fresh` wipes it.
3. Window 0 opens **maximized** at `https://www.instagram.com/reels/`.
4. The user logs in manually — once: the login lives in the persistent profile. rmux does **not** automate login; whatever Instagram throws (password, 2FA, CAPTCHA) is the user's to handle.
5. All windows share **one browser context**, so one login covers every window.

### 4.2 Watching & forking

1. On any reel page, a small **"Fork" button** floats at the bottom-left corner (hyperlink-preview style, like browsers show link URLs).
2. Clicking Fork:
   - Reads the current URL (`location.href` — verified live: the playing reel's URL is `instagram.com/reels/<shortcode>/`).
   - Opens a **new chromeless app window** at that URL. The reel plays from the start.
   - **Focus stays on the source window** (the new window is created, tiled, then the source is brought back to front).
   - The source window **stays exactly where it was** — no auto-advance (v1.1, field feedback: jumping the feed under the user was confusing).
3. The new window is itself a full session: it has its own Fork button, its own scroll-to-next-reel behavior, and can fork further. It is "a new window 0" of its own subtree.
4. Native interactions in every window: scroll, like, comment, scroll comments, mute/unmute — all work because these are real browser windows. Instagram starts every reel muted; rmux auto-unmutes **once per window** by clicking Instagram's own speaker control (its persistent mute preference only flips on that click), then stops — so a later manual mute is respected.

### 4.3 Switching focus

- **Mouse-first.** Click on any window to focus it (native OS behavior). No command bar, no global hotkeys, no keyboard commands in v1.

### 4.4 Closing & reflow

- Closing any window (native X button or Ctrl+W) ends that branch. **No merge/rejoin.**
- Survivors **re-index** to 0..N−1 in their original relative order, and the whole layout is **re-tiled**.
- If one window remains, it is **re-maximized**.
- If the last window closes, **rmux exits**.
- Ctrl+C in the terminal closes the browser and exits cleanly.

---

## 5. Layout & priority algorithm (spec)

**Invariants:**

1. Window 0 (lowest index) is always **leftmost, full height**.
2. Windows keep **maximum height** unless there is no other option.
3. Priority decreases left→right, then top→bottom: earlier windows always get *better* (left = wider-unopposed, top = higher) slots.
4. Number of columns is capped at **`MAX_COLUMNS = 3`** (tunable constant). Reels are portrait; desktop is landscape — 3 tall columns fit naturally, more do not.
5. N = 1 → the single window is **maximized**.

**Distribution rule (formal):**

```
C    = min(N, MAX_COLUMNS)
base = floor(N / C)
extra = N mod C
cnt(i) = base + (i >= C - extra ? 1 : 0)        # window count in column i (0-based)
start(i) = i*base + max(0, i - (C - extra))     # first window index in column i
```

- Column counts are as even as possible, **non-decreasing left→right** — the rightmost columns absorb overflow. (Left columns get fewer windows; window 0 stays alone longest.)
- Windows fill **column-major**: column 0 top→bottom, then column 1, etc. Within a column, lower index = higher row.

**Geometry (work area X, Y, W, H):**

```
left(i)  = X + round(i * W / C)
width(i) = round((i+1) * W / C) - round(i * W / C)
# within column i, window at local row r (0-based), column height count k:
top     = Y + round(r * H / k)
height  = round(H / k)        # last row absorbs the rounding remainder: Y + H − top
```

**Spec table (test cases — these are the unit tests):**

| N | Layout |
|---|--------|
| 1 | `0` (maximized) |
| 2 | `0 \| 1` |
| 3 | `0 \| 1 \| 2` |
| 4 | `0 \| 1 \| 2/3` |
| 5 | `0 \| 1/2 \| 3/4` |
| 6 | `0/1 \| 2/3 \| 4/5` |
| 7 | `0/1 \| 2/3 \| 4/5/6` |
| 8 | `0/1 \| 2/3/4 \| 5/6/7` |

(Columns separated by `\|`, stacked windows separated by `/`. Verified against the recurrence given by the product owner.)

**Example: close window 0 in state `0|1|2/3`** → survivors 1, 2, 3 re-index to 0, 1, 2 → N=3 → layout `0|1|2`, all full height.

**Mechanics:**

- Window movement is done **at runtime via Chrome DevTools Protocol** (`Browser.getWindowForTarget` + `Browser.setWindowBounds`) — see §8. This moves already-open windows; no native OS calls. Bounds are in DIP; the work area is read back from the maximized window, so units always cancel out.
- Before setting geometry, a window must be in `windowState: "normal"` (CDP requires a separate call to restore from maximized/minimized, then a second call with geometry).
- Retiling happens only on open/close events. If the user manually drags/resizes windows in between, rmux leaves them alone until the next event.
- Work area = bounds of the initial maximized window (read back via CDP) — implicitly excludes the taskbar, no extra dependencies. Verified on the dev machine at 150% scaling (readback `-7,-7 1722×1082` in DIP).
- **OS rounding (verified):** Windows/Chrome rounds reported window *sizes* by 0–2 px (DPI/frame rounding); *edges* (`left`/`top`) are exact. Adjacent windows may overlap by ~1 px. Imperceptible; deliberately not compensated.
- Re-tiling un-minimizes minimized windows (accepted v1 behavior).

---

## 6. Functional requirements

- **FR-1 Launch:** `npm start` launches headful Chrome with a fresh temp profile (`userDataDir` under `os.tmpdir()`), opens window 0 maximized at `https://www.instagram.com/reels/`.
- **FR-2 Login:** No automation. When a login page is detected in window 0, log a one-time hint: *"Log in — the Fork button appears on reel pages."*
- **FR-3 Button presence:** Fork button renders bottom-left in every rmux-tracked window, but **only on reel contexts** (`/reels` or `/reel/<code>/` path, host `instagram.com`). Hidden on login/other pages.
- **FR-4 Button isolation:** Button lives in its own **Shadow DOM**; host element has `pointer-events: none` (only the button itself is `pointer-events: auto`), `tabindex="-1"` (keyboard can't accidentally re-trigger it), and `z-index: 2147483647`. Instagram's styles and scripts cannot reach into it, and it does not block clicks anywhere else. (See §8.3 for the full isolation strategy.)
- **FR-5 Fork action:** Click → new top-level browser window in the **same browser context** (shared login/cookies) → that reel plays from the start → the new window receives its own Fork button. Forking from any window follows the same rule (recursion).
- **FR-6 Focus:** After a fork, focus returns to the source window (`page.bringToFront()` on the source after tiling). The new window must not end up holding focus.
- **FR-7 No auto-advance:** After a fork, the source window stays exactly where it was — nothing moves under the user. (Revised 2025-09-25 after field feedback. Consequence: rmux sends **no synthetic input events at all**.)
- **FR-8 Independence:** Every window is a complete session: scroll → next reel, fork → child session, native like/comment/etc.
- **FR-9 Priority tiling:** Layout follows §5 exactly. Retile on every open and close. N=1 → maximized.
- **FR-10 Close handling:** Native close (X / Ctrl+W) of a tracked window is detected; the window is removed, survivors re-index compactly, layout re-tiles. Last window closed → rmux exits (exit code 0).
- **FR-11 Shared session:** All windows share one browser context — login once, logged in everywhere. (Consequence: logging out in one window logs out everywhere. Accepted.)
- **FR-12 Native passthrough:** rmux automates nothing about Instagram interaction except the fork button, one synthetic scroll, and window geometry. Likes, comments, comment scrolling, sound — 100% native.
- **FR-13 Clean exit:** SIGINT (Ctrl+C) → close browser → exit. No orphaned Chrome.
- **FR-14 Logging:** Minimal, human-readable CLI output: window created/closed (`fork: #0 → #1 <url>`), layout changes (`layout: 3 cols, 5 windows`), errors. Enough to sanity-check behavior from the terminal.

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Platform | Windows 10/11, single monitor (verified at 150% scaling; tiling math is DPI-agnostic) |
| Runtime | Node.js ≥ 20, `puppeteer-core` driving Chrome for Testing 154 (downloaded to `./browsers/`) |
| Headful | Must be headful — real windows are the product. Headless is meaningless here. |
| Performance | Retile pass < 100 ms typical; no perceptible jank when forking |
| Resilience | Failure of one window's injection must not break others (per-page try/catch); synthetic-scroll failure degrades gracefully |
| Privacy/state | Login/cookies persist locally in `./profile/` (gitignored); nothing else stored; `--fresh` (or deleting the dir) resets |
| Network | Local only; no servers, no accounts, no telemetry |

---

## 8. Technical architecture

### 8.1 Components

```
┌─────────────────────────────── rmux (Node.js) ───────────────────────────────┐
│                                                                               │
│  main.js        entry: launch Chrome, wire everything, CLI logging, cleanup   │
│  windows.js     window registry [{index, targetId, windowId, page}],          │
│                 add / remove / reindex, lifecycle events                      │
│  tiler.js       pure layout math (computeLayout(N, workArea)) + applyLayout() │
│                 via CDP Browser.setWindowBounds                                │
│  inject.js      the Fork-button script injected into every tracked page       │
│  config.js      MAX_COLUMNS, REELS_URL, button label/style, chrome path       │
│                                                                               │
│        │ puppeteer-core (headful, fresh profile)        │ CDP (browser session)│
└────────┼───────────────────────────────────────────────┼───────────────────────┘
         │                                               │
   ┌─────┴─────┐  ┌─────┴─────┐                    Browser.getWindowForTarget
   │ Window #0 │  │ Window #1 │  …                  Browser.setWindowBounds
   │ (page +   │  │ (page +   │                     Target.* events (lifecycle)
   │ injected  │  │ injected  │
   │ button)   │  │ button)   │
   └───────────┘  └───────────┘
```

### 8.2 Window control — CDP

- `Browser.getWindowForTarget(targetId)` maps a page → its OS `windowId`. **Solves the handle problem exactly** — no title matching, no PID guessing. Page → target id via puppeteer's `Target._targetId` (verified identical to CDP's `targetInfo.targetId`).
- `Browser.setWindowBounds(windowId, bounds)` moves/resizes a **live** window. Cross-platform by construction (Chromium's own `BrowserWindow::SetBounds`), zero native dependencies, zero OS permissions. This is the same mechanism Selenium/chromedriver uses internally.
- Two-call sequence when un-maximizing: `{windowState: "normal"}` first, then `{left, top, width, height}`.
- Work area: read back the bounds of window 0 while maximized.
- Focus (verified): `setWindowBounds` does **not** steal focus; `page.bringToFront()` restores it after a fork.
- Bounds are in DIP (verified at 150% scaling). Because tiling is derived from the maximized readback, the units always cancel out.

### 8.3 Fork button injection & isolation

The button is the **only** thing rmux adds to the page, and it is built to never interact with Instagram's UI:

1. **Shadow DOM** (open shadow root): CSS in, CSS out — Instagram's styles cannot touch it, ours cannot leak. Instagram's DOM queries/scripts do not traverse into the shadow tree.
2. **Host element**: appended to `document.documentElement`, `position: fixed; left: 14px; bottom: 14px; z-index: 2147483647; pointer-events: none`. Since the host is click-transparent, it can never block clicks on reels or Instagram's own UI; only the button inside sets `pointer-events: auto`.
3. **Non-focusable**: `tabindex="-1"` and `blur()` after click, so a stray Space/Enter can never re-trigger it.
4. **SPA survival**: a watchdog interval (1s) re-appends the host if Instagram's SPA navigation orphans it, and toggles visibility based on the reel-page predicate (`/^\/reels?(\/|$)/` on `location.pathname` + instagram host). `evaluateOnNewDocument` re-installs the script on every navigation.
5. **Minimal touching of their tree**: rmux never mutates Instagram's nodes, never monkeypatches their code, never reads the feed DOM. The only things read are `location.href` at click time and, for the one-shot auto-unmute, Instagram's own `[aria-label="Adjust volume"]` speaker control (which rmux clicks once per window — see §9 D14).
6. **Channel back to Node**: `page.exposeFunction("__rmuxForkRequest", handler)` — the click handler calls `__rmuxForkRequest(location.href)`. (Obscure name to avoid collisions; persists across navigations automatically.)
7. **Injection timing**: new windows open at `about:blank` first; rmux attaches, installs `evaluateOnNewDocument` + `exposeFunction` *before* navigating to the reel URL — no race where the page loads uninstrumented. Note: raw CDP `Page.addScriptToEvaluateOnNewDocument` silently no-ops unless `Page.enable` ran first (verified in `tools/initcheck.mjs`); rmux uses puppeteer's `evaluateOnNewDocument`, which works and persists across navigations.

### 8.4 Creating new windows (the cookie trap — solved)

⚠️ **Trap:** `browser.createBrowserContext()` (the usual puppeteer way to get a new window) creates a **separate cookie jar** — each fork would be logged out. **Not acceptable.**

**Solution:** all windows live in the **default browser context** (shared session) **and in Chrome app mode** (chromeless). New windows are created by:

- **Primary:** spawn a short-lived second `chrome.exe --app=<data-url> --user-data-dir=<same>`. Chrome's process singleton forwards the command to the already-running browser, which opens a new chromeless app window in the default context; that window then appears on rmux's existing CDP connection, where rmux attaches, instruments, and navigates it.
- **Why not CDP `Target.createTarget({newWindow:true})`:** it always makes a *regular* toolbar window, and Chrome exposes **no CDP command** to create an app window.
- **Why a `data:` URL:** Chrome ignores `--app` for `about:blank` (you get a normal toolbar window), but a `data:` URL forces a real app window that stays chromeless after navigating on to https.
- **Fallback:** `window.open(url, "_blank", ...)` from the source page (same context; popup chrome may be minimal — acceptable as fallback).

Verified in `tools/appmodecheck.mjs`.

### 8.5 Lifecycle & close detection

- `browser.on("targetdestroyed")` (and `targetcrashed`) — when a tracked page's target dies, the window is treated as closed: remove → reindex → retile (or maximize survivor / exit if last).
- v1 assumption: the tracked page is the only tab in its window. (User-created extra tabs are out of scope — see §12.)
- Fork flow: validate URL (instagram reel context) → spawn forwarded `chrome --app=<data-url>` helper → attach to the new app window, map `windowId` → register (index N) → retile → instrument page → navigate to reel URL → `sourcePage.bringToFront()`. (Fork opens are serialised, since a new window is identified as "the page that was not there before".)
- New windows come from the forwarded `chrome --app` helper in the default browser context (verified: a real chromeless app window, no opener, same cookies as every other window).

---

## 9. Key decisions & rationale

| # | Decision | Rationale |
|---|---|---|
| D1 | Real browser windows (Option A), not local video capture | Faithful to the product: the forked reel is live Instagram — native scroll/like/comment all work; no fake replay. |
| D2 | CDP for window movement | Exact handle mapping, runtime moves, cross-platform, no native deps/permissions. |
| D3 | One browser context + app mode; new windows via a forwarded `chrome --app` helper | Shared login/cookies across all windows (avoids the per-context cookie-jar trap) **and** chromeless windows (no CDP API exists to make an app window, so a helper process asks the running browser for one). |
| D4 | Forked reel replays from the start | Instagram has no public deep-link for timestamps; MVP simplicity. (Future: inject `video.currentTime` resume.) |
| D5 | Shadow DOM + click-transparent host for the button | Complete UI isolation from Instagram, no click-stealing, survives SPA re-renders. |
| D6 | Focus stays on source after fork (`bringToFront`) | The origin story: the user keeps watching window 0; the fork plays in the background. |
| D7 | **No** auto-advance; the source stays put | Revised after the first live session: jumping the feed under the user was confusing. Fork is purely additive, and rmux sends zero synthetic input events. |
| D8 | No merge/rejoin; close = branch ends | Simplest honest tree semantics; matches the product owner's intent. |
| D9 | Flat index = creation order; compact re-index on close | Priority = seniority. "The lowest window sits leftmost." No tree bookkeeping needed in v1. |
| D10 | Column cap = 3, left-biased even distribution | Portrait content on landscape screens; product owner's recurrence (N≤6 shown, N≥7 derived and confirmed). |
| D11 | Persistent profile at `./profile/` (revision of the original throwaway-profile call) | Field feedback: re-logging in every run is friction. The login survives restarts; `--fresh` wipes on demand; tests use scratch profiles. |
| D12 | Mouse-only interactions in v1 | Everything is native OS/browser behavior; zero extra input machinery. |
| D13 | No selectors against Instagram's DOM | Their class names are hashed and volatile; we only read `location.href` and a simple path regex. Nothing to break. |
| D14 | One-shot auto-unmute by clicking Instagram's own speaker control | Instagram starts reels muted by design, and a raw `video.muted = false` does not update its persistent state (the next reel re-mutes). Only clicking its `[aria-label="Adjust volume"]` control flips that state, so the injected script does it once per window and then leaves it alone — sound by default, manual mute still respected. |
| D14 | Chrome for Testing (downloaded via `npm run install-browser`) instead of the system browser | No Chrome was installed on the dev machine (only Brave/Edge); CfT is pinned, reproducible, and shield-free. `RMUX_CHROME` overrides the path. |

---

## 10. Risks & mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Instagram anti-bot detection (injected DOM + CDP) → login walls, CAPTCHA, blocks | High | Med | Real Chrome for Testing build (not headless shell); strip `--enable-automation`; `navigator.webdriver` kept `false` via `--disable-blink-features=AutomationControlled` + JS override **(verified)**; **zero synthetic input** (a fork only opens/navigates a window), no scraping, no DOM poking; user handles whatever login throws; personal tool tolerates flakiness. |
| ~~Synthetic wheel doesn't advance the feed~~ | — | — | **Removed with auto-advance** (D7 revision): rmux no longer sends input events. |
| `Target.createTarget(newWindow:true)` behaves differently across Chrome versions | Med | Low | Spike in M0; fallback `window.open` with popup features (same context). |
| Window-size rounding / Chrome minimum size | Low | Certain | Windows adds 0–2 px to requested sizes and Chrome clamps very small windows; edges stay exact, and 3-column tiling never approaches the minimum. Accepted & documented (README). |
| Instagram changes reel URL patterns | Low | Low | Predicate is one regex in `config.js`; the only coupling point. |
| SPA navigation orphans the button | Low | High | Watchdog re-anchor + `evaluateOnNewDocument` (handled by design). |
| puppeteer-core / Chrome version skew | Med | Low | Pinned Chrome for Testing lives in `./browsers/`; reinstall with `npm run install-browser`. |
| Chrome crash / orphaned window on rmux crash | Low | Low | Temp profile is disposable; next launch just works. |
| Multiple reels playing audio simultaneously | Low | — | Native Instagram behavior: background windows autoplay muted; sound plays only where the user unmuted. This is the desired "peek" behavior — no action needed. |

---

## 11. Anti-detection posture (v1)

Principles: **minimum footprint, maximum nativeness.**

- The only page mutation is one shadow-DOM element appended to `documentElement` — no reads, no writes, no patching of Instagram's DOM or JS.
- rmux sends **no synthetic input events at all** — a fork is window management plus a navigation.
- Launch with `ignoreDefaultArgs: ["--enable-automation"]` (removes the "controlled by automated test software" infobar) plus `--disable-blink-features=AutomationControlled` and a JS `Navigator.prototype.webdriver` override — verified `navigator.webdriver === false` in the live window (repeatedly, across navigations).
- No rapid-fire actions, no scraping, no headless mode — usage patterns look human because they *are* human.
- Accept that Instagram may still push back (CAPTCHA, occasional logout). This is a personal tool; flakiness is tolerated. If it becomes a problem, hardening goes in M6 (not part of MVP scope).

---

## 12. Non-goals for v1

- ❌ Command bar / vim-style input (scrapped during design)
- ❌ Keyboard shortcuts, prefix keys, global hotkeys
- ❌ Like/comment automation (works natively — nothing to build)
- ❌ Timestamp-resume on fork (fork replays from start)
- ❌ Merge/rejoin of sessions
- ❌ Session persistence (detach/reattach across app restarts)
- ❌ Tree visualization or parent-child metadata
- ❌ User-created tabs inside windows (v1 tracks the window's primary page only)
- ❌ Multi-monitor, non-100% DPI, macOS, Linux (Wayland/X11)
- ❌ Multiple concurrent users, remote/pair watching
- ❌ Plugins, scripting, config file (constants live in `config.js` for now)
- ❌ Mobile

---

## 13. Future work (backlog, prioritized later)

1. **Timestamp resume** — read the player `<video>`'s `currentTime` at fork and seek the child to it (needs Instagram player internals; risky, low priority).
2. **Fork without advancing** — long-press / right-click on Fork = fork but keep watching the current reel.
3. **Window badges** — show each window's current index in a corner (needs a Node→page update channel).
4. **Command bar** — minimal bottom-left popup for power users (`:close 2`, `:focus 0`…).
5. **Keyboard-first mode** — tmux-style prefix key for fork/focus/close.
6. **Session persistence** — save/restore the window tree (`--profile` flag pair).
7. **Config file** — `~/.rmuxrc`: MAX_COLUMNS, button style/position, keybinds.
8. **Tree metadata & visualization** — track parent/child, show the tree.
9. **Tab tracking** — handle user-created tabs as addressable units.
10. **Cross-platform** — Linux (X11 first; Wayland positioning is a hard constraint per research), macOS (zero extra permissions needed with CDP).
11. **Multi-monitor** — place new windows on adjacent monitors, DPI-aware math.

---

## 14. Milestones & acceptance criteria

| # | Milestone | Gate (acceptance) |

**Status (2025-09-25):** M0–M5 complete — verified by unit tests, the lifecycle smoke test, and a real logged-in session (4 windows; layouts `0\|1` → `0\|1\|2` → `0\|1\|2/3`; close → reindex → retile → re-maximize; clean exit). **v1.1 revision:** persistent profile + auto-advance removed (user feedback). **v1.2 revision:** chromeless app-mode windows (`--app`) and one-shot auto-unmute — both verified live (window chrome 24px vs ~90px for a normal window; window 0 and a forked window both end up `muted:false` with no interaction). M6 (docs/hardening) in progress.
|---|---|---|
| **M0** | CDP window-control spike (from research doc §Next steps) | On this Windows machine: launch headful Chrome, open 2 pages, map both to `windowId`s, tile them, move them again at runtime, read back bounds. `Target.createTarget(newWindow:true)` verified to open a full-chrome window in the default context. |
| **M1** | App skeleton | `npm start` → real Chrome window at `/reels/` (maximized), login works, Ctrl+C cleans up, no infobar, no orphan processes. |
| **M2** | Button injection | Button visible bottom-left on reel pages, hidden on login, survives SPA navigation, click logs the current URL to the terminal, Instagram UI unaffected (clicks pass through everywhere but the button). |
| **M3** | Fork v1 | The origin story, literally: click Fork → window #1 opens tiled right playing that reel from start, window #0 keeps focus and advances. 2-up layout correct. |
| **M4** | Full tiling & lifecycle | Layouts for N=1..8 match the §5 spec table. Closing any window re-indexes + retiles; last survivor maximizes; last close exits. `targetdestroyed` handling solid. |
| **M5** | Polish | Auto-advance verified (or gracefully degraded), button aesthetics finalized, error handling (fork with bad URL = log, no-op), focus behavior flicker-free, CLI logs useful. |
| **M6** | Hardening & docs | Anti-detection pass as needed; README (quickstart, controls, layout rules, troubleshooting), known-issues list. |

---

## 15. MVP definition of done

> **With one command I get a maximized Chrome window logged in to Instagram Reels. I click Fork on a reel and a second window opens, tiled to the right, playing that reel from the start, while my original window advances to the next reel. Both windows scroll, fork, like, and comment independently — natively. Closing any window retiles the rest by priority (lowest index leftmost, max height); closing all exits the app. It runs on my Windows machine and tolerates Instagram's occasional pushback.**

---

## 16. Repo structure

```
E:/projects/rmux/
├── prd.md                        # this document
├── README.md                     # quickstart, layout rules, known issues
├── src/
│   ├── main.js                   # CLI entry, signals, fatal handling
│   ├── rmux.js                   # orchestrator: lifecycle, fork pipeline, close/reindex, retile
│   ├── windows.js                # ordered registry (index = priority, compact reindex)
│   ├── tiler.js                  # computeLayout() (pure) + applyLayout() (CDP)
│   ├── inject.page.js            # page-side Fork button (template, shadow DOM)
│   ├── inject.js                 # template → source (shared bridge name + reel regex)
│   └── config.js                 # constants, URL predicates, Chrome resolution
├── test/
│   ├── tiler.test.js             # layout spec table + geometry invariants
│   ├── inject.test.js            # injection contract + URL predicates
│   └── lifecycle.smoke.js        # real-browser end-to-end (npm run smoke)
├── tools/
│   ├── probe.mjs                 # M0 CDP window-control verification
│   ├── appmodecheck.mjs          # app-mode window chromelessness / tiling / forwarding
│   ├── initcheck.mjs             # init-script mechanism isolation
│   ├── geomcheck.mjs             # set/getWindowBounds rounding characterisation
│   ├── wdcheck.mjs               # navigator.webdriver flag checks
│   └── selftest.mjs              # boot the real app against Instagram, then exit
├── browsers/                     # Chrome for Testing (gitignored, npm run install-browser)
├── logs/                         # background session logs (gitignored)
└── package.json                  # puppeteer-core + @puppeteer/browsers; scripts: start/test/smoke/probe
```

---

## 17. Open questions — resolved

All original questions were answered by the M0 spike, the isolated checks in `tools/`, and the first live session:

1. **`Target.createTarget({newWindow: true})`** → opens a real full Chrome window in the default browser context, no opener (verified) — but it carries a toolbar. For chromeless windows rmux instead forwards `chrome --app=<data-url>` to the running browser (verified in `tools/appmodecheck.mjs`).
2. **Synthetic `mouse.wheel`** → accepted in live use; if Instagram ever ignores a step, the user scrolls manually — the fork itself is unaffected.
3. **Reel URLs** → live Instagram uses `instagram.com/reels/<shortcode>/` (plural) for the playing reel; the predicate accepts `/reels[/…]` and `/reel/<code>`.
4. **Button aesthetics** → field-approved on the first session; label/pill/hover as designed.
5. **Fork window appearance** → the window is created at a `data:` URL (app mode), tiled, then navigated; no flash or focus-steal issues observed, and no toolbar ever appears.
6. **Maximize→normal→geometry flicker** → no observable flicker in practice.

Auto-advance was implemented and observed in the first live session, and then **removed by product decision** (v1.1): the feed jumping under the user was confusing. Fork is now purely additive — and rmux no longer sends any synthetic input.

---

## Appendix A — Field verification (2025-09-25)

First real logged-in session (fresh profile, Chrome for Testing 154). Window #0 forked → #1 → (from #1) #2 → (from #2) #3, then the user closed windows one by one:

```
[rmux] fork: #0 → #1  https://www.instagram.com/reels/<shortcode-A>/
[rmux] layout (2): 0 | 1
[rmux] fork: #1 → #2  https://www.instagram.com/reels/<shortcode-A>/
[rmux] layout (3): 0 | 1 | 2
[rmux] fork: #2 → #3  https://www.instagram.com/reels/<shortcode-B>/
[rmux] layout (4): 0 | 1 | 2/3
[rmux] close: #0 (3 windows left)
[rmux] layout (3): 0 | 1 | 2
[rmux] close: #0 (2 windows left)
[rmux] layout (2): 0 | 1
[rmux] close: #0 (1 window left)
[rmux] layout (1): 0
[rmux] close: #0 (0 windows left)
[rmux] shutting down (all windows closed)
```

Confirmed live: the Fork button on real reels; the current reel's URL captured correctly; new windows tiled and playing that reel; the full priority layout ladder through `0 | 1 | 2/3`; compact re-indexing on every close; re-maximize on the last survivor; clean shutdown (zero orphaned Chrome processes).

**Post-session revisions (v1.1):** auto-advance removed (confusing jump); profile switched from throwaway-temp to persistent `./profile/` (login survives restarts; `--fresh` resets).
