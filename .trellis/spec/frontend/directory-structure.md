# Directory Structure

> How frontend code is organized in this project.

---

## Overview

The frontend is organized by feature and shell layout. `src/App.vue` is the composition root, `src/main.ts` mounts the app, and feature modules live under `src/components/`.

Shared concerns are deliberately small and central:

- `src/store/useStore.ts` owns the current project, memo, todo, log, and staged-file state
- `src/types.ts` owns shared domain types and enums
- `src/lib/utils.ts` owns the `cn` helper used for class merging
- `src/composables/useGlobalActionStatus.ts` adapts renderer-wide action feedback sources into one display model
- `src/index.css` owns theme tokens and global styling

---

## Directory Layout

```
src/
├── App.vue
├── main.ts
├── env.d.ts
├── index.css
├── types.ts
├── lib/
│   ├── gitRemoteProgress.ts
│   └── utils.ts
├── composables/
│   ├── useGlobalActionStatus.ts
│   └── useResizableSplit.ts
├── store/
│   └── useStore.ts
└── components/
	├── dashboard/
	│   ├── Dashboard.vue
	│   └── ProjectCard.vue
	├── layout/
	│   ├── Sidebar.vue
	│   └── TopBar.vue
	├── common/
	│   ├── ActionDialog.vue
	│   └── ActionStatusPopover.vue
	├── project/
	│   ├── GitTab.vue
	│   ├── MemoTab.vue
	│   ├── ProjectDetails.vue
	│   └── ScriptsTab.vue
	└── terminal/
		└── Terminal.vue
```

---

## Module Organization

Feature modules are grouped by screen or capability, not by technical layer.

- `layout/` contains the persistent shell UI such as sidebar and top bar
- `dashboard/` contains the project overview cards and dashboard header
- `project/` contains tabbed detail views for scripts, Git, and memo editing
- `common/` contains reusable cross-feature interaction primitives such as `ActionDialog.vue` and `ActionStatusPopover.vue`
- `terminal/` contains the embedded terminal/log panel used inside project details
- `composables/` contains stateful UI adapters with a meaningful lifecycle boundary; it does not replace Pinia ownership of domain state

Keep new features close to the screen that owns them. For example, a future project settings panel should live alongside the project detail views, not in `common/`. Add a component to `common/` only when it has shared behavior across multiple feature surfaces or forms an application-level interaction boundary; do not move feature panels there merely to shorten imports.

There is no separate `pages/` directory. Add a composable only when it owns a real lifecycle or presentation-adaptation boundary, such as global event subscription and cleanup; do not move one-off component-local state into `composables/` merely to shorten a component.

## Test Layout

Vitest files live in the top-level `tests/` directory, rather than alongside production modules in `src/`. Keep the test directory flat while retaining the source area in the filename, such as `tests/gitDiff.test.ts` and `tests/useStore.aiStream.test.ts`.

The Vitest include pattern is `tests/**/*.test.ts`. Import the production module explicitly from `../src/` so test discovery and source ownership remain separate:

```ts
import { parseGitDiff } from "../src/lib/gitDiff";
```

Do not add `*.test.ts` files beneath `src/`.

---

## Naming Conventions

Current naming follows Vue and TypeScript defaults:

- component files are `PascalCase.vue`
- utilities are `camelCase.ts`
- feature folders use lowercase nouns such as `dashboard`, `layout`, `project`, and `terminal`
- the store entry is `useStore.ts`, following the `use*` convention even though it is a Pinia store

Folder names stay lowercase and descriptive: `dashboard`, `layout`, `project`, `terminal`, `store`, `lib`.

---

## Examples

Representative examples:

- `src/App.vue` decides between the dashboard and project detail screens
- `src/components/project/ProjectDetails.vue` composes the tabbed project experience
- `src/components/dashboard/ProjectCard.vue` keeps card-level actions and status badges local
- `src/store/useStore.ts` centralizes shared project data for all views
