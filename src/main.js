// Wires everything together and runs the render loop.
import { CFG, weaponIdOf } from '../shared/data.js';
import { S } from './state.js';
import { T, scene, cam, renderer, onResize, sky } from './scene.js';
import { animateCourtyard } from './courtyard.js';
import { mkFig, animFig, upS, setHeld } from './figures.js';
import { hgt, updateWorld, isFree, setNodeQty, resetNodes, updateNodeFx } from './terrain.js';
import { syncRabbits, patchRabbits, updateRabbits, clearRabbits, onHit } from './rabbits.js';
import { burst, floatText, updateFx, updateFloaters, shake, applyShake, hurtFlash, flyGain } from './fx.js';
import { sfx, initAudio } from './audio.js';
import { vibrate, initSettings, closeSettings } from './settings.js';
import { decodePlayer, decodeRabbit } from '../shared/wire.js';
import { syncPlayers, patchPlayers, updatePlayers, clearPlayers } from './players.js';
import { on, send, connect, stop } from './net.js';
import { say, showBoot, updateHPUI, updateHud } from './ui.js';
import { initInventory, renderInv, toggleInv, invOpen } from './inventory.js';
import { initPanel, panelState, openNearestStation, closePanel, renderPanel } from './panel.js';
import { initMount, updateMountButton, applyMountState, updateDonkey } from './mount.js';
import { initInteract, checkNear, doInteract, onCast, onFail, cancelGather, updateGather } from './interact.js';
import { initCombat, tryAttack, bindFigure } from './combat.js';
import { initSkills, refreshSkills, useSkill, useConsumable, updateSkills, onMana, onCd, onBuffs, onScast, onScancel, onSkillFx, hideSpell, cancelSpellByMoving } from './skills.js';
import { initChat, addChat, openChat, closeChat, isTyping } from './chat.js';
import { drawMap, isMapBig, setMapBig, toggleMap } from './minimap.js';
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
initSkills();
initChat();
initAuth();
initSettings();
initAudio();
updateHPUI();
updateHud();
updateMountButton();
addEventListener('resize', onResize);
initInput(renderer.domElement, {
  attack: tryAttack,
  interact: doInteract,
  toggleInv,
  craft: openNearestStation,
  map: toggleMap,
  skill: useSkill,
  use: useConsumable,
  chat: openChat,
  escape: () => { if (isMapBig()) setMapBig(false); else if (isTyping()) closeChat(); else if (panelState.type) closePanel(); else if (invOpen) toggleInv(); else closeSettings(); },
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
  if (y.mana) onMana(y.mana);
  S.cd = {}; S.gcdUntil = 0; hideSpell();
  onBuffs(y.buffs || {});
  applyMountState(y.mt, y.dk, y.dh, y.dr);
  resetNodes(m.depleted);
  clearRabbits();
  clearPlayers();
  m.chat.forEach((c) => addChat(c.n, c.m));
  addChat('', 'Welcome, ' + m.name + '.' + (m.guest ? ' Guest progress is not saved — log in next time to keep it.' : ''), true);
  S.ready = true;
  cf.snap = true;
  sent.x = NaN;
  renderInv();
  refreshSkills();
  updateMountButton();
  updateHPUI();
  updateHud();
});
function applyMe(me) {
  S.st.hp = me.hp;
  S.st.maxHp = me.mh;
  applyMountState(me.mt, me.dk, me.dh, me.dr);
}
function applyOnline(o) {
  if (S.online !== o) { S.online = o; updateHud(); }
}
// Full snapshot (old protocol; the server still sends it to pages that did not ask for deltas).
on('s', (m) => {
  applyMe(m.me);
  applyOnline(m.o);
  syncPlayers(m.p);
  syncRabbits(m.rb);
  updateHPUI();
});
// Delta snapshot (protocol 2): only what changed. f:1 marks a full picture, so anything missing is gone.
let rabAlias = {}; // the server's short numbers for rabbits -> real rabbit ids (restarted by every keyframe)
on('d', (m) => {
  if (m.me) { applyMe(m.me); updateHPUI(); }
  if (m.o !== undefined) applyOnline(m.o);
  if (m.f) rabAlias = {};
  const pl = (m.p || []).map(decodePlayer);
  const rb = (m.rb || []).map((a) => decodeRabbit(a, rabAlias));
  const rg = (m.rg || []).map((al) => rabAlias[al]);
  if (m.f) {
    syncPlayers(pl);
    syncRabbits(rb);
  } else {
    patchPlayers(pl, m.pg);
    patchRabbits(rb, rg);
  }
});
on('inv', (m) => {
  S.inv = m.inv;
  Object.assign(S.st, m.st);
  if (typeof m.hp === 'number') S.st.hp = m.hp;
  renderInv();
  refreshSkills();
  updateMountButton();
  updateHPUI();
  updateHud();
  if (panelState.type) renderPanel();
});
on('st', (m) => { Object.assign(S.st, m.st); updateHPUI(); updateHud(); });
on('mana', onMana);
on('cd', onCd);
on('buffs', onBuffs);
on('scast', onScast);
on('scancel', onScancel);
on('heal', (m) => floatText(P.x, P.y + 2.4, P.z, '+' + m.d, 'heal'));
on('skfx', (m) => onSkillFx(m, (id) => (id === S.myId ? { x: P.x, y: P.y, z: P.z } : S.others[id] ? S.others[id].g.position : null)));
on('node', (m) => setNodeQty(m.id, m.qty));
on('toast', (m) => say(m.m));
on('fail', (m) => { say(m.m); sfx('error'); onFail(); });
on('hit', onHit);
on('hurt', (m) => {
  if (m.m) { // the donkey took the bite: blue number, small shake, no red screen
    sfx('hurt');
    shake(0.15);
    floatText(P.x, P.y + 2.6, P.z, '-' + m.d, 'mount');
    return;
  }
  sfx('hurt');
  hurtFlash(Math.min(1, m.d / 200));
  shake(0.35);
  vibrate(60);
  floatText(P.x, P.y + 2.2, P.z, '-' + m.d, 'hurt');
});
on('gain', (m) => {
  sfx(m.src === 'craft' ? 'craft' : m.src === 'reward' ? 'reward' : 'pickup');
  flyGain(m.item, m.n);
  if (m.src === 'gather' || m.src === 'loot') vibrate(15);
});
on('cast', onCast);
on('pos', (m) => { P.x = m.x; P.z = m.z; vel.x = vel.z = 0; cf.snap = true; });
on('chat', (m) => addChat(m.n, m.m));
on('kick', (m) => { stop(); showBoot(m.m, 'Reload the page to play here again.', { tips: false, game: false }); });
on('close', () => {
  cancelGather(false);
  hideSpell();
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
const vel = { x: 0, z: 0 }; // smoothed movement so starts and stops don't feel stiff
const cf = { x: 0, y: 0, z: 0, snap: true }; // smoothed camera focus
let dustT = 0, stepD = 0;
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
  if (S.spell && moving) cancelSpellByMoving();
  updateGather(now);

  const yaw = input.yaw, pitch = input.pitch;
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  let mx = -sy * iz + cy * ix, mz = -cy * iz - sy * ix;
  const l = Math.hypot(mx, mz);
  let tvx = 0, tvz = 0, aim = P.r;
  if (l > 0.05 && !S.gather.active) {
    if (l > 1) { mx /= l; mz /= l; }
    // two speeds: walking (6/s) and the donkey (10/s). There is no sprint.
    const sp = S.mounted ? CFG.RIDE_SPEED : CFG.WALK_SPEED * (1 + (S.st.speed || 0)); // boots: +40% on foot
    tvx = mx * sp; tvz = mz * sp;
    aim = Math.atan2(mx, mz);
  }
  const kv = Math.min(1, dt * (tvx || tvz ? 12 : 18));
  vel.x += (tvx - vel.x) * kv;
  vel.z += (tvz - vel.z) * kv;
  if (Math.abs(vel.x) + Math.abs(vel.z) > 0.03) {
    const nx = P.x + vel.x * dt, nz = P.z + vel.z * dt;
    if (isFree(nx, P.z)) P.x = nx; else vel.x = 0;
    if (isFree(P.x, nz)) P.z = nz; else vel.z = 0;
  }
  if (tvx || tvz) { // turn smoothly, the short way round
    const dr = Math.atan2(Math.sin(aim - P.r), Math.cos(aim - P.r));
    P.r += dr * Math.min(1, dt * 20);
  }

  updateWorld();
  checkNear();
  updateRabbits(dt, now);
  updatePlayers(dt, now);
  updateDonkey();

  // tell the server where we are (it checks that the movement is humanly possible)
  if (S.ready && now - sent.t >= 70 && (Math.abs(P.x - sent.x) > 0.005 || Math.abs(P.z - sent.z) > 0.005 || Math.abs(P.r - sent.r) > 0.01 || !(sent.x === sent.x))) {
    send({ t: 'p', x: +P.x.toFixed(3), z: +P.z.toFixed(3), r: +P.r.toFixed(3) });
    sent.x = P.x; sent.z = P.z; sent.r = P.r; sent.t = now;
  }

  fr++;
  if (fr % (isMapBig() ? 12 : 6) === 0) drawMap();
  updateSkills(now);

  P.y = Math.max(0.13, hgt(P.x, P.z));
  me.position.set(P.x, P.y + (S.mounted ? 0.55 : 0), P.z);
  me.rotation.y = P.r;

  if (P._px === undefined) { P._px = P.x; P._pz = P.z; }
  const psp = Math.min(20, Math.hypot(P.x - P._px, P.z - P._pz) / Math.max(dt, 1e-3));
  P._px = P.x; P._pz = P.z;
  setHeld(me, weaponIdOf(S.inv.eq));
  upS(me, now);
  animFig(me, dt, S.mounted ? 0 : psp, now);

  // footsteps on foot, dust behind the donkey
  if (!S.mounted && psp > 1.2) {
    stepD += psp * dt;
    if (stepD > 4.2) { stepD = 0; sfx('step'); }
  } else if (S.mounted && psp > 3) {
    dustT -= dt;
    if (dustT <= 0) { dustT = 0.1; burst(P.x, P.y + 0.1, P.z, { n: 2, color: 0x6a6f80, speed: 0.6, up: 0.8, life: 0.4, grav: 1 }); }
  }

  // camera follows with a little smoothing; snap if we were teleported
  if (cf.snap || Math.hypot(P.x - cf.x, P.z - cf.z) > 12) { cf.x = P.x; cf.y = P.y; cf.z = P.z; cf.snap = false; }
  const kc = Math.min(1, dt * 14);
  cf.x += (P.x - cf.x) * kc; cf.y += (P.y - cf.y) * kc; cf.z += (P.z - cf.z) * kc;
  const d = S.mounted ? 9 : 7, cp = Math.cos(pitch);
  cam.position.set(cf.x + sy * cp * d, cf.y + 2 + Math.sin(pitch) * d, cf.z + cy * cp * d);
  cam.position.y = Math.max(cam.position.y, hgt(cam.position.x, cam.position.z) + 1);
  cam.lookAt(cf.x, cf.y + 1.6, cf.z);
  applyShake(cam, dt);
  sky.position.set(cam.position.x, 0, cam.position.z);
  cam.updateMatrixWorld();
  animateCourtyard(t);
  updateNodeFx(now);
  updateFx(dt);
  updateFloaters(now);

  renderer.render(scene, cam);
  requestAnimationFrame(loop);
}

connect();
loop();

// handy for debugging / automated tests
window.__nwo = { S, send, me }; // handle for the browser e2e test
