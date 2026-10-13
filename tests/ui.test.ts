import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderScene } from '../src/scene.ts';
import type { ArchiveEntry } from '../src/types.ts';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) { return /\.(?:css|scss)$/.test(url) ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context); } });

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
const entry: ArchiveEntry = { id: 'a', relativePath: 'a.md', title: '<研究记录>', summary: '细胞实验摘要', date: '2026-10-10', category: '实验', type: 'md', sourceUrl: '/archive/a.md' };

test('management confirmation starts on cancel and exposes exact entry title', async () => {
  const { renderArchiveManagement } = await import('../src/archive-management.ts');
  const panel = renderArchiveManagement({ mode: 'confirm-entry', entry, categories: [], batches: [], onClose: () => {},
    onDeleteEntry: async () => {}, onDeleteCategory: async () => {}, onRestore: async () => {} });
  document.body.append(panel);
  await Promise.resolve();
  assert.match(panel.textContent!, /<研究记录>/);
  assert.match(panel.textContent!, /移入回收区/);
  assert.equal(document.activeElement?.textContent, '取消');
  panel.remove();
});

test('trash dialog explains when recycled files are permanently removed', async () => {
  const { renderArchiveManagement } = await import('../src/archive-management.ts');
  const panel = renderArchiveManagement({ mode: 'trash', categories: [], batches: [], onClose: () => {},
    onDeleteEntry: async () => {}, onDeleteCategory: async () => {}, onRestore: async () => {} });
  assert.match(panel.textContent!, /7 天后自动永久删除/);
});

test('reader return and download controls use decorative SVG icons', async () => {
  const { renderReader } = await import('../src/reader.ts');
  const reader = renderReader({ ...entry, type: 'doc' }, () => {});
  assert.ok(reader.querySelector('.reader-close svg[aria-hidden="true"]'));
  assert.ok(reader.querySelector('.reader-header a[download] svg[aria-hidden="true"]'));
  assert.match(reader.querySelector('.reader-close')!.textContent!, /返回档案/);
});

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
test('fallback file activation opens detail and reader for the matching entry', () => {
  const opened: unknown[][] = [];
  const scene = renderScene([entry], (...args) => opened.push(args));
  scene.querySelector<HTMLButtonElement>('.archive-file')!.click();
  assert.equal(scene.state.mode, 'detail');
  assert.match(scene.querySelector('.document-detail')!.textContent!, /2026-10-10/);
  const trigger = scene.querySelector<HTMLButtonElement>('[data-action=read]')!;
  trigger.click();
  assert.deepEqual(opened, [[entry, trigger]]);
  scene.dispose();
});
test('navigation updates the selected file metadata without inserting unsafe markup', () => {
  const scene = renderScene([entry, { ...entry, id: 'b', title: '第二份档案' }], () => {});
  scene.querySelector<HTMLButtonElement>('[data-action=next-file]')!.click();
  assert.match(scene.querySelector('.file-detail')!.textContent!, /第二份档案/);
  assert.equal(scene.querySelector('研究记录'), null);
  scene.dispose();
});

