import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { buildArchive } from '../scripts/build-archive.mjs';

async function fixture(t, outputName = 'public/archive') {
  const root = await mkdtemp(path.join(tmpdir(), 'archive-upload-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const documentsDir = path.join(root, 'documents');
  const outputDir = path.join(root, outputName);
  await mkdir(documentsDir, { recursive: true });
  await buildArchive({ documentsDir, outputDir });
  const { createUploadMiddleware } = await import('../scripts/local-upload.mjs');
  const middleware = createUploadMiddleware({ documentsDir, outputDir, trashDir: path.join(root, '.archive-trash') });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404).end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { root, documentsDir, outputDir, url: `http://127.0.0.1:${server.address().port}` };
}

async function upload(f, filename, content, category = '') {
  const body = new FormData();
  body.append('file', new Blob([content]), filename);
  body.append('category', category);
  return fetch(`${f.url}/api/uploads`, { method: 'POST', body });
}

test('local upload exposes capability and publishes a categorized document', async t => {
  const f = await fixture(t);
  const capability = await (await fetch(`${f.url}/api/upload-capabilities`)).json();
  assert.deepEqual(capability, { enabled: true, maxFileBytes: 52428800 });
  const response = await upload(f, '研究.md', '# 正文', '实验');
  assert.equal(response.status, 201, await response.clone().text());
  const { entry } = await response.json();
  assert.equal(entry.category, '实验');
  assert.equal(await readFile(path.join(f.documentsDir, '研究.md'), 'utf8'), '# 正文');
  assert.equal(JSON.parse(await readFile(path.join(f.documentsDir, '研究.meta.json'), 'utf8')).category, '实验');
  const manifest = JSON.parse(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.entries[0].id, entry.id);
  assert.match(await readFile(path.join(f.outputDir, 'previews', `${entry.id}.html`), 'utf8'), /正文/);
});

test('local recycle routes delete an entry and restore its batch', async t => {
  const f = await fixture(t);
  const uploaded = await (await upload(f, 'note.md', '# Note', '研究')).json();
  const deleted = await fetch(`${f.url}/api/archives/${uploaded.entry.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  const batch = await deleted.json();
  assert.deepEqual(batch.ids, [uploaded.entry.id]);
  assert.equal((await (await fetch(`${f.url}/api/trash`)).json()).batches[0].operationId, batch.operationId);
  assert.equal(JSON.parse(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8')).entries.length, 0);
  const restored = await fetch(`${f.url}/api/trash/${batch.operationId}/restore`, { method: 'POST' });
  assert.equal(restored.status, 200);
  assert.deepEqual((await restored.json()).ids, [uploaded.entry.id]);
});

test('category route recycles current members and keeps others', async t => {
  const f = await fixture(t);
  await upload(f, 'a.md', 'A', '研究');
  await upload(f, 'b.md', 'B', '研究');
  await upload(f, 'c.md', 'C', '其他');
  const response = await fetch(`${f.url}/api/categories`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: '研究' }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ids.length, 2);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8')).entries.map(e => e.title), ['c']);
});

test('upload and category deletion serialize without a partial batch', async t => {
  const f = await fixture(t);
  await upload(f, 'first.md', 'first', '研究');
  const [uploaded, deleted] = await Promise.all([
    upload(f, 'second.md', 'second', '研究'),
    fetch(`${f.url}/api/categories`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: '研究' }) }),
  ]);
  assert.equal(uploaded.status, 201);
  assert.equal(deleted.status, 200);
  const removed = (await deleted.json()).ids;
  const active = JSON.parse(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8')).entries;
  assert.equal(removed.length + active.length, 2);
  assert.ok(removed.length === 1 || removed.length === 2);
});

test('category deletion rejects stale confirmed members', async t => {
  const f = await fixture(t);
  const first = await (await upload(f, 'first.md', 'first', '研究')).json();
  await upload(f, 'second.md', 'second', '研究');
  const response = await fetch(`${f.url}/api/categories`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: '研究', expectedIds: [first.entry.id] }) });
  assert.equal(response.status, 409);
  assert.equal(JSON.parse(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8')).entries.length, 2);
});

test('recycle routes reject foreign origins and malformed category bodies', async t => {
  const f = await fixture(t);
  const options = { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{invalid' };
  assert.equal((await fetch(`${f.url}/api/categories`, options)).status, 400);
  assert.equal((await fetch(`${f.url}/api/categories`, { ...options, headers: { ...options.headers, Origin: 'http://attacker.example' } })).status, 403);
});

test('upload rejects duplicate file and shared metadata stem without overwriting', async t => {
  const f = await fixture(t);
  assert.equal((await upload(f, 'sample.md', 'First', 'A')).status, 201);
  assert.equal((await upload(f, 'sample.md', 'Second', 'B')).status, 409);
  assert.equal((await upload(f, 'sample.pdf', '%PDF-1.4', 'B')).status, 409);
  assert.equal(await readFile(path.join(f.documentsDir, 'sample.md'), 'utf8'), 'First');
  assert.equal(JSON.parse(await readFile(path.join(f.documentsDir, 'sample.meta.json'), 'utf8')).category, 'A');
});

test('invalid upload leaves no document or metadata behind', async t => {
  const f = await fixture(t);
  assert.equal((await upload(f, 'wrong.txt', 'No', 'A')).status, 400);
  assert.equal((await upload(f, 'note.md', 'No', 'a'.repeat(61))).status, 400);
  assert.equal((await upload(f, '../escape.md', 'No', 'A')).status, 400);
  assert.deepEqual(await readdir(f.documentsDir), []);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8')).entries, []);
});

test('upload enforces file size and removes temporary content', async t => {
  const f = await fixture(t);
  const tooLarge = new Uint8Array(50 * 1024 * 1024 + 1);
  assert.equal((await upload(f, 'large.md', tooLarge)).status, 413);
  assert.deepEqual(await readdir(f.documentsDir), []);
});

test('upload accepts a file of exactly 50 MiB', async t => {
  const f = await fixture(t);
  const response = await upload(f, 'exact.doc', new Uint8Array(50 * 1024 * 1024));
  assert.equal(response.status, 201, await response.clone().text());
  assert.ok((await readdir(f.documentsDir)).includes('exact.doc'));
});

test('chunked upload exceeding 50 MiB responds before request ends and clears temporary content', async t => {
  const f = await fixture(t);
  const endpoint = new URL('/api/uploads', f.url);
  const req = request(endpoint, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=overflow-test' } });
  req.on('error', () => {});
  const response = new Promise((resolve, reject) => {
    req.on('response', res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
  req.write('--overflow-test\r\nContent-Disposition: form-data; name="file"; filename="large.md"\r\nContent-Type: text/markdown\r\n\r\n');
  req.write(Buffer.alloc(50 * 1024 * 1024 + 1));
  try {
    assert.equal(await Promise.race([
      response,
      new Promise((_, reject) => setTimeout(() => reject(new Error('No early overflow response')), 3000)),
    ]), 413);
    assert.deepEqual(await readdir(f.documentsDir), []);
  } finally {
    req.destroy();
  }
});

test('aborted multipart request removes its temporary file', async t => {
  const f = await fixture(t);
  const endpoint = new URL('/api/uploads', f.url);
  const req = request(endpoint, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=cancel-test' } });
  req.on('error', () => {});
  req.write('--cancel-test\r\nContent-Disposition: form-data; name="file"; filename="partial.md"\r\nContent-Type: text/markdown\r\n\r\npartial');
  await new Promise(resolve => setTimeout(resolve, 20));
  req.destroy();
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await readdir(f.documentsDir)).length === 0) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(await readdir(f.documentsDir), []);
});

test('upload rejects a foreign origin', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.url}/api/uploads`, { method: 'POST', headers: { Origin: 'http://attacker.example' }, body: new FormData() });
  assert.equal(response.status, 403);
  assert.deepEqual(await readdir(f.documentsDir), []);
});

test('concurrent requests for the same filename allow exactly one upload', async t => {
  const f = await fixture(t);
  const results = await Promise.all([upload(f, 'same.md', 'First'), upload(f, 'same.md', 'Second')]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const manifest = JSON.parse(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.entries.length, 1);
});

test('upload publishes to the selected preview archive directory', async t => {
  const f = await fixture(t, 'dist/archive');
  assert.equal((await upload(f, 'preview.md', 'Preview')).status, 201);
  assert.equal(JSON.parse(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8')).entries.length, 1);
});
