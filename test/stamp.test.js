import test from 'node:test';
import assert from 'node:assert/strict';
import { isStamped, buildStamped } from '../tools/stamp.mjs';
import fs from 'node:fs';

test('index.html carries up-to-date script versions (run `npm run stamp` after editing src/ or shared/)', () => {
  assert.ok(isStamped(), 'index.html is out of date: run `npm run stamp` and commit the result');
});

test('every module is in the import map, so none can be served stale', () => {
  const html = buildStamped(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  for (const f of fs.readdirSync(new URL('../src/', import.meta.url)).filter((n) => n.endsWith('.js'))) {
    assert.match(map['./src/' + f], /\?v=[0-9a-f]{8}$/, f);
  }
  assert.ok(map['./shared/data.js']);
  assert.match(html, /src="src\/boot\.js\?v=[0-9a-f]{8}"/);
  assert.match(html, /href="css\/style\.css\?v=[0-9a-f]{8}"/);
});
