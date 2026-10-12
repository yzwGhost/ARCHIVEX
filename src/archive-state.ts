import type { ArchiveEntry } from './types.ts';
import { entryCategory } from './categories.ts';

export const GROUP_SIZE = 8;
export const SAVED_KEY = 'rhine-archive:saved:v1';
export type ArchiveMode = 'overview' | 'detail' | 'inspect';
export type DirectoryMode = 'index' | 'saved' | null;
export type ArchiveStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const fileCode = (index: number) => `X-${String(index + 1).padStart(3, '0')}`;

export function searchEntries(entries: ArchiveEntry[], query = '', category = ''): ArchiveEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  return entries.filter((entry, index) => (!category || entryCategory(entry) === category) &&
    `${fileCode(index)} ${entry.title} ${entry.summary}`.toLocaleLowerCase().includes(normalized));
}

export class ArchiveState {
  readonly entries: ArchiveEntry[];
  readonly allEntries: ArchiveEntry[];
  selected = 0;
  mode: ArchiveMode = 'overview';
  overlay: DirectoryMode = null;
  exploded = false;
  reading = false;
  saved = new Set<string>();
  storageAvailable = true;
  private storage?: ArchiveStorage;
  private listeners = new Set<() => void>();
  private clickedSelection: number | null = null;

  constructor(entries: ArchiveEntry[], storage?: ArchiveStorage, options?: { allEntries?: ArchiveEntry[]; selectedId?: string }) {
    this.entries = entries;
    this.allEntries = options?.allEntries ?? entries;
    const selected = entries.findIndex(entry => entry.id === options?.selectedId);
    if (selected >= 0) this.selected = selected;
    this.storage = storage;
    this.storageAvailable = Boolean(storage);
    if (storage) {
      try {
        const data: unknown = JSON.parse(storage.getItem(SAVED_KEY) ?? '[]');
        if (Array.isArray(data)) this.saved = new Set(data.filter((id): id is string => typeof id === 'string' && this.allEntries.some(entry => entry.id === id)));
      } catch { /* Invalid saved data starts a new session. */ }
    }
  }
  get entry() { return this.entries[this.selected]; }
  codeFor(entry: ArchiveEntry) { return fileCode(this.allEntries.findIndex(item => item.id === entry.id)); }
  get group() { return Math.floor(this.selected / GROUP_SIZE); }
  get groupCount() { return Math.ceil(this.entries.length / GROUP_SIZE); }
  get groupLength() { return Math.min(GROUP_SIZE, this.entries.length - this.group * GROUP_SIZE); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { this.listeners.forEach(listener => listener()); }
  select(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length || this.reading) return;
    this.clickedSelection = null;
    if (this.selected === index) return;
    this.selected = index; this.notify();
  }
  activate(index: number) {
    if (this.mode !== 'overview' || this.overlay || this.reading || !Number.isInteger(index) || !this.entries[index]) return;
    if (this.clickedSelection === index && this.selected === index) this.open(index);
    else {
      this.select(index);
      this.clickedSelection = index;
    }
  }
  stepFile(delta: number) {
    if (!this.entries.length || this.mode !== 'overview') return;
    this.select(this.group * GROUP_SIZE + ((this.selected % GROUP_SIZE + delta) % this.groupLength + this.groupLength) % this.groupLength);
  }
  stepGroup(delta: number) {
    if (!this.entries.length || this.mode !== 'overview') return;
    const group = ((this.group + delta) % this.groupCount + this.groupCount) % this.groupCount;
    this.select(group * GROUP_SIZE + Math.min(this.selected % GROUP_SIZE, this.entries.length - group * GROUP_SIZE - 1));
  }
  open(index = this.selected) {
    if (!this.entries[index] || this.reading) return;
    this.clickedSelection = null;
    this.selected = index; this.mode = 'detail'; this.overlay = null; this.exploded = false; this.notify();
  }
  inspect() { if (this.mode !== 'detail') return; this.mode = 'inspect'; this.exploded = false; this.notify(); }
  back() {
    if (this.reading) return;
    if (this.overlay) this.overlay = null;
    else { this.mode = this.mode === 'inspect' ? 'detail' : 'overview'; this.exploded = false; }
    this.notify();
  }
  setOverlay(mode: DirectoryMode) { if (this.reading) return; this.overlay = mode; this.notify(); }
  toggleExploded() { if (this.mode !== 'inspect') return; this.exploded = !this.exploded; this.notify(); }
  toggleSaved() {
    if (!this.entry) return;
    if (this.saved.has(this.entry.id)) this.saved.delete(this.entry.id); else this.saved.add(this.entry.id);
    try {
      if (!this.storage) throw new Error('storage unavailable');
      this.storage.setItem(SAVED_KEY, JSON.stringify([...this.saved]));
      this.storageAvailable = true;
    } catch { this.storageAvailable = false; }
    this.notify();
  }
}
