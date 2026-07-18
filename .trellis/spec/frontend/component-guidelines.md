# Component Guidelines

> How components are built in this project.

---

## Overview

Components use `<script setup lang="ts">`, the Composition API, Tailwind utility classes, and `lucide-vue-next` icons. Most components are self-contained and domain-specific instead of deeply generic.

The current pattern is:

- define props with TypeScript generics
- keep shared state in the Pinia store when multiple views need it
- use `cn` from `src/lib/utils.ts` for conditional classes
- compose feature components from smaller tab or panel components

---

## Component Structure

Typical component shape:

```vue
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "../../store/useStore";

const props = defineProps<{ projectId: string }>();
</script>

<template>
  <!-- semantic markup, Tailwind classes, icon buttons, and feature panels -->
</template>
```

The project already follows this pattern in `src/components/project/ProjectDetails.vue`, `src/components/project/MemoTab.vue`, and `src/components/terminal/Terminal.vue`.

---

## Props Conventions

Use a typed `defineProps` declaration and prefer imported shared interfaces for domain data.

Examples already in the repo:

```ts
const props = defineProps<{
  project: Project;
}>();
```

Use `defineEmits` for explicit child-to-parent events. `ProjectCard.vue` emits `select` with a project id instead of mutating parent state directly.

---

## Styling Patterns

Styling is Tailwind-first.

- use utility classes in the template for layout, spacing, color, and state
- use semantic design tokens from `src/index.css` instead of ad hoc colors when possible
- use scoped CSS only for small transition effects that are awkward in utility classes, such as the fade transition in `src/App.vue`
- use the `cn` helper when conditional class merging is clearer than inline ternaries

Example: `src/components/layout/Sidebar.vue` and `src/components/dashboard/ProjectCard.vue` both rely on semantic color tokens and utility classes rather than local CSS files.

---

## Accessibility

Semantic elements are preferred: buttons for actions, inputs for search and editing, labels for checkboxes, and headings for section structure.

Current UI already uses those patterns in places like `src/components/layout/TopBar.vue` and `src/components/project/MemoTab.vue`. When adding icon-only controls, give them an accessible name instead of relying on the icon itself.

### Convention: Keyboard-Driven Detail Tabs

**What**: Detail pages expose Tab and left/right arrow keys as page-scoped tab-switching shortcuts while focus is on any non-editable detail control or temporarily falls back to the document body. The active tab still uses roving focus and receives focus after a keyboard switch.

**Why**: Handlers attached only to tab buttons stop working as soon as focus moves to a header or content action. A detail-root bubbling handler still misses events when a view transition or host focus handoff leaves `document.body` active. Initial autofocus masks both scope errors in shallow tests, while native Tab resumes traversing buttons instead of switching project tabs.

**Rules**:

- Give the tablist and tab buttons `tablist` / `tab` semantics, `aria-selected`, `aria-controls`, and an active-only `tabindex="0"`.
- After mount or project replacement, wait for Vue's next DOM update and focus the active tab.
- Register a bubbling `window` keydown listener only while the detail component is mounted and remove it on unmount. Accept targets inside the detail root plus `document` / `body` fallback targets; ignore targets in teleported UI, open store-owned dialogs, modified or already-prevented events, editable targets, and `role="separator"` controls.
- Cycle Tab / Shift+Tab and left/right arrows across the tab list, then focus the newly active tab. Keep the selected underline as the focus cue and suppress the browser's extra outline/ring on these tab buttons.
- Verify entry behavior before clicking a tab, explicitly blur focus back to `body` and retry both key families, repeat the shortcut after focusing a header button, test the last-to-first cycle, and confirm inputs, dialogs, and resizable separators retain their own keyboard behavior.

**Related**: `src/components/project/ProjectDetails.vue`.

### Convention: Left-Side Back Buttons

**What**: Detail and settings headers place the return action on the left with an `ArrowLeft` icon button.

**Why**: The detail view and settings view should share a consistent back affordance in a compact uTools window.

**Example**:

```vue
<header class="mb-5 flex items-center gap-3">
  <button
    @click="store.setActiveTab('projects')"
    class="p-2 hover:bg-surface-variant rounded-lg text-on-surface-variant transition-all active:scale-90 border border-border-subtle bg-surface shadow-sm"
    :title="t.common.back"
    :aria-label="t.common.back"
  >
    <ArrowLeft :size="20" />
  </button>
  <h2 class="text-xl font-bold text-on-surface tracking-tight">{{ t.sidebar.settings }}</h2>
</header>
```

**Related**: `src/components/project/ProjectDetails.vue`, `src/components/layout/SettingsTab.vue`.

### Convention: Global Escape Back Handling

**What**: `src/App.vue` owns a capture-phase `keydown` listener. It first dispatches `requestAppEscape(event)` from `src/lib/escape.ts` so mounted child dialogs and floating menus can close themselves, then closes store-owned project dialogs, then returns from project details, then returns from settings.

**Why**: Escape should feel like a consistent exit path across app-level views and locally owned modal state. Child components often own their own dialog refs, and the capture-phase listener would otherwise swallow their native `keydown` handlers.

