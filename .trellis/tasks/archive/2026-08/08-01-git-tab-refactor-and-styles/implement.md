# GitTab 拆分与 Git 控件样式执行计划

## Ordered Checklist

1. Confirm preconditions and capture behavior baseline.
   - Run graph/ref, performance, type and build checks from the first two children.
   - Record GitTab's current public props/emits/expose and repository cleanup paths.
2. Extract `gitCommitFileTree.ts` with focused tests.
   - Move normalization, compact folder, sorting and visible-item logic without changing output.
   - Run only the new focused test immediately after the first edit.
3. Extract `GitChangesPane.vue`.
   - Move one complete template/script lifecycle with typed props/events.
   - Preserve commit drafts, textarea sizing, subgroup collapse and all file actions.
   - Run type-check/build and working-tree smoke before continuing.
4. Extract `GitCommitHistory.vue`.
   - Reuse graph/ref/file-tree modules and performance-cache contracts.
   - Preserve filters, selection, expansion, context/ref menus, preview and pagination observer.
   - Run focused tests, type-check/build and history smoke before continuing.
5. Extract `GitAiAnalysisDialog.vue`.
   - Move stream/session/composer state and cleanup.
   - Preserve all selected-history and worktree scopes and final-result behavior.
   - Run AI reasoning validation plus type-check/build.
6. Remove dead ownership from `GitTab.vue`.
   - Search for duplicate state, imports, handlers, class strings and locale keys.
   - Keep only orchestration and shared cross-region state.
7. Consolidate Git control styles in `src/index.css` and templates.
   - Apply the 32/24/20px action hierarchy and 32/28px collapse hierarchy.
   - Reuse `ui-field` tokens for inputs and preserve compact ref geometry.
8. Validate desktop, narrow and theme behavior with browser geometry/screenshots.
   - Check first/last action reachability, no negative overflow, focus/disabled/loading states, graph alignment, preview bounds and diff review.
9. Run final child checks and Trellis review.

## Validation Commands

```powershell
npx vitest run src/lib/gitCommitGraph.test.ts src/lib/gitCommitRefs.test.ts src/lib/gitCommitFileTree.test.ts
npm run validate:ai-reasoning
npm run validate:git-commits
npm run validate:git-workspace
npm run type-check
npm run build
```

## Review Gates

- After each extraction, no next region moves until type-check/build and its focused behavior smoke pass.
- Reject any component requiring a copied repository snapshot, action proxy or large context object.
- Reject any new wrapper that owns no independent state, lifecycle or reusable semantics.
- Keep pure modules free of Vue icons, CSS classes and Store access.

## Rollback Points

- Pure file-tree module.
- Changes pane extraction.
- History extraction.
- AI dialog extraction.
- CSS consolidation.
