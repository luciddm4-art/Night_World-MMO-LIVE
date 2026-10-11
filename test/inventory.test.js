import test from 'node:test';
import assert from 'node:assert/strict';
import { newInv, addItem, removeItems, countItem, equipFromBag, unequip, sanitizeInv, computeStats } from '../shared/inventory.js';

test('addItem splits stacks at 99 and is all-or-nothing', () => {
  const inv = newInv();
  assert.ok(addItem(inv, 'wood', 150));
  assert.deepEqual(inv.slots.slice(0, 3), [{ id: 'wood', n: 99 }, { id: 'wood', n: 51 }, null]);
  const full = newInv();
  for (let i = 0; i < 64; i++) full.slots[i] = { id: 'ore', n: 99 };
  const before = JSON.stringify(full);
  assert.equal(addItem(full, 'wood', 1), false);
  assert.equal(JSON.stringify(full), before, 'failed add must not change anything');
  assert.equal(addItem(inv, 'not_an_item', 1), false);
  assert.equal(addItem(inv, 'wood', -3), false);
});

test('removeItems spans stacks', () => {
  const inv = newInv();
  addItem(inv, 'wood', 120);
  assert.ok(removeItems(inv, 'wood', 110));
  assert.equal(countItem(inv, 'wood'), 10);
});

test('equip swaps the old item back into the bag', () => {
  const inv = newInv();
  addItem(inv, 'sword', 1);
  addItem(inv, 'bow', 1);
  assert.equal(equipFromBag(inv, 0), 'main');
  assert.equal(inv.eq.main.id, 'sword');
  const bowSlot = inv.slots.findIndex((s) => s && s.id === 'bow');
  assert.equal(equipFromBag(inv, bowSlot), 'main');
  assert.equal(inv.eq.main.id, 'bow');
  assert.equal(countItem(inv, 'sword'), 1);
});

test('equip refuses (and loses nothing) when the swap has no room', () => {
  const inv = newInv();
  inv.eq.main = { id: 'sword', n: 1 };
  for (let i = 0; i < 64; i++) inv.slots[i] = { id: 'wood', n: 99 };
  inv.slots[0] = { id: 'bow', n: 2 }; // a stack of 2: equipping one leaves a bow behind, bag still full
  assert.equal(equipFromBag(inv, 0), null);
  assert.equal(inv.eq.main.id, 'sword');
  assert.equal(inv.slots[0].n, 2);
});

test('unequip needs room', () => {
  const inv = newInv();
  inv.eq.head = { id: 'iron_helm', n: 1 };
  assert.ok(unequip(inv, 'head'));
  assert.equal(inv.eq.head, null);
  assert.equal(countItem(inv, 'iron_helm'), 1);
});

test('stats are derived from equipment', () => {
  const inv = newInv();
  assert.deepEqual(computeStats(inv), { maxHp: 1200, dmg: 1, haste: 0, def: 0 });
  inv.eq.chest = { id: 'iron_chest', n: 1 };
  inv.eq.chest2 = null;
  const s = computeStats(inv);
  assert.equal(s.maxHp, 1800);
  assert.equal(s.def, 0.2);
});

test('sanitizeInv drops junk from storage', () => {
  const inv = sanitizeInv({
    slots: [{ id: 'wood', n: 5 }, { id: 'hax', n: 5 }, { id: 'ore', n: -1 }, { id: 'ore', n: 1e9 }],
    eq: { head: { id: 'sword' }, main: { id: 'sword' } },
  });
  assert.deepEqual(inv.slots.slice(0, 4), [{ id: 'wood', n: 5 }, null, null, { id: 'ore', n: 99 }]);
  assert.equal(inv.eq.head, null);
  assert.equal(inv.eq.main.id, 'sword');
  assert.equal(sanitizeInv('garbage').slots.length, 64);
});
