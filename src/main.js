// Wires everything together and runs the render loop.
import { CFG } from '../shared/data.js';
import { S } from './state.js';
import { T, scene, cam, renderer, onResize } from './scene.js';
import { animateCourtyard } from './courtyard.js';
import { mkFig, animFig, upS } from './figures.js';
import { hgt, updateWorld, isFree, setNodeQty, resetNodes } from './terrain.js';
import { syncRabbits, updateRabbits, clearRabbits } from './rabbits.js';
import { syncPlayers, updatePlayers, clearPlayers } from './players.js';
import { on, send, connect, stop } from './net.js';
import { say, showBoot, updateHPUI, updateHud } from './ui.js';
import { initInventory, renderInv, toggleInv, invOpen } from './inventory.js';
import { initPanel, panelState, openCraft, closePanel, renderPanel } from './panel.js';
import { initMount, updateMountButton, applyMountState, updateDonkey } from './mount.js';
import { initInteract, checkNear, doInteract, onCast, onFail, cancelGather, updateGather } from './interact.js';
import { initCombat, tryAttack, bindFigure } from './combat.js';
import { initChat, addChat, openChat, closeChat, isTyping } from './chat.js';
import { drawMap } from './minimap.js';
import { input, initInput } from './input.js';
import { initAuth, myColor, logout } from './auth.js';

const { P } = S;

// ---- my character figure ----
const me = mkFig(new T.Color(myColor()).getHex());
scene.add(me);
bindFigure(me);

// ---- UI init ----
initInventory();
initPanel();
initMount();
initInteract();
initCombat();
initChat();
initAuth();
updateHPUI();
updateHud();
updateMountButton();
addEventListener('resize', onResize);
initInput(renderer.domElement, {
  attack: tryAttack,
  interact: doInteract,
  toggleInv,
  craft: () => openCraft(null),
  chat: openChat,
  escape: () => { if (isTyping()) closeChat(); else if (panelState.type) closePanel(); else if (invOpen) toggleInv(); },
});

// ---- server messages ----
on('welcome', (m) => {
  S.myId = m.id;
  S.name = m.name;
  S.online = m.online;
  const y = m.you;
  P.x = y.x; P.z = y.z; P.r = y.r;
  S.inv = y.inv;
  Object.assign(S.st, y.st, { hp: y.hp, maxHp: y.mh });
  applyMountState(y.mt, y.dk);
  resetNodes(m.depleted);
  clearRabbits();
  clearPlayers();
  m.chat.forEach((c) => addChat(c.n, c.m));
  addChat('', 'Welcome, ' + m.name + '.' + (m.guest ? ' Guest progress is not saved — log in next time to keep it.' : ''), true);
  S.ready = true;
  sent.x = NaN;
  renderInv();
  updateMountButton();
  updateHPUI();
  updateHud();
});
on('s', (m) => {
  S.st.hp = m.me.hp;
  S.st.maxHp = m.me.mh;
  applyMountState(m.me.mt, m.me.dk);
  if (S.online !== m.o) { S.online = m.o; updateHud(); }
  syncPlayers(m.p);
  syncRabbits(m.rb);
  updateHPUI();
});
on('inv', (m) => {
  S.inv = m.inv;
  Object.assign(S.st, m.st);
  if (typeof m.hp === 'number') S.st.hp = m.hp;
  renderInv();
  updateMountButton();
  updateHPUI();
  updateHud();
  if (panelState.type) renderPanel();
});
on('node', (m) => setNodeQty(m.id, m.qty));
on('toast', (m) => say(m.m));
on('fail', (m) => { say(m.m); onFail(); });
on('cast', onCast);
on('pos', (m) => { P.x = m.x; P.z = m.z; });
on('chat', (m) => addChat(m.n, m.m));
on('kick', (m) => { stop(); showBoot(m.m, 'Reload the page to play here again.'); });
on('close', () => {
  cancelGather(false);
  clearPlayers();
  clearRabbits();
});

// `/logout` in chat forgets the saved session on this device.
const chatForm = document.getElementById('chatform');
chatForm.addEventListener('submit', () => {
  if (document.getElementById('chatin').value.trim() === '/logout') logout();
}, true);

// ---- main loop ----
const clock = new T.Clock();
const sent = { x: NaN, z: NaN, r: NaN, t: 0 };
let fr = 0;

function loop() {
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  const now = performance.now();
  const { keys, joy } = input;
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  if (joy) { ix = joy.dx; iz = -joy.dy; }
  if (!S.ready) { ix = 0; iz = 0; }
  const moving = Math.abs(ix) > 0.05 || Math.abs(iz) > 0.05;
  if (S.gather.active && moving) cancelGather();
  updateGather(now);

  const yaw = input.yaw, pitch = input.pitch;
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  let mx = -sy * iz + cy * ix, mz = -cy * iz - sy * ix;
  const l = Math.hypot(mx, mz);
  if (l > 0.05 && !S.gather.active) {
    if (l > 1) { mx /= l; mz /= l; }
    let sp = keys.ShiftLeft || keys.ShiftRight ? CFG.MAX_SPEED : 6;
    if (joy) sp = 6 + 10 * Math.max(0, (Math.hypot(joy.dx, joy.dy) - 0.7) / 0.3);
    if (S.mounted) sp *= CFG.MOUNT_SPEED;
    const nx = P.x + mx * sp * dt, nz = P.z + mz * sp * dt;
    if (isFree(nx, P.z)) P.x = nx;
    if (isFree(P.x, nz)) P.z = nz;
    P.r = Math.atan2(mx, mz);
  }

  updateWorld();
  checkNear();
  updateRabbits(dt);
  updatePlayers(dt, now);
  updateDonkey();

  // tell the server where we are (it checks that the movement is humanly possible)
  if (S.ready && now - sent.t >= 70 && (Math.abs(P.x - sent.x) > 0.005 || Math.abs(P.z - sent.z) > 0.005 || Math.abs(P.r - sent.r) > 0.01 || !(sent.x === sent.x))) {
    send({ t: 'p', x: +P.x.toFixed(3), z: +P.z.toFixed(3), r: +P.r.toFixed(3) });
    sent.x = P.x; sent.z = P.z; sent.r = P.r; sent.t = now;
  }

  fr++;
  if (fr % 6 === 0) drawMap();

  P.y = Math.max(0.13, hgt(P.x, P.z));
  me.position.set(P.x, P.y + (S.mounted ? 0.55 : 0), P.z);
  me.rotation.y = P.r;

  if (P._px === undefined) { P._px = P.x; P._pz = P.z; }
  const psp = Math.min(20, Math.hypot(P.x - P._px, P.z - P._pz) / Math.max(dt, 1e-3));
  P._px = P.x; P._pz = P.z;
  upS(me, now);
  animFig(me, dt, S.mounted ? 0 : psp, now);

  const d = S.mounted ? 9 : 7, cp = Math.cos(pitch);
  cam.position.set(P.x + sy * cp * d, P.y + 2 + Math.sin(pitch) * d, P.z + cy * cp * d);
  cam.position.y = Math.max(cam.position.y, hgt(cam.position.x, cam.position.z) + 1);
  cam.lookAt(P.x, P.y + 1.6, P.z);
  animateCourtyard(t);

  renderer.render(scene, cam);
  requestAnimationFrame(loop);
}

connect();
loop();

// handy for debugging / automated tests
window.__nwo = { S, send };
