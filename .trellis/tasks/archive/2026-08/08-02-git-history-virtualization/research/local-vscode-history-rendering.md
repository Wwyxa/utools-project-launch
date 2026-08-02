# Local VS Code SCM History Rendering Research

## Scope

This research uses only local sources in this repository. No network, remote repository, or external documentation lookup was used.

Reviewed project sources:

- `src/components/project/GitCommitHistory.vue`
- `src/lib/gitCommitGraph.ts`
- `src/lib/gitCommitRefs.ts`
- `src/lib/gitCommitTooltipSession.ts`
- their focused Vitest suites and `scripts/benchmark-git-interactions.mjs`

Reviewed local VS Code references:

- `references/vscode/src/vs/workbench/contrib/scm/browser/scmHistoryViewPane.ts`
- `references/vscode/src/vs/workbench/contrib/scm/browser/scmHistory.ts`
- `references/vscode/extensions/git/src/historyProvider.ts`

## Confirmed Current Renderer Path

1. `GitCommitHistory.vue:248-289` filters the loaded snapshot in component state. `GitCommitHistory.vue:502-535` computes one `layoutGitCommitGraph(...)` result for every filtered commit, including expanded-file heights and reference colors.
2. `gitCommitGraph.ts:103-289` is renderer-neutral. It preserves all currently visible topology in ordered lane input/output data, produces row-local semantic segments with global `y` coordinates, and returns the exact canvas height. Expanded blocks are included in each later row coordinate at `gitCommitGraph.ts:240-282`.
3. `GitCommitHistory.vue:511-532` flattens every layout row into `graphPaths` and `graphNodes`. The template renders every path, node, commit row, and expanded-file block at `GitCommitHistory.vue:1752-1952`.
4. Existing `v-memo` at `GitCommitHistory.vue:1792` limits updates to an already-mounted row. It does not limit the number of mounted row, SVG-path, or SVG-node elements.
5. Pagination is data-safe but renderer-unbounded. `useStore.ts:2614-2654` serializes a page append, uses the current loaded count as `skip`, and appends an 80-item page only when the repository context and snapshot length are still current. `GitCommitHistory.vue:1313-1336` drives it through an observer sentinel.
6. Tooltip state is already intentionally narrow. `GitCommitHistory.vue:839-904` replaces one visible detail state; `gitCommitTooltipSession.ts:1-126` owns a 120-hash bounded repository/session promise cache. Valid preloaded short stats skip the file loader at `gitCommitTooltipSession.ts:81-92`.
7. Reference semantics are structured. `gitCommitRefs.ts:111-204` classifies structured refs, folds attached HEAD into a matching local branch, and uses one label plus icon/count groups. Virtualization must retain this exact input/output data rather than infer refs from display text or graph color.

## Local VS Code Findings

### Full Model, Virtual Row Lifetime

VS Code builds the complete history item view-model array after every loaded-page update. `scmHistoryViewPane.ts:1260-1323` appends a provider page, computes graph colors and merge-base inputs, then calls `toISCMHistoryItemViewModelArray(...)`. The list is nevertheless hosted in `WorkbenchCompressibleAsyncDataTree` at `scmHistoryViewPane.ts:1990-2025`, which uses `ListDelegate` with a fixed row height at `scmHistoryViewPane.ts:410-423`.

The item renderer demonstrates the lifecycle contract that is relevant here:

- `renderTemplate(...)` creates a reusable row shell at `scmHistoryViewPane.ts:461-474`.
- `renderElement(...)` updates that shell and attaches the delayed hover only while the row is rendered at `scmHistoryViewPane.ts:476-518`.
- `disposeElement(...)` clears row-owned hover and markdown disposables at `scmHistoryViewPane.ts:638-641`.
- `disposeTemplate(...)` destroys the reusable shell only when the list no longer needs it at `scmHistoryViewPane.ts:643-646`.

This supports adopting a viewport window and an explicit unmount lifecycle for this project. It does not mean copying VS Code's internal tree/list implementation into Vue.

### Graph Computation And Rendering Difference

VS Code's `toISCMHistoryItemViewModelArray(...)` retains input/output swimlanes for every history item at `scmHistory.ts:299-404`. It renders each displayed row with a small row-local SVG at `scmHistory.ts:124-275`; extra change rows use a lane placeholder at `scmHistoryViewPane.ts:692-746`.

