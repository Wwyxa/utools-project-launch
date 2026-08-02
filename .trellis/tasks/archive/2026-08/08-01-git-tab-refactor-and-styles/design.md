# GitTab 拆分与 Git 控件样式设计

## Preconditions

- `08-01-git-graph-layout-and-refs` has completed and owns graph/ref pure modules.
- `08-01-git-interaction-performance` has completed and owns tooltip/cache/refresh contracts.
- This child changes ownership and presentation without changing those behaviors.

## Final Ownership

### GitTab.vue

Keeps page orchestration only:

- active repository target and shared repository strip;
- top-level Changes/Commit Tree open state;
- resizable split and right-side diff selection;
- cross-region feedback and public refresh/expose API;
- composition of changes, history, AI and existing diff viewer.

### GitChangesPane.vue

Owns the complete working-tree/commit-composer UI lifecycle:

- staged and unstaged subgroup state;
- commit message textarea sizing and row actions;
- single/bulk stage, unstage, discard and commit interactions;
- file selection events that drive the parent review pane.

It receives `projectId`, repository target, open/disabled state, commit draft and current worktree selection. It emits typed open/draft/selection/feedback intents and reads canonical Git data/actions from Pinia rather than receiving a copied snapshot or action object.

### GitCommitHistory.vue

Owns the complete history scroll/lifecycle boundary:

- filters, selection and pagination observer;
- graph/ref rendering from child 1 pure modules;
- expanded commit files and file-tree module;
- tooltip state/cache integration from child 2;
- history context menu and branch/tag dialogs;
- history file-review and AI-scope events.

### GitAiAnalysisDialog.vue

Owns batch AI dialog state, stream lifecycle and renderer-session AI results. It receives project/repository/selected-commit scope and emits close/feedback. Project-level session cleanup moves with it; `GitTab` may temporarily re-export the cleanup function to keep callers stable during migration.

### Pure Modules

- Reuse `gitCommitGraph.ts` and `gitCommitRefs.ts` from child 1.
- Add `src/lib/gitCommitFileTree.ts` for normalization, compact folders, sorting and visible list/tree flattening.
- Do not add a one-consumer composable for tooltip, actions or history.

## State Rules

- Pinia owns snapshots, workspace inventory, loading, write concurrency and Git mutations.
- `GitTab` owns cross-region selection, repository context, draft session and right diff.
- Child views own only their complete local interaction state.
- Props/events stay narrow and typed; no provide/inject context object, copied snapshot or action proxy.
- Module-scoped renderer-session maps keep their existing repository-context cleanup boundaries.

## Migration Sequence

1. Extract and test the pure commit file-tree module.
2. Extract `GitChangesPane` and validate all working-tree actions before moving another region.
3. Extract `GitCommitHistory` using the already-stable graph/ref/cache contracts.
4. Extract `GitAiAnalysisDialog` and preserve session cleanup/export compatibility.
5. Delete dead inline state, imports, handlers and locale keys after each owner moves.
6. Consolidate control classes only after DOM ownership is stable.

## Compact Control Styles

Add a small Git-specific class family in `src/index.css` only where it removes repeated semantic state strings:

- top actions: 32px with 14px icons;
- section actions: 24px with 13px icons;
- row actions: 20px with 12px icons;
- primary section headers: 32px;
- staged/unstaged secondary headers: 28px;
- ref badges: approximately 18px with 9px text and 10px icons.

Commit message, filter and dialog fields use existing `ui-field` / `ui-field-compact` tokens. New classes define stable dimensions and shared focus/disabled/loading states; they do not create wrapper components.

All icon actions keep Lucide icons, native tooltip/title, `aria-label`, visible keyboard focus and stable dimensions. Narrow toolbars separate flexible content from a `shrink-0` action group so the first action never enters unreachable negative overflow.

## Compatibility

- `ProjectDetails.vue` sees no public API change.
- No bridge, persistence or runtime dependency is added.
- Existing dialogs, menus and teleported preview retain viewport clamping and Escape cleanup.
- Existing Git semantics and user-visible Chinese copy remain unchanged except dead or duplicate text removed by the new hierarchy.

## Validation

- Focused pure file-tree tests.
- Type-check/build after each component extraction.
- Browser checks at normal and minimum left-pane widths in light, dark and uTools host-like dimensions.
- Screenshot/geometry assertions for non-overlap, stable action dimensions, graph/text alignment, preview bounds and diff reachability.

## Rollback

Each extraction is one reversible slice. If a child contract becomes broad or duplicates state, roll back that extraction and keep the owner in `GitTab` until a narrower boundary is identified; do not compensate with a mega context object.
