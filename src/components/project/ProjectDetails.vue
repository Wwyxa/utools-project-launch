<script setup lang="ts">
import { computed, ref } from "vue";
import { ExternalLink, Folder, Pencil, ArrowLeft, RefreshCw, TerminalSquare, Trash2 } from "lucide-vue-next";
import { Project, ProjectStatus } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import ScriptsTab from "./ScriptsTab.vue";
import GitTab from "./GitTab.vue";
import MemoTab from "./MemoTab.vue";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();
type TabId = "info" | "scripts" | "git" | "memo";
const activeTab = ref<TabId>("scripts");

const tabs = computed<Array<{ id: TabId; label: string }>>(() => [
  { id: "info", label: t.value.projectDetails.overview },
  { id: "scripts", label: t.value.projectDetails.scripts },
  { id: "git", label: t.value.projectDetails.git },
  { id: "memo", label: t.value.projectDetails.memo },
]);

const statusLabel = computed(() => {
  if (props.project.status === ProjectStatus.RUNNING) {
    return t.value.common.running;
  }
  if (props.project.status === ProjectStatus.ERROR) {
    return t.value.common.error;
  }
  return t.value.common.stopped;
});
const isUnavailable = computed(() => props.project.pathExists === false);

const handleOpenFolder = () => store.openProjectFolder(props.project.id);
const handleOpenTerminal = () => store.openProjectInTerminal(props.project.id);
const handleEdit = () => store.openEditProjectForm(props.project.id);
const handleBack = () => store.setSelectedProject(null);
const handleRefresh = () => {
  if (!isUnavailable.value) {
    void store.refreshGitSnapshot(props.project.id);
  }
};
const handleDelete = () => {
  store.requestDeleteProject(props.project.id);
};
</script>

<template>
  <div class="p-4 flex-1 flex flex-col h-full overflow-hidden">
    <div class="mb-4 flex justify-between items-center gap-3">
      <div class="flex items-center gap-4 min-w-0">
        <button
          @click="handleBack"
          class="p-2 hover:bg-surface-variant rounded-lg text-on-surface-variant transition-all active:scale-90 border border-border-subtle bg-surface shadow-sm"
          :title="t.common.back"
        >
          <ArrowLeft :size="20" />
        </button>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-bold text-on-surface truncate">{{ project.name }}</h2>
            <span
              class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-variant text-on-surface-variant"
            >
              {{ t.projectKinds[project.kind] }}
            </span>
          </div>
          <div class="flex items-center gap-2 text-xs text-on-surface-variant mt-0.5">
            <span class="flex items-center gap-1"> <Folder :size="12" /> {{ project.path }} </span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <button
          @click="handleRefresh"
          :disabled="isUnavailable"
          class="p-2 text-on-surface-variant hover:bg-surface-variant rounded-lg transition-colors shadow-sm bg-surface border border-border-subtle"
          :title="t.common.refresh"
          :aria-label="t.common.refresh"
        >
          <RefreshCw :size="18" />
        </button>
        <button
          @click="handleOpenTerminal"
          :disabled="isUnavailable"
          class="bg-surface border border-border-subtle group text-on-surface hover:bg-surface-variant p-2 rounded-lg transition-all shadow-sm"
          :title="t.projectActions.openInTerminal"
          :aria-label="t.projectActions.openInTerminal"
        >
          <TerminalSquare :size="18" class="group-hover:text-primary" />
        </button>
        <button
          @click="handleOpenFolder"
          :disabled="isUnavailable"
          class="bg-surface border border-border-subtle group text-on-surface hover:bg-surface-variant p-2 rounded-lg transition-all shadow-sm"
          :title="t.projectDetails.openProject"
          :aria-label="t.projectDetails.openProject"
        >
          <ExternalLink :size="18" class="group-hover:text-primary" />
        </button>
        <button
          @click="handleEdit"
          class="bg-primary text-on-primary p-2 rounded-lg transition-all hover:bg-primary/90 shadow-sm"
          :title="t.common.edit"
          :aria-label="t.common.edit"
        >
          <Pencil :size="18" />
        </button>
        <button
          @click="handleDelete"
          class="bg-surface border border-border-subtle text-on-surface-variant hover:text-status-error hover:bg-status-error/10 p-2 rounded-lg transition-all shadow-sm"
          :title="t.projectActions.deleteProject"
          :aria-label="t.projectActions.deleteProject"
        >
          <Trash2 :size="18" />
        </button>
      </div>
    </div>

    <nav class="flex gap-5 border-b border-border-subtle mb-4 overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="activeTab = tab.id"
        :class="
          cn(
            'pb-2 text-sm font-bold transition-all relative whitespace-nowrap',
            activeTab === tab.id ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface',
          )
        "
      >
        {{ tab.label }}
        <div v-if="activeTab === tab.id" class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
      </button>
    </nav>

    <div class="flex-1 overflow-y-auto scrollbar-hide pr-1 space-y-4">
      <div v-if="activeTab === 'info'" class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 bg-surface border border-border-subtle rounded-lg p-4 space-y-3 shadow-sm">
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              {{ t.projectDetails.currentStatus }}
            </div>
            <p class="mt-1 text-sm text-on-surface-variant">{{ project.description || t.projectDetails.noScripts }}</p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div class="bg-surface-container-low rounded p-3 border border-border-subtle">
              <div class="text-xs font-bold uppercase text-on-surface-variant">{{ t.git.branch }}</div>
              <div class="mt-1 font-mono text-on-surface">{{ project.branch || "main" }}</div>
            </div>
            <div class="bg-surface-container-low rounded p-3 border border-border-subtle">
              <div class="text-xs font-bold uppercase text-on-surface-variant">{{ t.git.statusText }}</div>
              <div class="mt-1 text-on-surface">{{ project.git?.statusText || t.git.noRepo }}</div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="script in project.scripts"
              :key="script.id"
              class="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-variant text-on-surface-variant"
            >
              {{ script.name }}
            </span>
          </div>
        </div>

        <div class="space-y-4">
          <div class="bg-surface border border-border-subtle rounded-lg p-3 shadow-sm">
            <div class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">{{ t.common.status }}</div>
            <div class="mt-3 flex items-center gap-2 text-sm font-semibold">
              <span
                :class="[
                  'w-2 h-2 rounded-full',
                  project.status === ProjectStatus.RUNNING ? 'bg-status-running' : 'bg-status-stopped',
                ]"
              />
              {{ statusLabel }}
            </div>
          </div>
          <div class="bg-surface border border-border-subtle rounded-lg p-3 shadow-sm">
            <div class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              {{ t.common.lastUpdated }}
            </div>
            <div class="mt-3 text-sm text-on-surface-variant">{{ project.lastUpdated || t.common.never }}</div>
          </div>
        </div>
      </div>

      <ScriptsTab v-if="activeTab === 'scripts'" :project="project" />
      <GitTab v-if="activeTab === 'git'" :project="project" />
      <MemoTab v-if="activeTab === 'memo'" :project="project" />
    </div>
  </div>
</template>
