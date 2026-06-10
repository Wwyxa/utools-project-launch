<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useStore } from "../../store/useStore";
import ProjectCard from "./ProjectCard.vue";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { Project } from "../../types";
import { Search, RefreshCw, Plus, Settings, ChevronDown, ArrowUpDown, MonitorCog } from "lucide-vue-next";

const store = useStore();
const t = useI18n();

const searchQuery = ref("");
const isRefreshingProjects = ref(false);
const isSortingProjects = ref(false);
const draggingProjectId = ref<string | null>(null);
const selectedProjectGroupKey = ref("all");
const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase());

interface ProjectGroupFilter {
  key: string;
  label: string;
  count: number;
}

const projectMatchesSearch = (project: Project, query: string) =>
  project.name.toLowerCase().includes(query) ||
  project.path.toLowerCase().includes(query) ||
  project.type.toLowerCase().includes(query);

const projectGroupKey = (groupName: string) => (groupName ? `group:${groupName}` : "ungrouped");
const projectGroupName = (project: Project) => project.group?.trim() || "";

const searchedAvailableProjects = computed(() => {
  const query = normalizedSearchQuery.value;
  if (!query) return store.availableProjects;
  return store.availableProjects.filter((project) => projectMatchesSearch(project, query));
});
const projects = computed(() => {
  if (selectedProjectGroupKey.value === "all") {
    return searchedAvailableProjects.value;
  }

  return searchedAvailableProjects.value.filter(
    (project) => projectGroupKey(projectGroupName(project)) === selectedProjectGroupKey.value,
  );
});
const unavailableProjects = computed(() => {
  const source = store.unavailableProjects;
  const query = normalizedSearchQuery.value;
  if (!query) return source;
  return source.filter((project) => projectMatchesSearch(project, query));
});
const projectGroupFilters = computed<ProjectGroupFilter[]>(() => {
  const filteredCounts = new Map<string, number>();
  searchedAvailableProjects.value.forEach((project) => {
    const key = projectGroupKey(projectGroupName(project));
    filteredCounts.set(key, (filteredCounts.get(key) || 0) + 1);
  });

  const filters = new Map<string, ProjectGroupFilter>();
  store.availableProjects.forEach((project) => {
    const groupName = projectGroupName(project);
    const key = projectGroupKey(groupName);
    const existingFilter = filters.get(key);
    if (existingFilter) {
      return;
    }

    filters.set(key, {
      key,
      label: groupName || t.value.dashboard.ungroupedProjects,
      count: filteredCounts.get(key) || 0,
    });
  });

  return [
    { key: "all", label: t.value.common.all, count: searchedAvailableProjects.value.length },
    ...Array.from(filters.values()),
  ];
});
const visibleProjectIds = computed(() => projects.value.map((project) => project.id));
const hasProjectGroupFilters = computed(() => projectGroupFilters.value.length > 1);
const hasSortableProjects = computed(() => projects.value.length > 0);
const hasSearchQuery = computed(() => normalizedSearchQuery.value.length > 0);
const hasFilteredOutProjects = computed(
  () =>
    hasSearchQuery.value &&
    store.visibleProjects.length > 0 &&
    projects.value.length === 0 &&
    unavailableProjects.value.length === 0,
);
const activeProjectGroupLabel = computed(
  () =>
    projectGroupFilters.value.find((filter) => filter.key === selectedProjectGroupKey.value)?.label ||
    t.value.common.all,
);
const selectProjectGroup = (groupKey: string) => {
  selectedProjectGroupKey.value = groupKey;
};

watch(projectGroupFilters, (filters) => {
  if (!filters.some((filter) => filter.key === selectedProjectGroupKey.value)) {
    selectedProjectGroupKey.value = "all";
  }
});

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
  if (hasSortableProjects.value) {
    isSortingProjects.value = !isSortingProjects.value;
    draggingProjectId.value = null;
  }
};

watch(visibleProjectIds, (projectIds) => {
  if (projectIds.length === 0) {
    isSortingProjects.value = false;
    draggingProjectId.value = null;
  }
});

const showProjectGroupBadge = computed(() => selectedProjectGroupKey.value === "all" && hasProjectGroupFilters.value);

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

const handleProjectDrop = (event: DragEvent, targetProjectId: string, visibleProjectIds: string[]) => {
  event.preventDefault();
  const projectId = draggingProjectId.value || event.dataTransfer?.getData("text/plain") || "";
  draggingProjectId.value = null;
  if (!projectId || projectId === targetProjectId) {
    return;
  }

  void store.reorderProject(projectId, targetProjectId, visibleProjectIds);
};

const handleProjectDragEnd = () => {
  draggingProjectId.value = null;
};
</script>

<template>
  <div class="min-h-full">
    <div class="dashboard-toolbar sticky top-0 z-20 px-6 pt-3">
      <div class="flex flex-col gap-2">
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
              v-if="hasSortableProjects"
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
        <div v-if="hasProjectGroupFilters" class="flex min-w-0 items-center gap-1.5 overflow-x-auto">
          <button
            v-for="filter in projectGroupFilters"
            :key="filter.key"
            type="button"
            @click="selectProjectGroup(filter.key)"
            :class="
              cn(
                'dashboard-filter-chip inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-colors',
                selectedProjectGroupKey === filter.key && 'is-active',
              )
            "
            :aria-pressed="selectedProjectGroupKey === filter.key"
            :title="filter.label"
          >
            <span class="max-w-32 truncate">{{ filter.label }}</span>
            <span
              :class="
                cn(
                  'dashboard-filter-chip-count inline-flex min-w-5 justify-center rounded-full px-1.5 py-px text-[10px] font-bold leading-4',
                  selectedProjectGroupKey === filter.key && 'is-active',
                )
              "
            >
              {{ filter.count }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <p v-if="store.projectStorageMessage" class="px-6 pt-3 text-xs text-on-surface-variant">
      {{ store.projectStorageMessage }}
    </p>

    <div
      v-if="store.visibleProjects.length === 0"
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

    <div
      v-if="projects.length > 0"
      class="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] items-stretch gap-2.5 px-5 pt-2 pb-5"
    >
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        :is-sorting="isSortingProjects"
        :is-dragging="draggingProjectId === project.id"
        :show-group-badge="showProjectGroupBadge"
        :group-label="projectGroupName(project) || t.dashboard.ungroupedProjects"
        :draggable="isSortingProjects"
        @dragstart="handleProjectDragStart($event, project.id)"
        @dragover="handleProjectDragOver"
        @drop="handleProjectDrop($event, project.id, visibleProjectIds)"
        @dragend="handleProjectDragEnd"
        @select="store.setSelectedProject"
      />
    </div>

    <div
      v-else-if="hasFilteredOutProjects"
      class="m-6 border border-dashed border-border-subtle rounded-xl p-6 text-center"
    >
      <p class="text-sm text-on-surface-variant">
        {{ t.dashboard.noProjectsFound }}
      </p>
    </div>

    <div
      v-else-if="store.availableProjects.length > 0"
      class="m-6 border border-dashed border-border-subtle rounded-xl p-6 text-center"
    >
      <p class="text-sm text-on-surface-variant">
        {{ t.dashboard.noProjectsInFilter.replace("{group}", activeProjectGroupLabel) }}
      </p>
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
          :is-sorting="false"
          :draggable="false"
          @select="store.openEditProjectForm"
        />
      </div>
    </details>
  </div>
</template>
