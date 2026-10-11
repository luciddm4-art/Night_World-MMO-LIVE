// "Use" button / E key: stations, portal, gathering (with a cast bar), donkey.
import { STATIONS, STATION_Z, PORTAL, ITEMS, CFG } from '../shared/data.js';
import { S, nodeQty } from './state.js';
import { send } from './net.js';
import { chunks, world, treeReady, setTreeShake, setNodeShake, hgt } from './terrain.js';
import { burst } from './fx.js';
import { sfx } from './audio.js';
import { vibrate } from './settings.js';
import { panelState, openCraft, openTravel, closePanel } from './panel.js';
import { getDonkey } from './mount.js';

const { CS } = CFG;
const ub = document.getElementById('use');
const castEl = document.getElementById('cast'), castFill = document.getElementById('castfill'), castLabel = document.getElementById('castlabel');
export let interact = null;

const LABELS = { tree: 'Gathering wood...', node: 'Gathering...', corpse: 'Gathering hide...', mount: 'Summoning donkey...' };

function showCast(label) {
  castEl.style.display = 'block';
  castLabel.style.display = 'block';
  castLabel.textContent = label;
  castFill.style.width = '0%';
}
// ---- gather feedback: shake the target, throw chips, tick sounds ----
let fxTarget = null, nextTick = 0;
function targetPos(kind, id) {
  if (kind === 'tree') {
    const [X, Z, q] = id.split(',').map(Number);
    const t = world.ctrees(X, Z);
    return t[q * 3] === undefined ? null : { x: t[q * 3], z: t[q * 3 + 1], y: 1.2, color: 0xc89a5a };
  }
  if (kind === 'node') {
    const [X, Z] = id.split(':')[1].split(',').map(Number);
    for (const nd of world.cres(X, Z)) if (nd.id === id) return { x: nd.x, z: nd.z, y: 0.6, color: id.startsWith('cotton') ? 0xffffff : 0xb8c4d8 };
  }
  return null;
}
function startFx(kind, id) {
  stopFx();
  if (kind === 'tree') setTreeShake(id);
  else if (kind === 'node') setNodeShake(id);
  fxTarget = targetPos(kind, id);
  nextTick = performance.now() + 150;
}
function stopFx() {
  setTreeShake(null);
  setNodeShake(null);
  fxTarget = null;
}

export function hideCast() {
  stopFx();
  castEl.style.display = 'none';
  castLabel.style.display = 'none';
  castFill.style.width = '0%';
}

// Server accepted the request and started the timer.
export function onCast(m) {
  const g = S.gather;
  g.active = true; g.pending = 0;
  g.kind = m.kind; g.id = m.id; g.start = performance.now(); g.dur = m.dur;
  let label = LABELS[m.kind] || 'Working...';
  if (m.kind === 'node') label = 'Gathering ' + ITEMS[m.id.split(':')[0]].n + '...';
  showCast(label);
  startFx(m.kind, m.id);
}
export function onFail() {
  S.gather.active = false; S.gather.pending = 0;
  hideCast();
}
export function cancelGather(notify = true) {
  if (!S.gather.active && !S.gather.pending) return;
  S.gather.active = false; S.gather.pending = 0;
  hideCast();
  if (notify) send({ t: 'gcancel' });
}
// called every frame
export function updateGather(now) {
  const g = S.gather;
  if (!g.active) return;
  const pct = (now - g.start) / g.dur;
  if (fxTarget && now >= nextTick) {
    nextTick = now + 300;
    burst(fxTarget.x, hgt(fxTarget.x, fxTarget.z) + fxTarget.y, fxTarget.z, { n: 5, color: fxTarget.color, speed: 1.4, up: 2, life: 0.45 });
    sfx('tick');
    vibrate(8);
  }
  castFill.style.width = Math.min(100, pct * 100) + '%';
  if (pct >= 1) {
    if (fxTarget) burst(fxTarget.x, hgt(fxTarget.x, fxTarget.z) + fxTarget.y, fxTarget.z, { n: 14, color: fxTarget.color, speed: 2.2, up: 3, life: 0.6 });
    g.active = false;
    hideCast();
    send({ t: 'gdone' });
  }
}

