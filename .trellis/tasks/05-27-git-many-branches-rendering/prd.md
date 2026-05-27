# 修复 Git 分支较多时渲染问题

## Goal

Fix the Git tab commit graph so repositories with many visible branches render all graph lanes correctly without clipping or overlapping the commit list content.

## What I already know

- User reported a Git rendering issue when there are many branches, with a screenshot showing a dense commit graph in the Git tab.
- The Git tab is implemented in `src/components/project/GitTab.vue`.
- The commit graph is currently drawn manually with SVG rows from `graphRows`.
- `graphColumnWidth` clamps the graph column to `maxGraphColumnWidth = 104`, while `row.width` can grow beyond that as lane count increases.
- Each row's SVG uses `viewBox="0 0 ${row.width} ${rowHeight}"` but is rendered inside a column whose width can be smaller than the viewBox-derived lane span.
- The graph panel already uses `overflow-auto`, so a robust fix can preserve vertical scrolling and allow horizontal overflow when many lanes require more width.

## Assumptions

- The intended behavior is to keep every branch lane visible, even if the graph needs horizontal scrolling for unusually dense histories.
- Commit hash/message/author metadata should remain compact and readable; the fix should not make rows taller.
- The existing visual style, selection behavior, commit detail click behavior, hover tooltip, and load-more flow should remain unchanged.

## Requirements

- Render all Git graph lanes when branch count exceeds the old fixed graph column width.
- Prevent graph lanes from being clipped by the SVG container or row grid column.
- Keep commit rows compact and aligned with the existing `h-8` row rhythm.
- Preserve existing commit selection, copy hash, tooltip, commit detail opening, filtering, and load-more interactions.
- Avoid introducing a new graphing dependency for this scoped layout fix.

## Acceptance Criteria

- [ ] A dense branch history can show graph lanes beyond 104px without clipping.
- [ ] The Git graph panel scrolls horizontally when the graph plus commit columns exceed the available panel width.
- [ ] Commit message and refs remain in the message column and do not overlap the graph.
- [ ] Existing TypeScript lint/typecheck passes with `npm run lint`.

## Definition of Done

- Lint/typecheck green.
- Code changes are limited to the Git rendering/layout path unless a directly related type/style adjustment is required.
- No unrelated UI or data behavior changes.

## Out of Scope

- Replacing the Git graph algorithm with a third-party graph renderer.
- Changing how commits are fetched or parsed from Git.
- Redesigning the Git tab layout beyond the branch-heavy rendering fix.

## Technical Notes

- Likely file: `src/components/project/GitTab.vue`.
- Relevant constants and computed values: `laneWidth`, `laneCenter`, `maxGraphColumnWidth`, `graphRows`, `graphColumnWidth`, `graphRowColumns`.
- Current root cause hypothesis: the graph's logical width grows with `maxLane`, but the CSS grid graph column is capped at 104px and the SVG wrapper has `overflow-hidden`, causing lanes to disappear when branch count grows.
