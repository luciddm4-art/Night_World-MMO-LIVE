// Keeps a free Render web service from falling asleep.
// Render puts free services to sleep after ~15 minutes without inbound HTTP traffic. Requests the service
// makes to its own PUBLIC url come back in through Render's proxy, so they count as traffic. We hit /health
// every few minutes for as long as the process is up. (This cannot wake a service that is already asleep:
// that is what the GitHub Action and an optional external pinger are for.)
export function keepAliveUrl(env = process.env) {
  if (env.KEEPALIVE === 'off') return null;
  const base = env.KEEPALIVE_URL || env.RENDER_EXTERNAL_URL; // Render sets RENDER_EXTERNAL_URL automatically
  if (!base || !/^https:\/\//.test(base)) return null; // never ping on a laptop / plain http
  return base.replace(/\/+$/, '') + '/health';
}

export function startKeepAlive({ url, intervalMs = 4 * 60 * 1000, fetchFn = globalThis.fetch, log = () => {} } = {}) {
  if (!url || typeof fetchFn !== 'function') return { stop() {}, ping: async () => false };
  let fails = 0;
  const ping = async () => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const res = await fetchFn(url, { signal: ctl.signal, headers: { 'user-agent': 'nwo-keepalive' } });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (fails) log('keepalive ok again after ' + fails + ' failure(s)');
      fails = 0;
      return true;
    } catch (e) {
      if (++fails === 1 || fails % 10 === 0) log('keepalive ping failed (' + fails + '): ' + e.message);
      return false;
    }
  };
  const timer = setInterval(ping, intervalMs);
  timer.unref(); // never keeps the process alive on its own
  return { stop: () => clearInterval(timer), ping };
}
