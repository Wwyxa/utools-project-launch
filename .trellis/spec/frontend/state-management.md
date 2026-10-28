# State Management

## Ownership

Pinia in `src/store/` owns the project catalog, preferences, shared logs, Git
snapshots, runtime reconciliation, and automation actions. Components call
intent-specific actions instead of accessing persistence or preload directly.
Drafts, selection, hover, drag state, and panel layout stay local unless multiple
views actually share them. Derived project status comes from all scripts.

Persistence classification, private/public projects, local environment overrides,
and migration belong to [Storage Guidelines](../backend/database-guidelines.md).
Load preferences once at Store creation; component mounts do not reread them.
Normalize values at the boundary and skip unchanged writes.

## Catalog and Metadata

- Persist project, script, and todo ordering through Store actions. Filtered
  dashboard moves preserve hidden items' relative order and section boundaries.
- Dashboard hiding uses device-local `workspace.hiddenProjectIds` through
  `setProjectHidden(projectId, hidden)`. Missing ids default to an empty list;
  failed writes leave visibility unchanged. Filter dashboard cards and counts,
  while the full catalog, quick-open, running scripts, and automation keep all
  projects. Restore the hidden ids with the other workspace state after backups.
- On `projects-changed`, plugin entry/resume, or manual refresh, reload persisted
  metadata without writing it back. Preserve matching active script identity and
  valid Git state when the project id/path is unchanged; retain the current
  catalog on read failure.
- Keep editable metadata aligned across forms, hydration, Store serialization,
  preload serialization, and browser fallback. Trim optional strings and infer
  icons only when no explicit icon exists.
- Script discovery must not preselect potentially destructive targets. Path
  inspection is advisory and must leave manual form editing usable.
- Project quick-open matching lives in the Store: exact case-insensitive name
  first, then substring; unavailable paths open editing rather than broken details.

## Process State

- Identify a run by `(runId, runtimeOwner)`, not PID alone. Reject stale events;
  buffer terminal events that arrive before their matching launch identity, then
  settle once. A delayed start/result must not revive a terminal run.
- Rebuilding scripts uses `mergeScriptRuntimeState` for matching active scripts.
  Derive project status with `deriveProjectStatus`: active scripts outrank failed
  siblings. Missing paths clear invalid runtime state.
- Show stop requests immediately while keeping final settlement tied to process
  results. Set `STOPPING` before logging; defer normal stop logging and host calls
  with `scheduleAfterInitialPaint` without awaiting other scripts' stop requests.
  Stop-request logs use `addLog(..., false)`; runtime changes must not persist the
  catalog or resynchronize service configuration. Plugin-exit cleanup bypasses
  paint waiting; output-matched automation stops immediately. Service-owned runs
  can be controlled by identity before a PID exists.
  See [Error Handling](../backend/error-handling.md) for shutdown semantics.
- Live project/script logs share the indexing and retention contract in
  [Logging Guidelines](../backend/logging-guidelines.md).

## Automation

- Persist user configuration, not generated `dailyPlans`, `history`, notification
  receipts, or observed service execution ids. Hydration discards legacy runtime
  fields. Executing a task does not save the project or change configuration time.
- Plans are deterministic for a task/date. Apply missed-run policy before due
  collection, including startup/resume: grace-run within the configured window,
  run-now when available, or mark-missed without execution.
- Manual run-now creates a new entry. Early run consumes the exact future pending
  entry, preserves `plannedAt`, and validates status/time again in the Store.
  Claim/guard before awaiting work so repeated clicks or timers cannot duplicate it.
  `enabled` controls scheduling, not explicit manual/early actions.
- Prevent concurrent automation within one project, but derive each task's visible
  status from that task. A blocked action reports feedback without altering history.
- Recovery matches exact `(projectId, scriptId, automationRunId)` results for
  every script; do not guess from the latest script result or PID. Reconcile old
  runs before scheduling new ones, and share overlapping recovery work.
- Output-match success requires a validated same-run `automationExitMatched`
  marker recorded before termination. An explicit error wins; do not reinterpret
  platform nonzero exit codes globally.
- In service mode, service executions/history are authoritative. The first
  complete snapshot establishes a notification baseline; later terminal changes
  notify once using session identity tracking, not a capped display-history list.
  Ignore-missed is a service transition, not a synthetic renderer history row.
  Pass the execution ID actually displayed in the overview. A missed execution
  may be present in durable history but absent from the bounded live snapshot:
  validate the service response identity, upsert it into the current snapshot,
  and update matching shared history. Never overwrite newer unrelated state
  with a snapshot captured before the request. Pending and failed ignores must
  be visible; do not silently discard false results or rejected requests.

Service enable/disable barriers and failure ownership are specified once in
[Project Launch Service](../backend/project-launch-service.md).

## Git Repository Context

- Components pass a typed main/worktree/submodule target. Before every read or
  write, the Store resolves and re-authorizes it against the current project and
  workspace inventory. Never trust a bare path supplied by a component.
