// Night World Online — game server.
//   * HTTP: /health, plus the game's static files
//   * WebSocket: accounts, login, and the shared worlds (see room.js)
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { normalizeSeed, NAME_RE, WORLDS, ITEMS } from '../shared/data.js';
import { addItem } from '../shared/inventory.js';
import { makeFilter, reservedName, parseList, parseCommand } from './moderation.js';
import { Room } from './room.js';
import { Player } from './player.js';
import { Store, PgBackend, hashPassword, verifyPassword } from './store.js';
import { createStaticHandler } from './static.js';
import { keepAliveUrl, startKeepAlive } from './keepalive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_ORIGINS = ['https://luciddm4-art.github.io'];
const TICK_MS = 100;
const AUTOSAVE_MS = 30000;
const HEARTBEAT_MS = 30000;
const ROOM_IDLE_MS = 5 * 60 * 1000;

// Which world seeds may be opened. A public server must not let anyone open arbitrary worlds (each one costs memory
// and ticks). WORLD_SEEDS="7,8,9" overrides; unset = the defaults below. createGameServer's own default is "any seed"
// (tests), start() applies these.
export const DEFAULT_WORLD_SEEDS = [7, ...WORLDS.map((w) => w.seed)]; // the start world + every world the Travel Planner offers
export function parseSeeds(env) {
  const list = (env || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  return list.length ? list.map(normalizeSeed) : DEFAULT_WORLD_SEEDS;
}

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
    allowedSeeds: opts.allowedSeeds ? new Set(opts.allowedSeeds.map(normalizeSeed)) : null, // null = any seed
    maxPlayers: opts.maxPlayers ?? Infinity, // whole server, all worlds
    admins: new Set((opts.admins ?? parseList(process.env.ADMINS)).map((n) => String(n).toLowerCase())), // account names allowed to use /kick /mute /ban ...
    chatBlocklist: opts.chatBlocklist ?? parseList(process.env.CHAT_BLOCKLIST), // extra words to hide, on top of the built-in list
    statsMs: opts.statsMs ?? 5 * 60 * 1000,
    maxConnsPerIp: opts.maxConnsPerIp ?? 12, // sockets at once from one network (phones on mobile data share addresses)
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
  const connsByIp = new Map(); // ip -> open sockets
  const entries = new Set(); // every joined player {player, room, ws}, guests included
  const mutes = new Map(); // lower-case name -> muted until (ms)
  const reports = []; // newest last, kept in memory (and logged)
  const filter = makeFilter(cfg.chatBlocklist);
  const clientErrs = new Map(); // ip -> [timestamps] (rate limit for browser error reports)
  const clientErrors = []; // newest last (also logged)
  const tickStat = { n: 0, sum: 0, max: 0, lastAvg: 0, lastMax: 0 }; // how long one server tick takes
  const totalPlayers = () => [...rooms.values()].reduce((n, r) => n + r.players.size, 0);
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
        players: totalPlayers(),
        maxPlayers: Number.isFinite(cfg.maxPlayers) ? cfg.maxPlayers : null,
        rooms: rooms.size,
        uptime: Math.round((cfg.now() - startedAt) / 1000),
        storage: store.kind, // 'postgres' | 'file' | 'memory' (file/memory = progress is lost on redeploy)
        storageOk: store.ok,
        tickMs: { avg: +(tickStat.n ? tickStat.sum / tickStat.n : tickStat.lastAvg).toFixed(2), max: +Math.max(tickStat.max, tickStat.lastMax).toFixed(2) },
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (url === '/clienterr' && (req.method === 'POST' || req.method === 'OPTIONS')) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      const ip = clientIp(req);
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size <= 2048) chunks.push(c); else if (size > 65536) req.destroy(); });
      req.on('error', () => {});
      req.on('end', () => {
        if (size > 2048) { res.writeHead(413, cors); res.end(); return; }
        const recentErrs = recent(clientErrs, ip, 60000);
        if (recentErrs.length >= 10) { res.writeHead(429, cors); res.end(); return; }
        recentErrs.push(cfg.now());
        let rec;
        try { rec = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { rec = null; }
        if (!rec || typeof rec.m !== 'string') { res.writeHead(400, cors); res.end(); return; }
        const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n);
        const entry = { ts: cfg.now(), m: clean(rec.m, 400), v: clean(rec.v, 12), ua: clean(rec.ua, 100) };
        clientErrors.push(entry);
        if (clientErrors.length > 20) clientErrors.shift();
        cfg.log('CLIENT-ERROR', `[build ${entry.v || '?'}]`, entry.m, '|', entry.ua);
        res.writeHead(204, cors);
        res.end();
      });
      return;
    }
    if (serveStatic(req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found\n');
  });

  // ---------------------------------------------------------------- moderation commands (typed in chat)
  const isAdmin = (p) => !!p.account && cfg.admins.has(p.account);
  const findByName = (n) => { const k = String(n || '').toLowerCase(); for (const e of entries) if (e.player.name.toLowerCase() === k) return e; return null; };
  function kick(e, why) {
    send(e.ws, { t: 'kick', m: why });
    detach(e.ws);
    e.ws.close(4003, 'kicked');
  }
  function runCommand(entry, line) {
    const { player: p, room } = entry;
    const c = parseCommand(line);
    if (!c) return room.fail(p, 'Unknown command. Type /help');
    const say = (m) => room.toast(p, m);
    const admin = isAdmin(p);
    const target = () => {
      const e = findByName(c.args[0]);
      if (!e) room.fail(p, 'Nobody called "' + String(c.args[0] || '').slice(0, 20) + '" is online');
      return e;
    };
    switch (c.cmd) {
      case 'help':
        say('/report <name> <reason> — tell the moderators about a player');
        if (admin) say('Admin: /kick /mute <name> [min] /unmute /ban <name> [reason] /unban /say <text> /reports /give <item> [amount]');
        return;
      case 'report': {
        const t = findByName(c.args[0]);
        if (!c.args[0] || !t) return room.fail(p, 'Usage: /report <name> <what happened> (the player must be online)');
        if (t.player === p) return room.fail(p, 'You cannot report yourself');
        const now = cfg.now();
        if (p.lastReport && now - p.lastReport < 30000) return room.fail(p, 'Please wait a little before sending another report');
        p.lastReport = now;
        const r = { ts: now, by: p.name, target: t.player.name, reason: c.args.slice(1).join(' ').slice(0, 120) || '(no reason)' };
        reports.push(r);
        if (reports.length > 50) reports.shift();
        cfg.log('REPORT', r.by, '->', r.target + ':', r.reason);
        return say('Thanks — the moderators have been told.');
      }
      case 'reports': {
        if (!admin) break;
        if (!reports.length) return say('No reports.');
        for (const r of reports.slice(-5)) say(r.by + ' reported ' + r.target + ': ' + r.reason);
        return;
      }
      case 'kick': {
        if (!admin) break;
        const e = target(); if (!e) return;
        if (isAdmin(e.player)) return room.fail(p, 'You cannot do that to another admin');
        cfg.log('ADMIN', p.name, 'kick', e.player.name);
        kick(e, 'A moderator removed you from the game.');
        return say('Kicked ' + e.player.name);
      }
      case 'mute': {
        if (!admin) break;
        const e = target(); if (!e) return;
        if (isAdmin(e.player)) return room.fail(p, 'You cannot do that to another admin');
        const min = Math.max(1, Math.min(1440, Math.floor(Number(c.args[1]) || 10)));
        const until = cfg.now() + min * 60000;
        mutes.set(e.player.name.toLowerCase(), until);
        e.player.mutedUntil = until;
        cfg.log('ADMIN', p.name, 'mute', e.player.name, min + ' min');
        room.toast(e.player, 'A moderator muted you for ' + min + ' minute(s).');
        return say('Muted ' + e.player.name + ' for ' + min + ' min');
      }
      case 'unmute': {
        if (!admin) break;
        const k = String(c.args[0] || '').toLowerCase();
        if (!mutes.delete(k)) return room.fail(p, k + ' is not muted');
        const e = findByName(k); if (e) e.player.mutedUntil = 0;
        cfg.log('ADMIN', p.name, 'unmute', k);
        return say('Unmuted ' + k);
      }
      case 'ban': {
        if (!admin) break;
        const name = String(c.args[0] || '');
        const acct = NAME_RE.test(name) ? store.get(name) : null;
        if (!acct) return room.fail(p, 'No account called "' + name.slice(0, 20) + '" (guests can only be kicked)');
        if (cfg.admins.has(acct.name.toLowerCase())) return room.fail(p, 'You cannot do that to another admin');
        const reason = c.args.slice(1).join(' ').slice(0, 80);
        store.setBan(acct.name, { reason, by: p.name, ts: cfg.now() });
        const e = findByName(acct.name); if (e) kick(e, 'You have been banned' + (reason ? ': ' + reason : '.'));
        cfg.log('ADMIN', p.name, 'ban', acct.name, reason);
        return say('Banned ' + acct.name);
      }
      case 'unban': {
        if (!admin) break;
        const name = String(c.args[0] || '');
        if (!NAME_RE.test(name) || !store.get(name) || !store.get(name).banned) return room.fail(p, name.slice(0, 20) + ' is not banned');
        store.setBan(name, null);
        cfg.log('ADMIN', p.name, 'unban', name);
        return say('Unbanned ' + name);
      }
      case 'give': { // admin test helper: put an item (e.g. one you just added to the data files) in your own bag
        if (!admin) break;
        const id = String(c.args[0] || '').toLowerCase();
        const n = Math.max(1, Math.min(99, Math.floor(Number(c.args[1]) || 1)));
        if (!ITEMS[id]) return room.fail(p, 'Usage: /give <item id> [amount]. Item ids are in shared/data.js (e.g. sword, iron_boots, plank)');
        if (!addItem(p.inv, id, n)) return room.fail(p, 'Your inventory is full');
        room.gain(p, id, n, 'admin');
        room.sendInv(p);
        cfg.log('ADMIN', p.name, 'give', id, n);
        return;
      }
      case 'say': {
        if (!admin) break;
        if (!c.rest) return room.fail(p, 'Usage: /say <message>');
        const msg = { t: 'chat', n: 'Server', m: c.rest.slice(0, 120), ts: cfg.now() };
        for (const r of rooms.values()) r.broadcast(msg);
        cfg.log('ADMIN', p.name, 'say', c.rest);
        return;
      }
      default:
    }
    room.fail(p, 'Unknown command. Type /help');
  }

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
    // Compresses big messages: measured 3-4x less data on the wire (tools/loadtest.mjs) for ~50 % more CPU. Render's free
    // plan includes very little bandwidth, so this is ON; WS_DEFLATE=0 turns it off if CPU becomes the problem.
    perMessageDeflate: process.env.WS_DEFLATE !== '0' ? { threshold: 512, zlibDeflateOptions: { level: 1 }, serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 4 } : false,
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
      r = new Room(seed, { now: cfg.now, chatFilter: (t) => filter.clean(t) });
      rooms.set(seed, r);
      cfg.log('room opened', seed);
    }
    return r;
  }

  function savePlayer(entry) {
    if (entry.player.account) store.saveCharacter(entry.player.account, entry.player.toSave(entry.room.seed, entry.room.now()));
  }

  function detach(ws) {
    const entry = ws.entry;
    if (!entry) return;
    ws.entry = null;
    entries.delete(entry);
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
      if (cfg.allowedSeeds && !cfg.allowedSeeds.has(seed)) return authErr(ws, 'That world does not exist.');
      let acct = null, name, token = null;

      if (m.mode === 'guest') {
        name = 'Guest' + (guestN++ % 10000);
      } else if (m.mode === 'register') {
        const n = typeof m.name === 'string' ? m.name.trim() : '';
        const pw = typeof m.pass === 'string' ? m.pass : '';
        if (!NAME_RE.test(n)) return authErr(ws, 'Name must be 3-16 letters, numbers or _');
        if (reservedName(n) || filter.badName(n)) return authErr(ws, 'That name is not allowed. Please pick another.');
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
      if (acct && acct.banned) return authErr(ws, 'This account is banned' + (acct.banned.reason ? ': ' + acct.banned.reason : '.'), { clearToken: true });

      if (totalPlayers() >= cfg.maxPlayers) return authErr(ws, 'The server is full right now. Please try again in a few minutes.');
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
      player.v2 = m.v === 2; // new clients understand delta snapshots ("d"); old pages keep getting full ones ("s")
      if (!player.restore(saved, seed)) player.setSpawn();
      else room.ensureStandable(player);
      const entry = { player, room, ws };
      ws.entry = entry;
      entries.add(entry);
      player.mutedUntil = mutes.get(name.toLowerCase()) || 0;
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
    const open = (connsByIp.get(ip) || 0) + 1;
    if (open > cfg.maxConnsPerIp) { ws.close(1013, 'Too many connections from your network'); return; }
    connsByIp.set(ip, open);
    ws.once('close', () => { const n = (connsByIp.get(ip) || 1) - 1; if (n > 0) connsByIp.set(ip, n); else connsByIp.delete(ip); });
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
      if (m.t === 'chat' && typeof m.m === 'string' && m.m.trimStart().startsWith('/')) {
        try { runCommand(ws.entry, m.m); } catch (e) { console.error('[cmd] error:', e); }
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

  // ---------------------------------------------------------------- stats line
  function statsLine() {
    const avg = tickStat.n ? tickStat.sum / tickStat.n : 0;
    const mem = process.memoryUsage();
    cfg.log('stats', `players=${totalPlayers()} worlds=${rooms.size} sockets=${wss.clients.size} tick avg=${avg.toFixed(2)}ms max=${tickStat.max.toFixed(1)}ms (budget ${cfg.tickMs}ms)`, `rss=${Math.round(mem.rss / 1048576)}MB heap=${Math.round(mem.heapUsed / 1048576)}MB`, `storage=${store.kind}${store.ok ? '' : ' DOWN: ' + store.lastError}`);
    tickStat.lastAvg = avg; tickStat.lastMax = tickStat.max;
    tickStat.n = 0; tickStat.sum = 0; tickStat.max = 0;
    return { avg, ms: tickStat.lastMax };
  }

  // ---------------------------------------------------------------- timers
  const timers = [];
  function startTimers() {
    timers.push(setInterval(() => {
      const t = cfg.now();
      const t0 = performance.now();
      for (const [seed, room] of rooms) {
        try { room.tick(); } catch (e) { console.error('[room] tick error:', e); }
        if (room.emptySince !== null && t - room.emptySince > ROOM_IDLE_MS) {
          rooms.delete(seed);
          cfg.log('room closed', seed);
        }
      }
      const dt = performance.now() - t0;
      tickStat.n++; tickStat.sum += dt; if (dt > tickStat.max) tickStat.max = dt;
    }, cfg.tickMs));
    timers.push(setInterval(() => statsLine(), cfg.statsMs)); // one summary line every few minutes in the logs
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

  return { server, wss, store, rooms, online, entries, mutes, reports, clientErrors, statsLine, listen, stop, cfg };
}

export async function start() {
  const maxPlayers = Number(process.env.MAX_PLAYERS) > 0 ? Number(process.env.MAX_PLAYERS) : 40; // measured with tools/loadtest.mjs squeezed into 10 % of a core (Render free): ~40 players with compression on is the limit
  const gs = createGameServer({ log: (...a) => console.log('[nwo]', ...a), allowedSeeds: parseSeeds(process.env.WORLD_SEEDS), maxPlayers });
  console.log('[nwo] worlds: ' + [...gs.cfg.allowedSeeds].join(',') + ' · max players: ' + maxPlayers);
  const port = await gs.listen();
  console.log('Night World server on port ' + port + ' (storage: ' + gs.store.kind + (gs.store.kind === 'file' ? ', dir: ' + gs.cfg.dataDir + ' — NOT persistent on free hosting; set DATABASE_URL' : '') + ')');
  const kaUrl = keepAliveUrl();
  if (kaUrl) {
    const ka = startKeepAlive({ url: kaUrl, log: (m) => console.log('[nwo]', m) });
    gs.server.on('close', () => ka.stop());
    console.log('[nwo] keep-alive: pinging ' + kaUrl + ' every 4 min');
  } else console.log('[nwo] keep-alive: off (no RENDER_EXTERNAL_URL / KEEPALIVE_URL)');
  // a bug must leave a trace in the logs (Render keeps them), and a half-broken process must not linger
  process.on('unhandledRejection', (e) => console.error('[nwo] UNHANDLED REJECTION:', e));
  process.on('uncaughtException', async (e) => {
    console.error('[nwo] UNCAUGHT EXCEPTION, saving and restarting:', e);
    try { await gs.stop(); } catch { /* ignore */ }
    process.exit(1);
  });
  const shutdown = async (sig) => {
    console.log('[nwo] ' + sig + ' received, saving…');
    await gs.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return gs;
}
