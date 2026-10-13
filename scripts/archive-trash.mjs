import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, lstat, rename, copyFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { buildArchive, publishArchiveMutation } from './build-archive.mjs';

class TrashError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new TrashError(status, code, message); };
const exists = async file => { try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const unique = values => [...new Set(values)];
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function createArchiveTrash({ documentsDir, outputDir, trashDir }) {
  const documents = path.resolve(documentsDir), output = path.resolve(outputDir);
  const trash = path.resolve(trashDir ?? path.join(path.dirname(documents), '.archive-trash'));
  if (trash === documents || trash.startsWith(documents + path.sep) || documents.startsWith(trash + path.sep)) throw new Error('Trash must be outside documents.');
  const manifestPath = path.join(output, 'manifest.json');
  const readManifest = async () => JSON.parse(await readFile(manifestPath, 'utf8'));
  const journalPath = operationId => path.join(trash, operationId, 'journal.json');
  const writeJournal = async journal => {
    const target = journalPath(journal.operationId), temp = `${target}.tmp`;
    await writeFile(temp, JSON.stringify(journal, null, 2), 'utf8');
    await rename(temp, target);
  };
  const validRelative = relative => {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) fail(400, 'invalid_path', '档案路径无效。');
    const absolute = path.resolve(documents, relative);
    if (!absolute.startsWith(documents + path.sep)) fail(400, 'invalid_path', '档案路径无效。');
    return absolute;
  };
  const checkSource = async relative => {
    const target = validRelative(relative);
    for (let current = documents; ; ) {
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail(400, 'linked_path', '档案路径不能包含链接。');
      if (current === target) { if (!info.isFile()) fail(400, 'invalid_file', '档案不是普通文件。'); break; }
      if (!info.isDirectory()) fail(400, 'invalid_path', '档案目录无效。');
      const remaining = path.relative(current, target).split(path.sep);
      current = path.join(current, remaining[0]);
    }
    return target;
  };
  const metadataPath = relative => relative.slice(0, -path.extname(relative).length) + '.meta.json';
  const rejectLinks = async (root, target) => {
    for (let current = root; ; ) {
      try { if ((await lstat(current)).isSymbolicLink()) fail(409, 'linked_path', '目标路径包含链接，无法恢复。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current === target) break;
      const remaining = path.relative(current, target).split(path.sep);
      current = path.join(current, remaining[0]);
    }
  };
  const batchInfo = journal => ({ operationId: journal.operationId, kind: journal.kind, label: journal.label,
    deletedAt: journal.deletedAt, entries: journal.entries.map(({ id, relativePath, title, category }) => ({ id, relativePath, title, category })) });
  const stored = (journal, relative) => path.join(trash, journal.operationId, 'files', relative);

  async function recycle(entries, kind, label, manifest) {
    if (!entries.length) fail(404, 'not_found', '没有可回收的档案。');
    for (const entry of entries) {
      if (createHash('sha256').update(entry.relativePath).digest('hex') !== entry.id) fail(409, 'stale_manifest', '档案清单与原件不一致，请重新构建。');
      await checkSource(entry.relativePath);
    }
    const selected = new Set(entries.map(entry => entry.relativePath));
    const metadata = [];
    for (const relative of unique(entries.map(entry => metadataPath(entry.relativePath)))) {
      if (!await exists(validRelative(relative))) continue;
      await checkSource(relative);
      const usedByActive = manifest.entries.some(entry => !selected.has(entry.relativePath) && metadataPath(entry.relativePath) === relative);
      metadata.push({ relative, shared: usedByActive });
    }
    const journal = { operationId: randomUUID(), kind, label, deletedAt: new Date().toISOString(),
      state: 'pending-delete', entries, files: entries.map(entry => entry.relativePath), metadata };
    const batch = path.join(trash, journal.operationId);
    await rejectLinks(trash, trash);
    await mkdir(path.join(batch, 'files'), { recursive: true });
    await writeJournal(journal);
    try {
      for (const relative of journal.files) {
        const destination = stored(journal, relative);
        await mkdir(path.dirname(destination), { recursive: true });
        await rename(validRelative(relative), destination);
      }
      for (const meta of metadata) {
        const destination = stored(journal, meta.relative);
        await mkdir(path.dirname(destination), { recursive: true });
        if (meta.shared) await copyFile(validRelative(meta.relative), destination);
        else await rename(validRelative(meta.relative), destination);
      }
      await publishArchiveMutation({ documentsDir: documents, outputDir: output, stagingDir: trash, removeIds: entries.map(entry => entry.id) });
      journal.state = 'deleted'; await writeJournal(journal);
      return { operationId: journal.operationId, ids: entries.map(entry => entry.id) };
    } catch (error) {
      // A failure after the manifest replacement is already committed; leave
      // the pending journal for startup recovery rather than restoring sources.
      const current = await readManifest().catch(() => null);
      if (!current) throw error;
      if (entries.every(entry => !current.entries.some(item => item.id === entry.id))) {
        return { operationId: journal.operationId, ids: entries.map(entry => entry.id) };
      }
      for (const relative of journal.files) if (await exists(stored(journal, relative)) && !await exists(validRelative(relative))) {
        await mkdir(path.dirname(validRelative(relative)), { recursive: true }); await rename(stored(journal, relative), validRelative(relative));
      }
      for (const meta of metadata) if (!meta.shared && await exists(stored(journal, meta.relative)) && !await exists(validRelative(meta.relative))) {
        await rename(stored(journal, meta.relative), validRelative(meta.relative));
      }
      await rm(batch, { recursive: true, force: true });
      throw error;
    }
  }
  async function trashEntry(id) {
    if (!/^[a-f0-9]{64}$/u.test(id)) fail(400, 'invalid_id', '档案 ID 无效。');
    const manifest = await readManifest(), entry = manifest.entries.find(item => item.id === id);
    if (!entry) fail(404, 'not_found', '档案不存在。');
    return recycle([entry], 'entry', entry.title, manifest);
  }
  async function trashCategory(category, expectedIds) {
    if (typeof category !== 'string' || !category.trim() || category.length > 60) fail(400, 'invalid_category', '分类名称无效。');
    const manifest = await readManifest();
    const entries = manifest.entries.filter(entry => (entry.category?.trim() || '未分类') === category);
    if (expectedIds !== undefined) {
      if (!Array.isArray(expectedIds) || expectedIds.some(id => typeof id !== 'string') || expectedIds.length !== entries.length ||
        !entries.every(entry => expectedIds.includes(entry.id))) fail(409, 'stale_membership', '分类档案已变化，请重新确认。');
    }
    return recycle(entries, 'category', category, manifest);
  }
  async function listTrash() {
    await cleanupExpired();
    let names;
    try { names = await readdir(trash); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const batches = [];
    const manifest = await readManifest();
    for (const name of names) {
      if (!/^[a-z0-9-]+$/iu.test(name)) continue;
      try {
        const journal = JSON.parse(await readFile(journalPath(name), 'utf8'));
        if (journal.state === 'deleted' || (journal.state === 'pending-delete' && journal.entries.every(entry => !manifest.entries.some(item => item.id === entry.id)))) batches.push(batchInfo(journal));
      }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return batches.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
  async function cleanupExpired(now = Date.now()) {
    let names;
    try { names = await readdir(trash); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const name of names) {
      if (!/^[a-z0-9-]+$/iu.test(name)) continue;
      const batch = path.join(trash, name);
      const info = await lstat(batch);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      let journal;
      try { journal = JSON.parse(await readFile(journalPath(name), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const deletedAt = Date.parse(journal.deletedAt);
      if (journal.operationId !== name || journal.state !== 'deleted' || !Number.isFinite(deletedAt) || now - deletedAt < TRASH_RETENTION_MS) continue;
      await rm(batch, { recursive: true, force: true });
    }
  }
  async function restoreTrash(operationId) {
    if (!/^[a-z0-9-]+$/iu.test(operationId ?? '')) fail(400, 'invalid_id', '回收批次 ID 无效。');
    await cleanupExpired();
    let journal;
    try { journal = JSON.parse(await readFile(journalPath(operationId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') fail(404, 'not_found', '回收批次不存在。'); throw error; }
    const manifest = await readManifest();
    if (journal.state === 'pending-delete' && journal.entries.every(entry => !manifest.entries.some(item => item.id === entry.id))) {
      journal.state = 'deleted'; await writeJournal(journal);
    }
    if (journal.state !== 'deleted') fail(409, 'conflict', '回收批次当前不可恢复。');
    for (const relative of journal.files) {
      validRelative(relative);
      await rejectLinks(documents, validRelative(relative));
      await rejectLinks(trash, stored(journal, relative));
      if (await exists(validRelative(relative))) fail(409, 'conflict', '原路径已有文件，无法恢复。');
      if (!await exists(stored(journal, relative))) fail(409, 'conflict', '回收文件缺失。');
    }
    for (const meta of journal.metadata) {
      const target = validRelative(meta.relative), archived = stored(journal, meta.relative);
      await rejectLinks(documents, target);
      await rejectLinks(trash, archived);
      if (await exists(target) && !Buffer.from(await readFile(target)).equals(await readFile(archived))) fail(409, 'conflict', '原元数据已改变，无法恢复。');
    }
    if (journal.entries.some(entry => manifest.entries.some(item => item.id === entry.id))) fail(409, 'conflict', '档案 ID 已在使用。');
    journal.state = 'pending-restore'; journal.restoreCreatedMetadata = []; await writeJournal(journal);
    try {
      for (const relative of journal.files) {
        const target = validRelative(relative); await mkdir(path.dirname(target), { recursive: true });
        await rename(stored(journal, relative), target);
      }
      for (const meta of journal.metadata) if (!await exists(validRelative(meta.relative))) {
        journal.restoreCreatedMetadata.push(meta.relative);
        await writeJournal(journal);
        await mkdir(path.dirname(validRelative(meta.relative)), { recursive: true });
        await copyFile(stored(journal, meta.relative), validRelative(meta.relative));
      }
      await publishArchiveMutation({ documentsDir: documents, outputDir: output, stagingDir: trash, addRelativePaths: journal.files });
      journal.state = 'restored'; await writeJournal(journal);
      return { ids: journal.entries.map(entry => entry.id) };
    } catch (error) {
      const current = await readManifest().catch(() => null);
      if (!current) throw error;
      if (journal.entries.every(entry => current.entries.some(item => item.id === entry.id))) {
        return { ids: journal.entries.map(entry => entry.id) };
      }
      for (const relative of journal.files) if (await exists(validRelative(relative)) && !await exists(stored(journal, relative))) {
        await mkdir(path.dirname(stored(journal, relative)), { recursive: true }); await rename(validRelative(relative), stored(journal, relative));
      }
      for (const relative of journal.restoreCreatedMetadata ?? []) {
        const target = validRelative(relative), archived = stored(journal, relative);
        if (await exists(target) && Buffer.from(await readFile(target)).equals(await readFile(archived))) await rm(target);
      }
      journal.state = 'deleted'; await writeJournal(journal);
      throw error;
    }
  }
  async function recoverPending() {
    let names;
    try { names = await readdir(trash); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    let changed = false;
    for (const name of names) {
      if (!/^[a-z0-9-]+$/iu.test(name)) continue;
      let journal;
      try { journal = JSON.parse(await readFile(journalPath(name), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (!['pending-delete', 'pending-restore'].includes(journal.state)) continue;
      for (const relative of [...journal.files, ...journal.metadata.map(meta => meta.relative)]) {
        await rejectLinks(documents, validRelative(relative));
        await rejectLinks(trash, stored(journal, relative));
      }
      const manifest = await readManifest().catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const restoreCommitted = manifest !== null && journal.entries.every(entry => manifest.entries.some(item => item.id === entry.id));
      const deleteCommitted = manifest !== null && journal.entries.every(entry => !manifest.entries.some(item => item.id === entry.id));
      if (journal.state === 'pending-delete') {
        if (!deleteCommitted) {
          for (const relative of journal.files) if (await exists(stored(journal, relative)) && !await exists(validRelative(relative))) {
            await mkdir(path.dirname(validRelative(relative)), { recursive: true }); await rename(stored(journal, relative), validRelative(relative));
          }
          for (const meta of journal.metadata) if (!meta.shared && await exists(stored(journal, meta.relative)) && !await exists(validRelative(meta.relative))) await rename(stored(journal, meta.relative), validRelative(meta.relative));
          await rm(path.join(trash, name), { recursive: true, force: true });
        } else { journal.state = 'deleted'; await writeJournal(journal); }
      } else if (restoreCommitted) { journal.state = 'restored'; await writeJournal(journal); }
      else {
        for (const relative of journal.files) if (await exists(validRelative(relative)) && !await exists(stored(journal, relative))) {
          await mkdir(path.dirname(stored(journal, relative)), { recursive: true }); await rename(validRelative(relative), stored(journal, relative));
        }
        for (const relative of journal.restoreCreatedMetadata ?? []) {
          const target = validRelative(relative), archived = stored(journal, relative);
          if (await exists(target) && Buffer.from(await readFile(target)).equals(await readFile(archived))) await rm(target);
        }
        journal.state = 'deleted'; await writeJournal(journal);
      }
      changed = true;
    }
    if (changed) await buildArchive({ documentsDir: documents, outputDir: output });
    for (const name of names.filter(value => value.startsWith('.publish-'))) await rm(path.join(trash, name), { recursive: true, force: true });
  }
  return { trashEntry, trashCategory, listTrash, restoreTrash, recoverPending, cleanupExpired };
}