function findInteract() {
  const P = S.P;
  let best = null, bd = 2.6;
  for (const st of STATIONS) {
    const d = Math.hypot(P.x - st.x, P.z - STATION_Z);
    if (d < 2.4 && d < bd) { bd = d; best = { kind: 'station', st }; }
  }
  const pd = Math.hypot(P.x - PORTAL.x, P.z - PORTAL.z);
  if (pd < PORTAL.r && pd < bd) { bd = pd; best = { kind: 'portal' }; }
  const dm = getDonkey();
  if (dm && !S.mounted) {
    const dd = Math.hypot(P.x - dm.position.x, P.z - dm.position.z);
    if (dd < 2.5 && dd < bd) { bd = dd; best = { kind: 'donkey' }; }
  }
  const pcx = Math.floor(P.x / CS), pcz = Math.floor(P.z / CS);
  for (const k in chunks) {
    const c = chunks[k];
    if (Math.abs(c.cx - pcx) > 1 || Math.abs(c.cz - pcz) > 1) continue;
    for (const nd of c.nodes) {
      if (nodeQty(nd.def.id) <= 0) continue;
      const d2 = Math.hypot(P.x - nd.def.x, P.z - nd.def.z);
      if (d2 < 2.0 && d2 < bd) { bd = d2; best = { kind: 'node', node: nd }; }
    }
  }
  for (let ii = -1; ii <= 1; ii++) {
    for (let jj = -1; jj <= 1; jj++) {
      const X = pcx + ii, Z = pcz + jj, t = world.ctrees(X, Z);
      for (let q = 0; q < t.length; q += 3) {
        const tk = X + ',' + Z + ',' + q / 3;
        if (!treeReady(tk)) continue;
        const d3 = Math.hypot(P.x - t[q], P.z - t[q + 1]);
        if (d3 < 1.8 && d3 < bd) { bd = d3; best = { kind: 'tree', tk }; }
      }
    }
  }
  for (const id in S.rabbits) {
    const rb = S.rabbits[id];
    if (!rb.dead) continue;
    const dr = Math.hypot(P.x - rb.x, P.z - rb.z);
    if (dr < 1.8 && dr < bd) { bd = dr; best = { kind: 'corpse', rab: rb }; }
  }
  return best;
}

export function checkNear() {
  interact = S.ready ? findInteract() : null;
  if (interact) {
    ub.style.display = 'block';
    if (interact.kind === 'station') ub.textContent = 'Open ' + interact.st.name;
    else if (interact.kind === 'portal') ub.textContent = 'Travel Planner';
    else if (interact.kind === 'tree') ub.textContent = 'Gather Wood (2s)';
    else if (interact.kind === 'node') ub.textContent = 'Gather ' + ITEMS[interact.node.def.type].n + ' (2s)';
    else if (interact.kind === 'corpse') ub.textContent = 'Gather Hide (2s)';
    else if (interact.kind === 'donkey') ub.textContent = 'Mount Donkey';
  } else ub.style.display = 'none';
  if (panelState.type === 'craft' && panelState.station && (!interact || interact.kind !== 'station' || interact.st.k !== panelState.station)) closePanel();
  if (panelState.type === 'travel' && (!interact || interact.kind !== 'portal')) closePanel();
}

export function doInteract() {
  if (!S.ready) return;
  if (S.gather.active) { cancelGather(); return; }
  if (!interact || S.gather.pending) return;
  const ask = (kind, id) => {
    S.gather.pending = 1;
    setTimeout(() => { S.gather.pending = 0; }, 3000); // never get stuck if a reply is lost
    send({ t: 'gather', kind, id });
  };
  switch (interact.kind) {
    case 'station': return openCraft(interact.st.k);
    case 'portal': return openTravel();
    case 'tree': return ask('tree', interact.tk);
    case 'node': return ask('node', interact.node.def.id);
    case 'corpse': return ask('corpse', interact.rab.id);
    case 'donkey': return send({ t: 'mount' });
    default: return undefined;
  }
}

export function initInteract() {
  ub.addEventListener('click', doInteract);
}
