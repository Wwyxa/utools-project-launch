# Logging Guidelines

> How logging is done in this project.

---

## Overview

There is no backend logging library configured today. The current app models activity as terminal or project logs in the Pinia store and renders them in `src/components/terminal/Terminal.vue`.

The project currently uses a small, explicit log shape instead of a general-purpose logger:

```ts
export interface LogEntry {
  timestamp: string;
  message: string;
  type: "INFO" | "WARN" | "ERROR" | "SUCCESS";
}
```

Use this structure for user-visible activity. If server-side logging is added later, keep it separate from the UI log stream.

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