**Example**:

```ts
const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!dialogOpen.value) return;
  dialogOpen.value = false;
  event.detail.handle();
};

onMounted(() => {
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});
```

**Rules**:

- Dialogs and floating menus with component-local state should register `addAppEscapeRequestListener(...)` and call `event.detail.handle()` only after they actually close or intentionally keep focus inside the popup.
- Close nested floating controls before their parent dialog when both are open.
- Keep page-level back behavior in `src/App.vue`; do not add independent global Escape listeners for detail/settings navigation.
- Preserve the text-entry guard for page-level back behavior, but allow dialog dismissal to run before that guard.

**Related**: `src/App.vue`, `src/lib/escape.ts`.

### Convention: Conditional Advanced Inputs

**What**: Custom command fields in settings are rendered only when the matching `custom` option is selected.

**Why**: Disabled-but-visible inputs make the settings page taller and noisier than necessary. Conditional rendering keeps the control surface compact and makes the active path obvious.

**Example**:

```vue
<Transition>
  <div v-if="terminalUsesCustomCommand" class="overflow-hidden rounded-lg border border-border-subtle bg-surface px-3 py-3">
    <input :value="store.terminalPreferences.customCommand" @input="store.setDefaultTerminalCustomCommand(($event.target as HTMLInputElement).value)" />
  </div>
</Transition>
```

**Related**: `src/components/layout/SettingsTab.vue`.

### Convention: Shared Highlight Styling

**What**: Code previews reuse the same `highlight.js` token classes and theme colors across memo rendering and file previews.

**Why**: Per-component highlight styling tends to drift, and text files can look unhighlighted even when the parser is working. Shared token styles keep markdown and plain code previews visually consistent.

**Example**:

```ts
const renderedCode = computed(() => highlightCode(draftContent.value, previewLanguage.value));
```

**Related**: `src/lib/markdown.ts`, `src/index.css`, `src/components/project/FilesTab.vue`.

### Convention: Markdown Front Matter Preview

**What**: A closed YAML front matter block at the very start of Markdown is displayed as highlighted metadata, while the document body continues through the shared markdown-it renderer.

**Why**: Without an explicit boundary, markdown-it interprets the opening and closing `---` lines as thematic or Setext syntax, which breaks agent files and other metadata-bearing project documents.

**Rules**:

- Recognize front matter only at the document start, require a closing `---` or `...`, and require at least one YAML key.
- Render the metadata with the existing highlight.js YAML grammar; do not add a YAML/front-matter runtime dependency merely for preview.
- Preserve YAML indentation and line breaks, but wrap long metadata lines to the preview width and suppress horizontal scrolling. Ordinary fenced code blocks keep their existing no-wrap scrolling behavior.
- Parse Markdown images only from the body so image-like YAML strings do not trigger project file reads.
- Leave unclosed blocks and ordinary leading thematic breaks to markdown-it's default behavior.

**Related**: `src/lib/markdown.ts`, `scripts/validate-markdown-images.mjs`.

### Convention: Theme-Aware Code Preview Surfaces

**What**: File previews should use surface tokens for the preview background, gutter, and borders instead of leaving the syntax block on a contrasting hard-coded panel.

**Why**: When a light themed card contains a dark syntax block, the preview reads like a screenshot pasted into the UI. Using shared preview surface variables keeps the file viewer visually continuous in both light and dark themes.

**Example**:

```vue
<div class="grid h-full grid-cols-[3rem_minmax(0,1fr)] overflow-hidden bg-[var(--code-preview-bg)] font-mono text-xs">
  <pre class="border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)]">...</pre>
  <pre class="bg-[var(--code-preview-bg)]"><code class="hljs">...</code></pre>
</div>
```

**Related**: `src/components/project/FilesTab.vue`, `src/index.css`.

### Convention: File Viewer Highlighted Editing

**What**: The Files tab code viewer/editor keeps one shared no-wrap code surface for read and edit states. Edit mode overlays a transparent textarea on top of the highlighted code layer instead of swapping to a visually different plain textarea.

**Why**: Switching to a normal textarea loses syntax highlighting, wraps long lines differently, and makes the compact file viewer feel like two unrelated tools.

**Rules**:

- Keep the gutter, code layer, and textarea on the same font, line height, padding, tab size, and no-wrap behavior.
- Synchronize vertical and horizontal scroll between the textarea and highlighted layer.
- Search match marks should be injected into the full highlighted HTML by source offsets. Do not split the source into independent highlighted slices around matches, because a match can cut through strings, tags, or comments and break token coloring.
- Keep find/replace controls current-file scoped and compact; avoid large panels or repository-wide search UI unless the task explicitly asks for it.

**Related**: `src/components/project/FilesTab.vue`, `src/index.css`, `src/lib/markdown.ts`.

### Convention: Shared Skeleton Loading States

**What**: Loading regions in files, Git, and environment panels use a shared `.skeleton` utility class from `src/index.css` instead of repeating long `animate-pulse rounded bg-surface-container-high` class strings.