test('reader previews converted HTML with downloads', async t => {
  const { renderReader } = await import('../src/reader.ts');
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { requests.push(url); return new Response('<p>正文</p>'); });
  for (const type of ['md', 'docx'] as const) {
    const item = { ...entry, type, previewUrl: '/archive/previews/a.html' };
    const reader = renderReader(item, () => {});
    assert.equal(reader.getAttribute('role'), 'dialog');
    const frame = reader.querySelector('iframe')!;
    assert.equal(frame.dataset.previewUrl, item.previewUrl);
    {
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(frame.srcdoc, '<p>正文</p>');
      assert.equal(frame.getAttribute('sandbox'), 'allow-same-origin');
    }
    assert.equal(reader.querySelector('a[download]')?.getAttribute('href'), entry.sourceUrl);
  }
  assert.deepEqual(requests, ['/archive/previews/a.html', '/archive/previews/a.html']);
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

test('app opens reader from detail, closes with Escape or return, and restores focus', async t => {
  const { startArchive } = await import('../src/main.ts');
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ entries: [{ ...entry, previewUrl: '/preview.html' }], warnings: [] })));
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  app.querySelector<HTMLButtonElement>('.archive-file')!.click();
  const trigger = app.querySelector<HTMLButtonElement>('[data-action=read]')!;
  for (const closeWith of ['Escape', 'button']) {
    trigger.click();
    assert.ok(app.querySelector('[role=dialog]'));
    assert.equal(app.querySelector('.archive-scene')?.getAttribute('inert'), '');
    if (closeWith === 'Escape') document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else app.querySelector<HTMLButtonElement>('.reader-close')!.click();
    assert.equal(app.querySelector('[role=dialog]'), null);
    assert.equal(document.activeElement, trigger);
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

test('stale failed retry cannot replace recovered scene or reader', async t => {
  const { startArchive } = await import('../src/main.ts');
  const requests: Array<{ resolve: (value: Response) => void; reject: (error: Error) => void }> = [];
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((resolve, reject) => requests.push({ resolve, reject })));
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  const first = startArchive(app);
  const second = startArchive(app);
  requests[1].resolve(new Response(JSON.stringify({ entries: [entry], warnings: [] })));
  await second;
  app.querySelector<HTMLButtonElement>('.archive-file')!.click();
  const trigger = app.querySelector<HTMLButtonElement>('[data-action=read]')!;
  trigger.click();
  requests[0].reject(new Error('stale failure'));
  await first;
  assert.ok(app.querySelector('[role=dialog]'));
  app.querySelector<HTMLButtonElement>('.reader-close')!.click();
  assert.equal(document.activeElement, trigger);
});

test('failed HTML preview request explains failure and keeps download', async t => {
  const { renderReader } = await import('../src/reader.ts');
  t.mock.method(globalThis, 'fetch', async () => new Response('missing', { status: 404 }));
  const reader = renderReader({ ...entry, previewUrl: '/missing.html' }, () => {});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(reader.textContent!, /预览读取失败/);
  assert.equal(reader.querySelector('iframe'), null);
  assert.equal(reader.querySelector('a[download]')?.getAttribute('href'), entry.sourceUrl);
});

test('reloading closes the reader and disposes its Escape listener', async t => {
  const { startArchive } = await import('../src/main.ts');
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ entries: [entry], warnings: [] })));
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  const oldTrigger = app.querySelector<HTMLButtonElement>('.archive-file')!;
  oldTrigger.click();
  app.querySelector<HTMLButtonElement>('[data-action=read]')!.click();
  assert.ok(app.querySelector('.archive-reader'));
  await startArchive(app);
  const newTrigger = app.querySelector<HTMLButtonElement>('.archive-file')!;
  newTrigger.focus();
  assert.equal(app.querySelector('[role=dialog]'), null);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.activeElement, newTrigger);
  assert.equal(oldTrigger.isConnected, false);
});

test('old scene cannot open a stale reader while manifest reload is pending', async t => {
  const { startArchive } = await import('../src/main.ts');
  let resolveReload!: (value: Response) => void;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) return new Response(JSON.stringify({ entries: [entry], warnings: [] }));
    return new Promise<Response>(resolve => { resolveReload = resolve; });
  });
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  const oldTrigger = app.querySelector<HTMLButtonElement>('.archive-file')!;
  const reload = startArchive(app);
  oldTrigger.click();
  resolveReload(new Response(JSON.stringify({ entries: [entry], warnings: [] })));
  await reload;
  const newTrigger = app.querySelector<HTMLButtonElement>('.archive-file')!;
  newTrigger.focus();
  assert.equal(app.querySelector('[role=dialog]'), null);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.activeElement, newTrigger);
  assert.equal(oldTrigger.isConnected, false);
});

test('PDF interaction stays in app document so Escape closes and restores focus', async t => {
  const { startArchive } = await import('../src/main.ts');
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ entries: [{ ...entry, type: 'pdf' }], warnings: [] })));
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  const trigger = app.querySelector<HTMLButtonElement>('.archive-file')!;
  trigger.click();
  const read = app.querySelector<HTMLButtonElement>('[data-action=read]')!;
  read.click();
  assert.equal(app.querySelector('iframe'), null);
  const pages = app.querySelector<HTMLElement>('.reader-pdf')!;
  assert.ok(pages);
  pages.click();
  pages.focus();
  pages.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(app.querySelector('[role=dialog]'), null);
  assert.equal(document.activeElement, read);
});

