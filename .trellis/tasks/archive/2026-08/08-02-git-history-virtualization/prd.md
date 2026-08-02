# Virtualize Git Commit History Rendering

## Goal

Keep Git commit-history scrolling, hover previews, and row interactions stable as users append history pages, while retaining the complete loaded and filtered Git topology and reference semantics.

## Confirmed Facts

- The target branch is `refactor/git-commit-tree`. The loaded history is currently laid out in full and rendered in full by `GitCommitHistory.vue`.
- `layoutGitCommitGraph(...)` already owns correct lanes, merge routing, global coordinates, graph widths, and total height for every loaded filtered commit. It accepts per-commit expanded-file heights.
- At 80, 160, 240, and 400 synthetic commits in the mounted component, rendered rows, SVG paths, SVG nodes, and graph-container descendants grow with loaded history. The 400-commit baseline contains 400 row elements, 469 SVG paths, 400 SVG node groups, and 5,301 graph descendants.
- Tooltip state already retains one visible reactive detail object and a bounded repository/hash session cache. Valid preloaded short stats already avoid file-detail reads.
- Pagination appends fixed 80-commit pages through a guarded Store action and an observer sentinel.
- Current ref presentation is structured and shared by dense rows and tooltips. A focused baseline test also exposes a reproducible same-name tag/local-branch graph-color bug that must not be hidden by this work.

Detailed code evidence, VS Code comparison, and measurement limitations are recorded in `research/local-vscode-history-rendering.md` and `research/renderer-performance-baseline.md`.

## Requirements

1. Preserve complete topology calculation for every currently loaded and filtered commit, including merge parent routing, lanes, base/current/upstream colors, attached HEAD handling, and structured ref presentation.
2. Render only a finite viewport-plus-overscan window of commit rows, expanded-file blocks, shared SVG paths, and shared SVG nodes. The scroll surface must still represent the exact full layout height.
3. Support variable vertical extents from the fixed commit row plus expanded loading, error, list, and tree file blocks. Geometry changes must retain the visible scroll anchor and must not leave stale content.
4. Preserve graph continuity at virtual-window boundaries. A path that geometrically enters the SVG window must remain rendered and clipped correctly even when its commit-row DOM is outside the row window.
5. Preserve filtering, pagination, selected hashes, keyboard activation, context-menu behavior, focus restoration, repository cleanup, and tooltip lifecycle as rows mount and unmount.
6. Preserve the tooltip contract: fast hover scanning and A-B-A reuse must not create an unbounded reactive detail map, re-render offscreen history rows, or call `readGitCommitFiles` when a commit has valid preloaded short stats.
7. Retain the current compact ref badge design and color meanings. A narrow correction is allowed only for the documented same-name tag/local-branch graph-color correctness defect.
8. Use local repository sources only. Do not add a network dependency or use network research.

## Acceptance Criteria

- [ ] At 80, 160, 240, and feasible 400+ loaded commits, measured mounted rows, SVG paths, and SVG nodes are bounded by the viewport plus one documented finite overscan budget rather than by total loaded commits.
- [ ] Complete filtered topology remains correct for chains, forks, merges, current/upstream/base refs, attached HEAD, tags, and commits with multiple refs, including every path that crosses a virtual window edge.
- [ ] Expanded loading/error/file-list/tree blocks remain aligned with graph nodes and paths. Opening, closing, asynchronous loading, and directory/list/tree changes preserve the current viewport anchor and total content height.
- [ ] Pagination appends one guarded page per observer edge without losing selected hashes, recreating offscreen row DOM, opening stale tooltips, or misplacing floating menus.
- [ ] Graph scrolling and geometry changes close row-owned floating UI safely. Context-menu focus restoration never targets an unmounted row.
- [ ] Focused tests prove the geometry-window boundary rule, variable-height alignment, ref identity behavior, and tooltip session behavior. Type checking, build, the existing interaction benchmark, the browser renderer protocol, and manual browser/uTools smoke checks all pass.
- [ ] The frontend Trellis spec records the virtual-window ownership boundary, variable-height anchor rule, shared-SVG clipping rule, and tooltip performance contract.

## Out Of Scope

- Changing Git history fetch limits, the `--topo-order` data protocol, preload parsing, or bridge semantics except for an additive, measured renderer test hook if one is required.
- Redesigning ref badges, graph colors, Git action menus, or tooltip content.
- Replacing correct topology with a truncated, approximate, or per-page-only graph.
- Adding a runtime virtualization dependency.
