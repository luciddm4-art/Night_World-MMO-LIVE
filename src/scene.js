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

export const view = { W: innerWidth, H: innerHeight, PX: innerWidth < 600 ? 3 : 4 };

export const renderer = new T.WebGLRenderer({ antialias: false });
renderer.setSize(Math.floor(view.W / view.PX), Math.floor(view.H / view.PX), false);
document.body.appendChild(renderer.domElement);

export const scene = new T.Scene();
const FROSTY = REALM.id === 't2';
// Frostfall is a pale, cold world: lighter sky and fog, snow-blue light (the day/night cycle will take over these later)
scene.background = new T.Color(FROSTY ? 0x2a3753 : 0x121830);
scene.fog = new T.FogExp2(FROSTY ? 0x30405d : 0x151b30, FROSTY ? 0.0095 : 0.016);
export const cam = new T.PerspectiveCamera(70, view.W / view.H, 0.1, 500);

export function tex(base, bricks, rep) {
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

const amb = new T.AmbientLight(FROSTY ? 0xaab6d4 : 0x3a4a7a, FROSTY ? 1.0 : 0.9);
scene.add(amb);
const moonDir = new T.Vector3(-40, 60, -80);
const dl = new T.DirectionalLight(FROSTY ? 0xdfe8f8 : 0x8aa0d8, FROSTY ? 0.75 : 0.55);
dl.position.copy(moonDir);
scene.add(dl);
// brightness setting scales these two
export const lights = { amb, dir: dl, ambBase: FROSTY ? 1.0 : 0.9, dirBase: FROSTY ? 0.75 : 0.55 };
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
  renderer.setSize(Math.floor(view.W / view.PX), Math.floor(view.H / view.PX), false);
  cam.aspect = view.W / view.H;
  cam.updateProjectionMatrix();
}
