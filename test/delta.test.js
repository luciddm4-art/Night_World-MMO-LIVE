// Protocol 2 ("d" messages): a client that only applies deltas must always end up with the same picture
// as one that receives full snapshots — while the server says far less.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, makePlayer } from './helpers.js';
import { decodePlayer, decodeRabbit } from '../shared/wire.js';

// What the game page does with a "d" message (see src/main.js): same decoders, same rules.
function applyDelta(mirror, m) {
  if (m.me) mirror.me = m.me;
  if (m.o !== undefined) mirror.o = m.o;
  if (m.f) { mirror.p = {}; mirror.rb = {}; mirror.al = {}; }
  for (const a of m.p || []) { const e = decodePlayer(a); const old = mirror.p[e.id] || {}; mirror.p[e.id] = { ...e, n: e.n ?? old.n, c: e.c ?? old.c }; }
  for (const id of m.pg || []) delete mirror.p[id];
  const gone = (m.rg || []).map((al) => mirror.al[al]);
  for (const a of m.rb || []) { const e = decodeRabbit(a, mirror.al); mirror.rb[e.i] = e; }
  for (const id of gone) delete mirror.rb[id];
}
const fresh = () => ({ me: null, o: null, p: {}, rb: {}, al: {} });
const near = (a, b, tol = 0.051) => Math.abs(a - b) <= tol;

function stepAll(room, now, ms = 100) { now.advance(ms); room.tick(); }

test('delta: first message is a full picture; afterwards a standing-still player costs a fraction of the old snapshots', () => {
  const { room, now } = makeRoom();
  const a = makePlayer(room, 'alice', { x: 100, z: 100 });
  a.v2 = true;
  makePlayer(room, 'bob', { x: 105, z: 100 });
  stepAll(room, now);
  const first = a.last('d');
  assert.equal(first.f, 1);
  assert.equal(first.p.length, 1);
  assert.equal(decodePlayer(first.p[0]).n, 'bob');
  assert.ok(first.me && first.o === 2);
  assert.equal(a.last('s'), undefined, 'v2 players never get the old message');
  // alice and bob stand still while the rabbits wander; compare with what the old protocol would have sent
  a.out.length = 0;
  let bytes = 0, oldBytes = 0;
  for (let i = 0; i < 40; i++) {
    stepAll(room, now);
    for (const m of a.out) { bytes += JSON.stringify(m).length; if (m.p) assert.equal(m.p.length, 0, 'bob has not moved'); }
    a.out.length = 0;
    a.v2 = false; room.sendSnapshots(); a.v2 = true;
    oldBytes += JSON.stringify(a.last('s')).length;
    a.out.length = 0;
  }
  console.log('# standing still, 4 s: new ' + bytes + ' B vs old ' + oldBytes + ' B (' + Math.round((100 * bytes) / oldBytes) + '%)');
  assert.ok(bytes < oldBytes * 0.4, 'new ' + bytes + ' vs old ' + oldBytes);
});

