# Archive Trash and Removal Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the local archive recycle one document or a whole category, restore the originals, and animate removed binders leaving the 3D array.

**Architecture:** A focused trash service owns journaled source-file moves and coordinates staged changes to the generated archive. The existing loopback Vite middleware serializes upload, trash, and restore requests; `main.ts` keeps the old scene alive after a successful delete response until `ArchiveWorld` finishes its removal animation, then reloads the manifest.

**Tech Stack:** Node.js ESM and filesystem APIs, Vite middleware, TypeScript DOM UI, Three.js, CSS, Node test runner and jsdom.

**Spec:** `docs/superpowers/specs/2026-10-13-archive-trash-delete-design.md`

## Global Constraints

- Preserve the pre-existing uncommitted work in `src/` and `tests/`; inspect the baseline before isolation or commits and stage only files owned by each task.
- Only the local `127.0.0.1` development and preview services expose mutation endpoints; the static site remains read-only.
- `documents/` is the active source directory. `.archive-trash/` is outside it, ignored by Git, and never automatically purged. Generated files in `public/archive/` or `dist/archive/` are disposable copies.
- A category is derived from current entries. Deleting it recycles every member; `未分类` uses the explicit “清空未分类” action.
- Requests identify an archive by stable ID or category name, never by a client-supplied disk path. Never overwrite files or metadata during restore.
- Server success precedes removal animation; an error leaves the displayed archive intact. Reduced-motion and WebGL fallback remain usable.

## Review Focus

1. A hand-placed nested file and a symlink or junction ancestor: recycle only the resolved in-tree regular file and reject redirected paths (Task 1 tests).
2. Two supported extensions sharing one `.meta.json`: recycling one leaves the other's metadata in place; restoring accepts an identical sidecar and rejects a changed one (Task 1 tests).
3. Interrupted multi-file recycle or restore: pending journal recovery returns the source tree and manifest to one consistent state (Task 1 tests).
4. Upload racing a category delete: the serialized queue determines final category membership from the current manifest, without a partial batch (Task 2 test).
5. A scene disposed while the animation promise is pending: resolve the wait and refresh without leaving controls or focus locked (Tasks 3 and 5 tests).

---

## File structure

| File | Responsibility |
| --- | --- |
| `scripts/archive-trash.mjs` | Validate archive members and paths; journal, recycle, list, restore and recover batches |
| `scripts/build-archive.mjs` | Stage added or removed generated assets and replace the manifest as one publication step |
| `scripts/archive-build.mjs` | Recover pending trash operations before the normal full build |
| `scripts/local-upload.mjs`, `scripts/local-upload.d.mts`, `vite.config.ts` | Shared mutation queue and local HTTP routes |
| `src/archive-management.ts` | Confirmation, category management and trash dialogs |
| `src/scene/ArchiveRemoval.ts`, `src/scene/ArchiveWorld.ts`, `src/scene.ts` | Testable removal timeline, 3D motion and scene-level entry points/fallback motion |
| `src/main.ts` | Request, animation, refresh, selection and focus coordination |
| `src/icons.ts`, `src/style.css`, `src/types.ts`, `README.md`, `.gitignore`, `package.json` | Icons, appearance, types, usage and build startup |

### Task 1: Journaled trash service and archive publication

**Files:**
- Create: `scripts/archive-trash.mjs`
- Modify: `scripts/build-archive.mjs`
- Modify: `.gitignore`
- Test: `tests/archive-trash.test.mjs`

**Interfaces:**
- Consumes: `buildArchive({ documentsDir, outputDir })` and the existing stable `ArchiveEntry.id`/`relativePath` manifest fields.
- Produces: `createArchiveTrash({ documentsDir, outputDir, trashDir })` returning `trashEntry(id)`, `trashCategory(category)`, `listTrash()`, `restoreTrash(operationId)`, and `recoverPending()`; `publishArchiveMutation({ documentsDir, outputDir, removeIds = [], addRelativePaths = [] })` returns the committed manifest.
- `trashEntry` and `trashCategory` return `{ operationId, ids }`; `restoreTrash` returns `{ ids }`. Errors include stable `status`, `code`, and user-facing `message` fields for the HTTP layer.

