# Video Archive Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the approved video reference with all ten animation categories and real document workflows.
**Architecture:** Vanilla TypeScript state drives a Three.js world and semantic HTML controls. Existing conversion and document reading remain separate from presentation.
**Tech Stack:** Vite, TypeScript, Three.js, Node test runner, jsdom.
**Spec:** `docs/proposals/2026-10-11-video-redesign.md` (approved by user, including mandatory animations).

## Global Constraints
- Real document identity remains the manifest ID; group size is at most 8.
- All ten animation categories are required. Animation must be checked dynamically.
- No external publishing, account service or database. Saved IDs stay in local storage.
- Keep existing user documents and previous working changes.
- Desktop 1920×1080, 1440×900, 1280×720 and narrow preview remain navigable.

## Review Focus
- Partial last group and one/zero documents: navigation never selects a nonexistent entry (task 1).
- Fast retarget / Escape: current pose continues smoothly and no stale reader appears (tasks 1, 3).
- Storage denied or corrupt, or files removed: saved UI remains consistent and reports session-only storage (task 1).
- Reload while loading/reading: old scene and async work cannot reactivate (task 3).
- WebGL unavailable/context lost: real documents remain reachable (tasks 2, 3).

### Task 1: State, layout, persistence and motion contracts
Files: `src/archive-state.ts`, `src/layout.ts`, `src/scene/ArchiveMotion.ts`, `tests/archive-state.test.ts`, `tests/layout.test.ts`.
Interfaces: `ArchiveState` holds selected index, mode, overlay, exploded, saved IDs; `layoutFiles(count)` returns world coordinates; `MotionValue` samples and retargets continuous scalar interpolation.
- [ ] Write failing tests for group wrapping, partial groups, search, saved identity/storage failure and retarget continuity.
- [ ] Run tests and confirm expected failures.
- [ ] Implement contracts and run focused tests.

### Task 2: Model and animated world
Files: `src/scene/ArchiveModel.ts`, `src/scene/ArchiveWorld.ts`, dependency manifest.
Interfaces: `ArchiveWorld(container, entries, callbacks)` exposes `update(state)`, `replayIntro()`, `skipIntro()`, `resetView()`, `dispose()`; callbacks select/open actual entry indices.
- [ ] Install Three.js and its type definitions.
- [ ] Build reusable upright binder layers, labels, fasteners, rings and glass; support per-layer explosion.
- [ ] Build orthographic array, lighting, responsive camera, ray picking, wave/lift, intro, opening/return and inspection with damped orbit controls.
- [ ] Verify compile and actual rendering, including low/zero entry counts and resource disposal.

### Task 3: Controls, detail, reader and lifecycle
Files: `src/scene.ts`, `src/ui/ArchiveUI.ts`, `src/ui/ArchiveDirectory.ts`, `src/main.ts`, `src/reader.ts`, `src/style.css`, `tests/ui.test.ts`.
Interfaces: `renderScene(entries, onRead)` returns disposable scene element; `onRead(entry, trigger)` creates reader; UI consumes state and dispatches actions.
- [ ] Add failing tests for persistent selection, functional access, search-to-detail, saved filtering, inspection transitions, keyboard routing and stale reload disposal.
- [ ] Implement semantic overlay UI, animated directories, intro/replay controls, inspection/explosion controls and responsive layouts.
- [ ] Reuse format readers; provide expanded reading, focus restoration, Escape and cancellation.
- [ ] Run UI tests and complete tests plus build.

### Task 4: Visual and dynamic verification
Files: README, verification artifacts in `output/playwright/`, review notes.
- [ ] Compare overview/detail/inspection against video reference; tune model dimensions, view and lighting.
- [ ] Exercise all ten animation categories live; inspect rapid interruption and directory/reader interactions.
- [ ] Check different viewport sizes and browser errors; run final tests/build.
- [ ] Obtain fresh whole-change review, fix important findings and document results.

## Execution decisions
- User explicitly approved the plan and instructed implementation, so continue without another design approval cycle.
- Work in the current checkout on `codex/video-archive`: it contains the approved previous edits and real untracked input documents; creating a checkout from HEAD would omit them.
- Do not commit unrelated input documents. Deliver reviewable working changes locally.