**Why**: The shared class keeps loading states visually consistent, makes EnvironmentTab the same reference surface as FilesTab and GitTab, and lets each loading region focus only on its own width/height and grid layout.

**Example**:

```vue
<div v-if="isLoadingTree" class="space-y-1.5 p-1" aria-busy="true">
  <div class="skeleton h-3 w-24" />
  <div class="skeleton h-3 w-20" />
</div>

<div v-if="isLoadingFile" aria-busy="true">
  <div class="grid grid-cols-[3rem_1fr] gap-2">
    <span class="skeleton h-2.5 w-6" />
    <span class="skeleton h-2.5 w-full" />
  </div>
</div>
```

**Rules**:

- Put `aria-busy="true"` on the loading container only while the content is actually loading.
- Use `w-*` / `h-*` utilities to shape each placeholder row or block; the base class should stay tiny.
- When a loading string is replaced by skeleton UI, remove the now-unused locale keys from both locales in the same change.

**Related**: `src/index.css`, `src/components/environment/EnvironmentTab.vue`, `src/components/project/FilesTab.vue`, `src/components/project/GitTab.vue`, `src/components/project/FileTreeNode.vue`.

### Convention: Semantic Status Surfaces

**What**: When a component represents running, success, warning, error, or info state, use the shared semantic tokens from `src/index.css` instead of inventing a local palette.

**Why**: Dashboard cards, project overview badges, Git metadata, and terminal logs feel inconsistent when each surface picks its own shade of green or red. Running states often read better as a pulsing dot plus label than as pulsing text; keep that dot consistent across cards, terminal state chips, and script rows.

**Example**:

```vue
<span class="inline-flex items-center gap-1 border border-status-running/30 bg-status-running/10 text-status-running">
  <span class="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse shadow-[0_0_8px_rgba(46,175,125,0.9)]" />
  Running
</span>
```

**Related**: `src/index.css`, `src/components/dashboard/ProjectCard.vue`, `src/components/project/ProjectDetails.vue`, `src/components/terminal/Terminal.vue`.

### Convention: Terminal Output Context Menu

**What**: Actions that operate on the currently selected terminal output, such as copying the current log or clearing the selected script log, live in the terminal output area's right-click context menu. Project-wide actions such as clearing all runtime logs stay in the panel header.

**Why**: The terminal header is already dense with script chips, scroll controls, and filtering, but global destructive actions still need an always-visible home. Keeping current-terminal actions in a local context menu preserves horizontal space while making their scope obvious.

**Rules**:

- Attach the custom context menu to the log output surface, not text-entry inputs, so normal typing controls keep their expected behavior.
- Teleport floating menus to `body`, give them semantic token surfaces, border, and shadow, and close them on outside click or Escape.
- Keep destructive options visually distinct with status tokens, and disable unavailable actions rather than hiding them when the menu is open.

**Related**: `src/components/terminal/Terminal.vue`, `src/store/useStore.ts`.

### Convention: Collapsible Dense Panels

**What**: Dense data-heavy panels may use a small local collapse toggle to reclaim vertical space in narrow windows, but they should still render an explicit empty state when there is no data.

**Why**: Git change lists and similar sections can crowd the rest of a tab, especially in compact uTools windows.

**Example**:

```ts
const filesPanelOpen = ref(true);
```

**Related**: `src/components/project/GitTab.vue`.

### Convention: Resizable Split Panels

**What**: Side-by-side and stacked project panels use the shared `useResizableSplit(...)` composable when users need to adjust the divider directly. The composable owns pointer tracking, keyboard adjustment, renderer-session size memory, resize bounds, and cleanup; each tab owns only its panel refs, orientation, and minimum sizes.

**Why**: Independent resize implementations drift on pointer cancellation, narrow-window behavior, axis semantics, and remembered size lifetime. A shared interaction keeps Memo, Files, Git, Scripts, and later panel migrations consistent without moving visual state into Pinia or project persistence.

**Contract**:

- Keep visual size preferences in renderer memory under a stable layout key. Do not store them in project data, Pinia, preload storage, or `localStorage` unless a separate requirement explicitly asks for restart persistence.
- Use `orientation: "horizontal"` for left/right panes and `orientation: "vertical"` for top/bottom panes. Horizontal layouts expose a vertical separator with left/right arrow keys and `col-resize`; vertical layouts expose a horizontal separator with up/down arrow keys and `row-resize`.
- Start from the rendered first-panel width or height so the first drag does not jump when the default layout is ratio-based. On `pointerdown`, read that DOM size before any container measurement that can update the reactive grid template; otherwise the measurement can replace the visible ratio track with a stale or clamped pixel size before the drag origin is captured.
- Clamp both panes against explicit minimum sizes. When the container is narrower or shorter than both minimums plus the separator, degrade proportionally and keep every computed size non-negative.
- Use Pointer Events with a primary-button guard, pointer capture, and window-level move/end listeners. End the interaction on `pointerup`, `pointercancel`, `lostpointercapture`, window blur, and component unmount; always restore body cursor and text-selection styles, even when capture release fails.
- Observe the split container with `ResizeObserver` and re-clamp the remembered first-panel size whenever its available width or height changes.
- Expose the divider as a focusable `separator` with the axis-appropriate `aria-orientation`, an accessible label, current/min/max values, arrow-key adjustment, `touch-none`, and visible hover/focus/active feedback.
- Once the first track becomes a fixed pixel size, the remaining content track must be `minmax(0, 1fr)`. A lone fractional track below `1fr`, such as `0.71fr`, reserves only that fraction of the leftover space and leaves an empty strip at the container edge.

