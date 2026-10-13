import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer, parseSeeds, DEFAULT_WORLD_SEEDS } from '../server/index.js';
import { makeRoom, makePlayer, findThings } from './helpers.js';
import { WORLDS } from '../shared/data.js';

// ------------------------------------------------------------------ fuzz: garbage can never break a player or the room
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const TYPES = ['p', 'atk', 'gather', 'gdone', 'gcancel', 'craft', 'equip', 'unequip', 'mount', 'dismount', 'chat', 'auth', 'ping', '__proto__', 'constructor', '', 5, null];
function junk(r, depth = 0) {
  const pick = [
    () => null, () => undefined, () => true, () => false, () => NaN, () => Infinity, () => -Infinity, () => 0, () => -0, () => 1, () => -1,
    () => 1e300, () => -1e300, () => 2 ** 53, () => 0.5, () => Math.floor(r() * 100) - 20,
    () => '', () => 'x', () => 'a'.repeat(1 + Math.floor(r() * 400)), () => '<img src=x onerror=1>', () => '__proto__', () => 'constructor', () => '0', () => 'wood', () => 'sword',
    () => [], () => [1, 2, 3], () => ({}), () => ({ __proto__: { polluted: 1 } }), () => JSON.parse('{"__proto__":{"polluted":1}}'),
  ];
  if (depth < 2 && r() < 0.15) return r() < 0.5 ? [junk(r, depth + 1), junk(r, depth + 1)] : { a: junk(r, depth + 1), n: junk(r, depth + 1) };
  return pick[Math.floor(r() * pick.length)]();
}
function junkMsg(r) {
  const m = { t: TYPES[Math.floor(r() * TYPES.length)] };
  for (const k of ['x', 'z', 'r', 'kind', 'id', 'i', 'slot', 'm', 'n', 'item', 'to', 'from']) if (r() < 0.5) m[k] = junk(r);
  return m;
}

test('fuzz: 6000 garbage messages never throw and never leave a player in a broken state', () => {
  const { room, now } = makeRoom();
  const { tree } = findThings();
  const p = makePlayer(room, 'fuzzer', { x: tree.x + 1, z: tree.z });
  const r = rng(12345);
  const failures = [];
  for (let i = 0; i < 6000; i++) {
    const m = junkMsg(r);
    try { room.handle(p, m); } catch (e) { failures.push(JSON.stringify(m).slice(0, 120) + ' -> ' + e.message); if (failures.length > 5) break; }
    if (i % 25 === 0) { now.advance(300); try { room.tick(); } catch (e) { failures.push('tick -> ' + e.message); } }
  }
  assert.deepEqual(failures, []);
  assert.equal({}.polluted, undefined, 'prototype pollution');
  for (const k of ['x', 'z', 'r', 'hp']) assert.ok(Number.isFinite(p[k]), k + ' must stay a finite number, got ' + p[k]);
  assert.ok(p.hp >= 0 && p.hp <= p.maxHp);
  assert.ok(Math.abs(p.x) <= 1e6 && Math.abs(p.z) <= 1e6);
  for (const s of p.inv.slots) if (s) { assert.equal(typeof s.id, 'string'); assert.ok(Number.isInteger(s.n) && s.n >= 1 && s.n <= 99, 'bad stack ' + JSON.stringify(s)); }
  // the snapshot must still serialise (a NaN or cycle would break every nearby player)
  JSON.stringify(room.snapshotFor ? room.snapshotFor(p) : room.welcome(p));
});

// ------------------------------------------------------------------ server limits
function sock(url, headers) {
  const ws = new WebSocket(url, { headers });
  const msgs = [];
  ws.on('message', (raw) => { try { msgs.push(JSON.parse(raw)); } catch { /* ignore */ } });
  ws.on('error', () => {});
  const closed = new Promise((res) => ws.on('close', (code) => res(code)));
  const opened = new Promise((res) => { ws.on('open', res); ws.on('close', res); });
  const until = async (t, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const m = msgs.find((x) => x.t === t); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
    return null;
  };
  return { ws, msgs, closed, opened, until, send: (o) => ws.send(JSON.stringify(o)) };
}
async function boot(opts = {}) {
  const gs = createGameServer({ port: 0, host: '127.0.0.1', dataDir: null, tickMs: 50, databaseUrl: '', ...opts });
  const port = await gs.listen();
  return { gs, url: `ws://127.0.0.1:${port}`, http: `http://127.0.0.1:${port}` };
}

