# Git Repository Context Switching Design

## Summary

Replace the first implementation's teleported workspace overview with a VS Code Source Control-style repository section built into the existing Git Tab top bar. The main repository, linked worktrees, and direct submodules become selectable Git contexts. The selected context drives both existing panes and every ordinary Git read/write action while the launcher `Project` identity remains unchanged.

```text
GitTab active repository target
  -> Pinia target resolver and context-keyed state
  -> typed ProjectBridge / browser fallback
  -> public/preload.js argv-only Git commands
  -> exact selected repository path
```

The existing workspace snapshot reader remains the authoritative relationship inventory. This revision changes how that inventory is presented and how the selected path flows through the existing Git feature set; it does not add worktree/submodule lifecycle commands.

## Superseded First Implementation

Remove the following first-implementation UI path:

- `src/components/project/GitWorkspaceOverview.vue`;
- the Git top-bar workspace icon trigger;
- teleported dialog state, focus restoration, Escape handling, and overlay navigation emits;
- the assumption that related repositories are only read-only status/navigation entries.

Keep and extend:

- `ProjectGitWorkspaceSnapshot` and its worktree/submodule inventory;
- `readGitWorkspaceSnapshot(projectPath)` in the bridge/fallback/preload;
- NUL-aware parsers, four-worker limit, entry deadlines, bounded stderr, and partial-failure behavior;
- focused real-Git fixtures in `scripts/validate-git-workspace.mjs`;
- transient workspace refresh state and external path navigation helpers.

## Shared Repository Target Contract

Add a closed target union in `src/types.ts`:

```ts
export type ProjectGitRepositoryTarget =
  | { kind: "main" }
  | { kind: "worktree"; path: string }
  | { kind: "submodule"; path: string };

export interface ProjectGitRepositoryContext {
  target: ProjectGitRepositoryTarget;
  repositoryPath: string;
  contextKey: string;
}
```

Rules:

- Components pass a typed target, never an arbitrary repository path.
- `{ kind: "main" }` contains no caller-controlled path and resolves from the current project/workspace snapshot.
- Related targets carry the exact absolute path returned by the latest workspace snapshot.
- `contextKey` is internal transient identity, not persistence data. It combines project ID, target kind, and the authorized snapshot path without relying on user-visible labels.
- Target equality uses kind plus platform-aware normalized absolute path. On Windows, comparison is case-insensitive; display preserves Git's original path spelling.
- Bare, prunable, missing/unreadable worktrees and non-available submodules cannot resolve to an active context.

`ProjectBridge` Git methods continue accepting an absolute repository input path. Authorization belongs in Pinia, while preload remains authoritative for canonical Git-root resolution and path safety.

## Workspace Inventory And Display Model

The existing `ProjectGitWorkspaceSnapshot` remains separate from full `ProjectGitSnapshot` data.

Display rows are derived, not persisted:

```ts
export interface ProjectGitRepositoryRow {
  target: ProjectGitRepositoryTarget;
  repositoryPath: string;
  kind: "main" | "worktree" | "submodule";
  depth: 0 | 1;
  name: string;
  selectable: boolean;
  selected: boolean;
  head: ProjectGitHeadState;
  changes: ProjectGitChangeCounts | null;
  upstream: ProjectGitUpstreamState | null;
  health: "healthy" | "warning" | "unavailable";
  statusText: string;
}
```

Derivation rules:

- Main repository and linked worktrees use `depth: 0` and appear as peer rows.
- Direct submodules use `depth: 1` beneath the main row.
- Only available non-bare, non-prunable worktrees and `checkout === "available"` direct submodules are selectable.
- Locked but otherwise available worktrees remain selectable because lock prevents removal, not normal work in that checkout.
- Unavailable entries stay visible with health/status details and no Git actions.
- Row identity/path comes first; branch/detached state, counts, health, and current-row actions remain compact and truncation-safe.

No recursive submodule inventory is added. A linked worktree is not rendered as the parent of the main checkout's direct submodules.

## Pinia Ownership

### Existing Main Snapshot Compatibility

