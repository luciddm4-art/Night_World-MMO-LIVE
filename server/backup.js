// Export / import of all accounts (characters, inventories, bans) as one JSON file.
// Works with anything that has query(text, params) -> {rows}: a `pg` Pool in production, PGlite in tests.
// The file contains password HASHES, so treat it like a password: never commit it, never post it.
// People paste the connection string with extras: `psql 'postgresql://...'`, `DATABASE_URL=postgresql://...`, quotes,
// spaces or a newline. `pg` then silently treats the whole thing as a database NAME on a host called "base".
// Pull out just the postgresql:// URL; null if there isn't one.
export function cleanDatabaseUrl(raw) {
  const m = /postgres(?:ql)?:\/\/[^\s'"`]+/.exec(String(raw ?? ''));
  return m ? m[0] : null;
}
export const DB_URL_HELP = 'DATABASE_URL must be the full Neon connection string, starting with postgresql:// (no quotes, no "psql", no "DATABASE_URL=").';

export const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS nwo_accounts (
  key text PRIMARY KEY, doc jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;

export async function exportAccounts(db, now = Date.now) {
  await db.query(SCHEMA_SQL);
  const r = await db.query('SELECT key, doc FROM nwo_accounts ORDER BY key');
  const accounts = {};
  for (const row of r.rows) accounts[row.key] = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc;
  return { format: 'nwo-backup', version: 1, exportedAt: new Date(now()).toISOString(), count: r.rows.length, accounts };
}

export function validateDump(dump) {
  if (!dump || dump.format !== 'nwo-backup' || dump.version !== 1 || typeof dump.accounts !== 'object' || !dump.accounts) throw new Error('This is not a Night World backup file');
  for (const [k, d] of Object.entries(dump.accounts)) {
    if (k !== String(k).toLowerCase() || !d || typeof d !== 'object' || typeof d.name !== 'string' || d.name.toLowerCase() !== k || typeof d.hash !== 'string' || typeof d.salt !== 'string') {
      throw new Error('Backup file is damaged near account "' + String(k).slice(0, 20) + '"');
    }
  }
}

// overwrite=false: accounts that already exist are left alone (safe default). overwrite=true: the file wins.
export async function importAccounts(db, dump, { overwrite = false } = {}) {
  validateDump(dump);
  await db.query(SCHEMA_SQL);
  let inserted = 0, updated = 0, skipped = 0;
  for (const [key, doc] of Object.entries(dump.accounts)) {
    const have = await db.query('SELECT 1 FROM nwo_accounts WHERE key = $1', [key]);
    if (have.rows.length && !overwrite) { skipped++; continue; }
    await db.query(
      `INSERT INTO nwo_accounts (key, doc) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [key, JSON.stringify(doc)],
    );
    if (have.rows.length) updated++; else inserted++;
  }
  return { inserted, updated, skipped };
}
