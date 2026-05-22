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

**What**: `src/App.vue` owns a capture-phase `keydown` listener that closes the project form first, then dismisses delete confirmation, then returns from project details, then returns from settings.

**Why**: Escape should feel like a consistent exit path without overriding typing inside inputs, textareas, selects, or contenteditable regions.

**Example**:

```ts
const isTextEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
```

**Related**: `src/App.vue`.

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

### Convention: Semantic Status Surfaces

**What**: When a component represents running, success, warning, error, or info state, use the shared semantic tokens from `src/index.css` instead of inventing a local palette.

**Why**: Dashboard cards, project overview badges, Git metadata, and terminal logs feel inconsistent when each surface picks its own shade of green or red.

**Example**:

```vue
<span class="border border-status-running/30 bg-status-running/10 text-status-running">
  Running
</span>
```

**Related**: `src/index.css`, `src/components/dashboard/ProjectCard.vue`, `src/components/project/ProjectDetails.vue`, `src/components/terminal/Terminal.vue`.

### Convention: Collapsible Dense Panels

**What**: Dense data-heavy panels may use a small local collapse toggle to reclaim vertical space in narrow windows, but they should still render an explicit empty state when there is no data.

**Why**: Git change lists and similar sections can crowd the rest of a tab, especially in compact uTools windows.

**Example**:

```ts
const filesPanelOpen = ref(true);
```

**Related**: `src/components/project/GitTab.vue`.

### Convention: Compact Git History Rows

**What**: Git history rows should keep hash, message, refs, author, and relative time readable while fitting into a compact fixed-height row.

**Why**: Moving author/time below the commit message improves scanability, but if the row height stays too large the graph feels stretched and wastes vertical space.

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

### Convention: Markdown Commit Tooltips

**What**: Git commit rows may show a delayed markdown tooltip for the full commit body, while the row itself stays compact and displays only the subject line.

**Why**: Commit bodies often contain markdown lists. Native `title` tooltips flatten formatting and cannot render list structure, but immediate custom tooltips feel noisy when scanning a dense history list.

**Implementation Rules**:

- Render rich commit tooltips with a `Teleport` to `body` so nested Git panel `overflow` rules do not clip the floating layer.
- Use a short hover delay before showing the tooltip. Current Git history uses about `450ms`.
- Keep row text compact; use the full commit `body` only for the tooltip.
- Positioning should stay simple: default above the cursor/row, fall below only when there is not enough top space. Avoid complex left/right flipping that can make the tooltip appear far from the hovered commit.
- When placing above, prefer CSS transform based on the tooltip's real height, such as `transform: translateY(-100%)`, instead of subtracting an estimated height from `top`.
- Clear pending timers and visible tooltip state on mouse leave and component unmount.

**Example**:

```ts
const commitTooltip = ref<{ content: string; x: number; y: number } | null>(null);
const pendingCommitTooltip = ref<{ content: string; x: number; y: number } | null>(null);

const commitTooltipContent = (commit: { message: string; body?: string }) => commit.body || commit.message;
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
