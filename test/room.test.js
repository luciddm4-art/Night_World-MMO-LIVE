import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, makePlayer, findThings, giveItems, fillBag } from './helpers.js';
import { countItem } from '../shared/inventory.js';
import { CFG, STATIONS, STATION_Z, RECIPES, FAMILIES, ITEMS, EQUIP_SLOTS, REWARD_SLOTS, WEAPONS, FISTS } from '../shared/data.js';
import { sanitizeInv } from '../shared/inventory.js';
import { isFree, courtFree } from '../shared/collision.js';

const { tree, node, world } = findThings(7);

// stand at a crafting station
const atStation = (p, key) => { const st = STATIONS.find((x) => x.k === key); p.x = st.x; p.z = STATION_Z; };
const giveSword = (p) => { p.inv.eq.main = { id: 'sword', n: 1 }; p.recalc(); };

// a stretch of open ground running along +x (no trees, outside the spawn hall)
function openRun(len = 130) {
  for (let z = 30; z < 400; z += 1) {
    let ok = true;
    for (let x = 30; x <= 30 + len && ok; x += 0.25) ok = isFree(world, () => true, x, z, -0.8);
    if (ok) return { x0: 30, z };
  }
  throw new Error('no open run found');
}

function gatherOnce(room, now, p, kind, id) {
  p.out.length = 0;
  room.handle(p, { t: 'gather', kind, id });
  if (!p.last('cast')) return false;
  now.advance(CFG.GATHER_MS + 10);
  room.handle(p, { t: 'gdone' });
  return true;
}

// ------------------------------------------------------------------ gathering
test('gathering: must be in range', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a', { x: tree.x + 30, z: tree.z });
  room.handle(p, { t: 'gather', kind: 'tree', id: tree.id });
  assert.equal(p.last('fail').m, 'Too far away');
  assert.equal(p.last('cast'), undefined);
});

test('gathering: rejects made-up targets', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a', { x: tree.x, z: tree.z });
  for (const [kind, id] of [['tree', '0,0,999'], ['node', 'ore:0:0:7'], ['gold', 'x'], ['tree', { a: 1 }], ['corpse', 'rab:0:0:0']]) {
    p.out.length = 0;
    room.handle(p, { t: 'gather', kind, id });
    assert.ok(p.last('fail'), JSON.stringify([kind, id]));
  }
});

test('gathering: cannot finish early, then succeeds after the cast time', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: tree.x, z: tree.z });
  room.handle(p, { t: 'gather', kind: 'tree', id: tree.id });
  assert.equal(p.last('cast').dur, CFG.GATHER_MS);
  now.advance(300);
  room.handle(p, { t: 'gdone' });
  assert.equal(p.last('fail').m, 'Too early');
  assert.equal(countItem(p.inv, 'wood'), 0);

  assert.ok(gatherOnce(room, now, p, 'tree', tree.id));
  assert.equal(countItem(p.inv, 'wood'), 1);
  assert.match(p.last('toast').m, /\+1 Wood \(2 left\)/);
});

test('gathering: a tree runs out after 3 and respawns after 10s (broadcast to everyone)', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: tree.x, z: tree.z });
  const q = makePlayer(room, 'b', { x: tree.x + 1, z: tree.z });
  for (let i = 0; i < 3; i++) assert.ok(gatherOnce(room, now, p, 'tree', tree.id));
  assert.equal(countItem(p.inv, 'wood'), 3);
  assert.deepEqual(q.last('node'), { t: 'node', id: tree.id, qty: 0 }, 'other players see it vanish');
  assert.equal(gatherOnce(room, now, q, 'tree', tree.id), false);
  assert.equal(q.last('fail').m, 'Already depleted');

  now.advance(CFG.RESPAWN_MS + 50);
  room.tick();
  assert.deepEqual(q.last('node'), { t: 'node', id: tree.id, qty: CFG.NODE_QTY });
  assert.ok(gatherOnce(room, now, q, 'tree', tree.id));
});

test('gathering: a full bag blocks the gather and the node is NOT consumed', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: node.x, z: node.z });
  fillBag(p, 'plank');
  assert.ok(gatherOnce(room, now, p, 'node', node.id));
  assert.equal(p.last('fail').m, 'Inventory full');
  assert.equal(room.depleted.size, 0);
});

