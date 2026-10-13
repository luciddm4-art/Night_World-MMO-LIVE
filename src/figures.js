// Meshes for people, animals and the donkey, plus name tags.
import { T } from './scene.js';

export function mkFig(col) {
  const g = new T.Group(), m = new T.MeshLambertMaterial({ color: col });
  const torso = new T.Group();
  g.add(torso);
  g.userData.torso = torso;
  const b = new T.Mesh(new T.BoxGeometry(0.7, 1.1, 0.4), m);
  b.position.y = 1.15;
  torso.add(b);
  const head = new T.Mesh(new T.BoxGeometry(0.45, 0.45, 0.45), new T.MeshLambertMaterial({ color: 0xc8a98a }));
  head.position.y = 2;
  torso.add(head);
  const nose = new T.Mesh(new T.BoxGeometry(0.12, 0.12, 0.2), new T.MeshBasicMaterial({ color: 0x222222 }));
  nose.position.set(0, 2, 0.3);
  torso.add(nose);
  const legGeo = new T.BoxGeometry(0.25, 0.7, 0.3);
  legGeo.translate(0, -0.35, 0);
  const legL = new T.Mesh(legGeo, m); legL.position.set(-0.2, 0.7, 0); g.add(legL);
  const legR = new T.Mesh(legGeo, m); legR.position.set(0.2, 0.7, 0); g.add(legR);
  const armGeo = new T.BoxGeometry(0.22, 0.65, 0.28);
  armGeo.translate(0, -0.32, 0);
  const armL = new T.Mesh(armGeo, m); armL.position.set(-0.47, 1.6, 0); torso.add(armL);
  const armR = new T.Mesh(armGeo, m); armR.position.set(0.47, 1.6, 0); torso.add(armR);
  const sl = new T.Mesh(
    new T.RingGeometry(1, 1.9, 16, 1, -Math.PI / 2 - 1, 2),
    new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false, fog: false }),
  );
  sl.rotation.x = -Math.PI / 2;
  sl.position.y = 1.2;
  g.add(sl);
  Object.assign(g.userData, { legL, legR, armL, armR, sl, t: -9999, phase: 0, phase0: Math.random() * 6.283 });
  return g;
}

// ---- held weapons: small low-poly models parented to the right arm, so they swing with it
const metal = () => new T.MeshLambertMaterial({ color: 0xcfd6e0 });
const wood = () => new T.MeshLambertMaterial({ color: 0x6b4423 });
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const HELD = {
  sword() {
    const g = new T.Group();
    g.add(box(0.07, 0.95, 0.03, metal(), 0, 0.55, 0), box(0.34, 0.06, 0.08, new T.MeshLambertMaterial({ color: 0xc9a227 }), 0, 0.06, 0), box(0.06, 0.2, 0.06, wood(), 0, -0.06, 0));
    g.rotation.x = Math.PI / 2; // blade points forward from the fist
    return g;
  },
  bow() {
    const g = new T.Group(), w = wood();
    g.add(box(0.06, 0.22, 0.06, w, 0, 0, 0));
    const up = box(0.05, 0.5, 0.05, w, 0, 0.33, -0.1); up.rotation.x = -0.45; g.add(up);
    const dn = box(0.05, 0.5, 0.05, w, 0, -0.33, -0.1); dn.rotation.x = 0.45; g.add(dn);
    g.add(box(0.012, 1.1, 0.012, new T.MeshBasicMaterial({ color: 0xeeeeee }), 0, 0, -0.3));
    g.position.z = 0.1;
    return g;
  },
  fire_staff() {
    const g = new T.Group();
    g.add(box(0.06, 1.5, 0.06, new T.MeshLambertMaterial({ color: 0x3a2a1a }), 0, 0.3, 0));
    const orb = new T.Mesh(new T.SphereGeometry(0.15, 10, 8), new T.MeshBasicMaterial({ color: 0xff7a2a }));
    orb.position.y = 1.12;
    const glow = new T.Mesh(new T.SphereGeometry(0.24, 10, 8), new T.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.35, depthWrite: false }));
    glow.position.y = 1.12;
    g.add(orb, glow);
    return g;
  },
};
// wid: weapon id or 0/null for empty hands. Cheap no-op when unchanged.
export function setHeld(g, wid) {
  const u = g.userData;
  wid = wid && HELD[wid] ? wid : 0;
  if (u.heldId === wid) return;
  if (u.held) {
    u.armR.remove(u.held);
    u.held.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    u.held = null;
  }
  u.heldId = wid;
  if (!wid) return;
  const h = new T.Group();
  h.add(HELD[wid]());
  h.position.set(0, -0.62, 0.12);
  u.armR.add(h);
  u.held = h;
}

