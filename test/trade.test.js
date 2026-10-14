// Coins, trading, inspecting and targeting.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRoom, makePlayer, fakeClock, fillBag } from './helpers.js';
import { CFG, fmtCoins } from '../shared/data.js';
import { countItem, newInv } from '../shared/inventory.js';
import { Player } from '../server/player.js';
import { Store } from '../server/store.js';

const bag = (p, id, n) => { p.inv.slots[p.inv.slots.findIndex((s) => !s)] = { id, n }; };
const trade = (room, p, m) => room.handle(p, { t: 'trade', ...m });
function open(room, a, b) {
  trade(room, a, { a: 'req', id: b.id });
  assert.ok(b.last('trade') && b.last('trade').a === 'req', 'the other player is asked');
  trade(room, b, { a: 'accept' });
  assert.equal(a.last('trade').a, 'state');
}
const setup = () => { const r = makeRoom(); const a = makePlayer(r.room, 'ann', { x: 100, z: 100 }); const b = makePlayer(r.room, 'bob', { x: 3000, z: 3000 }); return { ...r, a, b }; };

test('coins: everyone starts with zero, and the wallet is saved and loaded', () => {
  const { room, a } = setup();
  assert.equal(a.coins, 0);
  assert.equal(room.welcome(a).you.coins, 0);
  a.coins = 12345;
  assert.equal(a.toSave(7).coins, 12345);
  const b = new Player({ id: 'x', name: 'x', saved: a.toSave(7), send: () => {} });
  assert.equal(b.coins, 12345);
  for (const bad of [-5, 1.5, 'lots', NaN, null]) assert.equal(new Player({ id: 'y', name: 'y', saved: { coins: bad }, send: () => {} }).coins, 0);
  assert.equal(new Player({ id: 'z', name: 'z', saved: { coins: 1e20 }, send: () => {} }).coins, 0, 'not a safe integer');
  assert.equal(fmtCoins(10000000000), '10,000,000,000');
});

