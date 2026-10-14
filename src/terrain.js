// Streaming terrain, trees and resource nodes around the player.
// WHAT exists is decided by shared/world.js (same on the server); whether a
// tree/node is currently gatherable comes from the server via S.nodeQty.
import { CFG } from '../shared/data.js';
import { createWorld } from '../shared/world.js';
import { SEED, REALM } from './config.js';
import { S, nodeQty } from './state.js';
import { T, scene, tex, smooth } from './scene.js';
import { isFree as sharedFree } from '../shared/collision.js';

const { CS, SEG, VR } = CFG;
export const world = createWorld(SEED);
export const hgt = world.hgt;
export const chunks = {};

const snowy = REALM.id === 't2';
// Low-poly: no texture. Every little triangle gets one flat colour of its own (by height, slope and a bit of chance).
const gmat = smooth ? new T.MeshLambertMaterial({ flatShading: true, vertexColors: true }) : new T.MeshLambertMaterial({ map: snowy ? tex([236, 241, 248], 0, 8) : tex([40, 70, 42], 0, 8), flatShading: true, vertexColors: true });

const lerp = (a, b, k) => a + (b - a) * k;
const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
// colour of one triangle: centre (x, y, z) and how steep it is (0 flat .. 1 sheer)
const GRASS_LOW = [0.17, 0.28, 0.24], GRASS = [0.22, 0.36, 0.22], GRASS_HI = [0.34, 0.4, 0.25], ROCK = [0.42, 0.41, 0.42];
function faceColour(x, y, z, steep) {
  const n = world.vn(x * 0.9 + 3, z * 0.9 + 7); // per-triangle chance
  let c;
  if (world.tint) { // Frostfall
    const t = world.tint(x, z, y);
    c = [t[0], t[1], t[2]];
  } else {
    c = y <= 0.3 ? GRASS_LOW : mix3(GRASS, GRASS_HI, sm(2, 24, y));
    c = mix3(c, ROCK, sm(0.22, 0.5, steep));
  }
  const v = 0.9 + n * 0.2;
  return [c[0] * v, c[1] * v, c[2] * v];
}

function mkChunkSmooth(cx, cz) {
  let g = new T.PlaneGeometry(CS, CS, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  g.translate(cx * CS + CS / 2, 0, cz * CS + CS / 2);
  let p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, hgt(p.getX(i), p.getZ(i)));
  g = g.toNonIndexed();
  g.computeVertexNormals(); // flat: one normal per triangle
  p = g.attributes.position;
  const nrm = g.attributes.normal, cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const c = faceColour(x, y, z, 1 - Math.abs(nrm.getY(i)));
    for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = c[0]; cols[(i + k) * 3 + 1] = c[1]; cols[(i + k) * 3 + 2] = c[2]; }
  }
  g.setAttribute('color', new T.BufferAttribute(cols, 3));
  const m = new T.Mesh(g, gmat);
  scene.add(m);
  return m;
}

function mkChunk(cx, cz) {
  if (smooth) return mkChunkSmooth(cx, cz);
  const g = new T.PlaneGeometry(CS, CS, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  g.translate(cx * CS + CS / 2, 0, cz * CS + CS / 2);
  const p = g.attributes.position, cols = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = hgt(x, z);
    p.setY(i, y);
    if (world.tint) { // Frostfall: ice, rock, snow and pine floor by place and slope
      const c = world.tint(x, z, y), v = 0.9 + world.vn(x * 0.3, z * 0.3) * 0.16;
      cols.push(c[0] * v, c[1] * v, c[2] * v);
    } else {
      const v = 0.75 + world.vn(x * 0.3, z * 0.3) * 0.4;
      cols.push(v, v, v);
    }
  }
  g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const m = new T.Mesh(g, gmat);
  scene.add(m);
  return m;
}

