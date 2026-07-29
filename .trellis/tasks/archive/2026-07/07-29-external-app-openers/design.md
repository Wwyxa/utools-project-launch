# External Application Openers Design

## Overview

Replace the single editor preference with a versioned, device-local collection of external applications. Keep process launch behind the ProjectBridge boundary, keep current state and mutations in Pinia, and expose one consistent launch menu pattern to the existing project and Git entry points.

## Data Model

Define the shared contracts in `src/types.ts`:

- `ExternalApplicationKind = "vscode" | "cursor" | "custom"`.
- `ExternalApplication` contains a stable `id`, display `name`, `kind`, custom `command`, and `enabled` flag.
- `ExternalApplicationPreferences` contains `schemaVersion: 1`, `defaultApplicationId`, and `applications`.
- VS Code and Cursor use fixed ids and fixed launch kinds. Their names and commands are restored from built-in definitions during normalization; stored data may only control whether they are enabled.
- Custom applications use stable generated ids, a unique non-empty name, and a non-empty command template. `{path}` and `{projectPath}` remain equivalent placeholders.

The collection must always contain both built-in definitions and at least one enabled application. The default id must resolve to an enabled application. Store actions prevent disabling or deleting the valid default; boundary normalization repairs malformed persisted data by selecting the first enabled application, enabling VS Code when none remain.

## Persistence And Migration

Use a new device-local key, `utools-project-launch.local-external-applications.v1`, in both the browser fallback and uTools preload. Do not use `dbStorage` and do not include the preference in project import/export.

Load order:

1. Read and normalize the new external-application key when present.
2. Otherwise read the legacy device-local editor key.
3. Otherwise read the legacy shared editor key.
4. Convert the legacy selected editor into the new default application and persist the normalized new document.
5. If no valid legacy value exists, create defaults with VS Code and Cursor enabled and VS Code selected.

Legacy keys remain unchanged for one rollback-compatible period. Future saves write only the new device-local key.

Legacy migration rules:

- `vscode` or `cursor` becomes the matching built-in default.
- A non-empty legacy custom command creates one enabled custom application and makes it the default.
- An empty or malformed legacy custom command falls back to the complete default document.

## Bridge And Launch Flow

Rename the internal bridge preference and launch contracts to external-application terminology. The browser fallback returns a typed unsupported result; preload validates the target directory and selected application before spawning.

```text
Vue trigger
  -> Pinia launch action(project id / repository target, optional application id)
  -> resolve enabled application snapshot (optional id or default id)
  -> ProjectBridge.openExternalApplication({ projectPath, application })
  -> preload validates path and application
  -> built-in VS Code/Cursor branch or existing custom command parser
  -> detached process result
  -> Pinia project log
```

Keep the current built-in VS Code/Cursor launch branches because Windows installations commonly expose `code.cmd` and `cursor.cmd`; a plain generic direct spawn does not resolve those shims reliably. Custom applications continue through the existing command tokenizer and detached native spawn without a shell. No application discovery, registry scan, icon extraction, or per-product adapter is added.

Store launch actions accept an optional application id. No id means the persisted default (left click and existing implicit callers); an explicit id means a one-time selection (right-click menu). Explicit selection never changes preferences. Missing projects, unavailable paths, disabled/unknown applications, failed launches, and thrown bridge errors remain no-throw component flows and append an appropriate project log where a project context exists.

## Settings UI

Replace the single segmented default-editor control in `SettingsTab.vue` with an environment-item-style hybrid management section. Use a responsive compact card grid for scanning and one dialog for data entry; do not add the mode editor's persistent left-list/right-editor layout because each application has only two short editable fields.

- Put the section title and one compact add button in the header.
- Use two or more compact columns when space permits and collapse naturally to one column in a narrow uTools window.
- Each card shows a fixed-size Lucide application icon, application name, preset/custom and default badges, and a truncated monospace command summary.
- Keep default selection and enabled state as separate inline controls: a single-choice default control and an enabled checkbox/toggle. Disable the enabled control on the current default row.
- Clicking a custom card opens one add/edit dialog with application name and command-template fields. Built-in cards expose only default and enabled controls.
- Under the command-template field, show one concise localized helper: `{path}` is the full directory path of the current launch target, while `{projectPath}` is a compatibility alias with the same value. This wording must also remain correct for Git worktrees and sub-repositories, so do not describe either token as always being the main project root.
- Allow setting any enabled row as default; allow built-in rows to be enabled or disabled but not deleted; allow custom rows to be added, edited, enabled, disabled, and deleted.
- Block disable/delete on the default row with an inline message that asks the user to select another default first.
- Validate custom name and command before calling Store actions; repeat normalization at the bridge boundary for persisted/untrusted values.

Use existing semantic tokens, card radius, Lucide icons, shared dialog transitions, custom dropdown/menu styling, and the app Escape request protocol. Keep card controls in fixed tracks so badges and long commands cannot resize the layout. Keep all visible text in both locale branches.

## Launch Entry UI

Create one small reusable launch-button/menu component for direct editor icon entry points. It owns trigger semantics and the teleported floating menu but receives applications and emits the selected application id; it does not know projects or call the Store.

- Left click emits the default application id immediately.
- Right click prevents the browser context menu and opens a compact menu at the pointer position.
- `ContextMenu` or `Shift+F10` opens the same menu from the trigger bounds.
- Menu items expose enabled applications only, mark the default, focus an item on open, support arrow/Home/End navigation, and close on selection, outside click, Escape, or focus departure.
- The trigger tooltip/accessibility label names the left-click default and the availability of the application menu.
- Teleport the menu to `body` and clamp it to the viewport so card and panel overflow cannot clip it.

Use the component for project-card variants, project details, and the active Git repository editor button. The Git repository “more actions” popup is already a context menu; replace its single editor row with enabled application rows and mark the default rather than opening a second nested context menu.

## Compatibility And Failure Behavior

- Existing project data and project import/export formats do not change.
- Existing editor preference values migrate without user action.
- Corrupt new-format data yields a complete normalized document, never a partially trusted list.
- Unknown or disabled ids cannot be launched.
- If a launch target disappears after a menu opens, the Store re-resolves it at click time and records a failure/no-op rather than passing stale configuration to preload.
- Browser preview remains usable and returns an unsupported launch result without attempting a local process.

## Validation Strategy

Add a focused Vitest file using the existing browser stubs and real-preload VM sandbox pattern. Cover defaults, local/shared legacy migration, new-key priority, malformed data, built-in restoration, duplicate/invalid custom entries, default repair, round-trip persistence, default-item protection, and explicit-versus-default Store launch selection.

Update the Git workspace bridge test for the renamed launch contract and preserve repository-path validation. Then run:

- `npx vitest run src/lib/projectBridge.externalApplications.test.ts`
- `npx vitest run src/lib/projectBridge.workspace.test.ts`
- `npm run validate:process-results`
- `npm run lint`
- `node --check public/preload.js`
- `npm run build`

Manual browser checks cover popup clipping, outside/Escape/keyboard behavior, compact project-card layouts, project details, Git repository menus, disabled/default states, and both locales. Manual uTools checks cover VS Code, Cursor, a quoted executable path with arguments, an invalid command, restart persistence, and legacy migration.

## Rollback

The feature writes only the new device-local key and leaves legacy editor keys and project documents untouched. A rollback can ignore or remove the new key and restore the previous settings/launch UI without migrating project data.
