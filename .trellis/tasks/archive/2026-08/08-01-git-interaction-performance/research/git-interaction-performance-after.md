# Git Interaction Performance After

## Command

`npm run benchmark:git-interactions -- --report after`

## Scope

- This post-change measurement includes parent/GitTab initial snapshot coordination, the existing post-write working-tree path, and tooltip preloaded-summary/renderer-session reuse. The independent before report remains `research/git-interaction-performance-baseline.md`.
- Visible tooltip summaries come from the already-loaded history result; only optional avatar enrichment remains, with no per-hover `readGitCommitFiles` work.
- The coordinated parent/GitTab model makes 16 Git children through readGitSnapshot=1/676.14 ms; the historical forced two-request model remains in `--report before`.
- Initial snapshot work beyond this coordination, pagination ref enumeration, and rendered-frame latency remain outside this slice.

## Method

- The harness uses only Node.js standard-library modules, creates the real `public/preload.js` in a fresh VM, and proxies its Git child-process APIs plus `readdirSync` and `readFileSync` below the temporary fixture root.
- Each scenario has one fresh-VM/cache-cold sample, one unreported warm-up, and 5 warm samples on the same fixture and VM. Warm medians are the middle of five samples. VM/cache-cold does not claim to flush operating-system filesystem caches.
- The GitHub-shaped remote never contacts a network. `fetch` is an in-VM deterministic stub and its calls are counted separately.
- Stage and unstage time the post-write foreground path: write action, start workspace inventory in the background, then await `readGitWorkingTreeSnapshot`. The sample is captured before the background inventory settles, though counters can include work it already started.
- Tooltip scenarios load one history page before the measured interval, select commits from that result, and validate their preloaded `shortStats`. A visible tooltip then runs only the optional avatar bridge call; it does not run per-hover `readGitCommitFiles`.

## Fixture

- git version 2.55.0.windows.3; a temporary repository initialized with fixture-local `HOME`, global Git identity, `GIT_CONFIG_NOSYSTEM=1`, and fixed author/committer dates.
- Exactly 90 commits: mainline history, a five-commit `feature/fixture` divergence, a real no-fast-forward merge, an old archive branch, a lightweight tag, and an annotated tag.
- A GitHub-shaped `origin` and synthetic upstream refs exist only as local configuration.
- Working tree includes one tracked file with staged and unstaged changes, a staged rename, an unstaged single-file action target, and 25 nested untracked files including a deterministic payload.

## After Table

| Flow | VM/cache-cold | Raw warm wall samples (ms) | Warm median | UI model and bridge calls | Git child categories | Fixture-local synchronous fs | HTTP |
| --- | ---: | --- | ---: | --- | --- | --- | ---: |
| initial history load | 450.41 ms | 445.33, 457.20, 459.91, 464.68, 491.66 | 459.91 ms | UI model=1 initial refresh; readGitSnapshot=1/459.89 ms | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | 0 |
| initial coordinated parent/GitTab model | 451.71 ms | 475.36, 654.41, 676.21, 678.05, 682.06 | 676.21 ms | UI/store model=parent plus GitTab joins one initial request; readGitSnapshot=1/676.14 ms | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | 0 |
| append history page | 359.68 ms | 259.17, 286.04, 283.73, 308.63, 252.47 | 283.73 ms | UI model=1 sentinel edge; readGitCommits=1/283.71 ms | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | 0 |
| tooltip leave before delay | 0.32 ms | 0.04, 0.04, 0.07, 0.04, 0.05 | 0.04 ms | UI model=loaded-history commit enters then leaves before delay; bridge=0; none | none | dirs=0, files=0, bytes=0 | 0 |
| tooltip cold open | 337.52 ms | 311.88, 362.45, 334.17, 328.89, 429.72 | 334.17 ms | UI model=1 visible tooltip; preloaded shortStats; optional avatar only; readGitCommitAuthorAvatar=1/334.15 ms | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | 0 |
| tooltip warm A-B-A switch | 668.71 ms | 672.46, 611.34, 668.77, 631.33, 664.92 | 664.92 ms | UI model=three visible commits; preloaded shortStats; renderer-session cached A avatar return; readGitCommitAuthorAvatar=2/664.86 ms | git=2, refs=2, root=4 | dirs=0, files=0, bytes=0 | 0 |
| tooltip remount same-hash return | 312.66 ms | 358.30, 309.89, 322.59, 315.68, 308.85 | 315.68 ms | UI model=same hash after component remount; preloaded shortStats; renderer-session avatar reuse; readGitCommitAuthorAvatar=1/315.65 ms | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | 0 |
| single-file stage | 561.02 ms | 742.78, 570.87, 535.74, 528.16, 513.08 | 535.74 ms | UI/store model=1 action; foreground working-tree, workspace background; readGitWorkingTreeSnapshot=1/267.53 ms, readGitWorkspaceSnapshot=1/272.68 ms, stageGitFile=1/263.04 ms | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | 0 |
| single-file unstage | 629.43 ms | 507.73, 491.28, 539.48, 544.00, 535.26 | 535.26 ms | UI/store model=1 action; foreground working-tree, workspace background; readGitWorkingTreeSnapshot=1/236.67 ms, readGitWorkspaceSnapshot=1/242.28 ms, unstageGitFile=1/292.94 ms | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | 0 |

