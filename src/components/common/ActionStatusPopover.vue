<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ChevronDown, RefreshCw } from "lucide-vue-next";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { cn } from "../../lib/utils";

export type ActionStatusState = "idle" | "loading" | "success" | "warning" | "error";
export type ActionStatusEntry = { timestamp: string; message: string };
type FloatingPosition = { left: number; top: number };

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
const panelPosition = ref<FloatingPosition>({ left: 8, top: 8 });
const hasDetails = computed(() => props.entries.length > 0);
const historyEntries = computed(() => props.entries.slice(0, -1));
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

const positionPanel = (trigger: HTMLElement, width: number, estimatedHeight: number): FloatingPosition => {
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
  const belowTop = rect.bottom + 6;
  const top = belowTop + estimatedHeight <= viewportHeight - 8 ? belowTop : Math.max(8, rect.top - estimatedHeight - 6);
  return { left, top };
};

const updatePanelPosition = async () => {
  const trigger = triggerRef.value;
  if (!trigger) return;

  panelPosition.value = positionPanel(trigger, 320, 192);
  await nextTick();
  if (!props.expanded || !panelRef.value) return;
  panelPosition.value = positionPanel(trigger, panelRef.value.offsetWidth, panelRef.value.offsetHeight);
};

const toggleExpanded = () => {
  if (!hasDetails.value) return;
  const expanded = !props.expanded;
  emit("update:expanded", expanded);
  if (expanded) void updatePanelPosition();
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

const handleViewportChange = () => close();
const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!props.expanded || event.detail.handled) return;
  close();
  event.detail.handle();
};

let stopAppEscapeListener = () => {};
onMounted(() => {
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
  window.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
});

onUnmounted(() => {
  stopAppEscapeListener();
  window.removeEventListener("pointerdown", handlePointerDown);
  window.removeEventListener("resize", handleViewportChange);
  window.removeEventListener("scroll", handleViewportChange, true);
});

watch(
  () => props.expanded,
  (expanded) => {
    if (expanded) void updatePanelPosition();
  },
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
          maxHeight: 'min(12rem, calc(100vh - 1rem))',
        }"
        role="dialog"
        aria-label="操作进度"
        @click.stop
      >
        <div
          class="flex min-w-0 items-center gap-2 border-b border-border-subtle bg-surface-container-low px-3 py-2"
          aria-live="polite"
        >
          <RefreshCw
            :size="12"
            :class="cn('shrink-0', stateClasses, state === 'loading' && 'animate-spin')"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold text-on-surface" :title="message">
            {{ message }}
          </span>
        </div>
        <div
          v-if="historyEntries.length"
          v-overlay-scrollbar
          class="themed-scrollbar max-h-32 space-y-0.5 overflow-y-auto px-2 py-1.5 font-mono text-[9px] leading-4"
        >
          <div
            v-for="entry in historyEntries"
            :key="`${entry.timestamp}:${entry.message}`"
            class="flex min-w-0 gap-1.5 rounded-md px-1.5 py-1 text-on-surface-variant"
          >
            <span class="shrink-0 text-[9px] text-on-surface-variant">{{ entry.timestamp }}</span>
            <span class="min-w-0 break-words">{{ entry.message }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
