import { renderScene } from './scene';
import type { ArchiveManifest } from './types';
import './style.css';

const app = document.querySelector<HTMLElement>('#app')!;
async function start() {
  try {
    const response = await fetch('/archive/manifest.json');
    if (!response.ok) throw new Error('manifest');
    const manifest: ArchiveManifest = await response.json();
    app.replaceChildren(renderScene(manifest.entries, (entry, trigger) => {
      app.dispatchEvent(new CustomEvent('archive:open', { detail: { entry, trigger } }));
    }));
  } catch {
    const message = document.createElement('p');
    message.className = 'archive-empty';
    message.textContent = '档案目录读取失败。请重新启动开发服务或重新构建后刷新页面。';
    app.replaceChildren(message);
  }
}
void start();
