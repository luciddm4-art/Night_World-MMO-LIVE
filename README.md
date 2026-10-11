# Night World Online

A small browser 3D MMO: gather wood, cotton and ore, hunt rabbits, craft gear at the spawn hall, earn a donkey, and portal into new procedurally generated worlds — together with other players.

- **Client:** plain ES modules + [Three.js r128](vendor/three.min.js) (vendored, no build step). Touch and keyboard/mouse.
- **Server:** Node 18+ and one dependency (`ws`). Authoritative game rules, accounts, chat, saves.

## Play

| | |
|---|---|
| Live (client) | https://luciddm4-art.github.io/Night_World-MMO-LIVE/ |
| Live (server) | https://night-world-mmo-live.onrender.com (also serves the game itself) |

**Controls** — move: stick / `WASD` · look: drag · sprint: `Shift` · attack: `Space` / Attack button · use/gather/craft: `E` / Use button · inventory: `I` · portable crafting: `C` · chat: `Enter` · `/logout` in chat forgets your saved login on this device.

**Phone extras** — a **Sprint** toggle button (above Attack), bigger tap targets, and vibration on hits. **Desktop extras** — left-click the world (without dragging) to attack, hover inventory/equipment slots for stats and recipes. **⚙ Settings** (top right): brightness, sound, vibration, auto-face. They are saved on this device only (`localStorage.nwo_settings`).

**Game feel** — floating damage numbers, hit flash and knockback, rabbit HP bars and a `!` when one is chasing you, screen shake + red vignette when bitten, wood chips / ore sparks while gathering, trees that shake and fall, loot that flies into your inventory, and synthesised sound effects (Web Audio — no audio files). Audio starts after your first tap or key press, as browsers require.

**Accounts** — register with a name + password to keep your character (inventory, gear, position per world), or play as a guest (not saved).

## Run it locally

```bash
npm install
npm start            # http://localhost:8080  — serves the game and the server
npm test             # unit + integration tests
```

Environment variables:

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP/WebSocket port |
| `DATA_DIR` | `./data` | where `accounts.json` is written (**gitignored**) |
| `ALLOWED_ORIGINS` | GitHub Pages site | extra comma-separated origins allowed to open a WebSocket (`*` = any). Same-origin and `localhost` are always allowed. |

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
| Crafting (recipe, materials, station proximity, bag space) | server |
| Rabbits (spawn, wander, chase, bite, death, respawn) and damage | server |
| Attack cooldown, range, damage | server |
| Mount / donkey rules | server |
| Resource nodes are shared | one state per world, broadcast to everyone |
| Movement | client moves, server **bounds** it with a speed budget and snaps cheaters back |

The world itself (terrain, tree/ore/cotton/rabbit positions) is generated from the seed by `shared/world.js`, identical on server and client — so only tiny messages (“tree X now has 2 left”) cross the wire.

### Protocol (JSON over WebSocket)

Client → server: `auth{mode: guest|register|login|token}`, `p{x,z,r}`, `atk{r}`, `gather{kind,id}`, `gdone`, `gcancel`, `craft{id}`, `equip{i}`, `unequip{slot}`, `mount`, `dismount`, `chat{m}`.
Server → client: `welcome`, `auth_err`, `s` (10 Hz snapshot: you, nearby players, nearby rabbits), `inv`, `node`, `cast`, `fail`, `toast`, `pos` (correction), `chat`, `kick`, plus three feedback events: `hit {i,d,h,k,by}` (a rabbit was hit; sent to players within 60 units), `hurt {d,by}` (you were bitten) and `gain {item,n,src}` (you received an item; `src` is `gather`, `loot`, `craft` or `reward`). Rabbit entries in `s` carry `a:1` while chasing or attacking. These only drive visuals and sound; the server remains the only authority on damage and items.

### Security model

- Passwords: `scrypt` with per-user salt; never stored or logged in clear. Login tokens are random, stored **hashed**, expire after 30 days. The browser keeps only the token.
- Rate limits: per-connection message bucket, failed-login throttle per IP, registrations per IP, chat flood limit, 4 KB max frame, max 40 players/world, max 16 worlds.
- WebSocket `Origin` allow-list; static server only exposes `index.html`, `css/ src/ shared/ vendor/`.
- Chat is plain text, control/bidi characters stripped, rendered with `textContent`.
- **Not covered:** the client still moves itself, so a modified client can e.g. walk through trees (not faster than allowed, not through the server's rules). Add server-side collision if that matters.

## Deploying

**Server (Render, free tier):** build `npm install`, start `npm start`. The service also serves the game, so `https://<service>.onrender.com/` works on its own.

**Client (GitHub Pages):** serve the repo root. The client talks to the hosted Render server when opened from `*.github.io` (see `src/config.js`).

### ⚠️ Persistence on free hosting

Accounts and characters are saved to `DATA_DIR/accounts.json`. Render's free tier has an **ephemeral disk**: the file is lost on every redeploy and whenever the instance is replaced. To keep accounts, attach a persistent disk (paid) and set `DATA_DIR` to its mount path, or replace `server/store.js` with a database-backed class (it has a small surface: `get/create/issueToken/byToken/saveCharacter/flush`).

### Cold starts

Render's free tier sleeps after ~15 minutes without traffic and takes ~30–60 s to wake. Two mitigations are included:

1. The client shows a **“Waking the server…”** screen with a live timer and retries automatically (it pokes `/health` first).
2. `.github/workflows/keepalive.yml` pings `/health` every 10 minutes. It runs only from the default branch, GitHub pauses scheduled workflows after 60 days without repo activity, and a service that never sleeps uses ~730 of Render's 750 free instance-hours/month (fine for one service). Delete the workflow if you don't want that.

## Tests

`npm test` runs ~50 tests: inventory rules, deterministic world generation, every server game rule with a fake clock (gather, craft, equip, combat, rabbits, mounts, chat, speed limit), and real-WebSocket integration tests (register/login/token, throttling, persistence across restart, origin check, malformed input, static-file safety).

## Roadmap ideas

Server-side collision · persistent database · player-vs-player and parties · more resources/recipes · sound · upgrading Three.js past r128 (needs a lighting/colour pass).
