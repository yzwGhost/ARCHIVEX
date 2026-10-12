import { ArchiveState, searchEntries } from './archive-state.ts';
import { categoryOptions } from './categories.ts';
import { hydrateIcons, setIconLabel, icon } from './icons.ts';
import type { ArchiveEntry } from './types.ts';
import type { ArchiveWorld } from './scene/ArchiveWorld.ts';

export interface ArchiveSceneElement extends HTMLElement {
  state: ArchiveState;
  dispose(): void;
  setReading(value: boolean): void;
}
const pad = (value: number) => String(value).padStart(2, '0');
interface SceneControls {
  allEntries: ArchiveEntry[];
  category: string;
  categories: string[];
  selectedId: string;
  onCategoryChange: (category: string) => void;
  onLocate: (id: string) => void;
  onSelectionChange: (id: string) => void;
  onUpload?: () => void;
}

export function renderScene(entries: ArchiveEntry[], onRead: (entry: ArchiveEntry, trigger: HTMLButtonElement) => void, controls?: SceneControls): ArchiveSceneElement {
  const root = document.createElement('section') as ArchiveSceneElement;
  root.className = 'archive-scene'; root.setAttribute('aria-label', '莱茵生命研究档案');
  let storage: Storage | undefined;
  try { storage = document.defaultView?.localStorage; } catch { /* Session-only favorites remain available. */ }
  const state = new ArchiveState(entries, storage, { allEntries: controls?.allEntries, selectedId: controls?.selectedId }); root.state = state;
  let world: ArchiveWorld | undefined, disposed = false, directory: HTMLElement | null = null;
  let restoreFocus: HTMLElement | null = null, lastOverlay: string | null = null;
  let introTimer: ReturnType<typeof setTimeout> | undefined;
  let previousMode = state.mode;
  let overviewFocus: HTMLElement | null = null;
  let reportedId = state.entry?.id;
  const addControls = (container: Element) => {
    if (!controls) return;
    const label = document.createElement('label');
    label.className = 'scene-category-label';
    label.textContent = '分类 ';
    const select = document.createElement('select');
    select.className = 'category-select';
    select.setAttribute('aria-label', '按分类筛选档案');
    for (const category of ['', ...controls.categories]) {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category || '全部';
      select.append(option);
    }
    select.value = controls.category;
    select.addEventListener('change', () => controls.onCategoryChange(select.value));
    const selectFrame = document.createElement('span');
    selectFrame.className = 'select archive-select';
    selectFrame.append(select, icon('chevron-down'));
    label.append(selectFrame);
    container.append(label);
    if (controls.onUpload) {
      const upload = document.createElement('button');
      upload.type = 'button';
      upload.className = 'button is-outlined upload-trigger';
      setIconLabel(upload, 'upload', '上传档案');
      upload.addEventListener('click', controls.onUpload);
      container.append(upload);
    }
  };
  root.dispose = () => { disposed = true; world?.dispose(); clearTimeout(introTimer); document.removeEventListener('keydown', onKey); unsubscribe(); };
  root.setReading = value => { state.reading = value; state.notify(); };
  const unsubscribe = state.subscribe(update);
  if (!entries.length) {
    root.innerHTML = '<header class="archive-brand"><h1>RHINE LAB</h1><p>ANALYSIS OS</p></header>';
    const actions = document.createElement('nav');
    actions.className = 'archive-toolbar';
    addControls(actions);
    root.append(actions);
    const empty = document.createElement('div');
    empty.className = 'archive-empty';
    empty.textContent = controls?.category ? '该分类暂无档案' : '将文件放入 documents/';
    if (controls?.category) {
      const showAll = document.createElement('button');
      showAll.type = 'button';
      showAll.className = 'button is-outlined show-all';
      showAll.textContent = '查看全部';
      showAll.addEventListener('click', () => controls.onCategoryChange(''));
      empty.append(document.createElement('br'), showAll);
    } else {
      const hint = document.createElement('p');
      hint.textContent = '支持 Markdown、Word 与 PDF · 添加后重新启动开发服务或重新构建';
      empty.append(hint);
    }
    root.append(empty);
    return root;
  }
  root.innerHTML = `
    <div class="archive-world"></div><div class="scene-vignette" aria-hidden="true"></div>
    <div class="archive-interface">
      <header class="archive-brand"><h1>RHINE LAB</h1><p>SYNTHESIZE INFORMATION</p><div>ANALYSIS <strong>OS</strong></div></header>
      <nav class="archive-toolbar" aria-label="档案工具"><button class="button is-ghost" data-action="index"><span data-icon="search"></span> ARCHIVE INDEX <kbd>/</kbd></button><button class="button is-ghost" data-action="saved"><span data-icon="plus"></span> SAVED <span data-field="saved-count">00</span></button><button class="button is-ghost" data-action="replay" aria-label="重播开场动画" title="重播开场动画"><span data-icon="replay"></span></button></nav>
      <button class="button is-ghost archive-back" data-action="back"><span data-icon="arrow-left"></span><span>返回档案阵列</span><kbd>ESC</kbd></button>
      <aside class="file-detail">
        <p class="eyebrow">INTERNAL DATABASE <i>/</i> <span data-field="category"></span></p>
        <h2>FILE NUMBER: <span data-field="code"></span></h2>
        <div class="detail-rule"><span data-field="title"></span><small>REFERENCE AREA</small></div>
        <p class="overview-summary" data-field="summary"></p>
        <button class="button is-ghost access-file" data-action="open">ACCESS FILE <span data-icon="arrow-right"></span></button>
      </aside>
      <section class="document-detail" aria-label="档案详情">
        <p class="eyebrow">INTERNAL DATABASE / RECORD DETAIL</p>
        <h2 data-field="code"></h2><h3 data-field="title"></h3>
        <dl class="record-meta"><div><dt>ARCHIVE DATE</dt><dd data-field="date"></dd></div><div><dt>FILE FORMAT</dt><dd data-field="type"></dd></div><div><dt>CATEGORY</dt><dd data-field="category"></dd></div><div><dt>STATUS</dt><dd>已归档 / ARCHIVED</dd></div></dl>
        <div class="record-overview"><p class="eyebrow">01 / OVERVIEW</p><p data-field="summary"></p></div>
        <button class="button is-ghost read-document" data-action="read">阅读档案正文 <span data-icon="arrow-up-right"></span></button>
        <div class="detail-actions"><button class="button is-ghost" data-action="save"><span data-icon="plus"></span>收藏档案</button><button class="button is-ghost" data-action="inspect"><span data-icon="inspect"></span>360° 检视</button><a data-field="download" download><span data-icon="download"></span>下载原文件</a></div>
        <p class="save-status" role="status"></p>
      </section>
      <section class="inspection-label" aria-label="三维检视"><p class="eyebrow">ARCHIVE OBJECT / 360° VIEW</p><h2 data-field="code"></h2><p data-field="title"></p><span>拖动旋转 · 滚轮缩放</span></section>
      <aside class="assembly-legend"><p class="eyebrow">STRUCTURE ANALYSIS</p><ol><li>透明防护封面</li><li>固定件 / 金属铆钉</li><li>内部资料层</li><li>档案背板</li></ol></aside>
      <div class="inspection-controls"><button class="button is-ghost" data-action="explode"><span data-icon="expand"></span>展开档案结构</button><button class="button is-ghost" data-action="reset"><span data-icon="replay"></span>重置视角</button></div>
      <footer class="archive-footer">
        <div class="file-counter"><small>ARCHIVE / SELECT</small><div><strong data-field="position"></strong><i>/</i><span data-field="group-length"></span></div></div>
        <nav class="file-navigation" aria-label="组内档案"><button class="button is-ghost" data-action="previous-file" aria-label="上一份档案"><span data-icon="arrow-up"></span></button><div class="file-ticks"></div><button class="button is-ghost" data-action="next-file" aria-label="下一份档案"><span data-icon="arrow-down"></span></button></nav>
        <nav class="group-navigation" aria-label="档案分组"><button class="button is-ghost" data-action="previous-group" aria-label="上一组档案"><span data-icon="arrow-left"></span></button><div><small data-field="group"></small><span data-field="category"></span></div><button class="button is-ghost" data-action="next-group" aria-label="下一组档案"><span data-icon="arrow-right"></span></button></nav>
        <div class="powered">POWERED BY <strong>RHINE LAB</strong><b>━</b></div>
      </footer>
    </div>
    <div class="fallback-files"><p>档案列表 · 当前设备使用简洁视图</p><div class="file-list"></div></div>
    <div class="intro-overlay" hidden><div class="intro-mark" aria-hidden="true">∞</div><p>RHINE LAB <span>/</span> ARCHIVE SYSTEM</p><div class="intro-line"></div><button class="button is-ghost" data-action="skip">跳过开场 <span data-icon="arrow-right"></span></button></div>`;
  hydrateIcons(root);
  addControls(root.querySelector('.archive-toolbar')!);
  const ui = root.querySelector<HTMLElement>('.archive-interface')!;
  const worldContainer = root.querySelector<HTMLElement>('.archive-world')!;
  const field = (name: string, text: string) => root.querySelectorAll<HTMLElement>(`[data-field="${name}"]`).forEach(el => { el.textContent = text; });
  const action = (name: string) => root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
  const intro = root.querySelector<HTMLElement>('.intro-overlay')!;
  const endIntro = () => { intro.hidden = true; root.classList.remove('is-intro'); clearTimeout(introTimer); };
  const replay = () => {
    if (state.mode !== 'overview' || state.overlay) return;
    intro.hidden = false; root.classList.add('is-intro'); world?.replayIntro();
    clearTimeout(introTimer); introTimer = setTimeout(endIntro, 3800);
  };
  const fileList = root.querySelector('.file-list')!;
  entries.forEach((entry, index) => {
    const button = document.createElement('button'); button.className = 'button is-ghost archive-file'; button.dataset.entryId = entry.id;
    button.textContent = `${state.codeFor(entry)}  /  ${entry.title}  ·  ${entry.type.toUpperCase()}`;
    button.addEventListener('click', () => { if (!disposed) state.open(index); }); fileList.append(button);
  });
  const operations: Record<string, () => void> = {
    index: () => state.setOverlay('index'), saved: () => state.setOverlay('saved'),
    open: () => state.open(), back: () => state.back(), inspect: () => state.inspect(),
    save: () => state.toggleSaved(), explode: () => state.toggleExploded(), reset: () => world?.resetView(),
    read: () => { if (!disposed && !state.reading) onRead(state.entry, action('read')); },
    'previous-file': () => state.stepFile(-1), 'next-file': () => state.stepFile(1),
    'previous-group': () => state.stepGroup(-1), 'next-group': () => state.stepGroup(1),
    replay, skip: () => { world?.skipIntro(); endIntro(); },
  };
  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => { if (!disposed) operations[button.dataset.action!](); }));
  function closeDirectory() {
    const outgoing = directory;
    if (outgoing && typeof outgoing.animate === 'function') {
      outgoing.setAttribute('inert', ''); outgoing.setAttribute('aria-hidden', 'true'); outgoing.style.pointerEvents = 'none';
      outgoing.animate([{opacity: 1}, {opacity: 0}], {duration: 220, fill: 'forwards'}).finished.then(() => outgoing.remove()).catch(() => outgoing.remove());
    } else outgoing?.remove();
    directory = null; ui.removeAttribute('inert'); worldContainer.removeAttribute('inert');
    root.querySelector('.fallback-files')?.removeAttribute('inert');
    if (restoreFocus?.isConnected) restoreFocus.focus(); restoreFocus = null;
  }
  function showDirectory() {
    restoreFocus = document.activeElement as HTMLElement;
    directory = document.createElement('section'); directory.className = 'archive-directory';
    directory.setAttribute('role', 'dialog'); directory.setAttribute('aria-modal', 'true'); directory.setAttribute('aria-label', state.overlay === 'saved' ? '已收藏档案' : '档案目录');
    directory.innerHTML = '<div class="directory-paper"><header><div><p class="eyebrow">RHINE LAB / ARCHIVE SYSTEM</p><h2></h2></div><button class="button is-ghost directory-close" aria-label="关闭目录"><span data-icon="close"></span></button></header><label class="search-label">搜索档案编号、标题或摘要<input class="input directory-search" placeholder="SEARCH / 输入档案编号或关键词" type="search"></label><div class="directory-filters"></div><p class="directory-count" role="status"></p><div class="directory-results"></div><footer>INTERNAL DATABASE <span>ESC / CLOSE</span></footer></div>';
    hydrateIcons(directory);
    directory.querySelector('h2')!.textContent = state.overlay === 'saved' ? 'SAVED ARCHIVES' : 'ARCHIVE INDEX';
    let category = '';
    const input = directory.querySelector<HTMLInputElement>('input')!;
    const results = directory.querySelector('.directory-results')!;
    const refresh = () => {
      const matches = searchEntries(state.allEntries, input.value, category).filter(entry => state.overlay !== 'saved' || state.saved.has(entry.id));
      results.replaceChildren();
      directory!.querySelector('.directory-count')!.textContent = `${pad(matches.length)} RECORDS / ${state.overlay === 'saved' ? '已收藏' : '检索结果'}`;
      if (!matches.length) { const p = document.createElement('p'); p.className = 'directory-empty'; p.textContent = state.overlay === 'saved' && !input.value ? '暂无收藏，打开档案后点击“收藏档案”。' : '未找到匹配档案，请尝试其他关键词。'; results.append(p); }
      matches.forEach(entry => {
        const index = entries.findIndex(item => item.id === entry.id), button = document.createElement('button'); button.className = 'button is-ghost directory-result';
        const code = document.createElement('span'); code.textContent = state.codeFor(entry);
        const title = document.createElement('strong'); title.textContent = entry.title;
        const meta = document.createElement('small'); meta.textContent = `${entry.type.toUpperCase()} / ${entry.date?.slice(0, 10) || '—'}`;
        button.append(code, title, meta, icon('arrow-up-right'));
        button.addEventListener('click', () => { if (index >= 0) state.open(index); else controls?.onLocate(entry.id); }); results.append(button);
      });
    };
    const filters = directory.querySelector('.directory-filters')!;
    ['', ...categoryOptions(state.allEntries)].forEach(value => {
      const button = document.createElement('button'); button.className = 'button is-ghost'; button.textContent = value || '全部'; button.setAttribute('aria-pressed', String(!value));
      button.addEventListener('click', () => { category = value; filters.querySelectorAll('button').forEach(el => el.setAttribute('aria-pressed', String(el === button))); refresh(); }); filters.append(button);
    });
    input.addEventListener('input', refresh); directory.querySelector('button')!.addEventListener('click', () => state.setOverlay(null));
    directory.addEventListener('click', event => { if (event.target === directory) state.setOverlay(null); });
    ui.setAttribute('inert', ''); worldContainer.setAttribute('inert', ''); root.querySelector('.fallback-files')?.setAttribute('inert', '');
    root.append(directory); refresh(); input.focus();
  }
  function update() {
    if (disposed || !entries.length) return;
    if (state.entry.id !== reportedId) { reportedId = state.entry.id; controls?.onSelectionChange(reportedId); }
    const changedMode = previousMode !== state.mode;
    if (changedMode && previousMode === 'overview') overviewFocus = document.activeElement as HTMLElement;
    root.dataset.mode = state.mode; root.classList.toggle('has-directory', Boolean(state.overlay));
    field('code', state.codeFor(state.entry)); field('title', state.entry.title); field('category', state.entry.category || '未分类');
    field('date', state.entry.date?.slice(0, 10) || '—'); field('type', state.entry.type.toUpperCase()); field('summary', state.entry.summary || '此档案暂无摘要，打开正文查看完整资料。');
    field('saved-count', pad(state.saved.size)); field('position', pad(state.selected % 8 + 1)); field('group-length', pad(state.groupLength));
    field('group', `COLUMN ${pad(state.group + 1)} / ${pad(state.groupCount)}`);
    const download = root.querySelector<HTMLAnchorElement>('[data-field=download]')!; download.href = state.entry.sourceUrl; download.download = state.entry.relativePath.split('/').pop()!;
    setIconLabel(action('save'), state.saved.has(state.entry.id) ? 'check' : 'plus', state.saved.has(state.entry.id) ? '已收藏' : '收藏档案'); action('save').setAttribute('aria-pressed', String(state.saved.has(state.entry.id)));
    root.querySelector('.save-status')!.textContent = !state.storageAvailable && state.saved.size ? '收藏保留在本次会话中（浏览器存储不可用）' : '';
    setIconLabel(action('explode'), state.exploded ? 'shrink' : 'expand', state.exploded ? '收合档案结构' : '展开档案结构'); action('explode').setAttribute('aria-pressed', String(state.exploded));
    action('back').querySelector('span')!.textContent = state.mode === 'inspect' ? '返回档案详情' : '返回档案阵列';
    const ticks = root.querySelector('.file-ticks')!;
    const tickHadFocus = ticks.contains(document.activeElement);
    if (ticks.children.length !== state.groupLength) {
      ticks.replaceChildren();
      for (let index = 0; index < state.groupLength; index++) {
        const button = document.createElement('button'); button.className = 'button is-ghost'; button.setAttribute('aria-label', `选择本组第 ${index + 1} 份档案`);
        button.addEventListener('click', () => state.select(state.group * 8 + index)); ticks.append(button);
      }
    }
    Array.from(ticks.children).forEach((button, index) => button.setAttribute('aria-pressed', String(index === state.selected % 8)));
    if (tickHadFocus) (ticks.children[state.selected % 8] as HTMLButtonElement | undefined)?.focus();
    if (lastOverlay !== state.overlay) { closeDirectory(); lastOverlay = state.overlay; if (state.overlay) showDirectory(); }
    world?.update(state);
    if (changedMode) {
      if (state.mode === 'overview') {
        const target = overviewFocus?.isConnected && overviewFocus !== document.body && !overviewFocus.closest('.archive-directory') ? overviewFocus : action('open');
        target.focus(); overviewFocus = null;
      } else action('back').focus();
      previousMode = state.mode;
    }
  }
  function onKey(event: KeyboardEvent) {
    if (disposed || !root.isConnected || root.hasAttribute('inert') || state.reading) return;
    if (event.key === 'Escape') { event.preventDefault(); if (!intro.hidden) operations.skip(); else state.back(); return; }
    if (directory) {
      if (event.key === 'Tab') {
        const items = Array.from(directory.querySelectorAll<HTMLElement>('button,input,a[href]'));
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (!intro.hidden) return;
    const target = event.target as HTMLElement;
    if (target?.matches?.('input,select,textarea,[contenteditable=true]')) return;
    const keys: Record<string, () => void> = {ArrowUp: operations['previous-file'], ArrowDown: operations['next-file'], ArrowLeft: operations['previous-group'], ArrowRight: operations['next-group']};
    if (state.mode === 'overview' && keys[event.key]) { event.preventDefault(); keys[event.key](); }
    if (event.key === '/') { event.preventDefault(); state.setOverlay('index'); }
    if (event.key === 'Enter' && state.mode === 'overview' && !target?.closest?.('button,a')) { event.preventDefault(); state.open(); }
  }
  document.addEventListener('keydown', onKey); update();
  const fallback = () => { if (disposed) return; root.dataset.renderer = 'fallback'; endIntro(); };
  root.dataset.renderer = 'fallback';
  if (document.defaultView && 'WebGL2RenderingContext' in document.defaultView) {
    root.dataset.renderer = 'loading';
    void import('./scene/ArchiveWorld.ts').then(({ ArchiveWorld }) => {
      if (disposed) return;
      world = new ArchiveWorld(worldContainer, entries, {activate: index => state.activate(index), fallback, introEnd: endIntro}, entry => state.codeFor(entry));
      world.update(state); root.dataset.renderer = 'webgl';
      let seen = false; try { seen = document.defaultView!.sessionStorage.getItem('rhine-intro') === '1'; document.defaultView!.sessionStorage.setItem('rhine-intro', '1'); } catch { /* Intro still works without storage. */ }
      if (!seen) replay();
    }).catch(fallback);
  }
  return root;
}
