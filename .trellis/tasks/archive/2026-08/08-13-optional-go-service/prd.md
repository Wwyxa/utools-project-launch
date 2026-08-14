# Project Launch Service

## Goal

Add an optional, independently running Go service that owns long-lived project processes and scheduled automation so those workloads remain observable and controllable across uTools plugin close/reopen and uTools process restarts. The existing plugin must remain fully usable without the service.

## User Value

- Keep service-owned project workloads running when the plugin or uTools exits.
- Reconnect to those services after reopening uTools instead of losing their runtime state and logs.
- Run all scheduled automation independently of the renderer lifecycle while service mode is enabled.
- Preserve the current lightweight, no-service workflow for users who do not enable the feature.

## Confirmed Facts

- `public/preload.js:48` stores active child-process handles in an in-memory `Map`.
- `public/preload.js:6569` launches commands from the uTools preload process and reports lifecycle events to the renderer.
- `public/preload.js:6893` can only stop processes that the current preload instance still knows about.
- `src/store/useStore.ts:3951` schedules automation with a renderer-owned `setTimeout`.
- `README.md:190` documents that scheduled tasks currently depend on the plugin being active.
- The repository has no backend runtime, backend persistence layer, or GitHub Actions release workflow today.
- Go is the selected implementation language because it supports small, platform-native, self-contained executables without requiring a Go installation on user machines.

## Requirements

### R1. Optional Integration

- The service is opt-in, disabled by default, and not downloaded or started without an explicit user action.
- When disabled, absent, incompatible, or unavailable, existing project management, script execution, Git, file, AI, and preference behavior continues through the current preload bridge.
- A service failure must not prevent the plugin from opening or disable unrelated features.
- When globally disabled, all script launches and automation keep their current preload-owned behavior.
- When globally enabled, all new script launches and all automation are owned by the service; there are no per-project, per-script, or per-task delegation switches.
- While globally enabled, a missing, incompatible, or unreachable service blocks new script launches and automation with an actionable message instead of silently falling back to preload execution.

### R2. Installation and User Guidance

- Settings expose a download action; merely opening settings or updating the plugin must not trigger a service download.
- The download action detects the current operating system and CPU architecture, selects the matching GitHub Release asset, verifies its checksum, and places the executable in the documented service directory.
- Settings also expose the GitHub Release page, the expected local executable path, a manual verification/recheck action, and an action to open the containing directory.
- Users can manually download and place the matching executable when automatic download is unavailable due to network, proxy, GitHub availability, or permission issues.
- Guidance explains the current platform/architecture, expected asset, destination, verification result, enable/start action, update state, and recovery steps without requiring command-line knowledge.
- Download, verification, permission, and compatibility errors remain actionable and do not implicitly enable or start the service.
- The service reuses the existing `~/.utools-project-launch` application directory that already contains `device-id.v1`; it must not introduce a second unrelated per-user root.
- Except for the existing `device-id.v1`, every file created or managed by the service is contained under one `~/.utools-project-launch/service/` directory; the application root must not accumulate service files.
- The installed executable remains one self-contained file. Runtime state and bounded logs are separate user-data files under that service directory, not executable dependencies, and their purpose and cleanup behavior are documented.

### R3. Runtime Ownership

- Service-managed processes remain alive when the plugin UI closes or uTools exits normally.
- Reopening the plugin reconstructs service-managed runtime state from the service rather than stale renderer state.
- Users can query, stop, and restart a service-managed process after reconnecting.
- Process identity must remain safe across reconnects and must not rely on an unverified persisted PID alone.
- The service terminates the complete process tree when the user explicitly stops a managed process.

### R4. Scheduling Ownership

- When the service is globally enabled, automation can run while the plugin and uTools are not active.
- Enabling the service transfers scheduler ownership for all automation to the service so frontend and service scheduling cannot execute the same plan entry twice.
- Existing missed-run policy, serial execution, timeout, input, output-match, and exit-match semantics remain compatible for service-mode tasks.
- Automation definitions and execution state reconcile when the plugin reconnects.

### R5. Logs and Runtime History