test('PDF network failure shows readable fallback and source download', async t => {
  const { renderReader } = await import('../src/reader.ts');
  t.mock.method(globalThis, 'fetch', async () => new Response('missing', { status: 404 }));
  const reader = renderReader({ ...entry, type: 'pdf' }, () => {});
  document.body.replaceChildren(reader);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(reader.textContent!, /PDF 预览读取失败/);
  assert.equal(reader.querySelector('a[download]')?.getAttribute('href'), entry.sourceUrl);
});

test('category options deduplicate values and filtering preserves archive order', async () => {
  const { categoryOptions, filterEntries } = await import('../src/categories.ts');
  const entries = [entry, { ...entry, id: 'b', category: '' }, { ...entry, id: 'c', category: '实验' }, { ...entry, id: 'd', category: '报告' }];
  assert.deepEqual(categoryOptions(entries), ['实验', '未分类', '报告']);
  assert.deepEqual(filterEntries(entries, '实验').map(item => item.id), ['a', 'c']);
  assert.deepEqual(filterEntries(entries, '未分类').map(item => item.id), ['b']);
  assert.deepEqual(filterEntries(entries, '').map(item => item.id), ['a', 'b', 'c', 'd']);
});

test('scene category control changes selection and empty result returns to all', () => {
  const selected: string[] = [];
  const scene = renderScene([], () => {}, { category: '实验', categories: ['实验'], onCategoryChange: value => selected.push(value) });
  assert.match(scene.textContent!, /该分类暂无档案/);
  scene.querySelector<HTMLButtonElement>('.show-all')!.click();
  assert.deepEqual(selected, ['']);
});

test('category selection survives reload while available and resets when removed', async t => {
  const { startArchive } = await import('../src/main.ts');
  let entries = [entry, { ...entry, id: 'b', category: '报告' }];
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ entries, warnings: [] })));
  const app = document.createElement('main');
  await startArchive(app);
  const select = app.querySelector<HTMLSelectElement>('.category-select')!;
  select.value = '实验';
  select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(app.querySelectorAll('.archive-file').length, 1);
  await startArchive(app);
  assert.equal(app.querySelector<HTMLSelectElement>('.category-select')?.value, '实验');
  entries = [{ ...entry, id: 'b', category: '报告' }];
  await startArchive(app);
  assert.equal(app.querySelector<HTMLSelectElement>('.category-select')?.value, '');
});

test('a detached scene cannot open a reader after category change', async t => {
  const { startArchive } = await import('../src/main.ts');
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ entries: [entry, { ...entry, id: 'b', category: '报告' }], warnings: [] })));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  const oldButton = app.querySelector<HTMLButtonElement>('.archive-file')!;
  const select = app.querySelector<HTMLSelectElement>('.category-select')!;
  select.value = '报告';
  select.dispatchEvent(new dom.window.Event('change'));
  oldButton.click();
  t.mock.timers.tick(650);
  assert.equal(app.querySelector('[role=dialog]'), null);
});

test('upload panel sends selected files one by one and reports mixed results', async t => {
  const { renderUploadPanel } = await import('../src/upload.ts');
  const sent: Array<{ name: string; category: string }> = [];
  let completed = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    const body = options.body as FormData;
    sent.push({ name: (body.get('file') as File).name, category: String(body.get('category')) });
    return new Response(JSON.stringify(sent.length === 1 ? { entry } : { code: 'conflict', message: '同名文件已存在。' }), { status: sent.length === 1 ? 201 : 409 });
  });
  const panel = renderUploadPanel({ categories: ['实验'], onClose: () => {}, onComplete: () => { completed++; } });
  document.body.replaceChildren(panel);
  const input = panel.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['A'], 'a.md'), new File(['B'], 'b.md')] });
  const select = panel.querySelector<HTMLSelectElement>('.upload-category')!;
  select.value = '实验';
  panel.querySelector<HTMLButtonElement>('.upload-submit')!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(sent, [{ name: 'a.md', category: '实验' }, { name: 'b.md', category: '实验' }]);
  assert.equal(completed, 1);
  assert.match(panel.textContent!, /同名文件已存在/);
});

