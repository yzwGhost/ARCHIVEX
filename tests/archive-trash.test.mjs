import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildArchive } from '../scripts/build-archive.mjs';
import { createArchiveTrash } from '../scripts/archive-trash.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'archive-trash-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const documentsDir = path.join(root, 'documents');
  const outputDir = path.join(root, 'archive');
  const trashDir = path.join(root, '.archive-trash');
  await mkdir(documentsDir);
  const service = createArchiveTrash({ documentsDir, outputDir, trashDir });
  const manifest = async () => JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
  return { root, documentsDir, outputDir, trashDir, service, manifest,
    build: () => buildArchive({ documentsDir, outputDir }) };
}

test('recycle one entry and restore it', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.documentsDir, 'deep'));
  await writeFile(path.join(f.documentsDir, 'deep', 'note.md'), '# Note');
  const { entries: [entry] } = await f.build();
  const result = await f.service.trashEntry(entry.id);
  assert.deepEqual(result.ids, [entry.id]);
  await assert.rejects(access(path.join(f.documentsDir, 'deep', 'note.md')));
  assert.deepEqual((await f.manifest()).entries, []);
  await assert.rejects(access(path.join(f.outputDir, 'files', 'deep', 'note.md')));
  await assert.rejects(access(path.join(f.outputDir, 'previews', `${entry.id}.html`)));
  assert.equal((await f.service.listTrash())[0].operationId, result.operationId);
  assert.deepEqual((await f.build()).entries, []);
  assert.deepEqual(await f.service.restoreTrash(result.operationId), { ids: [entry.id] });
  assert.equal((await f.manifest()).entries[0].id, entry.id);
  assert.match(await readFile(path.join(f.outputDir, 'previews', `${entry.id}.html`), 'utf8'), /Note/);
});

test('recycle a category as one batch', async t => {
  const f = await fixture(t);
  for (const name of ['a.md', 'b.md', 'c.md']) await writeFile(path.join(f.documentsDir, name), name);
  for (const name of ['a', 'b']) await writeFile(path.join(f.documentsDir, `${name}.meta.json`), JSON.stringify({ category: '研究' }));
  const initial = await f.build();
  const result = await f.service.trashCategory('研究');
  assert.equal(result.ids.length, 2);
  assert.deepEqual((await f.manifest()).entries.map(e => e.title), ['c']);
  assert.equal((await f.service.listTrash())[0].entries.length, 2);
  await f.service.restoreTrash(result.operationId);
  assert.deepEqual(new Set((await f.manifest()).entries.map(e => e.id)), new Set(initial.entries.map(e => e.id)));
});

test('keep shared metadata and reject changed metadata on restore', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'shared.md'), 'text');
  await writeFile(path.join(f.documentsDir, 'shared.pdf'), '%PDF');
  const metadata = path.join(f.documentsDir, 'shared.meta.json');
  await writeFile(metadata, JSON.stringify({ category: '研究' }));
  const initial = await f.build();
  const result = await f.service.trashEntry(initial.entries.find(e => e.type === 'md').id);
  assert.equal(JSON.parse(await readFile(metadata, 'utf8')).category, '研究');
  await writeFile(metadata, JSON.stringify({ category: '别的分类' }));
  await assert.rejects(f.service.restoreTrash(result.operationId), e => e.status === 409);
  await writeFile(metadata, JSON.stringify({ category: '研究' }));
  await f.service.restoreTrash(result.operationId);
  assert.equal((await f.manifest()).entries.length, 2);
});

test('failed restore rolls back a newly copied sidecar', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'note.md'), 'note');
  await writeFile(path.join(f.documentsDir, 'note.meta.json'), JSON.stringify({ category: '研究' }));
  const { entries: [entry] } = await f.build();
  const batch = await f.service.trashEntry(entry.id);
  await writeFile(path.join(f.outputDir, 'files', 'note.md'), 'collision');
  await assert.rejects(f.service.restoreTrash(batch.operationId));
  await assert.rejects(access(path.join(f.documentsDir, 'note.md')));
  await assert.rejects(access(path.join(f.documentsDir, 'note.meta.json')));
  assert.deepEqual((await f.manifest()).entries, []);
});

test('reject redirected and escaping paths', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'outside'));
  await writeFile(path.join(f.root, 'outside', 'note.md'), 'outside');
  try { await symlink(path.join(f.root, 'outside'), path.join(f.documentsDir, 'linked'), 'junction'); }
  catch (error) { if (error.code === 'EPERM') return; throw error; }
  const id = 'x'.repeat(64);
  await f.build();
  const manifestPath = path.join(f.outputDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ entries: [{ id, relativePath: 'linked/note.md', category: 'A', title: 'Note' }], warnings: [] }));
  await assert.rejects(f.service.trashEntry(id), e => e.status === 400 || e.status === 409);
  assert.equal(await readFile(path.join(f.root, 'outside', 'note.md'), 'utf8'), 'outside');
});

test('restore refuses a redirected destination directory', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.documentsDir, 'deep'));
  await writeFile(path.join(f.documentsDir, 'deep', 'note.md'), 'original');
  const { entries: [entry] } = await f.build();
  const batch = await f.service.trashEntry(entry.id);
  await rm(path.join(f.documentsDir, 'deep'), { recursive: true });
  await mkdir(path.join(f.root, 'outside'));
  try { await symlink(path.join(f.root, 'outside'), path.join(f.documentsDir, 'deep'), 'junction'); }
  catch (error) { if (error.code === 'EPERM') return; throw error; }
  await assert.rejects(f.service.restoreTrash(batch.operationId), e => e.status === 400 || e.status === 409);
  await assert.rejects(access(path.join(f.root, 'outside', 'note.md')));
});

