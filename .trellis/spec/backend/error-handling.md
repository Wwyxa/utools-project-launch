# Error Handling

> How errors are handled in this project.

---

## Overview

There is no centralized backend error layer today. The current app represents failures in UI state and terminal output instead of throwing API errors.

Current error surfaces include:

- `ProjectStatus.ERROR` for a project-level failure state
- `ProjectScript.status === 'ERROR'` for script-level status
- `LogEntry.type === 'ERROR'` for terminal output and activity logs

Use those existing status fields when the UI needs to show a failure. Do not invent server-style HTTP error handling unless a backend is actually added.

---

## Error Types

There are no custom backend error classes yet.

The current type system uses status enums and discriminated log types instead:

```ts
export enum ProjectStatus {
  RUNNING = "RUNNING",
  STOPPED = "STOPPED",
  WARNING = "WARNING",
  ERROR = "ERROR",
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: "INFO" | "WARN" | "ERROR" | "SUCCESS";
}
```

---

## Error Handling Patterns

For the current frontend-only setup:

- update state directly when an action succeeds
- surface failures by switching status fields or appending an error log entry
- keep user-facing failure text in the UI, not hidden in console output

If an async backend or process-control API is added later, wrap it in a narrow adapter that returns a typed success/failure result to the store or component layer.

For the uTools preload boundary, failures must be surfaced through the existing UI state model:

- process stderr -> append a `LogEntry` with `type: "ERROR"`
- process close with non-zero code -> set script status to `ERROR` and project status to `ProjectStatus.ERROR`
- Git unavailable / not a repository -> return an empty `ProjectGitSnapshot` with a user-facing `statusText`
- package script parsing failure -> return an empty script list and preserve manually configured commands

---

## API Error Responses

There is no API response contract yet.

If a backend is introduced later, document the exact error payload shape here before components start depending on it.

---

## Common Mistakes

- Swallowing a failure and leaving the project in a stale `RUNNING` state
- Logging a generic error without updating the related status field
- Reusing success styling for error output
- Adding API-style error handling before there is an API
- Throwing raw preload errors into Vue components instead of converting them into typed store state
