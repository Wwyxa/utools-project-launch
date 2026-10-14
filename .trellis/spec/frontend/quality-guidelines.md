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

Use focused scripts and Vitest files for Git, storage, process, AI, or icon-pack
changes. Manual uTools checks are required only when the change depends on host
behavior or a real filesystem/process.