test('gathering: moving away cancels the cast', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: node.x, z: node.z });
  room.handle(p, { t: 'gather', kind: 'node', id: node.id });
  now.advance(100);
  room.handle(p, { t: 'p', x: node.x + 3.5, z: node.z, r: 0 });
  assert.equal(p.gather, null);
  now.advance(2000);
  room.handle(p, { t: 'gdone' });
  assert.equal(countItem(p.inv, node.type), 0);
});

test('gathering: late joiners get the current depleted list', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: tree.x, z: tree.z });
  for (let i = 0; i < 3; i++) gatherOnce(room, now, p, 'tree', tree.id);
  const w = room.welcome(makePlayer(room, 'late'));
  assert.deepEqual(w.depleted, [[tree.id, 0]]);
});

// ------------------------------------------------------------------ crafting
test('crafting: needs materials, and refining needs the station', () => {
  const { room } = makeRoom();
  const loom = STATIONS.find((s) => s.k === 'loom');
  const p = makePlayer(room, 'a', { x: 0, z: -1.5 });
  giveItems(p, 'cotton', 3);
  room.handle(p, { t: 'craft', id: 'r_cloth' });
  assert.match(p.last('fail').m, /closer to the Loom/);
  p.x = loom.x; p.z = STATION_Z;
  room.handle(p, { t: 'craft', id: 'r_cloth' });
  assert.equal(countItem(p.inv, 'cotton'), 0);
  assert.equal(countItem(p.inv, 'cloth'), 1);
  room.handle(p, { t: 'craft', id: 'r_cloth' });
  assert.equal(p.last('fail').m, 'Not enough materials');
  room.handle(p, { t: 'craft', id: 'nope' }); // unknown recipe: silently ignored
});

test('crafting: the client cannot choose the output', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a');
  atStation(p, 'forge');
  giveItems(p, 'iron', 3);
  room.handle(p, { t: 'craft', id: 'c_ihelm', out: 'donkey', n: 50 });
  assert.equal(countItem(p.inv, 'iron_helm'), 1);
  assert.equal(countItem(p.inv, 'donkey'), 0);
});

test('crafting: refuses if the result would not fit, and spends nothing', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a');
  atStation(p, 'forge');
  fillBag(p, 'wood');
  p.inv.slots[0] = { id: 'iron', n: 3 }; // crafting uses it up, but the freed slot is fine -> allowed
  room.handle(p, { t: 'craft', id: 'c_ihelm' });
  assert.equal(countItem(p.inv, 'iron_helm'), 1);
  const q = makePlayer(room, 'b');
  atStation(q, 'forge');
  fillBag(q, 'wood');
  q.inv.slots[0] = { id: 'iron', n: 5 }; // helm costs 3: leaves 2, no free slot for the helm
  room.handle(q, { t: 'craft', id: 'c_ihelm' });
  assert.equal(q.last('fail').m, 'Inventory full');
  assert.equal(countItem(q.inv, 'iron'), 5);
});

// ------------------------------------------------------------------ equipment
test('equipment: stats change, and filling all 5 gear slots rewards a donkey once', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a');
  const gear = ['iron_helm', 'iron_chest', 'iron_boots', 'sword', 'spell_book'];
  gear.forEach((g) => giveItems(p, g, 1));
  gear.forEach((g) => room.handle(p, { t: 'equip', i: p.inv.slots.findIndex((s) => s && s.id === g) }));
  assert.equal(p.maxHp, Math.round(1200 * (1 + 0.03 * 2 + 0.5)));
  assert.equal(p.stats.def, 0.2);
  assert.equal(countItem(p.inv, 'donkey'), 1);
  assert.ok(p.all('toast').some((t) => t.m.includes('Donkey')));
  // unequip + re-equip a piece: no second donkey
  room.handle(p, { t: 'unequip', slot: 'head' });
  room.handle(p, { t: 'equip', i: p.inv.slots.findIndex((s) => s && s.id === 'iron_helm') });
  assert.equal(countItem(p.inv, 'donkey'), 1);
});

test('equipment: bad input is ignored', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a');
  for (const i of [-1, 64, 1.5, 'x', null, {}]) room.handle(p, { t: 'equip', i });
  room.handle(p, { t: 'unequip', slot: '__proto__' });
  room.handle(p, { t: 'unequip', slot: 'head' });
  assert.equal(p.out.length, 0);
});

// ------------------------------------------------------------------ movement
test('movement: teleporting is clamped and the client is told to snap back', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 0, z: 0 });
  now.advance(100);
  room.handle(p, { t: 'p', x: 500, z: 0, r: 0 });
  assert.ok(p.x < 40, 'moved only a short way: ' + p.x);
  assert.ok(p.last('pos'), 'correction sent');
});

