// Deterministic world generation. Server and client both call createWorld(seed)
// and get the same terrain height, trees, resource nodes and rabbit spawn points.
import { CFG, TOWN, PORTAL, PORTAL_SAFE, inSafeZone } from './data.js';

const sstep = (a, b, x) => {
  x = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export function createWorld(seed) {
  const CS = CFG.CS;

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
  const hgt = (x, z) => {
    let e = vn(x * 0.008, z * 0.008) * 30 + vn(x * 0.02, z * 0.02) * 10 + vn(x * 0.06, z * 0.06) * 3 - 12;
    if (e < 0) e *= 0.2;
    // flat ground under the town (square) and around the portal; hills blend in outside
    const flat = sstep(TOWN.safe - 4, TOWN.safe + 40, Math.max(Math.abs(x), Math.abs(z)));
    const flatP = sstep(PORTAL_SAFE - 20, PORTAL_SAFE + 20, Math.hypot(x - PORTAL.x, z - PORTAL.z));
    return e * flat * flatP;
  };

  // flat [x, z, scale, x, z, scale, ...] per chunk
  const treeCache = new Map();
  function ctrees(cx, cz) {
    const key = cx + ',' + cz;
    let a = treeCache.get(key);
    if (a) return a;
    a = [];
    const f = vn(cx * 0.35 + 9.1, cz * 0.35 + 4.7);
    const n = Math.floor(3 + f * f * 32);
    for (let i = 0; i < n; i++) {
      const x = cx * CS + h2(cx * 7 + i, cz * 13 + 1) * CS;
      const z = cz * CS + h2(cx * 17 + 2, cz * 5 + i) * CS;
      if (inSafeZone(x, z) || hgt(x, z) > 24) continue;
      a.push(x, z, 0.7 + h2(i + cx * 3, cz * 3 + i) * 0.9);
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
        if (inSafeZone(x, z)) continue;
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
      if (inSafeZone(x, z)) continue;
      out.push({ id: 'rab:' + cx + ':' + cz + ':' + i, x, z });
    }
    return out;
  }

  // ---- id lookups (the server uses these to validate what a client asks to gather) ----
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

  return { seed, hgt, ctrees, cres, crabbits, treeAt, nodeAt, h2, vn };
}
