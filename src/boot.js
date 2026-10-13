// Tiny loader so startup problems show up on screen instead of a blank page.
import { showErr } from './ui.js';
import './pwa.js';

addEventListener('error', (e) => showErr('Error: ' + (e.message || e.error) + '\n' + (e.filename || '') + ':' + (e.lineno || '')));
addEventListener('unhandledrejection', (e) => showErr('Error: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));

if (typeof window.THREE === 'undefined') {
  showErr('THREE failed to load.');
} else {
  import('./main.js').catch((e) => showErr('Startup error: ' + (e && e.message ? e.message : e) + '\n' + (e && e.stack ? e.stack : '')));
}
