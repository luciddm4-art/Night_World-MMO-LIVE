# Adding skills, potions and food

The game has the *frameworks* for skills, mana, potions and food, but ships **no content** in them yet.
You add content by editing plain data tables — no other code needs to change. After editing, run
`npm run stamp` (refreshes the file versions in `index.html`) and `npm test`.

## The rules in one place

| Thing | Rule |
|---|---|
| Mana | Everyone has 100 (`CFG.MANA_BASE`), regenerates 2 per second. Every skill costs mana. |
| Skills | The **weapon** gives 3 skills (buttons **Q, W, E**), the **chest** gives **R**, the **helmet** gives **D**. |
| Cooldowns | Each skill has its own cooldown; swapping gear does not reset it. There is also a 0.6 s pause between any two skills. |
| Cast time | A skill with `cast` takes that long; walking away, swapping gear, or mounting cancels it and costs nothing. Mana is spent when the cast finishes. You cannot attack or gather while casting. |
| Riding | Skills cannot be used on the donkey. |
| Potion | One slot. Tap to drink: instant effect, then a cooldown (20 s unless the potion says otherwise). Refused when it would do nothing (full health), so none are wasted. |
| Food | One slot. Tap to eat: a **30 minute** buff (`CFG.FOOD_MS`). Eating another food replaces the buff. The timer only runs while you are online and is saved with the character. |
| Boots | Every pair of boots gives **+40% walking speed** (`CFG.BOOT_SPEED`), on foot only (riding is unchanged). It is not tied to a particular item, so any new boots added to `SLOT_ACCEPTS.foot` get it. |

Phone buttons: Q W E R D are the five round buttons above the Attack button, the potion and food buttons
sit above the joystick (landscape: beside it). Keyboard: `1`–`5` = Q W E R D, `Z` potion, `X` food, `M` map.

## Add a skill — `shared/skills.js`

1. Define it in `SKILLS`.
2. Say where it comes from: `WEAPON_SKILLS`, `CHEST_SKILLS` or `HELMET_SKILLS`.

```js
export const SKILLS = {
  fireball: {
    n: 'Fireball', s: 'FB', d: 'Hurls a ball of fire.',   // name, 2-letter button label, tooltip text
    mana: 20, cd: 8000, cast: 1200,                        // mana, cooldown ms, cast time ms (optional)
    col: 0xff6a1a,                                         // effect colour (optional)
    effects: [{ kind: 'damage', mult: 2.5, shape: 'cone', range: 7, cone: 0.9, max: 1 }],
  },
};
export const WEAPON_SKILLS = { fire_staff: ['fireball', null, null] };   // Q, W, E (use null to leave one empty)
export const CHEST_SKILLS = { iron_chest: 'ironwall' };                  // R
export const HELMET_SKILLS = { iron_helm: 'warcry' };                    // D
```

`'fists'` is the key for "no weapon equipped". A skill can have several effects; they all happen when it fires.

| Effect | Fields |
|---|---|
| `damage` | `mult` (× weapon damage × your damage bonus), `shape` `'cone'` or `'circle'`, `range`, `cone` (0.3 wide … 0.94 narrow), `max` targets (nearest first) |
| `heal` | `amount` (HP) or `pct` (of max HP); add `over: 5` to spread it over 5 seconds |
| `buff` | `stat` + `value` + `dur` (ms): `dmg` (+damage), `dr` (less damage taken), `shield` (absorbs `value` damage), `invuln` (no damage), `mark` (your next `hits` hits do `+value` damage) |
| `dash` | `dist` (negative = backwards). Stops at walls and trees. |

## Add a potion or food — `shared/consumables.js`

```js
export const POTIONS = {
  minor_heal: { n: 'Minor Healing Potion', s: 'HP', heal: 400 },            // or healPct: 0.3, mana: 50, cd: 20000
};
export const FOODS = {
  hearty_stew: { n: 'Hearty Stew', s: 'HS', buff: { hp: 0.1, dmg: 0.05 } }, // fractions: 0.1 = +10%
};
```

Food buff stats: `hp` (max HP), `dmg`, `regen` (HP regeneration), `dr` (damage taken), `mp` (max mana), `mregen` (mana regeneration).
There is deliberately no speed buff (boots are the only speed bonus).

Then make the item obtainable: add a recipe to `RECIPES` in `shared/data.js` (the Alchemy and Kitchen stations are
planned; until then use the admin command below to test).

## Try things out: `/give`

Accounts listed in the server's `ADMINS` setting can type `/give <item id> [amount]` in chat to put an item in
their own bag (`/give hearty_stew 5`). Then tap it in the inventory to equip it.

## Tests

`test/skills.test.js` injects its own skills/potions/foods (so it keeps working while the real tables are empty) and
shows how each effect behaves. `e2e/skills-e2e.mjs` is the phone-size browser check; it serves the test content from
`e2e/test-content.js`.
