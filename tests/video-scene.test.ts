import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderVideoScene } from '../src/video-scene.ts';
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
