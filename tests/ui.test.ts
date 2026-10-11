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
const click = (root: HTMLElement, selector: string) => root.querySelector<HTMLButtonElement>(selector)!.click();
test('empty archive explains import without imaginary files', () => {
  const scene = renderScene([], () => {});
  assert.match(scene.textContent!, /将文件放入 documents\//);
  assert.equal(scene.querySelectorAll('.archive-file').length, 0); scene.dispose();
});
test('fallback safely shows real metadata before explicit reading', () => {
  const opened: unknown[][] = [];
  const scene = renderScene([entry], (...args) => opened.push(args)); document.body.replaceChildren(scene);
  assert.equal(scene.querySelector('研究记录'), null);
  assert.match(scene.querySelector('.file-detail')!.textContent!, /<研究记录>/);
  click(scene, '.archive-file'); assert.equal(scene.state.mode, 'detail'); assert.equal(opened.length, 0);
  click(scene, '[data-action=read]'); assert.equal(opened[0][0], entry);
  assert.equal(opened[0][1], scene.querySelector('[data-action=read]')); scene.dispose();
});
test('search opens the actual match then inspect explodes and returns to selected file', () => {
  const scene = renderScene([entry, {...entry, id:'b', title:'第二份档案'}], () => {}); document.body.replaceChildren(scene);
  click(scene, '[data-action=index]');
  const input = scene.querySelector<HTMLInputElement>('.directory-search')!;
  input.value = 'X-002'; input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(scene.querySelectorAll('.directory-result').length, 1); click(scene, '.directory-result');
  assert.equal(scene.state.entry.id, 'b'); assert.equal(scene.querySelector('.archive-directory'), null);
  click(scene, '[data-action=inspect]'); click(scene, '[data-action=explode]'); assert.equal(scene.state.exploded, true);
  click(scene, '[data-action=back]'); assert.equal(scene.state.mode, 'detail'); assert.equal(scene.state.exploded, false);
  click(scene, '[data-action=back]'); assert.equal(scene.state.selected, 1); scene.dispose();
});
test('directory ignores navigation keys in search and restores focus after Escape', () => {
  const scene = renderScene([entry,{...entry,id:'b'}],()=>{}); document.body.replaceChildren(scene);
  const trigger = scene.querySelector<HTMLButtonElement>('[data-action=index]')!; trigger.focus(); trigger.click();
  const input = scene.querySelector<HTMLInputElement>('input')!;
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); assert.equal(scene.state.selected,0);
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(scene.querySelector('.archive-directory'),null); assert.equal(document.activeElement,trigger); scene.dispose();
});
test('reader closes into detail, restores focus and is disposed on reload', async t => {
  const {startArchive}=await import('../src/main.ts');
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({entries:[entry],warnings:[]})));
  const app=document.createElement('main'); document.body.replaceChildren(app); await startArchive(app); click(app,'.archive-file');
  const trigger=app.querySelector<HTMLButtonElement>('[data-action=read]')!;
  for(const method of ['Escape','button']) {
    trigger.click(); assert.ok(app.querySelector('.archive-reader')); assert.ok(app.querySelector('.archive-scene')!.hasAttribute('inert'));
    if(method==='Escape') document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); else click(app,'.reader-close');
    assert.equal(app.querySelector('.archive-reader'),null); assert.equal(document.activeElement,trigger);
    assert.equal(app.querySelector<HTMLElement>('.archive-scene')!.dataset.mode,'detail');
  }
  trigger.click(); await startArchive(app); assert.equal(app.querySelector('.archive-reader'),null); assert.equal(trigger.isConnected,false);
});
test('stale manifest failure cannot replace current reader', async t => {
  const {startArchive}=await import('../src/main.ts');
  const pending: {resolve:(r:Response)=>void;reject:(e:Error)=>void}[]=[];
  t.mock.method(globalThis,'fetch',()=>new Promise<Response>((resolve,reject)=>pending.push({resolve,reject})));
  const app=document.createElement('main'); document.body.replaceChildren(app);
  const first=startArchive(app),second=startArchive(app);
  pending[1].resolve(new Response(JSON.stringify({entries:[entry]}))); await second;
  click(app,'.archive-file'); click(app,'[data-action=read]'); pending[0].reject(new Error('stale')); await first;
  assert.ok(app.querySelector('.archive-reader')); click(app,'.reader-close');
});
test('manifest error has working retry', async t => {
  const {startArchive}=await import('../src/main.ts'); let failed=true;
  t.mock.method(globalThis,'fetch',async()=>{if(failed)throw new Error();return new Response(JSON.stringify({entries:[]}));});
  const app=document.createElement('main'); await startArchive(app); assert.match(app.textContent!,/读取失败/);
  failed=false; click(app,'button'); await new Promise(resolve=>setTimeout(resolve,0)); assert.match(app.textContent!,/将文件放入 documents\//);
});
test('Markdown and Word preview safely and preserve downloads',async t=>{
  const {renderReader}=await import('../src/reader.ts'); t.mock.method(globalThis,'fetch',async()=>new Response('<p>正文</p>'));
  for(const type of ['md','docx'] as const){const reader=renderReader({...entry,type,previewUrl:'/preview'},()=>{});
    await new Promise(resolve=>setTimeout(resolve,0)); assert.equal(reader.querySelector('iframe')!.srcdoc,'<p>正文</p>');
    assert.equal(reader.querySelector('iframe')!.getAttribute('sandbox'),'allow-same-origin'); assert.equal(reader.querySelector('a[download]')!.getAttribute('href'),entry.sourceUrl);
  }
});
test('unsupported Word and failed previews explain fallback with download',async t=>{
  const {renderReader}=await import('../src/reader.ts'); t.mock.method(globalThis,'fetch',async()=>new Response('missing',{status:404}));
  for(const item of [{...entry,type:'doc' as const},{...entry,error:'转换失败'},{...entry,previewUrl:'/bad'},{...entry,type:'pdf' as const}]){
    const reader=renderReader(item,()=>{});document.body.replaceChildren(reader);await new Promise(resolve=>setTimeout(resolve,0));
    assert.match(reader.textContent!,/失败|仅支持下载/); assert.equal(reader.querySelector('iframe'),null);assert.ok(reader.querySelector('a[download]'));
  }
});
test('file ticks preserve focus and opening then returning restores the overview control',()=>{
  const scene=renderScene([entry,{...entry,id:'b'}],()=>{});document.body.replaceChildren(scene);
  const tick=scene.querySelectorAll<HTMLButtonElement>('.file-ticks button')[1];tick.focus();tick.click();
  assert.equal(document.activeElement,tick);assert.equal(scene.state.selected,1);
  const open=scene.querySelector<HTMLButtonElement>('[data-action=open]')!;open.focus();open.click();
  assert.equal(document.activeElement,scene.querySelector('[data-action=back]'));
  click(scene,'[data-action=back]');assert.equal(document.activeElement,open);scene.dispose();
});
test('keyboard focus follows selected tick into and out of the partial last group',()=>{
  const entries=Array.from({length:37},(_,i)=>({...entry,id:String(i)}));
  const scene=renderScene(entries,()=>{});document.body.replaceChildren(scene);
  const tick=scene.querySelectorAll<HTMLButtonElement>('.file-ticks button')[7];tick.focus();tick.click();
  tick.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  assert.equal(scene.state.selected,36);assert.equal(document.activeElement,scene.querySelectorAll('.file-ticks button')[4]);
  document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(scene.state.selected,4);assert.equal(document.activeElement,scene.querySelectorAll('.file-ticks button')[4]);scene.dispose();
});
