import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUploadMiddleware } from './scripts/local-upload.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const documentsDir = path.join(root, 'documents');
const trashDir = path.join(root, '.archive-trash');

export default defineConfig({
  css: { preprocessorOptions: { scss: { quietDeps: true } } },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  plugins: [{
    name: 'local-upload',
    configureServer(server) {
      server.middlewares.use(createUploadMiddleware({ documentsDir, outputDir: path.join(root, 'public/archive'), trashDir }));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createUploadMiddleware({ documentsDir, outputDir: path.join(root, 'dist/archive'), trashDir }));
    },
  }],
});
