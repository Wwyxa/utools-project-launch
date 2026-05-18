<script setup lang="ts">
import { computed } from "vue";
import {
  Play,
  Square,
  RotateCcw,
  Terminal as TerminalIcon,
  Clock,
  AlertTriangle,
  FolderOpen,
  Pencil,
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
const visibleScripts = computed(() => props.project.scripts.slice(0, 2));

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

const handleRefresh = async (event: MouseEvent) => {
  event.stopPropagation();
  await store.refreshGitSnapshot(props.project.id);
};
</script>

<template>
  <div
    @click="handleCardSelect"
    class="group relative border border-border-subtle rounded-xl p-5 bg-surface hover:bg-bg-soft-gray transition-all cursor-pointer flex flex-col h-full overflow-hidden"
  >
    <div class="flex justify-between items-start mb-4 gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="text-lg font-bold text-on-surface group-hover:text-primary transition-colors truncate">
            {{ project.name }}
          </h3>
          <span
            class="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full bg-surface-variant text-on-surface-variant"
          >
            {{ t.projectKinds[project.kind] }}
          </span>
        </div>
        <p class="font-mono text-xs text-on-surface-variant mt-1 truncate">{{ project.path }}</p>
        <p v-if="project.description" class="text-xs text-on-surface-variant mt-2 line-clamp-2">
          {{ project.description }}
        </p>
        <div class="flex gap-1 mt-2 flex-wrap">
          <span
            v-for="script in visibleScripts"
            :key="script.id"
            class="text-[10px] uppercase font-bold text-on-surface-variant bg-surface-variant px-1.5 py-0.5 rounded"
          >
            {{ script.name }}
          </span>
          <span
            v-if="project.scripts.length > 2"
            class="text-[10px] font-bold text-on-surface-variant bg-surface-variant px-1.5 py-0.5 rounded"
          >
            +{{ project.scripts.length - 2 }}
          </span>
        </div>
      </div>

      <div
        :class="
          cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap',
            isRunning
              ? 'bg-status-running/10 text-status-running'
              : isError
                ? 'bg-status-error/10 text-status-error'
                : 'bg-bg-soft-gray text-status-stopped border border-border-subtle',
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
        {{ isRunning ? t.common.running : project.status === ProjectStatus.ERROR ? t.common.error : t.common.stopped }}
      </div>
    </div>

    <div class="mt-auto pt-4 flex items-center justify-between border-t border-border-subtle gap-3">
      <div class="flex items-center gap-1.5 text-xs text-on-surface-variant min-w-0">
        <span v-if="isError" class="flex items-center gap-1 text-status-error">
          <AlertTriangle :size="12" /> {{ project.git?.statusText || "Exit code 1" }}
        </span>
        <span v-else class="flex items-center gap-1 truncate">
          <Clock :size="12" /> {{ project.lastUpdated || project.git?.lastRefreshedAt || "--" }}
        </span>
      </div>

      <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          v-if="isRunning"
          @click.stop="store.selectedProjectId === project.id ? null : null"
          class="p-1.5 text-on-surface-variant hover:text-status-error rounded hover:bg-surface transition-colors"
          :title="t.common.stop"
        >
          <Square :size="16" fill="currentColor" />
        </button>
        <button
          v-else
          @click.stop="store.selectedProjectId = project.id"
          class="p-1.5 text-on-surface-variant hover:text-status-running rounded hover:bg-surface transition-colors"
          :title="t.common.start"
        >
          <Play :size="16" fill="currentColor" />
        </button>
        <button
          @click="handleRefresh"
          class="p-1.5 text-on-surface-variant hover:text-primary rounded hover:bg-surface transition-colors"
          :title="t.git.refresh"
        >
          <RotateCcw :size="16" />
        </button>
        <button
          @click="handleOpenFolder"
          class="p-1.5 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface transition-colors"
          :title="t.common.openFolder"
        >
          <FolderOpen :size="16" />
        </button>
        <button
          @click="handleEdit"
          class="p-1.5 text-on-surface-variant hover:text-primary rounded hover:bg-surface transition-colors"
          :title="t.common.edit"
        >
          <Pencil :size="16" />
        </button>
        <button
          class="p-1.5 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface transition-colors"
          :title="t.projectDetails.scripts"
        >
          <TerminalIcon :size="16" />
        </button>
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
