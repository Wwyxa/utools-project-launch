# Frontend Quality Guidelines

## Code

- Reuse shared types from `src/types.ts`, semantic tokens from `src/index.css`,
  and available `lucide-vue-next` icons.
- Keep components focused on rendering and interaction. Host operations and
  persistence go through Store actions and the typed ProjectBridge adapter.
- Give icon-only controls an accessible name. Use buttons for actions, inputs
  for editing, and semantic tab/dialog/menu roles for custom controls.
- Avoid duplicated domain state, broad `any` casts, ad hoc color palettes, and
  component-local copies of persisted data.
- Routine stderr or readiness output is not automatically an error; classify
  user-visible status by meaning.
- Runtime capabilities follow the uTools documentation in
  `.github/skills/utools-plugin-dev-skill/references/development/plugin-architecture.md`.
  Derive theme tints with shared tokens and `color-mix()`; do not restore obsolete
  old-Chromium palette workarounds.

## Floating and Dense UI

Teleport menus, dialogs, and tooltips out of clipped panels. Measure interactive
floating shells after render, observe content-size changes, and clamp them to
the viewport. Keep the actual scroll container nested inside a fixed popup shell.
Close floating state when its owner closes, its context changes, or it unmounts.

Dense panels must preserve `min-w-0` on shrinking children and give the actual
overflow region explicit scrolling. Keep graph/layout coordinates derived from
the same rendered dimensions used by rows; do not rely on fixed estimates when
content loads asynchronously.

## Verification

Run the smallest relevant check first, then the normal frontend gates:

- `npm run lint` or `npm run type-check`
- `npm run build`
- `npm test` for cross-feature changes
- `node --check public/preload.js` when the preload boundary changes

Use existing focused scripts and Vitest files for the touched boundary.
Manual uTools checks are required only when the change depends on host behavior
or a real filesystem/process; the developer performs interactive checks.

## Test Selection

Keep tests proportional to regression risk and maintenance cost. Retain safety
boundaries, core workflows, nontrivial parsing/transformation, persistence,
async ordering/completion, and frontend/preload/service contracts. A UI-related
test is useful when it protects behavior, not just appearance.

- Prefer a few independent, representative cases in existing suites. Include
  relevant failures and edge cases; add a bug regression when recurrence is
  plausible and the test can reproduce it reliably.
- Remove redundant cases, trivial forwarding and brittle implementation/style
  assertions. Avoid duplicating Go or native-script checks unless the plugin
  boundary adds a distinct risk. Reuse fixtures and remove unused test support.
- Do not target a count, reduction percentage or coverage score, or hide the
  same bulk of assertions inside fewer tests. Preserve meaningful coverage.
