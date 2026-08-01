# Git 交互性能设计

## Measurement First

Add a standard-library-only performance harness derived from the existing real-preload VM validators. It creates a deterministic temporary repository, proxies Git child-process calls and fixture-local synchronous filesystem calls, and reports bridge calls, command categories and durations.

The harness records one cache/VM-cold sample and at least five warm samples, reporting the median and individual samples. It never performs network access; avatar fetch is stubbed.

Persist the before/after table in this task's `research/` directory. Product edits begin only after the initial table is recorded.

## Target Flows

- First 80-commit snapshot.
- One appended commit page.
- Tooltip leave-before-delay, cold open, adjacent warm switch, same-hash return and component remount.
- Single-file stage and unstage, with status refresh, workspace inventory and optional diff reload timed separately.

## Working-Tree Refresh Boundary

If the baseline confirms stage/unstage is dominated by status metadata and workspace inventory, introduce a narrow working-tree snapshot contract rather than optimistic UI state.

```text
git write
   |
   v
fresh porcelain + unstaged/staged numstat
   |
   v
merge only files/status summary into current repository snapshot
   |
   +--> return user-visible action result
   `--> refresh workspace inventory in background when relevant
```

The full status snapshot remains responsible for branch, HEAD, ahead/behind, local branches, remotes and upstream. The full snapshot/manual refresh remains the authoritative recovery path.

Implementation may add a typed `ProjectGitWorkingTreeSnapshot` and `readGitWorkingTreeSnapshot` bridge method if the measured critical path justifies it. The browser fallback, shared type, Store merge and preload implementation move together.

Fresh Git output remains authoritative for rename, untracked, partial staging and concurrent external changes. No stage/unstage action guesses the resulting row state.

## Initial Refresh Coordination

The Store remains the single in-flight coordinator. The Git tab must not force a second full snapshot merely because the parent refresh has not published its result yet. A missing snapshot requests the normal deduplicated refresh; manual refresh alone forces replacement.

## Tooltip Session Cache

Move successful/loading/unavailable commit detail state into a bounded module-scoped renderer-session map keyed by repository `contextKey` and full hash, while keeping the currently visible tooltip and timers component-local.

- Start details only after the cold-open delay displays the card.
- Reuse in-flight and settled detail state for warm switches and tab remounts.
- Reject late updates by context and request generation.
- Clear all entries with the old project prefix on project replacement/reset.
- Prune unreachable hashes and cap retained entries to avoid unbounded renderer-session growth.
- Keep avatar optional and independent from local file summary readiness.

## History And Ref Work

The benchmark decides whether pagination ref enumeration merits a cache.

- If ref work is material, cache only structured refs keyed by repository context plus an explicit Store ref epoch.
- Invalidate on internal ref mutation, manual forced refresh, repository change and detected external refresh.
- Do not cache complete status snapshots or use TTL as proof that refs are current.
- If `git log` dominates and ref work is negligible, leave pagination ref enumeration unchanged and record that decision.

## Synchronous Untracked Scanning

Measure directory calls, file reads and bytes. If confirmed material, switch porcelain to enumerate individual untracked files and move exact per-file enrichment off the synchronous preload loop while preserving the visible file set and Git-derived staged state. Any representation change for unknown untracked additions must be explicit in types and UI tests; silently displaying fabricated totals is not allowed.

## Test And Failure Model

- Store tests assert exact bridge calls and foreground/background completion order.
- Real-preload harness asserts command categories and filesystem work.
- Tooltip tests assert timers, request deduplication, remount reuse and context rejection.
- Full manual refresh repairs any narrow-cache or external-change uncertainty.

## Rollback

- Keep measurement harness and report even if a candidate optimization is rejected.
- Apply initial refresh, working-tree refresh, tooltip cache and pagination changes as separate validated slices.
- A slice that does not improve the same benchmark or weakens correctness is reverted without affecting other slices.
