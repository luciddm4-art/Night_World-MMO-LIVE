import { ITEMS, RECIPES, WORLDS, STATIONS, STATION_Z, STATION_RANGE, FAMILIES, normalizeSeed } from '../shared/data.js';
import { REALM } from './config.js';
import { S } from './state.js';
import { send } from './net.js';
import { say } from './ui.js';

const panel = document.getElementById('panel');
export const panelState = { type: null, station: null };

const count = (id) => S.inv.slots.reduce((n, s) => n + (s && s.id === id ? s.n : 0), 0);
const canAfford = (cost) => Object.keys(cost).every((k) => count(k) >= cost[k]);
const costStr = (cost) => Object.keys(cost).map((k) => cost[k] + ' ' + ITEMS[k].n).join(' + ');
const row = (l, c, a, ok) => '<button class="b" data-a="' + a + '"' + (ok ? '' : ' disabled') + '><span>' + l + '</span><span>' + c + '</span></button>';

export function openCraft(station) {
  panelState.type = 'craft';
  panelState.station = station;
  renderPanel();
  panel.style.display = 'block';
}
// C key / inventory "Craft" button: crafting only happens at a station, so open the one you are standing at.
export function openNearestStation() {
  let best = null, bd = STATION_RANGE;
  for (const st of STATIONS) {
    const d = Math.hypot(S.P.x - st.x, S.P.z - STATION_Z);
    if (d < bd) { bd = d; best = st; }
  }
  if (!best) { say('Go to a crafting station: Refinery, Loom, Forge or Tannery'); return; }
  openCraft(best.k);
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
    const st = STATIONS.find((x) => x.k === panelState.station);
    if (!st) { closePanel(); return; }
    const fam = FAMILIES[st.fam];
    h += '<h3>' + st.name + '</h3>';
    h += '<p><small>' + ITEMS[fam.raw].n + ' &rarr; ' + ITEMS[fam.refined].n + ' &middot; makes ' + st.fam + ' gear. Tier 1.</small></p>';
    const cats = {};
    RECIPES.filter((r) => r.station === st.k).forEach((r) => (cats[r.cat] || (cats[r.cat] = [])).push(r));
    ['Refine', 'Armor', 'Weapons', 'Tools'].forEach((c) => {
      if (!cats[c]) return;
      h += '<h4>' + c + '</h4>';
      cats[c].forEach((r) => {
        h += row(r.name + (r.n > 1 ? ' x' + r.n : '') + ' <small>' + costStr(r.cost) + '</small>', 'Craft', 'c:' + r.id, canAfford(r.cost));
      });
    });
    h += '<button class="b x" data-a="close">Close</button>';
  } else if (panelState.type === 'travel') {
    if (REALM.id === 't2') { // Frostfall's portal leads home
      h += '<h3>Travel Planner</h3><p>The portal remembers the way home.</p>';
      h += '<button class="b" data-a="t:7"><span>Night World <small>· Tier 1 · the start world</small></span><span>travel</span></button>';
    } else {
      h += '<h3>Travel Planner</h3><p>Onward. There is no way back.</p>';
      WORLDS.forEach((w) => {
        h += '<button class="b" data-a="t:' + w.seed + '"><span>' + w.name + ' <small>· ' + w.tag + '</small></span><span>travel</span></button>';
      });
    }
    // (no free-form seed box: the public server only opens the listed worlds)
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
    if (a.indexOf('t:') === 0) return travelToSeed(parseInt(a.slice(2), 10));
    if (a.indexOf('c:') === 0) send({ t: 'craft', id: a.slice(2) }); // server checks station, materials, space
  });
}
