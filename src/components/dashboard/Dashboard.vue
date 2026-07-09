<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useStore } from "../../store/useStore";
import ProjectCard from "./ProjectCard.vue";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import type { Project, ProjectAutomationHistoryEntry } from "../../types";
import {
  Search,
  RefreshCw,
  Plus,
  Settings,
  ChevronDown,
  CalendarClock,
  X,
  Play,
  Eye,
  ArrowUpDown,
  MonitorCog,
  PackageOpen,
  Download,
  CheckSquare,
} from "lucide-vue-next";
import type { TodoItem } from "../../types";

const store = useStore();
const t = useI18n();

const searchQuery = ref("");
const isRefreshingProjects = ref(false);
const isSortingProjects = ref(false);
const automationOverviewOpen = ref(false);
const todoOverviewOpen = ref(false);
const automationOverviewFeedback = ref("");
const draggingProjectId = ref<string | null>(null);
const selectedProjectGroupKey = ref("all");
const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase());
let stopAppEscapeListener = () => {};

interface ProjectGroupFilter {
  key: string;
  label: string;
  count: number;
}

interface ProjectTodoGroup {
  project: Project;
  todos: TodoItem[];
}

const projectMatchesSearch = (project: Project, query: string) =>
  project.name.toLowerCase().includes(query) ||
  project.path.toLowerCase().includes(query) ||
  project.type.toLowerCase().includes(query);

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!automationOverviewOpen.value && !todoOverviewOpen.value) return;
  automationOverviewOpen.value = false;
  todoOverviewOpen.value = false;
  event.detail.handle();
};

onMounted(() => {
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});

onUnmounted(() => {
  stopAppEscapeListener();
});

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
const tinyProjects = computed(() => projects.value.filter((p) => p.cardStyle === "tiny"));
const regularProjects = computed(() => projects.value.filter((p) => p.cardStyle !== "tiny"));
const hasTinyProjects = computed(() => tinyProjects.value.length > 0);
const hasRegularProjects = computed(() => regularProjects.value.length > 0);
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
const automationHistoryTime = (entry: ProjectAutomationHistoryEntry) =>
  new Date(entry.endedAt || entry.startedAt || entry.plannedAt || 0).getTime();
const sortedAutomationHistory = (history: ProjectAutomationHistoryEntry[]) =>
  [...history].sort((left, right) => automationHistoryTime(right) - automationHistoryTime(left));
