import type { ArchiveEntry } from './types.ts';
import { setIconLabel } from './icons.ts';

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
  close.className = 'button is-ghost reader-close';
  setIconLabel(close, 'arrow-left', '返回档案');
  close.addEventListener('click', () => onClose());
  const title = document.createElement('h2');
  title.textContent = entry.title;
  const download = document.createElement('a');
  download.href = entry.sourceUrl;
  download.download = entry.relativePath.split('/').pop() ?? '';
  setIconLabel(download, 'download', `下载原文件 · ${entry.type.toUpperCase()}`);
  header.append(close, title, download);
  reader.append(header);
  if (entry.error || entry.type === 'doc' || (entry.type !== 'pdf' && !entry.previewUrl)) {
    const message = document.createElement('p');
    message.className = 'reader-message';
    message.textContent = entry.error ? `预览失败：${entry.error}。可下载原文件查看。` : entry.type === 'doc' ? '旧版 Word（.doc）仅支持下载，请下载原文件查看。' : '此档案暂时没有预览，请下载原文件查看。';
    reader.append(message);
  } else if (entry.type === 'pdf') {
    const pages = document.createElement('div');
    pages.className = 'reader-pdf';
    pages.tabIndex = 0;
    pages.setAttribute('role', 'region');
    pages.setAttribute('aria-label', `${entry.title} · PDF 正文`);
    pages.addEventListener('click', () => pages.focus());
    const status = document.createElement('p');
    status.className = 'reader-message';
    status.setAttribute('role', 'status');
    status.textContent = '正在读取 PDF…';
    pages.append(status);
    reader.append(pages);
    void (async () => {
      let pdf: import('pdfjs-dist').PDFDocumentProxy | undefined;
      let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
      try {
        const response = await fetch(entry.sourceUrl);
        if (!response.ok) throw new Error('pdf');
        const data = new Uint8Array(await response.arrayBuffer());
        if (!reader.isConnected) return;
        const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
        GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
        task = getDocument({ data });
        pdf = await task.promise;
        for (let number = 1; number <= pdf.numPages; number++) {
          if (!reader.isConnected) return;
          const page = await pdf.getPage(number);
          const canvas = document.createElement('canvas');
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `PDF 第 ${number} 页`);
          const viewport = page.getViewport({ scale: 1.5 });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('canvas');
          await page.render({ canvasContext: context, canvas, viewport }).promise;
          pages.append(canvas);
          page.cleanup();
        }
        status.remove();
      } catch {
        pages.querySelectorAll('canvas').forEach(canvas => canvas.remove());
        status.textContent = 'PDF 预览读取失败，请下载原文件查看。';
      } finally {
        await task?.destroy();
      }
    })();
  } else {
    const frame = document.createElement('iframe');
    frame.className = 'reader-frame';
    frame.title = `${entry.title} · 档案正文`;
    {
      frame.dataset.previewUrl = entry.previewUrl!;
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.addEventListener('load', () => {
        const content = frame.contentDocument;
        if (!content) return;
        const style = content.createElement('style');
        style.textContent = `
          :root{font:15px/1.85 Arial,"Microsoft YaHei",sans-serif;color:#262c23;background:#faf8f2}
          *{box-sizing:border-box}body{max-width:980px;margin:0 auto;padding:42px 45px 90px;overflow-wrap:anywhere}
          h1,h2,h3,h4{line-height:1.5;font-weight:600;margin:1.8em 0 .75em}h1{font-size:28px;margin-top:0}h2{font-size:22px;border-bottom:1px solid #d7d8cc;padding-bottom:12px}h3{font-size:18px}
          p,ul,ol{margin:1em 0}table{border-collapse:collapse;width:100%;margin:24px 0;font-size:13px}th,td{border:1px solid #d8dacd;text-align:left;padding:10px 13px;vertical-align:top}th{background:#eeeee5}
          pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#efeee6;border-left:2px solid #9b9b80;padding:20px;font-size:12px;line-height:1.8}code{font-family:Consolas,monospace;font-size:.9em}img{max-width:100%;height:auto}blockquote{margin:24px 0;padding:5px 24px;border-left:2px solid #a5a68d;color:#626952}a{color:#6e7048}hr{border:0;border-top:1px solid #d7d8cc;margin:30px 0}
          @media(max-width:600px){body{padding:24px 20px 60px;font-size:14px}h1{font-size:24px}h2{font-size:20px}th,td{padding:7px;font-size:11px}}
        `;
        content.head.append(style);
        content.addEventListener('keydown', event => {
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
