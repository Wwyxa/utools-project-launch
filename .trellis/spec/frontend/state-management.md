# State Management

> How state is managed in this project.

---

## Overview

Pinia is the only global state layer in the app. `src/store/useStore.ts` owns the current project catalog, selected project id, terminal logs, staged file data, todos, and memo content.

Local UI state stays inside components when it only affects one panel or one interaction, such as the active tab in `ProjectDetails.vue` or the copied state in `Terminal.vue`.

---

## State Categories

Current categories:

- local UI state: tab selection, copied flags, scroll references, input text
- global app state: selected project, project list, logs, staged files, todo list, memo content
- derived state: `selectedProject` getter in the store
- server state: none today
- URL state: none today

---

## When to Use Global State

Promote state to the store when multiple views need the same data or one view must update another view immediately.

Good candidates in the current app include:

- selected project id
- project status changes
- log output visible in the terminal panel
- memo and todo content shared across tabs

Do not move purely visual state into the store if a component can manage it locally.

---

## Server State

There is no server state cache today. All data is in-memory and seeded in the store.

If the app later talks to a real backend or file system adapter, keep the fetched data behind a store action or composable so the UI does not need to care where it came from.

---

## Common Mistakes

- Duplicating the same project data in multiple components
- Storing view-only toggles in the global store
- Assuming store data persists across reloads
- Mutating nested records in ad hoc ways outside the store actions
- Letting derived state drift instead of reading from a getter