test('upload panel requires files and supports a new category', async t => {
  const { renderUploadPanel } = await import('../src/upload.ts');
  let category = '';
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    category = String((options.body as FormData).get('category'));
    return new Response(JSON.stringify({ entry }), { status: 201 });
  });
  const panel = renderUploadPanel({ categories: [], onClose: () => {}, onComplete: () => {} });
  document.body.replaceChildren(panel);
  const submit = panel.querySelector<HTMLButtonElement>('.upload-submit')!;
  submit.click();
  assert.equal(category, '');
  Object.defineProperty(panel.querySelector<HTMLInputElement>('input[type=file]')!, 'files', { configurable: true, value: [new File(['A'], 'a.md')] });
  panel.querySelector<HTMLInputElement>('.upload-new-category')!.value = '新分类';
  submit.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(category, '新分类');
});

test('upload category dropdown selects an existing category and Escape closes only the menu', async () => {
  const { renderUploadPanel } = await import('../src/upload.ts');
  let closes = 0;
  const panel = renderUploadPanel({ categories: ['实验', '报告'], onClose: () => { closes++; }, onComplete: () => {} });
  document.body.replaceChildren(panel);
  const trigger = panel.querySelector<HTMLButtonElement>('.upload-select .archive-dropdown-trigger')!;
  assert.ok(trigger);
  trigger.click();
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(closes, 0);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger.click();
  panel.querySelectorAll<HTMLElement>('.upload-select [role=option]')[2].click();
  assert.equal(panel.querySelector<HTMLSelectElement>('.upload-category')?.value, '报告');
  assert.equal(trigger.textContent?.includes('报告'), true);
});

test('local capability controls whether archive shows upload entry', async t => {
  const { startArchive } = await import('../src/main.ts');
  dom.reconfigure({ url: 'http://127.0.0.1:5173/' });
  t.after(() => dom.reconfigure({ url: 'about:blank' }));
  let enabled = true;
  t.mock.method(globalThis, 'fetch', async (url: string) => new Response(JSON.stringify(url === '/archive/manifest.json' ? { entries: [entry], warnings: [] } : { enabled, maxFileBytes: 52428800 })));
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  assert.ok(app.querySelector('.upload-trigger'));
  assert.ok(app.querySelector('.manage-categories'));
  assert.ok(app.querySelector('.open-trash'));
  enabled = false;
  await startArchive(app);
  assert.equal(app.querySelector('.upload-trigger'), null);
  assert.equal(app.querySelector('.manage-categories'), null);
  assert.equal(app.querySelector('.open-trash'), null);
});

test('local delete waits for removal then reloads the manifest', async t => {
  const { startArchive } = await import('../src/main.ts');
  dom.reconfigure({ url: 'http://127.0.0.1:5173/' });
  t.after(() => dom.reconfigure({ url: 'about:blank' }));
  let deleted = false, reads = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url === '/api/upload-capabilities') return new Response(JSON.stringify({ enabled: true, maxFileBytes: 52428800 }));
    if (url.startsWith('/api/archives/') && options?.method === 'DELETE') { deleted = true; return new Response(JSON.stringify({ operationId: 'batch', ids: [entry.id] })); }
    if (url === '/archive/manifest.json') { reads++; return new Response(JSON.stringify({ entries: deleted ? [] : [entry], warnings: [] })); }
    return new Response('missing', { status: 404 });
  });
  const app = document.createElement('main'); document.body.replaceChildren(app);
  await startArchive(app);
  assert.ok(app.querySelector('.manage-categories'));
  assert.ok(app.querySelector('.open-trash'));
  app.querySelector<HTMLButtonElement>('.archive-file')!.click();
  app.querySelector<HTMLButtonElement>('[data-action=delete]')!.click();
  document.querySelector<HTMLButtonElement>('.archive-management .is-danger')!.click();
  await new Promise(resolve => setTimeout(resolve, 520));
  assert.equal(reads, 2);
  assert.match(app.textContent!, /将文件放入 documents\//);
});