- The service retains enough bounded output and lifecycle history for the plugin to restore a useful terminal view after reconnecting.
- Log storage is bounded and supports retention or rotation so long-running commands cannot consume unbounded disk space.
- Sensitive environment values and secrets are not written to service logs.

### R6. Cross-Platform Deliverables

- GitHub Actions builds and attaches release artifacts for Windows, Linux, and macOS on both `amd64` and `arm64`.
- Each OS/architecture artifact contains a single service executable: PE `.exe` on Windows, ELF on Linux, and Mach-O on macOS.
- Release artifacts include integrity metadata that the plugin or user can verify before installation.
- Release asset naming is deterministic so the plugin can map the detected platform and architecture without downloading unrelated binaries.
- Build settings favor a small binary: standard library first, no CGO unless a measured requirement justifies it, stripped symbols/debug paths, and no embedded assets that are not needed at runtime.
- Binary size is measured and reported by CI; each raw executable must remain at or below 12 MiB.

### R7. Naming and Scope

- The product and user-facing service name is `Project Launch Service` (`项目启动服务`).
- The executable stem is `project-launch-service`; the product name does not expose the implementation language or imply AI-agent behavior.
- The first release remains narrow even if its name permits later capabilities.

### R8. Compatibility and Rollback

- Existing stored project data remains readable without a destructive migration.
- Disabling or removing the service restores current preload-owned behavior for new launches.
- Existing service-managed processes require an explicit, visible user decision before removal or ownership transfer; rollback must not orphan or silently terminate them.
- Protocol/version incompatibility produces a clear degraded-state message. Unrelated features remain available, but script and automation execution do not fall back while service mode is enabled.

## Acceptance Criteria

- [ ] AC1: With the service disabled or not installed, existing focused validation suites, type-check, and plugin build pass without requiring Go or a service process.
- [ ] AC2: A service-managed long-running command remains active after closing the plugin and fully exiting uTools, then appears with accurate status after reopening.
- [ ] AC3: The reconnected UI can receive retained output and stop the complete managed process tree.
- [ ] AC4: A scheduled task executes while uTools is closed and appears once, not twice, in reconciled execution history while service mode is enabled.
- [ ] AC5: If the service cannot start or becomes unavailable, the plugin opens normally, reports the scoped degradation, and unrelated existing features continue to work.
- [ ] AC6: Disabling service mode causes subsequent launches and schedules to use current preload-owned behavior without deleting existing project configuration.
- [ ] AC7: A tagged GitHub release produces checksummed single-executable artifacts for Windows, Linux, and macOS on `amd64` and `arm64`.
- [ ] AC8: CI reports executable sizes and fails when any raw artifact exceeds 12 MiB.
- [ ] AC9: Process lifecycle, reconnect, duplicate-scheduling prevention, protocol compatibility, and bounded-log behavior have automated focused tests.
- [ ] AC10: No service binary is downloaded or started until the user invokes the corresponding action and explicitly enables the service.
- [ ] AC11: The settings UI detects the current platform/architecture, downloads and verifies the matching release asset on request, and exposes the installation directory.
- [ ] AC12: After a simulated download failure, the UI provides a release link, exact asset/path guidance, manual recheck, and can recognize a correctly placed compatible executable.
- [ ] AC13: With the service enabled but unavailable, new launches and automation are blocked with an actionable error; they are never silently executed by preload.
- [ ] AC14: One global setting determines runtime ownership, with no per-project, per-script, or per-task delegation state.
- [ ] AC15: Installation reuses `~/.utools-project-launch`, keeps `device-id.v1` compatible, and exposes the exact executable/data paths plus an open-directory action.

## Out of Scope for the First Release

- Moving existing Git operations to Go solely for presumed performance gains.
- Replacing the current preload bridge, project storage, file operations, AI integrations, or environment detection.
- Remote access, multi-device synchronization, user accounts, or a cloud backend.
- A general plugin system or speculative extension API inside the service.
- Reimplementing Git with a pure-Go Git library.
- Requiring administrator/root privileges or mandatory OS-wide service installation.
- Silently downloading or updating the service during plugin startup or plugin upgrade.

## Deferred Items

- Git read caching or background indexing may be evaluated later using the existing Git interaction benchmark; language migration alone is not considered an optimization.
