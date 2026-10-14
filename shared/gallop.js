// Donkey gallop. Ride and keep moving for 3 seconds and the donkey gallops: +10% speed.
// A bite from a rabbit ends the gallop; it comes back after another 3 seconds of riding.
// Standing still for half a second also ends it. The page runs this for its own movement; the server's speed limit
// already has room for the extra 10% (see Room.onPos), so it does not need to track it.
import { CFG } from './data.js';

const IDLE_RESET_S = 0.5;
export const newRide = () => ({ t: 0, idle: 0, gallop: false });

// dt in seconds; `moving` = the rider is pushing the stick / keys this frame
export function stepRide(r, dt, moving, mounted) {
  if (!mounted) { r.t = 0; r.idle = 0; r.gallop = false; return r; }
  if (moving) {
    r.idle = 0;
    r.t += dt;
    if (r.t >= CFG.GALLOP_AFTER_MS / 1000) r.gallop = true;
  } else {
    r.idle += dt;
    if (r.idle > IDLE_RESET_S) { r.t = 0; r.gallop = false; }
  }
  return r;
}

export function hitRide(r) { r.t = 0; r.idle = 0; r.gallop = false; return r; }
export const rideSpeed = (r) => CFG.RIDE_SPEED * (r.gallop ? CFG.GALLOP_MULT : 1);
