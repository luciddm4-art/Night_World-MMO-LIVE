// Skill buttons (Q W E R D), mana bar, potion and food buttons, buff chips and the spell cast bar.
// The server decides everything (cooldowns, mana, damage); this file shows it and sends the button presses.
import { CFG, ITEMS, POTIONS, FOODS, WEAPONS, weaponOf } from '../shared/data.js';
import * as SK from '../shared/skills.js';
import { SKILLS, SKILL_KEYS, skillIdsFor } from '../shared/skills.js';
import { S } from './state.js';
import { send } from './net.js';
import { say } from './ui.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';
import { autoFace } from './combat.js';
import { burst } from './fx.js';

const $ = (id) => document.getElementById(id);
const manaFill = $('manafill'), manaLabel = $('manalabel');
const castEl = $('cast'), castFill = $('castfill'), castLabel = $('castlabel');
const btn = {}; // k -> { el, cdo, cdt, lb, mc, kk, id }
const cons = {}; // 'potion' | 'food' -> { el, lb, cnt, cdo, cdt, on }
let buffsEl = null;

export const manaNow = (now = performance.now()) => Math.min(S.mana.max, S.mana.v + (S.mana.rate * (now - S.mana.at)) / 1000);

// ---- text for tooltips (also used by the inventory)
const pct = (v) => Math.round(v * 100) + '%';
export function describeSkill(id) {
  const sk = SKILLS[id];
  if (!sk) return '';
  const lines = [sk.n + '  —  ' + sk.mana + ' mana, ' + sk.cd / 1000 + 's cooldown' + (sk.cast > 0 ? ', ' + sk.cast / 1000 + 's cast' : '')];
  if (sk.d) lines.push(sk.d);
  return lines.join('\n');
}
export function describeConsumable(id) {
  const out = [];
  const p = POTIONS[id], f = FOODS[id];
  if (p) {
    if (p.heal) out.push('Restores ' + p.heal + ' HP');
    if (p.healPct) out.push('Restores ' + pct(p.healPct) + ' of max HP');
    if (p.mana) out.push('Restores ' + p.mana + ' mana');
    out.push('Cooldown ' + (p.cd ?? CFG.POTION_CD_MS) / 1000 + 's');
  } else if (f) {
    const b = f.buff || {};
    const names = { hp: 'max HP', dmg: 'damage', regen: 'HP regeneration', dr: 'less damage taken', mp: 'max mana', mregen: 'mana regeneration' };
    const parts = Object.keys(b).filter((k) => names[k]).map((k) => '+' + pct(b[k]) + ' ' + names[k]);
    out.push((parts.join(', ') || 'A snack') + ' for ' + CFG.FOOD_MS / 60000 + ' minutes');
  }
  return out;
}
export function skillLinesFor(itemId) {
  const out = [];
  const list = [];
  (SK.WEAPON_SKILLS[itemId] || []).forEach((id, i) => id && list.push(['QWE'[i], id]));
  if (SK.CHEST_SKILLS[itemId]) list.push(['R', SK.CHEST_SKILLS[itemId]]);
  if (SK.HELMET_SKILLS[itemId]) list.push(['D', SK.HELMET_SKILLS[itemId]]);
  for (const [k, id] of list) if (SKILLS[id]) out.push('Skill ' + k + ': ' + SKILLS[id].n + ' (' + SKILLS[id].mana + ' mana)');
  return out;
}

// ---- building the buttons
export function initSkills() {
  const wrap = $('skills');
  SKILL_KEYS.forEach((k) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sk empty';
    el.dataset.k = k;
    el.innerHTML = '<span class="kk">' + k.toUpperCase() + '</span><span class="lb"></span><span class="mc"></span><span class="cdo"></span><span class="cdt"></span>';
    wrap.appendChild(el);
    btn[k] = { el, id: null, lb: el.querySelector('.lb'), mc: el.querySelector('.mc'), cdo: el.querySelector('.cdo'), cdt: el.querySelector('.cdt'), p: -1, t: '' };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); useSkill(k); });
  });
  const box = $('cons');
  [['potion', 'potbtn', 'Z'], ['food', 'foodbtn', 'X']].forEach(([slot, id, key]) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.id = id;
    el.className = 'cb empty';
    el.innerHTML = '<span class="kk">' + key + '</span><span class="on"></span><span class="lb"></span><span class="cnt"></span><span class="cdo"></span><span class="cdt"></span>';
    box.appendChild(el);
    cons[slot] = { el, lb: el.querySelector('.lb'), cnt: el.querySelector('.cnt'), cdo: el.querySelector('.cdo'), cdt: el.querySelector('.cdt'), on: el.querySelector('.on'), p: -1, t: '', ot: '' };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); useConsumable(slot); });
  });
  buffsEl = $('buffs');
  refreshSkills();
}

