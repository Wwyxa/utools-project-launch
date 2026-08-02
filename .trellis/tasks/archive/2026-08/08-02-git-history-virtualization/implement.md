# Git Commit History Virtualization Implementation Plan

## Preconditions

- Read the task PRD, design, both research reports, and applicable frontend/guides specs before editing.
- Preserve the documented baseline: the existing graph and tooltip focused suites pass except for the known same-name tag/local-branch ref-color assertion.
- Do not start a network service or add a package dependency for the implementation.

## Ordered Work

1. Extend graph geometry as a pure, tested boundary.
   - Add explicit logical row top/block-height data and a pure viewport-plus-overscan selector in `src/lib/gitCommitGraph.ts`.
   - Cover ordinary chains, forks, merges, first/last boundary equality, one preceding/intersecting segment, expanded blocks, and zero-height rows in `src/lib/gitCommitGraph.test.ts`.
   - Immediately run `npx vitest run src/lib/gitCommitGraph.test.ts` after this first substantive edit.

2. Introduce viewport state in `GitCommitHistory.vue`.
   - Add local scroll/resize observation with animation-frame coalescing and cleanup.
   - Render the full-height positioned surface and only selected commit rows/expanded blocks from the pure selector.
   - Keep row event handlers, selection, keyboard actions, refs, and existing `v-memo` inputs intact.
   - Run the focused graph test and `npm run lint` before continuing.

3. Window the shared SVG using the geometry rule.
   - Render only selected paths/nodes in a global-coordinate, clipped SVG viewport.
   - Verify visual continuity for a path entering from the preceding row and for paths across expanded file blocks.
   - Run the focused graph test, `npm run lint`, and a local browser smoke pass before further changes.

4. Add geometry-change anchoring and floating-control lifecycle protection.
   - Capture/restore the visible row anchor around expanded-file and tree/list height changes.
   - Close tooltip/menu ownership before an owner unmounts; require a connected focus opener before restoration.
   - Keep pagination append-only and retain the existing observer/concurrency guards.
   - Run focused graph/tooltip tests and browser checks for expansion, scrolling, context menu, and page append.

5. Repair the narrow structured-ref identity defect.
   - Replace bare-name graph-color matching with structured kind/name identity throughout the component and ref presentation helper.
   - Keep dense badge grouping and visual priorities unchanged except that same-name tags no longer inherit a local branch color.
   - Run `npx vitest run src/lib/gitCommitRefs.test.ts src/lib/gitCommitGraph.test.ts` immediately after the edit.

6. Capture before/after evidence and complete quality checks.
   - Re-run the documented local browser fixture at 80, 160, 240, and 400+ commits, record mounted row/path/node counts, and verify the window bound.
   - Re-run warm tooltip A-B-A with a graph-container mutation observer and confirm zero graph mutations plus no extra file-detail reads.
   - Run the existing bridge benchmark and manual merge/multi-ref/expanded-file/pagination smoke cases.

## Required Validation

```text
npx vitest run src/lib/gitCommitGraph.test.ts
npx vitest run src/lib/gitCommitRefs.test.ts src/lib/gitCommitTooltipSession.test.ts
npm run benchmark:git-interactions -- --report after
npm run lint
npm run build
```

Browser/uTools checks:

- 80, 160, 240, and 400+ commits: scroll top/middle/bottom and page append.
- Normal chain, fork, merge, and multiple visible references including current/upstream/base and attached HEAD.
- A path that crosses a window boundary and one that crosses an expanded file block.
- Open/close/loading/error file blocks; tree/list switching and nested directory collapse.
- Selected commits reappearing after scrolling away and back.
- Tooltip cold delay, warm A-B-A, scroll cleanup, and valid-short-stats no-file-read behavior.
- Context menu opening near a window edge, scrolling it out, and keyboard/Escape focus restoration.

## Risk Gates

- Do not merge a row-only virtual list while the SVG remains unbounded; it does not satisfy the renderer DOM bound.
- Do not slice commits before calling the full layout helper.
- Do not use CSS visibility or a large translated row list as a substitute for unmounting offscreen row DOM.
- Do not merge a strict-boundary SVG filter that can omit an endpoint on the viewport edge.
- Stop and return to planning if a browser check shows a missing lane, wrong y coordinate, scroll jump, stale menu, or new tooltip file read.

## Documentation And Rollback

After code checks pass, update the applicable frontend spec with the graph-window, variable-height anchor, SVG clipping, and tooltip lifecycle contracts. Do not commit unless the user explicitly asks. Reverting the component/window-helper edits restores the original full renderer without data migration.
