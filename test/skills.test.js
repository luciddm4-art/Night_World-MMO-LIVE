// Skills, mana, potions, food and boots. Content is injected here (the game ships with none).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, makePlayer, fakeClock } from './helpers.js';
import { CFG, TOWN, ITEMS, SLOT_ACCEPTS, registerConsumable, POTIONS, FOODS } from '../shared/data.js';
import { registerSkill, skillIdsFor, SKILLS } from '../shared/skills.js';
import { sweep } from '../shared/collision.js';
import { createWorld } from '../shared/world.js';
import { newInv, computeStats, equipFromBag, unequip, sanitizeInv, addItem } from '../shared/inventory.js';
import { Player } from '../server/player.js';
import { Room } from '../server/room.js';
import { Store } from '../server/store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

registerSkill('t_slash', { n: 'Slash', s: 'SL', mana: 10, cd: 3000, effects: [{ kind: 'damage', mult: 2, shape: 'cone', range: 3 }] }, { weapon: 'sword', slot: 0 });
registerSkill('t_nova', { n: 'Nova', s: 'NV', mana: 30, cd: 5000, effects: [{ kind: 'damage', mult: 1, shape: 'circle', range: 4, max: 2 }] }, { weapon: 'sword', slot: 1 });
registerSkill('t_bolt', { n: 'Bolt', s: 'BT', mana: 25, cd: 4000, cast: 1500, effects: [{ kind: 'damage', mult: 3, shape: 'cone', range: 6, cone: 0.9 }] }, { weapon: 'sword', slot: 2 });
registerSkill('t_wall', { n: 'Wall', s: 'WL', mana: 5, cd: 1000, effects: [{ kind: 'buff', stat: 'shield', value: 100, dur: 10000 }, { kind: 'heal', amount: 50 }] }, { chest: 'iron_chest' });
registerSkill('t_cry', { n: 'Cry', s: 'CR', mana: 5, cd: 1000, effects: [{ kind: 'buff', stat: 'dmg', value: 0.5, dur: 8000 }] }, { head: 'iron_helm' });
registerSkill('t_stone', { n: 'Stone', s: 'ST', mana: 5, cd: 1000, effects: [{ kind: 'buff', stat: 'invuln', value: 1, dur: 3000 }] }, { head: 'cloth_cowl' });
registerSkill('t_mark', { n: 'Mark', s: 'MK', mana: 5, cd: 1000, effects: [{ kind: 'buff', stat: 'mark', value: 1, dur: 20000, hits: 2 }] }, { head: 'leather_hood' });
registerSkill('t_dash', { n: 'Dash', s: 'DS', mana: 5, cd: 1000, effects: [{ kind: 'dash', dist: 5 }] }, { weapon: 'fists', slot: 0 });
registerSkill('t_leap', { n: 'Leap', s: 'LP', mana: 5, cd: 1000, effects: [{ kind: 'dash', dist: 100 }] }, { weapon: 'fists', slot: 1 });
registerSkill('t_hot', { n: 'Soothe', s: 'SO', mana: 5, cd: 1000, effects: [{ kind: 'heal', amount: 100, over: 5 }] }, { weapon: 'bow', slot: 0 });
registerConsumable('potion', 't_heal', { n: 'Test Heal Potion', s: 'TH', heal: 400 });
registerConsumable('potion', 't_mana', { n: 'Test Mana Potion', s: 'TM', mana: 60, cd: 5000 });
registerConsumable('food', 't_stew', { n: 'Test Stew', s: 'TS', buff: { hp: 0.1, dmg: 0.2, dr: 0.1, mp: 0.5 } });
registerConsumable('food', 't_pie', { n: 'Test Pie', s: 'TP', buff: { dmg: 0.05 } });

