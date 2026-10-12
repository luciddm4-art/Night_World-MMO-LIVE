// Browser end-to-end check: real Chromium + the real server in-process.
// Not part of `npm test` (needs Playwright + a browser). To run it:
//   npm i --no-save playwright && npx playwright install chromium
//   node e2e/e2e.mjs            (PLAYWRIGHT_PATH=/path/to/playwright/index.mjs to use another install)
// Screenshots go to $E2E_OUT (default: a temp folder).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.js';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const out = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-e2e-shots-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-e2e-'));
const gs = createGameServer({ port: 0, host: '127.0.0.1', dataDir, databaseUrl: '' });
const port = await gs.listen();
const base = `http://127.0.0.1:${port}`;
const problems = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) problems.push(m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  return page;
}
const woodOf = (p) => p.evaluate(() => window.__nwo.S.inv.slots.filter(Boolean).filter((s) => s.id === 'wood').reduce((n, s) => n + s.n, 0));

const A = await newPage();
await A.goto(base + '/?seed=7');
await A.waitForSelector('#auth.show', { timeout: 15000 });
ok(true, 'login overlay appears when there is no saved session');
await A.fill('#authname', 'Tester1');
await A.fill('#authpass', 'pw-123456');
await A.click('#regbtn');
await A.waitForFunction(() => window.__nwo && window.__nwo.S.ready, null, { timeout: 15000 });
ok(true, 'registered and entered the world');
ok((await A.textContent('#who')).includes('Tester1'), 'name + online count shown');

// next to a tree
const room = gs.rooms.get(7);
const player = [...room.players.values()][0];
let tree;
for (let cx = -6; cx < 6 && !tree; cx++) for (let cz = -6; cz < 6 && !tree; cz++) {
  const a = room.world.ctrees(cx, cz);
  if (a.length) tree = { id: cx + ',' + cz + ',0', x: a[0] + 1.2, z: a[1] };
}
player.x = tree.x; player.z = tree.z;
await A.evaluate((t) => { window.__nwo.S.P.x = t.x; window.__nwo.S.P.z = t.z; }, tree);
await wait(600);
ok(/Gather/.test(await A.textContent('#use')), 'interact prompt near a resource');
await A.click('#use');
await A.waitForSelector('#cast', { state: 'visible', timeout: 3000 });
ok(true, 'cast bar starts after the server accepts');
await wait(2150);
ok((await A.evaluate(() => document.querySelectorAll('.fly').length)) >= 1, 'a "+1 Wood" icon flies to the inventory');
await wait(350);
ok((await woodOf(A)) === 1, 'server granted 1 wood');

// chat
await A.keyboard.press('Enter');
await A.keyboard.type('hello from the browser <b>x</b>');
await A.keyboard.press('Enter');
await wait(400);
const chatHtml = await A.innerHTML('#chatlog');
ok(chatHtml.includes('hello from the browser') && !chatHtml.includes('<b>x</b>'), 'chat shown, HTML escaped');

// second player sees us
const B = await newPage();
await B.goto(base + '/?seed=7');
await B.waitForSelector('#auth.show');
await B.click('#guestbtn');
await B.waitForFunction(() => window.__nwo && window.__nwo.S.ready);
const bp = [...room.players.values()].find((p) => p.name !== 'Tester1');
bp.x = tree.x + 3; bp.z = tree.z;
await B.evaluate((t) => { window.__nwo.S.P.x = t.x + 3; window.__nwo.S.P.z = t.z; }, tree);
await wait(900);
ok((await B.evaluate(() => Object.keys(window.__nwo.S.others).length)) === 1, 'guest sees the other player');

// rabbit fight through the real UI
const rab = { id: 'rab:e2e:1', x: player.x, z: player.z + 1.0, hp: 50, mode: 'wander', tx: 0, tz: 0, wt: 1e9, atkT: 0, dead: false, gathered: false, deadAt: 0, target: null, home: Math.floor(player.x / 32) + ',' + Math.floor(player.z / 32) };
room.rabbits.set(rab.id, rab);
await A.evaluate(() => { window.__nwo.S.P.r = 0; });
await wait(300);
await A.click('#atk'); await wait(200);
const nums = await A.evaluate(() => [...document.querySelectorAll('#fx .floater')].map((e) => e.textContent));
ok(nums.includes('30'), 'floating damage number shown: ' + JSON.stringify(nums));
await A.screenshot({ path: out + '/combat.png' });
await wait(700); await A.click('#atk'); await wait(500);
ok(rab.hp === 0 || rab.dead, 'attack button damaged the rabbit server-side');

// settings
await A.click('#gear');
await A.click('#set-sound');
await A.evaluate(() => { const r = document.getElementById('set-bright'); r.value = '1.6'; r.dispatchEvent(new Event('input')); });
const saved = await A.evaluate(() => JSON.parse(localStorage.getItem('nwo_settings')));
ok(saved.mute === true && saved.brightness === 1.6, 'sound off + brightness saved');
await A.click('#set-close');
const tip = await A.evaluate(() => { const e = document.querySelector('#grid .islot.filled'); return e ? e.title : ''; });
ok(/Wood/.test(tip) && /Used in/.test(tip), 'inventory tooltip');

// reload => token login
await A.reload();
await A.waitForFunction(() => window.__nwo && window.__nwo.S.ready, null, { timeout: 15000 });
ok((await woodOf(A)) === 1, 'inventory persisted after reload');

// versioned modules via the import map
const urls = await A.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\/(src|shared)\/[a-z]+\.js/.test(n)));
ok(urls.length > 15 && urls.every((u) => /\?v=[0-9a-f]{8}$/.test(u)), 'all ' + urls.length + ' game modules load with a ?v= version');

// ping indicator
await wait(2500);
const pingTxt = await A.textContent('#ping');
ok(/^\d+ ms$/.test(pingTxt), 'ping shown in the HUD: "' + pingTxt + '"');

// connection drop: small banner, then automatic reconnect into the same character
const before = await A.evaluate(() => ({ x: window.__nwo.S.P.x, z: window.__nwo.S.P.z }));
for (const c of gs.wss.clients) c.terminate();
await A.waitForFunction(() => document.getElementById('netbanner').classList.contains('show') || document.getElementById('boot').classList.contains('show'), null, { timeout: 5000 });
ok(true, 'drop is shown to the player');
await A.waitForFunction(() => window.__nwo.S.ready, null, { timeout: 15000 });
const after = await A.evaluate(() => ({ x: window.__nwo.S.P.x, z: window.__nwo.S.P.z, banner: document.getElementById('netbanner').classList.contains('show'), boot: document.getElementById('boot').classList.contains('show') }));
ok(!after.banner && !after.boot, 'loader/banner hidden after reconnecting');
ok(Math.hypot(after.x - before.x, after.z - before.z) < 3, 'back where we were after reconnect');
await A.screenshot({ path: out + '/after-reconnect.png' });

for (const [n, p] of [['A', A], ['B', B]]) {
  const real = p.errors.filter((e) => !/favicon|404|flatShading/.test(e));
  ok(real.length === 0, `no browser errors on page ${n}` + (real.length ? ': ' + real.join(' | ') : ''));
}
await browser.close();
await gs.stop();
console.log(problems.length ? '\n' + problems.length + ' PROBLEM(S)' : '\nALL E2E CHECKS PASSED  (screenshots in ' + out + ')');
process.exit(problems.length ? 1 : 0);
