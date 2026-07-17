# Files Tab Enhancement Design

## Scope

Enhance the existing lazy file tree with navigation tools and local file management while preserving the current text/image preview and editor. Repair project-local images in the existing Markdown preview without adding a preview format, runtime dependency, or direct filesystem access. The rejected Flyfish Viewer evaluation remains in `research/flyfish-viewer-evaluation.md` as decision evidence.

## Architecture

The existing boundary remains authoritative:

```text
FilesTab / FileTreeNode
  -> Pinia store actions
    -> ProjectBridge typed contract
      -> browser fallback (safe unsupported result)
      -> uTools preload (validated filesystem operation)
```

Panel-only state stays in `FilesTab.vue`: focused node, expanded nodes, filter query/results, context-menu target, inline create/rename state, action feedback, and pending dirty-file continuation. Pinia owns only bridge delegation and project lookup.

Markdown local assets use the same boundary without a new bridge method:

```text
Markdown content + selected file path
  -> markdown-it image tokens
    -> pure project-relative path classifier
      -> existing store.readProjectFile
        -> preload project boundary + image type/size checks
          -> per-render local asset state
            -> markdown-it image renderer
```

## Markdown Local Images

Add a path-only helper in `src/lib/projectMarkdown.ts`. It classifies an image source as external/pass-through, project-local, or blocked and returns a normalized project-relative path only for the local case. Resolution rules are:

- `image.png`, `./image.png`, and `../image.png` resolve from the selected Markdown file's parent directory;
- `/assets/image.png` resolves from the project root;
- URL query/hash suffixes do not participate in the filesystem path;
- percent-encoded path segments, including non-ASCII names, are decoded exactly once; malformed encoding is blocked without throwing;
- `http:`, `https:`, protocol-relative, `data:`, `blob:`, and anchor sources pass through unchanged;
- drive-letter paths, UNC paths, `file:` URLs, NUL/control characters, and traversal above the project root are blocked before any store call.

The preload project's child resolver remains authoritative, so frontend normalization is not a security boundary by itself.

Extend `src/lib/markdown.ts` with optional render options and token-based image-source collection. Use markdown-it's parsed image tokens and renderer rule rather than regex over Markdown or generated HTML. `renderMarkdown(content)` with no options must preserve every existing caller. Files Tab passes an image resolver that can return ready, loading, or failed local state; ready entries replace only the token's `src`, while loading/failed/blocked entries render an escaped, localized inline fallback without aborting the document. Existing markdown-it URL validation must not be weakened.

`FilesTab.vue` owns a per-render asset map keyed by normalized project-relative path. On Markdown preview content or selected-path changes it extracts and deduplicates local image sources, then reads them through the existing store action with bounded concurrency. A monotonically increasing load generation prevents responses for an old file or draft from mutating the current preview. Clear local asset state when leaving the file and retain ready entries only while they still belong to the current Markdown context. Missing, unsupported, oversized, blocked, or read-failed images become isolated failed entries; remote and embedded sources never trigger a project read.

Add a responsive rule for rendered Markdown images under the existing `.memo-rendered` surface: `max-width: 100%` and `height: auto`. The failure placeholder must also wrap within the preview width.

Before markdown-it token parsing, split only a closed YAML front matter block at the start of the document when its body contains at least one YAML key. Render that metadata through the existing highlight.js YAML grammar, then render the remaining body with the same Markdown environment. Image collection scans only the body. Unclosed blocks and ordinary `---` thematic breaks retain markdown-it's default behavior.

## Bridge Contracts

Add shared types in `src/types.ts`:

```ts
type ProjectFileMutationKind = "file" | "directory";

interface ProjectFileSearchResult {
  rootPath: string;
  query: string;
  entries: ProjectFileTreeEntry[];
  truncated: boolean;
}

interface ProjectFileMutationResult {
  ok: boolean;
  kind: ProjectFileMutationKind;
  path: string;
  relativePath: string;
  previousRelativePath?: string;
  message?: string;
}
```

Extend `ProjectBridge` and mirror the methods in the store:

- `searchProjectFiles(projectPath, query, options?: { limit?: number }): Promise<ProjectFileSearchResult>`
- `createProjectEntry(projectPath, parentRelativePath, name, kind): Promise<ProjectFileMutationResult>`
- `renameProjectEntry(projectPath, relativePath, name): Promise<ProjectFileMutationResult>`
- `deleteProjectEntry(projectPath, relativePath): Promise<ProjectFileMutationResult>`
- `showProjectEntryInFolder(projectPath, relativePath): Promise<void>`

Expected user errors return `ok: false` plus a message. Unexpected bridge failures are caught by Files Tab and rendered as action feedback. Browser fallback keeps identical async signatures and returns unsupported results without mutating its mock tree.

## Filesystem Safety

`public/preload.js` remains the only filesystem mutation boundary.

- Reuse the existing ignored-directory set for tree listing and name search.
- Reuse the project-child path resolver and strengthen mutation checks with canonical root/parent validation so a symlinked parent cannot redirect create/rename outside the project.
- Accept a single basename for create/rename. Reject empty names, `.` / `..`, separators, NUL/control characters, platform-invalid names, Windows reserved basenames, and trailing dot/space where Windows forbids them.
- Create files exclusively (`wx`) and directories non-recursively at the selected parent so existing targets are never overwritten.
- Reject rename collisions and project-root rename/delete.
- Do not follow directory symlinks during recursive search.
- Recursive delete uses the already validated target and reports failure without optimistic frontend mutation.