const RB = 1000; // tough test rabbits, so big hits do not kill them
const BASE = { x: 100, z: 100 };
const eq = (p, slot, id, n = 1) => { p.inv.eq[slot] = id ? { id, n } : null; p.recalc(); };
function rabbit(room, id, x, z) {
  const rb = { id, x, z, hp: RB, mode: 'wander', tx: x, tz: z, wt: 1e9, atkT: 0, dead: false, gathered: false, deadAt: 0, target: null, home: '0,0' };
  room.rabbits.set(id, rb);
  return rb;
}
const setup = () => { const r = makeRoom(); const p = makePlayer(r.room, 'a', BASE); eq(p, 'main', 'sword'); return { ...r, p }; };

// ------------------------------------------------------------------ boots, stats
test('boots: every pair gives +40% walking speed, nothing else does', () => {
  const inv = newInv();
  assert.equal(computeStats(inv).speed, 0);
  for (const id of ['iron_boots', 'cloth_sandals', 'leather_boots']) {
    inv.eq.foot = { id, n: 1 };
    assert.equal(computeStats(inv).speed, 0.4, id);
  }
  inv.eq.foot = null;
  inv.eq.head = { id: 'leather_hood', n: 1 };
  inv.eq.chest = { id: 'iron_chest', n: 1 };
  assert.equal(computeStats(inv).speed, 0, 'only the foot slot speeds you up');
});

test('boots: the server lets you walk 40% faster on foot, and still stops speed hacks', () => {
  const w0 = createWorld(7);
  let sz = 100; // find a straight 150-unit corridor with nothing solid in it
  while (sweep(w0, () => true, 100, sz, 250, sz).blocked) sz += 7;
  const walk = (boots, speed) => {
    const { room, now } = makeRoom();
    const p = makePlayer(room, 'w', { x: 100, z: sz });
    if (boots) eq(p, 'foot', 'leather_boots');
    let x = 100;
    for (let i = 0; i < 100; i++) { // 10 s at `speed` units per second
      now.advance(100);
      x += speed / 10;
      room.handle(p, { t: 'p', x, z: sz, r: 0 });
    }
    return { x: p.x, corrected: p.all('pos').length };
  };
  assert.ok(walk(false, CFG.WALK_SPEED * 1.4).corrected > 0, 'boots-speed without boots is a speed hack');
  const ok = walk(true, CFG.WALK_SPEED * 1.4);
  assert.equal(ok.corrected, 0, 'boots-speed with boots is fine');
  assert.ok(ok.x > 100 + 60 * 1.3);
  assert.ok(walk(true, CFG.WALK_SPEED * 2).corrected > 0, 'twice walking speed is still refused');
});

test('boots: the speed bonus is reported to the page, and food shows in the stats', () => {
  const { room, p } = setup();
  eq(p, 'foot', 'iron_boots');
  assert.equal(room.statsOf(p).speed, 0.4);
  p.food = { id: 't_stew', until: 1e12 };
  p.recalc();
  const st = room.statsOf(p);
  assert.equal(st.dmg, 1.2);
  assert.equal(st.def, 0.1);
});

// ------------------------------------------------------------------ inventory: potion / food slots hold stacks
test('potion and food slots take the whole stack; the same item merges, a different one swaps', () => {
  const inv = newInv();
  inv.slots[0] = { id: 't_heal', n: 12 };
  assert.equal(equipFromBag(inv, 0), 'potion');
  assert.deepEqual(inv.eq.potion, { id: 't_heal', n: 12 });
  assert.equal(inv.slots[0], null);
  inv.slots[1] = { id: 't_heal', n: 5 };
  equipFromBag(inv, 1);
  assert.equal(inv.eq.potion.n, 17);
  inv.slots[2] = { id: 't_mana', n: 3 };
  equipFromBag(inv, 2);
  assert.deepEqual(inv.eq.potion, { id: 't_mana', n: 3 });
  assert.ok(inv.slots.some((s) => s && s.id === 't_heal' && s.n === 17), 'the old stack went back to the bag');
  assert.equal(unequip(inv, 'potion'), true);
  assert.equal(inv.eq.potion, null);
  assert.equal(inv.slots.filter((s) => s && s.id === 't_mana').reduce((a, s) => a + s.n, 0), 3);
  // a full stack in the slot only takes what fits
  inv.eq.food = { id: 't_stew', n: 95 };
  inv.slots[5] = { id: 't_stew', n: 10 };
  equipFromBag(inv, 5);
  assert.equal(inv.eq.food.n, 99);
  assert.equal(inv.slots[5].n, 6);
});

