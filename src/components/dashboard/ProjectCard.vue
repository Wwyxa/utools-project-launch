<script setup lang="ts">
import { computed } from "vue";
import {
  Play,
  Square,
  Clock,
  AlertTriangle,
  FolderOpen,
  Pencil,
  TerminalSquare,
  Trash2,
} from "lucide-vue-next";
import { Project, ProjectStatus } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  (e: "select", id: string): void;
}>();

const store = useStore();
const t = useI18n();

const isRunning = computed(() => props.project.status === ProjectStatus.RUNNING);
const isError = computed(() => props.project.status === ProjectStatus.ERROR);
const runningScripts = computed(() => props.project.scripts.filter((script) => script.status === "RUNNING"));
const visibleScripts = computed(() => {
  const runningIds = new Set(runningScripts.value.map((script) => script.id));
  return [...runningScripts.value, ...props.project.scripts.filter((script) => !runningIds.has(script.id))].slice(0, 3);
});
const hiddenRunningCount = computed(
  () => runningScripts.value.filter((script) => !visibleScripts.value.some((visible) => visible.id === script.id)).length,
);
const hiddenScriptCount = computed(() => props.project.scripts.length - visibleScripts.value.length);

const handleCardSelect = () => {
  emit("select", props.project.id);
};

const handleEdit = (event: MouseEvent) => {
  event.stopPropagation();
  store.openEditProjectForm(props.project.id);
};

const handleOpenFolder = async (event: MouseEvent) => {
  event.stopPropagation();
  await store.openProjectFolder(props.project.id);
};

const handleOpenTerminal = async (event: MouseEvent) => {
  event.stopPropagation();
  await store.openProjectInTerminal(props.project.id);
};

const handleScriptToggle = async (event: MouseEvent, scriptId: string, status: string) => {
  event.stopPropagation();
  if (status === "RUNNING") {
    await store.stopScript(props.project.id, scriptId);
    return;
  }
  await store.launchScript(props.project.id, scriptId);
};

const handleDelete = (event: MouseEvent) => {
  event.stopPropagation();
  store.requestDeleteProject(props.project.id);
};
</script>

<template>
  <div
    @click="handleCardSelect"
    class="group relative border border-border-subtle rounded-lg bg-surface hover:bg-surface-container transition-all cursor-pointer overflow-hidden"
  >
    <div class="p-3">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 min-w-0">
            <h3 class="min-w-0 truncate text-sm font-bold text-on-surface group-hover:text-primary transition-colors">
              {{ project.name }}
            </h3>
            <span
              class="shrink-0 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-surface-variant text-on-surface-variant"
            >
              {{ t.projectKinds[project.kind] }}
            </span>
          </div>
          <p class="font-mono text-[11px] text-on-surface-variant mt-1 max-w-full truncate">{{ project.path }}</p>
        </div>

        <div
          :class="
            cn(
              'shrink-0 inline-flex max-w-[5rem] items-center gap-1 px-1.5 py-1 rounded-full text-[10px] font-bold uppercase whitespace-nowrap',
              isRunning
                ? 'bg-status-running/10 text-status-running'
                : isError
                  ? 'bg-status-error/10 text-status-error'
                  : 'bg-surface-container text-status-stopped border border-border-subtle',
            )
          "
        >
          <span
            :class="
              cn(
                'w-1.5 h-1.5 rounded-full',
                isRunning ? 'bg-status-running' : isError ? 'bg-status-error' : 'bg-status-stopped',
              )
            "
          />
          <span class="truncate">
            {{ isRunning ? t.common.running : project.status === ProjectStatus.ERROR ? t.common.error : t.common.stopped }}
          </span>
        </div>
      </div>

      <p v-if="project.description" class="text-xs text-on-surface-variant mt-2 line-clamp-1">
        {{ project.description }}
      </p>

      <div class="flex gap-1 mt-2 flex-wrap min-h-6">
        <button
          v-for="script in visibleScripts"
          :key="script.id"
          :title="script.command"
          @click="handleScriptToggle($event, script.id, script.status)"
          :class="
            cn(
              'inline-flex max-w-[9rem] items-center gap-1 text-[10px] uppercase font-bold px-2 py-1 rounded border truncate transition-colors',
              script.status === 'RUNNING'
                ? 'text-status-running bg-status-running/10 border-status-running/30 hover:bg-status-running/15'
                : 'text-on-surface-variant bg-surface-variant border-transparent hover:text-on-surface hover:bg-surface-container-high',
            )
          "
        >
          <Square v-if="script.status === 'RUNNING'" :size="8" class="shrink-0" fill="currentColor" />
          <Play v-else :size="9" class="shrink-0" fill="currentColor" />
          <span class="truncate">{{ script.name }}</span>
        </button>
        <span
          v-if="hiddenScriptCount > 0"
          class="text-[10px] font-bold text-on-surface-variant bg-surface-variant px-2 py-1 rounded"
          :title="hiddenRunningCount > 0 ? t.projectActions.moreRunning.replace('{count}', String(hiddenRunningCount)) : undefined"
        >
          +{{ hiddenScriptCount }}
        </span>
      </div>

      <div class="mt-2 flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
        <div class="flex items-center gap-1.5 text-xs text-on-surface-variant min-w-0">
          <span v-if="isError" class="flex items-center gap-1 text-status-error truncate">
            <AlertTriangle :size="12" class="shrink-0" /> {{ project.git?.statusText || "Exit code 1" }}
          </span>
          <span v-else class="flex items-center gap-1 truncate">
            <Clock :size="12" class="shrink-0" /> {{ project.lastUpdated || project.git?.lastRefreshedAt || "--" }}
          </span>
        </div>
        <div class="shrink-0 flex items-center gap-0.5" @click.stop>
          <button
            @click.stop="handleOpenTerminal"
            class="p-1 text-on-surface-variant hover:text-status-running rounded hover:bg-surface transition-colors"
            :title="t.projectActions.openInTerminal"
            :aria-label="t.projectActions.openInTerminal"
          >
            <TerminalSquare :size="15" />
          </button>
          <button
            @click.stop="handleOpenFolder"
            class="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface transition-colors"
            :title="t.common.openFolder"
            :aria-label="t.common.openFolder"
          >
            <FolderOpen :size="15" />
          </button>
          <button
            @click.stop="handleEdit"
            class="p-1 text-on-surface-variant hover:text-primary rounded hover:bg-surface transition-colors"
            :title="t.common.edit"
            :aria-label="t.common.edit"
          >
            <Pencil :size="15" />
          </button>
          <button
            @click.stop="handleDelete"
            class="p-1 text-on-surface-variant hover:text-status-error rounded hover:bg-surface transition-colors"
            :title="t.projectActions.deleteProject"
            :aria-label="t.projectActions.deleteProject"
          >
            <Trash2 :size="15" />
          </button>
        </div>
      </div>
    </div>

    <div
      :class="
        cn(
          'absolute left-0 top-0 bottom-0 w-1',
          isRunning ? 'bg-status-running' : isError ? 'bg-status-error' : 'transparent',
        )
      "
    />
  </div>
</template>
