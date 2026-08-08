# Measure plugin cold-start loading

## Goal

Reduce the time that uTools displays its loading state when the project manager plugin is opened from a cold page creation, while preserving the current fast availability of project data after the page becomes visible.

## Confirmed Facts

- The reported delay occurs before the plugin page opens: uTools shows its loading state, then the page opens with its data already available.
- `public/plugin.json` configures `preload.js` as the plugin preload script.
- `public/preload.js` is a large CommonJS bridge that is parsed and evaluated before the Vue renderer starts. Its observed module-level work loads Node and Electron modules, declares bridge functions, and registers cleanup hooks; it does not visibly scan projects or execute Git commands at module evaluation time.
- The Vue application calls `store.loadProjects()` after mounting. That path is more relevant to data readiness after the page has opened than to the reported host loading indicator.
- The current production build transforms 1761 modules into one `1011987` byte JavaScript asset (`311.07 KB` gzip) and one `128541` byte CSS asset; Vite reports the JavaScript chunk as larger than its warning threshold.

## Requirements

- Establish repeatable, low-overhead timing for the cold-start path that distinguishes preload evaluation from renderer bootstrap and first mount.
- Use the timing evidence to identify the phase responsible for the observed delay before changing the startup implementation.
- Apply only an evidence-backed optimization to the measured bottleneck.
- Preserve plugin features, stored projects, and the current ready-to-use state when the page first appears.
- Avoid a permanent user-visible loading UI or routine debug noise unless it is necessary for the accepted measurement workflow.
- Define a cold-start measurement protocol that produces comparable baseline and post-change timings.
- Ensure diagnostic output or collected evidence identifies whether delay occurs before preload, in preload evaluation, in renderer bootstrap, or in first mount.
- Limit any production optimization to the measured startup bottleneck while retaining existing plugin behavior.
- Compare baseline and post-change results on the same machine using five fully cold plugin opens and the median plugin-owned critical-path duration.

## Scope

- Cold creation of the plugin page, from uTools activation through the first mounted application frame.
- The preload bridge, HTML entry point, Vite production output, and renderer bootstrap only when measurement attributes time to them.

## Out of Scope

- Optimizing Git refresh, project metadata inspection, or other work that occurs after the page is visible unless the timing evidence places it on the cold-start critical path.
- Changes to uTools itself or its loading indicator behavior.
- Broader application refactors unrelated to cold startup.

## Acceptance Criteria

- [ ] The timing probe can distinguish preload, renderer bootstrap, and first-mount timing during a cold plugin open.
- [ ] A recorded baseline identifies the dominant measurable phase or demonstrates that the delay is outside the plugin-owned startup path.
- [ ] When an actionable plugin-owned bottleneck is found, the selected optimization reduces the median plugin-owned critical-path duration by at least 30% under the same five-run cold-start protocol.
- [ ] If the dominant delay is outside the plugin-owned path, the result explicitly reports that boundary and does not claim a host-level improvement.
- [ ] Opening the plugin still exposes the existing project data and controls without new visible errors or delayed data readiness.
- [ ] Relevant type checks and targeted tests pass after implementation.

## Technical Hypothesis

Because project data is already available when the page opens, the likely bottleneck is before or during renderer initialization. The primary candidates are preload script parsing/evaluation and production renderer asset loading/evaluation. This hypothesis is falsified if phase timing shows those intervals are small and the measured delay precedes preload execution.

## Performance Decision

- The success metric is the median duration of the plugin-owned cold-start critical path across five fully cold opens on the same machine.
- The target is at least a 30% reduction when a plugin-owned bottleneck is actionable.
- No absolute target is imposed on the complete uTools loading indicator because uTools host work is outside this repository's control.

## Notes

- The implementation approach remains intentionally undecided until phase timing is available.
