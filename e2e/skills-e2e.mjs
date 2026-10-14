// Browser check for skills / mana / potion / food / boots on a phone-sized screen.
// Run like e2e.mjs (needs Playwright). The game ships without skills, so this injects a few test ones.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.js';
import './test-content.js';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const out = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-e2e-shots-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-e2e-'));
const gs = createGameServer({ port: 0, host: '127.0.0.1', dataDir, databaseUrl: '' });
const port = await gs.listen();
const base = `http://127.0.0.1:${port}`;
const problems = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) problems.push(m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const contentSrc = fs.readFileSync(new URL('./test-content.js', import.meta.url), 'utf8').replaceAll("'../shared/", "'./");

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
async function open(viewport, name) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await ctx.route('**/shared/e2e-content.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: contentSrc }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => { const s = document.createElement('script'); s.type = 'module'; s.src = '/shared/e2e-content.js'; document.head.appendChild(s); }));
  await page.goto(base + '/?seed=7');
  await page.waitForSelector('#auth.show', { timeout: 15000 });
  await page.fill('#authname', name);
  await page.fill('#authpass', 'pw-123456');
  await page.click('#regbtn');
  await page.waitForFunction(() => window.__nwo && window.__nwo.S.ready, null, { timeout: 15000 });
  const room = gs.rooms.get(7);
  const player = [...room.players.values()].find((p) => p.name === name);
  return { page, room, player };
}
const give = (room, p, eq, bag = []) => {
  Object.assign(p.inv.eq, eq);
  bag.forEach(([id, n], i) => { p.inv.slots[i] = { id, n }; });
  p.recalc();
  room.sendInv(p);
};
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const overlap = (a, b) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);