const automationTasks = computed(() =>
  store.visibleProjects.flatMap((project) =>
    (project.automationTasks || []).map((task) => {
      const entries = task.dailyPlans.flatMap((plan) => plan.entries);
      const runningEntry = entries.find((entry) => entry.status === "running") || null;
      return {
        project,
        task,
        runningEntry,
        currentStatus: runningEntry ? "running" : sortedAutomationHistory(task.history)[0]?.status || "pending",
        latestHistory: sortedAutomationHistory(task.history)[0],
        nextEntry: task.enabled
          ? entries
              .filter((entry) => entry.status === "pending" && new Date(entry.plannedAt).getTime() > Date.now())
              .sort((left, right) => new Date(left.plannedAt).getTime() - new Date(right.plannedAt).getTime())[0] ||
            null
          : null,
      };
    }),
  ),
);
const missedAutomationTasks = computed(() =>
  automationTasks.value
    .filter((item) => !item.runningEntry && item.latestHistory?.status === "missed")
    .sort(
      (left, right) =>
        new Date(right.latestHistory?.endedAt || right.latestHistory?.plannedAt || 0).getTime() -
        new Date(left.latestHistory?.endedAt || left.latestHistory?.plannedAt || 0).getTime(),
    ),
);
const automationProjectGroups = computed(() =>
  store.visibleProjects
    .map((project) => ({
      project,
      tasks: automationTasks.value.filter((item) => item.project.id === project.id),
    }))
    .filter((group) => group.tasks.length > 0),
);
const automationSummary = computed(() => {
  const enabled = automationTasks.value.filter((item) => item.task.enabled).length;
  const running = automationTasks.value.filter((item) => item.runningEntry).length;
  const failed = automationTasks.value.filter((item) => item.latestHistory?.status === "failed").length;
  const missed = automationTasks.value.filter((item) => item.latestHistory?.status === "missed").length;
  return { total: automationTasks.value.length, enabled, running, failed, missed };
});
const upcomingAutomationTasks = computed(() =>
  automationTasks.value
    .filter((item) => item.nextEntry)
    .sort(
      (left, right) =>
        new Date(left.nextEntry?.plannedAt || 0).getTime() - new Date(right.nextEntry?.plannedAt || 0).getTime(),
    )
    .slice(0, 6),
);
const recentAutomationTasks = computed(() =>
  automationTasks.value
    .filter((item) => item.latestHistory)
    .sort(
      (left, right) =>
        new Date(right.latestHistory?.endedAt || right.latestHistory?.plannedAt || 0).getTime() -
        new Date(left.latestHistory?.endedAt || left.latestHistory?.plannedAt || 0).getTime(),
    )
    .slice(0, 6),
);
const todoProjectGroups = computed<ProjectTodoGroup[]>(() =>
  store.visibleProjects
    .map((project) => ({
      project,
      todos: (store.todos[project.id] || project.todos || []).filter((todo) => !todo.completed),
    }))
    .filter((group) => group.todos.length > 0),
);
const openTodoCount = computed(() => todoProjectGroups.value.reduce((total, group) => total + group.todos.length, 0));

const automationStatusLabel = (status?: string) => {
  if (status === "completed") return t.value.automation.completed;
  if (status === "failed") return t.value.automation.failed;
  if (status === "skipped") return t.value.automation.skipped;
  if (status === "missed") return t.value.automation.missed;
  if (status === "running") return t.value.common.running;
  return t.value.automation.pending;
};

const automationStatusClass = (status?: string) =>
  status === "running"
    ? "border-status-info/30 bg-status-info/10 text-status-info"
    : status === "completed"
      ? "border-status-running/30 bg-status-running/10 text-status-running"
      : status === "failed"
        ? "border-status-error/30 bg-status-error/10 text-status-error"
        : status === "skipped" || status === "missed"
          ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
          : "border-border-subtle bg-surface text-on-surface-variant";

const isAutomationTaskRunning = (projectId: string, taskId: string) =>
  Boolean(automationTasks.value.find((item) => item.project.id === projectId && item.task.id === taskId)?.runningEntry);

const formatAutomationDateTime = (value?: string) => (value ? new Date(value).toLocaleString() : t.value.common.never);

const toggleTodoOverview = () => {
  todoOverviewOpen.value = !todoOverviewOpen.value;
  if (todoOverviewOpen.value) {
    automationOverviewOpen.value = false;
    automationOverviewFeedback.value = "";
  }
};

const toggleAutomationOverview = () => {
  automationOverviewOpen.value = !automationOverviewOpen.value;
  if (automationOverviewOpen.value) {
    todoOverviewOpen.value = false;
  }
};

const openProjectMemo = (projectId: string) => {
  todoOverviewOpen.value = false;
  store.openProjectMemo(projectId);
};

const completeTodo = (projectId: string, todoId: string) => {
  store.toggleTodo(projectId, todoId);
};

const openProjectAutomation = (projectId: string) => {
  automationOverviewOpen.value = false;
  automationOverviewFeedback.value = "";
  store.openProjectAutomation(projectId);
};

const runAutomationTaskNow = (projectId: string, taskId: string) => {
  const started = store.runAutomationTaskNow(projectId, taskId);
  automationOverviewFeedback.value = started ? t.value.automation.runStarted : t.value.automation.runBlocked;
};

