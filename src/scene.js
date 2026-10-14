// Renderer, camera, lights, sky. THREE comes from vendor/three.min.js (global).
import { SEED, REALM } from './config.js';

export const T = window.THREE;

export function rnd(s) {
  return function () {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}
export const R = rnd(SEED * 7 + 1); // cosmetic randomness (textures, stars)

// Graphics: 'smooth' (default) is the low-poly look at full sharpness with smoothed edges;
// 'pixel' is the old retro look (a tiny picture blown up). Saved in the settings; changing it reloads the page.
export const GFX = (() => {
  try { return JSON.parse(localStorage.getItem('nwo_settings') || '{}').gfx === 'pixel' ? 'pixel' : 'smooth'; } catch { return 'smooth'; }
})();
export const smooth = GFX === 'smooth';

export const view = { W: innerWidth, H: innerHeight, PX: innerWidth < 600 ? 3 : 4, q: 1 };
// the sharpest the picture is allowed to get: the screen's own pixel density, but never above 1.5 (phones would struggle)
view.qMax = Math.min(window.devicePixelRatio || 1, 1.5);
view.q = Math.min(1, view.qMax);

export const renderer = new T.WebGLRenderer({ antialias: smooth });
function sizeRenderer() {
  if (smooth) { renderer.setPixelRatio(view.q); renderer.setSize(view.W, view.H, false); }
  else renderer.setSize(Math.floor(view.W / view.PX), Math.floor(view.H / view.PX), false);
}
sizeRenderer();
if (smooth) renderer.domElement.classList.add('smooth');
document.body.appendChild(renderer.domElement);

// Automatic sharpness: if the frame rate drops the picture gets a little less sharp, if there is plenty to spare it gets sharper.
let fAcc = 0, fN = 0, fSince = 0, fCool = 0;
export function adaptQuality(dtMs, now) {
  if (!smooth) return;
  fAcc += dtMs; fN++;
  if (now - fSince < 2000) return;
  const avg = fAcc / fN;
  fAcc = 0; fN = 0; fSince = now;
  if (fCool > 0) { fCool--; return; }
  let q = view.q;
  if (avg > 30 && q > 0.5) q = Math.max(0.5, q - 0.15);
  else if (avg < 17 && q < view.qMax) q = Math.min(view.qMax, q + 0.1);
  if (Math.abs(q - view.q) > 0.01) { view.q = q; sizeRenderer(); fCool = 1; }
}

export const scene = new T.Scene();
const FROSTY = REALM.id === 't2';
// Frostfall is a pale, cold world: lighter sky and fog, snow-blue light (the day/night cycle will take over these later)
scene.background = new T.Color(FROSTY ? 0x2a3753 : 0x121830);
scene.fog = new T.FogExp2(FROSTY ? 0x30405d : 0x151b30, FROSTY ? 0.0095 : 0.016);
export const cam = new T.PerspectiveCamera(70, view.W / view.H, 0.1, 500);

export function tex(base, bricks, rep) {
  if (smooth) return smoothTex(base, bricks, rep);
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = 0.78 + R() * 0.3;
      g.fillStyle = 'rgb(' + ((base[0] * v) | 0) + ',' + ((base[1] * v) | 0) + ',' + ((base[2] * v) | 0) + ')';
      g.fillRect(x, y, 1, 1);
    }
  }
  if (bricks) {
    g.fillStyle = 'rgba(0,0,0,.45)';
    for (let j = 0; j < 16; j += 4) {
      g.fillRect(0, j, 16, 1);
      for (let i = ((j / 4) % 2) * 4; i < 16; i += 8) g.fillRect(i, j, 1, 4);
    }
  }
  const t = new T.CanvasTexture(c);
  t.magFilter = t.minFilter = T.NearestFilter;
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(rep, rep);
  return t;
}

// Low-poly surfaces: a flat colour with a very soft blotchy variation (and faint brick lines), smoothly filtered.
function smoothTex(base, bricks, rep) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  for (let y = 0; y < 32; y += 8) {
    for (let x = 0; x < 32; x += 8) {
      const v = 0.94 + R() * 0.1;
      g.fillStyle = 'rgb(' + ((base[0] * v) | 0) + ',' + ((base[1] * v) | 0) + ',' + ((base[2] * v) | 0) + ')';
      g.fillRect(x, y, 8, 8);
    }
  }
  if (bricks) {
    g.fillStyle = 'rgba(0,0,0,.22)';
    for (let j = 0; j < 32; j += 8) {
      g.fillRect(0, j, 32, 1);
      for (let i = ((j / 8) % 2) * 8; i < 32; i += 16) g.fillRect(i, j, 1, 8);
    }
  }
  const t = new T.CanvasTexture(c);
  t.magFilter = T.LinearFilter;
  t.minFilter = T.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(rep, rep);
  return t;
}

const amb = new T.AmbientLight(FROSTY ? 0xaab6d4 : 0x3a4a7a, FROSTY ? 1.0 : smooth ? 0.8 : 0.9);
scene.add(amb);
const moonDir = new T.Vector3(-40, 60, -80);
const dl = new T.DirectionalLight(FROSTY ? 0xdfe8f8 : 0x9fb2e6, FROSTY ? 0.75 : smooth ? 0.8 : 0.55);
dl.position.copy(moonDir);
scene.add(dl);
// brightness setting scales these two
export const lights = { amb, dir: dl, ambBase: FROSTY ? 1.0 : smooth ? 0.8 : 0.9, dirBase: FROSTY ? 0.75 : smooth ? 0.8 : 0.55 };
const moon = new T.Mesh(new T.SphereGeometry(14, 8, 6), new T.MeshBasicMaterial({ color: 0xdfe3ea, fog: false }));
moon.position.copy(moonDir).multiplyScalar(3);
// moon and stars live in a group that follows the camera, so they stay put in the sky however far you walk
export const sky = new T.Group();
sky.add(moon);
scene.add(sky);

const sp = [];
for (let i = 0; i < 350; i++) {
  const a = R() * 6.283, b = R() * 1.2 + 0.1, d = 250;
  sp.push(Math.cos(a) * Math.cos(b) * d, Math.sin(b) * d, Math.sin(a) * Math.cos(b) * d);
}
const sg = new T.BufferGeometry();
sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
sky.add(new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false })));

export function onResize() {
  view.W = innerWidth;
  view.H = innerHeight;
  view.PX = view.W < 600 ? 3 : 4;
  sizeRenderer();
  cam.aspect = view.W / view.H;
  cam.updateProjectionMatrix();
}
