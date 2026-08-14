# Project Launch Service Design

## 1. Design Goals

- Preserve current behavior when the service is globally disabled.
- Give one component exclusive ownership of every new script launch and automation schedule when the service is enabled.
- Survive plugin close/reopen and complete uTools process exit without requiring administrator privileges.
- Remain small, cross-platform, single-file, and independently releasable.
- Keep existing Git, file, AI, environment, launcher, and project-storage operations in preload.

## 1.1 Final Architecture Decision

The independent local service boundary is the necessary part of this solution; the Go single executable is the selected first implementation, not a claim that Go is the smallest possible binary or the fastest language in every workload.

For this project, Go is the best overall trade-off because it provides:

- a self-contained executable with no Go runtime or package installation requirement;
- straightforward Windows/Linux/macOS cross-compilation from GitHub Actions;
- a standard-library implementation for local HTTP, JSON, process supervision, hashing, and file persistence;
- a measured pure-Go baseline of about 5.2-5.8 MiB per target after stripping, with a 12 MiB CI limit;
- a lower maintenance and release burden than Rust or platform-specific service implementations.

The alternatives were considered as follows:

| Alternative                                    | Why it is not the first choice                                                                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detached Node.js helper                        | Reuses JavaScript, but couples the service to the uTools/Electron Node runtime and normally needs multiple script/dependency files; it does not improve the lifecycle boundary enough to justify that coupling. |
| Rust executable                                | Can be smaller in some builds and offers strong systems-level control, but the expected size difference is not material for this service and the project has no Rust toolchain or codebase.                     |
| OS-native service or login daemon              | Better for device-reboot persistence, but introduces installers, permissions, signing, uninstall, and per-platform lifecycle code. It is unnecessary while the required survival boundary is uTools exit.       |
| Python, .NET, or a process manager such as PM2 | Adds a runtime, package, or external installation dependency and conflicts with the optional, manually recoverable, single-file delivery goal.                                                                  |

Therefore the first release should keep the current design: `project-launch-service` as one downloaded executable, all service data under one `service/` directory, service mode disabled by default, and Git operations outside the service. The implementation should ship in phases, stabilizing process ownership and reconnect before enabling the scheduler transfer already described in the implementation plan.

The executable alone does not prove lifecycle independence. The release must include a real host-level test that starts the service from uTools, fully exits uTools, verifies the service and a managed child remain alive, then reconnects and stops the complete child tree. Windows must specifically verify whether the uTools parent job object requires a breakaway process-creation path; if so, implement that small platform-specific launch boundary rather than assuming `detached` is sufficient.

## 2. Non-Goals

- Device-reboot survival or OS service-manager installation.
- Remote access or LAN listening.
- Migrating Git operations to Go.
- A general extension/plugin architecture.
- Per-project, per-script, or per-automation service switches.
- Transparent fallback to preload while service mode remains enabled.

## 3. Naming

Use `Project Launch Service` (`项目启动服务`) as the product and user-facing service name. The implementation language remains Go, but the name does not expose that implementation detail or imply AI behavior. Use `project-launch-service` as the executable, command directory, and release-asset stem.

Deterministic asset names use the selected executable stem:

```text
project-launch-service-windows-amd64.exe
project-launch-service-windows-arm64.exe
project-launch-service-linux-amd64
project-launch-service-linux-arm64
project-launch-service-darwin-amd64
project-launch-service-darwin-arm64
checksums.txt
```

## 4. Architecture

```text
Vue / Pinia
  |
  | typed ProjectBridge calls and project-bridge-event events
  v
uTools preload.js
  |-- existing native capabilities (Git, files, AI, launchers, storage)
  |-- service installer / status adapter
  |-- service HTTP client and event cursor
  v
Optional Go service (127.0.0.1, random port, bearer token)
  |-- process supervisor
  |-- automation scheduler
  |-- bounded runtime/event persistence
  v
Project command process groups / trees
```

### Ownership invariant

