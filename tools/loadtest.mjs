// Load test: starts the real server as its own process and connects N simulated players that walk, fight,
// gather and chat. Reports bandwidth, latency, server CPU and tick time, and estimates how many players a free
// Render instance (about 0.1 CPU) could carry.
//
//   WS_DEFLATE=0 node tools/loadtest.mjs         the same without message compression
//   node tools/loadtest.mjs                      40 players for 20 s in one world, all starting in town
//   node tools/loadtest.mjs --players 80 --seconds 30 --worlds 2 --spread
//
// Linux only for the CPU numbers (reads /proc). Nothing here touches the live server.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith('--') ? Number(process.argv[i + 1]) : d; };
const N = arg('players', 40), SECS = arg('seconds', 20), WORLDS = arg('worlds', 1), SPREAD = process.argv.includes('--spread');
const BUDGET_GB = arg('budget-gb', 5); // monthly outbound bandwidth you have (Render's Hobby workspace: 5 GB, check your Billing page)
const THROTTLE = arg('throttle', 0); // e.g. 0.1 = squeeze the server into 10 % of a core, like Render's free tier (it runs ~10 ms, then is paused ~90 ms)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const SEEDS = [7, 42, 100, 999, 2025];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, WS_DEFLATE: process.env.WS_DEFLATE ?? '1', PORT: String(PORT), DATABASE_URL: '', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-load-')), KEEPALIVE: 'off', MAX_PLAYERS: String(N + 10), RENDER_EXTERNAL_URL: '', NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; }); child.stderr.on('data', (d) => { serverLog += d; });
const cpuTicks = () => { try { const f = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(') ')[1].split(' '); return Number(f[11]) + Number(f[12]); } catch { return null; } };
const rssMB = () => { try { return Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${child.pid}/status`, 'utf8'))[1]) / 1024; } catch { return null; } };
const HZ = 100;

for (let i = 0; i < 50 && !/Night World server on port/.test(serverLog); i++) await wait(100);
if (!/Night World server on port/.test(serverLog)) { console.error('server did not start:\n' + serverLog); child.kill(); process.exit(1); }

let throttleTimer = null;
function startThrottle() {
  if (!THROTTLE) return;
  const period = 100; // ms, the same period Linux CPU quotas use
  throttleTimer = setInterval(() => {
    try { process.kill(child.pid, 'SIGCONT'); } catch { return; }
    setTimeout(() => { try { process.kill(child.pid, 'SIGSTOP'); } catch { /* gone */ } }, period * THROTTLE);
  }, period);
}
const stats = { bytes: 0, msgs: 0, rtt: [], joined: 0, refused: 0, closed: 0 };
const socks = [];
const wireBytes = () => socks.reduce((n, s) => n + ((s._socket && s._socket.bytesRead) || 0), 0); // bytes that really crossed the network
let running = true;
function bot(i) {
  const seed = SEEDS[i % Math.min(WORLDS, SEEDS.length)];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { 'x-forwarded-for': `10.0.${(i >> 8) & 255}.${i & 255}` } }); // each bot looks like its own network
  let x = 0, z = 22, r = Math.random() * 6.28;
  const pings = new Map();
  ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', mode: 'guest', seed, color: '#88aa44' })));
  ws.on('message', (raw) => {
    stats.bytes += raw.length; stats.msgs++;
    const m = JSON.parse(raw);
    if (m.t === 'welcome') {
      stats.joined++;
      if (m.you) { x = m.you.x ?? x; z = m.you.z ?? z; }
      if (SPREAD) { /* the server clamps big jumps, so spread by walking */ r = (i / N) * 6.28; }
      loop();
    } else if (m.t === 'auth_err') stats.refused++;
    else if (m.t === 'pos') { x = m.x; z = m.z; }
    else if (m.t === 'pong') { const t0 = pings.get(m.n); if (t0) { stats.rtt.push(performance.now() - t0); pings.delete(m.n); } }
  });
  ws.on('close', () => { if (running) stats.closed++; });
  ws.on('error', () => {});
  function loop() {
    let tick = 0;
    const iv = setInterval(() => {
      if (!running || ws.readyState !== 1) { clearInterval(iv); return; }
      tick++;
      if (tick % 20 === 0) r += (Math.random() - 0.5) * 2;
      x += Math.sin(r) * 0.38; z += Math.cos(r) * 0.38; // 5.4 units/s: just under walking speed (6), like the real client (a packet every ~70 ms)
      ws.send(JSON.stringify({ t: 'p', x: +x.toFixed(2), z: +z.toFixed(2), r: +r.toFixed(2) }));
      if (tick % 10 === 0) ws.send(JSON.stringify({ t: 'atk', r }));
      if (tick % 200 === 0) ws.send(JSON.stringify({ t: 'chat', m: 'hello from bot ' + i }));
      if (tick % 20 === 5) { const n = i * 100000 + tick; pings.set(n, performance.now()); ws.send(JSON.stringify({ t: 'ping', n })); }
    }, 70);
  }
  return ws;
}

startThrottle();
console.log(`Starting ${N} bots in ${WORLDS} world(s) against a fresh server (port ${PORT})…`);
for (let i = 0; i < N; i++) { socks.push(bot(i)); if (i % 10 === 9) await wait(150); }
await wait(2500);
console.log(`joined ${stats.joined}/${N} (refused ${stats.refused}); measuring for ${SECS}s…`);

const c0 = cpuTicks(), t0 = performance.now(), b0 = wireBytes(); stats.rtt.length = 0;
await wait(SECS * 1000);
const c1 = cpuTicks(), secs = (performance.now() - t0) / 1000;
const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
const cpuFrac = c0 !== null && c1 !== null ? (c1 - c0) / HZ / secs : null;
const rtt = [...stats.rtt].sort((a, b) => a - b);
const q = (p) => (rtt.length ? rtt[Math.min(rtt.length - 1, Math.floor(rtt.length * p))] : NaN);
const kbpsEach = (wireBytes() - b0) / secs / Math.max(1, stats.joined) / 1024;
running = false;
if (throttleTimer) { clearInterval(throttleTimer); try { process.kill(child.pid, 'SIGCONT'); } catch { /* ignore */ } }
socks.forEach((s) => s.terminate());
const rss = rssMB();
child.kill('SIGTERM');
await wait(300);

const FREE_TIER_CPU = 0.1; // Render free: 0.1 CPU. This machine's cores are probably faster, so treat the estimate as optimistic.
console.log('\n================ RESULT ================');
console.log(THROTTLE ? `(server squeezed into ${(THROTTLE * 100).toFixed(0)} % of a core)` : '(server has a whole core)');
console.log(`players connected      : ${stats.joined}  (dropped during test: ${stats.closed})`);
console.log(`server tick            : avg ${health.tickMs.avg} ms, worst ${health.tickMs.max} ms   (budget 100 ms)`);
console.log(`latency (ping RTT)     : p50 ${q(0.5).toFixed(0)} ms, p95 ${q(0.95).toFixed(0)} ms, max ${q(1).toFixed(0)} ms`);
console.log(`download per player    : ${kbpsEach.toFixed(1)} KB/s on the wire   (server total ${(kbpsEach * stats.joined * 8).toFixed(0)} kbit/s)${process.env.WS_DEFLATE === '0' ? '  [compression OFF]' : '  [compression on]'}`);
console.log(`  = ${(kbpsEach * 3600 / 1024).toFixed(0)} MB per player-hour; a ${BUDGET_GB} GB/month allowance lasts ~${Math.round(BUDGET_GB * 1024 / (kbpsEach * 3600 / 1024))} player-hours (~${Math.round(BUDGET_GB * 1024 / (kbpsEach * 3600 / 1024) / 30)} per day)`);
if (cpuFrac !== null) {
  console.log(`server CPU             : ${(cpuFrac * 100).toFixed(1)} % of one core here, memory ${rss ? rss.toFixed(0) : '?'} MB`);
  const per = cpuFrac / Math.max(1, stats.joined);
  console.log(`CPU per player         : ${(per * 100).toFixed(2)} % of a core`);
  const cap = Math.floor((FREE_TIER_CPU * 0.7) / per);
  console.log(`estimated free-tier cap: ~${cap} players at 70 % of Render's 0.1 CPU (optimistic if their cores are slower)`);
}
console.log('========================================');
process.exit(0);