function mkCotton() {
  const g = new T.Group();
  const a = new T.Mesh(new T.SphereGeometry(0.32, 6, 5), new T.MeshLambertMaterial({ color: 0xf0f0e0 })); a.position.y = 0.32; g.add(a);
  const b = new T.Mesh(new T.SphereGeometry(0.24, 6, 5), new T.MeshLambertMaterial({ color: 0xffffff })); b.position.set(0.22, 0.5, 0.05); g.add(b);
  const c = new T.Mesh(new T.SphereGeometry(0.22, 6, 5), new T.MeshLambertMaterial({ color: 0xffffff })); c.position.set(-0.18, 0.52, 0.12); g.add(c);
  const st = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.4, 4), new T.MeshLambertMaterial({ color: 0x4a6a3a })); st.position.y = 0.15; g.add(st);
  return g;
}
function mkOre() {
  const g = new T.Group();
  const r = new T.Mesh(new T.DodecahedronGeometry(0.4, 0), new T.MeshLambertMaterial({ color: 0x6a6a78, flatShading: true }));
  r.position.y = 0.35;
  g.add(r);
  const s = new T.Mesh(new T.DodecahedronGeometry(0.14, 0), new T.MeshBasicMaterial({ color: 0xf2d34a }));
  s.position.set(0.12, 0.5, 0.1);
  g.add(s);
  return g;
}

const MAXT = 3400;
const trunk = new T.InstancedMesh(new T.CylinderGeometry(0.35, 0.5, 3, 5), new T.MeshLambertMaterial({ color: 0x3a2a1c }), MAXT);
const fol = new T.InstancedMesh(new T.ConeGeometry(2.4, 4.5, 6), new T.MeshLambertMaterial({ color: snowy ? 0x2f5d57 : 0x2d5236, flatShading: true }), MAXT);
const fol2 = new T.InstancedMesh(new T.ConeGeometry(1.7, 3.8, 6), new T.MeshLambertMaterial({ color: snowy ? 0xdbe8f1 : 0x35603f, flatShading: true }), MAXT);
const tcol = new T.Color();
const tm = new T.Matrix4(), tq = new T.Quaternion(), tsv = new T.Vector3(), tp = new T.Vector3();
trunk.frustumCulled = fol.frustumCulled = fol2.frustumCulled = false;
scene.add(trunk, fol, fol2);

export const treeReady = (tk) => nodeQty(tk) > 0;

const nodeMeshes = {}; // id -> mesh of loaded resource nodes
let lastC = null;

