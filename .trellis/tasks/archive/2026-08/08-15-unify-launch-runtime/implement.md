# Implementation Plan: Unified Project Launch Runtime

## Preconditions And Review Gates

- Confirm this planning summary and the three task artifacts before `task.py start`.
- Before code edits, read the current task artifacts plus the relevant backend/frontend specs through `trellis-before-dev`.
- Preserve unrelated worktree changes and do not commit during implementation.

## Phase 1: Normalize The Runtime Contract

- [ ] Extend shared types for owner-neutral run identity, service-state events, and optional scheduler status.
- [ ] Generate preload `runId` values and attach `runtimeOwner: "preload"` to direct process results/events.
- [ ] Add Store stale-event guards keyed by project, script, owner, and run ID while retaining legacy fixture compatibility.
- [ ] Add focused preload/store tests for direct run identity and stale terminal events.

Validation:

```text
node --check public/preload.js
npm run lint
npx vitest run tests/projectBridge.launchers.test.ts
```

Rollback point: revert only identity fields and event guards; the existing process maps and service protocol remain usable.

## Phase 2: Close The Service Automation State Loop

- [ ] Normalize service snapshots in preload and emit a typed service-state event from the existing background poll.
- [ ] Apply service snapshots in Store without duplicating process logs or terminal events.
- [ ] Reconcile live automation plan entries, active-run guards, history, cursors, and truncation state while the plugin is open.
- [ ] Add tests proving service task completion updates the open `AutomationTab` data without manual refresh.

Validation:

```text
npx vitest run tests/projectBridge.launchers.test.ts tests/projectBridge.uiPreferences.test.ts
npm run validate:process-results
npm run lint
```

Rollback point: stop emitting live snapshots while retaining startup/explicit reconciliation behavior.

## Phase 3: Make Scheduler Health Recoverable And Visible

- [ ] Add scheduler runtime status and last-error tracking in Go.
- [ ] Keep the scheduler loop alive after non-cancellation iteration failures and clear degraded state after recovery.
- [ ] Expose scheduler status through `/v1/state` and normalize it in the preload status adapter.
- [ ] Set the Store status to `starting` during service enable and surface polling/start failures instead of swallowing them.
- [ ] Add Go tests for scheduler error, continued polling, recovery, and API state serialization.

Validation:

```text
 npm run go:fmt
go -C service vet ./...
go -C service test ./internal/scheduler/... ./internal/api/...
node --check public/preload.js
npx vitest run tests/projectBridge.uiPreferences.test.ts
```

Rollback point: keep scheduler status optional at the bridge boundary and revert only the loop/status extension if protocol compatibility fails.

## Phase 4: Enforce Logical Run Ownership

- [ ] Add a typed active-run conflict for duplicate `projectId`/`scriptId` service launches.
- [ ] Map the conflict through the API and preload bridge without changing existing idempotency behavior.
- [ ] Add tests for duplicate start, existing-run authority, stop/input targeting, and service reconnect.

Validation:

```text
go -C service test ./internal/process/... ./internal/api/...
npx vitest run tests/projectBridge.launchers.test.ts tests/projectBridge.uiPreferences.test.ts
```

Rollback point: remove the conflict guard only if the product explicitly adopts a multi-run UI model; do not hide duplicate runs in reconciliation.

## Phase 5: Full Cross-Layer Verification

- [ ] Run `node --check public/preload.js`.
- [ ] Run `npm run lint` and `npm run build`.
- [ ] Run `npm run validate:process-results` and `npm run validate:project-storage`.
- [ ] Run `go -C service vet ./...` and `go -C service test ./...`.
- [ ] Review all runtime branches for disabled, enabled-healthy, enabled-degraded, enabled-unavailable, reconnect, and mode-handoff behavior.
- [ ] Perform a manual uTools smoke for two scripts, service task completion, service restart/reconnect, stale event protection, and explicit stop.

## High-Risk Files

- `src/types.ts`: shared protocol and event types must remain closed and synchronized.
- `public/preload.js`: native process maps, service polling, response normalization, and host lifecycle behavior.
- `src/store/useStore.ts`: script state, automation state, owner handoff, and persistence coordination.
- `service/internal/process/supervisor.go`: run identity, duplicate guard, stop/control safety.
- `service/internal/scheduler/scheduler.go`: execution claims, loop recovery, and scheduler health.
- `service/internal/api/server.go`: typed protocol responses and state exposure.

## Required Final Checks

```text
git diff --check
node --check public/preload.js
npm run lint
npm run build
npm run validate:process-results
npm run validate:project-storage
go -C service fmt
go -C service vet ./...
go -C service test ./...
```
