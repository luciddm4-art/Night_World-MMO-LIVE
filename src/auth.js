// Login / register / guest overlay. The server decides everything; we only
// remember a session token (never the password) so you stay logged in.
import { SEED } from './config.js';
import { S } from './state.js';
import { T } from './scene.js';
import { on, send } from './net.js';

const $ = (id) => document.getElementById(id);
const box = $('auth'), errEl = $('autherr');
const nameIn = $('authname'), passIn = $('authpass');
const btns = [$('loginbtn'), $('regbtn'), $('guestbtn')];
const HEX = /^#[0-9a-f]{6}$/i;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export function myColor() {
  let c = store.get('nwo_color');
  if (!HEX.test(c || '')) {
    c = '#' + new T.Color().setHSL(Math.random(), 0.6, 0.5).getHexString();
    store.set('nwo_color', c);
  }
  return c;
}

function busy(b) { btns.forEach((x) => { x.disabled = b; }); }
function showForm(msg) {
  busy(false);
  errEl.textContent = msg || '';
  box.classList.add('show');
}
function sendAuth(extra) {
  busy(true);
  send({ t: 'auth', seed: SEED, color: myColor(), ...extra });
}

export function logout() {
  store.del('nwo_token');
  location.reload();
}

export function initAuth() {
  on('open', () => {
    if (S.session && S.session.mode === 'guest') return sendAuth({ mode: 'guest' });
    const tok = store.get('nwo_token');
    if (tok) return sendAuth({ mode: 'token', token: tok });
    return showForm('');
  });
  on('auth_err', (m) => {
    if (m.clearToken) store.del('nwo_token');
    S.session = null;
    showForm(m.m);
  });
  on('welcome', (m) => {
    if (m.token) { store.set('nwo_token', m.token); S.session = { mode: 'token' }; } else S.session = { mode: 'guest' };
    box.classList.remove('show');
    busy(false);
    passIn.value = '';
  });

  const creds = () => ({ name: nameIn.value.trim(), pass: passIn.value });
  $('authform').addEventListener('submit', (e) => { e.preventDefault(); sendAuth({ mode: 'login', ...creds() }); });
  $('regbtn').addEventListener('click', () => sendAuth({ mode: 'register', ...creds() }));
  $('guestbtn').addEventListener('click', () => sendAuth({ mode: 'guest' }));
}
