# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

The repository includes one optional backend implementation: Project Launch Service under `service/`. It is a Go executable that is independently tested and released, while the main plugin remains a Vue/uTools application.

The frontend and service have separate validation surfaces. A successful Vite build does not validate Go process, persistence, protocol, or scheduler behavior; a successful Go test does not validate bridge types or the default-off plugin path.

---

## Forbidden Patterns

- Mixing backend concerns into Vue components
- Adding persistence or process control code without a dedicated boundary
- Logging secrets or masked values incorrectly
- Returning service payloads outside the typed ProjectBridge contract
- Starting, downloading, or silently falling back to the service without an explicit user action and a healthy compatible status
- Adding a second backend runtime or moving unrelated Git/file/AI work into Project Launch Service

---

## Required Patterns

- Keep UI state in the Pinia store or local component state
- Keep shared domain types in `src/types.ts`
- Keep semantic colors and spacing tokens in `src/index.css`
- Keep component composition clear and domain-driven
- Keep Project Launch Service isolated from the Vue presentation layer and expose it through preload plus `ProjectBridge`
- Keep service dependencies in the standard library unless a measured requirement and binary-size review justify an addition
- Preserve the disabled/no-install path without requiring a Go toolchain or service process

---

## Testing Requirements

Minimum plugin validation is:

- `npm test`
- `npm run lint`
- `npm run build`
- `node --check public/preload.js` when changing preload code

Minimum service validation is:

- `gofmt -l service`
- `go -C service vet ./...`
- `go -C service test ./...`
- one host build through `npm run go:build`
- CI cross-builds for Windows, Linux, and macOS on `amd64` and `arm64`, each at or below 12 MiB

Service changes that affect ownership, persistence, protocol, or scheduler behavior also require focused bridge/store validation and a check that disabled service mode retains the existing preload/renderer behavior. See [Project Launch Service](./project-launch-service.md) for exact contract-level assertions.

## Scenario: Windows Service Resource Benchmark

### 1. Scope / Trigger

- Trigger: a change claims to reduce Project Launch Service polling, scheduler, log, memory, or CPU overhead.
- The benchmark measures local process resources; it does not prove that moving work into Go lowers the total cost of the managed project process.

### 2. Signatures

- Command: `npm run benchmark:service-resources -- --label <scenario> --pid <pid> [--pid <pid> ...] [--duration <seconds>] [--interval <milliseconds>] [--service-log-dir <path>] [--counter <name=value>] [--output <path>]`.
- Report schema: `{ schemaVersion: 1, label, startedAt, completedAt, requestedDurationSeconds, actualDurationMilliseconds, sampleIntervalMilliseconds, counters, serviceLogUsage, aggregate, processes, samples }`.
- Each process summary includes `rssBytes`, `privateBytes`, and CPU `deltaSeconds` / `percentOfOneCore`; the aggregate sums the selected process samples.

### 3. Contracts

- The command is Windows-only because it obtains private memory through PowerShell `Get-Process`. `--label` and at least one positive `--pid` are required; duplicate PIDs are sampled once. Defaults are `60` seconds and a `1,000 ms` interval.
- Include every comparable process in the selected PID set: uTools, Project Launch Service when enabled, and each managed project process. Do not judge total consumption from the Go service PID alone.
- `--service-log-dir` recursively reports file count and bytes without modifying retention. `--counter` records manually observed values such as preload request count, Pinia event count, or terminal row count; it does not influence sampling.
- A missing sampled process remains an unavailable sample in the JSON report. An unreadable log directory yields `serviceLogUsage.available: false` while retaining the process report.

### 4. Validation & Error Matrix

- Missing `--label` or every `--pid` -> fail before sampling with a usage error.
- A PID exits during sampling -> report its missing samples; do not replace it with another process that later reuses the PID.
- Invalid `--counter` syntax or a non-positive PID/interval -> fail with an argument error.
- A non-Windows host -> fail before invoking a platform-specific sampler.
- A nonexistent `--service-log-dir` -> produce a report with unavailable log usage rather than discard measured process data.

### 5. Good/Base/Bad Cases

- Good: compare equal-duration service-off idle, service-on idle, uTools-closed service-running, and controlled high-output scenarios with the same process set and counters.
- Base: run `--duration 0` against a known live PID to validate the command and report shape without claiming a performance result.
- Bad: compare only the service's RSS before and after a change, or treat a reduction in plugin memory as proof that uTools plus service plus managed processes use less memory overall.

### 6. Tests Required

- `npm run benchmark:service-resources -- --help` must print usage without sampling.
- On Windows, run `npm run benchmark:service-resources -- --label cli-self-check --pid $PID --duration 0 --interval 1` and assert a schema-versioned JSON report with one available process sample.
- For a resource-affecting change, save reports for each comparison scenario and inspect aggregate RSS, private bytes, CPU delta, service log usage, request/event counters, and terminal row count.

### 7. Wrong vs Correct

#### Wrong

```powershell
npm run benchmark:service-resources -- --label after --pid <service-pid>
```

This hides renderer and managed-project resource shifts.

#### Correct

```powershell
npm run benchmark:service-resources -- --label service-on-idle --pid <utools-pid> --pid <service-pid> --pid <managed-project-pid> --duration 60
```

Measure the complete workload with a named, reproducible scenario before making a total-resource claim.

---

## Code Review Checklist

- Service code stays under `service/` and only delegated runtime ownership crosses the service boundary
- Status fields still reflect the real UI state
- Secrets remain masked
- Disabled, absent, incompatible, or unreachable service states keep unrelated plugin features usable
- Enabled but unhealthy service mode blocks new delegated launches rather than falling back to preload
- Service CI checks release asset names, checksums, and raw binary size before publishing
- New files follow the current directory and naming conventions
