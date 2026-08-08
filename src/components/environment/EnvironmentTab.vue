<script lang="ts">
type EnvironmentColumnWidths = [number, number, number];

let rememberedEnvironmentColumnWidths: EnvironmentColumnWidths | null = null;
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ArrowLeft, CheckCircle2, CircleAlert, CircleHelp, RefreshCw, Settings } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { EnvironmentToolResult } from "../../types";

const store = useStore();
const t = useI18n();

type ResizableColumnIndex = 0 | 1;

const defaultColumnWidths: EnvironmentColumnWidths = [112, 256, 320];
const minimumColumnWidths: EnvironmentColumnWidths = [80, 128, 160];
const columnWidths = ref<EnvironmentColumnWidths>(
  rememberedEnvironmentColumnWidths ? [...rememberedEnvironmentColumnWidths] : [...defaultColumnWidths],
);
const hasCustomColumnWidths = ref(rememberedEnvironmentColumnWidths !== null);
const activeResizeIndex = ref<ResizableColumnIndex | null>(null);
const toolHeaderRef = ref<HTMLElement | null>(null);
const versionHeaderRef = ref<HTMLElement | null>(null);
const pathHeaderRef = ref<HTMLElement | null>(null);
const headerRefs = [toolHeaderRef, versionHeaderRef, pathHeaderRef];
let activePointerId: number | null = null;
let activeSeparator: HTMLElement | null = null;
let resizeStartX = 0;
let resizeStartWidths: EnvironmentColumnWidths = [...defaultColumnWidths];
let previousUserSelect = "";
let previousCursor = "";

const desktopGridTemplate = computed(() =>
  hasCustomColumnWidths.value
    ? `${columnWidths.value[0]}px ${columnWidths.value[1]}px minmax(${columnWidths.value[2]}px, 1fr) max-content`
    : "minmax(7rem, 0.7fr) minmax(16rem, 1.35fr) minmax(10rem, 1.7fr) max-content",
);

const measureColumnWidths = (): EnvironmentColumnWidths =>
  headerRefs.map(
    (headerRef, index) => headerRef.value?.getBoundingClientRect().width || columnWidths.value[index],
  ) as EnvironmentColumnWidths;

const setColumnPairWidths = (
  columnIndex: ResizableColumnIndex,
  startWidths: EnvironmentColumnWidths,
  requestedDelta: number,
) => {
  const nextWidths = [...startWidths] as EnvironmentColumnWidths;
  const nextColumnIndex = columnIndex + 1;
  const delta = Math.min(
    startWidths[nextColumnIndex] - minimumColumnWidths[nextColumnIndex],
    Math.max(minimumColumnWidths[columnIndex] - startWidths[columnIndex], requestedDelta),
  );
  nextWidths[columnIndex] += delta;
  nextWidths[nextColumnIndex] -= delta;
  columnWidths.value = nextWidths;
  rememberedEnvironmentColumnWidths = [...nextWidths];
  hasCustomColumnWidths.value = true;
};

const restoreDocumentInteraction = () => {
  document.body.style.userSelect = previousUserSelect;
  document.body.style.cursor = previousCursor;
};

const stopColumnResize = (event?: PointerEvent) => {
  if (event && activePointerId !== event.pointerId) return;
  if (activeResizeIndex.value === null) return;

  const pointerId = activePointerId;
  const separator = activeSeparator;
  activePointerId = null;
  activeSeparator = null;
  activeResizeIndex.value = null;
  window.removeEventListener("pointermove", handleColumnPointerMove);
  window.removeEventListener("pointerup", stopColumnResize);
  window.removeEventListener("pointercancel", stopColumnResize);
  window.removeEventListener("blur", handleWindowBlur);
  separator?.removeEventListener("lostpointercapture", stopColumnResize);
  try {
    if (pointerId !== null && separator?.hasPointerCapture(pointerId)) separator.releasePointerCapture(pointerId);
  } finally {
    restoreDocumentInteraction();
  }
};

const handleWindowBlur = () => stopColumnResize();

const handleColumnPointerMove = (event: PointerEvent) => {
  if (activeResizeIndex.value === null || event.pointerId !== activePointerId) return;
  setColumnPairWidths(activeResizeIndex.value, resizeStartWidths, event.clientX - resizeStartX);
};

const startColumnResize = (event: PointerEvent, columnIndex: ResizableColumnIndex) => {
  if (!event.isPrimary || event.button !== 0 || activeResizeIndex.value !== null) return;

  const separator = event.currentTarget as HTMLElement;
  try {
    separator.setPointerCapture(event.pointerId);
  } catch {
    return;
  }

  resizeStartX = event.clientX;
  resizeStartWidths = measureColumnWidths();
  columnWidths.value = [...resizeStartWidths];
  hasCustomColumnWidths.value = true;
  activePointerId = event.pointerId;
  activeSeparator = separator;
  activeResizeIndex.value = columnIndex;
  previousUserSelect = document.body.style.userSelect;
  previousCursor = document.body.style.cursor;
  document.body.style.userSelect = "none";
  document.body.style.cursor = "col-resize";
  window.addEventListener("pointermove", handleColumnPointerMove);
  window.addEventListener("pointerup", stopColumnResize);
  window.addEventListener("pointercancel", stopColumnResize);
  window.addEventListener("blur", handleWindowBlur);
  separator.addEventListener("lostpointercapture", stopColumnResize);
  event.preventDefault();
};

