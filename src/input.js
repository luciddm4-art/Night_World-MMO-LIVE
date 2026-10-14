// Keyboard, touch joystick and drag-to-look.
export const input = { keys: {}, joy: null, look: null, yaw: 0, pitch: 0.35 };

export function initInput(canvas, cb) {
  const { keys } = input;
  const stickEl = document.getElementById('stick'), kn = document.getElementById('knob');

  function sj(e) {
    const r = stickEl.getBoundingClientRect();
    let dx = (e.clientX - r.left - r.width / 2) / (r.width / 2), dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    input.joy.dx = dx;
    input.joy.dy = dy;
    kn.style.transform = 'translate(' + dx * r.width * 0.3 + 'px,' + dy * r.height * 0.3 + 'px)';
  }
  stickEl.addEventListener('pointerdown', (e) => { stickEl.setPointerCapture(e.pointerId); input.joy = { id: e.pointerId, dx: 0, dy: 0 }; sj(e); });
  stickEl.addEventListener('pointermove', (e) => { if (input.joy && e.pointerId === input.joy.id) sj(e); });
  const sEnd = (e) => { if (input.joy && e.pointerId === input.joy.id) { input.joy = null; kn.style.transform = ''; } };
  stickEl.addEventListener('pointerup', sEnd);
  stickEl.addEventListener('pointercancel', sEnd);

  const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  addEventListener('keydown', (e) => {
    if (typing(e)) return;
    keys[e.code] = 1;
    if (e.code === 'Space') { cb.attack(); e.preventDefault(); }
    if (e.code === 'KeyE' && !e.repeat) cb.interact();
    if (e.code === 'KeyI' && !e.repeat) cb.toggleInv();
    if (e.code === 'KeyC' && !e.repeat) cb.craft();
    if (e.code === 'KeyM' && !e.repeat) cb.map();
    if (e.code === 'KeyT' && !e.repeat) cb.target();
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { // skills 1-5 (Q W E R D), potion Z, food X
      const si = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
      if (si >= 0) cb.skill(si);
      if (e.code === 'KeyZ') cb.use('potion');
      if (e.code === 'KeyX') cb.use('food');
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) { e.preventDefault(); cb.chat(); }
    if (e.code === 'Escape') cb.escape();
  });
  addEventListener('keyup', (e) => { keys[e.code] = 0; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = 0; });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    input.look = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() };
  });
  canvas.addEventListener('pointermove', (e) => {
    const look = input.look;
    if (look && e.pointerId === look.id) {
      input.yaw -= (e.clientX - look.x) * 0.006;
      input.pitch = Math.max(0.05, Math.min(1.2, input.pitch + (e.clientY - look.y) * 0.004));
      look.x = e.clientX;
      look.y = e.clientY;
    }
  });
  const up = (e) => {
    if (input.joy && e.pointerId === input.joy.id) input.joy = null;
    const look = input.look;
    if (look && e.pointerId === look.id) {
      input.look = null;
      // desktop: a plain left click (no drag) is an attack
      const tap = Math.hypot(e.clientX - look.x0, e.clientY - look.y0) < 6 && performance.now() - look.t0 < 350;
      if (e.type === 'pointerup' && tap && e.pointerType !== 'mouse') cb.pick(e.clientX, e.clientY); // a finger tap marks a player
      else if (e.type === 'pointerup' && e.pointerType === 'mouse' && e.button === 0 && tap && !cb.pick(e.clientX, e.clientY)) cb.attack(); // a click on a player marks them, anywhere else attacks
    }
  };

  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
}
