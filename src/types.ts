export interface ArchiveEntry {
  id: string;
  relativePath: string;
  title: string;
  summary: string;
  date: string;
  category: string;
  type: 'md' | 'docx' | 'pdf' | 'doc';
  sourceUrl: string;
  previewUrl?: string;
  error?: string;
}

export interface ArchiveManifest {
  entries: ArchiveEntry[];
  warnings: string[];
}