const ANIM_SCALE = 0.5;
export function animFig(g, dt, speed, now) {
  const u = g.userData;
  const walkAmt = Math.min(1, speed / 6); // walking is 6 units/s
  u.phase += dt * (2 + speed * 1.6) * ANIM_SCALE;
  const s = Math.sin(u.phase), t = now * 0.001;
  u.legL.rotation.x = s * 0.85 * walkAmt;
  u.legR.rotation.x = -s * 0.85 * walkAmt;
  u.armL.rotation.x = -s * 0.75 * walkAmt;
  u.armR.rotation.x = s * 0.75 * walkAmt;
  const idle = Math.sin(t * 1.6 + u.phase0) * 0.06 * (1 - walkAmt);
  u.armL.rotation.x += idle;
  u.armR.rotation.x -= idle;
  u.torso.position.y = Math.abs(s) * 0.07 * walkAmt + Math.sin(t * 2 + u.phase0) * 0.02 * (1 - walkAmt);
  u.torso.rotation.x = walkAmt * 0.12;
  u.torso.rotation.y *= 0.85;
  const age = now - u.t;
  if (age >= 0 && age < 320) {
    const sw = Math.sin((age / 320) * Math.PI);
    u.armR.rotation.x = 0.75 * walkAmt * s - 2.6 * sw;
    u.armR.rotation.z = -0.9 * sw;
    u.armL.rotation.x = -0.75 * walkAmt * s - 0.5 * sw;
    u.torso.rotation.y = 0.5 * sw;
    u.torso.rotation.x += 0.18 * sw;
  } else u.armR.rotation.z *= 0.8;
}

export function upS(g, now) {
  const u = (now - g.userData.t) / 250, m = g.userData.sl;
  m.material.opacity = u < 1 ? 0.8 * (1 - u) : 0;
  m.scale.setScalar(0.8 + 0.5 * Math.min(1, u));
}

export function mkRabbit() {
  const g = new T.Group(), m = new T.MeshLambertMaterial({ color: 0x8a6a4a });
  const b = new T.Mesh(new T.BoxGeometry(0.5, 0.35, 0.7), m); b.position.y = 0.22; g.add(b);
  const h = new T.Mesh(new T.BoxGeometry(0.3, 0.3, 0.35), m); h.position.set(0, 0.38, -0.45); g.add(h);
  const e1 = new T.Mesh(new T.BoxGeometry(0.06, 0.3, 0.1), m); e1.position.set(-0.09, 0.65, -0.5); g.add(e1);
  const e2 = new T.Mesh(new T.BoxGeometry(0.06, 0.3, 0.1), m); e2.position.set(0.09, 0.65, -0.5); g.add(e2);
  g.userData.body = b;
  g.userData.mat = m;
  return g;
}

export function mkDonkey() {
  const g = new T.Group(), m = new T.MeshLambertMaterial({ color: 0x6a4a3a });
  const body = new T.Mesh(new T.BoxGeometry(0.55, 0.5, 1.1), m); body.position.y = 0.65; g.add(body);
  const head = new T.Mesh(new T.BoxGeometry(0.35, 0.35, 0.5), m); head.position.set(0, 1, -0.75); g.add(head);
  const snout = new T.Mesh(new T.BoxGeometry(0.22, 0.22, 0.3), m); snout.position.set(0, 0.9, -1.05); g.add(snout);
  const eL = new T.Mesh(new T.BoxGeometry(0.08, 0.28, 0.1), m); eL.position.set(-0.1, 1.25, -0.72); g.add(eL);
  const eR = new T.Mesh(new T.BoxGeometry(0.08, 0.28, 0.1), m); eR.position.set(0.1, 1.25, -0.72); g.add(eR);
  const legGeo = new T.BoxGeometry(0.14, 0.55, 0.14);
  legGeo.translate(0, -0.275, 0);
  [[-0.2, -0.4], [0.2, -0.4], [-0.2, 0.4], [0.2, 0.4]].forEach((p) => {
    const l = new T.Mesh(legGeo, m);
    l.position.set(p[0], 0.55, p[1]);
    g.add(l);
  });
  const tail = new T.Mesh(new T.BoxGeometry(0.08, 0.4, 0.08), m); tail.position.set(0, 0.85, 0.6); g.add(tail);
  return g;
}

// Floating name above a player (canvas texture on a sprite).
export function mkNameTag(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 26px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,.85)';
  g.strokeText(text, 128, 26);
  g.fillStyle = '#f2d34a';
  g.fillText(text, 128, 26);
  const tex = new T.CanvasTexture(c);
  const mat = new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  const sp = new T.Sprite(mat);
  sp.scale.set(2.6, 0.49, 1);
  sp.position.y = 2.75;
  return sp;
}

export function disposeFig(scene, g) {
  scene.remove(g);
  g.traverse((o) => {
    if (o.isSprite && o.material) { o.material.map && o.material.map.dispose(); o.material.dispose(); }
  });
}
