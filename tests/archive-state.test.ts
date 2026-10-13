import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveState, searchEntries, replacementAfterRemoval } from '../src/archive-state.ts';
import { MotionValue } from '../src/scene/ArchiveMotion.ts';
import type { ArchiveEntry } from '../src/types.ts';

const entries: ArchiveEntry[] = Array.from({ length: 37 }, (_, i) => ({ id: `id-${i}`, relativePath: `${i}.md`, title: i === 12 ? '研究记录' : `文件 ${i}`, summary: '细胞实验', date: '2026-10-11', category: i < 8 ? '研究' : '未分类', type: 'md', sourceUrl: `/${i}.md` }));

test('replacement after removal prefers the same category row', () => {
  const sample = [entries[0], entries[1], entries[8]];
  assert.equal(replacementAfterRemoval(sample, ['id-0'], 'id-0'), 'id-1');
  assert.equal(replacementAfterRemoval(sample, ['id-0', 'id-1'], 'id-0'), 'id-8');
});
test('canvas clicks select first and open only on a second click on the same file', () => {
  const state = new ArchiveState(entries);
  state.activate(0); assert.equal(state.mode, 'overview');
  state.activate(0); assert.equal(state.mode, 'detail');
  state.back();
  state.activate(2); assert.equal(state.selected, 2); assert.equal(state.mode, 'overview');
  state.activate(3); assert.equal(state.selected, 3); assert.equal(state.mode, 'overview');
  state.activate(2); assert.equal(state.selected, 2); assert.equal(state.mode, 'overview');
  state.activate(2); assert.equal(state.mode, 'detail');
  state.back(); state.activate(2); assert.equal(state.mode, 'overview');
});
test('canvas activation ignores blocked or invalid input and resets after navigation', () => {
  const state = new ArchiveState(entries);
  state.activate(2); state.stepFile(1); state.stepFile(-1);
  state.activate(2); assert.equal(state.mode, 'overview');
  state.setOverlay('index'); state.activate(3); assert.equal(state.selected, 2);
  state.back(); state.reading = true; state.activate(3); assert.equal(state.selected, 2);
  state.reading = false;
  for (const index of [-1, 999, .5, NaN]) state.activate(index);
  assert.equal(state.selected, 2); assert.equal(state.mode, 'overview');
  const empty = new ArchiveState([]); empty.activate(0); assert.equal(empty.mode, 'overview');
});
test('left and right navigation stays within the selected category row', () => {
  const data = [entries[0], entries[8], entries[1], entries[9], entries[2]];
  const state = new ArchiveState(data);
  state.stepFile(1); assert.equal(state.selected, 2);
  state.stepFile(1); assert.equal(state.selected, 4);
  state.stepFile(1); assert.equal(state.selected, 4);
  state.stepFile(-1); assert.equal(state.selected, 2);
  state.select(999); assert.equal(state.selected, 2);
});
test('up and down navigation switches real categories and keeps the nearest horizontal position', () => {
  const data = [entries[0], entries[8], entries[1], { ...entries[9], category: '报告' }, entries[2], { ...entries[10], category: '报告' }];
  const state = new ArchiveState(data);
  state.select(4); state.stepCategory(1); assert.equal(state.selected, 1);
  state.stepCategory(1); assert.equal(state.selected, 5);
  state.stepCategory(1); assert.equal(state.selected, 5);
  state.stepCategory(-1); assert.equal(state.selected, 1);
  state.stepCategory(-1); assert.equal(state.selected, 2);
  state.stepCategory(-1); assert.equal(state.selected, 2);
});
test('file and category navigation do not change selection behind the directory', () => {
  const state = new ArchiveState([entries[0], entries[8], entries[1]]);
  state.setOverlay('index');
  state.stepFile(1); state.stepCategory(1);
  assert.equal(state.selected, 0);
});
test('zero and single entry archives have safe navigation', () => {
  for (const data of [[], entries.slice(0, 1)]) {
    const state = new ArchiveState(data); state.stepFile(-1); state.stepFile(1); state.stepCategory(-1); state.stepCategory(1); state.open();
    assert.equal(state.selected, 0); assert.equal(state.mode, data.length ? 'detail' : 'overview');
  }
});
test('selection persists, inspection returns to detail and detail returns to overview', () => {
  const state = new ArchiveState(entries); state.select(12); state.open(); state.inspect(); state.toggleExploded();
  assert.equal(state.mode, 'inspect'); assert.equal(state.exploded, true);
  state.back(); assert.equal(state.mode, 'detail'); assert.equal(state.exploded, false);
  state.back(); assert.equal(state.mode, 'overview'); assert.equal(state.selected, 12);
});
test('search uses display code, title, summary and actual category', () => {
  assert.deepEqual(searchEntries(entries, 'X-013').map(e => e.id), ['id-12']);
  assert.deepEqual(searchEntries(entries, '研究记录').map(e => e.id), ['id-12']);
  assert.equal(searchEntries(entries, '细胞', '研究').length, 8);
  assert.equal(searchEntries(entries, '不存在').length, 0);
});
test('saved entries use stable IDs and prune missing entries across reordered manifests', () => {
  let value = JSON.stringify(['id-12', 'removed']);
  const storage = { getItem: () => value, setItem: (_: string, next: string) => { value = next; } };
  const state = new ArchiveState([...entries].reverse(), storage);
  assert.deepEqual([...state.saved], ['id-12']);
  state.select(24); state.toggleSaved(); assert.deepEqual([...state.saved], []);
  state.toggleSaved(); assert.deepEqual(JSON.parse(value), ['id-12']);
});
test('corrupt or denied storage keeps usable session state and reports persistence failure', () => {
  const state = new ArchiveState(entries, { getItem: () => '{', setItem: () => { throw new Error('denied'); } });
  state.toggleSaved(); assert.equal(state.saved.has('id-0'), true); assert.equal(state.storageAvailable, false);
});
test('retargeting an in-flight motion starts from its current pose and reaches the new endpoint', () => {
  const motion = new MotionValue(0); motion.to(10, 1000, 0);
  const halfway = motion.value(500); assert.ok(halfway > 0 && halfway < 10);
  motion.to(-2, 500, 500); assert.equal(motion.value(500), halfway);
  assert.equal(motion.value(1000), -2); assert.equal(motion.value(2000), -2);
});

test('filtered state keeps full archive codes and saved identities', () => {
  const all = [entries[0], entries[8], entries[12]];
  const storage = { getItem: () => JSON.stringify(['id-0']), setItem: () => {} };
  const state = new ArchiveState([all[1]], storage, { allEntries: all, selectedId: 'id-8' });
  assert.deepEqual(state.entries.map(item => item.id), ['id-8']);
  assert.equal(state.entry.id, 'id-8');
  assert.equal(state.codeFor(all[1]), 'X-002');
  assert.deepEqual([...state.saved], ['id-0']);
});

test('directory category search treats empty metadata as uncategorized', () => {
  const uncategorized = { ...entries[0], id: 'blank', category: '' };
  assert.deepEqual(searchEntries([entries[0], uncategorized], '', '未分类').map(item => item.id), ['blank']);
});
