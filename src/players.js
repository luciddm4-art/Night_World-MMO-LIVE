// Other players: created from server snapshots, smoothed locally.
import { S } from './state.js';
import { T, scene } from './scene.js';
import { mkFig, mkNameTag, mkDonkey, animFig, upS, disposeFig, setHeld } from './figures.js';
import { attackFx } from './fx.js';
import { WEAPONS } from '../shared/data.js';

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Create / update the players in `list`. Returns the set of ids it saw.
export function upsertPlayers(list) {
  const seen = {};
  for (const e of list) {
    seen[e.id] = 1;
    let o = S.others[e.id];
    if (!o) {
      const col = HEX.test(e.c) ? e.c : '#888888';
      const g = mkFig(new T.Color(col).getHex());
      const tag = mkNameTag(String(e.n || '?').slice(0, 16));
      g.add(tag);
      g.position.set(num(e.x), 0.13, num(e.z));
      scene.add(g);
      o = S.others[e.id] = { g, col, a: e.a, donkey: null, name: String(e.n || '?').slice(0, 16) };
    }
    o.tx = num(e.x); o.tz = num(e.z); o.ty = num(e.y); o.tr = num(e.r);
    setHeld(o.g, e.w); // what they hold is visible to everyone
    if (e.a !== o.a) { // swing animation + weapon effect
      o.a = e.a; o.g.userData.t = performance.now();
      const wp = WEAPONS[e.w];
      attackFx(o.g.position.x, o.g.position.y, o.g.position.z, o.tr, e.w, wp ? wp.reach : 0);
    }
    o.m = !!e.m;
  }
  return seen;
}

function dropPlayer(k) {
  const o = S.others[k];
  if (!o) return;
  if (o.donkey) scene.remove(o.donkey);
  disposeFig(scene, o.g);
  delete S.others[k];
}

// Full picture: whoever is not in the list is gone.
export function syncPlayers(list) {
  const seen = upsertPlayers(list);
  for (const k in S.others) if (!seen[k]) dropPlayer(k);
}

// Protocol 2: only what changed, plus an explicit list of ids that left.
export function patchPlayers(list, gone) {
  if (list) upsertPlayers(list);
  if (gone) for (const k of gone) dropPlayer(k);
}

export function clearPlayers() {
  syncPlayers([]);
}

export function updatePlayers(dt, now) {
  const f = Math.min(1, dt * 10);
  for (const k in S.others) {
    const o = S.others[k], g = o.g;
    if (o.tx !== undefined) {
      g.position.x += (o.tx - g.position.x) * f;
      g.position.z += (o.tz - g.position.z) * f;
      g.position.y += (o.ty + (o.m ? 0.55 : 0) - g.position.y) * f;
      g.rotation.y += ((((o.tr - g.rotation.y + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * f;
    }
    if (o.px === undefined) { o.px = g.position.x; o.pz = g.position.z; }
    const sp = Math.min(20, Math.hypot(g.position.x - o.px, g.position.z - o.pz) / Math.max(dt, 1e-3));
    o.px = g.position.x; o.pz = g.position.z;

    // riders sit on a donkey
    if (o.m && !o.donkey) { o.donkey = mkDonkey(); scene.add(o.donkey); }
    if (!o.m && o.donkey) { scene.remove(o.donkey); o.donkey = null; }
    if (o.donkey) {
      o.donkey.position.set(g.position.x, g.position.y, g.position.z);
      o.donkey.rotation.y = g.rotation.y;
    }
    upS(g, now);
    animFig(g, dt, o.m ? 0 : sp, now);
  }
}
