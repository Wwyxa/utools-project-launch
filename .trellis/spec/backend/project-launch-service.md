# Project Launch Service

> Executable contract for the optional local Go runtime.

## Scenario: Optional Service Ownership, Protocol, And Recovery

### 1. Scope / Trigger

- Trigger: a change touches `service/`, service installation/discovery in `public/preload.js`, the `ProjectBridge` service methods, service settings, process execution, or automation scheduling.
- The service is an opt-in local runtime for delegated script processes and automation. It does not own Git, files, AI, project catalog storage, or ordinary plugin preferences.
- This contract spans Vue/Pinia, the preload bridge, a loopback Go HTTP server, and local service files. Keep [Encrypted Automation State](./error-handling.md#scenario-project-launch-service-encrypted-automation-state) as the authoritative persistence-security supplement.

### 2. Signatures

- Service executable: `project-launch-service --state-dir <service-directory>`.
- Service bridge methods: `loadProjectLaunchServicePreferences`, `saveProjectLaunchServicePreferences`, `getProjectLaunchServiceStatus`, `downloadProjectLaunchService`, `verifyProjectLaunchServiceInstall`, `startProjectLaunchService`, `stopProjectLaunchService`, `reconcileProjectLaunchService`, `getProjectLaunchServiceRunLog`, `getProjectLaunchServiceRunLogPage`, `getProjectLaunchServiceLogRetention`, `updateProjectLaunchServiceLogRetention`, `listProjectLaunchServiceLogs`, `clearProjectLaunchServiceLogs`, `syncProjectLaunchServiceAutomation`, `openProjectLaunchServiceDirectory`, and `openProjectLaunchServiceReleases`.
- Shared types: `ProjectLaunchServicePreferences`, `ProjectLaunchServiceStatus`, `ProjectLaunchServiceRun`, `ProjectLaunchServiceEvent`, `ProjectLaunchServiceRunLog`, `ProjectLaunchServiceLogRetentionPolicy`, `ProjectLaunchServiceLogRetentionStatus`, `ProjectLaunchServiceLogDescriptor`, `ProjectLaunchServiceLogClearResult`, `ProjectLaunchServiceAutomationConfig`, `ProjectLaunchServiceAutomationState`, and `ProjectLaunchServiceAutomationSyncResult` in `src/types.ts`.
- `ProjectLaunchServiceAutomationConfig` has one wire shape: `{ schemaVersion: 1, revision, projects }`. Each task uses `schedule`, `scheduleAlgorithmVersion: 1`, and optional `manualRun` or `runEarlyEntryId`; the service payload does not contain renderer-materialized `dailyPlans`.
- `PUT /v1/automation/config` receives `{ revision, config }`; the wrapper `revision` and `config.revision` must match. The service materializes plans from the schedule and persists accepted manual/early submissions.
- Loopback requests use `Authorization: Bearer <token>` and `X-Protocol-Version: 2`. JSON mutations also use `Content-Type: application/json`; `POST /v1/runs` requires `Idempotency-Key`.
- Protocol endpoints are `GET /v1/health`, `GET /v1/state`, `GET /v1/events?after=<cursor>`, `GET /v1/sync?after=<cursor>`, `GET /v1/runs/{runId}/log?before=<byte-offset>`, `GET/PUT /v1/log-retention`, `GET /v1/logs?projectId=<id>`, `POST /v1/logs/clear`, `POST /v1/runs`, `POST /v1/runs/{runId}/input`, `POST /v1/runs/{runId}/stop`, `PUT /v1/automation/config`, and `POST /v1/shutdown`.

### 3. Contracts

- `ProjectLaunchServicePreferences.enabled` defaults to `false`. When it is `false`, opening Settings, plugin startup, status discovery, and recheck may not download, start, or enable the service. When a previously enabled service is stopped by a device restart, plugin-open reconciliation may start only the already verified installed executable; it never downloads, updates, or enables a service implicitly.
- With service mode disabled, preload owns new script launches and the renderer owns automation. With it enabled, all new script launches and automation belong to the service; there are no per-project, per-script, or per-task ownership switches.
- A service-enabled but missing, incompatible, or unreachable runtime fails closed for delegated launches and automation. The plugin and unrelated features remain usable, but code must not silently use the preload/renderer owner.
- The fixed service-managed root is `~/.utools-project-launch/service/`, derived from the existing application root. The root-level `~/.utools-project-launch/device-id.v1` remains in place and is not service data. The executable, `discovery.json`, `token`, `state.json`, bounded logs, downloads, and temporary update files must all stay below `service/`. Discovery must name a loopback host, valid port, the exact service token path, PID, process identity, protocol version, and instance id.
- Installation writes `downloads/<executable>.partial`, verifies it, then atomically replaces the executable and records the verified target asset and SHA-256 in restricted `install.json` metadata. Automatic reconciliation of persisted enabled mode verifies the executable against that local metadata before spawning it and never downloads or checks the network during startup. A failed install removes partial files and restores a replaced executable from `update.backup`; a successful replacement removes the backup. Clean service shutdown removes owned discovery, and preload removes stale discovery only after validating that its recorded owner is absent.
- An explicitly requested Settings recheck may record the SHA-256 of an already placed executable in the same restricted `install.json` metadata after confirming the service is not running. When the user explicitly enables a stopped installed service, the Store performs this same local verification before startup and passes that completed verification into the immediate launch so the executable is not hashed twice; a verification or startup failure leaves service mode disabled. Passive status reads never create trust metadata. A Settings update check reads only the latest Release metadata and `checksums.txt`; it must not download, replace, stop, or restart a running service. When it finds a newer target, it reports a pending update until the service has no active work and the user explicitly downloads it.
- The service listens only on `127.0.0.1:0`. Preload validates discovery, token location, process identity, health response, and protocol compatibility before trusting an endpoint. Remove a stale discovery file only after identity validation proves its owner is absent.
- The Go handler authenticates every endpoint before routing. It rejects bad token, incompatible protocol, unsupported media type, oversized JSON, malformed/extra JSON values, and invalid event cursors with typed HTTP errors. A launch retry with the same idempotency key must return the original run; reusing it for different input conflicts.
- `runId` is the stable public identity. PID is diagnostic data only. Recovered runs must validate both PID and OS process identity before stop/control; an identity mismatch becomes lost/ended state rather than controlling a reused PID.
- On Windows, launched commands must use `CREATE_NO_WINDOW`, `CREATE_NEW_PROCESS_GROUP`, and `HideWindow`. Service stop enumerates the process tree through native Windows APIs and terminates processes directly, so it does not spawn console helpers during stop or process-existence checks.
- Enabling service mode pauses every renderer scheduling entry point before starting/synchronizing the service. Persist `enabled=true` only after the service accepts the complete monotonic automation configuration revision. A failed initial start, reconcile, or synchronization before that write clears the handoff barrier, keeps renderer ownership, and resumes renderer scheduling. A later runtime failure after `enabled=true` is persisted reports an unavailable status but keeps service mode enabled: new delegated launches and automation must remain fail-closed until the user explicitly and successfully disables service mode. Disabling requires service-owned active runs to stop first.
- Automation configuration is a single development-stage schema: use `schemaVersion: 1` for the schedule-driven service-owned payload. Do not add `automationSchemaVersions`, capability-based payload selection, legacy `dailyPlans` serialization, or automation-payload fallback support for an older service binary. This schema version is independent from transport `X-Protocol-Version: 2`; the current transport requires the combined `/v1/sync` response.
- The service owns bounded event/output history and returns cursor/truncation metadata. `ProjectLaunchServiceAutomationConfig` is input only; `ProjectLaunchServiceAutomationState` in `ProjectLaunchServiceStatus` exposes only a revision and optional executions, never a configuration or environment map. The service must not log tokens, full environments, or credentials.
- State retains the latest 20 terminal automation executions per `(projectId, taskId)` while retaining active executions. Run output is stored as `logs/<runId>.log`, capped to the newest 5 MiB per run, 100 MiB in total, and 200 retained log files. Output events use a per-run buffer and flush at about 64 KiB or 200 ms; enforce retention at startup, bounded flush thresholds, run completion, policy changes, service close, and explicit clear boundaries rather than scanning on every line. When the file-count or total-size cap is exceeded, delete the oldest completed-run logs first; only then trim active logs to their newest bounded tail until the total is within the size cap. Active runs may temporarily exceed the file-count cap rather than losing their live log.
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
- Automation `schemaVersion` other than `1`, or a wrapper/config revision mismatch -> HTTP `400` with `automation_config_invalid`; a stale accepted revision -> HTTP `409` with `automation_revision_conflict`.
- Reused launch idempotency key with the same fingerprint -> return the prior run; a different fingerprint -> conflict without a second process.
- Accepted automation revision -> atomically replaces the complete normalized configuration.
- Active service run during shutdown/disable -> reject shutdown or keep service mode enabled until explicit stop succeeds.
- Windows stop -> enumerate and terminate the process tree without spawning a visible console helper or relying on a shell command for process-existence checks.
- Event cursor precedes retained history -> return truncation metadata; the renderer must reconcile from the available boundary instead of inventing missing output.
- Invalid or unknown run id, or a log already removed by retention -> HTTP `404` with `run_log_unavailable` or the generic endpoint `not_found`; the Terminal keeps live logs unchanged and shows an unavailable message.

### 5. Good/Base/Bad Cases

- Good: a user clicks Download, manually enables a healthy compatible service, and a subsequent long-running script is restored from service state after uTools restarts.
- Good: a user previously enabled a verified service, restarts the device, then opens the plugin; reconciliation starts the installed executable and restores service-owned state without an implicit download.
- Good: service startup sees a stale discovery record, verifies the recorded process identity is gone, removes that record, and writes a new loopback-only discovery file.
- Good: enabling service mode clears the renderer timer, waits for configuration acknowledgement, then records the enabled preference so one planned entry can run only once.
- Good: the Store sends one schema-v1 schedule payload; a manual request uses `manualRun`, and an early request uses `runEarlyEntryId` while preserving the selected entry's original `plannedAt`.
- Good: after reopening uTools, the user opens Terminal log history, selects a completed run, and reads its retained output without adding those rows to the live terminal stream.
- Base: a user never installs or enables the service; plugin startup continues using the former preload and renderer behavior with no Go executable start or Go toolchain requirement.
- Bad: a component reads `discovery.json`, sends an unauthenticated local HTTP request, or starts a service executable directly.
- Bad: a failed service health check falls back to `runCommand` in preload while the global service setting remains enabled.
- Bad: negotiate an automation capability list or send renderer `dailyPlans` to support an older service binary; frontend and service use the one schedule-driven schema together during development.
- Bad: a persisted PID is used as authority to stop a process without process-identity validation.
- Bad: routing service-owned process termination through an external shell command and reintroducing a console helper into the stop path.

### 6. Tests Required

- `go -C service test ./...` covers authentication/protocol rejection, request limits, discovery lifecycle, state/token integrity, idempotency, process-tree stop, recovered-run identity checks, scheduler claims, executable restart/reconnect, log file-count eviction, and retained-log API reads.
- Windows process tests assert console isolation flags on launched commands and cover native process-tree enumeration and termination.
- `go -C service vet ./...` and `gofmt -l service` pass after Go changes; `npm run go:build` produces only ignored local developer output under `service/bin/`.
- Bridge/store tests cover default-off status, explicit manual and enable-time install verification, automatic startup rejection after an executable replacement, update checks that do not download or replace the executable, enabled-unavailable fail-closed behavior, ownership-handoff timer pause, accepted configuration revision, and reconciliation of service status/events.
- Automation contract tests assert `schemaVersion: 1`, schedule-driven tasks without service `dailyPlans`, `manualRun`/`runEarlyEntryId` submission metadata, rejection of schema-version or revision mismatches, and absence of capability negotiation in status or payload construction.
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

## Scenario: Unified Runtime Identity, Efficient Live State, And Scheduler Recovery

### 1. Scope / Trigger

- Trigger: a change affects script lifecycle identity, service synchronization polling, `/v1/state`, `/v1/sync`, scheduler execution, service-owned automation submission, or the enabled-mode handoff.
- This requires code-spec depth because `src/types.ts`, `public/preload.js`, `src/store/useStore.ts`, the Go API, supervisor state, and scheduler all exchange the same runtime facts.
- Script processes may have either owner, but Git, files, AI, and external application launchers remain outside the service runtime.

### 2. Signatures

- `ProjectBridgeRunResult` and `ProjectBridgeEvent` carry `runId?: string` and `runtimeOwner?: "preload" | "service"`; real preload and service events always provide both fields.
- `ProjectBridgeServiceStateEvent` is `{ type: "service-state"; status: ProjectLaunchServiceStatus; timestamp?: string }` and is delivered on the existing bridge event subscription.
- `ProjectLaunchServiceStatus` may include `runs`, `events`, cursor/truncation metadata, `automation`, and `scheduler?: { state: "running" | "degraded"; lastRunAt?: string; lastSuccessAt?: string; lastError?: string }`.
- `GET /v1/sync?after=<cursor>` returns `{ health, state, events }`: `health` has the same validated identity fields as `/v1/health`, `state` has the `/v1/state` snapshot shape, and `events` has the `/v1/events` cursor/truncation batch shape.
- While a preload reconciliation returns a partial event batch, its `ProjectLaunchServiceStatus` exposes `eventsHasMore: true`; event-poll broadcasts carry the final snapshot only after that flag becomes false.
- `GET /v1/health`, `GET /v1/state`, and `GET /v1/events?after=<cursor>` remain the compatibility sequence for a service that returns `404` for `/v1/sync`.
- `Runtime.Run(ctx)` runs an iteration immediately, then waits on either the next computed deadline, a configuration wake signal, or context cancellation.
- `POST /v1/runs` returns `409 { "code": "active_run_conflict" }` when an active run already owns the same `projectId` and `scriptId`.
- Service automation submission metadata is task-level: `manualRun` represents a persisted one-shot request and `runEarlyEntryId` selects an existing plan entry for early execution; neither changes the selected entry's `plannedAt`.

### 3. Contracts

- `runId` is the stable logical identity and `runtimeOwner` disambiguates its implementation. PID is diagnostic/process-control data only and must not decide whether an event is current.
- Preload generates a `runId` for every direct launch and emits it with `runtimeOwner: "preload"`. It normalizes service events and service runs with `runtimeOwner: "service"` before exposing them to the Store.
- A live service poll requests authenticated `GET /v1/sync?after=<cursor>`. Any non-`200` response, including `404`, or a malformed combined payload is a scoped unavailable/incompatible failure, not a preload fallback.
- `/v1/sync` obtains the state run snapshot and its event page from one state-store read lock, so a terminal run and its newly appended terminal event cannot be split by a process transition between two reads. When `events.hasMore` is true, preload advances the cursor and dispatches that page's process events, but defers the `service-state` snapshot until the final page; a renderer may retain an already-known matching service identity only until that buffered terminal sequence settles.
- Keep the existing `750 ms` poll cadence for a healthy service. Advance the cursor from the returned batch, emit each normalized process event, then emit one `service-state` snapshot with `events: []`. Suppress that snapshot only when the batch is empty and the status signature is unchanged; an empty healthy poll must not create redundant Pinia work.
- Explicit reconciliation may return service events in the snapshot. The Store reconciles the run/automation snapshot before replaying those events, and ignores a delayed event whose `runId` or owner differs from the current script identity.
- An unavailable or incompatible service emits a scoped `service-state` failure. The Store retains already-known service-owned script identity instead of manufacturing an exit; enabled mode stays fail-closed and does not fall back to preload/renderer execution.
- `CreateRun` first honors an idempotency claim: the same key and fingerprint returns its existing run, while a changed fingerprint returns `idempotency_conflict`. A different request for an active `(projectId, scriptId)` returns `active_run_conflict` and creates no second visible run.
- `Runtime.Run` derives its next delay from the earliest unclaimed eligible plan entry and waits with one `time.Timer`; an idle scheduler may wait up to `24h`. While an unclaimed future plan exists, cap one wait at `30s` so a device waking from sleep recomputes against wall-clock time before its grace window expires. `ReplaceConfiguration` signals an immediate wake, while recovered-process reconciliation retains a `500 ms` poll. Non-cancellation iteration failures set degraded health and retry from `1s` with exponential backoff capped at `1m`; a later successful iteration or accepted complete configuration clears `lastError` and returns health to `running`. Error text is bounded and control characters are removed before exposure.
- An early service submission keeps the selected entry's original `plannedAt`, sends only its task-level `runEarlyEntryId`, and waits for the accepted automation revision. The scheduler materializes that selected entry as early exactly once; normal claim semantics prevent a later due run from duplicating it.
- Enable handoff blocks renderer submissions, exposes `starting`, starts and validates the service, synchronizes the complete automation revision, and persists `enabled: true` only after acknowledgement. A pre-commit failure stops a newly started service when possible, restores renderer ownership, and resumes its timer.

### 4. Validation & Error Matrix

- A terminal event for an older `runId` or different owner -> ignore it; retain the current script runtime and logs.
- A terminal event arrives before its matching start/result identity -> keep it pending by `(projectId, scriptId, runId)` until that identity is known, then settle it once.
- `/v1/sync` returns a non-`200` response or an invalid `{ health, state, events }` body -> emit an unavailable service state and retain existing service-owned runtime identity.
- A healthy sync batch is empty and the status signature is unchanged -> do not emit `service-state`; a non-empty batch -> emit all process events and exactly one reconciliation snapshot.
- A sync page has `hasMore=true` while the state reports a current run as terminal -> emit that page's process events without a `service-state` snapshot; emit the snapshot only after the final page so its later `stdout`/`exit` events retain the current identity.
- A service poll/read fails while enabled -> emit `service-state` with `unavailable` or `incompatible`; preserve known service runs and block new delegated work.
- An automation configuration replacement arrives while the scheduler is idle -> wake immediately instead of waiting for the old deadline; a recovered run remains eligible for the bounded `500 ms` reconciliation poll.
- A scheduler iteration fails with a non-cancellation error -> `/v1/state.scheduler.state` becomes `degraded`; retry with bounded exponential backoff and continue serving future plans.
- A later successful scheduler iteration or accepted valid replacement configuration -> set scheduler state to `running` and clear `lastError`.
- A second active service start for the same project/script -> HTTP `409 active_run_conflict`; renderer reconciles the existing run or reports unavailable if it cannot recover that identity.
- A stale, already-running, past, or invalid early entry -> do not submit `runEarlyEntryId` and do not change its plan/history.
- A device wakes from sleep while a future plan was pending -> re-evaluate within `30s`; run an entry still inside its grace period, otherwise record it as missed.
- Initial handoff start, reconcile, or synchronization failure -> do not persist enabled ownership; resume renderer scheduling. A failure after enabled ownership is persisted -> retain service ownership and fail closed.

### 5. Good/Base/Bad Cases

- Good: a preload launch and a service launch both expose an owner-tagged `runId`; stop and input select the run using that identity even while a service PID is not yet available.
- Good: a service task completes while the plugin is open; one sync response updates its plan entry, active-run guard, history, scheduler status, and ordered output without a Settings refresh.
- Good: a one-shot service command exits after a large buffered output burst; paged sync delivers `started`, then later output/exit events before its terminal snapshot settles the run, while a different active service script remains running.
- Good: an older service snapshot reports a terminal run and its subsequent ordered event batch starts a newer run; the newer run remains current after reconciliation.
- Base: a current service returns one validated `{ health, state, events }` response for `/v1/sync`; preload advances the cursor and reconciles the snapshot before exposing events.
- Base: a browser or legacy fixture omits `runId`; compatibility processing may use matching PID only, but new preload/service events must not omit runtime identity.
- Bad: treat a failed status read as proof that a service process exited, then clear its `runId` or run renderer automation.
- Bad: issue the legacy three-request sequence instead of the required `/v1/sync` response, or broadcast an unchanged empty healthy snapshot every poll.
- Bad: change an early entry's `plannedAt` to now, which destroys the original schedule and can create duplicate/misclassified history.

### 6. Tests Required

- `npx vitest run tests/projectBridge.launchers.test.ts tests/projectBridge.uiPreferences.test.ts tests/projectRuntimeState.test.ts` must assert owner-tagged direct events, `/v1/sync` consumption, non-`200` synchronization failure without legacy fallback, unchanged-empty broadcast suppression, terminal snapshot replay for same-page and paged buffered output, stale terminal-event rejection, snapshot/event ordering, duplicate cursor suppression, unavailable-service identity retention, handoff gating, `runEarlyEntryId` submission, PID-less service stop/input/reconcile, and active-run-conflict recovery.
- `go -C service test ./internal/state/... ./internal/process/... ./internal/api/... ./internal/scheduler/...` must assert active-run conflict mapping, atomic `/v1/sync` run-snapshot/event-page reads, health/state/event serialization, configuration wake-up, idle deadline selection, future-plan `30s` recovery recheck, state serialization of scheduler health, non-cancellation scheduler recovery, bounded error text, and early-entry single claim behavior.
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

#### Wrong

```js
const health = await requestProjectLaunchServiceHealth(connection);
const events = await requestProjectLaunchServiceEvents(connection, cursor);
const state = await requestProjectLaunchServiceState(connection);
emit({ type: "service-state", status: { ...state, events } });
```

This keeps three healthy polling requests and broadcasts unchanged empty state on every cycle.

#### Correct

```js
const sync = await requestProjectLaunchServiceSync(connection, cursor);
const health = sync ? sync.health : await requestProjectLaunchServiceHealth(connection);
const batch = sync ? sync.events : await requestProjectLaunchServiceEvents(connection, cursor);
const state = sync ? sync.state : await requestProjectLaunchServiceState(connection);
advanceProjectLaunchServiceEventCursor(batch);
emitProcessEvents(batch.events);
emitChangedServiceState({ ...state, health, events: [] }, batch.events.length);
```

Prefer the required combined response and make an empty unchanged poll invisible to the Store.