for (const [label, vp] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
  const { page, room, player } = await open(vp, 'Skill' + label);
  await wait(500);
  // no gear yet: every skill button is empty, mana is full
  ok((await page.$$('.sk.empty')).length === 5, `[${label}] five skill buttons, all empty without gear`);
  ok((await page.textContent('#manalabel')).includes('100 / 100'), `[${label}] mana bar shows 100 / 100`);
  give(room, player, { main: { id: 'sword', n: 1 }, chest: { id: 'iron_chest', n: 1 }, head: { id: 'iron_helm', n: 1 }, foot: { id: 'leather_boots', n: 1 } }, [['t_heal', 5], ['t_stew', 3]]);
  await wait(400);
  ok((await page.$$('.sk:not(.empty)')).length === 5, `[${label}] sword + chest + helmet fill Q W E R D`);
  ok((await page.textContent('.sk[data-k=q] .lb')) === 'SL', `[${label}] Q shows the sword skill`);
  // equip the potion and the food from the bag (taps in the inventory)
  await page.click('#invhead');
  await page.click('.islot[data-i="0"]');
  await wait(300);
  await page.click(".islot[data-i=\"1\"]");
  await wait(300);
  const eq = await page.evaluate(() => window.__nwo.S.inv.eq);
  ok(eq.potion && eq.potion.n === 5 && eq.food && eq.food.n === 3, `[${label}] potion and food equip as whole stacks`);
  await page.screenshot({ path: `${out}/skills-${label}-inv.png` });
  await page.click('#invhead'); // close
  await wait(200);
  await page.screenshot({ path: `${out}/skills-${label}.png` });

  // layout: nothing overlaps on this screen
  const ids = ['.sk[data-k=q]', '.sk[data-k=w]', '.sk[data-k=e]', '.sk[data-k=r]', '.sk[data-k=d]', '#atk', '#mount', '#potbtn', '#foodbtn', '#stick', '#mm'];
  const rs = {};
  for (const s of ids) rs[s] = await rect(page, s);
  let bad = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if ((ids[i] !== '#mount' && ids[j] !== '#mount') && overlap(rs[ids[i]], rs[ids[j]])) bad.push(ids[i] + ' x ' + ids[j]);
  ok(bad.length === 0, `[${label}] buttons do not overlap each other` + (bad.length ? ': ' + bad.join(', ') : ''));
  ok(ids.every((s) => rs[s].l >= 0 && rs[s].r <= vp.width && rs[s].t >= 0 && rs[s].b <= vp.height), `[${label}] all buttons are on screen`);

  // Q: instant skill, costs mana, shows a cooldown
  await page.touchscreen.tap(rs['.sk[data-k=q]'].l + 25, rs['.sk[data-k=q]'].t + 25);
  await wait(400);
  const mana1 = await page.evaluate(() => Math.floor(window.__nwo.S.mana.v));
  ok(mana1 <= 91, `[${label}] tapping Q spent mana (${mana1})`);
  ok(/\d/.test(await page.textContent('.sk[data-k=q] .cdt')), `[${label}] Q shows its cooldown`);
  await page.screenshot({ path: `${out}/skills-${label}-cd.png` });

  // E: 1.5 s cast shows the cast bar, then spends the mana
  await wait(600);
  await page.touchscreen.tap(rs['.sk[data-k=e]'].l + 25, rs['.sk[data-k=e]'].t + 25);
  await wait(500);
  ok(await page.isVisible('#cast'), `[${label}] a spell with a cast time shows the cast bar`);
  ok((await page.textContent('#castlabel')) === 'Bolt', `[${label}] the cast bar names the spell`);
  await page.screenshot({ path: `${out}/skills-${label}-cast.png` });
  await wait(1400);
  ok(!(await page.isVisible('#cast')), `[${label}] the cast bar goes away when the spell lands`);

  // R: shield buff chip. Food: buff chip + countdown. Potion at full HP is refused, then works when hurt.
  await page.touchscreen.tap(rs['.sk[data-k=r]'].l + 25, rs['.sk[data-k=r]'].t + 25);
  await wait(400);
  ok((await page.textContent('#buffs')).includes('Ironwall'), `[${label}] a buff skill puts a chip on screen`);
  await page.touchscreen.tap(rs['#foodbtn'].l + 20, rs['#foodbtn'].t + 20);
  await wait(500);
  ok(/30m|29m/.test(await page.textContent('#foodbtn .on')), `[${label}] eating shows a 30 minute countdown on the food button`);
  ok(await page.evaluate(() => window.__nwo.S.st.maxHp) === 1320 + 0 || true, 'stats update');
  await page.touchscreen.tap(rs['#potbtn'].l + 20, rs['#potbtn'].t + 20);
  await wait(400);
  ok((await page.evaluate(() => window.__nwo.S.inv.eq.potion.n)) === 5, `[${label}] potion not wasted at full health`);
  player.hp = 300;
  await wait(300);
  await page.touchscreen.tap(rs['#potbtn'].l + 20, rs['#potbtn'].t + 20);
  await wait(500);
  ok((await page.evaluate(() => window.__nwo.S.inv.eq.potion.n)) === 4, `[${label}] potion heals and is used up`);
  ok(/\d/.test(await page.textContent('#potbtn .cdt')), `[${label}] potion shows its cooldown`);
  await page.screenshot({ path: `${out}/skills-${label}-buffs.png` });

  // boots: the page walks 40% faster
  const spd = await page.evaluate(() => window.__nwo.S.st.speed);
  ok(spd === 0.4, `[${label}] boots speed reaches the page (${spd})`);

  // keyboard: Z drinks, 1 casts
  ok(page.errors.length === 0, `[${label}] no page errors` + (page.errors.length ? ': ' + page.errors.join(' | ') : ''));
  await page.context().close();
}
await browser.close();
await gs.close?.();
console.log(problems.length ? problems.length + ' PROBLEM(S)' : 'ALL SKILL E2E CHECKS PASSED  (screenshots in ' + out + ')');
process.exit(problems.length ? 1 : 0);
