# Project Launch Service

> Executable contract for the optional local Go runtime.

## Scenario: Optional Service Ownership, Protocol, And Recovery

### 1. Scope / Trigger

- Trigger: a change touches `service/`, service installation/discovery in `public/preload.js`, the `ProjectBridge` service methods, service settings, process execution, or automation scheduling.
- The service is an opt-in local runtime for delegated script processes and automation. It does not own Git, files, AI, project catalog storage, or ordinary plugin preferences.
- This contract spans Vue/Pinia, the preload bridge, a loopback Go HTTP server, and local service files. Keep [Encrypted Automation State](./error-handling.md#scenario-project-launch-service-encrypted-automation-state) as the authoritative persistence-security supplement.

### 2. Signatures

- Service executable: `project-launch-service --state-dir <service-directory>`.
- Service bridge methods: `loadProjectLaunchServicePreferences`, `saveProjectLaunchServicePreferences`, `getProjectLaunchServiceStatus`, `downloadProjectLaunchService`, `startProjectLaunchService`, `stopProjectLaunchService`, `reconcileProjectLaunchService`, `getProjectLaunchServiceRunLog`, `syncProjectLaunchServiceAutomation`, `openProjectLaunchServiceDirectory`, and `openProjectLaunchServiceReleases`.
- Shared types: `ProjectLaunchServicePreferences`, `ProjectLaunchServiceStatus`, `ProjectLaunchServiceRun`, `ProjectLaunchServiceEvent`, `ProjectLaunchServiceRunLog`, `ProjectLaunchServiceAutomationConfig`, `ProjectLaunchServiceAutomationState`, and `ProjectLaunchServiceAutomationSyncResult` in `src/types.ts`.
- Loopback requests use `Authorization: Bearer <token>` and `X-Protocol-Version: 1`. JSON mutations also use `Content-Type: application/json`; `POST /v1/runs` requires `Idempotency-Key`.
- Protocol endpoints are `GET /v1/health`, `GET /v1/state`, `GET /v1/events?after=<cursor>`, `GET /v1/runs/{runId}/log`, `POST /v1/runs`, `POST /v1/runs/{runId}/input`, `POST /v1/runs/{runId}/stop`, `PUT /v1/automation/config`, and `POST /v1/shutdown`.

### 3. Contracts

- `ProjectLaunchServicePreferences.enabled` defaults to `false`. When it is `false`, opening Settings, plugin startup, status discovery, and recheck may not download, start, or enable the service. When a previously enabled service is stopped by a device restart, plugin-open reconciliation may start only the already verified installed executable; it never downloads, updates, or enables a service implicitly.
- With service mode disabled, preload owns new script launches and the renderer owns automation. With it enabled, all new script launches and automation belong to the service; there are no per-project, per-script, or per-task ownership switches.
- A service-enabled but missing, incompatible, or unreachable runtime fails closed for delegated launches and automation. The plugin and unrelated features remain usable, but code must not silently use the preload/renderer owner.
- The fixed service-managed root is `~/.utools-project-launch/service/`, derived from the existing application root. The root-level `~/.utools-project-launch/device-id.v1` remains in place and is not service data. The executable, `discovery.json`, `token`, `state.json`, bounded logs, downloads, and temporary update files must all stay below `service/`. Discovery must name a loopback host, valid port, the exact service token path, PID, process identity, protocol version, and instance id.
- Installation writes `downloads/<executable>.partial`, verifies it, then atomically replaces the executable and records the verified target asset and SHA-256 in restricted `install.json` metadata. Automatic reconciliation of persisted enabled mode verifies the executable against that local metadata before spawning it and never downloads or checks the network during startup. A failed install removes partial files and restores a replaced executable from `update.backup`; a successful replacement removes the backup. Clean service shutdown removes owned discovery, and preload removes stale discovery only after validating that its recorded owner is absent.
- The service listens only on `127.0.0.1:0`. Preload validates discovery, token location, process identity, health response, and protocol compatibility before trusting an endpoint. Remove a stale discovery file only after identity validation proves its owner is absent.
- The Go handler authenticates every endpoint before routing. It rejects bad token, incompatible protocol, unsupported media type, oversized JSON, malformed/extra JSON values, and invalid event cursors with typed HTTP errors. A launch retry with the same idempotency key must return the original run; reusing it for different input conflicts.
- `runId` is the stable public identity. PID is diagnostic data only. Recovered runs must validate both PID and OS process identity before stop/control; an identity mismatch becomes lost/ended state rather than controlling a reused PID.
- On Windows, launched commands must use `CREATE_NO_WINDOW`, `CREATE_NEW_PROCESS_GROUP`, and `HideWindow`. Service stop enumerates the process tree through native Windows APIs and terminates processes directly, so it does not spawn console helpers during stop or process-existence checks.
- Enabling service mode pauses every renderer scheduling entry point before starting/synchronizing the service. Persist `enabled=true` only after the service accepts the complete monotonic automation configuration revision. A failed initial start, reconcile, or synchronization before that write clears the handoff barrier, keeps renderer ownership, and resumes renderer scheduling. A later runtime failure after `enabled=true` is persisted reports an unavailable status but keeps service mode enabled: new delegated launches and automation must remain fail-closed until the user explicitly and successfully disables service mode. Disabling requires service-owned active runs to stop first.
- The service owns bounded event/output history and returns cursor/truncation metadata. `ProjectLaunchServiceAutomationConfig` is input only; `ProjectLaunchServiceAutomationState` in `ProjectLaunchServiceStatus` exposes only a revision and optional executions, never a configuration or environment map. The service must not log tokens, full environments, or credentials.
- State retains the latest 20 terminal automation executions per `(projectId, taskId)` while retaining active executions. Run output is stored as `logs/<runId>.log`, capped to the newest 5 MiB per run, 100 MiB in total, and 200 retained log files. Enforce the same limits on service startup and after every append. When the file-count or total-size cap is exceeded, delete the oldest completed-run logs first; only then trim active logs to their newest bounded tail until the total is within the size cap. Active runs may temporarily exceed the file-count cap rather than losing their live log.
- `GET /v1/runs/{runId}/log` returns the retained structured events, byte size, and truncation marker for one run that still exists in bounded run history. The preload bridge keeps the default 256 KiB service-response limit for all other requests and uses an 8 MiB limit only for this bounded log response. The Terminal history dialog lists completed runs for the current project and reads a selected log without merging it into live `scriptLogs`.
- `/v1/shutdown` accepts only an idle service. Release builds use the six-target matrix, deterministic asset names, checksum verification, stripped pure-Go binaries, and the 12 MiB raw-size limit.

### 4. Validation & Error Matrix

- Service preference absent or `enabled=false` -> no download/start; existing preload launches and renderer scheduling remain active.
- Plugin opens after a device restart with persisted `enabled=true` and a verified installed executable -> reconciliation may restart that executable, then validates health and state; it does not download or update it.
- Initial enable handoff fails before `enabled=true` is saved -> renderer ownership resumes. A health, polling, reconcile, or synchronization failure after `enabled=true` is saved -> status becomes unavailable and delegated work remains blocked without preload/renderer fallback.
- `enabled=true` with unhealthy, missing, or incompatible status -> show actionable unavailable/incompatible status; block delegated launch and automation without fallback.
- Discovery host is not loopback, token path escapes the service directory, PID identity differs, or metadata is malformed -> reject it; remove only a proven stale discovery record.
- Missing/incorrect bearer token -> HTTP `401` with `unauthorized`; incompatible protocol -> HTTP `426` with `protocol_mismatch`.
- Non-JSON, malformed, duplicated, or body-limited mutation -> typed `4xx` result; unknown fields never enter service state.
- Reused launch idempotency key with the same fingerprint -> return the prior run; a different fingerprint -> conflict without a second process.
- Stale automation revision -> reject with `automation_revision_conflict`; accepted revision -> atomically replaces the complete normalized configuration.
- Active service run during shutdown/disable -> reject shutdown or keep service mode enabled until explicit stop succeeds.
- Windows stop -> enumerate and terminate the process tree without spawning a visible console helper or relying on a shell command for process-existence checks.
- Event cursor precedes retained history -> return truncation metadata; the renderer must reconcile from the available boundary instead of inventing missing output.
- Invalid or unknown run id, or a log already removed by retention -> HTTP `404` with `run_log_unavailable` or the generic endpoint `not_found`; the Terminal keeps live logs unchanged and shows an unavailable message.

### 5. Good/Base/Bad Cases

- Good: a user clicks Download, manually enables a healthy compatible service, and a subsequent long-running script is restored from service state after uTools restarts.
- Good: a user previously enabled a verified service, restarts the device, then opens the plugin; reconciliation starts the installed executable and restores service-owned state without an implicit download.
- Good: service startup sees a stale discovery record, verifies the recorded process identity is gone, removes that record, and writes a new loopback-only discovery file.
- Good: enabling service mode clears the renderer timer, waits for configuration acknowledgement, then records the enabled preference so one planned entry can run only once.
- Good: after reopening uTools, the user opens Terminal log history, selects a completed run, and reads its retained output without adding those rows to the live terminal stream.
- Base: a user never installs or enables the service; plugin startup continues using the former preload and renderer behavior with no Go executable start or Go toolchain requirement.
- Bad: a component reads `discovery.json`, sends an unauthenticated local HTTP request, or starts a service executable directly.
- Bad: a failed service health check falls back to `runCommand` in preload while the global service setting remains enabled.
- Bad: a persisted PID is used as authority to stop a process without process-identity validation.
- Bad: routing service-owned process termination through an external shell command and reintroducing a console helper into the stop path.

### 6. Tests Required

- `go -C service test ./...` covers authentication/protocol rejection, request limits, discovery lifecycle, state/token integrity, idempotency, process-tree stop, recovered-run identity checks, scheduler claims, executable restart/reconnect, log file-count eviction, and retained-log API reads.
- Windows process tests assert console isolation flags on launched commands and cover native process-tree enumeration and termination.
- `go -C service vet ./...` and `gofmt -l service` pass after Go changes; `npm run go:build` produces only ignored local developer output under `service/bin/`.
- Bridge/store tests cover default-off status, manual install/recheck failure, enabled-unavailable fail-closed behavior, ownership-handoff timer pause, accepted configuration revision, and reconciliation of service status/events.
- `node --check public/preload.js`, `npm run lint`, `npm run build`, `npm run validate:process-results`, and `npm run validate:project-storage` pass after cross-layer changes.
- CI builds the six release targets, verifies checksums, and rejects every raw executable over 12 MiB. A real uTools smoke must still verify full host exit/reconnect and Windows job-object behavior.

### 7. Wrong vs Correct

#### Wrong

```ts
if (serviceEnabled && !serviceHealthy) {
  return runWithPreload(command);
}
```

This creates dual ownership: the UI says service mode is enabled while the renderer/preload can still launch work that the service cannot reconcile.

#### Correct

```ts
if (serviceEnabled && !serviceHealthy) {
  throw new Error("Project Launch Service is unavailable. Recheck or disable service mode first.");
}

return serviceEnabled ? runWithService(command) : runWithPreload(command);
```

Keep ownership global and explicit: delegate only after healthy validation, otherwise fail the scoped operation without disabling unrelated plugin features.

## Scenario: Unified Runtime Identity, Live State, And Scheduler Recovery

### 1. Scope / Trigger

- Trigger: a change affects script lifecycle identity, service state polling, `/v1/state`, scheduler execution, service-owned automation submission, or the enabled-mode handoff.
- This requires code-spec depth because `src/types.ts`, `public/preload.js`, `src/store/useStore.ts`, the Go API, supervisor state, and scheduler all exchange the same runtime facts.
- Script processes may have either owner, but Git, files, AI, and external application launchers remain outside the service runtime.

### 2. Signatures

- `ProjectBridgeRunResult` and `ProjectBridgeEvent` carry `runId?: string` and `runtimeOwner?: "preload" | "service"`; real preload and service events always provide both fields.
- `ProjectBridgeServiceStateEvent` is `{ type: "service-state"; status: ProjectLaunchServiceStatus; timestamp?: string }` and is delivered on the existing bridge event subscription.
- `ProjectLaunchServiceStatus` may include `runs`, `events`, cursor/truncation metadata, `automation`, and `scheduler?: { state: "running" | "degraded"; lastRunAt?: string; lastSuccessAt?: string; lastError?: string }`.
- `GET /v1/state` returns the supervisor snapshot plus automation state and scheduler health. `GET /v1/events?after=<cursor>` returns the ordered process batch and cursor metadata.
- `POST /v1/runs` returns `409 { "code": "active_run_conflict" }` when an active run already owns the same `projectId` and `scriptId`.
- Service automation configuration entries may include `runEarly?: boolean`; the field is submission metadata, not a replacement for `plannedAt`.

### 3. Contracts

- `runId` is the stable logical identity and `runtimeOwner` disambiguates its implementation. PID is diagnostic/process-control data only and must not decide whether an event is current.
- Preload generates a `runId` for every direct launch and emits it with `runtimeOwner: "preload"`. It normalizes service events and service runs with `runtimeOwner: "service"` before exposing them to the Store.
- A live service poll reads the event batch and a final service state, advances the cursor, emits normalized process events, then emits one `service-state` snapshot with `events: []`. This lets the Store apply live output once while still reconciling runs, automation, and scheduler health from the final snapshot.
- Explicit reconciliation may return service events in the snapshot. The Store reconciles the run/automation snapshot before replaying those events, and ignores a delayed event whose `runId` or owner differs from the current script identity.
- An unavailable or incompatible service emits a scoped `service-state` failure. The Store retains already-known service-owned script identity instead of manufacturing an exit; enabled mode stays fail-closed and does not fall back to preload/renderer execution.
- `CreateRun` first honors an idempotency claim: the same key and fingerprint returns its existing run, while a changed fingerprint returns `idempotency_conflict`. A different request for an active `(projectId, scriptId)` returns `active_run_conflict` and creates no second visible run.
- `Runtime.Run` records non-cancellation iteration failures as degraded health and continues its ticker. A successful iteration or accepted complete automation configuration clears `lastError` and returns health to `running`. Error text is bounded and control characters are removed before exposure.
- An early service submission keeps the selected entry's original `plannedAt`, marks only that outbound entry `runEarly: true`, and waits for the accepted automation revision. The scheduler may claim it before its planned time exactly once; normal claim semantics prevent a later due run from duplicating it.
- Enable handoff blocks renderer submissions, exposes `starting`, starts and validates the service, synchronizes the complete automation revision, and persists `enabled: true` only after acknowledgement. A pre-commit failure stops a newly started service when possible, restores renderer ownership, and resumes its timer.

### 4. Validation & Error Matrix

- A terminal event for an older `runId` or different owner -> ignore it; retain the current script runtime and logs.
- A terminal event arrives before its matching start/result identity -> keep it pending by `(projectId, scriptId, runId)` until that identity is known, then settle it once.
- A service poll/read fails while enabled -> emit `service-state` with `unavailable` or `incompatible`; preserve known service runs and block new delegated work.
- A scheduler iteration fails with a non-cancellation error -> `/v1/state.scheduler.state` becomes `degraded`; the next ticker iteration still runs.
- A later successful scheduler iteration or accepted valid replacement configuration -> set scheduler state to `running` and clear `lastError`.
- A second active service start for the same project/script -> HTTP `409 active_run_conflict`; renderer reconciles the existing run or reports unavailable if it cannot recover that identity.
- A stale, already-running, past, or invalid early entry -> do not submit `runEarly` and do not change its plan/history.
- Initial handoff start, reconcile, or synchronization failure -> do not persist enabled ownership; resume renderer scheduling. A failure after enabled ownership is persisted -> retain service ownership and fail closed.

### 5. Good/Base/Bad Cases

- Good: a preload launch and a service launch both expose an owner-tagged `runId`; stop and input select the run using that identity even while a service PID is not yet available.
- Good: a service task completes while the plugin is open; the next bridge poll updates its plan entry, active-run guard, history, and scheduler status without a Settings refresh.
- Good: an older service snapshot reports a terminal run and its subsequent ordered event batch starts a newer run; the newer run remains current after reconciliation.
- Base: a browser or legacy fixture omits `runId`; compatibility processing may use matching PID only, but new preload/service events must not omit runtime identity.
- Bad: treat a failed status read as proof that a service process exited, then clear its `runId` or run renderer automation.
- Bad: change an early entry's `plannedAt` to now, which destroys the original schedule and can create duplicate/misclassified history.

### 6. Tests Required

- `npx vitest run tests/projectBridge.launchers.test.ts tests/projectBridge.uiPreferences.test.ts tests/projectRuntimeState.test.ts` must assert owner-tagged direct events, stale terminal-event rejection, snapshot/event ordering, duplicate cursor suppression, unavailable-service identity retention, handoff gating, `runEarly` submission, PID-less service stop/input/reconcile, and active-run-conflict recovery.
- `go -C service test ./internal/process/... ./internal/api/... ./internal/scheduler/...` must assert active-run conflict mapping, state serialization of scheduler health, non-cancellation scheduler recovery, bounded error text, and early-entry single claim behavior.
- `node --check public/preload.js` must pass after changing bridge polling, run normalization, or direct-process events.
- `npm run lint` and `npm run build` must pass after changing shared runtime types, Store reconciliation, or service-state UI handling.

### 7. Wrong vs Correct

#### Wrong

```ts
if (event.type === "exit") {
  script.status = "IDLE";
  script.pid = undefined;
}
```

This lets a delayed exit for an older process erase a newer visible run and treats PID as the authoritative identity.

#### Correct

```ts
if (script.runId && (event.runId !== script.runId || event.runtimeOwner !== script.runtimeOwner)) {
  return;
}

// Apply the matching event, then derive project status from all scripts.
```

Only the matching owner-neutral runtime identity may mutate a script's live state.