```ts
// Correct after the first pane switches to a measured pixel size.
return `${firstSize}px ${separatorSize}px minmax(0, 1fr)`;

// Wrong: the second pane uses only 71% of the remaining space.
return `${firstSize}px ${separatorSize}px minmax(0, 0.71fr)`;
```

**Validation**:

- Assert that the two pane sizes plus separator size equal the split container's corresponding client dimension within subpixel tolerance.
- Drag by a known horizontal or vertical delta and assert the first pane changes by that delta until a minimum/maximum boundary is reached.
- Switch away from and back to the tab and assert renderer-session size recovery; reload the renderer and assert the default ratio returns.
- Check desktop and narrow viewports for no unintended overflow, non-overlapping panels, axis-correct keyboard adjustment, and cleanup after releasing outside the divider.

**Related**: `src/composables/useResizableSplit.ts`, `src/components/project/MemoTab.vue`, `src/components/project/FilesTab.vue`, `src/components/project/GitTab.vue`, `src/components/project/ScriptsTab.vue`.

### Convention: Teleported Modal Entry Transitions

**What**: Dialog shells and other teleported overlays use a shared `.scale-*` Vue transition in `src/index.css`. The transition wraps the `v-if` root inside the existing `Teleport`.

**Why**: This gives modals a soft entry and exit without hard cuts, while keeping the overlay layer outside panel overflow and away from clipped stacking contexts.

**Example**:

```vue
<Teleport to="body">
  <Transition name="scale">
    <div v-if="showDialog" class="fixed inset-0 z-50 flex items-center justify-center">...</div>
  </Transition>
</Teleport>
```

**Rules**:

- Use `.scale-enter-active/.scale-leave-active` for full dialog shells; keep `fade` for lightweight floating controls.
- Do not wrap one side of a paired `v-if` / `v-else` switch in its own transition, because it breaks the replacement pair.
- Leave half-panel content switches unanimated unless a manual regression proves the resize behavior stays stable.

**Related**: `src/index.css`, `src/components/project/GitTab.vue`, `src/components/project/ProjectFormModal.vue`, `src/App.vue`.

### Convention: Collapsible AI Reasoning Results

**What**: AI result panels that can receive model reasoning should render through a shared result component with a default-collapsed reasoning block and a separate final-answer body.

**Why**: Reasoning streams can be much longer than the useful answer. Keeping reasoning separate preserves provider compatibility and prevents dense Git dialogs from filling with intermediate thinking text.

**Rules**:

- Keep the final answer visible and streaming normally.
- Render reasoning only when the stream state has non-empty reasoning; do not show an empty collapse block.
- Copy actions should copy the final answer content only. Keep `rawContent` for parsing/debug preservation, not for the default user-facing copy action.
- Use conservative parsing for inline reasoning tags; never hide incomplete, inline-code, or fenced-code tags.

**Related**: `src/components/project/AiReasoningResult.vue`, Streaming AI Bridge Actions in `state-management.md`.

### Convention: Compact Git History Rows

**What**: Git history rows should keep hash, message, refs, author, and relative time readable while fitting into a compact fixed-height row.

**Why**: Moving author/time below the commit message improves scanability, but if the row height stays too large the graph feels stretched and wastes vertical space.

**Graph Width Rule**: The SVG graph column must use the actual lane span as its CSS grid width. Do not cap the graph column to an arbitrary maximum such as `104px`; dense branch histories should make the row horizontally scrollable instead of clipping lanes or scaling each row differently.

**Continuous Graph Rule**: Render Git graph lanes with a list-level shared SVG layer, not one isolated SVG per row. Compute row `y` coordinates from the same fixed row height and row gap used by the visible rows, keep the SVG layer `pointer-events: none`, and place it above hover/selected row backgrounds so branch lines and nodes remain visible while row clicks, selection buttons, hash copy, and tooltips continue to work. Keep that SVG inside the loaded-row container and clip it there; the graph must not visually extend into empty states or the "load more" area. Prefer a stable left-side mainline. For cross-lane parent links, non-first parents should fan out near the merge commit and branch lanes should fan back in near the target/base commit, then continue vertically; do not draw one long diagonal or long Bezier across many rows.

**Dot Alignment Rule**: Commit rows must use the same pixel row-height constant as the SVG coordinate system. Do not rely on a rem-based utility such as `h-8` for Git graph rows while SVG nodes use numeric pixel coordinates, because root font size, zoom, or rendered content can make dots drift above or below their matching commit row. Set the row height from the shared `rowHeight` value and compute node `y` values from that same value plus the row gap.

