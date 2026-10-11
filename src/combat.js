import { CFG } from '../shared/data.js';
import { S } from './state.js';
import { send } from './net.js';

let atkT = 0;
let meFig = null;
export function bindFigure(fig) { meFig = fig; }

// The server validates cooldown, range and damage; this is just the button.
export function tryAttack() {
  if (!S.ready || S.mounted) return;
  const now = performance.now();
  if (now - atkT < CFG.PLAYER_BASE_ATK_MS * (1 - S.st.haste)) return;
  atkT = now;
  if (meFig) meFig.userData.t = now;
  send({ t: 'atk', r: S.P.r });
}

export function initCombat() {
  document.getElementById('atk').addEventListener('pointerdown', (e) => { e.preventDefault(); tryAttack(); });
}