test('stack sizes in the potion/food slots survive saving and loading', () => {
  const inv = newInv();
  inv.eq.potion = { id: 't_heal', n: 40 };
  inv.eq.food = { id: 't_pie', n: 500 };
  inv.eq.main = { id: 'sword', n: 7 };
  const back = sanitizeInv(JSON.parse(JSON.stringify(inv)));
  assert.deepEqual(back.eq.potion, { id: 't_heal', n: 40 });
  assert.deepEqual(back.eq.food, { id: 't_pie', n: 99 }, 'capped at one stack');
  assert.deepEqual(back.eq.main, { id: 'sword', n: 1 });
  assert.equal(sanitizeInv({ eq: { potion: { id: 'sword', n: 1 }, food: { id: 't_heal', n: 1 } } }).eq.potion, null, 'wrong item for the slot is dropped');
});

// ------------------------------------------------------------------ which skill is on which button
test('skillIdsFor: weapon gives Q/W/E, chest R, helmet D', () => {
  const inv = newInv();
  assert.deepEqual(skillIdsFor(inv.eq), { q: 't_dash', w: 't_leap', e: null, r: null, d: null }, 'fists have skills too');
  inv.eq.main = { id: 'sword', n: 1 };
  inv.eq.chest = { id: 'iron_chest', n: 1 };
  inv.eq.head = { id: 'iron_helm', n: 1 };
  assert.deepEqual(skillIdsFor(inv.eq), { q: 't_slash', w: 't_nova', e: 't_bolt', r: 't_wall', d: 't_cry' });
  inv.eq.main = null; // no weapon = fists
  assert.deepEqual(skillIdsFor(inv.eq), { q: 't_dash', w: 't_leap', e: null, r: 't_wall', d: 't_cry' });
});

// ------------------------------------------------------------------ mana, cooldowns, casting
test('mana: starts full, a skill costs mana, it comes back over time, and too little mana refuses', () => {
  const { room, now, p } = setup();
  assert.equal(p.maxMana, 100);
  assert.equal(room.welcome(p).you.mana.max, 100);
  room.handle(p, { t: 'skill', k: 'q', r: 0 });
  assert.equal(p.mana, 90);
  assert.deepEqual(p.last('mana'), { t: 'mana', v: 90, max: 100, rate: 2 });
  assert.deepEqual(p.last('cd'), { t: 'cd', id: 't_slash', ms: 3000 });
  for (let i = 0; i < 20; i++) { now.advance(50); room.tick(); } // 1 s
  assert.ok(p.mana > 91.5 && p.mana < 92.5, 'about 2 mana per second: ' + p.mana);
  p.mana = 5;
  now.advance(1000);
  room.handle(p, { t: 'skill', k: 'w', r: 0 });
  assert.match(p.last('fail').m, /Not enough mana/);
  assert.equal(p.mana, 5, 'a refused cast costs nothing');
});

