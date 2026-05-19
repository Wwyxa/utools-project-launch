<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "../../store/useStore";
import ProjectCard from "./ProjectCard.vue";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Search, RefreshCw, Plus, Settings, ChevronDown, ArrowUpDown } from "lucide-vue-next";

const store = useStore();
const t = useI18n();

const searchQuery = ref("");
const isSortingProjects = ref(false);
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

const handleRefreshAll = () => {
  store.refreshProjects();
};

const toggleSortingProjects = () => {
  if (hasVisibleProjects.value) {
    isSortingProjects.value = !isSortingProjects.value;
  }
};

const getProjectOrderState = (projectId: string, source: { id: string }[]) => {
  const index = source.findIndex((project) => project.id === projectId);
  return {
    canMoveTop: index > 0,
    canMoveUp: index > 0,
    canMoveDown: index >= 0 && index < source.length - 1,
  };
};

const handleMoveProject = (projectId: string, direction: "top" | "up" | "down", source: { id: string }[]) => {
  void store.moveProject(
    projectId,
    direction,
    source.map((project) => project.id),
  );
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
            @click="store.setActiveTab('settings')"
            class="toolbar-icon-button p-1.5 rounded-lg transition-colors"
            :title="t.sidebar.settings"
            :aria-label="t.sidebar.settings"
          >
            <Settings :size="18" />
          </button>
          <button
            @click="handleRefreshAll"
            class="toolbar-icon-button p-1.5 rounded-lg transition-colors"
            :title="t.common.refresh"
            :aria-label="t.common.refresh"
          >
            <RefreshCw :size="18" />
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

    <div v-else class="grid grid-cols-1 items-start md:grid-cols-2 lg:grid-cols-3 gap-3 px-6 pt-4 pb-6">
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        :is-sorting="isSortingProjects"
        v-bind="getProjectOrderState(project.id, projects)"
        @select="store.setSelectedProject"
        @move="(projectId, direction) => handleMoveProject(projectId, direction, projects)"
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
      <div class="grid grid-cols-1 items-start md:grid-cols-2 lg:grid-cols-3 gap-3 border-t border-border-subtle p-3">
        <ProjectCard
          v-for="project in unavailableProjects"
          :key="project.id"
          :project="project"
          :is-sorting="isSortingProjects"
          v-bind="getProjectOrderState(project.id, unavailableProjects)"
          @select="store.openEditProjectForm"
          @move="(projectId, direction) => handleMoveProject(projectId, direction, unavailableProjects)"
        />
      </div>
    </details>
  </div>
</template>
