# uTools 项目管理插件

## Goal

Build a uTools plugin for managing local development and compiled projects, including project launch/stop, Git operations, memo notes, and Chinese-first UI with optional bilingual switching. The plugin must package according to uTools plugin structure requirements so it can be loaded normally.

## What I already know

- The current app is a Vue 3 + Vite frontend with mock project data in `src/store/useStore.ts` and feature components under `src/components/`.
- The current UI already exists, but business logic is not implemented yet and some buttons are still placeholders.
- The user wants support for Node.js, Python, Go, front-end/back-end paired startup commands, and compiled executables such as `.exe`.
- The user wants the interface to be Chinese, with the option to switch to English.
- The first version should use manual project addition rather than automatic project scanning.
- The first version should prioritize Node, Python, and Go projects, with custom command support and startup of compiled executables such as `.exe`.
- The first version of Git should focus on read-only project state display rather than write actions.
- uTools plugin packaging must follow the official file-structure requirements: the package needs a `plugin.json` entry and should ship the built `dist` output, not the project root.
- For third-party dependencies, frontend dependencies can be bundled into the build output, while Node-side dependencies must stay alongside `preload.js` if used.

## Assumptions (temporary)

- Project management will start from local configuration rather than remote discovery.
- Manual project entry is the first supported onboarding flow.
- Node projects can surface commands from `package.json`, while Python and Go projects may rely more on custom commands.
- Git actions in v1 will be limited to read-only state, history, and change visibility.
- The first delivery can prioritize a reliable MVP over deep automation for every language ecosystem.

## Open Questions

- What is the minimum set of project types and command templates that must be supported in v1?

## Requirements (evolving)

- Provide a dashboard for local projects.
- Support starting and stopping projects.
- Support projects with one or more launch commands.
- Support paired frontend/backend startup commands when a project has multiple services.
- Support compiled executables such as `.exe`.
- Prioritize Node, Python, and Go project templates.
- Support custom command definitions for projects that do not fit an auto-detected template.
- Provide Git-related controls and project memos.
- Keep the interface Chinese-first, with language switching if practical.
- Package the app as a valid uTools plugin.

## Acceptance Criteria (evolving)

- [ ] The plugin loads in uTools from a correctly structured package.
- [ ] The app can display and manage at least one local project end to end.
- [ ] The UI is Chinese by default.
- [ ] Launch and stop controls work for supported project types.
- [ ] Node projects can read or manage commands consistently from project metadata.
- [ ] Python, Go, and compiled executable projects can be started and stopped through configured commands or paths.
- [ ] Git state, history, and file change views are wired to real state, not mock-only placeholders.
- [ ] Memo features are wired to real state, not mock-only placeholders.

## Definition of Done (team quality bar)

- Tests added/updated where practical.
- Lint / typecheck / build pass.
- Packaging structure matches uTools requirements.
- Docs/notes updated if behavior changes.

## Out of Scope (explicit)

- Remote project orchestration or cloud sync.
- Full IDE replacement features.
- Complex container or VM orchestration.

## Technical Notes

- Current app shell: `src/App.vue`.
- Current data model: `src/types.ts`, `src/store/useStore.ts`.
- Current UI entry points: dashboard, project details, scripts, Git, memo, terminal.
- uTools file-structure doc: plugin must have `plugin.json`, `logo`, and either `main` or `preload`, and should ship built output.
