# 修复插件关闭页面误停运行项目

## Goal

The plugin currently stops all tracked project processes when the webview page is closed, even if the plugin itself is not fully exited. The fix should narrow cleanup so ordinary page dismissal does not kill running projects, while still preserving cleanup for true plugin termination when that lifecycle is available.

## What I already know

- `public/preload.js` tracks spawned processes in `activeProcesses` and calls `stopAllProcesses()` from multiple lifecycle hooks.
- The current hooks include `beforeunload`, `unload`, `window.utools.onPluginOut`, `window.utools.onPluginDetach`, and process exit signals.
- `stopProcess()` uses `taskkill /t /f` on Windows, so any cleanup hook that fires will terminate the full child process tree.
- `src/App.vue` can call `window.utools?.outPlugin?.()` from the Escape key flow, so the UI already has a direct plugin-exit path.
- `utools.outPlugin(isKill?: boolean)` and `onPluginOut(isKill?: boolean)` provide the needed distinction: ordinary plugin-out should preserve projects, while `isKill === true` should stop tracked processes.

## Assumptions (temporary)

- Closing or re-rendering the plugin page should not automatically stop long-running project processes.
- There is still a valid need to stop tracked processes on real plugin exit or host shutdown.
- A user-facing stop action, if present, remains responsible for explicit process termination.

## Open Questions

- None blocking at the moment; the repo already shows the cleanup hooks and the UI exit path.

## Requirements (evolving)

- Page-level unload should not trigger `stopAllProcesses()` by default.
- Cleanup should remain available for real plugin exit paths where the host signals a full teardown, including `onPluginOut(true)`.
- The fix should be minimal and keep explicit stop behavior intact.

## Acceptance Criteria (evolving)

- [ ] Closing the plugin page no longer stops a running `npm run dev` child process.
- [ ] Explicit stop actions still terminate tracked processes.
- [ ] The code still performs cleanup for genuine plugin termination paths, including `onPluginOut(true)`.

## Definition of Done (team quality bar)

- Tests added/updated where practical.
- Lint / typecheck / build green.
- Docs/notes updated if behavior changes.

## Out of Scope (explicit)

- Reworking the whole process manager or adding a new process supervision model.
- Changing unrelated project launch, Git, or file browser logic.

## Technical Notes

- Affected file: `public/preload.js`
- Related UI path: `src/App.vue`
- Current spec guidance: ` .trellis/spec/frontend/state-management.md`, ` .trellis/spec/frontend/quality-guidelines.md`, ` .trellis/spec/backend/error-handling.md`
- The repo is frontend-only today; the preload bridge acts as the local process boundary.
