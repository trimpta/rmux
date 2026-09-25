#!/usr/bin/env node
// rmux CLI entry point.
import { APP_NAME } from './config.js';
import { RmuxApp } from './rmux.js';

const freshProfile = process.argv.includes('--fresh');
const app = new RmuxApp({ freshProfile });
let signalled = false;

const handleSignal = (signal) => {
  if (signalled) return;
  signalled = true;
  app.shutdown(signal).catch(() => process.exit(0));
};

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

// A misbehaving click handler must never take down the whole app.
process.on('uncaughtException', (err) => console.error(`[${APP_NAME}] uncaught:`, err));
process.on('unhandledRejection', (err) => console.error(`[${APP_NAME}] unhandled rejection:`, err));

console.log(`[${APP_NAME}] starting${freshProfile ? ' (fresh profile)' : ''}…`);
app.start().catch((err) => {
  console.error(`[${APP_NAME}] fatal:`, err?.message || err);
  process.exit(1);
});
