import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';
import { countItem } from '../shared/inventory.js';
import { SPAWN } from '../shared/data.js';
import { PGlite } from '@electric-sql/pglite';
import { PgBackend } from '../server/store.js';

async function boot(opts = {}) {
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-'));
  const gs = createGameServer({ port: 0, host: '127.0.0.1', dataDir, tickMs: 50, databaseUrl: '', ...opts });
  const port = await gs.listen();
  return { gs, port, dataDir, url: `ws://127.0.0.1:${port}`, http: `http://127.0.0.1:${port}` };
}

function client(url, headers = {}) {
  const ws = new WebSocket(url, { headers });
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.t === m.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else queue.push(m);
  });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return {
    ws, opened,
    send: (o) => ws.send(JSON.stringify(o)),
    next(t, ms = 3000) {
      const i = queue.findIndex((m) => m.t === t);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { t, resolve };
        waiters.push(w);
        setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error('timeout waiting for ' + t)); } }, ms);
      });
    },
    close: () => new Promise((res) => { ws.on('close', res); ws.close(); }),
  };
}

async function login(env, msg) {
  const c = client(env.url);
  await c.opened;
  c.send({ t: 'auth', seed: 7, ...msg });
  return c;
}

test('guest play: welcome packet has a fresh character and no token', async () => {
  const env = await boot({ dataDir: null });
  try {
    const c = await login(env, { mode: 'guest' });
    const w = await c.next('welcome');
    assert.equal(w.guest, true);
    assert.equal(w.token, null);
    assert.match(w.name, /^Guest\d+$/);
    assert.equal(w.you.inv.slots.length, 64);
    assert.equal(w.seed, 7);
    await c.close();
  } finally { await env.gs.stop(); }
});

test('accounts: register, duplicate names, wrong password, login, token resume', async () => {
  const env = await boot();
  try {
    const a = await login(env, { mode: 'register', name: 'Alice', pass: 'hunter22' });
    const w = await a.next('welcome');
    assert.equal(w.guest, false);
    assert.equal(w.name, 'Alice');
    assert.equal(w.token.length, 64);
    await a.close();

    const dup = await login(env, { mode: 'register', name: 'alice', pass: 'whatever1' });
    assert.equal((await dup.next('auth_err')).m, 'That name is taken');

    const bad = await login(env, { mode: 'login', name: 'Alice', pass: 'nope-nope' });
    assert.equal((await bad.next('auth_err')).m, 'Wrong name or password');
    const ghost = await login(env, { mode: 'login', name: 'Nobody', pass: 'nope-nope' });
    assert.equal((await ghost.next('auth_err')).m, 'Wrong name or password', 'same message for unknown names');

    const ok = await login(env, { mode: 'login', name: 'alice', pass: 'hunter22' });
    assert.equal((await ok.next('welcome')).name, 'Alice');
    await ok.close();

    const t = await login(env, { mode: 'token', token: w.token });
    assert.equal((await t.next('welcome')).name, 'Alice');
    await t.close();
    const badTok = await login(env, { mode: 'token', token: 'f'.repeat(64) });
    const e = await badTok.next('auth_err');
    assert.equal(e.clearToken, true);

    env.gs.store.flushSync();
    const raw = fs.readFileSync(path.join(env.dataDir, 'accounts.json'), 'utf8');
    assert.ok(!raw.includes('hunter22'), 'password is never stored in plain text');
    assert.ok(!raw.includes(w.token), 'tokens are stored hashed');
  } finally { await env.gs.stop(); }
});

