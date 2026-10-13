import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFiles } from '../src/layout.ts';

test('each category owns one horizontal row and shorter rows receive blank files', () => {
  const layout = layoutFiles([
    { category: '研究' }, { category: '报告' }, { category: '研究' },
    { category: '照片' }, { category: '研究' }, { category: '照片' },
  ]);
  assert.deepEqual(layout.files.map(({ x, z }) => [x, z]), [
    [-.48, 0], [0, -4.6], [0, 0], [-.48, -9.2], [.48, 0], [0, -9.2],
  ]);
  assert.deepEqual(layout.placeholders.filter(({ x, z }) => Math.abs(x) <= .48 && z >= -9.2).map(({ x, z }) => [x, z]), [
    [-.48, -4.6], [.48, -4.6], [.48, -9.2],
  ]);
});

test('few categories gain visual blank files on both outer sides', () => {
  const layout = layoutFiles([{ category: '研究' }, { category: '研究' }]);
  assert.equal(layout.files.length, 2);
  assert.ok(layout.files.every(({ z }) => z === 0));
  assert.ok(layout.placeholders.some(({ x }) => x < layout.files[0].x));
  assert.ok(layout.placeholders.some(({ x }) => x > layout.files[1].x));
});

test('blank rows continue behind the deepest real category', () => {
  const layout = layoutFiles([{ category: '研究' }, { category: '报告' }]);
  assert.ok(layout.files.every(({ z }) => z >= -4.6));
  assert.ok(layout.visualRows > layout.categoryCount);
  const firstDeepRow = layout.placeholders.filter(({ z }) => z === -9.2);
  assert.equal(new Set(firstDeepRow.map(({ x }) => x)).size, layout.visualColumns);
  assert.ok(layout.placeholders.some(({ z }) => z <= -23));
});

test('a category can grow beyond eight files without creating another row', () => {
  const layout = layoutFiles(Array.from({ length: 10 }, () => ({ category: '研究' })));
  assert.ok(layout.files.every(({ z }) => z === 0));
  assert.equal(layout.files[9].x, 2.16);
});

test('an empty archive has no file or blank positions', () => {
  assert.deepEqual(layoutFiles([]), { files: [], placeholders: [], categoryCount: 0, slotsPerRow: 0, visualColumns: 0, visualRows: 0 });
});