## Before / After Comparison

- Before medians are read from the preserved pre-change report; after medians are generated by this invocation using the same documented fixture and protocol. They are not simultaneous samples, so command/bridge/filesystem counts remain the causal evidence and time-only changes on unchanged models are host variance.
- Delta is `after - before`; a negative value is faster.

| Flow | Before warm median | After warm median | Delta | Interpretation |
| --- | ---: | ---: | ---: | --- |
| initial history load | 679.29 ms | 459.91 ms | -219.38 ms (-32.3%) | No deliberate model change; treat timing delta as host variance. |
| initial coordinated parent/GitTab model | 1124.93 ms | 676.21 ms | -448.72 ms (-39.9%) | One request replaces the forced duplicate model. |
| append history page | 314.04 ms | 283.73 ms | -30.31 ms (-9.7%) | No deliberate model change; treat timing delta as host variance. |
| tooltip leave before delay | 0.01 ms | 0.04 ms | not meaningful (<0.05 ms) | No deliberate model change; treat timing delta as host variance. |
| tooltip cold open | 694.47 ms | 334.17 ms | -360.30 ms (-51.9%) | Preloaded short stats make the summary ready immediately; only optional avatar work remains. |
| tooltip warm A-B-A switch | 1355.74 ms | 664.92 ms | -690.82 ms (-51.0%) | Each visible summary is preloaded, while the A return reuses the renderer-session avatar entry. |
| tooltip remount same-hash return | 1320.50 ms | 315.68 ms | -1004.82 ms (-76.1%) | Preloaded summary needs no file read, and the renderer-session avatar entry survives component remount. |
| single-file stage | 1497.88 ms | 535.74 ms | -962.14 ms (-64.2%) | Foreground uses the working-tree snapshot; workspace inventory is background work. |
| single-file unstage | 1471.05 ms | 535.26 ms | -935.79 ms (-63.6%) | Foreground uses the working-tree snapshot; workspace inventory is background work. |

## Raw Samples

### initial history load

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 450.41 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/450.24 ms | 0 |
| warm 1 | 445.33 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/445.31 ms | 0 |
| warm 2 | 457.20 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/457.17 ms | 0 |
| warm 3 | 459.91 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/459.89 ms | 0 |
| warm 4 | 464.68 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/464.67 ms | 0 |
| warm 5 | 491.66 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/491.65 ms | 0 |

### initial coordinated parent/GitTab model

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 451.71 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/451.43 ms | 0 |
| warm 1 | 475.36 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/475.32 ms | 0 |
| warm 2 | 654.41 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/654.38 ms | 0 |
| warm 3 | 676.21 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/676.14 ms | 0 |
| warm 4 | 678.05 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/678.01 ms | 0 |
| warm 5 | 682.06 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/682.03 ms | 0 |

### append history page

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 359.68 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/359.51 ms | 0 |
| warm 1 | 259.17 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/259.14 ms | 0 |
| warm 2 | 286.04 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/286.02 ms | 0 |
| warm 3 | 283.73 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/283.71 ms | 0 |
| warm 4 | 308.63 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/308.61 ms | 0 |
| warm 5 | 252.47 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/252.45 ms | 0 |

### tooltip leave before delay

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 0.32 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |
| warm 1 | 0.04 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |
| warm 2 | 0.04 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |
| warm 3 | 0.07 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |
| warm 4 | 0.04 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |
| warm 5 | 0.05 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |

### tooltip cold open

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 337.52 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/337.30 ms | 1 |
| warm 1 | 311.88 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/311.86 ms | 0 |
| warm 2 | 362.45 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/362.43 ms | 0 |
| warm 3 | 334.17 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/334.15 ms | 0 |
| warm 4 | 328.89 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/328.87 ms | 0 |
| warm 5 | 429.72 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/429.70 ms | 0 |

### tooltip warm A-B-A switch

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 668.71 ms | 8 | git=2, refs=2, root=4 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/668.31 ms | 2 |
| warm 1 | 672.46 ms | 8 | git=2, refs=2, root=4 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/672.37 ms | 0 |
| warm 2 | 611.34 ms | 8 | git=2, refs=2, root=4 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/611.28 ms | 0 |
| warm 3 | 668.77 ms | 8 | git=2, refs=2, root=4 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/668.72 ms | 0 |
| warm 4 | 631.33 ms | 8 | git=2, refs=2, root=4 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/631.28 ms | 0 |
| warm 5 | 664.92 ms | 8 | git=2, refs=2, root=4 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/664.86 ms | 0 |

