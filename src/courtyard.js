// The spawn hall: walls, crafting stations, portal. Static scenery + collision.
import { STATIONS, PORTAL } from '../shared/data.js';
import { T, scene, tex, R } from './scene.js';
import { mkFig } from './figures.js';

export const ST = STATIONS;
export { PORTAL };

const stone = tex([120, 120, 128], 1, 1);
const floorMesh = new T.Mesh(new T.BoxGeometry(24, 0.2, 24), new T.MeshLambertMaterial({ map: tex([95, 95, 105], 1, 8) }));
floorMesh.position.y = 0.03;
scene.add(floorMesh);

const wallMat = new T.MeshLambertMaterial({ map: stone });
const merlon = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), wallMat, 120);
let mi = 0;
const m4 = new T.Matrix4();
function wall(cx, cz, len, alongX) {
  const w = new T.Mesh(new T.BoxGeometry(alongX ? len : 1.2, 4, alongX ? 1.2 : len), wallMat);
  w.position.set(cx, 2, cz);
  scene.add(w);
  for (let k = -len / 2 + 0.5; k < len / 2; k += 2) {
    m4.makeTranslation(alongX ? cx + k : cx, 4.5, alongX ? cz : cz + k);
    m4.scale(new T.Vector3(1, 1, 1));
    merlon.setMatrixAt(mi++, m4);
  }
}
wall(0, -12, 24, 1); wall(-12, 0, 24, 0); wall(12, 0, 24, 0); wall(-7.5, 12, 9, 1); wall(7.5, 12, 9, 1);
merlon.count = mi;
merlon.frustumCulled = false;
scene.add(merlon);

const torches = [];
[[-9, -9], [9, -9], [-9, 9], [9, 9]].forEach((p) => {
  const t2 = new T.Mesh(new T.BoxGeometry(0.3, 1.6, 0.3), new T.MeshLambertMaterial({ color: 0x4a3320 }));
  t2.position.set(p[0], 0.9, p[1]);
  scene.add(t2);
  const f2 = new T.Mesh(new T.BoxGeometry(0.4, 0.5, 0.4), new T.MeshBasicMaterial({ color: 0xffa53a }));
  f2.position.set(p[0], 1.9, p[1]);
  scene.add(f2);
  const l2 = new T.PointLight(0xff8a3c, 1.3, 16);
  l2.position.set(p[0], 2.2, p[1]);
  scene.add(l2);
  l2.userData.s = R() * 9;
  torches.push(l2);
});

function mkLabel(txt, w, h, bg) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.max(32, Math.round((512 * h) / w));
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#f2d34a';
  g.lineWidth = 8;
  g.strokeRect(4, 4, c.width - 8, c.height - 8);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let fs = Math.round(c.height * 0.5);
  do { g.font = 'bold ' + fs + 'px Georgia,serif'; fs -= 2; } while (g.measureText(txt).width > c.width - 40 && fs > 10);
  g.fillText(txt, c.width / 2, c.height / 2 + 3);
  return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c) }));
}

const hallMat = new T.MeshLambertMaterial({ color: 0x5a4030 });
const roof = new T.Mesh(new T.BoxGeometry(22.8, 0.5, 7), new T.MeshLambertMaterial({ color: 0x3a2630, transparent: true, opacity: 0.7 }));
roof.position.set(0, 5.2, -5.5);
scene.add(roof);
const back = new T.Mesh(new T.BoxGeometry(24, 5, 0.4), new T.MeshLambertMaterial({ color: 0x3a2c3a }));
back.position.set(0, 2.5, -8.4);
scene.add(back);
[-11, -4, 4, 11].forEach((x) => {
  const q = new T.Mesh(new T.CylinderGeometry(0.35, 0.4, 5, 6), hallMat);
  q.position.set(x, 2.5, -3.2);
  scene.add(q);
});
const title = mkLabel('SPAWN HALL', 8, 1.3, '#1b2340');
title.position.set(0, 5.2, -2.98);
scene.add(title);
const hl = new T.PointLight(0xffb060, 1.1, 16);
hl.position.set(0, 4, -5);
scene.add(hl);

