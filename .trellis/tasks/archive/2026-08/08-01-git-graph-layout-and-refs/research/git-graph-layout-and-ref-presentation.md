# Research: Git Graph Layout and Ref Presentation

- **Query**: Research the current `graphLayout` / `refPresentation` path in `GitTab.vue`, compare it with the local VS Code SCM graph and Git history provider, identify falsifiable causes for the three-to-two-lane and global text-spacing regressions, and define Vue adaptation boundaries, preserved contracts, minimal fixtures, and validation points.
- **Scope**: Internal only; application source plus the checked-in local VS Code reference tree.
- **Date**: 2026-08-01

## Findings

### Files Found

| File Path                                                                      | Description                                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `src/components/project/GitTab.vue`                                            | Current filtering, graph layout, SVG rendering, per-commit expansion, pagination, and ref presentation |
| `src/types.ts`                                                                 | Full-hash commit, structured ref, remote, and upstream contracts                                       |
| `public/preload.js`                                                            | Authoritative structured ref collection and topological commit loading                                 |
| `src/store/useStore.ts`                                                        | Pagination append and stale-load protection                                                            |
| `scripts/validate-git-commits.mjs`                                             | Real-Git validation for full parents and structured refs                                               |
| `references/vscode/src/vs/workbench/contrib/scm/browser/scmHistory.ts`         | VS Code input/output swimlane transition, row graph rendering, row width, and ref priority             |
| `references/vscode/src/vs/workbench/contrib/scm/browser/scmHistoryViewPane.ts` | VS Code row consumption and ref badge grouping                                                         |
| `references/vscode/extensions/git/src/historyProvider.ts`                      | VS Code Git ref classification and category ordering                                                   |

### Current Data Path

1. The preload reads `git log --all --topo-order` with full `%H` / `%P` hashes and attaches `refNames` built separately from full ref namespaces (`public/preload.js:4765-4815`, `public/preload.js:4820-4876`).
2. The component filters the loaded commit array by date, author, and text; `graphLayout` consumes this filtered array, not the unfiltered snapshot (`src/components/project/GitTab.vue:361-382`, `src/components/project/GitTab.vue:3528-3531`).
3. The current layout owns one `activeLanes: Array<string | null>`, one lane per row node, and deferred child-to-parent edges (`src/components/project/GitTab.vue:3489-3499`, `src/components/project/GitTab.vue:3528-3630`).
4. The template renders one list-level SVG over all loaded rows, while every row uses one global graph grid width (`src/components/project/GitTab.vue:3660-3680`, `src/components/project/GitTab.vue:4885-4948`).
5. Dense rows and the hover preview both call the same local ref presentation path, with structured `refNames` preferred over legacy `refs` (`src/components/project/GitTab.vue:3288-3374`, `src/components/project/GitTab.vue:4952-4968`, `src/components/project/GitTab.vue:5708-5719`).

### 1. Falsifiable Root Causes

#### Three lanes collapse to two

The root cause is the current lane state model, not SVG curve geometry.

- `findLane()` is `activeLanes.indexOf(hash)`, so a future commit hash can occupy at most one lane (`src/components/project/GitTab.vue:3551`).
- The current node lane is cleared before parents are installed (`src/components/project/GitTab.vue:3588-3594`).
- If a parent hash is already active, the algorithm reuses that lane; for a first parent to the right, it explicitly clears that lane and moves the parent into the current lane (`src/components/project/GitTab.vue:3597-3612`).
- The output therefore cannot represent the same target hash twice. Duplicate target lanes are required while two visible paths approach the same future commit.
- Deferred paths only connect each commit node to its visible parent node. There is no row-level contract for every bypass lane (`src/components/project/GitTab.vue:3632-3655`).

A minimal falsifier is the newest-to-oldest sequence below. `F3` is feature HEAD ahead of a main merge `M`; `M` has parents `M2` and `F2`.

| Row  | Commit parents | VS Code-style input | Required output | Current active state after row |
| ---- | -------------- | ------------------- | --------------- | ------------------------------ |
| `F3` | `F2`           | `[]`                | `[F2]`          | `[F2]`                         |
| `M`  | `M2, F2`       | `[F2]`              | `[F2, M2, F2]`  | `[F2, M2]`                     |
| `M2` | `B`            | `[F2, M2, F2]`      | `[F2, B, F2]`   | `[F2, B]`                      |
| `F2` | `F1`           | `[F2, B, F2]`       | `[F1, B]`       | `[F1, B]`                      |
| `F1` | `B`            | `[F1, B]`           | `[B, B]`        | `[B]`                          |
| `B`  | none           | `[B, B]`            | `[]`            | `[]`                           |

