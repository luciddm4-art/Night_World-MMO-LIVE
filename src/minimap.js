import { S } from './state.js';
import { hgt } from './terrain.js';
import { getDonkey } from './mount.js';

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
  const c = mp(0, 0);
  mg.fillStyle = '#f2d34a';
  if (c[0] > 5 && c[0] < 91 && c[1] > 5 && c[1] < 91) mg.fillRect(c[0] - 3, c[1] - 3, 6, 6);
  else {
    const ang = Math.atan2(c[1] - 48, c[0] - 48);
    mg.beginPath();
    mg.arc(48 + Math.cos(ang) * 43, 48 + Math.sin(ang) * 43, 3, 0, 6.283);
    mg.fill();
  }
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
