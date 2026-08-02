# Git History Renderer Baseline

## Purpose And Limits

This is a local, pre-implementation baseline. It separates three concerns:

1. Git/bridge work, covered by the existing deterministic Node harness.
2. Browser DOM/SVG growth, measured against the actual mounted Vue component.
3. Final user-perceived responsiveness, which needs the same after-change protocol and manual host smoke checks.

Absolute browser times below are development-mode single samples and include browser scheduling. They are directional evidence only. Element counts and mutation observations are the stable baseline evidence.

## Existing Bridge Benchmark

Command run successfully:

```text
npm run benchmark:git-interactions -- --report after
```

The harness uses a temporary local Git repository and a deterministic in-VM fetch stub; it performs no network request. It passed without writing the archived report.

The archived after report documents these relevant invariants:

- A visible cold tooltip has preloaded short stats and makes no `readGitCommitFiles` bridge call.
- A warm A-B-A sequence loads only the two distinct optional avatar entries; returning to A reuses its renderer-session entry.
- A remounted same-hash tooltip retains the session entry.

The existing benchmark deliberately does not mount Vue or measure rendered-frame latency. Its own limitation is stated in `scripts/benchmark-git-interactions.mjs:569-580` and in the archived report's Unknowns section.

## Browser Fixture Protocol

1. Started local Vite only. Port 3421 was already occupied, so this session used `http://localhost:3422/`.
2. Opened the existing Git tab in the local browser preview.
3. Temporarily injected an in-memory `ProjectGitSnapshot` through the mounted Pinia store. No project storage write, application source change, or external connection occurred.
4. Generated `ProjectGitCommitSummary` entries with full 40-character hashes, valid parent references, valid `shortStats`, structured refs, current/upstream/base refs, and one in-window secondary parent every 41 commits.
5. For each history size, measured from replacing that in-memory snapshot until the actual component rendered the expected count of commit rows. Counted graph descendants inside the shared SVG/row container.

## Observed DOM And SVG Growth

| Loaded commits | Rendered commit rows | SVG paths | SVG node groups | Graph container descendants | Scroll content height (px) | Single dev-mode snapshot-to-DOM sample |
| -------------: | -------------------: | --------: | --------------: | --------------------------: | -------------------------: | -------------------------------------: |
|             80 |                   80 |        92 |              80 |                       1,070 |                      2,655 |                               55.20 ms |
|            160 |                  160 |       187 |             160 |                       2,133 |                      5,295 |                              115.60 ms |
|            240 |                  240 |       281 |             240 |                       3,189 |                      7,935 |                              120.10 ms |
|            400 |                  400 |       469 |             400 |                       5,301 |                     13,215 |                              174.30 ms |

The stable conclusion is structural: the rendered rows, graph nodes, paths, and descendants all increase with total loaded commits. `v-memo` does not change that count. The per-sample scroll-to-next-animation-frame values varied from 8.0 ms to 66.3 ms in this development browser, so they must not be represented as an FPS claim.

## Tooltip Isolation Observation

At 400 rendered commits, a cold tooltip opened after the intended 450 ms delay. A warm tooltip switch changed the floating tooltip content while a `MutationObserver` on the complete graph container recorded:

```text
rendered rows: 400
graph mutations during warm hover: 0
```

This directly supports the existing tooltip strategy: the visible tooltip can update without reconciling the graph container. The optimization should preserve it rather than replace it.

## Focused Regression Baseline

Command run:

```text
npx vitest run src/lib/gitCommitGraph.test.ts src/lib/gitCommitRefs.test.ts src/lib/gitCommitTooltipSession.test.ts
```

Result: 24 tests passed; one existing `gitCommitRefs.test.ts` assertion failed. The failing fixture contains an attached `HEAD -> main`, local `main`, and tag `main`; the tag receives a graph color because `gitCommitRefs.ts:145-148` indexes `graphColorByRefName` by bare `ref.name`. The test expects tags not to inherit a local branch color. `git blame` attributes the relevant narrowing behavior to commit `1bc7fc2` on the current branch. This is a reproducible ref correctness defect, not a virtualization result.

## After-Change Measurement Gate

The implementation is accepted only when the same 80/160/240/400+ protocol records:

- rendered commit rows bounded by viewport plus documented finite overscan rather than total loaded commits;
- SVG paths/nodes bounded by the same geometry window, including one preceding/intersecting segment when needed;
- stable total scroll height and graph coordinates after opening/closing/loading an expanded block and after changing list/tree mode;
- no graph-container mutation during warm tooltip A-B-A switching;
- no `readGitCommitFiles` call for valid preloaded short stats in focused tests and the existing interaction benchmark;
- a manual browser/uTools check for scrolling, pagination, merge paths, refs, selected commits, expanded files, and context-menu focus restoration.

## After-Change Renderer Measurements

The same local browser fixture replaced only the in-memory Pinia snapshot and restored it after measurement. It used a 569px history viewport, the production `256px` overscan budget, and sampled the top, middle, and bottom positions for every size. The table records the maximum mounted count across those positions.

| Loaded commits | Max mounted rows | Max SVG paths | Max SVG nodes | Max graph surface descendants | Scroll content height (px) |
| -------------: | ---------------: | ------------: | ------------: | ----------------------------: | -------------------------: |
|             80 |               34 |            38 |            33 |                           446 |                      2,655 |
|            160 |               34 |            38 |            33 |                           446 |                      5,295 |
|            240 |               34 |            38 |            33 |                           446 |                      7,935 |
|            400 |               34 |            38 |            33 |                           446 |                     13,215 |

The prior 400-commit baseline had 400 rows, 469 paths, 400 nodes, and 5,301 graph descendants. The new measurements prove that mounted renderer primitives are bounded by the viewport plus finite overscan while the scroll surface continues to grow with the complete layout.

Additional local browser checks passed:

- Expanding a mounted overscan row above the visible anchor moved `scrollTop` by the 40px inserted block height while retaining the visible row's exact relative position. The same held at the true scroll bottom with zero remaining scroll distance.
- A delayed cold tooltip, warm A-B-A hover sequence, and subsequent owner-window exit produced zero mutations inside the graph surface during hover and closed the tooltip after the owner left the window.
- A context menu opened from a mounted history row and closed after that owner was scrolled out of the virtual window; the former opener was no longer connected, so no focus restoration targeted detached DOM.
- A local screenshot of the middle range showed the merge path continuously clipped through the SVG window with aligned nodes and rows.

## Production Bundle Measurement

An offline detached `HEAD` worktree was built with the current local `node_modules`, then removed. No package was added and no network access was used.

| Asset      |  HEAD raw | Current raw | Delta raw | HEAD gzip | Current gzip | Delta gzip | HEAD Brotli | Current Brotli | Delta Brotli |
| ---------- | --------: | ----------: | --------: | --------: | -----------: | ---------: | ----------: | -------------: | -----------: |
| JavaScript | 929,100 B |   931,824 B |  +2,724 B | 288,728 B |    289,708 B |     +980 B |   234,668 B |      235,182 B |       +514 B |
| CSS        | 123,898 B |   123,898 B |       0 B |  21,125 B |     21,125 B |        0 B |    17,221 B |       17,221 B |          0 B |

The small JavaScript increase comes from local windowing and lifecycle logic. No runtime virtualization dependency or copied VS Code implementation is included in the bundle.
