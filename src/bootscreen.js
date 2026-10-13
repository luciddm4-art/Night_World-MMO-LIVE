// The loading screen: shown from the very first paint (it is plain HTML/CSS in index.html), then this module
// brings it to life: a pixel-art night scene (moon, stars, the walled town, a glowing portal, fireflies you can
// tap), a progress bar with steps, and rotating tips. It also covers cold starts of the sleeping free server.
// No images or libraries: everything is drawn on a small canvas that is scaled up with crisp pixels (like the game).
const root = document.getElementById('boot');
const cv = document.getElementById('bootcv');
const g = cv.getContext('2d');
const $ = (id) => document.getElementById(id);
const barEl = $('bootbar'), msgEl = $('bootmsg'), hintEl = $('boothint'), tipEl = $('boottip'), playEl = $('bootplay'), scoreEl = $('bootscore');
const steps = [...document.querySelectorAll('#bootsteps span')];

const TIPS = [
  'Each crafting station makes its own gear: Forge iron, Loom cloth, Tannery leather.',
  'Rabbits drop hide. Take it to the Tannery to make leather.',
  'Bows shoot far, swords hit everything in front, fire staffs burn a crowd.',
  'Fill head, chest, feet, main hand and off hand to earn a donkey.',
  'While you ride, rabbit bites hit your donkey instead of you.',
  'Press C near a crafting station to open it.',
  'Trees and ore grow back after a few seconds.',
  'The portal is far from town. A donkey gets you there much faster.',
  'The free server naps when nobody plays. You are waking it up for everyone.',
];

// ---------------------------------------------------------------- state
let W = 0, H = 0, PX = 4, u = 1, horizon = 0;
let visible = !!root.classList.contains('show');
let raf = 0, last = 0, shownAt = performance.now(), hideTimer = 0, tipTimer = 0, tipI = Math.floor(Math.random() * TIPS.length);
let prog = 0, target = 0.05, caught = 0;
const stars = [], flies = [], sparks = [], windows = [];
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function resize() {
  PX = innerWidth < 600 ? 3 : 4;
  W = Math.max(60, Math.ceil(innerWidth / PX));
  H = Math.max(60, Math.ceil(innerHeight / PX));
  cv.width = W; cv.height = H;
  u = Math.min(W / 150, H / 100);
  horizon = Math.round(H * 0.62);
}
function init() {
  resize();
  for (let i = 0; i < 120; i++) stars.push({ x: rnd(), y: rnd() * 0.62, p: rnd() * 6.28, s: 0.6 + rnd() * 2 });
  for (let i = 0; i < 16; i++) flies.push(newFly(true));
  for (let i = 0; i < 40; i++) windows.push({ p: rnd() * 6.28, on: rnd() < 0.8 });
}
function newFly(anywhere) {
  return { x: rnd() * W, y: horizon - 8 * u + rnd() * (H * 0.9 - horizon + 8 * u), p: rnd() * 6.28, sp: 0.4 + rnd() * 0.8, hit: 0 };
}

// ---------------------------------------------------------------- drawing helpers
const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
const tri = (x1, y1, x2, y2, x3, y3, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.closePath(); g.fill(); };
const mix = (a, b, k) => 'rgb(' + ((a[0] + (b[0] - a[0]) * k) | 0) + ',' + ((a[1] + (b[1] - a[1]) * k) | 0) + ',' + ((a[2] + (b[2] - a[2]) * k) | 0) + ')';

function sky(t) {
  for (let y = 0; y < horizon; y += 2) rect(0, y, W, 2, mix([7, 9, 24], [52, 34, 84], Math.pow(y / horizon, 1.6)));
  for (const s of stars) {
    const a = 0.35 + 0.65 * Math.abs(Math.sin(t * s.s + s.p));
    g.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
    g.fillRect(Math.floor(s.x * W), Math.floor(s.y * H), 1, 1);
  }
  const mx = W * 0.2, my = H * 0.2 + 4, r = Math.max(5, 6 * u);
  for (const [k, a] of [[3.2, 0.05], [2.2, 0.07], [1.5, 0.1]]) { g.fillStyle = 'rgba(190,205,255,' + a + ')'; g.beginPath(); g.arc(mx, my, r * k, 0, 6.283); g.fill(); }
  g.fillStyle = '#e8ecf8'; g.beginPath(); g.arc(mx, my, r, 0, 6.283); g.fill();
  g.fillStyle = 'rgba(150,160,195,.55)';
  for (const [dx, dy, dr] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.3], [-0.1, 0.4, 0.15]]) { g.beginPath(); g.arc(mx + dx * r, my + dy * r, dr * r, 0, 6.283); g.fill(); }
}