- `Project.git` is the main snapshot. Related snapshots, drafts, selection, and
  request coordination are keyed by repository context and remain transient.
  Switching context rejects late results and is blocked during writes.
- Inventory uses Git machine formats and bounded workers/deadlines. Parse NUL
  records and full object ids, correlate direct submodules, and preserve healthy
  siblings on partial failure. This inventory is not recursive submodule scanning.
- Ref mutations invalidate related history with the shared-ref epoch. Project
  path replacement invalidates workspace, snapshots, failures, and request tokens,
  including an A-to-B-to-A path transition.

## Git Reads and Writes

- Initial/full history reads are bounded. Pagination appends commits without
  replacing worktree state; compute `hasMoreCommits` from one extra record.
  A new sentinel intersection requests one page, not every page while visible.
- Status/working-tree reads update only their fields and require a complete
  snapshot. Transient failure preserves valid data; `not-a-repository` clears it.
  Tokens and mutation versions guard both successful and failed results.
- Index/worktree writes await only the fresh working-tree data and start workspace
  inventory in the background. Commit/ref/remote mutations refresh full state;
  partial write or remote failure still refreshes potentially changed data.
- Selected-file writes use exact paths. Bulk-all collects live status in preload,
  independent of UI filtering/pagination. Chunk argv and report only completed
  paths on partial failure. Discard never recursively deletes untracked directories.
- Visible worktree diffs explicitly select staged or unstaged scope; combined is
  the compatibility default for AI. Key selection by path plus scope, reject stale
  responses, and preserve valid `diff --no-index` output with exit code 1.
- Full-context/whitespace options apply consistently to worktree, commit, and
  stash readers. See `public/preload/git-diff.js` and `validate:git-diff`.
- Use structured refs and typed destructive blockers. Validate names/commits in
  preload and confirm force/discard/delete explicitly. Explicit detach must bypass
  branch-tip selection. Initialization targets the main project; publication
  targets the selected authorized repository and remote.
- Remote commands stream progress, disable credential prompts, and have a timeout.
  Tracking refs are local fetched state. Push only the chosen branch/tags; remote
  branch deletion is distinct from local branch or remote-config removal.

### History Mutation Boundaries

- Read the full stash reflog, carry numeric selectors and base/untracked-parent
  metadata, and pass it to file/diff readers. Ordinary merge-diff reads cannot
  reconstruct all stash content. Refresh full state after stash writes and refs
  after pop/drop because stack selectors change.
- Select actual HEAD from structured refs, not the first history row: synthetic
  stashes may precede it. Amend/undo require an attached local branch. Undo uses
  soft reset, not revert; root undo preserves files and recovers HEAD/index on
  partial failure. Merge undo requires the typed blocker and explicit confirmation.
- Cherry-pick/revert accept one full ordinary commit and require a clean attached
  branch with no existing operation. A failed status probe is not a clean tree.
  Abort only the matching operation whose ref equals the requested target; never
  reset/clean or abort an unrelated operation. Preserve original/recovery errors.
- Merge/rebase confirmations open before async preparation; conflict predictions
  are advisory and must not update refs, HEAD, index, or worktree. Execute only a
  revalidated `ProjectGitIntegrationPlan`. Preserve `rebaseInProgress` across
  snapshot refreshes; staging must refresh `canContinue`. Resume via rebase
  controls, never ordinary commit or automatic abort. See `validate:git-integration`.
- Serialize writes by repository context through refresh, reauthorize queued
  targets, and fully refresh refs/state after failed history mutations.

## Feature Async State

- Renderer sessions may retain successful state in bounded repository-keyed maps.
  Keep pending/error state local, prune on project/context reset, and check request
  generations on every async update. Do not persist these sessions.
- External application selection resolves an enabled default or explicit one-time
  choice without changing the default. Keep device-local commands out of projects.
  Host capability detection is manual, scoped, asynchronous, and independent of
  actual launch availability.
- Environment detection validates command/argument tokens, separates trusted
  built-ins from direct custom commands, and uses the constrained Windows shim
  path where needed. Bound concurrency and timeouts; publish per-tool results.
  Recheck generations both before queued work starts and before results publish.
- AI streams keep content, reasoning, and raw preservation text separate, settle
  exactly once, and ignore stale callbacks. User copy and commit text use final
  content. Append runtime context to general prompts while supporting old tokens.
- File browsing is lazy and root-bounded; bounded search and mutations use Store
  actions and preload canonical/symlink checks. Browser preview returns typed
  unavailable results rather than pretending host operations succeeded.
- Work activity groups projects by Git root, excludes stash refs, uses local
  author dates, and loads day details lazily. Failures are not zero activity;
  invalidate unavailable-project discovery when its path/Git capability changes.

## Verification Entry Points

Use existing tests by ownership: `projectRuntimeState`, `automationTask`,
`automationScheduler`, `projectBridge.workspace`, `projectBridge.uiPreferences`,
`projectBridge.launchers`, `environmentTools`, `useStore.aiStream`, and
`workActivity` under `tests/`. Native regression scripts are listed in
`package.json`; choose the script matching the touched boundary.
