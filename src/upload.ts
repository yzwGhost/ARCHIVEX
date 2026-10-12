import { icon, setIconLabel } from './icons.ts';

interface UploadPanelOptions {
  categories: string[];
  onClose: () => void;
  onComplete: () => void | Promise<void>;
}

export function renderUploadPanel({ categories, onClose, onComplete }: UploadPanelOptions): HTMLElement {
  const panel = document.createElement('section');
  let closed = false;
  const closePanel = () => {
    if (closed) return;
    closed = true;
    onClose();
  };
  panel.className = 'upload-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '上传档案');
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closePanel(); }
  });
  const heading = document.createElement('h2');
  heading.textContent = '上传档案';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'button is-ghost upload-close';
  setIconLabel(close, 'close', '关闭');
  close.addEventListener('click', closePanel);
  const fileLabel = document.createElement('label');
  fileLabel.textContent = '选择本地文件';
  const files = document.createElement('input');
  files.type = 'file';
  files.multiple = true;
  files.accept = '.md,.docx,.pdf,.doc';
  files.className = 'upload-file';
  fileLabel.append(files);
  const categoryLabel = document.createElement('label');
  categoryLabel.textContent = '分类';
  const category = document.createElement('select');
  category.className = 'upload-category';
  for (const name of ['', ...categories.filter(name => name !== '未分类')]) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name || '未分类';
    category.append(option);
  }
  const categoryFrame = document.createElement('span');
  categoryFrame.className = 'select upload-select';
  categoryFrame.append(category, icon('chevron-down'));
  categoryLabel.append(categoryFrame);
  const newCategoryLabel = document.createElement('label');
  newCategoryLabel.textContent = '或填写新分类';
  const newCategory = document.createElement('input');
  newCategory.type = 'text';
  newCategory.className = 'input upload-new-category';
  newCategory.maxLength = 60;
  newCategoryLabel.append(newCategory);
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'button is-outlined upload-submit';
  setIconLabel(submit, 'upload', '开始上传');
  const status = document.createElement('p');
  status.className = 'upload-status';
  status.setAttribute('role', 'status');
  const results = document.createElement('ul');
  results.className = 'upload-results';
  submit.addEventListener('click', () => {
    if (submit.disabled) return;
    const selected = Array.from(files.files ?? []);
    if (!selected.length) { status.textContent = '请先选择文件。'; return; }
    const selectedCategory = (newCategory.value.trim() || category.value).trim();
    if (selectedCategory.length > 60) { status.textContent = '分类不能超过 60 字。'; return; }
    submit.disabled = true;
    results.replaceChildren();
    status.textContent = `正在上传 ${selected.length} 份档案…`;
    void (async () => {
      let succeeded = 0;
      for (const file of selected) {
        if (closed) break;
        const item = document.createElement('li');
        item.textContent = `${file.name} · 上传中`;
        results.append(item);
        try {
          const body = new FormData();
          body.append('file', file, file.name);
          body.append('category', selectedCategory);
          const response = await fetch('/api/uploads', { method: 'POST', body });
          const result: { message?: string; entry?: unknown; warnings?: string[] } = await response.json();
          if (!response.ok) throw new Error(result.message || '上传失败。');
          succeeded++;
          item.textContent = `${file.name} · 已上传${result.warnings?.length ? '（预览有提示）' : ''}`;
        } catch (error) {
          item.textContent = `${file.name} · ${error instanceof Error ? error.message : '上传失败。'}`;
        }
      }
      status.textContent = `完成：${succeeded} / ${selected.length} 份上传成功。`;
      submit.disabled = false;
      if (!closed) await onComplete();
    })();
  });
  panel.append(heading, close, fileLabel, categoryLabel, newCategoryLabel, submit, status, results);
  return panel;
}
