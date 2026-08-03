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

### Convention: Host command environment parity

- Project command execution and environment-tool checks must use the same
  platform command interpreter.
- On macOS, invoke the user's login/interactive shell so GUI-launched uTools
  receives shell-managed PATH entries; on Windows, invoke `ComSpec` with
  explicit cmd arguments.
- Apply project environment values after the inherited host environment. Never
  print the full environment to user-visible terminal logs, because it can
  contain secrets.
- Makefile discovery is static: parse target names only and never run `make`
  while inspecting a project.
- A malformed `package.json` or unreadable Makefile must return a discovery
  message naming the failed file; never collapse a parse failure into an
  indistinguishable empty command list.
- On Unix-like hosts, launch user commands as detached process groups. Stop
  the group with `SIGTERM`, then escalate to `SIGKILL` after a bounded grace
  period when it is still active. This prevents nested command runners from
  leaving scripts stuck in `STOPPING`.
- uTools validates preload entries as `.js` and loads them through CommonJS.
  In this ESM package, keep `plugin.json` pointed at `preload.js`, and copy a
  `package.json` with `"type": "commonjs"` into `dist/` so that Node classifies
  this one file correctly before the bridge is exposed.

### Scenario: Git Diff Read Options

#### 1. Scope / Trigger

- Trigger: the Git review UI requests a working-tree, commit, or stash file
  diff with full context or whitespace filtering enabled.

#### 2. Signatures

```ts
ProjectBridge.readGitFileDiff(
  projectPath: string,
  relativePath: string,
  options?: ProjectGitFileDiffOptions,
): Promise<ProjectGitFileDiffResult>;

ProjectBridge.readGitCommitFileDiff(
  projectPath: string,
  commitHash: string,
  relativePath: string,
  stash?: ProjectGitStash,
  options?: ProjectGitFileDiffOptions,
): Promise<ProjectGitFileDiffResult>;
```

#### 3. Contracts

- `scope` accepts only `combined`, `staged`, or `unstaged`; preload normalizes
  any other value to `combined`.
- `fullFile: true` appends `--unified=999999999` to every tracked Git diff
  command so unchanged text between hunks is included.
- `ignoreWhitespace: true` appends both `--ignore-space-change` and
  `--ignore-blank-lines`.
- Options are passed before `--` for working-tree `diff`, commit `show`, and
  both tracked and untracked stash diff paths. Omitted or non-boolean options
  preserve the prior command arguments.

#### 4. Validation & Error Matrix

- Unknown `scope` -> read the combined working-tree diff.
- `fullFile` or `ignoreWhitespace` not exactly `true` -> do not add the
  corresponding command flags.
- Empty path -> return the existing empty result and selection message.
- Path outside the repository -> preserve `resolveProjectChild` rejection.
- Missing repository or failed Git command -> return the existing empty diff
  result and user-facing message; do not throw raw process errors into Vue.

#### 5. Good/Base/Bad Cases

- Good: all three readers receive the same normalized flags, so a review
  option behaves identically for a working tree, commit, and stash.
- Base: callers omit options and receive the original scoped or commit diff.
- Bad: adding flags only to the working-tree reader makes commit and stash
  reviews silently disagree with the selected UI state.

#### 6. Tests Required

- `scripts/validate-git-diff.mjs` must assert default versus full-context
  output for working-tree, commit, and stash files.
- The same script must assert that whitespace-only changes disappear with the
  filter while a non-whitespace change in the same file remains.
- Run `node --check public/preload.js` and TypeScript checks for the shared
  bridge signatures.

#### 7. Wrong vs Correct

##### Wrong

```js
runGitDiff(repositoryPath, ["show", "--format=", hash, "--", relativePath]);
```

##### Correct

```js
const diffOptions = gitDiffOptionArgs(normalizeGitDiffOptions(options));
runGitDiff(repositoryPath, ["show", "--format=", ...diffOptions, hash, "--", relativePath]);
```

### Scenario: External terminal launch failures

### Scenario: External application launch and process cleanup failures

#### 1. Scope / Trigger

- Trigger: the preload bridge launches selected external applications and owns cleanup for app-started script processes.

#### 2. Signatures

- `ProjectBridge.openExternalApplication(payload: ProjectBridgeExternalApplicationLaunchPayload) -> Promise<ProjectBridgeExternalApplicationLaunchResult>`
- `ProjectBridge.stopAllProcesses() -> Promise<void>`

#### 3. Contracts

- External application launches return the selected application id/kind with the same typed success/failure shape as terminal launches.
- `launched: false` means the store should log an error message; the component should not throw.
- `stopAllProcesses` is best-effort cleanup for processes started by this plugin session. It must not promise to handle hard OS or host crashes that do not run JavaScript lifecycle hooks.
- Cleanup should be attached only to true runtime shutdown signals or explicit user stop actions. uTools page leave hooks such as ordinary plugin-out/detach can fire during normal panel close/open cycles and must not stop long-running project scripts by default unless the host marks the event as a full kill, such as `onPluginOut(true)`.
- In this app, the confirmed kill path is `window.utools.onPluginOut(isKill => { if (isKill) window.projectBridge.stopAllProcesses(); })`; do not add extra process-exit or unload-based stop hooks unless uTools behavior is revalidated.

#### 4. Validation & Error Matrix

- Missing or non-directory target path -> return `launched: false` with a path message.
- Missing/disabled applications, unknown kinds, reserved id mismatches, and empty custom commands -> return `launched: false` before spawning.
- Custom commands use detached executable/argument spawning without `shell: true`.
- Process already exited during cleanup -> ignore and continue stopping the remaining processes.

#### 5. Good/Base/Bad Cases

- Good: external application spawn failures become project log entries and do not break the project or Git view.
- Good: explicit stop actions and true runtime shutdown signals attempt to stop every tracked child process before teardown.
- Base: no active child processes makes `stopAllProcesses` a no-op.
- Bad: binding cleanup to ordinary page leave hooks and killing project scripts when the user only closes the plugin panel.

#### 6. Tests Required

- Type-check the bridge contract in `src/types.ts`, fallback bridge, and store actions.
- Manual smoke test: start a script, close the plugin view, and confirm the tracked process keeps running until an explicit stop or true host shutdown.
- Manual smoke test: invalid custom application command returns a visible project log error.

#### 7. Lifecycle Boundary Note

- Do not treat normal webview/page unload as a guarantee of full plugin shutdown.
- Cleanup hooks that stop tracked project processes should be reserved for real host/plugin exit signals, `onPluginOut(true)`, or explicit user stop actions.
- If a page-level hook is used, confirm it does not fire during simple panel close/open cycles that should preserve running projects.

#### 8. Wrong vs Correct

##### Wrong

```js
window.utools?.onPluginOut?.(stopAllProcesses);
```

This fires during normal plugin panel leave cycles and can kill long-running scripts unexpectedly.

##### Correct

```js
window.utools?.onPluginOut?.((isKill) => {
  if (isKill === true) {
    stopAllProcesses();
  }
});
```

Keep ordinary page/plugin leave separate from process shutdown and explicit stop actions.

---

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
