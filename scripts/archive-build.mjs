import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArchive } from './build-archive.mjs';
import { createArchiveTrash } from './archive-trash.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const documentsDir = path.join(root, 'documents');
const outputDir = path.join(root, 'public/archive');
const trash = createArchiveTrash({ documentsDir, outputDir, trashDir: path.join(root, '.archive-trash') });
await trash.recoverPending();
await trash.cleanupExpired();
const manifest = await buildArchive({ documentsDir, outputDir });
console.log(`Archive: ${manifest.entries.length} documents, ${manifest.warnings.length} warnings.`);
