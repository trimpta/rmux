// Builds the page-side injection source from the template, substituting the
// shared bridge name and reel-path regex so Node and the page cannot drift.
import { readFileSync } from 'node:fs';
import { FORK_BRIDGE, REEL_PATH_RE } from './config.js';

const TEMPLATE = readFileSync(new URL('./inject.page.js', import.meta.url), 'utf8');

export function buildInjectionSource() {
  const source = TEMPLATE
    .replace('"__FORK_BRIDGE__"', JSON.stringify(FORK_BRIDGE))
    .replace('"__REEL_PATH_SOURCE__"', JSON.stringify(REEL_PATH_RE.source));
  if (source.includes('__FORK_BRIDGE__') || source.includes('__REEL_PATH_SOURCE__')) {
    throw new Error('inject.page.js: unresolved placeholder — template changed?');
  }
  return source;
}
