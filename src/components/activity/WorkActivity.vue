<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Users,
} from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { calendarYearGitActivityRange, gitActivityHeatmapCells, rollingGitActivityRange } from "../../lib/gitActivity";
import { cn } from "../../lib/utils";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import type { ProjectGitActivityDayReport } from "../../types";

type ActivityRangeMode = "rolling" | "year";

const store = useStore();
const t = useI18n();
const rangeMode = ref<ActivityRangeMode>("rolling");
const selectedYear = ref(new Date().getFullYear());
const selectedAuthorId = ref("");
const selectedDate = ref("");
const projectScopeOpen = ref(false);
const authorPickerOpen = ref(false);
const dayDetails = ref<ProjectGitActivityDayReport | null>(null);
const dayDetailsLoading = ref(false);
const dayDetailsMessage = ref("");
let dayDetailsRequestGeneration = 0;
let stopAppEscapeListener = () => {};

const activityRange = computed(() =>
  rangeMode.value === "year" ? calendarYearGitActivityRange(selectedYear.value) : rollingGitActivityRange(),
);
const readyRepositories = computed(() =>
  (store.workActivityReport?.repositories || []).filter((repository) => repository.state === "ready"),
);
const failedRepositories = computed(() =>
  (store.workActivityReport?.repositories || []).filter((repository) => repository.state === "failed"),
);
const projectsByPath = computed(() => new Map(store.projects.map((project) => [project.path, project])));
const authors = computed(() => {
  const values = new Map<string, { id: string; name: string; commits: number }>();
  readyRepositories.value.forEach((repository) => {
    repository.authors.forEach((author) => {
      const existing = values.get(author.id) || { ...author, commits: 0 };
      existing.commits += author.commits;
      values.set(author.id, existing);
    });
  });
  return [...values.values()].sort(
    (left, right) => right.commits - left.commits || left.name.localeCompare(right.name),
  );
});
const selectedAuthor = computed(() => authors.value.find((author) => author.id === selectedAuthorId.value) || null);
const countsByDate = computed(() => {
  const counts = new Map<string, number>();
  readyRepositories.value.forEach((repository) => {
    repository.daily.forEach((day) => {
      const commits = selectedAuthorId.value ? day.authors[selectedAuthorId.value] || 0 : day.commits;
      if (commits > 0) counts.set(day.date, (counts.get(day.date) || 0) + commits);
    });
  });
  return counts;
});
const heatmapCells = computed(() => gitActivityHeatmapCells(activityRange.value, countsByDate.value));
const heatmapWeeks = computed(() => {
  const weeks = [] as (typeof heatmapCells.value)[];
  for (let index = 0; index < heatmapCells.value.length; index += 7) {
    weeks.push(heatmapCells.value.slice(index, index + 7));
  }
  return weeks;
});
const monthLabels = computed(() =>
  heatmapCells.value.flatMap((cell, index) => {
    if (!cell.inRange || cell.date.slice(8) !== "01") return [];
    return [
      {
        date: cell.date,
        left: Math.floor(index / 7) * 16,
        label: new Intl.DateTimeFormat(store.locale, { month: "short" }).format(new Date(`${cell.date}T12:00:00`)),
      },
    ];
  }),
);
const weekdayLabels = computed(() =>
  Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(store.locale, { weekday: "narrow" }).format(new Date(2023, 0, 1 + index)),
  ),
);
const totalCommits = computed(() => [...countsByDate.value.values()].reduce((total, value) => total + value, 0));
const activeDays = computed(() => [...countsByDate.value.values()].filter((count) => count > 0).length);
const selectedDateCount = computed(() => (selectedDate.value ? countsByDate.value.get(selectedDate.value) || 0 : 0));
const selectedProjectIds = computed(() => new Set(store.workActivitySelectedProjectIds));
const rangeLabel = computed(
  () => `${formatDate(activityRange.value.startDate)} - ${formatDate(activityRange.value.endDate)}`,
);
const dayCommits = computed(() => dayDetails.value?.commits || []);
const hasMoreDayCommits = computed(() => dayDetails.value?.hasMore === true);

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(store.locale, { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );

const cellLabel = (date: string, commits: number) =>
  t.value.activity.cellLabel.replace("{date}", formatDate(date)).replace("{count}", String(commits));

const projectNamesForPaths = (projectPaths: string[]) =>
  projectPaths.map((projectPath) => projectsByPath.value.get(projectPath)?.name || projectPath).join(" · ");

const formatCommitTime = (value: string) =>
  new Intl.DateTimeFormat(store.locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

const resetDayDetails = () => {
  dayDetailsRequestGeneration += 1;
  dayDetails.value = null;
  dayDetailsLoading.value = false;
  dayDetailsMessage.value = "";
};

const loadDayDetails = async (append = false) => {
  const date = selectedDate.value;
  if (!date) return;

  const requestGeneration = ++dayDetailsRequestGeneration;
  const skip = append ? dayCommits.value.length : 0;
  if (!append) {
    dayDetails.value = null;
    dayDetailsMessage.value = "";
  }
  dayDetailsLoading.value = true;
  try {
    const report = await store.readGitActivityDay({
      date,
      authorId: selectedAuthorId.value || undefined,
      limit: 50,
      skip,
    });
    if (requestGeneration !== dayDetailsRequestGeneration) return;
    if (!report) return;
    if (append && dayDetails.value) {
      const existingKeys = new Set(dayDetails.value.commits.map((commit) => `${commit.repositoryPath}:${commit.hash}`));
      dayDetails.value = {
        ...report,
        commits: [
          ...dayDetails.value.commits,
          ...report.commits.filter((commit) => !existingKeys.has(`${commit.repositoryPath}:${commit.hash}`)),
        ],
      };
      return;
    }
    dayDetails.value = report;
  } catch (error) {
    if (requestGeneration !== dayDetailsRequestGeneration) return;
    dayDetailsMessage.value = error instanceof Error ? error.message : t.value.activity.readFailed;
  } finally {
    if (requestGeneration === dayDetailsRequestGeneration) {
      dayDetailsLoading.value = false;
    }
  }
};

const loadActivity = (force = false) => {
  const { startDate, endDate } = activityRange.value;
  resetDayDetails();
  selectedDate.value = "";
  void store.loadGitActivity(force ? { startDate, endDate, force: true } : { startDate, endDate });
};

const setRangeMode = (mode: ActivityRangeMode) => {
  rangeMode.value = mode;
};

const selectPreviousYear = () => {
  selectedYear.value -= 1;
};

const selectNextYear = () => {
  selectedYear.value += 1;
};

const selectAuthor = (authorId: string) => {
  selectedAuthorId.value = authorId;
  authorPickerOpen.value = false;
  resetDayDetails();
  void loadDayDetails();
};

const setProjectSelected = (projectId: string, selected: boolean) => {
  const projectIds = new Set(store.workActivitySelectedProjectIds);
  if (selected) {
    projectIds.add(projectId);
  } else {
    projectIds.delete(projectId);
  }
  store.setWorkActivityProjectIds([...projectIds]);
  selectedDate.value = "";
  selectedAuthorId.value = "";
  resetDayDetails();
  loadActivity();
};

const selectAllProjects = () => {
  store.setWorkActivityProjectIds(store.workActivitySelectableProjects.map((project) => project.id));
  selectedDate.value = "";
  selectedAuthorId.value = "";
  resetDayDetails();
  loadActivity();
};

const clearProjects = () => {
  store.setWorkActivityProjectIds([]);
  selectedDate.value = "";
  selectedAuthorId.value = "";
  resetDayDetails();
};

const selectCell = (date: string) => {
  selectedDate.value = date;
  void loadDayDetails();
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (authorPickerOpen.value) {
    authorPickerOpen.value = false;
    event.detail.handle();
    return;
  }
  if (!projectScopeOpen.value) return;
  projectScopeOpen.value = false;
  event.detail.handle();
};

watch(
  () => `${rangeMode.value}:${selectedYear.value}`,
  () => {
    selectedDate.value = "";
    selectedAuthorId.value = "";
    loadActivity();
  },
  { immediate: true },
);

watch(countsByDate, (counts) => {
  if (selectedDate.value && counts.has(selectedDate.value)) return;
  selectedDate.value = [...counts.keys()].at(-1) || "";
  void loadDayDetails();
});

onMounted(() => {
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});

onBeforeUnmount(() => {
  stopAppEscapeListener();
});
</script>

<template>
  <div v-overlay-scrollbar class="themed-scrollbar h-full overflow-y-auto p-2">
    <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-border-subtle bg-surface p-1.5 text-on-surface-variant shadow-sm transition-all hover:bg-surface-variant active:scale-90"
          :title="t.common.back"
          :aria-label="t.common.back"
          @click="store.returnFromWorkActivity()"
        >
          <ArrowLeft :size="18" />
        </button>
        <div class="min-w-0">
          <h2 class="truncate text-base font-bold leading-tight text-on-surface">{{ t.activity.title }}</h2>
          <p class="mt-0.5 truncate text-xs text-on-surface-variant">{{ rangeLabel }}</p>
        </div>
      </div>
      <div class="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        <div
          class="flex h-7 overflow-hidden rounded-lg border border-border-subtle bg-surface"
          role="group"
          :aria-label="t.activity.range"
        >
          <button
            type="button"
            :class="
              cn(
                'px-2 text-xs font-bold transition-colors',
                rangeMode === 'rolling'
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-variant',
              )
            "
            :aria-pressed="rangeMode === 'rolling'"
            @click="setRangeMode('rolling')"
          >
            {{ t.activity.rollingYear }}
          </button>
          <button
            type="button"
            :class="
              cn(
                'border-l border-border-subtle px-2 text-xs font-bold transition-colors',
                rangeMode === 'year'
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-variant',
              )
            "
            :aria-pressed="rangeMode === 'year'"
            @click="setRangeMode('year')"
          >
            {{ t.activity.calendarYear }}
          </button>
        </div>
        <div
          v-if="rangeMode === 'year'"
          class="flex h-7 items-center rounded-lg border border-border-subtle bg-surface"
        >
          <button
            type="button"
            class="flex h-full w-7 items-center justify-center text-on-surface-variant transition-colors hover:bg-surface-variant"
            :title="t.activity.previousYear"
            :aria-label="t.activity.previousYear"
            @click="selectPreviousYear"
          >
            <ChevronLeft :size="15" />
          </button>
          <span class="min-w-11 px-1 text-center text-xs font-bold text-on-surface">{{ selectedYear }}</span>
          <button
            type="button"
            class="flex h-full w-7 items-center justify-center text-on-surface-variant transition-colors hover:bg-surface-variant"
            :title="t.activity.nextYear"
            :aria-label="t.activity.nextYear"
            @click="selectNextYear"
          >
            <ChevronRight :size="15" />
          </button>
        </div>
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
          :aria-expanded="projectScopeOpen"
          @click="
            projectScopeOpen = !projectScopeOpen;
            authorPickerOpen = false;
          "
        >
          <Users :size="14" />
          <span>{{
            t.activity.projectsSelected.replace("{count}", String(store.workActivitySelectedProjectIds.length))
          }}</span>
          <ChevronDown :size="14" :class="projectScopeOpen && 'rotate-180'" />
        </button>
        <button
          type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:bg-surface-variant disabled:cursor-wait disabled:opacity-60"
          :disabled="store.workActivityLoading"
          :title="t.common.refresh"
          :aria-label="t.common.refresh"
          @click="loadActivity(true)"
        >
          <RefreshCw :size="15" :class="store.workActivityLoading && 'animate-spin'" />
        </button>
      </div>
    </header>

    <section v-if="projectScopeOpen" class="mb-3 border-y border-border-subtle bg-surface-container-low px-2 py-2">
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-on-surface-variant">{{ t.activity.projectScope }}</span>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded px-1.5 py-1 text-[11px] font-bold text-primary hover:bg-primary/10"
            @click="selectAllProjects"
          >
            {{ t.activity.selectAll }}
          </button>
          <button
            type="button"
            class="rounded px-1.5 py-1 text-[11px] font-bold text-on-surface-variant hover:bg-surface-variant"
            @click="clearProjects"
          >
            {{ t.activity.clearSelection }}
          </button>
        </div>
      </div>
      <div v-overlay-scrollbar class="themed-scrollbar grid max-h-48 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
        <label
          v-for="project in store.workActivitySelectableProjects"
          :key="project.id"
          class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-on-surface-variant transition-colors hover:bg-surface-variant"
        >
          <input
            type="checkbox"
            class="h-3.5 w-3.5 shrink-0 accent-[var(--color-primary)]"
            :checked="selectedProjectIds.has(project.id)"
            @change="setProjectSelected(project.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="min-w-0 truncate font-semibold text-on-surface">{{ project.name }}</span>
          <span class="min-w-0 truncate text-[10px] text-on-surface-variant">{{ project.path }}</span>
        </label>
      </div>
      <p v-if="store.workActivitySelectableProjects.length === 0" class="py-2 text-xs text-on-surface-variant">
        {{ t.activity.noProjects }}
      </p>
    </section>

    <section class="mb-3 grid gap-2 sm:grid-cols-3" :aria-busy="store.workActivityLoading">
      <div class="rounded-lg border border-border-subtle bg-surface px-3 py-2 shadow-sm">
        <div class="text-[10px] font-bold text-on-surface-variant">{{ t.activity.totalCommits }}</div>
        <div class="mt-1 text-xl font-bold tabular-nums text-on-surface">{{ totalCommits }}</div>
      </div>
      <div class="rounded-lg border border-border-subtle bg-surface px-3 py-2 shadow-sm">
        <div class="text-[10px] font-bold text-on-surface-variant">{{ t.activity.activeDays }}</div>
        <div class="mt-1 text-xl font-bold tabular-nums text-on-surface">{{ activeDays }}</div>
      </div>
      <div class="rounded-lg border border-border-subtle bg-surface px-3 py-2 shadow-sm">
        <div class="text-[10px] font-bold text-on-surface-variant">{{ t.activity.repositories }}</div>
        <div class="mt-1 text-xl font-bold tabular-nums text-on-surface">{{ readyRepositories.length }}</div>
      </div>
    </section>

    <section class="border-y border-border-subtle py-3" :aria-busy="store.workActivityLoading">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <CalendarDays :size="16" class="shrink-0 text-primary" />
          <h3 class="text-sm font-bold text-on-surface">{{ t.activity.heatmap }}</h3>
        </div>
        <div class="relative">
          <button
            type="button"
            class="inline-flex h-7 max-w-[15rem] items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
            :aria-expanded="authorPickerOpen"
            @click="
              authorPickerOpen = !authorPickerOpen;
              projectScopeOpen = false;
            "
          >
            <Users :size="14" class="shrink-0 text-on-surface-variant" />
            <span class="truncate">{{ selectedAuthor?.name || t.activity.allAuthors }}</span>
            <ChevronDown :size="14" class="shrink-0" :class="authorPickerOpen && 'rotate-180'" />
          </button>
        </div>
      </div>

      <div v-if="authorPickerOpen" class="mb-3 border border-border-subtle bg-surface-container-low p-1 shadow-sm">
        <div v-overlay-scrollbar class="themed-scrollbar max-h-48 overflow-y-auto">
          <button
            type="button"
            :class="
              cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                !selectedAuthorId ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-variant',
              )
            "
            @click="selectAuthor('')"
          >
            <Check v-if="!selectedAuthorId" :size="14" class="shrink-0" />
            <span v-else class="w-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate font-semibold">{{ t.activity.allAuthors }}</span>
            <span class="tabular-nums text-[10px]">{{
              readyRepositories.reduce((total, repository) => total + repository.totalCommits, 0)
            }}</span>
          </button>
          <button
            v-for="author in authors"
            :key="author.id"
            type="button"
            :class="
              cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                selectedAuthorId === author.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface-variant hover:bg-surface-variant',
              )
            "
            @click="selectAuthor(author.id)"
          >
            <Check v-if="selectedAuthorId === author.id" :size="14" class="shrink-0" />
            <span v-else class="w-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate font-semibold">{{ author.name }}</span>
            <span class="tabular-nums text-[10px]">{{ author.commits }}</span>
          </button>
        </div>
      </div>

      <div v-if="store.workActivityLoading" class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2" aria-busy="true">
        <div class="grid grid-rows-7 gap-1 pt-5">
          <span v-for="index in 7" :key="index" class="skeleton h-3 w-3" />
        </div>
        <div class="skeleton h-32 w-full" />
      </div>
      <div v-else-if="heatmapCells.length > 0" v-overlay-scrollbar class="themed-scrollbar overflow-x-auto pb-1">
        <div class="flex min-w-max items-start gap-2">
          <div class="grid grid-rows-7 gap-1 pt-5 text-center text-[9px] font-medium text-on-surface-variant">
            <span v-for="(label, index) in weekdayLabels" :key="label + index" class="h-3 leading-3">
              {{ index === 1 || index === 3 || index === 5 ? label : "" }}
            </span>
          </div>
          <div>
            <div
              class="relative mb-1 h-4 text-[9px] font-medium text-on-surface-variant"
              :style="{ width: `${Math.max(0, heatmapWeeks.length * 16 - 4)}px` }"
            >
              <span
                v-for="month in monthLabels"
                :key="month.date"
                class="absolute top-0 whitespace-nowrap"
                :style="{ left: `${month.left}px` }"
              >
                {{ month.label }}
              </span>
            </div>
            <div class="flex gap-1" role="grid" :aria-label="t.activity.heatmap">
              <div v-for="(week, weekIndex) in heatmapWeeks" :key="weekIndex" class="grid grid-rows-7 gap-1" role="row">
                <template v-for="cell in week" :key="cell.date">
                  <button
                    v-if="cell.inRange"
                    type="button"
                    :class="
                      cn(
                        'h-3 w-3 rounded-[2px] border transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        cell.level === 0 && 'border-border-subtle bg-surface-container-high',
                        cell.level === 1 && 'border-status-running/30 bg-status-running/25',
                        cell.level === 2 && 'border-status-running/45 bg-status-running/45',
                        cell.level === 3 && 'border-status-running/65 bg-status-running/65',
                        cell.level === 4 && 'border-status-running bg-status-running',
                        selectedDate === cell.date && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                      )
                    "
                    :title="cellLabel(cell.date, cell.count)"
                    :aria-label="cellLabel(cell.date, cell.count)"
                    :aria-pressed="selectedDate === cell.date"
                    @click="selectCell(cell.date)"
                  />
                  <span v-else class="h-3 w-3" aria-hidden="true" />
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p v-else class="py-8 text-center text-sm text-on-surface-variant">{{ t.activity.noActivity }}</p>
    </section>

    <section class="py-3">
      <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-sm font-bold text-on-surface">{{ t.activity.dailyRecords }}</h3>
        <span v-if="selectedDate" class="text-xs text-on-surface-variant"
          >{{ formatDate(selectedDate) }} · {{ selectedDateCount }}</span
        >
      </div>
      <div
        v-if="!selectedDate"
        class="border border-dashed border-border-subtle px-3 py-3 text-sm text-on-surface-variant"
      >
        {{ t.activity.selectDay }}
      </div>
      <div v-else-if="dayDetailsLoading" class="space-y-2 border-y border-border-subtle py-2" aria-busy="true">
        <div v-for="index in 3" :key="index" class="grid grid-cols-[minmax(0,1fr)_3rem] gap-3 px-2">
          <span class="skeleton h-3 w-3/4" />
          <span class="skeleton h-3 w-full" />
        </div>
      </div>
      <div v-else-if="dayDetailsMessage" class="border border-status-warning/30 px-3 py-3 text-sm text-status-warning">
        {{ dayDetailsMessage }}
      </div>
      <div
        v-else-if="dayCommits.length === 0"
        class="border border-dashed border-border-subtle px-3 py-3 text-sm text-on-surface-variant"
      >
        {{ t.activity.noActivity }}
      </div>
      <div v-else class="divide-y divide-border-subtle border-y border-border-subtle">
        <div
          v-for="commit in dayCommits"
          :key="`${commit.repositoryPath}:${commit.hash}`"
          class="flex min-w-0 items-center gap-3 px-2 py-2"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs font-bold text-on-surface" :title="commit.message || commit.hash">
              {{ commit.message || commit.hash }}
            </div>
            <div
              class="truncate text-[10px] text-on-surface-variant"
              :title="projectNamesForPaths(commit.projectPaths)"
            >
              {{ commit.author }} · {{ projectNamesForPaths(commit.projectPaths) }} ·
              {{ formatCommitTime(commit.date) }}
            </div>
          </div>
          <span class="shrink-0 font-mono text-[10px] font-bold text-primary">{{ commit.hash.slice(0, 8) }}</span>
        </div>
      </div>
      <button
        v-if="hasMoreDayCommits && !dayDetailsLoading"
        type="button"
        class="mt-2 inline-flex h-7 items-center rounded-lg border border-border-subtle bg-surface px-2.5 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
        @click="loadDayDetails(true)"
      >
        {{ t.activity.loadMore }}
      </button>
      <p v-if="dayDetails?.failedRepositories.length" class="mt-2 text-xs text-status-warning">
        {{ t.activity.partialRead }}
      </p>
    </section>

    <section
      v-if="store.workActivityMessage || failedRepositories.length > 0"
      class="border-t border-status-warning/30 py-3 text-xs text-status-warning"
    >
      <p v-if="store.workActivityMessage">{{ store.workActivityMessage }}</p>
      <ul v-if="failedRepositories.length > 0" class="mt-1 space-y-1 text-on-surface-variant">
        <li
          v-for="repository in failedRepositories"
          :key="repository.repositoryPath || repository.projectPaths.join('|')"
        >
          {{ repository.projectPaths.join(" · ") }}: {{ repository.message || t.activity.readFailed }}
        </li>
      </ul>
    </section>
  </div>
</template>
