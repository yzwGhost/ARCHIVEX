import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderScene as renderVideoScene } from '../src/scene.ts';
import { ArchiveModel, createModelAssets } from '../src/scene/ArchiveModel.ts';
import type { ArchiveEntry } from '../src/types.ts';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
const entry: ArchiveEntry = { id: 'record-a', relativePath: 'a.md', title: '研究记录', summary: '摘要', date: '2026-10-10', category: '研究', type: 'md', sourceUrl: '/archive/a.md' };

test('fallback removal targets one row and resolves when disposed', async () => {
  const other = { ...entry, id: 'record-b', relativePath: 'b.md' };
  const scene = renderVideoScene([entry, other], () => {});
  document.body.replaceChildren(scene);
  await scene.animateRemoval([entry.id], true);
  assert.equal(scene.querySelector('.archive-file-exit'), null);
  const pending = scene.animateRemoval([entry.id], false);
  assert.ok(scene.querySelector('[data-entry-id="record-a"]')?.classList.contains('archive-file-exit'));
  assert.equal(scene.querySelector('[data-entry-id="record-b"]')?.classList.contains('archive-file-exit'), false);
  scene.dispose();
  await pending;
});

test('scene controls use accessible SVG icons through state changes and overlays', () => {
  const scene = renderVideoScene([entry], () => {});
  document.body.replaceChildren(scene);
  const icon = (selector: string) => scene.querySelector(`${selector} svg[aria-hidden="true"]`);
  for (const selector of ['[data-action=index]', '[data-action=replay]', '[data-action=back]', '[data-action=open]', '[data-action=previous-file]', '[data-action=next-file]', '.intro-overlay [data-action=skip]']) {
    assert.ok(icon(selector), `${selector} should contain a decorative SVG`);
  }
  assert.equal(scene.querySelector<HTMLButtonElement>('[data-action=replay]')?.getAttribute('aria-label'), '重播开场动画');
  scene.state.open();
  assert.ok(icon('[data-action=save]'));
  scene.querySelector<HTMLButtonElement>('[data-action=save]')!.click();
  assert.ok(icon('[data-action=save]'), 'saving should preserve the icon');
  assert.equal(scene.querySelector<HTMLButtonElement>('[data-action=save]')?.getAttribute('aria-pressed'), 'true');
  scene.querySelector<HTMLButtonElement>('[data-action=inspect]')!.click();
  scene.querySelector<HTMLButtonElement>('[data-action=explode]')!.click();
  assert.ok(icon('[data-action=explode]'), 'collapsing should preserve the icon');
  scene.state.back();
  scene.state.back();
  scene.querySelector<HTMLButtonElement>('[data-action=index]')!.click();
  assert.ok(icon('.directory-close'));
  assert.ok(icon('.directory-result'));
  scene.dispose();
});

test('footer and arrow keys navigate real files without a fixed group size', () => {
  const data = Array.from({ length: 10 }, (_, index) => ({ ...entry, id: `record-${index}` }));
  const scene = renderVideoScene(data, () => {});
  document.body.replaceChildren(scene);
  assert.equal(scene.querySelector('[data-field=position]')?.textContent, '01');
  assert.equal(scene.querySelector('[data-field=group-length]')?.textContent, '10');
  assert.equal(scene.querySelector('.group-navigation'), null);
  scene.querySelector<HTMLButtonElement>('[data-action=next-file]')!.click();
  assert.equal(scene.state.selected, 1);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert.equal(scene.state.selected, 0);
  scene.state.select(7);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(scene.state.selected, 8);
  assert.equal(scene.querySelector('[data-field=position]')?.textContent, '09');
  scene.dispose();
});

test('up and down arrows switch category rows while left and right stay within a row', () => {
  const data = [
    { ...entry, id: 'a1' }, { ...entry, id: 'b1', category: '报告' },
    { ...entry, id: 'a2' }, { ...entry, id: 'b2', category: '报告' },
  ];
  const scene = renderVideoScene(data, () => {});
  document.body.replaceChildren(scene);
  const press = (key: string) => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  press('ArrowRight'); assert.equal(scene.state.entry.id, 'a2');
  press('ArrowUp'); assert.equal(scene.state.entry.id, 'b2');
  press('ArrowRight'); assert.equal(scene.state.entry.id, 'b2');
  press('ArrowDown'); assert.equal(scene.state.entry.id, 'a2');
  scene.dispose();
});

test('bottom navigation shows the selected file category as category rows change', () => {
  const data = [
    { ...entry, id: 'research' },
    { ...entry, id: 'report', category: '报告' },
    { ...entry, id: 'uncategorized', category: '   ' },
  ];
  const scene = renderVideoScene(data, () => {});
  document.body.replaceChildren(scene);
  const category = scene.querySelector('.file-navigation .current-category-name');
  assert.equal(category?.textContent, '研究');
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  assert.equal(category?.textContent, '报告');
  scene.state.select(2);
  assert.equal(category?.textContent, '未分类');
  scene.dispose();
});

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

test('focused category dropdown handles Arrow and Enter without moving the archive', () => {
  const second = { ...entry, id: 'second', category: '报告' };
  const scene = renderVideoScene([entry, second], () => {}, {
    allEntries: [entry, second], category: '', categories: ['研究', '报告'], selectedId: entry.id,
    onCategoryChange: () => {}, onLocate: () => {}, onSelectionChange: () => {},
  });
  document.body.replaceChildren(scene);
  const trigger = scene.querySelector<HTMLButtonElement>('.scene-category-label .archive-dropdown-trigger')!;
  assert.ok(trigger);
  trigger.focus();
  const arrow = new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
  trigger.dispatchEvent(arrow);
  assert.equal(arrow.defaultPrevented, true);
  assert.equal(scene.state.entry.id, entry.id);
  const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  trigger.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(scene.state.mode, 'overview');
  scene.dispose();
});

test('category dropdown opens a themed option list and selects with the keyboard', () => {
  const chosen: string[] = [];
  const scene = renderVideoScene([entry], () => {}, {
    allEntries: [entry], category: '', categories: ['研究', '报告'], selectedId: entry.id,
    onCategoryChange: value => chosen.push(value), onLocate: () => {}, onSelectionChange: () => {},
  });
  document.body.replaceChildren(scene);
  const trigger = scene.querySelector<HTMLButtonElement>('.scene-category-label .archive-dropdown-trigger')!;
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const options = scene.querySelectorAll('[role=option]');
  assert.deepEqual(Array.from(options, option => option.textContent), ['全部', '研究', '报告']);
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual(chosen, ['研究']);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
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
