# Hook Guidelines

> How hooks are used in this project.

---

## Overview

The project does not have standalone custom composables yet. Vue composition features such as `ref`, `computed`, `watch`, and `onMounted` are used directly inside components when the logic is local to one view.

State that needs to cross multiple views goes into `src/store/useStore.ts` instead of a composable. That keeps the current app simple and makes the data flow obvious.

---

## Custom Hook Patterns

There are no reusable custom hooks/composables in the repository today.

If you add one, keep it under a clearly named folder such as `src/composables/`, name it `useXxx`, and return a typed object rather than mutating module-level state.

---

## Data Fetching

There is no client-server data fetching layer today. The current app uses seeded in-memory data in the store.

If async data is added later, wrap it in a composable or store action that exposes explicit `loading` and `error` state, and let the component decide how to render each state.

---

## Naming Conventions

Use the `useXxx` prefix for any future composable.

Keep the name aligned with the concern it owns, such as `useTerminalLog` or `useProjectSelection`, instead of generic names like `useData`.

---

## Common Mistakes

- Creating a composable for logic that only one component uses
- Moving store mutations into an opaque helper that hides the real data flow
- Starting async work without exposing loading or error state
- Adding a composable before the data actually needs to be shared
