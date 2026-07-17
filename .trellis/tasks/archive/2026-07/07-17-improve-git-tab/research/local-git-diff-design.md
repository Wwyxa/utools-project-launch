# Local Git Diff Design Research

## Scope

Local repository research for the Git Tab review-flow redesign. No external web research was required because the current implementation and project specs define the controlling contracts.

## Confirmed Implementation Facts

- `src/components/project/GitTab.vue` currently owns Git panel-local selection, modal state, commit detail state, diff loading, and the two-pane layout.
- The left pane is a VS Code-style compact source-control panel with commit controls and one flat changed-file list. File-row click opens a diff modal.
- The right pane is the commit graph. Commit-row click opens a second modal for commit details; clicking a changed file in that modal opens the diff modal above it.
- `src/types.ts:273` defines one `ProjectGitFileChange` record with independent optional `staged` and `unstaged` flags, so one path can legitimately appear in both proposed UI groups without changing the snapshot shape.
- `src/types.ts:666` exposes `readGitFileDiff(projectPath, relativePath)` without a scope option.
- `src/store/useStore.ts:2006` delegates worktree diff reads to the bridge and is the correct component boundary.
- `public/preload.js:2780` currently reads cached, worktree, and untracked diff content and concatenates them. The same function can branch by an explicit scope while preserving combined behavior for existing AI callers.
- `public/preload.js:2860` already reads one historical commit/file diff independently through `git show`, so historical review needs UI navigation changes but no new Git command.
- `src/lib/markdown.ts:165` exposes shared highlight.js-backed code highlighting. The enhanced diff can reuse project code-surface tokens and escaping conventions; the structural diff parser should remain a separate pure helper.
- `package.json` has type-check/build and custom validation scripts, but no unit-test runner. A parser with line-number state and malformed-hunk handling merits focused tests.

## Applicable Project Contracts

- `.trellis/spec/frontend/state-management.md`: component -> Pinia store -> project bridge -> preload; UI-only navigation remains local; bulk Git actions operate on live complete status rather than filtered UI data.
- `.trellis/spec/frontend/type-safety.md`: bridge contracts live in `src/types.ts`; browser fallback and preload stay signature-compatible.
- `.trellis/spec/frontend/component-guidelines.md`: preserve compact Git sidebar, shared resizable split, semantic tokens, accessible icon controls, skeleton loading, and stable half-panel content switches without animation.
- `.trellis/spec/frontend/quality-guidelines.md`: run type-check and build, verify compact-window overflow and keyboard/accessibility behavior.
- `.trellis/spec/guides/cross-layer-thinking-guide.md`: define scope at every layer and test empty/invalid/rapid-switch cases.

## Recommended Contract

Add `ProjectGitDiffScope = "combined" | "staged" | "unstaged"` and `ProjectGitFileDiffOptions = { scope?: ProjectGitDiffScope }`.

`readGitFileDiff(..., options?)` keeps `combined` as the default for compatibility with batch AI diff collection. Worktree review always passes `staged` or `unstaged` explicitly. The result includes the resolved scope so stale or mismatched responses can be rejected by the component.

Preload behavior:

- `staged`: `git diff --cached -- <path>`.
- `unstaged`: `git diff -- <path>` plus the existing bounded untracked-file fallback.
- `combined`: existing cached + worktree + untracked concatenation.

## UI State Recommendation

- Right context: `"review" | "history"`, initialized to `"history"` on project entry.
- Worktree selection: `{ path, scope: "staged" | "unstaged" } | null`.
- History level: `"graph" | "detail" | "diff"` plus selected commit/file.
- Diff requests use a monotonically increasing generation; only the latest matching selection may update the viewer.
- Filter query and group-collapse state affect only computed visible entries.
- Stage/unstage migrates the selection after the store's status refresh; discard captures the next visible candidate before mutation and resolves it against refreshed status afterward.

## Parsing and Test Boundary

Create a pure `src/lib/gitDiff.ts` parser that converts unified diff text into typed rows with `kind`, `content`, `oldLineNumber`, `newLineNumber`, and hunk identity. It must tolerate metadata before the first hunk, omitted counts, multiple hunks, `\\ No newline at end of file`, binary markers, and malformed headers without throwing.

Extract `GitDiffViewer.vue` so worktree and historical paths cannot drift. Add focused Vitest cases for parser line-number transitions and malformed/metadata states; keep preload scope behavior covered by a project validation script or targeted bridge fixture where practical.

## Risk Notes

- Search-filtered arrays must never feed bulk `all: true` action semantics.
- Same-path dual-scope rows need a composite key; path-only selection will collapse valid state.
- Async diff reads can complete out of order during keyboard navigation or rapid row clicks.
- Moving commit details out of a modal narrows the available width; detail and AI sections need responsive single-column fallback.
- Existing AI callers rely on combined worktree context, so changing the default scope would be a regression.
