# Hook Guidelines

> How hooks are used in this project.

---

## Overview

Use Vue composition features such as `ref`, `computed`, `watch`, and `onMounted` directly inside components when the logic is local to one view. Use a standalone composable only when it owns a meaningful lifecycle or presentation-adaptation boundary.

`src/store/useStore.ts` remains the owner of shared domain and runtime state. `src/composables/useResizableSplit.ts` owns split-pane interaction lifecycle, and `src/composables/useGlobalActionStatus.ts` adapts existing state and renderer events into a global presentation model without moving Git or project data out of Pinia.

---

## Custom Hook Patterns

Keep composables under `src/composables/`, name them `useXxx`, and return a typed object rather than mutating module-level state.

Create a composable when the caller would otherwise own multiple reactive sources plus setup/cleanup for browser or renderer events. Do not use a composable to hide Pinia mutations or to relocate a single local ref.

---

## Data Fetching

There is no client-server data fetching layer today. The current app uses seeded in-memory data in the store.

If async data is added later, wrap it in a composable or store action that exposes explicit `loading` and `error` state, and let the component decide how to render each state.

---

## Naming Conventions

Use the `useXxx` prefix for any future composable.

Keep the name aligned with the concern it owns, such as `useTerminalLog` or `useProjectSelection`, instead of generic names like `useData`.

### Convention: Global Action Status Adapter

`useGlobalActionStatus(store)` adapts shared action feedback, Git read loading, and remote-progress events for `App.vue`.

- Keep `ActionStatusPopover.vue` and `actionStatus.ts` source-agnostic; the composable owns renderer listener setup and cleanup.
- Return only generic display state and expansion state to the application shell.
- Give each future long-running domain its own `operationId` and adapter instead of adding branches to the Git adapter.

---

## Common Mistakes

- Creating a composable for logic that only one component uses
- Moving store mutations into an opaque helper that hides the real data flow
- Starting async work without exposing loading or error state
- Adding a composable before it owns a real lifecycle or adaptation boundary
