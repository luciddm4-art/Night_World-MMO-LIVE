// Tiny synthesised sound effects (Web Audio). No audio files to download.
import { settings } from './settings.js';

let ctx = null, master = null, noiseBuf = null;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Browsers only allow audio after a tap/click/key: wake it up on the first one.
export function initAudio() {
  const wake = () => { ensure(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, wake, { once: true, passive: true }));
}

function tone(f0, f1, dur, { type = 'sine', vol = 0.3, delay = 0 } = {}) {
  const c = ensure();
  if (!c || settings.mute || c.state !== 'running') return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.3, f0 = 1500, f1 = 600, q = 1, delay = 0 } = {}) {
  const c = ensure();
  if (!c || settings.mute || c.state !== 'running') return;
  const t = c.currentTime + delay;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

const SFX = {
  swing: () => noise(0.13, { vol: 0.22, f0: 500, f1: 2400, q: 0.8 }),
  hit: () => { tone(160, 60, 0.12, { type: 'triangle', vol: 0.4 }); noise(0.08, { vol: 0.25, f0: 2000, f1: 800 }); },
  kill: () => { tone(220, 70, 0.28, { type: 'triangle', vol: 0.4 }); tone(330, 110, 0.2, { type: 'square', vol: 0.12, delay: 0.05 }); },
  tick: () => noise(0.05, { vol: 0.16, f0: 2600, f1: 1800, q: 3 }),
  pickup: () => { tone(520, 780, 0.09, { type: 'square', vol: 0.12 }); tone(780, 1170, 0.12, { type: 'square', vol: 0.1, delay: 0.07 }); },
  craft: () => { tone(880, 880, 0.25, { vol: 0.16 }); tone(1320, 1320, 0.2, { vol: 0.09, delay: 0.02 }); noise(0.06, { vol: 0.2, f0: 4000, f1: 3000, q: 4 }); },
  equip: () => { tone(300, 420, 0.07, { type: 'triangle', vol: 0.25 }); noise(0.04, { vol: 0.12, f0: 3000, f1: 2000 }); },
  hurt: () => { tone(200, 90, 0.22, { type: 'sawtooth', vol: 0.22 }); noise(0.1, { vol: 0.15, f0: 900, f1: 300 }); },
  error: () => tone(160, 120, 0.12, { type: 'square', vol: 0.08 }),
  step: () => noise(0.05, { vol: 0.07, f0: 380 + Math.random() * 150, f1: 200, q: 0.7 }),
  reward: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.18, { type: 'triangle', vol: 0.2, delay: i * 0.09 })); },
};

export function sfx(name) {
  const f = SFX[name];
  if (f) try { f(); } catch { /* audio is never worth crashing the game */ }
}