const ignoreMissedAutomationTask = (projectId: string, taskId: string) => {
  void store.ignoreMissedAutomationTask(projectId, taskId);
};

const canRunAutomationTaskNow = (projectId: string, taskId: string) => {
  const project = store.visibleProjects.find((item) => item.id === projectId);
  const task = project?.automationTasks?.find((item) => item.id === taskId);
  return Boolean(task && task.scriptIds.length > 0 && !isAutomationTaskRunning(projectId, taskId));
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
              @click="toggleTodoOverview"
              :class="
                cn(
                  'toolbar-icon-button h-8 px-2 rounded-lg flex items-center gap-1.5 transition-colors',
                  todoOverviewOpen && '!bg-primary !text-on-primary !border-primary hover:!bg-primary/90',
                )
              "
              :title="t.dashboard.todoOverview"
              :aria-label="t.dashboard.todoOverview"
              :aria-pressed="todoOverviewOpen"
            >
              <CheckSquare :size="16" />
              <span class="text-xs font-semibold">{{ openTodoCount }}</span>
            </button>
            <button
              @click="toggleAutomationOverview"
              :class="
                cn(
                  'toolbar-icon-button h-8 px-2 rounded-lg flex items-center gap-1.5 transition-colors',
                  automationOverviewOpen && '!bg-primary !text-on-primary !border-primary hover:!bg-primary/90',
                )
              "
              :title="t.automation.overview"
              :aria-label="t.automation.overview"
              :aria-pressed="automationOverviewOpen"
            >
              <CalendarClock :size="16" />
              <span class="text-xs font-semibold">{{ automationSummary.enabled }}/{{ automationSummary.total }}</span>
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
              v-if="hasSortableProjects"
              @click="toggleSortingProjects"
              :class="
                cn(
                  'toolbar-icon-button p-1.5 rounded-lg transition-colors',
                  isSortingProjects && '!bg-primary !text-on-primary !border-primary hover:!bg-primary/90',
                )
              "
              :title="isSortingProjects ? t.dashboard.finishSorting : t.dashboard.sortProjects"
              :aria-label="isSortingProjects ? t.dashboard.finishSorting : t.dashboard.sortProjects"
              :aria-pressed="isSortingProjects"
            >
              <ArrowUpDown :size="18" />
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

    <Teleport to="body">
      <Transition name="scale">
        <div
          v-if="todoOverviewOpen"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          @click.self="todoOverviewOpen = false"
        >
          <section
            class="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-xl"
          >
            <div class="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
              <div class="min-w-0">
                <h2 class="text-sm font-bold text-on-surface">{{ t.dashboard.todoOverview }}</h2>
                <p class="mt-0.5 text-xs text-on-surface-variant">
                  {{
                    t.dashboard.todoSummary
                      .replace("{count}", String(openTodoCount))
                      .replace("{projects}", String(todoProjectGroups.length))
                  }}
                </p>
              </div>
              <button
                type="button"
                class="rounded-lg border border-border-subtle bg-surface-container-low p-1.5 text-on-surface-variant hover:bg-surface-variant"
                :title="t.common.close"
                :aria-label="t.common.close"
                @click="todoOverviewOpen = false"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="themed-scrollbar min-h-0 overflow-auto p-3">
              <div
                v-if="todoProjectGroups.length === 0"
                class="rounded-lg border border-dashed border-border-subtle px-3 py-6 text-center text-sm text-on-surface-variant"
              >
                {{ t.dashboard.todoEmpty }}
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="group in todoProjectGroups"
                  :key="group.project.id"
                  class="border-b border-[color:color-mix(in_srgb,var(--color-border-subtle)_38%,transparent)] pb-2 last:border-b-0 last:pb-0"
                >
                  <div class="flex items-center justify-between gap-2 px-1.5 py-1">
                    <button
                      type="button"
                      class="min-w-0 truncate text-left text-xs font-bold text-on-surface hover:text-primary"
                      :title="group.project.name"
                      @click="openProjectMemo(group.project.id)"
                    >
                      {{ group.project.name }}
                    </button>
                    <span
                      class="shrink-0 rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[10px] font-bold text-on-surface-variant"
                    >
                      {{ group.todos.length }}
                    </span>
                  </div>
                  <div class="space-y-0.5">
                    <div
                      v-for="todo in group.todos"
                      :key="todo.id"
                      class="flex items-start gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-[color:color-mix(in_srgb,var(--color-surface-container-high)_46%,transparent)]"
                    >
                      <input
                        type="checkbox"
                        :checked="todo.completed"
                        class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-outline-variant text-primary focus:ring-primary"
                        :aria-label="t.dashboard.completeTodo.replace('{todo}', todo.text)"
                        :title="t.dashboard.completeTodo.replace('{todo}', todo.text)"
                        @change="completeTodo(group.project.id, todo.id)"
                      />
                      <button
                        type="button"
                        class="min-w-0 flex-1 text-left"
                        :title="todo.text"
                        @click="openProjectMemo(group.project.id)"
                      >
                        <span class="line-clamp-2 break-words font-medium leading-5 text-on-surface">{{
                          todo.text
                        }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="scale">
        <div
          v-if="automationOverviewOpen"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          @click.self="automationOverviewOpen = false"
        >
          <section
            class="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-xl"
          >
            <div class="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
              <div class="min-w-0">
                <h2 class="text-sm font-bold text-on-surface">{{ t.automation.overview }}</h2>
                <p class="mt-0.5 text-xs text-on-surface-variant">
                  {{
                    t.automation.summary
                      .replace("{enabled}", String(automationSummary.enabled))
                      .replace("{total}", String(automationSummary.total))
                      .replace("{running}", String(automationSummary.running))
                      .replace("{failed}", String(automationSummary.failed))
                      .replace("{missed}", String(automationSummary.missed))
                  }}
                </p>
              </div>
              <button
                type="button"
                class="rounded-lg border border-border-subtle bg-surface-container-low p-1.5 text-on-surface-variant hover:bg-surface-variant"
                :title="t.common.close"
                :aria-label="t.common.close"
                @click="automationOverviewOpen = false"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="themed-scrollbar min-h-0 space-y-3 overflow-auto p-4">
              <p
                v-if="automationOverviewFeedback"
                class="rounded-lg border border-status-info/20 bg-status-info/10 px-3 py-2 text-xs font-semibold text-status-info"
              >
                {{ automationOverviewFeedback }}
              </p>
              <div
                v-if="missedAutomationTasks.length > 0"
                class="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3"
              >
                <div class="mb-2 flex items-center justify-between gap-2">
                  <div class="text-xs font-bold text-status-warning">{{ t.automation.missedTasks }}</div>
                  <span
                    class="rounded-full border border-status-warning/30 bg-surface px-2 py-0.5 text-[10px] font-bold text-status-warning"
                  >
                    {{ missedAutomationTasks.length }}
                  </span>
                </div>
                <div
                  v-for="item in missedAutomationTasks"
                  :key="`${item.project.id}-${item.task.id}-missed`"
                  class="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-2 py-2 text-xs"
                >
                  <button
                    type="button"
                    class="min-w-0 flex-1 text-left"
                    @click="openProjectAutomation(item.project.id)"
                  >
                    <span class="block truncate font-bold text-on-surface">{{ item.task.name }}</span>
                    <span class="block truncate text-on-surface-variant">
                      {{ item.project.name }} · {{ formatAutomationDateTime(item.latestHistory?.plannedAt) }}
                    </span>
                  </button>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="rounded-md border border-border-subtle bg-surface-container-low p-1.5 text-on-surface-variant hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                      :disabled="!canRunAutomationTaskNow(item.project.id, item.task.id)"
                      :title="t.automation.runNow"
                      :aria-label="t.automation.runNow"
                      @click="runAutomationTaskNow(item.project.id, item.task.id)"
                    >
                      <Play :size="13" />
                    </button>
                    <button
                      type="button"
                      class="rounded-md border border-border-subtle bg-surface-container-low p-1.5 text-on-surface-variant hover:bg-status-warning/10 hover:text-status-warning"
                      :title="t.automation.ignoreMissed"
                      :aria-label="t.automation.ignoreMissed"
                      @click="ignoreMissedAutomationTask(item.project.id, item.task.id)"
                    >
                      <X :size="13" />
                    </button>
                    <button
                      type="button"
                      class="rounded-md border border-border-subtle bg-surface-container-low p-1.5 text-on-surface-variant hover:bg-surface-variant"
                      :title="t.automation.viewTask"
                      :aria-label="t.automation.viewTask"
                      @click="openProjectAutomation(item.project.id)"
                    >
                      <Eye :size="13" />
                    </button>
                  </div>
                </div>
              </div>
              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded-lg border border-border-subtle bg-surface-container-low p-3">
                  <div class="mb-2 text-xs font-bold text-on-surface-variant">{{ t.automation.nextRun }}</div>
                  <div v-if="upcomingAutomationTasks.length === 0" class="text-xs text-on-surface-variant">
                    {{ t.common.noData }}
                  </div>
                  <button
                    v-for="item in upcomingAutomationTasks"
                    :key="`${item.project.id}-${item.task.id}-next`"
                    type="button"
                    class="mb-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-2 py-2 text-left text-xs transition-colors hover:bg-surface-variant"
                    @click="openProjectAutomation(item.project.id)"
                  >
                    <span class="min-w-0">
                      <span class="block truncate font-bold text-on-surface">{{ item.task.name }}</span>
                      <span class="block truncate text-on-surface-variant">{{ item.project.name }}</span>
                    </span>
                    <span class="shrink-0 font-mono text-[10px] text-on-surface-variant">{{
                      formatAutomationDateTime(item.nextEntry?.plannedAt)
                    }}</span>
                  </button>
                </div>
                <div class="rounded-lg border border-border-subtle bg-surface-container-low p-3">
                  <div class="mb-2 text-xs font-bold text-on-surface-variant">{{ t.automation.recentResults }}</div>
                  <div v-if="recentAutomationTasks.length === 0" class="text-xs text-on-surface-variant">
                    {{ t.common.noData }}
                  </div>
                  <button
                    v-for="item in recentAutomationTasks"
                    :key="`${item.project.id}-${item.task.id}-recent`"
                    type="button"
                    class="mb-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-2 py-2 text-left text-xs transition-colors hover:bg-surface-variant"
                    @click="openProjectAutomation(item.project.id)"
                  >
                    <span class="min-w-0">
                      <span class="block truncate font-bold text-on-surface">{{ item.task.name }}</span>
                      <span class="block truncate text-on-surface-variant">
                        {{ item.project.name }} ·
                        {{ formatAutomationDateTime(item.latestHistory?.endedAt || item.latestHistory?.plannedAt) }}
                      </span>
                      <span
                        v-if="item.latestHistory?.reason"
                        class="block truncate text-[10px] text-on-surface-variant"
                      >
                        {{ item.latestHistory.reason }}
                      </span>
                    </span>
                    <span
                      class="shrink-0 rounded-full border border-border-subtle bg-surface-container-low px-2 py-0.5 text-[10px] font-bold text-on-surface-variant"
                    >
                      {{ automationStatusLabel(item.latestHistory?.status) }}
                    </span>
                  </button>
                </div>
              </div>
              <div class="rounded-lg border border-border-subtle bg-surface-container-low p-3">
                <div class="mb-2 text-xs font-bold text-on-surface-variant">{{ t.automation.allTasks }}</div>
                <div v-if="automationProjectGroups.length === 0" class="text-xs text-on-surface-variant">
                  {{ t.common.noData }}
                </div>
                <div
                  v-for="group in automationProjectGroups"
                  :key="group.project.id"
                  class="mb-2 rounded-lg border border-border-subtle bg-surface p-2"
                >
                  <div class="mb-1.5 flex items-center gap-2">
                    <span class="truncate text-xs font-bold text-on-surface">{{ group.project.name }}</span>
                  </div>
                  <div class="space-y-1">
                    <div
                      v-for="item in group.tasks"
                      :key="`${item.project.id}-${item.task.id}-project`"
                      class="flex items-center justify-between gap-2 rounded-md bg-surface-container-low px-2 py-1.5 text-xs"
                    >
                      <span class="min-w-0">
                        <span class="block truncate font-semibold text-on-surface">{{ item.task.name }}</span>
                        <span class="block truncate text-[10px] text-on-surface-variant">
                          {{ formatAutomationDateTime(item.runningEntry?.plannedAt || item.nextEntry?.plannedAt) }}
                        </span>
                      </span>
                      <div class="flex shrink-0 items-center justify-end gap-1">
                        <span
                          :class="
                            cn(
                              'inline-flex min-w-14 items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold',
                              automationStatusClass(item.currentStatus),
                            )
                          "
                        >
                          <span
                            v-if="item.currentStatus === 'running'"
                            class="h-1.5 w-1.5 rounded-full bg-status-info animate-pulse"
                          />
                          {{ automationStatusLabel(item.currentStatus) }}
                        </span>
                        <button
                          type="button"
                          class="rounded-md border border-border-subtle bg-surface p-1.5 text-on-surface-variant hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                          :disabled="!canRunAutomationTaskNow(item.project.id, item.task.id)"
                          :title="t.automation.runNow"
                          :aria-label="t.automation.runNow"
                          @click="runAutomationTaskNow(item.project.id, item.task.id)"
                        >
                          <Play :size="12" />
                        </button>
                        <button
                          type="button"
                          class="rounded-md border border-border-subtle bg-surface p-1.5 text-on-surface-variant hover:bg-surface-variant"
                          :title="t.automation.viewTask"
                          :aria-label="t.automation.viewTask"
                          @click="openProjectAutomation(item.project.id)"
                        >
                          <Eye :size="12" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>

    <div
      v-if="store.visibleProjects.length === 0"
      class="m-6 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-subtle px-6 py-12 text-center"
    >
      <PackageOpen :size="40" class="text-primary/60" aria-hidden="true" />
      <h2 class="text-base font-bold text-on-surface">{{ t.dashboard.emptyTitle }}</h2>
      <p class="max-w-sm text-sm text-on-surface-variant">{{ t.dashboard.emptySubtitle }}</p>
      <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
        <button
          @click="store.openCreateProjectForm"
          class="toolbar-primary-button inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition-colors"
        >
          <Plus :size="16" aria-hidden="true" />
          {{ t.dashboard.createHint }}
        </button>
        <button
          @click="store.importProjectConfig"
          class="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
        >
          <Download :size="16" aria-hidden="true" />
          {{ t.dashboard.emptyImport }}
        </button>
      </div>
    </div>

    <!-- Project sections -->
    <div v-if="projects.length > 0">
      <!-- Tiny cards: compact grid row -->
      <div v-if="hasTinyProjects" class="px-5 pt-2" :class="{ 'pb-2': hasRegularProjects }">
        <div class="flex flex-wrap gap-2">
          <ProjectCard
            v-for="project in tinyProjects"
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
      </div>

      <!-- Regular cards: grid layout -->
      <div
        v-if="hasRegularProjects"
        class="grid gap-2.5 px-5 pt-2 pb-5"
        style="grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr))"
      >
        <ProjectCard
          v-for="project in regularProjects"
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
        class="grid gap-2.5 border-t border-border-subtle p-3"
        style="grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr))"
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
