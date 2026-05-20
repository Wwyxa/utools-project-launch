# 修复插件退出时 Node 项目未停止

## Goal

修复 uTools 插件退出时正在运行的 Node 项目没有被停止的问题。前一轮修复只覆盖了 Python 后端相关判断，结果实际上 Node 项目仍然可能在插件结束后继续运行，说明退出清理链路需要重新审查并补全。

## What I already know

- `public/preload.js` 维护 `activeProcesses`、`launchedProcessIds` 和 `userStoppedProcesses`，并提供 `stopProcess()` / `stopAllProcesses()`。
- 当前退出清理挂在 `window.utools?.onPluginOut?.(...)`、`process.once("exit")`、`process.once("SIGINT")` 和 `process.once("SIGTERM")` 上。
- `src/App.vue` 在按 Escape 且当前处于项目页时会调用 `window.utools?.outPlugin?.()`。
- `src/App.vue` 里已经区分了 `onPluginOut(isKill)`，但现在只在 `isKill === true` 时调用前端 store 清理和 `window.projectBridge?.stopAllProcesses?.()`。
- `src/store/useStore.ts` 会通过 `bridge.runCommand(...)` 启动脚本，并通过 `bridge.stopProcess(...)` / `bridge.stopAllProcesses(...)` 结束脚本。
- 这次问题不是单纯的 Python 分支判断，而是退出时真正该停止的 Node 项目进程没有被覆盖到。

## Assumptions (temporary)

- 需要继续保留“普通关闭插件面板不自动杀进程”的边界。
- 真正的插件终止或 host kill 仍然应该尽力清理已启动的项目进程。
- Node 项目和 Python 项目在退出清理上应遵守同一套生命周期契约，不应只关注某一种项目类型。

## Open Questions

- None blocking; the current code already shows the bridge and lifecycle hooks that need to be reconciled.

## Requirements (evolving)

- Re-check the exit lifecycle so Node project processes are covered by the same cleanup path as other tracked scripts.
- Keep explicit stop actions intact and avoid reintroducing ordinary page-close kills.
- If the store keeps an in-memory record of running scripts, ensure the exit path updates state consistently for all project kinds.
- If the actual issue is a missed hook or an overly narrow condition, fix it at the root cause rather than adding another one-off branch.

## Acceptance Criteria (evolving)

- [ ] Running Node project scripts are stopped when the plugin really exits.
- [ ] Ordinary page close / non-kill plugin-out still does not force-stop running projects.
- [ ] Explicit stop actions still terminate tracked processes.
- [ ] The fix applies consistently across Node and Python project flows instead of only one project type.

## Definition of Done (team quality bar)

- Tests or verification steps added where practical.
- Lint / typecheck / build green.
- Docs/notes updated if behavior changes.

## Out of Scope (explicit)

- Rewriting the process manager or adding new runtime supervision primitives.
- Changing unrelated project launch, file browser, memo, or Git behavior.

## Technical Notes

- Likely touch points: `src/App.vue`, `src/store/useStore.ts`, `src/lib/projectBridge.ts`, `public/preload.js`.
- Existing lifecycle contract lives in `.trellis/spec/backend/error-handling.md`.
- Current state management and bridge boundaries live in `.trellis/spec/frontend/state-management.md` and `.trellis/spec/frontend/quality-guidelines.md`.
- Prior task archive to review: `.trellis/tasks/archive/2026-05/05-20-fix-page-close-process-stop/prd.md`.