test('accounts: input validation', async () => {
  const env = await boot({ dataDir: null });
  try {
    for (const [msg, re] of [
      [{ mode: 'register', name: 'x', pass: 'password1' }, /Name must be/],
      [{ mode: 'register', name: 'bad name!', pass: 'password1' }, /Name must be/],
      [{ mode: 'register', name: 'Fine_Name', pass: '123' }, /Password must be/],
      [{ mode: 'register', name: { $ne: 1 }, pass: 'password1' }, /Name must be/],
      [{ mode: 'hax' }, /Unknown login mode/],
    ]) {
      const c = await login(env, msg);
      assert.match((await c.next('auth_err')).m, re);
      c.ws.terminate();
    }
  } finally { await env.gs.stop(); }
});

test('accounts: repeated failed logins are throttled', async () => {
  const env = await boot();
  try {
    const r = await login(env, { mode: 'register', name: 'Victim', pass: 'correct-horse' });
    await r.next('welcome'); await r.close();
    let last;
    for (let i = 0; i < 9; i++) {
      const c = await login(env, { mode: 'login', name: 'Victim', pass: 'guess' + i });
      last = (await c.next('auth_err')).m;
      c.ws.terminate();
    }
    assert.match(last, /Too many failed logins/);
    const c = await login(env, { mode: 'login', name: 'Victim', pass: 'correct-horse' });
    assert.match((await c.next('auth_err')).m, /Too many failed logins/, 'even the right password is refused while throttled');
  } finally { await env.gs.stop(); }
});

test('persistence: inventory and position survive logout, and a full server restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-'));
  let env = await boot({ dataDir });
  const a = await login(env, { mode: 'register', name: 'Saver', pass: 'secret123' });
  await a.next('welcome');
  const entry = env.gs.online.get('saver');
  entry.player.inv.slots[0] = { id: 'iron', n: 7 };
  entry.player.x = 12.5; entry.player.z = 40;
  await a.close();
  await new Promise((r) => setTimeout(r, 100));
  await env.gs.stop();

  env = await boot({ dataDir });
  try {
    const b = await login(env, { mode: 'login', name: 'Saver', pass: 'secret123' });
    const w = await b.next('welcome');
    assert.equal(w.you.inv.slots[0].id, 'iron');
    assert.equal(w.you.inv.slots[0].n, 7);
    assert.equal(w.you.x, 12.5);
    assert.equal(w.you.z, 40);
    await b.close();

    // a different world starts you in that world's town plaza, but keeps your stuff
    const c = client(env.url);
    await c.opened;
    c.send({ t: 'auth', mode: 'login', name: 'Saver', pass: 'secret123', seed: 42 });
    const w2 = await c.next('welcome');
    assert.equal(w2.seed, 42);
    assert.equal(w2.you.z, SPAWN.z);
    assert.equal(w2.you.inv.slots[0].n, 7);
    await c.close();
  } finally { await env.gs.stop(); }
});

test('persistence on Postgres: progress and login token survive a full server restart', async () => {
  const db = new PGlite(); // stands in for the Neon database; outlives both server instances
  let env = await boot({ dataDir: null, backend: new PgBackend({ pool: db }) });
  let token;
  try {
    const health = await (await fetch(env.http + '/health')).json();
    assert.equal(health.storage, 'postgres');
    assert.equal(health.storageOk, true);
    const a = await login(env, { mode: 'register', name: 'Pgsaver', pass: 'secret123' });
    const welcome = await a.next('welcome');
    token = welcome.token;
    const entry = env.gs.online.get('pgsaver');
    entry.player.inv.slots[0] = { id: 'iron', n: 9 };
    entry.player.x = 20; entry.player.z = 33;
    await a.close();
    await new Promise((r) => setTimeout(r, 100));
  } finally { await env.gs.stop(); }

  env = await boot({ dataDir: null, backend: new PgBackend({ pool: db }) }); // "redeploy": fresh process, empty disk
  try {
    const b = await login(env, { mode: 'token', token });
    const w = await b.next('welcome');
    assert.equal(w.name, 'Pgsaver');
    assert.equal(w.you.inv.slots[0].n, 9);
    assert.equal(w.you.x, 20);
    await b.close();
    const c = await login(env, { mode: 'login', name: 'Pgsaver', pass: 'secret123' });
    assert.ok(await c.next('welcome'), 'password login works too');
    await c.close();
  } finally { await env.gs.stop(); }
  await db.close();
});

