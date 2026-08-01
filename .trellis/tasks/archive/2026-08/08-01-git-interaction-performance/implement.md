# Git 交互性能执行计划

## Ordered Checklist

1. Add the repeatable benchmark/command recorder.
   - Reuse the real-preload VM and temporary Git repository patterns.
   - Create the 90-commit, branch/merge/tag, tracked/untracked and optional worktree/submodule fixture.
   - Record the pre-change table in `research/git-interaction-performance-baseline.md`.
2. Remove duplicate initial full refresh if observed.
   - Add a Store/bridge-spy regression for simultaneous parent/Git-tab mount.
   - Make the Git tab use the normal in-flight coordinator; keep manual refresh forced.
   - Rerun initial-load measurements.
3. Optimize stage/unstage critical path if confirmed.
   - Add a typed working-tree-only bridge path and Store merge if required by the baseline.
   - Return after Git-derived file correctness; move workspace inventory off the foreground path where safe.
   - Cover rename, untracked, partial-stage, batch and concurrent mutation behavior.
   - Rerun stage/unstage measurements after this slice.
4. Reuse tooltip detail sessions.
   - Add focused timer/request/context tests before moving cache ownership.
   - Preserve cold delay, immediate warm switching and independent avatar/file readiness.
   - Verify tab remount reuse and project/repository cleanup.
5. Optimize history/ref work only if measured.
   - Add explicit ref-epoch invalidation before introducing reuse.
   - Otherwise retain current behavior and document the rejected optimization.
6. Address synchronous untracked scanning only if measured.
   - Preserve exact visible paths and truthful summary semantics.
   - Do not add workers or dependencies.
7. Record the post-change table with the same fixture and protocol.
   - Explain gains, neutral paths, variance and intentionally deferred work.
8. Run final child checks and Trellis review.

## Validation Commands

```powershell
npx vitest run src/lib/projectBridge.workspace.test.ts
npm run validate:git-commits
npm run validate:git-workspace
node --check public/preload.js
npm run type-check
npm run build
```

Add the benchmark command to `package.json` only if it remains useful and deterministic after implementation; otherwise invoke the script directly and keep validation scripts unchanged.

## Decision Gates

- Do not optimize a path whose measured median and command profile are already negligible.
- Do not use a cache without a repository/ref invalidation contract and stale-result test.
- Do not let workspace inventory or optional avatar readiness gate user-visible stage/unstage or local tooltip summary completion.

## Rollback Points

- Baseline harness/report.
- Initial refresh coordination.
- Working-tree refresh boundary.
- Tooltip session cache.
- Optional pagination/untracked scan optimization.
