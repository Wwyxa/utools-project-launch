# Implementation Plan: Git Change List Interaction

## Ordered Work

1. Read the applicable Trellis frontend and shared guidance before source edits.
2. In `GitTab.vue`, introduce hash-keyed expanded-file state, per-hash request invalidation, and helpers for querying, clearing, and pruning expanded commit blocks.
3. Update file-diff selection to accept the owning commit hash instead of reading a global expanded hash.
4. Replace unique-expand graph calculations with a cumulative per-row height calculation and use the same height source for inline blocks and SVG dimensions.
5. Add a list/tree mode ref backed by a module-scoped renderer-session preference, deterministic path-to-tree display items, per-commit directory-collapse state, and the history-toolbar icon button.
6. Render nested directory buttons with chevrons and `aria-expanded`; use only visible tree items for the `240px` capped inline height, while preserving status badges, diff actions, loading/error/empty states, and keyboard/accessibility attributes.
7. Reset or prune commit and directory expansion state during project and commit-list lifecycle changes; leave AI commit selection behavior intact.

## Validation Plan

1. After the first source edit, run `npm run type-check` before expanding the edit scope.
2. Run `npm run build` after the final source change.
3. Run `npm run test:git-diff` and `npm run validate:git-diff` to preserve the existing Git diff contract checks.
4. Start the Vite development server and manually verify a repository with at least two commits containing file changes:
   - expand two commits and close either one independently;
   - confirm graph nodes and links remain aligned below all open blocks;
   - change between list and tree modes without closing blocks;
   - select tree mode, leave and reopen the Git tab or open another project, and verify the selected mode remains until the renderer reloads;
   - collapse and re-expand nested directories in one commit, verify descendants hide/show and another commit stays unchanged;
   - verify a direct child file's status icon and filename begin one visible level after its parent directory rather than at the directory's chevron/folder position;
   - verify a chain such as `.trellis/spec/frontend` with no direct files in its leading folders appears as one `\`-separated directory row, then collapses and re-expands its child files as one unit;
   - open a file from each expanded commit and confirm the review panel identifies the correct commit.
5. Run `git diff --check` for the touched files before handoff.

## Risk and Rollback Points

- Async state must be scoped by commit hash; stale responses are the highest functional risk.
- The graph's vertical offset must consume exactly the same heights as the inline blocks; a mismatch would recreate the reported misalignment.
- Tree item generation is display-only and should not mutate Git file objects.
- Revert the local `GitTab.vue` changes to restore the previous behavior if a regression is found.
