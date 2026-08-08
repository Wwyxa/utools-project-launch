# Render Gap Trace

## Cold-Start Observation

One opt-in cold-start trace with 11 visible projects produced these key milestones:

| Interval                                                    |               Measurement |
| ----------------------------------------------------------- | ------------------------: |
| Preload bridge ready                                        |                   4.65 ms |
| OverlayScrollbars mount start to complete                   |                   48.6 ms |
| Project storage hydration complete                          | renderer elapsed 106.9 ms |
| Hydration complete to visible Dashboard DOM update complete |                  111.0 ms |
| Renderer first-frame marker                                 | renderer elapsed 296.8 ms |
| Renderer post-paint marker                                  | renderer elapsed 306.8 ms |
| Project-card width measurement maximum                      | 0.2 ms, after first paint |

Path availability and automation plan work start after `renderer-post-paint`, as intended. No OverlayScrollbars update marker occurs on this initial project-list hydration path.

## Attribution

The measured 48.6 ms OverlayScrollbars initialization occurs before project hydration and is on the critical first-render path. It remains a measured historical candidate, but the user rejected any deferred OverlayScrollbars behavior for this task. The existing dashboard scrollbar setup must remain unchanged.

The Dashboard project-list DOM update accounts for a separate 111 ms interval after hydration. Project-card width measurements are not a meaningful cause: they execute after the first paint and take at most 0.2 ms per observed sample.

## Rejected Candidate

Deferring the App dashboard's initial OverlayScrollbars mount until after a visible paint opportunity was considered, then rejected. Do not add a directive modifier, native-scrollbar handoff, or lifecycle scheduling around `v-overlay-scrollbar`.

## Selected Optimization

Render the Dashboard shell and size-stable `.skeleton` placeholders first. After `store.projectsLoaded`, mount every tiny, regular, and unavailable `ProjectCard` only after `nextTick()` plus two `requestAnimationFrame` callbacks. Cancel pending callbacks on unmount or a loading-state change. A later Dashboard instance created after cards have already mounted may render them immediately; a loading-state transition within the same instance must use the full gate again.

Emit `dashboard-visible-projects-dom-update-complete` only after the real card DOM has committed. Preserve catalog hydration, path availability and automation deferral, direct keyword-to-project entry, the existing timing probes, and the current OverlayScrollbars behavior.

## Success Check

The next cold trace must show `renderer-first-frame` before `dashboard-visible-projects-dom-update-complete`, with the latter emitted after real cards exist. Verify that no real `ProjectCard` DOM appears before the gate, the skeleton geometry is stable, callbacks do not survive unmount, and returning from project details does not repeat the skeleton. Do not claim a new performance result until it is measured.
