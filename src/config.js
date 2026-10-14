import { normalizeSeed } from '../shared/data.js';
import { realmOf } from '../shared/realm.js';

// World seed comes from ?seed=N (the travel portal navigates to it).
export const SEED = (() => {
  const m = location.search.match(/[?&]seed=(-?\d+)/);
  return m ? normalizeSeed(parseInt(m[1], 10)) : 7;
})();

// Which tier we are in: spawn point, portal, safe zone, map size (shared/realm.js).
export const REALM = realmOf(SEED);

const HOSTED_SERVER = 'night-world-mmo-live.onrender.com';
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

// Where is the game server?
//  - served by the game server itself (Render, localhost):   same origin
//  - served from GitHub Pages / a file:                       the hosted Render server
//  - dev override ?server=host:port (localhost only, so a crafted link can't
//    make the login form talk to someone else's server)
export function endpoints() {
  let host = HOSTED_SERVER, secure = true;
  const onPages = location.hostname.endsWith('github.io') || location.protocol === 'file:';
  if (!onPages) {
    host = location.host;
    secure = location.protocol === 'https:';
  }
  const override = new URLSearchParams(location.search).get('server');
  if (isLocal && override && /^[\w.-]+(:\d+)?$/.test(override)) {
    host = override;
    secure = false;
  }
  return { ws: (secure ? 'wss://' : 'ws://') + host, http: (secure ? 'https://' : 'http://') + host };
}
