import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';
import { makeFilter, reservedName, parseCommand } from '../server/moderation.js';

const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const BAD = rot13('shpx'), BAD2 = rot13('fuvg'), BAD3 = rot13('phag');

test('filter hides bad words, even when disguised, and leaves normal text alone', () => {
  const f = makeFilter();
  assert.equal(f.clean(`what the ${BAD} is this`), 'what the **** is this');
  assert.equal(f.clean(`${BAD.toUpperCase()}ING hell`), '****ING hell');
  assert.ok(!f.clean(`f.u.c.k that`).includes('f.u'));
  assert.equal(f.clean(`you ${BAD2}!`), 'you ****!');
  assert.ok(f.clean(`${BAD.replace('u', 'v')}`).startsWith('f')); // not a bad word at all
  for (const ok of ['Hello there, friend', 'Scunthorpe', 'class assume bass', 'shiitake mushrooms', 'I scored 100 points', 'Cassandra', 'The ' + BAD3.slice(0, 2) + 'rse is long', 'Bitcoin', 'night world rocks']) {
    assert.equal(f.clean(ok), ok, ok);
  }
  assert.equal(makeFilter(['grumble']).clean('so much grumble here'), 'so much ******* here');
});

test('names: reserved and rude names are refused', () => {
  const f = makeFilter();
  for (const n of ['admin', 'Admin_1', 'moderator', 'Server', 'Guest12', 'Guest', 'NightWorld', 'staff99']) assert.ok(reservedName(n), n);
  for (const n of ['Rabbit', 'Guesty', 'Adminton', 'Wizard_7']) assert.ok(!reservedName(n), n);
  assert.ok(f.badName('xx_' + BAD + '_xx'));
  assert.ok(f.badName(BAD2.toUpperCase() + '123'));
  assert.ok(!f.badName('Wizard_7'));
});

test('command parser', () => {
  assert.deepEqual(parseCommand('/Mute Bob 30 spam'), { cmd: 'mute', args: ['Bob', '30', 'spam'], rest: 'Bob 30 spam' });
  assert.deepEqual(parseCommand('/help'), { cmd: 'help', args: [], rest: '' });
  assert.equal(parseCommand('hello'), null);
});

// ------------------------------------------------------------------ over the wire
function sock(url) {
  const ws = new WebSocket(url);
  const msgs = [];
  ws.on('message', (raw) => { try { msgs.push(JSON.parse(raw)); } catch { /* ignore */ } });
  ws.on('error', () => {});
  const closed = new Promise((res) => ws.on('close', (c) => res(c)));
  const opened = new Promise((res) => { ws.on('open', res); ws.on('close', res); });
  const until = async (pred, ms = 2500) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const m = msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 15)); }
    return null;
  };
  return { ws, msgs, closed, opened, until, send: (o) => ws.send(JSON.stringify(o)) };
}
async function join(env, extra) {
  const c = sock(env.url); await c.opened;
  c.send({ t: 'auth', seed: 7, ...extra });
  const res = await c.until((m) => m.t === 'welcome' || m.t === 'auth_err');
  return { c, res };
}
async function boot(opts = {}) {
  const gs = createGameServer({ port: 0, host: '127.0.0.1', dataDir: null, tickMs: 50, databaseUrl: '', admins: ['Boss1'], ...opts });
  const port = await gs.listen();
  return { gs, url: `ws://127.0.0.1:${port}` };
}
const text = (c, t) => c.msgs.filter((m) => m.t === t).map((m) => m.m);

test('chat is filtered on the server and reserved/rude names cannot register', async () => {
  const env = await boot();
  try {
    for (const name of ['Admin', 'Guest7', BAD2 + '_king']) {
      const { res } = await join(env, { mode: 'register', name, pass: 'pw-123456' });
      assert.equal(res.t, 'auth_err', name);
      assert.match(res.m, /not allowed/);
    }
    const a = await join(env, { mode: 'guest' }); const b = await join(env, { mode: 'guest' });
    a.c.send({ t: 'chat', m: `you ${BAD} idiot` });
    const got = await b.c.until((m) => m.t === 'chat');
    assert.equal(got.m, 'you **** idiot');
    [a, b].forEach((x) => x.c.ws.terminate());
  } finally { await env.gs.stop(); }
});