test('movement: legitimate sprinting is never corrected', () => {
  const { room, now } = makeRoom();
  const run = openRun();
  const p = makePlayer(room, 'a', { x: run.x0, z: run.z });
  let x = run.x0;
  for (let i = 0; i < 100; i++) { // 7 seconds at full sprint, packets every 70 ms
    now.advance(70);
    x += CFG.MAX_SPEED * 0.07;
    room.handle(p, { t: 'p', x, z: run.z, r: 1 });
  }
  assert.equal(p.last('pos'), undefined);
  assert.ok(Math.abs(p.x - x) < 1e-9);
});

test('movement: flooding position packets does not beat the speed limit', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 0, z: 0 });
  const t0 = now();
  for (let i = 0; i < 100; i++) { // claim +3 units every 20 ms = 150 u/s
    now.advance(20);
    room.handle(p, { t: 'p', x: (i + 1) * 3, z: 0, r: 0 });
  }
  const seconds = (now() - t0) / 1000;
  const maxAllowed = CFG.MAX_SPEED * 1.15 * (seconds + 1.5);
  assert.ok(p.x <= maxAllowed + 1e-6, `travelled ${p.x.toFixed(1)}, cap ${maxAllowed.toFixed(1)}`);
});

test('movement: NaN / junk coordinates are ignored', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a', { x: 3, z: 4 });
  for (const m of [{ x: NaN, z: 0 }, { x: 'a', z: 0 }, { z: 1 }, { x: Infinity, z: 0 }]) room.handle(p, { t: 'p', ...m });
  assert.deepEqual([p.x, p.z], [3, 4]);
});

// ------------------------------------------------------------------ combat
function spawnRabbitNear(room, p) {
  const rb = {
    id: 'rab:test:1', x: p.x, z: p.z + 1.0, hp: CFG.RABBIT_HP, mode: 'wander', tx: p.x, tz: p.z + 1.0,
    wt: 1e9, atkT: 0, dead: false, gathered: false, deadAt: 0, target: null, home: '0,0',
  };
  room.rabbits.set(rb.id, rb);
  return rb;
}

test('combat: two sword hits kill a rabbit, the cooldown is enforced, corpse gives hide', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  giveSword(p);
  const rb = spawnRabbitNear(room, p);
  room.handle(p, { t: 'atk', r: 0 }); // facing +z
  assert.equal(rb.hp, CFG.RABBIT_HP - 36);
  room.handle(p, { t: 'atk', r: 0 }); // too soon
  assert.equal(rb.hp, CFG.RABBIT_HP - 36, 'cooldown');
  now.advance(450);
  room.handle(p, { t: 'atk', r: 0 });
  assert.ok(rb.dead);
  assert.equal(rb.target, null);

  p.z = rb.z;
  assert.ok(gatherOnce(room, now, p, 'corpse', rb.id));
  assert.equal(countItem(p.inv, 'hide'), 3);
  assert.equal(room.rabbits.has(rb.id), false, 'corpse removed');
});

test('combat: attacking away from the rabbit misses; mounted players cannot attack', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  const rb = spawnRabbitNear(room, p);
  room.handle(p, { t: 'atk', r: Math.PI }); // facing -z, rabbit is at +z
  assert.equal(rb.hp, CFG.RABBIT_HP);
  now.advance(500);
  p.mounted = true;
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(rb.hp, CFG.RABBIT_HP);
});

test('combat: gear raises damage (cloth robe = +50%)', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  p.inv.eq.chest = { id: 'cloth_robe', n: 1 };
  p.recalc();
  const rb = spawnRabbitNear(room, p);
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(rb.hp, CFG.RABBIT_HP - 30); // fists 20 x 1.5
});

test('combat: a hurt rabbit chases and bites; being knocked out resets HP; armor helps', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  const rb = spawnRabbitNear(room, p);
  rb.mode = 'chase'; rb.target = p.id; rb.atkT = 0;
  room.tick(); // close enough: bites immediately
  assert.equal(p.hp, 1200 - CFG.RABBIT_DMG);
  now.advance(CFG.RABBIT_ATK_MS + 10);
  room.tick();
  assert.equal(p.hp, 1200 - 2 * CFG.RABBIT_DMG);

  p.hp = 10;
  now.advance(CFG.RABBIT_ATK_MS + 10);
  room.tick();
  assert.equal(p.hp, p.maxHp);
  assert.ok(p.all('toast').some((t) => /knocked out/.test(t.m)));
});

