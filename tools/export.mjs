// node tools/export.mjs [file]      (needs DATABASE_URL)   ->  nwo-backup-YYYY-MM-DD.json
import fs from 'node:fs';
import { exportAccounts, cleanDatabaseUrl, DB_URL_HELP } from '../server/backup.js';
const DB_URL = cleanDatabaseUrl(process.env.DATABASE_URL);
if (!DB_URL) { console.error(process.env.DATABASE_URL ? DB_URL_HELP : 'Set DATABASE_URL first (the Neon connection string).'); process.exit(1); }
const { default: pg } = await import('pg');
const pool = new pg.Pool({ connectionString: DB_URL, max: 1, connectionTimeoutMillis: 20000 });
try {
  const dump = await exportAccounts(pool);
  const file = process.argv[2] || 'nwo-backup-' + dump.exportedAt.slice(0, 10) + '.json';
  fs.writeFileSync(file, JSON.stringify(dump), { mode: 0o600 });
  console.log('Exported ' + dump.count + ' accounts to ' + file + ' (contains password hashes: keep it private)');
} finally { await pool.end(); }
