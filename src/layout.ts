import type { ArchiveEntry } from './types.ts';
import { entryCategory } from './categories.ts';

export interface FilePosition {
  x: number;
  y: number;
  z: number;
}

export interface FileLayout {
  files: FilePosition[];
  placeholders: FilePosition[];
  categoryCount: number;
  slotsPerRow: number;
  visualColumns: number;
  visualRows: number;
}

const DEPTH_FILL_ROWS = 8;

export function layoutFiles(entries: readonly Pick<ArchiveEntry, 'category'>[]): FileLayout {
  if (!entries.length) return { files: [], placeholders: [], categoryCount: 0, slotsPerRow: 0, visualColumns: 0, visualRows: 0 };

  const counts = new Map<string, number>();
  entries.forEach(entry => {
    const category = entryCategory(entry);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  });
  const categories = [...counts.keys()];
  const categoryCount = categories.length;
  const categoryRows = new Map(categories.map((category, index) => [category, index]));
  const rowLengths = [...counts.values()];
  const slotsPerRow = Math.max(...rowLengths);
  const rowOffsets = rowLengths.map(length => Math.floor((slotsPerRow - length) / 2));
  const rowSlots = Array<number>(categoryCount).fill(0);
  const xAt = (slot: number) => (slot - (slotsPerRow - 1) / 2) * .48;
  const zAt = (row: number) => row ? -row * 4.6 : 0;
  const files = entries.map(entry => {
    const row = categoryRows.get(entryCategory(entry))!;
    const slot = rowOffsets[row] + rowSlots[row]++;
    return { x: xAt(slot), y: 0, z: zAt(row) };
  });
  const placeholders: FilePosition[] = [];
  for (let row = 0; row < categoryCount; row++) {
    for (let slot = 0; slot < slotsPerRow; slot++) {
      if (slot < rowOffsets[row] || slot >= rowOffsets[row] + rowLengths[row]) {
        placeholders.push({ x: xAt(slot), y: 0, z: zAt(row) });
      }
    }
  }
  const sideColumns = Math.max(0, Math.ceil((32 - slotsPerRow) / 2));
  for (let offset = 1; offset <= sideColumns; offset++) {
    for (const slot of [-offset, slotsPerRow - 1 + offset]) {
      for (let row = 0; row < categoryCount; row++) {
        placeholders.push({ x: xAt(slot), y: 0, z: zAt(row) });
      }
    }
  }
  const visualColumns = slotsPerRow + sideColumns * 2;
  const visualRows = categoryCount + DEPTH_FILL_ROWS;
  for (let row = categoryCount; row < visualRows; row++) {
    for (let slot = -sideColumns; slot < slotsPerRow + sideColumns; slot++) {
      placeholders.push({ x: xAt(slot), y: 0, z: zAt(row) });
    }
  }
  return { files, placeholders, categoryCount, slotsPerRow, visualColumns, visualRows };
}