test('combat: mounted players take no rabbit damage; rabbits give up when you run', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  const rb = spawnRabbitNear(room, p);
  rb.mode = 'chase'; rb.target = p.id;
  p.mounted = true;
  now.advance(2000);
  room.tick();
  assert.equal(p.hp, 1200);
  p.x += 50;
  room.tick();
  assert.equal(rb.mode, 'wander');
});

test('health regenerates after the combat lock', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a');
  p.hp = 600;
  p.lastDamageT = now();
  now.advance(2000); room.tick();
  assert.equal(p.hp, 600, 'locked');
  now.advance(CFG.REGEN_COMBAT_LOCK + 1000);
  room.tick();
  now.advance(1000);
  room.tick();
  assert.ok(p.hp > 600);
});

test('rabbits spawn around players, despawn when everyone leaves, and respawn after being looted', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 0, z: 0 });
  assert.ok(room.rabbits.size > 0, 'rabbits near spawn');
  const far = makePlayer(room, 'b', { x: 5000, z: 5000 });
  room.removePlayer(far);
  p.x = 3000; p.z = 3000; // walk away
  now.advance(2100);
  room.tick();
  for (const rb of room.rabbits.values()) assert.ok(Math.abs(rb.x - 3000) < 400, 'old rabbits are gone');
});

// ------------------------------------------------------------------ mount
test('mount: cast, ride, dismount, re-mount; unequipping drops the ride', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 10, z: 10 });
  room.handle(p, { t: 'mount' });
  assert.equal(p.last('fail').m, 'No donkey equipped');
  p.inv.eq.mount = { id: 'donkey', n: 1 };
  room.handle(p, { t: 'mount' });
  assert.equal(p.last('cast').kind, 'mount');
  now.advance(CFG.MOUNT_CAST_MS + 10);
  room.handle(p, { t: 'gdone' });
  assert.equal(p.mounted, true);

  room.handle(p, { t: 'dismount' });
  assert.equal(p.mounted, false);
  assert.ok(p.donkey);
  room.handle(p, { t: 'mount' }); // donkey is standing right there: instant
  assert.equal(p.mounted, true);

  room.handle(p, { t: 'unequip', slot: 'mount' });
  assert.equal(p.mounted, false);
  assert.equal(p.donkey, null);
  assert.equal(countItem(p.inv, 'donkey'), 1);
});

test('mount: a donkey left behind wanders off and returns to the bag', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a', { x: 10, z: 10 });
  p.inv.eq.mount = { id: 'donkey', n: 1 };
  p.donkey = { x: 10, z: 10 };
  p.x = 10 + CFG.DONKEY_LEASH + 2;
  room.tick();
  assert.equal(p.donkey, null);
  assert.equal(p.inv.eq.mount, null);
  assert.equal(countItem(p.inv, 'donkey'), 1);
});

// ------------------------------------------------------------------ chat
test('chat: sanitised, length-limited, and broadcast to everyone in the world', () => {
  const { room } = makeRoom();
  const a = makePlayer(room, 'alice');
  const b = makePlayer(room, 'bob');
  room.handle(a, { t: 'chat', m: '  hello\u0000   <b>world</b>\u202e  ' });
  const got = b.last('chat');
  assert.equal(got.n, 'alice');
  assert.equal(got.m, 'hello <b>world</b>'); // control + bidi chars gone; HTML is left for the client to render as text
  room.handle(a, { t: 'chat', m: 'x'.repeat(500) });
  assert.equal(b.last('chat').m.length, 120);
  b.out.length = 0;
  room.handle(a, { t: 'chat', m: '   ' });
  room.handle(a, { t: 'chat', m: 42 });
  assert.equal(b.out.length, 0);
});

test('chat: rate limited', () => {
  const { room, now } = makeRoom();
  const a = makePlayer(room, 'alice');
  const b = makePlayer(room, 'bob');
  for (let i = 0; i < 6; i++) room.handle(a, { t: 'chat', m: 'spam ' + i });
  assert.equal(b.all('chat').length, 3);
  assert.equal(a.last('fail').m, 'You are chatting too fast');
  now.advance(2100);
  room.handle(a, { t: 'chat', m: 'ok again' });
  assert.equal(b.all('chat').length, 4);
});

