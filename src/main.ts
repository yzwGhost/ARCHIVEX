import { renderScene, type ArchiveSceneElement } from './scene.ts';
import { renderReader } from './reader.ts';
import { categoryOptions, entryCategory, filterEntries } from './categories.ts';
import { renderUploadPanel } from './upload.ts';
import type { ArchiveEntry, ArchiveManifest, UploadCapabilities } from './types.ts';
import './style.css';

interface AppState {
  generation: number;
  category: string;
  selectedId: string;
  scene?: ArchiveSceneElement;
  closeReader?: (restore?: boolean) => void;
  uploadPanel?: HTMLElement;
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
    retry.textContent = '重新读取';
    retry.addEventListener('click', () => { void startArchive(app); });
    message.append(document.createElement('br'), retry);
    app.replaceChildren(message);
  }
}
const app = document.querySelector<HTMLElement>('#app');
if (app) void startArchive(app);