### tooltip remount same-hash return

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 312.66 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/312.49 ms | 1 |
| warm 1 | 358.30 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/358.26 ms | 0 |
| warm 2 | 309.89 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/309.85 ms | 0 |
| warm 3 | 322.59 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/322.57 ms | 0 |
| warm 4 | 315.68 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/315.65 ms | 0 |
| warm 5 | 308.85 ms | 4 | git=1, refs=1, root=2 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/308.82 ms | 0 |

### single-file stage

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 561.02 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/281.49 ms, readGitWorkspaceSnapshot=1/287.65 ms, stageGitFile=1/273.21 ms | 0 |
| warm 1 | 742.78 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/464.52 ms, readGitWorkspaceSnapshot=1/472.38 ms, stageGitFile=1/270.35 ms | 0 |
| warm 2 | 570.87 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/299.90 ms, readGitWorkspaceSnapshot=1/306.08 ms, stageGitFile=1/264.76 ms | 0 |
| warm 3 | 535.74 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/267.53 ms, readGitWorkspaceSnapshot=1/272.68 ms, stageGitFile=1/263.04 ms | 0 |
| warm 4 | 528.16 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/255.26 ms, readGitWorkspaceSnapshot=1/260.60 ms, stageGitFile=1/267.55 ms | 0 |
| warm 5 | 513.08 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/240.03 ms, readGitWorkspaceSnapshot=1/246.37 ms, stageGitFile=1/266.68 ms | 0 |

### single-file unstage

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 629.43 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/348.74 ms, readGitWorkspaceSnapshot=1/354.11 ms, unstageGitFile=1/275.18 ms | 0 |
| warm 1 | 507.73 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/242.17 ms, readGitWorkspaceSnapshot=1/247.12 ms, unstageGitFile=1/260.59 ms | 0 |
| warm 2 | 491.28 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/236.24 ms, readGitWorkspaceSnapshot=1/241.78 ms, unstageGitFile=1/249.48 ms | 0 |
| warm 3 | 539.48 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/268.96 ms, readGitWorkspaceSnapshot=1/275.01 ms, unstageGitFile=1/264.43 ms | 0 |
| warm 4 | 544.00 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/264.80 ms, readGitWorkspaceSnapshot=1/269.92 ms, unstageGitFile=1/274.05 ms | 0 |
| warm 5 | 535.26 ms | 11 | numstat=2, root=6, status=2, write=1 | dirs=17, files=25, bytes=70528 | readGitWorkingTreeSnapshot=1/236.67 ms, readGitWorkspaceSnapshot=1/242.28 ms, unstageGitFile=1/292.94 ms | 0 |

## Bottleneck Conclusions

- The coordinated parent/GitTab initial-request median sample made 16 Git child processes and readGitSnapshot=1/676.14 ms. Both callers share one bridge request; the unchanged before model remains two `readGitSnapshot` calls and 32 Git children.

- The stage foreground median sample made 11 Git child processes and readGitWorkingTreeSnapshot=1/267.53 ms, readGitWorkspaceSnapshot=1/272.68 ms, stageGitFile=1/263.04 ms. Its longest bridge operation was `readGitWorkspaceSnapshot` at 272.68 ms. Bridge operation durations overlap when status and workspace reads run concurrently, so their summed values are diagnostic rather than additive wall time.
- The unstage foreground median sample made 11 Git child processes and readGitWorkingTreeSnapshot=1/236.67 ms, readGitWorkspaceSnapshot=1/242.28 ms, unstageGitFile=1/292.94 ms. Its longest bridge operation was `unstageGitFile` at 292.94 ms.
- The append-page median sample made 5 Git child processes, including 3 ref-category calls. Ref reuse is not justified until an optimization reruns this exact fixture and improves the same measurement.
- The cold tooltip summary comes from the preloaded history record; its visible-card enhancement made 4 Git child processes and readGitCommitAuthorAvatar=1/334.15 ms, with no per-hover `readGitCommitFiles` bridge call.
- The A-B-A tooltip session model made 8 Git child processes and readGitCommitAuthorAvatar=2/664.86 ms. Each visible summary is preloaded; the return to A reuses the renderer-session avatar entry without additional bridge work.
- The remount-return tooltip model made 4 Git child processes and readGitCommitAuthorAvatar=1/315.65 ms. A new component instance reuses the renderer-session avatar entry while its summary remains preloaded.


## Unknowns

- The harness invokes real preload bridge methods but does not mount Vue. Focused renderer-session tests cover the delayed start, remount reuse, and stale-context rejection; whether component scheduling triggers the deliberate initial full-snapshot contention model still needs a focused Store/component bridge-spy regression.
- It does not measure rendered-frame latency, actual host browser event timing, linked-worktree/submodule inventory growth, or a selected-file diff reload.
- Antivirus, indexer activity, Git version, and OS cache state can affect absolute times. Compare subsequent optimization runs on this same machine and fixture.

## Narrow Next Optimization

This report includes parent/GitTab initial snapshot coordination, the post-write working-tree foreground path, and tooltip preloaded-summary/session reuse. Pagination ref enumeration and rendered-frame latency remain unoptimized in this slice.
