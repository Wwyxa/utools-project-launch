<script setup lang="ts">
import { computed, ref } from "vue";
import { Play, Square, TerminalSquare } from "lucide-vue-next";
import { Project } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { useResizableSplit } from "../../composables/useResizableSplit";
import Terminal from "../terminal/Terminal.vue";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();
const splitContainerRef = ref<HTMLElement | null>(null);
const scriptsPaneRef = ref<HTMLElement | null>(null);

const scripts = computed(() => props.project.scripts);
const isUnavailable = computed(() => props.project.pathExists === false);
const {
  bounds: splitBounds,
  firstSize,
  gridTemplateStyle,
  handleSeparatorKeydown,
  isResizing,
  separatorOrientation,
  startResize,
} = useResizableSplit({
  containerRef: splitContainerRef,
  firstPaneRef: scriptsPaneRef,
  layoutKey: "scripts-main",
  orientation: "vertical",
  defaultFirstRatio: 0.34,
  minFirstSize: 88,
  minSecondSize: 180,
});

const scriptStatusLabel = (status: Project["scripts"][number]["status"]) => {
  if (status === "RUNNING") return t.value.common.running;
  if (status === "STOPPING") return t.value.common.stopping;
  if (status === "ERROR") return t.value.common.error;
  if (status === "STOPPED") return t.value.common.stopped;
  return t.value.common.idle;
};

const handleStart = async (scriptId: string) => {
  if (isUnavailable.value) {
    return;
  }
  await store.launchScript(props.project.id, scriptId);
};

const handleStop = async (scriptId: string) => {
  if (isUnavailable.value) {
    return;
  }
  await store.stopScript(props.project.id, scriptId);
};
</script>

<template>
  <div ref="splitContainerRef" class="relative grid h-full min-h-0 overflow-hidden" :style="gridTemplateStyle">
    <div
      v-if="scripts.length === 0"
      ref="scriptsPaneRef"
      class="rounded-lg border border-dashed border-border-subtle bg-surface p-6 text-sm text-on-surface-variant"
    >
      {{ t.projectDetails.noScripts }}
    </div>

    <div v-else ref="scriptsPaneRef" class="min-h-0">
      <div class="flex h-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm">
        <div class="ui-panel-header">
          <div class="ui-panel-title">
            <TerminalSquare :size="14" class="text-primary" />
            <span>{{ t.projectDetails.scripts }}</span>
          </div>
          <span class="ui-panel-meta">{{ scripts.length }}</span>
        </div>
        <div class="themed-scrollbar min-h-0 flex-1 overflow-auto">
          <div
            v-for="script in scripts"
            :key="script.id"
            class="grid grid-cols-[minmax(8rem,1.1fr)_auto_minmax(0,2fr)_minmax(6rem,0.8fr)_auto] gap-3 px-3 py-2 border-b border-border-subtle last:border-b-0 items-center hover:bg-surface-container-low transition-colors"
          >
            <div class="min-w-0">
              <div class="font-mono text-xs font-bold text-on-surface truncate" :title="script.name">
                {{ script.name }}
              </div>
              <div class="text-[10px] text-on-surface-variant truncate" :title="script.note || script.source">
                {{ script.note || script.source }}
              </div>
            </div>
            <div
              :class="
                cn(
                  'px-2 py-0.5 rounded-full text-[9px] font-bold border justify-self-start inline-flex items-center gap-1',
                  script.status === 'RUNNING'
                    ? 'bg-status-running/10 text-status-running border-status-running/20'
                    : script.status === 'STOPPING'
                      ? 'bg-status-warning/10 text-status-warning border-status-warning/20'
                      : script.status === 'ERROR'
                        ? 'bg-status-error/10 text-status-error border-status-error/20'
                        : 'bg-status-stopped/10 text-status-stopped border-status-stopped/20',
                )
              "
            >
              <span
                v-if="script.status === 'RUNNING'"
                class="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse shadow-[0_0_8px_rgba(46,175,125,0.9)]"
              />
              {{ scriptStatusLabel(script.status) }}
            </div>
            <div class="font-mono text-xs text-on-surface-variant truncate" :title="script.command">
              {{ script.command }}
            </div>
            <div class="text-[10px] text-on-surface-variant truncate" :title="script.cwd || '.'">
              {{ t.scripts.cwd }}: {{ script.cwd || "." }}
            </div>
            <div class="flex items-center gap-2 justify-end shrink-0">
              <button
                v-if="script.status === 'RUNNING'"
                type="button"
                @click="handleStop(script.id)"
                :disabled="isUnavailable"
                class="bg-status-error text-white text-xs font-bold py-1.5 px-3 rounded flex items-center gap-1.5 hover:bg-opacity-90 disabled:opacity-50"
              >
                <Square :size="12" fill="currentColor" /> {{ t.scripts.stopScript }}
              </button>
              <button
                v-else-if="script.status === 'STOPPING'"
                type="button"
                disabled
                class="bg-status-warning text-white text-xs font-bold py-1.5 px-3 rounded flex items-center gap-1.5 opacity-80 cursor-wait"
              >
                <Square :size="12" fill="currentColor" /> {{ t.common.stopping }}
              </button>
              <button
                v-else
                type="button"
                @click="handleStart(script.id)"
                :disabled="isUnavailable || !script.command.trim()"
                class="bg-primary text-on-primary text-xs font-bold py-1.5 px-3 rounded flex items-center gap-1.5 hover:bg-opacity-90 disabled:opacity-50"
              >
                <Play :size="12" fill="currentColor" /> {{ t.scripts.startScript }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      role="separator"
      :aria-orientation="separatorOrientation"
      :aria-label="t.scripts.resizePanels"
      :aria-valuemin="Math.round(splitBounds.min)"
      :aria-valuemax="Math.round(splitBounds.max)"
      :aria-valuenow="Math.round(firstSize ?? 0)"
      tabindex="0"
      :class="cn('group/split relative z-20 cursor-row-resize touch-none outline-none', isResizing && 'bg-primary/10')"
      @pointerdown="startResize"
      @keydown="handleSeparatorKeydown"
    >
      <span
        :class="
          cn(
            'absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border-subtle transition-colors group-hover/split:bg-primary group-focus/split:bg-primary',
            isResizing && 'bg-primary',
          )
        "
      />
    </div>

    <div class="min-h-0">
      <Terminal :projectId="project.id" :scripts="project.scripts" />
    </div>
  </div>
</template>