test('cooldowns are per skill, a short global cooldown separates casts, and swapping weapons does not reset them', () => {
  const { room, now, p } = setup();
  room.handle(p, { t: 'skill', k: 'q', r: 0 });
  assert.equal(p.mana, 90);
  now.advance(CFG.GCD_MS - 100);
  room.handle(p, { t: 'skill', k: 'w', r: 0 });
  assert.equal(p.mana, 90, 'global cooldown');
  now.advance(200);
  room.handle(p, { t: 'skill', k: 'q', r: 0 });
  assert.match(p.last('fail').m, /not ready/);
  assert.equal(p.mana > 89, true);
  room.handle(p, { t: 'skill', k: 'w', r: 0 });
  assert.ok(p.mana < 70, 'a different skill is fine');
  // swap to fists and back: the sword's Slash is still on cooldown
  eq(p, 'main', null);
  eq(p, 'main', 'sword');
  now.advance(CFG.GCD_MS + 10);
  room.handle(p, { t: 'skill', k: 'q', r: 0 });
  assert.match(p.last('fail').m, /not ready/);
  now.advance(3000);
  room.handle(p, { t: 'skill', k: 'q', r: 0 });
  assert.ok(p.last('cd').id === 't_slash');
});

test('a button with no skill does nothing; skills are refused while riding or gathering', () => {
  const { room, now, p } = setup();
  room.handle(p, { t: 'skill', k: 'd', r: 0 });
  assert.equal(p.mana, 100);
  p.mounted = true;
  room.handle(p, { t: 'skill', k: 'q', r: 0 });
  assert.match(p.last('fail').m, /riding/);
  p.mounted = false;
  p.gather = { kind: 'tree', id: 'x', start: now(), x: p.x, z: p.z, dur: 1500 };
  room.handle(p, { t: 'skill', k: 'q', r: 0 });
  assert.match(p.last('fail').m, /busy/);
  assert.equal(p.mana, 100);
});

test('cast time: mana is spent when the cast ends, moving cancels it, and you cannot attack or gather meanwhile', () => {
  const { room, now, p } = setup();
  const rb = rabbit(room, 'rab:t:1', p.x, p.z + 4);
  room.handle(p, { t: 'skill', k: 'e', r: 0 });
  assert.deepEqual(p.last('scast'), { t: 'scast', id: 't_bolt', dur: 1500 });
  assert.equal(p.mana, 100, 'nothing spent yet');
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(rb.hp, RB, 'no basic attacks while casting');
  room.handle(p, { t: 'gather', kind: 'tree', id: '0,0,0' });
  assert.match(p.last('fail').m, /busy/);
  now.advance(1000); room.tick();
  assert.ok(p.spell, 'still casting');
  now.advance(600); room.tick();
  assert.equal(p.spell, null);
  assert.ok(p.mana <= 76 && p.mana >= 74, 'spent on completion: ' + p.mana);
  assert.equal(rb.hp, RB - Math.round(36 * 3));

  // walking away interrupts, and costs nothing
  now.advance(5000);
  p.mana = 100;
  p.out.length = 0;
  room.handle(p, { t: 'skill', k: 'e', r: 0 });
  now.advance(500);
  room.handle(p, { t: 'p', x: p.x + 3, z: p.z, r: 0 });
  room.tick();
  assert.equal(p.spell, null);
  assert.ok(p.last('scancel'));
  assert.equal(p.mana > 99, true);
  assert.match(p.last('fail').m, /interrupted/);
  // the page can cancel by itself (it does when you move the stick)
  now.advance(5000);
  room.handle(p, { t: 'skill', k: 'e', r: 0 });
  assert.ok(p.spell);
  room.handle(p, { t: 'scancel' });
  assert.equal(p.spell, null);
  // swapping gear interrupts too
  now.advance(5000);
  room.handle(p, { t: 'skill', k: 'e', r: 0 });
  assert.ok(p.spell);
  p.inv.slots[0] = { id: 'torch', n: 1 };
  room.handle(p, { t: 'equip', i: 0 });
  assert.equal(p.spell, null);
});

