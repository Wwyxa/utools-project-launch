<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ChevronDown, ChevronUp, WrapText } from "lucide-vue-next";
import { parseGitDiff, type GitDiffRow } from "../../lib/gitDiff";
import { cn } from "../../lib/utils";

const props = withDefaults(
  defineProps<{
    diff?: string;
    loading?: boolean;
    message?: string;
    scrollTop?: number;
  }>(),
  {
    diff: "",
    loading: false,
    message: "",
    scrollTop: 0,
  },
);

const emit = defineEmits<{
  (event: "update:scrollTop", value: number): void;
}>();

const scrollRef = ref<HTMLDivElement | null>(null);
const wrapsLongLines = ref(false);
const activeHunkIndex = ref(0);
const parsedDiff = computed(() => parseGitDiff(props.diff));
const isBinaryDiff = computed(() => /^(?:Binary files .* differ|GIT binary patch)$/m.test(props.diff));
const hunkProgress = computed(() =>
  parsedDiff.value.hunks.length ? `${activeHunkIndex.value + 1}/${parsedDiff.value.hunks.length}` : "0/0",
);

const rowPrefix = (row: GitDiffRow) => {
  if (row.kind === "addition") return "+";
  if (row.kind === "deletion") return "-";
  if (row.kind === "context") return " ";
  return "";
};

const displayLineNumber = (row: GitDiffRow) => row.newLineNumber ?? row.oldLineNumber;
const lineNumberLabel = (row: GitDiffRow) => {
  const lineNumber = displayLineNumber(row);
  if (lineNumber == null) return "无对应行号";
  return row.newLineNumber != null ? `新文件第 ${lineNumber} 行` : `原文件第 ${lineNumber} 行`;
};

const rowClass = (row: GitDiffRow) =>
  cn(
    "grid grid-cols-[3.5rem_minmax(0,1fr)] font-mono text-xs leading-5",
    row.kind === "addition" && "bg-status-running/10 text-status-running",
    row.kind === "deletion" && "bg-status-error/10 text-status-error",
    row.kind === "hunk" && "bg-primary/10 text-primary",
    row.kind === "meta" && "bg-[var(--code-preview-gutter-bg)] text-on-surface-variant",
    row.kind === "context" && "text-on-surface",
  );

const resolveActiveHunkIndex = (scrollElement: HTMLElement, hunkElements: HTMLElement[]) =>
  Math.max(
    0,
    hunkElements.reduce(
      (lastIndex, element, index) => (element.offsetTop <= scrollElement.scrollTop + 8 ? index : lastIndex),
      -1,
    ),
  );

const syncActiveHunkIndex = () => {
  const scrollElement = scrollRef.value;
  if (!scrollElement || !parsedDiff.value.hunks.length) {
    activeHunkIndex.value = 0;
    return;
  }
  const hunkElements = Array.from(scrollElement.querySelectorAll<HTMLElement>("[data-diff-hunk]"));
  activeHunkIndex.value = resolveActiveHunkIndex(scrollElement, hunkElements);
};

const navigateHunk = async (direction: -1 | 1) => {
  const scrollElement = scrollRef.value;
  if (!scrollElement || !parsedDiff.value.hunks.length) return;

  await nextTick();
  const hunkElements = Array.from(scrollElement.querySelectorAll<HTMLElement>("[data-diff-hunk]"));
  const currentIndex = resolveActiveHunkIndex(scrollElement, hunkElements);
  const targetIndex =
    direction > 0
      ? Math.min(hunkElements.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1);
  const target = hunkElements[targetIndex];
  if (target) {
    activeHunkIndex.value = targetIndex;
    scrollElement.scrollTo({ top: target.offsetTop });
  }
};

const handleScroll = () => {
  if (scrollRef.value) {
    emit("update:scrollTop", scrollRef.value.scrollTop);
    syncActiveHunkIndex();
  }
};

watch(
  () => props.scrollTop,
  async (scrollTop) => {
    await nextTick();
    if (scrollRef.value && Math.abs(scrollRef.value.scrollTop - scrollTop) > 1) {
      scrollRef.value.scrollTop = scrollTop;
    }
    syncActiveHunkIndex();
  },
  { immediate: true },
);

watch(
  () => props.diff,
  async () => {
    activeHunkIndex.value = 0;
    await nextTick();
    syncActiveHunkIndex();
  },
);
</script>

<template>
  <div
    class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--code-preview-bg)]"
    role="region"
    aria-label="Git diff"
  >
    <div
      class="absolute bottom-3 right-3 z-20 flex h-9 items-center gap-0.5 rounded-lg border border-[var(--code-preview-border)] bg-surface-container-high px-1.5 shadow-lg"
      role="toolbar"
      aria-label="Diff 导航"
    >
      <span
        class="min-w-9 select-none px-1 text-center font-mono text-[10px] font-semibold tabular-nums text-on-surface-variant"
        :title="`${parsedDiff.hunks.length} 个变更块`"
      >
        {{ hunkProgress }}
      </span>
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-35"
        title="上一个 hunk"
        aria-label="上一个 hunk"
        :disabled="!parsedDiff.hunks.length"
        @click="navigateHunk(-1)"
      >
        <ChevronUp :size="14" />
      </button>
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-35"
        title="下一个 hunk"
        aria-label="下一个 hunk"
        :disabled="!parsedDiff.hunks.length"
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
        :title="wrapsLongLines ? '关闭长行换行' : '开启长行换行'"
        :aria-label="wrapsLongLines ? '关闭长行换行' : '开启长行换行'"
        :aria-pressed="wrapsLongLines"
        @click="wrapsLongLines = !wrapsLongLines"
      >
        <WrapText :size="14" />
      </button>
    </div>

    <div
      ref="scrollRef"
      class="themed-scrollbar min-h-0 flex-1 overflow-auto pb-14 [scroll-padding-bottom:3.5rem]"
      @scroll="handleScroll"
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
      <div v-else-if="parsedDiff.rows.length" :class="wrapsLongLines ? 'min-w-0' : 'min-w-max'">
        <div
          v-for="row in parsedDiff.rows"
          :key="row.id"
          :data-diff-hunk="row.kind === 'hunk' ? row.hunkId : undefined"
          :class="rowClass(row)"
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
                  'select-none border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)] px-2 text-right tabular-nums',
                  row.kind === 'deletion' && 'text-status-error/70',
                  row.kind === 'addition' && 'text-status-running/70',
                  row.kind === 'context' && 'text-on-surface-variant/60',
                )
              "
              :title="lineNumberLabel(row)"
              :aria-label="lineNumberLabel(row)"
            >
              {{ displayLineNumber(row) ?? "" }}
            </span>
            <span :class="cn('px-3', wrapsLongLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')">
              {{ `${rowPrefix(row)}${row.content}` || " " }}
            </span>
          </template>
        </div>
      </div>
      <div v-else class="p-5 text-sm text-on-surface-variant">
        {{ message || "暂无可显示的 diff。" }}
      </div>
    </div>
  </div>
</template>
