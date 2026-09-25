// rmux fork button — injected into every page rmux tracks.
//
// Isolation contract (prd.md §8.3):
//  - lives in its own shadow DOM; Instagram CSS/JS cannot reach it
//  - the host is click-transparent (pointer-events:none); only the button is
//    clickable, so Instagram's UI is never blocked
//  - the only DOM mutation is appending the host to <html>
//  - the only thing read from Instagram is location.href, on click
//  - non-focusable (tabindex=-1 + blur on click): Space/Enter can never
//    re-trigger it
//  - a watchdog re-anchors the host through SPA navigations and hides the
//    button outside reel pages
(() => {
  'use strict';

  const BRIDGE = "__FORK_BRIDGE__";
  const REEL_RE = new RegExp("__REEL_PATH_SOURCE__");
  const HOST_ID = '__rmux_fork_host';
  const LABEL = 'Fork';

  // Belt and braces: keep the automation flag off the page's radar.
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
  } catch (e) { /* ignore */ }

  let host = null;
  let btn = null;

  const isReelPage = () => {
    try {
      return /(^|\.)instagram\.com$/.test(location.hostname) && REEL_RE.test(location.pathname);
    } catch (e) {
      return false;
    }
  };

  const style = (el, props) => {
    for (const k in props) {
      try { el.style[k] = props[k]; } catch (e) { /* ignore */ }
    }
  };

  function setLabel(text) {
    if (btn) btn.textContent = text;
  }

  function pulse(text) {
    setLabel(text);
    setTimeout(() => setLabel(LABEL), 1100);
  }

  function onClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    if (btn) btn.blur();
    if (!btn || btn.disabled) return;

    const bridge = window[BRIDGE];
    if (typeof bridge !== 'function') {
      pulse('Unavailable');
      return;
    }

    btn.disabled = true;
    setLabel('Forking…');
    Promise.resolve()
      .then(() => bridge(String(location.href)))
      .then((res) => setLabel(res === 'ok' ? 'Forked ✓' : res === 'ignored' ? 'Ignored' : 'Failed'))
      .catch(() => setLabel('Failed'))
      .finally(() => {
        setTimeout(() => {
          setLabel(LABEL);
          if (btn) btn.disabled = false;
        }, 1100);
      });
  }

  function build() {
    host = document.createElement('div');
    host.id = HOST_ID;
    style(host, {
      position: 'fixed', left: '14px', bottom: '14px', zIndex: '2147483647',
      pointerEvents: 'none', margin: '0', padding: '0', border: '0',
      background: 'transparent', width: 'auto', height: 'auto', lineHeight: '0',
    });

    const root = host.attachShadow({ mode: 'open' });
    btn = document.createElement('button');
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.textContent = LABEL;
    btn.title = 'Fork this reel into a new window';
    style(btn, {
      pointerEvents: 'auto', cursor: 'pointer', border: '0', margin: '0',
      borderRadius: '999px', padding: '7px 13px',
      background: 'rgba(0,0,0,0.62)', color: '#ffffff',
      font: '600 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      letterSpacing: '0.02em', boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
      opacity: '0.85', outline: 'none', display: 'block', minWidth: '0',
      userSelect: 'none', webkitUserSelect: 'none',
      transition: 'background 120ms ease, opacity 120ms ease, transform 80ms ease',
    });

    btn.addEventListener('mouseenter', () => {
      if (!btn.disabled) style(btn, { background: 'rgba(0,0,0,0.85)', opacity: '1' });
    });
    btn.addEventListener('mouseleave', () => {
      style(btn, { background: 'rgba(0,0,0,0.62)', opacity: '0.85' });
    });
    btn.addEventListener('mousedown', () => style(btn, { transform: 'scale(0.97)' }));
    btn.addEventListener('mouseup', () => style(btn, { transform: 'scale(1)' }));
    btn.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    btn.addEventListener('click', onClick, true);

    root.appendChild(btn);
  }

  function ensure() {
    try {
      if (!host) build();
      const parent = document.documentElement || document.body;
      if (parent && !host.isConnected) parent.appendChild(host);
      if (host) host.style.display = isReelPage() ? 'block' : 'none';
    } catch (e) { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensure, { once: true });
  }
  ensure();
  setInterval(ensure, 1000);
})();