VS Code deliberately preserves duplicate ids. It clones the previous row's output into the next input, replaces the first occurrence of the current commit with its first parent, removes further occurrences, preserves every bypass node in order, and appends unprocessed parents (`references/vscode/src/vs/workbench/contrib/scm/browser/scmHistory.ts:309-352`). Its renderer uses the first current-id input as the node lane and curves later duplicate occurrences into that node (`references/vscode/src/vs/workbench/contrib/scm/browser/scmHistory.ts:132-201`).

**Disconfirming check**: a focused test is sufficient to falsify this diagnosis. If the current layout can produce output ids `[F2, M2, F2]` and a three-lane span on row `M`, despite `findLane(indexOf)` and the unique-hash active array, this root-cause claim is wrong. Static inspection shows it cannot.

#### Global text spacing

The root cause is direct and independent of the missing-lane issue.

- `maxLane` accumulates the maximum lane seen anywhere in the filtered page (`src/components/project/GitTab.vue:3534`, `src/components/project/GitTab.vue:3589`, `src/components/project/GitTab.vue:3621`).
- One page-wide `columnWidth` is derived from that maximum (`src/components/project/GitTab.vue:3660-3662`).
- Every row then consumes that same width through `graphRowColumns`, and expanded details use it for padding too (`src/components/project/GitTab.vue:3679-3680`, `src/components/project/GitTab.vue:4928-4934`, `src/components/project/GitTab.vue:4986-4999`).

VS Code instead sizes each history-item SVG from that row's `max(inputSwimlanes.length, outputSwimlanes.length, 1)` (`references/vscode/src/vs/workbench/contrib/scm/browser/scmHistory.ts:271-272`).

**Disconfirming check**: place a one-lane row and a three-lane merge row in one fixture. Their content starts are currently equal; the intended model makes the one-lane row narrower by exactly two lane steps while retaining a canvas wide enough for the three-lane row.

### 2. Vue Adaptation

#### Swimlane state

Adapt the VS Code state transition into a Vue-independent pure TypeScript layout function; do not copy its DOM, theme registry, Observable, incoming/outgoing synthetic nodes, or tree renderer.

Each row should retain at least:

- `inputSwimlanes` and `outputSwimlanes` as ordered lane records `{ id, color }`; duplicate `id` values are valid.
- `nodeLane`, derived from the first matching input occurrence or `inputSwimlanes.length` when the commit is not already active (`references/vscode/src/vs/workbench/contrib/scm/browser/scmHistory.ts:132-140`).
- row-local path segments for bypass verticals, lane shifts, duplicate convergence, first-parent continuation, additional-parent fan-out, and root termination.
- `graphWidth`, `y`, and the original commit.

Use the filtered visible hash set as a boundary. Preserve original parent indices, but only add a parent lane or edge when that exact parent hash is visible. This keeps an in-window bypass such as the existing `F2` lane while refusing to invent `M2` or `F1` nodes outside a filtered/page window. It also preserves the current no-phantom-edge behavior at `src/components/project/GitTab.vue:3594-3596`.

HEAD placement should prefer the exact `snapshot.headHash`, with structured `kind: "head"` / `head: true` only as a fallback. The contract already exposes `headHash` and structured head metadata (`src/types.ts:400-417`, `src/types.ts:420-429`). This retains a stable left-side mainline without hard-coding `origin/<branch>` as the identity test.

#### Shared SVG and per-row width

Keep the existing list-level shared SVG contract. Translate each row-local segment into list coordinates using that row's `y`/top offset. The canvas width is `max(row.graphWidth)`, but the row grid's first track is `row.graphWidth`, not the canvas maximum.

The row width should be based on the actual row span:

`max(input.length, output.length, nodeLane + 1, 1)` lane steps plus the existing horizontal padding/minimum.

This is the Vue equivalent of VS Code's per-row SVG width (`references/vscode/src/vs/workbench/contrib/scm/browser/scmHistory.ts:271-272`) while preserving the project's shared SVG rule.

Keep `rowHeight = 32`, `rowGap = 1`, and the current accumulated expanded height (`src/components/project/GitTab.vue:3379-3383`, `src/components/project/GitTab.vue:3588`, `src/components/project/GitTab.vue:3627`, `src/components/project/GitTab.vue:3662`). When a commit has expanded details, continue every output lane vertically through the interval from the commit row bottom to the next row top. The same row model must drive row DOM position, SVG segment endpoints, expanded detail padding, and total canvas height.

#### Ref sorting and grouping

Keep classification authoritative and structured:

