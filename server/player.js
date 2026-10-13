import { CFG, SPAWN, FOODS, weaponIdOf } from '../shared/data.js';
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
    this.maxMana = CFG.MANA_BASE;
    this.mana = this.maxMana;
    this.food = null; // active food buff {id, until}; until is on the room clock and is set when the player joins a room
    this.pendingFood = null; // {id, ms} loaded from a save, turned into `food` by Room.addPlayer
    if (saved && saved.food && FOODS[saved.food.id] && Number.isFinite(saved.food.ms) && saved.food.ms > 0) {
      this.pendingFood = { id: saved.food.id, ms: Math.min(saved.food.ms, CFG.FOOD_MS) };
    }
    this.buffs = []; // timed skill buffs {id, stat, value, until, hits}
    this.hots = []; // heals over time {perSec, until}
    this.cds = {}; // skill id -> time it is ready again (per skill, so swapping weapons does not reset anything)
    this.gcdUntil = 0;
    this.potionReadyAt = 0;
    this.spell = null; // spell being cast {id, key, start, dur, x, z}
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
    this.moveBudget = CFG.WALK_SPEED;
    this.mountHp = CFG.MOUNT_HP; // rabbits bite the donkey while you ride
    this.mountReadyAt = 0; // time (ms) when a donkey that dropped to 0 HP can be summoned again
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
    const fb = this.foodBuff();
    this.maxHp = Math.round(this.stats.maxHp * (1 + (fb.hp || 0)));
    this.hp = Math.min(this.maxHp, Math.max(1, Math.round(this.maxHp * ratio)));
    this.maxMana = Math.round(CFG.MANA_BASE * (1 + (fb.mp || 0)));
    this.mana = Math.min(this.mana, this.maxMana);
  }

  // ---- food and skill buffs (all take `now`, the room clock)
  foodBuff() {
    return (this.food && FOODS[this.food.id] && FOODS[this.food.id].buff) || {};
  }
  buffSum(stat, now) {
    let v = 0;
    for (const b of this.buffs) if (b.stat === stat && b.until > now) v += b.value;
    return v;
  }
  hasBuff(stat, now) {
    return this.buffs.some((b) => b.stat === stat && b.until > now && (b.stat !== 'shield' || b.value > 0));
  }
  // total damage multiplier for the next hit (gear x food x active buffs)
  dmgMult(now) {
    return this.stats.dmg * (1 + (this.foodBuff().dmg || 0)) * (1 + this.buffSum('dmg', now));
  }
  damageReduction(now) {
    return Math.min(0.9, (this.foodBuff().dr || 0) + this.buffSum('dr', now));
  }
  regenMult() { return 1 + (this.foodBuff().regen || 0); }
  manaRegen() { return CFG.MANA_REGEN_PER_SEC * (1 + (this.foodBuff().mregen || 0)); }

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
  toSave(seed, now = Date.now()) {
    return {
      inv: this.inv,
      food: this.food && this.food.until > now ? { id: this.food.id, ms: Math.round(this.food.until - now) } : this.pendingFood,
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

  // `coarse` (protocol 2): the recall countdown is rounded up to whole seconds, so it only changes once a second
  view(now = 0, coarse = false) {
    const left = Math.max(0, this.mountReadyAt - now);
    return {
      dh: Math.round(this.mountHp), // donkey HP
      dr: coarse ? Math.ceil(left / 1000) * 1000 : Math.round(left), // ms until the donkey can be summoned again
      hp: Math.round(this.hp),
      mh: this.maxHp,
      mt: this.mounted ? 1 : 0,
      w: weaponIdOf(this.inv.eq) || 0, // held weapon, for the figure model
      dk: this.donkey ? { x: round2(this.donkey.x), z: round2(this.donkey.z) } : null,
    };
  }
}

export const round2 = (v) => Math.round(v * 100) / 100;
