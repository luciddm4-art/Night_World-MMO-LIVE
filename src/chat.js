import { CHAT_MAX_LEN } from '../shared/data.js';
import { send } from './net.js';

const log = document.getElementById('chatlog');
const form = document.getElementById('chatform');
const input = document.getElementById('chatin');
const FADE_MS = 14000;

export const isTyping = () => document.activeElement === input;

export function addChat(name, text, system = false) {
  const d = document.createElement('div');
  if (system) {
    const i = document.createElement('i');
    i.textContent = text;
    d.appendChild(i);
  } else {
    const b = document.createElement('b');
    b.textContent = name + ': '; // textContent only: chat can never inject HTML
    d.appendChild(b);
    d.appendChild(document.createTextNode(text));
  }
  log.appendChild(d);
  while (log.children.length > 40) log.removeChild(log.firstChild);
  setTimeout(() => d.classList.add('old'), FADE_MS);
}

export function openChat() {
  form.classList.add('open');
  log.classList.add('open');
  input.focus();
}
export function closeChat() {
  form.classList.remove('open');
  log.classList.remove('open');
  input.blur();
}

export function initChat() {
  document.getElementById('chatbtn').addEventListener('click', () => (isTyping() ? closeChat() : openChat()));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim().slice(0, CHAT_MAX_LEN);
    if (v) send({ t: 'chat', m: v });
    input.value = '';
    closeChat();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keep WASD etc. out of the game while typing
    if (e.key === 'Escape') closeChat();
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
}
