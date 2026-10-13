# Night World Online

A small browser 3D MMO: gather wood, cotton and ore, hunt rabbits, craft gear at the spawn hall, earn a donkey, and portal into new procedurally generated worlds — together with other players.

- **Client:** plain ES modules + [Three.js r128](vendor/three.min.js) (vendored, no build step). Touch and keyboard/mouse.
- **Server:** Node 18+ and one dependency (`ws`). Authoritative game rules, accounts, chat, saves.

## Play

| | |
|---|---|
| Live (client) | https://luciddm4-art.github.io/Night_World-MMO-LIVE/ |
| Live (server) | https://night-world-mmo-live.onrender.com (also serves the game itself) |

**Controls** — move: stick / `WASD` · look: drag · attack: `Space` / Attack button · use/gather/craft: `E` / Use button · inventory: `I` · open the nearest crafting station: `C` · chat: `Enter` · `/logout` in chat forgets your saved login on this device.

**Connection** — a ping readout (green/yellow/red) sits next to the online count. A short drop shows a small “Reconnecting…” banner and the game keeps rendering; the client retries quickly with back-off, and a silent dead connection (common on phones after switching networks) is detected within ~9 s. Logged-in players come back where they were; guests start a fresh character.

**Phone extras** — bigger tap targets, and vibration on hits. **Desktop extras** — left-click the world (without dragging) to attack, hover inventory/equipment slots for stats and recipes. **⚙ Settings** (top right): brightness, sound, vibration, auto-face. They are saved on this device only (`localStorage.nwo_settings`).

**Game feel** — floating damage numbers, hit flash and knockback, rabbit HP bars and a `!` when one is chasing you, screen shake + red vignette when bitten, wood chips / ore sparks while gathering, trees that shake and fall, loot that flies into your inventory, and synthesised sound effects (Web Audio — no audio files). Audio starts after your first tap or key press, as browsers require.

