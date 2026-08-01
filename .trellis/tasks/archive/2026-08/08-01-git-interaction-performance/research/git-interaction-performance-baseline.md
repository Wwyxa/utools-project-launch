# Git Interaction Performance Baseline (Before)

## Command

`npm run benchmark:git-interactions -- --report before`

## Method

- The harness uses only Node.js standard-library modules, creates the real `public/preload.js` in a fresh VM, and proxies its Git child-process APIs plus `readdirSync` and `readFileSync` below the temporary fixture root.
- Each scenario has one fresh-VM/cache-cold sample, one unreported warm-up, and 5 warm samples on the same fixture and VM. Warm medians are the middle of five samples. VM/cache-cold does not claim to flush operating-system filesystem caches.
- The GitHub-shaped remote never contacts a network. `fetch` is an in-VM deterministic stub and its calls are counted separately.
- Stage and unstage time the current foreground-equivalent sequence: write action, then concurrent `readGitStatusSnapshot` and `readGitWorkspaceSnapshot`. Fixture setup and postcondition assertions are excluded from recorded counts and wall time.

## Fixture

- git version 2.55.0.windows.3; a temporary repository initialized with fixture-local `HOME`, global Git identity, `GIT_CONFIG_NOSYSTEM=1`, and fixed author/committer dates.
- Exactly 90 commits: mainline history, a five-commit `feature/fixture` divergence, a real no-fast-forward merge, an old archive branch, a lightweight tag, and an annotated tag.
- A GitHub-shaped `origin` and synthetic upstream refs exist only as local configuration.
- Working tree includes one tracked file with staged and unstaged changes, a staged rename, an unstaged single-file action target, and 25 nested untracked files including a deterministic payload.

## Before Table

| Flow | VM/cache-cold | Raw warm wall samples (ms) | Warm median | UI model and bridge calls | Git child categories | Fixture-local synchronous fs | HTTP |
| --- | ---: | --- | ---: | --- | --- | --- | ---: |
| initial history load | 665.41 ms | 679.29, 687.97, 672.14, 665.84, 720.08 | 679.29 ms | UI model=1 initial refresh; readGitSnapshot=1/679.27 ms | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | 0 |
| initial forced contention model | 1282.05 ms | 1147.67, 1085.51, 1151.61, 1104.55, 1124.93 | 1124.93 ms | UI model=parent plus forced GitTab contender; readGitSnapshot=2/2132.31 ms | git=4, history=2, numstat=4, refs=12, root=6, status=4 | dirs=34, files=50, bytes=141056 | 0 |
| append history page | 298.96 ms | 313.20, 405.54, 314.04, 347.12, 309.02 | 314.04 ms | UI model=1 sentinel edge; readGitCommits=1/314.02 ms | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | 0 |
| tooltip leave before delay | 0.39 ms | 0.01, 0.01, 0.02, 0.01, 0.01 | 0.01 ms | UI model=enter then leave; bridge=0; none | none | dirs=0, files=0, bytes=0 | 0 |
| tooltip cold open | 695.21 ms | 693.79, 695.26, 694.47, 681.43, 703.01 | 694.47 ms | UI model=1 visible tooltip; readGitCommitAuthorAvatar=1/398.95 ms, readGitCommitFiles=1/295.49 ms | detail=2, git=1, refs=1, root=3 | dirs=0, files=0, bytes=0 | 0 |
| tooltip warm A-B-A switch | 1411.62 ms | 1355.74, 1381.51, 1262.45, 1191.65, 1713.39 | 1355.74 ms | UI model=three visible commits; cached A return; readGitCommitAuthorAvatar=2/786.27 ms, readGitCommitFiles=2/569.36 ms | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | 0 |
| tooltip remount same-hash return | 1280.36 ms | 1210.51, 1275.53, 1320.50, 1347.45, 1619.03 | 1320.50 ms | UI model=same hash after component remount; local cache reset; readGitCommitAuthorAvatar=2/734.36 ms, readGitCommitFiles=2/586.06 ms | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | 0 |
| single-file stage | 1353.88 ms | 1619.17, 1514.56, 1497.88, 1452.26, 1426.81 | 1497.88 ms | UI/store model=1 action; foreground status plus workspace; readGitStatusSnapshot=1/706.94 ms, readGitWorkspaceSnapshot=1/1114.42 ms, stageGitFile=1/375.16 ms | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | 0 |
| single-file unstage | 1552.32 ms | 1522.47, 1403.83, 1457.67, 1650.27, 1471.05 | 1471.05 ms | UI/store model=1 action; foreground status plus workspace; readGitStatusSnapshot=1/709.39 ms, readGitWorkspaceSnapshot=1/1102.62 ms, unstageGitFile=1/359.53 ms | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | 0 |

## Raw Samples

