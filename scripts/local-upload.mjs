import Busboy from 'busboy';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { appendArchiveEntry } from './build-archive.mjs';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const allowed = new Set(['.md', '.docx', '.pdf', '.doc']);

class UploadError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function validateName(name) {
  if (!name || name !== name.trim() || /[<>:"/\\|?*\x00-\x1f]/u.test(name) || /[. ]$/u.test(name) || !path.parse(name).name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name) || !allowed.has(path.extname(name).toLowerCase())) {
    throw new UploadError(400, 'invalid_file', '文件名或格式不受支持。');
  }
}

function validateCategory(value) {
  const category = value.trim();
  if (category.length > 60 || /[\x00-\x1f]/u.test(category)) throw new UploadError(400, 'invalid_category', '分类不能超过 60 字且不能包含控制字符。');
  return category === '未分类' ? '' : category;
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function parseUpload(req, documentsDir) {
  await mkdir(documentsDir, { recursive: true });
  const tempPath = path.join(documentsDir, `.upload-${randomUUID()}.tmp`);
  let filename;
  let category = '';
  let fileCount = 0;
  let tooLarge = false;
  let invalidShape = false;
  const writes = [];
  try {
    await new Promise((resolve, reject) => {
      let parser;
      try { parser = Busboy({ headers: req.headers, preservePath: true, defParamCharset: 'utf8', limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 1 } }); }
      catch { reject(new UploadError(400, 'invalid_request', '上传请求格式无效。')); return; }
      parser.on('file', (field, stream, info) => {
        fileCount++;
        filename = info.filename;
        if (field !== 'file') invalidShape = true;
        stream.on('limit', () => { tooLarge = true; });
        writes.push(pipeline(stream, createWriteStream(tempPath, { flags: 'wx' })));
      });
      parser.on('field', (field, value, info) => {
        if (field !== 'category' || info.valueTruncated) invalidShape = true;
        else category = value;
      });
      parser.on('filesLimit', () => { invalidShape = true; });
      parser.on('fieldsLimit', () => { invalidShape = true; });
      parser.on('error', reject);
      parser.on('close', resolve);
      req.on('aborted', () => {
        const error = new UploadError(400, 'aborted', '上传已中断。');
        parser.destroy(error);
        reject(error);
      });
      req.pipe(parser);
    });
    await Promise.all(writes);
    if (tooLarge) throw new UploadError(413, 'too_large', '单文件不能超过 50 MiB。');
    if (invalidShape || fileCount !== 1) throw new UploadError(400, 'invalid_request', '请选择一份文件并指定分类。');
    validateName(filename);
    return { tempPath, filename, category: validateCategory(category) };
  } catch (error) {
    await Promise.allSettled(writes);
    await rm(tempPath, { force: true });
    throw error;
  }
}

export function createUploadMiddleware({ documentsDir, outputDir }) {
  let queue = Promise.resolve();
  const commit = task => {
    const result = queue.then(task, task);
    queue = result.catch(() => {});
    return result;
  };
  return (req, res, next) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname !== '/api/upload-capabilities' && pathname !== '/api/uploads') return next();
    const host = req.headers.host ?? '';
    const expectedOrigin = `http://${host}`;
    if (!/^127\.0\.0\.1(?::\d+)?$/u.test(host) || (req.headers.origin && req.headers.origin !== expectedOrigin)) {
      send(res, 403, { code: 'forbidden', message: '仅允许本机同源请求。' });
      return;
    }
    if (pathname === '/api/upload-capabilities' && req.method === 'GET') {
      send(res, 200, { enabled: true, maxFileBytes: MAX_FILE_BYTES });
      return;
    }
    if (pathname !== '/api/uploads' || req.method !== 'POST') {
      send(res, 405, { code: 'method_not_allowed', message: '请求方法不受支持。' });
      return;
    }
    void (async () => {
      let parsed;
      try {
        if (Number(req.headers['content-length']) > MAX_FILE_BYTES + 16 * 1024) throw new UploadError(413, 'too_large', '单文件不能超过 50 MiB。');
        parsed = await parseUpload(req, documentsDir);
        const result = await commit(async () => {
          const stem = path.parse(parsed.filename).name;
          const existing = await readdir(documentsDir);
          if (existing.some(name => allowed.has(path.extname(name).toLowerCase()) && path.parse(name).name.toLowerCase() === stem.toLowerCase()) || existing.some(name => name.toLowerCase() === `${stem}.meta.json`.toLowerCase())) {
            throw new UploadError(409, 'conflict', '同名文件或元数据已存在。');
          }
          const destination = path.join(documentsDir, parsed.filename);
          const metadata = path.join(documentsDir, `${stem}.meta.json`);
          const metaTemp = path.join(documentsDir, `.upload-${randomUUID()}.tmp`);
          let linkedFile = false;
          let linkedMeta = false;
          try {
            if (parsed.category) await writeFile(metaTemp, JSON.stringify({ category: parsed.category }, null, 2), { flag: 'wx' });
            await link(parsed.tempPath, destination);
            linkedFile = true;
            if (parsed.category) { await link(metaTemp, metadata); linkedMeta = true; }
            return await appendArchiveEntry({ documentsDir, outputDir, relativePath: parsed.filename });
          } catch (error) {
            if (linkedMeta) await rm(metadata, { force: true });
            if (linkedFile) await rm(destination, { force: true });
            if (error.code === 'EEXIST') throw new UploadError(409, 'conflict', '同名文件或元数据已存在。');
            throw error;
          } finally {
            await rm(metaTemp, { force: true });
          }
        });
        send(res, 201, result);
      } catch (error) {
        if (!res.headersSent) send(res, error.status ?? 500, { code: error.code ?? 'storage_error', message: error.status ? error.message : '文件写入失败。' });
      } finally {
        if (parsed) await rm(parsed.tempPath, { force: true });
      }
    })();
  };
}
