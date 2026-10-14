import { weaponOf } from '../shared/data.js';
import { S } from './state.js';
import { send } from './net.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';
import { attackFx } from './fx.js';

// Turn toward the nearest living rabbit in reach of the held weapon so a swing doesn't miss by a few degrees.
// Returns the distance to that rabbit (or the weapon's full reach when nothing is near).
export function autoFace(wp) {
  let best = null, bd = wp.reach + 0.8;
  for (const id in S.rabbits) {
    const r = S.rabbits[id];
    if (r.dead) continue;
    const d = Math.hypot(r.x - S.P.x, r.z - S.P.z);
    if (d < bd) { bd = d; best = r; }
  }
  if (best) { S.P.r = Math.atan2(best.x - S.P.x, best.z - S.P.z); return bd; }
  return wp.reach;
}

let atkT = 0;
let meFig = null;
export function bindFigure(fig) { meFig = fig; }

// The server validates cooldown, range and damage; this is just the button.
export function tryAttack() {
  if (!S.ready || S.mounted || S.spell) return;
  const now = performance.now();
  const wp = weaponOf(S.inv.eq);
  if (now - atkT < wp.cd * (1 - S.st.haste)) return;
  atkT = now;
  const len = settings.autoface ? autoFace(wp) : wp.reach;
  sfx(wp.id === 'sword' ? 'slash' : wp.id === 'bow' ? 'bow' : wp.id === 'fire_staff' ? 'fire' : 'swing');
  attackFx(S.P.x, S.P.y, S.P.z, S.P.r, wp.id, len);
  if (meFig) meFig.userData.t = now;
  send({ t: 'atk', r: S.P.r });
}

export function initCombat() {
  document.getElementById('atk').addEventListener('pointerdown', (e) => { e.preventDefault(); tryAttack(); });
}