test('only the listed worlds can be opened', async () => {
  const env = await boot({ allowedSeeds: [7, 8] });
  try {
    const a = sock(env.url); await a.opened; a.send({ t: 'auth', mode: 'guest', seed: 99999 });
    assert.match((await a.until('auth_err')).m, /does not exist/);
    const b = sock(env.url); await b.opened; b.send({ t: 'auth', mode: 'guest', seed: 8 });
    assert.ok(await b.until('welcome'));
    const c = sock(env.url); await c.opened; c.send({ t: 'auth', mode: 'guest' }); // no seed = 7
    assert.ok(await c.until('welcome'));
    assert.equal(env.gs.rooms.size, 2, 'the refused world was never created');
    for (const x of [a, b, c]) x.ws.terminate();
  } finally { await env.gs.stop(); }
});

test('production defaults: the start world plus every Travel Planner world, WORLD_SEEDS overrides', () => {
  assert.deepEqual(parseSeeds(''), DEFAULT_WORLD_SEEDS);
  assert.deepEqual(parseSeeds(undefined), DEFAULT_WORLD_SEEDS);
  assert.deepEqual(parseSeeds('7, 21 ,x'), [7, 21]);
  assert.ok(DEFAULT_WORLD_SEEDS.includes(7), 'existing characters live in world 7');
  for (const w of WORLDS) assert.ok(DEFAULT_WORLD_SEEDS.includes(w.seed), 'the portal offers ' + w.name);
});

test('server-wide player cap', async () => {
  const env = await boot({ maxPlayers: 2 });
  try {
    const cs = [];
    for (let i = 0; i < 3; i++) { const c = sock(env.url); await c.opened; c.send({ t: 'auth', mode: 'guest', seed: 7 }); cs.push(c); await new Promise((r) => setTimeout(r, 120)); }
    assert.ok(await cs[0].until('welcome'));
    assert.ok(await cs[1].until('welcome'));
    assert.match((await cs[2].until('auth_err')).m, /server is full/);
    assert.equal((await (await fetch(env.http + '/health')).json()).maxPlayers, 2);
    cs.forEach((c) => c.ws.terminate());
  } finally { await env.gs.stop(); }
});

test('too many sockets from one network are refused, and slots free up again', async () => {
  const env = await boot({ maxConnsPerIp: 3 });
  try {
    const cs = [];
    for (let i = 0; i < 3; i++) { const c = sock(env.url); await c.opened; cs.push(c); }
    const extra = sock(env.url); await extra.opened;
    assert.equal(await extra.closed, 1013);
    cs[0].ws.close(); await cs[0].closed;
    await new Promise((r) => setTimeout(r, 50));
    const again = sock(env.url); await again.opened;
    again.send({ t: 'auth', mode: 'guest' });
    assert.ok(await again.until('welcome'), 'a freed slot can be used');
    [...cs, again].forEach((c) => c.ws.terminate());
  } finally { await env.gs.stop(); }
});

test('junk on the wire (bad JSON, binary, huge frames, flood) does not hurt the server or other players', async () => {
  const env = await boot();
  try {
    const good = sock(env.url); await good.opened; good.send({ t: 'auth', mode: 'guest' });
    assert.ok(await good.until('welcome'));
    const bad = sock(env.url); await bad.opened;
    bad.ws.send('not json'); bad.ws.send(Buffer.from([0, 255, 3, 7])); bad.ws.send('null'); bad.ws.send('[1,2]'); bad.ws.send('"str"'); bad.ws.send('{"t":"p"}');
    for (let i = 0; i < 200; i++) bad.ws.send(JSON.stringify({ t: 'p', x: Math.random() * 1e12, z: NaN }));
    bad.ws.send('x'.repeat(10000)); // over maxPayload: the server drops this socket
    assert.ok([1009, 1006].includes(await bad.closed));
    good.send({ t: 'chat', m: 'still here' });
    assert.ok(await good.until('chat'));
    assert.equal((await (await fetch(env.http + '/health')).json()).ok, true);
    good.ws.terminate();
  } finally { await env.gs.stop(); }
});

test('snapshots are compressed on the wire by default (Render\'s free plan has very little bandwidth)', async () => {
  const env = await boot();
  try {
    const c = sock(env.url); await c.opened;
    assert.match(String(c.ws.extensions), /permessage-deflate/);
    c.ws.terminate();
  } finally { await env.gs.stop(); }
});
