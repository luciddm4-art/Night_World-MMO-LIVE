// Solid things in the world: the spawn hall's walls/stations/portal and standing trees.
// The client uses this for movement (tol = 0, exact) and the server uses it to check
// movement packets (tol > 0 shrinks every obstacle a little, so lag and tiny client/server
// timing differences never push an honest player into a "wall").
import { PORTAL, CFG, TOWN, HOUSES } from './data.js';

const CS = CFG.CS;

export function courtFree(x, z, tol = 0) {
  if (Math.hypot(x - PORTAL.x, z - PORTAL.z) < 2.5 - tol) return false; // portal base
  const a = Math.abs(x), b = Math.abs(z);
  if (a > TOWN.half + 3 || b > TOWN.half + 3) return true; // open country
  const H = TOWN.half, G = TOWN.gate;
  // Town wall (2 thick) with a gate in the middle of every side, and a round tower on each corner
  if (Math.abs(a - H) < 1 - tol && b < H + 1 - tol && b > G + tol) return false; // east / west walls
  if (Math.abs(b - H) < 1 - tol && a < H + 1 - tol && a > G + tol) return false; // north / south walls
  if (Math.hypot(a - H, b - H) < 3.5 - tol) return false;
  for (const h of HOUSES) {
    if (Math.abs(x - h.x) < h.w / 2 - tol && Math.abs(z - h.z) < h.d / 2 - tol) return false;
  }
  if (Math.hypot(x - TOWN.fountain.x, z - TOWN.fountain.z) < TOWN.fountain.r - tol) return false;
  if (a > 14 || b > 14) return true; // everything below is inside the Crafting Hall
  // station counter row + back wall
  if (a < 11.6 - tol && z > -8.2 + tol && z < -5.2 - tol) return false;
  // pillars
  if (Math.abs(z + 3.5) < 0.75 - tol && (Math.abs(a - 3) < 0.75 - tol || Math.abs(a - 10.5) < 0.75 - tol)) return false;
  // hall walls (the south wall has a gap in the middle)
  if (a < 13.5 && b < 13.5) {
    if (Math.abs(a - 12) < 1 - tol && b < 12.8) return false;
    if (Math.abs(z + 12) < 1 - tol && a < 12.8) return false;
    if (Math.abs(z - 12) < 1 - tol && a > 3 + tol && a < 12.8) return false;
  }
  return true;
}

// world: createWorld(seed); standing(treeKey) -> true if that tree is still there ("X,Z,i").
export function isFree(world, standing, x, z, tol = 0) {
  if (!courtFree(x, z, tol)) return false;
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  for (let ii = -1; ii <= 1; ii++) {
    for (let jj = -1; jj <= 1; jj++) {
      const X = cx + ii, Z = cz + jj, t = world.ctrees(X, Z);
      for (let q = 0; q < t.length; q += 3) {
        const dx = x - t[q], dz = z - t[q + 1];
        const r = Math.max(0.15, Math.sqrt(0.8 * t[q + 2] * t[q + 2] + 0.3) - tol);
        if (dx * dx + dz * dz >= r * r) continue;
        if (standing(X + ',' + Z + ',' + q / 3)) return false;
      }
    }
  }
  return true;
}

// Walk a straight line from (x0,z0) to (x1,z1). Returns the last free point on the way
// and whether anything solid was in the path. A player who is already inside something
// (a tree grew back on top of them) is never trapped: their move is allowed.
export function sweep(world, standing, x0, z0, x1, z1, tol = 0.3) {
  if (!isFree(world, standing, x0, z0, tol)) return { x: x1, z: z1, blocked: false };
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.min(120, Math.ceil(len / 0.35));
  let lx = x0, lz = z0;
  for (let i = 1; i <= n; i++) {
    const t = i / n, sx = x0 + (x1 - x0) * t, sz = z0 + (z1 - z0) * t;
    if (!isFree(world, standing, sx, sz, tol)) return { x: lx, z: lz, blocked: true };
    lx = sx; lz = sz;
  }
  return { x: x1, z: z1, blocked: false };
}
