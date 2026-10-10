import { renderScene } from './scene.ts';
import { renderReader } from './reader.ts';
import type { ArchiveManifest } from './types.ts';
import './style.css';

const appStates = new WeakMap<HTMLElement, { generation: number; dispose?: () => void }>();

export async function startArchive(app: HTMLElement) {
  const state = appStates.get(app) ?? { generation: 0 };
  appStates.set(app, state);
  const generation = ++state.generation;
  state.dispose?.();
  state.dispose = undefined;
  try {
    const response = await fetch('/archive/manifest.json');
    if (!response.ok) throw new Error('manifest');
    const manifest: ArchiveManifest = await response.json();
    if (generation !== state.generation) return;
    let active = false;
    const scene = renderScene(manifest.entries, (entry, trigger) => {
      if (active || generation !== state.generation) return;
      active = true;
      trigger.classList.add('is-selected');
      scene.classList.add('is-extracting');
      const timer = setTimeout(() => {
        scene.classList.add('is-reading');
        const reader = renderReader(entry, close);
        app.append(reader);
        reader.querySelector<HTMLButtonElement>('.reader-close')!.focus();
      }, 650);
      scene.setAttribute('inert', '');
      const close = (restoreFocus = true) => {
        clearTimeout(timer);
        app.querySelector('.archive-reader')?.remove();
        scene.classList.remove('is-extracting', 'is-reading');
        scene.removeAttribute('inert');
        trigger.classList.remove('is-selected');
        document.removeEventListener('keydown', onKey);
        active = false;
        state.dispose = undefined;
        if (restoreFocus && trigger.isConnected) trigger.focus();
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
      };
      document.addEventListener('keydown', onKey);
      state.dispose = () => close(false);
    });
    app.replaceChildren(scene);
  } catch {
    if (generation !== state.generation) return;
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
