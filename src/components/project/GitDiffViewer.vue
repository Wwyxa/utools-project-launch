<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  FileText,
  Maximize2,
  Minimize2,
  Pilcrow,
  Rows2,
  WrapText,
} from "lucide-vue-next";
import {
  findGitDiffChangeBlocks,
  findGitDiffInlineRanges,
  markGitDiffInlineRanges,
  parseGitDiff,
  toGitDiffSideBySideRows,
  type GitDiffInlineRange,
  type GitDiffRow,
  type GitDiffSideBySideRow,
} from "../../lib/gitDiff";
import { highlightCode, languageForFilePath } from "../../lib/markdown";
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
const diffViewMode = ref<GitDiffViewMode>("unified");
const activeHunkIndex = ref(0);
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
const highlightedCodeByRowId = computed(() => {
  const language = diffLanguage.value;
  return new Map(
    parsedDiff.value.rows
      .filter((row) => row.kind === "addition" || row.kind === "deletion" || row.kind === "context")
      .map((row) => [row.id, highlightCode(row.content, language)]),
  );
});
const inlineHighlightsByRowId = computed(() => {
  const highlights = new Map<string, InlineRowHighlight>();
  sideBySideRows.value.forEach((row) => {
    if (!row.isReliablePair || row.oldRow?.kind !== "deletion" || row.newRow?.kind !== "addition") {
      return;
    }

    const ranges = findGitDiffInlineRanges(row.oldRow.content, row.newRow.content);
    if (!ranges) return;
    highlights.set(row.oldRow.id, { kind: "deletion", ranges: ranges.oldRanges });
    highlights.set(row.newRow.id, { kind: "addition", ranges: ranges.newRanges });
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

const highlightedCode = (row: GitDiffRow) => highlightedCodeByRowId.value.get(row.id) || "";
const renderedCode = (row: GitDiffRow | null) => {
  if (!row) return " ";
  const inlineHighlight = inlineHighlightsByRowId.value.get(row.id);
  const code = inlineHighlight
    ? markGitDiffInlineRanges(highlightedCode(row), inlineHighlight.ranges, inlineHighlight.kind)
    : highlightedCode(row);
  return `${rowPrefix(row)}${code}` || " ";
};

const displayLineNumber = (row: GitDiffRow) => row.newLineNumber ?? row.oldLineNumber;
const lineNumberLabel = (row: GitDiffRow) => {
  const lineNumber = displayLineNumber(row);
  if (lineNumber == null) return "无对应行号";
  return row.newLineNumber != null ? `新文件第 ${lineNumber} 行` : `原文件第 ${lineNumber} 行`;
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
    "grid grid-cols-[3.5rem_minmax(0,1fr)] font-mono text-xs leading-5",
    row.kind === "addition" && "bg-[var(--syntax-addition-bg)] text-[var(--syntax-addition-fg)]",
    row.kind === "deletion" && "bg-[var(--syntax-deletion-bg)] text-[var(--syntax-deletion-fg)]",
    row.kind === "hunk" && "bg-primary/10 text-primary",
    row.kind === "meta" && "bg-[var(--code-preview-gutter-bg)] text-on-surface-variant",
    row.kind === "context" && "text-on-surface",
  );

const sidePaneRowClass = (row: GitDiffSideBySideRow) =>
  cn(
    "grid min-h-5 grid-cols-[3.5rem_minmax(10rem,1fr)] font-mono text-xs leading-5",
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

const sideLineNumberClass = (row: GitDiffRow | null, side: "old" | "new") =>
  cn(
    "diff-line-number select-none bg-[var(--code-preview-gutter-bg)] px-2 text-right tabular-nums",
    "border-r",
    "border-[var(--code-preview-border)]",
    row?.kind === "deletion" && "text-[var(--syntax-deletion-fg)]",
    row?.kind === "addition" && "text-[var(--syntax-addition-fg)]",
    row?.kind === "context" && "diff-line-number-context",
    !row && "text-transparent",
  );

const sideContentClass = (row: GitDiffRow | null) =>
  cn(
    "min-w-0 px-3",
    row?.kind === "addition" && "bg-[var(--syntax-addition-bg)] text-[var(--syntax-addition-fg)]",
    row?.kind === "deletion" && "bg-[var(--syntax-deletion-bg)] text-[var(--syntax-deletion-fg)]",
    row?.kind === "context" && "text-on-surface",
    "whitespace-pre",
  );

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
  const targetIndex =
    direction > 0
      ? Math.min(changeBlocks.value.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1);
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
  if (target) {
    if (Math.abs(target.scrollTop - source.scrollTop) > 1) target.scrollTop = source.scrollTop;
    if (Math.abs(target.scrollLeft - source.scrollLeft) > 1) target.scrollLeft = source.scrollLeft;
  }
  emit("update:scrollTop", source.scrollTop);
};

const toggleDiffViewMode = () => {
  const scrollTop = reviewScrollElement()?.scrollTop ?? props.scrollTop;
  diffViewMode.value = diffViewMode.value === "unified" ? "side-by-side" : "unified";
  void nextTick(() => {
    setReviewScrollTop(scrollTop);
    emit("update:scrollTop", scrollTop);
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
</script>

<template>
  <div
    class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--code-preview-bg)]"
    role="region"
    aria-label="Git diff"
  >
    <div
      class="flex h-10 shrink-0 min-w-0 items-center justify-between gap-2 border-b border-[var(--code-preview-border)] bg-surface-container-low px-2.5"
    >
      <div class="min-w-0 flex-1 leading-tight">
        <div class="truncate font-mono text-[10px] font-bold text-on-surface" :title="path || 'Git diff'">
          {{ path || "Git diff" }}
        </div>
        <div v-if="branch || subtitle" class="flex min-w-0 items-center gap-1 text-[9px] text-on-surface-variant">
          <span v-if="branch" class="min-w-0 flex-1 truncate font-mono" :title="branch">{{ branch }}</span>
          <span v-if="branch && subtitle" aria-hidden="true">·</span>
          <span v-if="subtitle" class="min-w-0 truncate" :title="subtitle">{{ subtitle }}</span>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-0.5" role="toolbar" aria-label="Diff 工具栏">
        <span
          class="min-w-9 select-none px-1 text-center font-mono text-[10px] font-semibold tabular-nums text-on-surface-variant"
          :title="`${changeBlocks.length} 个变更块`"
        >
          {{ hunkProgress }}
        </span>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-35"
          title="上一个 hunk"
          aria-label="上一个 hunk"
          :disabled="loading || !changeBlocks.length"
          @click="navigateHunk(-1)"
        >
          <ChevronUp :size="14" />
        </button>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-35"
          title="下一个 hunk"
          aria-label="下一个 hunk"
          :disabled="loading || !changeBlocks.length"
          @click="navigateHunk(1)"
        >
          <ChevronDown :size="14" />
        </button>
        <span class="mx-1 h-4 w-px bg-border-subtle" aria-hidden="true" />
        <button
          type="button"
          :class="
            cn(
              'flex h-7 w-7 items-center justify-center rounded transition-colors',
              wrapsLongLines
                ? 'bg-primary/10 text-primary'
                : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface',
            )
          "
          :title="
            diffViewMode === 'side-by-side' ? '双栏对比固定不换行' : wrapsLongLines ? '关闭长行换行' : '开启长行换行'
          "
          :aria-label="
            diffViewMode === 'side-by-side' ? '双栏对比固定不换行' : wrapsLongLines ? '关闭长行换行' : '开启长行换行'
          "
          :aria-pressed="diffViewMode === 'unified' && wrapsLongLines"
          :disabled="loading || diffViewMode === 'side-by-side'"
          @click="wrapsLongLines = !wrapsLongLines"
        >
          <WrapText :size="14" />
        </button>
        <span class="mx-1 h-4 w-px bg-border-subtle" aria-hidden="true" />
        <button
          type="button"
          :class="
            cn(
              'flex h-7 w-7 items-center justify-center rounded transition-colors disabled:opacity-35',
              fullFile
                ? 'bg-primary/10 text-primary'
                : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface',
            )
          "
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
          :class="
            cn(
              'flex h-7 w-7 items-center justify-center rounded transition-colors disabled:opacity-35',
              ignoreWhitespace
                ? 'bg-primary/10 text-primary'
                : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface',
            )
          "
          :title="ignoreWhitespace ? '显示空白符变更' : '忽略空白符变更'"
          :aria-label="ignoreWhitespace ? '显示空白符变更' : '忽略空白符变更'"
          :aria-pressed="ignoreWhitespace"
          :disabled="loading"
          @click="toggleIgnoreWhitespace"
        >
          <Pilcrow :size="14" />
        </button>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-35"
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
          class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
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
              <span class="border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)]" />
              <span :class="cn('px-3', wrapsLongLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')">
                {{ row.content || " " }}
              </span>
            </template>
            <template v-else>
              <span
                :class="
                  cn(
                    'diff-line-number select-none border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)] px-2 text-right tabular-nums',
                    row.kind === 'deletion' && 'text-[var(--syntax-deletion-fg)]',
                    row.kind === 'addition' && 'text-[var(--syntax-addition-fg)]',
                    row.kind === 'context' && 'diff-line-number-context',
                  )
                "
                :title="lineNumberLabel(row)"
                :aria-label="lineNumberLabel(row)"
              >
                {{ displayLineNumber(row) ?? "" }}
              </span>
              <span
                :class="cn('px-3', wrapsLongLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')"
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
            <div class="min-w-max">
              <div
                v-for="(row, index) in sideBySideRows"
                :key="row.id"
                :data-diff-change-block="sideChangeBlockStartId(row)"
                :class="
                  cn(
                    sidePaneRowClass(row),
                    activeHunkRowClass(
                      sideChangeBlockId(row),
                      sideChangeBlockId(sideBySideRows[index - 1]),
                      sideChangeBlockId(sideBySideRows[index + 1]),
                    ),
                  )
                "
              >
                <template v-if="row.kind === 'hunk' || row.kind === 'meta'">
                  <span class="border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)]" />
                  <span class="px-3 whitespace-pre">{{ row.oldRow?.content || " " }}</span>
                </template>
                <template v-else>
                  <span
                    :class="sideLineNumberClass(row.oldRow, 'old')"
                    :title="sideLineNumberLabel(row.oldRow, 'old')"
                    :aria-label="sideLineNumberLabel(row.oldRow, 'old')"
                  >
                    {{ sideLineNumber(row.oldRow, "old") ?? "" }}
                  </span>
                  <span :class="sideContentClass(row.oldRow)" v-html="renderedCode(row.oldRow)" />
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
            <div class="min-w-max">
              <div
                v-for="(row, index) in sideBySideRows"
                :key="row.id"
                :data-diff-change-block="sideChangeBlockStartId(row)"
                :class="
                  cn(
                    sidePaneRowClass(row),
                    activeHunkRowClass(
                      sideChangeBlockId(row),
                      sideChangeBlockId(sideBySideRows[index - 1]),
                      sideChangeBlockId(sideBySideRows[index + 1]),
                    ),
                  )
                "
              >
                <template v-if="row.kind === 'hunk' || row.kind === 'meta'">
                  <span class="border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)]" />
                  <span class="px-3 whitespace-pre">{{ row.newRow?.content || " " }}</span>
                </template>
                <template v-else>
                  <span
                    :class="sideLineNumberClass(row.newRow, 'new')"
                    :title="sideLineNumberLabel(row.newRow, 'new')"
                    :aria-label="sideLineNumberLabel(row.newRow, 'new')"
                  >
                    {{ sideLineNumber(row.newRow, "new") ?? "" }}
                  </span>
                  <span :class="sideContentClass(row.newRow)" v-html="renderedCode(row.newRow)" />
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
