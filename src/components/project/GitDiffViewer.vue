<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  FileText,
  Maximize2,
  Minimize2,
  Pilcrow,
  Rows2,
  Space,
  WrapText,
} from "lucide-vue-next";
import {
  findGitDiffBlockInlineRanges,
  findGitDiffChangeBlocks,
  highlightGitDiffRows,
  markGitDiffInlineRanges,
  markGitDiffWhitespace,
  parseGitDiff,
  toGitDiffSideBySideRows,
  type GitDiffInlineRange,
  type GitDiffRow,
  type GitDiffSideBySideRow,
} from "../../lib/gitDiff";
import { languageForFilePath } from "../../lib/markdown";
import { cn } from "../../lib/utils";

type GitDiffViewMode = "unified" | "side-by-side";
type InlineRowHighlight = { kind: "addition" | "deletion"; ranges: GitDiffInlineRange[] };

const props = withDefaults(
  defineProps<{
    diff?: string;
    path?: string;
    branch?: string;
    subtitle?: string;
    loading?: boolean;
    message?: string;
    scrollTop?: number;
    fullFile?: boolean;
    ignoreWhitespace?: boolean;
    expanded?: boolean;
  }>(),
  {
    diff: "",
    path: "",
    branch: "",
    subtitle: "",
    loading: false,
    message: "",
    scrollTop: 0,
    fullFile: false,
    ignoreWhitespace: false,
    expanded: false,
  },
);

const emit = defineEmits<{
  (event: "update:scrollTop", value: number): void;
  (event: "update:fullFile", value: boolean): void;
  (event: "update:ignoreWhitespace", value: boolean): void;
  (event: "toggle-expanded"): void;
}>();

const unifiedScrollRef = ref<HTMLDivElement | null>(null);
const oldScrollRef = ref<HTMLDivElement | null>(null);
const newScrollRef = ref<HTMLDivElement | null>(null);
const wrapsLongLines = ref(false);
const showsWhitespace = ref(false);
const diffViewMode = ref<GitDiffViewMode>("unified");
const activeHunkIndex = ref(0);
const sideRowHeights = ref(new Map<string, number>());
let rowResizeObserver: ResizeObserver | undefined;
let rowMeasureFrame = 0;
let scrollSyncFrame = 0;
let scrollSyncSource: "old" | "new" | undefined;
const parsedDiff = computed(() => parseGitDiff(props.diff));
const sideBySideRows = computed(() => toGitDiffSideBySideRows(parsedDiff.value.rows));
const changeBlocks = computed(() => findGitDiffChangeBlocks(parsedDiff.value.rows));
const changeBlockIdByRowId = computed(() => {
  const ids = new Map<string, string>();
  changeBlocks.value.forEach((block) => {
    for (let rowIndex = block.startRowIndex; rowIndex <= block.endRowIndex; rowIndex += 1) {
      const row = parsedDiff.value.rows[rowIndex];
      if (row) ids.set(row.id, block.id);
    }
  });
  return ids;
});
const changeBlocksById = computed(() => new Map(changeBlocks.value.map((block) => [block.id, block])));
const changeBlockStartIdByRowId = computed(() => {
  const ids = new Map<string, string>();
  changeBlocks.value.forEach((block) => {
    const row = parsedDiff.value.rows[block.startRowIndex];
    if (row) ids.set(row.id, block.id);
  });
  return ids;
});
const diffLanguage = computed(() => languageForFilePath(props.path));
const highlightedCodeByRowId = computed(() => highlightGitDiffRows(parsedDiff.value.rows, diffLanguage.value));
const oldHighlightedCodeByRowId = computed(() =>
  highlightGitDiffRows(parsedDiff.value.rows, diffLanguage.value, "old"),
);
const diffStats = computed(() => ({
  additions: parsedDiff.value.rows.filter((row) => row.kind === "addition").length,
  deletions: parsedDiff.value.rows.filter((row) => row.kind === "deletion").length,
}));
const lineNumberWidth = computed(() => {
  const maxLineNumber = parsedDiff.value.rows.reduce(
    (maximum, row) => Math.max(maximum, row.oldLineNumber || 0, row.newLineNumber || 0),
    0,
  );
  return `calc(${Math.max(4, String(maxLineNumber).length)}ch + 1rem)`;
});
const inlineHighlightsByRowId = computed(() => {
  const highlights = new Map<string, InlineRowHighlight>();
  changeBlocks.value.forEach((block) => {
    const changedRows = parsedDiff.value.rows.slice(block.startRowIndex, block.endRowIndex + 1);
    const oldRows = changedRows.filter((row) => row.kind === "deletion");
    const newRows = changedRows.filter((row) => row.kind === "addition");
    if (!oldRows.length || !newRows.length) return;
    const rangesByRowId = findGitDiffBlockInlineRanges(oldRows, newRows);
    if (!rangesByRowId) return;

    oldRows.forEach((row) => {
      const ranges = rangesByRowId.get(row.id);
      if (ranges?.length) highlights.set(row.id, { kind: "deletion", ranges });
    });
    newRows.forEach((row) => {
      const ranges = rangesByRowId.get(row.id);
      if (ranges?.length) highlights.set(row.id, { kind: "addition", ranges });
    });
  });
  return highlights;
});
const isBinaryDiff = computed(() => /^(?:Binary files .* differ|GIT binary patch)$/m.test(props.diff));
const hunkProgress = computed(() =>
  changeBlocks.value.length ? `${activeHunkIndex.value + 1}/${changeBlocks.value.length}` : "0/0",
);
const activeChangeBlockId = computed(() => changeBlocks.value[activeHunkIndex.value]?.id);