function bx(w, h, d, col, x, y, z, basic) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), basic ? new T.MeshBasicMaterial({ color: col }) : new T.MeshLambertMaterial({ color: col }));
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}
ST.forEach((s) => {
  bx(6.6, 1.1, 1, s.col, s.x, 0.58, -5.5);
  const sg = mkLabel(s.name.toUpperCase(), 4.2, 1.05, s.bg);
  sg.position.set(s.x, 3.6, -8.15);
  scene.add(sg);
  const n = mkFig(s.col);
  n.position.set(s.x, 0.13, -7);
  scene.add(n);
  if (s.k === 'refinery') {
    for (let i3 = 0; i3 < 3; i3++) bx(1.2, 0.4, 0.4, 0x8a5a2b, s.x - 0.6 + i3 * 0.6, 1.32, -5.5);
    bx(1.2, 0.4, 0.4, 0x8a5a2b, s.x, 1.72, -5.5);
  }
  if (s.k === 'loom') { bx(0.9, 0.7, 0.7, 0xf0f0e0, s.x - 0.7, 1.35, -5.5); bx(0.9, 0.7, 0.7, 0xffffff, s.x + 0.3, 1.35, -5.5); }
  if (s.k === 'forge') {
    bx(1.3, 0.35, 0.6, 0x2c2f38, s.x, 1.28, -5.5);
    bx(0.55, 0.3, 0.5, 0x2c2f38, s.x, 1.58, -5.5);
    const coal = new T.Mesh(new T.BoxGeometry(0.4, 0.2, 0.4), new T.MeshBasicMaterial({ color: 0xff6a20 }));
    coal.position.set(s.x, 1.85, -5.5);
    scene.add(coal);
    const gl = new T.PointLight(0xff7a20, 1.2, 6);
    gl.position.set(s.x, 2.1, -5.5);
    scene.add(gl);
  }
  if (s.k === 'tannery') { bx(0.8, 0.5, 0.6, 0x6a4a2a, s.x - 0.5, 1.35, -5.5); bx(0.8, 0.5, 0.6, 0x7a5a3a, s.x + 0.5, 1.35, -5.5); }
});

// portal
const portalG = new T.Group();
const portalRing = new T.Mesh(new T.TorusGeometry(2, 0.28, 8, 24), new T.MeshLambertMaterial({ color: 0x3a2a5a }));
portalG.add(portalRing);
const portalInner = new T.Mesh(new T.CircleGeometry(1.7, 24), new T.MeshBasicMaterial({ color: 0x6f9fff, transparent: true, opacity: 0.5, side: T.DoubleSide, depthWrite: false }));
portalG.add(portalInner);
const portalRunes = new T.Mesh(new T.TorusGeometry(2.35, 0.07, 6, 24), new T.MeshBasicMaterial({ color: 0xf2d34a }));
portalG.add(portalRunes);
const portalGlow = new T.PointLight(0x6f9fff, 1.5, 14);
portalG.add(portalGlow);
portalG.position.set(PORTAL.x, 2.4, PORTAL.z);
scene.add(portalG);
const pbase = new T.Mesh(new T.CylinderGeometry(2.4, 2.6, 0.35, 16), new T.MeshLambertMaterial({ color: 0x2a2f45 }));
pbase.position.set(PORTAL.x, 0.17, PORTAL.z);
scene.add(pbase);

export function animateCourtyard(t) {
  torches.forEach((l2) => { l2.intensity = 1.2 + Math.sin(t * 9 + l2.userData.s) * 0.18 + Math.sin(t * 23 + l2.userData.s) * 0.1; });
  portalInner.rotation.z = t * 0.35;
  portalRunes.rotation.z = -t * 0.55;
  portalInner.material.opacity = 0.38 + Math.sin(t * 2.7) * 0.14;
  portalGlow.intensity = 1.3 + Math.sin(t * 3.1) * 0.35;
  portalRing.rotation.z = t * 0.08;
}

// walls / stations / portal collision lives in shared/collision.js (the server checks it too)
export { courtFree } from '../shared/collision.js';
