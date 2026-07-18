# Design: Git Change List Interaction

## Scope and Boundary

All product changes remain in `src/components/project/GitTab.vue`. The existing Git bridge already supplies commit file lists and commit-file diffs, so no protocol, store, or persistence changes are required.

The feature applies to the inline changed-file blocks under commit rows in the history panel. It does not affect the working-tree list, commit multi-selection, or the review panel contract.

## State Model

Replace the single expanded-commit state with a reactive record keyed by commit hash. Each entry owns its own file list, loading flag, and error string. A per-hash request generation counter invalidates a pending request when that commit is closed or the project changes, so a stale response cannot repopulate a closed block or another commit's block.

Keep a module-scoped `"list" | "tree"` renderer-session preference, initialized to `"list"` when the renderer loads. Each `GitTab` instance initializes its local view-mode ref from that preference and writes the new value back when the toolbar button toggles it. The mode is shared by all expanded blocks and all GitTab instances in the current renderer session, but it is not keyed by project and must not be written to Pinia, project data, preload storage, or `localStorage`.

Keep a second local record keyed first by commit hash and then by normalized directory path. Missing entries mean expanded, preserving the original complete-tree view on first open. Toggling one directory updates only that commit's record. Clear and prune this record together with expanded commit state when a project changes, the component unmounts, or commit hashes disappear.

The existing `selectedCommitHashes` remains exclusively responsible for AI-analysis selection and is not reused for expansion.

## Layout and Data Flow

```mermaid
flowchart TD
  Click[Click commit row] --> Toggle{Already expanded?}
  Toggle -- Yes --> Close[Invalidate that request and remove its state]
  Toggle -- No --> Loading[Create loading state for this hash]
  Loading --> Read[readGitCommitFiles(projectId, hash)]
  Read --> Guard{Hash generation still current?}
  Guard -- Yes --> Store[Store files or error under the same hash]
  Guard -- No --> Ignore[Ignore stale result]
  Store --> Height[Compute this block's visible height]
  Height --> Graph[Accumulate prior expanded heights into graph row Y positions]
```

The graph layout walks commits in display order. Before placing a row, it uses the sum of the heights of all expanded blocks from earlier rows as that row's vertical offset. After placing an expanded row, it adds that row's current height to the running total. The same per-hash heights determine the SVG canvas height. Directory toggles recompute the visible display items, so tree visibility, inline-block height, paths, nodes, rows, and canvas share one source of vertical geometry. Non-empty blocks cap at `240px` and use their existing local scrollbar beyond that height.

When project identity changes, clear all expanded state and invalidate outstanding generations. When the commit collection changes, remove expanded entries whose hashes no longer exist.

## Tree Representation

Transform each expanded commit's `ProjectGitFileChange[]` into display items only when tree mode is active:

- Normalize `/` and `\\` path separators.
- Create virtual directory items for each path segment before the final filename.
- Emit items in depth-first order, with directories preceding files and names sorted deterministically.
- Give every directory item its normalized full path and current expanded state. Descendants are emitted only while each ancestor is expanded.
- Compact a contiguous directory chain when each leading virtual directory has no direct files and exactly one child directory. Display the compact label with `\` separators, but keep the final normalized `/` path as the directory key, tooltip, and collapse-state key.
- Keep file items linked to their original `ProjectGitFileChange` and owning commit hash.

Directory items are buttons with an expandable chevron and `aria-expanded`; their state is scoped to the owning commit. File rows preserve status, additions, deletions, path tooltip, and click-to-review behavior. In tree mode, file rows add one content-column indent beyond their logical depth so their status icon and filename do not visually align with the parent directory's chevron or folder icon. Tree-mode height uses the number of currently visible directory and file rows, capped at `240px`.

## UI and Accessibility

Add an icon-only view-mode button at the far-right edge of the existing history-panel action group in the upper-right. Its icon and tooltip describe the target view reached by clicking it, while `aria-pressed` exposes the current tree-mode state. Keep its visual treatment neutral in both modes so the target icon is not mistaken for the active view. The button does not alter expansion state.

The commit title button reports its own expanded state from the hash-keyed record. Each expanded block retains its existing ARIA region identity, loading announcement, and file interactions.

## Compatibility and Rollback

The first renderer-session view stays list mode, matching current behavior. Reopening a Git tab or switching projects reuses the last renderer-session choice; reloading the renderer resets it to list. The change is local to the component and requires no data migration. Reverting the `GitTab.vue` change restores the prior single-expand behavior without affecting stored project data.