// ------------------------------------------------------------------ effects
test('damage effects: cone vs circle, multipliers, target limit', () => {
  const { room, now, p } = setup();
  const front = rabbit(room, 'a1', p.x, p.z + 2);
  const behind = rabbit(room, 'a2', p.x, p.z - 2);
  const far = rabbit(room, 'a3', p.x, p.z + 9);
  room.handle(p, { t: 'skill', k: 'q', r: 0 }); // 2x sword in a cone
  assert.equal(front.hp, RB - 72);
  assert.equal(behind.hp, RB, 'cone does not hit behind');
  assert.equal(far.hp, RB);
  now.advance(1000);
  const side = rabbit(room, 'a4', p.x + 3, p.z);
  room.handle(p, { t: 'skill', k: 'w', r: 0 }); // circle, 2 targets max, nearest first
  assert.equal(front.hp, RB - 72 - 36);
  assert.equal(behind.hp, RB - 36);
  assert.equal(side.hp, RB, 'only the two nearest');
  assert.ok(p.last('hit'));
  assert.equal(p.last('skfx').id, 't_nova');
});

test('buffs: damage buff raises hits, mark applies to the next N hits only, they expire', () => {
  const { room, now, p } = setup();
  const rb = rabbit(room, 'b1', p.x, p.z + 1);
  eq(p, 'head', 'iron_helm'); // Cry: +50% damage
  room.handle(p, { t: 'skill', k: 'd', r: 0 });
  assert.equal(p.last('buffs').list[0].id, 't_cry');
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(rb.hp, RB - 54);
  now.advance(9000); room.tick();
  assert.deepEqual(p.last('buffs').list, [], 'expired and reported');
  rb.hp = RB;
  room.handle(p, { t: 'atk', r: 0 });
  assert.equal(rb.hp, RB - 36);

  eq(p, 'head', 'leather_hood'); // Mark: next 2 hits +100%
  room.handle(p, { t: 'skill', k: 'd', r: 0 });
  rb.hp = RB;
  const hit = () => { now.advance(500); const b = rb.hp; room.handle(p, { t: 'atk', r: 0 }); return b - rb.hp; };
  assert.equal(hit(), 74, 'first marked hit (the hood adds 3%)');
  assert.equal(hit(), 74, 'second marked hit');
  assert.equal(hit(), 37, 'mark used up');
});

test('defence: shield soaks damage, invulnerable takes none, food damage reduction applies', () => {
  const { room, now, p } = setup();
  eq(p, 'chest', 'iron_chest');
  p.hp = p.maxHp;
  room.handle(p, { t: 'skill', k: 'r', r: 0 }); // shield 100
  room.damagePlayer(p, 60, now(), 'x');
  assert.equal(p.hp, p.maxHp);
  room.damagePlayer(p, 60, now(), 'x');
  assert.equal(p.hp, p.maxHp - 20, '40 left in the shield, 20 got through');
  assert.deepEqual(p.last('buffs').list, [], 'a used-up shield is removed');
  eq(p, 'head', 'cloth_cowl');
  now.advance(1000);
  room.handle(p, { t: 'skill', k: 'd', r: 0 });
  const hp = p.hp;
  room.damagePlayer(p, 500, now(), 'x');
  assert.equal(p.hp, hp);
  now.advance(3100); room.tick();
  p.food = { id: 't_stew', until: now() + 1e6 };
  p.recalc();
  const h2 = p.hp;
  room.damagePlayer(p, 100, now(), 'x');
  assert.ok(Math.abs(h2 - p.hp - 90) < 0.001, '10% less');
});

test('heal effects: instant, and over time', () => {
  const { room, now, p } = setup();
  eq(p, 'chest', 'iron_chest');
  p.hp = 500;
  room.handle(p, { t: 'skill', k: 'r', r: 0 });
  assert.equal(p.hp, 550);
  assert.equal(p.last('heal').d, 50);
  eq(p, 'main', 'bow');
  now.advance(1000);
  room.handle(p, { t: 'skill', k: 'q', r: 0 });
  assert.equal(p.hp, 550, 'nothing at once');
  for (let i = 0; i < 100; i++) { now.advance(50); p.lastDamageT = now(); room.tick(); } // 5 s (no natural regen)
  assert.ok(p.hp > 640 && p.hp < 660, 'about 100 healed over 5 s (plus normal regen): ' + p.hp);
});

