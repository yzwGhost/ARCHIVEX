# 视频档案场景与本地上传分类整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将提交 `376b7d843e5290d0ef39441b16a93e67c53fa205` 的三维档案体验与当前本地上传、持久分类合为一个可用页面。

**Architecture:** 先在整合分支引入三维场景模块而不替换现有页面，保持基线可测试；再让新场景区分完整清单和可见集合；随后切换页面入口并接入上传刷新。最后合入原视频分支的历史，解决文档、测试和依赖冲突，以完整测试及浏览器验收确认语义整合。

**Tech Stack:** Vite 7、TypeScript、Three.js、Busboy、Node 内置测试、JSDOM、Playwright CLI。

**Spec:** `docs/superpowers/specs/2026-10-12-video-upload-integration-design.md`

## Global Constraints

- 以 `376b7d8` 的三维阵列、动画、详情、检索、收藏、检视与简洁视图为主体；保留当前上传 API 和文档转换。
- 上传仅在 `127.0.0.1` 本机开发/预览服务可用；静态部署只浏览。格式限 `.md`、`.docx`、`.pdf`、`.doc`，单文件上限 50 MiB。
- 用户源文件只在 `documents/`，分类在同名 `.meta.json`；不得覆盖或删除现有源文件。
- 分类选项来自完整清单；场景只渲染可见条目，目录检索和收藏面向完整清单，档案编号按完整清单顺序稳定计算。
- 按稳定 `ArchiveEntry.id` 恢复选择与收藏；分类消失切回“全部”；上传中关闭面板不得替换后来打开的阅读器。
- 每次替换场景都调用 `dispose()`，释放 WebGL、动画和监听器；WebGL 失败时仍可筛选、上传、阅读和下载。

## Review Focus

1. 从目录打开当前全局分类以外的档案：Task 2 测试要求切换筛选后按 ID 打开正确档案，编号不变。
2. 空目录、筛选后空结果和仅有未分类档案：Task 2 测试要求上传入口或返回“全部”始终可达。
3. 上传完成、面板关闭与阅读器打开交错：Task 3 测试要求阅读器不被迟到刷新替换，场景不会残留 `inert`。
4. 多次分类切换和 WebGL 上下文丢失：Task 3 测试要求旧场景释放，简洁视图和键盘入口继续可用。
5. 依赖锁文件或静态部署错误显示上传：Task 4 的干净安装、构建和浏览器测试要求 `three`/`busboy` 共存且静态页无上传入口。

## File Map

- `src/archive-state.ts`、`src/scene/*`、`src/layout.ts`：视频版状态、模型、动画与渲染；临时 `src/video-scene.ts`、`src/video-layout.ts` 让旧页面在准备阶段保持可用，切换后移除临时命名。
- `src/scene.ts`：最终三维页面、简洁列表、全局分类控件、完整目录与上传入口。
- `src/main.ts`：完整清单、全局分类、选中 ID、上传能力、阅读器及刷新生命周期。
- `src/categories.ts`、`src/upload.ts`：沿用分类规则和上传面板行为。
- `src/reader.ts`、`src/style.css`、`README.md`：合并新版阅读布局、视觉样式和使用说明。
- `package.json`、`package-lock.json`：同时包含 `three`、`@types/three` 和 `busboy`。
- `tests/archive-state.test.ts`、`tests/archive-wave.test.ts`、`tests/layout.test.ts`、`tests/ui.test.ts`、`tests/local-upload.test.mjs`：两边行为与整合回归。

---

### Task 1: 独立接入视频场景核心

**Files:** Create `src/archive-state.ts`, `src/video-scene.ts`, `src/video-layout.ts`, `src/scene/ArchiveContactPass.ts`, `src/scene/ArchiveModel.ts`, `src/scene/ArchiveMotion.ts`, `src/scene/ArchiveWave.ts`, `src/scene/ArchiveWorld.ts`, `tests/archive-state.test.ts`, `tests/archive-wave.test.ts`, `tests/video-scene.test.ts`; Modify `package.json`, `package-lock.json`.

