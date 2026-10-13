import { S } from './state.js';
import { hgt } from './terrain.js';
import { getDonkey } from './mount.js';
import { PORTAL, TOWN } from '../shared/data.js';

// The minimap is a small round canvas in the corner. Tap it and it opens large (a bigger area, drawn sharper);
// tap again, tap the dark backdrop, or press Esc/M to close.
const cv = document.getElementById('mm');
const mg = cv.getContext('2d');
const back = document.getElementById('mmback');
let big = false;

// small: 48x48 samples over +-100 units, drawn on a 96 px canvas. big: 96x96 samples over +-240 units on 384 px.
const MODES = { small: { size: 96, ms: 48, rng: 100 }, big: { size: 384, ms: 96, rng: 240 } };

export const isMapBig = () => big;
export function setMapBig(on) {
  big = !!on;
  const m = big ? MODES.big : MODES.small;
  cv.width = cv.height = m.size;
  cv.classList.toggle('big', big);
  back.classList.toggle('show', big);
  drawMap(true);
}
export function toggleMap() { setMapBig(!big); }
cv.addEventListener('click', toggleMap);
back.addEventListener('click', () => setMapBig(false));

export function drawMap() {
  const P = S.P;
  const { size, ms, rng } = big ? MODES.big : MODES.small;
  const k = size / 96; // everything below is laid out for a 96 px canvas and scaled by k
  const mid = size / 2, cl = size / ms;
  for (let i = 0; i < ms; i++) {
    for (let j = 0; j < ms; j++) {
      const h = hgt(P.x + (i / ms - 0.5) * 2 * rng, P.z + (j / ms - 0.5) * 2 * rng), v = Math.min(1, h / 30);
      mg.fillStyle = h <= 0.3 ? 'rgb(36,60,46)' : 'rgb(' + ((40 + v * 150) | 0) + ',' + ((70 + v * 110) | 0) + ',' + ((48 + v * 130) | 0) + ')';
      mg.fillRect(i * cl, j * cl, cl + 0.5, cl + 0.5);
    }
  }
  const mp = (wx, wz) => [mid + ((wx - P.x) / rng) * mid, mid + ((wz - P.z) / rng) * mid];
  const inside = (p, pad = 2 * k) => p[0] > pad && p[0] < size - pad && p[1] > pad && p[1] < size - pad;
  // the town wall (a square) and, pinned to the map edge when it is far away, the portal
  mg.strokeStyle = 'rgba(242,211,74,.75)';
  mg.lineWidth = 1.5 * k;
  const a = mp(-TOWN.half, -TOWN.half), b = mp(TOWN.half, TOWN.half);
  mg.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  const pp = mp(PORTAL.x, PORTAL.z);
  let qx = pp[0], qy = pp[1];
  const far = Math.hypot(qx - mid, qy - mid) > mid * 0.83;
  if (far) { const ang = Math.atan2(qy - mid, qx - mid); qx = mid + Math.cos(ang) * mid * 0.83; qy = mid + Math.sin(ang) * mid * 0.83; }
  const d = (big ? 0.9 : 1) * k;
  mg.fillStyle = '#6fc0ff';
  mg.strokeStyle = '#fff';
  mg.lineWidth = k;
  mg.beginPath();
  mg.moveTo(qx, qy - 5 * d); mg.lineTo(qx + 4 * d, qy); mg.lineTo(qx, qy + 5 * d); mg.lineTo(qx - 4 * d, qy);
  mg.closePath();
  mg.fill();
  mg.stroke();
  const dot = (big ? 0.6 : 1) * k;
  for (const id in S.rabbits) {
    const rb = S.rabbits[id];
    if (rb.dead) continue;
    const rp = mp(rb.x, rb.z);
    if (inside(rp)) { mg.fillStyle = '#c88888'; mg.fillRect(rp[0] - dot, rp[1] - dot, 2 * dot, 2 * dot); }
  }
  for (const key in S.others) {
    const o = S.others[key];
    const p = mp(o.g.position.x, o.g.position.z);
    if (inside(p)) { mg.fillStyle = o.col; mg.beginPath(); mg.arc(p[0], p[1], 3 * dot, 0, 6.283); mg.fill(); }
  }
  const dm = getDonkey();
  if (dm && !S.mounted) {
    const dp = mp(dm.position.x, dm.position.z);
    if (inside(dp)) { mg.fillStyle = '#8a5a3a'; mg.fillRect(dp[0] - 2 * dot, dp[1] - 2 * dot, 4 * dot, 4 * dot); }
  }
  const sx = Math.sin(P.r), sz = Math.cos(P.r), u = (big ? 0.8 : 1) * k;
  mg.fillStyle = '#fff';
  mg.beginPath();
  mg.moveTo(mid + sx * 7 * u, mid + sz * 7 * u);
  mg.lineTo(mid - sx * 4 * u + sz * 4 * u, mid - sz * 4 * u - sx * 4 * u);
  mg.lineTo(mid - sx * 4 * u - sz * 4 * u, mid - sz * 4 * u + sx * 4 * u);
  mg.fill();
  if (big) { // a little compass: the map always has north (-z) at the top
    mg.fillStyle = 'rgba(242,211,74,.9)';
    mg.font = '700 ' + 14 * (k / 2) + 'px Georgia,serif';
    mg.textAlign = 'center';
    mg.fillText('N', mid, 20);
  }
}