- [ ] **Step 1: Write failing service tests.** Name tests `recycle one entry and restore it`, `recycle a category as one batch`, `keep shared metadata`, `reject redirected and escaping paths`, and `recover interrupted batch`. In isolated temporary fixtures, assert removed IDs are absent from both `documents/` and `manifest.entries`, the operation exists under `.archive-trash/`, restore returns the original IDs and preview, a changed shared sidecar returns `409`, and recovery never leaves an entry published without its source.
- [ ] **Step 2: Run `node --test tests/archive-trash.test.mjs`.** Expected: FAIL because `createArchiveTrash` and publication support do not exist.
- [ ] **Step 3: Implement the two exported interfaces.** Resolve every ID against the latest manifest; `lstat` source and each existing ancestor before any move. Store a batch journal and original relative paths under `.archive-trash/<operationId>/`; snapshot a shared sidecar rather than moving it while an active sibling still uses it. Stage generated file and preview changes; replace `manifest.json` last, with rollback and startup recovery keyed by the journal state. Add `.archive-trash/` to `.gitignore`.
- [ ] **Step 4: Run `node --test tests/archive-trash.test.mjs tests/build-archive.test.mjs`.** Expected: PASS, including existing full-build and incremental-publish behavior.
- [ ] **Step 5: Commit only this task's files** with `feat: add recoverable archive trash service`.

### Task 2: Local API and mutation serialization

**Files:**
- Create: `scripts/archive-build.mjs`
- Modify: `scripts/local-upload.mjs`, `scripts/local-upload.d.mts`, `vite.config.ts`, `package.json`
- Test: `tests/local-upload.test.mjs`, `tests/archive-trash.test.mjs`

**Interfaces:**
- Consumes: `createArchiveTrash(...)` methods from Task 1.
- Produces: `createUploadMiddleware({ documentsDir, outputDir, trashDir })` with `DELETE /api/archives/:id`, `DELETE /api/categories` JSON `{ category }`, `GET /api/trash`, and `POST /api/trash/:operationId/restore`. Existing upload routes and response formats stay compatible. Delete responses expose `{ operationId, ids }`.

- [ ] **Step 1: Write failing HTTP tests.** Assert the four routes and status mappings (`400` malformed input, `403` non-loopback/cross-origin, `404` missing ID/batch, `409` stale membership or restore collision); upload concurrently with category deletion and assert one complete serialized result. Verify static build has no management route through the existing capability gate.
- [ ] **Step 2: Run `node --test tests/local-upload.test.mjs tests/archive-trash.test.mjs`.** Expected: FAIL on missing routes and queue behavior.
- [ ] **Step 3: Implement route dispatch and one shared commit queue.** Keep parsing and error responses in `local-upload.mjs`; the trash service performs disk mutations inside the queue. Pass a project-root trash path from both Vite servers and recover pending batches before serving either mode. `archive-build.mjs` invokes recovery before the normal build; use it in `dev` and `build` scripts so a restart cannot scan a half-moved source tree.
- [ ] **Step 4: Run `node --test tests/local-upload.test.mjs tests/archive-trash.test.mjs` and `npm run build`.** Expected: PASS; the build still creates a valid archive.
- [ ] **Step 5: Commit only this task's files** with `feat: expose local archive trash API`.

### Task 3: Cancellable 3D removal animation

**Files:**
- Create: `src/scene/ArchiveRemoval.ts`
- Modify: `src/scene/ArchiveWorld.ts`
- Test: `tests/archive-removal.test.ts`, `tests/video-scene.test.ts`

**Interfaces:**
- Produces: `removalPose(elapsedMs: number, index: number, count: number): { forward: number; lift: number; rotation: number; done: boolean }` in `ArchiveRemoval.ts`, and `ArchiveWorld.animateRemoval(ids: string[], options?: { reducedMotion?: boolean }): Promise<void>`. The promise resolves on completion or disposal; scene release alone must not reject it. `ArchiveWorld` addresses target models by stable ID.

- [ ] **Step 1: Write failing tests.** Test `removalPose(0, 0, 1)` starts at zero, a later pose moves forward and lifts, and the final pose sets `done`; a many-file batch finishes within 1200 ms. In the scene test, assert an unrelated model does not receive the pose, reduced motion resolves immediately, and `dispose()` settles a pending promise. Use controlled time rather than real delays.
- [ ] **Step 2: Run `node --test tests/archive-removal.test.ts tests/video-scene.test.ts`.** Expected: FAIL on the absent timeline and removal API.
- [ ] **Step 3: Implement the motion.** Use `removalPose` for per-model forward travel, lift and slight rotation. If the scene is in detail mode, guide the camera back toward the selected row before the final extraction. Lock pointer/Orbit input during the sequence; cap a category batch at 1200 ms. Keep shared materials and placeholder instances unchanged; on dispose settle the promise and release locks.
- [ ] **Step 4: Run `node --test tests/archive-removal.test.ts tests/video-scene.test.ts` and `npx tsc --noEmit`.** Expected: PASS.
- [ ] **Step 5: Commit only this task's files** with `feat: animate archive removal`.

### Task 4: Management dialogs and scene entry points

