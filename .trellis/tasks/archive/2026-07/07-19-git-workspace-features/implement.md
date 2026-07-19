# Git Repository Context Switching Implementation Plan

## Preconditions

- [ ] Review `prd.md`, `design.md`, and `research/git-workspace-contracts.md`; treat the research document's Git machine-format findings as authoritative but its old overlay/read-only product recommendation as superseded.
- [ ] Confirm the user approved the revised VS Code-style repository-section plan before application-code edits.
- [ ] Because the task pointer may be unavailable, use the explicit task path `.trellis/tasks/07-19-git-workspace-features`.
- [ ] Run `trellis-before-dev` and load the curated implementation contexts before the first source edit.
- [ ] Preserve the current first-implementation changes and unrelated user work; refactor forward without reverting proven parser/validator fixes.

## Ordered Implementation

### 1. Repository Target Contract And Resolver

- [ ] Add `ProjectGitRepositoryTarget` and `ProjectGitRepositoryContext` to `src/types.ts`; keep target state transient and out of `Project` persistence/export contracts.
- [ ] Add pure target equality/context-key helpers with Windows case-insensitive comparison and original display-path preservation.
- [ ] Extend the existing workspace authorization helper in `src/store/useStore.ts` into one resolver for main, available non-bare/non-prunable worktree, and available direct-submodule targets.
- [ ] Reject stale, arbitrary, bare, prunable, missing, unreadable, uninitialized, and unrelated targets before bridge access.
- [ ] Keep `{ kind: "main" }` free of a caller-provided path and preserve existing main-repository behavior for callers that omit a target.
- [ ] Add focused resolver tests in `src/lib/projectBridge.workspace.test.ts`.
- [ ] Immediately run `npm run type-check`; repair only shared-contract/resolver mismatches before continuing.

### 2. Context-Keyed Reads And Snapshot Isolation

- [ ] Add transient related full-snapshot and refresh maps keyed by repository context; preserve `Project.git` as the main snapshot for dashboard compatibility.
- [ ] Convert full/status refresh promises, request generations, mutation versions, and pagination/loading state from project-only keys to context keys.
- [ ] Add one project-wide shared-ref epoch for histories/refs shared by linked worktrees.
- [ ] Make `refreshGitSnapshot`, `refreshGitStatusSnapshot`, `loadMoreGitCommits`, file/commit diff reads, commit-file reads, avatar reads, and commit-message diff reads accept an explicit target.
- [ ] Resolve/re-authorize the target at action start and call existing bridge methods with the exact resulting repository path.
- [ ] Reject responses whose project, context key, request generation, mutation version, or shared-ref epoch no longer matches.
- [ ] Keep related snapshots out of persisted/exported project data and clear them when the project is removed or its path changes.
- [ ] Extend store tests for simultaneous main/worktree/submodule reads, deduplication, same-hash separation, stale response rejection, and path invalidation.
- [ ] Run `npm run validate:git-workspace` immediately after this slice.
- [ ] Run `npm run type-check` before beginning Git writes.

### 3. Target-Aware Git Writes

- [ ] Add the explicit target to stage, unstage, discard, bulk file actions, commit, branch switch, commit checkout, fetch/pull/push, and remote add/edit/remove store actions.
- [ ] Re-authorize every write at action start; GitTab must pass its active target explicitly even where store defaults preserve main-only callers.
- [ ] Keep status-only mutations context-local and bump the project shared-ref epoch for commit, checkout, branch, pull, fetch, and other ref-changing operations.
- [ ] After each successful write, refresh the selected context with the lightest correct snapshot and force-refresh the root workspace inventory.
- [ ] Invalidate other cached histories when shared refs change; do not let a full refresh overwrite newer selected-context status.
- [ ] Keep existing app-rendered confirmations and ensure their dirty-state text comes from the selected repository.
- [ ] Extend focused bridge/store tests to assert exact worktree/submodule repository paths for stage, commit, checkout, and remote operations, plus stale-target rejection before any bridge write.
- [ ] Extend the real Git fixture to execute representative reads/writes against a linked worktree and initialized direct submodule, then assert the main checkout was not mutated accidentally.
- [ ] Run `npm run validate:git-workspace` immediately after this slice.
- [ ] Run `npm run validate:git-diff` and `npm run validate:git-commits` before UI migration.