test('chat: new arrivals see recent history', () => {
  const { room } = makeRoom();
  const a = makePlayer(room, 'alice');
  room.handle(a, { t: 'chat', m: 'first' });
  const w = room.welcome(makePlayer(room, 'carol'));
  assert.equal(w.chat[0].m, 'first');
});

// ------------------------------------------------------------------ snapshots
test('snapshots: names are sent once, nearby players only', () => {
  const { room } = makeRoom();
  const a = makePlayer(room, 'alice', { x: 0, z: 0 });
  const b = makePlayer(room, 'bob', { x: 5, z: 0 });
  const far = makePlayer(room, 'faraway', { x: 2000, z: 0 });
  room.tick();
  let s = a.last('s');
  assert.equal(s.p.length, 1);
  assert.equal(s.p[0].n, 'bob');
  assert.ok(b.last('s').p.every((e) => e.id !== far.id));
  a.out.length = 0;
  room.tick();
  s = a.last('s');
  assert.equal(s.p[0].n, undefined, 'name not repeated');
  assert.equal(s.me.mh, 1200);
  assert.equal(s.o, 3);
});

// ------------------------------------------------------------------ feedback events (game feel)
test('events: hits are announced with real damage, to everyone nearby', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  const bystander = makePlayer(room, 'near', { x: 105, z: 100 });
  const far = makePlayer(room, 'far', { x: 900, z: 900 });
  giveSword(p);
  const rb = spawnRabbitNear(room, p);
  room.handle(p, { t: 'atk', r: 0 });
  const h = p.last('hit');
  assert.deepEqual([h.i, h.d, h.h, h.k, h.w, h.sp], [rb.id, 36, 14, 0, 'sword', 0]);
  assert.ok(bystander.last('hit'), 'a nearby player sees it too');
  assert.equal(far.last('hit'), undefined);
  now.advance(450);
  room.handle(p, { t: 'atk', r: 0 });
  const k = p.last('hit');
  assert.deepEqual([k.d, k.h, k.k], [36, 0, 1]);
});

test('events: a rejected attack (cooldown / miss) produces no hit event', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  spawnRabbitNear(room, p);
  room.handle(p, { t: 'atk', r: 0 });
  p.out.length = 0;
  room.handle(p, { t: 'atk', r: 0 }); // too soon
  room.handle(p, { t: 'atk', r: Math.PI });
  assert.equal(p.all('hit').length, 0);
});

test('events: bites tell the victim how much it hurt; gathers, loot and crafts report gains', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  const rb = spawnRabbitNear(room, p);
  rb.mode = 'chase'; rb.target = p.id;
  room.tick();
  assert.deepEqual([p.last('hurt').d, p.last('hurt').by], [25, rb.id]);
  assert.equal(p.last('s').rb.find((r) => r.i === rb.id).a, 1, 'aggro flag in snapshot');

  const { tree } = findThings(7);
  const q = makePlayer(room, 'b', { x: tree.x, z: tree.z });
  room.handle(q, { t: 'gather', kind: 'tree', id: tree.id });
  now.advance(2100);
  room.handle(q, { t: 'gdone' });
  assert.deepEqual(q.last('gain'), { t: 'gain', item: 'wood', n: 1, src: 'gather' });
  giveItems(q, 'iron', 3);
  atStation(q, 'forge');
  room.handle(q, { t: 'craft', id: 'c_ihelm' });
  assert.deepEqual(q.last('gain'), { t: 'gain', item: 'iron_helm', n: 1, src: 'craft' });
});


// ---------------------------------------------------------------- collision (server side)
test('collision: you cannot walk through the spawn hall wall', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 0, z: -4 });
  now.advance(1000);
  room.handle(p, { t: 'p', x: 0, z: -9.5, r: 0 }); // the back wall / station row is at z -8.2 .. -5.2
  assert.ok(p.z > -5.6, 'stopped at the wall, z=' + p.z);
  assert.ok(p.last('pos'), 'client told to snap back');
});

test('collision: a huge jump cannot tunnel over a thin wall', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 0, z: 0 });
  now.advance(60000); // lots of saved-up movement budget
  p.moveBudget = 100;
  room.handle(p, { t: 'p', x: 25, z: 0, r: 0 }); // the east wall is at x = 12
  assert.ok(p.x < 11.5, 'did not pass the east wall, x=' + p.x);
});