// Called whenever the equipment changes.
export function refreshSkills() {
  const ids = skillIdsFor(S.inv.eq);
  for (const k of SKILL_KEYS) {
    const b = btn[k];
    if (!b) continue;
    const id = ids[k], sk = id && SKILLS[id];
    b.id = sk ? id : null;
    b.el.classList.toggle('empty', !sk);
    b.lb.textContent = sk ? sk.s || sk.n.slice(0, 2).toUpperCase() : '';
    b.mc.textContent = sk ? sk.mana : '';
    b.el.title = sk ? describeSkill(id) : k.toUpperCase() + ' — no skill (comes from ' + (k === 'r' ? 'your chest armour' : k === 'd' ? 'your helmet' : 'your weapon') + ')';
  }
  for (const slot of ['potion', 'food']) {
    const c = cons[slot];
    if (!c) continue;
    const it = S.inv.eq[slot];
    c.el.classList.toggle('empty', !it);
    c.lb.textContent = it && ITEMS[it.id] ? ITEMS[it.id].s : slot === 'potion' ? 'PT' : 'FD';
    c.cnt.textContent = it ? it.n : '';
    c.el.title = it ? ITEMS[it.id].n + '\n' + describeConsumable(it.id).join('\n') : (slot === 'potion' ? 'Potion slot (equip a potion from your bag)' : 'Food slot (equip a food from your bag)');
  }
}

// ---- pressing buttons
export function useSkill(i) {
  const k = typeof i === 'number' ? SKILL_KEYS[i] : i;
  const b = btn[k];
  if (!b || !S.ready || !b.id) return;
  const sk = SKILLS[b.id], now = performance.now();
  if (S.mounted) { say('You cannot cast while riding'); sfx('error'); return; }
  if (S.spell) return;
  if (S.gather.active) return;
  if (now < S.gcdUntil) return;
  const cd = S.cd[b.id];
  if (cd && now < cd.until) return;
  if (manaNow(now) < sk.mana) { say('Not enough mana'); sfx('error'); return; }
  S.gcdUntil = now + CFG.GCD_MS * 0.8;
  const dmg = (sk.effects || []).find((e) => e.kind === 'damage' && e.shape !== 'circle');
  if (dmg && settings.autoface) autoFace({ reach: isFinite(dmg.range) && dmg.range ? dmg.range : weaponOf(S.inv.eq).reach });
  sfx(sk.cast > 0 ? 'cast' : 'skill');
  send({ t: 'skill', k, r: S.P.r });
}

export function useConsumable(slot) {
  if (!S.ready) return;
  const it = S.inv.eq[slot];
  if (!it) { say(slot === 'potion' ? 'No potion equipped — equip one from your bag' : 'No food equipped — equip one from your bag'); sfx('error'); return; }
  if (slot === 'potion') {
    const cd = S.cd.potion;
    if (cd && performance.now() < cd.until) return;
  }
  send({ t: 'use', slot });
}

// ---- messages from the server
const startCd = (id, ms) => { S.cd[id] = { until: performance.now() + ms, total: ms }; };
export function onMana(m) { S.mana.v = m.v; S.mana.max = m.max; S.mana.rate = m.rate; S.mana.at = performance.now(); }
export function onCd(m) { startCd(m.id, m.ms); if (m.id === 'potion') sfx('drink'); }
export function onBuffs(m) {
  const now = performance.now();
  updateSkills.t = 0; // redraw the chips now
  const prevFood = S.buffs.food;
  S.buffs = { list: (m.list || []).map((b) => ({ id: b.id, until: now + b.ms })), food: m.food ? { id: m.food.id, until: now + m.food.ms } : null };
  if (m.food && !(prevFood && prevFood.id === m.food.id && prevFood.until > now + m.food.ms - 5000)) sfx('eat'); // a new meal, not just a resend
  refreshSkills();
}
export function onScast(m) {
  const sk = SKILLS[m.id];
  S.spell = { id: m.id, start: performance.now(), dur: m.dur };
  castEl.style.display = 'block';
  castLabel.style.display = 'block';
  castLabel.textContent = sk ? sk.n : 'Casting';
  castFill.style.width = '0%';
}
export function hideSpell() {
  if (!S.spell) return;
  S.spell = null;
  castEl.style.display = 'none';
  castLabel.style.display = 'none';
  castFill.style.width = '0%';
}
export function onScancel() { hideSpell(); }
export function cancelSpellByMoving() {
  if (!S.spell) return;
  hideSpell();
  send({ t: 'scancel' });
  say('Cast interrupted');
}
export function onSkillFx(m, whereOf) {
  const pos = whereOf(m.by);
  if (!pos) return;
  const sk = SKILLS[m.id] || {};
  const col = sk.col || 0xf2d34a;
  burst(pos.x, pos.y + 0.9, pos.z, { n: 22, color: col, speed: 3.2, up: 1.2, life: 0.55, grav: 0 });
  burst(pos.x, pos.y + 0.2, pos.z, { n: 12, color: 0xffffff, speed: 2, up: 0.4, life: 0.35, grav: 0 });
  if (m.by !== S.myId) sfx('skill');
}

