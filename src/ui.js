import { S } from './state.js';

const $ = (id) => document.getElementById(id);
export const el = {
  toasts: $('toasts'), hpfill: $('hpfill'), hplabel: $('hplabel'), hud: $('hud'), who: $('who'),
  boot: $('boot'), bootmsg: $('bootmsg'), boothint: $('boothint'), err: $('err'),
};

// Stacked toasts: up to 4 lines, each fades on its own.
export function say(m) {
  const d = document.createElement('div');
  d.textContent = m;
  el.toasts.appendChild(d);
  while (el.toasts.children.length > 4) el.toasts.firstChild.remove();
  setTimeout(() => d.classList.add('out'), 2200);
  setTimeout(() => d.remove(), 2600);
}

export function showErr(m) {
  el.err.style.display = 'block';
  el.err.textContent += (el.err.textContent ? '\n\n' : '') + m;
}

export function updateHPUI() {
  const pct = Math.max(0, S.st.hp / S.st.maxHp);
  el.hpfill.style.width = pct * 100 + '%';
  el.hplabel.textContent = 'HP ' + Math.max(0, Math.round(S.st.hp)) + ' / ' + S.st.maxHp;
}

export function updateHud() {
  el.hud.textContent = 'DMG ' + Math.round(S.st.dmg * 100) + '%   CD ' + Math.round(S.st.haste * 100) + '%   DEF ' + Math.round(S.st.def * 100) + '%';
  el.who.textContent = (S.name ? S.name + ' · ' : '') + S.online + ' online';
}

export function showBoot(msg, hint = '') {
  el.boot.classList.add('show');
  el.bootmsg.textContent = msg;
  el.boothint.textContent = hint;
}
export function hideBoot() {
  el.boot.classList.remove('show');
}
