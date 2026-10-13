// Tiny loader so startup problems show up on screen instead of a blank page.
import { showErr } from './ui.js';
import './pwa.js';
import { reportError } from './telemetry.js';

addEventListener('error', (e) => {
  showErr('Error: ' + (e.message || e.error) + '\n' + (e.filename || '') + ':' + (e.lineno || ''));
  reportError((e.message || e.error) + ' @ ' + String(e.filename || '').split('/').slice(-2).join('/') + ':' + (e.lineno || ''));
});
addEventListener('unhandledrejection', (e) => {
  const m = e.reason && e.reason.message ? e.reason.message : e.reason;
  showErr('Error: ' + m);
  reportError('unhandled: ' + m);
});

if (typeof window.THREE === 'undefined') {
  showErr('THREE failed to load.');
  reportError('THREE failed to load');
} else {
  import('./main.js').catch((e) => { showErr('Startup error: ' + (e && e.message ? e.message : e) + '\n' + (e && e.stack ? e.stack : '')); reportError('startup: ' + (e && e.message ? e.message : e)); });
}
