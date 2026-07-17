# Git Tab Integrated Review Design

## Summary

Keep one stable right-side content area, but fold the Commit Tree / Review mode switch into the existing toolbar instead of adding a separate tab row. Preserve the scope-accurate worktree diff foundation and shared viewer, flatten commit history into an inline-expand tree, make commit metadata hoverable and interactive, move checkout to a row context menu, and consolidate worktree/selected-history analysis into one scope-aware AI entry.

## Boundaries

### In Scope

- Git snapshot-derived staged/unstaged groups, path search, collapse state, and visible-item navigation.
- Scope-aware worktree diff reads.
- Shared unified diff parsing and rendering.
- Integrated right-side mode toolbar and inline commit-file expansion.
- Interactive commit hover card and commit-row checkout context menu.
- Selected-commit AI using historical file lists and bounded historical diffs.
- Preservation of existing Git actions, commit graph selection/filtering, remotes, and sync.

### Out of Scope

See `prd.md#Out of Scope`. In particular, no new Git write operation, partial staging, or side-by-side diff is introduced.

## Component Structure

- `GitTab.vue` remains the owner of Git navigation, selection, filters, action state, inline commit expansion, floating commit controls, AI state, and bridge calls.
- Add `src/components/project/GitDiffViewer.vue` for the shared diff toolbar, hunk navigation, gutter, row rendering, loading and empty/error states.
- Add `src/lib/gitDiff.ts` for pure unified-diff parsing and typed row/hunk models.
- Keep the commit graph, inline changed-file rows, hover card, and context menu in `GitTab.vue`; their state is tightly coupled to graph rows and does not justify a new component boundary in this iteration.

## Data Contracts

Add shared types in `src/types.ts`:

```ts
export type ProjectGitDiffScope = "combined" | "staged" | "unstaged";

export interface ProjectGitFileDiffOptions {
  scope?: ProjectGitDiffScope;
}

export interface ProjectGitFileDiffResult {
  path: string;
  scope?: ProjectGitDiffScope;
  diff: string;
  message?: string;
}
```

Update `ProjectBridge.readGitFileDiff`, browser fallback, Pinia action, and preload implementation to accept `options?: ProjectGitFileDiffOptions`. The default is `combined` for backward compatibility; visible worktree review passes an explicit non-combined scope.

Historical `readGitCommitFileDiff` remains unchanged because the commit hash already fixes its comparison source.

## Data Flow

```text
Worktree row {path, scope}
  -> GitTab request generation
  -> store.readGitFileDiff(projectId, path, {scope})
  -> ProjectBridge.readGitFileDiff(projectPath, path, {scope})
  -> preload validates path and scope
  -> git diff command for selected scope
  -> ProjectGitFileDiffResult
  -> latest matching request only
  -> GitDiffViewer(parseGitDiff(result.diff))

History commit file {hash, path}
  -> store.readGitCommitFileDiff(projectId, hash, path)
  -> existing git show path
  -> same GitDiffViewer
```

## Preload Scope Behavior

- Normalize an absent/unknown scope to `combined`; accepted typed values are `combined`, `staged`, and `unstaged`.
- Resolve and validate the project-relative file path before every Git invocation.
- `staged`: return only cached/index diff.
- `unstaged`: return working-tree diff; for untracked regular files, retain the existing `--no-index`/manual fallback behavior.
- `combined`: preserve current cached + working-tree + untracked behavior for AI and compatibility.
- Return a scope-specific empty message. Binary Git output is passed through and classified by the viewer as non-line-preview metadata rather than treated as a thrown error.

## Worktree List Model

Derive two arrays from the unfiltered snapshot:

- staged entries: `file.staged === true`, selection scope `staged`.
- unstaged entries: `file.unstaged === true` or the existing stageable fallback, selection scope `unstaged`.

Apply the normalized path query and group-collapse state only to visible computed arrays. Composite keys use `${scope}:${path}`. Existing bulk action inputs continue to derive from full live `files`, `stageableFiles`, `unstageableFiles`, and `discardableFiles` values.

