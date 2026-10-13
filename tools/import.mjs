// node tools/import.mjs <file> [--overwrite]      (needs DATABASE_URL)
// Default: accounts that already exist are skipped. --overwrite: the file replaces them.
import fs from 'node:fs';
import { importAccounts } from '../server/backup.js';
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('Usage: node tools/import.mjs <backup.json> [--overwrite]'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first (the Neon connection string).'); process.exit(1); }
const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 20000 });
try {
  const r = await importAccounts(pool, dump, { overwrite: process.argv.includes('--overwrite') });
  console.log(`Done: ${r.inserted} added, ${r.updated} replaced, ${r.skipped} skipped (already there).`);
} finally { await pool.end(); }
