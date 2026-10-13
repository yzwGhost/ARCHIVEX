import test from 'node:test';
import assert from 'node:assert/strict';
import { removalPose } from '../src/scene/ArchiveRemoval.ts';

test('binder moves forward, lifts and turns before leaving', () => {
  assert.deepEqual(removalPose(0, 0, 1), { forward: 0, lift: 0, rotation: 0, done: false });
  const middle = removalPose(500, 0, 1);
  assert.ok(middle.forward > 0);
  assert.ok(middle.lift > 0);
  assert.ok(middle.rotation > 0);
  assert.equal(removalPose(1200, 0, 1).done, true);
});

test('large batch finishes in at most 1200 ms', () => {
  assert.equal(removalPose(1200, 19, 20).done, true);
});
