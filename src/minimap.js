import { S } from './state.js';
import { hgt } from './terrain.js';
import { getDonkey } from './mount.js';
import { PORTAL, TOWN } from '../shared/data.js';

const mg = document.getElementById('mm').getContext('2d');
const MS = 48, RNG = 100, CL = 96 / MS;

export function drawMap() {
  const P = S.P;
  for (let i = 0; i < MS; i++) {
    for (let j = 0; j < MS; j++) {
      const h = hgt(P.x + (i / MS - 0.5) * 2 * RNG, P.z + (j / MS - 0.5) * 2 * RNG), v = Math.min(1, h / 30);
      mg.fillStyle = h <= 0.3 ? 'rgb(36,60,46)' : 'rgb(' + ((40 + v * 150) | 0) + ',' + ((70 + v * 110) | 0) + ',' + ((48 + v * 130) | 0) + ')';
      mg.fillRect(i * CL, j * CL, CL + 0.5, CL + 0.5);
    }
  }
  const mp = (wx, wz) => [48 + ((wx - P.x) / RNG) * 48, 48 + ((wz - P.z) / RNG) * 48];
  // the town wall (a square) and, pinned to the map edge when it is far away, the portal
  mg.strokeStyle = 'rgba(242,211,74,.75)';
  mg.lineWidth = 1.5;
  const a = mp(-TOWN.half, -TOWN.half), b = mp(TOWN.half, TOWN.half);
  mg.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  const pp = mp(PORTAL.x, PORTAL.z);
  let qx = pp[0], qy = pp[1];
  const far = Math.hypot(qx - 48, qy - 48) > 40;
  if (far) { const ang = Math.atan2(qy - 48, qx - 48); qx = 48 + Math.cos(ang) * 40; qy = 48 + Math.sin(ang) * 40; }
  mg.fillStyle = '#6fc0ff';
  mg.strokeStyle = '#fff';
  mg.lineWidth = 1;
  mg.beginPath();
  mg.moveTo(qx, qy - 5); mg.lineTo(qx + 4, qy); mg.lineTo(qx, qy + 5); mg.lineTo(qx - 4, qy);
  mg.closePath();
  mg.fill();
  mg.stroke();
  for (const id in S.rabbits) {
    const rb = S.rabbits[id];
    if (rb.dead) continue;
    const rp = mp(rb.x, rb.z);
    if (rp[0] > 2 && rp[0] < 94 && rp[1] > 2 && rp[1] < 94) { mg.fillStyle = '#c88888'; mg.fillRect(rp[0] - 1, rp[1] - 1, 2, 2); }
  }
  for (const k in S.others) {
    const o = S.others[k];
    const p = mp(o.g.position.x, o.g.position.z);
    if (p[0] > 2 && p[0] < 94 && p[1] > 2 && p[1] < 94) { mg.fillStyle = o.col; mg.beginPath(); mg.arc(p[0], p[1], 3, 0, 6.283); mg.fill(); }
  }
  const dm = getDonkey();
  if (dm && !S.mounted) {
    const dp = mp(dm.position.x, dm.position.z);
    if (dp[0] > 2 && dp[0] < 94 && dp[1] > 2 && dp[1] < 94) { mg.fillStyle = '#8a5a3a'; mg.fillRect(dp[0] - 2, dp[1] - 2, 4, 4); }
  }
  const sx = Math.sin(P.r), sz = Math.cos(P.r);
  mg.fillStyle = '#fff';
  mg.beginPath();
  mg.moveTo(48 + sx * 7, 48 + sz * 7);
  mg.lineTo(48 - sx * 4 + sz * 4, 48 - sz * 4 - sx * 4);
  mg.lineTo(48 - sx * 4 - sz * 4, 48 - sz * 4 + sx * 4);
  mg.fill();
}
