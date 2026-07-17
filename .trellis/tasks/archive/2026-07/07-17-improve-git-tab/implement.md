# Git Tab Review Flow Implementation Plan

## Preconditions

- User reviews and approves `prd.md`, `design.md`, and this plan.
- Continue the existing `in_progress` task; do not create a second task or commit unless the user asks.
- After approval, refresh implementation context and dispatch the exact `trellis-implement` agent with the active task path.

## Baseline

- [x] Scope-aware staged/unstaged/combined diff contract is implemented and validated.
- [x] Shared `GitDiffViewer` and pure parser are implemented; parser tests and real Git validation pass.
- [x] Current separate mode row, worktree groups, history detail/diff levels, tooltip, checkout, and both AI paths are located in `GitTab.vue`.
- [x] Re-run focused tests, type-check, and build before the follow-up edit; record any unrelated baseline failures.
- [x] Capture the current Git Tab at normal and compact widths for direct spacing/interaction comparison.

## 1. Compact List and Integrated Toolbar

- [x] Omit the staged group only when the unfiltered staged file list is empty; preserve zero-match search feedback when staged files exist.
- [x] Fix search icon/input spacing with an explicit component-owned left inset.
- [x] Remove previous/next buttons from the left change-list header while retaining keyboard and review-toolbar navigation.
- [x] Remove the separate right-context tab row and move Commit Tree / Review mode controls into the left side of the existing toolbar, Commit Tree first and default.
- [x] Render history actions and review actions on the toolbar right side according to the active mode.
- [x] Run type-check immediately after the first state/template edit, then build and inspect normal/compact toolbar fit.

Rollback point: restore only the previous toolbar shell; list fixes are independent.

## 2. Inline Commit Files and Shared Review

- [x] Replace `historyLevel` and detail-only selection state with one `expandedCommitHash`, inline file state, loading/error state, and request-generation guard.
- [x] Make commit row click toggle inline changed files; keep checkbox click isolated to AI selection.
- [x] Render compact loading, empty/error, and changed-file rows directly below the owning commit.
- [x] Replace worktree-only review selection with a discriminated worktree/commit selection and route both through the existing shared viewer.
- [x] Make historical file click switch to Review and preserve graph scroll, expanded commit, filters, and checkbox selection when returning.
- [x] Remove the dedicated commit detail/history diff markup, back-navigation functions, and dead state.
- [x] Run type-check and build; exercise rapid row switching to verify stale file reads cannot populate the wrong expansion.

Rollback point: inline expansion can be reverted without changing historical read APIs or the shared viewer.

## 3. Interactive Commit Metadata and Checkout

- [x] Anchor tooltip placement to the hovered commit target, add open/close grace timers, and allow pointer entry into the teleported card.
- [x] Render full author, relative/absolute time, refs, title/body, text selection, and copy-message action without displaying hash.
- [x] Close tooltip on delayed leave, Escape, project change, and unmount.
- [x] Add a viewport-clamped commit-row context menu opened only by right click with checkout as its only write action; do not add a hover/persistent action button and keep the checkbox AI-only.
- [x] Generalize checkout labels/guards to accept the menu commit while preserving existing execute/force-confirm code.
- [x] Close the context menu on outside pointer, Escape, invocation, project change, and unmount.
- [x] Run type-check/build and browser-check tooltip pointer transfer, scroll bounds, context-menu bounds, clean checkout, and dirty confirmation.

Rollback point: the floating card and context menu are independent of inline expansion and can be reverted separately.

## 4. Unified Worktree and Selected-Commit AI

- [x] Remove single-commit AI state, prompt builder, generation handler, menu state, and detail panel.
- [x] Keep one AI trigger: with no selected commit, open worktree analysis and show “未选择提交，将分析当前工作区变更”; with selections, show a concise selected-count scope hint.
- [x] Build selected-history context from each selected commit's metadata and `readGitCommitFiles` result.
- [x] Serialize every selected commit message and metadata before diff allocation; when Diff is enabled, read historical file diffs sequentially under one global 14,000-character budget.
- [x] If historical diff exceeds the budget, preserve every selected commit message and show “Diff 已截断，所有提交信息已保留” in the dialog without replacing the AI result.
- [x] Remove current worktree file/diff sections from selected-commit analysis while preserving AI modes, streaming, copy, and error states.
- [x] Preserve the existing bounded worktree file/diff path when no commit is selected.
- [x] Run type-check/build and inspect generated prompts for no selection, one commit, multiple commits, Diff off, truncation, and read failures.

## 5. Full Validation and Review

- [x] Run `npm run test:git-diff` and any new Git bridge validation script.
- [x] Run `node --check public/preload.js`.
- [x] Run `npm run type-check` and `npm run build`.
- [x] Run the exact `trellis-check` agent with `check.jsonl` context and fix in-scope findings.
- [x] Browser smoke test normal and compact host-like widths: integrated toolbar, search spacing, conditional staged group, inline expansion, shared review, tooltip interaction, context menu, AI guards, and no overlapping/unreachable controls.
- [ ] uTools smoke test real repositories: staged-only, unstaged-only, same-file mixed scope, untracked, deleted, renamed, binary, empty diff, historical file diff, rapid commit expansion, stage/unstage/discard migration, clean/dirty checkout, worktree/selected-commit AI, and remote regression. Pending a real uTools host repository.
- [x] Compare final behavior against every PRD acceptance criterion and record any manual-only residual risk.

## Files Expected to Change

- `src/components/project/GitTab.vue`
- `.trellis/tasks/07-17-improve-git-tab/prd.md`
- `.trellis/tasks/07-17-improve-git-tab/design.md`
- `.trellis/tasks/07-17-improve-git-tab/implement.md`
- No bridge/type/preload changes are expected unless implementation reveals a missing historical-read contract.

## Review Gates

- Do not let filtered/collapsed UI state determine batch write scope.
- Do not duplicate worktree and historical diff rendering.
- Do not let row expansion toggle checkbox selection or vice versa.
- Do not append current worktree diff to selected historical commit analysis.
- Do not bypass existing checkout dirty-worktree confirmation or detached-HEAD/local-branch behavior.
- Do not regress graph selection/filtering, commit message AI, remotes, or dangerous-action confirmation.
- Do not report completion without executable parser, preload syntax, type-check and build validation.
