# Post-Change Three-Run Trace

## Measurement

The user chose to use three fully cold uTools runs for directional validation after the post-paint deferral. The original five-run baseline remains `403 ms` median from preload start to the first-frame marker.

| Run    | Preload bridge ready (ms) | Renderer first-frame elapsed (ms) | Preload start to first frame (ms) | Project load (ms) | Path availability (ms) | Automation recomputation (ms) |
| ------ | ------------------------: | --------------------------------: | --------------------------------: | ----------------: | ---------------------: | ----------------------------: |
| 1      |                      4.55 |                             316.0 |                               380 |             291.2 |                    1.5 |                          55.2 |
| 2      |                      4.48 |                             292.8 |                               352 |             265.1 |                    2.1 |                          50.5 |
| 3      |                      4.35 |                             292.0 |                               350 |             766.1 |                    1.4 |                         543.0 |
| Median |                      4.48 |                             292.8 |                               352 |             291.2 |                    1.5 |                          55.2 |

The optimized preload-start-to-first-frame median is `352 ms`, a `51 ms` or approximately `12.7%` reduction from the `403 ms` baseline. The `30%` target would require a median no higher than `282.1 ms`.

## Confirmed Behavior

- `renderer-first-frame` occurs before path availability and automation markers in all three runs, proving the post-paint deferral is active.
- Path availability drops from the earlier `110.1 ms` pre-paint measurement to roughly `1.5 ms` when it runs after the first frame. It is no longer the visible-startup blocker.
- Automation recomputation remains after the first frame; the third run has a large `543 ms` outlier, but it does not delay the first frame.
- The remaining median interval from Vue mount completion to the first-frame marker is approximately `190 ms`. This points to initial Dashboard DOM/reactive work, per-card post-render measurement, or scrollbar initialization rather than preload or project storage.

## Next Diagnostic

The next probe should record a post-paint marker and the completion of the initial project-card/list DOM update plus `OverlayScrollbars` mount/update work. Do not claim the 30% target until that remaining interval is measured and an optimization is rerun under the same protocol.
