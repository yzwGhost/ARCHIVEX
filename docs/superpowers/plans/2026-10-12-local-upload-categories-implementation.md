# 本地上传与分类实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面网页把文档保存到本机 `documents/` 并即时展示，同时支持按现有元数据分类筛选。

**Architecture:** Vite 的开发和预览中间件提供仅限本机的单文件上传 API；源文件与同名元数据写入 `documents/`。档案生成器复用现有转换规则，先生成新文件与预览，再原子替换清单；浏览器读取清单并在单列档案序列中筛选。

**Tech Stack:** Node.js、Vite 7、TypeScript、Busboy、现有 Markdown/DOCX/PDF 转换依赖、Node 内置测试、JSDOM。

**Spec:** `docs/superpowers/specs/2026-10-12-local-upload-categories-design.md`

## Global Constraints

- 只在绑定 `127.0.0.1` 的本机开发与预览服务开放上传；纯静态站点没有上传入口。
- 上传格式仅 `.md`、`.docx`、`.pdf`、`.doc`；单文件上限 50 MiB。
- 原件持久化到 `documents/`，分类持久化到同名 `.meta.json`；`public/archive/` 或 `dist/archive/` 只存生成内容。
- 同名文件及已有同名元数据不能被覆盖；失败须清理本次临时文件。
- 保持现有 `ArchiveEntry`、清单排序、预览/下载行为和单列档案视觉。
- 上传批次逐份处理；某份失败不撤销其他成功文件。

## Review Focus

1. 同目录不同扩展名但同 stem 的文件可能共享 `.meta.json`：Task 2 的冲突测试要求拒绝会改变已有文件分类的上传。
2. 50 MiB 附近的请求体及提前断开的客户端：Task 2 的限额/断流测试要求无源文件和临时文件残留。
3. 预览转换失败的合法文档：Task 1 的测试要求清单仍有可下载原件和错误提示。
4. 上传后当前筛选没有匹配项，或其分类消失：Task 3 的测试要求空结果与回到“全部”的行为明确。
5. 预览服务读取 `dist/archive/`，开发服务读取 `public/archive/`：Task 2 的配置测试要求两种服务更新各自正在提供的清单。

## File Map

- `scripts/build-archive.mjs`：共享单文件转换、上传增量发布及原有完整构建。
- `scripts/local-upload.mjs`：请求校验、Busboy 流处理、源文件提交、上传串行化和 HTTP 结果。
- `vite.config.ts`：在开发和预览服务注册同一上传中间件，分别传入正确输出目录。
- `src/categories.ts`：分类归一化、选项生成、筛选。
- `src/upload.ts`：上传面板、文件状态及逐份提交。
- `src/scene.ts`：分类筛选和上传入口，同时保留档案序列。
- `src/main.ts`：上传能力检测、筛选状态、刷新协调。
- `src/types.ts`：上传能力和结果类型。
- `src/style.css`、`README.md`：控件样式和使用说明。
- `tests/build-archive.test.mjs`、`tests/local-upload.test.mjs`、`tests/ui.test.ts`：行为验证。

---

### Task 1: 复用档案生成并增量发布

**Files:**
- Modify: `scripts/build-archive.mjs`
- Modify: `tests/build-archive.test.mjs`

**Interfaces:**
- Produces: `appendArchiveEntry({ documentsDir, outputDir, relativePath }: { documentsDir: string; outputDir: string; relativePath: string }): Promise<{ entry: ArchiveEntry; warnings: string[] }>`。调用方保证串行；函数将新原件和预览发布到现有输出目录，最后通过临时文件加 rename 更新 `manifest.json`。
- Preserves: `buildArchive({ documentsDir, outputDir })` 的现有签名、排序、URL 和完整构建输出。

- [ ] **Step 1: 写失败测试。** 在 `tests/build-archive.test.mjs` 断言增量加入 Markdown 后原有条目和预览保留、新条目及原件可读、日期/路径排序正确；损坏 DOCX 仍有原件与 `error`；模拟发布失败时正式清单不变。
- [ ] **Step 2: 运行测试并确认失败。** `node --test tests/build-archive.test.mjs`，预期新增测试因缺少 `appendArchiveEntry` 而失败。
- [ ] **Step 3: 提取单文件转换并实现 `appendArchiveEntry`。** 新文件先写入临时生成目录；将生成的原件和预览移入输出目录后，最后替换清单。只清理本次产生的内容；完整构建继续使用现有安全的输出目录检查。
- [ ] **Step 4: 运行测试。** `node --test tests/build-archive.test.mjs` 与 `git diff --check` 均通过。
- [ ] **Step 5: 提交。** `git add scripts/build-archive.mjs tests/build-archive.test.mjs`；`git commit -m "feat: publish uploaded archive entries"`。

### Task 2: 本机上传 API

**Files:**
- Create: `scripts/local-upload.mjs`
- Create: `tests/local-upload.test.mjs`
- Modify: `vite.config.ts`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: Task 1 的 `appendArchiveEntry(...)`。
- Produces: `createUploadMiddleware({ documentsDir, outputDir })`，供 Vite Connect 使用。
- HTTP: `GET /api/upload-capabilities` 返回 `{ enabled: true, maxFileBytes: 52428800 }`；`POST /api/uploads` 接收一个 multipart `file` 和一个 `category`，成功返回 HTTP 201 `{ entry, warnings }`。无分类用空字符串表示；失败返回 `{ code, message }`，分别使用 400、409、413 或 500。