**Ref Classification Rule**: Parse each `git log --decorate=short` ref through one presentation helper shared by the dense row and its tooltip. A current-HEAD node is only an exact `HEAD` ref or `HEAD -> <non-empty branch>`; never use `refs.includes("HEAD")`, because historical symbolic refs such as `remote/HEAD` or `fork/HEAD` would otherwise receive the current-HEAD node style. Classify tags first, then configured/prefix-matched remotes, then known local branches. Only a known local `main` or `master` gets the primary-local variant; an unrecognized string must stay neutral rather than being guessed as a local branch.

```ts
const isHeadRef = (refName: string) => refName === "HEAD" || /^HEAD ->\s+\S+$/.test(refName);
const isRemoteRef = (refName: string) =>
  /^(?:origin|upstream|remote|remotes\/[^/]+)\//.test(refName) ||
  snapshot.value?.remotes?.some((remote) => refName.startsWith(`${remote.name}/`));
```

Use familiar Lucide icons plus semantic tokens to distinguish current HEAD, primary local branches, other local branches, remotes, and tags. A graph fixture containing `HEAD -> master`, a non-main local branch, `remote/HEAD` or a custom `fork/HEAD`, and a tag must yield exactly one enlarged HEAD node and matching row/tooltip badge presentation.

**Expanded Details Rule**: When multiple commit rows can show inline changed-file blocks, store each block's files, loading state, error, and request generation by commit hash. For a collapsible tree, keep only explicitly collapsed directory paths in a second record keyed by commit hash plus normalized `/` path; a missing path means expanded. Build one reactive visible-item list from that state and use it for template rows, the capped inline height, every later graph row's vertical offset, and the SVG canvas height. Accumulate that height in visible commit order after placing each row; do not use a single selected-row offset. Closing a block, replacing the project, unmounting the component, or pruning unavailable commits must remove the matching request and directory state so an old file-list response cannot reopen or overwrite state.

The list/tree choice is a renderer-session user preference rather than per-instance state: initialize each `GitTab` ref from one module-scoped `"list" | "tree"` value and update that value from the view-toggle action. Do not reset it for project replacement, and do not put this purely visual preference in Pinia, project data, preload storage, or `localStorage`; a renderer reload starts from the list default.

```ts
let expandedHeight = 0;
for (const [index, commit] of visibleCommits.entries()) {
  rows.push({ commit, y: index * rowPitch + rowHeight / 2 + expandedHeight });
  expandedHeight += expandedCommitFilesHeight(commit.hash);
}
```

```ts
let rememberedCommitFileViewMode: "list" | "tree" = "list";
const commitFileViewMode = ref(rememberedCommitFileViewMode);

const toggleCommitFileViewMode = () => {
  commitFileViewMode.value = commitFileViewMode.value === "list" ? "tree" : "list";
  rememberedCommitFileViewMode = commitFileViewMode.value;
};
```

This keeps graph nodes, paths, row DOM, and expandable content in one vertical coordinate model even while file lists load asynchronously or switch between list and tree display modes.

```ts
const isDirectoryExpanded = (commitHash: string, path: string) => collapsedDirectories[commitHash]?.[path] !== false;
const visibleItems = commitFileDisplayItems(commitHash);
const height = Math.min(240, visibleItems.length * 24 + 10);
```

Do not recursively render all directory descendants and calculate height from that unfiltered list; a collapsed parent must remove every descendant from the same list that drives layout.

Use VS Code-style compact folders for virtual directory chains: when a directory has no direct files and exactly one child directory, emit one directory row with the names joined by `\`. The compact row's key, tooltip, and collapse state must use the final normalized `/` path rather than its display label, and its children must be emitted from the final directory node at one deeper visible depth.

Directory rows reserve a chevron and folder-icon column, while file rows begin with a status-icon column. Therefore, a tree-mode file row needs one additional indent unit beyond `item.depth`; otherwise a child file's status icon can appear level with its parent's folder icon even though the tree data depth is correct. Keep this as a visual-only offset so it does not affect visible-item counts or graph height.

```ts
while (directory.files.length === 0 && directory.directories.size === 1) {
  const [childName, childDirectory] = [...directory.directories.entries()][0]!;
  compactName += ` \\ ${childName}`;
  compactPath = `${compactPath}/${childName}`;
  directory = childDirectory;
}
```

**Example**:

```vue
<div class="grid h-8 min-w-[30rem] items-center gap-1.5 rounded px-2 text-xs">
  <span class="truncate font-mono text-[10px] font-semibold">abc1234</span>
  <div class="min-w-0 overflow-hidden">
    <div class="flex min-w-0 items-center gap-1.5 leading-4">
      <span class="truncate text-[11px] font-semibold">Fix layout</span>
    </div>
    <div class="mt-px truncate text-[9px] leading-3">wyxa · 2 小时前</div>
  </div>
