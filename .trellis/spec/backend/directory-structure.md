# Directory Structure

> How backend code is organized in this project.

---

## Overview

There is no backend source tree in the repository today. The app is a Vite + Vue frontend that mounts from `src/main.ts` and renders the project manager UI from `src/App.vue`. For uTools packaging, local native capabilities live in the readable CommonJS preload file under `public/preload.js`, which is copied to `dist/preload.js` during Vite build.

Current project-management behavior lives in the client store and components:

- shared domain state in `src/store/useStore.ts`
- shared types in `src/types.ts`
- local command/Git/file-system boundary in `public/preload.js`, exposed to the UI as `window.projectBridge`
- frontend fallback adapter in `src/lib/projectBridge.ts`
- layout and feature views in `src/components/**`
- theme tokens and global CSS in `src/index.css`

If a backend is added later, keep it in a clearly separate runtime boundary instead of mixing server concerns into the Vue component tree.

---

## Directory Layout

```
src/
├── App.vue
├── main.ts
├── index.css
├── types.ts
├── lib/
│   └── utils.ts
├── store/
│   └── useStore.ts
└── components/
	├── dashboard/
	├── layout/
	├── project/
	└── terminal/
```

---

## Module Organization

There are no backend modules yet. The current organization is feature-first on the frontend side:

- `src/components/layout/` for shell UI such as the sidebar and top bar
- `src/components/dashboard/` for project cards and overview content
- `src/components/project/` for project detail tabs such as scripts, Git, and memo editing
- `src/components/terminal/` for the embedded log/terminal surface
- `src/store/useStore.ts` for shared in-memory project data and actions

If backend code is introduced later, use dedicated folders for command execution, external adapters, and persistence. Keep process control, Git orchestration, and file-system work out of the Vue components.

## uTools Preload Boundary

`public/preload.js` is the current native boundary. Keep it small, readable, and CommonJS-based because uTools requires preload code and any preload-side dependencies to remain clear and unbundled.

- `plugin.json` declares `preload: "preload.js"` and `main: "index.html"`.
- `preload.js` exposes local functions through `window.projectBridge`.
- Vue components must not call Node.js modules directly; call store actions, which call `src/lib/projectBridge.ts`, which delegates to `window.projectBridge` or a browser fallback.
- Runtime process output is emitted as browser `CustomEvent("project-bridge-event")` events and handled by `src/App.vue` / `src/store/useStore.ts`.

### Current preload signatures

```ts
window.projectBridge.readPackageScripts(projectPath): Promise<{ scripts: { name: string; command: string }[]; packagePath: string | null }>;
window.projectBridge.readGitSnapshot(projectPath): Promise<ProjectGitSnapshot>;
window.projectBridge.runCommand({ projectId, scriptId, command, cwd, env, label }): Promise<{ pid: number; startedAt: string; command: string; cwd: string }>;
window.projectBridge.stopProcess(pid): Promise<void>;
window.projectBridge.openPath(path): Promise<void>;
window.projectBridge.showItemInFolder(path): Promise<void>;
```

### Wrong vs Correct

Wrong:

```ts
// Vue component imports Node APIs directly.
import { spawn } from "node:child_process";
```

Correct:

```ts
// Component calls the store; the store uses the project bridge boundary.
await store.launchScript(project.id, script.id);
```

---

## Naming Conventions

Current files use standard Vue + TypeScript naming:

- Vue components use `PascalCase.vue`
- shared TypeScript modules use `camelCase.ts`
- feature folders use lowercase nouns such as `dashboard`, `layout`, `project`, and `terminal`
- the store entry is `useStore.ts`, following the `use*` convention even though it is a Pinia store

Do not introduce vague backend names like `helpers` or `misc` unless the module is truly shared across multiple server concerns.

---

## Examples

Examples from the current codebase:

- `src/App.vue` orchestrates the main dashboard/detail switch
- `src/store/useStore.ts` holds the current project list, logs, staged files, todos, and memo content
- `src/components/project/ProjectDetails.vue` composes the tabbed project detail views
- `src/components/terminal/Terminal.vue` renders the terminal log surface and scroll behavior
