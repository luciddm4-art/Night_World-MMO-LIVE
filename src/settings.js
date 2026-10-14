// Player preferences, saved on this device only.
import { lights } from './scene.js';

const KEY = 'nwo_settings';
const defaults = { mute: false, vibrate: true, autoface: true, brightness: 1, gfx: 'smooth' };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export const settings = { ...defaults, ...load() };
settings.brightness = Math.min(2.2, Math.max(0.6, Number(settings.brightness) || 1));

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

export function applySettings() {
  lights.amb.intensity = lights.ambBase * settings.brightness;
  lights.dir.intensity = lights.dirBase * settings.brightness;
}

export function vibrate(ms) {
  if (settings.vibrate && navigator.vibrate) navigator.vibrate(ms);
}

export function initSettings() {
  applySettings();
  const box = document.getElementById('settings');
  box.innerHTML = '<h3>Settings</h3>'
    + '<label>Brightness <input id="set-bright" type="range" min="0.6" max="2.2" step="0.05"></label>'
    + '<label>Graphics <select id="set-gfx"><option value="smooth">Low-poly (smooth)</option><option value="pixel">Pixel (retro)</option></select></label>'
    + '<label>Sound <input id="set-sound" type="checkbox"></label>'
    + '<label>Vibration <input id="set-vib" type="checkbox"></label>'
    + '<label>Auto-face rabbits when attacking <input id="set-face" type="checkbox"></label>'
    + '<button type="button" id="set-close">Close</button>';
  const $ = (id) => document.getElementById(id);
  $('set-bright').value = settings.brightness;
  $('set-gfx').value = settings.gfx === 'pixel' ? 'pixel' : 'smooth';
  $('set-gfx').addEventListener('change', (e) => { settings.gfx = e.target.value; saveSettings(); location.reload(); }); // the picture mode is chosen when the page starts
  $('set-sound').checked = !settings.mute;
  $('set-vib').checked = settings.vibrate;
  $('set-face').checked = settings.autoface;
  $('set-bright').addEventListener('input', (e) => { settings.brightness = Number(e.target.value); applySettings(); saveSettings(); });
  $('set-sound').addEventListener('change', (e) => { settings.mute = !e.target.checked; saveSettings(); });
  $('set-vib').addEventListener('change', (e) => { settings.vibrate = e.target.checked; saveSettings(); });
  $('set-face').addEventListener('change', (e) => { settings.autoface = e.target.checked; saveSettings(); });
  $('set-close').addEventListener('click', () => box.classList.remove('open'));
  $('gear').addEventListener('click', () => box.classList.toggle('open'));
}
export const closeSettings = () => document.getElementById('settings').classList.remove('open');