This project instead uses one shared, absolute SVG whose segment coordinates are global. The useful observation is that current project segments remain row-local: `gitCommitGraph.ts:248-261` produces a segment only from that row's top/node/output positions. A segment can cross an expanded-file block, but no generated segment jumps directly across arbitrary future rows. Therefore a windowed shared SVG can preserve continuity by rendering every segment whose geometric `[min(from.y, to.y), max(from.y, to.y)]` intersects the SVG viewport window. SVG clipping can trim the endpoints outside that window without changing the underlying lane model.

### Hover And Reference Semantics

VS Code attaches its delayed hover during row rendering, not to an all-history reactive map (`scmHistoryViewPane.ts:476-486`). Its provider returns short statistics and structured refs with each history item (`historyProvider.ts:250-331`), and classifies local, remote, tag, and attached HEAD refs structurally (`historyProvider.ts:491-539`). The existing project already follows the same broad boundary: short stats are loaded with commits in `public/preload.js:4938-5037`, and structured refs flow through `presentGitCommitRefs(...)`.

Do not move tooltip details into the virtual-list state. Keep the existing visible-tooltip ref and session cache, but close the floating tooltip when its owner leaves the rendering window or the graph scrolls. This matches the current scroll cleanup at `GitCommitHistory.vue:1388-1403`.

## Architecture Options

| Option                                                                    | Benefits                                                                                                                 | Rejected / retained risks                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Virtualize only commit rows; retain full shared SVG                       | Smallest row-DOM reduction and lowest topology risk                                                                      | SVG paths/nodes still grow with loaded history, so the final DOM bound and long-history paint goal are not met.                   |
| Virtualize rows and window the shared SVG by row index                    | Reduces both sources of accumulated DOM                                                                                  | Incorrect around expanded blocks and a window boundary because a previous row's output segment can enter the visible pixel range. |
| Virtualize rows and window the shared SVG by global geometry intersection | Keeps the complete layout and total scroll height while bounding rows, paths, and nodes to viewport plus finite overscan | Requires a pure window-selection helper, scroll/resize measurement, and explicit anchor handling for variable heights.            |

Recommended architecture: option three.

## Proposed Contracts

1. `layoutGitCommitGraph(...)` remains the only topology and global-coordinate authority for every loaded filtered commit. It must not be sliced before lanes, parents, ref colors, or total height are calculated.
2. A pure graph-window selector receives global layout plus `scrollTop`, viewport height, and a pixel overscan budget. It returns visible row records, nodes whose center lies within the overscan window, and segments whose bounding y-range intersects the overscan window.
3. The template keeps one full-height positioned content surface. Window rows and expanded blocks are absolutely positioned from the layout's global row top; the shared SVG is positioned over the same global coordinate system with a clipped `viewBox` matching the SVG window.
4. Variable-height updates capture the top visible commit hash and its local pixel offset before changing expanded-file/tree state. After Vue flushes the new layout, restore that anchor if the commit remains loaded. Append-only pagination does not need an anchor correction because it changes only the tail.
5. Window movement closes tooltip and context-menu ownership if their row is about to unmount. Focus restoration must test `opener.isConnected` before attempting to focus a recycled/removed row.
6. The bounded tooltip session continues to own reusable promises. Virtual-window updates must not create a reactive per-hash detail map or call `readGitCommitFiles` for valid short stats.

## Compatibility Risks To Test

- A segment from the preceding commit can pass through a visible expanded block; index-only SVG filtering would drop it.
- A segment touching an SVG boundary must be included and clipped, not discarded by a strict `>` comparison.
- A selected or expanded commit outside the window must keep state by hash and rehydrate correctly when it re-enters.
- Pagination must preserve the current scroll offset and observer behavior without re-mounting historical rows.
- A context-menu opener may be unmounted while its floating menu is open; restore focus only to a connected element.
- Current/upstream/base and attached HEAD semantics must remain passed through the existing structured ref presentation helper.
- `gitCommitRefs.test.ts` currently exposes an adjacent correctness issue: `graphColorByRefName` keys by bare name, so a tag named `main` can inherit the local branch's graph color. This is a pre-implementation baseline failure and must be fixed narrowly or explicitly excluded before the focused suite can pass.
