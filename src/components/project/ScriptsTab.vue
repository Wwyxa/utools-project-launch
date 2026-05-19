<script setup lang="ts">
import { computed } from "vue";
import { ListStart, Play, Square } from "lucide-vue-next";
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
const canRunAll = computed(() => scripts.value.some((script) => script.status !== "RUNNING" && script.command.trim()));

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

const handleRunAll = async () => {
  if (isUnavailable.value || !canRunAll.value) {
    return;
  }
  await store.launchAllScripts(props.project.id);
};
</script>

<template>
  <div class="flex flex-col gap-3 min-h-full">
    <div v-if="scripts.length > 0" class="flex justify-end">
      <button
        type="button"
        @click="handleRunAll"
        :disabled="isUnavailable || !canRunAll"
        class="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary-container px-3 py-1.5 text-xs font-bold text-on-primary shadow-sm transition-all hover:bg-primary disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-container disabled:text-on-surface-variant disabled:shadow-none"
      >
        <ListStart :size="14" /> {{ t.scripts.startAll }}
      </button>
    </div>

    <div
      v-if="scripts.length === 0"
      class="border border-dashed border-border-subtle rounded-lg p-6 text-sm text-on-surface-variant bg-surface"
    >
      {{ t.projectDetails.noScripts }}
    </div>

    <div v-else class="border border-border-subtle rounded-lg overflow-hidden bg-surface shadow-sm">
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
          {{ script.status }}
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

    <Terminal :projectId="project.id" :scripts="project.scripts" />
  </div>
</template>
