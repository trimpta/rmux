// rmux orchestrator: browser lifecycle, window registry, fork pipeline, tiling.
// See prd.md §8 for the architecture this implements.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import {
  APP_WINDOW_URL,
  CHROME_ARGS,
  DEFAULT_TIMEOUT_MS,
  FORK_BRIDGE,
  START_URL,
  isLoginUrl,
  isReelUrl,
  resolveChromeExecutable,
  resolveProfileDir,
} from './config.js';
import { buildInjectionSource } from './inject.js';
import { applyLayout, computeLayout, formatLayout } from './tiler.js';
import { WindowRegistry } from './windows.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Puppeteer's Target does not expose its id publicly; _targetId is the value
// verified (tools/probe.mjs) to match CDP's targetInfo.targetId exactly.
const targetIdOf = (target) =>
  target?._targetId ?? (typeof target?.targetId === 'function' ? target.targetId() : undefined);

async function getTargetId(page) {
  const id = targetIdOf(page.target());
  if (id) return id;
  const session = await page.createCDPSession();
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    return targetInfo.targetId;
  } finally {
    await session.detach().catch(() => {});
  }
}

const safeUrl = (href) => {
  try {
    return new URL(String(href));
  } catch {
    return null;
  }
};

export class RmuxApp {
  constructor(opts = {}) {
    this.opts = {
      startUrl: START_URL,
      urlFilter: isReelUrl,
      keepAliveOnAllClosed: false,
      exitOnShutdown: true,
      quiet: false,
      profileDir: null,
      freshProfile: false,
      ...opts,
    };

    this.registry = new WindowRegistry();
    this.browser = null;
    this.browserSession = null;
    this.workArea = null;
    this.profileDir = null;

    this._shutdown = false;
    this._retileRunning = null;
    this._retileQueued = false;
    this._allClosed = new Promise((resolve) => {
      this._allClosedResolve = resolve;
    });
    this._instrumented = new WeakSet();
    this._injectionSource = buildInjectionSource();
    this._loginHinted = false;
    this._openWindowChain = Promise.resolve();
  }

  log(...args) {
    if (!this.opts.quiet) console.log('[rmux]', ...args);
  }

  warn(...args) {
    console.warn('[rmux]', ...args);
  }

  /** Resolves when the last tracked window has closed. */
  waitForAllClosed() {
    return this._allClosed;
  }

  // ---------------------------------------------------------------- startup

  async start() {
    const executablePath = resolveChromeExecutable();
    this.profileDir = this.opts.profileDir || resolveProfileDir();
    const hadProfile = existsSync(join(this.profileDir, 'Default'));
    if (this.opts.freshProfile) {
      try {
        rmSync(this.profileDir, { recursive: true, force: true });
      } catch (err) {
        this.warn(`could not wipe profile (${err.message}) — continuing with the existing one`);
      }
    }
    mkdirSync(this.profileDir, { recursive: true });

    try {
      this.browser = await puppeteer.launch({
        executablePath,
        headless: false,
        userDataDir: this.profileDir,
        defaultViewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
        // --app opens window 0 chromeless (no tab strip / omnibox), like a PWA.
        args: [...CHROME_ARGS, `--app=${APP_WINDOW_URL}`],
      });
    } catch (err) {
      const hint = existsSync(join(this.profileDir, 'SingletonLock'))
        ? `\nThe profile at "${this.profileDir}" looks locked — is another rmux instance (or Chrome using that profile) running?`
        : '';
      throw new Error(`failed to launch Chrome: ${err.message}${hint}`);
    }
    this.log(`Chrome ${await this.browser.version()} launched`);
    this.log(
      `profile: ${this.profileDir} (${
        this.opts.freshProfile
          ? 'wiped (--fresh)'
          : hadProfile
            ? 'persistent — the login is kept here'
            : 'new — log in once, it persists'
      })`,
    );
    this.browserSession = await this.browser.target().createCDPSession();

    this.browser.on('targetdestroyed', (target) => this._handleTargetDestroyed(target));
    this.browser.on('targetcrashed', (target) =>
      this.warn(`renderer crashed (${targetIdOf(target) || 'unknown target'})`),
    );
    this.browser.on('disconnected', () => this._handleDisconnected());

    const pages = await this.browser.pages();
    if (!pages.length) throw new Error('no initial page after launch');

    const win0 = await this._registerPage(pages[0]);
    this.workArea = await this._determineWorkArea(win0);
    this.log(
      `work area ${this.workArea.width}×${this.workArea.height} at ` +
        `(${this.workArea.x},${this.workArea.y}) via ${this.workArea.source}`,
    );

    await this._instrumentPage(win0.page);
    await this._retile();

    if (this.opts.startUrl && this.opts.startUrl !== 'about:blank') {
      this.log(`window #0 → ${this.opts.startUrl}`);
      await win0.page
        .goto(this.opts.startUrl, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS })
        .catch((err) => this.warn(`initial navigation: ${err.message}`));
    }

