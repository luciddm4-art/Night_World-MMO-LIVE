// Pure inventory / stats logic. The server owns the inventory; these helpers
// never touch the DOM or the network, so they are easy to test.
import { CFG, ITEMS, EQUIP_SLOTS, SLOT_ACCEPTS, ARMOR_STATS } from './data.js';

export function newInv() {
  const eq = {};
  EQUIP_SLOTS.forEach((s) => (eq[s] = null));
  return { eq, slots: new Array(CFG.INV_SLOTS).fill(null) };
}

export const cloneInv = (inv) => JSON.parse(JSON.stringify(inv));

export function countItem(inv, id) {
  let n = 0;
  for (const s of inv.slots) if (s && s.id === id) n += s.n;
  return n;
}

export function canAfford(inv, cost) {
  for (const k in cost) if (countItem(inv, k) < cost[k]) return false;
  return true;
}

export function removeItems(inv, id, count) {
  for (let i = 0; i < inv.slots.length && count > 0; i++) {
    const s = inv.slots[i];
    if (!s || s.id !== id) continue;
    const t = Math.min(s.n, count);
    s.n -= t;
    count -= t;
    if (s.n <= 0) inv.slots[i] = null;
  }
  return count === 0;
}

// Adds n of an item (splitting across stacks). All-or-nothing: returns false and
// leaves the inventory untouched if there isn't room.
export function addItem(inv, id, n) {
  if (!ITEMS[id] || !Number.isInteger(n) || n <= 0) return false;
  const work = inv.slots.map((s) => (s ? { id: s.id, n: s.n } : null));
  let left = n;
  for (const s of work) {
    if (left <= 0) break;
    if (s && s.id === id && s.n < CFG.STACK_MAX) {
      const t = Math.min(CFG.STACK_MAX - s.n, left);
      s.n += t;
      left -= t;
    }
  }
  for (let i = 0; i < work.length && left > 0; i++) {
    if (!work[i]) {
      const t = Math.min(CFG.STACK_MAX, left);
      work[i] = { id, n: t };
      left -= t;
    }
  }
  if (left > 0) return false;
  inv.slots = work;
  return true;
}

export function computeStats(inv) {
  let hpMult = 1, dmg = 1, haste = 0, def = 0;
  for (const slot of EQUIP_SLOTS) {
    const it = inv.eq[slot];
    if (!it) continue;
    const st = ARMOR_STATS[it.id];
    if (!st) continue;
    if (st.hp) hpMult += st.hp;
    if (st.dmg) dmg += st.dmg;
    if (st.haste) haste += st.haste;
    if (st.def) def += st.def;
  }
  return { maxHp: Math.round(CFG.PLAYER_BASE_HP * hpMult), dmg, haste, def };
}

// Equip the item in bag slot i into the first slot that accepts it, swapping any
// previous item back into the bag. Returns the slot name, or null if impossible.
export function equipFromBag(inv, i) {
  const it = inv.slots[i];
  if (!it) return null;
  for (const slot of EQUIP_SLOTS) {
    if (!SLOT_ACCEPTS[slot].includes(it.id)) continue;
    const work = cloneInv(inv);
    const cur = work.eq[slot];
    work.eq[slot] = { id: it.id, n: 1 };
    work.slots[i].n--;
    if (work.slots[i].n <= 0) work.slots[i] = null;
    if (cur && !addItem(work, cur.id, cur.n)) return null; // bag full: refuse, nothing lost
    inv.eq = work.eq;
    inv.slots = work.slots;
    return slot;
  }
  return null;
}

export function unequip(inv, slot) {
  const it = inv.eq[slot];
  if (!it) return false;
  if (!addItem(inv, it.id, it.n)) return false;
  inv.eq[slot] = null;
  return true;
}

// Defensive loader for anything coming out of storage.
export function sanitizeInv(raw) {
  const inv = newInv();
  if (!raw || typeof raw !== 'object') return inv;
  if (Array.isArray(raw.slots)) {
    for (let i = 0; i < CFG.INV_SLOTS; i++) {
      const s = raw.slots[i];
      if (s && ITEMS[s.id] && Number.isInteger(s.n) && s.n > 0) inv.slots[i] = { id: s.id, n: Math.min(s.n, CFG.STACK_MAX) };
    }
  }
  if (raw.eq && typeof raw.eq === 'object') {
    for (const slot of EQUIP_SLOTS) {
      const e = raw.eq[slot];
      if (e && SLOT_ACCEPTS[slot].includes(e.id)) inv.eq[slot] = { id: e.id, n: 1 };
    }
  }
  return inv;
}