test('failed deletion keeps the scene and shows the server error', async t => {
  const { startArchive } = await import('../src/main.ts');
  dom.reconfigure({ url: 'http://127.0.0.1:5173/' });
  t.after(() => dom.reconfigure({ url: 'about:blank' }));
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/archive/manifest.json') { reads++; return new Response(JSON.stringify({ entries: [entry], warnings: [] })); }
    if (url === '/api/upload-capabilities') return new Response(JSON.stringify({ enabled: true, maxFileBytes: 52428800 }));
    return new Response(JSON.stringify({ code: 'conflict', message: '原件已变化' }), { status: 409 });
  });
  const app = document.createElement('main'); document.body.replaceChildren(app);
  await startArchive(app);
  app.querySelector<HTMLButtonElement>('.archive-file')!.click();
  app.querySelector<HTMLButtonElement>('[data-action=delete]')!.click();
  document.querySelector<HTMLButtonElement>('.archive-management .is-danger')!.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(reads, 1);
  assert.match(document.querySelector('.management-status')!.textContent!, /原件已变化/);
  assert.equal(app.querySelectorAll('.archive-file').length, 1);
  document.querySelector<HTMLButtonElement>('.management-paper footer button')!.click();
  assert.equal(app.querySelector('.archive-scene')!.hasAttribute('inert'), false);
});

test('category removal selects its row before animating from all entries', async t => {
  const { startArchive } = await import('../src/main.ts');
  dom.reconfigure({ url: 'http://127.0.0.1:5173/' });
  t.after(() => dom.reconfigure({ url: 'about:blank' }));
  const other = { ...entry, id: 'b', relativePath: 'b.md', title: '报告', category: '报告' };
  let deleted = false;
  let confirmedIds: string[] | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url === '/archive/manifest.json') return new Response(JSON.stringify({ entries: deleted ? [other] : [other, entry], warnings: [] }));
    if (url === '/api/upload-capabilities') return new Response(JSON.stringify({ enabled: true, maxFileBytes: 52428800 }));
    if (url === '/api/categories') {
      confirmedIds = JSON.parse(String(options?.body)).expectedIds;
      deleted = true;
      return new Response(JSON.stringify({ operationId: 'batch', ids: [entry.id] }));
    }
    return new Response('missing', { status: 404 });
  });
  const app = document.createElement('main'); document.body.replaceChildren(app);
  await startArchive(app);
  assert.equal((app.querySelector('.archive-scene') as any).state.entry.id, other.id);
  app.querySelector<HTMLButtonElement>('.manage-categories')!.click();
  const rows = [...document.querySelectorAll<HTMLElement>('.management-row')];
  rows.find(row => row.textContent?.includes('实验'))!.querySelector<HTMLButtonElement>('button')!.click();
  document.querySelector<HTMLButtonElement>('.archive-management .is-danger')!.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((app.querySelector('.archive-scene') as any).state.entry.id, entry.id);
  assert.deepEqual(confirmedIds, [entry.id]);
  await new Promise(resolve => setTimeout(resolve, 520));
});

test('upload completion refreshes archive once and keeps its category', async t => {
  const { startArchive } = await import('../src/main.ts');
  dom.reconfigure({ url: 'http://127.0.0.1:5173/' });
  t.after(() => dom.reconfigure({ url: 'about:blank' }));
  let manifestReads = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/upload-capabilities') return new Response(JSON.stringify({ enabled: true, maxFileBytes: 52428800 }));
    if (url === '/api/uploads') return new Response(JSON.stringify({ entry: { ...entry, id: 'new' }, warnings: [] }), { status: 201 });
    manifestReads++;
    return new Response(JSON.stringify({ entries: manifestReads === 1 ? [entry] : [entry, { ...entry, id: 'new' }], warnings: [] }));
  });
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  const category = app.querySelector<HTMLSelectElement>('.category-select')!;
  category.value = '实验';
  category.dispatchEvent(new dom.window.Event('change'));
  app.querySelector<HTMLButtonElement>('.upload-trigger')!.click();
  const panel = document.querySelector<HTMLElement>('.upload-panel')!;
  Object.defineProperty(panel.querySelector<HTMLInputElement>('input[type=file]')!, 'files', { configurable: true, value: [new File(['A'], 'new.md')] });
  panel.querySelector<HTMLButtonElement>('.upload-submit')!.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(manifestReads, 2);
  assert.equal(app.querySelector<HTMLSelectElement>('.category-select')?.value, '实验');
  assert.equal(app.querySelectorAll('.archive-file').length, 2);
  panel.querySelector<HTMLButtonElement>('.upload-close')!.click();
  assert.equal(document.activeElement, app.querySelector('.upload-trigger'));
});

