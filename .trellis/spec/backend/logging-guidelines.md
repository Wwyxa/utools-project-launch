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
