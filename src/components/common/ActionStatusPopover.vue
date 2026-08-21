<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ChevronDown, RefreshCw } from "lucide-vue-next";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { getOverlayScrollbarScrollElements } from "../../lib/overlayScrollbar";
import { cn, scrollToBoundary } from "../../lib/utils";

export type ActionStatusState = "idle" | "loading" | "success" | "warning" | "error";
export type ActionStatusEntry = { timestamp: string; message: string };
type FloatingPosition = { left: number; top: number; maxHeight: string };

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    message: string;
    state?: ActionStatusState;
    entries?: readonly ActionStatusEntry[];
    expanded?: boolean;
  }>(),
  {
    state: "idle",
    entries: () => [],
    expanded: false,
  },
);

const emit = defineEmits<{
  (event: "update:expanded", value: boolean): void;
}>();

const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const entriesScrollRef = ref<HTMLElement | null>(null);
const panelPosition = ref<FloatingPosition>({
  left: 8,
  top: 8,
  maxHeight: "min(12rem, calc(100vh - 1rem))",
});
let panelResizeObserver: ResizeObserver | null = null;
const hasDetails = computed(() => props.entries.length > 0);
const stateClasses = computed(() => {
  if (props.state === "loading") return "text-primary";
  if (props.state === "success") return "text-status-running";
  if (props.state === "warning") return "text-status-warning";
  if (props.state === "error") return "text-status-error";
  return "text-on-surface-variant";
});
const indicatorClasses = computed(() => {
  if (props.state === "loading") return "bg-primary animate-pulse";
  if (props.state === "success") return "bg-status-running";
  if (props.state === "warning") return "bg-status-warning";
  if (props.state === "error") return "bg-status-error";
  return "bg-on-surface-variant";
});

const positionPanel = (trigger: HTMLElement, width: number, height: number): FloatingPosition => {
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const viewportInset = 8;
  const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
  const belowTop = rect.bottom + 6;
  const availableBelow = Math.max(0, viewportHeight - belowTop - viewportInset);
  const availableAbove = Math.max(0, rect.top - 6 - viewportInset);
  const placeBelow = height <= 0 || availableBelow >= Math.min(height, availableAbove);
  const top = placeBelow ? belowTop : Math.max(viewportInset, rect.top - height - 6);
  const availableHeight = placeBelow ? availableBelow : availableAbove;
  return {
    left,
    top,
    maxHeight: `min(12rem, ${Math.max(1, Math.floor(availableHeight))}px)`,
  };
};

const positionPanelFromLayout = () => {
  const trigger = triggerRef.value;
  const panel = panelRef.value;
  if (!trigger || !panel || !props.expanded) return;

  const rect = panel.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  panelPosition.value = positionPanel(trigger, rect.width, rect.height);
};

const updatePanelPosition = async () => {
  const trigger = triggerRef.value;
  if (!trigger) return;

  panelPosition.value = positionPanel(trigger, 320, 0);
  await nextTick();
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  positionPanelFromLayout();
};

const scrollEntriesToBottom = async () => {
  await nextTick();
  const scrollElement = getOverlayScrollbarScrollElements(entriesScrollRef.value)?.scrollOffsetElement;
  if (scrollElement) scrollToBoundary(scrollElement, "bottom");
};

const toggleExpanded = () => {
  if (!hasDetails.value) return;
  emit("update:expanded", !props.expanded);
};

const close = () => {
  if (props.expanded) emit("update:expanded", false);
};

const handlePointerDown = (event: PointerEvent) => {
  if (!props.expanded) return;
  const target = event.target;
  if (target instanceof Node && (triggerRef.value?.contains(target) || panelRef.value?.contains(target))) return;
  close();
};

const handleViewportChange = () => {
  if (props.expanded) void updatePanelPosition();
};

const handleViewportScroll = (event: Event) => {
  const panel = panelRef.value;
  if (panel && event.composedPath().includes(panel)) return;
  close();
};
const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!props.expanded || event.detail.handled) return;
  close();
  event.detail.handle();
};

let stopAppEscapeListener = () => {};
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    panelResizeObserver = new ResizeObserver(positionPanelFromLayout);
    if (panelRef.value) panelResizeObserver.observe(panelRef.value);
  }
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
  window.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportScroll, true);
  if (props.expanded) void updatePanelPosition();
});

onUnmounted(() => {
  panelResizeObserver?.disconnect();
  panelResizeObserver = null;
  stopAppEscapeListener();
  window.removeEventListener("pointerdown", handlePointerDown);
  window.removeEventListener("resize", handleViewportChange);
  window.removeEventListener("scroll", handleViewportScroll, true);
});

watch(
  panelRef,
  (panel, previousPanel) => {
    if (previousPanel) panelResizeObserver?.unobserve(previousPanel);
    if (panel) {
      panelResizeObserver?.observe(panel);
      positionPanelFromLayout();
    }
  },
  { flush: "post" },
);

watch(
  () => props.expanded,
  (expanded) => {
    if (expanded) {
      void updatePanelPosition();
      void scrollEntriesToBottom();
    }
  },
  { flush: "post" },
);

watch(
  () => props.entries,
  () => {
    if (props.expanded) void scrollEntriesToBottom();
  },
  { flush: "post" },
);
</script>

<template>
  <button
    ref="triggerRef"
    v-bind="$attrs"
    type="button"
    aria-live="polite"
    :class="
      cn(
        'inline-flex h-7 max-w-80 items-center gap-1.5 truncate rounded-md border border-outline-variant/80 bg-surface-container-lowest px-2 text-[10px] font-semibold shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        stateClasses,
        hasDetails && 'cursor-pointer hover:border-outline hover:bg-surface-container-low',
        !hasDetails && 'cursor-default',
      )
    "
    :title="hasDetails ? '展开或收起操作进度' : message"
    :aria-label="hasDetails ? '展开或收起操作进度' : message"
    :aria-expanded="hasDetails ? expanded : undefined"
    :disabled="!hasDetails"
    @click.stop="toggleExpanded"
  >
    <RefreshCw v-if="state === 'loading'" :size="12" class="shrink-0 animate-spin" aria-hidden="true" />
    <span v-else class="h-1.5 w-1.5 shrink-0 rounded-full" :class="indicatorClasses" aria-hidden="true" />
    <span class="min-w-0 truncate">{{ message }}</span>
    <ChevronDown
      v-if="hasDetails"
      :size="11"
      class="shrink-0 transition-transform"
      :class="expanded ? 'rotate-180' : ''"
      aria-hidden="true"
    />
  </button>

  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="expanded"
        ref="panelRef"
        class="fixed z-[80] w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-border-subtle bg-surface-container-lowest text-xs shadow-2xl"
        :style="{
          left: `${panelPosition.left}px`,
          top: `${panelPosition.top}px`,
          maxHeight: panelPosition.maxHeight,
        }"
        role="dialog"
        aria-label="操作进度"
        @click.stop
      >
        <div
          ref="entriesScrollRef"
          v-overlay-scrollbar
          class="themed-scrollbar max-h-32 overscroll-contain overflow-y-auto px-2 py-1.5 font-mono text-[9px] leading-4"
          aria-live="polite"
        >
          <div class="space-y-0.5">
            <div
              v-for="entry in entries"
              :key="`${entry.timestamp}:${entry.message}`"
              class="flex min-w-0 gap-1.5 rounded-md px-1.5 py-1 text-on-surface-variant"
            >
              <span class="shrink-0 text-[9px] text-on-surface-variant">{{ entry.timestamp }}</span>
              <span class="min-w-0 break-words">{{ entry.message }}</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