- `refNames` first; parse comma-separated `refs` only as compatibility fallback (`src/components/project/GitTab.vue:3346-3349`).
- Keep kind-driven capabilities and display. The preload already preserves comma-containing names, peels annotated tags to the target commit, and emits exact head/local/remote/tag records (`public/preload.js:4765-4815`).
- Never copy VS Code Git's special suppression of `refs/remotes/origin/HEAD` at `references/vscode/extensions/git/src/historyProvider.ts:491-500`; this project's contract requires symbolic remote HEAD refs to remain remote data and never become current HEAD.

Apply a stable presentation sort:

1. exact current HEAD;
2. exact current upstream remote (`snapshot.upstream.remote/branch` or normalized `snapshot.upstream.ref`; contract at `src/types.ts:365-371`);
3. other refs carrying the row's graph color;
4. remaining refs, stably ordered by local, remote, tag, unknown, then name.

This adapts VS Code's current/remote/base/colored priority (`references/vscode/src/vs/workbench/contrib/scm/browser/scmHistory.ts:532-554`) and Git category ordering (`references/vscode/extensions/git/src/historyProvider.ts:21-38`) without inventing a base-ref contract that this project does not currently expose.

For compact rendering, sort before grouping. Group metadata may use `(graphColor, icon)` as VS Code does (`references/vscode/src/vs/workbench/contrib/scm/browser/scmHistoryViewPane.ts:518-555`), with the first important colored ref retaining its name and grouped members retaining all names for `title`/tooltip. The minimal compatible rendering should keep the current stricter behavior: hide the local duplicate of the HEAD label, show one real remote branch with text, keep symbolic/additional remotes as individually titled icon badges, and keep unrelated local branches and tags visible (`src/components/project/GitTab.vue:3350-3373`). Count-based collapsing is optional under the PRD; it is not required for the first minimal change.

The dense row and hover preview must consume the same sorted structured model. Dense output may compact it; hover output must expose every member (`src/components/project/GitTab.vue:4952-4968`, `src/components/project/GitTab.vue:5708-5719`).

### 3. Existing Contracts to Preserve

- Full commit and parent object ids must stay directly comparable; root commits keep `parents: []` (`src/types.ts:408-417`, `scripts/validate-git-commits.mjs:75-85`).
- Real preload data must use structured `refNames`; legacy `refs` remains fallback only. Comma names and peeled annotated tags must remain intact (`public/preload.js:4765-4803`, `scripts/validate-git-commits.mjs:86-103`).
- Exact HEAD semantics: `remote/HEAD`, `origin/HEAD`, and custom `fork/HEAD` are remote refs, not HEAD nodes (`src/components/project/GitTab.vue:3279-3288`).
- The layout input remains the component's filtered visible commit list; the pure layout does not own search/filter state (`src/components/project/GitTab.vue:361-382`).
- Pagination remains store-owned and appends only after context/ref-version/stale-length checks; layout recomputes from the resulting visible list (`src/store/useStore.ts:2499-2536`).
- The load sentinel remains outside the SVG loaded-row container, so paths do not cross it (`src/components/project/GitTab.vue:4885-4894`, `src/components/project/GitTab.vue:5104-5118`).
- Keep one list-level pointer-transparent SVG, fixed pixel row height, horizontal scrolling, and one y-coordinate model for rows plus any number of expanded file blocks (`src/components/project/GitTab.vue:4876-4913`, `src/components/project/GitTab.vue:3478-3484`, `src/components/project/GitTab.vue:4982-4999`).
- Preserve row interactions: Ctrl/Cmd toggles selection; plain click/Enter/Space toggles files; context menu and delayed hover remain component-owned (`src/components/project/GitTab.vue:2810-2816`, `src/components/project/GitTab.vue:4938-4945`).
- Preserve per-hash expanded-file state, request-generation stale-result protection, list/tree visible-item height, and pruning on commit replacement (`src/components/project/GitTab.vue:2537-2589`, `src/components/project/GitTab.vue:2596-2737`, `src/components/project/GitTab.vue:3243-3251`).
- Keep Lucide icons and project semantic tokens; do not import VS Code theme or icon services (`src/components/project/GitTab.vue:3288-3344`).

### 4. Minimal Regression Fixtures

Use tiny plain commit objects with full-looking but readable fixture ids mapped to hashes. Assert ordered lane ids separately from colors so topology failures remain obvious.

