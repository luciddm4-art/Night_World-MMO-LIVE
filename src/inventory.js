import { ITEMS, EQUIP_SLOTS, SLOT_LABEL } from '../shared/data.js';
import { S } from './state.js';
import { send } from './net.js';
import { openCraft } from './panel.js';

const invEl = document.getElementById('inv');
const invSum = document.getElementById('invsum');
export let invOpen = false;

export function toggleInv() {
  invOpen = !invOpen;
  invEl.classList.toggle('open', invOpen);
}

const count = (id) => S.inv.slots.reduce((n, s) => n + (s && s.id === id ? s.n : 0), 0);

export function renderInv() {
  EQUIP_SLOTS.forEach((s) => {
    const el = document.querySelector('.eqslot[data-slot="' + s + '"]');
    if (!el) return;
    const it = S.inv.eq[s];
    el.classList.toggle('filled', !!it);
    el.textContent = it ? (ITEMS[it.id] ? ITEMS[it.id].s : '?') : SLOT_LABEL[s];
  });
  let h = '';
  for (let i = 0; i < 64; i++) {
    const it = S.inv.slots[i];
    if (it) {
      const dd = ITEMS[it.id] || { s: '?', n: '?' };
      h += '<div class="islot filled" data-i="' + i + '" title="' + dd.n + '">' + dd.s + (it.n > 1 ? '<span class="n">' + it.n + '</span>' : '') + '</div>';
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
  document.getElementById('craftbtn').addEventListener('click', (e) => { e.stopPropagation(); openCraft(null); });
  // The server decides whether an equip is legal; we only ask.
  document.getElementById('grid').addEventListener('click', (e) => {
    const el = e.target.closest('.islot.filled');
    if (el) send({ t: 'equip', i: parseInt(el.getAttribute('data-i'), 10) });
  });
  document.getElementById('eq').addEventListener('click', (e) => {
    const el = e.target.closest('.eqslot.filled');
    if (el) send({ t: 'unequip', slot: el.getAttribute('data-slot') });
  });
  renderInv();
}
