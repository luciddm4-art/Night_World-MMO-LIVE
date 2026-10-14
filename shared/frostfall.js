// Frostfall (Tier 2): deterministic snow-and-ice terrain. Same API as createWorld in world.js
// (hgt, ctrees, cres, crabbits, treeAt, nodeAt, h2, vn) plus tint() for the ground colour.
//
// Layers, from the ground up:
//   hills       three noise octaves, minus an offset so low places dip under 0
//   highlands   a biome noise; where it is high the hills turn into terraced cliffs
//   lakes       anything below 0 is a flat frozen lake (walkable ice)
//   rivers      narrow bands of another noise are cut down to ice level: frozen rivers
//   village     the clearing in the south is levelled
//   mountains   a ring along the map edge rises to 100+ units
import { CFG } from './data.js';
import { FROST, T2_REALM } from './realm.js';

const CS = CFG.CS;
const sstep = (a, b, x) => {
  x = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export function createFrostWorld(seed) {
  const h2 = (i, j) => {
    const n = Math.sin(i * 127.1 + j * 311.7 + seed * 13.37) * 43758.5453;
    return n - Math.floor(n);
  };
  const vn = (x, z) => {
    const i = Math.floor(x), j = Math.floor(z);
    let fx = x - i, fz = z - j;
    fx = fx * fx * (3 - 2 * fx);
    fz = fz * fz * (3 - 2 * fz);
    const a = h2(i, j), b = h2(i + 1, j), c = h2(i, j + 1), d = h2(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  const V = FROST.village;

  // 0 = tundra, 1 = pine forest, 2 = glacier highlands
  const biomeV = (x, z) => vn(x * 0.0025 + 200, z * 0.0025 + 90);
  const biome = (x, z) => { const b = biomeV(x, z); return b < 0.3 ? 0 : b < 0.62 ? 1 : 2; };

  const hgt = (x, z) => {
    const r = Math.max(Math.abs(x), Math.abs(z));
    let e = vn(x * 0.004, z * 0.004) * 36 + vn(x * 0.011, z * 0.011) * 14 + vn(x * 0.045, z * 0.045) * 3.5 - 15;
    // cliffs: terraces, strongest in the highlands
    if (e > 0) {
      const t = e / 9, f = Math.floor(t);
      const terr = (f + sstep(0.3, 0.7, t - f)) * 9;
      const k = 0.25 + 0.75 * sstep(0.5, 0.72, biomeV(x, z));
      e += (terr - e) * k;
    }
    // frozen rivers
    const rv = Math.abs(vn(x * 0.0055 + 7, z * 0.0055 + 3) - 0.5);
    const riv = 1 - sstep(0.01, 0.03, rv);
    e = e * (1 - riv) - 2 * riv;
    if (e < 0) e = 0; // below 0 is ice: perfectly flat and walkable
    // the village clearing is level
    const fv = sstep(FROST.safeR + 10, FROST.safeR + 70, Math.hypot(x - V.x, z - V.z));
    e = 0.6 + (e - 0.6) * fv;
    // the mountain ring
    const ring = sstep(FROST.ringFrom, FROST.wall + 2, r);
    if (ring > 0) e += ring * (90 + vn(x * 0.03 + 11, z * 0.03 + 5) * 50);
    return e;
  };

  // Ground colour (multiplies a pale snow texture): ice, rock on steep slopes, snow, pine-floor, glacier.
  const tint = (x, z, y) => {
    const out = [0.96, 0.98, 1];
    const sl = (Math.abs(hgt(x + 1.5, z) - y) + Math.abs(hgt(x, z + 1.5) - y)) / 3;
    if (y <= 0.05) { out[0] = 0.6; out[1] = 0.82; out[2] = 1; return out; } // frozen lake / river
    if (Math.hypot(x - V.x, z - V.z) < FROST.safeR) { out[0] = 0.72; out[1] = 0.74; out[2] = 0.8; return out; } // trampled village snow
    const b = biomeV(x, z);
    if (b >= 0.62) { out[0] = 0.84; out[1] = 0.93; out[2] = 1; } // glacier
    else if (b >= 0.3) { out[0] = 0.76; out[1] = 0.87; out[2] = 0.84; } // pine floor
    if (sl > 0.55) { // rock
      const k = sstep(0.55, 1.1, sl);
      out[0] += (0.4 - out[0]) * k; out[1] += (0.41 - out[1]) * k; out[2] += (0.47 - out[2]) * k;
    }
    if (y > 70) { const k = sstep(70, 95, y); out[0] += (1 - out[0]) * k * 0.7; out[1] += (1 - out[1]) * k * 0.7; out[2] += (1 - out[2]) * k * 0.7; } // snowy peaks
    return out;
  };

  const inSafe = T2_REALM.inSafe;
  const inland = (x, z) => Math.max(Math.abs(x), Math.abs(z)) < FROST.ringFrom - 20;

  // flat [x, z, scale, ...] per chunk
  const treeCache = new Map();
  function ctrees(cx, cz) {
    const key = cx + ',' + cz;
    let a = treeCache.get(key);
    if (a) return a;
    a = [];
    const f = vn(cx * 0.35 + 9.1, cz * 0.35 + 4.7);
    const bm = biome(cx * CS + CS / 2, cz * CS + CS / 2);
    const n = bm === 1 ? Math.floor(5 + f * f * 33) : bm === 0 ? Math.floor(f * f * 7) : Math.floor(f * f * 2);
    for (let i = 0; i < n; i++) {
      const x = cx * CS + h2(cx * 7 + i, cz * 13 + 1) * CS;
      const z = cz * CS + h2(cx * 17 + 2, cz * 5 + i) * CS;
      if (!inland(x, z) || inSafe(x, z)) continue;
      const y = hgt(x, z);
      if (y < 0.4 || y > 26) continue; // not on ice, not up on the cliffs
      a.push(x, z, 0.8 + h2(i + cx * 3, cz * 3 + i) * 0.9);
    }
    if (treeCache.size > 4000) treeCache.clear();
    treeCache.set(key, a);
    return a;
  }

  function cres(cx, cz) {
    const out = [];
    [['cotton', 1.7], ['ore', 3.9]].forEach(([type, sd]) => {
      const f = vn(cx * 0.43 + sd, cz * 0.43 + sd);
      const n = Math.floor(f * f * 4);
      for (let i = 0; i < n; i++) {
        const x = cx * CS + h2(cx * 11 + i * 3 + sd, cz * 13 + sd) * CS;
        const z = cz * CS + h2(cx * 17 + sd, cz * 5 + i * 3 + sd) * CS;
        if (!inland(x, z) || inSafe(x, z) || hgt(x, z) < 0.4) continue;
        out.push({ id: type + ':' + cx + ':' + cz + ':' + i, type, x, z });
      }
    });
    return out;
  }

  function crabbits(cx, cz) {
    const out = [];
    const f = vn(cx * 0.61 + 21, cz * 0.61 + 13);
    const n = Math.floor(f * f * 3);
    for (let i = 0; i < n; i++) {
      const x = cx * CS + h2(cx * 23 + i * 5, cz * 19 + 7) * CS;
      const z = cz * CS + h2(cx * 13 + 7, cz * 29 + i * 5) * CS;
      if (!inland(x, z) || inSafe(x, z)) continue;
      out.push({ id: 'rab:' + cx + ':' + cz + ':' + i, x, z });
    }
    return out;
  }

  const LIM = 100000;
  const okC = (v) => Number.isInteger(v) && Math.abs(v) <= LIM;
  function treeAt(id) {
    const m = /^(-?\d+),(-?\d+),(\d+)$/.exec(id);
    if (!m) return null;
    const cx = +m[1], cz = +m[2], i = +m[3] * 3;
    if (!okC(cx) || !okC(cz)) return null;
    const a = ctrees(cx, cz);
    if (i >= a.length) return null;
    return { x: a[i], z: a[i + 1], s: a[i + 2] };
  }
  function nodeAt(id) {
    const m = /^(cotton|ore):(-?\d+):(-?\d+):(\d+)$/.exec(id);
    if (!m) return null;
    const cx = +m[2], cz = +m[3];
    if (!okC(cx) || !okC(cz)) return null;
    return cres(cx, cz).find((n) => n.id === id) || null;
  }

  return { seed, realm: T2_REALM, hgt, tint, biome, ctrees, cres, crabbits, treeAt, nodeAt, h2, vn };
}
