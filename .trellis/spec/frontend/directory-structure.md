# Directory Structure

> How frontend code is organized in this project.

---

## Overview

The frontend is organized by feature and shell layout. `src/App.vue` is the composition root, `src/main.ts` mounts the app, and feature modules live under `src/components/`.

Shared concerns are deliberately small and central:

- `src/store/useStore.ts` owns the current project, memo, todo, log, and staged-file state
- `src/types.ts` owns shared domain types and enums
- `src/lib/utils.ts` owns the `cn` helper used for class merging
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
│   └── utils.ts
├── store/
│   └── useStore.ts
└── components/
	├── dashboard/
	│   ├── Dashboard.vue
	│   └── ProjectCard.vue
	├── layout/
	│   ├── Sidebar.vue
	│   └── TopBar.vue
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
- `terminal/` contains the embedded terminal/log panel used inside project details

Keep new features close to the screen that owns them. For example, a future project settings panel should live alongside the project detail views, not in a generic shared folder.

There is no separate `pages/` or `composables/` directory yet. If one is added later, it should solve an actual reuse problem rather than just moving code around.

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
