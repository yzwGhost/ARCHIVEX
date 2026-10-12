import type { IncomingMessage, ServerResponse } from 'node:http';

export function createUploadMiddleware(options: { documentsDir: string; outputDir: string }):
  (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
