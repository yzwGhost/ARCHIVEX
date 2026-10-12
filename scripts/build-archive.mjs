import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, rm, copyFile, stat, lstat, mkdtemp, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MarkdownIt from 'markdown-it';
import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import { Parser } from 'htmlparser2';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markdown = new MarkdownIt({ html: false });
const supported = new Set(['md', 'docx', 'pdf', 'doc']);
const urlPath = relative => relative.split('/').map(encodeURIComponent).join('/');
const blockTags = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'br', 'hr']);
function plainText(html) {
  let text = '';
  const separateBlock = tag => { if (blockTags.has(tag)) text += ' '; };
  const parser = new Parser({
    onopentag: separateBlock,
    onclosetag: separateBlock,
    ontext: value => { text += value; },
  }, { decodeEntities: true });
  parser.end(html);
  return text.replace(/\s+/g, ' ').trim();
}

async function rejectLinkedAncestors(target) {
  // lstat each existing ancestor: checking only the leaf misses junction redirects.
  for (let current = target; ; current = path.dirname(current)) {
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Archive output cannot contain a symbolic link or junction: ${current}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current === path.dirname(current)) break;
  }
}

async function scan(directory, prefix = '') {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    // Symlinks are deliberately not followed outside the document tree.
    if (item.isDirectory()) files.push(...await scan(path.join(directory, item.name), relative));
    else if (item.isFile() && supported.has(path.extname(item.name).slice(1).toLowerCase())) files.push(relative);
  }
  return files.sort();
}

const sortEntries = entries => entries.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));

async function buildEntry(input, output, relativePath) {
  const warnings = [];
  const source = path.join(input, relativePath);
  const type = path.extname(relativePath).slice(1).toLowerCase();
  const id = createHash('sha256').update(relativePath).digest('hex');
  const entry = {
    id, relativePath, title: path.basename(relativePath, path.extname(relativePath)),
    summary: type === 'pdf' ? 'PDF 文档，请打开预览或下载原文件。' : type === 'doc' ? '旧版 Word 文档，请下载后查看。' : '',
    date: '', category: '未分类', type, sourceUrl: `/archive/files/${urlPath(relativePath)}`,
  };
  try {
    entry.date = (await stat(source)).mtime.toISOString();
    const destination = path.join(output, 'files', relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    if (type === 'pdf') entry.previewUrl = entry.sourceUrl;
    if (type === 'md' || type === 'docx') {
      let html;
      if (type === 'md') html = markdown.render(await readFile(source, 'utf8'));
      else {
        const conversion = await mammoth.convertToHtml({ path: source });
        html = conversion.value;
        warnings.push(...conversion.messages.map(message => `${relativePath}: ${message.message}`));
      }
      html = sanitizeHtml(html);
      entry.summary = plainText(html).slice(0, 180);
      await mkdir(path.join(output, 'previews'), { recursive: true });
      await writeFile(path.join(output, 'previews', `${id}.html`), html, 'utf8');
      entry.previewUrl = `/archive/previews/${id}.html`;
    }
  } catch (error) {
    entry.error = `无法读取或转换文件：${error.message}`;
    warnings.push(`${relativePath}: ${entry.error}`);
  }
  try {
    const metadata = JSON.parse(await readFile(source.slice(0, -path.extname(source).length) + '.meta.json', 'utf8'));
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Metadata must be an object');
    for (const field of ['title', 'summary', 'date', 'category']) {
      if (metadata[field] === undefined) continue;
      if (typeof metadata[field] !== 'string' || (field === 'date' && !Number.isFinite(Date.parse(metadata[field])))) {
        warnings.push(`${relativePath}: invalid metadata field ${field}`);
      } else entry[field] = metadata[field];
    }
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push(`${relativePath}: invalid metadata: ${error.message}`);
  }
  return { entry, warnings };
}

/** Build the archive in a dedicated output directory. Never pass an existing user-content directory. */
export async function buildArchive({ documentsDir, outputDir }) {
  const input = path.resolve(documentsDir);
  const output = path.resolve(outputDir);
  // Validate the exact recursive-delete target before clearing generated content.
  const inputRelative = path.relative(output, input);
  if (output === path.parse(output).root || output === projectRoot || output === input || (!inputRelative.startsWith('..' + path.sep) && inputRelative !== '..' && !path.isAbsolute(inputRelative))) {
    throw new Error('Archive output must be a dedicated directory outside the document tree.');
  }
  const outputRelative = path.relative(input, output);
  if (!outputRelative.startsWith('..' + path.sep) && outputRelative !== '..' && !path.isAbsolute(outputRelative)) throw new Error('Archive output cannot be inside documents.');
  await rejectLinkedAncestors(output);
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'files'), { recursive: true });
  await mkdir(path.join(output, 'previews'), { recursive: true });
  const manifest = { entries: [], warnings: [] };
  let files;
  try { files = await scan(input); }
  catch (error) { if (error.code === 'ENOENT') files = []; else throw error; }
  for (const relativePath of files) {
    const { entry, warnings } = await buildEntry(input, output, relativePath);
    manifest.entries.push(entry);
    manifest.warnings.push(...warnings);
  }
  sortEntries(manifest.entries);
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

export async function appendArchiveEntry({ documentsDir, outputDir, relativePath }) {
  const input = path.resolve(documentsDir);
  const output = path.resolve(outputDir);
  const source = path.resolve(input, relativePath);
  if (!supported.has(path.extname(relativePath).slice(1).toLowerCase()) || path.relative(input, source).startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid archive path.');
  }
  await rejectLinkedAncestors(output);
  const manifestPath = path.join(output, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.entries.some(entry => entry.relativePath === relativePath)) throw new Error('Archive entry already exists.');
  const stage = await mkdtemp(path.join(tmpdir(), 'archive-stage-'));
  const published = [];
  let manifestTemp;
  try {
    const { entry, warnings } = await buildEntry(input, stage, relativePath);
    const files = [relativePath];
    for (const file of files) {
      const destination = path.join(output, 'files', file);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(stage, 'files', file), destination, constants.COPYFILE_EXCL);
      published.push(destination);
    }
    if (entry.previewUrl && entry.type !== 'pdf') {
      const destination = path.join(output, 'previews', `${entry.id}.html`);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(stage, 'previews', `${entry.id}.html`), destination, constants.COPYFILE_EXCL);
      published.push(destination);
    }
    manifest.entries.push(entry);
    manifest.warnings.push(...warnings);
    sortEntries(manifest.entries);
    manifestTemp = path.join(output, `.manifest-${entry.id}.tmp`);
    await writeFile(manifestTemp, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    await rename(manifestTemp, manifestPath);
    return { entry, warnings };
  } catch (error) {
    await Promise.all(published.map(file => rm(file, { force: true })));
    if (manifestTemp) await rm(manifestTemp, { force: true });
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const manifest = await buildArchive({ documentsDir: path.join(projectRoot, 'documents'), outputDir: path.join(projectRoot, 'public/archive') });
  console.log(`Archive: ${manifest.entries.length} documents, ${manifest.warnings.length} warnings.`);
  for (const warning of manifest.warnings) console.warn(warning);
}
