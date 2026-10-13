import { icon } from './icons.ts';
import type { ArchiveEntry, ArchiveTrashBatch } from './types.ts';

export interface ManagementOptions {
  mode: 'confirm-entry' | 'categories' | 'trash';
  entry?: ArchiveEntry;
  categories: { name: string; count: number }[];
  batches: ArchiveTrashBatch[];
  onClose: () => void;
  onDeleteEntry: (id: string) => Promise<void>;
  onDeleteCategory: (name: string) => Promise<void>;
  onRestore: (operationId: string) => Promise<void>;
}

export function renderArchiveManagement(options: ManagementOptions): HTMLElement {
  const root = document.createElement('section');
  root.className = 'archive-management';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', options.mode === 'trash' ? '回收区' : options.mode === 'categories' ? '管理分类' : '删除档案');
  const paper = document.createElement('div'); paper.className = 'management-paper';
  const header = document.createElement('header');
  const title = document.createElement('h2');
  const close = document.createElement('button'); close.type = 'button'; close.className = 'button is-ghost management-close';
  close.setAttribute('aria-label', '关闭'); close.append(icon('close'));
  header.append(title, close);
  const content = document.createElement('div'); content.className = 'management-content';
  const status = document.createElement('p'); status.className = 'management-status'; status.setAttribute('role', 'alert');
  const footer = document.createElement('footer');
  paper.append(header, content, status, footer); root.append(paper);
  let pending = false;
  let categoryToDelete: { name: string; count: number } | undefined;
  const button = (label: string, action: () => void, className = 'button is-outlined') => {
    const el = document.createElement('button'); el.type = 'button'; el.className = className; el.textContent = label;
    el.addEventListener('click', action); return el;
  };
  const run = async (task: () => Promise<void>) => {
    if (pending) return;
    pending = true; status.textContent = '';
    root.querySelectorAll<HTMLButtonElement>('button').forEach(el => { el.disabled = true; });
    try { await task(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : '操作失败，请重试。'; }
    finally { pending = false; root.querySelectorAll<HTMLButtonElement>('button').forEach(el => { el.disabled = false; }); }
  };
  const dismiss = () => { if (!pending) options.onClose(); };
  close.addEventListener('click', dismiss);
  root.addEventListener('click', event => { if (event.target === root) dismiss(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
    if (event.key !== 'Tab') return;
    const items = [...root.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  const render = () => {
    content.replaceChildren(); footer.replaceChildren(); status.textContent = '';
    if (options.mode === 'confirm-entry' && options.entry) {
      title.textContent = '删除档案';
      const message = document.createElement('p'); message.textContent = `“${options.entry.title}”将移入回收区，可恢复。`;
      content.append(message);
      footer.append(button('取消', dismiss), button('移入回收区', () => { void run(() => options.onDeleteEntry(options.entry!.id)); }, 'button is-danger'));
    } else if (options.mode === 'categories' && categoryToDelete) {
      title.textContent = categoryToDelete.name === '未分类' ? '清空未分类' : '删除分类';
      const message = document.createElement('p');
      message.textContent = `“${categoryToDelete.name}”中的 ${categoryToDelete.count} 份档案将一起移入回收区，可恢复。`;
      content.append(message);
      footer.append(button('取消', () => { categoryToDelete = undefined; render(); }),
        button('移入回收区', () => { void run(() => options.onDeleteCategory(categoryToDelete!.name)); }, 'button is-danger'));
    } else if (options.mode === 'categories') {
      title.textContent = '管理分类';
      if (!options.categories.length) content.textContent = '暂无分类档案。';
      options.categories.forEach(category => {
        const row = document.createElement('div'); row.className = 'management-row';
        const text = document.createElement('span'); text.textContent = `${category.name} · ${category.count} 份档案`;
        row.append(text, button(category.name === '未分类' ? '清空未分类' : '删除分类', () => { categoryToDelete = category; render(); }));
        content.append(row);
      });
      footer.append(button('关闭', dismiss));
    } else {
      title.textContent = '回收区';
      const retention = document.createElement('p');
      retention.className = 'management-retention';
      retention.textContent = '移入回收区的文件将在 7 天后自动永久删除。';
      content.append(retention);
      if (!options.batches.length) {
        const empty = document.createElement('p'); empty.textContent = '回收区暂无档案。'; content.append(empty);
      }
      options.batches.forEach(batch => {
        const row = document.createElement('div'); row.className = 'management-row';
        const text = document.createElement('span');
        text.textContent = `${batch.label} · ${batch.entries.length} 份档案 · ${new Date(batch.deletedAt).toLocaleString()}`;
        row.append(text, button('恢复', () => { void run(() => options.onRestore(batch.operationId)); }));
        content.append(row);
      });
      footer.append(button('关闭', dismiss));
    }
    queueMicrotask(() => { if (root.isConnected) (footer.querySelector('button') ?? close).focus(); });
  };
  render();
  return root;
}
