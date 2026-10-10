import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderScene } from '../src/scene.ts';
import type { ArchiveEntry } from '../src/types.ts';

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
