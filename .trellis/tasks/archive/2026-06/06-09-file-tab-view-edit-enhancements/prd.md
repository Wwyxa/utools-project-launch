# 增强项目详情文件 Tab 查看与编辑体验

## Goal

Improve the project detail Files tab so it feels like a compact, consistent file viewer/editor: read and edit modes should present code with the same syntax-highlighted, no-wrap surface; users can search and replace within the current file; and opening a file from the Git tab should switch to Files and expand the tree to the selected file.

## What I Already Know

- `ProjectDetails.vue` owns the detail tabs and already routes `GitTab` `open-file` events into `FilesTab` via `openRelativePath`.
- `FilesTab.vue` already lists project files lazily, reads/writes text files, renders Markdown previews, and highlights code with `highlightCode` from `src/lib/markdown.ts`.
- Current edit mode uses a plain `textarea`, so it loses syntax highlighting and can wrap differently from read mode.
- `FileTreeNode.vue` supports loaded/expanded directory nodes but there is no helper to expand parent directories for an externally opened file.
- The project has no Monaco/CodeMirror dependency; adding a large editor package is not required for the MVP and risks changing bundle/UI weight.
- Repository memory notes say file previews should use theme-aware `--code-preview-*` surfaces and shared highlight token colors.

## Requirements

- Preserve the existing compact Files tab layout: no large blank panels, no tall search/replace surfaces, and no marketing/help text inside the app.
- Keep read and edit code surfaces visually aligned:
  - same code font, line height, gutter width, no automatic line wrapping, shared scroll behavior, and shared syntax highlighting;
  - edit mode may use a transparent textarea overlay or equivalent approach, but the highlighted code should remain visible and aligned.
- Support current-file find with `Ctrl/Cmd+F`:
  - focus a compact find input;
  - show match count and active match;
  - highlight all matches and the active match in the code surface;
  - support previous/next navigation with buttons and keyboard Enter / Shift+Enter while the find input is focused.
- Support current-file replace with `Ctrl/Cmd+H`:
  - reveal a compact replace row;
  - allow replace current match and replace all;
  - only enable replacement for editable text files in edit mode, or enter edit mode when possible before replacing.
- Keep the find/replace controls visually close to VS Code's compact floating find widget: anchored over the editor surface, not consuming a full-width content row, with dense inputs/actions and no extra blank space.
- Long editable files must remain editable beyond the initially visible editor height; the overlay input layer should cover the whole highlighted content, not just the first viewport of lines.
- Opening a file from Git tab should switch to the Files tab and expand the directory tree down to the target file path, selecting the matching tree node when it exists.
- Do not change bridge read/write contracts unless truly necessary; this is primarily a frontend interaction improvement.

## Acceptance Criteria

- [ ] In read mode, text files keep syntax highlighting, no-wrap code display, line numbers, and compact scrolling.
- [ ] In edit mode, typing changes content while syntax highlighting, no-wrap layout, line numbers, and scroll alignment remain consistent with read mode.
- [ ] `Ctrl/Cmd+F` opens/focuses search for the current text file without stealing ordinary save behavior.
- [ ] `Ctrl/Cmd+H` opens/focuses replace controls for editable text files without adding large vertical whitespace.
- [ ] Search next/previous and replace current/all work on the current file content, including empty/no-match states.
- [ ] Git tab “open file” expands the Files tab directory tree to the file parent path and selects the file.
- [ ] Existing Markdown preview and image/unsupported file states still render correctly.
- [ ] `npm run lint` and `npm run build` pass.

## Out Of Scope

- Repository-wide search/replace.
- Full IDE editor capabilities such as multi-cursor, minimap, diagnostics, language server support, or file rename/delete/create.
- Introducing Monaco/CodeMirror unless the existing lightweight approach proves insufficient.
- Changing preload/backend file list/read/write behavior beyond what is required for tree expansion.

## Technical Notes

- Relevant files inspected: `src/components/project/FilesTab.vue`, `src/components/project/FileTreeNode.vue`, `src/components/project/GitTab.vue`, `src/components/project/ProjectDetails.vue`, `src/lib/markdown.ts`, `src/types.ts`, `src/lib/projectBridge.ts`, `src/index.css`.
- Frontend specs to follow: `.trellis/spec/frontend/index.md`, `.trellis/spec/frontend/component-guidelines.md`, `.trellis/spec/frontend/quality-guidelines.md`, `.trellis/spec/frontend/type-safety.md`.
- The likely implementation path is an overlay editor: a highlighted `<pre><code>` layer plus a transparent textarea layer for input, sharing scroll positions and font metrics. Search highlight spans can be generated from escaped/highlighted segments or plain overlay marks, as long as they stay aligned and theme-aware.