`Project.git` remains the main repository snapshot because dashboard recency and existing project consumers depend on it. Main-target refreshes continue updating `Project.git` and its lightweight persisted recency metadata.

Related full snapshots stay transient:

```ts
gitRepositorySnapshots: Record<string, ProjectGitSnapshot | undefined>;
gitRepositoryRefreshing: Record<string, boolean>;
gitRepositoryStatusRefreshing: Record<string, boolean>;
```

The store exposes one accessor that returns `project.git` for the main target and the context-keyed map for related targets. No related snapshot enters project persistence, import/export, or dashboard metadata.

### Target Resolution And Authorization

One store-owned resolver is mandatory for every Git action:

```ts
resolveGitRepositoryContext(
  projectId: string,
  target: ProjectGitRepositoryTarget,
): ProjectGitRepositoryContext | null;
```

Resolution:

1. Resolve the current project and reject missing/unavailable project paths.
2. For `main`, use the current workspace snapshot's canonical main repository path when available, otherwise use the project path as Git input.
3. For `worktree`, find an exact latest-snapshot worktree with a matching normalized path and selectable health.
4. For `submodule`, find an exact latest-snapshot direct submodule with `pathAvailable` and `checkout === "available"`.
5. Return the authorized repository input plus context key, or reject without calling the bridge.

Every read and write resolves again at action start. GitTab state is not authorization.

### Context-Keyed Concurrency

Convert Git operation coordination from project-only keys to repository context keys:

- full-refresh promise and request generation;
- status-refresh promise and request generation;
- status mutation version;
- pagination/loading-more state;
- related snapshot cache;
- commit-file and diff request identity where store-owned.

Keep one project-wide shared-ref epoch because linked worktrees share refs. Commit, branch switch, commit checkout, pull, fetch, and other ref-changing operations bump that epoch. A full-refresh response may merge status/history only when both its context generation and shared-ref epoch still match.

Stage/unstage affect only the selected checkout's index and use context-local mutation versions. After any successful ordinary Git write:

- refresh the selected context with the lightest correct snapshot path;
- force-refresh the root workspace inventory so row counts, HEAD, mismatch, and health stay current;
- invalidate or refresh other cached histories when shared refs changed.

### Target-Aware Actions

Every GitTab-consumed action gains an explicit target while preserving a main-target default for non-migrated callers. GitTab must always pass its active target explicitly.

Affected families:

- `refreshGitSnapshot`, `refreshGitStatusSnapshot`, `loadMoreGitCommits`;
- file diff, commit diff, commit files, author/avatar, commit-message diff;
- stage, unstage, discard, and bulk variants;
- commit, branch switch, commit checkout;
- fetch, pull, push, and remote add/edit/remove;
- Git AI context reads and AI commit-message generation inputs.

Bridge method signatures do not need target objects; Pinia resolves the target to `repositoryPath` before delegation.

## GitTab Repository Context State

Use module-scoped renderer-session records keyed by project ID:

```ts
const rememberedGitRepositoryTargets = new Map<string, ProjectGitRepositoryTarget>();
const rememberedRepositorySectionOpen = new Map<string, boolean>();
const repositorySectionChoiceMade = new Set<string>();
const commitDraftsByContext = new Map<string, string>();
```

Component-local reactive state mirrors the active project's remembered values. None of these values belong in Pinia persistence, preload storage, `localStorage`, project export, or synced project docs.

### Initial Selection And Expansion

- Start from the remembered healthy target for the project; otherwise select main.
- Renderer reload naturally clears module maps and starts from main.
- Main-only projects start with the repository section collapsed.
- On the first workspace result that contains any related row, open the section once unless the user already made an explicit expand/collapse choice for that project.
- Refresh never overrides an explicit choice.
- If the active related target disappears or becomes unselectable, atomically fall back to main and show restrained feedback.

### Repository Switching State Machine

Repository selection is disabled while any ordinary Git write action is active.

On an accepted switch:

1. Save the current commit draft under the old context key.
2. Bump a component repository-context generation.
3. Close row menus, remote menus, branch menus, commit menus, tooltips, and dialogs bound to the old context.
4. Clear file review selection/diff, selected commits, expanded commit files/directories, commit detail state, pagination UI, and old-context transient errors.
5. Set and remember the new typed target.
6. Restore the new context's draft.
7. Render a cached full snapshot if available and request one otherwise.
8. Accept async UI results only when project ID, repository context key, and component generation all match.