</div>
```

**Related**: `src/components/project/GitTab.vue`.

### Convention: Git History Selection Controls

**What**: When Git history rows support manual selection for batch AI analysis, selection uses a dedicated compact button at the start of each row. The row click remains reserved for opening commit details.

**Why**: Dense Git rows already have multiple meanings: graph scanning, hash copy, tooltip preview, and detail opening. A dedicated selection control lets users choose arbitrary commits without accidentally opening details or losing the compact row layout.

**Example**:

```vue
<div class="grid h-8 items-center" @click="openCommitDetails(row.commit.hash)">
  <button
    type="button"
    :aria-label="isCommitSelected(row.commit.hash) ? '取消选择该提交' : '选择该提交'"
    @click.stop="toggleCommitSelection(row.commit.hash)"
  >
    <Check v-if="isCommitSelected(row.commit.hash)" :size="12" />
  </button>
  <!-- graph, hash, message, refs, author/time -->
</div>
```

**Rules**:

- Keep selection state local to `GitTab.vue` unless another view needs to consume it.
- AI batch scope should prefer explicitly selected commits, falling back to the filtered visible commit list when nothing is selected.
- Bulk actions such as select visible and clear selection belong near the filter/AI action area, and the toolbar should wrap in narrow windows.
- Do not make the whole row toggle selection; preserve row click for commit details and `@click.stop` for hash copy and selection buttons.

**Related**: `src/components/project/GitTab.vue`, Streaming AI Bridge Actions in `state-management.md`.

### Convention: Markdown Commit Tooltips

**What**: Git commit rows may show a delayed structured markdown tooltip for the full commit details, while the row itself stays compact and displays only the short hash, subject, refs, author, and relative time.

**Why**: Commit bodies often contain markdown lists. Native `title` tooltips flatten formatting and cannot render list structure, but immediate custom tooltips feel noisy when scanning a dense history list.

**Implementation Rules**:

- Render rich commit tooltips with a `Teleport` to `body` so nested Git panel `overflow` rules do not clip the floating layer.
- Use a short hover delay before showing the tooltip. Current Git history uses about `450ms`.
- Keep row text compact; put detailed absolute time in the custom tooltip instead of a native `title` on the author/time row.
- Do not repeat the short commit hash inside the tooltip header; the row already shows it. It is fine to use the hash only for stable Vue keys.
- Store the hovered commit object plus coordinates in tooltip state instead of storing only a precomputed string. The tooltip needs `message`, `body`, `author`, `date`, and `refs` to build the header and markdown body.
- Let tooltip width fit content with a max-width cap. Do not add a fixed/minimum width that leaves empty space for short commit messages.
- Positioning should stay simple: default above the cursor/row, fall below only when there is not enough top space. Avoid complex left/right flipping that can make the tooltip appear far from the hovered commit.
- When placing above, prefer CSS transform based on the tooltip's real height, such as `transform: translateY(-100%)`, instead of subtracting an estimated height from `top`.
- In a height-constrained tooltip, make the shell and content area flex columns with `min-h-0`; keep the header, title, change summary, and refs non-shrinking, and let only the markdown body use the remaining height with `overflow-y-auto`. With a long body at compact max-height, assert that the body scrolls and the summary remains fully inside the panel bounds.
- Clear pending timers and visible tooltip state on mouse leave and component unmount.
- Normalize common commit formats before rendering the tooltip body:
  - Subject-only commit: show the subject as the tooltip title and omit the body area.
  - `body` starts with the same subject line or a truncated/expanded version of it: remove that first body line before markdown rendering.
  - Message/body starts as an unordered markdown list (`- item`, `* item`, `+ item`): render the whole content as markdown and do not create a separate plain title.
  - Subject is `Title - item A - item B` and body repeats `- item A\n- item B`: title should be `Title`, body should render the list.
  - Subject contains multiple conventional commit segments such as `fix: A fix: B change: C`, and body repeats the trailing segments line-by-line: title should keep only `fix: A`, body should render the repeated segments.

**Example**:

```ts
type CommitTooltipState = { commit: ProjectGitCommitSummary; x: number; y: number };

const commitTooltip = ref<CommitTooltipState | null>(null);
const pendingCommitTooltip = ref<CommitTooltipState | null>(null);

const showCommitTooltip = (event: MouseEvent, commit: ProjectGitCommitSummary) => {
  pendingCommitTooltip.value = { commit, x: event.clientX, y: event.clientY };
};
```

**Related**: `src/components/project/GitTab.vue`, `src/lib/markdown.ts`, `src/index.css`.

### Convention: Custom Floating Controls in Dense Panels

**What**: In compact project panels, date pickers, model pickers, and similar high-frequency form controls should use custom popovers or menus when the native browser control would be clipped, feel visually inconsistent, or open in the wrong direction inside overflow-constrained containers.

**Why**: Native `select` and `input[type=date]` widgets keep the browser's default popup styling and placement. In dense uTools panels, those popups can appear below the trigger, get clipped by nested overflow containers, or read as unrelated system UI instead of part of the app.

**Implementation Notes**:

- Keep the trigger in the normal form row, but render the popup as a local floating layer with its own surface, border, and shadow.
- Prefer opening upward when the control sits near the bottom of a dense panel.
- Use a compact menu or calendar grid with shared design tokens and a subdued scrollbar for long option lists.
- Keep the selected value in the same source field the rest of the component already uses; the custom popup should only change how the value is chosen.

**Example**:

```vue
<div class="relative min-w-0 flex-1">
  <button type="button" class="ui-field flex w-full items-center justify-between gap-2" @click.stop="isMenuOpen = !isMenuOpen">
    <span>{{ selectedLabel }}</span>
    <ChevronDown :size="14" />
  </button>
  <div v-if="isMenuOpen" class="mode-menu-popover popover-above" @click.stop>
    <button v-for="option in options" :key="option.value" type="button" @click="selectOption(option.value)">
      {{ option.label }}
    </button>
  </div>
