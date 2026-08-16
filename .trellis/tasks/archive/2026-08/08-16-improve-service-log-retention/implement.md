# 实施计划：项目启动服务日志体验与持久化

## Phase 0: Planning Gate

1. Review `prd.md`, `design.md`, and this checklist with the user.
2. Confirm the protocol v2 migration behavior for installed older service binaries.
3. Start the Trellis task only after explicit approval of the final planning summary.
4. Load frontend/backend Trellis specs through `trellis-before-dev` before touching product code.

## Phase 1: Backend contracts and state migration

1. Add the validated retention policy and compatible defaults to service state.
2. Separate in-memory live events from persisted output events so `persist=false` leaves no new output on disk.
3. Add log descriptors and usage data needed by the history list and settings UI.
4. Add API contracts for policy read/update and clear-all, including typed errors and operation results.
5. Bump the service protocol to v2 and show an actionable update state for older installed binaries.

Checkpoint: state migration, policy validation, API request/response types, and old JSONL reads pass focused Go tests.

## Phase 2: Buffered persistence and retention enforcement

1. Introduce one buffered writer per active run with explicit flush/close lifecycle.
2. Remove per-output-line full `state.json` rewrite and directory-wide quota scan.
3. Maintain incremental file-size accounting and perform cleanup at bounded maintenance points.
4. Replace per-line tail rewrite with high/low-water truncation or segment rotation if benchmark evidence requires it.
5. Implement clear-all coordination for completed and active runs.
6. Preserve error visibility and ensure a failed durable write cannot silently report complete history.

Checkpoint: Go tests cover persistence off/on, restart recovery, cleanup order, clear-all, truncation, active writers, and partial writes.

## Phase 3: Preload, bridge, store, and UI

1. Extend shared types and project bridge methods for policy, usage, log descriptors, paged reads, and clear results.
2. Add normalized user preferences and explicit save behavior while keeping existing installations enabled by default.
3. Repair OverlayScrollbars content wrapping in live and historical terminal views.
4. Update history rows, status states, search, copy, truncation messaging, and latest-batch loading.
5. Add SettingsTab controls for persistence, per-project count, per-run size, total size, usage, reset, and clear confirmation.
6. Refresh list and usage after policy changes or clear operations without disturbing live terminal content.

Checkpoint: bridge/store tests pass; manual desktop and narrow-window checks show vertical log rows and correct toggle/clear behavior.

## Phase 4: Verification and hardening

1. Add a focused persistence benchmark comparing high-output append behavior before and after batching.
2. Run `go -C service test ./...`.
3. Run `go -C service vet ./...`.
4. Run `npm run lint`.
5. Run `npm run build`.
6. Run `node --check public/preload.js` and targeted bridge/store tests.
7. Validate protocol mismatch, old state migration, disabled persistence, partial cleanup, and service restart behavior.
8. Capture a history dialog regression check at 800x600 and a narrow viewport.

## Review Gates

- Do not expose configurable retention until the service-side policy is the source of truth and cleanup is idempotent.
- Do not claim persistence-off privacy until output is absent from both log files and persisted state events.
- Do not remove the old full-log API until paged/tail reads and the current history flow are both covered.
- Do not weaken lifecycle durability merely to optimize stdout throughput.

## Risky Files and Rollback Points

- `service/internal/state/runtime.go`: state migration, writer lifecycle, retention and clear semantics.
- `service/internal/process/supervisor.go`: output backpressure and error propagation.
- `service/internal/api/server.go`: protocol compatibility and destructive operation authorization.
- `public/preload/project-launch-service.js`: service capability checks and response limits.
- `src/components/terminal/Terminal.vue`: OverlayScrollbars layout and historical rendering.
- `src/components/layout/SettingsTab.vue`: persistence and retention controls.
- Roll back in slices: first disable batched output persistence, then disable new settings UI, while retaining readable legacy JSONL files and the existing service launch path.