// ---- every frame: cooldown rings, mana bar, cast bar, chips
function setRing(o, p, text) {
  const q = Math.round(p * 100);
  if (q !== o.p) { o.p = q; o.cdo.style.setProperty('--p', q + '%'); }
  if (text !== o.t) { o.t = text; o.cdt.textContent = text; }
}
const secs = (ms) => (ms >= 10000 ? Math.ceil(ms / 1000) : (Math.ceil(ms / 100) / 10).toFixed(1)) + '';
const clock = (ms) => (ms >= 60000 ? Math.ceil(ms / 60000) + 'm' : Math.ceil(ms / 1000) + 's');

export function updateSkills(now) {
  const mana = manaNow(now);
  manaFill.style.width = (S.mana.max > 0 ? (mana / S.mana.max) * 100 : 0) + '%';
  const ml = 'MP ' + Math.floor(mana) + ' / ' + S.mana.max;
  if (manaLabel.textContent !== ml) manaLabel.textContent = ml;

  for (const k of SKILL_KEYS) {
    const b = btn[k];
    if (!b) continue;
    if (!b.id) { if (b.p !== 0) setRing(b, 0, ''); continue; }
    const cd = S.cd[b.id];
    const left = cd ? cd.until - now : 0;
    b.lb.style.opacity = left > 0 ? '0.25' : '';
    if (left > 0) setRing(b, left / cd.total, secs(left));
    else if (S.spell && S.spell.id !== b.id) setRing(b, 0, '');
    else setRing(b, 0, '');
    b.el.classList.toggle('nomana', mana < SKILLS[b.id].mana);
    b.el.style.opacity = S.mounted ? '0.4' : '';
  }
  for (const slot of ['potion', 'food']) {
    const c = cons[slot];
    if (!c) continue;
    const cd = slot === 'potion' ? S.cd.potion : null;
    const left = cd ? cd.until - now : 0;
    if (left > 0) setRing(c, left / cd.total, secs(left)); else setRing(c, 0, '');
    const fed = slot === 'food' && S.buffs.food && S.buffs.food.until > now;
    c.el.classList.toggle('fed', !!fed);
    const ot = fed ? clock(S.buffs.food.until - now) : '';
    if (ot !== c.ot) { c.ot = ot; c.on.textContent = ot; }
  }
  if (S.spell) {
    const u = (now - S.spell.start) / S.spell.dur;
    castFill.style.width = Math.min(100, u * 100) + '%';
    if (u > 1.3) hideSpell(); // the server's answer was lost; never leave the bar stuck
  }
  // buff chips (rebuilt once a second)
  if (buffsEl && now - (updateSkills.t || 0) > 500) {
    updateSkills.t = now;
    let h = '';
    for (const b of S.buffs.list) if (b.until > now) h += '<span>' + ((SKILLS[b.id] && SKILLS[b.id].n) || b.id) + ' ' + clock(b.until - now) + '</span>';
    if (S.buffs.food && S.buffs.food.until > now) h += '<span class="food">' + ((ITEMS[S.buffs.food.id] && ITEMS[S.buffs.food.id].n) || 'Food') + ' ' + clock(S.buffs.food.until - now) + '</span>';
    if (S.ride.gallop) h = '<span class="gal">Gallop +10%</span>' + h;
    if (buffsEl.innerHTML !== h) buffsEl.innerHTML = h;
  }
}
