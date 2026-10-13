// Skills. Shared by the server (which runs them) and the game page (which shows the buttons).
//
// WHERE SKILLS COME FROM
//   weapon   -> 3 skills on Q, W, E    (WEAPON_SKILLS[weaponId] = [skillForQ, skillForW, skillForE]; 'fists' = no weapon)
//   chest    -> 1 skill on R            (CHEST_SKILLS[chestItemId] = skillId)
//   helmet   -> 1 skill on D            (HELMET_SKILLS[helmItemId] = skillId)
// A skill button is empty when nothing equipped gives it a skill. Everything is empty at the moment: fill the tables
// below and add the skills to SKILLS. No other file needs to change. See docs/GAME-DATA.md.
//
// A SKILL
//   SKILLS.fireball = {
//     n: 'Fireball', s: 'FB', d: 'Hurls a ball of fire.',   // name, 2-letter button label, tooltip text
//     mana: 20, cd: 8000,                                    // mana cost and cooldown (ms)
//     cast: 1200,                                            // cast time (ms); 0/missing = instant. Walking away cancels it.
//     col: 0xff6a1a,                                         // optional effect colour
//     effects: [ ...one or more of the effects below, they all happen when the cast finishes... ],
//   };
//
// EFFECTS
//   { kind: 'damage', mult: 2.0, shape: 'cone', range: 3, cone: 0.3, max: 3 }
//        Hurts rabbits in front of you for  weapon damage x your damage bonus x mult.
//        shape 'cone' (range, cone = how wide: 0.3 wide ... 0.94 narrow) or 'circle' (range = radius around you).
//        max = at most that many targets (nearest first). Leave it out for "all".
//   { kind: 'heal', amount: 300 }  or  { kind: 'heal', pct: 0.2 }  (+ over: 5 = spread over 5 seconds)
//   { kind: 'buff', stat: 'dmg', value: 0.3, dur: 10000 }
//        stat 'dmg'    +30% damage          stat 'dr'  -30% damage taken
//        stat 'shield' absorbs 'value' damage (dur = how long the shield lasts)
//        stat 'invuln' no damage at all     stat 'mark' your next 'hits' hits do +value damage
//        optional hits: n  (for 'mark')
//   { kind: 'dash', dist: 5 }   (negative = jump backwards). Stops at walls and water.
import { weaponIdOf } from './data.js';

export const SKILL_KEYS = ['q', 'w', 'e', 'r', 'd'];
export const SKILL_STATS = ['dmg', 'dr', 'shield', 'invuln', 'mark'];
export const EFFECT_KINDS = ['damage', 'heal', 'buff', 'dash'];

export const SKILLS = {
};

export const WEAPON_SKILLS = {
  // sword: ['slash', 'whirl', 'charge'],
};
export const CHEST_SKILLS = {
  // iron_chest: 'ironwall',
};
export const HELMET_SKILLS = {
  // iron_helm: 'warcry',
};

// Which skill is on which button for this equipment. { q, w, e, r, d } with null for empty buttons.
export function skillIdsFor(eq) {
  const out = { q: null, w: null, e: null, r: null, d: null };
  if (!eq) return out;
  const ws = WEAPON_SKILLS[weaponIdOf(eq) || 'fists'] || [];
  out.q = ws[0] || null;
  out.w = ws[1] || null;
  out.e = ws[2] || null;
  out.r = (eq.chest && CHEST_SKILLS[eq.chest.id]) || null;
  out.d = (eq.head && HELMET_SKILLS[eq.head.id]) || null;
  for (const k of SKILL_KEYS) if (out[k] && !SKILLS[out[k]]) out[k] = null; // a name with no definition is ignored
  return out;
}

// Adds a skill at run time (tests use this; the tables above are the normal way).
export function registerSkill(id, def, where) {
  SKILLS[id] = def;
  if (where) {
    if (where.weapon) (WEAPON_SKILLS[where.weapon] ||= [])[where.slot || 0] = id;
    if (where.chest) CHEST_SKILLS[where.chest] = id;
    if (where.head) HELMET_SKILLS[where.head] = id;
  }
}
