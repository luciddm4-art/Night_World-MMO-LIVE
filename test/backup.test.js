import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PgBackend, Store } from '../server/store.js';
import { exportAccounts, importAccounts, validateDump } from '../server/backup.js';

async function liveStore() {
  const db = new PGlite();
  const store = new Store(null, { backend: new PgBackend({ pool: db }) });
  await store.init();
  return { db, store };
}

test('export then import into an empty database brings every account back (incl. bans and characters)', async () => {
  const a = await liveStore();
  const acc = await a.store.create('Hero1', 'pw-123456');
  await a.store.create('Hero2', 'pw-123456');
  a.store.saveCharacter('Hero1', { inv: { slots: [{ id: 'wood', n: 5 }], eq: {} }, hpRatio: 1, color: '#112233', lastSeed: 7, world: { x: 1, z: 2 } });
  a.store.setBan('Hero2', { reason: 'test', by: 'x', ts: 1 });
  await a.store.flush();
  const dump = await exportAccounts(a.db, () => 1_700_000_000_000);
  assert.equal(dump.count, 2);
  assert.equal(dump.exportedAt, '2023-11-14T22:13:20.000Z');

  const b = await liveStore();
  const r = await importAccounts(b.db, JSON.parse(JSON.stringify(dump)));
  assert.deepEqual(r, { inserted: 2, updated: 0, skipped: 0 });
  const restored = new Store(null, { backend: new PgBackend({ pool: b.db }) });
  await restored.init();
  assert.equal(restored.get('hero1').hash, acc.hash, 'the same password still works');
  assert.deepEqual(restored.get('hero1').save.inv.slots[0], { id: 'wood', n: 5 });
  assert.equal(restored.get('hero2').banned.reason, 'test');
});

test('import is safe by default: existing accounts are skipped unless --overwrite', async () => {
  const a = await liveStore();
  await a.store.create('Keep1', 'pw-123456'); await a.store.flush();
  const dump = await exportAccounts(a.db);
  dump.accounts.keep1.save = { marker: 'from-file' };
  const r1 = await importAccounts(a.db, dump);
  assert.deepEqual(r1, { inserted: 0, updated: 0, skipped: 1 });
  assert.equal((await exportAccounts(a.db)).accounts.keep1.save, null);
  const r2 = await importAccounts(a.db, dump, { overwrite: true });
  assert.deepEqual(r2, { inserted: 0, updated: 1, skipped: 0 });
  assert.equal((await exportAccounts(a.db)).accounts.keep1.save.marker, 'from-file');
});

test('a wrong or damaged file is refused before anything is written', async () => {
  const a = await liveStore();
  assert.throws(() => validateDump({ hello: 1 }), /not a Night World backup/);
  assert.throws(() => validateDump(null), /not a Night World backup/);
  assert.throws(() => validateDump({ format: 'nwo-backup', version: 1, accounts: { Bob: { name: 'Bob', hash: 'h', salt: 's' } } }), /damaged/);
  assert.throws(() => validateDump({ format: 'nwo-backup', version: 1, accounts: { bob: { name: 'bob', salt: 's' } } }), /damaged/);
  await assert.rejects(importAccounts(a.db, { format: 'nope' }), /not a Night World backup/);
  assert.equal((await exportAccounts(a.db)).count, 0);
});