### 4. GitTab Active Repository Migration

- [ ] Add active typed target, context key, repository-context generation, and computed active snapshot to `GitTab.vue`.
- [ ] Replace all direct `props.project.git`, `store.stagedFiles[project.id]`, and implicit project-path Git action assumptions with active-snapshot/explicit-target access.
- [ ] Rename component-local `WorktreeSelection` to `FileReviewSelection` to separate working-tree diff scope from linked worktrees.
- [ ] On repository switch, save/restore the per-context commit draft; close old-context menus/dialogs/tooltips; clear file/commit review, selection, expansion, pagination, errors, and old async identities; then load the selected snapshot.
- [ ] Key retained commit/detail caches by repository context plus full hash, or clear them on switch.
- [ ] Block repository selection while a Git write action is active.
- [ ] Bind AI analysis and commit-message generation to the originating context key/generation so late output cannot cross repositories.
- [ ] Preserve main-only Files Tab opening; related file review remains in GitTab and external opening uses the repository row actions instead of silently targeting the launcher Files Tab.
- [ ] Run `npm run type-check` immediately after migrating data/action calls, before changing layout.

### 5. Replace Overlay With Top Repository Section

- [ ] Delete `src/components/project/GitWorkspaceOverview.vue` and remove its import, open state, trigger, Escape/focus code, and event wiring from `GitTab.vue`.
- [ ] Refactor the current Git Tab top status bar into one collapsible repository section controlling both existing panes.
- [ ] Keep a fixed-height summary with branch/detached state, change/health status, upstream/Remote state, and the existing top-right fetch/pull/push buttons. Hide repository identity and expansion UI for main-only projects; when related repositories exist, show one compact 12px-chevron-plus-selected-name button with no repository-kind subtitle, decorative glyphs, or summary More action.
- [ ] Render expanded repository rows inline below the summary in a capped themed-scrollbar list: main and linked worktrees at depth 0, direct submodules at depth 1.
- [ ] Keep unavailable/uninitialized/bare/prunable rows visible but unselectable; locked healthy worktrees remain selectable.
- [ ] Make row body selection semantic and keyboard accessible; nested actions stop propagation.
- [ ] Show compact identity/branch/change/health on every row and a row More menu for editor, terminal, folder, copy/view path, and health details; keep refresh out of repository rows.
- [ ] Expose the active-repository refresh method to `ProjectDetails.vue` so its existing header refresh button is the only refresh entry and refreshes both the selected context and root inventory while Git is active.
- [ ] Teleport expanded-row More, Branch, and Remote menus to `body`; clamp them to the viewport and use fade/outside-click/app-Escape conventions. Keep fetch/pull/push in the top-right action group and reserve Remote for configuration/status.
- [ ] Implement conditional visibility and initial expansion: main-only hides the selector/list, first related discovery reveals and expands once, and explicit per-project choice survives refresh/tab/project switches during the renderer session.
- [ ] Implement remembered healthy selected target per project with main fallback after reload or invalidation.
- [ ] Verify the expanded list does not resize or reset the existing split divider and does not starve either pane.
- [ ] Run `npm run type-check` immediately after the UI slice.
- [ ] Run `npm run build` before manual layout checks.

### 6. Validation, Cleanup, And Review

- [ ] Remove dead overlay imports, state, locale keys, tests, comments, and design assumptions.
- [ ] Search production code for forbidden worktree/submodule lifecycle commands and direct component bridge calls.
- [ ] Update `src/lib/projectBridge.workspace.test.ts` and `scripts/validate-git-workspace.mjs` to cover the revised target-aware contracts without weakening existing parser/failure fixtures.
- [ ] Run the exact `trellis-check` agent and repair task-scoped findings.
- [ ] Rerun every focused failure, then the complete command matrix once.

## Focused Automated Matrix

`validate:git-workspace` and its Vitest companion must cover:

- [ ] Existing NUL parsing, unusual paths, worktree health, porcelain-v2 rename/conflict counts, normal untracked-directory entry semantics, direct-only submodules, SHA-1/SHA-256 OIDs, four-worker limit, deadline, and sibling failure isolation.
- [ ] Main target resolution with no caller path.
- [ ] Available linked-worktree and initialized direct-submodule target resolution.
- [ ] Rejection of arbitrary, stale, bare, prunable, missing, unreadable, unrelated-checkout, and unavailable-submodule targets.
- [ ] Context-keyed full/status refresh deduplication and stale-generation rejection.
- [ ] Main/worktree/submodule snapshots for one project remain independent, including equal commit hashes.
- [ ] Stage, commit, checkout, and remote bridge calls receive the exact selected repository path.
- [ ] A stale target triggers zero Git write bridge calls.
- [ ] Successful related writes refresh selected snapshot plus root workspace counts/mismatch.
- [ ] Shared-ref mutation invalidates stale histories without overwriting another checkout's status.
- [ ] Selected-target fallback and first-related auto-expansion helpers where practical.
- [ ] Per-context draft restoration and late AI output isolation where practical.

## Full Command Matrix

```text
node --check public/preload.js
npm run lint
npm run type-check
npm run validate:git-workspace
npm run validate:git-commits
npm run validate:git-diff
npm run test:git-diff
npm run build
git diff --check
```

## Manual UI Smoke

Test browser preview and uTools at normal and host-like narrow sizes in light and dark themes:

- [ ] Main-only starts collapsed; first related discovery expands once; explicit expand/collapse survives refresh and project/tab switches.
- [ ] Main/worktree peer rows and indented direct submodules remain readable with no overlapping labels, badges, or actions.
- [ ] Selecting main, a linked worktree, and an initialized direct submodule atomically switches top metadata, changes, history, diff, expanded details, AI context, and all ordinary Git actions.
- [ ] Commit drafts restore per repository; delayed AI output never overwrites another repository's textarea.
- [ ] Repository selection is disabled during write actions.
- [ ] Stage/unstage/discard/commit/branch/checkout/fetch/pull/push/remote management affect only the selected repository.
- [ ] Missing, uninitialized, bare, prunable, and unreadable entries remain visible but cannot become active.
- [ ] The single project-detail refresh button refreshes the selected repository path; More, Branch, and Remote menus close through outside click/Escape and remain unclipped.
- [ ] Existing split resize, history graph, diff review, commit expansion, confirmations, and main-project Files Tab behavior remain usable.
- [ ] Browser preview exposes no fabricated related repositories or successful local Git actions.

## High-Risk Files

- `src/store/useStore.ts`: target authorization, context-keyed races, mutation/ref epochs, exact write paths.
- `src/components/project/GitTab.vue`: broad migration from implicit main snapshot to active context and dense top-bar geometry.
- `src/types.ts`: shared target contract fan-out.
- `src/lib/projectBridge.workspace.test.ts`: deterministic authorization/race/write-path regression coverage.
- `scripts/validate-git-workspace.mjs`: real multi-repository mutation isolation.
- `public/preload.js`: should remain mostly stable; any change must preserve the proven parser/process contracts.

## Rollback Checkpoints

1. **Target checkpoint**: target types, resolver, and resolver tests form one rollback unit.
2. **Read checkpoint**: related full snapshots and context-keyed read generations can roll back while main `Project.git` remains intact.
3. **Write checkpoint**: target-aware write actions and exact-path tests roll back together; never leave mixed implicit/explicit GitTab calls.
4. **UI checkpoint**: top repository section and active-context migration roll back together; do not restore the old overlay alongside active-context behavior.
5. **Full rollback**: return GitTab/store to main-only routing and remove related selection state. Workspace inventory/parsers may remain only if another visible consumer still uses them.

No rollback requires data migration or Git repair because all new target, snapshot, draft, and layout state is transient.

## Completion Gate

- [ ] AC1-AC12 each map to executable or manual evidence.
- [ ] No unresolved task-scoped `trellis-check` finding remains.
- [ ] No Git read/write action can receive a repository path that was not authorized from the latest project/workspace state.
- [ ] No worktree/submodule lifecycle command, recursive submodule traversal, project identity switch, or automatic project registration entered production code.
- [ ] Related repository paths, snapshots, drafts, and expand/selection state are absent from persisted/exported project data.
- [ ] The final diff has no orphaned overlay code or unrelated refactor churn.
