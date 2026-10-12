// The Big Town (walls, gates, towers, plaza, fountain, houses, lamps) and the portal clearing far to the south.
// Pure scenery: what is solid is defined in shared/collision.js, which uses the same numbers from shared/data.js.
import { TOWN, HOUSES, PORTAL } from '../shared/data.js';
import { T, scene, tex, R } from './scene.js';

const H = TOWN.half, G = TOWN.gate;
const stone = tex([120, 120, 128], 1, 1);
const wallMat = new T.MeshLambertMaterial({ map: stone });
const add = (m, x, y, z) => { m.position.set(x, y, z); scene.add(m); return m; };
const box = (w, h, d, mat) => new T.Mesh(new T.BoxGeometry(w, h, d), mat);
const mat = (c) => new T.MeshLambertMaterial({ color: c });

// ---- ground: paved plaza around the Hall (|x|,|z| < 38), roads from it to the four gates
const PL = 38;
const pave = new T.MeshLambertMaterial({ map: tex([92, 92, 100], 1, 1) });
pave.map.repeat.set(24, 24);
add(box(PL * 2, 0.1, PL * 2, pave), 0, 0.03, 0);
const roadTex = tex([70, 66, 62], 0, 1); roadTex.repeat.set(2, 14);
const road = new T.MeshLambertMaterial({ map: roadTex });
add(box(G * 2, 0.08, H - PL, road), 0, 0.03, -(H + PL) / 2); // north road
add(box(G * 2, 0.08, H + 4 - PL, road), 0, 0.03, (H + 4 + PL) / 2); // south road, runs a little past the gate
add(box(H - PL, 0.08, G * 2, road), -(H + PL) / 2, 0.03, 0);
add(box(H - PL, 0.08, G * 2, road), (H + PL) / 2, 0.03, 0);

// ---- wall: 8 pieces (two per side, gate in the middle), merlons on top
const merlon = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), wallMat, 320);
let mi = 0;
const m4 = new T.Matrix4();
function wallPiece(cx, cz, len, alongX) {
  add(box(alongX ? len : 2, 5, alongX ? 2 : len, wallMat), cx, 2.5, cz);
  for (let k = -len / 2 + 0.5; k < len / 2; k += 2) {
    m4.makeTranslation(alongX ? cx + k : cx, 5.5, alongX ? cz : cz + k);
    merlon.setMatrixAt(mi++, m4);
  }
}
const seg = H + 1 - G, mid = (H + 1 + G) / 2;
for (const s of [-1, 1]) {
  wallPiece(s * mid, -H, seg, true); wallPiece(s * mid, H, seg, true); // north / south
  wallPiece(-H, s * mid, seg, false); wallPiece(H, s * mid, seg, false); // west / east
}
merlon.count = mi;
merlon.frustumCulled = false;
scene.add(merlon);

// ---- corner towers and gate pillars
const roofMat = mat(0x5a3a3a);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  add(new T.Mesh(new T.CylinderGeometry(3.4, 3.8, 9, 10), wallMat), sx * H, 4.5, sz * H);
  add(new T.Mesh(new T.ConeGeometry(4.4, 4, 10), roofMat), sx * H, 11, sz * H);
}
const lantern = new T.MeshBasicMaterial({ color: 0xffb54a });
function gate(cx, cz, alongX) { // two pillars and a lintel
  for (const s of [-1, 1]) {
    const px = alongX ? cx + s * (G + 1.2) : cx, pz = alongX ? cz : cz + s * (G + 1.2);
    add(box(2.6, 8, 2.6, wallMat), px, 4, pz);
    add(new T.Mesh(new T.SphereGeometry(0.45, 8, 6), lantern), px, 8.5, pz);
  }
  add(box(alongX ? G * 2 + 2.4 : 1.6, 1.4, alongX ? 1.6 : G * 2 + 2.4, wallMat), cx, 7, cz);
}
gate(0, -H, true); gate(0, H, true); gate(-H, 0, false); gate(H, 0, false);

