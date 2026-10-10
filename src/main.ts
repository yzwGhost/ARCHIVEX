import { renderScene } from './scene.ts';
import { renderReader } from './reader.ts';
import type { ArchiveManifest } from './types.ts';
import './style.css';

export async function startArchive(app: HTMLElement) {
  try {
    const response = await fetch('/archive/manifest.json');
    if (!response.ok) throw new Error('manifest');
    const manifest: ArchiveManifest = await response.json();
    let active = false;
    const scene = renderScene(manifest.entries, (entry, trigger) => {
      if (active) return;
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
      const close = () => {
        clearTimeout(timer);
        app.querySelector('.archive-reader')?.remove();
        scene.classList.remove('is-extracting', 'is-reading');
        scene.removeAttribute('inert');
        trigger.classList.remove('is-selected');
        document.removeEventListener('keydown', onKey);
        active = false;
        trigger.focus();
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
      };
      document.addEventListener('keydown', onKey);
    });
    app.replaceChildren(scene);
  } catch {
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
