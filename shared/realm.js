// A "realm" is the set of rules that differ between the start world (Tier 1) and Frostfall (Tier 2):
// where you spawn, where the portal is, what counts as a safe zone, what is solid, how big the map is.
// Everything that used to read TOWN / PORTAL / SPAWN directly asks realmOf(seed) instead.
// Server and client both use this, so they always agree.
import { SPAWN, PORTAL, inSafeZone } from './data.js';
import { courtFree } from './collision.js';

export const FROST_SEED = 5001;

// Frostfall: a 5,000 x 5,000 square (x and z from -2500 to 2500). The map edge is a ring of mountains
// that starts rising at RING_FROM; an invisible wall stops you at WALL. The village is on the south edge
// (z is positive = south), in the flat clearing in front of the mountains, with the portal home.
export const FROST = {
  half: 2500,
  ringFrom: 2400, // the mountain ring starts to rise here (distance from the centre, measured as max(|x|,|z|))
  wall: 2476, // invisible wall: nothing walks past this
  village: { x: 0, z: 2300 },
  safeR: 80, // no trees, nodes or hares closer than this to the village centre
  spawn: { x: 0, z: 2338, spread: 10 },
  portal: { x: 0, z: 2284, r: 2.6 },
};

const frostSolid = (x, z, tol = 0) => {
  if (Math.max(Math.abs(x), Math.abs(z)) > FROST.wall + tol) return false; // the invisible wall at the map edge
  if (Math.hypot(x - FROST.portal.x, z - FROST.portal.z) < 2.5 - tol) return false; // portal base
  return true;
};

export const T1_REALM = Object.freeze({
  id: 't1', name: 'Night World', tier: 1,
  spawn: SPAWN, portal: PORTAL, limit: 6000,
  inSafe: inSafeZone, solid: courtFree,
  hall: true, // the Crafting Hall (stations) stands at the spawn
});

export const T2_REALM = Object.freeze({
  id: 't2', name: 'Frostfall', tier: 2,
  spawn: FROST.spawn, portal: FROST.portal, limit: FROST.wall - 6,
  inSafe: (x, z) => Math.hypot(x - FROST.village.x, z - FROST.village.z) < FROST.safeR,
  solid: frostSolid,
  hall: false,
});

export const realmOf = (seed) => (seed === FROST_SEED ? T2_REALM : T1_REALM);
