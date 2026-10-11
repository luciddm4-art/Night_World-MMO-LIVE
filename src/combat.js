import { CFG } from '../shared/data.js';
import { S } from './state.js';
import { send } from './net.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';

const FACE_RANGE = 3.4;
// Turn toward the nearest living rabbit in reach so a swing doesn't miss by a few degrees.
function autoFace() {
  let best = null, bd = FACE_RANGE;
  for (const id in S.rabbits) {
    const r = S.rabbits[id];
    if (r.dead) continue;
    const d = Math.hypot(r.x - S.P.x, r.z - S.P.z);
    if (d < bd) { bd = d; best = r; }
  }
  if (best) S.P.r = Math.atan2(best.x - S.P.x, best.z - S.P.z);
}

let atkT = 0;
let meFig = null;
export function bindFigure(fig) { meFig = fig; }

// The server validates cooldown, range and damage; this is just the button.
export function tryAttack() {
  if (!S.ready || S.mounted) return;
  const now = performance.now();
  if (now - atkT < CFG.PLAYER_BASE_ATK_MS * (1 - S.st.haste)) return;
  atkT = now;
  if (settings.autoface) autoFace();
  sfx('swing');
  if (meFig) meFig.userData.t = now;
  send({ t: 'atk', r: S.P.r });
}

export function initCombat() {
  document.getElementById('atk').addEventListener('pointerdown', (e) => { e.preventDefault(); tryAttack(); });
}
