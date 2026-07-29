# External Application Openers Implementation Plan

## 1. Preference Contract And Migration

- [x] Add shared external-application types and bridge payload/result contracts in `src/types.ts`.
- [x] Add browser-fallback defaults, normalization, new-key persistence, and legacy editor migration in `src/lib/projectBridge.ts`.
- [x] Add the corresponding preload defaults, normalization, new-key persistence, and migration in `public/preload.js`.
- [x] Add `src/lib/projectBridge.externalApplications.test.ts` covering browser and real-preload preference behavior.
- [x] Run `npx vitest run src/lib/projectBridge.externalApplications.test.ts` before opening the Store/UI work.

Rollback point: types, bridge preference functions, preload preference functions, and the focused test can be reverted together while legacy editor behavior is still untouched by components.

## 2. Launch Boundary And Store Actions

- [x] Replace the internal editor launch payload with the selected external-application payload in browser fallback and preload.
- [x] Preserve current target-directory validation, built-in VS Code/Cursor launch branches, custom placeholder replacement, detached spawn, and typed failure results.
- [x] Load the preference collection once into Pinia and add intent-specific actions for add, update, enable/disable, delete, and set-default operations.
- [x] Change project and Git repository launch actions to resolve either the default application or an explicit one-time application id and clone the selected application before bridge delegation.
- [x] Keep implicit Git file/repository call sites on the default application.
- [x] Update `src/lib/projectBridge.workspace.test.ts` to assert repository validation and selected/default application payloads.
- [x] Run the two focused Vitest files and `npm run validate:process-results`.

Rollback point: bridge method and Store action renames must remain one atomic slice; do not leave renderer and preload contracts mismatched.

## 3. Settings Management UI

- [x] Replace the default-editor segmented control with a responsive environment-item-style card grid and inline default/enabled controls in `SettingsTab.vue`.
- [x] Keep card icon/control tracks stable, truncate long names and command summaries, and verify the grid collapses to one column without horizontal overflow.
- [x] Add one add/edit dialog for custom application name and command template, reusing the existing settings dialog and Escape patterns.
- [x] Add concise Simplified Chinese and English command-field help defining `{path}` as the current launch target's full directory path and `{projectPath}` as its compatibility alias.
- [x] Keep built-in applications non-deletable and block disable/delete of the default application with visible feedback.
- [x] Add/update Simplified Chinese and English locale keys and remove editor-setting keys that become unused.
- [x] Run `npm run lint` and `npm run build` before changing launch entry components.

## 4. Direct Launch Menu

- [x] Add a reusable direct launch button/menu component with left-click default launch, right-click selection, pointer and keyboard positioning, menu semantics, focus navigation, outside-click cleanup, and Escape integration.
- [x] Replace editor icon buttons in both project-card layouts and project details with the shared component while preserving disabled states and card event isolation.
- [x] Apply the shared component to the active Git repository direct action.
- [x] Expand the existing Git repository “more actions” menu into one enabled-application row per app instead of nesting another context menu.
- [x] Search all `openProjectInEditor`, `openGitRepositoryInEditor`, editor locale keys, and editor bridge calls; update or intentionally retain every remaining occurrence.
- [x] Run focused tests, `npm run lint`, `node --check public/preload.js`, and `npm run build`.

## 5. Final Verification

- [x] Run `npx vitest run src/lib/projectBridge.externalApplications.test.ts`.
- [x] Run `npx vitest run src/lib/projectBridge.workspace.test.ts`.
- [x] Run `npm run validate:process-results`.
- [x] Run `npm run lint`.
- [x] Run `node --check public/preload.js`.
- [x] Run `npm run build`.
- [ ] Browser-check dashboard card variants, project details, active Git repository action, repository “more” menu, both locales, narrow viewport clipping, and full keyboard/Escape behavior.
- [ ] uTools-check VS Code, Cursor, valid/invalid custom commands, restart persistence, and migration from each legacy editor kind.

## Review Gates

- Preference data remains device-local and absent from project import/export.
- Every component launches through Store actions; no component reads storage or calls `window.projectBridge` directly.
- The default application always resolves to an enabled item after every Store action and persistence normalization.
- One-time menu choices never mutate preferences.
- No external menu is clipped by card/detail/Git overflow containers.
- No new dependency, shell-backed custom launch path, application scanner, or per-product adapter is introduced.
