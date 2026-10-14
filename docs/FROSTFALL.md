# Frostfall (Tier 2)

Seed **5001**. Reached from the Travel Planner in the start world; its own portal leads back to Night World.

| | |
|---|---|
| Size | 5,000 x 5,000 units (x and z from -2500 to 2500) |
| Edge | a mountain ring that starts rising at 2400 from the centre (measured as max(abs x, abs z)) and an invisible wall at 2476 |
| Village | the level clearing on the south edge at (0, 2300). Spawn (0, 2338), portal (0, 2284). Nothing grows or spawns within 80 units |
| Terrain | `shared/frostfall.js`: hills, terraced cliffs in the glacier biome, frozen lakes (anything below 0 is flat ice), frozen rivers, the village clearing, then the mountain ring |
| Biomes | tundra (open), pine forest (dense trees), glacier highlands (cliffs, few trees) |

All the numbers are in `shared/realm.js` (`FROST`). `realmOf(seed)` says which tier a world is: spawn point, portal,
safe zone and what is solid all come from it, on the server and in the browser.

Scenery: `src/village.js` (plaza, lamp posts, sign, portal). Not built yet: crafting stations, Market, Bank, ruins and
camps, bridges, day and night. Crafting stations only exist in the start world's Crafting Hall for now.
