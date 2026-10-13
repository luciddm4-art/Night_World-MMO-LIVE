import test from 'node:test';
import assert from 'node:assert/strict';
import { keepAliveUrl, startKeepAlive } from '../server/keepalive.js';

test('keepalive url: uses Render\'s public url, can be overridden or turned off, never plain http', () => {
  assert.equal(keepAliveUrl({ RENDER_EXTERNAL_URL: 'https://x.onrender.com' }), 'https://x.onrender.com/health');
  assert.equal(keepAliveUrl({ RENDER_EXTERNAL_URL: 'https://x.onrender.com/' }), 'https://x.onrender.com/health');
  assert.equal(keepAliveUrl({ KEEPALIVE_URL: 'https://y.example.com', RENDER_EXTERNAL_URL: 'https://x.onrender.com' }), 'https://y.example.com/health');
  assert.equal(keepAliveUrl({ RENDER_EXTERNAL_URL: 'https://x.onrender.com', KEEPALIVE: 'off' }), null);
  assert.equal(keepAliveUrl({}), null, 'local runs do not ping');
  assert.equal(keepAliveUrl({ KEEPALIVE_URL: 'http://localhost:8080' }), null);
});

test('keepalive: pings on a timer, survives failures, stops cleanly', async () => {
  const calls = [];
  let fail = true;
  const fetchFn = async (url) => { calls.push(url); if (fail) throw new Error('boom'); return { ok: true }; };
  const logs = [];
  const ka = startKeepAlive({ url: 'https://x/health', intervalMs: 20, fetchFn, log: (m) => logs.push(m) });
  await new Promise((r) => setTimeout(r, 90));
  assert.ok(calls.length >= 3, 'pinged repeatedly even though it failed: ' + calls.length);
  assert.equal(logs.length, 1, 'repeated failures are logged once, not every time');
  fail = false;
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(logs.some((m) => /ok again/.test(m)));
  ka.stop();
  const n = calls.length;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.length, n, 'no pings after stop');
});

test('keepalive: a non-2xx answer counts as a failure; no url = no-op', async () => {
  const ka = startKeepAlive({ url: 'https://x/health', fetchFn: async () => ({ ok: false, status: 503 }), intervalMs: 1e6 });
  assert.equal(await ka.ping(), false);
  ka.stop();
  const none = startKeepAlive({});
  assert.equal(await none.ping(), false);
  none.stop();
});