const handleColumnResizeKeydown = (event: KeyboardEvent, columnIndex: ResizableColumnIndex) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  setColumnPairWidths(columnIndex, measureColumnWidths(), direction * 16);
  event.preventDefault();
};

const columnMaximumWidth = (columnIndex: ResizableColumnIndex) =>
  columnWidths.value[columnIndex] + columnWidths.value[columnIndex + 1] - minimumColumnWidths[columnIndex + 1];

const enabledKeys = computed(() => new Set(store.environmentPreferences.enabledToolKeys));
const enabledDefinitions = computed(() => [
  ...store.builtinEnvironmentTools
    .filter((tool) => enabledKeys.value.has(tool.key))
    .map((tool) => ({
      ...tool,
      command:
        store.environmentPreferences.builtinOverrides.find((item) => item.key === tool.key)?.command || tool.command,
    })),
  ...store.environmentPreferences.customTools
    .filter((tool) => tool.enabled)
    .map((tool) => ({ key: tool.id, name: tool.name, command: tool.command })),
]);
const resultByKey = computed(() => new Map(store.environmentResults.map((result) => [result.key, result])));
const isRefreshing = (key: string) => store.environmentRefreshingKeys[key] === true;

const statusClass = (key: string, result?: EnvironmentToolResult) =>
  cn(
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold",
    !result && "border-border-subtle bg-surface-container-low text-on-surface-variant",
    isRefreshing(key) && "border-primary/30 bg-primary/10 text-primary",
    !isRefreshing(key) &&
      result?.status === "available" &&
      "border-status-running/30 bg-status-running/10 text-status-running",
    !isRefreshing(key) &&
      result?.status === "missing" &&
      "border-status-warning/30 bg-status-warning/10 text-status-warning",
    !isRefreshing(key) && result?.status === "error" && "border-status-error/30 bg-status-error/10 text-status-error",
  );

const statusText = (key: string, result?: EnvironmentToolResult) => {
  if (isRefreshing(key)) return t.value.environment.checking;
  if (!result) return t.value.environment.notChecked;
  if (result.status === "available") return t.value.environment.available;
  if (result.status === "missing") return t.value.environment.missing;
  return t.value.environment.error;
};

const statusColumnText = computed(() =>
  enabledDefinitions.value.reduce((longest, tool) => {
    const current = statusText(tool.key, resultByKey.value.get(tool.key));
    return current.length > longest.length ? current : longest;
  }, ""),
);

watch(
  () => [
    enabledDefinitions.value.map((tool) => tool.key).join("|"),
    store.environmentRefreshing,
    store.environmentResults.map((result) => result.key).join("|"),
  ],
  () => {
    if (store.environmentRefreshing) return;
    const missingKeys = enabledDefinitions.value.map((tool) => tool.key).filter((key) => !resultByKey.value.has(key));
    if (missingKeys.length > 0) void store.refreshEnvironmentTools(missingKeys);
  },
  { immediate: true },
);

onBeforeUnmount(() => stopColumnResize());
</script>

