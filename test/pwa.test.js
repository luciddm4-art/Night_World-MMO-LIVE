import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createGameServer } from '../server/index.js';

const R = (f) => new URL('../' + f, import.meta.url);
const pngSize = (f) => { const b = fs.readFileSync(R(f)); assert.equal(b.toString('latin1', 1, 4), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('manifest is valid and every icon exists with the size it claims', () => {
  const m = JSON.parse(fs.readFileSync(R('manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name && m.start_url && m.background_color && m.theme_color);
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of m.icons) assert.deepEqual(pngSize(i.src), i.sizes.split('x').map(Number), i.src);
  assert.deepEqual(pngSize('assets/apple-touch-icon.png'), [180, 180]);
});

test('service worker script parses and never touches other origins or /health', () => {
  const src = fs.readFileSync(R('sw.js'), 'utf8');
  new vm.Script(src); // syntax check
  assert.match(src, /url\.origin !== self\.location\.origin/);
  assert.match(src, /\/health/);
});

test('index.html links the manifest and icons, and the app registers the worker', () => {
  const html = fs.readFileSync(R('index.html'), 'utf8');
  for (const s of ['rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon"', 'name="theme-color"', 'id="installbtn"']) assert.ok(html.includes(s), s);
  assert.match(fs.readFileSync(R('src/pwa.js'), 'utf8'), /serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.match(fs.readFileSync(R('src/boot.js'), 'utf8'), /import '\.\/pwa\.js'/);
});

test('server serves manifest, worker and icons with the right headers', async () => {
  const gs = createGameServer({ port: 0, host: '127.0.0.1', dataDir: null, databaseUrl: '' });
  const port = await gs.listen();
  try {
    const base = `http://127.0.0.1:${port}`;
    const m = await fetch(base + '/manifest.webmanifest');
    assert.equal(m.status, 200);
    assert.match(m.headers.get('content-type'), /manifest\+json/);
    assert.equal(m.headers.get('cache-control'), 'no-cache');
    assert.equal((await m.json()).short_name, 'Night World');
    const sw = await fetch(base + '/sw.js');
    assert.match(sw.headers.get('content-type'), /javascript/);
    assert.equal(sw.headers.get('cache-control'), 'no-cache'); // so a new worker is noticed right away
    const ic = await fetch(base + '/assets/icon-192.png');
    assert.equal(ic.status, 200);
    assert.equal(ic.headers.get('content-type'), 'image/png');
  } finally { await gs.stop(); }
});
