// Game data shared by the server (authoritative) and the browser client (display).
// Plain ES module: no Node or browser APIs in here.

export const CFG = {
  CS: 32, // chunk size (world units)
  SEG: 16, // terrain segments per chunk (client only)
  VR: 4, // view radius in chunks
  RESPAWN_MS: 10000, // depleted node / tree respawn
  PARTIAL_REFILL_MS: 120000, // partly-gathered node refills after this long
  NODE_QTY: 3,
  GATHER_MS: 2000,
  RABBIT_HP: 50,
  RABBIT_DMG: 25,
  RABBIT_ATK_MS: 1500,
  RABBIT_RESPAWN_MS: 30000,
  CORPSE_MS: 60000,
  PLAYER_BASE_HP: 1200,
  PLAYER_BASE_DMG: 30,
  PLAYER_BASE_ATK_MS: 400,
  MOUNT_SPEED: 1.15,
  MOUNT_CAST_MS: 1500,
  DONKEY_LEASH: 18,
  REGEN_PER_SEC: 0.01,
  REGEN_COMBAT_LOCK: 5000,
  INV_SLOTS: 64,
  STACK_MAX: 99,
  MAX_SPEED: 16, // sprint speed, units / second
};

export const SEED_LIMIT = 1e9;
export function normalizeSeed(v) {
  v = Math.trunc(Number(v));
  if (!Number.isFinite(v)) return 7;
  return Math.max(-SEED_LIMIT, Math.min(SEED_LIMIT, v));
}

export const ITEMS = {
  wood: { n: 'Wood', s: 'W' }, cotton: { n: 'Cotton', s: 'C' }, ore: { n: 'Ore', s: 'O' }, hide: { n: 'Hide', s: 'H' },
  plank: { n: 'Plank', s: 'P' }, cloth: { n: 'Cloth', s: 'L' }, iron: { n: 'Iron Bar', s: 'I' }, leather: { n: 'Leather', s: 'E' },
  sword: { n: 'Sword', s: 'SW' }, fire_staff: { n: 'Fire Staff', s: 'FS' }, bow: { n: 'Bow', s: 'BW' },
  torch: { n: 'Torch', s: 'TC' }, spell_book: { n: 'Spell Book', s: 'SB' },
  iron_helm: { n: 'Iron Helmet', s: 'IH' }, iron_chest: { n: 'Iron Armor', s: 'IA' }, iron_boots: { n: 'Iron Boots', s: 'IB' },
  cloth_cowl: { n: 'Cloth Cowl', s: 'CC' }, cloth_robe: { n: 'Cloth Robe', s: 'CR' }, cloth_sandals: { n: 'Cloth Sandals', s: 'CS' },
  leather_hood: { n: 'Leather Hood', s: 'LH' }, leather_jacket: { n: 'Leather Jacket', s: 'LJ' }, leather_boots: { n: 'Leather Shoes', s: 'LB' },
  donkey: { n: 'Donkey', s: 'DK' },
};

// Every item is Tier 1 for now. Later worlds can add higher tiers (T2 resources -> T2 refined -> T2 gear).
for (const k of Object.keys(ITEMS)) ITEMS[k].tier = 1;

// Material families. A crafting station handles exactly one family: it refines that family's raw
// resource and crafts that family's gear (see STATIONS below and RECIPES).
//   wood: Wood (trees) -> Plank          cloth: Cotton (cotton nodes) -> Cloth
//   iron: Ore (ore nodes) -> Iron Bar    leather: Hide (rabbits) -> Leather
export const FAMILIES = {
  wood: { raw: 'wood', refined: 'plank' },
  cloth: { raw: 'cotton', refined: 'cloth' },
  iron: { raw: 'ore', refined: 'iron' },
  leather: { raw: 'hide', refined: 'leather' },
};

export const EQUIP_SLOTS = ['head', 'chest', 'foot', 'main', 'off', 'mount'];
export const SLOT_LABEL = { head: 'HD', chest: 'CH', foot: 'FT', main: 'MH', off: 'OH', mount: 'MT' };
export const SLOT_ACCEPTS = {
  head: ['iron_helm', 'cloth_cowl', 'leather_hood'],
  chest: ['iron_chest', 'cloth_robe', 'leather_jacket'],
  foot: ['iron_boots', 'cloth_sandals', 'leather_boots'],
  main: ['sword', 'fire_staff', 'bow', 'torch'],
  off: ['spell_book', 'torch'],
  mount: ['donkey'],
};
// Slots that must all be filled to earn the donkey.
export const REWARD_SLOTS = ['head', 'chest', 'foot', 'main', 'off'];

// Gloves were removed from the game. Old saves get these refunded as refined materials.
export const LEGACY_REFUND = {
  iron_gauntlets: { id: 'iron', n: 3 },
  cloth_gloves: { id: 'cloth', n: 3 },
  leather_gloves: { id: 'leather', n: 3 },
};

// Iron = tank, Cloth = damage, Leather = damage + speed.
export const ARMOR_STATS = {
  iron_helm: { hp: 0.03 }, iron_chest: { hp: 0.5, def: 0.2 }, iron_boots: { hp: 0.03 },
  cloth_cowl: { dmg: 0.05 }, cloth_robe: { dmg: 0.5 }, cloth_sandals: { dmg: 0.05 },
  leather_hood: { dmg: 0.03, haste: 0.03 }, leather_jacket: { dmg: 0.3, haste: 0.05 }, leather_boots: { dmg: 0.03, haste: 0.03 },
};