test('delta: a delta-only client matches a full-snapshot client over a busy minute', () => {
  const { room, now } = makeRoom();
  const a = makePlayer(room, 'alice', { x: 100, z: 100 });
  a.v2 = true;
  const b = makePlayer(room, 'bob', { x: 110, z: 100 });
  const c = makePlayer(room, 'carol', { x: 2000, z: 0 }); // far away: walks into range later
  const mirror = fresh();
  let seenRabbits = 0;
  for (let i = 0; i < 600; i++) {
    if (i % 3 === 0) { b.x += Math.cos(i / 20) * 2; b.z += Math.sin(i / 20) * 2; b.r = i / 10; }
    if (i === 100) b.a++;
    if (i === 150) { b.mounted = true; }
    if (i === 250) { c.x = 130; c.z = 100; } // appears
    if (i === 400) { c.x = 2000; } // leaves
    if (i === 450) { for (const r of room.rabbits.values()) { if (Math.abs(r.x - a.x) < 150) { r.hp = 20; break; } } }
    stepAll(room, now);
    for (const m of a.all('d')) applyDelta(mirror, m);
    a.out.length = 0;
    // ground truth: what an old client would be told right now
    a.v2 = false;
    room.sendSnapshots();
    const s = a.last('s');
    a.v2 = true;
    a.out.length = 0;
    const ids = Object.keys(mirror.p).sort();
    assert.deepEqual(ids, s.p.map((e) => String(e.id)).sort(), 'same players at step ' + i);
    for (const e of s.p) {
      const g = mirror.p[e.id], d = Math.hypot(e.x - a.x, e.z - a.z);
      const tol = d <= 35 ? 0.051 : 3; // close players are exact; far ones may lag half a second
      assert.ok(near(g.x, e.x, tol) && near(g.z, e.z, tol) && near(g.y, e.y, tol + 0.06) && near(g.r, e.r, tol), 'player position at step ' + i);
      assert.equal(g.a, e.a); assert.equal(!!g.m, !!e.m); assert.equal(g.w, e.w);
      assert.ok(g.n && g.c, 'name and colour known');
    }
    // rabbits: the fog hides everything beyond ~125 units, so those are not sent any more
    const inReach = s.rb.filter((e) => Math.abs(e.x - a.x) <= 125 && Math.abs(e.z - a.z) <= 125);
    seenRabbits = Math.max(seenRabbits, inReach.length);
    assert.deepEqual(Object.keys(mirror.rb).sort(), inReach.map((e) => String(e.i)).sort(), 'same rabbits at step ' + i);
    for (const e of inReach) {
      const g = mirror.rb[e.i], d = Math.hypot(e.x - a.x, e.z - a.z);
      const tol = d <= 28 ? 0.051 : 2;
      assert.ok(near(g.x, e.x, tol) && near(g.z, e.z, tol), 'rabbit position at step ' + i);
      assert.equal(g.h, e.h); assert.equal(!!g.d, !!e.d); assert.equal(!!g.a, !!e.a);
    }
    assert.equal(mirror.me.hp, s.me.hp);
    assert.equal(mirror.o, s.o);
  }
  assert.ok(seenRabbits >= 3, 'the test saw rabbits: ' + seenRabbits);
});

test('delta: a keyframe (f:1) arrives every 20 s and fixes anything the client lost', () => {
  const { room, now } = makeRoom();
  const a = makePlayer(room, 'alice', { x: 100, z: 100 });
  a.v2 = true;
  makePlayer(room, 'bob', { x: 105, z: 100 });
  stepAll(room, now);
  a.out.length = 0;
  let keys = 0;
  for (let i = 0; i < 450; i++) { stepAll(room, now); keys += a.all('d').filter((m) => m.f).length; a.out.length = 0; }
  assert.equal(keys, 2, '45 s => two more keyframes');
});

test('delta: heartbeat — never silent for more than ~2 s, so the client watchdog stays calm', () => {
  const { room, now } = makeRoom();
  const a = makePlayer(room, 'alice', { x: 100, z: 100 });
  a.v2 = true;
  stepAll(room, now);
  // wipe the rabbits so nothing at all changes
  room.rabbits.clear();
  stepAll(room, now);
  a.out.length = 0;
  let last = now(), gap = 0;
  for (let i = 0; i < 100; i++) {
    stepAll(room, now);
    room.rabbits.clear();
    if (a.out.length) { gap = Math.max(gap, now() - last); last = now(); a.out.length = 0; }
  }
  assert.ok(gap <= 2100, 'longest silence ' + gap + ' ms');
});

test('delta: leaving the area is announced; rejoining starts from a clean slate', () => {
  const { room, now } = makeRoom();
  const a = makePlayer(room, 'alice', { x: 100, z: 100 });
  a.v2 = true;
  const b = makePlayer(room, 'bob', { x: 105, z: 100 });
  stepAll(room, now);
  b.x = 3000;
  a.out.length = 0;
  stepAll(room, now);
  assert.deepEqual(a.last('d').pg, [b.id]);
  // join again (new welcome) => the next message is a keyframe
  room.removePlayer(a);
  room.addPlayer(a);
  a.out.length = 0;
  stepAll(room, now);
  assert.equal(a.last('d').f, 1);
});

test('delta: the donkey recall countdown only changes once a second', () => {
  const { room, now } = makeRoom();
  const a = makePlayer(room, 'alice', { x: 100, z: 100 });
  a.v2 = true;
  a.mountReadyAt = now() + 5000;
  stepAll(room, now);
  a.out.length = 0;
  let withMe = 0;
  for (let i = 0; i < 30; i++) { stepAll(room, now); withMe += a.all('d').filter((m) => m.me).length; a.out.length = 0; }
  assert.ok(withMe <= 5, 'countdown messages in 3 s: ' + withMe);
});

test('delta: old pages (no v:2) still get the full "s" snapshots', () => {
  const { room, now } = makeRoom();
  const a = makePlayer(room, 'alice', { x: 100, z: 100 });
  stepAll(room, now);
  assert.ok(a.last('s') && !a.last('d'));
});
