// Boots the real app against Instagram for a few seconds, prints state, and
// shuts down cleanly. Run: node tools/selftest.mjs [seconds]
import { RmuxApp } from '../src/rmux.js';

const seconds = Number(process.argv[2] || 12);
const app = new RmuxApp({ exitOnShutdown: false });

await app.start();
const w0 = app.registry.all[0];

console.log('[selftest] window #0 url:', w0.page.url());
console.log(
  '[selftest] fork host present:',
  await w0.page.evaluate(() => !!document.getElementById('__rmux_fork_host')).catch((e) => `err: ${e.message}`),
);
console.log(
  '[selftest] navigator.webdriver:',
  await w0.page.evaluate(() => navigator.webdriver).catch((e) => `err: ${e.message}`),
);
console.log(
  '[selftest] browser chrome above page (px):',
  await w0.page
    .evaluate(() => Math.round(window.outerHeight - window.innerHeight))
    .catch((e) => `err: ${e.message}`),
  '(chromeless app window should be ~35-40, a normal toolbar window ~90+)',
);

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
console.log('[selftest] final url:', w0.page.url());
await app.shutdown('selftest done');
console.log('[selftest] clean shutdown');