function hills(t) {
  g.fillStyle = '#10182c';
  g.beginPath(); g.moveTo(0, horizon + 2);
  for (let x = 0; x <= W; x += 2) g.lineTo(x, horizon - 5 * u - Math.sin(x * 0.045 / u) * 3 * u - Math.sin(x * 0.12 / u + 1) * 1.6 * u);
  g.lineTo(W, horizon + 2); g.closePath(); g.fill();
}

function town(t) {
  const cx = W / 2, b = horizon; // b = baseline
  const X = (v) => cx + v * u;
  const wallC = '#1a1f36', roofC = '#2b1f2e', hallC = '#222a4a';
  // houses behind the wall
  const houses = [[-46, 11, 14], [-33, 10, 17], [-19, 9, 13], [22, 9, 15], [34, 11, 18], [47, 10, 14]];
  let wi = 0;
  houses.forEach(([hx, hw, hh]) => {
    rect(X(hx - hw / 2), b - hh * u, hw * u, hh * u, '#1d2340');
    tri(X(hx - hw / 2) - u, b - hh * u, X(hx + hw / 2) + u, b - hh * u, X(hx), b - (hh + 6) * u, roofC);
    for (let k = 0; k < 2; k++) { const w = windows[wi++ % windows.length]; if (w.on) rect(X(hx - 2 + k * 4), b - (hh - 4) * u, Math.max(1, 1.4 * u), Math.max(1, 2 * u), 'rgba(255,200,110,' + (0.65 + 0.3 * Math.sin(t * 2.5 + w.p)).toFixed(2) + ')'); }
  });
  // the crafting hall in the middle
  rect(X(-13), b - 22 * u, 26 * u, 22 * u, hallC);
  rect(X(-15), b - 24 * u, 30 * u, 3 * u, '#2a3358');
  for (let k = -12; k < 13; k += 4) rect(X(k), b - 27 * u, Math.max(1, 2 * u), 3 * u, '#2a3358');
  for (let k = 0; k < 4; k++) { const w = windows[(wi++) % windows.length]; rect(X(-9 + k * 6), b - 15 * u, Math.max(1, 2.4 * u), Math.max(1, 4 * u), ['#ff8a3c', '#9fb4d8', '#ff6a20', '#c89a5a'][k] ); }
  // wall with crenellations and a gate
  rect(X(-62), b - 8 * u, 124 * u, 8 * u, wallC);
  for (let k = -62; k < 62; k += 4) rect(X(k), b - 10 * u, Math.max(1, 2.4 * u), 2 * u, wallC);
  rect(X(-5), b - 7 * u, 10 * u, 7 * u, '#0c0f1c');
  rect(X(-6), b - 8 * u, Math.max(1, 1.5 * u), 9 * u, '#262c4c'); rect(X(4.6), b - 8 * u, Math.max(1, 1.5 * u), 9 * u, '#262c4c');
  // towers with cone roofs
  for (const tx of [-62, 62]) {
    rect(X(tx - 4), b - 17 * u, 8 * u, 17 * u, '#1f2540');
    tri(X(tx - 5.5), b - 17 * u, X(tx + 5.5), b - 17 * u, X(tx), b - 25 * u, roofC);
    const w = windows[(wi++) % windows.length]; rect(X(tx - 0.7), b - 12 * u, Math.max(1, 1.5 * u), Math.max(1, 3 * u), 'rgba(255,200,110,' + (0.7 + 0.25 * Math.sin(t * 3 + w.p)).toFixed(2) + ')');
  }
}

function ground(t) {
  for (let y = horizon; y < H; y += 2) rect(0, y, W, 2, mix([14, 22, 28], [4, 7, 12], (y - horizon) / (H - horizon)));
  // road from the gate towards the viewer
  g.fillStyle = '#1b2231';
  g.beginPath(); g.moveTo(W / 2 - 4 * u, horizon); g.lineTo(W / 2 + 4 * u, horizon); g.lineTo(W / 2 + W * 0.28, H); g.lineTo(W / 2 - W * 0.28, H); g.closePath(); g.fill();
}

