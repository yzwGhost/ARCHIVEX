import type { ArchiveEntry } from './types.ts';

export function entryCategory(entry: Pick<ArchiveEntry, 'category'>): string {
  return entry.category.trim() || '未分类';
}

export function categoryOptions(entries: ArchiveEntry[]): string[] {
  return [...new Set(entries.map(entryCategory))];
}

export function filterEntries(entries: ArchiveEntry[], category: string): ArchiveEntry[] {
  return category ? entries.filter(entry => entryCategory(entry) === category) : entries;
}
