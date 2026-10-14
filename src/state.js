import { CFG, EQUIP_SLOTS } from '../shared/data.js';

// Shared mutable client state. The server is the source of truth for inventory,
// stats, resource nodes and rabbits — this just mirrors what it last told us.
export const S = {
  ready: false, // true once the server has welcomed us
  myId: null,
  name: '',
  online: 1,
  P: { x: 0, z: -1.5, r: Math.PI, y: 0.13 },
  inv: { eq: Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null])), slots: new Array(CFG.INV_SLOTS).fill(null) },
  st: { hp: CFG.PLAYER_BASE_HP, maxHp: CFG.PLAYER_BASE_HP, dmg: 1, haste: 0, def: 0, speed: 0 },
  mounted: false,
  mountHp: CFG.MOUNT_HP, // donkey HP (server tells us)
  mountReadyAt: 0, // performance.now() time when a knocked-out donkey can be summoned again
  donkeyPos: null,
  nodeQty: {}, // only depleted / partly gathered ids are listed; anything else is full
  rabbits: {},
  others: {},
  mana: { v: CFG.MANA_BASE, max: CFG.MANA_BASE, rate: CFG.MANA_REGEN_PER_SEC, at: 0 }, // the server sends it when it changes; we regrow it locally
  cd: {}, // skill id (or 'potion') -> { until, total } in performance.now() time
  gcdUntil: 0,
  spell: null, // spell being cast: { id, start, dur }
  buffs: { list: [], food: null, at: 0 }, // timed buffs from the server (ms left, as of `at`)
  gather: { active: false, kind: null, id: null, start: 0, dur: 0, pending: 0 },
  treesDirty: false,
  session: null, // {mode:'guest'} | {mode:'token'} used to re-auth after a dropped connection
};

export const nodeQty = (id) => (id in S.nodeQty ? S.nodeQty[id] : CFG.NODE_QTY);