function pines(t) {
  const tree = (x, h, w, k) => {
    const sway = Math.sin(t * 0.9 + k) * 0.8;
    for (let i = 0; i < 5; i++) {
      const y0 = H - h + (i * h) / 6, tw = w * (0.35 + i * 0.16);
      tri(x - tw + sway * (1 - i / 5), y0 + h / 4, x + tw + sway * (1 - i / 5), y0 + h / 4, x + sway * (1 - i / 5) * 0.4, y0 - h * 0.05, '#070c16');
    }
    rect(x - 1, H - h * 0.12, 2, h * 0.12, '#05080f');
  };
  tree(W * 0.05, H * 0.5, 9 * u, 1); tree(W * 0.16, H * 0.38, 7 * u, 2); tree(W * 0.27, H * 0.3, 5 * u, 3);
  tree(W * 0.95, H * 0.5, 9 * u, 4); tree(W * 0.84, H * 0.38, 7 * u, 5); tree(W * 0.73, H * 0.3, 5 * u, 6);
}

function portal(t, dt) {
  const r = Math.max(10, 15 * u), cx = W / 2, base = horizon + 4 * u, cy = base - r;
  // stone platform and glow on the ground
  g.fillStyle = 'rgba(111,159,255,.12)'; g.beginPath(); g.ellipse(cx, base, r * 1.9, r * 0.45, 0, 0, 6.283); g.fill();
  g.fillStyle = '#2a2f45'; g.beginPath(); g.ellipse(cx, base + 0.5 * u, r * 0.85, r * 0.17, 0, 0, 6.283); g.fill();
  const pulse = 0.85 + 0.15 * Math.sin(t * 3);
  for (const [k, a] of [[2.0, 0.05], [1.6, 0.08], [1.3, 0.12]]) { g.fillStyle = 'rgba(111,159,255,' + (a * pulse).toFixed(3) + ')'; g.beginPath(); g.arc(cx, cy, r * k, 0, 6.283); g.fill(); }
  // inner swirl
  const gr = g.createRadialGradient(cx, cy, 1, cx, cy, r);
  gr.addColorStop(0, 'rgba(190,225,255,.95)'); gr.addColorStop(0.55, 'rgba(90,130,230,.75)'); gr.addColorStop(1, 'rgba(30,40,130,.7)');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r * 0.88, 0, 6.283); g.fill();
  g.lineWidth = Math.max(1, u * 0.9);
  for (let i = 0; i < 3; i++) {
    g.strokeStyle = 'rgba(225,240,255,' + (0.75 - i * 0.18) + ')';
    const a0 = t * (0.9 + i * 0.35) + i * 2.1, rr = r * (0.7 - i * 0.2);
    g.beginPath(); g.arc(cx, cy, rr, a0, a0 + 1.7); g.stroke();
  }
  // dark ring + gold runes
  g.lineWidth = Math.max(2, u * 2.2); g.strokeStyle = '#3a2a5a'; g.beginPath(); g.arc(cx, cy, r * 0.95, 0, 6.283); g.stroke();
  g.lineWidth = 1; g.strokeStyle = 'rgba(242,211,74,' + (0.55 + 0.25 * Math.sin(t * 2)).toFixed(2) + ')'; g.beginPath(); g.arc(cx, cy, r * 1.12, 0, 6.283); g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = -t * 0.55 + (i / 12) * 6.283, rr = r * 1.12, on = 0.45 + 0.55 * Math.abs(Math.sin(t * 1.3 + i));
    g.fillStyle = 'rgba(242,211,74,' + on.toFixed(2) + ')';
    g.fillRect(Math.round(cx + Math.cos(a) * rr) - 1, Math.round(cy + Math.sin(a) * rr) - 1, 2, 2);
  }
  // sparks rising off the rim
  if (sparks.length < 90) for (let i = 0; i < 2; i++) {
    const a = rnd() * 6.283, gold = rnd() < 0.4;
    sparks.push({ x: cx + Math.cos(a) * r * 1.05, y: cy + Math.sin(a) * r * 1.05, vx: (rnd() - 0.5) * 6, vy: -(6 + rnd() * 14), life: 0.7 + rnd() * 1.1, t: 0, c: gold ? '242,211,74' : '150,200,255' });
  }
}

function drawSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.t += dt;
    if (s.t >= s.life) { sparks[i] = sparks[sparks.length - 1]; sparks.pop(); continue; }
    s.x += s.vx * dt; s.y += s.vy * dt; s.vy += s.grav || 0;
    g.fillStyle = 'rgba(' + s.c + ',' + (1 - s.t / s.life).toFixed(2) + ')';
    g.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
  }
}

