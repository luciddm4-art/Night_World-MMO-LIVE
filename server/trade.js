// Player-to-player trading. Anyone in the same world can trade, anywhere on the map.
// Flow: A asks B (`req`) -> B accepts -> both put items (from the bag) and coins on the table (`offer`) ->
// both press Accept (`lock`) on the same version of the table -> the swap happens in one step, or not at all.
// Any change to either offer clears both accepts, and `lock` carries the version the player saw, so an offer cannot
// be switched under someone's finger. Equipped items are not on offer. Soulbound items cannot be traded.
import { ITEMS, SOULBOUND, CFG } from '../shared/data.js';
import * as Inv from '../shared/inventory.js';

export const TRADE_REQ_MS = 30000;
const MAX_LINES = 12; // different items on one side of the table

const int = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);

export class Trades {
  constructor(room) { this.room = room; }

  // ---- asking
  request(p, m) {
    const room = this.room, now = room.now();
    const t = room.players.get(String(m.id));
    if (!t || t === p) return room.fail(p, 'That player is not here');
    if (p.trade) return room.fail(p, 'Finish your current trade first');
    if (t.trade) return room.fail(p, t.name + ' is busy trading');
    if (now - (p.lastTradeReq || 0) < 1500) return;
    p.lastTradeReq = now;
    t.tradeReq = { from: p.id, until: now + TRADE_REQ_MS };
    t.send({ t: 'trade', a: 'req', from: p.id, name: p.name });
    room.toast(p, 'Trade request sent to ' + t.name);
  }

  respond(p, accept) {
    const room = this.room, now = room.now();
    const r = p.tradeReq;
    p.tradeReq = null;
    const from = r && room.players.get(r.from);
    if (!r || now > r.until || !from) return room.fail(p, 'That trade request is no longer valid');
    if (!accept) return room.toast(from, p.name + ' declined the trade');
    if (p.trade || from.trade) return room.fail(p, 'Someone is already busy trading');
    const s = { a: from, b: p, v: 1, offer: { [from.id]: { items: {}, coins: 0 }, [p.id]: { items: {}, coins: 0 } }, ok: { [from.id]: false, [p.id]: false } };
    from.trade = p.trade = s;
    this.push(s);
  }

  // ---- on the table
  offer(p, m) {
    const s = p.trade;
    if (!s) return;
    const room = this.room;
    const items = {};
    const raw = Array.isArray(m.items) ? m.items.slice(0, 40) : [];
    for (const e of raw) {
      if (!Array.isArray(e)) continue;
      const id = String(e[0]), n = int(e[1]);
      if (!ITEMS[id] || !n || SOULBOUND.includes(id)) continue;
      items[id] = (items[id] || 0) + n;
    }
    if (Object.keys(items).length > MAX_LINES) return room.fail(p, 'Too many different items');
    for (const id in items) if (Inv.countItem(p.inv, id) < items[id]) return room.fail(p, 'You do not have that many ' + ITEMS[id].n);
    const coins = int(m.coins);
    if (coins > p.coins) return room.fail(p, 'You do not have that many coins');
    s.offer[p.id] = { items, coins };
    s.v++;
    s.ok[s.a.id] = s.ok[s.b.id] = false;
    this.push(s);
  }

  lock(p, m) {
    const s = p.trade;
    if (!s) return;
    if (m.v !== s.v) { this.push(s); return this.room.fail(p, 'The offer just changed — check it again'); }
    s.ok[p.id] = true;
    if (s.ok[s.a.id] && s.ok[s.b.id]) return this.finish(s);
    this.push(s);
  }

  unlock(p) {
    const s = p.trade;
    if (!s || !s.ok[p.id]) return;
    s.ok[p.id] = false;
    this.push(s);
  }

  // ---- the swap
  finish(s) {
    const room = this.room;
    const { a, b } = s;
    const oa = s.offer[a.id], ob = s.offer[b.id];
    const refuse = (why) => {
      s.ok[a.id] = s.ok[b.id] = false;
      room.fail(a, why);
      room.fail(b, why);
      this.push(s);
    };
    if (oa.coins > a.coins || ob.coins > b.coins) return refuse('Someone no longer has the coins');
    if (a.coins - oa.coins + ob.coins > CFG.COINS_MAX || b.coins - ob.coins + oa.coins > CFG.COINS_MAX) return refuse('Too many coins');
    const wa = Inv.cloneInv(a.inv), wb = Inv.cloneInv(b.inv);
    for (const id in oa.items) if (Inv.countItem(wa, id) < oa.items[id]) return refuse('Someone no longer has the items');
    for (const id in ob.items) if (Inv.countItem(wb, id) < ob.items[id]) return refuse('Someone no longer has the items');
    for (const id in oa.items) Inv.removeItems(wa, id, oa.items[id]);
    for (const id in ob.items) Inv.removeItems(wb, id, ob.items[id]);
    for (const id in ob.items) if (!Inv.addItem(wa, id, ob.items[id])) return refuse(a.name + ' does not have enough bag space');
    for (const id in oa.items) if (!Inv.addItem(wb, id, oa.items[id])) return refuse(b.name + ' does not have enough bag space');
    a.inv = wa; b.inv = wb;
    a.coins += ob.coins - oa.coins;
    b.coins += oa.coins - ob.coins;
    a.trade = b.trade = null;
    for (const [me, other, got] of [[a, b, ob], [b, a, oa]]) {
      me.send({ t: 'trade', a: 'end', done: 1 });
      room.toast(me, 'Trade with ' + other.name + ' complete');
      for (const id in got.items) room.gain(me, id, got.items[id], 'trade');
      room.sendInv(me);
    }
  }

  // ---- ending
  cancel(p, why) {
    const s = p.trade;
    if (!s) return;
    s.a.trade = s.b.trade = null;
    for (const q of [s.a, s.b]) {
      q.send({ t: 'trade', a: 'end', why: q === p ? '' : why || '' });
      if (q !== p && why) this.room.toast(q, why);
    }
  }

  push(s) {
    for (const [me, other] of [[s.a, s.b], [s.b, s.a]]) {
      const view = (o, ok) => ({ items: Object.entries(o.items), coins: o.coins, ok });
      me.send({ t: 'trade', a: 'state', v: s.v, with: { id: other.id, name: other.name }, mine: view(s.offer[me.id], s.ok[me.id]), theirs: view(s.offer[other.id], s.ok[other.id]) });
    }
  }
}
