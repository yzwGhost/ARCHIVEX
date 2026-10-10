import type { ArchiveEntry } from './types.ts';

export function renderReader(entry: ArchiveEntry, onClose: () => void): HTMLElement {
  const reader = document.createElement('section');
  reader.className = 'archive-reader';
  reader.setAttribute('role', 'dialog');
  reader.setAttribute('aria-modal', 'true');
  reader.setAttribute('aria-label', `阅读档案：${entry.title}`);
  const header = document.createElement('header');
  header.className = 'reader-header';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'reader-close';
  close.textContent = '← 返回档案';
  close.addEventListener('click', () => onClose());
  const title = document.createElement('h2');
  title.textContent = entry.title;
  const download = document.createElement('a');
  download.href = entry.sourceUrl;
  download.download = entry.relativePath.split('/').pop() ?? '';
  download.textContent = `下载原文件 · ${entry.type.toUpperCase()}`;
  header.append(close, title, download);
  reader.append(header);
  if (entry.error || entry.type === 'doc' || (entry.type !== 'pdf' && !entry.previewUrl)) {
    const message = document.createElement('p');
    message.className = 'reader-message';
    message.textContent = entry.error ? `预览失败：${entry.error}。可下载原文件查看。` : entry.type === 'doc' ? '旧版 Word（.doc）仅支持下载，请下载原文件查看。' : '此档案暂时没有预览，请下载原文件查看。';
    reader.append(message);
  } else {
    const frame = document.createElement('iframe');
    frame.className = 'reader-frame';
    frame.title = `${entry.title} · 档案正文`;
    if (entry.type === 'pdf') frame.src = entry.sourceUrl;
    if (entry.type !== 'pdf') {
      frame.dataset.previewUrl = entry.previewUrl!;
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.addEventListener('load', () => {
        frame.contentDocument?.addEventListener('keydown', event => {
          if (event.key === 'Escape') onClose();
        });
      });
      const loading = document.createElement('p');
      loading.className = 'reader-message';
      loading.setAttribute('role', 'status');
      loading.textContent = '正在读取预览…';
      reader.append(loading);
      frame.hidden = true;
      void (async () => {
        try {
          const response = await fetch(entry.previewUrl!);
          if (!response.ok) throw new Error('preview');
          const html = await response.text();
          frame.srcdoc = html;
          frame.hidden = false;
          loading.remove();
        } catch {
          frame.remove();
          loading.textContent = '预览读取失败，请下载原文件查看。';
        }
      })();
    }
    reader.append(frame);
  }
  return reader;
}
