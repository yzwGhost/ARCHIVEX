import { renderScene } from './scene.ts';
import { renderReader } from './reader.ts';
import type { ArchiveManifest } from './types.ts';
import './style.css';
const appStates = new WeakMap<HTMLElement, {generation: number; dispose?: () => void}>();
export async function startArchive(app: HTMLElement) {
  const state = appStates.get(app) ?? {generation: 0}; appStates.set(app, state);
  const generation = ++state.generation; state.dispose?.(); state.dispose = undefined;
  try {
    const response = await fetch('/archive/manifest.json'); if (!response.ok) throw new Error('manifest');
    const manifest: ArchiveManifest = await response.json(); if (generation !== state.generation) return;
    let closeReader: (() => void) | undefined;
    const scene = renderScene(manifest.entries, (entry, trigger) => {
      if (closeReader || generation !== state.generation) return;
      scene.setReading(true); scene.setAttribute('inert', '');
      const close = (restore = true) => {
        reader.remove(); scene.removeAttribute('inert'); scene.setReading(false);
        document.removeEventListener('keydown', onKey); closeReader = undefined;
        if (restore && trigger.isConnected) trigger.focus();
      };
      const reader = renderReader(entry, close);
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
        if (event.key === 'Tab') {
          const items = Array.from(reader.querySelectorAll<HTMLElement>('button,a[href],iframe,[tabindex="0"]'));
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
      closeReader = () => close(false); document.addEventListener('keydown', onKey);
      app.append(reader); reader.querySelector<HTMLButtonElement>('.reader-close')!.focus();
    });
    state.dispose = () => { closeReader?.(); scene.dispose(); }; app.replaceChildren(scene);
  } catch {
    if (generation !== state.generation) return;
    const message = document.createElement('p'); message.className = 'archive-empty';
    message.textContent = '档案目录读取失败。请重试，或重新启动开发服务 / 重新构建后刷新页面。';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重新读取';
    retry.addEventListener('click', () => { void startArchive(app); }); message.append(document.createElement('br'), retry); app.replaceChildren(message);
  }
}
const app = document.querySelector<HTMLElement>('#app'); if (app) void startArchive(app);
