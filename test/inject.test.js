// Injection template + URL predicate tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInjectionSource } from '../src/inject.js';
import { FORK_BRIDGE, REEL_PATH_RE, isLoginUrl, isReelUrl } from '../src/config.js';

test('injection source resolves all placeholders and parses as JavaScript', () => {
  const source = buildInjectionSource();
  assert.ok(source.includes(FORK_BRIDGE), 'bridge name substituted');
  assert.ok(!source.includes('__FORK_BRIDGE__'), 'no bridge placeholder left');
  assert.ok(!source.includes('__REEL_PATH_SOURCE__'), 'no regex placeholder left');
  assert.ok(source.includes(JSON.stringify(REEL_PATH_RE.source)), 'regex source substituted');
  assert.ok(source.includes('__rmux_fork_host'), 'host id present');
  // Throws on syntax error — guards against a broken template.
  new Function(source);
});

test('injection is isolated (shadow dom, click-transparent host, non-focusable)', () => {
  const source = buildInjectionSource();
  assert.ok(source.includes("attachShadow({ mode: 'open' })"), 'shadow root');
  assert.ok(/pointerEvents:\s*'none'/.test(source), 'host click-transparent');
  assert.ok(/pointerEvents:\s*'auto'/.test(source), 'button clickable');
  assert.ok(source.includes('btn.tabIndex = -1'), 'not tab-reachable');
  assert.ok(source.includes('blur()'), 'blurs after click');
  assert.ok(source.includes('stopImmediatePropagation'), 'click cannot leak to Instagram');
  assert.ok(source.includes('2147483647'), 'top z-index');
  assert.ok(source.includes("Object.defineProperty(Navigator.prototype, 'webdriver'"), 'webdriver override');
});

test('isReelUrl accepts reel contexts only', () => {
  const yes = [
    'https://www.instagram.com/reels/',
    'https://www.instagram.com/reels',
    'https://www.instagram.com/reel/ABC123xyz/',
    'https://instagram.com/reel/ABC123xyz/',
    'https://www.instagram.com/reel/ABC123xyz/?hl=en',
  ];
  const no = [
    'https://www.instagram.com/',
    'https://www.instagram.com/explore/',
    'https://www.instagram.com/direct/inbox/',
    'https://www.instagram.com/reel',
    'https://evil-instagram.com/reel/ABC/',
    'https://www.instagram.com.evil.com/reel/ABC/',
    'not a url',
    '',
  ];
  for (const url of yes) assert.equal(isReelUrl(url), true, `should accept ${url}`);
  for (const url of no) assert.equal(isReelUrl(url), false, `should reject ${url}`);
});

test('isLoginUrl spots login/checkpoint pages', () => {
  assert.equal(isLoginUrl('https://www.instagram.com/accounts/login/?next=%2Freels%2F'), true);
  assert.equal(isLoginUrl('https://www.instagram.com/accounts/emailsignup/'), true);
  assert.equal(isLoginUrl('https://www.instagram.com/challenge/abc/'), true);
  assert.equal(isLoginUrl('https://www.instagram.com/reels/'), false);
  assert.equal(isLoginUrl('https://www.instagram.com/'), false);
});
