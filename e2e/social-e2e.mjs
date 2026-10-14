// Browser check for coins, targeting, inspect and trading between two real pages (phone-sized).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.js';
import { countItem } from '../shared/inventory.js';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const out = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-e2e-shots-'));
const gs = createGameServer({ port: 0, host: '127.0.0.1', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-e2e-')), databaseUrl: '', admins: ['Alice1'] });
const port = await gs.listen();
const base = `http://127.0.0.1:${port}`;
const problems = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) problems.push(m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });

async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  await page.goto(base + '/?seed=7');
  await page.waitForSelector('#auth.show', { timeout: 15000 });
  await page.fill('#authname', name);
  await page.fill('#authpass', 'pw-123456');
  await page.click('#regbtn');
  await page.waitForFunction(() => window.__nwo && window.__nwo.S.ready, null, { timeout: 15000 });
  const room = gs.rooms.get(7);
  return { page, room, p: [...room.players.values()].find((q) => q.name === name) };
}
const A = await open('Alice1'), B = await open('Bob1');
const room = A.room;
// stand next to each other, away from rabbits' trouble
// (the camera looks toward -z, so Bob stands a few steps in front of Alice)
for (const [x, px, pz] of [[A, 60, 30], [B, 60.5, 26]]) {
  x.p.x = px; x.p.z = pz;
  await x.page.evaluate(([a, b]) => { window.__nwo.S.P.x = a; window.__nwo.S.P.z = b; }, [px, pz]);
}
B.p.inv.eq.main = { id: 'sword', n: 1 };
B.p.inv.eq.foot = { id: 'leather_boots', n: 1 };
B.p.recalc(); room.sendInv(B.p);
A.p.inv.slots[0] = { id: 'wood', n: 20 }; room.sendInv(A.p);
B.p.inv.slots[0] = { id: 'ore', n: 9 }; room.sendInv(B.p);
await wait(1500);

// coins
ok(A.p.coins === 10_000_000_000 && B.p.coins === 0, 'admin account has 10,000,000,000 coins, a normal account has none');
await A.page.click('#invhead');
ok((await A.page.textContent('#coins')).includes('10,000,000,000'), 'the inventory shows the coin balance');
ok((await B.page.evaluate(() => window.__nwo.S.coins)) === 0, 'a normal player sees 0 coins');
await A.page.click('#invhead');

// target by tapping the other player
await A.page.waitForFunction(() => Object.keys(window.__nwo.S.others).length > 0);
const pos = await A.page.evaluate((id) => window.__nwo.screenOf(id), B.p.id);
ok(!!pos, 'the other player is on screen');
await A.page.touchscreen.tap(pos.x + 8, pos.y + 6);
await wait(500);
ok(await A.page.isVisible('#target'), 'tapping a player marks them: the target frame appears');
ok((await A.page.textContent('#target .tn')) === 'Bob1', 'the frame shows their name');
const fr = await A.page.evaluate(() => { const r = document.getElementById('target').getBoundingClientRect(), h = document.getElementById('hpwrap').getBoundingClientRect(), m = document.getElementById('mm').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, hr: h.right, ml: m.left }; });
ok(fr.l >= fr.hr && fr.r <= fr.ml, `the frame sits beside the HP bar and clear of the minimap (${Math.round(fr.l)}-${Math.round(fr.r)}, HP ends ${Math.round(fr.hr)}, map starts ${Math.round(fr.ml)})`);
await A.page.waitForFunction(() => window.__nwo.S.target && window.__nwo.S.target.mh > 0, null, { timeout: 5000 });
ok(true, 'the target HP arrives from the server');
await A.page.screenshot({ path: `${out}/social-target.png` });

// inspect
await A.page.click('#target');
await A.page.click('#tmenu button[data-a=inspect]');
await A.page.waitForSelector('#inspect.show');
const txt = await A.page.textContent('#inspect');
ok(/Sword/.test(txt) && /Leather Shoes/.test(txt) && /speed \+40%/.test(txt), 'inspect lists their gear and speed');
await A.page.screenshot({ path: `${out}/social-inspect.png` });
await A.page.keyboard.press('Escape');
ok(!(await A.page.isVisible('#inspect')), 'Esc closes the inspect window');

// trade
await A.page.click('#target');
await A.page.click('#tmenu button[data-a=trade]');
await B.page.waitForSelector('#tradereq.show');
ok(true, 'the other player is asked');
await B.page.screenshot({ path: `${out}/social-request.png` });
await B.page.click('#tradereq button[data-a=accept]');
await A.page.waitForSelector('#trade.show');
await B.page.waitForSelector('#trade.show');
ok(true, 'both trade windows open');
await A.page.click('#trade [data-add=wood]');
await A.page.fill('#tr-qty', '8');
await A.page.click('#trade button[data-a=addqty]');
await A.page.fill('#tr-coins', '2500');
await A.page.click('#trade button[data-a=setcoins]');
await B.page.click('#trade [data-add=ore]');
await B.page.click('#trade button[data-a=addqty]'); // all 9
await wait(500);
ok(/Wood ×8/.test(await B.page.textContent('#trade')) && /2,500/.test(await B.page.textContent('#trade')), 'each side sees what the other offers');
await B.page.screenshot({ path: `${out}/social-trade.png` });
await A.page.click('#trade button[data-a=lock]');
await wait(300);
ok(/They accepted/.test(await B.page.textContent('#trade')), 'the other side sees the accept');
await B.page.click('#trade button[data-a=lock]');
await wait(800);
ok(!(await A.page.isVisible('#trade')) && !(await B.page.isVisible('#trade')), 'the windows close when the trade completes');
ok(countItem(A.p.inv, 'wood') === 12 && countItem(A.p.inv, 'ore') === 9 && countItem(B.p.inv, 'wood') === 8 && countItem(B.p.inv, 'ore') === 0, 'items changed hands');
ok(A.p.coins === 10_000_000_000 - 2500 && B.p.coins === 2500, 'coins changed hands');
ok((await B.page.evaluate(() => window.__nwo.S.coins)) === 2500, 'the receiver sees their new balance');

for (const [n, x] of [['Alice', A], ['Bob', B]]) ok(x.page.errors.length === 0, `no page errors (${n})` + (x.page.errors.length ? ': ' + x.page.errors.join(' | ') : ''));
await browser.close();
await gs.stop();
console.log(problems.length ? problems.length + ' PROBLEM(S)' : 'ALL SOCIAL E2E CHECKS PASSED  (screenshots in ' + out + ')');
process.exit(problems.length ? 1 : 0);