- [ ] **Step 1: 写失败的 HTTP 测试。** 用临时 `documents/` 和输出目录启动 Node HTTP 测试服务，验证能力接口、合法上传、分类 sidecar、即时清单及原件；再验证非法扩展名、路径型文件名、空文件名、非法分类、同名文件、同 stem 冲突、超过 50 MiB、客户端断流、并发重名请求均不覆盖或遗留文件。
- [ ] **Step 2: 运行测试并确认失败。** `node --test tests/local-upload.test.mjs`，预期中间件缺失。
- [ ] **Step 3: 添加 Busboy 并实现中间件。** 使用流式限额、只允许一个文件字段、校验 `Host` 与 `Origin` 为本机同源；临时文件独占创建，提交原件与 sidecar 后调用 `appendArchiveEntry`。冲突时绝不写入；非预览类的提交失败要回滚本次源文件与元数据。预览转换失败按成功档案返回并带警告。上传提交和清单更新使用进程内队列串行化。
- [ ] **Step 4: 注册 Vite 插件。** `configureServer` 传 `public/archive/`，`configurePreviewServer` 传 `dist/archive/`；两者都只在本机地址下提供接口。测试分别用这两个输出目录发布并读取清单。
- [ ] **Step 5: 运行验证。** `node --test tests/local-upload.test.mjs`、`npm test`、`git diff --check` 通过。
- [ ] **Step 6: 提交。** `git add scripts/local-upload.mjs tests/local-upload.test.mjs vite.config.ts package.json package-lock.json`；`git commit -m "feat: add local document upload API"`。

### Task 3: 分类筛选

**Files:**
- Create: `src/categories.ts`
- Modify: `src/scene.ts`, `src/main.ts`, `src/style.css`
- Modify: `tests/ui.test.ts`

**Interfaces:**
- Produces: `categoryOptions(entries: ArchiveEntry[]): string[]` 与 `filterEntries(entries: ArchiveEntry[], category: string): ArchiveEntry[]`；`category` 的空字符串表示“全部”，`未分类` 表示未分类条目。
- `renderScene(entries, onOpen, controls?)` 增加可选的 `{ category, categories, onCategoryChange, onUpload }`，保持原有两参数调用可用。

- [ ] **Step 1: 写失败测试。** 覆盖分类去重、空值归入未分类、全部与指定分类的结果及原顺序；场景中的筛选选择、零结果文案、键盘激活和现有阅读触发。
- [ ] **Step 2: 运行测试并确认失败。** `node --test tests/ui.test.ts`，预期新增筛选测试失败。
- [ ] **Step 3: 实现分类纯函数与场景控件。** 页头放轻量选择器，筛选后仍用一条档案序列；空结果提供“查看全部”。`startArchive` 保存选中分类，清单刷新后若分类不存在则切回全部，阅读视图的关闭与焦点恢复保持现状。
- [ ] **Step 4: 运行验证。** `node --test tests/ui.test.ts`、`npm test`、`git diff --check` 通过。
- [ ] **Step 5: 提交。** `git add src/categories.ts src/scene.ts src/main.ts src/style.css tests/ui.test.ts`；`git commit -m "feat: filter archive by category"`。

### Task 4: 上传界面与运行说明

**Files:**
- Create: `src/upload.ts`
- Modify: `src/main.ts`, `src/scene.ts`, `src/types.ts`, `src/style.css`, `README.md`
- Modify: `tests/ui.test.ts`

**Interfaces:**
- Consumes: Task 2 的两个 HTTP 接口和 Task 3 的分类状态。
- Produces: `renderUploadPanel({ categories, onClose, onComplete })`；`onComplete` 在批次结束后触发一次清单刷新。上传能力检测只在返回结构中 `enabled === true` 时显示入口。

- [ ] **Step 1: 写失败测试。** 能力接口可用/不可用时入口显隐正确；多文件逐份请求并显示成功与失败；已有分类、新分类、未分类传值正确；批次结束仅刷新一次并保持当前筛选；文件选择为空时不可提交。
- [ ] **Step 2: 运行测试并确认失败。** `node --test tests/ui.test.ts`，预期上传界面测试失败。
- [ ] **Step 3: 实现上传面板和主流程。** 使用 `FormData` 逐份发送；显示每份状态和错误，不中断后续文件；完成后重新获取清单。能力探测失败或静态站点返回非预期 JSON 时隐藏上传入口。面板关闭后恢复触发按钮焦点。
- [ ] **Step 4: 更新 `README.md`。** 说明本机开发/预览服务上传、纯静态构建只读、50 MiB 限额、分类 sidecar、同名冲突以及仍可手动放入 `documents/`。
- [ ] **Step 5: 运行完整验证。** `npm test`、`npm run build`、`git diff --check` 通过；在本机开发服务手工上传一份临时 Markdown，确认页面即时出现、分类筛选和下载可用，随后仅删除本次临时文件并重新生成档案，确保提交中没有测试文档。
- [ ] **Step 6: 提交。** `git add src/upload.ts src/main.ts src/scene.ts src/types.ts src/style.css README.md tests/ui.test.ts`；`git commit -m "feat: add archive upload controls"`。