    this.log('ready — click "Fork" on a reel to open a background session');
    return this;
  }

  /**
   * Maximized-window bounds are, by construction, in the same coordinate space
   * as Browser.setWindowBounds — units cancel out (verified at 150% scaling).
   */
  async _determineWorkArea(win) {
    try {
      await this.browserSession.send('Browser.setWindowBounds', {
        windowId: win.windowId,
        bounds: { windowState: 'maximized' },
      });
      for (let i = 0; i < 20; i++) {
        const { bounds } = await this.browserSession.send('Browser.getWindowBounds', {
          windowId: win.windowId,
        });
        if (bounds.windowState === 'maximized' && bounds.width > 0 && bounds.height > 0) {
          return {
            x: Math.round(bounds.left ?? 0),
            y: Math.round(bounds.top ?? 0),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
            source: 'maximized window bounds',
          };
        }
        await sleep(150);
      }
      this.warn('work area: maximized bounds never settled');
    } catch (err) {
      this.warn(`work area via window bounds failed: ${err.message}`);
    }

    const screen = await win.page.evaluate(() => ({
      x: screen.availLeft || 0,
      y: screen.availTop || 0,
      width: screen.availWidth,
      height: screen.availHeight,
    }));
    return { ...screen, source: 'screen API (fallback)' };
  }

  // ----------------------------------------------------------- registration

  async _registerPage(page) {
    const targetId = await getTargetId(page);
    if (!targetId) throw new Error('could not determine page target id');
    const { windowId } = await this.browserSession.send('Browser.getWindowForTarget', { targetId });
    if (!windowId) throw new Error('could not resolve the OS window for the page');
    return this.registry.add({ page, targetId, windowId });
  }

  async _instrumentPage(page) {
    if (this._instrumented.has(page)) return;
    this._instrumented.add(page);

    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const href = frame.url();
      if (!this._loginHinted && isLoginUrl(href)) {
        this._loginHinted = true;
        this.log('Instagram wants a login/checkpoint — complete it there; the Fork button appears on reel pages.');
      }
    });

    // Persists across navigations (verified in tools/initcheck.mjs).
    await page.evaluateOnNewDocument(this._injectionSource);
    await page.exposeFunction(FORK_BRIDGE, (href) => this._handleForkRequest(page, href));
    // Cover the document that already exists (e.g. about:blank).
    await page.evaluate(this._injectionSource).catch(() => {});
  }

  // ---------------------------------------------------------------- forking

  /**
   * Opens a new top-level *app* window (chromeless) in the SAME browser
   * process — and therefore the same context, so the login is shared.
   *
   * Chrome exposes no CDP command for an app-mode window, and
   * Target.createTarget always makes a regular toolbar window. Instead we run a
   * second chrome.exe pointed at the same --user-data-dir: Chrome's process
   * singleton forwards the --app URL to the running browser, and the new window
   * appears on our existing CDP connection (verified in tools/appmodecheck.mjs).
   *
   * Because a new window is identified by "a page that was not there before",
   * concurrent opens must not overlap — they are serialised.
   */
  _openWindow() {
    const run = this._openWindowChain.then(() => this._openWindowOnce());
    this._openWindowChain = run.catch(() => {});
    return run;
  }

  async _openWindowOnce() {
    const before = new Set(await this.browser.pages());
    this._spawnAppWindow();

    const deadline = Date.now() + 15_000;
    let page = null;
    while (!page && Date.now() < deadline) {
      page = (await this.browser.pages()).find((p) => !before.has(p));
      if (!page) await sleep(150);
    }
    if (!page) throw new Error('the forked window never appeared');

    const win = await this._registerPage(page);
    return { win, page };
  }

  /**
   * Fires the short-lived helper process that asks the running browser for a new
   * app window. It exits immediately after forwarding; the window it produces is
   * our real target. No --remote-debugging-port: it must NOT start its own browser.
   */
  _spawnAppWindow() {
    const child = spawn(
      resolveChromeExecutable(),
      [
        `--app=${APP_WINDOW_URL}`,
        `--user-data-dir=${this.profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
  }

  /**
   * The fork pipeline (prd.md §8.5): open → map → register → retile →
   * instrument → navigate → refocus source.
   */
  async _handleForkRequest(sourcePage, href) {
    if (this._shutdown) return 'ignored';

    const url = safeUrl(href);
    if (!url || !this.opts.urlFilter(url.href)) {
      this.warn(`fork ignored (not a reel url): ${String(href).slice(0, 140)}`);
      return 'ignored';
    }

    const sourceWin = this.registry.find((w) => w.page === sourcePage);
    let created = null;

    try {
      created = await this._openWindow();
      this.log(`fork: #${sourceWin ? sourceWin.index : '?'} → #${created.win.index}  ${url.href}`);

      await this._scheduleRetile();
      await this._instrumentPage(created.page);
      await created.page
        .goto(url.href, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS })
        .catch((err) => this.warn(`window #${created.win.index} navigation: ${err.message}`));

      await sourcePage.bringToFront().catch(() => {});
      return 'ok';
    } catch (err) {
      this.warn(`fork failed: ${err.message}`);
      if (created?.page) await created.page.close().catch(() => {});
      return 'error';
    }
  }

  // --------------------------------------------------------------- tiling

  _scheduleRetile() {
    this._retileQueued = true;
    if (this._retileRunning) return this._retileRunning;

    this._retileRunning = (async () => {
      try {
        while (this._retileQueued && !this._shutdown) {
          this._retileQueued = false;
          await this._retile().catch((err) => this.warn(`retile: ${err.message}`));
        }
      } finally {
        this._retileRunning = null;
      }
    })();
    return this._retileRunning;
  }

  async _retile() {
    const windows = this.registry.all;
    if (!windows.length || !this.workArea || !this.browserSession || this._shutdown) return;
    const layout = computeLayout(windows.length, this.workArea);
    await applyLayout(this.browserSession, windows, layout, (msg) => this.warn(msg));
    this.log(`layout (${windows.length}): ${formatLayout(layout)}`);
  }

  // ------------------------------------------------------------- lifecycle

  _handleTargetDestroyed(target) {
    const targetId = targetIdOf(target);
    if (!targetId) return;

    const win = this.registry.find((w) => w.targetId === targetId);
    if (!win) return;

    const index = win.index;
    this.registry.removeByTargetId(targetId);
    if (this._shutdown) return;

    const left = this.registry.count;
    this.log(`close: #${index} (${left} window${left === 1 ? '' : 's'} left)`);

    if (left === 0) {
      this._allClosedResolve?.();
      if (!this.opts.keepAliveOnAllClosed) this.shutdown('all windows closed').catch(() => {});
    } else {
      this._scheduleRetile();
    }
  }

  async shutdown(reason = 'shutdown') {
    if (this._shutdown) return;
    this._shutdown = true;
    this.log(`shutting down (${reason})`);

    try {
      // Chrome normally exits on its own when the last window closes; talking to
      // an already-dead connection would otherwise stall for the full grace
      // period, which reads as "the process is still running".
      if (this.browser?.connected) {
        await Promise.race([this.browser.close().catch(() => {}), sleep(1500)]);
      }
      this.browser?.process()?.kill();
    } catch {
      /* ignore */
    }

    if (this.opts.exitOnShutdown) process.exit(0);
  }

  _handleDisconnected() {
    if (this._shutdown) return;
    this._shutdown = true;
    this.log('browser closed');
    this._allClosedResolve?.();
    if (this.opts.exitOnShutdown) process.exit(0);
  }
}
