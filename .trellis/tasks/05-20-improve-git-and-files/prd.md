# 改进 Git 功能和文件功能

## Goal

Improve the project details Git and Files tabs so Git graph rendering is less misleading, changed files can be inspected through the existing file preview flow, and Markdown files render as rich previews outside the memo tab.

## What I Already Know

- Git graph rendering lives in `src/components/project/GitTab.vue` and currently computes lanes from commit parent relationships.
- The graph SVG currently draws every active lane as a full-height vertical line for every row, then draws current commit connections. This can create misleading continuation lines above the first visible commit and below visible end commits.
- Git snapshot data is produced in `public/preload.js` by `readGitSnapshot`, using `git log --all --graph --decorate=short --pretty=format:%h\t%p\t%an\t%ad\t%D\t%s` plus working tree status and numstat.
- The changed-file list in `GitTab.vue` currently displays file path, additions/deletions, and status, but has no interaction.
- The Files tab already supports browsing a project tree and reading a file by project-relative path via `store.readProjectFile`.
- `ProjectDetails.vue` owns the active detail tab state and can be extended to let GitTab request opening a file in Files tab.
- Memo Markdown rendering is implemented directly inside `src/components/project/MemoTab.vue` with `markdown-it`, `highlight.js`, and `github-dark.css`.
- File preview in `src/components/project/FilesTab.vue` currently shows text files in a readonly textarea/code-editor layout and image files as images.

## Assumptions

- Changed-file inspection should provide two actions: open the file in the existing Files tab and view a Git diff in-place.
- Deleted files cannot be opened in the Files tab and should remain visibly disabled or show an unavailable state, but their diff should still be viewable.
- Renamed files should open the new/current path already exposed by the Git snapshot.
- Markdown rendering should be preview-only when not editing; entering edit mode should keep the existing plain text editor behavior.

## Requirements

- Fix Git graph rendering so visible start/end commits do not show misleading thin lane extensions where the graph has no visible continuation.
- Review the current Git graph lane algorithm for obvious rendering issues and address low-risk defects in the same area.
- Make changed files in the Git tab actionable with both opening the selected file in the Files tab and viewing its diff.
- Add a focused diff viewing experience for changed files without replacing the existing changed-file summary list.
- Preserve the existing Git changed-file summary UI and status/addition/deletion indicators.
- Add Markdown rendering to the Files tab for `.md`/Markdown text files, reusing the memo Markdown renderer behavior rather than duplicating setup.
- Keep editable Markdown files editable through the existing edit/done/save workflow.
- Keep unsupported/binary/deleted-file cases graceful.

## Acceptance Criteria

- [ ] The first visible Git graph row does not draw a lane above itself unless there is an intentionally visible incoming segment within the loaded rows.
- [ ] The last visible Git graph row does not draw a lane below itself when the commit has no visible parent continuation in the loaded rows.
- [ ] Merge/branch connections still render coherently for commits with one or more parents.
- [ ] Clicking the open-file action for a non-deleted changed file switches to Files tab and loads that file.
- [ ] Clicking the diff action for a changed file opens a readable diff view for that file.
- [ ] Changed-file actions communicate interactivity through hover/focus styling and title/label text.
- [ ] Deleted changed files do not attempt to open a missing file.
- [ ] Markdown files opened from Files tab render as formatted Markdown when not editing.
- [ ] Markdown edit mode remains raw text and saving still works.
- [ ] `npm run build` passes.

## Out of Scope

- Side-by-side diff, staging, checkout, or commit actions.
- Changing the Git snapshot data model beyond what is needed for display, file opening, and diff retrieval.
- Rich preview for non-Markdown text formats.

## Technical Notes

- Candidate files: `src/components/project/GitTab.vue`, `src/components/project/FilesTab.vue`, `src/components/project/MemoTab.vue`, `src/components/project/ProjectDetails.vue`, shared markdown helper under `src/lib/` if needed, `src/types.ts` for callback/bridge type wiring, and `public/preload.js` for diff retrieval if needed.
- Relevant specs: `.trellis/spec/frontend/index.md` and frontend component/state/type/quality guidelines; `.trellis/spec/backend/index.md` and backend quality/error guidelines because `public/preload.js` is the bridge boundary if touched.