Omit the staged group object entirely when the unfiltered staged array is empty. Keep the group visible with a zero filtered count when staged files exist but the search query matches none, so search feedback remains understandable. Give the search input an explicit component-owned left padding that wins over the shared field shorthand.

Keyboard navigation uses `Alt+ArrowUp` / `Alt+ArrowDown` while focus is inside Git Tab and not in an editable control, dialog, menu, or separator. Navigation traverses the currently visible flattened group order. Remove previous/next buttons from the left list header; review-mode toolbar controls may invoke the same navigation function.

## Right-Side Mode State

```text
rightContext = history (default) | review

history:
  expandedCommitHash = "" | hash
  expandedCommitFiles = [] | files

reviewSelection =
  | { kind: "worktree", path, scope }
  | { kind: "commit", commitHash, commitMessage, path }
```

- Render one existing-height toolbar. Its left side is a compact two-option Commit Tree / Review mode control with Commit Tree first and active by default. Its right side is mode-specific: graph selection/filter/AI/scroll actions in history, and current file navigation/source information in review.
- Clicking a worktree file sets a worktree `reviewSelection`, switches to review, and loads the explicit scoped diff.
- Clicking a commit row toggles a single inline expanded commit. Use `commitFilesRequestGeneration` so a slow prior read cannot populate the newly expanded row.
- Clicking an expanded historical file sets a commit `reviewSelection`, switches to review, and loads `readGitCommitFileDiff` through the same request-generation guard and `GitDiffViewer`.
- Switching back to Commit Tree preserves graph scroll, filters, checkbox selection, expanded commit, and loaded files. Switching to Review preserves its latest selection and diff scroll.
- Escape closes floating controls first; if none are open and review is active, it returns to Commit Tree. No detail/diff history stack remains.
- On project id change, reset to Commit Tree and clear expanded/review selections and stale request generations.

## Mutation Reconciliation

- Stage/unstage actions continue to await the store's existing lightweight status refresh.
- After a successful stage, select `{ same path, staged }` if present; after unstage, select `{ same path, unstaged }` if present, then reload scoped diff.
- Before discard, compute the next visible candidate in the selected scope. After the full snapshot refresh, select that candidate if it remains, otherwise the next available item in the same scope, otherwise show review empty state.
- Increment the diff request generation before mutation and before each new read so stale responses cannot restore removed content.

## Unified Diff Parser and Viewer

`parseGitDiff` emits typed rows:

- `meta`: file headers, index/mode lines, binary markers, and no-newline markers.
- `hunk`: parsed `@@ -oldStart,oldCount +newStart,newCount @@` header.
- `context`, `addition`, `deletion`: rows with the correct old/new line numbers.

Line counters reset at each valid hunk. Invalid headers remain visible metadata and do not throw. The viewer:

- uses stable old/new gutter columns and semantic code-surface tokens;
- exposes previous/next hunk icon controls with accessible names;
- supports a local wrap toggle without changing font size or layout tracks;
- scrolls both contexts independently and restores stored offsets;
- shows shared skeleton loading and explicit empty/error/unavailable states.

## Inline Commit Expansion

Remove the dedicated commit detail and history-diff levels. Insert the expanded file list immediately after its owning graph row in normal document flow so subsequent rows move down without obscuring graph content. Keep graph-lane SVG geometry tied only to commit-row indices; the expansion panel occupies an overlay-free block beneath the row and does not add a synthetic graph node.

The expanded block contains a compact changed-file header, loading skeleton, explicit empty/error state, and rows with status, path, additions, and deletions. Checkbox selection remains independent: clicking the row expands, while clicking the checkbox only changes AI selection.

## Commit Hover Card