// How each main-hand item attacks. The server applies these; the client uses them for effects and auto-aim.
//   reach: distance in world units      dmg: base damage (before gear)      cd: cooldown in ms
//   cone: how well you must be facing the target (cosine; 0.3 = wide arc, 0.94 = narrow aim)
//   hits: 'all' = everything in the cone, 'one' = only the nearest target in the cone
//   splash/splashR: extra damage to others near the target
export const FISTS = { id: 'fists', n: 'Fists', reach: 2.0, dmg: 20, cd: 500, cone: 0.3, hits: 'all', splash: 0, splashR: 0 };
export const WEAPONS = {
  sword: { id: 'sword', n: 'Sword', reach: 2.6, dmg: 36, cd: 450, cone: 0.3, hits: 'all', splash: 0, splashR: 0 },
  bow: { id: 'bow', n: 'Bow', reach: 9, dmg: 24, cd: 800, cone: 0.94, hits: 'one', splash: 0, splashR: 0 },
  fire_staff: { id: 'fire_staff', n: 'Fire Staff', reach: 5.5, dmg: 20, cd: 900, cone: 0.82, hits: 'one', splash: 12, splashR: 2.5 },
};
export const weaponIdOf = (eq) => (eq && eq.main && WEAPONS[eq.main.id] ? eq.main.id : null);
export const weaponOf = (eq) => WEAPONS[weaponIdOf(eq)] || FISTS;

// Recipes. Every recipe belongs to exactly one station, and each station crafts one material family.
export const RECIPES = [
  // Refinery (wood)
  { id: 'r_plank', cat: 'Refine', name: 'Plank', out: 'plank', n: 1, cost: { wood: 3 }, station: 'refinery' },
  { id: 'c_torch', cat: 'Tools', name: 'Torch x3', out: 'torch', n: 3, cost: { wood: 2, cloth: 1 }, station: 'refinery' },
  // Loom (cloth)
  { id: 'r_cloth', cat: 'Refine', name: 'Cloth', out: 'cloth', n: 1, cost: { cotton: 3 }, station: 'loom' },
  { id: 'c_ccowl', cat: 'Armor', name: 'Cloth Cowl', out: 'cloth_cowl', n: 1, cost: { cloth: 3 }, station: 'loom' },
  { id: 'c_crobe', cat: 'Armor', name: 'Cloth Robe', out: 'cloth_robe', n: 1, cost: { cloth: 5 }, station: 'loom' },
  { id: 'c_csand', cat: 'Armor', name: 'Cloth Sandals', out: 'cloth_sandals', n: 1, cost: { cloth: 3 }, station: 'loom' },
  { id: 'c_staff', cat: 'Weapons', name: 'Fire Staff', out: 'fire_staff', n: 1, cost: { plank: 3, cloth: 3 }, station: 'loom' },
  { id: 'c_book', cat: 'Tools', name: 'Spell Book', out: 'spell_book', n: 1, cost: { cloth: 3, leather: 2 }, station: 'loom' },
  // Forge (iron)
  { id: 'r_iron', cat: 'Refine', name: 'Iron Bar', out: 'iron', n: 1, cost: { ore: 3 }, station: 'forge' },
  { id: 'c_ihelm', cat: 'Armor', name: 'Iron Helmet', out: 'iron_helm', n: 1, cost: { iron: 3 }, station: 'forge' },
  { id: 'c_ichest', cat: 'Armor', name: 'Iron Armor', out: 'iron_chest', n: 1, cost: { iron: 5 }, station: 'forge' },
  { id: 'c_iboot', cat: 'Armor', name: 'Iron Boots', out: 'iron_boots', n: 1, cost: { iron: 3 }, station: 'forge' },
  { id: 'c_sword', cat: 'Weapons', name: 'Sword', out: 'sword', n: 1, cost: { plank: 3, iron: 3 }, station: 'forge' },
  // Tannery (leather)
  { id: 'r_leather', cat: 'Refine', name: 'Leather', out: 'leather', n: 1, cost: { hide: 3 }, station: 'tannery' },
  { id: 'c_lhood', cat: 'Armor', name: 'Leather Hood', out: 'leather_hood', n: 1, cost: { leather: 3 }, station: 'tannery' },
  { id: 'c_ljack', cat: 'Armor', name: 'Leather Jacket', out: 'leather_jacket', n: 1, cost: { leather: 5 }, station: 'tannery' },
  { id: 'c_lboot', cat: 'Armor', name: 'Leather Shoes', out: 'leather_boots', n: 1, cost: { leather: 3 }, station: 'tannery' },
  { id: 'c_bow', cat: 'Weapons', name: 'Bow', out: 'bow', n: 1, cost: { plank: 4, leather: 2 }, station: 'tannery' },
];

export const WORLDS = [
  { name: 'Ashen', seed: 42, tag: 'scorched & grey' },
  { name: 'Frost', seed: 100, tag: 'cold pale stone' },
  { name: 'Ember', seed: 999, tag: 'red earth & dust' },
  { name: 'Hollow', seed: 2025, tag: 'silent dark woods' },
];

// Spawn hall layout. Crafting stations stand at z = STATION_Z.
export const STATIONS = [
  { k: 'refinery', name: 'Refinery', fam: 'wood', x: -11, col: 0xb8872e, bg: '#6b4a12' },
  { k: 'loom', name: 'Loom', fam: 'cloth', x: -3.7, col: 0x9fb4d8, bg: '#2c456f' },
  { k: 'forge', name: 'Forge', fam: 'iron', x: 3.7, col: 0xc0562a, bg: '#7a2f14' },
  { k: 'tannery', name: 'Tannery', fam: 'leather', x: 11, col: 0x8a5a3a, bg: '#4a2a1a' },
];
export const STATION_Z = -4.6;
export const STATION_RANGE = 2.4;
export const PORTAL = { x: 0, z: 8, r: 2.6 };
export const SPAWN = { x: 0, z: -1.5, spread: 6 };

export const CHAT_MAX_LEN = 120;
export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
