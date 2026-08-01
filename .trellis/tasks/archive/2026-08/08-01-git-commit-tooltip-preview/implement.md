# Implementation Plan: Git Workspace And Commit Preview

## Preconditions

- Review `prd.md` and `design.md` before editing product code.
- Load the configured frontend quality spec and VS Code source-control / hover-preview reference through Trellis implementation context.
- Do not start implementation until the final planning summary receives explicit user approval and `task.py start` succeeds.
- Preserve the existing uncommitted preview implementation and adapt it to the new left-side graph layout; do not revert unrelated user work.

## Implementation Checklist

1. Remove the right-side mode architecture in `src/components/project/GitTab.vue`.
   - Delete `RightContext`, `rightContext`, mode-tab keyboard handling, mode reset assignments, and history/review template branches.
   - Remove the old header-only previous/next worktree-file controls and dead navigation helper; do not relocate them into dense left headers or `GitDiffViewer`.
   - Keep one right pane that directly renders `GitDiffViewer` or the existing compact empty state.
   - Preserve worktree/historical selection, diff loading, request generation, navigation, and review scroll state.

2. Rebuild the left pane as two primary collapsible sections.
   - Add local open state for Changes and Commit Tree; retain direct staged/unstaged secondary open state without a Change List parent.
   - Move commit composer into the expanded Changes body.
   - Put AI generation, global discard, and commit icon controls in the Changes title row.
   - Render staged/unstaged as visually weaker direct groups; keep bulk stage/unstage actions in the relevant group and keep all-scope discard in the Changes title row.
   - Use a 40px-to-144px content-driven textarea height and remeasure it whenever the horizontal split width changes.
   - Move filters, graph, and existing history actions under the Commit Tree section; remove top/bottom controls.
   - Apply flex height constraints and independent scrollports without a new vertical resizer or nested cards.

3. Simplify commit rows and selection.
   - Remove selection/hash grid tracks and their row controls.
   - Recompute graph/content offsets and minimum row width without changing lane coordinates or row-height constants.
   - Render flat rows containing graph, title, compact refs, and a subdued author/relative-time line.
   - Add one row click handler: Ctrl/Cmd toggles selection only; unmodified click toggles inline files.
   - Keep context menu, nested file clicks, filter/AI selection helpers, selected count, and inline file offsets working.

4. Replace manual pagination with a stable sentinel.
   - Add a fixed-height load-sentinel ref below graph content.
   - Observe it with native `IntersectionObserver` rooted at `graphScrollRef` and a small bottom prefetch margin.
   - Call the existing guarded `handleLoadMore` once per intersection entry.
   - Show only a small spinner inside the stable sentinel while loading; remove the button and text.
   - Disconnect/reconnect on section visibility, repository context, ref changes, and unmount; do not recursively chase filtered pages.

5. Adapt the existing interactive preview to the left-side graph.
   - Keep actual DOM size observation, 450ms cold open, immediate warm switching, 180ms close grace, and lifecycle cleanup.
   - Anchor `left` to `graphScrollRef`'s right edge plus 8px and constrain right/top/bottom viewport insets to 12px.
   - Render a clickable short hash before the footer change summary; it copies the full hash without a standalone icon or copy-message action.
   - Close preview when Commit Tree collapses, external geometry changes, or repository context resets.

6. Finish focused styling and cleanup.
   - Adjust `src/index.css` only for compact section headers, flat row states, intrinsic preview sizing, and stable sentinel rendering where utilities are insufficient.
   - Remove locale entries used only by deleted top/bottom controls.
   - Remove dead imports, refs, handlers, computed state, and classes created by the old mode/header/hash/checkbox paths.
   - Do not add dependencies, generic section components, placement abstractions, row animations, or persistence.

## Focused Validation

After the first product-code edit, run the cheapest slice-wide check:

```bash
npm run lint
```

Repair local TypeScript failures and rerun the same command before continuing. Rerun it after each major template/state slice. After all edits, run:

```bash
npm run lint
npm run build
```

Use `git diff --check` after executable checks. Validate Trellis manifests and task artifacts before final review.

## Browser and Host Checks

- Layout: right pane is always review/empty state and has no Git mode header; divider resize still works.
- Collapse: Changes, staged, unstaged, and Commit Tree preserve their own state and release space correctly; staged/unstaged are direct weak secondary rows.
- Headers: 32px-class primary rows, right-aligned icon-only actions, correct tooltip/ARIA/disabled/loading states, and no top/bottom controls.
- Commit rows: no checkbox/hash/frame; graph alignment remains exact; subdued author/relative-time metadata remains visible; normal click expands and Ctrl/Cmd click selects without double action.
- Review: worktree and historical files update the same right `GitDiffViewer`; hunk navigation, wrapping, and scroll restoration remain available.
- Preview cold/warm behavior: first row appears after approximately 450ms; adjacent row switches immediately; the short footer hash copies the full hash, text selection and body scrolling work, and no redundant copy controls render.
- Preview geometry: short/no-body, long-body, multiple-ref, loading/loaded, avatar/fallback, and top/middle/bottom rows stay within 384px × 400px and right/top/bottom insets.
- Pagination: approaching the bottom triggers one page, spinner does not alter sentinel height, existing `scrollTop` and rows do not jump, and the next request waits for a new intersection entry.
- Lifecycle: filters, Commit Tree collapse, external scroll, resize, repository/project switch, tab change, and unmount leave no stale preview, observer, or response.
- Compact host: normal, minimum-left-pane, and actual uTools-like dimensions have no overlapping text, clipped actions, nested scroll dead zones, or unreachable controls.

## Review and Rollback Gates

- Review the final diff by the independent slices defined above: right-mode removal, collapsible layout, compact rows/modifier selection, pagination sentinel, and preview relocation.
- Reject any third-party positioning dependency, virtual list, recursive auto-pagination, vertical section resizer, right-mode fallback, generic accordion framework, native child window, or click-to-pin behavior.
- If the sentinel causes repeated loads without a new intersection entry, disconnect that slice and retain one-entry/one-page behavior before proceeding.
- If actual-size observation or horizontal relocation causes resize loops or visible oscillation, revert only the placement slice before changing the interaction model.