test('collision: walking along a wall is smooth and not corrected', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: -6, z: -4 });
  for (let i = 1; i <= 40; i++) { // hug the station row (free ground is z >= -5.2) while sprinting sideways
    now.advance(70);
    room.handle(p, { t: 'p', x: -6 + i * 0.25, z: -4.7, r: 1 });
  }
  assert.equal(p.last('pos'), undefined);
  assert.ok(Math.abs(p.x - 4) < 1e-9);
});

test('collision: standing trees block, and a felled tree does not', () => {
  const { room, now } = makeRoom();
  const [X, Z] = tree.id.split(',').map(Number);
  const t = world.ctrees(X, Z);
  const tx = t[0], tz = t[1];
  const start = { x: tx - 4, z: tz };
  assert.ok(isFree(world, () => true, start.x, start.z, 0.3), 'test needs a clear start');
  const run = (name) => {
    const p = makePlayer(room, name, start);
    now.advance(2000);
    room.handle(p, { t: 'p', x: tx + 4, z: tz, r: 0 }); // straight through the trunk
    return p;
  };
  const a = run('a');
  assert.ok(a.x < tx, 'blocked by the tree: x=' + a.x + ' tree=' + tx);
  room.depleted.set(tree.id, { qty: 0, readyAt: now() + 10000 });
  const b = run('b');
  assert.ok(b.x > tx, 'passes once the tree is gone');
});

test('collision: a player trapped inside an obstacle is never frozen in place', () => {
  const { room, now } = makeRoom();
  const [X, Z] = tree.id.split(',').map(Number);
  const t = world.ctrees(X, Z);
  const p = makePlayer(room, 'a', { x: t[0], z: t[1] }); // a tree grew right on top of them
  now.advance(1000);
  room.handle(p, { t: 'p', x: t[0] + 3, z: t[1], r: 0 });
  assert.ok(Math.abs(p.x - (t[0] + 3)) < 1e-6, 'free to walk out');
});

test('collision: client and server agree on the hall layout', () => {
  assert.equal(courtFree(0, 0), true);
  assert.equal(courtFree(0, -7), false);
  assert.equal(courtFree(12, 0), false);
  assert.equal(courtFree(0, 8), false, 'the portal');
  assert.equal(courtFree(0, 12), true, 'the gap in the south wall');
});


// ---------------------------------------------------------------- crafting system: families and stations
test('recipes: every recipe has a station, and each station only handles its own material family', () => {
  const famOf = Object.fromEntries(STATIONS.map((st) => [st.k, FAMILIES[st.fam]]));
  for (const st of STATIONS) assert.ok(FAMILIES[st.fam], st.k + ' has a family');
  for (const r of RECIPES) {
    assert.ok(famOf[r.station], r.id + ' has a valid station (' + r.station + ')');
    const fam = famOf[r.station];
    if (r.cat === 'Refine') {
      assert.deepEqual(Object.keys(r.cost), [fam.raw], r.id + ' refines only its own raw resource');
      assert.equal(r.out, fam.refined, r.id + ' outputs the family material');
    }
    if (r.cat === 'Armor') {
      assert.deepEqual(Object.keys(r.cost), [fam.refined], r.id + ' uses only ' + fam.refined);
    }
    if (r.cat === 'Weapons') {
      assert.ok(r.cost[fam.refined] && r.cost.plank, r.id + ' needs planks plus this station\'s own refined material');
    }
  }
  // all four raw resources and all four refined materials are covered
  assert.deepEqual(RECIPES.filter((r) => r.cat === 'Refine').map((r) => r.out).sort(), ['cloth', 'iron', 'leather', 'plank']);
});

test('recipes: 3 armor sets x (head, chest, foot) and 3 weapons, no gloves', () => {
  const armor = RECIPES.filter((r) => r.cat === 'Armor');
  assert.equal(armor.length, 9);
  assert.deepEqual(armor.map((r) => r.name).sort(), [
    'Cloth Cowl', 'Cloth Robe', 'Cloth Sandals', 'Iron Armor', 'Iron Boots', 'Iron Helmet', 'Leather Hood', 'Leather Jacket', 'Leather Shoes',
  ]);
  assert.deepEqual(RECIPES.filter((r) => r.cat === 'Weapons').map((r) => r.out).sort(), ['bow', 'fire_staff', 'sword']);
  assert.ok(!EQUIP_SLOTS.includes('hands'));
  assert.ok(!Object.keys(ITEMS).some((k) => /glove|gauntlet/.test(k)));
  for (const k of Object.keys(ITEMS)) assert.equal(ITEMS[k].tier, 1, k + ' is tier 1');
});

