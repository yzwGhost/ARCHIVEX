import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Document, Packer, Paragraph } from 'docx';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'archive-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const documentsDir = path.join(root, 'documents');
  const outputDir = path.join(root, 'archive');
  await mkdir(documentsDir);
  const { buildArchive } = await import('../scripts/build-archive.mjs');
  return { documentsDir, outputDir, build: () => buildArchive({ documentsDir, outputDir }) };
}

test('Markdown generates safe readable HTML and copies original', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'note.md'), '# Hello\n\n[unsafe](javascript:alert(1))\n\n<script>alert(1)</script>');
  const { entries } = await f.build();
  const html = await readFile(path.join(f.outputDir, 'previews', entries[0].id + '.html'), 'utf8');
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.doesNotMatch(html, /<script|href="javascript:/);
  assert.equal(entries[0].sourceUrl, '/archive/files/note.md');
  assert.match(await readFile(path.join(f.outputDir, 'files/note.md'), 'utf8'), /# Hello/);
});

test('PDF is previewable and legacy DOC is download only', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'report.pdf'), '%PDF-1.4');
  await writeFile(path.join(f.documentsDir, 'legacy.doc'), 'legacy');
  const { entries } = await f.build();
  const pdf = entries.find(e => e.type === 'pdf');
  const doc = entries.find(e => e.type === 'doc');
  assert.equal(pdf.previewUrl, pdf.sourceUrl);
  assert.equal(doc.previewUrl, undefined);
  assert.equal(doc.sourceUrl, '/archive/files/legacy.doc');
});

test('DOCX converts actual document text', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'word.docx'), await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Rhine document text')] }] })));
  const { entries: [entry] } = await f.build();
  const html = await readFile(path.join(f.outputDir, 'previews', entry.id + '.html'), 'utf8');
  assert.match(html, /Rhine document text/);
  assert.match(entry.summary, /Rhine document text/);
});

test('nested duplicate filenames have stable distinct IDs and encoded URLs', async t => {
  const f = await fixture(t);
  for (const dir of ['中文 空格', 'other']) {
    await mkdir(path.join(f.documentsDir, dir));
    await writeFile(path.join(f.documentsDir, dir, '同名 file.md'), 'Text');
  }
  const first = await f.build();
  assert.equal(new Set(first.entries.map(e => e.id)).size, 2);
  assert.ok(first.entries.some(e => e.sourceUrl === '/archive/files/%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC/%E5%90%8C%E5%90%8D%20file.md'));
  assert.deepEqual((await f.build()).entries.map(e => e.id), first.entries.map(e => e.id));
});

test('invalid JSON falls back with warning while valid metadata overrides and sorts', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'bad.md'), 'Fallback');
  await writeFile(path.join(f.documentsDir, 'bad.meta.json'), '{invalid');
  await writeFile(path.join(f.documentsDir, 'good.md'), 'Default');
  await writeFile(path.join(f.documentsDir, 'good.meta.json'), JSON.stringify({ title: 'Override', summary: 'Summary', date: '2099-01-01', category: 'Research' }));
  const result = await f.build();
  assert.equal(result.warnings.length, 1);
  assert.equal(result.entries.find(e => e.relativePath === 'bad.md').title, 'bad');
  assert.equal(result.entries[0].title, 'Override');
  assert.equal(result.entries[0].summary, 'Summary');
  assert.equal(result.entries[0].category, 'Research');
  assert.equal(result.entries[0].date, '2099-01-01');
});

test('corrupt DOCX preserves entry and downloadable original with error', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'broken.docx'), 'not a zip');
  const { entries: [entry] } = await f.build();
  assert.ok(entry.error);
  assert.equal(entry.sourceUrl, '/archive/files/broken.docx');
  assert.equal(entry.previewUrl, undefined);
  assert.equal(await readFile(path.join(f.outputDir, 'files/broken.docx'), 'utf8'), 'not a zip');
});

test('empty folder writes empty manifest and removes stale generated output', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'old.md'), 'Old');
  await f.build();
  await rm(path.join(f.documentsDir, 'old.md'));
  assert.deepEqual((await f.build()).entries, []);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8')).entries, []);
  await assert.rejects(readFile(path.join(f.outputDir, 'files/old.md')));
});
