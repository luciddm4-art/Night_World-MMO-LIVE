import { CFG, SPAWN } from '../shared/data.js';
import { newInv, sanitizeInv, computeStats } from '../shared/inventory.js';

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

// Server-side state for one connected character.
export class Player {
  constructor({ id, name, color = '#888888', account = null, saved = null, send = () => {} }) {
    this.id = String(id);
    this.name = name;
    this.color = color;
    this.account = account; // lower-case account key, or null for guests
    this.send = send; // (obj) => void, set by the transport
    this.inv = saved ? sanitizeInv(saved.inv) : newInv();
    this.stats = computeStats(this.inv);
    this.maxHp = this.stats.maxHp;
    const ratio = saved && Number.isFinite(saved.hpRatio) ? Math.min(1, Math.max(0.01, saved.hpRatio)) : 1;
    this.hp = Math.max(1, Math.round(this.maxHp * ratio));
    this.x = 0;
    this.z = 0;
    this.y = 0.13;
    this.r = Math.PI;
    this.a = 0; // attack counter (clients use it to animate swings)
    this.mounted = false;
    this.donkey = null; // {x,z} while a summoned donkey stands nearby
    this.gather = null; // {kind,id,start,x,z,dur}
    this.lastAtk = 0;
    this.lastDamageT = 0;
    this.lastPosT = 0;
    this.moveBudget = CFG.MAX_SPEED;
    this.chatTokens = 3;
    this.chatT = 0;
    this.dirty = false;
    this.joinedAt = 0;
  }

  hasMount() {
    return !!(this.inv.eq.mount && this.inv.eq.mount.id === 'donkey');
  }

  // Recompute derived stats after equipment changes, keeping the HP ratio.
  recalc() {
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.stats = computeStats(this.inv);
    this.maxHp = this.stats.maxHp;
    this.hp = Math.min(this.maxHp, Math.max(1, Math.round(this.maxHp * ratio)));
  }

  setSpawn(rng = Math.random) {
    this.x = SPAWN.x + (rng() - 0.5) * SPAWN.spread;
    this.z = SPAWN.z;
    this.r = Math.PI;
    this.y = 0.13;
  }

  restore(saved, seed) {
    const w = saved && saved.worlds && saved.worlds[String(seed)];
    if (w && Number.isFinite(w.x) && Number.isFinite(w.z)) {
      this.x = fin(w.x);
      this.z = fin(w.z);
      this.r = fin(w.r, Math.PI);
      if (w.mounted && this.hasMount()) this.mounted = true;
      else if (w.donkey && this.hasMount() && Number.isFinite(w.donkey.x) && Number.isFinite(w.donkey.z)) {
        this.donkey = { x: w.donkey.x, z: w.donkey.z };
      }
      return true;
    }
    return false;
  }

  // What we persist for accounts. `worlds` is merged by the store.
  toSave(seed) {
    return {
      inv: this.inv,
      hpRatio: this.maxHp > 0 ? this.hp / this.maxHp : 1,
      color: this.color,
      lastSeed: seed,
      world: {
        x: this.x, z: this.z, r: this.r,
        mounted: this.mounted,
        donkey: this.donkey,
      },
    };
  }

  view() {
    return {
      hp: Math.round(this.hp),
      mh: this.maxHp,
      mt: this.mounted ? 1 : 0,
      dk: this.donkey ? { x: round2(this.donkey.x), z: round2(this.donkey.z) } : null,
    };
  }
}

export const round2 = (v) => Math.round(v * 100) / 100;
