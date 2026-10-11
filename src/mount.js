import { S } from './state.js';
import { scene } from './scene.js';
import { mkDonkey } from './figures.js';
import { send } from './net.js';
import { hgt } from './terrain.js';

let donkeyMesh = null;
const btn = document.getElementById('mount');
export const getDonkey = () => donkeyMesh;
export const hasMountEquipped = () => !!(S.inv.eq.mount && S.inv.eq.mount.id === 'donkey');

export function updateMountButton() {
  if (S.mounted) { btn.style.display = 'block'; btn.textContent = 'Dismount'; return; }
  if (hasMountEquipped()) { btn.style.display = 'block'; btn.textContent = 'Mount'; return; }
  btn.style.display = 'none';
}

// Server tells us (every snapshot) whether we ride and where a parked donkey stands.
export function applyMountState(mt, dk) {
  const was = S.mounted;
  S.mounted = !!mt;
  S.donkeyPos = dk || null;
  if (was !== S.mounted) updateMountButton();
}

export function updateDonkey() {
  const want = S.mounted || !!S.donkeyPos;
  if (want && !donkeyMesh) { donkeyMesh = mkDonkey(); scene.add(donkeyMesh); }
  if (!want && donkeyMesh) { scene.remove(donkeyMesh); donkeyMesh = null; return; }
  if (!donkeyMesh) return;
  if (S.mounted) {
    donkeyMesh.position.set(S.P.x, S.P.y, S.P.z);
    donkeyMesh.rotation.y = S.P.r;
  } else {
    donkeyMesh.position.set(S.donkeyPos.x, hgt(S.donkeyPos.x, S.donkeyPos.z), S.donkeyPos.z);
  }
}

export function initMount() {
  btn.addEventListener('click', () => {
    if (S.gather.active) return;
    send({ t: S.mounted ? 'dismount' : 'mount' });
  });
}
