import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, makePlayer } from './helpers.js';
import { CFG, TOWN, HOUSES, PORTAL, PORTAL_SAFE, SPAWN, STATIONS, STATION_Z, STATION_RANGE, inSafeZone } from '../shared/data.js';
import { courtFree, isFree, sweep } from '../shared/collision.js';
import { createWorld } from '../shared/world.js';
import { Player } from '../server/player.js';

const H = TOWN.half;

test('town: walls are solid, every gate is open, corner towers are solid', () => {
  for (const s of [-1, 1]) {
    assert.equal(courtFree(20, s * H), false, 'north/south wall');
    assert.equal(courtFree(s * H, 20), false, 'east/west wall');
    assert.equal(courtFree(0, s * H), true, 'gate in the middle of the N/S wall');
    assert.equal(courtFree(s * H, 0), true, 'gate in the middle of the E/W wall');
    assert.equal(courtFree(s * (TOWN.gate - 0.5), s * H), true, 'gate is 14 wide');
    assert.equal(courtFree(s * (TOWN.gate + 0.5), s * H), false);
    for (const t of [-1, 1]) assert.equal(courtFree(s * H, t * H), false, 'tower');
  }
  assert.equal(courtFree(H + 6, 20), true, 'outside the wall is open country');
});

test('town: you can walk from the gate to the Hall, and from the plaza into the Hall', () => {
  const world = createWorld(7), up = () => true;
  // straight down each street, from outside the gate to the Hall's walls (the south road bends round the fountain)
  for (const [x0, z0, x1, z1] of [[5, H + 10, 5, 16], [0, -H - 10, 0, -16], [H + 10, 0, 16, 0], [-H - 10, 0, -16, 0]]) {
    const sw = sweep(world, up, x0, z0, x1, z1, 0.3);
    assert.equal(sw.blocked, false, `gate path from ${x0},${z0}`);
  }
  assert.equal(sweep(world, up, SPAWN.x, SPAWN.z, 0, -3, 0.3).blocked, false, 'through the Hall door');
  for (const st of STATIONS) assert.equal(courtFree(st.x, STATION_Z + 3), true, st.k + ' counter is reachable');
});

test('town: houses and the fountain are solid, streets stay clear, nothing overlaps', () => {
  for (const h of HOUSES) {
    assert.equal(courtFree(h.x, h.z), false, 'house at ' + h.x + ',' + h.z);
    assert.equal(courtFree(h.x + h.w / 2 + 0.3, h.z), true, 'just outside');
    // streets (|x| < 8 or |z| < 8) are clear, and the Hall (|x|,|z| < 14) is not covered
    const minX = Math.min(Math.abs(h.x - h.w / 2), Math.abs(h.x + h.w / 2)), minZ = Math.min(Math.abs(h.z - h.d / 2), Math.abs(h.z + h.d / 2));
    assert.ok(minX >= 8 && minZ >= 8, 'off the streets');
    assert.ok(Math.max(minX, minZ) > 14, 'clear of the Hall');
    assert.ok(Math.max(Math.abs(h.x) + h.w / 2, Math.abs(h.z) + h.d / 2) < H - 1, 'inside the wall');
    for (const o of HOUSES) {
      if (o === h) continue;
      assert.ok(Math.abs(h.x - o.x) >= (h.w + o.w) / 2 || Math.abs(h.z - o.z) >= (h.d + o.d) / 2, 'houses do not overlap');
    }
  }
  assert.equal(courtFree(TOWN.fountain.x, TOWN.fountain.z), false);
  assert.equal(courtFree(0, TOWN.fountain.z + TOWN.fountain.r + 1), true);
  assert.equal(courtFree(SPAWN.x, SPAWN.z), true, 'spawn is free');
  for (const dx of [-SPAWN.spread / 2, SPAWN.spread / 2]) assert.equal(courtFree(SPAWN.x + dx, SPAWN.z), true, 'whole spawn strip is free');
});