**Interfaces:** `renderVideoScene(entries: ArchiveEntry[], onRead: (entry: ArchiveEntry, trigger: HTMLButtonElement) => void): ArchiveSceneElement` 先复用视频分支 `renderScene` 的两参数行为；`ArchiveSceneElement` 提供 `state: ArchiveState`、`dispose()`、`setReading(boolean)`。`ArchiveWorld` 暂从 `video-layout.ts` 获取布局；现有 `src/scene.ts` 与 `src/main.ts` 在本任务不切换。

- [ ] **Step 0: 建立隔离与基线。** 按 `superpowers:using-git-worktrees` 在当前 `main` 创建整合分支/工作区，确认 `git status --short` 为空并运行 `npm test`；预期原有测试全通过。
- [ ] **Step 1: 写失败测试。** 从视频分支移入 `ArchiveState`、波动和纯场景测试到上述测试文件；`test('video scene opens the selected real file')` 断言第一次激活仍为 `overview`、第二次为 `detail`、阅读回调收到对应 `entry.id`；`test('video scene disposes listeners')` 断言 `dispose()` 后按钮与键盘不再改变状态。不移入依赖新版 `main.ts` 的测试。
- [ ] **Step 2: 验证 RED。** 运行 `node --test tests/archive-state.test.ts tests/archive-wave.test.ts tests/video-scene.test.ts`，预期缺少新模块而失败。
- [ ] **Step 3: 接入核心。** 从 `376b7d8` 引入模型、动画、状态和场景；把视频版 `layout.ts` 暂命名为 `video-layout.ts`，把 `renderScene` 导出暂命名为 `renderVideoScene`，加入 `three`、`@types/three`；保持旧页面运行。
- [ ] **Step 4: 验证 GREEN。** 上述定向测试、`npm test`、`npx tsc --noEmit` 均通过；提交 `feat: stage video archive scene core`。

### Task 2: 在新场景中整合完整清单与分类

**Files:** Modify `src/archive-state.ts`, `src/video-scene.ts`, `src/scene/ArchiveWorld.ts`, `src/categories.ts`, `tests/archive-state.test.ts`, `tests/video-scene.test.ts`.

**Interfaces:** 扩展 `ArchiveState(entries: ArchiveEntry[], storage?: ArchiveStorage, options?: { allEntries?: ArchiveEntry[]; selectedId?: string })`：`entries` 是可见集合，`allEntries` 默认等于 `entries`；`entry`、`selected` 和三维命中索引用可见集合，收藏校验和目录检索用完整集合；新增 `codeFor(entry: ArchiveEntry): string` 按完整清单顺序返回 `X-001` 格式编号。扩展 `renderVideoScene(visibleEntries, onRead, controls?)`，其中 `controls` 含 `{ allEntries, category, categories, selectedId, onCategoryChange, onLocate, onSelectionChange, onUpload? }`；`onLocate(id: string)` 由页面入口切换筛选并定位，`onSelectionChange(id: string)` 保存当前选择。

- [ ] **Step 1: 写失败测试。** `test('filtered world keeps full archive identity')` 断言 `scene.state.entries.map(e => e.id)` 仅含可见 ID，而 `codeFor`、目录搜索和收藏仍覆盖完整清单；`test('directory locates a hidden category')` 断言回调收到原始 ID；`test('empty category keeps controls')` 断言“查看全部”和上传按钮可激活。
- [ ] **Step 2: 验证 RED。** 运行 `node --test tests/archive-state.test.ts tests/video-scene.test.ts`，预期新增断言失败。
- [ ] **Step 3: 实现状态与控件。** 用 `categoryOptions`/`filterEntries` 保持当前分类语义；状态分离完整/可见条目；场景工具栏加入分类与本机上传回调，目录继续检索完整清单，WebGL 只接收可见条目；旧两参数调用保持可用。
- [ ] **Step 4: 验证 GREEN。** 定向测试、`npm test`、`npx tsc --noEmit` 通过；提交 `feat: add global categories to video scene`。