- Service setting `enabled=false`: preload owns new script processes; renderer owns automation scheduling.
- Service setting `enabled=true`: Go service owns all new script processes and all automation scheduling.
- The selected owner is checked at the shared store/bridge execution boundary, not independently in individual components.
- When enabled service health/version validation fails, new launches and schedules fail closed with an actionable message. They never run through preload.

### Existing processes during mode changes

- Enabling service mode is blocked while preload-owned scripts or automation runs are active. The UI identifies active scripts and asks the user to stop them first.
- Disabling service mode is blocked while service-owned scripts or automation runs are active. The UI offers explicit stop-all and retry; it does not orphan, adopt, or silently terminate them.
- After a successful ownership switch, only future launches move to the new owner.

This avoids unsafe process adoption and keeps rollback deterministic.

## 5. Repository Boundaries

```text
service/
+-- go.mod
+-- cmd/project-launch-service/main.go
+-- internal/api/
+-- internal/process/
+-- internal/scheduler/
+-- internal/state/
+-- internal/platform/
+
+.github/workflows/
+-- service-ci.yml
+-- service-release.yml
+
+public/preload.js
+-- installation, discovery, startup, health, protocol client
+
+src/types.ts
+-- shared service status/preferences/protocol-facing bridge types
+
+src/lib/projectBridge.ts
+-- browser fallback preserving no-service behavior
+
+src/store/useStore.ts
+-- ownership routing, state reconciliation, scheduler handoff
+
+src/components/layout/SettingsTab.vue
+-- service installation, status, enable/disable, guidance
```

The first Go release uses the standard library only. Adding a Go dependency requires a measured requirement and explicit review of binary-size impact.

## 6. Installation and Data Directories

Reuse the existing application root created by the device-ID fallback:

```text
~/.utools-project-launch/
```

This resolves from `os.homedir()` on Windows, macOS, and Linux. Keeping one established root avoids migration of `device-id.v1`, makes manual installation guidance consistent, and avoids splitting application-owned data across two locations. The settings action opens this directory so users do not need to navigate hidden dot-directories manually on macOS/Linux.

The service has one file root: `~/.utools-project-launch/service/`. Every service-owned file, including the executable, discovery metadata, state, token, logs, download partials, and update backups, stays below this directory. The only file directly under the application root is the pre-existing `device-id.v1` managed by preload.

Layout:

```text
~/.utools-project-launch/
+-- device-id.v1
+-- service/                         # the only Project Launch Service file root
  +-- project-launch-service.exe   # Windows; no extension on macOS/Linux
  +-- discovery.json
  +-- state.json
  +-- token
  +-- logs/
  |   +-- <run-id>.log
  +-- downloads/
  |   +-- <asset-name>.partial
  +-- update.backup                # temporary; removed after health validation
```

- `device-id.v1` remains owned by the existing preload logic and is not moved or rewritten by the service.
- `service/` is the only directory created or managed by the service. Updates require the service to be stopped, then replace the executable atomically; temporary/backup files are removed after validation.
- The service directory contains exactly one installed executable for the current platform.
- `discovery.json` is generated while the service is available and records its local endpoint, PID identity, and version. It is removed on clean shutdown; stale copies are validated before cleanup.
- `state.json` persists scheduler configuration, run metadata, idempotency claims, cursors, and bounded history required for reconnect/recovery.
- `token` contains the random local authentication token and is created once with user-only permissions where supported.
- `logs/` contains bounded per-run output needed to replay logs after uTools restarts.
- `downloads/` contains only an in-progress download and is emptied after success, cancellation, or failure.
- Download to a `.partial` file, verify length and SHA-256, then atomically rename.
- On Linux/macOS, set the executable bit after verification.
- Service update is allowed only while stopped; keep one short-lived backup during replacement and delete it after the new binary passes a health check.
- The settings UI exposes the resolved binary path and an open-containing-directory action.
- Manual installation uses the same expected path and the same verify/recheck flow.

## 7. Download and Release Contract

### User flow

