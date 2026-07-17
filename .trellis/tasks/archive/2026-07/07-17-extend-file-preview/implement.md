# Files Tab Enhancement Implementation Plan

## 1. Markdown Local Images

- [x] Add the pure local/external/blocked path classifier in `src/lib/projectMarkdown.ts`, including selected-file-relative and project-root-relative normalization.
- [x] Extend `src/lib/markdown.ts` with optional token-based image collection/resolution while preserving no-options behavior for Memo, Git, and AI rendering.
- [x] Add per-render local image state, deduplicated bounded reads through the existing store action, stale-generation protection, and isolated loading/failure rendering in `FilesTab.vue`.
- [x] Add localized Chinese/English image failure text in `src/lib/i18n.ts` and responsive rendered-image/fallback styles in `src/index.css`.
- [x] Add `scripts/validate-markdown-images.mjs` and `validate:markdown-images`; cover the README example, nested/root paths, encoded names, pass-through URLs, blocked paths, token handling, and isolated failures.
- [x] Render closed YAML front matter through the shared YAML highlighter, preserve normal body Markdown, and add positive/negative regression cases.
- [x] Run `npm run validate:markdown-images` immediately after the path/render slice; repair and rerun before changing other Files Tab behavior.
- [ ] Run `npm run type-check` and `npm run build`; manually verify the real README image, rapid file switching, failed-image isolation, and wide images at minimum preview width.
- Rollback point: remove the Files Tab render options and local asset state; all other Markdown callers retain the unchanged default renderer.

## 2. Shared Dialog Foundation

- [x] Add `ProjectActionDialog.vue` with the existing Git dialog visuals, Teleport/transition, primary/secondary/cancel actions, busy state, and Escape contract.
- [x] Migrate `GitTab.vue` confirmation flows to the shared component without behavior or copy changes.
- [ ] Run `npm run type-check` immediately after this slice; smoke Git discard/force-switch/remove-remote dialogs.
- Rollback point: revert the shared component migration before touching Files Tab dialogs if Git behavior differs.

## 3. Filesystem Contracts and Behavior Tests

- [x] Add search/mutation result types and ProjectBridge signatures in `src/types.ts`.
- [x] Add safe browser fallback methods in `src/lib/projectBridge.ts`.
- [x] Add project-id store actions in `src/store/useStore.ts`.
- [x] Implement bounded async name search, create, rename, recursive delete, and validated reveal in `public/preload.js`.
- [x] Add `scripts/validate-project-files.mjs` plus `validate:project-files` package script using temporary fixtures and the VM bridge harness.
- [x] Run `npm run validate:project-files` immediately after the first preload behavior slice; repair and rerun before expanding UI work.
- [x] Run `node --check public/preload.js` and `npm run type-check` after contracts agree across all layers.
- Rollback point: methods are additive; retain existing list/read/write APIs unchanged.

## 4. Tree Navigation and Filtering

- [x] Extend `FileTreeNode.vue` with tree semantics, roving focus props/events, context-menu events, selected-directory state, and inline create/rename rows.
- [x] Add Files toolbar, local focus/selection state, visible-node flattening, standard tree keyboard controls, refresh, collapse-all, and debounced project-wide name filtering in `FilesTab.vue`.
- [x] Render filtered results with relative paths, stale-response protection, result-limit feedback, and ancestor expansion on activation.
- [x] Add localized Chinese/English strings in `src/lib/i18n.ts`; remove any replaced dead keys in both locales.
- [ ] Run `npm run type-check`, then manually verify keyboard navigation at the minimum 180px tree width.

## 5. Context Menu and File Management

- [x] Add the teleported node context menu with outside-click/Escape cleanup, viewport clamping, keyboard opening, disabled states, and danger styling.
- [x] Replace fixed menu dimensions with intrinsic width and post-render bounding-box positioning that flips around edge-adjacent triggers.
- [x] Implement create/rename/delete UI continuations only after bridge success; preserve inline input and error text on failure.
- [x] Implement clipboard feedback for relative/absolute paths and store-backed system reveal.
- [x] Reconcile expanded/focused/selected/current-preview paths after create, rename, delete, and refresh.
- [x] Run `npm run validate:project-files` and `npm run type-check` after this slice.

## 6. Dirty Draft Safety and Parent Coordination

- [x] Centralize the Save / Discard / Cancel continuation guard for switch, Git-originated open, rename, and delete.
- [x] Add `open-canceled` to Files Tab and clear matching requests in `ProjectDetails.vue`.
- [x] Ensure save failures stop the pending action; cancel preserves draft, search state, focus, and preview.
- [ ] Verify rename/delete of an ancestor directory handles the current file path and editor state correctly.
- [x] Run `npm run type-check` and `npm run build`.

## 7. Full Verification

- [x] Run `npm run validate:markdown-images`.
- [x] Run `npm run validate:project-files`.
- [x] Run `node --check public/preload.js`.
- [x] Run `npm run type-check`.
- [x] Run `npm run build`.
- [ ] Manual uTools smoke: README and nested/root-relative Markdown images; blocked/missing/oversized image isolation; remote/data image pass-through; wide-image containment; lazy expansion; whole-project name filter; keyboard tree/menu; create file/directory; collision and invalid-name errors; rename; recursive delete; copy paths; reveal; dirty switch/rename/delete Save/Discard/Cancel; Git-to-Files cancellation; narrow split width; Git confirmation regressions.
- [x] Confirm no new runtime dependency and no new preview format.
