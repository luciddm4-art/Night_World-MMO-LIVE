// Service worker: makes the game installable and makes the second start fast.
//  - the page (navigations): network first, falls back to the saved copy if the network is slow or gone
//  - files whose URL carries ?v=<hash> (scripts, css): saved forever, a new hash is a new file
//  - everything else on this site (three.js, icons): saved copy first, refreshed in the background
// It never touches the game server (a different origin) or the websocket, and /health is always live.
const CACHE = 'nwo-shell-1';
const NAV_TIMEOUT = 4000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('nwo-shell-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function put(cache, req, res) {
  if (!res || !res.ok || res.type === 'opaque') return res;
  const url = new URL(req.url);
  if (url.searchParams.has('v')) {
    // drop older versions of the same file so the cache never grows
    for (const old of await cache.keys()) {
      const u = new URL(old.url);
      if (u.pathname === url.pathname && u.search !== url.search) await cache.delete(old);
    }
  }
  await cache.put(req, res.clone());
  return res;
}

async function navigate(req) {
  const cache = await caches.open(CACHE);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), NAV_TIMEOUT);
    const res = await fetch(req, { signal: ctl.signal });
    clearTimeout(t);
    return await put(cache, new Request(new URL('./index.html', self.registration.scope).href), res);
  } catch {
    return (await cache.match(new URL('./index.html', self.registration.scope).href)) || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // game server, fonts, anything external
  if (url.pathname.endsWith('/health') || url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate') { e.respondWith(navigate(req)); return; }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (url.searchParams.has('v')) {
      if (hit) return hit;
      return put(cache, req, await fetch(req));
    }
    const fresh = fetch(req).then((r) => put(cache, req, r)).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    return (await fresh) || Response.error();
  })());
});
