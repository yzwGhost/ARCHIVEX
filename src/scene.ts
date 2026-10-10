import { layoutFiles } from './layout.ts';
import type { ArchiveEntry } from './types.ts';

function textElement(tag: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function renderScene(entries: ArchiveEntry[], onOpen: (entry: ArchiveEntry, trigger: HTMLButtonElement) => void): HTMLElement {
  const scene = document.createElement('section');
  scene.className = 'archive-scene';
  scene.setAttribute('aria-label', '研究档案序列');
  const header = document.createElement('header');
  header.className = 'archive-brand';
  header.append(textElement('h1', '', 'RHINE LAB'), textElement('p', '', 'RESEARCH ARCHIVE'), textElement('span', 'brand-caption', '莱茵生命 / 本地研究档案'));
  scene.append(header);
  const ornament = document.createElement('div');
  ornament.className = 'orbit';
  ornament.setAttribute('aria-hidden', 'true');
  scene.append(ornament);

  if (!entries.length) {
    const empty = textElement('div', 'archive-empty', '将文件放入 documents/');
    empty.append(textElement('p', '', '支持 Markdown、Word 与 PDF · 添加后重新启动开发服务或重新构建'));
    scene.append(empty);
    return scene;
  }

  const viewport = document.createElement('div');
  viewport.className = 'archive-viewport';
  const row = document.createElement('div');
  row.className = 'archive-row';
  row.style.width = `${Math.max(520, (entries.length - 1) * 76 + 320)}px`;
  const detail = document.createElement('aside');
  detail.className = 'file-detail';
  detail.hidden = true;
  detail.setAttribute('aria-live', 'polite');
  const positions = layoutFiles(entries.length);

  entries.forEach((entry, index) => {
    const position = positions[index];
    const slot = document.createElement('div');
    slot.className = 'file-position';
    slot.style.transform = `translate3d(${position.x}px, 0, ${position.z}px)`;
    slot.style.setProperty('--wave-delay', `${position.delayMs}ms`);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `archive-file file-${entry.type}`;
    button.dataset.entryId = entry.id;
    button.setAttribute('aria-label', `${entry.title}，${entry.type.toUpperCase()}，打开档案`);
    button.append(textElement('span', 'file-number', String(index + 1).padStart(2, '0')), textElement('span', 'file-title', entry.title), textElement('span', 'file-type', entry.type.toUpperCase()), textElement('span', 'file-mark', 'RH / RESEARCH'));
    const showDetail = () => {
      detail.replaceChildren(textElement('span', 'detail-index', `ARCHIVE / ${String(index + 1).padStart(2, '0')}`), textElement('h2', '', entry.title), textElement('p', 'detail-meta', `${entry.date} · ${entry.type.toUpperCase()}${entry.category ? ` · ${entry.category}` : ''}`), textElement('p', 'detail-summary', entry.summary));
      detail.hidden = false;
    };
    button.addEventListener('pointerenter', showDetail);
    button.addEventListener('focus', showDetail);
    button.addEventListener('pointerleave', () => { if (document.activeElement !== button) detail.hidden = true; });
    button.addEventListener('blur', () => { detail.hidden = true; });
    button.addEventListener('click', () => onOpen(entry, button));
    button.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!event.repeat) onOpen(entry, button);
      }
    });
    slot.append(button);
    row.append(slot);
  });
  viewport.append(row);
  scene.append(viewport, detail, textElement('footer', 'archive-footer', `${String(entries.length).padStart(2, '0')} DOCUMENTS / 悬停查看 · 点击或按 Enter 阅读 · 横向滚动浏览`));
  return scene;
}
