# Git 提交树与交互性能总体执行计划

## Sequence

1. Start and complete `08-01-git-graph-layout-and-refs`.
   - Implement from its `design.md` and `implement.md`.
   - Run the focused graph/ref checks and full child validation.
   - Complete Trellis quality review, spec judgment and child commit before continuing.
2. Start and complete `08-01-git-interaction-performance`.
   - Capture the pre-change baseline before product edits.
   - Apply only measurement-supported changes and rerun the same scenarios after each slice.
   - Complete Trellis quality review, performance report, spec judgment and child commit.
3. Start and complete `08-01-git-tab-refactor-and-styles`.
   - Move one responsibility at a time using the stabilized contracts from children 1 and 2.
   - Validate after each extraction, then perform desktop/narrow/theme visual checks.
   - Complete Trellis quality review, spec judgment and child commit.
4. Run parent integration review.
   - Re-run all focused Git tests and repository validation scripts.
   - Run type-check and production build.
   - Exercise the original three-lane history, hover preview, stage/unstage, pagination, repository switching and Git controls in browser/uTools-like dimensions.
   - Confirm no child acceptance criterion was weakened by a later child.

## Integration Commands

```powershell
npx vitest run src/lib/gitCommitGraph.test.ts src/lib/gitCommitRefs.test.ts
npm run validate:git-commits
npm run validate:git-workspace
npm run type-check
npm run build
```

The exact focused file names may be adjusted by the child designs, but the parent integration gate must cover graph topology, refs, Store/bridge concurrency and preload syntax.

## Review Gates

- Do not start a later child while the earlier child has uncommitted or unchecked behavior changes.
- If the performance baseline contradicts the planned bottleneck, update child 2 research/design before modifying a different path.
- If extraction requires widening `GitTab`'s public API or adding a bridge contract unrelated to measured performance, return to planning.

## Rollback Points

- Child 1 commit: correct graph/ref baseline.
- Child 2 commit: measured performance baseline.
- Child 3 commit: final component/style structure.
- A parent-level issue should roll back only the owning child commit unless the shared data contract itself is invalid.