const rowPrefix = (row: GitDiffRow) => {
  if (row.kind === "addition") return "+";
  if (row.kind === "deletion") return "-";
  if (row.kind === "context") return " ";
  return "";
};

const renderedCode = (row: GitDiffRow | null, side: "old" | "new" = "new") => {
  if (!row) return " ";
  const inlineHighlight = inlineHighlightsByRowId.value.get(row.id);
  const highlighted = (side === "old" ? oldHighlightedCodeByRowId : highlightedCodeByRowId).value.get(row.id) || "";
  const code = inlineHighlight
    ? markGitDiffInlineRanges(highlighted, inlineHighlight.ranges, inlineHighlight.kind)
    : highlighted;
  return (showsWhitespace.value ? markGitDiffWhitespace(code) : code) || " ";
};

const sideLineNumber = (row: GitDiffRow | null, side: "old" | "new") =>
  side === "old" ? row?.oldLineNumber : row?.newLineNumber;
const sideLineNumberLabel = (row: GitDiffRow | null, side: "old" | "new") => {
  const lineNumber = sideLineNumber(row, side);
  if (lineNumber == null) return side === "old" ? "原文件无对应行号" : "新文件无对应行号";
  return `${side === "old" ? "原文件" : "新文件"}第 ${lineNumber} 行`;
};

const rowClass = (row: GitDiffRow) =>
  cn(
    "diff-code-row diff-unified-row grid font-mono text-xs leading-5",
    row.kind === "addition" && "bg-[var(--syntax-addition-bg)]",
    row.kind === "deletion" && "bg-[var(--syntax-deletion-bg)]",
    row.kind === "hunk" && "bg-primary/10 text-primary",
    row.kind === "meta" && "bg-[var(--code-preview-gutter-bg)] text-on-surface-variant",
    row.kind === "context" && "text-on-surface",
  );

const sidePaneRowClass = (row: GitDiffSideBySideRow) =>
  cn(
    "diff-code-row diff-side-row grid min-h-5 font-mono text-xs leading-5",
    row.kind === "hunk" && "bg-primary/10 text-primary",
    row.kind === "meta" && "bg-[var(--code-preview-gutter-bg)] text-on-surface-variant",
    row.kind === "context" && "text-on-surface",
  );

const activeHunkRowClass = (
  changeBlockId: string | undefined,
  previousChangeBlockId: string | undefined,
  nextChangeBlockId: string | undefined,
) => {
  const isActive = Boolean(changeBlockId) && changeBlockId === activeChangeBlockId.value;
  return cn(
    isActive && "diff-active-hunk",
    isActive && previousChangeBlockId !== changeBlockId && "diff-active-hunk-start",
    isActive && nextChangeBlockId !== changeBlockId && "diff-active-hunk-end",
  );
};

const changeBlockId = (row?: GitDiffRow | null) => (row ? changeBlockIdByRowId.value.get(row.id) : undefined);
const sideChangeBlockId = (row?: GitDiffSideBySideRow) => changeBlockId(row?.oldRow) ?? changeBlockId(row?.newRow);
const sideChangeBlockStartId = (row?: GitDiffSideBySideRow) => {
  const blockId = sideChangeBlockId(row);
  const block = blockId ? changeBlocksById.value.get(blockId) : undefined;
  const startRowId = block ? parsedDiff.value.rows[block.startRowIndex]?.id : undefined;
  return startRowId && (row?.oldRow?.id === startRowId || row?.newRow?.id === startRowId) ? blockId : undefined;
};

