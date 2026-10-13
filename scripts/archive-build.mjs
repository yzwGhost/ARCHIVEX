import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArchive } from './build-archive.mjs';
import { createArchiveTrash } from './archive-trash.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const documentsDir = path.join(root, 'documents');
const outputDir = path.join(root, 'public/archive');
await createArchiveTrash({ documentsDir, outputDir, trashDir: path.join(root, '.archive-trash') }).recoverPending();
const manifest = await buildArchive({ documentsDir, outputDir });
console.log(`Archive: ${manifest.entries.length} documents, ${manifest.warnings.length} warnings.`);
