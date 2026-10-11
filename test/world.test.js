import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../shared/world.js';
import { findThings } from './helpers.js';

test('same seed -> identical world, different seed -> different world', () => {
  const a = createWorld(42), b = createWorld(42), c = createWorld(43);
  assert.equal(a.hgt(100, 50), b.hgt(100, 50));
  assert.deepEqual(a.ctrees(3, 4), b.ctrees(3, 4));
  assert.deepEqual(a.cres(2, 2), b.cres(2, 2));
  assert.notEqual(a.hgt(100, 50), c.hgt(100, 50));
});

test('the spawn hall is flat', () => {
  const w = createWorld(7);
  assert.equal(w.hgt(0, 0), 0);
  assert.equal(w.hgt(5, -5), 0);
});

test('tree and node ids resolve to the right positions', () => {
  const { tree, node, world } = findThings(7);
  assert.ok(tree && node, 'test world should contain a tree and a node');
  const t = world.treeAt(tree.id);
  assert.equal(t.x, tree.x);
  assert.equal(world.nodeAt(node.id).type, node.type);
});

test('malformed or out-of-range ids are rejected', () => {
  const w = createWorld(7);
  for (const id of ['', 'x', '1,2', '1,2,3,4', '999999999,0,0', 'gold:1:1:0', 'ore:1:1:99', '0,0,9999', "ore:1:1:0'; DROP"]) {
    assert.equal(w.treeAt(id) || w.nodeAt(id), null, id);
  }
});
