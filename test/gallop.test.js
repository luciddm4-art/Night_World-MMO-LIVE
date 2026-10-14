import test from 'node:test';
import assert from 'node:assert/strict';
import { newRide, stepRide, hitRide, rideSpeed } from '../shared/gallop.js';
import { CFG } from '../shared/data.js';

const run = (r, secs, moving = true, mounted = true) => { for (let i = 0; i < secs * 10; i++) stepRide(r, 0.1, moving, mounted); return r; };

test('gallop: after 3 seconds of riding and moving the donkey gallops (+10%)', () => {
  const r = newRide();
  run(r, 2.8);
  assert.equal(r.gallop, false);
  assert.equal(rideSpeed(r), CFG.RIDE_SPEED);
  run(r, 0.5);
  assert.equal(r.gallop, true);
  assert.ok(Math.abs(rideSpeed(r) - CFG.RIDE_SPEED * 1.1) < 1e-9);
});

test('gallop: a bite ends it and it only comes back after 3 more seconds of riding', () => {
  const r = run(newRide(), 4);
  assert.equal(r.gallop, true);
  hitRide(r);
  assert.equal(r.gallop, false);
  run(r, 2.5);
  assert.equal(r.gallop, false);
  run(r, 0.8);
  assert.equal(r.gallop, true);
});

test('gallop: stopping for a moment ends it, a tiny pause does not, and dismounting resets', () => {
  const r = run(newRide(), 4);
  run(r, 0.3, false);
  assert.equal(r.gallop, true, 'a short pause is fine');
  run(r, 0.4, false);
  assert.equal(r.gallop, false);
  run(r, 2, true);
  assert.equal(r.gallop, false, 'the 3 seconds start over');
  run(r, 4);
  assert.equal(r.gallop, true);
  stepRide(r, 0.1, true, false); // dismounted
  assert.deepEqual(r, { t: 0, idle: 0, gallop: false });
});