Do not reuse commit-hash-only cache keys across repositories. Any retained cache uses `contextKey + full hash`.

### Commit Draft And AI Isolation

- Commit drafts are renderer-session state per repository context.
- A successful commit clears only the selected context's draft.
- AI commit-message generation captures the originating context key and generation.
- Late chunks/results update only the originating draft record; they update the visible textarea only if that context remains selected.
- Switching may supersede generation without allowing cross-context writes.

## Top Repository Section UI

Refactor the existing top status bar in `GitTab.vue`; do not create a third pane or dialog.

### Collapsed State

One fixed-height summary row always contains branch/remote/status controls and conditionally contains the repository selector:

- when related repositories exist, one compact button combining a 12px expand chevron and the selected repository name/path cue;
- branch or detached HEAD;
- change/health indicator;
- existing upstream/ahead/behind and Remote status for the selected repository;
- the existing top-right fetch, pull, and push icon actions for the selected repository.

Main-only projects omit the repository selector and repository identity because the project detail header already supplies that information. When related repositories exist, the selector shows the active repository identity on one line. Do not add a repository-kind subtitle, decorative repository/branch glyphs, or a summary More action. Repository path/navigation details remain available from the expanded row More menu.

The project-detail header owns the only refresh button. `GitTab` exposes an async refresh method so that button refreshes the active repository target plus the root workspace inventory when the Git tab is active; the collapsed summary and repository rows do not add refresh buttons.

### Expanded State

Rows render directly below the summary within a capped, themed-scrollbar list. Main/worktree rows are depth 0; direct submodules are depth 1. The expanded list does not duplicate the summary row's remote command band.

Each row:

- is a semantic button/selectable row with a visible selected state and accessible name;
- keeps icon/name/branch/change/health scannable with `min-w-0` and truncation;
- opens a row More menu for editor, terminal, folder, copy/view path, and health details;
- prevents nested action clicks from selecting another row;
- disables selection and Git actions when unhealthy while retaining details.

The expanded-row More menu plus the Branch and Remote menus Teleport to `body` as lightweight floating controls and use anchor-relative fixed positioning plus the existing fade/Escape/outside-click conventions. The repository section itself is inline and uses no modal semantics, focus trap, or scale transition.

The list gets a capped height so expanding many repositories never starves the two existing Git panes. The split container and its remembered divider remain unchanged.

## Top-Bar Remote And Branch Behavior

The existing branch, detached HEAD, upstream, remote management, fetch, pull, and push controls derive from the active full snapshot and pass the active target to store actions.

- No upstream still disables fetch/pull/push with the existing explanation.
- Fetch, pull, and push remain the existing top-right icon actions; the Remote menu is reserved for remote configuration and status details.
- Remote add/edit/remove affects only the selected repository.
- Branch switch and commit checkout are blocked/confirmed using selected-repository dirty state.
- Linked worktree branch conflicts remain Git errors surfaced through existing feedback; no lifecycle workaround is added.
- Remote/ref mutations refresh selected snapshot, workspace inventory, and shared-ref-dependent caches.

## Changed Files, History, Diff, And AI

Both existing panes consume `activeSnapshot`, never `props.project.git` directly after migration.

- Changed-file groups use selected snapshot files and explicit target-aware actions.
- History, filters, graph, load-more, commit expansion, tooltip enrichment, and commit diff reads use the selected context.
- Worktree file review should be renamed internally to `FileReviewSelection` to avoid collision with linked-worktree terminology.
- AI common context uses selected repository path, branch, status, files, commits, and diffs.
- Batch/commit-detail AI selections are cleared on repository switch.
- The Files Tab remains rooted at the launcher project. GitTab row review continues to show related-repository diffs in GitTab; main-only cross-tab file opening remains unchanged, while related paths use the row/editor navigation affordance rather than silently opening the launcher project's Files Tab.

## Browser Preview

