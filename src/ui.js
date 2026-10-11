import { S } from './state.js';

const $ = (id) => document.getElementById(id);
export const el = {
  toast: $('toast'), hpfill: $('hpfill'), hplabel: $('hplabel'), hud: $('hud'), who: $('who'),
  boot: $('boot'), bootmsg: $('bootmsg'), boothint: $('boothint'), err: $('err'),
};

let tt = 0;
export function say(m) {
  el.toast.textContent = m;
  el.toast.style.opacity = 1;
  clearTimeout(tt);
  tt = setTimeout(() => { el.toast.style.opacity = 0; }, 2200);
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
