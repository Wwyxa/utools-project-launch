# Git 提交图布局与引用徽标设计

## Design Goals

- Model topology explicitly enough to preserve duplicate target lanes.
- Keep graph calculation deterministic and testable without Vue or DOM.
- Retain the existing list-level SVG and expanded-row coordinate system.
- Let each row reserve only its own active graph width.
- Keep structured ref semantics separate from Vue icons and CSS classes.

## Pure Graph Contract

Add `src/lib/gitCommitGraph.ts` with domain-local graph types and one public layout function.

```ts
type GitGraphLane = { id: string; colorIndex: number };

type GitGraphRow = {
  commit: ProjectGitCommitSummary;
  inputLanes: GitGraphLane[];
  outputLanes: GitGraphLane[];
  nodeLane: number;
  graphWidth: number;
  y: number;
};

type GitGraphLayout = {
  rows: GitGraphRow[];
  paths: GitGraphPath[];
  nodes: GitGraphNode[];
  canvasWidth: number;
  height: number;
};
```

The exact exported names may follow nearby conventions, but outputs stay semantic and serializable. Literal SVG colors are supplied by the renderer from deterministic `colorIndex` values.

### Row Transition

For commits in newest-to-oldest visible order:

1. Clone the previous row's `outputLanes` into this row's `inputLanes`; duplicate ids are valid and ordered.
2. Find the first input lane whose id equals the current commit. If absent, place the node after the current inputs.
3. Walk every input lane in order.
   - On the first current-id occurrence, replace it with the visible first parent and retain the lane color.
   - Drop later current-id occurrences so they converge into the same node.
   - Copy every non-current bypass lane unchanged.
4. Append visible unprocessed parents in original parent order, assigning deterministic colors.
5. Produce row-local semantic segments for bypass, lane shift, convergence, first-parent continuation and non-first-parent fan-out.
6. Translate row-local coordinates to the shared SVG y model after expanded-row heights are known.

Only exact parent hashes present in the filtered visible set become output parents. This preserves real in-window bypass lanes without inventing off-window nodes or edges.

### Width And Coordinates

- `row.graphWidth` uses `max(inputLanes.length, outputLanes.length, nodeLane + 1, 1)` plus the shared lane/padding constants.
- `layout.canvasWidth` is the maximum row width and sizes only the shared SVG canvas.
- The row grid uses its own `row.graphWidth`; expanded details use the owning row's content start.
- `rowHeight`, `rowGap`, expanded detail heights and row y values remain one fixed-pixel contract.
- Output lanes continue vertically through any expanded detail block before entering the next commit row.

## Ref Presentation Contract

Add `src/lib/gitCommitRefs.ts`. The pure module accepts structured refs plus known branch, remote, upstream and HEAD context. It returns semantic values such as kind, label, identity, priority, grouping key, current/head flags and complete member names.

It must not import Vue `Component`, Lucide icons, Tailwind class strings or theme colors. `GitTab.vue` maps semantic kinds to existing icons and token classes.

### Ordering

1. Exact current HEAD.
2. Exact current upstream/remote.
3. Refs associated with the row graph color.
4. Remaining local, remote, tag and unknown refs in stable name order.

### Dense Compaction

- Hide a local branch only when the HEAD badge already displays the same branch.
- Keep one representative real remote branch labeled before symbolic `*/HEAD` refs.
- Preserve every additional remote member in the compact model with an individual title or grouped count.
- Keep unrelated local branches and tags visible.
- Hover presentation expands every original ref, including members compacted in the dense row.

Legacy comma-split refs remain fallback only. Structured names containing commas and peeled annotated tags never pass through legacy parsing.

## Vue Integration

- Replace only the inline graph/ref calculations in `GitTab.vue`; do not split the history component in this child.
- Keep one pointer-transparent shared SVG and existing row interaction handlers.
- Compute `gridTemplateColumns` and row minimum width from `row.graphWidth` instead of the global canvas width.
- Keep the load sentinel outside the loaded-row SVG container.
- Use the same ref output for dense badges, context data and hover refs; compact only at the rendering boundary.

## Validation Design

`src/lib/gitCommitGraph.test.ts` covers exact input/output lane ids, duplicate ids, node lane, segment kinds, parent indices, row width and expanded y offsets.

`src/lib/gitCommitRefs.test.ts` covers structured priority, duplicate HEAD suppression, one/many remotes, custom remote HEAD, comma names, tags and legacy fallback.

The first implementation edit is the failing three-lane fixture. Its cheap discriminating assertion is `mergeRow.outputLanes.map(id) === [F2, M2, F2]` and a three-lane row span.

## Compatibility And Rollback

- No bridge or persisted type change is expected.
- `ProjectGitCommitSummary` remains the input type.
- If integration fails, the pure modules and tests can remain while the renderer temporarily uses the old layout; do not keep both algorithms active in production.
