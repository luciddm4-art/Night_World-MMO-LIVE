// Night World Online — game server.
//   * HTTP: /health, plus the game's static files
//   * WebSocket: accounts, login, and the shared worlds (see room.js)
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { normalizeSeed, NAME_RE } from '../shared/data.js';
import { Room } from './room.js';
import { Player } from './player.js';
import { Store, PgBackend, hashPassword, verifyPassword } from './store.js';
import { createStaticHandler } from './static.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_ORIGINS = ['https://luciddm4-art.github.io'];
const TICK_MS = 100;
const AUTOSAVE_MS = 30000;
const HEARTBEAT_MS = 30000;
const ROOM_IDLE_MS = 5 * 60 * 1000;

function parseOrigins(env) {
  const extra = (env || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}

export function createGameServer(opts = {}) {
  const cfg = {
    port: opts.port ?? Number(process.env.PORT || 8080),
    host: opts.host ?? '0.0.0.0',
    dataDir: opts.dataDir === undefined ? process.env.DATA_DIR || path.join(ROOT, 'data') : opts.dataDir,
    allowedOrigins: opts.allowedOrigins ?? parseOrigins(process.env.ALLOWED_ORIGINS),
    maxPlayersPerRoom: opts.maxPlayersPerRoom ?? 40,
    maxRooms: opts.maxRooms ?? 16,
    now: opts.now ?? Date.now,
    tickMs: opts.tickMs ?? TICK_MS,
    log: opts.log ?? (() => {}),
    databaseUrl: opts.databaseUrl === undefined ? process.env.DATABASE_URL || '' : opts.databaseUrl,
  };

  // DATABASE_URL (or an explicit backend, used by tests) -> Postgres; otherwise the JSON file.
  const backend = opts.backend || (cfg.databaseUrl ? new PgBackend({ url: cfg.databaseUrl }) : null);
  const store = new Store(cfg.dataDir, { now: cfg.now, backend });
  store.load();
  const rooms = new Map(); // seed -> Room
  const online = new Map(); // account key -> {player, room, ws}
  const failedLogins = new Map(); // ip -> [timestamps]
  const registrations = new Map(); // ip -> [timestamps]
  const startedAt = cfg.now();
  let nextId = 1;
  let guestN = 1;

  // ---------------------------------------------------------------- http
  const serveStatic = createStaticHandler(ROOT);
  const server = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    if (url === '/health') {
      const body = JSON.stringify({
        ok: true,
        players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
        rooms: rooms.size,
        uptime: Math.round((cfg.now() - startedAt) / 1000),
        storage: store.kind, // 'postgres' | 'file' | 'memory' (file/memory = progress is lost on redeploy)
        storageOk: store.ok,
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (serveStatic(req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found\n');
  });

  // ---------------------------------------------------------------- websocket
  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser clients (bots, tests)
    if (cfg.allowedOrigins.includes('*')) return true;
    let u;
    try { u = new URL(origin); } catch { return false; }
    if (u.host === req.headers.host) return true; // served by this very server
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    return cfg.allowedOrigins.includes(origin);
  }

  const wss = new WebSocketServer({
    server,
    maxPayload: 4096,
    verifyClient: (info, done) => (originAllowed(info.req) ? done(true) : done(false, 403, 'Forbidden origin')),
  });

  const recent = (map, ip, windowMs) => {
    const t = cfg.now();
    const arr = (map.get(ip) || []).filter((x) => t - x < windowMs);
    map.set(ip, arr);
    return arr;
  };
  const clientIp = (req) => {
    const xff = req.headers['x-forwarded-for'];
    return (xff ? String(xff).split(',')[0].trim() : req.socket.remoteAddress) || '?';
  };

  function getRoom(seed) {
    let r = rooms.get(seed);
    if (!r) {
      if (rooms.size >= cfg.maxRooms) return null;
      r = new Room(seed, { now: cfg.now });
      rooms.set(seed, r);
      cfg.log('room opened', seed);
    }
    return r;
  }

  function savePlayer(entry) {
    if (entry.player.account) store.saveCharacter(entry.player.account, entry.player.toSave(entry.room.seed));
  }

  function detach(ws) {
    const entry = ws.entry;
    if (!entry) return;
    ws.entry = null;
    entry.room.removePlayer(entry.player);
    savePlayer(entry);
    const key = entry.player.account;
    if (key && online.get(key) === entry) online.delete(key);
  }

  function send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  function authErr(ws, m, extra) {
    send(ws, { t: 'auth_err', m, ...extra });
  }

  async function onAuth(ws, m, ip) {
    if (ws.entry || ws.authBusy) return;
    ws.authBusy = true;
    try {
      const seed = normalizeSeed(m.seed ?? 7);
      let acct = null, name, token = null;

      if (m.mode === 'guest') {
        name = 'Guest' + (guestN++ % 10000);
      } else if (m.mode === 'register') {
        const n = typeof m.name === 'string' ? m.name.trim() : '';
        const pw = typeof m.pass === 'string' ? m.pass : '';
        if (!NAME_RE.test(n)) return authErr(ws, 'Name must be 3-16 letters, numbers or _');
        if (pw.length < 6 || pw.length > 64) return authErr(ws, 'Password must be 6-64 characters');
        if (recent(registrations, ip, 3600e3).length >= 5) return authErr(ws, 'Too many new accounts from this network. Try later.');
        acct = await store.create(n, pw);
        if (!acct) return authErr(ws, 'That name is taken');
        registrations.get(ip).push(cfg.now());
        token = store.issueToken(acct.name);
        name = acct.name;
      } else if (m.mode === 'login') {
        if (recent(failedLogins, ip, 600e3).length >= 8) return authErr(ws, 'Too many failed logins. Try again in a few minutes.');
        const n = typeof m.name === 'string' ? m.name.trim() : '';
        const pw = typeof m.pass === 'string' ? m.pass.slice(0, 64) : '';
        const a = NAME_RE.test(n) ? store.get(n) : null;
        let ok = false;
        if (a) ok = await verifyPassword(pw, a.salt, a.hash);
        else await hashPassword(pw || 'x'); // keep timing similar for unknown names
        if (!ok) {
          failedLogins.get(ip).push(cfg.now());
          return authErr(ws, 'Wrong name or password');
        }
        acct = a;
        token = store.issueToken(a.name);
        name = a.name;
      } else if (m.mode === 'token') {
        acct = store.byToken(m.token);
        if (!acct) return authErr(ws, 'Session expired. Please log in again.', { clearToken: true });
        token = m.token;
        name = acct.name;
      } else {
        return authErr(ws, 'Unknown login mode');
      }

      if (ws.readyState !== 1) return; // left while we were hashing

      const room = getRoom(seed);
      if (!room) return authErr(ws, 'All worlds are busy right now. Try an existing world.');
      if (room.players.size >= cfg.maxPlayersPerRoom) return authErr(ws, 'This world is full (' + cfg.maxPlayersPerRoom + ' players)');

      const key = acct ? acct.name.toLowerCase() : null;
      if (key && online.has(key)) {
        const old = online.get(key);
        detach(old.ws);
        send(old.ws, { t: 'kick', m: 'You logged in from another place.' });
        old.ws.close(4002, 'replaced');
      }

      const saved = acct ? acct.save : null;
      const color = HEX.test(m.color) ? m.color : saved && HEX.test(saved.color) ? saved.color : '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      const player = new Player({
        id: nextId++, name, color, account: key, saved,
        send: (obj) => {
          if (ws.readyState !== 1) return;
          if (ws.bufferedAmount > 1e6) { ws.terminate(); return; } // hopelessly slow client
          ws.send(JSON.stringify(obj));
        },
      });
      if (!player.restore(saved, seed)) player.setSpawn();
      else room.ensureStandable(player);
      const entry = { player, room, ws };
      ws.entry = entry;
      if (key) online.set(key, entry);
      const welcome = room.addPlayer(player);
      welcome.guest = !acct;
      welcome.token = acct ? token : null;
      send(ws, welcome);
      cfg.log('join', name, 'seed', seed);
    } catch (e) {
      console.error('[auth] error:', e);
      authErr(ws, 'Server error, please try again');
    } finally {
      ws.authBusy = false;
    }
  }

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    ws.isAlive = true;
    ws.entry = null;
    ws.bucket = { tokens: 80, t: cfg.now(), drops: 0, dropT: cfg.now() };
    const authTimer = setTimeout(() => { if (!ws.entry) ws.close(4001, 'auth timeout'); }, 15000);

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      // token bucket: ~50 messages/second sustained, bursts of 80
      const b = ws.bucket, t = cfg.now();
      b.tokens = Math.min(80, b.tokens + ((t - b.t) / 1000) * 50);
      b.t = t;
      if (b.tokens < 1) {
        if (t - b.dropT > 10000) { b.drops = 0; b.dropT = t; }
        if (++b.drops > 300) ws.close(1008, 'rate limit');
        return;
      }
      b.tokens -= 1;

      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ping') { // latency probe from the client; echo the number back
        if (typeof m.n === 'number' && Number.isFinite(m.n) && ws.readyState === 1) ws.send(JSON.stringify({ t: 'pong', n: m.n }));
        return;
      }
      if (!ws.entry) {
        if (m.t === 'auth') onAuth(ws, m, ip);
        return;
      }
      try {
        ws.entry.room.handle(ws.entry.player, m);
      } catch (e) {
        console.error('[room] handler error:', e);
      }
    });
    ws.on('close', () => { clearTimeout(authTimer); detach(ws); });
    ws.on('error', () => {});
  });

  // ---------------------------------------------------------------- timers
  const timers = [];
  function startTimers() {
    timers.push(setInterval(() => {
      const t = cfg.now();
      for (const [seed, room] of rooms) {
        try { room.tick(); } catch (e) { console.error('[room] tick error:', e); }
        if (room.emptySince !== null && t - room.emptySince > ROOM_IDLE_MS) {
          rooms.delete(seed);
          cfg.log('room closed', seed);
        }
      }
    }, cfg.tickMs));
    timers.push(setInterval(() => {
      for (const e of online.values()) savePlayer(e);
      store.prune();
    }, AUTOSAVE_MS));
    // Drop dead connections; the ping also keeps free hosts awake while people play.
    timers.push(setInterval(() => {
      wss.clients.forEach((c) => {
        if (!c.isAlive) return c.terminate();
        c.isAlive = false;
        c.ping();
      });
    }, HEARTBEAT_MS));
    timers.forEach((t) => t.unref?.());
  }

  async function listen() {
    await store.init(); // connects to the database (if configured) before anyone can log in
    return new Promise((resolve) => {
      startTimers();
      server.listen(cfg.port, cfg.host, () => resolve(server.address().port));
    });
  }

  async function stop() {
    timers.forEach(clearInterval);
    for (const e of online.values()) savePlayer(e);
    wss.clients.forEach((c) => c.terminate());
    await store.close(); // final write to whichever backend is in use
    return new Promise((resolve) => wss.close(() => server.close(() => resolve())));
  }

  return { server, wss, store, rooms, online, listen, stop, cfg };
}

export async function start() {
  const gs = createGameServer({ log: (...a) => console.log('[nwo]', ...a) });
  const port = await gs.listen();
  console.log('Night World server on port ' + port + ' (storage: ' + gs.store.kind + (gs.store.kind === 'file' ? ', dir: ' + gs.cfg.dataDir + ' — NOT persistent on free hosting; set DATABASE_URL' : '') + ')');
  const shutdown = async (sig) => {
    console.log('[nwo] ' + sig + ' received, saving…');
    await gs.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return gs;
}
