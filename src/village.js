// Frostfall village (scenery only): the plaza on the south edge of the map, lamp posts, the portal home.
// What is solid is defined in shared/realm.js (T2_REALM.solid), the same numbers the server uses.
import { FROST } from '../shared/realm.js';
import { T, scene, tex } from './scene.js';

const V = FROST.village, PORTAL = FROST.portal, Y = 0.6; // the clearing is levelled at y = 0.6
const mat = (c) => new T.MeshLambertMaterial({ color: c });
const basic = (c) => new T.MeshBasicMaterial({ color: c });
const add = (m, x, y, z) => { m.position.set(x, y, z); scene.add(m); return m; };
const box = (w, h, d, m) => new T.Mesh(new T.BoxGeometry(w, h, d), m);

function label(text, w, h, bg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = Math.round(256 * h / w);
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#f2d34a'; g.lineWidth = 6; g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = '#f2d34a'; g.font = '700 ' + Math.round(c.height * 0.42) + 'px Georgia,serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new T.CanvasTexture(c);
  return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: t, side: T.DoubleSide }));
}

// plaza: a round stone floor under a dusting of snow, with a ring of darker stones
const stone = tex([150, 156, 170], 1, 3);
add(new T.Mesh(new T.CylinderGeometry(17, 17.5, 0.25, 28), new T.MeshLambertMaterial({ map: stone })), V.x, Y + 0.02, V.z);
add(new T.Mesh(new T.CylinderGeometry(7, 7.4, 0.35, 20), mat(0xdfe8f2)), V.x, Y + 0.1, V.z); // a snow-covered round dais in the middle

// lamp posts: a ring round the plaza and two rows along the path to the spawn
const pole = mat(0x2c2f38), lantern = basic(0xffd27a);
function lamp(x, z) {
  add(box(0.22, 3.4, 0.22, pole), x, Y + 1.7, z);
  add(new T.Mesh(new T.SphereGeometry(0.34, 8, 6), lantern), x, Y + 3.6, z);
  add(new T.Mesh(new T.ConeGeometry(0.5, 0.35, 6), mat(0xe8f0f8)), x, Y + 4.05, z); // snow cap
}
for (let i = 0; i < 8; i++) lamp(V.x + Math.cos(i * Math.PI / 4) * 13, V.z + Math.sin(i * Math.PI / 4) * 13);
for (const z of [V.z + 24, V.z + 32, V.z + 40]) { lamp(V.x - 6, z); lamp(V.x + 6, z); }

// the sign at the spawn
const spawnZ = FROST.spawn.z;
add(box(0.3, 3.2, 0.3, mat(0x5a3d26)), V.x - 3.2, Y + 1.6, spawnZ - 12);
add(box(0.3, 3.2, 0.3, mat(0x5a3d26)), V.x + 3.2, Y + 1.6, spawnZ - 12);
add(label('FROSTFALL', 6, 1.2, '#16263f'), V.x, Y + 3.0, spawnZ - 12);

// the portal home
const portalG = new T.Group();
const ring = new T.Mesh(new T.TorusGeometry(2, 0.28, 8, 24), mat(0x3a4a6a));
const inner = new T.Mesh(new T.CircleGeometry(1.7, 24), new T.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.5, side: T.DoubleSide, depthWrite: false }));
const runes = new T.Mesh(new T.TorusGeometry(2.35, 0.07, 6, 24), basic(0xf2d34a));
const glow = new T.PointLight(0x8fd0ff, 1.5, 14);
portalG.add(ring, inner, runes, glow);
add(portalG, PORTAL.x, Y + 2.4, PORTAL.z);
add(new T.Mesh(new T.CylinderGeometry(2.4, 2.6, 0.35, 16), mat(0x2a3550)), PORTAL.x, Y + 0.17, PORTAL.z);
add(new T.Mesh(new T.CylinderGeometry(7.5, 8, 0.3, 24), new T.MeshLambertMaterial({ map: stone })), PORTAL.x, Y + 0.05, PORTAL.z);
const orbs = [];
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + Math.PI / 4, sx = PORTAL.x + Math.cos(a) * 6, sz = PORTAL.z + Math.sin(a) * 6;
  add(box(1.1, 5, 1.1, new T.MeshLambertMaterial({ map: stone })), sx, Y + 2.5, sz);
  orbs.push(add(new T.Mesh(new T.SphereGeometry(0.4, 8, 6), basic(0x8fd0ff)), sx, Y + 5.4, sz));
}

export function animateCourtyard(t) {
  inner.rotation.z = t * 0.35;
  runes.rotation.z = -t * 0.55;
  inner.material.opacity = 0.38 + Math.sin(t * 2.7) * 0.14;
  glow.intensity = 1.3 + Math.sin(t * 3.1) * 0.35;
  ring.rotation.z = t * 0.08;
  orbs.forEach((o, i) => o.scale.setScalar(0.85 + Math.sin(t * 2.5 + i * 1.6) * 0.2));
}