const sideLineNumberClass = (row: GitDiffRow | null) =>
  cn(
    "diff-line-number sticky left-0 z-10 flex select-none items-start justify-end gap-1 bg-[var(--code-preview-gutter-bg)] pl-2 text-right tabular-nums",
    "border-r",
    "border-[var(--code-preview-border)]",
    row?.kind === "deletion" && "text-[var(--syntax-deletion-fg)]",
    row?.kind === "addition" && "text-[var(--syntax-addition-fg)]",
    row?.kind === "context" && "diff-line-number-context",
    !row && "diff-empty-cell text-transparent",
  );

const sideContentClass = (row: GitDiffRow | null) =>
  cn(
    "min-w-0 self-start px-3",
    row?.kind === "context" && "text-on-surface",
    !row && "self-stretch",
    wrapsLongLines.value ? "whitespace-pre-wrap break-all" : "whitespace-pre",
  );

const measureSideRows = () => {
  cancelAnimationFrame(rowMeasureFrame);
  rowMeasureFrame = requestAnimationFrame(() => {
    const heights = new Map<string, number>();
    [oldScrollRef.value, newScrollRef.value].forEach((pane) => {
      pane?.querySelectorAll<HTMLElement>("[data-diff-measure]").forEach((element) => {
        const id = element.dataset.diffMeasure!;
        heights.set(id, Math.max(heights.get(id) || 20, Math.ceil(element.getBoundingClientRect().height)));
      });
    });
    if (
      heights.size !== sideRowHeights.value.size ||
      [...heights].some(([id, height]) => sideRowHeights.value.get(id) !== height)
    ) {
      sideRowHeights.value = heights;
    }
  });
};

const sideRowStyle = (row: GitDiffSideBySideRow) => ({ minHeight: `${sideRowHeights.value.get(row.id) || 20}px` });

const reviewScrollElement = () => (diffViewMode.value === "unified" ? unifiedScrollRef.value : oldScrollRef.value);

const setReviewScrollTop = (scrollTop: number, behavior?: ScrollBehavior) => {
  const scrollOptions: ScrollToOptions = { top: scrollTop };
  if (behavior) scrollOptions.behavior = behavior;
  const scrollElements =
    diffViewMode.value === "unified" ? [unifiedScrollRef.value] : [oldScrollRef.value, newScrollRef.value];
  scrollElements.forEach((scrollElement) => {
    if (scrollElement && Math.abs(scrollElement.scrollTop - scrollTop) > 1) scrollElement.scrollTo(scrollOptions);
  });
};

const navigateHunk = async (direction: -1 | 1) => {
  const currentIndex = Math.min(Math.max(activeHunkIndex.value, 0), changeBlocks.value.length - 1);
  const targetIndex = (currentIndex + direction + changeBlocks.value.length) % changeBlocks.value.length;
  const targetBlock = changeBlocks.value[targetIndex];
  if (!targetBlock) return;

  activeHunkIndex.value = targetIndex;
  await nextTick();

  const scrollElement = reviewScrollElement();
  if (!scrollElement) return;
  const target = Array.from(scrollElement.querySelectorAll<HTMLElement>("[data-diff-change-block]")).find(
    (element) => element.dataset.diffChangeBlock === targetBlock.id,
  );
  if (!target) return;

  const targetOffset = target.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top;
  const targetScrollTop = Math.max(
    0,
    scrollElement.scrollTop + targetOffset - (scrollElement.clientHeight - target.offsetHeight) / 2,
  );
  setReviewScrollTop(targetScrollTop);
};

const handleUnifiedScroll = () => {
  if (unifiedScrollRef.value) {
    emit("update:scrollTop", unifiedScrollRef.value.scrollTop);
  }
};

