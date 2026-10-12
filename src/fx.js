// Visual feedback: particles, floating numbers, screen shake, hurt vignette,
// and the "+1" icon that flies into the inventory bar.
import { ITEMS } from '../shared/data.js';
import { S } from './state.js';
import { T, scene, cam, view } from './scene.js';

// ------------------------------------------------------------ particles
const MAXP = 400;
const pos = new Float32Array(MAXP * 3), col = new Float32Array(MAXP * 3);
const geo = new T.BufferGeometry();
geo.setAttribute('position', new T.BufferAttribute(pos, 3));
geo.setAttribute('color', new T.BufferAttribute(col, 3));
geo.setDrawRange(0, 0);
const points = new T.Points(geo, new T.PointsMaterial({
  size: 2.5, sizeAttenuation: false, vertexColors: true, transparent: true,
  depthWrite: false, blending: T.AdditiveBlending, fog: false,
}));
points.frustumCulled = false;
scene.add(points);
const parts = [];

export function burst(x, y, z, o = {}) {
  const n = o.n || 10, color = new T.Color(o.color ?? 0xffffff);
  const speed = o.speed ?? 2, up = o.up ?? 1.5, life = o.life ?? 0.5, grav = o.grav ?? 6;
  for (let i = 0; i < n && parts.length < MAXP; i++) {
    const a = Math.random() * 6.283, s = speed * (0.4 + Math.random() * 0.6);
    parts.push({
      x, y, z, vx: Math.cos(a) * s, vy: up * (0.3 + Math.random()), vz: Math.sin(a) * s,
      t: 0, max: life * (0.6 + Math.random() * 0.6), r: color.r, g: color.g, b: color.b, grav,
    });
  }
}

// ------------------------------------------------------------ weapon effects
// A "shot" is a glowing head that flies forward leaving a trail of particles: arrows and fireballs.
const shots = [];
const SHOT = {
  bow: { speed: 70, color: 0xf2e6c0, n: 2, life: 0.22, grav: 0 },
  fire_staff: { speed: 22, color: 0xff7a2a, n: 5, life: 0.4, grav: -3 },
};
function shoot(x, y, z, r, len, kind) {
  const k = SHOT[kind];
  shots.push({ x, y, z, dx: Math.sin(r), dz: Math.cos(r), left: len, k });
}
// Called for every swing: yours and other players'. len = how far a projectile flies.
export function attackFx(x, y, z, r, wid, len) {
  if (wid === 'sword') {
    for (let a = -1; a <= 1.01; a += 0.25) burst(x + Math.sin(r + a) * 1.7, y + 1.1 + (0.5 - Math.abs(a)) * 0.2, z + Math.cos(r + a) * 1.7, { n: 2, color: 0xdfe8ff, speed: 0.4, up: 0.3, life: 0.22, grav: 0 });
  } else if (SHOT[wid]) {
    shoot(x + Math.sin(r) * 0.7, y + 1.3, z + Math.cos(r) * 0.7, r, len || 8, wid);
    if (wid === 'fire_staff') burst(x + Math.sin(r) * 0.9, y + 1.3, z + Math.cos(r) * 0.9, { n: 8, color: 0xffa030, speed: 1.2, up: 0.5, life: 0.3, grav: -1 });
  }
}

export function updateFx(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const sh = shots[i], step = Math.min(sh.left, sh.k.speed * dt);
    // emit along the path travelled this frame so fast arrows stay a continuous streak
    const m = Math.max(1, Math.ceil(step / 0.6));
    for (let j = 1; j <= m; j++) {
      const f = (step * j) / m;
      burst(sh.x + sh.dx * f, sh.y, sh.z + sh.dz * f, { n: sh.k.n, color: sh.k.color, speed: 0.25, up: 0.15, life: sh.k.life, grav: sh.k.grav });
    }
    sh.x += sh.dx * step; sh.z += sh.dz * step; sh.left -= step;
    if (sh.left <= 0.001) shots.splice(i, 1);
  }
  let n = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    if (p.t >= p.max) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    p.vy -= p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  }
  for (const p of parts) {
    const k = 1 - p.t / p.max;
    pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
    col[n * 3] = p.r * k; col[n * 3 + 1] = p.g * k; col[n * 3 + 2] = p.b * k;
    n++;
  }
  geo.setDrawRange(0, n);
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
}

