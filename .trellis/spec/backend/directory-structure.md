# Backend Directory Structure

## Preload

`public/preload.js` loads the ordered modules in `public/preload/` into one
CommonJS runtime. Those modules share lexical bindings; preserve dependency
order when adding or moving functions. `bridge.js` exposes `window.projectBridge`.

| Module                                                      | Ownership                                           |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `foundation.js`                                             | Host paths, shared normalizers, platform primitives |
| `local-state.js`, `preferences.js`                          | Device-local files and preferences                  |
| `projects.js`, `migration.js`                               | Project documents, filesystem operations, migration |
| `processes.js`, `platform.js`, `environment-tools.js`       | Direct processes and host launch/detection          |
| `git.js`, `git-diff.js`                                     | Git commands, snapshots, diffs                      |
| `project-launch-service.js`                                 | Service install, discovery, HTTP client             |
| `ai.js`, `icon-packs.js`, `agent-tools.js`, `data-tools.js` | Feature-specific native operations                  |

Keep native implementations here. Vue calls Pinia, Pinia calls
`src/lib/projectBridge.ts`, and that adapter selects preload or browser fallback.
Keep shared contracts in `src/types.ts`; do not expose raw Node modules to UI.

`public/plugin.json` declares `preload.js`. `public/package.json` supplies the
CommonJS boundary in the built plugin. The current source layout is a project
choice: the uTools documentation allows building Node dependencies, so do not
impose a platform-wide unbundled-code restriction.

## Go Service

| Directory                             | Ownership                                         |
| ------------------------------------- | ------------------------------------------------- |
| `service/cmd/project-launch-service/` | Arguments and OS signals                          |
| `service/internal/api/`               | Authenticated loopback HTTP protocol              |
| `service/internal/process/`           | Process identity, supervision, tree termination   |
| `service/internal/scheduler/`         | Delegated automation                              |
| `service/internal/state/`             | Atomic files, token, locks, encrypted state, logs |
| `service/internal/service/`           | Runtime wiring and lifetime                       |

The optional service owns delegated processes and automation. Git, ordinary
files, AI, project configuration, and plugin preferences stay outside it.
See [Project Launch Service](./project-launch-service.md).