test('coins are stored with the account', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-coins-'));
  const now = fakeClock();
  const s1 = new Store(dir, { now });
  s1.load();
  await s1.create('Rich', 'pw-123456');
  s1.saveCharacter('Rich', { inv: newInv(), hpRatio: 1, color: '#112233', lastSeed: 7, coins: 777, adminGrant: true, world: { x: 1, z: 2, r: 0 } });
  await s1.close();
  const s2 = new Store(dir, { now });
  s2.load();
  assert.equal(s2.get('rich').save.coins, 777);
  assert.equal(s2.get('rich').save.adminGrant, true);
  await s2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('trade: a full swap of items and coins, from anywhere in the world', () => {
  const { room, a, b } = setup();
  bag(a, 'wood', 20); a.coins = 500;
  bag(b, 'ore', 7); b.coins = 100;
  open(room, a, b);
  trade(room, a, { a: 'offer', items: [['wood', 15]], coins: 200 });
  trade(room, b, { a: 'offer', items: [['ore', 7]], coins: 0 });
  const sa = a.last('trade');
  assert.deepEqual(sa.mine, { items: [['wood', 15]], coins: 200, ok: false });
  assert.deepEqual(sa.theirs, { items: [['ore', 7]], coins: 0, ok: false });
  trade(room, a, { a: 'lock', v: sa.v });
  assert.equal(a.last('trade').mine.ok, true);
  assert.equal(b.last('trade').theirs.ok, true, 'the other side sees you accepted');
  assert.equal(countItem(a.inv, 'wood'), 20, 'nothing moves until both accept');
  trade(room, b, { a: 'lock', v: b.last('trade').v });
  assert.equal(countItem(a.inv, 'wood'), 5);
  assert.equal(countItem(a.inv, 'ore'), 7);
  assert.equal(countItem(b.inv, 'wood'), 15);
  assert.equal(countItem(b.inv, 'ore'), 0);
  assert.equal([a.coins, b.coins].join(), '300,300');
  assert.equal(a.last('trade').done, 1);
  assert.equal(a.trade, null);
  assert.equal(a.last('inv').c, 300);
  assert.ok(b.last('gain') && b.last('gain').src === 'trade');
});

test('trade: changing an offer clears both accepts, and a stale accept is refused', () => {
  const { room, a, b } = setup();
  bag(a, 'wood', 20); bag(b, 'ore', 5);
  open(room, a, b);
  trade(room, a, { a: 'offer', items: [['wood', 5]], coins: 0 });
  const seen = b.last('trade').v;
  trade(room, a, { a: 'lock', v: a.last('trade').v });
  trade(room, a, { a: 'offer', items: [['wood', 1]], coins: 0 }); // she changes it...
  assert.equal(a.last('trade').mine.ok, false, 'her accept is cleared');
  trade(room, b, { a: 'lock', v: seen }); // ...but he accepted what he saw before
  assert.match(b.last('fail').m, /changed/);
  assert.equal(b.last('trade').mine.ok, false);
  assert.equal(countItem(b.inv, 'wood'), 0);
  // unlock works too
  trade(room, b, { a: 'lock', v: b.last('trade').v });
  assert.equal(b.last('trade').mine.ok, true);
  trade(room, b, { a: 'unlock' });
  assert.equal(b.last('trade').mine.ok, false);
});

test('trade: you cannot offer what you do not have, negative or fractional amounts, equipped or soulbound items', () => {
  const { room, a, b } = setup();
  bag(a, 'wood', 5); a.coins = 50;
  a.inv.eq.main = { id: 'sword', n: 1 };
  bag(a, 'donkey', 1);
  open(room, a, b);
  trade(room, a, { a: 'offer', items: [['wood', 6]], coins: 0 });
  assert.match(a.last('fail').m, /do not have/);
  assert.deepEqual(a.last('trade').mine.items, [], 'the table did not change');
  trade(room, a, { a: 'offer', items: [], coins: 51 });
  assert.match(a.last('fail').m, /coins/);
  trade(room, a, { a: 'offer', items: [['wood', -3], ['wood', 1.5], ['sword', 1], ['donkey', 1], ['nonsense', 1], 'x', null], coins: -9 });
  assert.deepEqual(a.last('trade').mine, { items: [], coins: 0, ok: false }, 'all junk is ignored');
  trade(room, a, { a: 'offer', items: [['wood', 2], ['wood', 3]], coins: 0 });
  assert.deepEqual(a.last('trade').mine.items, [['wood', 5]], 'duplicate lines add up');
});

test('trade: the bag must have room, otherwise nothing at all happens', () => {
  const { room, a, b } = setup();
  bag(a, 'wood', 5);
  fillBag(b, 'iron'); // b has no free slot
  open(room, a, b);
  trade(room, a, { a: 'offer', items: [['wood', 5]], coins: 0 });
  trade(room, a, { a: 'lock', v: a.last('trade').v });
  trade(room, b, { a: 'lock', v: b.last('trade').v });
  assert.match(b.last('fail').m, /bag space/);
  assert.equal(countItem(a.inv, 'wood'), 5);
  assert.equal(a.trade && b.trade ? 1 : 0, 1, 'the table stays open');
  assert.equal(a.last('trade').mine.ok, false);
});

test('trade: coins cannot go over the cap or be spent twice', () => {
  const { room, a, b } = setup();
  a.coins = 100; b.coins = CFG.COINS_MAX - 10;
  open(room, a, b);
  trade(room, a, { a: 'offer', items: [], coins: 100 });
  trade(room, a, { a: 'lock', v: a.last('trade').v });
  trade(room, b, { a: 'lock', v: b.last('trade').v });
  assert.match(b.last('fail').m, /Too many coins/);
  assert.equal(a.coins, 100);
  a.coins = 40; // she spends coins elsewhere while the table is open
  trade(room, a, { a: 'offer', items: [], coins: 40 });
  b.coins = 0;
  trade(room, a, { a: 'lock', v: a.last('trade').v });
  a.coins = 10;
  trade(room, b, { a: 'lock', v: b.last('trade').v });
  assert.match(b.last('fail').m, /coins/);
  assert.equal(b.coins, 0);
});

test('trade: cancel, decline, expiry, busy players, and leaving all end cleanly', () => {
  const { room, now, a, b } = setup();
  const c = makePlayer(room, 'cat', { x: 5, z: 5 });
  trade(room, a, { a: 'req', id: 'nobody' });
  assert.match(a.last('fail').m, /not here/);
  trade(room, a, { a: 'req', id: a.id });
  assert.match(a.last('fail').m, /not here/);
  trade(room, a, { a: 'req', id: b.id });
  trade(room, b, { a: 'decline' });
  assert.match(a.last('toast').m, /declined/);
  assert.equal(b.tradeReq, null);
  now.advance(2000);
  trade(room, a, { a: 'req', id: b.id });
  now.advance(31000);
  trade(room, b, { a: 'accept' });
  assert.match(b.last('fail').m, /no longer valid/);
  now.advance(2000);
  open(room, a, b);
  trade(room, c, { a: 'req', id: a.id });
  assert.match(c.last('fail').m, /busy/);
  trade(room, a, { a: 'req', id: c.id });
  assert.match(a.last('fail').m, /Finish your current trade/);
  trade(room, a, { a: 'cancel' });
  assert.equal(a.trade, null);
  assert.equal(b.trade, null);
  assert.equal(b.last('trade').a, 'end');
  assert.match(b.last('toast').m, /cancelled/);
  now.advance(2000);
  open(room, a, b);
  room.removePlayer(b); // he disconnects
  assert.equal(a.trade, null);
  assert.equal(a.last('trade').a, 'end');
  assert.match(a.last('toast').m, /left/);
  // random junk from a bad client does nothing
  for (const m of [{ a: 'offer' }, { a: 'lock' }, { a: 'what' }, {}, { a: 'offer', items: 'x' }]) trade(room, a, m);
});

test('inspect and target: equipment and HP of another player, nothing private', () => {
  const { room, a, b } = setup();
  b.inv.eq.main = { id: 'bow', n: 1 };
  b.inv.eq.chest = { id: 'iron_chest', n: 1 };
  bag(b, 'wood', 50);
  b.coins = 999;
  b.recalc();
  b.hp = 700;
  room.handle(a, { t: 'inspect', id: b.id });
  const r = a.last('inspected');
  assert.equal(r.name, 'bob');
  assert.deepEqual(r.eq, { chest: { id: 'iron_chest', n: 1 }, main: { id: 'bow', n: 1 } });
  assert.equal(r.hp, 700);
  assert.equal(r.mh, b.maxHp);
  assert.equal(r.st.def, 0.2);
  assert.ok(!JSON.stringify(r).includes('wood') && !JSON.stringify(r).includes('999'), 'no bag, no coins');
  room.handle(a, { t: 'tg', id: b.id });
  assert.deepEqual(a.last('tg'), { t: 'tg', id: b.id, hp: 700, mh: b.maxHp });
  room.handle(a, { t: 'tg', id: 'ghost' });
  assert.deepEqual(a.last('tg'), { t: 'tg', id: 'ghost', gone: 1 });
  room.handle(a, { t: 'inspect', id: 'ghost' });
  assert.match(a.last('fail').m, /not here/);
});