// ------------------------------------------------------------ floating text
const fxEl = document.getElementById('fx');
const floaters = [];
const tv = new T.Vector3();

export function floatText(x, y, z, text, cls = 'dmg', life = 900) {
  const el = document.createElement('div');
  el.className = 'floater ' + cls;
  el.textContent = text;
  fxEl.appendChild(el);
  floaters.push({ el, x, y, z, t0: performance.now(), life, dx: (Math.random() - 0.5) * 30 });
  if (floaters.length > 40) floaters.shift().el.remove();
}

export function updateFloaters(now) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i], u = (now - f.t0) / f.life;
    if (u >= 1) { f.el.remove(); floaters.splice(i, 1); continue; }
    tv.set(f.x, f.y + u * 1.3, f.z).project(cam);
    if (tv.z > 1) { f.el.style.opacity = 0; continue; }
    const px = (tv.x * 0.5 + 0.5) * view.W + f.dx * u, py = (-tv.y * 0.5 + 0.5) * view.H;
    const pop = u < 0.15 ? 1 + (0.15 - u) * 4 : 1;
    f.el.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px) translate(-50%,-50%) scale(' + pop.toFixed(2) + ')';
    f.el.style.opacity = u < 0.7 ? 1 : (1 - u) / 0.3;
  }
}

// ------------------------------------------------------------ shake + vignette
let shakeAmt = 0;
export function shake(a) { shakeAmt = Math.max(shakeAmt, a); }
export function applyShake(camera, dt) {
  if (shakeAmt < 0.002) { shakeAmt = 0; return; }
  camera.position.x += (Math.random() - 0.5) * shakeAmt;
  camera.position.y += (Math.random() - 0.5) * shakeAmt;
  camera.position.z += (Math.random() - 0.5) * shakeAmt;
  shakeAmt *= Math.exp(-dt * 9);
}

const hurtEl = document.getElementById('hurt');
export function hurtFlash(k = 1) {
  hurtEl.style.transition = 'none';
  hurtEl.style.opacity = Math.min(1, 0.35 + k * 0.4);
  void hurtEl.offsetWidth; // restart the CSS transition
  hurtEl.style.transition = 'opacity .6s ease-out';
  hurtEl.style.opacity = 0;
}

// ------------------------------------------------------------ "+1" flying to the inventory
export function flyGain(item, n) {
  const def = ITEMS[item];
  if (!def) return;
  const dst = document.getElementById('invhead').getBoundingClientRect();
  tv.set(S.P.x, S.P.y + 1.8, S.P.z).project(cam);
  const sx = (tv.x * 0.5 + 0.5) * view.W, sy = (-tv.y * 0.5 + 0.5) * view.H;
  const el = document.createElement('div');
  el.className = 'fly';
  el.textContent = '+' + n + ' ' + def.n;
  document.body.appendChild(el);
  const dx = dst.left + dst.width / 2, dy = dst.top + dst.height / 2;
  const a = el.animate([
    { transform: 'translate(' + sx + 'px,' + sy + 'px) translate(-50%,-50%) scale(1.15)', opacity: 1 },
    { transform: 'translate(' + sx + 'px,' + (sy - 40) + 'px) translate(-50%,-50%) scale(1.15)', opacity: 1, offset: 0.25 },
    { transform: 'translate(' + dx + 'px,' + dy + 'px) translate(-50%,-50%) scale(.55)', opacity: 0.25 },
  ], { duration: 750, easing: 'cubic-bezier(.35,.1,.5,1)' });
  a.onfinish = () => {
    el.remove();
    const h = document.getElementById('invhead');
    h.classList.remove('bump');
    void h.offsetWidth;
    h.classList.add('bump');
  };
}
