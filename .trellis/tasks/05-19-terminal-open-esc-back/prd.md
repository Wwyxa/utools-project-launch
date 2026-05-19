# Terminal open and ESC back polish

## Goal

Fix several uTools plugin interaction details: make "open in terminal" actually launch the configured external terminal, confirm the default terminal preference is wired through that flow, add consistent ESC-back behavior across the app, and align the Settings back button with the Project Details back button placement.

## What I already know

- The dashboard card action calls `store.openProjectInTerminal(project.id)`.
- `openProjectInTerminal` currently logs the selected terminal kind, returns for `builtin`, and otherwise calls `bridge.openPath(project.path)`.
- The preload bridge currently maps `openPath` to Electron `shell.openPath`, which opens the folder with the OS file association instead of launching a terminal at that directory.
- `terminalPreferences.kind` already exists with `builtin`, `windows-terminal`, `powershell`, `cmd`, and `custom` options plus a custom command input.
- The Settings page already has a back button, but it is placed on the right side of the header while Project Details places the back button on the left.
- No global Escape key handling exists in `src/App.vue` or components today.
- uTools docs confirm preload can use Node.js and Electron APIs, so native process launching should live in `public/preload.js` behind the typed bridge.

## Requirements

- "在终端中打开" should open the selected external terminal at the project path when the project path exists.
- Default terminal settings must be consumed by the terminal-open flow, including Windows Terminal, PowerShell, CMD, and custom command modes.
- The built-in terminal preference should not attempt to launch an external terminal, but should remain a valid no-op preference for future embedded-terminal behavior.
- Failed terminal launch attempts should surface as project logs using the existing log model.
- Escape should navigate back through the plugin UI:
  - Close the project form modal when it is open.
  - Cancel delete confirmation when it is open.
  - From project details, return to the dashboard.
  - From settings, return to projects.
  - Avoid hijacking Escape from text inputs, textareas, selects, and contenteditable elements.
- The Settings page back button should move to the left side and visually match the Project Details return pattern.

## Acceptance Criteria

- [ ] Selecting Windows Terminal, PowerShell, CMD, or a custom terminal command affects the command used by "在终端中打开".
- [ ] External terminal launch is implemented in preload via Node/Electron native capability, not by `shell.openPath` folder opening.
- [ ] TypeScript bridge contracts include any new terminal-open payload/result shape.
- [ ] ESC closes modal/confirmation first, otherwise returns from detail/settings views.
- [ ] Settings header places the back button on the left consistently with Project Details.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.

## Out of Scope

- Implementing a full embedded terminal UI.
- Adding terminal process lifecycle tracking for external terminals.
- Changing Git behavior or script execution behavior.
- Adding new dependencies.

## Technical Notes

- Relevant uTools docs: https://www.u-tools.cn/docs/developer/docs.html
- uTools preload docs indicate preload files can call Node.js and Electron renderer APIs.
- Relevant files: `src/store/useStore.ts`, `src/types.ts`, `src/lib/projectBridge.ts`, `src/global.d.ts`, `src/App.vue`, `src/components/layout/SettingsTab.vue`, `public/preload.js`.