| Fixture, newest to oldest                                            | Minimum assertions                                                                                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear + root: `A(B), B()`                                           | `A: [] -> [B]`; `B: [B] -> []`; both nodes stay lane 0; root has no output segment                                                                                    |
| Ordinary fork: `A(B), C(B), B(R), R()`                               | `C: [B] -> [B,B]`; `B` consumes both duplicates and converges once; no early compaction                                                                               |
| Merge: `M(A,B), A(R), B(R), R()`                                     | `M: [] -> [A,B]`; first parent continues from node, second parent fans out; `B: [R,B] -> [R,R]`                                                                       |
| Three-lane regression: `F3(F2), M(M2,F2), M2(B), F2(F1), F1(B), B()` | Exact table in section 1; `M.output === [F2,M2,F2]`; row span is 3; one-lane rows have a smaller `graphWidth`                                                         |
| Octopus merge: `O(A,B,C), A(R), B(R), C(R), R()`                     | `O.output === [A,B,C]`; three parent segments retain original parent indices; duplicates converge at `R` without lane loss                                            |
| Page boundary: visible `A(OUT)` only                                 | `OUT` creates no output lane, node, or path; canvas ends before the sentinel                                                                                          |
| Filtered window: visible `F3(F2), M(M2,F2), F2(F1)`                  | `M: [F2] -> [F2,F2]`; the visible second parent keeps `parentIndex: 1`; no synthetic `M2`/`F1` node or edge                                                           |
| Expanded rows                                                        | Expanding two nonadjacent hashes shifts every later row/node/segment by the sum of their exact visible-item heights; collapsing either reverses only its contribution |

Minimal ref fixtures:

- Structured `HEAD -> master`, local `master`, remote `origin/HEAD`, remote `origin/master`, and tag `master`, with upstream `origin/master`: exactly one HEAD node; HEAD sorts first, upstream second; dense output retains the established four-badge behavior; full tooltip contains all five refs.
- One remote `origin/develop`: it remains a full cloud + label badge.
- Custom `fork/HEAD`: remote styling only, never HEAD styling.
- Local/tag names containing commas and an annotated tag: structured names remain whole; no fallback splitting is invoked.
- Legacy-only `refs`: classification remains neutral unless existing branch/remote evidence identifies it; exact `HEAD` / `HEAD -> name` is the only legacy HEAD match.

### Validation Points

Focused Vitest for the extracted pure modules should assert:

- exact input/output lane id arrays, including duplicate ids;
- node lane and path semantic kinds, including bypass, shift, fan-out, convergence, vertical continuation, and root termination;
- original parent index preservation when only a non-first parent is visible;
- no path/node for an out-of-window parent;
- deterministic colors for retained lanes, without testing literal theme colors;
- `row.graphWidth` from that row only and `canvasWidth === max(row.graphWidth)`;
- shared y geometry before/after multiple expanded rows;
- ref sort order, duplicate-HEAD suppression, remote symbolic handling, compact titles/member retention, and full tooltip completeness.

Executable project checks already available:

- focused graph/ref Vitest (`vitest run <new focused test files>`; existing direct pure-module style at `src/lib/gitDiff.test.ts:1-14`);
- `npm run validate:git-commits` for real Git full-parent and structured-ref boundaries (`package.json:15`, `scripts/validate-git-commits.mjs:75-103`);
- `npm run type-check` and `npm run build` (`package.json:13-14`).

Manual DOM geometry checks should compare a one-lane row beside a three-lane row, verify content starts immediately after each row's actual graph span, expand multiple commits, append a page, apply a filter, and assert that rows, nodes, paths, badges, horizontal overflow, hover, and the sentinel do not overlap or drift.

### Related Specs

- `.trellis/spec/frontend/component-guidelines.md` — compact Git rows, continuous shared SVG, exact row geometry, structured ref classification, compact ref behavior, expanded details, selection, context menu, and hover contracts.
- `.trellis/spec/frontend/type-safety.md` — full parent hashes and structured Git commit ref boundary.
- `.trellis/spec/frontend/quality-guidelines.md` — focused type/build and dense-panel visual validation expectations.
- `.trellis/spec/guides/code-reuse-thinking-guide.md` — one shared presentation helper for dense rows and hover.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — preserve the preload/type/store/component data boundary.

### External References

None. The requested VS Code evidence was taken only from the checked-in local `references/vscode/` source tree.

## Caveats / Not Found

- No existing graph-layout or ref-presentation focused test/module was found; both helpers currently live only inside `GitTab.vue`.
- Trellis reported no globally active task via `task.py current --source`. This research uses the user-specified `.trellis/tasks/08-01-git-graph-layout-and-refs` directory without changing task state.
- The local VS Code source is treated as a reference snapshot; no claim is made about newer upstream VS Code behavior.
