// Postgres backend for the Store. Works with `pg` (Pool) in production and with
// anything that has `query(text, params)` -> {rows} (the tests use PGlite).
//
// Layout: one row per account (JSON document) and one per login token.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS nwo_accounts (
     key text PRIMARY KEY,
     doc jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS nwo_tokens (
     hash text PRIMARY KEY,
     acct text NOT NULL,
     exp bigint NOT NULL
   )`,
];

export class PgBackend {
  // Give either a connection string (url) or a ready pool-like object.
  constructor({ url = null, pool = null } = {}) {
    this.url = url;
    this.pool = pool;
    this.kind = 'postgres';
    this.async = true;
  }

  async connect() {
    if (this.pool) return;
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: this.url,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000, // free databases can take a few seconds to wake up
    });
    // idle connections get dropped by free hosts; that must not crash the server
    pool.on('error', (e) => console.error('[pg] idle client error:', e.message));
    this.pool = pool;
  }

  async load() {
    await this.connect();
    for (const sql of SCHEMA) await this.pool.query(sql);
    const accounts = {}, tokens = {};
    const a = await this.pool.query('SELECT key, doc FROM nwo_accounts');
    for (const r of a.rows) accounts[r.key] = typeof r.doc === 'string' ? JSON.parse(r.doc) : r.doc;
    const t = await this.pool.query('SELECT hash, acct, exp FROM nwo_tokens');
    for (const r of t.rows) tokens[r.hash] = { acct: r.acct, exp: Number(r.exp) };
    return { accounts, tokens };
  }

  // changes = {accounts: [[key, doc|null]], tokens: [[hash, {acct,exp}|null]]}
  // Each statement is an idempotent upsert/delete, so a retry after a failure is always safe.
  async write(_data, changes) {
    for (const [key, doc] of changes.accounts) {
      if (doc) {
        await this.pool.query(
          `INSERT INTO nwo_accounts (key, doc) VALUES ($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
          [key, JSON.stringify(doc)],
        );
      } else {
        await this.pool.query('DELETE FROM nwo_accounts WHERE key = $1', [key]);
      }
    }
    for (const [hash, tok] of changes.tokens) {
      if (tok) {
        await this.pool.query(
          `INSERT INTO nwo_tokens (hash, acct, exp) VALUES ($1, $2, $3)
           ON CONFLICT (hash) DO UPDATE SET acct = EXCLUDED.acct, exp = EXCLUDED.exp`,
          [hash, tok.acct, tok.exp],
        );
      } else {
        await this.pool.query('DELETE FROM nwo_tokens WHERE hash = $1', [hash]);
      }
    }
  }

  async close() {
    if (this.pool && this.pool.end) await this.pool.end();
    this.pool = this.url ? null : this.pool;
  }
}