### initial history load

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 665.41 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/665.27 ms | 0 |
| warm 1 | 679.29 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/679.27 ms | 0 |
| warm 2 | 687.97 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/687.95 ms | 0 |
| warm 3 | 672.14 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/672.10 ms | 0 |
| warm 4 | 665.84 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/665.81 ms | 0 |
| warm 5 | 720.08 ms | 16 | git=2, history=1, numstat=2, refs=6, root=3, status=2 | dirs=17, files=25, bytes=70528 | readGitSnapshot=1/720.06 ms | 0 |

### initial forced contention model

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 1282.05 ms | 32 | git=4, history=2, numstat=4, refs=12, root=6, status=4 | dirs=34, files=50, bytes=141056 | readGitSnapshot=2/2495.80 ms | 0 |
| warm 1 | 1147.67 ms | 32 | git=4, history=2, numstat=4, refs=12, root=6, status=4 | dirs=34, files=50, bytes=141056 | readGitSnapshot=2/2156.93 ms | 0 |
| warm 2 | 1085.51 ms | 32 | git=4, history=2, numstat=4, refs=12, root=6, status=4 | dirs=34, files=50, bytes=141056 | readGitSnapshot=2/2051.23 ms | 0 |
| warm 3 | 1151.61 ms | 32 | git=4, history=2, numstat=4, refs=12, root=6, status=4 | dirs=34, files=50, bytes=141056 | readGitSnapshot=2/2178.56 ms | 0 |
| warm 4 | 1104.55 ms | 32 | git=4, history=2, numstat=4, refs=12, root=6, status=4 | dirs=34, files=50, bytes=141056 | readGitSnapshot=2/2099.60 ms | 0 |
| warm 5 | 1124.93 ms | 32 | git=4, history=2, numstat=4, refs=12, root=6, status=4 | dirs=34, files=50, bytes=141056 | readGitSnapshot=2/2132.31 ms | 0 |

### append history page

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 298.96 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/298.80 ms | 0 |
| warm 1 | 313.20 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/313.17 ms | 0 |
| warm 2 | 405.54 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/405.52 ms | 0 |
| warm 3 | 314.04 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/314.02 ms | 0 |
| warm 4 | 347.12 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/347.09 ms | 0 |
| warm 5 | 309.02 ms | 5 | history=1, refs=3, root=1 | dirs=0, files=0, bytes=0 | readGitCommits=1/308.99 ms | 0 |

### tooltip leave before delay

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 0.39 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |
| warm 1 | 0.01 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |
| warm 2 | 0.01 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |
| warm 3 | 0.02 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |
| warm 4 | 0.01 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |
| warm 5 | 0.01 ms | 0 | none | dirs=0, files=0, bytes=0 | none | 0 |

### tooltip cold open

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 695.21 ms | 7 | detail=2, git=1, refs=1, root=3 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/393.89 ms, readGitCommitFiles=1/301.12 ms | 1 |
| warm 1 | 693.79 ms | 7 | detail=2, git=1, refs=1, root=3 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/406.07 ms, readGitCommitFiles=1/287.69 ms | 0 |
| warm 2 | 695.26 ms | 7 | detail=2, git=1, refs=1, root=3 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/395.01 ms, readGitCommitFiles=1/300.21 ms | 0 |
| warm 3 | 694.47 ms | 7 | detail=2, git=1, refs=1, root=3 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/398.95 ms, readGitCommitFiles=1/295.49 ms | 0 |
| warm 4 | 681.43 ms | 7 | detail=2, git=1, refs=1, root=3 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/393.76 ms, readGitCommitFiles=1/287.64 ms | 0 |
| warm 5 | 703.01 ms | 7 | detail=2, git=1, refs=1, root=3 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=1/416.78 ms, readGitCommitFiles=1/286.20 ms | 0 |

### tooltip warm A-B-A switch

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 1411.62 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/820.59 ms, readGitCommitFiles=2/590.81 ms | 2 |
| warm 1 | 1355.74 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/786.27 ms, readGitCommitFiles=2/569.36 ms | 0 |
| warm 2 | 1381.51 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/795.81 ms, readGitCommitFiles=2/585.61 ms | 0 |
| warm 3 | 1262.45 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/704.85 ms, readGitCommitFiles=2/557.54 ms | 0 |
| warm 4 | 1191.65 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/688.55 ms, readGitCommitFiles=2/503.02 ms | 0 |
| warm 5 | 1713.39 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/817.48 ms, readGitCommitFiles=2/895.83 ms | 0 |

### tooltip remount same-hash return

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 1280.36 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/722.01 ms, readGitCommitFiles=2/558.01 ms | 1 |
| warm 1 | 1210.51 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/709.45 ms, readGitCommitFiles=2/501.00 ms | 0 |
| warm 2 | 1275.53 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/771.89 ms, readGitCommitFiles=2/503.57 ms | 0 |
| warm 3 | 1320.50 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/734.36 ms, readGitCommitFiles=2/586.06 ms | 0 |
| warm 4 | 1347.45 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/783.37 ms, readGitCommitFiles=2/564.00 ms | 0 |
| warm 5 | 1619.03 ms | 14 | detail=4, git=2, refs=2, root=6 | dirs=0, files=0, bytes=0 | readGitCommitAuthorAvatar=2/923.47 ms, readGitCommitFiles=2/695.46 ms | 0 |

