// Marking another player: tap them (or press T). Their name and HP show beside your own status; tap that frame for
// Inspect (what they wear) and Trade. The server answers 'tg' (HP, tiny, every 3 s) and 'inspected' (equipment).
import { EQUIP_SLOTS, ITEMS } from '../shared/data.js';
import { S } from './state.js';
import { T, scene, cam } from './scene.js';
import { send } from './net.js';
import { sfx } from './audio.js';
import { say } from './ui.js';
import { requestTrade } from './trade.js';

const $ = (id) => document.getElementById(id);
const frame = $('target'), menu = $('tmenu'), insp = $('inspect');
const SLOT_NAME = { head: 'Head', chest: 'Chest', foot: 'Feet', main: 'Main hand', off: 'Off hand', mount: 'Mount', potion: 'Potion', food: 'Food' };
let ring = null, pollT = 0;

export function initTarget() {
  const geo = new T.RingGeometry(0.85, 1.05, 28);
  geo.rotateX(-Math.PI / 2);
  ring = new T.Mesh(geo, new T.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.9, depthTest: false }));
  ring.renderOrder = 10;
  ring.visible = false;
  scene.add(ring);
  frame.addEventListener('click', () => toggleMenu());
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !S.target) return;
    const a = b.dataset.a, id = S.target.id;
    closeMenu();
    if (a === 'inspect') send({ t: 'inspect', id });
    else if (a === 'trade') requestTrade(id);
    else if (a === 'clear') clearTarget();
  });
  insp.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'trade' && S.target) requestTrade(S.target.id);
    closeInspect();
  });
}

export function setTarget(id) {
  const o = S.others[id];
  if (!o) return;
  const same = S.target && S.target.id === id;
  S.target = { id, name: o.name || 'Player', hp: same ? S.target.hp : 0, mh: same ? S.target.mh : 0 };
  if (!same) sfx('equip');
  renderTarget();
  pollT = 0;
}
export function clearTarget() {
  S.target = null;
  closeMenu();
  renderTarget();
}
function renderTarget() {
  const t = S.target;
  frame.classList.toggle('show', !!t);
  if (!t) { ring.visible = false; return; }
  frame.querySelector('.tn').textContent = t.name;
  frame.querySelector('.tf').style.width = (t.mh > 0 ? Math.max(0, Math.min(1, t.hp / t.mh)) * 100 : 100) + '%';
}
export const onTg = (m) => {
  if (!S.target || S.target.id !== String(m.id)) return;
  if (m.gone) { clearTarget(); return; }
  S.target.hp = m.hp; S.target.mh = m.mh;
  renderTarget();
};

function toggleMenu() {
  if (!S.target) return;
  if (menu.classList.contains('show')) return closeMenu();
  menu.innerHTML = '<div class="t">' + esc(S.target.name) + '</div><button data-a="inspect">Inspect gear</button><button data-a="trade">Trade</button><button class="x" data-a="clear">Clear target</button>';
  menu.classList.add('show');
}
export function closeMenu() { menu.classList.remove('show'); }
export const menuOpen = () => menu.classList.contains('show');
export const inspectOpen = () => insp.classList.contains('show');
export function closeInspect() { insp.classList.remove('show'); }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pc = (v) => Math.round(v * 100) + '%';

export function onInspected(m) {
  let h = '<h3>' + esc(m.name) + '</h3><p>HP ' + m.hp + ' / ' + m.mh + (m.mt ? ' · riding' : '') + '</p><h4>Equipment</h4>';
  let any = false;
  for (const s of EQUIP_SLOTS) {
    const it = m.eq[s];
    if (!it) continue;
    any = true;
    h += '<div class="row"><b>' + SLOT_NAME[s] + '</b><span>' + esc((ITEMS[it.id] && ITEMS[it.id].n) || it.id) + (it.n > 1 ? ' ×' + it.n : '') + '</span></div>';
  }
  if (!any) h += '<div class="row none">Nothing equipped</div>';
  const st = m.st || {};
  h += '<h4>Stats</h4><p>DMG ' + pc(st.dmg || 1) + ' · CD ' + pc(st.haste || 0) + ' · DEF ' + pc(st.def || 0) + (st.speed ? ' · speed +' + pc(st.speed) : '') + '</p>';
  h += '<div class="btns"><button data-a="trade" class="go">Trade</button><button data-a="close">Close</button></div>';
  insp.innerHTML = h;
  insp.classList.add('show');
}

// ---- picking: the player nearest to the tap on the screen, within a finger's width
const v = new T.Vector3();
// where a player is on the screen (also used by the browser test)
export function screenOf(id) {
  const g = S.others[id] && S.others[id].g;
  if (!g) return null;
  v.set(g.position.x, g.position.y + 1.2, g.position.z).project(cam);
  return v.z > 1 ? null : { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
}
export function pickPlayer(cx, cy, maxPx = 56) {
  let best = null, bd = maxPx;
  for (const id in S.others) {
    const g = S.others[id].g;
    const sp = screenOf(id);
    if (!sp) continue;
    const d = Math.hypot(sp.x - cx, sp.y - cy);
    if (d < bd) { bd = d; best = id; }
  }
  if (!best) return false;
  setTarget(best);
  return true;
}
// keyboard T: the nearest player, then the next nearest...
export function cycleTarget() {
  const list = Object.keys(S.others).map((id) => ({ id, d: Math.hypot(S.others[id].g.position.x - S.P.x, S.others[id].g.position.z - S.P.z) })).sort((a, b) => a.d - b.d);
  if (!list.length) { say('No players nearby'); return; }
  const i = S.target ? list.findIndex((e) => e.id === S.target.id) : -1;
  setTarget(list[(i + 1) % list.length].id);
}

// ---- every frame: the ring under the target, losing a target that left, asking for its HP
export function updateTarget(now) {
  const t = S.target;
  if (!t) return;
  const o = S.others[t.id];
  if (!o || Math.hypot(o.g.position.x - S.P.x, o.g.position.z - S.P.z) > 230) { if (!o) { say(t.name + ' is out of sight'); clearTarget(); } return; }
  ring.visible = true;
  ring.position.set(o.g.position.x, o.g.position.y + 0.08, o.g.position.z);
  const s = 1 + Math.sin(now / 220) * 0.06;
  ring.scale.set(s, 1, s);
  if (now - pollT > 3000) { pollT = now; send({ t: 'tg', id: t.id }); }
}
