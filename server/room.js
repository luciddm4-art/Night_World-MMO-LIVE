// One Room = one shared world (one seed). All game rules live here, so the
// server — not the browser — decides what you gathered, crafted, hit or earned.
// Room knows nothing about sockets: players have a send(obj) function, and the
// clock/RNG are injectable, which keeps it fully unit-testable.
import {
  CFG, ITEMS, RECIPES, STATIONS, STATION_Z, STATION_RANGE, EQUIP_SLOTS, STACK_SLOTS, POTIONS, FOODS, CHAT_MAX_LEN, REWARD_SLOTS, inSafeZone, weaponOf, weaponIdOf,
} from '../shared/data.js';
import { SKILLS, SKILL_KEYS, SKILL_STATS, skillIdsFor } from '../shared/skills.js';
import { createWorld } from '../shared/world.js';
import { sweep, isFree } from '../shared/collision.js';
import * as Inv from '../shared/inventory.js';
import { round2 } from './player.js';
import { encodeRabbit } from '../shared/wire.js';

const SLACK = 2.0; // positional tolerance for network lag (units)
const STATION_SLACK = 1.0;
const GATHER_GRACE_MS = 250;
const SNAP_PLAYER_R = 220;
const SNAP_RABBIT_R = 160;
const KEYFRAME_MS = 20000; // protocol 2: a full resync this often (cheap insurance against drift)
const HEARTBEAT_MS = 2000; // protocol 2: at least one tiny message this often so clients can tell the line is alive
const round1 = (v) => Math.round(v * 10) / 10;
// protocol 2: how often (ms) a moving thing is re-sent, by distance in world units: [[maxDistance, everyMs], ...]
const RABBIT_TIERS = [[30, 0], [70, 200], [Infinity, 500]];
const PLAYER_TIERS = [[40, 0], [90, 200], [Infinity, 500]];
const every = (d, tiers) => { for (const [max, ms] of tiers) if (d <= max) return ms; return 500; };
const SNAP_RABBIT_R_V2 = 125; // the fog hides rabbits beyond ~120 units, so do not send them
const GATHER_STALE_MS = 15000;

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export class Room {
  constructor(seed, { now = Date.now, rng = Math.random, chatFilter = null } = {}) {
    this.seed = seed;
    this.chatFilter = chatFilter; // (text) => cleaned text
    this.now = now;
    this.rng = rng;
    this.world = createWorld(seed);
    this.players = new Map(); // id -> Player
    this.depleted = new Map(); // node/tree id -> {qty, readyAt}
    this.rabbits = new Map(); // id -> rabbit
    this.deadUntil = new Map(); // rabbit id -> respawn time
    this.chatLog = [];
    this.lastTick = now();
    this.lastEnsure = 0;
    this.emptySince = now();
  }

  // ------------------------------------------------------------ membership
  // A saved position can end up inside a wall or house after the world changed: move such players to the plaza.
  ensureStandable(p) {
    if (isFree(this.world, (k) => !this.isDepleted(k), p.x, p.z)) return false;
    p.setSpawn(this.rng);
    p.mounted = false;
    p.donkey = null;
    return true;
  }

  addPlayer(p) {
    this.players.set(p.id, p);
    this.emptySince = null;
    p.joinedAt = this.now();
    p.lastPosT = p.joinedAt;
    p.known = new Set();
    p.snapState = null; // protocol-2 delta bookkeeping restarts with every join
    p.y = Math.max(0.13, this.world.hgt(p.x, p.z));
    if (p.pendingFood) { // a food buff from a previous session keeps the time it had left
      p.food = { id: p.pendingFood.id, until: p.joinedAt + p.pendingFood.ms };
      p.pendingFood = null;
      p.recalc();
    }
    this.ensureRabbits();
    return this.welcome(p);
  }

  removePlayer(p) {
    this.players.delete(p.id);
    p.gather = null;
    if (this.players.size === 0) this.emptySince = this.now();
  }

  welcome(p) {
    return {
      t: 'welcome',
      id: p.id,
      name: p.name,
      seed: this.seed,
      you: {
        x: round2(p.x), z: round2(p.z), r: round2(p.r), c: p.color,
        ...p.view(this.now()), inv: p.inv, st: this.statsOf(p),
        mana: { v: round1(p.mana), max: p.maxMana, rate: p.manaRegen() },
        buffs: this.buffsOf(p, this.now()),
      },
      depleted: [...this.depleted].map(([id, s]) => [id, s.qty]),
      chat: this.chatLog.slice(-20),
      online: this.players.size,
    };
  }

  statsOf(p) {
    const fb = p.foodBuff();
    return {
      maxHp: p.maxHp,
      dmg: round2(p.stats.dmg * (1 + (fb.dmg || 0))),
      haste: p.stats.haste,
      def: round2(1 - (1 - p.stats.def) * (1 - Math.min(0.9, fb.dr || 0))),
      speed: p.stats.speed, // boots: walking speed bonus (the page applies it to its own movement)
    };
  }

  // ------------------------------------------------------------ messaging
  broadcast(obj) {
    for (const p of this.players.values()) p.send(obj);
  }
  // send to everyone within r units of a point (hit events: you see other players' fights too)
  broadcastNear(x, z, r, obj) {
    for (const q of this.players.values()) if (Math.abs(q.x - x) <= r && Math.abs(q.z - z) <= r) q.send(obj);
  }
  toast(p, m) { p.send({ t: 'toast', m }); }
  gain(p, item, n, src) { p.send({ t: 'gain', item, n, src }); }
  fail(p, m) { p.send({ t: 'fail', m }); }
  sendInv(p) {
    p.dirty = true;
    p.send({ t: 'inv', inv: p.inv, st: this.statsOf(p), hp: Math.round(p.hp) });
  }

  handle(p, m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'p': return this.onPos(p, m);
      case 'atk': return this.onAttack(p, m);
      case 'gather': return this.onGather(p, m);
      case 'gdone': return this.onGatherDone(p);
      case 'gcancel': return this.cancelGather(p);
      case 'craft': return this.onCraft(p, m);
      case 'equip': return this.onEquip(p, m);
      case 'unequip': return this.onUnequip(p, m);
      case 'mount': return this.onMount(p);
      case 'dismount': return this.onDismount(p);
      case 'chat': return this.onChat(p, m);
      case 'skill': return this.onSkill(p, m);
      case 'use': return this.onUse(p, m);
      case 'scancel': return this.cancelSpell(p);
      default: return undefined;
    }
  }

  // ------------------------------------------------------------ movement
  onPos(p, m) {
    if (!isNum(m.x) || !isNum(m.z)) return;
    const now = this.now();
    const x = clamp(m.x, 1e6), z = clamp(m.z, 1e6);
    if (isNum(m.r)) p.r = clamp(m.r, 10);

    // Movement budget: you can never cover more ground than top speed allows,
    // no matter how many (or how few) position packets you send.
    const dtS = Math.max(0, (now - p.lastPosT) / 1000);
    p.lastPosT = now;
    const vmax = (p.mounted ? CFG.RIDE_SPEED : CFG.WALK_SPEED * (1 + p.stats.speed)) * 1.15;
    p.moveBudget = Math.min(vmax * 1.5, p.moveBudget + vmax * dtS);
    const d = dist(x, z, p.x, p.z);
    let nx = x, nz = z;
    if (d > p.moveBudget) {
      const k = d > 0 ? p.moveBudget / d : 0;
      nx = p.x + (x - p.x) * k;
      nz = p.z + (z - p.z) * k;
      p.moveBudget = 0;
      if (now - (p.lastCorrection || 0) > 250) {
        p.lastCorrection = now;
        p.send({ t: 'pos', x: round2(nx), z: round2(nz) });
      }
    } else {
      p.moveBudget -= d;
    }
    // Solid things: walk the path and stop at the first wall/tree. Honest clients never hit
    // this (they collide locally); it stops walking through walls with a modified client.
    const sw = sweep(this.world, (k) => !this.isDepleted(k), p.x, p.z, nx, nz);
    if (sw.blocked) {
      nx = sw.x; nz = sw.z;
      p.moveBudget = Math.max(0, p.moveBudget - 0.5);
      if (now - (p.lastCorrection || 0) > 250) {
        p.lastCorrection = now;
        p.send({ t: 'pos', x: round2(nx), z: round2(nz) });
      }
    }
    p.x = nx;
    p.z = nz;
    p.y = Math.max(0.13, this.world.hgt(nx, nz));

    if (p.gather && dist(p.x, p.z, p.gather.x, p.gather.z) > 3) this.cancelGather(p);
  }

  // ------------------------------------------------------------ gathering
  resolveTarget(kind, id) {
    if (typeof id !== 'string' || id.length > 64) return null;
    if (kind === 'tree') {
      const t = this.world.treeAt(id);
      return t && { x: t.x, z: t.z, range: 1.8, item: 'wood', n: 1 };
    }
    if (kind === 'node') {
      const nd = this.world.nodeAt(id);
      return nd && { x: nd.x, z: nd.z, range: 2.0, item: nd.type, n: 1 };
    }
    if (kind === 'corpse') {
      const rb = this.rabbits.get(id);
      return rb && rb.dead && !rb.gathered ? { x: rb.x, z: rb.z, range: 1.8, item: 'hide', n: 3 } : null;
    }
    return null;
  }

  isDepleted(id) {
    const s = this.depleted.get(id);
    return !!s && s.qty <= 0;
  }

  onGather(p, m) {
    if (p.gather || p.spell) return this.fail(p, 'Already busy');
    const tgt = this.resolveTarget(m.kind, m.id);
    if (!tgt) return this.fail(p, 'Nothing to gather there');
    if (dist(p.x, p.z, tgt.x, tgt.z) > tgt.range + SLACK) return this.fail(p, 'Too far away');
    if (m.kind !== 'corpse' && this.isDepleted(m.id)) return this.fail(p, 'Already depleted');
    p.gather = { kind: m.kind, id: m.id, start: this.now(), x: p.x, z: p.z, dur: CFG.GATHER_MS };
    p.send({ t: 'cast', kind: m.kind, id: m.id, dur: CFG.GATHER_MS });
  }

  cancelGather(p) {
    p.gather = null;
  }

  onGatherDone(p) {
    const g = p.gather;
    if (!g) return;
    p.gather = null;
    const now = this.now();
    if (now - g.start < g.dur - GATHER_GRACE_MS) return this.fail(p, 'Too early');
    if (dist(p.x, p.z, g.x, g.z) > 3) return this.fail(p, 'You moved');

    if (g.kind === 'mount') return this.mountFinish(p);

    const tgt = this.resolveTarget(g.kind, g.id);
    if (!tgt) return this.fail(p, 'Nothing to gather there');
    if (dist(p.x, p.z, tgt.x, tgt.z) > tgt.range + SLACK) return this.fail(p, 'Too far away');
    if (g.kind !== 'corpse' && this.isDepleted(g.id)) return this.fail(p, 'Already depleted');
    if (!Inv.addItem(p.inv, tgt.item, tgt.n)) return this.fail(p, 'Inventory full');

    const name = ITEMS[tgt.item].n;
    this.gain(p, tgt.item, tgt.n, g.kind === 'corpse' ? 'loot' : 'gather');
    if (g.kind === 'corpse') {
      this.rabbits.delete(g.id);
      this.deadUntil.set(g.id, now + CFG.RABBIT_RESPAWN_MS);
      this.toast(p, '+3 Hide');
    } else {
      const s = this.depleted.get(g.id) || { qty: CFG.NODE_QTY, readyAt: 0 };
      s.qty--;
      s.readyAt = now + (s.qty <= 0 ? CFG.RESPAWN_MS : CFG.PARTIAL_REFILL_MS);
      this.depleted.set(g.id, s);
      this.broadcast({ t: 'node', id: g.id, qty: s.qty });
      this.toast(p, '+1 ' + name + (s.qty > 0 ? ' (' + s.qty + ' left)' : ' (respawns in 10s)'));
    }
    this.sendInv(p);
  }

  // ------------------------------------------------------------ combat
  onAttack(p, m) {
    if (p.mounted || p.spell) return;
    const now = this.now();
    const wp = weaponOf(p.inv.eq); // fists, sword, bow or fire staff: reach / damage / cooldown / aim all come from the weapon
    const cd = wp.cd * (1 - p.stats.haste);
    if (now - p.lastAtk < cd - 80) return;
    p.lastAtk = now;
    p.a = (p.a + 1) % 1000000;
    if (isNum(m.r)) p.r = clamp(m.r, 10);
    const fx = Math.sin(p.r), fz = Math.cos(p.r);
    const base = wp.dmg * p.dmgMult(now);
    const reach = wp.reach + 0.6; // +0.6: lag tolerance
    const inCone = [];
    for (const rb of this.rabbits.values()) {
      if (rb.dead) continue;
      const dx = rb.x - p.x, dz = rb.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > reach) continue;
      if ((dx * fx + dz * fz) / Math.max(d, 0.001) < wp.cone) continue;
      inCone.push({ rb, d });
    }
    if (!inCone.length) return;
    let targets = inCone;
    if (wp.hits === 'one') { // bow / staff: the nearest rabbit you are aiming at
      inCone.sort((a, b) => a.d - b.d);
      targets = [inCone[0]];
    }
    const struck = new Set();
    for (const { rb } of targets) { struck.add(rb.id); this.damageRabbit(rb, Math.round(base * (1 + this.takeMark(p, now))), p, now, wp.id, false); }
    if (wp.splash > 0) { // fire: scorches rabbits standing near the one that was hit
      const c = targets[0].rb, sd = Math.round(wp.splash * p.dmgMult(now));
      for (const rb of this.rabbits.values()) {
        if (rb.dead || struck.has(rb.id)) continue;
        if (dist(rb.x, rb.z, c.x, c.z) <= wp.splashR) this.damageRabbit(rb, sd, p, now, wp.id, true);
      }
    }
  }

  damageRabbit(rb, amount, p, now, weapon, splash) {
    rb.hp -= amount;
    const killed = rb.hp <= 0;
    this.broadcastNear(rb.x, rb.z, 60, { t: 'hit', i: rb.id, d: amount, h: Math.max(0, rb.hp), k: killed ? 1 : 0, by: p.id, w: weapon, sp: splash ? 1 : 0 });
    rb.mode = 'chase';
    rb.target = p.id;
    rb.atkT = now + 400;
    if (killed) {
      rb.hp = 0;
      rb.dead = true;
      rb.deadAt = now;
      rb.target = null;
    }
  }

  // ------------------------------------------------------------ crafting / equipment
  onCraft(p, m) {
    const r = RECIPES.find((x) => x.id === m.id);
    if (!r) return;
    // Every recipe belongs to one station and can only be made while standing at it.
    const st = STATIONS.find((s) => s.k === r.station);
    if (!st) return this.fail(p, 'That needs a crafting station');
    if (dist(p.x, p.z, st.x, STATION_Z) > STATION_RANGE + STATION_SLACK) return this.fail(p, 'Move closer to the ' + st.name);
    if (!Inv.canAfford(p.inv, r.cost)) return this.fail(p, 'Not enough materials');
    const work = Inv.cloneInv(p.inv);
    for (const k in r.cost) Inv.removeItems(work, k, r.cost[k]);
    if (!Inv.addItem(work, r.out, r.n)) return this.fail(p, 'Inventory full');
    p.inv = work;
    this.gain(p, r.out, r.n, 'craft');
    this.toast(p, 'Crafted ' + r.name);
    this.sendInv(p);
  }

  onEquip(p, m) {
    const i = m.i;
    if (!Number.isInteger(i) || i < 0 || i >= CFG.INV_SLOTS || !p.inv.slots[i]) return;
    const id = p.inv.slots[i].id;
    if (!Inv.equipFromBag(p.inv, i)) return this.fail(p, 'Cannot equip that');
    this.cancelSpell(p);
    p.recalc();
    this.toast(p, 'Equipped ' + ITEMS[id].n);
    this.checkDonkeyReward(p);
    this.sendInv(p);
  }

  onUnequip(p, m) {
    if (!EQUIP_SLOTS.includes(m.slot) || !p.inv.eq[m.slot]) return;
    if (!Inv.unequip(p.inv, m.slot)) return this.fail(p, 'Inventory full');
    this.cancelSpell(p);
    if (m.slot === 'mount') {
      p.mounted = false;
      p.donkey = null;
    }
    p.recalc();
    this.toast(p, 'Unequipped');
    this.sendInv(p);
  }

  checkDonkeyReward(p) {
    for (const s of REWARD_SLOTS) if (!p.inv.eq[s]) return;
    if (p.hasMount() || Inv.countItem(p.inv, 'donkey') > 0) return;
    if (Inv.addItem(p.inv, 'donkey', 1)) {
      this.gain(p, 'donkey', 1, 'reward');
      this.toast(p, 'Reward: Donkey received!');
    }
  }

  // ------------------------------------------------------------ mount
  mountWait(p) { return Math.max(0, p.mountReadyAt - this.now()); }
  onMount(p) {
    if (p.mounted || p.gather || p.spell) return;
    if (!p.hasMount()) return this.fail(p, 'No donkey equipped');
    const wait = this.mountWait(p);
    if (wait > 0) return this.fail(p, 'The donkey is recovering (' + Math.ceil(wait / 1000) + 's)');
    if (p.donkey && dist(p.x, p.z, p.donkey.x, p.donkey.z) < 2.5 + 1) {
      p.mounted = true;
      p.donkey = null;
      p.dirty = true;
      return this.toast(p, 'Mounted');
    }
    p.gather = { kind: 'mount', id: '', start: this.now(), x: p.x, z: p.z, dur: CFG.MOUNT_CAST_MS };
    p.send({ t: 'cast', kind: 'mount', id: '', dur: CFG.MOUNT_CAST_MS });
  }
  mountFinish(p) {
    if (!p.hasMount() || this.mountWait(p) > 0) return;
    p.mounted = true;
    p.donkey = null;
    p.dirty = true;
    this.toast(p, 'Mounted');
  }
  // Rabbit bites hit the donkey instead of the rider. At 0 HP the rider falls off and the donkey is gone for 30 s.
  damageMount(p, amount, now, by) {
    p.mountHp = Math.max(0, p.mountHp - amount);
    p.send({ t: 'hurt', d: Math.round(amount), by, m: 1 });
    if (p.mountHp > 0) return;
    p.mounted = false;
    p.donkey = null;
    p.mountReadyAt = now + CFG.MOUNT_RECALL_MS;
    p.dirty = true;
    this.toast(p, 'Your donkey is exhausted! It can be summoned again in ' + CFG.MOUNT_RECALL_MS / 1000 + 's');
  }
  onDismount(p) {
    if (!p.mounted) return;
    p.mounted = false;
    p.donkey = { x: p.x + Math.cos(p.r) * 1.2, z: p.z + Math.sin(p.r) * 1.2 };
    p.dirty = true;
    this.toast(p, 'Dismounted');
  }

  // ------------------------------------------------------------ mana, skills, potions and food
  sendMana(p) { p.send({ t: 'mana', v: round1(p.mana), max: p.maxMana, rate: p.manaRegen() }); }
  buffsOf(p, now) {
    const seen = new Map();
    for (const b of p.buffs) if (b.until > now && !seen.has(b.id)) seen.set(b.id, { id: b.id, ms: Math.round(b.until - now) });
    return { list: [...seen.values()], food: p.food && p.food.until > now ? { id: p.food.id, ms: Math.round(p.food.until - now) } : null };
  }
  sendBuffs(p, now) { p.send({ t: 'buffs', ...this.buffsOf(p, now) }); }

  // your next 'mark' hits do extra damage; returns the bonus (0.3 = +30%) and uses one hit up
  takeMark(p, now) {
    const b = p.buffs.find((x) => x.stat === 'mark' && x.until > now && x.hits > 0);
    if (!b) return 0;
    b.hits--;
    if (b.hits <= 0) { p.buffs = p.buffs.filter((x) => x !== b); this.sendBuffs(p, now); }
    return b.value;
  }

  cancelSpell(p, why) {
    if (!p.spell) return;
    p.spell = null;
    p.send({ t: 'scancel' });
    if (why) this.fail(p, why);
  }

  onSkill(p, m) {
    if (!SKILL_KEYS.includes(m.k)) return;
    const now = this.now();
    if (p.mounted) return this.fail(p, 'You cannot cast while riding');
    if (p.gather || p.spell) return this.fail(p, p.spell ? 'Already casting' : 'You are busy');
    const id = skillIdsFor(p.inv.eq)[m.k];
    const sk = id && SKILLS[id];
    if (!sk) return;
    if (now < p.gcdUntil) return;
    if (now < (p.cds[id] || 0)) return this.fail(p, sk.n + ' is not ready yet');
    if (p.mana < sk.mana) return this.fail(p, 'Not enough mana');
    if (isNum(m.r)) p.r = clamp(m.r, 10);
    if (sk.cast > 0) {
      p.spell = { id, key: m.k, start: now, dur: sk.cast, x: p.x, z: p.z };
      p.gcdUntil = now + CFG.GCD_MS;
      p.send({ t: 'scast', id, dur: sk.cast });
      return;
    }
    this.castSkill(p, id, sk, now);
  }

  finishSpell(p, now) {
    const sp = p.spell;
    p.spell = null;
    const sk = SKILLS[sp.id];
    if (!sk || skillIdsFor(p.inv.eq)[sp.key] !== sp.id) return p.send({ t: 'scancel' });
    if (p.mana < sk.mana) { p.send({ t: 'scancel' }); return this.fail(p, 'Not enough mana'); }
    this.castSkill(p, sp.id, sk, now);
  }

  castSkill(p, id, sk, now) {
    p.mana -= sk.mana;
    p.cds[id] = now + sk.cd;
    p.gcdUntil = now + CFG.GCD_MS;
    let buffed = false;
    for (const e of sk.effects || []) {
      if (e.kind === 'damage') this.fxDamage(p, e, now);
      else if (e.kind === 'heal') this.fxHeal(p, e, now);
      else if (e.kind === 'buff') buffed = this.fxBuff(p, id, e, now) || buffed;
      else if (e.kind === 'dash') this.fxDash(p, e);
    }
    this.sendMana(p);
    p.send({ t: 'cd', id, ms: sk.cd });
    if (buffed) this.sendBuffs(p, now);
    this.broadcastNear(p.x, p.z, 60, { t: 'skfx', by: p.id, id, r: round2(p.r) });
  }

  fxDamage(p, e, now) {
    const wp = weaponOf(p.inv.eq);
    const fx = Math.sin(p.r), fz = Math.cos(p.r);
    const range = (isNum(e.range) ? e.range : wp.reach) + 0.6;
    const circle = e.shape === 'circle';
    const cone = isNum(e.cone) ? e.cone : 0.3;
    const hit = [];
    for (const rb of this.rabbits.values()) {
      if (rb.dead) continue;
      const dx = rb.x - p.x, dz = rb.z - p.z, d = Math.hypot(dx, dz);
      if (d > range) continue;
      if (!circle && (dx * fx + dz * fz) / Math.max(d, 0.001) < cone) continue;
      hit.push({ rb, d });
    }
    hit.sort((a, b) => a.d - b.d);
    const base = wp.dmg * p.dmgMult(now) * (isNum(e.mult) ? e.mult : 1);
    for (const { rb } of hit.slice(0, e.max > 0 ? e.max : hit.length)) {
      this.damageRabbit(rb, Math.max(1, Math.round(base * (1 + this.takeMark(p, now)))), p, now, wp.id, false);
    }
  }

  fxHeal(p, e, now) {
    const total = isNum(e.amount) ? e.amount : (isNum(e.pct) ? e.pct * p.maxHp : 0);
    if (total <= 0) return;
    if (e.over > 0) {
      p.hots.push({ perSec: total / e.over, until: now + e.over * 1000 });
      return;
    }
    p.hp = Math.min(p.maxHp, p.hp + total);
    p.send({ t: 'heal', d: Math.round(total) });
  }

  fxBuff(p, id, e, now) {
    if (!SKILL_STATS.includes(e.stat) || !isNum(e.value) || !(e.dur > 0)) return false;
    p.buffs = p.buffs.filter((b) => !(b.id === id && b.stat === e.stat)); // casting it again refreshes it
    p.buffs.push({ id, stat: e.stat, value: e.value, until: now + e.dur, hits: e.hits > 0 ? e.hits : 1 });
    return true;
  }

  fxDash(p, e) {
    const dist2 = isNum(e.dist) ? e.dist : 0;
    const nx = p.x + Math.sin(p.r) * dist2, nz = p.z + Math.cos(p.r) * dist2;
    const sw = sweep(this.world, (k) => !this.isDepleted(k), p.x, p.z, nx, nz);
    p.x = sw.blocked ? sw.x : nx;
    p.z = sw.blocked ? sw.z : nz;
    p.y = Math.max(0.13, this.world.hgt(p.x, p.z));
    p.send({ t: 'pos', x: round2(p.x), z: round2(p.z) });
  }

  // per-player, every tick: mana regen, spell progress, buff / HoT / food expiry
  tickMagic(p, dt, now) {
    if (p.spell) {
      if (dist(p.x, p.z, p.spell.x, p.spell.z) > CFG.SPELL_MOVE_CANCEL) this.cancelSpell(p, 'Cast interrupted');
      else if (now - p.spell.start >= p.spell.dur) this.finishSpell(p, now);
    }
    if (p.mana < p.maxMana) p.mana = Math.min(p.maxMana, p.mana + p.manaRegen() * dt);
    if (p.hots.length) p.hots = p.hots.filter((h) => h.until > now);
    if (p.buffs.length) {
      const live = p.buffs.filter((b) => b.until > now && !(b.stat === 'shield' && b.value <= 0));
      if (live.length !== p.buffs.length) { p.buffs = live; this.sendBuffs(p, now); }
    }
    if (p.food && p.food.until <= now) {
      p.food = null;
      p.recalc();
      this.toast(p, 'Your food buff wore off');
      this.sendBuffs(p, now);
      this.sendMana(p);
      p.send({ t: 'st', st: this.statsOf(p) });
      p.dirty = true;
    }
  }

  // Potion and food buttons. The server checks everything, so a modified page cannot drink faster.
  onUse(p, m) {
    if (!STACK_SLOTS.includes(m.slot)) return;
    const it = p.inv.eq[m.slot];
    if (!it) return this.fail(p, m.slot === 'potion' ? 'No potion equipped' : 'No food equipped');
    const now = this.now();
    if (m.slot === 'potion') {
      const def = POTIONS[it.id];
      if (!def) return;
      if (now < p.potionReadyAt) return this.fail(p, 'Potion is not ready yet');
      const hp = def.heal || def.healPct, mp = def.mana;
      const hpFull = p.hp >= p.maxHp - 0.5, mpFull = p.mana >= p.maxMana - 0.5;
      if ((!hp || hpFull) && (!mp || mpFull)) return this.fail(p, hp && !mp ? 'Your health is already full' : mp && !hp ? 'Your mana is already full' : 'You are already full');
      if (hp) {
        const amt = def.heal || def.healPct * p.maxHp;
        p.hp = Math.min(p.maxHp, p.hp + amt);
        p.send({ t: 'heal', d: Math.round(amt) });
      }
      if (mp) { p.mana = Math.min(p.maxMana, p.mana + mp); this.sendMana(p); }
      const cd = isNum(def.cd) ? def.cd : CFG.POTION_CD_MS;
      p.potionReadyAt = now + cd;
      p.send({ t: 'cd', id: 'potion', ms: cd });
    } else {
      const def = FOODS[it.id];
      if (!def) return;
      p.food = { id: it.id, until: now + CFG.FOOD_MS };
      p.recalc();
      this.toast(p, 'You ate ' + ITEMS[it.id].n + ' — buff for ' + CFG.FOOD_MS / 60000 + ' minutes');
      this.sendBuffs(p, now);
      this.sendMana(p);
    }
    it.n--;
    if (it.n <= 0) p.inv.eq[m.slot] = null;
    this.sendInv(p);
  }

  // ------------------------------------------------------------ chat
  onChat(p, m) {
    if (typeof m.m !== 'string') return;
    const text = m.m
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CHAT_MAX_LEN);
    if (!text) return;
    const now = this.now();
    p.chatTokens = Math.min(3, p.chatTokens + (now - (p.chatT || now)) / 2000);
    p.chatT = now;
    if (p.mutedUntil && now < p.mutedUntil) return this.fail(p, 'You are muted for ' + Math.ceil((p.mutedUntil - now) / 60000) + ' more minute(s)');
    if (p.chatTokens < 1) return this.fail(p, 'You are chatting too fast');
    p.chatTokens -= 1;
    const msg = { t: 'chat', n: p.name, m: this.chatFilter ? this.chatFilter(text) : text, ts: now };
    this.chatLog.push(msg);
    if (this.chatLog.length > 30) this.chatLog.shift();
    this.broadcast(msg);
  }

  // ------------------------------------------------------------ rabbits
  ensureRabbits() {
    const now = this.now();
    const CS = CFG.CS, VR = CFG.VR;
    const spawn = new Map(), keep = new Set();
    for (const p of this.players.values()) {
      const pcx = Math.floor(p.x / CS), pcz = Math.floor(p.z / CS);
      for (let i = -VR - 1; i <= VR + 1; i++) {
        for (let j = -VR - 1; j <= VR + 1; j++) {
          const cx = pcx + i, cz = pcz + j, key = cx + ',' + cz;
          keep.add(key);
          if (Math.abs(i) <= VR && Math.abs(j) <= VR) spawn.set(key, [cx, cz]);
        }
      }
    }
    for (const [key, [cx, cz]] of spawn) {
      for (const def of this.world.crabbits(cx, cz)) {
        if (this.rabbits.has(def.id)) continue;
        const du = this.deadUntil.get(def.id);
        if (du && du > now) continue;
        this.rabbits.set(def.id, {
          id: def.id, x: def.x, z: def.z, hp: CFG.RABBIT_HP, mode: 'wander',
          tx: def.x, tz: def.z, wt: 0, atkT: 0, dead: false, gathered: false, deadAt: 0,
          target: null, home: key,
        });
      }
    }
    for (const [id, rb] of this.rabbits) if (!keep.has(rb.home)) this.rabbits.delete(id);
    for (const [id, t] of this.deadUntil) if (t <= now) this.deadUntil.delete(id);
  }

  updateRabbits(dt, now) {
    for (const [id, rb] of this.rabbits) {
      if (rb.dead) {
        if (now - rb.deadAt > CFG.CORPSE_MS) {
          this.rabbits.delete(id);
          this.deadUntil.set(id, now + CFG.RABBIT_RESPAWN_MS);
        }
        continue;
      }
      if (rb.mode === 'wander') {
        rb.wt -= dt * 1000;
        if (rb.wt <= 0) {
          rb.wt = 1500 + this.rng() * 2500;
          rb.tx = rb.x + (this.rng() - 0.5) * 8;
          rb.tz = rb.z + (this.rng() - 0.5) * 8;
        }
        const dx = rb.tx - rb.x, dz = rb.tz - rb.z, dl = Math.hypot(dx, dz);
        if (dl > 0.3) {
          const sp = 1.2 * dt;
          const nx = rb.x + (dx / dl) * sp, nz = rb.z + (dz / dl) * sp;
          if (!inSafeZone(nx, nz)) { rb.x = nx; rb.z = nz; } else rb.wt = 0; // rabbits never wander into the town
        }
        continue;
      }
      const t = this.players.get(rb.target);
      if (!t) { rb.mode = 'wander'; rb.target = null; continue; }
      const pdx = t.x - rb.x, pdz = t.z - rb.z, pd = Math.hypot(pdx, pdz);
      if (pd > 12 || inSafeZone(t.x, t.z)) { rb.mode = 'wander'; rb.target = null; } // the town is a safe zone
      else if (pd < 1.5) {
        rb.mode = 'attack';
        if (now - rb.atkT > CFG.RABBIT_ATK_MS) {
          rb.atkT = now;
          if (t.mounted) this.damageMount(t, CFG.RABBIT_DMG, now, rb.id);
          else this.damagePlayer(t, CFG.RABBIT_DMG * (1 - t.stats.def), now, rb.id);
        }
      } else {
        rb.mode = 'chase';
        const sp = 2.6 * dt;
        const nx = rb.x + (pdx / pd) * sp, nz = rb.z + (pdz / pd) * sp;
        if (!inSafeZone(nx, nz)) { rb.x = nx; rb.z = nz; }
      }
    }
  }

  damagePlayer(p, amount, now, by = null) {
    if (p.hasBuff('invuln', now)) return p.send({ t: 'hurt', d: 0, by });
    amount *= 1 - p.damageReduction(now);
    const sh = p.buffs.find((b) => b.stat === 'shield' && b.until > now && b.value > 0);
    if (sh) { // a shield soaks damage before HP does
      const soak = Math.min(sh.value, amount);
      sh.value -= soak;
      amount -= soak;
      if (sh.value <= 0) { p.buffs = p.buffs.filter((b) => b !== sh); this.sendBuffs(p, now); }
      if (amount <= 0) return p.send({ t: 'hurt', d: 0, by });
    }
    p.hp -= amount;
    p.lastDamageT = now;
    if (p.gather && p.gather.kind === 'mount') this.cancelGather(p); // a bite interrupts the donkey summon
    p.send({ t: 'hurt', d: Math.round(amount), by });
    if (p.hp <= 0) {
      p.hp = p.maxHp;
      this.toast(p, 'You were knocked out. Waking up...');
    }
  }

  // ------------------------------------------------------------ main tick
  tick() {
    const now = this.now();
    const dt = Math.min(0.25, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;

    for (const [id, s] of this.depleted) {
      if (now >= s.readyAt) {
        this.depleted.delete(id);
        this.broadcast({ t: 'node', id, qty: CFG.NODE_QTY });
      }
    }
    if (now - this.lastEnsure > 2000) {
      this.lastEnsure = now;
      this.ensureRabbits();
    }
    this.updateRabbits(dt, now);

    for (const p of this.players.values()) {
      if (now - p.lastDamageT > CFG.REGEN_COMBAT_LOCK && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * CFG.REGEN_PER_SEC * p.regenMult() * dt);
      }
      if (p.hp < p.maxHp && p.hots.length) { // heals over time
        for (const h of p.hots) p.hp = Math.min(p.maxHp, p.hp + h.perSec * dt);
      }
      this.tickMagic(p, dt, now);
      if (p.gather && now - p.gather.start > GATHER_STALE_MS) p.gather = null;
      // Donkey HP: a donkey that dropped to 0 is away for 30 s and returns healed; otherwise it heals 0 -> full in 30 s.
      if (p.mountReadyAt > now) p.mountHp = 0;
      else if (p.mountReadyAt > 0) {
        p.mountReadyAt = 0;
        p.mountHp = CFG.MOUNT_HP;
        if (p.hasMount()) this.toast(p, 'Your donkey is ready again');
      } else if (p.mountHp < CFG.MOUNT_HP) p.mountHp = Math.min(CFG.MOUNT_HP, p.mountHp + (CFG.MOUNT_HP * dt * 1000) / CFG.MOUNT_REGEN_MS);
      if (!p.mounted && p.donkey && dist(p.x, p.z, p.donkey.x, p.donkey.z) > CFG.DONKEY_LEASH) {
        p.donkey = null;
        if (Inv.unequip(p.inv, 'mount')) {
          p.recalc();
          this.sendInv(p);
        }
        this.toast(p, 'The donkey wandered off');
      }
    }
    this.sendSnapshots();
  }

  sendSnapshots() {
    if (!this.players.size) return;
    const now = this.now();
    const list = [...this.players.values()];
    for (const p of list) {
      if (p.v2) { this.sendDelta(p, list, now); continue; }
      const pl = [];
      const seen = new Set();
      for (const q of list) {
        if (q === p) continue;
        if (Math.abs(q.x - p.x) > SNAP_PLAYER_R || Math.abs(q.z - p.z) > SNAP_PLAYER_R) continue;
        seen.add(q.id);
        const e = { id: q.id, x: round2(q.x), z: round2(q.z), y: round2(q.y), r: round2(q.r), a: q.a, m: q.mounted ? 1 : 0, w: weaponIdOf(q.inv.eq) || 0 };
        if (!p.known.has(q.id)) { e.n = q.name; e.c = q.color; } // name/colour only on first sight
        pl.push(e);
      }
      p.known = seen;
      const rb = [];
      for (const r of this.rabbits.values()) {
        if (Math.abs(r.x - p.x) > SNAP_RABBIT_R || Math.abs(r.z - p.z) > SNAP_RABBIT_R) continue;
        rb.push({ i: r.id, x: round2(r.x), z: round2(r.z), d: r.dead ? 1 : 0, h: r.hp, a: r.mode === 'chase' || r.mode === 'attack' ? 1 : 0 });
      }
      p.send({ t: 's', me: p.view(now), p: pl, rb, o: list.length });
    }
  }

  // Protocol 2 ("d" messages): tell this player only what changed since the last message we sent them.
  //  - things that did not change are not repeated; far-away things update less often (the fog hides them anyway);
  //  - entries are compact arrays (see shared/wire.js);
  //  - every KEYFRAME_MS everything restarts and a full picture goes out with f:1, so the client can also drop
  //    anything it should no longer have; and a tiny heartbeat goes out at least every HEARTBEAT_MS.
  sendDelta(p, list, now) {
    let st = p.snapState;
    const key = !st || now - st.keyAt >= KEYFRAME_MS;
    if (key) st = p.snapState = { keyAt: now, sentAt: now, pl: new Map(), rb: new Map(), ra: 0, me: '', o: -1 };
    const m = { t: 'd' };
    let any = key;
    if (key) m.f = 1;

    const pl = [];
    const seenP = new Set();
    for (const q of list) {
      if (q === p) continue;
      const dx = q.x - p.x, dz = q.z - p.z;
      if (Math.abs(dx) > SNAP_PLAYER_R || Math.abs(dz) > SNAP_PLAYER_R) continue;
      seenP.add(q.id);
      const w = weaponIdOf(q.inv.eq) || 0;
      const x = round1(q.x), z = round1(q.z), y = round1(q.y), r = round2(q.r), mt = q.mounted ? 1 : 0;
      const k = x + '|' + z + '|' + y + '|' + r + '|' + q.a + '|' + mt + '|' + w;
      const prev = st.pl.get(q.id);
      if (prev && prev.k === k) continue;
      // same except for movement of someone far away: wait a little
      if (prev && prev.s === q.a + '|' + mt + '|' + w && now - prev.t < every(Math.hypot(dx, dz), PLAYER_TIERS)) continue;
      const e = [q.id, x, z, y, r, q.a, mt, w];
      if (!prev) e.push(q.name, q.color); // name/colour only on first sight
      pl.push(e);
      st.pl.set(q.id, { k, t: now, s: q.a + '|' + mt + '|' + w });
    }
    const pg = [];
    for (const id of st.pl.keys()) if (!seenP.has(id)) { pg.push(id); st.pl.delete(id); }

    const rb = [];
    const seenR = new Set();
    for (const r of this.rabbits.values()) {
      const dx = r.x - p.x, dz = r.z - p.z;
      if (Math.abs(dx) > SNAP_RABBIT_R_V2 || Math.abs(dz) > SNAP_RABBIT_R_V2) continue;
      seenR.add(r.id);
      const x = round1(r.x), z = round1(r.z), d = r.dead ? 1 : 0, a = r.mode === 'chase' || r.mode === 'attack' ? 1 : 0;
      const stat = r.hp + '|' + d + '|' + a;
      const prev = st.rb.get(r.id);
      if (prev) {
        if (prev.s === stat && prev.x === x && prev.z === z) continue;
        // health / death / alert always go out at once; plain wandering only as often as its distance deserves
        if (prev.s === stat && now - prev.t < every(Math.hypot(dx, dz), RABBIT_TIERS)) continue;
      }
      const alias = prev ? prev.al : ++st.ra;
      rb.push(encodeRabbit(alias, x, z, r.hp, d, a, prev ? undefined : r.id));
      st.rb.set(r.id, { al: alias, x, z, s: stat, t: now });
    }
    const rg = [];
    for (const [id, v] of st.rb) if (!seenR.has(id)) { rg.push(v.al); st.rb.delete(id); }

    const me = p.view(now, true);
    const mk = JSON.stringify(me);
    if (mk !== st.me) { st.me = mk; m.me = me; any = true; }
    if (list.length !== st.o) { st.o = list.length; m.o = list.length; any = true; }
    if (pl.length) { m.p = pl; any = true; }
    if (pg.length) { m.pg = pg; any = true; }
    if (rb.length) { m.rb = rb; any = true; }
    if (rg.length) { m.rg = rg; any = true; }

    if (!any && now - st.sentAt < HEARTBEAT_MS) return; // nothing new: say nothing
    st.sentAt = now;
    p.send(m);
  }
}
