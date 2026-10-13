import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGameServer } from '../server/index.js';

async function boot(opts = {}) {
  const logs = [];
  const gs = createGameServer({ port: 0, host: '127.0.0.1', dataDir: null, tickMs: 20, databaseUrl: '', log: (...a) => logs.push(a.join(' ')), ...opts });
  const port = await gs.listen();
  return { gs, logs, http: `http://127.0.0.1:${port}` };
}
const post = (env, body, headers = {}) => fetch(env.http + '/clienterr', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'text/plain', ...headers } });

test('browser error reports are logged, sanitised and rate limited', async () => {
  const env = await boot();
  try {
    const ok = await post(env, { m: 'x is not a function @ src/main.js:10\nINJECTED LINE', v: 'abc12345', ua: 'Mozilla/5.0 (Linux; Android 14)' });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), '*');
    assert.equal(env.gs.clientErrors.length, 1);
    assert.ok(!env.gs.clientErrors[0].m.includes('\n'), 'newlines are stripped so nobody can forge log lines');
    const line = env.logs.find((l) => l.startsWith('CLIENT-ERROR'));
    assert.match(line, /build abc12345/);
    assert.match(line, /x is not a function/);

    assert.equal((await post(env, 'not json')).status, 400);
    assert.equal((await post(env, { nope: 1 })).status, 400);
    assert.equal((await fetch(env.http + '/clienterr', { method: 'OPTIONS' })).status, 204);
    assert.equal((await post(env, { m: 'a'.repeat(5000) })).status, 413, 'oversized bodies are refused');
    for (let i = 0; i < 12; i++) await post(env, { m: 'flood ' + i });
    assert.equal((await post(env, { m: 'one more' })).status, 429, 'a flood from one network is cut off');
    assert.ok(env.gs.clientErrors.length <= 20);
    assert.equal((await fetch(env.http + '/clienterr')).status, 404, 'GET is not an endpoint');
  } finally { await env.gs.stop(); }
});

test('/health reports how long a server tick takes, and the stats line summarises the server', async () => {
  const env = await boot();
  try {
    await new Promise((r) => setTimeout(r, 150));
    const h = await (await fetch(env.http + '/health')).json();
    assert.equal(typeof h.tickMs.avg, 'number');
    assert.equal(typeof h.tickMs.max, 'number');
    assert.ok(h.tickMs.avg < 20, 'an empty server ticks far inside its 20ms budget');
    env.gs.statsLine();
    const line = env.logs.find((l) => l.startsWith('stats'));
    assert.match(line, /players=0 worlds=0 sockets=0 tick avg=/);
    assert.match(line, /rss=\d+MB/);
    assert.match(line, /storage=memory/);
  } finally { await env.gs.stop(); }
});

test('the browser reports its own crashes (boot.js wires telemetry)', () => {
  const boot = fs.readFileSync(new URL('../src/boot.js', import.meta.url), 'utf8');
  assert.match(boot, /import \{ reportError \} from '\.\/telemetry\.js'/);
  assert.equal((boot.match(/reportError\(/g) || []).length >= 4, true);
  const t = fs.readFileSync(new URL('../src/telemetry.js', import.meta.url), 'utf8');
  assert.match(t, /\/clienterr/);
});
