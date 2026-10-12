import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { watch } from 'node:fs';
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

test('cleanup rejects junction ancestors and preserves external archive contents', async t => {
  const f = await fixture(t);
  const root = path.dirname(f.documentsDir);
  const external = path.join(root, 'external');
  const linkedPublic = path.join(root, 'public');
  await mkdir(path.join(external, 'archive'), { recursive: true });
  await writeFile(path.join(external, 'archive', 'sentinel.txt'), 'Keep this external content');
  await symlink(external, linkedPublic, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const { buildArchive } = await import('../scripts/build-archive.mjs');
    await assert.rejects(buildArchive({ documentsDir: f.documentsDir, outputDir: path.join(linkedPublic, 'archive') }), /symbolic link|junction/i);
    assert.equal(await readFile(path.join(external, 'archive', 'sentinel.txt'), 'utf8'), 'Keep this external content');
  } finally {
    await rm(linkedPublic, { recursive: true, force: true });
  }
});

test('DOCX summaries separate paragraphs and decode entities into plain text', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'paragraphs.docx'), await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('First paragraph.'), new Paragraph('Second & third <literal> paragraph.')] }] })));
  const { entries: [entry] } = await f.build();
  assert.equal(entry.summary, 'First paragraph. Second & third <literal> paragraph.');
});

test('incremental publish keeps existing files and sorts the new entry', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'old.md'), 'Earlier');
  const first = await f.build();
  await writeFile(path.join(f.documentsDir, 'new.md'), '# New');
  const { appendArchiveEntry } = await import('../scripts/build-archive.mjs');
  const { entry } = await appendArchiveEntry({ documentsDir: f.documentsDir, outputDir: f.outputDir, relativePath: 'new.md' });
  const manifest = JSON.parse(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.entries.length, 2);
  assert.ok(manifest.entries.some(item => item.id === first.entries[0].id));
  assert.ok(manifest.entries.some(item => item.id === entry.id));
  assert.equal(await readFile(path.join(f.outputDir, 'files/old.md'), 'utf8'), 'Earlier');
  assert.equal(await readFile(path.join(f.outputDir, 'files/new.md'), 'utf8'), '# New');
  assert.match(await readFile(path.join(f.outputDir, 'previews', `${entry.id}.html`), 'utf8'), /New/);
});

test('incremental corrupt DOCX stays downloadable with conversion error', async t => {
  const f = await fixture(t);
  await f.build();
  await writeFile(path.join(f.documentsDir, 'broken.docx'), 'not a zip');
  const { appendArchiveEntry } = await import('../scripts/build-archive.mjs');
  const { entry } = await appendArchiveEntry({ documentsDir: f.documentsDir, outputDir: f.outputDir, relativePath: 'broken.docx' });
  assert.ok(entry.error);
  assert.equal(entry.previewUrl, undefined);
  assert.equal(await readFile(path.join(f.outputDir, 'files/broken.docx'), 'utf8'), 'not a zip');
});

test('failed incremental publish preserves the previous manifest', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.documentsDir, 'old.md'), 'Old');
  await f.build();
  const before = await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8');
  await writeFile(path.join(f.documentsDir, 'new.md'), 'New');
  await writeFile(path.join(f.outputDir, 'files', 'new.md'), 'Block publishing');
  const { appendArchiveEntry } = await import('../scripts/build-archive.mjs');
  await assert.rejects(appendArchiveEntry({ documentsDir: f.documentsDir, outputDir: f.outputDir, relativePath: 'new.md' }));
  assert.equal(await readFile(path.join(f.outputDir, 'manifest.json'), 'utf8'), before);
  assert.equal(await readFile(path.join(f.outputDir, 'files', 'new.md'), 'utf8'), 'Block publishing');
});

test('incremental publish keeps temporary generation outside the served public directory', async t => {
  const f = await fixture(t);
  await f.build();
  await writeFile(path.join(f.documentsDir, 'new.md'), '# New');
  const seen = [];
  const watcher = watch(path.dirname(f.outputDir), (_event, name) => seen.push(String(name)));
  t.after(() => watcher.close());
  const { appendArchiveEntry } = await import('../scripts/build-archive.mjs');
  await appendArchiveEntry({ documentsDir: f.documentsDir, outputDir: f.outputDir, relativePath: 'new.md' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(seen.some(name => name.startsWith('.archive-stage-')), false);
});
