# Hosting: what the free plan can and cannot carry

All numbers come from `npm run loadtest` (simulated players walking, fighting and chatting against the real server).
`--throttle 0.1` squeezes the server into 10 % of a core to imitate Render's free instance (0.1 CPU, 512 MB).
Your machine and Render's are not identical, so read these as good estimates, not promises.

## Measured

| Players | Message compression | CPU (free plan emulation) | Ping p95 | Data per player |
|---|---|---|---|---|
| 1 | on | fine | fine | 3.4 KB/s = **12 MB/hour** |
| 10 | off | fine | 25 ms | 20 KB/s = 70 MB/hour |
| 10 | **on** | fine | fine | **5.6 KB/s = 20 MB/hour** |
| 40 (all crowded in town) | off | fine | 43 ms | 41 KB/s = 145 MB/hour |
| 40 (all crowded in town) | on | tight | 139 ms | 10 KB/s = 36 MB/hour |
| 60 in two worlds | off | ok | 86 ms | ~37 KB/s |
| 60 in two worlds | on | **overloaded** | 431 ms | 9 KB/s |

(Ping p95 has a floor of about 90 ms in the emulation because the free CPU quota pauses the server ~90 ms in every 100 ms.)

What this means:

1. **Bandwidth is the first wall, not CPU.** Compression cuts data 3–4×, so it is **on by default** now
   (`WS_DEFLATE=0` turns it off). Without it a handful of players would burn through a small monthly allowance quickly.
2. **CPU is the second wall.** Compression costs ~50 % more CPU, so on the free plan about **40 players** is the limit.
   `MAX_PLAYERS` therefore defaults to **40**; at the limit new players see "The server is full right now".
3. **Check your allowance.** Render's current Hobby workspace includes **5 GB of outbound bandwidth per month**
   (older plans had 100 GB; that was changed in April 2026 according to published pricing summaries), then $0.15/GB, and
   without a payment method on file Render suspends free services for the rest of the month. Look at
   *Render dashboard → Billing / Usage* for your real number. At 12–20 MB per player-hour, 5 GB is roughly
   250–400 player-hours a month, so about **8–13 player-hours a day**. That is plenty for friends, not for a public launch.
   (The game files themselves come from GitHub Pages, so they don't count.)

## Your options

| | Free + pinger (now) | Starter (about $7/month) | Starter + more bandwidth |
|---|---|---|---|
| Always awake (no 30–60 s cold start) | mostly (pinger + self-ping) | **yes** | yes |
| CPU | 0.1 | **0.5** (5× more) | 0.5 |
| Players at once | ~40 | ~150+ (raise `MAX_PLAYERS`) | ~150+ |
| Bandwidth | 5 GB/month (check) | the workspace allowance, then $0.15/GB | pay as you go |
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
npm run loadtest -- --players 100 --worlds 3 --seconds 20             # a whole core
WS_DEFLATE=0 npm run loadtest -- --players 40 --seconds 20            # without compression
npm run loadtest -- --players 40 --budget-gb 25                       # your own monthly allowance
```