test('recover interrupted batch', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'note.md'), 'note');
  const { entries: [entry] } = await f.build();
  const operationId = 'interrupted-test';
  const batchDir = path.join(f.trashDir, operationId);
  await mkdir(path.join(batchDir, 'files'), { recursive: true });
  await writeFile(path.join(batchDir, 'journal.json'), JSON.stringify({ operationId, kind: 'entry', state: 'pending-delete', entries: [entry], files: ['note.md'], metadata: [] }));
  await rm(path.join(f.documentsDir, 'note.md'));
  await writeFile(path.join(batchDir, 'files', 'note.md'), 'note');
  await f.service.recoverPending();
  assert.equal(await readFile(path.join(f.documentsDir, 'note.md'), 'utf8'), 'note');
  assert.equal((await f.manifest()).entries[0].id, entry.id);
});

test('missing manifest rolls an incomplete delete back to the source tree', async t => {
  const f = await fixture(t);
  for (const name of ['one.md', 'two.md']) await writeFile(path.join(f.documentsDir, name), name);
  const initial = await f.build();
  const operationId = 'interrupted-missing-manifest';
  const batchDir = path.join(f.trashDir, operationId);
  await mkdir(path.join(batchDir, 'files'), { recursive: true });
  await writeFile(path.join(batchDir, 'journal.json'), JSON.stringify({ operationId, kind: 'category', state: 'pending-delete', entries: initial.entries, files: ['one.md', 'two.md'], metadata: [] }));
  await rm(path.join(f.documentsDir, 'one.md'));
  await writeFile(path.join(batchDir, 'files', 'one.md'), 'one.md');
  await rm(path.join(f.outputDir, 'manifest.json'));
  await f.service.recoverPending();
  assert.deepEqual(new Set((await f.manifest()).entries.map(entry => entry.id)), new Set(initial.entries.map(entry => entry.id)));
  assert.equal(await readFile(path.join(f.documentsDir, 'one.md'), 'utf8'), 'one.md');
  await assert.rejects(access(batchDir));
});

test('recover a committed delete with a pending journal', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'note.md'), 'note');
  const { entries: [entry] } = await f.build();
  const result = await f.service.trashEntry(entry.id);
  const journalFile = path.join(f.trashDir, result.operationId, 'journal.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8'));
  journal.state = 'pending-delete';
  await writeFile(journalFile, JSON.stringify(journal));
  await f.service.recoverPending();
  assert.deepEqual((await f.manifest()).entries, []);
  await assert.rejects(access(path.join(f.documentsDir, 'note.md')));
  assert.equal((await f.service.listTrash())[0].operationId, result.operationId);
});

test('missing manifest rolls an interrupted restore back to the trash', async t => {
  const f = await fixture(t);
  for (const name of ['one.md', 'two.md']) {
    await writeFile(path.join(f.documentsDir, name), name);
    await writeFile(path.join(f.documentsDir, name.replace('.md', '.meta.json')), JSON.stringify({ category: '研究' }));
  }
  await f.build();
  const batch = await f.service.trashCategory('研究');
  const journalFile = path.join(f.trashDir, batch.operationId, 'journal.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8'));
  journal.state = 'pending-restore';
  await writeFile(journalFile, JSON.stringify(journal));
  await mkdir(f.documentsDir, { recursive: true });
  await writeFile(path.join(f.documentsDir, 'one.md'), 'one');
  await rm(path.join(f.trashDir, batch.operationId, 'files', 'one.md'));
  await rm(path.join(f.outputDir, 'manifest.json'));
  await f.service.recoverPending();
  assert.deepEqual((await f.manifest()).entries, []);
  await assert.rejects(access(path.join(f.documentsDir, 'one.md')));
  assert.equal((await f.service.listTrash())[0].operationId, batch.operationId);
});

test('a pending committed delete remains visible and recoverable', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'note.md'), 'note');
  const { entries: [entry] } = await f.build();
  const batch = await f.service.trashEntry(entry.id);
  const journalFile = path.join(f.trashDir, batch.operationId, 'journal.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8'));
  journal.state = 'pending-delete'; await writeFile(journalFile, JSON.stringify(journal));
  assert.equal((await f.service.listTrash())[0].operationId, batch.operationId);
  assert.deepEqual(await f.service.restoreTrash(batch.operationId), { ids: [entry.id] });
});

test('generated nested links cannot redirect removal outside the archive', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.documentsDir, 'deep'));
  await writeFile(path.join(f.documentsDir, 'deep', 'note.md'), 'source');
  const { entries: [entry] } = await f.build();
  const external = path.join(f.root, 'external'); await mkdir(external);
  await writeFile(path.join(external, 'note.md'), 'external');
  await rm(path.join(f.outputDir, 'files', 'deep'), { recursive: true });
  try { await symlink(external, path.join(f.outputDir, 'files', 'deep'), 'junction'); }
  catch (error) { if (error.code === 'EPERM') return; throw error; }
  await assert.rejects(f.service.trashEntry(entry.id));
  assert.equal(await readFile(path.join(external, 'note.md'), 'utf8'), 'external');
  assert.equal(await readFile(path.join(f.documentsDir, 'deep', 'note.md'), 'utf8'), 'source');
});
