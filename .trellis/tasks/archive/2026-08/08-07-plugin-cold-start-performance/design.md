# Cold-Start Performance Design

## Objective

Measure the plugin-owned portion of a cold uTools page creation, then reduce the dominant actionable phase without changing the bridge contract or the first-use experience.

## Current Startup Flow

```text
uTools creates plugin page
  -> CommonJS preload.js is parsed/evaluated and publishes window.projectBridge
  -> index.html loads the Vite renderer entry
  -> src/main.ts creates and mounts the Vue app
  -> App.vue registers lifecycle handlers and starts loadProjects()
  -> the first application frame is painted
```

`loadProjects()` is intentionally measured as a separate post-mount interval. The reported symptom says project data is already available quickly after the page opens, so this work must not be optimized speculatively.

## Measurement Design

### Boundaries

- Preload evaluation start: the first executable statement in `public/preload.js`.
- Preload bridge ready: immediately before or after `window.projectBridge` is published.
- Renderer bootstrap start: the first executable statement in `src/main.ts`.
- Vue mount end: immediately after `app.mount("#root")` returns.
- First-frame boundary: the first `requestAnimationFrame` callback after mount.
- Dashboard visible-project DOM update: after the real tiny, regular, and unavailable `ProjectCard` DOM has committed.
- Project load interval: the existing `store.loadProjects()` start and completion, reported separately from first-frame readiness.

Use monotonic timers for intervals within one context and an epoch-millisecond boundary value for comparing preload and renderer logs. The diagnostic probe is temporary and emits only structured console timing records during measurement; it is removed or disabled before the final production build.

### Cold-Start Protocol

1. Build the same commit with `npm run build` for baseline and post-change runs.
2. Fully close and relaunch uTools, then open the plugin through the same command path.
3. Record the phase marks and the visible loading-state duration for five cold opens on the same machine.
4. Use the median for comparison; record outliers and whether the host indicator starts before the first plugin-owned mark.
5. Repeat the exact protocol after each candidate optimization.

The host loading indicator is an observational metric. The 30% acceptance target applies only to the measured plugin-owned critical path, not to unobservable uTools host work.

## Candidate Optimizations

### Renderer-first candidate

The production build has a single approximately 1 MB minified JavaScript asset. Keep the dashboard shell in the initial chunk and convert screens that are not needed for the initial project list (`ProjectDetails`, settings, and environment views) to Vue async components. Verify that the relative Vite base produces valid chunk URLs in the packaged uTools plugin and that navigation still renders the same views.

Do not lazy-load a component that is needed to display the initial dashboard or its first interaction unless timing shows that it is safe and the resulting first-use delay is acceptable.

### Preload candidate

If preload evaluation is dominant, defer only nonessential initialization discovered by the probe. Preserve the CommonJS package scope and legacy Node builtin names required by older uTools Electron versions. Do not split or rewrite the bridge merely to reduce source line count; any split must remove work from the initial evaluation path and retain all existing method signatures.

### Data-loading boundary

Only change `loadProjects()` or availability reconciliation if the phase marks show that it blocks first-frame readiness. Keep persisted preference reads and project hydration behavior unchanged unless a focused measurement and regression test justify a change.

### Selected Dashboard card-grid optimization

Keep the Dashboard shell and size-stable `.skeleton` placeholders on the first render. Once catalog hydration sets `store.projectsLoaded`, defer every tiny, regular, and unavailable `ProjectCard` list through `nextTick()` and two animation frames. Cancel pending callbacks on unmount and while the loading state changes. Capture whether cards were already mounted when a Dashboard instance is created so a later return does not repeat the skeleton; a reload within the same instance must pass through the gate again.

Emit `dashboard-visible-projects-dom-update-complete` only after a `nextTick()` confirms the real card DOM update. The next trace must order `renderer-first-frame` before this mark. Preserve hydration, post-paint path checks and automation work, direct keyword-to-project navigation, and the existing timing probes.

Do not defer, modify, or add a scheduling modifier for OverlayScrollbars. The render-gap trace identifies it as a historical candidate, but the user rejected that candidate for this task.

## Compatibility and Rollback

- `window.projectBridge` method names and payloads remain backward-compatible.
- Browser fallback behavior remains available for renderer tests and local preview.
- Any async renderer chunks must work with `base: "./"` and the existing uTools packaging layout.
- The timing probe can be removed independently of the optimization.
- If packaged navigation fails, or the first-use view regresses, revert the async split and retain the measurement-only result.

## Verification

- `npm run lint`
- `npm run build`
- `node --check public/preload.js` when preload changes
- Focused existing tests for any changed store or bridge contract
- Verify cold entry, a `projectsLoaded` transition, and return navigation from project details without premature card DOM or repeated skeletons.
- Manual uTools cold/warm navigation and five-run timing comparison