// ---- little animations: trees fall / regrow / sway, nodes shrink / pop / shake ----
const treeFx = {}; // tree id -> {type:'fall'|'grow'|'sway', t0, dur, axis}
const nodeFx = {}; // node id -> {type:'shrink'|'grow', t0, dur}
let swayTree = null, shakeNode = null, shakenMesh = null;
const Z_AXIS = new T.Vector3(0, 0, 1);
const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return h; };
const backOut = (u) => { const c = 1.7; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const hasTreeFx = () => { for (const k in treeFx) return true; return swayTree !== null; };

export function setTreeShake(id) { swayTree = id; lastC = null; }
export function setNodeShake(id) { shakeNode = id; }

// Called when the server says a tree / node changed.
export function setNodeQty(id, qty) {
  const prev = nodeQty(id);
  if (qty >= CFG.NODE_QTY) delete S.nodeQty[id];
  else S.nodeQty[id] = qty;
  const now = performance.now();
  const mesh = nodeMeshes[id];
  if (mesh) {
    if (qty <= 0 && prev > 0) nodeFx[id] = { type: 'shrink', t0: now, dur: 350 }; // stays visible until it finishes
    else if (qty > 0 && prev <= 0) { mesh.visible = true; mesh.scale.setScalar(0.001); nodeFx[id] = { type: 'grow', t0: now, dur: 450 }; }
  } else if (!id.includes(':')) { // a tree: animate, and rebuild the instanced forest
    if (qty <= 0 && prev > 0) treeFx[id] = { type: 'fall', t0: now, dur: 550, axis: new T.Vector3(Math.cos(hash(id)), 0, Math.sin(hash(id))).normalize() };
    else if (qty > 0 && prev <= 0) treeFx[id] = { type: 'grow', t0: now, dur: 500 };
    lastC = null;
  }
}

// call every frame
export function updateNodeFx(now) {
  for (const id in nodeFx) {
    const f = nodeFx[id], mesh = nodeMeshes[id];
    if (!mesh) { delete nodeFx[id]; continue; }
    const u = Math.min(1, (now - f.t0) / f.dur);
    if (f.type === 'shrink') {
      mesh.scale.setScalar(Math.max(0.001, 1 - u * u));
      if (u >= 1) { mesh.visible = false; mesh.scale.setScalar(1); delete nodeFx[id]; }
    } else {
      mesh.scale.setScalar(Math.max(0.001, backOut(u)));
      if (u >= 1) { mesh.scale.setScalar(1); delete nodeFx[id]; }
    }
  }
  const m = shakeNode ? nodeMeshes[shakeNode] : null;
  if (shakenMesh && shakenMesh !== m) shakenMesh.rotation.z = 0;
  if (m) m.rotation.z = Math.sin(now * 0.06) * 0.16;
  shakenMesh = m;
}

export function resetNodes(list) {
  S.nodeQty = {};
  for (const [id, qty] of list) S.nodeQty[id] = qty;
  lastC = null;
  for (const id in nodeMeshes) { nodeMeshes[id].visible = nodeQty(id) > 0; nodeMeshes[id].scale.setScalar(1); }
  for (const k in nodeFx) delete nodeFx[k];
  for (const k in treeFx) delete treeFx[k];
}

export function updateWorld() {
  const cx = Math.floor(S.P.x / CS), cz = Math.floor(S.P.z / CS);
  const animating = hasTreeFx();
  if (!animating && lastC && lastC[0] === cx && lastC[1] === cz) return;
  const now = performance.now();
  lastC = [cx, cz];
  for (const k in chunks) {
    const c = chunks[k];
    if (Math.abs(c.cx - cx) > VR || Math.abs(c.cz - cz) > VR) {
      scene.remove(c.m);
      c.m.geometry.dispose();
      c.nodes.forEach((n) => { scene.remove(n.mesh); delete nodeMeshes[n.def.id]; });
      delete chunks[k];
    }
  }
  let n = 0;
  for (let i2 = -VR; i2 <= VR; i2++) {
    for (let j2 = -VR; j2 <= VR; j2++) {
      const X = cx + i2, Z = cz + j2, key = X + ',' + Z;
      if (!chunks[key]) {
        const c2 = { cx: X, cz: Z, m: mkChunk(X, Z), nodes: [] };
        chunks[key] = c2;
        for (const nd of world.cres(X, Z)) {
          const mesh = nd.type === 'cotton' ? mkCotton() : mkOre();
          mesh.position.set(nd.x, hgt(nd.x, nd.z), nd.z);
          mesh.visible = nodeQty(nd.id) > 0;
          scene.add(mesh);
          nodeMeshes[nd.id] = mesh;
          c2.nodes.push({ mesh, def: nd });
        }
      }
      const t = world.ctrees(X, Z);
      for (let q = 0; q < t.length; q += 3) {
        const tk = X + ',' + Z + ',' + q / 3;
        const fx = treeFx[tk];
        const standing = treeReady(tk);
        if (!standing && !(fx && fx.type === 'fall')) continue;
        const x = t[q], z = t[q + 1], k2 = t[q + 2], y = hgt(x, z);
        let sc = k2;
        tq.set(0, 0, 0, 1);
        if (fx) {
          const u = (now - fx.t0) / fx.dur;
          if (u >= 1) { delete treeFx[tk]; if (!standing) continue; }
          else if (fx.type === 'fall') { sc = k2 * (1 - u * u * 0.9); tq.setFromAxisAngle(fx.axis, u * u * 1.3); }
          else if (fx.type === 'grow') sc = Math.max(0.001, k2 * backOut(u));
        }
        if (swayTree === tk) tq.setFromAxisAngle(Z_AXIS, Math.sin(now * 0.05) * 0.05);
        tsv.set(sc, sc, sc);
        tm.compose(tp.set(x, y + 1.5 * k2, z), tq, tsv); trunk.setMatrixAt(n, tm);
        tm.compose(tp.set(x, y + 4.2 * k2, z), tq, tsv); fol.setMatrixAt(n, tm);
        tm.compose(tp.set(x, y + 6.4 * k2, z), tq, tsv); fol2.setMatrixAt(n, tm);
        if (smooth) { // every tree a slightly different green
          const hv = ((hash(tk) >>> 0) % 997) / 997, v = 0.8 + hv * 0.4;
          tcol.setRGB(v, v * (0.94 + hv * 0.12), v * (1.06 - hv * 0.12));
          fol.setColorAt(n, tcol); fol2.setColorAt(n, tcol);
        }
        n++;
      }
    }
  }
  trunk.count = fol.count = fol2.count = n;
  trunk.instanceMatrix.needsUpdate = fol.instanceMatrix.needsUpdate = fol2.instanceMatrix.needsUpdate = true;
  if (fol.instanceColor) fol.instanceColor.needsUpdate = fol2.instanceColor.needsUpdate = true;
}

// Can the player stand here? (hall walls, stations, portal, standing trees)
export function isFree(x, z) {
  return sharedFree(world, treeReady, x, z, 0);
}
