# Rhine Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local desktop website that reads files from `documents/` and presents them as one animated, container-free row of upright archive files with immersive previews.

**Architecture:** A Node content step scans local documents, writes a typed JSON manifest, safe HTML previews, and copies source files into Vite's public output. A Vite/TypeScript browser app renders an abstract milk-white archive sequence using CSS perspective and owns hover, extraction, and reading states. The visual is implemented with DOM/CSS rather than using the approved image as a static background.

**Tech Stack:** Node.js 20+, Vite, TypeScript, Vitest with jsdom, Markdown-it, Mammoth, sanitize-html, browser-native PDF viewing.

**Spec:** `docs/superpowers/specs/2026-10-10-rhine-archive-design.md`

## Global Constraints

- Desktop browser only; no phone layout, server API, account, upload, database, remote sync, or publishing.
- Input formats: `.md`, `.docx`, `.pdf`, and download-only `.doc`; files live in `documents/`, including subdirectories.
- Optional same-stem `.meta.json` may override `title`, `summary`, `date`, and `category`; restart dev server or rebuild after file changes.
- Background is abstract and predominantly soft milky ivory, with no literal room, props, archive box, drawer, shelf, or platform.
- Files stand vertically in exactly one row; camera is oblique from above; selected file only translates up and never rotates its face toward the viewer.
- Idle wave, hover extraction, and click extraction always play, regardless of the system reduced-motion setting.
- Keyboard focus, Enter/Space, Escape, and visible return control operate the same states as pointer actions.

## Review Focus

1. Two files with the same basename in different subdirectories produce distinct IDs and source URLs; Task 1 tests both.
2. Chinese and space-containing filenames remain loadable after build; Task 1 tests encoded URLs.
3. Malformed `.meta.json` does not abort the entire collection; Task 1 tests fallback metadata and a warning.
4. Corrupt `.docx` yields a readable preview error and a source download; Task 1 tests per-file failure isolation.
5. Empty `documents/` shows instructions without fake clickable files or a crash; Task 2 tests the empty state.

---

## File Map

- `package.json`, `tsconfig.json`, `index.html`, `vite.config.ts`, `.gitignore`: local tooling and app entry.
- `scripts/build-archive.mjs`: recursive scan, metadata, conversion, sanitization, manifest and source copying.
- `tests/build-archive.test.mjs`: content pipeline behavior using temporary document directories.
- `src/types.ts`: browser-facing `ArchiveEntry` and manifest types.
- `src/layout.ts`: pure single-row position calculation, independent of rendering.
- `src/scene.ts`: accessible archive sequence, hover label, and empty state.
- `src/reader.ts`: Markdown/Word HTML, PDF, legacy Word, and error reading states.
- `src/main.ts`: load manifest, connect scene to reader, and restore focus on close.
- `src/style.css`: abstract ivory scene, 3D file geometry, wave and extraction transitions.
- `tests/layout.test.ts`, `tests/ui.test.ts`: placement and interaction behavior.
- `README.md`, `documents/.gitkeep`: file placement, metadata, startup, and supported preview instructions.

### Task 1: Local document pipeline

**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `scripts/build-archive.mjs`, `tests/build-archive.test.mjs`, `src/types.ts`, `documents/.gitkeep`.

**Interfaces:** `buildArchive({ documentsDir, outputDir }: { documentsDir: string; outputDir: string }): Promise<ArchiveManifest>` writes `outputDir/manifest.json`, `outputDir/files/**`, and `outputDir/previews/**`. `ArchiveEntry` has `id`, `relativePath`, `title`, `summary`, `date`, `category`, `type: 'md'|'docx'|'pdf'|'doc'`, `sourceUrl`, optional `previewUrl`, and optional `error`. Manifest has `entries: ArchiveEntry[]` and `warnings: string[]`. IDs are a stable hash of normalized relative paths; entries sort by date descending, then path.

- [ ] **Step 1: Write failing content tests.** In `tests/build-archive.test.mjs`, create temp inputs and assert: Markdown converts to sanitized HTML; PDF and DOC get source URLs but only PDF is previewable; DOCX text converts with Mammoth; same basenames in nested folders have distinct IDs; URL segments encode Chinese/spaces; invalid JSON metadata falls back with warning; corrupt DOCX keeps its entry, error, and source URL; empty folder returns `entries: []`. Generate the DOCX fixture with the `docx` test dependency.
- [ ] **Step 2: Verify red.** Run `npm test -- tests/build-archive.test.mjs`; expect missing `buildArchive` export or failing assertions.
- [ ] **Step 3: Implement the content step and project scripts.** `npm run dev` and `npm run build` run `node scripts/build-archive.mjs` first. Use Markdown-it with raw HTML disabled, Mammoth for DOCX, sanitize-html for all generated HTML, safe path-segment encoding, and per-file error isolation. Copy originals so the preview always has a download. Generated `public/archive/` is ignored by Git; clear only that resolved project-owned directory before rebuilding.
- [ ] **Step 4: Verify green and commit.** Run `npm test -- tests/build-archive.test.mjs` and `npm run build`; expect zero failures and a built site. Commit the task files.

