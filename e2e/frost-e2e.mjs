// Browser check of Frostfall (Tier 2): spawn on the south edge, the look of the biomes, the map edge, the portal home.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.js';
import { createWorld } from '../shared/world.js';
import { FROST } from '../shared/realm.js';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const out = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-e2e-shots-'));
const gs = createGameServer({ port: 0, host: '127.0.0.1', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-e2e-')), databaseUrl: '', admins: ['Alice1'] });
const port = await gs.listen();
const problems = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) problems.push(m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// find nice spots with the same world code the game uses
const w = createWorld(5001);
function find(pred) {
  for (let r = 100; r < 2200; r += 40) for (let a = 0; a < 6.28; a += 0.15) {
    const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
    if (pred(x, z)) return { x, z };
  }
  throw new Error('no spot');
}
const spots = {
  forest: find((x, z) => w.biome(x, z) === 1 && w.ctrees(Math.floor(x / 32), Math.floor(z / 32)).length > 60 && w.hgt(x, z) > 1 && w.hgt(x, z) < 20),
  lake: find((x, z) => { for (const [dx, dz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12], [25, 25], [-25, -25]]) if (w.hgt(x + dx, z + dz) > 0.05) return false; return true; }),
  glacier: find((x, z) => w.biome(x, z) === 2 && w.hgt(x, z) > 12),
};
console.log('spots', JSON.stringify(spots));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(`http://127.0.0.1:${port}/?seed=5001`);
await page.waitForSelector('#auth.show', { timeout: 15000 });
await page.fill('#authname', 'Alice1');
await page.fill('#authpass', 'pw-123456');
await page.click('#regbtn');
await page.waitForFunction(() => window.__nwo && window.__nwo.S.ready, null, { timeout: 20000 });
await wait(2500);
const room = gs.rooms.get(5001);
const me = [...room.players.values()][0];
const P = () => page.evaluate(() => ({ x: window.__nwo.S.P.x, z: window.__nwo.S.P.z }));

let p = await P();
ok(Math.abs(p.x - FROST.spawn.x) < 8 && Math.abs(p.z - FROST.spawn.z) < 1, `you start in the Frostfall village on the south edge (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
ok(!(await page.evaluate(() => !!document.querySelector('canvas') === false)), 'the game canvas is up');
await page.screenshot({ path: `${out}/frost-spawn.png` });

// map (small + big)
await page.click('#mm');
await wait(600);
await page.screenshot({ path: `${out}/frost-map.png` });
await page.keyboard.press('Escape');

async function look(name, s, yaw = 0) {
  await page.evaluate(({ s, yaw }) => { window.__nwo.send({ t: 'chat', m: `/teleport ${s.x} ${s.z}` }); }, { s, yaw });
  await page.waitForFunction((s) => Math.abs(window.__nwo.S.P.x - s.x) < 3 && Math.abs(window.__nwo.S.P.z - s.z) < 3, s, { timeout: 8000 });
  await wait(2500);
  await page.screenshot({ path: `${out}/frost-${name}.png` });
}
await look('forest', spots.forest);
await look('lake', spots.lake);
await look('glacier', spots.glacier);
await look('edge', { x: 0, z: -(FROST.ringFrom - 30) }); // (the camera looks north, so the north edge is in front)

// the wall: walk (via the server's own movement check) to the edge from the village side
await page.evaluate(() => window.__nwo.send({ t: 'chat', m: '/teleport 0 2440' }));
await wait(800);
await page.evaluate(() => { window.__nwo.S.P.z = 2600; });
await wait(1500);
ok(me.z <= FROST.wall + 0.5, `the server keeps you inside the map (z = ${me.z.toFixed(1)})`);

// the portal home
await page.evaluate(() => window.__nwo.send({ t: 'chat', m: '/teleport portal' }));
await wait(1200);
await page.keyboard.press('e');
await wait(500);
const txt = await page.evaluate(() => document.body.innerText);
ok(/way home|Night World/.test(txt), 'the portal offers the way home to Night World');
await page.screenshot({ path: `${out}/frost-portal.png` });

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
await gs.stop();
console.log(problems.length ? problems.length + ' PROBLEM(S)' : 'ALL FROSTFALL E2E CHECKS PASSED  (screenshots in ' + out + ')');
process.exit(problems.length ? 1 : 0);