const handleSideScroll = (side: "old" | "new") => {
  const source = side === "old" ? oldScrollRef.value : newScrollRef.value;
  const target = side === "old" ? newScrollRef.value : oldScrollRef.value;
  if (!source) return;
  if (scrollSyncSource && scrollSyncSource !== side) return;
  scrollSyncSource = side;
  cancelAnimationFrame(scrollSyncFrame);
  scrollSyncFrame = requestAnimationFrame(() => {
    scrollSyncSource = undefined;
  });
  if (target) {
    if (Math.abs(target.scrollTop - source.scrollTop) > 1) target.scrollTop = source.scrollTop;
    if (Math.abs(target.scrollLeft - source.scrollLeft) > 1) target.scrollLeft = source.scrollLeft;
  }
  emit("update:scrollTop", source.scrollTop);
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.defaultPrevented || props.loading || !changeBlocks.value.length) return;
  if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']"))
    return;
  if (event.ctrlKey || event.metaKey) return;
  if ((event.key === "F7" && !event.altKey) || (event.key === "F5" && event.altKey)) {
    event.preventDefault();
    event.stopPropagation();
    void navigateHunk(event.shiftKey ? -1 : 1);
  }
};

const toggleDiffViewMode = () => {
  const source = reviewScrollElement();
  const scrollTop = source?.scrollTop ?? props.scrollTop;
  const viewportTop = source?.getBoundingClientRect().top ?? 0;
  const anchor =
    source &&
    Array.from(source.querySelectorAll<HTMLElement>("[data-diff-row-id]")).find(
      (element) => element.getBoundingClientRect().bottom > viewportTop,
    );
  const anchorId = anchor?.dataset.diffRowId;
  const anchorOffset = anchor ? anchor.getBoundingClientRect().top - viewportTop : 0;
  diffViewMode.value = diffViewMode.value === "unified" ? "side-by-side" : "unified";
  void nextTick(() => {
    const target = reviewScrollElement();
    const targetRow =
      anchorId &&
      target?.querySelector<HTMLElement>(`[data-diff-row-id="${anchorId}"], [data-diff-new-row-id="${anchorId}"]`);
    const targetTop =
      target && targetRow
        ? Math.max(
            0,
            target.scrollTop +
              targetRow.getBoundingClientRect().top -
              target.getBoundingClientRect().top -
              anchorOffset,
          )
        : scrollTop;
    setReviewScrollTop(targetTop);
    emit("update:scrollTop", targetTop);
  });
};

const toggleFullFile = () => {
  if (!props.loading) emit("update:fullFile", !props.fullFile);
};

const toggleIgnoreWhitespace = () => {
  if (!props.loading) emit("update:ignoreWhitespace", !props.ignoreWhitespace);
};

watch(
  () => props.scrollTop,
  async (scrollTop) => {
    await nextTick();
    setReviewScrollTop(scrollTop);
  },
  { immediate: true },
);

watch([() => props.diff, () => props.loading], async () => {
  activeHunkIndex.value = 0;
  await nextTick();
  setReviewScrollTop(props.scrollTop);
});

watch(
  [sideBySideRows, diffViewMode, wrapsLongLines, showsWhitespace, () => props.loading],
  async () => {
    rowResizeObserver?.disconnect();
    cancelAnimationFrame(rowMeasureFrame);
    await nextTick();
    if (
      diffViewMode.value !== "side-by-side" ||
      !wrapsLongLines.value ||
      props.loading ||
      !oldScrollRef.value ||
      !newScrollRef.value
    ) {
      sideRowHeights.value = new Map();
      return;
    }
    rowResizeObserver ??= new ResizeObserver(measureSideRows);
    [oldScrollRef.value, newScrollRef.value].forEach((pane) => {
      pane
        ?.querySelectorAll<HTMLElement>("[data-diff-measure]")
        .forEach((element) => rowResizeObserver?.observe(element));
    });
    measureSideRows();
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  rowResizeObserver?.disconnect();
  cancelAnimationFrame(rowMeasureFrame);
  cancelAnimationFrame(scrollSyncFrame);
});
</script>

