# Persist default terminal and fix ESC navigation

## Goal

Persist the default terminal preference so the selected terminal and custom command survive reloads, make the built-in terminal option act as a non-external-launch preference instead of a confusing dead choice, add a visible "open in terminal" action in the project details header, and stop Escape from leaving the plugin entirely when the user expects in-app back navigation.

## What I already know

- `terminalPreferences` currently lives only in Pinia state and is not loaded from or written to plugin storage.
- The settings page already edits `terminalPreferences.kind` and `terminalPreferences.customCommand`.
- The store already persists project catalog data through the preload bridge.
- The dashboard card already has an "open in terminal" button, but the project details header does not.
- `App.vue` currently listens for `Escape` on `window`, but the interaction still exits the plugin instead of returning to the previous plugin page when the user is on the top-level UI.
- uTools docs expose `utools.hideMainWindow()`, `utools.showMainWindow()`, `utools.outPlugin()`, `utools.onPluginEnter()`, and `utools.onPluginOut()`, so the app should use plugin/window lifecycle intentionally rather than treating Escape as a generic browser key.
- uTools preload supports Node.js and Electron APIs, so persistence and bridge behavior can be kept in preload / shared contracts.

## Requirements

- Persist the default terminal preference across reloads and app restarts.
- Persist both `kind` and `customCommand`.
- Keep `builtin` as a valid preference, but make it clearly behave as a no-external-launch option rather than a confusing terminal target.
- Add a project-details header button that opens the selected project in the configured terminal.
- Escape should stay inside the plugin's own navigation model:
  - close the project form when open
  - cancel delete confirmation when open
  - return from project details to the dashboard
  - return from settings to the projects view
  - avoid text-entry targets
  - avoid calling plugin-exit behavior from this interaction path

## Acceptance Criteria

- [ ] Reloading the app preserves the selected default terminal kind and custom command.
- [ ] The settings UI reflects the persisted terminal preference on first render after reload.
- [ ] The project details header has a visible open-in-terminal action button.
- [ ] Escape returns within the plugin UI instead of leaving the plugin from top-level views.
- [ ] The Escape handler still ignores input, textarea, select, and contenteditable targets.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.

## Out of Scope

- Implementing a real embedded terminal pane.
- Changing Git, memo, or script-running flows.
- Adding a new settings subsystem beyond terminal preference persistence.

## Technical Notes

- Relevant files: `src/store/useStore.ts`, `src/App.vue`, `src/components/project/ProjectDetails.vue`, `src/components/layout/SettingsTab.vue`, `src/lib/projectBridge.ts`, `src/types.ts`, `public/preload.js`.
- Relevant docs: uTools window and events API sections for `hideMainWindow`, `showMainWindow`, `outPlugin`, `onPluginEnter`, and `onPluginOut`.
