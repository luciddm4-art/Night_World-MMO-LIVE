// Potions and foods. This file is the only place you need to edit to add a new one (plus a recipe in data.js RECIPES).
// It is plain data, shared by the server (which applies the effect) and the game page (which shows it).
//
// POTION  - equipped in the potion slot, drunk with the potion button. Works at once, then a cooldown.
//   id: { n: 'Name', s: 'AB' (2-letter icon), heal: 400 (HP) | healPct: 0.3 (30% of max HP), mana: 50, cd: 20000 (ms, default 20 s) }
//   Example:  minor_heal: { n: 'Minor Healing Potion', s: 'HP', heal: 400 },
//
// FOOD    - equipped in the food slot, eaten with the food button. The buff lasts 30 minutes (CFG.FOOD_MS); eating
//   another food replaces it. The buff keeps counting only while you are online.
//   id: { n: 'Name', s: 'AB', buff: { hp: 0.10, dmg: 0.10, regen: 0.5, dr: 0.10, mp: 0.2, mregen: 0.5 } }
//   hp = more max HP, dmg = more damage, regen = faster HP regen, dr = less damage taken, mp = more max mana,
//   mregen = faster mana regen. Values are fractions (0.10 = +10%). Use any mix.
//   Example:  hearty_stew: { n: 'Hearty Stew', s: 'HS', buff: { hp: 0.1 } },
//
// Movement speed is deliberately not a food buff (the game has no sprint); boots give it instead (CFG.BOOT_SPEED).
export const POTIONS = {
};

export const FOODS = {
};
