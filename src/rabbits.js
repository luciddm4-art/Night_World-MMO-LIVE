// Rabbits are simulated by the server; here we only draw them and smooth their movement.
import { S } from './state.js';
import { scene } from './scene.js';
import { mkRabbit } from './figures.js';
import { hgt } from './terrain.js';

export function syncRabbits(list) {
  const seen = {};
  for (const e of list) {
    seen[e.i] = 1;
    let r = S.rabbits[e.i];
    if (!r) {
      const mesh = mkRabbit();
      mesh.position.set(e.x, hgt(e.x, e.z), e.z);
      scene.add(mesh);
      r = S.rabbits[e.i] = { id: e.i, mesh, x: e.x, z: e.z, tx: e.x, tz: e.z, dead: false };
    }
    r.tx = e.x;
    r.tz = e.z;
    if (e.d && !r.dead) {
      r.dead = true;
      r.x = r.tx;
      r.z = r.tz;
      r.mesh.userData.body.rotation.z = Math.PI / 2;
      r.mesh.userData.body.position.y = 0.12;
      r.mesh.rotation.y = Math.random() * 6.28;
      r.mesh.position.set(r.x, hgt(r.x, r.z), r.z);
    }
  }
  for (const id in S.rabbits) {
    if (!seen[id]) {
      scene.remove(S.rabbits[id].mesh);
      delete S.rabbits[id];
    }
  }
}

export function clearRabbits() {
  for (const id in S.rabbits) scene.remove(S.rabbits[id].mesh);
  S.rabbits = {};
}

export function updateRabbits(dt) {
  const f = Math.min(1, dt * 10);
  for (const id in S.rabbits) {
    const r = S.rabbits[id];
    if (r.dead) continue;
    const dx = r.tx - r.x, dz = r.tz - r.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.002) {
      r.x += dx * f;
      r.z += dz * f;
      if (Math.hypot(dx, dz) > 0.03) r.mesh.rotation.y = Math.atan2(dx, dz);
    }
    r.mesh.position.set(r.x, hgt(r.x, r.z), r.z);
  }
}