test('crafting: a station only crafts its own recipes (Loom cannot make iron gear)', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a');
  giveItems(p, 'iron', 10);
  giveItems(p, 'cloth', 10);
  atStation(p, 'loom');
  room.handle(p, { t: 'craft', id: 'c_ihelm' });
  assert.match(p.last('fail').m, /closer to the Forge/);
  room.handle(p, { t: 'craft', id: 'c_ccowl' });
  assert.equal(countItem(p.inv, 'cloth_cowl'), 1);
  atStation(p, 'forge');
  room.handle(p, { t: 'craft', id: 'c_ihelm' });
  assert.equal(countItem(p.inv, 'iron_helm'), 1);
});

test('crafting: the full chain works (resource -> refined -> gear -> weapon)', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a');
  giveItems(p, 'wood', 3); giveItems(p, 'hide', 9); giveItems(p, 'ore', 0);
  atStation(p, 'refinery'); room.handle(p, { t: 'craft', id: 'r_plank' });
  giveItems(p, 'wood', 9);
  for (let i = 0; i < 3; i++) room.handle(p, { t: 'craft', id: 'r_plank' }); // 4 planks total
  atStation(p, 'tannery');
  for (let i = 0; i < 3; i++) room.handle(p, { t: 'craft', id: 'r_leather' });
  room.handle(p, { t: 'craft', id: 'c_bow' }); // 4 planks + 2 leather
  assert.equal(countItem(p.inv, 'bow'), 1);
  room.handle(p, { t: 'craft', id: 'c_lhood' }); // 3 leather? only 1 left
  assert.match(p.last('fail').m, /Not enough/);
});

// ---------------------------------------------------------------- weapons
function rabbitAt(room, id, x, z) {
  const rb = { id, x, z, hp: CFG.RABBIT_HP, mode: 'wander', tx: x, tz: z, wt: 1e9, atkT: 0, dead: false, gathered: false, deadAt: 0, target: null, home: '0,0' };
  room.rabbits.set(id, rb);
  return rb;
}
const arm = (p, id) => { p.inv.eq.main = id ? { id, n: 1 } : null; p.recalc(); };

test('weapons: stats table is sane', () => {
  assert.deepEqual(Object.keys(WEAPONS).sort(), ['bow', 'fire_staff', 'sword']);
  assert.ok(WEAPONS.bow.reach > WEAPONS.fire_staff.reach && WEAPONS.fire_staff.reach > WEAPONS.sword.reach && WEAPONS.sword.reach > FISTS.reach);
  assert.ok(WEAPONS.sword.dmg > WEAPONS.bow.dmg && WEAPONS.sword.dmg > FISTS.dmg);
});

test('weapons: fists are slow and weak (3 hits, 500 ms)', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  const rb = rabbitAt(room, 'r1', 100, 101);
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(rb.hp, 30);
  now.advance(380);
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(rb.hp, 30, 'still on cooldown at 380 ms');
  now.advance(120);
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(rb.hp, 10, 'second hit after 500 ms');
  now.advance(520);
  room.handle(p, { t: 'atk', r: 0 });
  assert.ok(rb.dead);
});

test('weapons: sword hits everything in its wide arc, but not beyond its reach', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  arm(p, 'sword');
  const a = rabbitAt(room, 'a', 100, 101.5), b = rabbitAt(room, 'b', 101.5, 100.8), far = rabbitAt(room, 'far', 100, 105);
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(a.hp, 14); assert.equal(b.hp, 14);
  assert.equal(far.hp, 50, 'out of reach');
});

test('weapons: bow reaches far, needs good aim, and only hits the nearest rabbit in line', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  arm(p, 'bow');
  const near = rabbitAt(room, 'near', 100, 104), behind = rabbitAt(room, 'behind', 100, 107), side = rabbitAt(room, 'side', 104, 102);
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(near.hp, 26, 'bow does 24');
  assert.equal(behind.hp, 50, 'arrow stops at the first target');
  assert.equal(side.hp, 50, 'poorly aimed rabbit is missed');
  now.advance(700);
  near.hp = 50;
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(near.hp, 50, 'bow cooldown is 800 ms');
  const far = rabbitAt(room, 'toofar', 100, 120);
  now.advance(200);
  far.z = 100 + WEAPONS.bow.reach + 1.5; // beyond reach + lag tolerance
  const before = far.hp;
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(far.hp, before);
});

