# Project Load Subphase Trace

## Trace

One fully cold uTools open was collected with `UTOOLS_PROJECT_LAUNCH_STARTUP_TIMING=1` after the granular `loadProjects()` markers were added.

| Phase                              | Duration (ms) |
| ---------------------------------- | ------------: |
| Preference reads                   |          10.1 |
| Project storage read and hydration |           8.3 |
| Path availability refresh          |         110.1 |
| In-memory project state setup      |           0.3 |
| Runtime reconciliation             |           0.9 |
| Automation plan recomputation      |         116.1 |
| Entire `loadProjects()` interval   |         252.1 |

The project-load operation completed at renderer elapsed `343.7 ms`; the first-frame marker occurred at `421.6 ms`, leaving `77.9 ms` between the two markers.

## Attribution

The project catalog is hydrated before either expensive subphase starts. The dominant startup work is therefore:

1. Full project path availability probing, which calls synchronous preload file-system existence checks for all configured projects.
2. Automation-plan normalization, generation, missed-run processing, and due-run scheduling.

The two dominant phases total `226.2 ms` and execute before the initial browser paint. Preference and project-record reads total only `18.4 ms`; preload evaluation remains out of scope for optimization.

## Chosen Optimization

Keep catalog hydration and `projectsLoaded` on the initial path so the first dashboard render receives project data. Preserve the `loadProjects()` completion contract, but wait for two animation frames before path availability refresh, runtime reconciliation, and automation-plan recomputation. The first frame can then paint the hydrated dashboard before these nonessential initial refreshes run.

The double-frame boundary is required: a single `requestAnimationFrame` callback still runs before that frame is painted. Use an immediate fallback outside a browser renderer so tests and nonvisual environments retain current completion behavior.

## Discriminating Check

After the change, a cold trace must show `renderer-first-frame` before `projects-load-path-availability-start` and `projects-load-automation-plan-recomputation-start`. The final `loadProjects()` completion remains after both operations, and the five-run median preload-to-first-frame duration must improve by at least 30% versus the recorded `403 ms` baseline.
