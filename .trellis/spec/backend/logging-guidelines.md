# Logging Guidelines

> How logging is done in this project.

---

## Overview

There is no general-purpose backend logging library configured. The current app models live activity as terminal or project logs in the Pinia store and renders them in `src/components/terminal/Terminal.vue`. The optional Project Launch Service also persists bounded run events for service-owned commands, but that store remains separate from the live UI log stream.

The project currently uses a small, explicit log shape instead of a general-purpose logger:

```ts
export interface LogEntry {
  timestamp: string;
  message: string;
  type: "INFO" | "WARN" | "ERROR" | "SUCCESS";
}
```

Use this structure for user-visible activity. Service-owned history is converted into this shape only when a user opens a retained run; reading history must not append it to the live UI log stream.

---

## Log Levels

Current levels and their meaning:

- `INFO` for normal command output and state updates
- `SUCCESS` for completed actions such as a successful script run or refresh
- `WARN` for recoverable problems or partial results
- `ERROR` for failed commands, failed process control, or invalid project state

The terminal view colors those levels directly in the UI rather than routing them through a server log sink.

---

## Structured Logging

Use the `LogEntry` shape with a timestamp, message, and type. The terminal panel in `src/components/terminal/Terminal.vue` renders each row from that structure.

Example:

```ts
store.addLog(projectId, {
  timestamp: "10:42:02",
  message: "VITE v4.4.9 ready in 320 ms",
  type: "SUCCESS",
});
```

---

## What to Log

- script start/stop output
- project status changes
- Git-related activity that should be visible to the user
- terminal messages and warnings that help explain what happened
- recoverable validation or runtime issues that affect a project surface
- uTools preload process events emitted through `project-bridge-event`

---

## What NOT to Log

- API keys, tokens, and secrets
- full environment values that are meant to stay masked
- personal data that does not help with project control
- implementation details that are only useful in a console, not the UI

The current store already masks secrets such as `API_KEY` in the seeded `env` object in `src/store/useStore.ts`.

## Preload Event Logs

The uTools preload bridge emits process lifecycle events to the UI with this event name:

```ts
window.dispatchEvent(new CustomEvent("project-bridge-event", { detail }));
```

`detail.type` is one of `started`, `stdout`, `stderr`, `exit`, or `error`. The store converts these events into user-visible `LogEntry` rows and status updates. Do not log environment payloads or full command secrets from preload events.

## Scenario: Script-Level Runtime Logs

### 1. Scope / Trigger

- Trigger: command execution events cross the preload/UI boundary and must remain attributable to a specific project script.

### 2. Signatures

- Event name: `project-bridge-event`
- Event detail fields: `type`, `projectId`, `scriptId`, `pid`, optional `message`, `code`, `signal`, and `stoppedByUser`.

### 3. Contracts

- The preload bridge must emit `scriptId` for every process lifecycle event.
- The Pinia store must preserve both a project-level aggregate log and a script-level log index keyed by `projectId` and `scriptId`.
- The terminal UI should show script-level tabs only for scripts that have produced output in the current session. Do not show an aggregate "all" tab in the details runtime log.
- Strip ANSI/control escape sequences at the store boundary before creating user-visible `LogEntry` rows.
- On Windows, process output may arrive as GBK/GB18030. The preload bridge should fall back to GB18030 when UTF-8 decoding produces replacement characters.

### 4. Validation & Error Matrix

- Missing project or script -> ignore the status update, but do not throw from the event handler.
- `stderr` or `error` event -> append an `ERROR` log entry for the owning script and aggregate stream.
- `exit` with non-zero code -> mark the script `ERROR`; `exit` after user stop -> mark it `STOPPED`; zero exit -> mark it `STOPPED` with a success log.

### 5. Good/Base/Bad Cases

- Good: frontend and backend commands run together; each visible script tab shows only its own cleaned output.
- Base: one command runs; one script tab appears and shows its lifecycle in order.
- Bad: all output is stored only under `logs[projectId]`, making simultaneous command output indistinguishable.

### 6. Tests Required

- Type check the `ProjectBridgeEvent` handling path.
- Build the frontend after changing log state shape or terminal props.
- Manually verify two simultaneous scripts can be distinguished in the details terminal.

### 7. Wrong vs Correct

#### Wrong

```ts
store.addLog(event.projectId, { message: event.message || "", type: "INFO", timestamp });
```

#### Correct

```ts
store.addLog(event.projectId, log, event.scriptId);
```

## Scenario: Service-Owned Persisted Run Logs

### 1. Scope / Trigger

- Trigger: a service-owned script continues after the uTools renderer closes and its output must remain available after the plugin or service restarts.
- Trigger: persisted output needs bounded disk usage and a controlled historical reader.

### 2. Signatures

- File format: `service/logs/<runId>.log`, one JSON-encoded `ProjectLaunchServiceEvent` per line.
- Store methods: `state.Store.AppendEvent(...)` and `state.Store.ReadRunLog(runID)`.
- HTTP endpoint: `GET /v1/runs/{runId}/log`.
- Response: `{ runId, events, truncated, sizeBytes }`.

### 3. Contracts

