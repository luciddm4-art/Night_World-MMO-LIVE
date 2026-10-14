import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../shared/world.js';
import { realmOf, FROST, FROST_SEED, T1_REALM, T2_REALM } from '../shared/realm.js';
import { sweep } from '../shared/collision.js';
import { WORLDS } from '../shared/data.js';
import { DEFAULT_WORLD_SEEDS } from '../server/index.js';
import { makeRoom, makePlayer } from './helpers.js';

const w = createWorld(FROST_SEED);

test('Frostfall is the Tier 2 realm of seed 5001, every other seed is Tier 1', () => {
  assert.equal(realmOf(5001), T2_REALM);
  for (const s of [7, 42, 100, 999, 2025, 5002]) assert.equal(realmOf(s), T1_REALM);
  assert.equal(w.realm, T2_REALM);
  assert.equal(createWorld(7).realm, T1_REALM);
  assert.ok(WORLDS.some((x) => x.seed === 5001 && x.name === 'Frostfall'));
  assert.ok(DEFAULT_WORLD_SEEDS.includes(5001));
});

test('the terrain is deterministic and the same on every call', () => {
  const a = createWorld(5001), b = createWorld(5001);
  for (const [x, z] of [[10, 20], [-900, 1300], [2300, -50], [0, 2400]]) assert.equal(a.hgt(x, z), b.hgt(x, z));
  assert.deepEqual(a.ctrees(5, 5), b.ctrees(5, 5));
});

test('the map is 5,000 x 5,000 with a mountain ring at the edge', () => {
  assert.equal(FROST.half, 2500);
  for (const [x, z] of [[0, 2470], [0, -2470], [2470, 0], [-2470, 0], [2450, 2450]]) {
    assert.ok(w.hgt(x, z) > 60, `the edge at ${x},${z} is a mountain (${w.hgt(x, z).toFixed(0)})`);
  }
  let low = 0, ice = 0, n = 0;
  for (let x = -2300; x <= 2300; x += 50) for (let z = -2300; z <= 2300; z += 50) { n++; const h = w.hgt(x, z); if (h <= 0.05) ice++; if (h < 45) low++; }
  assert.ok(low / n > 0.9, 'the inside is hills and cliffs, not mountains');
  assert.ok(ice / n > 0.05 && ice / n < 0.3, 'there are frozen lakes and rivers (' + (ice / n).toFixed(2) + ')');
});

test('the village is a level clearing on the south edge, with nothing growing in it', () => {
  const V = FROST.village;
  for (let a = 0; a < 6.28; a += 0.4) for (const r of [0, 30, 60, 80]) {
    assert.ok(Math.abs(w.hgt(V.x + Math.cos(a) * r, V.z + Math.sin(a) * r) - 0.6) < 0.01);
  }
  assert.ok(FROST.spawn.z > 2200 && FROST.spawn.z < FROST.ringFrom, 'spawn is on the south edge, in front of the mountains');
  assert.equal(T2_REALM.inSafe(V.x, V.z), true);
  assert.equal(T2_REALM.inSafe(0, 0), false);
  for (let cx = -3; cx <= 3; cx++) for (let cz = 68; cz <= 76; cz++) {
    for (const f of [w.ctrees(cx, cz)]) for (let i = 0; i < f.length; i += 3) assert.ok(!T2_REALM.inSafe(f[i], f[i + 1]));
    for (const r of w.crabbits(cx, cz)) assert.ok(!T2_REALM.inSafe(r.x, r.z));
    for (const nd of w.cres(cx, cz)) assert.ok(!T2_REALM.inSafe(nd.x, nd.z));
  }
});

test('trees and nodes never stand on ice or up in the mountains', () => {
  for (let cx = -60; cx <= 60; cx += 3) for (let cz = -60; cz <= 60; cz += 3) {
    const t = w.ctrees(cx, cz);
    for (let i = 0; i < t.length; i += 3) { const h = w.hgt(t[i], t[i + 1]); assert.ok(h >= 0.4 && h <= 26, 'tree height ' + h); }
    for (const nd of w.cres(cx, cz)) assert.ok(w.hgt(nd.x, nd.z) >= 0.4);
  }
  // ids still resolve for the server's gather checks
  const t = w.ctrees(10, 10);
  if (t.length) assert.deepEqual(w.treeAt('10,10,0'), { x: t[0], z: t[1], s: t[2] });
});

test('the invisible wall stops walking at the map edge, and the portal base is solid', () => {
  const none = () => false;
  const s = sweep(w, none, 0, 2400, 0, 2600);
  assert.ok(s.blocked && s.z < FROST.wall + 0.1 && s.z > FROST.wall - 2, 'stopped at the wall: z = ' + s.z);
  const e = sweep(w, none, 2300, 0, 2600, 0);
  assert.ok(e.blocked && e.x <= FROST.wall + 0.1);
  assert.equal(T2_REALM.solid(FROST.portal.x, FROST.portal.z, 0), false);
  assert.equal(T2_REALM.solid(0, 2300, 0), true);
  // the start world is unchanged: no wall at 2500
  assert.equal(sweep(createWorld(7), none, 0, 2400, 0, 2600).blocked, false);
});

test('players spawn in the Frostfall village and are kept inside the map', () => {
  const { room, now } = makeRoom(5001);
  const p = makePlayer(room, 'Snowy');
  p.setSpawn(room.rng, room.realm.spawn); // (this is what the server does when someone joins)
  assert.ok(Math.abs(p.x - FROST.spawn.x) <= FROST.spawn.spread / 2 + 0.01 && p.z === FROST.spawn.z);
  p.x = 0; p.z = 2460;
  for (let i = 0; i < 40; i++) { now.advance(100); room.onPos(p, { x: 0, z: 2520 + i, r: 0 }); }
  assert.ok(p.z <= FROST.wall + 0.5, 'cannot leave the map: z = ' + p.z);
  assert.equal(room.teleport(p, 0, 2600), null);
  assert.ok(room.teleport(p, 0, 2400));
});
