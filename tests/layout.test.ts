import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFiles } from '../src/layout.ts';

test('files occupy one ordered axis with independent wave phases', () => {
  const positions = layoutFiles(7);
  assert.equal(positions.length, 7);
  assert.equal(new Set(positions.map(p => p.z)).size, 1);
  assert.equal(new Set(positions.map(p => p.delayMs)).size, 7);
  assert.ok(positions.every((p, i) => i === 0 || p.x > positions[i - 1].x));
});
test('an empty archive has no file positions', () => assert.deepEqual(layoutFiles(0), []));
