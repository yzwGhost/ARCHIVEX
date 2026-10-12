import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFiles } from '../src/layout.ts';

test('every real file receives a unique world position and the ninth begins a new depth group', () => {
  const positions = layoutFiles(9);
  assert.equal(positions.length, 9);
  assert.equal(new Set(positions.map(p => `${p.x},${p.z}`)).size, 9);
  assert.equal(positions[7].z, positions[0].z);
  assert.notEqual(positions[8].z, positions[0].z);
  assert.equal(positions[8].x, positions[0].x);
});
test('an empty archive has no file positions', () => assert.deepEqual(layoutFiles(0), []));
