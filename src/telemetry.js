// Sends browser errors to the game server's log (POST /clienterr), so a crash on someone's phone isn't invisible.
// Only the message, the build id and the browser name are sent: no account, no chat, no IP stored.
import { endpoints } from './config.js';

const seen = new Set();
let sent = 0;
const build = () => { const m = (document.querySelector('script[src*="boot.js"]') || {}).src; return m && /[?&]v=(\w+)/.test(m) ? RegExp.$1 : '?'; };

export function reportError(msg) {
  try {
    msg = String(msg || '').slice(0, 500);
    if (!msg || seen.has(msg) || sent >= 5) return; // each distinct error once, at most 5 per page load
    seen.add(msg); sent++;
    const body = JSON.stringify({ m: msg, v: build(), ua: navigator.userAgent.slice(0, 100) });
    const url = endpoints().http + '/clienterr';
    if (!(navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' })))) {
      fetch(url, { method: 'POST', body, keepalive: true, mode: 'cors', headers: { 'content-type': 'text/plain' } }).catch(() => {});
    }
  } catch { /* reporting must never cause an error itself */ }
}