1. Service is shown as disabled and not installed by default.
2. Settings detects `process.platform` and `process.arch` through preload, not browser user-agent guessing.
3. The user can open the GitHub Releases page or click Download.
4. Download resolves the latest compatible service release and exact asset name.
5. Preload downloads only after that click, verifies SHA-256, installs atomically, and reports installed version.
6. Installation does not enable or start the service. The user performs a separate Enable action.
7. On failure, settings shows the release URL, expected asset name, destination path, open-directory action, and Recheck action.

### Release metadata

- Git tag/release version is embedded into the binary through `-ldflags -X main.version=<tag>`.
- Each GitHub asset has a deterministic name and a SHA-256 digest.
- `checksums.txt` is published even when the GitHub API returns `digest`, providing a stable manual verification source.
- Preload accepts only HTTPS GitHub URLs under the repository release path and enforces a bounded response size and timeout.
- Redirects are bounded and the final response must remain HTTPS.
- A failed or canceled download removes the partial file.

## 8. Service Lifecycle and Discovery

The service is a detached user process, not an OS-installed daemon.

- Enable starts the verified executable with `--state-dir <path>`.
- The service binds to `127.0.0.1:0`, writes discovery metadata atomically, and stays alive after its parent preload/uTools process exits.
- Discovery metadata contains protocol version, service version, PID, process start identity, port, and token-file path. The bearer token itself is stored separately with user-only permissions where supported.
- Preload validates the discovery file, process identity, loopback address, token, health response, and protocol compatibility before using the service.
- Stale discovery files are removed only after validation proves the service is absent.
- Disable requests graceful service shutdown only after all managed runs are stopped and scheduler ownership can be returned safely.

The first release does not start at device login. After a device reboot, opening the plugin while service mode is enabled starts the verified installed service before reconciling schedules.

## 9. Local Protocol

Use versioned JSON over HTTP on loopback TCP using Go `net/http` and Node's built-in HTTP client. Every request includes:

```text
Authorization: Bearer <random-install-token>
X-Protocol-Version: 1
Content-Type: application/json
```

Core endpoints:

| Method | Path                        | Purpose                                              |
| ------ | --------------------------- | ---------------------------------------------------- |
| GET    | `/v1/health`                | Service/protocol version and instance identity       |
| GET    | `/v1/state`                 | Managed runs, scheduler state, latest event cursor   |
| POST   | `/v1/runs`                  | Start one script command                             |
| POST   | `/v1/runs/{runId}/input`    | Send stdin                                           |
| POST   | `/v1/runs/{runId}/stop`     | Stop complete process tree                           |
| GET    | `/v1/events?after=<cursor>` | Long-poll ordered lifecycle/output events            |
| PUT    | `/v1/automation/config`     | Replace complete normalized automation configuration |
| POST   | `/v1/shutdown`              | Stop idle service during explicit disable            |

Protocol rules:

- Stable `runId` is the public identity; PID is diagnostic data only.
- Mutation requests include an idempotency key so retrying after a timeout cannot duplicate launches or configuration application.
- Events have monotonically increasing cursors, timestamps, project/script IDs, optional automation run ID, and the existing event semantics (`started`, `stdout`, `stderr`, `stdin`, `exit`, `error`).
- Requests and responses have explicit size limits and typed error codes.
- Major protocol mismatch blocks service mode and gives update/reinstall guidance.

## 10. Process Supervision

- Commands preserve the existing platform command-interpreter behavior and inherited environment semantics.
- Environment values are accepted for launch but never persisted or logged as a full map.
- Each process record contains `runId`, project/script identity, command metadata, start time, verified OS process identity, current state, and event cursor range.
- Windows starts commands in a process group/job-compatible boundary and terminates descendants on explicit stop.
- Unix starts a new process group, sends `SIGTERM`, then escalates to `SIGKILL` after a bounded grace period.
- Service startup reconciles persisted run records against OS process identity; a PID/start mismatch becomes an ended/lost record and is never controlled.

## 11. Automation Ownership and Reconciliation