### Task 2: Container-free archive scene

**Files:** Create `src/layout.ts`, `src/scene.ts`, `src/style.css`, `src/main.ts`, `tests/layout.test.ts`, `tests/ui.test.ts`; modify `index.html`.

**Interfaces:** `layoutFiles(count: number): Array<{ x: number; z: number; delayMs: number }>` gives a single ordered axis and staggered wave phases. `renderScene(entries: ArchiveEntry[], onOpen: (entry: ArchiveEntry, trigger: HTMLButtonElement) => void): HTMLElement` returns the full scene and marks empty state clearly.

- [ ] **Step 1: Write failing layout and scene tests.** Assert `layoutFiles(7)` has seven ordered positions with no second lane and distinct wave delays; `renderScene([])` shows `将文件放入 documents/` without clickable files; populated scene produces one button per entry with title/type labels and calls `onOpen` for click and keyboard activation.
- [ ] **Step 2: Verify red.** Run `npm test -- tests/layout.test.ts tests/ui.test.ts`; expect missing scene/layout implementations.
- [ ] **Step 3: Implement the scene.** Use perspective transforms to arrange one row of upright file planes on an invisible axis. Build files as DOM buttons; selected file transforms by translation only, with the same rotation as neighbors. Use a nearby independent detail label. CSS has an always-running phase-staggered wave, a pronounced hover lift, and the soft milk-white abstract backdrop. Do not add a `prefers-reduced-motion` override.
- [ ] **Step 4: Verify green and commit.** Run targeted tests, then `npm run build`; expect zero failures. Commit the scene, layout, and tests.

### Task 3: Extract and read real files

**Files:** Create `src/reader.ts`; modify `tests/ui.test.ts`, `src/main.ts`, `src/scene.ts`, `src/style.css`.

**Interfaces:** `renderReader(entry: ArchiveEntry, onClose: () => void): HTMLElement` returns a dialog-like reading view. `main.ts` fetches `/archive/manifest.json`, renders the scene, and retains the opening button to restore focus after close.

- [ ] **Step 1: Write failing reader and app tests.** Assert MD/DOCX iframe or safe HTML pane uses `previewUrl`, PDF uses native browser PDF frame, DOC shows a download-only explanation, an entry with `error` shows the error plus download, and Escape/return button closes the reader and restores focus. Assert clicking a file enters extraction state before the reading view appears; fake timers may advance the transition.
- [ ] **Step 2: Verify red.** Run `npm test -- tests/ui.test.ts`; expect missing reader/app behavior.
- [ ] **Step 3: Implement transitions and reader.** First translate the upright file upward without rotating it; then fade/blur the sequence and reveal the reading view. Keep download reachable for every format. Handle manifest fetch failure with a readable retry message. Use close button and Escape, with focus returning to the opening file.
- [ ] **Step 4: Verify green and commit.** Run `npm test -- tests/ui.test.ts` and `npm run build`; expect zero failures. Commit the reader and interaction code.

### Task 4: Documentation and desktop validation

**Files:** Create `README.md`; modify `src/style.css` and focused tests only if validation exposes a concrete defect.

**Interfaces:** `npm run dev` serves the website locally; `npm run build` generates a static `dist/` with all source files and previews.

- [ ] **Step 1: Write README.** Document `documents/`, the four extensions, `.meta.json` keys with one example, install/start/build commands, DOCX layout limits, and the required restart/rebuild after file changes.
- [ ] **Step 2: Run full automated checks.** Run `npm test`, `npm run build`, and `git diff --check`; expect zero failures.
- [ ] **Step 3: Run desktop browser QA.** Start the local preview and inspect one real MD, DOCX, and PDF fixture plus a DOC download state. Confirm oblique single row, no container, warm ivory color, wave, hover lift, click extraction with unchanged orientation, reading view, close, empty state, and horizontal browsing with many files. Fix only observed defects, adding a failing test first.
- [ ] **Step 4: Commit verified documentation and fixes.** Keep fixtures outside `documents/` or remove them before commit, so the user's archive starts empty. Record any browser or DOCX rendering limitation in the final handoff.
