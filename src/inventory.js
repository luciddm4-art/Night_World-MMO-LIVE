import { ITEMS, EQUIP_SLOTS, SLOT_LABEL, SLOT_ACCEPTS, ARMOR_STATS, RECIPES, WEAPONS, STATIONS } from '../shared/data.js';
import { sfx } from './audio.js';
import { S } from './state.js';
import { send } from './net.js';
import { openNearestStation } from './panel.js';

const invEl = document.getElementById('inv');
const invSum = document.getElementById('invsum');
export let invOpen = false;

export function toggleInv() {
  invOpen = !invOpen;
  invEl.classList.toggle('open', invOpen);
}

const SLOT_NAME = { head: 'Head', chest: 'Chest', foot: 'Feet', main: 'Main hand', off: 'Off hand', mount: 'Mount' };
const STAT_NAME = { hp: 'max HP', dmg: 'damage', def: 'defence', haste: 'attack speed' };

// Hover / long-press text for an item: what it is and what it does.
export function tipFor(id, equipped = false) {
  const d = ITEMS[id];
  if (!d) return '';
  const lines = [d.n + '  (Tier ' + d.tier + ')'];
  const slot = Object.keys(SLOT_ACCEPTS).find((k) => SLOT_ACCEPTS[k].includes(id));
  if (slot) {
    lines.push(id === 'torch' ? 'Main or off hand' : SLOT_NAME[slot]);
    const w = WEAPONS[id];
    if (w) {
      lines.push('Damage ' + w.dmg + '  Reach ' + w.reach + '  Speed ' + (w.cd / 1000).toFixed(2) + 's');
      lines.push(w.id === 'sword' ? 'Wide arc: hits everything in front' : w.id === 'bow' ? 'Aim at one target; arrow hits the nearest' : 'Fireball: also scorches rabbits next to the target (' + w.splash + ' dmg)');
    }
    const st = ARMOR_STATS[id];
    if (st) lines.push(Object.keys(st).map((k) => '+' + Math.round(st[k] * 100) + '% ' + STAT_NAME[k]).join(', '));
    const rec = RECIPES.find((r) => r.out === id);
    if (rec) lines.push('Crafted at the ' + STATIONS.find((x) => x.k === rec.station).name);
    lines.push(equipped ? 'Click to unequip' : 'Click to equip');
  } else {
    const made = RECIPES.filter((r) => r.out === id);
    if (made.length) lines.push('Made from ' + made.map((r) => Object.keys(r.cost).map((k) => r.cost[k] + ' ' + ITEMS[k].n).join(' + ') + ' at the ' + STATIONS.find((x) => x.k === r.station).name).join(' or '));
    const used = RECIPES.filter((r) => r.cost[id]).map((r) => r.name);
    if (used.length) lines.push('Used in: ' + used.slice(0, 4).join(', ') + (used.length > 4 ? '...' : ''));
  }
  return lines.join('\n');
}

const count = (id) => S.inv.slots.reduce((n, s) => n + (s && s.id === id ? s.n : 0), 0);

export function renderInv() {
  EQUIP_SLOTS.forEach((s) => {
    const el = document.querySelector('.eqslot[data-slot="' + s + '"]');
    if (!el) return;
    const it = S.inv.eq[s];
    el.classList.toggle('filled', !!it);
    el.textContent = it ? (ITEMS[it.id] ? ITEMS[it.id].s : '?') : SLOT_LABEL[s];
    el.title = it ? tipFor(it.id, true) : SLOT_NAME[s] + ' slot (empty)';
  });
  let h = '';
  for (let i = 0; i < 64; i++) {
    const it = S.inv.slots[i];
    if (it) {
      const dd = ITEMS[it.id] || { s: '?', n: '?' };
      h += '<div class="islot filled" data-i="' + i + '" title="' + tipFor(it.id).replace(/\n/g, '&#10;') + '">' + dd.s + (it.n > 1 ? '<span class="n">' + it.n + '</span>' : '') + '</div>';
    } else h += '<div class="islot"></div>';
  }
  document.getElementById('grid').innerHTML = h;
  const parts = [];
  ['wood', 'cotton', 'ore', 'hide', 'plank', 'cloth', 'iron', 'leather'].forEach((id) => {
    const n = count(id);
    if (n > 0) parts.push(ITEMS[id].s + ' ' + n);
  });
  invSum.textContent = parts.length ? '  ' + parts.join('  ') : '';
}

export function initInventory() {
  document.getElementById('eq').innerHTML = EQUIP_SLOTS.map((s) => '<div class="eqslot" data-slot="' + s + '">' + SLOT_LABEL[s] + '</div>').join('');
  document.getElementById('invhead').addEventListener('click', (e) => { if (e.target.id !== 'craftbtn') toggleInv(); });
  document.getElementById('craftbtn').addEventListener('click', (e) => { e.stopPropagation(); openNearestStation(); });
  // The server decides whether an equip is legal; we only ask.
  document.getElementById('grid').addEventListener('click', (e) => {
    const el = e.target.closest('.islot.filled');
    if (el) { sfx('equip'); send({ t: 'equip', i: parseInt(el.getAttribute('data-i'), 10) }); }
  });
  document.getElementById('eq').addEventListener('click', (e) => {
    const el = e.target.closest('.eqslot.filled');
    if (el) { sfx('equip'); send({ t: 'unequip', slot: el.getAttribute('data-slot') }); }
  });
  renderInv();
}
