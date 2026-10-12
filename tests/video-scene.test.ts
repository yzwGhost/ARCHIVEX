import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderScene as renderVideoScene } from '../src/scene.ts';
import { ArchiveModel, createModelAssets } from '../src/scene/ArchiveModel.ts';
import type { ArchiveEntry } from '../src/types.ts';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
const entry: ArchiveEntry = { id: 'record-a', relativePath: 'a.md', title: '研究记录', summary: '摘要', date: '2026-10-10', category: '研究', type: 'md', sourceUrl: '/archive/a.md' };

test('video scene opens the selected real file', () => {
  const opened: string[] = [];
  const scene = renderVideoScene([entry], item => opened.push(item.id));
  document.body.replaceChildren(scene);
  scene.querySelector<HTMLButtonElement>('.archive-file')!.click();
  assert.equal(scene.state.mode, 'detail');
  assert.deepEqual(opened, []);
  scene.querySelector<HTMLButtonElement>('[data-action=read]')!.click();
  assert.deepEqual(opened, ['record-a']);
  scene.dispose();
});

test('video scene disposes listeners', () => {
  const scene = renderVideoScene([entry], () => {});
  document.body.replaceChildren(scene);
  scene.dispose();
  scene.querySelector<HTMLButtonElement>('.archive-file')!.click();
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(scene.state.mode, 'overview');
});

test('filtered world keeps full archive identity', () => {
  const hidden = { ...entry, id: 'hidden', title: '隐藏档案' };
  const visible = { ...entry, id: 'visible', category: '报告' };
  const scene = renderVideoScene([visible], () => {}, {
    allEntries: [hidden, visible], category: '报告', categories: ['研究', '报告'], selectedId: 'visible',
    onCategoryChange: () => {}, onLocate: () => {}, onSelectionChange: () => {},
  });
  document.body.replaceChildren(scene);
  assert.deepEqual(scene.state.entries.map(item => item.id), ['visible']);
  assert.match(scene.querySelector('.archive-file')!.textContent!, /X-002/);
  scene.querySelector<HTMLButtonElement>('[data-action=index]')!.click();
  const input = scene.querySelector<HTMLInputElement>('.directory-search')!;
  input.value = '隐藏档案';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(scene.querySelectorAll('.directory-result').length, 1);
  assert.match(scene.querySelector('.directory-result')!.textContent!, /X-001/);
  scene.dispose();
});

test('directory locates a hidden category by stable ID', () => {
  const hidden = { ...entry, id: 'hidden', title: '隐藏档案' };
  const visible = { ...entry, id: 'visible', category: '报告' };
  const located: string[] = [];
  const scene = renderVideoScene([visible], () => {}, {
    allEntries: [hidden, visible], category: '报告', categories: ['研究', '报告'], selectedId: 'visible',
    onCategoryChange: () => {}, onLocate: id => located.push(id), onSelectionChange: () => {},
  });
  document.body.replaceChildren(scene);
  scene.querySelector<HTMLButtonElement>('[data-action=index]')!.click();
  scene.querySelector<HTMLButtonElement>('.directory-result')!.click();
  assert.deepEqual(located, ['hidden']);
  scene.dispose();
});

test('empty category keeps show-all and upload controls', () => {
  let selected = '';
  let uploads = 0;
  const scene = renderVideoScene([], () => {}, {
    allEntries: [entry], category: '报告', categories: ['研究', '报告'], selectedId: '',
    onCategoryChange: value => { selected = value; }, onLocate: () => {}, onSelectionChange: () => {}, onUpload: () => { uploads++; },
  });
  document.body.replaceChildren(scene);
  scene.querySelector<HTMLButtonElement>('.show-all')!.click();
  scene.querySelector<HTMLButtonElement>('.upload-trigger')!.click();
  assert.equal(selected, '');
  assert.equal(uploads, 1);
  scene.dispose();
});

test('focused category select retains its Arrow and Enter keys', () => {
  const second = { ...entry, id: 'second', category: '报告' };
  const scene = renderVideoScene([entry, second], () => {}, {
    allEntries: [entry, second], category: '', categories: ['研究', '报告'], selectedId: entry.id,
    onCategoryChange: () => {}, onLocate: () => {}, onSelectionChange: () => {},
  });
  document.body.replaceChildren(scene);
  const select = scene.querySelector<HTMLSelectElement>('.category-select')!;
  select.focus();
  const arrow = new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
  select.dispatchEvent(arrow);
  assert.equal(arrow.defaultPrevented, false);
  assert.equal(scene.state.entry.id, entry.id);
  const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  select.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, false);
  assert.equal(scene.state.mode, 'overview');
  scene.dispose();
});

test('model label uses global archive number while retaining visible hit index', t => {
  const labels: string[] = [];
  t.mock.method(dom.window.HTMLCanvasElement.prototype, 'getContext', () => ({
    clearRect() {}, fillRect() {}, fillText(value: string) { labels.push(value); },
  }));
  const model = new ArchiveModel({ ...entry, id: 'second' }, 0, createModelAssets(), 'X-002');
  assert.equal(model.group.userData.entryIndex, 0);
  assert.ok(labels.includes('NO.002'));
  assert.ok(labels.includes('X-002'));
});
