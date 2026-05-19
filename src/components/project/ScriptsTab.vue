<script setup lang="ts">
import { computed } from "vue";
import { Play, Square } from "lucide-vue-next";
import { Project } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import Terminal from "../terminal/Terminal.vue";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();

const scripts = computed(() => props.project.scripts);
const isUnavailable = computed(() => props.project.pathExists === false);

const scriptStatusLabel = (status: Project["scripts"][number]["status"]) => {
  if (status === "RUNNING") return t.value.common.running;
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
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
    <div
      v-if="scripts.length === 0"
      class="border border-dashed border-border-subtle rounded-lg p-6 text-sm text-on-surface-variant bg-surface"
    >
      {{ t.projectDetails.noScripts }}
    </div>

    <div v-else class="max-h-[38%] shrink-0 overflow-auto rounded-lg border border-border-subtle bg-surface shadow-sm themed-scrollbar">
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

    <div class="min-h-0 flex-1">
      <Terminal :projectId="project.id" :scripts="project.scripts" />
    </div>
  </div>
</template>
