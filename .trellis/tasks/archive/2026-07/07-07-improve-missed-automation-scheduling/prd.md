# Improve missed automation scheduling

## Goal

Improve scheduled automation behavior when the app starts after a planned execution time, so missed tasks are handled predictably instead of silently remaining pending or always being marked missed.

## Requirements

- Random automation schedules remain deterministic for a given task and date; opening the app later in the day must not reshuffle already planned random times.
- Each automation task supports a missed-run policy:
  - grace-run: run immediately if the planned time is within a short grace window; otherwise mark missed.
  - run-now: run overdue pending entries immediately after the app is available.
  - mark-missed: keep strict current behavior and mark overdue pending entries as missed.
- New and migrated tasks default to grace-run with a 5 minute grace window.
- Fixed and random schedules use the same missed-run policy.
- Existing history should still record whether a task completed, failed, skipped, or missed.
- The automation settings UI exposes the missed-run policy and grace window without changing unrelated schedule settings.
- The dashboard automation overview shows missed tasks separately and lets users run or view them quickly.
- The dashboard automation overview groups tasks by project and provides quick run/view actions for each task.
- The project automation task list provides a run-now action for each runnable task.
- The missed-task section is hidden when there are no missed tasks.
- Missed tasks can be ignored from the dashboard overview.
- Scheduled-run enabled/disabled state controls scheduled execution only; manual run-now remains available when scripts are runnable.
- Dashboard and project detail task lists show running state per task, not per project.
- Dashboard run-now controls remain clickable for sibling tasks while another task in the same project is running, and show feedback if project-level concurrency blocks execution.

## Acceptance Criteria

- [x] A 09:00 pending task opened at 09:03 runs immediately with the default policy.
- [x] A 09:00 pending task opened at 10:00 is marked missed with the default policy.
- [x] A 09:00 pending task opened at 10:00 runs immediately when policy is run-now.
- [x] A 09:00 pending task opened at 09:03 is marked missed when policy is mark-missed.
- [x] Random daily plans remain stable across repeated app opens on the same date.
- [x] Type-check or an equivalent focused validation passes for the touched scheduling and UI code.
- [x] Missed tasks are visible in the dashboard automation overview with run-now and view actions.
- [x] Dashboard automation overview groups tasks by project with run-now and view actions.
- [x] Project automation task cards expose a run-now button for runnable tasks.
- [x] Dashboard hides the missed-task section when there are no missed tasks.
- [x] Missed tasks expose an ignore action in the dashboard overview.
- [x] Disabled tasks can still be run manually from dashboard and project detail controls.
- [x] Running one task in a project does not make sibling tasks display as running.
- [x] Dashboard overview reflects the clicked task as running immediately after quick run starts.
- [x] Dashboard sibling task run buttons do not silently disable while another same-project task is running.
- [x] Dashboard shows feedback when a run-now action starts or is blocked by same-project concurrency.

## Notes

- Lightweight task; PRD-only planning is sufficient because the change is confined to automation scheduling policy, persisted task shape normalization, and the existing automation settings UI.