</div>
```

**Related**: `src/components/project/GitTab.vue`, `src/components/layout/SettingsTab.vue`, `src/index.css`.

### Convention: Unified Dropdown Styling

**What**: Dropdown-like controls in the app should share the same trigger, menu surface, spacing, and selection states instead of using ad hoc native `select` styling per component.

**Why**: We already learned that a themed trigger alone does not fix the native popup. If each feature uses a different approach, the app quickly ends up with mixed browser pickers, inconsistent focus rings, and dropdowns that open in the wrong direction inside compact panels.

**Implementation Notes**:

- Use a shared trigger style based on `ui-field` for the closed state.
- Prefer a local floating menu with `mode-menu-popover`, `mode-menu-item`, or a close equivalent that follows the same surface tokens and icon treatment.
- Keep option rows compact and highlight the active choice with a semantic token, not a custom one-off palette.
- For menu-like controls inside settings panes or dialogs, make the popup close on outside click and open upward when the trigger sits near the bottom edge of the container.
- If a control needs a long option list, give the popup its own restrained scrollbar so the panel around it does not scroll unexpectedly.

**Example**:

```vue
<div class="relative min-w-0 flex-1">
  <button type="button" class="ui-field flex w-full items-center justify-between gap-2 text-left" @click.stop="open = !open">
    <span>{{ label }}</span>
    <ChevronDown :size="14" />
  </button>
  <div v-if="open" class="mode-menu-popover popover-above" @click.stop>
    <button v-for="option in options" :key="option.value" type="button" :class="cn('mode-menu-item', active === option.value && 'bg-primary/10 text-primary')">
      <span>{{ option.label }}</span>
      <Check v-if="active === option.value" :size="13" />
    </button>
  </div>
</div>
```

**Related**: `src/components/project/GitTab.vue`, `src/components/layout/SettingsTab.vue`, `src/index.css`.

### Convention: Compact AI Analysis Dialogs

**What**: AI generation dialogs in compact project views should keep the body focused on the input controls and the generated result, while moving summary metadata into the header and collapsing optional prompt editors after save.

**Why**: Long empty panels and duplicate status blocks make the dialog feel taller than necessary and distract from the primary action. A compact header summary plus a constrained result pane keeps the interaction readable in small windows.

**Implementation Notes**:

- Put the current filter or scope summary in the dialog header subtitle instead of repeating it in a separate card.
- Hide the custom prompt editor after saving, and reopen it only when the user explicitly edits it again.
- Let the result pane scroll independently with a soft scrollbar, but avoid forcing a second scrollable column for simple setup controls.
- Keep the dialog width comfortable, but let height be driven by content and a capped result panel rather than an oversized fixed shell.

**Example**:

```vue
<div class="flex w-[min(54rem,94vw)] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-2xl">
  <header class="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4 py-3">
    <div>
      <h3 class="text-sm font-bold text-on-surface">AI 生成</h3>
      <p class="truncate text-[10px] font-medium text-on-surface-variant">{{ filterStatusSummary }}</p>
    </div>
  </header>
  <section class="space-y-3 p-3">
    <div class="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)]">...</div>
    <div class="ai-result-panel min-h-40 max-h-[min(20rem,42vh)] overflow-auto">...</div>
  </section>
