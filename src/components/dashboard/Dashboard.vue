<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useStore } from "../../store/useStore";
import ProjectCard from "./ProjectCard.vue";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Search, RefreshCw, Plus, Settings, ChevronDown, ArrowUpDown, MonitorCog } from "lucide-vue-next";

const store = useStore();
const t = useI18n();

const searchQuery = ref("");
const isRefreshingProjects = ref(false);
const isSortingProjects = ref(false);
const draggingProjectId = ref<string | null>(null);
const projects = computed(() => {
  const source = store.availableProjects;
  if (!searchQuery.value) return source;
  const q = searchQuery.value.toLowerCase();
  return source.filter(
    (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.type.toLowerCase().includes(q),
  );
});
const unavailableProjects = computed(() => {
  const source = store.unavailableProjects;
  if (!searchQuery.value) return source;
  const q = searchQuery.value.toLowerCase();
  return source.filter(
    (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.type.toLowerCase().includes(q),
  );
});
const hasVisibleProjects = computed(() => projects.value.length > 0 || unavailableProjects.value.length > 0);

const handleRefreshAll = async () => {
  if (isRefreshingProjects.value) {
    return;
  }

  isRefreshingProjects.value = true;
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    await store.refreshProjects();
  } finally {
    isRefreshingProjects.value = false;
  }
};

const toggleSortingProjects = () => {
  if (hasVisibleProjects.value) {
    isSortingProjects.value = !isSortingProjects.value;
    draggingProjectId.value = null;
  }
};

const handleProjectDragStart = (event: DragEvent, projectId: string) => {
  if (!isSortingProjects.value || !event.dataTransfer) {
    return;
  }

  draggingProjectId.value = projectId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", projectId);
};

const handleProjectDragOver = (event: DragEvent) => {
  if (isSortingProjects.value && draggingProjectId.value) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }
};

const handleProjectDrop = (event: DragEvent, targetProjectId: string, source: { id: string }[]) => {
  event.preventDefault();
  const projectId = draggingProjectId.value || event.dataTransfer?.getData("text/plain") || "";
  draggingProjectId.value = null;
  if (!projectId || projectId === targetProjectId) {
    return;
  }

  void store.reorderProject(
    projectId,
    targetProjectId,
    source.map((project) => project.id),
  );
};

const handleProjectDragEnd = () => {
  draggingProjectId.value = null;
};
</script>

<template>
  <div class="min-h-full">
    <div class="dashboard-toolbar sticky top-0 z-20 px-6 py-2">
      <div class="flex items-center justify-between gap-4">
        <div class="relative flex-1 max-w-md">
          <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t.common.search"
            class="toolbar-search pl-9 pr-4 py-1.5 rounded-lg text-sm w-full transition-all"
          />
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="hasVisibleProjects"
            @click="toggleSortingProjects"
            :class="
              cn(
                'toolbar-icon-button h-8 px-2 rounded-lg flex items-center gap-1.5 transition-colors',
                isSortingProjects && '!bg-primary !text-on-primary !border-primary hover:!bg-primary/90',
              )
            "
            :title="isSortingProjects ? t.dashboard.finishSorting : t.dashboard.sortProjects"
            :aria-label="isSortingProjects ? t.dashboard.finishSorting : t.dashboard.sortProjects"
            :aria-pressed="isSortingProjects"
          >
            <ArrowUpDown :size="16" />
            <span class="text-xs font-semibold">{{
              isSortingProjects ? t.dashboard.doneSorting : t.dashboard.sort
            }}</span>
          </button>
          <button
            @click="store.setActiveTab('environment')"
            class="toolbar-icon-button p-1.5 rounded-lg transition-colors"
            :title="t.environment.title"
            :aria-label="t.environment.title"
          >
            <MonitorCog :size="18" />
          </button>
          <button
            @click="store.setActiveTab('settings')"
            class="toolbar-icon-button p-1.5 rounded-lg transition-colors"
            :title="t.sidebar.settings"
            :aria-label="t.sidebar.settings"
          >
            <Settings :size="18" />
          </button>
          <button
            @click="handleRefreshAll"
            :disabled="isRefreshingProjects"
            :class="
              cn(
                'toolbar-icon-button h-8 rounded-lg transition-colors disabled:cursor-wait disabled:opacity-90',
                isRefreshingProjects
                  ? 'px-2 flex items-center gap-1.5 !border-primary/35 !bg-primary/10 !text-primary'
                  : 'p-1.5',
              )
            "
            :title="isRefreshingProjects ? t.common.refreshing : t.common.refresh"
            :aria-label="isRefreshingProjects ? t.common.refreshing : t.common.refresh"
          >
            <RefreshCw :size="18" :class="isRefreshingProjects && 'animate-spin'" />
            <span v-if="isRefreshingProjects" class="text-xs font-semibold leading-none">{{
              t.common.refreshing
            }}</span>
          </button>
          <button
            @click="store.openCreateProjectForm"
            class="toolbar-primary-button p-1.5 rounded-lg flex items-center justify-center transition-colors"
            :title="t.dashboard.createHint"
            :aria-label="t.dashboard.createHint"
          >
            <Plus :size="18" />
          </button>
        </div>
      </div>
    </div>

    <p v-if="store.projectStorageMessage" class="px-6 pt-3 text-xs text-on-surface-variant">
      {{ store.projectStorageMessage }}
    </p>

    <div
      v-if="projects.length === 0 && unavailableProjects.length === 0"
      class="m-6 border border-dashed border-border-subtle rounded-xl p-8 text-center"
    >
      <p class="text-sm text-on-surface-variant mb-4">{{ t.dashboard.empty }}</p>
      <button
        @click="store.openCreateProjectForm"
        class="toolbar-primary-button px-4 py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm"
      >
        {{ t.dashboard.createHint }}
      </button>
    </div>

    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] items-stretch gap-2.5 px-5 pt-3 pb-5">
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        :is-sorting="isSortingProjects"
        :is-dragging="draggingProjectId === project.id"
        :draggable="isSortingProjects"
        @dragstart="handleProjectDragStart($event, project.id)"
        @dragover="handleProjectDragOver"
        @drop="handleProjectDrop($event, project.id, projects)"
        @dragend="handleProjectDragEnd"
        @select="store.setSelectedProject"
      />
    </div>

    <details
      v-if="unavailableProjects.length > 0"
      class="mx-6 mb-6 rounded-lg border border-border-subtle bg-surface-container-low"
    >
      <summary
        class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold text-on-surface [&::-webkit-details-marker]:hidden"
      >
        <span>{{ t.dashboard.unavailableProjects }} ({{ unavailableProjects.length }})</span>
        <ChevronDown :size="16" class="text-on-surface-variant" />
      </summary>
      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] items-stretch gap-2.5 border-t border-border-subtle p-3"
      >
        <ProjectCard
          v-for="project in unavailableProjects"
          :key="project.id"
          :project="project"
          :is-sorting="isSortingProjects"
          :is-dragging="draggingProjectId === project.id"
          :draggable="isSortingProjects"
          @dragstart="handleProjectDragStart($event, project.id)"
          @dragover="handleProjectDragOver"
          @drop="handleProjectDrop($event, project.id, unavailableProjects)"
          @dragend="handleProjectDragEnd"
          @select="store.openEditProjectForm"
        />
      </div>
    </details>
  </div>
</template>
