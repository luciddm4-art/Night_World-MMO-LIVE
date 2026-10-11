// Tiny JSON-file persistence for accounts, login tokens and character saves.
//
// IMPORTANT: this writes to DATA_DIR on the server's disk. Free hosts such as
// Render's free tier have an *ephemeral* disk, so the file is wiped on every
// redeploy / cold restart. Mount a persistent disk (or swap this class for a
// database) if you want accounts to survive. The interface is deliberately small.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

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

export class Store {
  constructor(dir, { now = Date.now } = {}) {
    this.dir = dir;
    this.file = dir ? path.join(dir, 'accounts.json') : null; // dir === null -> memory only
    this.now = now;
    this.data = { accounts: {}, tokens: {} };
    this.timer = null;
    this.writing = Promise.resolve();
  }

  load() {
    if (!this.file) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.accounts && raw.tokens) this.data = raw;
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[store] could not read', this.file, e.message);
    }
    this.prune();
  }

  prune() {
    const t = this.now();
    for (const [h, v] of Object.entries(this.data.tokens)) if (v.exp < t) delete this.data.tokens[h];
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
    this.scheduleFlush();
    return this.data.accounts[key];
  }

  issueToken(name) {
    const token = crypto.randomBytes(32).toString('hex');
    this.data.tokens[sha(token)] = { acct: name.toLowerCase(), exp: this.now() + TOKEN_TTL_MS };
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
    if (typeof token === 'string') delete this.data.tokens[sha(token)];
    this.scheduleFlush();
  }

  // save = Player.toSave(seed) output
  saveCharacter(name, save) {
    const acct = this.get(name);
    if (!acct) return;
    const prev = acct.save || { worlds: {} };
    const worlds = { ...(prev.worlds || {}) };
    worlds[String(save.lastSeed)] = { ...save.world, t: this.now() };
    const keys = Object.keys(worlds);
    if (keys.length > MAX_WORLDS_SAVED) {
      keys.sort((a, b) => (worlds[a].t || 0) - (worlds[b].t || 0));
      for (const k of keys.slice(0, keys.length - MAX_WORLDS_SAVED)) delete worlds[k];
    }
    acct.save = { inv: save.inv, hpRatio: save.hpRatio, color: save.color, lastSeed: save.lastSeed, worlds };
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 1500);
    this.timer.unref?.();
  }

  flush() {
    if (!this.file) return Promise.resolve();
    const json = JSON.stringify(this.data);
    const tmp = this.file + '.tmp';
    this.writing = this.writing
      .then(() => fs.promises.writeFile(tmp, json))
      .then(() => fs.promises.rename(tmp, this.file))
      .catch((e) => console.error('[store] write failed:', e.message));
    return this.writing;
  }

  flushSync() {
    if (!this.file) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] sync write failed:', e.message);
    }
  }
}