</div>
```

**Related**: `src/components/project/GitTab.vue`, `src/index.css`.

### Convention: File-Type Icons in Trees

**What**: File trees should map common extensions and special filenames to lightweight `lucide-vue-next` icons instead of relying on plain text labels.

**Why**: Compact file trees become easier to scan without introducing a heavy icon dependency or expanding the row height.

**Example**:

```ts
const fileIcon = computed(() => {
  if (props.node.kind === "directory") return Folder;
  if (["json", "jsonc"].includes(extension)) return FileJson;
  if (["js", "jsx", "ts", "tsx"].includes(extension)) return FileCode;
  return File;
});
```

**Related**: `src/components/project/FileTreeNode.vue`.

## Interaction Safety

- For clickable cards that also contain action buttons, stop event propagation on the action area and on each icon button so card-level navigation does not fire accidentally.
- If an action is meant to stay in the current view, do not let the card root click handler override it.
- Keep action buttons visually and structurally separated from card navigation affordances so users can tell whether they are opening a detail view or running a direct command.
- For nested scroll panels such as runtime logs, provide direct top/bottom controls and avoid forcing auto-scroll while the user is reading history.
- When a nested scroll panel reaches its top or bottom boundary, pass wheel movement to the nearest outer scroll container so users can leave the panel naturally.
- For dense panels with variable-width rows such as Git history or file trees, combine `min-w-0` on flex/grid children with explicit `overflow-x-auto` or a fixed minimum row width so narrow windows do not clip the right edge of the content.
- For floating UI inside clipped/scrolling panels, render the floating layer outside the panel with `Teleport` and keep positioning logic minimal. Over-calculated placement can be worse than a simple above/below rule in compact windows.

### Convention: Tiny Card Layout

**What**: Projects with `cardStyle === "tiny"` render as compact single-row cards in a dedicated top section, separated from regular cards which use a CSS Grid layout.

**Why**: Mixing tiny and regular cards in the same masonry/grid creates uneven column heights and visual chaos. Separating them into distinct sections gives each layout its own rhythm.

**Layout Rules**:

- Tiny cards use a `flex-wrap gap-2` container, not a fixed-column grid. This lets cards pack tightly based on actual content width.
- Each tiny card has `min-w-[8rem] max-w-[14rem]` for uniform but adaptive sizing.
- Regular cards use `grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))]`.
- When both sections exist, add a `border-b border-border-subtle` divider on the tiny section.

**Hover Action Buttons**:

- Tiny card action buttons (terminal, editor, folder, edit, delete) are positioned outside the card border using `absolute top-[calc(100%+0.25rem)] right-0` **inside the card div** (not a sibling wrapper), so `right-0` aligns to the card's right edge.
- The card div needs `after:absolute after:inset-x-0 after:top-full after:h-8` to bridge the gap between the card and the buttons, preventing hover state loss when the mouse moves downward.
- Action buttons have a distinct floating surface: `rounded-md border border-outline-variant/60 bg-surface-container-lowest shadow-md z-30`.
- The run button stays inside the card border, after the project name.

**Example**:

```vue
<!-- Group wrapper (no positioning role) -->
<div class="group relative flex items-center">
  <!-- Card border (relative positioning context) -->
  <div class="relative ... after:absolute after:inset-x-0 after:top-full after:h-8">
    <div class="flex items-center gap-1.5 py-1.5 px-2.5">
      <ProjectIcon ... />
      <h3 class="min-w-0 flex-1 truncate ...">{{ project.name }}</h3>
      <button class="h-6 w-6 ..."><!-- run --></button>
    </div>
    <!-- Action buttons (absolute, right-aligned, below card) -->
    <div class="absolute top-[calc(100%+0.25rem)] right-0 z-30
                opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto
                rounded-md border bg-surface-container-lowest shadow-md ...">
      <!-- terminal, editor, folder, edit, delete -->
    </div>
    <!-- Status accent bar -->
    <div class="absolute -left-px -top-px -bottom-px w-[5px] ..." />
  </div>
</div>
```

**Related**: `src/components/dashboard/ProjectCard.vue`, `src/components/dashboard/Dashboard.vue`.

---

## Common Mistakes

- Putting shared project state in multiple components instead of the store
- Introducing an extra abstraction for a one-off panel
- Using raw SVGs when the same icon already exists in `lucide-vue-next`
- Adding local CSS files for patterns already covered by Tailwind and theme tokens
- Leaving icon-only actions without an accessible name
- Letting nested action buttons bubble to the card root and trigger unintended navigation
- Forgetting `min-w-0` on nested panel children, which causes wide rows to truncate or hide the rightmost content on smaller screens
- Coloring normal startup/readiness output as error red just because it arrived on stderr; reserve error tones for true failures and use semantic content to classify logs
- Positioning hover-revealed action buttons as siblings outside the card div without a hover bridge — the mouse loses hover state crossing the gap and buttons become unclickable. Always add `after:absolute after:inset-x-0 after:top-full after:h-*` on the positioning parent to bridge the gap

### 布局与间距

- **侧边栏 (Sidebar)**: 固定宽度为 `64px`，采用极简图标设计，不显示文字标签。
- **页面间距**: 容器内边距建议使用 `p-6` 或 `p-8`，视窗口大小而定。
- **紧凑性**: 优先考虑 uTools 插件的紧凑布局，减少不必要的页眉和冗余文字。

### 主题支持 (Theme)

- **切换逻辑**: 使用 `App.vue` 中的全局监听器管理主题。支持 `light`、`dark` 和 `auto`。
- **Auto 模式**: 优先调用 `window.utools.isDarkColors()`，若环境不可用则回退至 `prefers-color-scheme` 媒体查询。
- **变量命名**: 深色模式下的样式应通过 `.dark` 类名覆盖 CSS 变量实现。

### 常用交互

- **返回操作**: 在详情页头部左侧放置 `ArrowLeft` 图标按钮。
- **搜索与刷新**: 整合进业务页面的头部，而不是放在全局顶栏。
