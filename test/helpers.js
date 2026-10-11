import { Room } from '../server/room.js';
import { Player } from '../server/player.js';
import { createWorld } from '../shared/world.js';

export function fakeClock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

// seeded rng so rabbit wandering is reproducible
export function seededRng(seed = 1) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

export function makeRoom(seed = 7) {
  const now = fakeClock();
  const room = new Room(seed, { now, rng: seededRng(5) });
  return { room, now };
}

export function makePlayer(room, name = 'tester', { x = 0, z = -1.5 } = {}) {
  const out = [];
  const p = new Player({ id: name, name, send: (m) => out.push(m) });
  p.x = x; p.z = z;
  room.addPlayer(p);
  out.length = 0;
  p.out = out;
  p.last = (t) => [...out].reverse().find((m) => m.t === t);
  p.all = (t) => out.filter((m) => m.t === t);
  return p;
}

// first tree / ore node / cotton node in the world near the origin
export function findThings(seed = 7) {
  const w = createWorld(seed);
  let tree = null, node = null;
  for (let cx = -8; cx <= 8 && !(tree && node); cx++) {
    for (let cz = -8; cz <= 8; cz++) {
      const t = w.ctrees(cx, cz);
      if (!tree && t.length >= 3) tree = { id: cx + ',' + cz + ',0', x: t[0], z: t[1] };
      const r = w.cres(cx, cz);
      if (!node && r.length) node = r[0];
    }
  }
  return { tree, node, world: w };
}

export function giveItems(p, id, n) {
  for (let i = 0; i < p.inv.slots.length && n > 0; i++) {
    if (!p.inv.slots[i]) { const t = Math.min(99, n); p.inv.slots[i] = { id, n: t }; n -= t; }
  }
}

export function fillBag(p, id = 'wood') {
  for (let i = 0; i < p.inv.slots.length; i++) if (!p.inv.slots[i]) p.inv.slots[i] = { id, n: 99 };
}