The browser fallback keeps its explicit unavailable workspace snapshot. With no authorized related rows, the repository section renders the main summary in unavailable/preview state and ordinary local Git actions retain current unsupported results. Browser preview never fabricates selectable local worktrees/submodules.

## Preload Impact

No new Git command family is required. Existing bridge methods already accept an arbitrary repository input and canonicalize it.

Preload changes are limited to defects exposed by new target fixtures. Preserve:

- argv-only execution with `shell: false`;
- NUL machine formats and streaming record parsing;
- four active entry workers maximum;
- one shared 30-second deadline per related entry;
- timeout/spawn-error precedence over exit code;
- bounded stderr and sibling/section failure isolation;
- SHA-1/SHA-256 full OID validation;
- direct-only submodule inspection.

No command may invoke worktree add/remove/prune/lock/unlock or submodule init/update/sync/deinit.

## Error And Safety Matrix

| Condition                                     | Required behavior                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| Remembered target missing/unhealthy           | Fall back to main; never call bridge with stale path                          |
| Switch requested during Git write             | Keep current repository and show disabled/action-in-progress affordance       |
| Old full/status response returns after switch | Reject by context key + generation                                            |
| Same commit hash exists in two repositories   | Separate all cache/detail state by context key                                |
| AI result returns after switch                | Update only origin draft or ignore; never overwrite visible new-context draft |
| Related write succeeds                        | Refresh selected snapshot and workspace row inventory                         |
| Ref-changing write in linked worktree         | Bump project shared-ref epoch and invalidate other history caches             |
| Submodule commit changes HEAD                 | Parent workspace refresh updates mismatch/gitlink summary                     |
| Target becomes prunable/unavailable           | Keep row visible, disable selection/actions, fall back if active              |
| Browser fallback                              | Explicit unavailable data and unsupported actions                             |

## Validation Strategy

Extend `src/lib/projectBridge.workspace.test.ts` and `scripts/validate-git-workspace.mjs` rather than introducing a second workspace validator.

Focused automated coverage:

- target authorization for main, available worktree, available direct submodule, stale path, unrelated path, bare/prunable path, and unavailable submodule;
- per-context full/status refresh deduplication and stale-response rejection;
- same project with simultaneous worktree/submodule reads keeps snapshots isolated;
- stage/commit/checkout/remote actions receive the exact selected repository path;
- a stale target is rejected before any bridge write;
- selected-target write refreshes workspace row counts;
- shared-ref mutation invalidates related history safely;
- remembered selection fallback and initial expansion rules through extracted pure helpers where practical;
- per-context draft isolation and late AI result rejection through focused component/helper tests where practical;
- existing parser, timeout, conflict, nested-direct-only, bare, SHA, and failure-isolation fixtures remain green.

Minimum executable verification:

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

Manual browser/uTools smoke:

- main-only hides the selector and repository list; first related discovery reveals and expands the selector once; explicit choice survives refresh/tab/project switches;
- main/worktree peer rows and indented direct submodules remain readable at host-like narrow widths;
- selecting each healthy repository atomically switches top metadata, changes, history, diff, AI context, and actions;
- commit drafts restore per repository and do not cross after delayed AI output;
- selection is blocked during writes;
- stage/unstage/discard/commit/branch/checkout/remote operations affect only the selected checkout;
- unavailable rows remain visible and cannot become active;
- More menu external navigation uses the row path and closes through outside click/Escape;
- light/dark themes show no overlap, horizontal clipping, or pane-size regression.

## Rollout And Rollback

This is a replacement of the first implementation's UI/state routing, not an additive second entry point.

Rollback unit:

1. restore main-only GitTab/store action routing;
2. remove target/context types and related snapshot maps;
3. restore or remove the first workspace overlay according to product direction;
4. keep the proven preload inventory/parsers and validator only if still consumed.

No data migration or Git repair is required because targets, drafts, snapshots, expansion, and selection are transient.

## Sources

- `prd.md`
- `research/git-workspace-contracts.md` for Git machine-format and failure contracts only; its old overlay/read-only product recommendations are superseded by this design.
- User-supplied VS Code Source Control repository-selection screenshots, 2026-07-19.
