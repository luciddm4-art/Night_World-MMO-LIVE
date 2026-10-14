// The trade window. The server owns the table; this only draws what it says and sends what you tap.
import { ITEMS, SOULBOUND, fmtCoins } from '../shared/data.js';
import { S } from './state.js';
import { send } from './net.js';
import { sfx } from './audio.js';
import { say } from './ui.js';

const $ = (id) => document.getElementById(id);
const win = $('trade'), req = $('tradereq');
let sel = null; // item id picked in the bag, waiting for a quantity
let reqTimer = 0;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const name = (id) => (ITEMS[id] ? ITEMS[id].n : id);
const bagCount = (id) => S.inv.slots.reduce((n, s) => n + (s && s.id === id ? s.n : 0), 0);

export const tradeOpen = () => !!S.trade;
export function requestTrade(id) {
  if (S.trade) { say('You are already trading'); return; }
  send({ t: 'trade', a: 'req', id });
}

export function initTrade() {
  win.addEventListener('click', onClick);
  req.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    send({ t: 'trade', a: b.dataset.a });
    hideReq();
  });
}
function hideReq() { req.classList.remove('show'); clearTimeout(reqTimer); }

export function onTrade(m) {
  if (m.a === 'req') {
    if (S.trade) return;
    req.innerHTML = esc(m.name) + ' wants to trade<div class="btns"><button class="go" data-a="accept">Accept</button><button data-a="decline">Decline</button></div>';
    req.classList.add('show');
    sfx('reward');
    clearTimeout(reqTimer);
    reqTimer = setTimeout(hideReq, 30000);
  } else if (m.a === 'state') {
    hideReq();
    if (!S.trade) sel = null;
    S.trade = m;
    render();
  } else if (m.a === 'end') {
    S.trade = null;
    sel = null;
    win.classList.remove('show');
    if (m.done) sfx('craft');
  }
}

const lines = (o) => o.items.map(([id, n]) => [id, n]);
function offerNow(mine, items, coins) { send({ t: 'trade', a: 'offer', items, coins }); }

function render() {
  const t = S.trade;
  if (!t) return;
  const mine = t.mine, theirs = t.theirs;
  const row = (id, n, mineSide) => '<div class="row"' + (mineSide ? ' data-rm="' + id + '" style="cursor:pointer"' : '') + '><span>' + esc(name(id)) + ' ×' + n + '</span>' + (mineSide ? '<b>✕</b>' : '') + '</div>';
  const side = (o, mineSide) => (o.items.length ? o.items.map(([id, n]) => row(id, n, mineSide)).join('') : '<div class="row none">nothing</div>') + '<div class="row"><span>Coins</span><b>' + fmtCoins(o.coins) + '</b></div>';
  let h = '<h3>Trade with ' + esc(t.with.name) + '</h3>';
  h += '<div class="cols"><div><h4>You give</h4>' + side(mine, true) + '<div class="state' + (mine.ok ? ' ok' : '') + '">' + (mine.ok ? 'You accepted ✓' : 'Not accepted') + '</div></div>';
  h += '<div><h4>You get</h4>' + side(theirs, false) + '<div class="state' + (theirs.ok ? ' ok' : '') + '">' + (theirs.ok ? 'They accepted ✓' : 'Not accepted') + '</div></div></div>';
  // coins you give
  h += '<h4>Your coins: ' + fmtCoins(S.coins) + '</h4><div class="qty"><input id="tr-coins" type="number" inputmode="numeric" min="0" step="1" value="' + mine.coins + '"><button data-a="setcoins">Set</button></div>';
  // bag
  const have = {};
  for (const s of S.inv.slots) if (s && !SOULBOUND.includes(s.id)) have[s.id] = (have[s.id] || 0) + s.n;
  for (const [id, n] of mine.items) if (have[id]) have[id] -= n;
  const ids = Object.keys(have).filter((id) => have[id] > 0);
  h += '<h4>Your bag — tap to add</h4><div class="chips">' + (ids.length ? ids.map((id) => '<button data-add="' + id + '">' + esc(name(id)) + ' ' + have[id] + '</button>').join('') : '<span style="color:#9aa6c8;font-size:12px">nothing left to offer</span>') + '</div>';
  if (sel && have[sel] > 0) {
    h += '<div class="qty"><span style="color:#fff;font-size:12px;flex:none">' + esc(name(sel)) + '</span><input id="tr-qty" type="number" inputmode="numeric" min="1" max="' + have[sel] + '" value="' + have[sel] + '"><button data-a="addqty" class="go">Add</button></div>';
  } else sel = null;
  h += '<div class="btns"><button data-a="lock" class="' + (mine.ok ? 'ok' : 'go') + '">' + (mine.ok ? 'Waiting… (tap to undo)' : 'Accept') + '</button><button data-a="cancel" class="x">Cancel</button></div>';
  // keep what the player is typing when the table refreshes
  const keepCoins = document.activeElement && document.activeElement.id === 'tr-coins' ? document.activeElement.value : null;
  win.innerHTML = h;
  if (keepCoins !== null) { const i = $('tr-coins'); i.value = keepCoins; i.focus(); }
  win.classList.add('show');
}

function onClick(e) {
  const t = S.trade;
  if (!t) return;
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    const id = rm.dataset.rm;
    return offerNow(t.mine, lines(t.mine).filter(([i]) => i !== id), t.mine.coins);
  }
  const add = e.target.closest('[data-add]');
  if (add) { sel = add.dataset.add; sfx('equip'); return render(); }
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'cancel') return send({ t: 'trade', a: 'cancel' });
  if (a === 'lock') return send({ t: 'trade', a: t.mine.ok ? 'unlock' : 'lock', v: t.v });
  if (a === 'setcoins') {
    const c = Math.max(0, Math.floor(Number($('tr-coins').value) || 0));
    if (c > S.coins) { say('You only have ' + fmtCoins(S.coins) + ' coins'); return; }
    return offerNow(t.mine, lines(t.mine), c);
  }
  if (a === 'addqty') {
    const q = Math.floor(Number($('tr-qty').value) || 0);
    if (q <= 0) return;
    const cur = lines(t.mine), at = cur.find(([i]) => i === sel);
    if (at) at[1] += q; else cur.push([sel, q]);
    if (cur.find(([i, n]) => i === sel)[1] > bagCount(sel)) { say('You do not have that many'); return; }
    sel = null;
    return offerNow(t.mine, cur, t.mine.coins);
  }
}
// the inventory changed while the table is open (e.g. a rabbit drop): redraw
export const refreshTrade = () => { if (S.trade) render(); };
export const cancelTrade = () => { if (S.trade) send({ t: 'trade', a: 'cancel' }); };
