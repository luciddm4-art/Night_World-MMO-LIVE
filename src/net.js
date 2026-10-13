// WebSocket transport: connect (waking a sleeping free host if needed), reconnect
// with back-off, and a tiny message bus.  Game logic lives elsewhere.
import { endpoints } from './config.js';
import { S } from './state.js';
import { showBoot, hideBoot, showBanner, hideBanner, setPing, setBootProgress } from './ui.js';

const handlers = {};
let ws = null;
let stopped = false;
let hasPlayed = false; // we were in the world at least once: a drop is a "reconnect", not a first load
let lastRx = 0;
let rtt = null;

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
  const soft = attempt > 0 && hasPlayed; // short drop while playing: small banner, game stays visible
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    if (soft && s < 8) return;
    // the bar creeps forward while we wait (fast at first, then slower), so it never looks frozen
    setBootProgress(0.08 + 0.52 * (1 - Math.exp(-s / 20)));
    if (s >= 3 || soft) {
      showBoot(
        attempt ? 'Reconnecting…' : 'Waking the server…',
        'The free server naps when nobody is playing. Waking it takes up to a minute — ' + s + 's',
      );
      hideBanner();
    }
  }, 500);
  if (soft) showBanner('Reconnecting…');
  else showBoot(attempt ? 'Reconnecting…' : 'Connecting…');
  try {
    while (!done && !stopped) {
      const ctl = new AbortController();
      const kill = setTimeout(() => ctl.abort(), 20000);
      try {
        await fetch(http + '/health', { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
        done = true;
        setBootProgress(0.7); // server answered
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
    ws.onopen = () => { opened = true; lastRx = Date.now(); clearTimeout(guard); setBootProgress(0.92); hideBoot(); hideBanner(); emit('open'); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      lastRx = Date.now();
      if (m && m.t === 'pong') {
        const d = Math.max(0, Math.round(lastRx - m.n));
        rtt = rtt == null ? d : Math.round(rtt * 0.7 + d * 0.3);
        setPing(rtt);
        return;
      }
      if (m && m.t === 'welcome') hasPlayed = true;
      if (m && m.t) emit(m.t, m);
    };
    ws.onclose = () => { clearTimeout(guard); S.ready = false; rtt = null; setPing(null); emit('close'); resolve(opened); };
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
    if (hasPlayed && attempt < 4) showBanner('Connection lost — reconnecting…');
    else showBoot('Connection lost — retrying…');
    // quick first retries, then back off (with jitter so a restarted server isn't stampeded)
    const wait = Math.min(6000, 300 * 2 ** Math.min(attempt, 5)) * (0.75 + Math.random() * 0.5);
    await sleep(wait);
  }
}

// ---- latency probe + dead-connection watchdog ----
// Phones often leave a socket "open" after wifi/4G changes. If nothing arrives for a while, drop it
// and let the reconnect loop above take over instead of freezing the game.
function probe() {
  if (!ws || ws.readyState !== 1) return;
  if (Date.now() - lastRx > 9000) { try { ws.close(); } catch { /* ignore */ } return; }
  send({ t: 'ping', n: Date.now() });
}
setInterval(probe, 2000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !ws || ws.readyState !== 1) return;
  if (Date.now() - lastRx > 4000) { try { ws.close(); } catch { /* ignore */ } } else probe();
});
