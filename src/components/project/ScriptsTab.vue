<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDown, ChevronUp, Play, Square, TerminalSquare } from "lucide-vue-next";
import { Project } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import Terminal from "../terminal/Terminal.vue";

type CollapsedScriptsPanel = "scripts" | "terminal";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();
const collapsedScriptsPanel = ref<CollapsedScriptsPanel | null>(null);

const scripts = computed(() => props.project.scripts);
const isUnavailable = computed(() => props.project.pathExists === false);
const canCollapseScriptsLayout = computed(() => scripts.value.length > 0);
const isScriptsListPanelCollapsed = computed(
  () => canCollapseScriptsLayout.value && collapsedScriptsPanel.value === "scripts",
);
const isScriptsTerminalPanelCollapsed = computed(
  () => canCollapseScriptsLayout.value && collapsedScriptsPanel.value === "terminal",
);
const showScriptsCollapseControls = computed(() => canCollapseScriptsLayout.value && !collapsedScriptsPanel.value);
const scriptListPanelFrameClass = computed(() =>
  cn(
    "relative overflow-visible",
    isScriptsTerminalPanelCollapsed.value ? "min-h-0 flex-1" : "min-h-[5.5rem] max-h-[38%] shrink-0",
  ),
);

const collapseScriptsListPanel = () => {
  collapsedScriptsPanel.value = "scripts";
};

const collapseScriptsTerminalPanel = () => {
  collapsedScriptsPanel.value = "terminal";
};

const expandScriptsPanels = () => {
  collapsedScriptsPanel.value = null;
};

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
  <div class="relative flex h-full min-h-0 flex-col gap-3 overflow-visible">
    <button
      v-if="isScriptsListPanelCollapsed"
      type="button"
      class="flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-surface-container-low shadow-sm"
      title="展开脚本列表"
      aria-label="展开脚本列表"
      @click="expandScriptsPanels"
    >
      <span
        class="flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface hover:text-primary"
      >
        <ChevronDown :size="14" />
      </span>
    </button>

    <div
      v-else-if="scripts.length === 0"
      class="rounded-lg border border-dashed border-border-subtle bg-surface p-6 text-sm text-on-surface-variant"
    >
      {{ t.projectDetails.noScripts }}
    </div>

    <div v-else :class="scriptListPanelFrameClass">
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
          <div class="font-mono text-xs font-bold text-on-surface truncate" :title="script.name">{{ script.name }}</div>
          <div class="text-[10px] text-on-surface-variant truncate" :title="script.note || script.source">
            {{ script.note || script.source }}
          </div>
        </div>
        <div
          :class="
            cn(
              'px-2 py-0.5 rounded-full text-[9px] font-bold border justify-self-start',
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
      <div
        v-if="showScriptsCollapseControls"
        class="pointer-events-none absolute bottom-0 left-1/2 z-30 -translate-x-1/2 translate-y-[calc(50%+0.375rem)]"
      >
        <div
          class="pointer-events-auto flex flex-col items-center overflow-hidden rounded-full border border-outline-variant/70 bg-surface-container-high shadow-md"
        >
          <button
            type="button"
            class="flex h-3.5 w-4 items-center justify-center border-b border-border-subtle text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
            title="收起上方脚本列表"
            aria-label="收起上方脚本列表"
            @click.stop="collapseScriptsListPanel"
          >
            <ChevronUp :size="8" />
          </button>
          <button
            type="button"
            class="flex h-3.5 w-4 items-center justify-center text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
            title="收起下方终端面板"
            aria-label="收起下方终端面板"
            @click.stop="collapseScriptsTerminalPanel"
          >
            <ChevronDown :size="8" />
          </button>
        </div>
      </div>
    </div>

    <button
      v-if="isScriptsTerminalPanelCollapsed"
      type="button"
      class="flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-surface-container-low shadow-sm"
      title="展开终端面板"
      aria-label="展开终端面板"
      @click="expandScriptsPanels"
    >
      <span
        class="flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface hover:text-primary"
      >
        <ChevronUp :size="14" />
      </span>
    </button>

    <div v-else class="min-h-0 flex-1">
      <Terminal :projectId="project.id" :scripts="project.scripts" />
    </div>
  </div>
</template>