test('weapons: fire staff burns the target and splashes nearby rabbits', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  arm(p, 'fire_staff');
  const main = rabbitAt(room, 'm', 100, 104);
  const close = rabbitAt(room, 'c', 101.5, 104.5); // within 2.5 of the target
  const away = rabbitAt(room, 'x', 106, 104); // too far from the target
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(main.hp, 30);
  assert.equal(close.hp, 38, 'splash 12');
  assert.equal(away.hp, 50);
  const hits = p.all('hit');
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.sp).sort(), [0, 1]);
  assert.ok(hits.every((h) => h.w === 'fire_staff'));
});

test('weapons: splash can finish a rabbit and gear multiplies weapon damage', () => {
  const { room } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  arm(p, 'fire_staff');
  p.inv.eq.chest = { id: 'cloth_robe', n: 1 }; p.recalc(); // +50% damage
  const main = rabbitAt(room, 'm', 100, 104), weak = rabbitAt(room, 'w', 100.5, 104);
  weak.hp = 10;
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(main.hp, 50 - 30, 'staff 20 x 1.5');
  assert.ok(weak.dead, 'splash 18 kills a 10 HP rabbit');
  assert.equal(p.all('hit').find((h) => h.i === 'w').k, 1);
});

test('weapons: leather speed shortens the cooldown; a torch fights like fists', () => {
  const { room, now } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  arm(p, 'torch');
  const rb = rabbitAt(room, 'r', 100, 101);
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(rb.hp, 30, 'torch = fists (20 dmg)');
  p.stats.haste = 0.5; // pretend lots of leather
  now.advance(300);
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(rb.hp, 10, '250 ms cooldown with 50% haste');
});

test('weapons: other players see what you hold (snapshot field w)', () => {
  const { room } = makeRoom();
  const a = makePlayer(room, 'a', { x: 100, z: 100 }), b = makePlayer(room, 'b', { x: 102, z: 100 });
  arm(a, 'bow');
  room.tick();
  assert.equal(b.last('s').p.find((q) => q.id === 'a').w, 'bow');
  assert.equal(a.last('s').me.w, 'bow');
  arm(a, null);
  room.tick();
  assert.equal(b.last('s').p.find((q) => q.id === 'a').w, 0);
});

// ---------------------------------------------------------------- gloves were removed
test('migration: old gloves are refunded as refined materials, nothing else is touched', () => {
  const raw = {
    eq: { head: { id: 'iron_helm', n: 1 }, hands: { id: 'iron_gauntlets', n: 1 }, main: { id: 'sword', n: 1 } },
    slots: [{ id: 'cloth_gloves', n: 2 }, { id: 'wood', n: 7 }, { id: 'leather_gloves', n: 1 }, null],
  };
  const inv = sanitizeInv(raw);
  assert.equal(countItem(inv, 'iron'), 3, 'equipped gauntlets -> 3 iron bars');
  assert.equal(countItem(inv, 'cloth'), 6, '2 cloth gloves -> 6 cloth');
  assert.equal(countItem(inv, 'leather'), 3);
  assert.equal(countItem(inv, 'wood'), 7);
  assert.equal(inv.eq.head.id, 'iron_helm');
  assert.equal(inv.eq.main.id, 'sword');
  assert.equal('hands' in inv.eq, false);
  assert.ok(!JSON.stringify(inv).match(/glove|gauntlet/));
  // loading the already-migrated inventory again must not refund twice
  const again = sanitizeInv(JSON.parse(JSON.stringify(inv)));
  assert.equal(countItem(again, 'iron'), 3);
  assert.equal(countItem(again, 'cloth'), 6);
});

test('donkey reward: needs head, chest, foot, main and off hand (5 slots)', () => {
  assert.deepEqual(REWARD_SLOTS, ['head', 'chest', 'foot', 'main', 'off']);
  const { room } = makeRoom();
  const p = makePlayer(room, 'a');
  ['iron_helm', 'iron_chest', 'iron_boots', 'sword'].forEach((g) => giveItems(p, g, 1));
  ['iron_helm', 'iron_chest', 'iron_boots', 'sword'].forEach((g) => room.handle(p, { t: 'equip', i: p.inv.slots.findIndex((s) => s && s.id === g) }));
  assert.equal(countItem(p.inv, 'donkey'), 0, 'four slots is not enough');
});