- Anchor the card to the hovered row/message bounding rectangle instead of following the pointer; stable placement makes the pointer transition into the card possible.
- Use separate open and close timers. Entering either the row target or teleported card cancels close; leaving both schedules a short delayed close.
- The teleported panel uses pointer events, supports text selection and a copy-message control, and closes on Escape, project change, or unmount.
- Show full author, relative plus absolute time, refs, title, and rendered body. Do not show or copy the commit hash in this card.
- Clamp the card to the viewport and cap body height with internal scrolling.

## Commit Context Menu

Store `{ commit, x, y }` for the active row menu and open it only from `contextmenu.prevent`; do not add a persistent or hover action button. The leading checkbox remains exclusively for AI multi-selection. Teleport a compact menu with the existing checkout operation as its only write action. Close it on outside pointerdown, Escape, successful invocation, project change, or unmount.

Generalize selected-commit checkout labels and guards into commit-parameter helpers, but reuse `executeCheckoutCommit` and `requestForceCheckoutCommit` unchanged. This preserves local-branch preference, detached-HEAD handling, dirty-worktree confirmation, force behavior, and status refresh.

## Unified Git AI

Remove `commitAi*`, `buildCommitAiPrompt`, `generateCommitAiAnalysis`, and the detail-page AI panel. Keep one AI dialog with an explicit scope hint:

- no selected commits: “未选择提交，将分析当前工作区变更”，using current worktree files and `workingTreeDiffContext`;
- selected commits: a short selected-count hint, using only selected historical commits.

For the selected-history path, use this aggregator instead of current-worktree context:

```text
manuallySelectedCommits
  -> complete commit message and metadata for every selected commit
  -> readGitCommitFiles(hash) in graph order
  -> file summary per included commit
  -> readGitCommitFileDiff(hash, path) sequentially
  -> one global diff character budget
  -> explicit truncation/omission note
```

Build all selected commit messages and metadata before allocating any diff content so no selected commit message can be displaced by an earlier commit's large diff. Reuse the existing 14,000-character diff budget globally rather than once per commit. Stop additional historical diff reads when the budget is exhausted; selected metadata remains available and the prompt states which code context was truncated. The existing Diff checkbox controls historical diff bodies, while selected-commit file summaries remain included. Never append current worktree files or `workingTreeDiffContext` to the selected-history path.

When the historical diff budget is exhausted, set a dialog-level warning after prompt construction: “Diff 已截断，所有提交信息已保留”. Keep this notice separate from the AI response and do not overwrite it with a successful streaming completion message. Worktree analysis uses the existing bounded combined diff behavior and its own concise truncation notice when applicable.

## Compatibility

- Optional scope keeps existing callers source-compatible and preserves combined AI context.
- No persisted project schema changes.
- Browser fallback accepts the new option and returns the same safe unavailable result shape.
- Existing snapshot, Git write, remote, and AI streaming contracts remain unchanged. Historical AI context uses existing commit-file read APIs.

## Validation Strategy

- Focused parser unit tests with Vitest for line counters, omitted counts, multiple hunks, metadata, binary markers, no-newline markers, and malformed input.
- Scope bridge validation for staged-only, unstaged-only, combined, untracked, empty, and invalid-path cases where the existing preload fixture approach permits.
- `node --check public/preload.js`.
- `npm run type-check` and `npm run build`.
- Browser layout smoke checks at normal and compact host-like widths, including integrated toolbar fit, search spacing, conditional staged group, inline expansion, hover-card reachability, context-menu bounds, and disabled fallback diff states.
- Interaction checks for row expansion versus checkbox selection, stale expansion reads, worktree/historical review switching, Escape priority, hover-card pointer transfer, outside-click menu close, and AI scope/truncation hints.
- Manual uTools smoke test against a real repository with staged-only, unstaged-only, mixed-scope same-file, untracked, deleted, renamed, binary, historical commit files, clean checkout, and dirty checkout confirmation.

## Rollback

The follow-up is isolated to local Git Tab state, prompt construction, and markup. The validated parser/viewer and optional scope contract remain intact. Rollback can restore the separate mode row and detail markup without any data migration or bridge rollback.
