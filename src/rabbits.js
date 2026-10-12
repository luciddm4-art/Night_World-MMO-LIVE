// Rabbits are simulated by the server; here we draw them, smooth their movement,
// and show the feedback: hit flash + knockback, HP bar, "!" alert, corpse glow.
import { CFG } from '../shared/data.js';
import { S } from './state.js';
import { T, scene } from './scene.js';
import { mkRabbit } from './figures.js';
import { hgt } from './terrain.js';
import { burst, floatText } from './fx.js';
import { sfx } from './audio.js';
import { vibrate } from './settings.js';

function spriteFrom(draw, w, h, sw, sh) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g);
  const tex = new T.CanvasTexture(c);
  const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(sw, sh, 1);
  return { sp, c, g, tex };
}

function drawBar(g, pct) {
  g.clearRect(0, 0, 64, 10);
  g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(0, 0, 64, 10);
  g.fillStyle = '#c83232'; g.fillRect(2, 2, 60 * Math.max(0, pct), 6);
}

function ensureBar(r) {
  if (r.bar) return r.bar;
  const b = spriteFrom((g) => drawBar(g, 1), 64, 10, 1.1, 0.17);
  b.sp.position.y = 1.15;
  r.mesh.add(b.sp);
  return (r.bar = b);
}
function setBar(r, hp) {
  r.hp = hp;
  if (r.dead) { if (r.bar) r.bar.sp.visible = false; return; }
  if (hp >= CFG.RABBIT_HP) { if (r.bar) r.bar.sp.visible = false; return; }
  const b = ensureBar(r);
  b.sp.visible = true;
  drawBar(b.g, hp / CFG.RABBIT_HP);
  b.tex.needsUpdate = true;
}
function setAlert(r, on) {
  if (on === r.alertOn) return;
  r.alertOn = on;
  if (on && !r.alert) {
    const a = spriteFrom((g) => {
      g.font = 'bold 56px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 8; g.strokeStyle = '#000'; g.strokeText('!', 32, 36);
      g.fillStyle = '#ff4a3a'; g.fillText('!', 32, 36);
    }, 64, 64, 0.55, 0.55);
    a.sp.position.y = 1.6;
    r.mesh.add(a.sp);
    r.alert = a;
  }
  if (r.alert) r.alert.sp.visible = on && !r.dead;
}

function makeCorpse(r) {
  r.dead = true;
  r.x = r.tx; r.z = r.tz;
  r.mesh.userData.body.rotation.z = Math.PI / 2;
  r.mesh.userData.body.position.y = 0.12;
  r.mesh.rotation.y = Math.random() * 6.28;
  setAlert(r, false);
  if (r.bar) r.bar.sp.visible = false;
  const ring = new T.Mesh(
    new T.RingGeometry(0.4, 0.62, 20),
    new T.MeshBasicMaterial({ color: 0xf2d34a, transparent: true, opacity: 0.7, side: T.DoubleSide, depthWrite: false, fog: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  r.mesh.add(ring);
  r.ring = ring;
  r.mesh.position.set(r.x, hgt(r.x, r.z), r.z);
}

function dispose(r) {
  scene.remove(r.mesh);
  r.mesh.traverse((o) => {
    if (o.isSprite) { o.material.map && o.material.map.dispose(); o.material.dispose(); }
    if (o.isMesh && o.geometry) o.geometry.dispose();
  });
}

export function syncRabbits(list) {
  const seen = {};
  for (const e of list) {
    seen[e.i] = 1;
    let r = S.rabbits[e.i];
    if (!r) {
      const mesh = mkRabbit();
      mesh.position.set(e.x, hgt(e.x, e.z), e.z);
      scene.add(mesh);
      r = S.rabbits[e.i] = { id: e.i, mesh, x: e.x, z: e.z, tx: e.x, tz: e.z, dead: false, hp: CFG.RABBIT_HP, flash: 0, kx: 0, kz: 0 };
    }
    r.tx = e.x;
    r.tz = e.z;
    if (e.d && !r.dead) makeCorpse(r);
    else if (!e.d) {
      if (e.h !== r.hp) setBar(r, e.h);
      setAlert(r, !!e.a);
    }
  }
  for (const id in S.rabbits) {
    if (!seen[id]) { dispose(S.rabbits[id]); delete S.rabbits[id]; }
  }
}

export function clearRabbits() {
  for (const id in S.rabbits) dispose(S.rabbits[id]);
  S.rabbits = {};
}

// Server says someone hit a rabbit for real damage.
export function onHit(m) {
  const r = S.rabbits[m.i];
  if (!r) return;
  const by = m.by === S.myId ? S.P : S.others[m.by] ? S.others[m.by].g.position : null;
  r.flash = 1;
  if (by) {
    const dx = r.x - by.x, dz = r.z - by.z, d = Math.hypot(dx, dz) || 1;
    r.kx = (dx / d) * 0.6; r.kz = (dz / d) * 0.6;
  }
  const y = hgt(r.x, r.z);
  floatText(r.x, y + 1.0, r.z, String(m.d), m.k ? 'crit' : 'dmg');
  setBar(r, m.h);
  if (m.k) {
    burst(r.x, y + 0.3, r.z, { n: 18, color: 0xcfc2a8, speed: 2.2, up: 2.5, life: 0.6 });
    sfx('kill');
  } else {
    burst(r.x, y + 0.4, r.z, { n: 6, color: 0xff8a6a, speed: 1.6, up: 1.5, life: 0.35 });
    sfx('hit');
  }
  if (m.by === S.myId) vibrate(m.k ? 40 : 20);
}

export function updateRabbits(dt, now) {
  const f = Math.min(1, dt * 10), kd = Math.exp(-dt * 8);
  for (const id in S.rabbits) {
    const r = S.rabbits[id];
    if (r.dead) {
      if (r.ring) r.ring.material.opacity = 0.45 + Math.sin(now * 0.005) * 0.3;
      continue;
    }
    const dx = r.tx - r.x, dz = r.tz - r.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.002) {
      r.x += dx * f;
      r.z += dz * f;
      if (Math.hypot(dx, dz) > 0.03) r.mesh.rotation.y = Math.atan2(dx, dz);
    }
    r.kx *= kd; r.kz *= kd;
    r.mesh.position.set(r.x + r.kx, hgt(r.x, r.z), r.z + r.kz);
    if (r.flash > 0) {
      r.flash = Math.max(0, r.flash - dt * 4);
      r.mesh.userData.mat.emissive.setRGB(r.flash, r.flash * 0.15, r.flash * 0.1);
    }
    if (r.alert && r.alert.sp.visible) r.alert.sp.position.y = 1.6 + Math.sin(now * 0.012) * 0.07;
  }
}
