import { S } from './state.js';
import { scene } from './scene.js';
import { mkDonkey } from './figures.js';
import { send } from './net.js';
import { hgt } from './terrain.js';
import { CFG } from '../shared/data.js';

let donkeyMesh = null;
const btn = document.getElementById('mount');
export const getDonkey = () => donkeyMesh;
export const hasMountEquipped = () => !!(S.inv.eq.mount && S.inv.eq.mount.id === 'donkey');

const mpWrap = document.getElementById('mpwrap'), mpFill = document.getElementById('mpfill'), mpLabel = document.getElementById('mplabel');
const waitLeft = () => Math.max(0, S.mountReadyAt - performance.now());
export function updateMountButton() {
  const eq = hasMountEquipped(), w = waitLeft();
  const show = S.mounted || eq;
  // donkey HP bar: only while you own a donkey
  mpWrap.style.display = mpLabel.style.display = show ? 'block' : 'none';
  if (show) {
    mpFill.style.width = (w > 0 ? 0 : Math.max(0, S.mountHp / CFG.MOUNT_HP) * 100) + '%';
    const t = w > 0 ? 'Donkey back in ' + Math.ceil(w / 1000) + 's' : 'Donkey ' + Math.round(S.mountHp) + ' / ' + CFG.MOUNT_HP;
    if (mpLabel.textContent !== t) mpLabel.textContent = t;
  }
  if (S.mounted) { btn.style.display = 'block'; btn.textContent = 'Dismount'; btn.classList.remove('wait'); return; }
  if (eq) {
    btn.style.display = 'block';
    btn.textContent = w > 0 ? Math.ceil(w / 1000) + 's' : 'Mount';
    btn.classList.toggle('wait', w > 0);
    return;
  }
  btn.style.display = 'none';
}

// Server tells us (every snapshot) whether we ride and where a parked donkey stands.
export function applyMountState(mt, dk, dh, dr) {
  S.mounted = !!mt;
  S.donkeyPos = dk || null;
  if (typeof dh === 'number') S.mountHp = dh;
  if (typeof dr === 'number') S.mountReadyAt = dr > 0 ? performance.now() + dr : 0;
  updateMountButton(); // cheap: only touches the DOM when something changed
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
    if (S.gather.active || (!S.mounted && waitLeft() > 0)) return;
    send({ t: S.mounted ? 'dismount' : 'mount' });
  });
}
