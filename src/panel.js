import { ITEMS, RECIPES, WORLDS, normalizeSeed } from '../shared/data.js';
import { S } from './state.js';
import { send } from './net.js';

const panel = document.getElementById('panel');
export const panelState = { type: null, station: null };

const count = (id) => S.inv.slots.reduce((n, s) => n + (s && s.id === id ? s.n : 0), 0);
const canAfford = (cost) => Object.keys(cost).every((k) => count(k) >= cost[k]);
const costStr = (cost) => Object.keys(cost).map((k) => cost[k] + ' ' + ITEMS[k].s).join(' + ');
const row = (l, c, a, ok) => '<button class="b" data-a="' + a + '"' + (ok ? '' : ' disabled') + '><span>' + l + '</span><span>' + c + '</span></button>';

export function openCraft(station) {
  panelState.type = 'craft';
  panelState.station = station;
  renderPanel();
  panel.style.display = 'block';
}
export function openTravel() {
  panelState.type = 'travel';
  renderPanel();
  panel.style.display = 'block';
}
export function closePanel() {
  panelState.type = null;
  panelState.station = null;
  panel.style.display = 'none';
}

export function renderPanel() {
  if (!panelState.type) { panel.style.display = 'none'; return; }
  let h = '';
  if (panelState.type === 'craft') {
    h += '<h3>Crafting</h3>';
    h += panelState.station ? '<p><small>at the ' + panelState.station + '</small></p>' : '<p><small>portable workbench</small></p>';
    const cats = {};
    RECIPES.forEach((r) => {
      if (r.cat === 'Refine' && r.station !== panelState.station) return;
      (cats[r.cat] || (cats[r.cat] = [])).push(r);
    });
    ['Refine', 'Weapons', 'Tools', 'Iron Armor', 'Cloth Armor', 'Leather Armor'].forEach((c) => {
      if (!cats[c]) return;
      h += '<h4>' + c + '</h4>';
      cats[c].forEach((r) => {
        h += row(r.name + (r.n > 1 ? ' x' + r.n : '') + ' <small>' + costStr(r.cost) + '</small>', 'Craft', 'c:' + r.id, canAfford(r.cost));
      });
    });
    h += '<button class="b x" data-a="close">Close</button>';
  } else if (panelState.type === 'travel') {
    h += '<h3>Travel Planner</h3><p>Onward. There is no way back.</p>';
    WORLDS.forEach((w) => {
      h += '<button class="b" data-a="t:' + w.seed + '"><span>' + w.name + ' <small>· ' + w.tag + '</small></span><span>travel</span></button>';
    });
    h += '<div style="display:flex;gap:6px;margin-top:8px"><input id="seedin" type="number" placeholder="custom seed" style="flex:1;padding:9px;border-radius:8px;border:1px solid rgba(242,211,74,.5);background:rgba(0,0,0,.4);color:#fff;font:600 14px Georgia,serif"><button class="b" style="width:auto;margin:0" data-a="customseed">Go</button></div>';
    h += '<button class="b x" data-a="close" style="margin-top:6px">Close</button>';
  }
  panel.innerHTML = h;
}

export function travelToSeed(seed) {
  seed = normalizeSeed(seed);
  const f = document.createElement('div');
  f.style.cssText = 'position:fixed;inset:0;background:#0b0e1a;z-index:999;opacity:0;transition:opacity .4s;pointer-events:none';
  document.body.appendChild(f);
  requestAnimationFrame(() => { f.style.opacity = '1'; });
  // the server saves your character when the connection closes
  setTimeout(() => { location.href = location.pathname + '?seed=' + seed; }, 420);
}

export function initPanel() {
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const a = b.getAttribute('data-a');
    if (a === 'close') return closePanel();
    if (a === 'customseed') {
      const v = parseInt(document.getElementById('seedin').value, 10);
      if (Number.isFinite(v)) travelToSeed(v);
      return;
    }
    if (a.indexOf('t:') === 0) return travelToSeed(parseInt(a.slice(2), 10));
    if (a.indexOf('c:') === 0) send({ t: 'craft', id: a.slice(2) }); // server checks station, materials, space
  });
}
