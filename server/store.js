// Persistence for accounts, login tokens and character saves.
//
// The Store keeps everything in memory (it is tiny) and writes changes through
// a backend:
//   * PgBackend   - Postgres, used when DATABASE_URL is set. Survives redeploys.
//   * FileBackend - a JSON file in DATA_DIR. On Render's free tier the disk is
//                   ephemeral, so this is only for local play, tests and as a
//                   fallback if the database cannot be reached.
//   * none        - memory only (dataDir === null), used by tests.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { PgBackend } from './pg-backend.js';

export { PgBackend };

const scrypt = promisify(crypto.scrypt);
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_WORLDS_SAVED = 20;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPassword(password, saltHex = crypto.randomBytes(16).toString('hex')) {
  const buf = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  return { salt: saltHex, hash: buf.toString('hex') };
}

export async function verifyPassword(password, salt, hashHex) {
  const { hash } = await hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}


// ------------------------------------------------------------------ file backend
export class FileBackend {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'accounts.json');
    this.kind = 'file';
    this.writing = Promise.resolve();
  }

  loadSync() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.accounts && raw.tokens) return raw;
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[store] could not read', this.file, e.message);
    }
    return null;
  }

  // The file is small, so every write is a full snapshot (atomic: tmp + rename).
  write(data) {
    const json = JSON.stringify(data);
    const tmp = this.file + '.tmp';
    this.writing = this.writing
      .then(() => fs.promises.writeFile(tmp, json))
      .then(() => fs.promises.rename(tmp, this.file))
      .catch((e) => console.error('[store] write failed:', e.message));
    return this.writing;
  }

  writeSync(data) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] sync write failed:', e.message);
    }
  }
}

// ------------------------------------------------------------------ store
export class Store {
  // dir: folder for the file backend (null -> memory only)
  // backend: optional explicit backend (e.g. a PgBackend)
  constructor(dir, { now = Date.now, backend = null } = {}) {
    this.dir = dir;
    this.now = now;
    this.backend = backend || (dir ? new FileBackend(dir) : null);
    this.fallbackDir = dir;
    this.data = { accounts: {}, tokens: {} };
    this.dirtyAcc = new Set();
    this.dirtyTok = new Set();
    this.timer = null;
    this.writing = Promise.resolve();
    this.sigs = new WeakMap(); // account -> signature of the last saved character (skip no-op writes)
    this.lastError = null;
    this.ready = !(this.backend && this.backend.async);
  }

  get kind() { return this.backend ? this.backend.kind : 'memory'; }
  get ok() { return !this.lastError; }

  // Synchronous load for the file backend.
  load() {
    if (this.backend && !this.backend.async) {
      const raw = this.backend.loadSync();
      if (raw) this.data = raw;
    }
    this.prune();
  }

  // Async start-up: connects to the database and loads everything. If it fails we log it
  // loudly and carry on with the file store, so the game stays playable.
  async init() {
    if (this.ready) return;
    try {
      const raw = await this.backend.load();
      this.data = raw;
      this.ready = true;
      this.lastError = null;
    } catch (e) {
      console.error('[store] DATABASE UNAVAILABLE, falling back to the local file store:', e.message);
      try { await this.backend.close?.(); } catch { /* ignore */ }
      this.lastError = e.message;
      this.backend = this.fallbackDir ? new FileBackend(this.fallbackDir) : null;
      this.ready = true;
      this.load();
    }
    this.prune();
  }

  prune() {
    const t = this.now();
    for (const [h, v] of Object.entries(this.data.tokens)) {
      if (v.exp < t) { delete this.data.tokens[h]; this.dirtyTok.add(h); }
    }
  }

  get(name) { return this.data.accounts[String(name).toLowerCase()] || null; }
  count() { return Object.keys(this.data.accounts).length; }

  async create(name, password) {
    const key = name.toLowerCase();
    if (this.data.accounts[key]) return null;
    const { salt, hash } = await hashPassword(password);
    // re-check: another register may have won the race while scrypt ran
    if (this.data.accounts[key]) return null;
    this.data.accounts[key] = { name, salt, hash, created: this.now(), save: null };
    this.dirtyAcc.add(key);
    this.scheduleFlush();
    return this.data.accounts[key];
  }

  issueToken(name) {
    const token = crypto.randomBytes(32).toString('hex');
    const h = sha(token);
    this.data.tokens[h] = { acct: name.toLowerCase(), exp: this.now() + TOKEN_TTL_MS };
    this.dirtyTok.add(h);
    this.scheduleFlush();
    return token;
  }

  byToken(token) {
    if (typeof token !== 'string' || token.length !== 64) return null;
    const t = this.data.tokens[sha(token)];
    if (!t || t.exp < this.now()) return null;
    return this.data.accounts[t.acct] || null;
  }

  revokeToken(token) {
    if (typeof token !== 'string') return;
    const h = sha(token);
    delete this.data.tokens[h];
    this.dirtyTok.add(h);
    this.scheduleFlush();
  }

  // save = Player.toSave(seed) output
  saveCharacter(name, save) {
    const acct = this.get(name);
    if (!acct) return;
    const sig = JSON.stringify([save.inv, save.hpRatio, save.color, save.lastSeed, save.world]);
    const same = this.sigs.get(acct) === sig;
    this.sigs.set(acct, sig);
    if (same && acct.save) return; // nothing changed since the last save: don't wake the database
    const prev = acct.save || { worlds: {} };
    const worlds = { ...(prev.worlds || {}) };
    worlds[String(save.lastSeed)] = { ...save.world, t: this.now() };
    const keys = Object.keys(worlds);
    if (keys.length > MAX_WORLDS_SAVED) {
      keys.sort((a, b) => (worlds[a].t || 0) - (worlds[b].t || 0));
      for (const k of keys.slice(0, keys.length - MAX_WORLDS_SAVED)) delete worlds[k];
    }
    acct.save = { inv: save.inv, hpRatio: save.hpRatio, color: save.color, lastSeed: save.lastSeed, worlds };
    this.dirtyAcc.add(name.toLowerCase());
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (!this.backend || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 1500);
    this.timer.unref?.();
  }

  // Write pending changes. Failed writes keep their changes queued and are retried by the next flush.
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.backend || !this.ready) return this.writing;
    this.writing = this.writing.then(async () => {
      if (!this.backend || (!this.dirtyAcc.size && !this.dirtyTok.size && this.backend.kind === 'postgres')) return;
      const accs = [...this.dirtyAcc], toks = [...this.dirtyTok];
      this.dirtyAcc.clear();
      this.dirtyTok.clear();
      try {
        await this.backend.write(this.data, {
          accounts: accs.map((k) => [k, this.data.accounts[k] || null]),
          tokens: toks.map((h) => [h, this.data.tokens[h] || null]),
        });
        this.lastError = null;
      } catch (e) {
        accs.forEach((k) => this.dirtyAcc.add(k));
        toks.forEach((h) => this.dirtyTok.add(h));
        this.lastError = e.message;
        console.error('[store] write failed (will retry):', e.message);
        this.scheduleFlush();
      }
    });
    return this.writing;
  }

  // Sync flush for the file backend; for databases use close().
  flushSync() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.backend && this.backend.kind === 'file') this.backend.writeSync(this.data);
  }

  // Final flush on shutdown (works for every backend).
  async close() {
    await this.flush();
    if (this.backend && this.backend.kind === 'file') this.backend.writeSync(this.data);
    await this.backend?.close?.();
  }
}