<template>
  <div v-overlay-scrollbar class="themed-scrollbar h-full overflow-y-auto p-2">
    <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          @click="store.setActiveTab('projects')"
          class="rounded-lg border border-border-subtle bg-surface p-2 text-on-surface-variant shadow-sm transition-all active:scale-90 hover:bg-surface-variant"
          :title="t.common.back"
          :aria-label="t.common.back"
        >
          <ArrowLeft :size="20" />
        </button>
        <div class="min-w-0">
          <h2 class="truncate text-xl font-bold tracking-tight text-on-surface">{{ t.environment.title }}</h2>
          <p class="truncate text-xs text-on-surface-variant">{{ t.environment.subtitle }}</p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          @click="store.setActiveTab('settings')"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
          :title="t.environment.configure"
          :aria-label="t.environment.configure"
        >
          <Settings :size="14" />
          <span class="hidden sm:inline">{{ t.environment.configure }}</span>
        </button>
        <button
          type="button"
          @click="store.refreshEnvironmentTools()"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-primary px-3 text-xs font-bold text-on-primary shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
          :disabled="store.environmentRefreshing || enabledDefinitions.length === 0"
          :title="t.common.refresh"
          :aria-label="t.common.refresh"
        >
          <RefreshCw :size="14" :class="store.environmentRefreshing && 'animate-spin'" />
          <span class="hidden sm:inline">{{ t.common.refresh }}</span>
        </button>
      </div>
    </header>

    <section :aria-busy="store.environmentRefreshing">
      <div
        v-if="enabledDefinitions.length === 0"
        class="rounded border border-dashed border-border-subtle px-3 py-2 text-sm text-on-surface-variant"
      >
        {{ t.environment.empty }}
      </div>
      <div v-else :style="{ '--environment-grid-columns': desktopGridTemplate }">
        <div
          class="environment-grid hidden items-center gap-3 border-b border-border-subtle px-2 pb-1.5 text-[10px] font-bold text-on-surface-variant md:grid"
        >
          <span ref="toolHeaderRef" class="relative min-w-0">
            {{ t.environment.tool }}
            <button
              type="button"
              role="separator"
              aria-orientation="vertical"
              :aria-label="`${t.environment.tool} / ${t.environment.version}`"
              :aria-valuemin="minimumColumnWidths[0]"
              :aria-valuemax="Math.round(columnMaximumWidth(0))"
              :aria-valuenow="Math.round(columnWidths[0])"
              class="group/column-resize absolute -right-3 top-1/2 z-10 h-6 w-3 -translate-y-1/2 cursor-col-resize touch-none border-0 bg-transparent p-0 outline-none"
              @pointerdown="startColumnResize($event, 0)"
              @keydown="handleColumnResizeKeydown($event, 0)"
            >
              <span
                :class="
                  cn(
                    'absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-border-subtle transition-colors group-hover/column-resize:bg-primary group-focus/column-resize:bg-primary',
                    activeResizeIndex === 0 && 'bg-primary',
                  )
                "
              />
            </button>
          </span>
          <span ref="versionHeaderRef" class="relative min-w-0">
            {{ t.environment.version }}
            <button
              type="button"
              role="separator"
              aria-orientation="vertical"
              :aria-label="`${t.environment.version} / ${t.environment.path}`"
              :aria-valuemin="minimumColumnWidths[1]"
              :aria-valuemax="Math.round(columnMaximumWidth(1))"
              :aria-valuenow="Math.round(columnWidths[1])"
              class="group/column-resize absolute -right-3 top-1/2 z-10 h-6 w-3 -translate-y-1/2 cursor-col-resize touch-none border-0 bg-transparent p-0 outline-none"
              @pointerdown="startColumnResize($event, 1)"
              @keydown="handleColumnResizeKeydown($event, 1)"
            >
              <span
                :class="
                  cn(
                    'absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-border-subtle transition-colors group-hover/column-resize:bg-primary group-focus/column-resize:bg-primary',
                    activeResizeIndex === 1 && 'bg-primary',
                  )
                "
              />
            </button>
          </span>
          <span ref="pathHeaderRef" class="min-w-0">{{ t.environment.path }}</span>
          <span class="min-w-0">
            <span class="sr-only">{{ t.common.status }}</span>
            <span
              class="invisible inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold"
              aria-hidden="true"
            >
              <span class="h-3 w-3 shrink-0" />
              {{ statusColumnText }}
            </span>
          </span>
        </div>
        <article
          v-for="tool in enabledDefinitions"
          :key="tool.key"
          class="environment-grid grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-border-subtle px-2 py-2.5 transition-colors last:border-b-0 hover:bg-surface-container-low md:gap-3"
        >
          <div class="min-w-0">
            <h3 class="truncate text-sm font-bold text-on-surface" :title="tool.name">{{ tool.name }}</h3>
          </div>
          <div
            class="col-span-2 grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-xs md:col-span-1 md:col-start-2 md:row-start-1 md:block"
          >
            <span class="text-on-surface-variant md:hidden">{{ t.environment.version }}</span>
            <span v-if="isRefreshing(tool.key) && !resultByKey.get(tool.key)" class="skeleton h-3 w-20" />
            <span v-else class="block truncate font-mono text-on-surface" :title="resultByKey.get(tool.key)?.version">
              {{ resultByKey.get(tool.key)?.version || "-" }}
            </span>
          </div>
          <div
            class="col-span-2 grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-xs md:col-span-1 md:col-start-3 md:row-start-1 md:block"
          >
            <span class="text-on-surface-variant md:hidden">{{ t.environment.path }}</span>
            <span v-if="isRefreshing(tool.key) && !resultByKey.get(tool.key)" class="skeleton h-3 w-full" />
            <span
              v-else
              :class="[
                'block truncate font-mono',
                resultByKey.get(tool.key)?.error ? 'text-status-error' : 'text-on-surface',
              ]"
              :title="resultByKey.get(tool.key)?.error || resultByKey.get(tool.key)?.executablePath"
            >
              {{ resultByKey.get(tool.key)?.error || resultByKey.get(tool.key)?.executablePath || "-" }}
            </span>
          </div>
          <span
            :class="[
              statusClass(tool.key, resultByKey.get(tool.key)),
              'col-start-2 row-start-1 md:col-start-4 md:row-start-1',
            ]"
          >
            <RefreshCw v-if="isRefreshing(tool.key)" :size="12" class="animate-spin" />
            <CheckCircle2 v-else-if="resultByKey.get(tool.key)?.status === 'available'" :size="12" />
            <CircleAlert v-else-if="resultByKey.get(tool.key)" :size="12" />
            <CircleHelp v-else :size="12" />
            {{ statusText(tool.key, resultByKey.get(tool.key)) }}
          </span>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
@media (min-width: 48rem) {
  .environment-grid {
    grid-template-columns: var(--environment-grid-columns);
  }
}
</style>
