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

### Scenario: External terminal launch failures

#### 1. Scope / Trigger

- Trigger: the preload bridge launches an external terminal for the current project path.

#### 2. Signatures

- `ProjectBridge.openTerminal(payload: { projectPath: string; terminal: TerminalPreferences }) -> Promise<{ launched: boolean; command: string; cwd: string; kind: DefaultTerminalKind; message?: string }>`

#### 3. Contracts

- `projectPath` must exist and point to a readable directory before the bridge tries to launch.
- `terminal.kind` selects `builtin`, `windows-terminal`, `powershell`, `cmd`, or `custom` behavior.
- `terminal.customCommand` is required only for `custom` mode.
- `launched: true` means the detached terminal process spawned successfully.
- `launched: false` means the store should treat the result as a user-visible failure and log `message` when present.

#### 4. Validation & Error Matrix

- Missing or missing-directory path -> return `launched: false` with a path error message.
- `builtin` kind -> return `launched: false` and skip external spawn.
- Empty custom command -> return `launched: false` with an input error message.
- Unknown terminal kind or spawn failure -> return `launched: false` with a launch error message.

#### 5. Good/Base/Bad Cases

- Good: the bridge spawns the configured terminal and the store logs the command used.
- Base: `builtin` remains a valid preference but does not start an external terminal yet.
- Bad: calling `shell.openPath` and treating the folder reveal as a terminal launch.

#### 6. Tests Required

- Type-check the bridge contract in `src/types.ts` and `src/lib/projectBridge.ts`.
- Manual smoke test on uTools with each terminal kind and a custom command using `{path}`.
- Verify a missing path produces an error log instead of a silent no-op.

#### 7. Wrong vs Correct

##### Wrong

```ts
await bridge.openPath(project.path);
```

##### Correct

```ts
const result = await bridge.openTerminal({
  projectPath: project.path,
  terminal: this.terminalPreferences,
});
```

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
