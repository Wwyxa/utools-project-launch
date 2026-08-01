# Technical Design: Git Workspace And Commit Preview

## Scope and Boundaries

The main change stays in `src/components/project/GitTab.vue`, with focused tooltip and section styling in `src/index.css` and removal of locale keys that become unused in `src/lib/i18n.ts`. It does not change the Git bridge, Pinia pagination contract, commit model, Markdown renderer, avatar lookup, `GitDiffViewer`, or `useResizableSplit`.

Keep the worktree, commit graph, inline historical file list, context menus, AI actions, and interactive preview in `GitTab.vue`. Their state already shares repository context, selection, request generations, and graph geometry; splitting new components would move code without reducing ownership complexity.

## Layout Architecture

Keep the existing horizontal split and its renderer-session width memory:

```text
Git split container
  |- left source-control pane
  |    |- Changes section header (32px)
  |    |    `- expanded body
  |    |         |- commit message input
  |    |         `- staged / unstaged secondary groups
  |    `- Commit Tree section header (32px)
  |         `- filters + graph scroll viewport + load sentinel
  `- right review pane
       `- GitDiffViewer or compact empty state
```

Remove `RightContext`, `rightContext`, tab keyboard handling, the right mode header, and all assignments that switch from history to review. The header-only previous/next worktree-file controls and their now-unused navigation helper are removed rather than relocated. Worktree and historical file selection continue to update their existing selection/diff state; the right pane renders that state directly, and `GitDiffViewer` keeps its own hunk navigation.

The left pane is one shared surface with section dividers, not nested cards. Section headers use a left chevron/title/count group and a right-aligned icon action group. The current outer rounded split-pane shell may remain; individual rows and sections do not gain additional framed containers.

## Collapse and Height Model

Use two primary local booleans:

- `changesSectionOpen`: controls the whole Changes body;
- `commitTreeSectionOpen`: controls filters, graph, inline commit files, and pagination sentinel.

Existing `stagedGroupOpen` and `unstagedGroupOpen` are direct secondary state below `changesSectionOpen`. Closing a parent does not mutate any child state. The commit textarea starts at 40px, grows from `scrollHeight` to 144px, and remeasures whenever the horizontal split's `firstSize` changes.

Do not add a vertical resize handle. Use flex constraints:

- when both primary sections are open, Changes is shrinkable and capped near 45% of the left pane while Commit Tree owns the remaining `flex: 1` space;
- if Commit Tree is closed, Changes may use all available body height;
- if Changes is closed, Commit Tree uses all remaining height;
- the worktree list and graph keep separate `overflow-y-auto` scrollports.

The exact cap may use nearby utility values rather than a persisted numeric preference. Collapse state is component-local and survives ordinary interactions while `GitTab` remains mounted; no project or local-storage schema is added.

## Header Actions

Changes header:

- AI commit-message generation (`WandSparkles`);
- discard all changed files (`Undo`), with the existing destructive confirmation;
- commit staged changes (`Check`);
- existing loading, disabled, title, and `aria-label` contracts.

Direct staged/unstaged rows:

- remain independently collapsible but use smaller, quieter text and action icons than primary headers;
- staged rows provide bulk unstage and unstaged rows provide bulk stage; the global discard action stays in the Changes header because it acts on both scopes.

Commit Tree header:

- selected count as compact metadata;
- select all visible and clear selection;
- filter toggle;
- AI analysis;
- commit-file list/tree toggle.

Delete scroll-to-top and scroll-to-bottom controls and remove their now-unused locale keys. Do not replace them with another navigation control.

## Compact Commit Rows

Remove the selection and hash grid tracks. The visible row uses graph width plus one content track:

```text
graph lanes | commit title + compact refs
```

Keep a low-contrast author and relative-time line below the subject; full hash, absolute timestamp, body, and summary move to the preview. Keep graph coordinates and the shared SVG unchanged except for the reduced row grid offset/width calculations.

Rows are flat list bands: no per-row border box, rounded card, or selection ring. Hover and selected states use background and, if needed, one subtle inset start-edge marker. HEAD warning keeps semantic color without restoring a framed card.

One row click handler owns the distinction:

```text
event.ctrlKey || event.metaKey
  -> prevent row expansion and toggle commit selection
otherwise
  -> toggle inline commit files
```