test('dash moves you forward and tells the page; walls stop it', () => {
  const { room, p } = setup();
  eq(p, 'main', null);
  room.handle(p, { t: 'skill', k: 'q', r: 0 });
  assert.ok(Math.abs(p.z - (BASE.z + 5)) < 0.01);
  assert.deepEqual(p.last('pos'), { t: 'pos', x: p.x, z: p.z });
  // a long leap from the middle of the town, towards the north wall (no gate there): it stops at the wall
  const { room: r2 } = makeRoom();
  const q = makePlayer(r2, 'q', { x: 30, z: 0 });
  eq(q, 'main', null);
  r2.handle(q, { t: 'skill', k: 'w', r: Math.PI });
  assert.ok(q.z < 0 && q.z > -TOWN.half, 'stopped before the wall: ' + q.z);
});

// ------------------------------------------------------------------ potions and food
test('potion: heals at once, uses one up, has a cooldown, refuses at full health', () => {
  const { room, now, p } = setup();
  eq(p, 'potion', 't_heal', 3);
  room.handle(p, { t: 'use', slot: 'potion' });
  assert.match(p.last('fail').m, /full/);
  assert.equal(p.inv.eq.potion.n, 3, 'not wasted');
  p.hp = 300;
  room.handle(p, { t: 'use', slot: 'potion' });
  assert.equal(p.hp, 700);
  assert.equal(p.inv.eq.potion.n, 2);
  assert.deepEqual(p.last('cd'), { t: 'cd', id: 'potion', ms: CFG.POTION_CD_MS });
  assert.equal(p.last('inv').inv.eq.potion.n, 2);
  room.handle(p, { t: 'use', slot: 'potion' });
  assert.match(p.last('fail').m, /not ready/);
  now.advance(CFG.POTION_CD_MS + 1);
  room.handle(p, { t: 'use', slot: 'potion' });
  assert.equal(p.hp, 1100);
  now.advance(CFG.POTION_CD_MS + 1);
  p.hp = 100;
  room.handle(p, { t: 'use', slot: 'potion' });
  assert.equal(p.inv.eq.potion, null, 'the last one empties the slot');
});

test('potions can restore mana, with their own cooldown; healPct works', () => {
  const { room, now, p } = setup();
  eq(p, 'potion', 't_mana', 2);
  room.handle(p, { t: 'use', slot: 'potion' });
  assert.match(p.last('fail').m, /mana is already full/i);
  p.mana = 10;
  room.handle(p, { t: 'use', slot: 'potion' });
  assert.equal(p.mana, 70);
  assert.equal(p.last('cd').ms, 5000);
  registerConsumable('potion', 't_pct', { n: 'Pct', healPct: 0.5 });
  eq(p, 'potion', 't_pct', 1);
  p.hp = 100;
  now.advance(5001);
  room.handle(p, { t: 'use', slot: 'potion' });
  assert.equal(p.hp, 700);
});

test('food: a 30-minute buff that replaces the old one, then wears off', () => {
  const { room, now, p } = setup();
  eq(p, 'food', 't_stew', 2);
  p.hp = p.maxHp;
  room.handle(p, { t: 'use', slot: 'food' });
  assert.equal(p.maxHp, 1320, '+10% HP');
  assert.equal(p.maxMana, 150, '+50% mana');
  assert.equal(p.hp, 1320, 'HP ratio is kept');
  assert.equal(p.inv.eq.food.n, 1);
  assert.deepEqual(p.last('buffs').food, { id: 't_stew', ms: CFG.FOOD_MS });
  assert.equal(p.last('inv').st.dmg, 1.2);
  assert.equal(p.last('mana').max, 150);
  now.advance(10 * 60000);
  assert.equal(room.buffsOf(p, now()).food.ms, 20 * 60000);
  eq(p, 'food', 't_pie', 1); // the stew stack was swapped out
  room.handle(p, { t: 'use', slot: 'food' });
  assert.equal(p.food.id, 't_pie');
  assert.equal(p.maxHp, 1200, 'the stew bonus is gone');
  assert.equal(p.food.until, now() + CFG.FOOD_MS, 'a fresh 30 minutes');
  now.advance(CFG.FOOD_MS - 1000); room.tick();
  assert.ok(p.food);
  now.advance(2000); room.tick();
  assert.equal(p.food, null);
  assert.match(p.last('toast').m, /wore off/);
  assert.equal(p.last('st').st.dmg, 1);
});

