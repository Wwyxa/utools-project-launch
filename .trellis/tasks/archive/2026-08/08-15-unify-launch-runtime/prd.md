# Unify Project Launch Runtime And Service Task State

## Goal

Make project script execution and scheduled automation use one owner-neutral runtime contract while preserving the two existing execution owners:

- preload-owned execution when Project Launch Service mode is disabled;
- Go service-owned execution and scheduling when service mode is enabled.

The user-visible result must be the same in both modes: stable run identity, ordered lifecycle events, accurate script status, accurate automation status/history, controllable input/stop behavior, and explicit degraded states.

## Background And Confirmed Facts

- `ProjectBridge.runCommand`, `stopProcess`, `getProcessStatus`, `sendProcessInput`, and `stopAllProcesses` are already the shared entry points for script runtime operations.
- The preload implementation currently tracks direct child processes in memory and emits process events without a stable `runId`.
- The Go service persists run IDs, process identity, ordered event cursors, run logs, and automation executions.
- Go scheduler execution state is returned by `/v1/state`, but the background preload event poll forwards only process events, so automation completion can remain stale in Pinia and `AutomationTab`.
- `scheduler.Runtime.Run` returns permanently after one non-cancellation error, while the service health response can still report the process as healthy.
- The service does not reject concurrent active runs for the same project/script, while the UI model displays only one current run per script.
- Existing service ownership rules are intentional: service mode is global, enabled mode fails closed, and Git/files/AI/external application launchers remain outside the Go service.

## Requirements

### R1. One Runtime Contract

- Both execution owners return the same logical run shape with a stable `runId`, explicit `runtimeOwner`, start time, command, working directory, and diagnostic PID.
- Both owners provide equivalent start, stop, input, snapshot/reconcile, and event-subscription semantics through the existing `ProjectBridge` boundary; owner-specific adapters may remain internal to preload or the Go service.
- Both owners emit the same process lifecycle event semantics, including `runId` on every event.
- Store status reconciliation and control paths use `runId` as the primary identity; PID remains diagnostic and platform-control data only.
- A delayed event from an older run must not overwrite the current run for the same project/script.

### R2. Live Service Automation State

- Service automation execution transitions (`running`, `completed`, `failed`, `skipped`, `missed`) must reach the renderer while the plugin remains open.
- Reconciliation must update plan entries, active task guards, task history, and user-visible status without requiring Settings, Terminal history, or a full plugin reload.
- The service remains authoritative for service-owned automation state; renderer persistence must not manufacture a second execution result.

### R3. Observable Scheduler Health

- A scheduler iteration error must be represented in service state with a bounded, user-safe error message and time information.
- A recoverable iteration error must not permanently terminate the scheduler goroutine.
- A subsequent successful iteration or accepted valid configuration must clear the degraded scheduler state.
- Manual service-owned script launch remains distinguishable from scheduler health; a scheduler degradation must not falsely claim that process supervision is unavailable.

### R4. Safe Logical Run Ownership

- The service must reject a second active run for the same project/script unless the protocol explicitly models multiple visible runs; the current UI contract uses one visible run, so the first implementation rejects duplicates with a typed conflict.
- Stop, input, reconnect, and terminal history must continue to address the selected run by `runId`.
- Service mode remains fail-closed when the service is unavailable or incompatible; no preload fallback is introduced while enabled.

### R5. Explicit Mode And Status Feedback

- Enabling and disabling service mode keeps the existing global ownership handoff rules and does not add per-project or per-script switches.
- A handoff pauses new submissions, validates and starts the target owner, synchronizes the complete configuration revision, and persists the new owner only after success; a failed initial handoff rolls back to the previous owner and resumes its scheduling path.
- The UI exposes the distinction between service process health and scheduler degradation.
- The service enable transition reports a real `starting` state while the verified executable is being launched and checked.
- Polling or reconciliation failures update scoped service state instead of being silently discarded.

### R6. Compatibility And Scope

- Disabled/no-install behavior continues to use the existing preload process path and renderer automation path.
- Existing service persistence, encrypted automation configuration, process identity checks, bounded logs, Windows process-tree handling, and protocol authentication remain intact.
- External terminal/editor/application launchers remain preload-owned and are not moved into the long-lived process supervisor.
- No new runtime dependency or database is introduced.

## Acceptance Criteria

- [ ] A preload-owned launch and a service-owned launch both produce stable run identities and owner-tagged lifecycle events; stop and input work through the same Store actions.
- [ ] Runtime snapshots and subscriptions reconcile both owners through the same Store-facing boundary without exposing raw service payloads to components.
- [ ] A stale exit/error event from an older run cannot clear or replace a newer run for the same script.
- [ ] A service-scheduled task changes from pending to running and then to a terminal state in the open UI without a manual refresh, including history and active-run guards.
- [ ] A service scheduler error is visible in service state, the scheduler continues polling, and a later valid iteration clears the error.
- [ ] Starting the same project/script twice through the service returns a typed conflict and leaves only one active run.
- [ ] Service process health and scheduler health are represented separately; process launches remain possible when only scheduling is degraded.
- [ ] Service mode still fails closed when the service is unavailable or incompatible, and disabled mode never starts or downloads the service implicitly.
- [ ] Enabling service mode pauses new renderer submissions and persists ownership only after target validation and configuration synchronization; an initial failure restores renderer ownership.
- [ ] Existing service reconnect, retained log, process-tree stop, automation claim, and default-off behavior tests remain passing.
- [ ] Focused tests cover live service-state delivery, stale run events, duplicate active runs, scheduler recovery, and enable-starting status.
- [ ] Required checks pass: `node --check public/preload.js`, `npm run lint`, `npm run build`, `npm run validate:process-results`, `npm run validate:project-storage`, `go -C service vet ./...`, and `go -C service test ./...`.

## Out Of Scope

- Moving Git, file, AI, environment detection, terminal opening, or external editor launching into Go.
- Device-login service installation, remote access, cloud synchronization, or a general plugin extension API.
- A full rewrite of every Store action around a new class hierarchy when the existing `ProjectBridge` facade can remain the common boundary.
- Transparent fallback to preload while service mode is enabled.

## Risks And Deferred Items

- The first implementation may use one serialized service-state reconciliation path; higher event throughput can justify a dedicated long-poll stream later.
- Service scheduler health is process-local and should not expose command environment values or secrets.
- Existing persisted project files must remain configuration-only; active runtime state continues to be reconstructed from the selected owner.
