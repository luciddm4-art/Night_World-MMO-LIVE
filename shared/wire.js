// Protocol 2 wire format ("d" messages), shared by the server (encode) and the game page (decode).
//
// To keep the data small, entries are arrays, not objects:
//   player: [id, x, z, y, r, a, m, w]            + [n, c] (name, colour) the first time we see them
//   rabbit: [alias, x, z, hp, flags]             + [id] the first time (alias = small number the server
//                                                  makes up per player; flags: 1 = dead, 2 = chasing)
// `rg` (rabbits that left) lists aliases. A keyframe (f:1) restarts the aliases.

export const encodeRabbit = (alias, x, z, hp, dead, aggro, id) => {
  const e = [alias, x, z, hp, (dead ? 1 : 0) | (aggro ? 2 : 0)];
  if (id !== undefined) e.push(id);
  return e;
};

export const decodePlayer = (a) => ({ id: a[0], x: a[1], z: a[2], y: a[3], r: a[4], a: a[5], m: a[6], w: a[7], n: a[8], c: a[9] });

// `aliases` is the page's alias -> rabbit id table. Returns a rabbit entry in the same shape as the old "s" message.
export function decodeRabbit(a, aliases) {
  if (a.length > 5) aliases[a[0]] = a[5];
  const f = a[4] | 0;
  return { i: aliases[a[0]], x: a[1], z: a[2], h: a[3], d: f & 1, a: f & 2 ? 1 : 0 };
}
