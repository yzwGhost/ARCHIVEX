import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderScene } from '../src/scene.ts';
import type { ArchiveEntry } from '../src/types.ts';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context); } });

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
const entry: ArchiveEntry = { id: 'a', relativePath: 'a.md', title: '<研究记录>', summary: '细胞实验摘要', date: '2026-10-10', category: '实验', type: 'md', sourceUrl: '/archive/a.md' };

test('empty scene explains where to add files without fake files', () => {
  const scene = renderScene([], () => {});
  assert.match(scene.textContent!, /将文件放入 documents\//);
  assert.equal(scene.querySelectorAll('button').length, 0);
});
test('each real entry has a safely rendered title and format label', () => {
  const scene = renderScene([entry, { ...entry, id: 'b', type: 'pdf' }], () => {});
  assert.equal(scene.querySelectorAll('.archive-file').length, 2);
  assert.match(scene.textContent!, /<研究记录>/);
  assert.match(scene.textContent!, /MD/);
  assert.match(scene.textContent!, /PDF/);
  assert.equal(scene.querySelector('研究记录'), null);
});
test('pointer and keyboard activation open the matching entry and trigger', () => {
  const opened: unknown[][] = [];
  const scene = renderScene([entry], (...args) => opened.push(args));
  const button = scene.querySelector('button')!;
  button.click();
  button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.equal(opened.length, 3);
  for (const args of opened) assert.deepEqual(args, [entry, button]);
});
test('focus displays independent metadata and blur hides it', () => {
  const scene = renderScene([entry], () => {});
  const button = scene.querySelector('button')!;
  button.dispatchEvent(new dom.window.FocusEvent('focus'));
  const detail = scene.querySelector<HTMLElement>('.file-detail')!;
  assert.equal(detail.hidden, false);
  assert.match(detail.textContent!, /细胞实验摘要/);
  assert.match(detail.textContent!, /2026-10-10/);
  button.dispatchEvent(new dom.window.FocusEvent('blur'));
  assert.equal(detail.hidden, true);
});
test('leaving a hovered file restores metadata for the focused file', () => {
  const scene = renderScene([entry, { ...entry, id: 'b', title: '第二份档案' }], () => {});
  const [first, second] = scene.querySelectorAll('button');
  first.dispatchEvent(new dom.window.FocusEvent('focus'));
  second.dispatchEvent(new dom.window.Event('pointerenter'));
  const detail = scene.querySelector<HTMLElement>('.file-detail')!;
  assert.match(detail.textContent!, /第二份档案/);
  second.dispatchEvent(new dom.window.Event('pointerleave'));
  assert.equal(detail.hidden, false);
  assert.match(detail.textContent!, /<研究记录>/);
  first.dispatchEvent(new dom.window.FocusEvent('blur'));
  assert.equal(detail.hidden, true);
});
test('blurring a file preserves metadata for a still hovered file', () => {
  const scene = renderScene([entry, { ...entry, id: 'b', title: '第二份档案' }], () => {});
  const [first, second] = scene.querySelectorAll('button');
  first.dispatchEvent(new dom.window.FocusEvent('focus'));
  second.dispatchEvent(new dom.window.Event('pointerenter'));
  first.dispatchEvent(new dom.window.FocusEvent('blur'));
  const detail = scene.querySelector<HTMLElement>('.file-detail')!;
  assert.equal(detail.hidden, false);
  assert.match(detail.textContent!, /第二份档案/);
});

test('reader previews converted HTML and native PDF with downloads', async () => {
  const { renderReader } = await import('../src/reader.ts');
  for (const type of ['md', 'docx', 'pdf'] as const) {
    const item = { ...entry, type, previewUrl: '/archive/previews/a.html' };
    const reader = renderReader(item, () => {});
    assert.equal(reader.getAttribute('role'), 'dialog');
    assert.equal(reader.querySelector('iframe')?.getAttribute('src'), type === 'pdf' ? item.sourceUrl : item.previewUrl);
    assert.equal(reader.querySelector('a[download]')?.getAttribute('href'), entry.sourceUrl);
  }
});

test('legacy Word and preview errors explain fallback and preserve downloads', async () => {
  const { renderReader } = await import('../src/reader.ts');
  for (const item of [{ ...entry, type: 'doc' as const }, { ...entry, error: '转换失败' }]) {
    const reader = renderReader(item, () => {});
    assert.match(reader.textContent!, item.error ? /转换失败/ : /仅支持下载/);
    assert.equal(reader.querySelector('iframe'), null);
    assert.ok(reader.querySelector('a[download]'));
  }
});

test('app extracts before reading, closes with Escape or return, and restores focus', async t => {
  const { startArchive } = await import('../src/main.ts');
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ entries: [{ ...entry, previewUrl: '/preview.html' }], warnings: [] })));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  const trigger = app.querySelector<HTMLButtonElement>('.archive-file')!;
  for (const closeWith of ['Escape', 'button']) {
    trigger.click();
    assert.ok(trigger.classList.contains('is-selected'));
    assert.equal(app.querySelector('[role=dialog]'), null);
    t.mock.timers.tick(650);
    assert.ok(app.querySelector('[role=dialog]'));
    assert.equal(app.querySelector('.archive-scene')?.getAttribute('inert'), '');
    if (closeWith === 'Escape') document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else app.querySelector<HTMLButtonElement>('.reader-close')!.click();
    assert.equal(app.querySelector('[role=dialog]'), null);
    assert.equal(document.activeElement, trigger);
    assert.equal(trigger.classList.contains('is-selected'), false);
  }
});

test('manifest failure offers a working retry', async t => {
  const { startArchive } = await import('../src/main.ts');
  let failed = true;
  t.mock.method(globalThis, 'fetch', async () => { if (failed) throw new Error('offline'); return new Response(JSON.stringify({ entries: [], warnings: [] })); });
  const app = document.createElement('main');
  await startArchive(app);
  assert.match(app.textContent!, /读取失败/);
  failed = false;
  app.querySelector('button')!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(app.textContent!, /将文件放入 documents\//);
});
