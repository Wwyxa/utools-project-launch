# UI 视觉与交互打磨

## Goal

Improve the project launcher and project detail experience so the light theme feels more coherent, denser, and easier to scan, while keeping dark theme behavior aligned wherever the same issue exists.

## What I already know

- The app is a Vite + Vue 3 frontend with Pinia state and no backend runtime.
- Main screens involved are dashboard, project details, files, Git, memo, settings, and the edit-project modal.
- Current design tokens already define semantic colors in `src/index.css`, including primary, success/running, warning, error, and surface layers.
- Existing UI already uses `lucide-vue-next` icons, Tailwind utilities, and shared state in `src/store/useStore.ts`.
- The current code already has some semantic color usage, but several screens still mix status colors and use oversized spacing.
- The user explicitly wants to improve visual system consistency, UX density, and developer-tool ergonomics.

## Assumptions (temporary)

- This task should focus first on high-impact, low-risk UI polish rather than a full product redesign.
- Layout-heavy changes can be phased if the requested scope is too large for one task.
- Dark theme should be updated wherever the same visual issue appears in the light theme.

## Decisions

- Scope selected by user: B. Medium scope.
- This task will implement global visual polish, dashboard running-card/menu improvements, terminal log color refinement, compact settings/modal tweaks, overview compaction, Git change-list collapse, memo two-column layout, and file-tree type icons.
- Full file-preview layout redesign and large editor-like preview reconstruction are deferred to a later task.

## Open Questions

- None currently blocking implementation.

## Requirements (evolving)

- Unify semantic color usage so primary, success, warning, danger, and info read consistently across the app.
- Reduce overly large padding/margins where density is too low.
- Make running project cards more visually prominent in the dashboard.
- Give dropdown popovers stronger separation from their parent surfaces.
- Tighten project overview status presentation so it uses less empty space and surfaces more useful information.
- Improve script/log view state cues and terminal log coloration so normal startup output does not read as errors.
- Improve file tree readability with file-type cues. Keep the current preview architecture mostly intact in this task.
- Make Git file list and commit history denser, clearer, and easier to collapse in small windows.
- Improve memo/todo composition and editing ergonomics.
- Improve edit-project modal alignment, labels, and affordances.
- Reduce excessive vertical gaps in settings and make section hierarchy clearer.

## Acceptance Criteria (evolving)

- [ ] Dashboard, overview, Git, memo, file tree, settings, and modal visuals feel more coherent under the shared semantic color system.
- [ ] Running and error states are clearer without conflicting status colors.
- [ ] The requested screens are denser without breaking layout in narrow windows.
- [ ] Dropdown menus and popovers clearly float above their parents.
- [ ] Terminal log colors distinguish success/info from true error output.
- [ ] Git changed-files panel can collapse without breaking the zero-change state.
- [ ] Memo tab uses a denser two-column layout on wider screens and remains stacked on narrow screens.
- [ ] Light mode and dark mode remain visually aligned where the same component is changed.

## Definition of Done

- Tests added or updated where appropriate.
- `npm run lint` passes.
- `npm run build` passes.
- Visual sanity checks are completed for the touched screens.
- Specs or notes are updated if the task reveals a reusable pattern worth preserving.

## Out of Scope

- Rewriting the app shell or introducing a backend.
- Large architectural refactors unrelated to the UI polish request.
- Full file-preview layout redesign/full-bleed editor rebuild.
- Replacing the existing store or design token system.

## Technical Notes

- Frontend spec entry: `.trellis/spec/frontend/index.md`
- Component conventions and interaction safety: `.trellis/spec/frontend/component-guidelines.md`
- Quality baseline: `.trellis/spec/frontend/quality-guidelines.md`
- Type safety baseline: `.trellis/spec/frontend/type-safety.md`
- Relevant implementation areas: `src/index.css`, `src/components/dashboard/ProjectCard.vue`, `src/components/project/ProjectDetails.vue`, `src/components/project/GitTab.vue`, `src/components/project/FilesTab.vue`, `src/components/project/MemoTab.vue`, `src/components/project/ProjectFormModal.vue`, `src/components/layout/SettingsTab.vue`, `src/components/terminal/Terminal.vue`