Name search is explicit, debounced, case-insensitive substring matching. It uses asynchronous breadth-first directory reads, defaults to 200 results, stops at the limit with `truncated: true`, and ignores the same generated/heavy directories as the tree. A monotonically increasing request id prevents stale search responses from replacing newer results.

## Shared Confirmation Dialog

Extract the current Git danger/warning dialog shell into `src/components/project/ProjectActionDialog.vue` and migrate `GitTab.vue` to it in the same change. The shared component preserves the existing Teleport, `scale` transition, semantic tokens, detail block, busy state, backdrop behavior, and accessibility.

The component exposes primary, optional secondary, and cancel actions. Git uses primary/cancel exactly as today. Files Tab uses:

- dirty guard: Save / Discard / Cancel;
- delete: Delete / Cancel, danger tone;
- non-empty directory delete message: show the directory name and explicitly state that all contents are removed.

The dialog and context menu register through `addAppEscapeRequestListener`; Escape closes the deepest local surface before app-level back navigation.

## Tree Interaction

The left pane gains a compact toolbar:

- new file;
- new directory;
- refresh;
- collapse all;
- toggle/focus name filter.

Node-specific actions live in one teleported context menu opened by right-click, Context Menu key, or Shift+F10. Menu actions are new file/directory for directory targets, rename, copy relative path, copy absolute path, reveal in system file manager, and delete. Destructive actions use semantic danger styling.

The menu uses intrinsic content width rather than a fixed panel width. After Teleport renders, measure its actual bounding box, keep the trigger point as the anchor, flip left/up when right/bottom space is insufficient, clamp to an 8px viewport margin, then focus the first menu item. Mouse and keyboard openings share this positioning path.

Use `role="tree"` / `role="treeitem"` and roving tabindex. `FilesTab.vue` computes the visible flattened nodes and owns keyboard movement:

- Up/Down: previous/next visible node;
- Right: expand directory or move to first child;
- Left: collapse directory or move to parent;
- Home/End: first/last visible node;
- Enter: toggle directory or open file;
- F2: rename;
- Delete: request delete;
- ContextMenu or Shift+F10: open the node menu.

Inline create/rename uses Enter to submit and Escape to cancel. On failure, keep the entered value and show the error beside the row. Create target rules are derived from the focused selection exactly as recorded in the PRD. A created file opens immediately in edit mode; a created directory is selected and expanded.

While a filter is active, render a bounded flat result list with relative paths. Opening a result restores/uses the tree, expands its ancestors, focuses it, and opens files normally. Clearing the filter restores the prior expansion state.

## Dirty Draft Continuations

Any action that leaves or affects the selected file or an ancestor directory runs through one continuation guard:

1. no dirty draft -> continue immediately;
2. Save -> await save success, then continue;
3. Discard -> restore persisted content, leave edit mode as needed, then continue;
4. Cancel -> keep draft, focus, selection, and preview unchanged.

This guard applies to tree file switching, Git-originated `openRelativePath`, rename, and delete. `FilesTab` adds an `open-canceled` event; `ProjectDetails.vue` clears the matching Git-originated request on cancellation so no stale request remains.

After rename, rewrite affected selected/expanded paths by prefix and reread the selected file. After deleting the selected file or an ancestor, clear preview/editor/find state. Refresh preserves a valid current selection, clears it if the entry disappeared externally, and never discards a dirty draft without the same guard.

## Validation

Add `scripts/validate-markdown-images.mjs` and `validate:markdown-images`. Use Vite's server-side module loader so the script exercises the TypeScript path helper and Markdown token renderer directly without a new test dependency. Assert:

- the README example resolves to `docs/screenshots/Git状态.png`;
- nested bare, `./`, `../`, and project-root paths normalize correctly;
- encoded non-ASCII names and query/hash suffixes resolve correctly;
- traversal, drive-letter, UNC, `file:`, malformed encoding, and control-character sources are blocked;
- remote/data/blob/anchor sources pass through and never enter the local read set;
- image syntax is collected from Markdown tokens, while code samples are not rewritten;
- ready, loading, and failed images render independently and surrounding Markdown remains present.
- closed YAML front matter renders as highlighted metadata while headings, inline code, and lists remain structured; an ordinary leading thematic break is not converted.

Add `scripts/validate-project-files.mjs` using the repository's existing VM sandbox pattern. It loads `public/preload.js`, creates temporary project fixtures, and asserts:

- ignored directories stay hidden from list/search;
- search finds unloaded nested entries, obeys limits, and reports truncation;
- create file/directory succeeds without overwrite;
- invalid names, collisions, root operations, and traversal are rejected;
- rename returns old/new relative paths and preserves contents;
- recursive delete removes non-empty directories only after the bridge method is called;
- symlink escape attempts are rejected where the platform permits symlink fixtures;
- reveal resolves only validated project children.

Add both validation scripts to `package.json`. Final checks: both focused validation scripts, `node --check public/preload.js`, `npm run type-check`, `npm run build`, and manual uTools interaction at normal and minimum split widths. The Markdown smoke covers the real README image, nested relative/root-relative images, blocked paths, isolated failures, remote/data pass-through, rapid file switching, and wide-image containment.

## Rollback

Bridge methods are additive. If the UI proves unstable, Files Tab can stop exposing mutation/search controls without changing existing list/read/write behavior. The shared dialog migration must preserve Git behavior independently and can be reverted as one isolated slice before file operations are exposed.
