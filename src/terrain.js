// Streaming terrain, trees and resource nodes around the player.
// WHAT exists is decided by shared/world.js (same on the server); whether a
// tree/node is currently gatherable comes from the server via S.nodeQty.
import { CFG } from '../shared/data.js';
import { createWorld } from '../shared/world.js';
import { SEED } from './config.js';
import { S, nodeQty } from './state.js';
import { T, scene, tex } from './scene.js';
import { courtFree } from './courtyard.js';

const { CS, SEG, VR } = CFG;
export const world = createWorld(SEED);
export const hgt = world.hgt;
export const chunks = {};

const gmat = new T.MeshLambertMaterial({ map: tex([40, 70, 42], 0, 8), flatShading: true, vertexColors: true });

function mkChunk(cx, cz) {
  const g = new T.PlaneGeometry(CS, CS, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  g.translate(cx * CS + CS / 2, 0, cz * CS + CS / 2);
  const p = g.attributes.position, cols = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), v = 0.75 + world.vn(x * 0.3, z * 0.3) * 0.4;
    p.setY(i, hgt(x, z));
    cols.push(v, v, v);
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
const fol = new T.InstancedMesh(new T.ConeGeometry(2.4, 4.5, 6), new T.MeshLambertMaterial({ color: 0x2d5236, flatShading: true }), MAXT);
const fol2 = new T.InstancedMesh(new T.ConeGeometry(1.7, 3.8, 6), new T.MeshLambertMaterial({ color: 0x35603f, flatShading: true }), MAXT);
const tm = new T.Matrix4(), tq = new T.Quaternion(), tsv = new T.Vector3(), tp = new T.Vector3();
trunk.frustumCulled = fol.frustumCulled = fol2.frustumCulled = false;
scene.add(trunk, fol, fol2);

export const treeReady = (tk) => nodeQty(tk) > 0;

const nodeMeshes = {}; // id -> mesh of loaded resource nodes
let lastC = null;

// Called when the server says a tree / node changed.
export function setNodeQty(id, qty) {
  if (qty >= CFG.NODE_QTY) delete S.nodeQty[id];
  else S.nodeQty[id] = qty;
  const mesh = nodeMeshes[id];
  if (mesh) mesh.visible = qty > 0;
  else if (!id.includes(':')) lastC = null; // a tree: rebuild the instanced forest
}

export function resetNodes(list) {
  S.nodeQty = {};
  for (const [id, qty] of list) S.nodeQty[id] = qty;
  lastC = null;
  for (const id in nodeMeshes) nodeMeshes[id].visible = nodeQty(id) > 0;
}

export function updateWorld() {
  const cx = Math.floor(S.P.x / CS), cz = Math.floor(S.P.z / CS);
  if (lastC && lastC[0] === cx && lastC[1] === cz) return;
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
        if (!treeReady(X + ',' + Z + ',' + q / 3)) continue;
        const x = t[q], z = t[q + 1], k2 = t[q + 2], y = hgt(x, z);
        tsv.set(k2, k2, k2);
        tm.compose(tp.set(x, y + 1.5 * k2, z), tq, tsv); trunk.setMatrixAt(n, tm);
        tm.compose(tp.set(x, y + 4.2 * k2, z), tq, tsv); fol.setMatrixAt(n, tm);
        tm.compose(tp.set(x, y + 6.4 * k2, z), tq, tsv); fol2.setMatrixAt(n, tm);
        n++;
      }
    }
  }
  trunk.count = fol.count = fol2.count = n;
  trunk.instanceMatrix.needsUpdate = fol.instanceMatrix.needsUpdate = fol2.instanceMatrix.needsUpdate = true;
}

// Can the player stand here? (hall walls, stations, portal, standing trees)
export function isFree(x, z) {
  if (!courtFree(x, z)) return false;
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  for (let ii = -1; ii <= 1; ii++) {
    for (let jj = -1; jj <= 1; jj++) {
      const X = cx + ii, Z = cz + jj, t = world.ctrees(X, Z);
      for (let q = 0; q < t.length; q += 3) {
        if (!treeReady(X + ',' + Z + ',' + q / 3)) continue;
        const dx = x - t[q], dz = z - t[q + 1];
        if (dx * dx + dz * dz < 0.8 * t[q + 2] * t[q + 2] + 0.3) return false;
      }
    }
  }
  return true;
}