**Files:**
- Create: `src/archive-management.ts`
- Modify: `src/scene.ts`, `src/icons.ts`, `src/style.css`, `src/types.ts`
- Test: `tests/video-scene.test.ts`, `tests/ui.test.ts`

**Interfaces:**
- Consumes: `ArchiveEntry`, `categoryOptions` and the Task 2 response shapes.
- Produces: `ArchiveTrashBatch { operationId: string; kind: 'entry' | 'category'; label: string; deletedAt: string; entries: Pick<ArchiveEntry, 'id' | 'relativePath' | 'title' | 'category'>[] }` in `src/types.ts`; `renderArchiveManagement(options)` returns a dialog element, where `options` carries `mode: 'confirm-entry' | 'categories' | 'trash'`, optional `entry`, `categories: { name: string; count: number }[]`, `batches: ArchiveTrashBatch[]`, `onClose: () => void`, and async `onDeleteEntry(id)`, `onDeleteCategory(name)`, `onRestore(operationId)` callbacks. `renderScene` controls gain optional `onDeleteEntry(id)`, `onManageCategories()`, `onOpenTrash()` callbacks. The dialog only collects intent; it never calls `fetch` itself.

- [ ] **Step 1: Write failing DOM tests.** Assert local-only delete/management/trash controls; dialog shows exact file title or category count, defaults focus to Cancel, traps Tab and closes on Escape; `未分类` says “清空未分类”; pending action disables repeat clicks; an error stays visible. Assert fallback list offers a short row-exit effect under normal motion and no effect under reduced motion.
- [ ] **Step 2: Run `node --test tests/video-scene.test.ts tests/ui.test.ts`.** Expected: FAIL on absent controls/dialog.
- [ ] **Step 3: Build the dialog and hook scene buttons to callbacks.** Reuse Bulma, the warm-paper tokens and Lucide icons; keep scene and filesystem concerns separate. Expose a scene method `animateRemoval(ids: string[], reducedMotion: boolean): Promise<void>` that delegates to `ArchiveWorld` or the fallback list, so `main.ts` has one call site.
- [ ] **Step 4: Run `node --test tests/video-scene.test.ts tests/ui.test.ts` and `npx tsc --noEmit`.** Expected: PASS.
- [ ] **Step 5: Commit only this task's files** with `feat: add archive management controls`.

### Task 5: End-to-end delete, restore and refresh coordination

**Files:**
- Modify: `src/main.ts`, `src/archive-state.ts`, `README.md`
- Test: `tests/ui.test.ts`, `tests/video-scene.test.ts`, `tests/archive-state.test.ts`

**Interfaces:**
- Consumes: Task 2 routes and Task 4 scene/dialog interfaces.
- Produces: `replacementAfterRemoval(entries: ArchiveEntry[], removedIds: readonly string[], selectedId: string): string` in `archive-state.ts`, choosing a surviving same-row neighbor by x distance, otherwise the nearest remaining row; successful delete flow `request -> animateRemoval(ids) -> startArchive(app)` and restore flow `request -> startArchive(app) -> select restored ID`. Both use the existing `generation` guard and clear `inert`/busy state in `finally`.

- [ ] **Step 1: Write failing integration tests.** Test `replacementAfterRemoval` with two files in one row and a different-category file: deleting the selected ID returns its same-row peer, then deleting that peer returns the other row's ID. Assert no animation or reload after a failed request; success does not replace the old scene before animation resolves; deleting the last category member switches to “全部”; saved IDs are pruned; restore collision leaves the page unchanged; a closed dialog, detached scene or rejected refresh leaves no inert controls or stale focus.
- [ ] **Step 2: Run `node --test tests/ui.test.ts tests/video-scene.test.ts`.** Expected: FAIL on missing coordination.
- [ ] **Step 3: Implement API calls and state transitions in `main.ts`.** Fetch capabilities before showing management controls. Keep the old scene mounted until its removal promise settles, then reload with the existing generation check. On restore, refresh once and locate the returned stable ID. Document the local-only behavior, `.archive-trash/` recovery and the absence of automatic purging in `README.md`.
- [ ] **Step 4: Run `npm test`, `npx tsc --noEmit`, `npm run build`, and `git diff --check`.** Expected: all pass; the existing large-chunk Vite warning may remain.
- [ ] **Step 5: Verify in a real browser.** On wide and narrow viewports, recycle one file and one category, restore both, inspect the physical pull direction and stagger, confirm blank-file fill and keyboard navigation, repeat with reduced motion and WebGL fallback, and check that a restart retains the deleted state. Use only disposable fixture documents for this check.
- [ ] **Step 6: Commit only this task's files** with `feat: complete archive delete and restore flow`, then request a whole-change code review and resolve material findings.
