# Cold-Start Implementation Plan

## Ordered Checklist

1. Activate the approved Trellis task after the planning review.
2. Add the smallest temporary timing probe at the preload, renderer bootstrap, mount, first-frame, and project-load boundaries.
3. Run the production build and collect five fully cold uTools runs using the documented protocol.
4. Attribute the delay to preload evaluation, renderer asset/bootstrap work, first mount, host work, or post-mount project loading.
5. Implement the selected Dashboard card-grid gate:
   - Keep the Dashboard shell and size-stable `.skeleton` placeholders on the initial render.
   - After `store.projectsLoaded`, mount every tiny, regular, and unavailable `ProjectCard` only after `nextTick()` and two animation frames.
   - Cancel pending callbacks on unmount and loading-state changes; skip the gate only for a later Dashboard instance after cards have previously mounted.
   - Emit `dashboard-visible-projects-dom-update-complete` only after the real card DOM update; preserve hydration, post-paint path checks, automation deferral, direct keyword-to-project entry, and current timing probes.
   - Do not defer or otherwise modify OverlayScrollbars; its measured mount cost is a rejected candidate for this task.
6. Collect the next cold trace and compare medians only after the behavior checks pass; do not claim the 30% plugin-owned target until a comparable five-run measurement supports it.
7. Remove temporary diagnostics or keep them disabled from the production path.
8. Run the focused and full validation commands, then perform a final uTools smoke check.

## Validation Commands

- `npm run lint`
- `npm run build`
- `node --check public/preload.js` if `public/preload.js` is touched
- The narrowest relevant Vitest test for any changed store, bridge, or startup helper
- `python ./.trellis/scripts/task.py validate 08-07-plugin-cold-start-performance`

## Review Gates

- Do not optimize before a baseline phase attribution exists.
- Do not claim improvement in the complete uTools loading indicator when the measured delay is host-owned.
- Confirm `renderer-first-frame` precedes `dashboard-visible-projects-dom-update-complete`, which must follow actual card DOM creation.
- Confirm no real card mounts before the gate, skeleton geometry remains stable, callbacks cannot outlive unmount, and project-detail return does not repeat the skeleton.
- Keep OverlayScrollbars unchanged; do not implement or recommend a deferred scrollbar mount.
- Confirm initial dashboard rendering, project data availability, project navigation, settings, environment view, and browser fallback behavior after any async split.
- Confirm no permanent startup console noise, leaked timing state, or changed bridge payloads remain.

## Rollback Points

- Roll back the timing probe independently if it changes startup ordering or adds observable noise.
- Roll back renderer code splitting if packaged relative chunks fail to load or first navigation becomes unusably delayed.
- Roll back preload deferral if any bridge method becomes unavailable during early renderer setup.
