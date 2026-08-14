# Directory Structure

> How backend code is organized in this project.

---

## Overview

The repository has an optional local backend runtime under `service/`. The app is still a Vite + Vue frontend that mounts from `src/main.ts` and renders the project manager UI from `src/App.vue`. For uTools packaging, local native capabilities live in the readable CommonJS preload file under `public/preload.js`, which is copied to `dist/preload.js` during Vite build.

Current project-management behavior lives in the client store and components:

- shared domain state in `src/store/useStore.ts`
- shared types in `src/types.ts`
- local command/Git/file-system boundary in `public/preload.js`, exposed to the UI as `window.projectBridge`
- frontend fallback adapter in `src/lib/projectBridge.ts`
- layout and feature views in `src/components/**`
- theme tokens and global CSS in `src/index.css`

Project Launch Service is the only backend runtime. It owns delegated process supervision, automation scheduling, discovery metadata, and bounded runtime persistence. Keep all other native product concerns in preload and never mix service concerns into the Vue component tree.

---

## Directory Layout

```
service/
├── cmd/project-launch-service/  # executable entry point
└── internal/
	├── api/                     # loopback HTTP protocol
	├── process/                 # process-tree supervision
	├── scheduler/               # delegated automation
	├── service/                 # runtime startup/shutdown
	└── state/                   # discovery, state, token, and locking

public/preload.js                # installer, discovery validation, HTTP client
src/types.ts                     # shared ProjectBridge and service contracts
src/lib/projectBridge.ts         # typed browser fallback
src/store/useStore.ts            # ownership routing and reconciliation
src/components/layout/           # service settings surface
```

---

## Module Organization

The Go service is organized by runtime ownership:

- `service/cmd/project-launch-service/` parses process arguments and owns OS signal handling only.
- `service/internal/api/` owns versioned loopback request validation and response shapes.
- `service/internal/process/` owns command invocation, process identity, tree termination, and retained events.
- `service/internal/scheduler/` owns delegated automation execution after configuration is accepted.
- `service/internal/state/` owns atomic files, the restricted token, discovery validation, locks, and encrypted automation persistence.
- `service/internal/service/` wires those packages together and owns listener/scheduler lifetime.

The frontend remains feature-first:

- `src/components/layout/` for shell UI such as the sidebar and top bar
- `src/components/dashboard/` for project cards and overview content
- `src/components/project/` for project detail tabs such as scripts, Git, and memo editing
- `src/components/terminal/` for the embedded log/terminal surface
- `src/store/useStore.ts` for shared in-memory project data and actions

Keep process control out of Vue components. Keep Git orchestration, ordinary file-system access, download installation, and the service HTTP client in the preload boundary; the Go executable must not become a catch-all replacement for preload.

## uTools Preload Boundary

`public/preload.js` is the current native boundary. Keep it small, readable, and CommonJS-based because uTools requires preload code and any preload-side dependencies to remain clear and unbundled.

- `plugin.json` declares `preload: "preload.js"` and `main: "index.html"`.
- `preload.js` exposes local functions through `window.projectBridge`.
- Vue components must not call Node.js modules directly; call store actions, which call `src/lib/projectBridge.ts`, which delegates to `window.projectBridge` or a browser fallback.
- Runtime process output is emitted as browser `CustomEvent("project-bridge-event")` events and handled by `src/App.vue` / `src/store/useStore.ts`.
- Preload resolves the service directory, validates discovery/token/process identity, starts the verified executable, and is the only JavaScript owner of loopback HTTP requests. Vue code never reads discovery files or sends service HTTP requests directly.
- The browser fallback returns an unavailable service status and must not simulate service ownership.

### Current preload signatures

```ts
window.projectBridge.readPackageScripts(projectPath): Promise<{ scripts: { name: string; command: string }[]; packagePath: string | null }>;
window.projectBridge.readGitSnapshot(projectPath): Promise<ProjectGitSnapshot>;
window.projectBridge.runCommand(payload: ProjectBridgeRunCommandPayload): Promise<ProjectBridgeRunResult>;
window.projectBridge.stopProcess(pid: number, options?: ProjectBridgeStopProcessOptions): Promise<void>;
window.projectBridge.getProcessStatus(pid: number, options?: ProjectBridgeStopProcessOptions): Promise<ProjectBridgeProcessStatusResult>;
window.projectBridge.sendProcessInput(pid: number, input: string, options?: ProjectBridgeStopProcessOptions): Promise<ProjectBridgeSendInputResult>;
window.projectBridge.openPath(path): Promise<void>;
window.projectBridge.showItemInFolder(path): Promise<void>;
```

`ProjectBridgeRunResult`, `ProjectBridgeEvent`, and `ProjectScript` carry optional `runId` and `runtimeOwner: "preload" | "service"`. `runId` is the stable service-facing runtime identity across reconnects; `runtimeOwner` identifies which boundary controls that run. A PID remains diagnostic and a current-process handle, not a persisted authority for service recovery or control.

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
