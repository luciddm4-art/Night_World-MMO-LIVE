# Hosting: what the free plan can and cannot carry

All numbers come from `npm run loadtest` (simulated players walking, fighting and chatting against the real server).
`--throttle 0.1` squeezes the server into 10 % of a core to imitate Render's free instance (0.1 CPU, 512 MB).
Your machine and Render's are not identical, so read these as good estimates, not promises.

## Measured

**Important:** Render's front door (a Cloudflare proxy) does not pass WebSocket compression through (checked against the
live server: the handshake comes back without `permessage-deflate`). So on Render **compression does nothing**, and the
numbers that count are the "no compression" ones. The real fix for bandwidth is to send less, which is what
"delta snapshots" (protocol 2) do: the server only tells each player what changed (see `shared/wire.js`).

Data per player, no compression (as on Render), all players crowded in town:

| Players | Old protocol | **Delta protocol (now)** | Saving |
|---|---|---|---|
| 1 | 10.9 KB/s = 38 MB/hour | **0.7 KB/s = 2 MB/hour** | 16x |
| 5 | 17.2 KB/s = 61 MB/hour | **1.4 KB/s = 5 MB/hour** | 12x |
| 20 | 27.8 KB/s = 98 MB/hour | **4.2 KB/s = 15 MB/hour** | 6.5x |
| 40 | 40.6 KB/s = 143 MB/hour | **7.7 KB/s = 27 MB/hour** | 5x |

The more players stand together and move, the more there is to tell, so crowds save less than a lone player.

CPU (free-plan emulation with `--throttle 0.1`, delta protocol, no compression):

| Players | Ping p95 | Verdict |
|---|---|---|
| 40 | 84 ms | comfortable |
| 60 in two worlds | 100 ms | fine |
| 80 in two worlds | 193 ms | too much |

(Ping p95 has a floor of about 90 ms in the emulation because the free CPU quota pauses the server ~90 ms in every 100 ms.)

What this means:

1. **Bandwidth was the first wall, CPU is the second.** The delta protocol makes 5 GB last about 5-16x longer than before.
2. **`MAX_PLAYERS` stays at 40.** The test says about 60 would hold, but real Render cores are probably slower than this
   machine, so 40 keeps a margin. At the limit new players see "The server is full right now".
3. **Check your allowance.** Render's current Hobby workspace includes **5 GB of outbound bandwidth per month**
   (confirmed in the dashboard), then $0.15/GB, and without a payment method on file Render suspends free services for
   the rest of the month. Look at *Render dashboard -> Billing / Usage* for the running total. With the delta protocol
   5 GB is roughly **2,000 hours of solo play** or **about 350 player-hours with 20 players together** (~12 a day).
   (The game files themselves come from GitHub Pages, so they don't count.)
4. **Old pages keep working.** A page that has not refreshed since the update asks for no deltas and gets the old full
   snapshots (more data) until it reloads.
5. **WebSocket compression** is still switched on (`WS_DEFLATE=0` turns it off). It only helps on hosts that let it
   through (for example a VPS in front of which nothing strips it); on Render it is simply unused.

## Your options

| | Free + pinger (now) | Starter (about $7/month) | Starter + more bandwidth |
|---|---|---|---|
| Always awake (no 30–60 s cold start) | mostly (pinger + self-ping) | **yes** | yes |
| CPU | 0.1 | **0.5** (5× more) | 0.5 |
| Players at once | ~40 | ~150+ (raise `MAX_PLAYERS`) | ~150+ |
| Bandwidth | 5 GB/month (confirmed) | the workspace allowance, then $0.15/GB | pay as you go |
| Postgres | Neon free (separate, fine) | same | same |
| Good for | friends, testing | a real public launch | a popular game |

**My recommendation:** stay on free while it's you and friends. Before you tell the public, move the one web service to
Starter and set `MAX_PLAYERS` to about 150. Watch the `stats` lines in the Render logs and the bandwidth on the Billing
page for a week, then decide about more. A custom domain is optional and independent of all this.

## How to switch to Starter (phone steps)

1. dashboard.render.com → your **night-world-mmo-live** service → **Settings**.
2. **Instance Type** → choose **Starter** → **Save**. (Add a payment method if asked.) Render redeploys by itself.
3. **Environment** → add `MAX_PLAYERS` = `150` → **Save changes**.
4. Keep the keep-alive pinger anyway; it is harmless.

## Re-running the test

```
npm run loadtest -- --players 40 --seconds 20 --throttle 0.1          # free-plan emulation
npm run loadtest -- --players 20 --seconds 20 --legacy                # an old page (full snapshots), for comparison
npm run loadtest -- --players 100 --worlds 3 --seconds 20             # a whole core
WS_DEFLATE=0 npm run loadtest -- --players 40 --seconds 20            # without compression (what Render really does)
npm run loadtest -- --players 40 --budget-gb 25                       # your own monthly allowance
```
