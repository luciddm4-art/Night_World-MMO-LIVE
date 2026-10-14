// The skill / potion / food framework ships with no content (the game owner adds it later).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, WEAPON_SKILLS, CHEST_SKILLS, HELMET_SKILLS, skillIdsFor } from '../shared/skills.js';
import { POTIONS, FOODS, SLOT_ACCEPTS, EQUIP_SLOTS } from '../shared/data.js';
import { makeRoom, makePlayer } from './helpers.js';

test('no skills, potions or foods are defined yet, and nothing breaks without them', () => {
  assert.deepEqual([SKILLS, WEAPON_SKILLS, CHEST_SKILLS, HELMET_SKILLS, POTIONS, FOODS].map((o) => Object.keys(o).length), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(SLOT_ACCEPTS.potion, []);
  assert.deepEqual(SLOT_ACCEPTS.food, []);
  assert.ok(EQUIP_SLOTS.includes('potion') && EQUIP_SLOTS.includes('food'));
  assert.deepEqual(skillIdsFor({ main: { id: 'sword', n: 1 } }), { q: null, w: null, e: null, r: null, d: null });
  const { room } = makeRoom();
  const p = makePlayer(room, 'a', { x: 100, z: 100 });
  for (const k of ['q', 'w', 'e', 'r', 'd', 'x', 5, null]) room.handle(p, { t: 'skill', k });
  room.handle(p, { t: 'use', slot: 'potion' });
  room.handle(p, { t: 'use', slot: 'food' });
  assert.match(p.last('fail').m, /No food/);
  assert.equal(p.mana, 100);
});
