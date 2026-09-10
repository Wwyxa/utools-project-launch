<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  GitCommitHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Users,
} from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import {
  calendarYearGitActivityRange,
  gitActivityDateInTimeZone,
  gitActivityHeatmapCells,
  gitActivityHeatmapMonthStarts,
  rollingGitActivityRange,
} from "../../lib/gitActivity";
import { cn } from "../../lib/utils";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import type { ProjectGitActivityDayReport, WorkActivityPreferences } from "../../types";

type ActivityRangeMode = "rolling" | "year";
const currentAuthorSelection = "current";

const store = useStore();
const t = useI18n();
const rangeMode = computed({
  get: () => store.uiPreferences.workActivity.rangeMode,
  set: (mode: ActivityRangeMode) => {
    store.setWorkActivityPreferences({ rangeMode: mode });
  },
});
const selectedYear = computed({
  get: () => store.uiPreferences.workActivity.selectedYear,
  set: (year: number) => {
    store.setWorkActivityPreferences({ selectedYear: year });
  },
});
const activityPreferences = computed(() => store.uiPreferences.workActivity);
const selectedAuthorId = ref(currentAuthorSelection);
const selectedDate = ref("");
const projectScopeOpen = ref(false);
const authorPickerOpen = ref(false);
const refScopePickerOpen = ref(false);
const timeZonePickerOpen = ref(false);
const criteriaOpen = ref(false);
const projectScopeTriggerRef = ref<HTMLElement | null>(null);
const authorPickerTriggerRef = ref<HTMLElement | null>(null);
const refScopePickerTriggerRef = ref<HTMLElement | null>(null);
const timeZonePickerTriggerRef = ref<HTMLElement | null>(null);
const projectScopeMenuPosition = ref({ right: 8, top: 8 });
const authorPickerMenuPosition = ref({ right: 8, top: 8 });
const refScopePickerMenuPosition = ref({ right: 8, top: 8 });
const timeZonePickerMenuPosition = ref({ right: 8, top: 8 });
const dayDetails = ref<ProjectGitActivityDayReport | null>(null);
const dayDetailsLoading = ref(false);
const dayDetailsMessage = ref("");
let dayDetailsRequestGeneration = 0;
let stopAppEscapeListener = () => {};

