// The same persistence behaviour must hold for the JSON file store and for Postgres.
// Postgres is exercised with PGlite (real Postgres compiled to WebAssembly), no server needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Store, PgBackend } from '../server/store.js';
import { fakeClock } from './helpers.js';

const SAVE = { inv: { slots: [{ id: 'wood', n: 5 }], eq: {} }, hpRatio: 0.8, color: '#112233', lastSeed: 7, world: { x: 3, z: 4, r: 0 } };

// Each kind returns {open(): fresh Store on the same storage, cleanup()}
const KINDS = {
  file() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-store-'));
    return { open: (now) => { const s = new Store(dir, { now }); s.load(); return s; }, cleanup() { fs.rmSync(dir, { recursive: true, force: true }); } };
  },
  async postgres() {
    const db = new PGlite();
    return {
      db,
      open: async (now) => { const s = new Store(null, { now, backend: new PgBackend({ pool: db }) }); await s.init(); return s; },
      cleanup: () => db.close(),
    };
  },
};

for (const [kind, make] of Object.entries(KINDS)) {
  test(`[${kind}] accounts, tokens and saves survive a restart`, async () => {
    const env = await make();
    const now = fakeClock();
    const a = await env.open(now);
    const acct = await a.create('Alice', 'secret-pw');
    assert.ok(acct);
    assert.equal(await a.create('alice', 'other'), null, 'names are unique, case-insensitively');
    const token = a.issueToken('Alice');
    a.saveCharacter('Alice', SAVE);
    await a.close();

    const b = await env.open(now);
    assert.equal(b.count(), 1);
    assert.equal(b.get('ALICE').name, 'Alice');
    assert.equal(b.byToken(token).name, 'Alice', 'login token still works');
    assert.deepEqual(b.get('alice').save.inv, SAVE.inv);
    assert.equal(b.get('alice').save.worlds['7'].x, 3);
    assert.ok(!JSON.stringify(b.get('alice')).includes('secret-pw'), 'no plain-text password');
    await b.close();
    await env.cleanup();
  });

  test(`[${kind}] revoked and expired tokens stay gone`, async () => {
    const env = await make();
    const now = fakeClock();
    const a = await env.open(now);
    await a.create('Bob', 'pw-123456');
    const t1 = a.issueToken('Bob'), t2 = a.issueToken('Bob');
    a.revokeToken(t1);
    await a.close();

    now.advance(31 * 24 * 3600 * 1000); // past the 30-day lifetime
    const b = await env.open(now);
    assert.equal(b.byToken(t1), null, 'revoked');
    assert.equal(b.byToken(t2), null, 'expired');
    await b.flush();
    await b.close();
    const c = await env.open(now);
    assert.equal(Object.keys(c.data.tokens).length, 0, 'expired tokens were deleted from storage');
    await c.close();
    await env.cleanup();
  });

  test(`[${kind}] latest save wins and worlds are kept separately`, async () => {
    const env = await make();
    const now = fakeClock();
    const a = await env.open(now);
    await a.create('Cy', 'pw-123456');
    a.saveCharacter('Cy', SAVE);
    now.advance(1000);
    a.saveCharacter('Cy', { ...SAVE, lastSeed: 42, world: { x: 9, z: 9, r: 1 }, inv: { slots: [{ id: 'ore', n: 2 }], eq: {} } });
    await a.close();
    const b = await env.open(now);
    const s = b.get('cy').save;
    assert.equal(s.lastSeed, 42);
    assert.deepEqual(s.inv.slots[0], { id: 'ore', n: 2 });
    assert.deepEqual(Object.keys(s.worlds).sort(), ['42', '7']);
    await b.close();
    await env.cleanup();
  });
}

test('[postgres] an unchanged character does not rewrite the database', async () => {
  const env = await KINDS.postgres();
  const store = await env.open(fakeClock());
  await store.create('Dee', 'pw-123456');
  store.saveCharacter('Dee', SAVE);
  await store.flush();
  const writes = [];
  const real = store.backend.pool.query.bind(store.backend.pool);
  store.backend.pool.query = (sql, params) => { writes.push(sql.trim().split(/\s+/)[0]); return real(sql, params); };
  for (let i = 0; i < 5; i++) store.saveCharacter('Dee', SAVE); // autosave ticks with nothing new
  await store.flush();
  assert.equal(writes.length, 0, 'no queries for an unchanged save');
  store.saveCharacter('Dee', { ...SAVE, hpRatio: 0.5 });
  await store.flush();
  assert.equal(writes.length, 1, 'a real change is written once');
  store.backend.pool.query = real;
  await store.close();
  await env.cleanup();
});

test('[postgres] a failed write is retried, nothing is lost', async () => {
  const env = await KINDS.postgres();
  const store = await env.open(fakeClock());
  const origErr = console.error;
  console.error = () => {};
  try {
    await store.create('Eve', 'pw-123456');
    const real = store.backend.pool.query.bind(store.backend.pool);
    store.backend.pool.query = () => Promise.reject(new Error('connection terminated'));
    await store.flush();
    assert.equal(store.ok, false, 'store reports the problem');
    store.backend.pool.query = real; // database is back
    await store.flush();
    assert.equal(store.ok, true);
    const fresh = await env.open(fakeClock());
    assert.equal(fresh.get('eve').name, 'Eve', 'account arrived after the retry');
  } finally {
    console.error = origErr;
  }
  await env.cleanup();
});

test('an unreachable database falls back to the file store and the game keeps working', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwo-fallback-'));
  const broken = new PgBackend({ pool: { query: () => Promise.reject(new Error('ECONNREFUSED')) } });
  const store = new Store(dir, { backend: broken });
  const origErr = console.error;
  console.error = () => {};
  try { await store.init(); } finally { console.error = origErr; }
  assert.equal(store.kind, 'file');
  assert.equal(store.ok, false, 'health can report the database problem');
  assert.ok(await store.create('Fay', 'pw-123456'));
  await store.close();
  const again = new Store(dir);
  again.load();
  assert.equal(again.get('fay').name, 'Fay');
  fs.rmSync(dir, { recursive: true, force: true });
});