test('closing during upload leaves the scene interactive and preserves a subsequently opened reader', async t => {
  const { startArchive } = await import('../src/main.ts');
  dom.reconfigure({ url: 'http://127.0.0.1:5173/' });
  t.after(() => dom.reconfigure({ url: 'about:blank' }));
  let resolveUpload!: (value: Response) => void;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/upload-capabilities') return new Response(JSON.stringify({ enabled: true }));
    if (url === '/api/uploads') return new Promise<Response>(resolve => { resolveUpload = resolve; });
    return new Response(JSON.stringify({ entries: [entry], warnings: [] }));
  });
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  app.querySelector<HTMLButtonElement>('.upload-trigger')!.click();
  const panel = document.querySelector<HTMLElement>('.upload-panel')!;
  Object.defineProperty(panel.querySelector<HTMLInputElement>('input[type=file]')!, 'files', { configurable: true, value: [new File(['A'], 'new.md')] });
  panel.querySelector<HTMLButtonElement>('.upload-submit')!.click();
  panel.querySelector<HTMLButtonElement>('.upload-close')!.click();
  const trigger = app.querySelector<HTMLButtonElement>('.archive-file')!;
  trigger.click();
  app.querySelector<HTMLButtonElement>('[data-action=read]')!.click();
  resolveUpload(new Response(JSON.stringify({ entry }), { status: 201 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.querySelector('.upload-panel'), null);
  assert.ok(app.querySelector('.archive-reader'));
  app.querySelector<HTMLButtonElement>('.reader-close')!.click();
  assert.equal(app.querySelector('.archive-scene')?.hasAttribute('inert'), false);
});

test('closing during archive refresh does not leave the new scene inert', async t => {
  const { startArchive } = await import('../src/main.ts');
  dom.reconfigure({ url: 'http://127.0.0.1:5173/' });
  t.after(() => dom.reconfigure({ url: 'about:blank' }));
  let manifestReads = 0;
  let resolveRefresh!: (value: Response) => void;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/upload-capabilities') return new Response(JSON.stringify({ enabled: true }));
    if (url === '/api/uploads') return new Response(JSON.stringify({ entry }), { status: 201 });
    if (++manifestReads === 1) return new Response(JSON.stringify({ entries: [entry], warnings: [] }));
    return new Promise<Response>(resolve => { resolveRefresh = resolve; });
  });
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  app.querySelector<HTMLButtonElement>('.upload-trigger')!.click();
  const panel = document.querySelector<HTMLElement>('.upload-panel')!;
  Object.defineProperty(panel.querySelector<HTMLInputElement>('input[type=file]')!, 'files', { configurable: true, value: [new File(['A'], 'new.md')] });
  panel.querySelector<HTMLButtonElement>('.upload-submit')!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(manifestReads, 2);
  panel.querySelector<HTMLButtonElement>('.upload-close')!.click();
  resolveRefresh(new Response(JSON.stringify({ entries: [entry], warnings: [] })));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.querySelector('.upload-panel'), null);
  assert.equal(app.querySelector('.archive-scene')?.hasAttribute('inert'), false);
});

test('upload refresh preserves category and selected id in the video scene', async t => {
  const { startArchive } = await import('../src/main.ts');
  dom.reconfigure({ url: 'http://127.0.0.1:5173/' });
  t.after(() => dom.reconfigure({ url: 'about:blank' }));
  const second = { ...entry, id: 'second', title: '第二份档案' };
  let manifestReads = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/upload-capabilities') return new Response(JSON.stringify({ enabled: true }));
    if (url === '/api/uploads') return new Response(JSON.stringify({ entry }), { status: 201 });
    manifestReads++;
    return new Response(JSON.stringify({ entries: [entry, second], warnings: [] }));
  });
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  const select = app.querySelector<HTMLSelectElement>('.category-select')!;
  select.value = '实验';
  select.dispatchEvent(new dom.window.Event('change'));
  const scene = app.querySelector<HTMLElement & { state: { select(index: number): void } }>('.archive-scene')!;
  scene.state.select(1);
  app.querySelector<HTMLButtonElement>('.upload-trigger')!.click();
  const panel = document.querySelector<HTMLElement>('.upload-panel')!;
  Object.defineProperty(panel.querySelector<HTMLInputElement>('input[type=file]')!, 'files', { configurable: true, value: [new File(['A'], 'new.md')] });
  panel.querySelector<HTMLButtonElement>('.upload-submit')!.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(manifestReads, 2);
  assert.equal(app.querySelector<HTMLSelectElement>('.category-select')?.value, '实验');
  assert.equal(app.querySelector<HTMLElement & { state: { entry: ArchiveEntry } }>('.archive-scene')?.state.entry.id, 'second');
  panel.querySelector<HTMLButtonElement>('.upload-close')!.click();
});