- On enable, preload sends one normalized full configuration snapshot with a monotonic configuration revision.
- The service atomically persists and acknowledges the revision before the frontend scheduler is disabled.
- On plugin load with service mode enabled, the frontend scheduler remains paused until service health and configuration revision are reconciled.
- Each planned execution has a deterministic key derived from task ID and planned entry ID. The service persists claim/result state before launch so restart/retry cannot execute it twice.
- The service preserves existing schedule, missed policy, serial execution, timeout, input sequence, output match, exit match, and history semantics.
- The service is authoritative for delegated runtime status and automation history. The frontend reconciles into the existing project model and persists compatible snapshots for display/export.
- Configuration edits use replace-with-revision semantics; stale revisions are rejected.

## 12. Logs and Persistence

Use JSON state files and append-only run logs; do not add a database in the first release.

- State updates use write-temp, flush, and atomic rename.
- Per-run output is appended with cursor metadata.
- Default retention: latest 20 automation history entries per task, matching current behavior.
- Runtime log default caps: 5 MiB per run and 100 MiB total. Oldest completed-run logs are deleted first; active logs retain a bounded tail when their per-run cap is reached.
- Event reconciliation returns truncation metadata when earlier output has been evicted.
- Service diagnostic logs are separate from user terminal output and never include tokens, full environment maps, or AI credentials.

## 13. Settings UX

Add one unframed settings section consistent with the existing settings surface. It exposes:

- Global disabled/enabled switch.
- Detected platform and architecture.
- Installation state, installed version, protocol compatibility, and running health.
- Download button, cancel/progress state, Recheck button, open Releases button, and open-directory icon button with tooltip.
- Exact expected asset name and local destination for manual installation.
- Clear states: not installed, downloading, installed-disabled, starting, enabled-healthy, enabled-unavailable, incompatible, update available.
- Enable and disable confirmation only when active ownership or process shutdown requires user action.

Opening settings performs local discovery only. It must not download, enable, start, or update the service.

## 14. Build and Release

### Matrix

- `windows/amd64`
- `windows/arm64`
- `linux/amd64`
- `linux/arm64`
- `darwin/amd64`
- `darwin/arm64`

### Build flags

```text
CGO_ENABLED=0
go build -trimpath -buildvcs=false -ldflags="-s -w -X main.version=<tag>"
```

### CI gates

- `gofmt` check.
- `go vet ./...`.
- `go test ./...` including race-enabled host tests where supported.
- Build all six targets.
- Assert each raw executable is at most 12 MiB.
- Generate SHA-256 checksums and verify them before upload.
- Upload only tagged releases; pull requests build/test without publishing.
- Keep UPX out of the first release: it complicates startup, signing, antivirus behavior, and reproducibility for limited practical value at this size.

macOS code signing/notarization is deferred until distribution evidence shows Gatekeeper blocks the downloaded binary in the supported uTools flow. The UI must surface an actionable launch error rather than suggesting unsafe global security changes.

## 15. Compatibility, Migration, and Rollback

- Add service preferences as a new device-local schema with default `enabled=false`; existing project records require no destructive migration.
- Existing browser/preload fallback adapter remains valid.
- Rollout order: release compatible Go binary first, then release plugin UI that can download it.
- The plugin declares a supported protocol range and a recommended service version.
- Plugin rollback remains safe while the installed service protocol stays in range. Otherwise service mode is blocked, with existing non-service features available.
- Service updates use side-by-side versioned binaries and switch only after health validation.
- Removing the binary is available only while disabled and stopped.

## 16. Key Risks and Mitigations

| Risk                                    | Mitigation                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| Duplicate launches during timeout/retry | Idempotency keys and persisted execution claims                                  |
| Dual schedulers                         | Explicit ownership handoff and paused frontend scheduler                         |
| PID reuse                               | Stable run IDs plus OS process start identity validation                         |
| Local unauthorized control              | Loopback-only bind, random token, strict file permissions, request limits        |
| Partial/corrupt download                | Partial file, SHA-256 verification, atomic rename                                |
| Service update incompatibility          | Versioned protocol range and side-by-side rollback                               |
| Disk growth                             | Per-run and global caps with completed-run eviction                              |
| Binary growth                           | Standard library only and 12 MiB CI gate                                         |
| Unexpected behavior change              | Default off; one shared ownership boundary; existing fallback untouched when off |
