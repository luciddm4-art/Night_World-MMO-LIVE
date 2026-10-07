// Night World Online - tiny WebSocket server (one shared world).
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 40;
const TICK_MS = 100; // 10 snapshots per second
const HEX = /^#[0-9a-f]{6}$/i;
const players = new Map(); // id -> {x,z,y,r,c,a}
let nextId = 1;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Night World Online server. Players online: ' + players.size + '\n');
});

const wss = new WebSocketServer({ server, maxPayload: 1024 });

const n = (v, lim) => {
  v = Number(v);
  return Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0;
};

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    ws.close(1013, 'full');
    return;
  }
  const id = String(nextId++);
  ws.isAlive = true;
  ws.last = 0;
  ws.send(JSON.stringify({ t: 'w', id }));

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - ws.last < 40) return; // max ~25 msgs/sec per player
    ws.last = now;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || m.t !== 'p' || !m.d) return;
    const d = m.d;
    players.set(id, {
      x: n(d.x, 1e6), z: n(d.z, 1e6), y: n(d.y, 1e4), r: n(d.r, 10),
      c: HEX.test(d.c) ? d.c : '#888888',
      a: Math.floor(n(d.a, 1e9)),
    });
  });
  ws.on('close', () => { players.delete(id); });
  ws.on('error', () => {});
});

// Broadcast everyone's state to everyone.
setInterval(() => {
  if (!wss.clients.size) return;
  const p = [];
  players.forEach((s, id) => p.push({ id, ...s }));
  const msg = JSON.stringify({ t: 's', p });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}, TICK_MS);

// Drop dead connections; the ping also keeps free hosts awake while people play.
setInterval(() => {
  wss.clients.forEach((c) => {
    if (!c.isAlive) return c.terminate();
    c.isAlive = false;
    c.ping();
  });
}, 30000);

server.listen(PORT, () => console.log('Night World server on port ' + PORT));