test('category round trip keeps the automatically selected visible file', async t => {
  const { startArchive } = await import('../src/main.ts');
  const second = { ...entry, id: 'second', category: '报告', title: '第二份档案' };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ entries: [entry, second], warnings: [] })));
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  let select = app.querySelector<HTMLSelectElement>('.category-select')!;
  select.value = '报告';
  select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(app.querySelector<HTMLElement & { state: { entry: ArchiveEntry } }>('.archive-scene')?.state.entry.id, 'second');
  select = app.querySelector<HTMLSelectElement>('.category-select')!;
  select.value = '';
  select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(app.querySelector<HTMLElement & { state: { entry: ArchiveEntry } }>('.archive-scene')?.state.entry.id, 'second');
});

test('closing upload cannot replace a later video reader', async t => {
  const { startArchive } = await import('../src/main.ts');
  dom.reconfigure({ url: 'http://127.0.0.1:5173/' });
  t.after(() => dom.reconfigure({ url: 'about:blank' }));
  let resolveUpload!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/upload-capabilities') return new Response(JSON.stringify({ enabled: true }));
    if (url === '/api/uploads') return new Promise<Response>(resolve => { resolveUpload = resolve; });
    return new Response(JSON.stringify({ entries: [entry], warnings: [] }));
  });
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  app.querySelector<HTMLButtonElement>('.upload-trigger')!.click();
  const panel = document.querySelector<HTMLElement>('.upload-panel')!;
  Object.defineProperty(panel.querySelector<HTMLInputElement>('input[type=file]')!, 'files', { configurable: true, value: [new File(['A'], 'new.md')] });
  panel.querySelector<HTMLButtonElement>('.upload-submit')!.click();
  panel.querySelector<HTMLButtonElement>('.upload-close')!.click();
  const scene = app.querySelector<HTMLElement & { state: { open(): void } }>('.archive-scene')!;
  scene.state.open();
  app.querySelector<HTMLButtonElement>('[data-action=read]')!.click();
  const reader = app.querySelector('.archive-reader');
  resolveUpload(new Response(JSON.stringify({ entry }), { status: 201 }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(reader?.isConnected);
  app.querySelector<HTMLButtonElement>('.reader-close')!.click();
  assert.equal(app.querySelector('.archive-scene')?.hasAttribute('inert'), false);
});

test('static and fallback video controls stay usable', async t => {
  const { startArchive } = await import('../src/main.ts');
  dom.reconfigure({ url: 'https://example.test/' });
  t.after(() => dom.reconfigure({ url: 'about:blank' }));
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ entries: [entry], warnings: [] })));
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  assert.equal(app.querySelector('.upload-trigger'), null);
  const scene = app.querySelector<HTMLElement>('.archive-scene')!;
  assert.equal(scene.dataset.renderer, 'fallback');
  const select = scene.querySelector<HTMLSelectElement>('.category-select')!;
  select.value = '实验';
  select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(app.querySelector<HTMLSelectElement>('.category-select')?.value, '实验');
  assert.ok(app.querySelector('.archive-file'));
});

test('reload disposes the previous video scene', async t => {
  const { startArchive } = await import('../src/main.ts');
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ entries: [entry], warnings: [] })));
  const app = document.createElement('main');
  document.body.replaceChildren(app);
  await startArchive(app);
  const oldScene = app.querySelector<HTMLElement & { dispose(): void }>('.archive-scene')!;
  const originalDispose = oldScene.dispose;
  let disposals = 0;
  oldScene.dispose = () => { disposals++; originalDispose(); };
  await startArchive(app);
  assert.equal(disposals, 1);
  assert.equal(oldScene.isConnected, false);
});
