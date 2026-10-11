// WebSocket transport: connect (waking a sleeping free host if needed), reconnect
// with back-off, and a tiny message bus.  Game logic lives elsewhere.
import { endpoints } from './config.js';
import { S } from './state.js';
import { showBoot, hideBoot } from './ui.js';

const handlers = {};
let ws = null;
let stopped = false;

export function on(type, fn) {
  (handlers[type] || (handlers[type] = [])).push(fn);
}
function emit(type, msg) {
  (handlers[type] || []).forEach((fn) => {
    try { fn(msg); } catch (e) { console.error('handler for', type, 'failed:', e); }
  });
}

export function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

export function stop() {
  stopped = true;
  if (ws) try { ws.close(); } catch { /* ignore */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Free hosts sleep when idle; the first request wakes them and can take ~30-60 s.
// Poke /health until it answers so we can show a real status instead of a frozen page.
async function warmUp(http, attempt) {
  const t0 = Date.now();
  let done = false;
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    if (s >= 3) {
      showBoot(
        attempt ? 'Reconnecting…' : 'Waking the server…',
        'The free host sleeps when nobody is playing. This can take up to a minute — ' + s + 's',
      );
    }
  }, 500);
  showBoot(attempt ? 'Reconnecting…' : 'Connecting…');
  try {
    while (!done && !stopped) {
      const ctl = new AbortController();
      const kill = setTimeout(() => ctl.abort(), 20000);
      try {
        await fetch(http + '/health', { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
        done = true;
      } catch {
        await sleep(1500);
        if (Date.now() - t0 > 120000) break; // give the socket a go anyway
      } finally {
        clearTimeout(kill);
      }
    }
  } finally {
    clearInterval(tick);
  }
}

function openSocket(url) {
  return new Promise((resolve) => {
    let opened = false;
    try { ws = new WebSocket(url); } catch { resolve(false); return; }
    const guard = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, 30000);
    ws.onopen = () => { opened = true; clearTimeout(guard); hideBoot(); emit('open'); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m && m.t) emit(m.t, m);
    };
    ws.onclose = () => { clearTimeout(guard); S.ready = false; emit('close'); resolve(opened); };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  });
}

export async function connect() {
  const { ws: url, http } = endpoints();
  let attempt = 0;
  while (!stopped) {
    await warmUp(http, attempt);
    if (stopped) break;
    const wasOpen = await openSocket(url);
    if (stopped) break;
    attempt = wasOpen ? 1 : attempt + 1;
    showBoot('Connection lost — retrying…');
    await sleep(Math.min(8000, 800 * attempt));
  }
}
