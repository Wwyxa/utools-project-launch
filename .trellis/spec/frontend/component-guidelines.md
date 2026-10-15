# Component Guidelines

## Composition and Styling

Use `<script setup lang="ts">`, typed props/emits, Tailwind utilities,
`lucide-vue-next`, and `cn` where conditional classes benefit. Shared colors,
surfaces, status styling, syntax highlighting, and skeletons live in
`src/index.css`. Keep theme differences tied to the app's root `.dark` class.

Reuse existing file-icon resolution, shared markdown rendering, and
`AiReasoningResult.vue`; do not recreate extension maps or reasoning parsers in
each feature. The current file-icon implementation is `src/lib/fileIconTheme.ts`.

## Navigation and Floating UI

- `App.vue` owns page-level Escape/back behavior. Local dialogs and menus use
  `src/lib/escape.ts`, handle nested surfaces first, and mark an Escape request
  handled only when they consume it.
- Detail tabs retain roving focus and page-scoped keyboard navigation. Ignore
  editable targets, dialogs, modified events, and resizable separators; clean up
  listeners on unmount.
- Use the shared `ActionDialog.vue` for simple confirmations. Keep creation/edit
  forms in their feature. Stop nested action propagation on clickable cards.
- Teleport clipped overlays to `body`. Measure and clamp floating geometry after
  render and content changes; close it on context replacement, owner collapse,
  outside interaction, or unmount. Internal menu scrolling must not close the owner.
- Custom pickers reuse existing trigger/menu styles when native controls cannot
  meet placement or styling needs. This is a UI choice, not a uTools API ban.
- Components with a visible root plus Teleport siblings explicitly forward
  fallthrough attributes to the visible root when needed.

## Resizable and Scrollable Panels

Reuse `useResizableSplit` for split interactions, bounds, keyboard adjustment,
session memory, and cleanup. Preserve a constrained flex height chain and
`min-w-0`/`min-h-0` where children shrink. Measured first panes leave a
`minmax(0, 1fr)` remainder; start dragging from the rendered pane size.

Keep scrollbars on the actual scrolling region. A fixed popup shell must keep
its positioning; put overlay-scrollbar behavior on its inner scroller. Validate
compact layouts with short/long content and loaded/empty/loading states.
Scrollable dialog bodies and floating-menu content use `v-overlay-scrollbar`
with the shared theme; `themed-scrollbar` alone does not initialize the component.
For fixed menus and date pickers, keep positioning and measurement refs on the
outer shell and constrain an inner scroller with `min-h-0` in a flex column.

## Git Surface Ownership

- `GitTab.vue` coordinates repository context, splits, cross-region selection,
  drafts, and feedback. `GitChangesPane.vue`, `GitCommitHistory.vue`, and
  `GitAiAnalysisDialog.vue` own their complete local interaction lifecycles.
  Pinia remains the owner of snapshots, writes, and concurrency.
- History graph layout is computed from all filtered loaded commits; virtualize
  only presentation. Rows, inline-file blocks, and shared SVG paths use one
  coordinate model. Anchor scroll position when expanded blocks change height.
- Use full commit/parent ids, structured ref presentation, and kind-qualified
  color identity. Shared graph/ref helpers own topology and badge derivation;
  components do not reconstruct them from display strings.
- Keep only the visible tooltip details reactive. Use bounded repository/hash
  caches, preloaded short stats, and optional avatars; failed avatar loading
  falls back to initials. Prefetch must not trigger file-detail reads or expose
  author email. Close floating state before virtual rows disappear.
- Ordinary row clicks expand files; Ctrl/Cmd clicks select for analysis. Menus
  use structured ref capabilities, hierarchical keyboard handling, viewport
  clamping, and connected-opener focus restoration.
- Diff views preserve original text and derive inline ranges from the complete
  changed block. Hunk navigation owns the active block even when scrolling does
  not move; scrolling alone must not overwrite that navigation state.
- Diff syntax highlighting runs on each hunk's old/new sequences independently;
  split highlighted HTML into balanced lines, preserving the correct side's
  syntax state on context rows. Keep signs and whitespace decorations outside
  copied source text; pure insert/delete blocks need only line shading.
- Wrapped side-by-side rows share the maximum measured code height. Measure
  intrinsic code spans, excluding empty stretched counterparts, so rows can
  shrink after resizing. Disconnect observers and cancel animation frames on
  teardown. Mode changes preserve the visible source-row anchor.
- `\ No newline at end of file` annotations retain their side and do not split
  replacement blocks. Keep regression coverage in `tests/gitDiff.test.ts` and
  `tests/GitDiffViewer.test.ts` for syntax state, source preservation, annotation
  pairing, keyboard navigation, wrapping, and scroll synchronization.

Sources: `src/lib/gitCommitGraph.ts`, `src/lib/gitCommitRefs.ts`,
`src/lib/gitCommitTooltipSession.ts`, `src/lib/gitDiff.ts`, and their `tests/`
counterparts. Keep exact geometry, timings, and regression fixtures there.