### single-file stage

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 1353.88 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/624.76 ms, readGitWorkspaceSnapshot=1/1009.15 ms, stageGitFile=1/337.94 ms | 0 |
| warm 1 | 1619.17 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/900.98 ms, readGitWorkspaceSnapshot=1/1242.02 ms, stageGitFile=1/370.02 ms | 0 |
| warm 2 | 1514.56 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/679.13 ms, readGitWorkspaceSnapshot=1/1158.56 ms, stageGitFile=1/348.53 ms | 0 |
| warm 3 | 1497.88 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/706.94 ms, readGitWorkspaceSnapshot=1/1114.42 ms, stageGitFile=1/375.16 ms | 0 |
| warm 4 | 1452.26 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/636.83 ms, readGitWorkspaceSnapshot=1/1072.49 ms, stageGitFile=1/371.63 ms | 0 |
| warm 5 | 1426.81 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/665.80 ms, readGitWorkspaceSnapshot=1/1068.88 ms, stageGitFile=1/350.25 ms | 0 |

### single-file unstage

| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |
| --- | ---: | ---: | --- | --- | --- | ---: |
| VM/cache-cold | 1552.32 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/750.65 ms, readGitWorkspaceSnapshot=1/1174.55 ms, unstageGitFile=1/369.98 ms | 0 |
| warm 1 | 1522.47 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/743.16 ms, readGitWorkspaceSnapshot=1/1142.78 ms, unstageGitFile=1/371.38 ms | 0 |
| warm 2 | 1403.83 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/633.52 ms, readGitWorkspaceSnapshot=1/1039.54 ms, unstageGitFile=1/356.24 ms | 0 |
| warm 3 | 1457.67 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/654.24 ms, readGitWorkspaceSnapshot=1/1094.18 ms, unstageGitFile=1/356.43 ms | 0 |
| warm 4 | 1650.27 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/864.79 ms, readGitWorkspaceSnapshot=1/1277.92 ms, unstageGitFile=1/363.93 ms | 0 |
| warm 5 | 1471.05 ms | 22 | git=2, numstat=2, refs=3, root=7, status=4, workspace=3, write=1 | dirs=17, files=25, bytes=70528 | readGitStatusSnapshot=1/709.39 ms, readGitWorkspaceSnapshot=1/1102.62 ms, unstageGitFile=1/359.53 ms | 0 |

## Bottleneck Conclusions

- The stage foreground median sample made 22 Git child processes and readGitStatusSnapshot=1/706.94 ms, readGitWorkspaceSnapshot=1/1114.42 ms, stageGitFile=1/375.16 ms. Its longest bridge operation was `readGitWorkspaceSnapshot` at 1114.42 ms. Bridge operation durations overlap when status and workspace reads run concurrently, so their summed values are diagnostic rather than additive wall time.
- The unstage foreground median sample made 22 Git child processes and readGitStatusSnapshot=1/709.39 ms, readGitWorkspaceSnapshot=1/1102.62 ms, unstageGitFile=1/359.53 ms. Its longest bridge operation was `readGitWorkspaceSnapshot` at 1102.62 ms.
- The append-page median sample made 5 Git child processes, including 3 ref-category calls. Ref reuse is not justified until an optimization reruns this exact fixture and improves the same measurement.
- The A-B-A tooltip session model made 14 Git child processes and readGitCommitAuthorAvatar=2/786.27 ms, readGitCommitFiles=2/569.36 ms. The return to A uses the already-created component-session entry and therefore issues no additional bridge call in that model; leave-before-delay records zero bridge and HTTP work.
- The remount-return tooltip model made 14 Git child processes and readGitCommitAuthorAvatar=2/734.36 ms, readGitCommitFiles=2/586.06 ms. It creates a new component-local detail cache for the same hash, so both detail bridge methods run again after remount.

## Unknowns

- The harness invokes real preload bridge methods but does not mount Vue. It measures one initial full snapshot and a deliberate two-request forced-contention model; whether component scheduling triggers that duplicate in a host session still needs a focused Store/component bridge-spy regression.
- It does not measure rendered-frame latency, actual host browser event timing, linked-worktree/submodule inventory growth, or a selected-file diff reload.
- Antivirus, indexer activity, Git version, and OS cache state can affect absolute times. Compare subsequent optimization runs on this same machine and fixture.

## Narrow Next Optimization

Keep the Git-derived status refresh in the stage/unstage foreground path and move only workspace inventory completion behind the user-visible result, with an explicit background refresh and existing full-refresh recovery.