Nested file, context-menu, and ref/hash replacement controls continue stopping propagation where they already own the click. No Shift selection is introduced.

## Interactive Preview

Retain the already implemented preview state machine and actual-size observation:

```text
closed -> row enter -> 450ms -> open
open/closing -> another row enter -> immediate commit replacement
row and card leave -> 180ms -> closed
```

Moving the graph to the left reverses only the horizontal placement contract. Read `graphScrollRef.getBoundingClientRect().right` as `graphRight`:

```text
panelGap      = 8
viewportInset = 12
maxWidth      = min(384, viewportWidth - graphRight - panelGap - viewportInset)
maxHeight     = min(400, viewportHeight - 2 * viewportInset)
left          = graphRight + panelGap

rowCenter      = (rowTop + rowBottom) / 2
renderedHeight = min(measuredHeight, maxHeight)
top            = clamp(rowCenter - renderedHeight / 2,
                       viewportInset,
                       viewportHeight - renderedHeight - viewportInset)
```

There is no placement fallback. The card grows rightward over the review pane, stays fixed horizontally while users move through commits, and uses the existing `ResizeObserver` to settle after wrapping or asynchronous details.

Put a short hash at the start of the footer beside the change summary. Clicking the hash copies the full hash and stops propagation; do not render a separate hash-copy icon or a copy-message action. Preserve author/avatar/time, Markdown, summary, refs, internal-scroll, Escape, context reset, and stale-request behavior.

## Automatic Pagination

Replace the button with one stable-height sentinel at the end of the graph content. Observe it with native `IntersectionObserver`:

```text
root: graphScrollRef
rootMargin: 0px 0px 120px 0px
threshold: 0
```

When an entry becomes intersecting and `hasMoreCommits && !isLoadingMore`, call the existing `handleLoadMore`. Store-level promise deduplication remains the second guard.

The observer does not manually re-observe or recursively call after a page resolves. This produces at most one request per intersection entry and prevents a client-side filter with few matches from automatically pulling the entire repository history. Appending visible rows moves the sentinel below the viewport; normal scrolling causes the next entry.

Keep the sentinel mounted at a fixed compact height so loading state does not add/remove layout height. Show only a centered small spinner while `isLoadingMore`; never render button text or an end-of-history card. Existing rows retain hash keys, and page data appends below them, so Vue reuses their DOM and `scrollTop` remains unchanged. Do not animate inserted rows or replace the list with a loading shell.

Create/disconnect the observer when graph/sentinel refs, repository context, section visibility, or component lifetime changes. Collapsing the Commit Tree disconnects observation. Repository reset keeps the store's existing stale-page guards.

## Viewport and Lifecycle

Keep existing app Escape, repository/project reset, and unmount cleanup. External scroll, window resize, or collapsing Commit Tree closes the preview. Scroll originating inside the preview body remains exempt.

Removing `rightContext` must also remove state resets, focus movement, and conditionals that only served mode switching. It must not remove review selection, diff request generations, or review scroll restoration.

## Compatibility and Rollback

- No dependency, bridge, store-contract, persistence, or migration changes.
- Existing uncommitted preview work is adapted, not discarded.
- Rollback boundaries are: layout/right-context removal, compact rows/modifier selection, pagination sentinel, and preview horizontal relocation. Each can be reviewed independently in the final diff.
- The prior right-mode architecture is not retained as a hidden fallback.

## Verification Strategy

Run `npm run lint` and `npm run build`, then inspect normal, compact, and minimum-left-pane layouts.

Verify:

- Changes, staged/unstaged, and Commit Tree collapse independently without state loss; the secondary rows remain visibly weaker than the primary headers;
- right review stays mounted while worktree and historical files change;
- Ctrl/Cmd click changes selection only, ordinary click expands only, and nested controls retain behavior;
- graph lanes/nodes remain aligned after removing selection/hash tracks and after inline file expansion;
- the first preview waits, warm row switching is immediate, the footer short hash copies the full hash without a duplicate copy button, and actual-size bounds hold at top/middle/bottom rows;
- the fixed sentinel triggers one 80-commit append near the bottom, keeps its height during loading, preserves `scrollTop`, and triggers again only after the user reaches the new bottom;
- filters, repository switches, section collapse, external scroll, Escape, resize, and unmount leave no stale preview, observer, or pagination result.
