import { renderScene, type ArchiveSceneElement } from './scene.ts';
import { renderReader } from './reader.ts';
import { categoryOptions, entryCategory, filterEntries } from './categories.ts';
import { renderUploadPanel } from './upload.ts';
import { renderArchiveManagement } from './archive-management.ts';
import { replacementAfterRemoval } from './archive-state.ts';
import type { ArchiveEntry, ArchiveManifest, ArchiveTrashBatch, UploadCapabilities } from './types.ts';
import './bulma.scss';
import './style.css';

interface AppState {
  generation: number;
  category: string;
  selectedId: string;
  scene?: ArchiveSceneElement;
  closeReader?: (restore?: boolean) => void;
  uploadPanel?: HTMLElement;
  managementPanel?: HTMLElement;
  busy?: boolean;
}
const appStates = new WeakMap<HTMLElement, AppState>();

export async function startArchive(app: HTMLElement, shouldApply: () => boolean = () => true) {
  const state = appStates.get(app) ?? { generation: 0, category: '', selectedId: '' };
  appStates.set(app, state);
  const generation = ++state.generation;
  try {
    const response = await fetch('/archive/manifest.json');
    if (!response.ok) throw new Error('manifest');
    const manifest: ArchiveManifest = await response.json();
    if (generation !== state.generation || !shouldApply()) return;
    let uploadEnabled = false;
    if (app.ownerDocument.defaultView?.location.hostname === '127.0.0.1') {
      try {
        const capabilityResponse = await fetch('/api/upload-capabilities');
        if (capabilityResponse.ok) {
          const capability: UploadCapabilities = await capabilityResponse.json();
          uploadEnabled = capability.enabled === true;
        }
      } catch { /* Static hosting has no upload API. */ }
    }
    if (generation !== state.generation || !shouldApply()) return;
    const categories = categoryOptions(manifest.entries);
    if (state.category && !categories.includes(state.category)) state.category = '';
    const render = (openId?: string) => {
      state.closeReader?.(false);
      state.scene?.dispose();
      const visible = filterEntries(manifest.entries, state.category);
      let scene: ArchiveSceneElement;
      const request = async (url: string, options?: RequestInit) => {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || '档案操作失败。');
        return data;
      };
      const openManagement = async (mode: 'confirm-entry' | 'categories' | 'trash', entry?: ArchiveEntry) => {
        if (state.busy || state.managementPanel?.isConnected || state.uploadPanel?.isConnected || state.closeReader) return;
        let batches: ArchiveTrashBatch[] = [];
        if (mode === 'trash') {
          try { batches = (await request('/api/trash')).batches as ArchiveTrashBatch[]; }
          catch { return; }
        }
        if (state.scene !== scene || !scene.isConnected) return;
        const trigger = app.ownerDocument.activeElement as HTMLElement;
        const close = (restoreFocus = true) => {
          panel.remove();
          if (state.managementPanel === panel) state.managementPanel = undefined;
          if (state.scene === scene) scene.removeAttribute('inert');
          if (restoreFocus && trigger?.isConnected) trigger.focus();
        };
        const afterDelete = async (url: string, options: RequestInit) => {
          if (state.busy) return;
          const result = await request(url, options) as { operationId: string; ids: string[] };
          state.busy = true;
          close(false);
          const replacement = replacementAfterRemoval(manifest.entries, result.ids, state.selectedId);
          const target = manifest.entries.find(item => result.ids.includes(item.id));
          let animationScene = scene;
          if (target && !visible.some(item => result.ids.includes(item.id))) {
            state.category = entryCategory(target);
            state.selectedId = target.id;
            render();
            animationScene = state.scene ?? scene;
          } else if (target && !result.ids.includes(animationScene.state.entry?.id ?? '')) {
            const index = visible.findIndex(item => item.id === target.id);
            if (index >= 0) animationScene.state.select(index);
          }
          animationScene.setReading(true); animationScene.setAttribute('inert', '');
          try {
            const reducedMotion = app.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
            await animationScene.animateRemoval(result.ids, reducedMotion);
            state.selectedId = replacement;
            await startArchive(app);
            state.scene?.focus();
          } finally {
            state.busy = false;
            if (animationScene.isConnected) { animationScene.setReading(false); animationScene.removeAttribute('inert'); }
          }
        };
        const panel = renderArchiveManagement({
          mode, entry,
          categories: categories.map(name => ({ name, count: manifest.entries.filter(item => entryCategory(item) === name).length })),
          batches, onClose: close,
          onDeleteEntry: id => afterDelete(`/api/archives/${encodeURIComponent(id)}`, { method: 'DELETE' }),
          onDeleteCategory: name => afterDelete('/api/categories', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: name, expectedIds: manifest.entries.filter(item => entryCategory(item) === name).map(item => item.id) }) }),
          onRestore: async operationId => {
            if (state.busy) return;
            const result = await request(`/api/trash/${encodeURIComponent(operationId)}/restore`, { method: 'POST' }) as { ids: string[] };
            state.busy = true; close(false);
            state.category = ''; state.selectedId = result.ids[0] ?? '';
            try { await startArchive(app); state.scene?.focus(); }
            finally { state.busy = false; if (scene.isConnected) scene.removeAttribute('inert'); }
          },
        });
        state.managementPanel = panel;
        scene.setAttribute('inert', '');
        app.ownerDocument.body.append(panel);
      };
      const onRead = (entry: ArchiveEntry, trigger: HTMLButtonElement) => {
        if (state.scene !== scene || !scene.isConnected || state.closeReader || state.uploadPanel?.isConnected) return;
        scene.setReading(true);
        scene.setAttribute('inert', '');
        const close = (restore = true) => {
          reader.remove();
          scene.removeAttribute('inert');
          scene.setReading(false);
          document.removeEventListener('keydown', onKey);
          if (state.closeReader === close) state.closeReader = undefined;
          if (restore && trigger.isConnected) trigger.focus();
        };
        const reader = renderReader(entry, close);
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
          if (event.key === 'Tab') {
            const items = Array.from(reader.querySelectorAll<HTMLElement>('button,a[href],iframe,[tabindex="0"]'));
            const first = items[0], last = items[items.length - 1];
            if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        };
        state.closeReader = close;
        document.addEventListener('keydown', onKey);
        app.append(reader);
        reader.querySelector<HTMLButtonElement>('.reader-close')!.focus();
      };
      scene = renderScene(visible, onRead, {
        allEntries: manifest.entries,
        category: state.category,
        categories,
        selectedId: state.selectedId,
        onCategoryChange: category => { state.category = category; render(); },
        onLocate: id => {
          const entry = manifest.entries.find(item => item.id === id);
          if (!entry) return;
          state.category = entryCategory(entry);
          state.selectedId = id;
          render(id);
        },
        onSelectionChange: id => { state.selectedId = id; },
        onDeleteEntry: uploadEnabled ? id => { void openManagement('confirm-entry', manifest.entries.find(item => item.id === id)); } : undefined,
        onManageCategories: uploadEnabled ? () => { void openManagement('categories'); } : undefined,
        onOpenTrash: uploadEnabled ? () => { void openManagement('trash'); } : undefined,
        onUpload: uploadEnabled ? () => {
          if (state.uploadPanel?.isConnected) return;
          scene.setAttribute('inert', '');
          const panel = renderUploadPanel({
            categories,
            onClose: () => {
              panel.remove();
              if (state.uploadPanel === panel) state.uploadPanel = undefined;
              state.scene?.removeAttribute('inert');
              state.scene?.querySelector<HTMLButtonElement>('.upload-trigger')?.focus();
            },
            onComplete: async () => {
              await startArchive(app, () => panel.isConnected);
              if (panel.isConnected) state.scene?.setAttribute('inert', '');
            },
          });
          state.uploadPanel = panel;
          app.ownerDocument.body.append(panel);
          panel.querySelector<HTMLInputElement>('input[type=file]')?.focus();
        } : undefined,
      });
      state.scene = scene;
      app.replaceChildren(scene);
      state.selectedId = scene.state.entry?.id ?? '';
      if (state.uploadPanel?.isConnected) scene.setAttribute('inert', '');
      if (openId) {
        const index = visible.findIndex(entry => entry.id === openId);
        if (index >= 0) scene.state.open(index);
      }
    };
    render();
  } catch {
    if (generation !== state.generation || !shouldApply()) return;
    state.closeReader?.(false);
    state.scene?.dispose();
    state.scene = undefined;
    const message = document.createElement('p');
    message.className = 'archive-empty';
    message.textContent = '档案目录读取失败。请重试，或重新启动开发服务 / 重新构建后刷新页面。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button is-outlined';
    retry.textContent = '重新读取';
    retry.addEventListener('click', () => { void startArchive(app); });
    message.append(document.createElement('br'), retry);
    app.replaceChildren(message);
  }
}
const app = document.querySelector<HTMLElement>('#app');
if (app) void startArchive(app);