### Task 3: 切换页面并协调上传、阅读和资源生命周期

**Files:** Replace `src/scene.ts` with integrated `src/video-scene.ts`; Replace `src/layout.ts` with `src/video-layout.ts`; Remove both temporary files; Modify `src/main.ts`, `src/reader.ts`, `src/style.css`, `src/scene/ArchiveWorld.ts`, `tests/ui.test.ts`, `tests/layout.test.ts`, `tests/video-scene.test.ts`.

**Interfaces:** `renderScene(...)` 为 Task 2 的场景接口；`startArchive(app: HTMLElement): Promise<void>` 继续作为入口。页面状态保存 `{ generation, category, selectedId, uploadPanel, dispose }`；上传完成后重新读清单、恢复当前分类/ID，只有仍连接的上传面板才保持新场景 `inert`。

- [ ] **Step 1: 写失败测试。** `test('upload refresh preserves category and selected id')` 断言刷新后筛选值和 `state.entry.id`；`test('closing upload cannot replace a later reader')` 断言阅读器仍连接且场景最终无残留 `inert`；`test('static and fallback controls stay usable')` 断言静态页无上传入口、WebGL 回退后分类和本机上传可点；`test('reload disposes the previous scene')` 断言旧 `dispose()` 调用一次。保留视频分支阅读器和键盘焦点测试。
- [ ] **Step 2: 验证 RED。** 运行 `node --test tests/ui.test.ts`，预期整合行为断言失败。
- [ ] **Step 3: 切换入口。** 将新场景移到 `src/scene.ts`，重命名布局，合并视频版样式和阅读焦点行为；`main.ts` 维护完整清单及生命周期，在可应用新响应时才释放旧场景，上传面板关闭后忽略该面板的后续完成回调。
- [ ] **Step 4: 验证 GREEN。** `npm test`、`npm run build`、`git diff --check` 通过；提交 `feat: combine video archive with local upload`。

### Task 4: 合入分支历史并完成真实环境验收

**Files:** Merge commit `376b7d8`; Modify `README.md`, `package.json`, `package-lock.json`, `tests/ui.test.ts` and any conflict files only as required by semantic merge.

**Interfaces:** 不新增产品 API。保留当前上传服务器实现和 Task 3 的整合界面；保留视频分支的设计资料、动画实现及相关测试。合并提交的第二父提交应包含 `376b7d8`，不得用 `-s ours` 代替代码整合。

- [ ] **Step 1: 预检并合并。** 确认工作区干净、当前 `main` 与 `376b7d8` 的共同祖先；在整合分支执行 `git merge --no-commit --no-ff 376b7d8`。解决 `README.md`、依赖锁文件、`tests/ui.test.ts` 等冲突，核对自动合并的入口与场景代码没有回退 Task 3 行为。
- [ ] **Step 2: 验证合并结果。** `npm ci`、`npm test`、`npm run build`、`git diff --check` 通过；锁文件同时包含 `three`、`@types/three`、`busboy`，所有现有文档仍在 `documents/`。
- [ ] **Step 3: 浏览器验收。** 在本机开发服务检查 1920×1080 与窄窗口的阵列、动画、详情、目录/收藏和检视；上传一份仅用于验收的 Markdown，验证分类、预览、下载与即时刷新，再只移除该临时文档及 sidecar。以纯静态预览确认上传入口隐藏，WebGL 失败时检查简洁列表。
- [ ] **Step 4: 更新说明并提交。** `README.md` 同时说明三维操作与本机上传边界；提交合并结果，确认 `git merge-base --is-ancestor 376b7d8 HEAD`、`git status -sb`，再做整条分支独立审查。