function fireflies(t, dt) {
  for (const f of flies) {
    f.x += Math.sin(t * f.sp + f.p) * 5 * dt + Math.cos(t * 0.3 + f.p) * 2 * dt;
    f.y += Math.cos(t * f.sp * 0.8 + f.p) * 4 * dt;
    if (f.x < -4) f.x = W + 3; else if (f.x > W + 4) f.x = -3;
    f.y = Math.min(H * 0.92, Math.max(horizon - 14 * u, f.y));
    const a = 0.45 + 0.55 * Math.abs(Math.sin(t * 1.7 + f.p * 3));
    g.fillStyle = 'rgba(210,255,120,' + (a * 0.28).toFixed(2) + ')'; g.beginPath(); g.arc(f.x, f.y, 4.2, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(235,255,170,' + a.toFixed(2) + ')'; g.fillRect(Math.round(f.x) - 1, Math.round(f.y) - 1, 2, 2);
  }
}

function frame(now) {
  raf = 0;
  if (!visible) return;
  const t = now / 1000, dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  sky(t); hills(t); town(t); ground(t); portal(t, dt); pines(t); fireflies(t, dt); drawSparks(dt);
  // progress bar eases toward its target and never looks frozen: a tiny creep while we wait
  prog += (target - prog) * Math.min(1, dt * 3);
  const shown = Math.min(1, prog);
  barEl.style.width = (shown * 100).toFixed(1) + '%';
  steps.forEach((s, i) => { const th = [0.08, 0.62, 0.88][i]; s.classList.toggle('on', shown >= th); s.classList.toggle('now', shown >= th && (i === 2 || shown < [0.08, 0.62, 0.88][i + 1])); });
  raf = requestAnimationFrame(frame);
}

function startLoop() { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(frame); } }

// ---------------------------------------------------------------- tips
function showTip() {
  tipEl.classList.remove('in');
  setTimeout(() => { tipEl.textContent = 'Tip: ' + TIPS[tipI % TIPS.length]; tipI++; tipEl.classList.add('in'); }, 250);
}

// ---------------------------------------------------------------- tap the fireflies
function poke(e) {
  if (!visible) return;
  const r = cv.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
  let best = null, bd = 9;
  for (const f of flies) { const d = Math.hypot(f.x - x, f.y - y); if (d < bd) { bd = d; best = f; } }
  if (!best) return;
  for (let i = 0; i < 14; i++) sparks.push({ x: best.x, y: best.y, vx: (rnd() - 0.5) * 40, vy: (rnd() - 0.7) * 32, life: 0.5 + rnd() * 0.5, t: 0, c: '225,255,150', grav: 0.4 });
  Object.assign(best, newFly(true), { x: rnd() < 0.5 ? -3 : W + 3 });
  caught++;
  scoreEl.textContent = 'Fireflies caught: ' + caught;
  scoreEl.classList.remove('pop'); void scoreEl.offsetWidth; scoreEl.classList.add('pop');
  if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- public API (re-exported by ui.js)
export function setBootProgress(p) { target = Math.max(target, Math.min(1, p)); }

// opts.tips / opts.game = false hides the tips and the tap game (for fatal messages like "kicked")
export function showBoot(msg, hint = '', opts = {}) {
  clearTimeout(hideTimer);
  if (!visible) { visible = true; shownAt = performance.now(); prog = 0; target = 0.05; }
  root.classList.add('show');
  root.classList.remove('out');
  msgEl.textContent = msg;
  hintEl.textContent = hint;
  const tips = opts.tips !== false, game = opts.game !== false;
  tipEl.style.display = tips ? '' : 'none';
  playEl.style.display = scoreEl.style.display = game ? '' : 'none';
  if (tips && !tipTimer) { showTip(); tipTimer = setInterval(showTip, 5500); }
  if (!tips && tipTimer) { clearInterval(tipTimer); tipTimer = 0; }
  startLoop();
}

// fades the screen out (after it has been visible for a moment, so a fast start still shows the scene)
export function hideBoot() {
  if (!visible) return;
  clearTimeout(hideTimer);
  const wait = Math.max(0, 1300 - (performance.now() - shownAt));
  hideTimer = setTimeout(() => {
    target = 1;
    msgEl.textContent = 'Ready';
    root.classList.add('out');
    hideTimer = setTimeout(() => {
      visible = false;
      root.classList.remove('show', 'out');
      clearInterval(tipTimer); tipTimer = 0;
    }, 750);
  }, wait);
}

init();
addEventListener('resize', resize);
root.addEventListener('pointerdown', poke);
if (visible) { showTip(); tipTimer = setInterval(showTip, 5500); startLoop(); }