test('admin commands: report, mute, kick, ban/unban, say, and non-admins cannot use them', async () => {
  const env = await boot();
  try {
    const boss = await join(env, { mode: 'register', name: 'Boss1', pass: 'pw-123456' });
    assert.equal(boss.res.t, 'welcome');
    const victimAcct = await join(env, { mode: 'register', name: 'Victim1', pass: 'pw-123456' });
    const guest = await join(env, { mode: 'guest' });
    const guestName = guest.res.you?.name || guest.res.name || [...env.gs.entries].find((e) => e.player.name.startsWith('Guest')).player.name;
    const B = boss.c, V = victimAcct.c, G = guest.c;

    // players can report; the admin sees it
    G.send({ t: 'chat', m: '/report Victim1 being rude' });
    assert.ok(await G.until((m) => m.t === 'toast' && /moderators/.test(m.m)));
    B.send({ t: 'chat', m: '/reports' });
    assert.ok(await B.until((m) => m.t === 'toast' && /reported Victim1: being rude/.test(m.m)));
    assert.equal(env.gs.reports.length, 1);

    // ordinary players get nothing from admin commands (and are not told they exist)
    G.send({ t: 'chat', m: '/kick Victim1' });
    assert.ok(await G.until((m) => m.t === 'fail' && /Unknown command/.test(m.m)));
    assert.ok(env.gs.entries.size === 3);

    // mute: the muted player can't talk, then can after /unmute
    B.send({ t: 'chat', m: '/mute Victim1 5' });
    assert.ok(await V.until((m) => m.t === 'toast' && /muted you/.test(m.m)));
    V.send({ t: 'chat', m: 'hello?' });
    assert.ok(await V.until((m) => m.t === 'fail' && /muted/.test(m.m)));
    B.send({ t: 'chat', m: '/unmute Victim1' });
    await new Promise((r) => setTimeout(r, 80));
    V.send({ t: 'chat', m: 'thanks' });
    assert.ok(await B.until((m) => m.t === 'chat' && m.m === 'thanks'));

    // say
    B.send({ t: 'chat', m: '/say Server restarts soon' });
    assert.ok(await G.until((m) => m.t === 'chat' && m.n === 'Server' && m.m === 'Server restarts soon'));

    // kick a guest
    B.send({ t: 'chat', m: '/kick ' + guestName });
    assert.ok(await G.until((m) => m.t === 'kick'));
    await G.closed;

    // ban an account: kicked now, refused at login, tokens too; unban lets them back
    const token = victimAcct.res.token;
    B.send({ t: 'chat', m: '/ban Victim1 griefing' });
    assert.ok(await V.until((m) => m.t === 'kick' && /banned: griefing/.test(m.m)));
    await V.closed;
    const again = await join(env, { mode: 'login', name: 'Victim1', pass: 'pw-123456' });
    assert.equal(again.res.t, 'auth_err'); assert.match(again.res.m, /banned: griefing/);
    const viaToken = await join(env, { mode: 'token', token });
    assert.equal(viaToken.res.t, 'auth_err');
    B.send({ t: 'chat', m: '/unban Victim1' });
    assert.ok(await B.until((m) => m.t === 'toast' && /Unbanned/.test(m.m)));
    const back = await join(env, { mode: 'login', name: 'Victim1', pass: 'pw-123456' });
    assert.equal(back.res.t, 'welcome');

    // admins are protected from each other
    B.send({ t: 'chat', m: '/kick Boss1' });
    assert.ok(await B.until((m) => m.t === 'fail' && /another admin/.test(m.m)));
    B.ws.terminate(); back.c.ws.terminate();
  } finally { await env.gs.stop(); }
});

test('a ban is saved with the account', async () => {
  const env = await boot();
  try {
    await join(env, { mode: 'register', name: 'Troll1', pass: 'pw-123456' });
    assert.equal(env.gs.store.setBan('Troll1', { reason: 'x', by: 'Boss1', ts: 1 }), true);
    assert.equal(env.gs.store.get('troll1').banned.reason, 'x');
    env.gs.store.setBan('Troll1', null);
    assert.equal(env.gs.store.get('troll1').banned, undefined);
    assert.equal(env.gs.store.setBan('Nobody', { reason: 'x' }), false);
  } finally { await env.gs.stop(); }
});