test('food: time left is saved, offline time does not count, and bad saves are ignored', () => {
  const { room, now, p } = setup();
  eq(p, 'food', 't_stew', 1);
  room.handle(p, { t: 'use', slot: 'food' });
  now.advance(12 * 60000);
  const save = JSON.parse(JSON.stringify(p.toSave(7, now())));
  assert.deepEqual(save.food, { id: 't_stew', ms: 18 * 60000 });

  // a different room/clock much later: still 18 minutes left
  const clock2 = fakeClock(5_000_000_000);
  const room2 = new Room(7, { now: clock2 });
  const p2 = new Player({ id: 'b', name: 'b', saved: save, send: () => {} });
  p2.restore(save, 7);
  room2.addPlayer(p2);
  assert.equal(p2.food.until - clock2(), 18 * 60000);
  assert.equal(p2.maxHp, 1320);
  // saved again without ever being rebased still keeps its time
  const p3 = new Player({ id: 'c', name: 'c', saved: save, send: () => {} });
  assert.deepEqual(p3.toSave(7, 0).food, { id: 't_stew', ms: 18 * 60000 });
  for (const bad of [{ id: 'nope', ms: 1000 }, { id: 't_stew', ms: -5 }, { id: 't_stew', ms: 'x' }, null]) {
    assert.equal(new Player({ id: 'd', name: 'd', saved: { ...save, food: bad }, send: () => {} }).pendingFood, null);
  }
  assert.equal(new Player({ id: 'e', name: 'e', saved: { ...save, food: { id: 't_stew', ms: 1e12 } }, send: () => {} }).pendingFood.ms, CFG.FOOD_MS, 'capped');
});

test('food is stored with the account', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-food-'));
  const now = fakeClock();
  const s1 = new Store(dir, { now });
  s1.load();
  return s1.create('Cook', 'pw-123456').then(async () => {
    const save = { inv: newInv(), hpRatio: 1, color: '#112233', lastSeed: 7, food: { id: 't_stew', ms: 600000 }, world: { x: 1, z: 2, r: 0 } };
    s1.saveCharacter('Cook', save);
    s1.saveCharacter('Cook', { ...save, food: { id: 't_stew', ms: 599000 } }); // same minute: not a new write
    await s1.close();
    const s2 = new Store(dir, { now });
    s2.load();
    assert.deepEqual(s2.get('cook').save.food, { id: 't_stew', ms: 600000 });
    s2.saveCharacter('Cook', { ...save, food: null });
    assert.equal(s2.get('cook').save.food, null);
    await s2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('data tables stay consistent', () => {
  for (const id of Object.keys(POTIONS)) assert.ok(ITEMS[id] && SLOT_ACCEPTS.potion.includes(id));
  for (const id of Object.keys(FOODS)) assert.ok(ITEMS[id] && SLOT_ACCEPTS.food.includes(id));
  for (const [id, sk] of Object.entries(SKILLS)) {
    assert.ok(sk.n && sk.mana >= 0 && sk.cd > 0 && Array.isArray(sk.effects) && sk.effects.length, id);
  }
  addItem(newInv(), 't_pie', 1);
});
