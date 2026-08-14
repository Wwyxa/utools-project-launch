# Project Launch Service

> Executable contract for the optional local Go runtime.

## Scenario: Optional Service Ownership, Protocol, And Recovery

### 1. Scope / Trigger

- Trigger: a change touches `service/`, service installation/discovery in `public/preload.js`, the `ProjectBridge` service methods, service settings, process execution, or automation scheduling.
- The service is an opt-in local runtime for delegated script processes and automation. It does not own Git, files, AI, project catalog storage, or ordinary plugin preferences.
- This contract spans Vue/Pinia, the preload bridge, a loopback Go HTTP server, and local service files. Keep [Encrypted Automation State](./error-handling.md#scenario-project-launch-service-encrypted-automation-state) as the authoritative persistence-security supplement.

### 2. Signatures

- Service executable: `project-launch-service --state-dir <service-directory>`.
- Service bridge methods: `loadProjectLaunchServicePreferences`, `saveProjectLaunchServicePreferences`, `getProjectLaunchServiceStatus`, `downloadProjectLaunchService`, `startProjectLaunchService`, `stopProjectLaunchService`, `reconcileProjectLaunchService`, `syncProjectLaunchServiceAutomation`, `openProjectLaunchServiceDirectory`, and `openProjectLaunchServiceReleases`.
- Shared types: `ProjectLaunchServicePreferences`, `ProjectLaunchServiceStatus`, `ProjectLaunchServiceRun`, `ProjectLaunchServiceEvent`, `ProjectLaunchServiceAutomationConfig`, `ProjectLaunchServiceAutomationState`, and `ProjectLaunchServiceAutomationSyncResult` in `src/types.ts`.
- Loopback requests use `Authorization: Bearer <token>` and `X-Protocol-Version: 1`. JSON mutations also use `Content-Type: application/json`; `POST /v1/runs` requires `Idempotency-Key`.
- Protocol endpoints are `GET /v1/health`, `GET /v1/state`, `GET /v1/events?after=<cursor>`, `POST /v1/runs`, `POST /v1/runs/{runId}/input`, `POST /v1/runs/{runId}/stop`, `PUT /v1/automation/config`, and `POST /v1/shutdown`.

### 3. Contracts

- `ProjectLaunchServicePreferences.enabled` defaults to `false`. When it is `false`, opening Settings, plugin startup, status discovery, and recheck may not download, start, or enable the service. When a previously enabled service is stopped by a device restart, plugin-open reconciliation may start only the already verified installed executable; it never downloads, updates, or enables a service implicitly.
- With service mode disabled, preload owns new script launches and the renderer owns automation. With it enabled, all new script launches and automation belong to the service; there are no per-project, per-script, or per-task ownership switches.
- A service-enabled but missing, incompatible, or unreachable runtime fails closed for delegated launches and automation. The plugin and unrelated features remain usable, but code must not silently use the preload/renderer owner.
- The fixed service-managed root is `~/.utools-project-launch/service/`, derived from the existing application root. The root-level `~/.utools-project-launch/device-id.v1` remains in place and is not service data. The executable, `discovery.json`, `token`, `state.json`, bounded logs, downloads, and temporary update files must all stay below `service/`. Discovery must name a loopback host, valid port, the exact service token path, PID, process identity, protocol version, and instance id.
- Installation writes `downloads/<executable>.partial`, verifies it, then atomically replaces the executable and records the verified target asset and SHA-256 in restricted `install.json` metadata. Automatic reconciliation of persisted enabled mode verifies the executable against that local metadata before spawning it and never downloads or checks the network during startup. A failed install removes partial files and restores a replaced executable from `update.backup`; a successful replacement removes the backup. Clean service shutdown removes owned discovery, and preload removes stale discovery only after validating that its recorded owner is absent.
- The service listens only on `127.0.0.1:0`. Preload validates discovery, token location, process identity, health response, and protocol compatibility before trusting an endpoint. Remove a stale discovery file only after identity validation proves its owner is absent.
- The Go handler authenticates every endpoint before routing. It rejects bad token, incompatible protocol, unsupported media type, oversized JSON, malformed/extra JSON values, and invalid event cursors with typed HTTP errors. A launch retry with the same idempotency key must return the original run; reusing it for different input conflicts.
- `runId` is the stable public identity. PID is diagnostic data only. Recovered runs must validate both PID and OS process identity before stop/control; an identity mismatch becomes lost/ended state rather than controlling a reused PID.
- Enabling service mode pauses every renderer scheduling entry point before starting/synchronizing the service. Persist `enabled=true` only after the service accepts the complete monotonic automation configuration revision. A failed initial start, reconcile, or synchronization before that write clears the handoff barrier, keeps renderer ownership, and resumes renderer scheduling. A later runtime failure after `enabled=true` is persisted reports an unavailable status but keeps service mode enabled: new delegated launches and automation must remain fail-closed until the user explicitly and successfully disables service mode. Disabling requires service-owned active runs to stop first.
- The service owns bounded event/output history and returns cursor/truncation metadata. `ProjectLaunchServiceAutomationConfig` is input only; `ProjectLaunchServiceAutomationState` in `ProjectLaunchServiceStatus` exposes only a revision and optional executions, never a configuration or environment map. The service must not log tokens, full environments, or credentials.
- State retains the latest 20 terminal automation executions per `(projectId, taskId)` while retaining active executions. Run output is stored as `logs/<runId>.log`, capped to the newest 5 MiB per run and 100 MiB in total. When the total cap is exceeded, delete the oldest completed-run logs first; only then trim active logs to their newest bounded tail until the total is within the cap.
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
- Event cursor precedes retained history -> return truncation metadata; the renderer must reconcile from the available boundary instead of inventing missing output.

### 5. Good/Base/Bad Cases

- Good: a user clicks Download, manually enables a healthy compatible service, and a subsequent long-running script is restored from service state after uTools restarts.
- Good: a user previously enabled a verified service, restarts the device, then opens the plugin; reconciliation starts the installed executable and restores service-owned state without an implicit download.
- Good: service startup sees a stale discovery record, verifies the recorded process identity is gone, removes that record, and writes a new loopback-only discovery file.
- Good: enabling service mode clears the renderer timer, waits for configuration acknowledgement, then records the enabled preference so one planned entry can run only once.
- Base: a user never installs or enables the service; plugin startup continues using the former preload and renderer behavior with no Go executable start or Go toolchain requirement.
- Bad: a component reads `discovery.json`, sends an unauthenticated local HTTP request, or starts a service executable directly.
- Bad: a failed service health check falls back to `runCommand` in preload while the global service setting remains enabled.
- Bad: a persisted PID is used as authority to stop a process without process-identity validation.

### 6. Tests Required

- `go -C service test ./...` covers authentication/protocol rejection, request limits, discovery lifecycle, state/token integrity, idempotency, process-tree stop, recovered-run identity checks, scheduler claims, and executable restart/reconnect.
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