<template>
  <div
    class="git-diff-viewer relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--code-preview-bg)]"
    :style="{ '--diff-line-width': lineNumberWidth }"
    role="region"
    aria-label="Git diff"
    tabindex="0"
    @keydown="handleKeydown"
  >
    <div
      class="flex min-h-10 shrink-0 min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-[var(--code-preview-border)] bg-surface-container-low px-2.5 py-1"
    >
      <div class="min-w-20 flex-1 leading-tight">
        <div class="truncate font-mono text-[10px] font-bold text-on-surface" :title="path || 'Git diff'">
          {{ path || "Git diff" }}
        </div>
        <div v-if="branch || subtitle" class="flex min-w-0 items-center gap-1 text-[9px] text-on-surface-variant">
          <span v-if="branch" class="min-w-0 flex-1 truncate font-mono" :title="branch">{{ branch }}</span>
          <span v-if="branch && subtitle" aria-hidden="true">·</span>
          <span v-if="subtitle" class="min-w-0 truncate" :title="subtitle">{{ subtitle }}</span>
        </div>
      </div>
      <div
        class="ml-auto flex max-w-full shrink-0 flex-wrap items-center gap-0.5"
        role="toolbar"
        aria-label="Diff 工具栏"
      >
        <span
          v-if="!loading && changeBlocks.length"
          class="mr-1 whitespace-nowrap font-mono text-[10px] tabular-nums"
          :aria-label="`新增 ${diffStats.additions} 行，删除 ${diffStats.deletions} 行`"
        >
          <span class="text-[var(--syntax-addition-fg)]">+{{ diffStats.additions }}</span>
          <span class="ml-1 text-[var(--syntax-deletion-fg)]">-{{ diffStats.deletions }}</span>
        </span>
        <span
          class="min-w-9 select-none px-1 text-center font-mono text-[10px] font-semibold tabular-nums text-on-surface-variant"
          :title="`${changeBlocks.length} 个变更块`"
        >
          {{ hunkProgress }}
        </span>
        <button
          type="button"
          class="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
          title="上一个变更 (Shift+F7)"
          aria-label="上一个变更"
          :disabled="loading || !changeBlocks.length"
          @click="navigateHunk(-1)"
        >
          <ChevronUp :size="14" />
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
          title="下一个变更 (F7)"
          aria-label="下一个变更"
          :disabled="loading || !changeBlocks.length"
          @click="navigateHunk(1)"
        >
          <ChevronDown :size="14" />
        </button>
        <span class="mx-1 h-4 w-px bg-border-subtle" aria-hidden="true" />
        <button
          type="button"
          :class="cn('ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm', wrapsLongLines && 'bg-primary/10 text-primary')"
          :title="wrapsLongLines ? '关闭长行换行' : '开启长行换行'"
          :aria-label="wrapsLongLines ? '关闭长行换行' : '开启长行换行'"
          :aria-pressed="wrapsLongLines"
          :disabled="loading"
          @click="wrapsLongLines = !wrapsLongLines"
        >
          <WrapText :size="14" />
        </button>
        <button
          type="button"
          :class="cn('ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm', showsWhitespace && 'bg-primary/10 text-primary')"
          :title="showsWhitespace ? '隐藏空白字符' : '显示空白字符'"
          :aria-label="showsWhitespace ? '隐藏空白字符' : '显示空白字符'"
          :aria-pressed="showsWhitespace"
          :disabled="loading"
          @click="showsWhitespace = !showsWhitespace"
        >
          <Space :size="14" />
        </button>
        <span class="mx-1 h-4 w-px bg-border-subtle" aria-hidden="true" />
        <button
          type="button"
          :class="cn('ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm', fullFile && 'bg-primary/10 text-primary')"
          :title="fullFile ? '显示变更附近内容' : '显示完整文件'"
          :aria-label="fullFile ? '显示变更附近内容' : '显示完整文件'"
          :aria-pressed="fullFile"
          :disabled="loading"
          @click="toggleFullFile"
        >
          <FileText :size="14" />
        </button>
        <button
          type="button"
          :class="cn('ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm', ignoreWhitespace && 'bg-primary/10 text-primary')"
          :title="ignoreWhitespace ? '显示空白量和空白行变更' : '忽略空白量和空白行变更'"
          :aria-label="ignoreWhitespace ? '显示空白量和空白行变更' : '忽略空白量和空白行变更'"
          :aria-pressed="ignoreWhitespace"
          :disabled="loading"
          @click="toggleIgnoreWhitespace"
        >
          <Pilcrow :size="14" />
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
          :title="diffViewMode === 'unified' ? '切换到双栏对比' : '切换到单栏对比'"
          :aria-label="diffViewMode === 'unified' ? '切换到双栏对比' : '切换到单栏对比'"
          :aria-pressed="diffViewMode === 'side-by-side'"
          :disabled="loading"
          @click="toggleDiffViewMode"
        >
          <component :is="diffViewMode === 'unified' ? Columns2 : Rows2" :size="14" />
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
          :title="expanded ? '还原内嵌审阅' : '放大查看'"
          :aria-label="expanded ? '还原内嵌审阅' : '放大查看'"
          @click="emit('toggle-expanded')"
        >
          <Minimize2 v-if="expanded" :size="14" />
          <Maximize2 v-else :size="14" />
        </button>
      </div>
    </div>

    <div
      v-if="diffViewMode === 'side-by-side' && !loading && parsedDiff.rows.length && !isBinaryDiff"
      class="grid shrink-0 grid-cols-2 border-b border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)] text-[10px] text-on-surface-variant"
    >
      <div class="border-r border-[var(--code-preview-border)] px-3 py-1">
        原文件 <span class="ml-1 font-mono text-[var(--syntax-deletion-fg)]">-{{ diffStats.deletions }}</span>
      </div>
      <div class="px-3 py-1">
        新文件 <span class="ml-1 font-mono text-[var(--syntax-addition-fg)]">+{{ diffStats.additions }}</span>
      </div>
    </div>

    <div
      ref="unifiedScrollRef"
      :class="
        diffViewMode === 'unified'
          ? 'themed-scrollbar min-h-0 flex-1 overflow-auto'
          : 'flex min-h-0 flex-1 overflow-hidden'
      "
      @scroll="handleUnifiedScroll"
    >
      <div v-if="loading" class="space-y-1.5 py-3" aria-busy="true">
        <div v-for="row in 10" :key="row" class="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center">
          <span class="skeleton ml-auto mr-2 h-3 w-6" />
          <span :class="cn('skeleton mr-2 h-3', row % 3 === 0 ? 'w-3/4' : row % 3 === 1 ? 'w-5/6' : 'w-2/3')" />
        </div>
      </div>
      <div v-else-if="isBinaryDiff" class="p-5 text-sm text-on-surface-variant">
        该文件包含二进制变更，无法进行逐行预览。
      </div>
      <div
        v-else-if="parsedDiff.rows.length"
        :class="
          diffViewMode === 'side-by-side' ? 'flex min-h-0 min-w-0 flex-1' : wrapsLongLines ? 'min-w-0' : 'min-w-max'
        "
      >
        <template v-if="diffViewMode === 'unified'">
          <div
            v-for="(row, index) in parsedDiff.rows"
            :key="row.id"
            :data-diff-change-block="changeBlockStartIdByRowId.get(row.id)"
            :data-diff-row-id="row.id"
            :class="
              cn(
                rowClass(row),
                activeHunkRowClass(
                  changeBlockId(row),
                  changeBlockId(parsedDiff.rows[index - 1]),
                  changeBlockId(parsedDiff.rows[index + 1]),
                ),
              )
            "
          >
            <template v-if="row.kind === 'hunk' || row.kind === 'meta'">
              <span
                class="sticky left-0 z-10 col-span-2 border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)]"
              />
              <span :class="cn('px-3', wrapsLongLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')">
                {{ row.content || " " }}
              </span>
            </template>
            <template v-else>
              <span
                :class="
                  cn(
                    'diff-line-number sticky left-0 z-10 select-none border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)] px-2 text-right tabular-nums',
                    row.kind === 'deletion' && 'text-[var(--syntax-deletion-fg)]',
                    row.kind === 'addition' && 'text-[var(--syntax-addition-fg)]',
                    row.kind === 'context' && 'diff-line-number-context',
                  )
                "
                :title="sideLineNumberLabel(row, row.newLineNumber != null ? 'new' : 'old')"
                :aria-label="sideLineNumberLabel(row, row.newLineNumber != null ? 'new' : 'old')"
              >
                {{ row.newLineNumber ?? row.oldLineNumber ?? "" }}
              </span>
              <span
                :class="
                  cn(
                    'diff-change-sign sticky z-10 select-none text-center',
                    row.kind === 'addition' && 'diff-change-sign-addition',
                    row.kind === 'deletion' && 'diff-change-sign-deletion',
                  )
                "
                aria-hidden="true"
                >{{ rowPrefix(row) }}</span
              >
              <span
                :class="cn('min-w-0 px-3', wrapsLongLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')"
                v-html="renderedCode(row)"
              />
            </template>
          </div>
        </template>
        <div v-else class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            ref="oldScrollRef"
            class="themed-scrollbar min-h-0 min-w-0 flex-1 overflow-auto border-r border-[var(--code-preview-border)]"
            aria-label="旧版代码"
            @scroll="handleSideScroll('old')"
          >
            <div :class="wrapsLongLines ? 'min-w-0' : 'min-w-max'">
              <div
                v-for="(row, index) in sideBySideRows"
                :key="row.id"
                :data-diff-change-block="sideChangeBlockStartId(row)"
                :data-diff-row-id="row.oldRow?.id || row.newRow?.id"
                :data-diff-new-row-id="row.newRow?.id"
                :style="sideRowStyle(row)"
                :class="
                  cn(
                    sidePaneRowClass(row),
                    row.oldRow?.kind === 'deletion' && 'bg-[var(--syntax-deletion-bg)]',
                    !row.oldRow && 'diff-empty-cell',
                    activeHunkRowClass(
                      sideChangeBlockId(row),
                      sideChangeBlockId(sideBySideRows[index - 1]),
                      sideChangeBlockId(sideBySideRows[index + 1]),
                    ),
                  )
                "
              >
                <template v-if="row.kind === 'hunk' || row.kind === 'meta'">
                  <span
                    class="sticky left-0 z-10 border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)]"
                  />
                  <span
                    :data-diff-measure="row.id"
                    :class="
                      cn('min-w-0 self-start px-3', wrapsLongLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')
                    "
                    >{{ row.oldRow?.content || " " }}</span
                  >
                </template>
                <template v-else>
                  <span
                    :class="sideLineNumberClass(row.oldRow)"
                    :title="sideLineNumberLabel(row.oldRow, 'old')"
                    :aria-label="sideLineNumberLabel(row.oldRow, 'old')"
                  >
                    {{ sideLineNumber(row.oldRow, "old") ?? "" }}
                    <span class="w-4 shrink-0 text-center" aria-hidden="true">{{
                      row.oldRow ? rowPrefix(row.oldRow) : ""
                    }}</span>
                  </span>
                  <span
                    :data-diff-measure="row.oldRow ? row.id : undefined"
                    :class="sideContentClass(row.oldRow)"
                    v-html="renderedCode(row.oldRow, 'old')"
                  />
                </template>
              </div>
            </div>
          </div>
          <div
            ref="newScrollRef"
            class="themed-scrollbar min-h-0 min-w-0 flex-1 overflow-auto"
            aria-label="新版代码"
            @scroll="handleSideScroll('new')"
          >
            <div :class="wrapsLongLines ? 'min-w-0' : 'min-w-max'">
              <div
                v-for="(row, index) in sideBySideRows"
                :key="row.id"
                :data-diff-change-block="sideChangeBlockStartId(row)"
                :data-diff-row-id="row.oldRow?.id || row.newRow?.id"
                :data-diff-new-row-id="row.newRow?.id"
                :style="sideRowStyle(row)"
                :class="
                  cn(
                    sidePaneRowClass(row),
                    row.newRow?.kind === 'addition' && 'bg-[var(--syntax-addition-bg)]',
                    !row.newRow && 'diff-empty-cell',
                    activeHunkRowClass(
                      sideChangeBlockId(row),
                      sideChangeBlockId(sideBySideRows[index - 1]),
                      sideChangeBlockId(sideBySideRows[index + 1]),
                    ),
                  )
                "
              >
                <template v-if="row.kind === 'hunk' || row.kind === 'meta'">
                  <span
                    class="sticky left-0 z-10 border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)]"
                  />
                  <span
                    :data-diff-measure="row.id"
                    :class="
                      cn('min-w-0 self-start px-3', wrapsLongLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')
                    "
                    >{{ row.newRow?.content || " " }}</span
                  >
                </template>
                <template v-else>
                  <span
                    :class="sideLineNumberClass(row.newRow)"
                    :title="sideLineNumberLabel(row.newRow, 'new')"
                    :aria-label="sideLineNumberLabel(row.newRow, 'new')"
                  >
                    {{ sideLineNumber(row.newRow, "new") ?? "" }}
                    <span class="w-4 shrink-0 text-center" aria-hidden="true">{{
                      row.newRow ? rowPrefix(row.newRow) : ""
                    }}</span>
                  </span>
                  <span
                    :data-diff-measure="row.newRow ? row.id : undefined"
                    :class="sideContentClass(row.newRow)"
                    v-html="renderedCode(row.newRow)"
                  />
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="p-5 text-sm text-on-surface-variant">
        {{ message || "暂无可显示的 diff。" }}
      </div>
    </div>
  </div>
</template>