test('town: no trees, resource nodes, rabbit spawns or hills inside the walls or at the portal', () => {
  for (const seed of [7, 42, 100, 999, 2025]) {
    const w = createWorld(seed);
    const check = (x0, z0, r, label) => {
      for (let cx = Math.floor((x0 - r) / CFG.CS); cx <= Math.floor((x0 + r) / CFG.CS); cx++) {
        for (let cz = Math.floor((z0 - r) / CFG.CS); cz <= Math.floor((z0 + r) / CFG.CS); cz++) {
          const t = w.ctrees(cx, cz);
          for (let i = 0; i < t.length; i += 3) assert.equal(inSafeZone(t[i], t[i + 1]), false, `${label}: tree in safe zone (seed ${seed})`);
          for (const n of w.cres(cx, cz)) assert.equal(inSafeZone(n.x, n.z), false, label + ': node');
          for (const r2 of w.crabbits(cx, cz)) assert.equal(inSafeZone(r2.x, r2.z), false, label + ': rabbit');
        }
      }
    };
    check(0, 0, 90, 'town');
    check(PORTAL.x, PORTAL.z, 60, 'portal');
    for (let x = -64; x <= 64; x += 8) for (let z = -64; z <= 64; z += 8) assert.ok(Math.abs(w.hgt(x, z)) < 1e-9, 'flat town ground');
    for (let a = 0; a < 6.3; a += 0.7) assert.ok(Math.abs(w.hgt(PORTAL.x + Math.cos(a) * 18, PORTAL.z + Math.sin(a) * 18)) < 1e-9, 'flat portal clearing');
  }
  // and there is plenty of forest just outside
  const w = createWorld(7);
  let trees = 0;
  for (let cx = 2; cx < 8; cx++) for (let cz = 2; cz < 8; cz++) trees += w.ctrees(cx, cz).length / 3;
  assert.ok(trees > 50, 'forest outside the town: ' + trees);
});

test('portal: due south, about 8 minutes by galloping donkey and 12 on foot from the spawn plaza', () => {
  assert.equal(PORTAL.x, 0);
  assert.ok(PORTAL.z > 0, 'south of the town, away from the main gate on the north side');
  const dist = Math.hypot(PORTAL.x - SPAWN.x, PORTAL.z - SPAWN.z);
  const g = CFG.GALLOP_AFTER_MS / 1000; // 3 s at 8.4 units/s, then 9.24
  const donkeyMin = (g + (dist - g * CFG.RIDE_SPEED) / (CFG.RIDE_SPEED * CFG.GALLOP_MULT)) / 60, walkMin = dist / CFG.WALK_SPEED / 60;
  assert.ok(donkeyMin > 7.8 && donkeyMin < 8.2, 'donkey: ' + donkeyMin.toFixed(2) + ' min');
  assert.ok(walkMin > 12 && walkMin < 12.6, 'walking: ' + walkMin.toFixed(2) + ' min');
  assert.equal(CFG.WALK_SPEED, 6);
  assert.equal(CFG.RIDE_SPEED, 8.4);
  assert.ok(Math.abs(CFG.RIDE_SPEED - CFG.WALK_SPEED * 1.4) < 1e-9, 'the donkey is 40% faster than walking');
  assert.equal(courtFree(PORTAL.x, PORTAL.z), false, 'the portal base is solid');
  assert.equal(courtFree(PORTAL.x, PORTAL.z - 4), true);
  assert.ok(PORTAL_SAFE >= 30);
});

test('stations: still in range of the Hall counters', () => {
  assert.ok(STATION_RANGE > 2 && STATIONS.length === 4);
});

test('saves: a character saved inside something that is now solid is moved to the plaza', () => {
  const { room } = makeRoom();
  const p = new Player({ id: 'old', name: 'old', send: () => {} });
  p.x = HOUSES[0].x; p.z = HOUSES[0].z; // standing inside a house
  p.mounted = true;
  assert.equal(room.ensureStandable(p), true);
  assert.equal(Math.abs(p.x - SPAWN.x) <= SPAWN.spread / 2, true);
  assert.equal(p.z, SPAWN.z);
  assert.equal(p.mounted, false);
  const q = new Player({ id: 'ok', name: 'ok', send: () => {} });
  q.x = 100; q.z = 100;
  assert.equal(room.ensureStandable(q), false, 'free positions are left alone');
});

test('new players spawn on the plaza outside the Hall', () => {
  const { room } = makeRoom();
  const p = new Player({ id: 'n', name: 'n', send: () => {} });
  p.setSpawn(() => 0.5);
  room.addPlayer(p);
  assert.equal(p.z, SPAWN.z);
  assert.ok(isFree(room.world, () => true, p.x, p.z));
});
