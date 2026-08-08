# Cold-Start Baseline

## Measurement Setup

- uTools was launched with `UTOOLS_PROJECT_LAUNCH_STARTUP_TIMING=1`.
- The plugin had 11 configured projects; not every project had a Git repository.
- Each sample was a fully cold uTools/plugin open on the same machine.
- The timestamps below are the five user-provided startup traces collected after the first timing probe was added.

## Phase Measurements

| Run    | Preload bridge ready (ms) | Bridge ready to renderer (ms) | Renderer to first frame (ms) | Projects load (ms) | Preload start to first frame (ms) |
| ------ | ------------------------: | ----------------------------: | ---------------------------: | -----------------: | --------------------------------: |
| 1      |                      4.40 |                            55 |                        343.7 |              168.3 |                               403 |
| 2      |                      4.45 |                            54 |                        334.1 |              171.3 |                               393 |
| 3      |                     23.47 |                            86 |                        357.4 |              178.1 |                               467 |
| 4      |                      4.18 |                            53 |                        329.3 |              163.3 |                               386 |
| 5      |                      4.56 |                            59 |                        378.9 |              203.0 |                               443 |
| Median |                      4.45 |                            55 |                        343.7 |              171.3 |                               403 |

`projects-load-complete` preceded `renderer-first-frame` by 75.1-83.9 ms in every run (median 79.2 ms).

## Findings

- Preload module evaluation is not the practical bottleneck: its median bridge-ready interval is 4.45 ms.
- The application has a 55 ms median gap from preload bridge readiness to renderer bootstrap. This includes static renderer asset loading and evaluation, but is not large enough by itself to satisfy the 30% target.
- The renderer needs a 343.7 ms median from its first executable statement to the first frame.
- `loadProjects()` consumes 171.3 ms inside that renderer interval and completes before the browser is allowed to paint. Its work is therefore a high-value attribution target, although its duration overlaps other renderer work and must not be counted twice.
- The next discriminating measurement must split `loadProjects()` into preference reads, project-record hydration, path availability checks, runtime reconciliation, and automation-plan work before changing behavior.

## Decision

Do not optimize `public/preload.js` based on the baseline. Add only granular, opt-in measurement to the existing startup path, collect a short confirmation trace, then defer or restructure the measured first-frame blocker while retaining the current project-data readiness contract.