const activityRange = computed(() =>
  rangeMode.value === "year"
    ? calendarYearGitActivityRange(selectedYear.value)
    : rollingGitActivityRange(gitActivityDateInTimeZone(new Date(), activityPreferences.value.timeZone)),
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
const currentAuthorIds = computed(
  () => new Set(readyRepositories.value.map((repository) => repository.currentAuthorId).filter(Boolean)),
);
const currentAuthors = computed(() => authors.value.filter((author) => currentAuthorIds.value.has(author.id)));
const selectedAuthor = computed(() => authors.value.find((author) => author.id === selectedAuthorId.value) || null);
const selectedAuthorLabel = computed(() => {
  if (selectedAuthorId.value !== currentAuthorSelection)
    return selectedAuthor.value?.name || t.value.activity.allAuthors;
  if (currentAuthors.value.length === 1) return `${currentAuthors.value[0].name} (${t.value.activity.currentUser})`;
  return t.value.activity.currentUser;
});
const countsByDate = computed(() => {
  const counts = new Map<string, number>();
  readyRepositories.value.forEach((repository) => {
    repository.daily.forEach((day) => {
      const authorId =
        selectedAuthorId.value === currentAuthorSelection ? repository.currentAuthorId : selectedAuthorId.value;
      const commits = authorId ? day.authors[authorId] || 0 : selectedAuthorId.value ? 0 : day.commits;
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
  gitActivityHeatmapMonthStarts(heatmapCells.value).map((date) => {
    if (!date) return null;
    return {
      date,
      label: new Intl.DateTimeFormat(store.locale, { month: "short" }).format(new Date(`${date}T12:00:00`)),
    };
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
const excludedCommits = computed(() =>
  readyRepositories.value.reduce(
    (total, repository) => total + (repository.excludedMerges || 0) + (repository.excludedBots || 0),
    0,
  ),
);
const scopeLabel = computed(() => t.value.activity[`${activityPreferences.value.refScope}RefScope`]);
const timeZoneLabel = computed(() =>
  activityPreferences.value.timeZone === "local" ? t.value.activity.localTimeZone : activityPreferences.value.timeZone,
);
const criteriaSummary = computed(() => `${scopeLabel.value} · ${timeZoneLabel.value}`);
const refScopeOptions = computed(
  () => ["current", "default", "all"] as const satisfies readonly WorkActivityPreferences["refScope"][],
);
const timeZoneOptions = computed(() => [
  ...new Set([
    activityPreferences.value.timeZone,
    "local",
    "UTC",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Europe/London",
    "America/New_York",
  ]),
]);

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(store.locale, { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );

const cellLabel = (date: string, commits: number) =>
  t.value.activity.cellLabel.replace("{date}", formatDate(date)).replace("{count}", String(commits));

const projectNamesForPaths = (projectPaths: string[]) =>
  projectPaths.map((projectPath) => projectsByPath.value.get(projectPath)?.name || projectPath).join(" · ");

const projectForPaths = (projectPaths: string[]) =>
  projectPaths.map((projectPath) => projectsByPath.value.get(projectPath)).find(Boolean);

const formatCommitTime = (value: string) =>
  new Intl.DateTimeFormat(store.locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: activityPreferences.value.timeZone === "local" ? undefined : activityPreferences.value.timeZone,
  }).format(new Date(value));

const setActivityPreference = <Key extends keyof WorkActivityPreferences>(
  key: Key,
  value: WorkActivityPreferences[Key],
) => store.setWorkActivityPreferences({ [key]: value } as Pick<WorkActivityPreferences, Key>);

const splitAliases = (value: string) =>
  value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);

const updateIdentity = (index: number, field: "name" | "emails" | "names", value: string) => {
  const identities = activityPreferences.value.identities.map((identity) => ({ ...identity }));
  const identity = identities[index];
  if (!identity) return;
  if (field === "name") identity.name = value.trim() || identity.name;
  else identity[field] = splitAliases(value);
  setActivityPreference("identities", identities);
};

const addIdentity = () =>
  setActivityPreference("identities", [
    ...activityPreferences.value.identities,
    { id: `identity-${Date.now()}`, name: t.value.activity.newIdentity, emails: [], names: [] },
  ]);

const removeIdentity = (index: number) =>
  setActivityPreference(
    "identities",
    activityPreferences.value.identities.filter((_, identityIndex) => identityIndex !== index),
  );

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
      authorId:
        selectedAuthorId.value && selectedAuthorId.value !== currentAuthorSelection
          ? selectedAuthorId.value
          : undefined,
      currentUserOnly: selectedAuthorId.value === currentAuthorSelection,
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

const isCurrentAuthor = (authorId: string) => currentAuthorIds.value.has(authorId);
const isAuthorSelected = (authorId: string) =>
  selectedAuthorId.value === authorId ||
  (selectedAuthorId.value === currentAuthorSelection && isCurrentAuthor(authorId));

const positionDropdown = (trigger: HTMLElement, target: { value: { right: number; top: number } }) => {
  const rect = trigger.getBoundingClientRect();
  target.value = {
    right: Math.max(8, (document.documentElement.clientWidth || window.innerWidth) - rect.right),
    top: rect.bottom + 6,
  };
};

const toggleProjectScope = () => {
  authorPickerOpen.value = false;
  refScopePickerOpen.value = false;
  timeZonePickerOpen.value = false;
  projectScopeOpen.value = !projectScopeOpen.value;
  if (projectScopeOpen.value && projectScopeTriggerRef.value) {
    positionDropdown(projectScopeTriggerRef.value, projectScopeMenuPosition);
  }
};

const toggleAuthorPicker = () => {
  projectScopeOpen.value = false;
  refScopePickerOpen.value = false;
  timeZonePickerOpen.value = false;
  authorPickerOpen.value = !authorPickerOpen.value;
  if (authorPickerOpen.value && authorPickerTriggerRef.value) {
    positionDropdown(authorPickerTriggerRef.value, authorPickerMenuPosition);
  }
};

const toggleRefScopePicker = () => {
  projectScopeOpen.value = false;
  authorPickerOpen.value = false;
  timeZonePickerOpen.value = false;
  refScopePickerOpen.value = !refScopePickerOpen.value;
  if (refScopePickerOpen.value && refScopePickerTriggerRef.value) {
    positionDropdown(refScopePickerTriggerRef.value, refScopePickerMenuPosition);
  }
};

const toggleTimeZonePicker = () => {
  projectScopeOpen.value = false;
  authorPickerOpen.value = false;
  refScopePickerOpen.value = false;
  timeZonePickerOpen.value = !timeZonePickerOpen.value;
  if (timeZonePickerOpen.value && timeZonePickerTriggerRef.value) {
    positionDropdown(timeZonePickerTriggerRef.value, timeZonePickerMenuPosition);
  }
};

const selectRefScope = (refScope: WorkActivityPreferences["refScope"]) => {
  setActivityPreference("refScope", refScope);
  refScopePickerOpen.value = false;
};

const selectTimeZone = (timeZone: string) => {
  setActivityPreference("timeZone", timeZone);
  timeZonePickerOpen.value = false;
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
  selectedAuthorId.value = currentAuthorSelection;
  resetDayDetails();
  loadActivity();
};

const selectAllProjects = () => {
  store.setWorkActivityProjectIds(store.workActivitySelectableProjects.map((project) => project.id));
  selectedDate.value = "";
  selectedAuthorId.value = currentAuthorSelection;
  resetDayDetails();
  loadActivity();
};

const clearProjects = () => {
  store.setWorkActivityProjectIds([]);
  selectedDate.value = "";
  selectedAuthorId.value = currentAuthorSelection;
  resetDayDetails();
};

const selectCell = (date: string) => {
  selectedDate.value = date;
  void loadDayDetails();
};

const openCommitInGit = (projectPaths: string[], commitHash: string) => {
  const project = projectForPaths(projectPaths);
  if (project) store.openProjectGit(project.id, commitHash);
};

const handleWindowPointerDown = (event: PointerEvent) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!projectScopeTriggerRef.value?.contains(target) && !target.closest("[data-work-activity-project-menu]")) {
    projectScopeOpen.value = false;
  }
  if (!authorPickerTriggerRef.value?.contains(target) && !target.closest("[data-work-activity-author-menu]")) {
    authorPickerOpen.value = false;
  }
  if (!refScopePickerTriggerRef.value?.contains(target) && !target.closest("[data-work-activity-ref-scope-menu]")) {
    refScopePickerOpen.value = false;
  }
  if (!timeZonePickerTriggerRef.value?.contains(target) && !target.closest("[data-work-activity-time-zone-menu]")) {
    timeZonePickerOpen.value = false;
  }
};

const handleViewportChange = () => {
  if (projectScopeOpen.value && projectScopeTriggerRef.value) {
    positionDropdown(projectScopeTriggerRef.value, projectScopeMenuPosition);
  }
  if (authorPickerOpen.value && authorPickerTriggerRef.value) {
    positionDropdown(authorPickerTriggerRef.value, authorPickerMenuPosition);
  }
  if (refScopePickerOpen.value && refScopePickerTriggerRef.value) {
    positionDropdown(refScopePickerTriggerRef.value, refScopePickerMenuPosition);
  }
  if (timeZonePickerOpen.value && timeZonePickerTriggerRef.value) {
    positionDropdown(timeZonePickerTriggerRef.value, timeZonePickerMenuPosition);
  }
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (timeZonePickerOpen.value) {
    timeZonePickerOpen.value = false;
    event.detail.handle();
    return;
  }
  if (refScopePickerOpen.value) {
    refScopePickerOpen.value = false;
    event.detail.handle();
    return;
  }
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
  () => JSON.stringify(activityPreferences.value),
  () => {
    selectedDate.value = "";
    selectedAuthorId.value = currentAuthorSelection;
    loadActivity();
  },
  { immediate: true },
);

watch(
  countsByDate,
  (counts) => {
    if (selectedDate.value && counts.has(selectedDate.value)) return;
    selectedDate.value = [...counts.keys()].sort().at(-1) || "";
    void loadDayDetails();
  },
  { immediate: true },
);

onMounted(() => {
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
  window.addEventListener("pointerdown", handleWindowPointerDown);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
});

onBeforeUnmount(() => {
  stopAppEscapeListener();
  window.removeEventListener("pointerdown", handleWindowPointerDown);
  window.removeEventListener("resize", handleViewportChange);
  window.removeEventListener("scroll", handleViewportChange, true);
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
          :class="
            cn(
              'flex h-7 items-center rounded-lg border border-border-subtle bg-surface',
              rangeMode !== 'year' && 'invisible pointer-events-none',
            )
          "
          :aria-hidden="rangeMode !== 'year'"
        >
          <button
            type="button"
            class="flex h-full w-7 items-center justify-center text-on-surface-variant transition-colors hover:bg-surface-variant"
            :title="t.activity.previousYear"
            :aria-label="t.activity.previousYear"
            :disabled="rangeMode !== 'year'"
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
            :disabled="rangeMode !== 'year'"
            @click="selectNextYear"
          >
            <ChevronRight :size="15" />
          </button>
        </div>
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
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
          :aria-expanded="criteriaOpen"
          @click="criteriaOpen = !criteriaOpen"
        >
          <Settings2 :size="14" />
          <span>{{ t.activity.criteria }}</span>
        </button>
        <button
          ref="projectScopeTriggerRef"
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
          :aria-expanded="projectScopeOpen"
          @click="toggleProjectScope"
        >
          <FolderGit2 :size="14" />
          <span>{{
            t.activity.projectsSelected.replace("{count}", String(store.workActivitySelectedProjectIds.length))
          }}</span>
          <ChevronDown :size="14" :class="projectScopeOpen && 'rotate-180'" />
        </button>
      </div>
    </header>

    <section class="mb-3 border-y border-border-subtle py-2 text-xs text-on-surface-variant">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 text-left"
        :aria-expanded="criteriaOpen"
        @click="criteriaOpen = !criteriaOpen"
      >
        <span class="truncate">{{ criteriaSummary }}</span>
        <span v-if="excludedCommits" class="shrink-0 text-status-warning">
          {{ t.activity.excludedCommits.replace("{count}", String(excludedCommits)) }}
        </span>
      </button>
      <div v-if="criteriaOpen" class="mt-3 grid gap-3 border-t border-border-subtle pt-3 lg:grid-cols-2">
        <div class="grid gap-2 sm:grid-cols-2">
          <div class="grid gap-1">
            <span id="work-activity-ref-scope-label" class="font-bold text-on-surface">{{ t.activity.refScope }}</span>
            <button
              ref="refScopePickerTriggerRef"
              type="button"
              class="flex h-8 items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface px-2 text-left text-sm text-on-surface transition-colors hover:bg-surface-variant"
              aria-haspopup="menu"
              aria-labelledby="work-activity-ref-scope-label"
              :aria-expanded="refScopePickerOpen"
              @click="toggleRefScopePicker"
            >
              <span class="truncate">{{ scopeLabel }}</span>
              <ChevronDown :size="15" class="shrink-0" :class="refScopePickerOpen && 'rotate-180'" />
            </button>
          </div>
          <div class="grid gap-1">
            <span id="work-activity-time-zone-label" class="font-bold text-on-surface">{{ t.activity.timeZone }}</span>
            <button
              ref="timeZonePickerTriggerRef"
              type="button"
              class="flex h-8 items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface px-2 text-left text-sm text-on-surface transition-colors hover:bg-surface-variant"
              aria-haspopup="menu"
              aria-labelledby="work-activity-time-zone-label"
              :aria-expanded="timeZonePickerOpen"
              @click="toggleTimeZonePicker"
            >
              <span class="truncate">{{ timeZoneLabel }}</span>
              <ChevronDown :size="15" class="shrink-0" :class="timeZonePickerOpen && 'rotate-180'" />
            </button>
          </div>
          <p class="sm:col-span-2">{{ t.activity.timeBasisHint }}</p>
        </div>
        <div class="grid content-start gap-2">
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              class="accent-[var(--color-primary)]"
              :checked="activityPreferences.hideMerges"
              @change="setActivityPreference('hideMerges', ($event.target as HTMLInputElement).checked)"
            />
            <span class="font-bold text-on-surface">{{ t.activity.hideMerges }}</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              class="accent-[var(--color-primary)]"
              :checked="activityPreferences.excludeBots"
              @change="setActivityPreference('excludeBots', ($event.target as HTMLInputElement).checked)"
            />
            <span class="font-bold text-on-surface">{{ t.activity.excludeBots }}</span>
          </label>
          <label v-if="activityPreferences.excludeBots" class="grid gap-1">
            <span>{{ t.activity.botPatterns }}</span>
            <input
              class="h-8 rounded-md border border-border-subtle bg-surface px-2 font-mono text-on-surface"
              :value="activityPreferences.botPatterns.join(', ')"
              @change="setActivityPreference('botPatterns', splitAliases(($event.target as HTMLInputElement).value))"
            />
          </label>
        </div>
        <div class="grid gap-2 lg:col-span-2">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="font-bold text-on-surface">{{ t.activity.identities }}</div>
              <div>{{ t.activity.identityHint }}</div>
            </div>
            <button
              type="button"
              class="inline-flex h-7 items-center gap-1 rounded-md border border-border-subtle px-2 font-bold text-on-surface hover:bg-surface-variant"
              @click="addIdentity"
            >
              <Plus :size="13" /> {{ t.activity.addIdentity }}
            </button>
          </div>
          <div
            v-for="(identity, index) in activityPreferences.identities"
            :key="identity.id"
            class="grid gap-1 sm:grid-cols-[10rem_1fr_1fr_2rem]"
          >
            <input
              class="h-8 rounded-md border border-border-subtle bg-surface px-2 text-on-surface"
              :value="identity.name"
              @change="updateIdentity(index, 'name', ($event.target as HTMLInputElement).value)"
            />
            <input
              class="h-8 rounded-md border border-border-subtle bg-surface px-2 text-on-surface"
              :placeholder="t.activity.identityEmails"
              :value="identity.emails.join(', ')"
              @change="updateIdentity(index, 'emails', ($event.target as HTMLInputElement).value)"
            />
            <input
              class="h-8 rounded-md border border-border-subtle bg-surface px-2 text-on-surface"
              :placeholder="t.activity.identityNames"
              :value="identity.names.join(', ')"
              @change="updateIdentity(index, 'names', ($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center text-status-error hover:bg-status-error/10"
              :aria-label="t.common.delete"
              @click="removeIdentity(index)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
        <p
          v-if="readyRepositories.some((repository) => repository.scopeMessage)"
          class="text-status-warning lg:col-span-2"
        >
          {{ readyRepositories.find((repository) => repository.scopeMessage)?.scopeMessage }}
        </p>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="refScopePickerOpen"
          data-work-activity-ref-scope-menu
          class="fixed z-50 w-max min-w-48 max-w-[calc(100vw-1rem)] rounded-lg border border-border-subtle bg-surface p-1 shadow-xl"
          :style="{ right: `${refScopePickerMenuPosition.right}px`, top: `${refScopePickerMenuPosition.top}px` }"
        >
          <button
            v-for="refScope in refScopeOptions"
            :key="refScope"
            type="button"
            :class="
              cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                activityPreferences.refScope === refScope
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface-variant hover:bg-surface-variant',
              )
            "
            @click="selectRefScope(refScope)"
          >
            <Check v-if="activityPreferences.refScope === refScope" :size="14" class="shrink-0" />
            <span v-else class="w-3.5 shrink-0" />
            <span class="font-semibold">{{ t.activity[`${refScope}RefScope`] }}</span>
          </button>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="timeZonePickerOpen"
          data-work-activity-time-zone-menu
          class="fixed z-50 w-max min-w-48 max-w-[calc(100vw-1rem)] rounded-lg border border-border-subtle bg-surface p-1 shadow-xl"
          :style="{ right: `${timeZonePickerMenuPosition.right}px`, top: `${timeZonePickerMenuPosition.top}px` }"
        >
          <div v-overlay-scrollbar class="themed-scrollbar max-h-64 overflow-y-auto">
            <button
              v-for="timeZone in timeZoneOptions"
              :key="timeZone"
              type="button"
              :class="
                cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                  activityPreferences.timeZone === timeZone
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-variant hover:bg-surface-variant',
                )
              "
              @click="selectTimeZone(timeZone)"
            >
              <Check v-if="activityPreferences.timeZone === timeZone" :size="14" class="shrink-0" />
              <span v-else class="w-3.5 shrink-0" />
              <span class="font-semibold">{{ timeZone === "local" ? t.activity.localTimeZone : timeZone }}</span>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="projectScopeOpen"
          data-work-activity-project-menu
          class="fixed z-50 w-max min-w-64 max-w-[min(32rem,calc(100vw-1rem))] rounded-lg border border-border-subtle bg-surface p-1.5 shadow-xl"
          :style="{ right: `${projectScopeMenuPosition.right}px`, top: `${projectScopeMenuPosition.top}px` }"
        >
          <div class="mb-1 flex items-center justify-between gap-4 px-1">
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
          <div v-overlay-scrollbar class="themed-scrollbar max-h-64 overflow-y-auto">
            <label
              v-for="project in store.workActivitySelectableProjects"
              :key="project.id"
              class="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-on-surface-variant transition-colors hover:bg-surface-variant"
            >
              <input
                type="checkbox"
                class="h-3.5 w-3.5 shrink-0 accent-[var(--color-primary)]"
                :checked="selectedProjectIds.has(project.id)"
                @change="setProjectSelected(project.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="max-w-40 truncate font-semibold text-on-surface">{{ project.name }}</span>
              <span class="max-w-64 truncate text-[10px] text-on-surface-variant">{{ project.path }}</span>
            </label>
          </div>
          <p v-if="store.workActivitySelectableProjects.length === 0" class="px-2 py-2 text-xs text-on-surface-variant">
            {{ t.activity.noProjects }}
          </p>
        </div>
      </Transition>
    </Teleport>

    <section class="mb-2 grid gap-1.5 sm:grid-cols-3" :aria-busy="store.workActivityLoading">
      <div
        class="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 shadow-sm"
      >
        <div class="truncate text-[10px] font-bold text-on-surface-variant">{{ t.activity.totalCommits }}</div>
        <div class="shrink-0 text-base font-bold leading-none tabular-nums text-on-surface">{{ totalCommits }}</div>
      </div>
      <div
        class="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 shadow-sm"
      >
        <div class="truncate text-[10px] font-bold text-on-surface-variant">{{ t.activity.activeDays }}</div>
        <div class="shrink-0 text-base font-bold leading-none tabular-nums text-on-surface">{{ activeDays }}</div>
      </div>
      <div
        class="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 shadow-sm"
      >
        <div class="truncate text-[10px] font-bold text-on-surface-variant">{{ t.activity.repositories }}</div>
        <div class="shrink-0 text-base font-bold leading-none tabular-nums text-on-surface">
          {{ readyRepositories.length }}
        </div>
      </div>
    </section>

    <section class="border-y border-border-subtle py-3" :aria-busy="store.workActivityLoading">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <CalendarDays :size="16" class="shrink-0 text-primary" />
          <h3 class="text-sm font-bold text-on-surface">{{ t.activity.heatmap }}</h3>
        </div>
        <div>
          <button
            ref="authorPickerTriggerRef"
            type="button"
            class="inline-flex h-7 max-w-[15rem] items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
            :aria-expanded="authorPickerOpen"
            @click="toggleAuthorPicker"
          >
            <Users :size="14" class="shrink-0 text-on-surface-variant" />
            <span class="truncate">{{ selectedAuthorLabel }}</span>
            <ChevronDown :size="14" class="shrink-0" :class="authorPickerOpen && 'rotate-180'" />
          </button>
        </div>
      </div>

      <Teleport to="body">
        <Transition name="fade">
          <div
            v-if="authorPickerOpen"
            data-work-activity-author-menu
            class="fixed z-50 w-max min-w-48 max-w-[calc(100vw-1rem)] rounded-lg border border-border-subtle bg-surface p-1 shadow-xl"
            :style="{ right: `${authorPickerMenuPosition.right}px`, top: `${authorPickerMenuPosition.top}px` }"
          >
            <div v-overlay-scrollbar class="themed-scrollbar max-h-64 overflow-y-auto">
              <button
                type="button"
                :class="
                  cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                    !selectedAuthorId
                      ? 'bg-primary/10 text-primary'
                      : 'text-on-surface-variant hover:bg-surface-variant',
                  )
                "
                @click="selectAuthor('')"
              >
                <Check v-if="!selectedAuthorId" :size="14" class="shrink-0" />
                <span v-else class="w-3.5 shrink-0" />
                <span class="truncate font-semibold">{{ t.activity.allAuthors }}</span>
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
                    isAuthorSelected(author.id)
                      ? 'bg-primary/10 text-primary'
                      : 'text-on-surface-variant hover:bg-surface-variant',
                  )
                "
                @click="selectAuthor(isCurrentAuthor(author.id) ? currentAuthorSelection : author.id)"
              >
                <Check v-if="isAuthorSelected(author.id)" :size="14" class="shrink-0" />
                <span v-else class="w-3.5 shrink-0" />
                <span class="font-semibold">{{ author.name }}</span>
                <span
                  v-if="isCurrentAuthor(author.id)"
                  class="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-bold text-primary"
                  >{{ t.activity.currentUser }}</span
                >
                <span class="tabular-nums text-[10px]">{{ author.commits }}</span>
              </button>
            </div>
          </div>
        </Transition>
      </Teleport>

      <div
        v-if="store.workActivityLoading && !store.workActivityReport"
        class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2"
        aria-busy="true"
      >
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
            <div class="mb-1 flex h-4 gap-1 text-[9px] font-medium text-on-surface-variant">
              <span
                v-for="(month, weekIndex) in monthLabels"
                :key="month?.date || weekIndex"
                class="w-3 shrink-0 whitespace-nowrap"
              >
                {{ month?.label }}
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
          <button
            v-if="projectForPaths(commit.projectPaths)"
            type="button"
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
            :title="t.activity.openInGit"
            :aria-label="t.activity.openInGit"
            @click="openCommitInGit(commit.projectPaths, commit.hash)"
          >
            <GitCommitHorizontal :size="15" />
          </button>
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
