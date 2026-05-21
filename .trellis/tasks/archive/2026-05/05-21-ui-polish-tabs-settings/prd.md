# UI Polish for Project Tabs and Settings

## Goal

Refine the project detail tabs and settings page to reduce visual noise, improve information density, restore file syntax highlighting, and modernize the control styling so the app feels more compact and consistent across related panels.

## What I already know

- The memo tab currently uses two nested framed sections: a todo list panel and a memo editor panel, which makes it visually heavier than the other project tabs.
- The project details container already switches between `scripts`, `files`, `git`, and `memo` tabs inside `src/components/project/ProjectDetails.vue`.
- The file tab already uses `highlight.js` through `src/lib/markdown.ts`, but the current text preview path does not appear to render code highlighting in the file editor view.
- The file editor toolbar already has edit and save actions; the edit action should become a `Done` action while preserving its position and keeping save in front of it.
- Settings currently render separate cards for language and theme, plus always-visible custom command inputs for terminal/editor preferences.
- Current settings UI uses gray nested shells and pill-style toggle groups in `src/components/layout/SettingsTab.vue`.
- The app is frontend-only, so this work stays inside Vue components, shared styling, and i18n text.

## Assumptions (temporary)

- File code highlighting should be applied for all text previews that are rendered as code, not only for markdown previews.
- The custom command input should be conditionally rendered only when the custom option is selected, rather than disabled and always visible.
- The memo tab should keep the existing memo and todo functionality, only flattening the layout and reducing redundant framing.

## Open Questions

- None blocking; the requested visual direction is specific enough to implement directly.

## Requirements (evolving)

- Make the memo tab feel visually aligned with the other tabs by removing the extra outer frame around its two internal sections.
- Reduce bottom spacing in the project detail tab content so more content fits in the viewport.
- Ensure file previews for text files show syntax highlighting for common languages like CSS and JavaScript.
- Replace the current file-tab edit button with a persistent-position `Done` button when editing, and keep a `Save` button before it.
- Hide custom command inputs in settings unless the custom option is selected.
- Remove the large nested gray shells around settings inputs and make the controls feel less boxed in.
- Convert the current toggle groups into segmented controls with clearer selected-state treatment.
- Merge language and theme into a single General settings card.
- Make project config import/export buttons feel lighter and more refined.
- Make the about area feel more deliberate, with version and repository information aligned more cleanly.

## Acceptance Criteria (evolving)

- [ ] Memo tab uses a flatter layout consistent with other project tabs.
- [ ] Project detail content uses tighter vertical spacing at the bottom of tab panels.
- [ ] Text files in the file tab display syntax highlighting for supported languages.
- [ ] File editing shows `Save` and `Done` controls without adding a new button slot or shifting the edit control position unexpectedly.
- [ ] Settings only show custom command inputs when the custom option is selected.
- [ ] Language and theme appear inside one combined General card.
- [ ] Settings controls read as segmented selectors rather than separate pill buttons in a gray tray.
- [ ] Project config and about sections read cleaner and more compact.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.

## Definition of Done

- Tests added/updated where practical.
- Lint and build succeed.
- UI behavior matches the requested interaction changes.
- Notes/specs updated if a reusable pattern or pitfall is discovered.

## Out of Scope (explicit)

- No backend changes.
- No new tab features beyond the requested layout and interaction polish.
- No redesign of dashboard cards outside the settings and project-detail areas unless needed for consistency.

## Technical Notes

- Relevant components: `src/components/project/MemoTab.vue`, `src/components/project/FilesTab.vue`, `src/components/layout/SettingsTab.vue`, `src/components/project/ProjectDetails.vue`.
- Highlighting helpers: `src/lib/markdown.ts`, `src/index.css`.
- Shared i18n text: `src/lib/i18n.ts`.
- Current project detail tab shell is controlled in `src/components/project/ProjectDetails.vue`.