test('a bad DATABASE_URL does not stop the game: falls back to files and says so on /health', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-'));
  const origErr = console.error;
  console.error = () => {};
  let env;
  try {
    env = await boot({ dataDir, databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none' }); // nothing listens on port 1
  } finally { console.error = origErr; }
  try {
    const health = await (await fetch(env.http + '/health')).json();
    assert.equal(health.storage, 'file');
    assert.equal(health.storageOk, false);
    const c = await login(env, { mode: 'register', name: 'Fallback', pass: 'secret123' });
    assert.ok(await c.next('welcome'), 'players can still register and play');
    await c.close();
  } finally { await env.gs.stop(); }
});

test('ping: the server echoes the probe (before and after login) and ignores junk', async () => {
  const env = await boot({ dataDir: null });
  try {
    const c = client(env.url);
    await c.opened;
    c.send({ t: 'ping', n: 12345 });
    assert.equal((await c.next('pong')).n, 12345, 'works before login too');
    c.send({ t: 'ping', n: 'abc' });
    c.send({ t: 'ping' });
    c.send({ t: 'auth', seed: 7, mode: 'guest' });
    await c.next('welcome');
    c.send({ t: 'ping', n: 777 });
    assert.equal((await c.next('pong')).n, 777, 'and in the game');
    await assert.rejects(c.next('pong', 300), /timeout/, 'junk pings get no reply');
    await c.close();
  } finally { await env.gs.stop(); }
});

test('one login per account: a second login kicks the first', async () => {
  const env = await boot({ dataDir: null });
  try {
    const a = await login(env, { mode: 'register', name: 'Twin', pass: 'secret123' });
    await a.next('welcome');
    const b = await login(env, { mode: 'login', name: 'Twin', pass: 'secret123' });
    await b.next('welcome');
    assert.match((await a.next('kick')).m, /another place/);
    assert.equal(env.gs.online.size, 1);
  } finally { await env.gs.stop(); }
});

test('gameplay over the wire: gather a tree, see your inventory update, chat with a neighbour', async () => {
  const env = await boot({ dataDir: null });
  try {
    const a = await login(env, { mode: 'guest' });
    const b = await login(env, { mode: 'guest' });
    const wa = await a.next('welcome');
    await b.next('welcome');
    const room = env.gs.rooms.get(7);
    const player = room.players.get(wa.id);

    let tree;
    for (let cx = -5; cx < 5 && !tree; cx++) for (let cz = -5; cz < 5 && !tree; cz++) {
      const arr = room.world.ctrees(cx, cz);
      if (arr.length) tree = { id: cx + ',' + cz + ',0', x: arr[0], z: arr[1] };
    }
    assert.ok(tree, 'found a tree');
    player.x = tree.x; player.z = tree.z; // (test shortcut: skip the walk)

    a.send({ t: 'gather', kind: 'tree', id: tree.id });
    assert.equal((await a.next('cast')).dur, 2000);
    await new Promise((r) => setTimeout(r, 2100));
    a.send({ t: 'gdone' });
    const inv = await a.next('inv');
    assert.equal(countItem(inv.inv, 'wood'), 1);
    assert.deepEqual(await b.next('node'), { t: 'node', id: tree.id, qty: 2 });

    a.send({ t: 'chat', m: 'hello world' });
    const msg = await b.next('chat');
    assert.equal(msg.m, 'hello world');
    assert.equal(msg.n, wa.name);
    await a.close(); await b.close();
  } finally { await env.gs.stop(); }
});

test('snapshots arrive about 10 times a second', async () => {
  const env = await boot({ dataDir: null, tickMs: 100 });
  try {
    const a = await login(env, { mode: 'guest' });
    await a.next('welcome');
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await a.next('s');
    assert.ok(Date.now() - t0 < 900, 'five snapshots in under a second');
    await a.close();
  } finally { await env.gs.stop(); }
});

test('hardening: bad JSON, huge payloads, junk before auth and unknown messages do not crash the server', async () => {
  const env = await boot({ dataDir: null });
  try {
    const c = client(env.url);
    await c.opened;
    c.ws.send('not json');
    c.ws.send(JSON.stringify({ t: 'p', x: 1, z: 1 })); // game message before auth: ignored
    c.ws.send(JSON.stringify([1, 2, 3]));
    c.ws.send(JSON.stringify(null));
    c.send({ t: 'auth', mode: 'guest', seed: 'drop table' });
    const w = await c.next('welcome');
    assert.equal(w.seed, 7, 'garbage seed falls back to the default world');
    for (const m of [{ t: 'zzz' }, { t: 'p' }, { t: 'gather' }, { t: 'craft', id: {} }, { t: 'chat' }, { t: 'equip', i: 'x' }, { t: '__proto__' }]) c.send(m);
    const big = new WebSocket(env.url);
    await new Promise((r) => big.on('open', r));
    const closed = new Promise((r) => big.on('close', (code) => r(code)));
    big.send('x'.repeat(10000));
    assert.equal(await closed, 1009, 'oversize frames are rejected');
    c.send({ t: 'chat', m: 'still alive' });
    assert.equal((await c.next('chat')).m, 'still alive');
    await c.close();
  } finally { await env.gs.stop(); }
});

test('seeds are clamped and the number of worlds is capped', async () => {
  const env = await boot({ dataDir: null, maxRooms: 2 });
  try {
    const mk = async (seed) => { const c = client(env.url); await c.opened; c.send({ t: 'auth', mode: 'guest', seed }); return c; };
    const a = await mk(1e15);
    assert.equal((await a.next('welcome')).seed, 1e9);
    const b = await mk(5);
    await b.next('welcome');
    const c = await mk(6);
    assert.match((await c.next('auth_err')).m, /worlds are busy/);
    const d = await mk(5); // existing world: fine
    await d.next('welcome');
  } finally { await env.gs.stop(); }
});

test('origin check: unknown websites cannot connect; the Pages site and same-origin can', async () => {
  const env = await boot({ dataDir: null });
  try {
    const evil = client(env.url, { Origin: 'https://evil.example' });
    await assert.rejects(evil.opened, /403/);
    const ok = client(env.url, { Origin: 'https://luciddm4-art.github.io' });
    await ok.opened; ok.ws.terminate();
    const self = client(env.url, { Origin: `http://127.0.0.1:${env.port}` });
    await self.opened; self.ws.terminate();
  } finally { await env.gs.stop(); }
});

test('http: /health works (with CORS) and static files are served safely', async () => {
  const env = await boot({ dataDir: null });
  try {
    const h = await fetch(env.http + '/health');
    assert.equal(h.status, 200);
    assert.equal(h.headers.get('access-control-allow-origin'), '*');
    assert.equal((await h.json()).ok, true);

    const idx = await fetch(env.http + '/');
    assert.equal(idx.status, 200);
    assert.match(idx.headers.get('content-type'), /text\/html/);
    const js = await fetch(env.http + '/shared/data.js');
    assert.match(js.headers.get('content-type'), /javascript/);
    const gz = await fetch(env.http + '/vendor/three.min.js', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.status, 200);

    for (const bad of ['/server/index.js', '/package.json', '/data/accounts.json', '/test/helpers.js', '/.git/config', '/src/../package.json', '/%2e%2e/package.json', '/src/%2e%2e/%2e%2e/etc/passwd', '/nope']) {
      const r = await fetch(env.http + bad);
      assert.equal(r.status, 404, bad);
    }
  } finally { await env.gs.stop(); }
});