test('/give: admins can put an item in their own bag, other players cannot', async () => {
  const env = await boot();
  try {
    const boss = await join(env, { mode: 'register', name: 'Boss1', pass: 'pw-123456' });
    const guest = await join(env, { mode: 'guest' });
    guest.c.send({ t: 'chat', m: '/give sword' });
    assert.ok(await guest.c.until((m) => m.t === 'fail' && /Unknown command/.test(m.m)));
    boss.c.send({ t: 'chat', m: '/give nonsense' });
    assert.ok(await boss.c.until((m) => m.t === 'fail' && /Usage: \/give/.test(m.m)));
    boss.c.send({ t: 'chat', m: '/give plank 5' });
    const inv = await boss.c.until((m) => m.t === 'inv' && m.inv.slots.some((s) => s && s.id === 'plank' && s.n === 5));
    assert.ok(inv);
    [boss, guest].forEach((x) => x.c.ws.terminate());
  } finally { await env.gs.stop(); }
});

test('/teleport: admins can go to coordinates, a player, the town or the portal; others cannot', async () => {
  const env = await boot();
  try {
    const boss = await join(env, { mode: 'register', name: 'Boss1', pass: 'pw-123456' });
    const guest = await join(env, { mode: 'register', name: 'Plain1', pass: 'pw-123456' });
    guest.c.send({ t: 'chat', m: '/teleport 100 100' });
    assert.ok(await guest.c.until((m) => m.t === 'fail' && /Unknown command/.test(m.m)));
    const room = env.gs.rooms.get(7);
    const me = [...room.players.values()].find((q) => q.name === 'Boss1');
    const other = [...room.players.values()].find((q) => q.name === 'Plain1');
    boss.c.send({ t: 'chat', m: '/teleport 1200 -800' });
    assert.ok(await boss.c.until((m) => m.t === 'pos' && m.x === 1200 && m.z === -800));
    assert.equal(me.x, 1200); assert.equal(me.z, -800);
    // a position packet that was already on its way must not drag the admin back
    boss.c.send({ t: 'pos', x: 5, z: 5, r: 0 });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(me.x, 1200);
    boss.c.send({ t: 'chat', m: '/tp 99999 0' });
    assert.ok(await boss.c.until((m) => m.t === 'fail' && /outside the map/.test(m.m)));
    boss.c.send({ t: 'chat', m: '/teleport portal' });
    await boss.c.until((m) => m.t === 'pos' && m.z > 4000);
    assert.ok(me.z > 4000 && me.z < 4455);
    other.x = 300; other.z = 400;
    boss.c.send({ t: 'chat', m: '/teleport plain1' });
    await boss.c.until((m) => m.t === 'pos' && m.x > 299 && m.x < 305);
    assert.ok(Math.abs(me.x - 301.5) < 0.1 && me.z === 400);
    boss.c.send({ t: 'chat', m: '/teleport town' });
    await boss.c.until((m) => m.t === 'pos' && m.z === 22);
    assert.equal(me.z, 22);
    boss.c.send({ t: 'chat', m: '/teleport' });
    assert.ok(await boss.c.until((m) => m.t === 'fail' && /Usage: \/teleport/.test(m.m)));
    [boss, guest].forEach((x) => x.c.ws.terminate());
  } finally { await env.gs.stop(); }
});

test('coins: new players have none, an admin account gets 10 billion once', async () => {
  const env = await boot();
  try {
    const boss = await join(env, { mode: 'register', name: 'Boss1', pass: 'pw-123456' });
    const other = await join(env, { mode: 'register', name: 'Plain1', pass: 'pw-123456' });
    assert.equal(boss.res.you.coins, 10_000_000_000);
    assert.equal(other.res.you.coins, 0);
    boss.c.ws.terminate();
    await new Promise((r) => setTimeout(r, 150));
    const again = await join(env, { mode: 'login', name: 'Boss1', pass: 'pw-123456' });
    assert.equal(again.res.t, 'welcome');
    assert.equal(again.res.you.coins, 10_000_000_000, 'saved, and not granted a second time');
    [again, other].forEach((x) => x.c.ws.terminate());
  } finally { await env.gs.stop(); }
});
