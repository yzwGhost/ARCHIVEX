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

export interface UploadCapabilities {
  enabled: boolean;
  maxFileBytes: number;
}

export interface UploadResult {
  entry: ArchiveEntry;
  warnings: string[];
}