- Each run gets one append-only log file keyed only by the validated 32-character lowercase hexadecimal `runId`.
- Keep at most 5 MiB per run, 100 MiB across logs, and 200 log files. Use one buffered JSONL writer per active run, flushing at about 64 KiB or 200 ms; enforce limits at startup, bounded flush thresholds, run completion, policy changes, service close, and explicit clear boundaries.
- Delete the oldest completed-run logs before trimming active logs. Active files may temporarily exceed the file-count limit, but total-size trimming may keep only their newest complete JSONL records.
- If an abrupt stop leaves an incomplete final JSONL record, return earlier complete events with `truncated: true`; a malformed interior record remains an error.
- The service must not persist tokens, full environment maps, or credentials in events. The run command belongs to run metadata; the generic service `started` event message is a status message, not a command label.
- History responses use the relaxed 8 MiB preload response limit. The terminal lists only retained terminal runs for the current project and never merges historical rows into live `scriptLogs`.

### 4. Validation & Error Matrix

- Invalid or unknown `runId` -> `404 run_log_unavailable`; never join it to a filesystem path.
- Missing or evicted log file -> `404 run_log_unavailable`; keep live logs unchanged.
- Per-run or total limit exceeded -> oldest eligible output is evicted and the run is marked truncated when active output is trimmed.
- Final partial JSONL record -> return complete prior events and mark the response truncated.
- Interior malformed JSONL record or event for another run -> fail the read rather than returning ambiguous history.

### 5. Good/Base/Bad Cases

- Good: reopening a project shows a completed service run in Log history and reads its retained output without duplicating live terminal rows.
- Good: a large active log is trimmed to complete newest records and remains readable.
- Base: a run below all limits is returned with its complete event sequence and `truncated: false`.
- Bad: truncate JSONL at an arbitrary byte and make the history endpoint fail on the next read.
- Bad: let a history dialog read arbitrary relative paths or mix selected historical output into the current script tab.

### 6. Tests Required

- State tests cover per-run truncation, total-size trimming, completed-file eviction, unreadable-file handling, and incomplete trailing records.
- Service tests cover retained log API reads and `run_log_unavailable` for removed logs.
- Bridge/store tests cover the bounded log response path and conversion into isolated history entries.
- `go -C service test ./...`, `go -C service vet ./...`, `node --check public/preload.js`, `npm run lint`, and `npm run build` pass after changes.

### 7. Wrong vs Correct

#### Wrong

```go
tail = tail[logSize-limit:]
```

This can leave a partial JSON object at either edge of the retained file.

#### Correct

```go
truncated, err := truncateFileTail(logPath, MaxRunLogBytes)
```

The implementation aligns both edges to newline boundaries and reports that output was truncated when complete history is no longer available.

## Scenario: Bounded In-Session Live Logs

### 1. Scope / Trigger

- Trigger: direct preload or service process output is appended to Pinia while a project produces sustained output.
- This is distinct from persisted service run history: it bounds renderer-session memory and terminal rendering without changing durable service retention.

### 2. Signatures

- `LIVE_PROJECT_LOG_ENTRY_LIMIT = 2_000` limits `logs[projectId]`.
- `addLog(projectId: string, log: LogEntry, scriptId?: string): void` updates the aggregate project stream and, when supplied, `scriptLogs[projectId][scriptId]`.
- `clearLogs(projectId: string): void` and `clearScriptLogs(projectId: string, scriptId: string): void` keep the same aggregate/script object-index contract.

### 3. Contracts

- `addLog` creates one fresh stored `LogEntry` object per call. The aggregate stream and the optional script stream retain that same stored object, but callers must not be able to alias one input object across projects or scripts.
- At most `2,000` newest aggregate entries remain per project. When the aggregate stream overflows, remove its oldest entries and remove each matching object from its owning script stream.
- Entries without `scriptId` belong only to the aggregate stream. Removing them must not alter a script stream.
- Do not trim or merge service-owned retained history into live `logs` or `scriptLogs`; the history reader stays a separate bounded-disk surface.

### 4. Validation & Error Matrix

- A script emits `2,001` live entries -> aggregate and that script stream retain `2,000` newest entries.
- One script emits `2,000` entries, then another emits one -> aggregate retains `2,000`; the first script retains `1,999` and the second retains `1`.
- The caller reuses one `LogEntry` input object for multiple `addLog` calls -> every stored row remains independently attributable and overflow removes the correct script row.
- An aggregate-only entry overflows -> it is removed only from `logs[projectId]`.
- A retained service log is opened -> live Pinia streams remain unchanged.

### 5. Good/Base/Bad Cases

- Good: a noisy development server remains readable because the terminal keeps its newest output while the service history can still expose completed-run output separately.
- Base: a short command produces fewer than `2,000` entries and no row is discarded.
- Bad: cap only `logs[projectId]` and leave stale objects in `scriptLogs`, or retain a caller-owned log object as the identity for more than one stream row.

### 6. Tests Required

- `npx vitest run tests/projectBridge.uiPreferences.test.ts` must assert the `2,000` entry cap, cross-script eviction alignment, and reused-input-object isolation.
- `npm run lint` and `npm run build` must pass after changing the Store log shape or retention helper.
- Manual terminal smoke: run a high-output script, switch script tabs, clear one script, and verify aggregate output neither leaks stale rows nor changes another script's output.

### 7. Wrong vs Correct

#### Wrong

```ts
this.logs[projectId].push(log);
this.scriptLogs[projectId][scriptId].push(log);
this.logs[projectId].splice(0, overflow);
```

This lets reused input identities corrupt the script mapping and leaves evicted rows in the script index.

#### Correct

```ts
this.logs[projectId].push({ ...log });
const storedLog = this.logs[projectId][this.logs[projectId].length - 1];
this.scriptLogs[projectId][scriptId].push(storedLog);
trimLiveProjectLogs(this.logs[projectId], this.scriptLogs[projectId]);
```

Store a unique entry, share it only between its two internal indexes, and trim both indexes together.