**The Big Town** — you spawn on the plaza of a walled 120x120 town: stone walls with a gate in the middle of each side, corner towers, a fountain, 12 houses and the Crafting Hall (with the four stations) in the middle. The town is a safe zone: no trees, resource nodes or rabbits inside the walls, and rabbits stop chasing you at the gates. The **portal is far away, due south at z = 4820** (the town's main gate faces north). There is no sprint: you walk at 6 units/s and the donkey goes 10 units/s, so the trip is about **8 minutes by donkey and 13 on foot**. The portal shows on the minimap (a blue diamond, pinned to the edge of the map while it is far away); there is no compass arrow. The portal sits in a flat clearing with four standing stones.

**The donkey** — summoning it is a 5 second cast. While you ride, rabbit bites hit the **donkey (200 HP, 25 per bite)** instead of you. At 0 HP you fall off, the donkey is gone for 30 s and comes back at full health (then you need the 5 s summon again). It also heals from 0 to full in 30 s while it is fine. The HP bar sits under your own. Old characters saved inside a wall or house are moved to the plaza when they log in.

**Crafting & weapons** — there is no portable crafting: you craft by standing at one of the four stations in the spawn hall (`E` or `C` opens it). Each station handles one material family, end to end (everything is Tier 1 for now):

| Station | Refines | Crafts |
|---|---|---|
| Refinery | 3 Wood → Plank | Torch |
| Loom | 3 Cotton → Cloth | Cloth Cowl / Robe / Sandals (damage), Fire Staff, Spell Book |
| Forge | 3 Ore → Iron Bar | Iron Helmet / Armor / Boots (tank), Sword |
| Tannery | 3 Hide (from rabbit corpses) → Leather | Leather Hood / Jacket / Shoes (damage + speed), Bow |

Weapons go in the main hand and change how you fight (damage is multiplied by your gear; speed is improved by Leather). Everyone sees what you are holding.

| Weapon | Reach | Damage | Speed | Behaviour |
|---|---|---|---|---|
| Fists (or a Torch) | 2.0 | 20 | 0.50 s | |
| Sword | 2.6 | 36 | 0.45 s | wide arc, hits everything in front |
| Bow | 9 | 24 | 0.80 s | narrow aim, arrow hits the nearest rabbit in line |
| Fire Staff | 5.5 | 20 (+12 splash) | 0.90 s | fireball, also scorches rabbits within 2.5 of the target |

The donkey reward needs head, chest, feet, main hand and off hand filled. Gloves were removed: old gloves are refunded as 3 refined materials when you next log in. Items carry a `tier` field so higher-tier worlds can add their own resources later.

**Accounts** — register with a name + password to keep your character (inventory, gear, position per world), or play as a guest (not saved).

## Run it locally

```bash
npm install
npm start            # http://localhost:8080  — serves the game and the server
npm test             # unit + integration tests
npm run stamp        # after editing src/ or shared/ or css/: refresh script versions in index.html (see Cache-busting)
```

Environment variables:

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP/WebSocket port |
| `DATABASE_URL` | *(unset)* | Postgres connection string. **Set this in production**: accounts and saves then survive redeploys. Unset = JSON file (local play only). |
| `DATA_DIR` | `./data` | where `accounts.json` is written when there is no database (**gitignored**); also the fallback if the database is unreachable |
| `ALLOWED_ORIGINS` | GitHub Pages site | extra comma-separated origins allowed to open a WebSocket (`*` = any). Same-origin and `localhost` are always allowed. |

### Staying awake on Render's free plan

Free web services sleep after ~15 minutes with no incoming requests (the next visitor then waits 30-60 s). Three layers keep it up:

1. **Self-ping (built in, `server/keepalive.js`)**: while the server runs it requests its own public `/health` every 4 minutes. Render sets `RENDER_EXTERNAL_URL` itself, so nothing to configure. Set `KEEPALIVE=off` to disable, or `KEEPALIVE_URL` to ping another address.
2. **GitHub Action (`.github/workflows/keepalive.yml`)**: pings every 5 minutes from outside, which also *wakes* the server if it did go to sleep. GitHub schedules are best-effort and pause after 60 days without repo activity.
3. **Optional external pinger**: a free monitor such as UptimeRobot or cron-job.org hitting `https://night-world-mmo-live.onrender.com/health` every 5 minutes is the most dependable backup.

Free instances get 750 hours per month per account: one always-on service (about 744 h) fits, a second always-on free service would not. For a truly always-on server with no cold starts, use Render's paid Starter plan.

## How it works

```
index.html, css/        UI shell
src/                    client (ES modules): rendering, input, UI, net
shared/                 used by BOTH sides: items/recipes/constants, world generation, inventory rules
server/                 room.js (game rules) · index.js (sockets/auth) · store.js · static.js
test/                   node:test suites
```

### The server decides, the client displays

| Thing | Who decides |
|---|---|
| Inventory, equipment, stats, HP | server (client only renders what it is sent) |
| Gathering (range, 2 s timer, node quantity, respawn, bag space) | server |
| Crafting (recipe, materials, being at that recipe's station, bag space) | server |
| Rabbits (spawn, wander, chase, bite, death, respawn) and damage; weapon reach, aim cone, splash and cooldown | server |
| Attack cooldown, range, damage | server |
| Mount / donkey rules | server |
| Resource nodes are shared | one state per world, broadcast to everyone |
| Movement | client moves, server **bounds** it with a speed budget and snaps cheaters back |

The world itself (terrain, tree/ore/cotton/rabbit positions) is generated from the seed by `shared/world.js`, identical on server and client — so only tiny messages (“tree X now has 2 left”) cross the wire.

### Protocol (JSON over WebSocket)

Client → server: `auth{mode: guest|register|login|token}`, `p{x,z,r}`, `atk{r}`, `gather{kind,id}`, `gdone`, `gcancel`, `craft{id}`, `equip{i}`, `unequip{slot}`, `mount`, `dismount`, `chat{m}`, `ping{n}`.
Server → client: `welcome`, `auth_err`, `s` (10 Hz snapshot: you, nearby players, nearby rabbits), `inv`, `node`, `cast`, `fail`, `toast`, `pos` (correction), `chat`, `kick`, plus three feedback events: `hit {i,d,h,k,by}` (a rabbit was hit; sent to players within 60 units), `pong {n}` (reply to the client's `ping {n}` latency probe), `hurt {d,by}` (you were bitten) and `gain {item,n,src}` (you received an item; `src` is `gather`, `loot`, `craft` or `reward`). Rabbit entries in `s` carry `a:1` while chasing or attacking. These only drive visuals and sound; the server remains the only authority on damage and items.

### Security model

- Passwords: `scrypt` with per-user salt; never stored or logged in clear. Login tokens are random, stored **hashed**, expire after 30 days. The browser keeps only the token.
- Rate limits: per-connection message bucket, failed-login throttle per IP, registrations per IP, chat flood limit, 4 KB max frame, max 40 players/world, max 16 worlds.
- WebSocket `Origin` allow-list; static server only exposes `index.html`, `css/ src/ shared/ vendor/`.
- Chat is plain text, control/bidi characters stripped, rendered with `textContent`.
- **Collision:** the client moves itself, but the server walks every position packet along its path and stops it at the spawn hall's walls and at standing trees (`shared/collision.js`, with a small tolerance so lag never rubber-bands honest players). A player trapped inside something (a tree regrew on them) is never frozen.

## Deploying

**Server (Render, free tier):** easiest is the included `render.yaml` Blueprint (Render dashboard → New → Blueprint → this repo): it sets build `npm ci --omit=dev`, start `npm start`, health check `/health`, Node 20, and asks you for `DATABASE_URL`. Or create a Web Service by hand with the same settings. Keep the service name `night-world-mmo-live`, because `src/config.js` and the keep-alive workflow use that URL. The service also serves the game, so `https://<service>.onrender.com/` works on its own.

**Client (GitHub Pages):** serve the repo root. The client talks to the hosted Render server when opened from `*.github.io` (see `src/config.js`).

### Persistence (Postgres)

Render's free disk is **ephemeral**: it is wiped on every redeploy and restart. So production should use a database:

1. Create a free Postgres at [neon.tech](https://neon.tech) (the free tier does not expire) and copy its connection string.
2. In Render → your service → **Environment**, add `DATABASE_URL` = that string, save (Render redeploys).
3. Open `https://<service>.onrender.com/health`. It should say `"storage":"postgres","storageOk":true`.

Never commit the connection string or paste it in chat or issues; it lives only in Render's environment settings.

How it works: the server keeps accounts in memory and writes changes through `server/store.js` to two tables (`nwo_accounts`, `nwo_tokens`, created automatically on first start). Writes are batched, unchanged characters are not rewritten (so the database can sleep while nobody plays), failed writes are retried, and a final flush runs on shutdown (SIGTERM). If the database cannot be reached at start-up the server logs it loudly, falls back to the file store and reports `"storage":"file","storageOk":false` on `/health`, so the game stays playable.

Without `DATABASE_URL` the JSON file in `DATA_DIR` is used. Accounts created on the file store are not migrated to the database.

### Cache-busting

GitHub Pages lets browsers keep files for ~10 minutes, so after a deploy some players could run old scripts. `npm run stamp` writes an **import map** into `index.html` that gives each script a version taken from its contents (`./src/fx.js` → `./src/fx.js?v=1a2b3c4d`); unchanged files stay cached, changed files are fetched fresh. Run it after editing anything in `src/`, `shared/` or `css/` and commit `index.html`: a test (`test/stamp.test.js`) fails in CI if you forget. Browsers without import-map support still work, they just skip the versioning.

### Cold starts

Render's free tier sleeps after ~15 minutes without traffic and takes ~30–60 s to wake. Two mitigations are included:

1. The client shows a **“Waking the server…”** screen with a live timer and retries automatically (it pokes `/health` first).
2. `.github/workflows/keepalive.yml` pings `/health` every 10 minutes. It runs only from the default branch, GitHub pauses scheduled workflows after 60 days without repo activity, and a service that never sleeps uses ~730 of Render's 750 free instance-hours/month (fine for one service). Delete the workflow if you don't want that.

## Tests

`npm test` runs ~75 tests: inventory rules, deterministic world generation, every server game rule with a fake clock (gather, craft, equip, combat, rabbits, mounts, chat, speed limit), and real-WebSocket integration tests (register/login/token, throttling, persistence across restart on both the file store and Postgres, origin check, malformed input, static-file safety). Postgres is tested with [PGlite](https://pglite.dev) (real Postgres in WebAssembly), so no database is needed to run the tests. Server-side collision, the ping probe and the `index.html` version stamp are covered too.

`e2e/e2e.mjs` is a browser test (real Chromium via Playwright, not part of `npm test`): login, gathering, combat feedback, settings, versioned modules, the ping readout and a forced disconnect + reconnect.

## Roadmap ideas

Player-vs-player and parties · more resources/recipes · upgrading Three.js past r128 (needs a lighting/colour pass).

## Loading screen

The page opens straight into a pixel-art night scene (moon, stars, the walled town, the glowing portal) drawn by
`src/bootscreen.js`. The first paint comes from plain HTML/CSS in `index.html`, so it shows before any script loads.
It covers the cold start of the sleeping free server: a progress bar (Server / Connection / World), rotating tips and
a small "tap the fireflies" game. It fades out when the socket opens (never sooner than 1.3 s, so a fast start still
shows the scene).

## Install as an app (PWA)

The game is an installable web app: `manifest.webmanifest` (name, icons, standalone full-screen), `sw.js` (service
worker) and `src/pwa.js` (registers the worker and shows the install button on the login card).

- **Android Chrome:** open the game, tap **Install as an app** on the login card (or ⋮ menu → *Install app*). It gets a
  home-screen icon and opens full screen with no browser bar.
- **iPhone Safari:** Share → *Add to Home Screen* (the login card shows this hint).
- The service worker only speeds up the second start (saved scripts) and keeps the page available if the network is
  slow. The game itself still needs the server, and the worker never touches the websocket or `/health`.
- Updates: the page is always fetched fresh first, and scripts have hashed URLs (`npm run stamp`), so a deploy reaches
  installed apps on the next open. If you change `sw.js` itself, bump `CACHE` in it.

## Checks that run on every pull request

- **CI** (`npm test`): ~110 unit and server tests, plus an advisory `npm audit` (never blocks a merge).
- **Browser test** (`.github/workflows/e2e.yml`): the real game in headless Chromium — login, move, gather, craft,
  fight, chat, reconnect, module loading. Screenshots are attached to the run if it fails. Run it yourself with
  `npm i --no-save playwright && npx playwright install chromium && node e2e/e2e.mjs`.
- **Dependabot** opens a weekly PR for outdated npm packages and GitHub Actions.

## Abuse protection (server limits)

| Limit | Default | Setting |
|---|---|---|
| Worlds that can be opened | the start world (7) + the four Travel Planner worlds (42, 100, 999, 2025) | `WORLD_SEEDS=7,42` |
| Players on the whole server | 40 (free plan; raise on a paid instance) | `MAX_PLAYERS=150` |
| Players per world | 40 | |
| Sockets at once from one network | 12 | |
| Messages per second per socket | ~50 sustained (bursts of 80) | |
| Message size | 4 KB | |
| New accounts per network | 5 per hour | |
| Failed logins per network | 8 per 10 minutes | |

`test/abuse.test.js` throws thousands of garbage messages at a player and the server on every run.

## Moderation

- **Chat filter:** bad words are replaced with `****` on the server (disguises like `f.u.c.k` or `sh1t` too; whole words only
  for short ones, so "Scunthorpe" is fine). Add your own with `CHAT_BLOCKLIST=word1,word2`.
- **Names:** reserved names (admin, moderator, server, staff, `GuestNN` …) and rude names can't be registered.
- **Players:** type `/report <name> <what happened>` in chat. It is logged as `REPORT …` in the Render logs.
- **Admins:** set the Render environment variable `ADMINS=YourAccountName` (comma-separated, registered accounts only),
  then, logged in as that account, type in chat:

| Command | Does |
|---|---|
| `/reports` | shows the last 5 reports |
| `/kick <name>` | removes a player (guests too) |
| `/mute <name> [minutes]` | blocks their chat (default 10, max 1440) |
| `/unmute <name>` | |
| `/ban <name> [reason]` | bans an account: kicked now, refused at login (saved in the database) |
| `/unban <name>` | |
| `/say <text>` | announcement to every world, shown as "Server" |

Admins can't kick, mute or ban each other. Every admin action is logged as `ADMIN …`. Non-admins who type an
admin command just see "Unknown command".

## Logs, health and backups

- **Render logs** now show: `stats players=… worlds=… tick avg=…ms max=…ms rss=…MB storage=…` every 5 minutes,
  `CLIENT-ERROR [build …] message` whenever a player's browser hits a script error, `REPORT` / `ADMIN` lines for
  moderation, and `UNCAUGHT EXCEPTION` / `UNHANDLED REJECTION` if the server itself has a bug.
- `/health` adds `tickMs {avg, max}` (how long one 100 ms server tick takes) and `maxPlayers`.
- **Backups:** Neon's free plan only restores the last 6 hours, so there is a nightly encrypted export, plus
  `tools/export.mjs` / `tools/import.mjs`. Setup and restore steps: [docs/BACKUP.md](docs/BACKUP.md).

## Load test

`npm run loadtest -- --players 40 --seconds 20 [--worlds 2] [--throttle 0.1]` starts the real server as its own process and
connects simulated players that walk, fight and chat, then prints tick time, latency, bandwidth, CPU and memory.
`--throttle 0.1` squeezes the server into 10 % of a core to imitate Render's free tier. Results and what they mean:
[docs/HOSTING.md](docs/HOSTING.md).