// ---- houses
const wallCols = [0xb8a58a, 0xa8957a, 0xc4b49a, 0x9c8a74];
const roofCols = [0x6a3a30, 0x4a4036, 0x5a3a3a, 0x3e4a5a];
const windowMat = new T.MeshBasicMaterial({ color: 0xffd37a });
HOUSES.forEach((h, i) => {
  const hh = 4.6;
  add(box(h.w, hh, h.d, mat(wallCols[i % 4])), h.x, hh / 2, h.z);
  const roof = new T.Mesh(new T.ConeGeometry(0.7071, 2.4, 4), mat(roofCols[(i * 3) % 4]));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(h.w + 1, 1, h.d + 1);
  add(roof, h.x, hh + 1.2, h.z);
  // door and windows face the nearest street (towards the middle)
  const face = Math.abs(h.x) > Math.abs(h.z) ? 'x' : 'z';
  const dir = -Math.sign(face === 'x' ? h.x : h.z);
  const fw = face === 'x' ? h.d : h.w;
  const put = (w, hgt, y, off, m) => {
    const b = box(face === 'x' ? 0.15 : w, hgt, face === 'x' ? w : 0.15, m);
    add(b, face === 'x' ? h.x + dir * (h.w / 2 + 0.05) : h.x + off, y, face === 'x' ? h.z + off : h.z + dir * (h.d / 2 + 0.05));
  };
  put(1.4, 2.5, 1.25, 0, mat(0x3a2418));
  put(1.1, 1.0, 2.7, -fw / 3, windowMat); put(1.1, 1.0, 2.7, fw / 3, windowMat);
});

// ---- fountain
const F = TOWN.fountain;
add(new T.Mesh(new T.CylinderGeometry(F.r, F.r + 0.2, 0.8, 16), wallMat), F.x, 0.4, F.z);
const water = new T.Mesh(new T.CircleGeometry(F.r - 0.35, 16), new T.MeshBasicMaterial({ color: 0x5aa0ff, transparent: true, opacity: 0.7 }));
water.rotation.x = -Math.PI / 2;
add(water, F.x, 0.82, F.z);
add(new T.Mesh(new T.CylinderGeometry(0.3, 0.45, 2.2, 8), wallMat), F.x, 1.5, F.z);
add(new T.Mesh(new T.SphereGeometry(0.5, 8, 6), new T.MeshBasicMaterial({ color: 0x9fd0ff })), F.x, 2.8, F.z);

// ---- lamp posts (decoration only, no extra lights)
const pole = mat(0x2c2f38);
function lamp(x, z) {
  add(box(0.22, 3.4, 0.22, pole), x, 1.7, z);
  add(new T.Mesh(new T.SphereGeometry(0.34, 8, 6), lantern), x, 3.6, z);
}
for (const s of [-1, 1]) for (const z of [-50, -38, -26, 26, 50]) { lamp(s * 9, z); lamp(z, s * 9); }

// ---- the portal clearing: a stone ring, four standing stones
const px = PORTAL.x, pz = PORTAL.z;
add(new T.Mesh(new T.CylinderGeometry(7.5, 8, 0.3, 24), new T.MeshLambertMaterial({ map: stone })), px, 0.1, pz);
const stones = [];
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + Math.PI / 4, sx = px + Math.cos(a) * 6, sz = pz + Math.sin(a) * 6;
  add(box(1.1, 5, 1.1, wallMat), sx, 2.5, sz);
  stones.push(add(new T.Mesh(new T.SphereGeometry(0.4, 8, 6), new T.MeshBasicMaterial({ color: 0x6f9fff })), sx, 5.4, sz));
}

export function animateTown(t) {
  water.material.opacity = 0.62 + Math.sin(t * 2.2) * 0.1;
  stones.forEach((s, i) => s.scale.setScalar(0.85 + Math.sin(t * 2.5 + i * 1.6) * 0.2));
}
