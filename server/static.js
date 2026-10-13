// Minimal static file server so the same Node process can serve the game itself
// (handy for local play and for hosting everything on Render). Only an
// allow-list of top-level paths is exposed — never server/, data/ or test/.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC_DIRS = new Set(['css', 'src', 'shared', 'vendor', 'assets']);
const PUBLIC_FILES = new Set(['index.html', 'favicon.ico', 'manifest.webmanifest', 'sw.js']);
const COMPRESSIBLE = new Set(['.html', '.webmanifest', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);

export function createStaticHandler(root) {
  const base = path.resolve(root);
  const gzCache = new Map(); // file -> {mtime, buf}

  return function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return false;
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname.includes('\0')) return false;
    const rel = pathname.replace(/^\/+/, '');
    const top = rel.split('/')[0];
    if (!PUBLIC_FILES.has(rel) && !PUBLIC_DIRS.has(top)) return false;
    const file = path.resolve(base, rel);
    if (file !== base && !file.startsWith(base + path.sep)) return false;

    let st;
    try { st = fs.statSync(file); } catch { return false; }
    if (!st.isFile()) return false;

    const ext = path.extname(file).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': ext === '.html' || rel === 'sw.js' || rel === 'manifest.webmanifest' ? 'no-cache' : new URL(req.url, 'http://x').searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      vary: 'Accept-Encoding',
    };
    const wantsGzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    let body;
    if (wantsGzip) {
      let c = gzCache.get(file);
      if (!c || c.mtime !== st.mtimeMs) {
        c = { mtime: st.mtimeMs, buf: zlib.gzipSync(fs.readFileSync(file)) };
        gzCache.set(file, c);
      }
      body = c.buf;
      headers['content-encoding'] = 'gzip';
    } else {
      body = fs.readFileSync(file);
    }
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
