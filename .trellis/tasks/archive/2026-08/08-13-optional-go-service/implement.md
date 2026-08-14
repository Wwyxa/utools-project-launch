# Project Launch Service Implementation Plan

## Preconditions

- User approves the latest planning summary in a subsequent message.
- Run `task.py start` only after approval and context manifests validate.
- Before product edits, load `trellis-before-dev` and the relevant backend/frontend specs.

## Phase 1: Go Runtime Skeleton

- [ ] Add `service/go.mod` and the `cmd/project-launch-service` entry point using the standard library only.
- [ ] Implement version injection, loopback bind, token/discovery files, `/v1/health`, and graceful idle shutdown.
- [ ] Add atomic state-file helpers and restrictive token/discovery permissions where supported.
- [ ] Add focused Go tests for discovery lifecycle, stale metadata, authentication, protocol mismatch, and request limits.
- [ ] Measure all six binaries and confirm the 12 MiB gate before adding process or scheduler code.

Validation:

```text
gofmt -l service
go vet ./...
go test ./...
CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w -X main.version=<tag>" ./cmd/project-launch-service
```

Rollback point: remove the isolated `service/` tree; no plugin behavior is connected yet.

## Phase 2: Installer and Settings Surface

- [ ] Add device-local service preference and status types with `enabled=false` defaults.
- [ ] Reuse `~/.utools-project-launch` as the shared application root without changing the existing `device-id.v1` contract.
- [ ] Keep the service executable, state, token, logs, download partials, and update backups under the single `~/.utools-project-launch/service/` directory; verify no service files are created directly beside `device-id.v1`.
- [ ] Extend preload with authoritative platform/architecture detection, path resolution, local discovery, manual recheck, open-directory, and open-Releases actions.
- [ ] Implement click-triggered GitHub Release lookup/download, bounded redirects/timeouts, SHA-256 verification, partial-file cleanup, executable permissions, and atomic installation.
- [ ] Add browser fallback methods that never claim the service is available and preserve existing no-service behavior.
- [ ] Add the settings section with all local/download/manual-install states and concise bilingual guidance.
- [ ] Verify opening settings causes no network request, download, service start, or setting change.

Focused validation:

```text
node --check public/preload.js
npm run type-check
vitest run tests/projectBridge.* tests/useStore.*
npm run build
```

Add focused tests for platform/asset mapping, path resolution, checksum mismatch, canceled/failed download cleanup, manual recheck, and default-off storage compatibility.

Rollback point: service remains disconnected from script execution; removing settings/preload installer methods restores prior behavior.

## Phase 3: Process Supervision and Reconnect

- [ ] Implement run IDs, idempotent launch, process metadata persistence, ordered events, bounded per-run logs, status queries, stdin, and explicit stop.
- [ ] Implement Windows and Unix process-tree behavior with platform files and focused tests/helpers.
- [ ] Add the preload service client and event long-poll cursor with typed failures.
- [ ] Route the shared `runCommand`, status, input, and stop bridge path by the global owner setting.
- [ ] Keep existing preload implementation unchanged for `enabled=false`; fail closed for launches when `enabled=true` but service validation fails.
- [ ] Reconcile service-owned state into existing store script status/log structures after plugin/uTools restart.
- [ ] Block enable/disable while the current owner has active runs; add explicit stop-all and retry flow.

Focused validation:

```text
go test ./internal/process/... ./internal/api/... ./internal/state/...
node --check public/preload.js
npm run type-check
vitest run <runtime-focused tests>
npm run validate:process-results
```

Manual lifecycle gate:

1. Start a service-owned long-running command.
2. Close the plugin and fully exit uTools.
3. Confirm the command remains alive.
4. Reopen uTools and confirm state/log replay.
5. Stop it and confirm the complete descendant tree exits.

Rollback point: disable service mode only after all service runs stop; subsequent launches use the existing preload path.

## Phase 4: Scheduler Ownership Transfer

- [ ] Extract or share normalized automation payload construction without duplicating product rules in components.
- [ ] Implement service configuration revisioning, atomic replace, deterministic plan-entry claim keys, missed policies, serial execution, timeouts, input/output matching, exit matching, and bounded history.
- [ ] Transfer ownership in two phases: service persists/acknowledges config, then frontend scheduler pauses.
- [ ] On reconnect, validate service health/revision before keeping the frontend scheduler paused and reconcile authoritative history/status.
- [ ] Block automation when service mode is enabled but unavailable; never invoke the renderer scheduler as fallback.
- [ ] Return ownership to the renderer only after the service has no active runs and acknowledges scheduler disable/shutdown.

Focused validation:

```text
go test ./internal/scheduler/... ./internal/state/... ./internal/api/...
npm run type-check
vitest run <automation and store-focused tests>
npm run build
```

Lifecycle acceptance gate:

1. Schedule one near-term task.
2. Fully exit uTools before its planned time.
3. Confirm one execution occurs.
4. Reopen and confirm exactly one reconciled history entry.
5. Repeat across service restart and request retry scenarios to prove idempotency.

Rollback point: return scheduler ownership explicitly, then disable service mode; do not delete automation definitions.

## Phase 5: CI and GitHub Release

- [ ] Add a Go CI workflow for formatting, vet, tests, and all-target builds on pull requests.
- [ ] Add a tag-triggered release workflow for the six-target matrix.
- [ ] Embed the tag version, enforce the 12 MiB raw executable limit, generate/verify `checksums.txt`, and publish deterministic raw assets.
- [ ] Ensure release jobs use least-required permissions and never publish from pull-request workflows.
- [ ] Add documentation for download, manual installation, enable/disable, data paths, recovery, and supported platform matrix.

Validation:

```text
git diff --check
npm run lint
npm run build
node --check public/preload.js
go vet ./...
go test ./...
<local release-build script or workflow-equivalent dry run>
```

Release acceptance gate: inspect one draft/test release and verify every expected asset, checksum, embedded version, executable format, and size.

## Phase 6: Full Quality Gate

- [ ] Dispatch the `trellis-check` agent with the active task path and curated `check.jsonl` context.
- [ ] Run existing project-specific validations affected by preload/store/process changes.
- [ ] Verify default-off behavior on a clean profile with no Go binary and no Go installation.
- [ ] Verify network failure, checksum failure, permission failure, stale discovery, incompatible protocol, and occupied/stale service states.
- [ ] Verify service logs never contain environment secrets or bearer tokens.
- [ ] Verify no Git behavior or Git performance path changed.
- [ ] Record final measured binary sizes for every target.

Required full checks:

```text
npm run lint
npm run build
npm run validate:process-results
npm run validate:project-storage
node --check public/preload.js
go vet ./...
go test ./...
git diff --check
python ./.trellis/scripts/task.py validate 08-13-optional-go-service
```

## High-Risk Files and Boundaries

- `public/preload.js`: current process owner and all native plugin capabilities; avoid unrelated refactors.
- `src/store/useStore.ts`: scheduler and runtime state; ownership must be centralized and duplicate execution impossible.
- `src/types.ts`: preserve existing bridge compatibility while adding typed service results.
- `src/lib/projectBridge.ts`: fallback must keep no-service/browser behavior working.
- `src/components/layout/SettingsTab.vue`: settings already has several concerns; keep service UI isolated and avoid broad redesign.
- `.github/workflows/**`: release permissions, tag conditions, deterministic artifacts, and size/checksum gates.

## Explicit Deferrals

- Git migration or Go Git libraries.
- OS boot/login startup.
- Database adoption.
- UPX compression.
- macOS notarization until an actual Gatekeeper distribution failure is reproduced.
- Remote control, cloud synchronization, and plugin APIs.
