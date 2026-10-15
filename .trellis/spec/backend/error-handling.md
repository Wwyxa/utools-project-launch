# Error Handling

## Bridge Results

Components call Store actions. The preload boundary validates external inputs
and returns the shared typed result for the operation; the Store converts
failure into visible state or project logs. Do not hide failed reads behind
successful empty values or throw raw process errors into templates.

- Git reads use `ProjectGitReadResult<T>` when an empty repository is valid.
  Transient command/parse failures preserve the previous complete snapshot;
  authoritative `not-a-repository` clears stale repository data.
- Every command required by a snapshot must succeed. A valid unborn repository
  is empty history, but one expected no-HEAD error cannot hide another failure.
- Launch results distinguish `launched: false` from a spawned process. Validate
  paths and selected launchers before spawning; a failed selection does not
  silently try another application.
- Script discovery reports malformed package/Makefile input while keeping manual
  editing usable. Makefile discovery parses targets without executing `make`.
- Storage write/read-back failures remain failures. See
  [Storage Guidelines](./database-guidelines.md).

## Process Lifecycle

`public/preload/processes.js` owns direct process settlement and cleanup.
Emit exactly one terminal event, clear process bookkeeping on both close and
spawn error, and identify events by run and owner. One failed script must not
erase a running sibling's state.

A user stop is `STOPPED` even when tree termination returns a nonzero exit code.
Ordinary panel close/detach is not runtime termination. The current app uses
explicit stops and `onPluginOut(true)` for direct-process shutdown; preserve
long-running scripts across ordinary plugin-out events.

On Unix, stop the process group with bounded TERM-to-KILL escalation. Command
execution and environment checks must use the intended platform interpreter
and inherited PATH; apply project environment values afterward without logging
the full environment.

## Files and Git Writes

- File operations validate lexical and canonical paths under the project root.
  Reject direct symlink operations and root mutation; expected failures return
  typed results without optimistic disk changes.
- Git writes use executable/argv calls with `--` before pathspecs. Validate refs
  and commits in preload. Destructive retries require explicit confirmation and
  typed blockers such as `dirty-worktree` or `unmerged-branch`.
- Remote Git processes are asynchronous, time-limited, and noninteractive.
  Refresh after partial or failed mutations because Git may already have changed
  local refs or worktree state.

## Optional Service

An enabled but unavailable/incompatible service blocks delegated work while
unrelated plugin features remain usable. It must not fall back to a second
process/scheduler owner. See [Project Launch Service](./project-launch-service.md)
for protocol, encrypted-state, and recovery contracts.

## Verification

Use the matching existing check: `validate:git-commits`, `validate:git-workspace`,
`validate:git-diff`, `validate:project-files`, `validate:project-storage`, or
`validate:process-results`. Launcher failures are covered by
`tests/projectBridge.launchers.test.ts` and
`tests/projectBridge.externalApplications.test.ts`.
