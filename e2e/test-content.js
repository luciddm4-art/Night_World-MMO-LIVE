// Test-only skills, potions and food for the browser test. The shipped game has none of these yet.
// Loaded by the server directly, and served to the page as /shared/e2e-content.js (see skills-e2e.mjs).
import { registerSkill } from '../shared/skills.js';
import { registerConsumable } from '../shared/data.js';

registerSkill('t_slash', { n: 'Slash', s: 'SL', d: 'A wide strike for double damage.', mana: 10, cd: 3000, col: 0xffd060, effects: [{ kind: 'damage', mult: 2, shape: 'cone', range: 3 }] }, { weapon: 'sword', slot: 0 });
registerSkill('t_nova', { n: 'Nova', s: 'NV', d: 'Blast everything around you.', mana: 30, cd: 6000, col: 0x6fc0ff, effects: [{ kind: 'damage', mult: 1.2, shape: 'circle', range: 4 }] }, { weapon: 'sword', slot: 1 });
registerSkill('t_bolt', { n: 'Bolt', s: 'BT', d: 'A slow, heavy bolt.', mana: 25, cd: 5000, cast: 1500, col: 0xff6a1a, effects: [{ kind: 'damage', mult: 3, shape: 'cone', range: 6, cone: 0.9 }] }, { weapon: 'sword', slot: 2 });
registerSkill('t_wall', { n: 'Ironwall', s: 'IW', d: 'A shield that soaks 300 damage.', mana: 15, cd: 12000, effects: [{ kind: 'buff', stat: 'shield', value: 300, dur: 15000 }] }, { chest: 'iron_chest' });
registerSkill('t_cry', { n: 'War Cry', s: 'WC', d: '+50% damage for 10 seconds.', mana: 20, cd: 15000, effects: [{ kind: 'buff', stat: 'dmg', value: 0.5, dur: 10000 }] }, { head: 'iron_helm' });
registerConsumable('potion', 't_heal', { n: 'Test Healing Potion', s: 'HP', heal: 400 });
registerConsumable('food', 't_stew', { n: 'Test Stew', s: 'ST', buff: { hp: 0.1, dmg: 0.1 } });
