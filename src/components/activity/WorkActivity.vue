<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  GitCompareArrows,
  GitCommitHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Users,
  X,
} from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import {
  calendarYearGitActivityRange,
  currentYearGitActivityRange,
  gitActivityDateInTimeZone,
  gitActivityComparison,
  gitActivityHeatmapCells,
  gitActivityHeatmapMonthStarts,
  gitActivityStreaks,
  previousGitActivityRange,
  rollingGitActivityRange,
} from "../../lib/gitActivity";
import { cn } from "../../lib/utils";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import type {
  ProjectGitActivityChangesReport,
  ProjectGitActivityDayReport,
  ProjectGitActivityRepository,
  WorkActivityPreferences,
} from "../../types";

type ActivityRangeMode = WorkActivityPreferences["rangeMode"];
type AnalysisTab = "day" | "patterns" | "projects" | "changes";
type ProjectSort = "commits" | "activeDays" | "recent" | "share";
type CustomDatePickerKind = "start" | "end";
const currentAuthorSelection = "current";

const store = useStore();
const t = useI18n();
const rangeMode = computed({
  get: () => store.uiPreferences.workActivity.rangeMode,
  set: (mode: ActivityRangeMode) => {
    store.setWorkActivityPreferences({ rangeMode: mode });
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
const customDatePickerKind = ref<CustomDatePickerKind | null>(null);
const customDatePickerMonth = ref(new Date());
const analysisTab = ref<AnalysisTab>("patterns");
const projectSort = ref<ProjectSort>("commits");
const projectSortOpen = ref(false);
const focusedRepositoryPath = ref("");
const changesReport = ref<ProjectGitActivityChangesReport | null>(null);
const changesLoading = ref(false);
const changesMessage = ref("");
const projectScopeTriggerRef = ref<HTMLElement | null>(null);
const authorPickerTriggerRef = ref<HTMLElement | null>(null);
const refScopePickerTriggerRef = ref<HTMLElement | null>(null);
const timeZonePickerTriggerRef = ref<HTMLElement | null>(null);
const projectSortTriggerRef = ref<HTMLElement | null>(null);
const customDatePickerTriggerRef = ref<HTMLElement | null>(null);
const projectScopeMenuPosition = ref({ right: 8, top: 8 });
const authorPickerMenuPosition = ref({ right: 8, top: 8 });
const refScopePickerMenuPosition = ref({ right: 8, top: 8 });
const timeZonePickerMenuPosition = ref({ right: 8, top: 8 });
const projectSortMenuPosition = ref({ right: 8, top: 8 });
const customDatePickerPosition = ref({ right: 8, top: 8 });
const dayDetails = ref<ProjectGitActivityDayReport | null>(null);
const dayDetailsLoading = ref(false);
const dayDetailsMessage = ref("");
let dayDetailsRequestGeneration = 0;
let changesRequestGeneration = 0;
let stopAppEscapeListener = () => {};

const today = computed(() => gitActivityDateInTimeZone(new Date(), activityPreferences.value.timeZone));
const activityRange = computed(() => {
  if (rangeMode.value === "currentYear") return currentYearGitActivityRange(today.value);
  if (rangeMode.value === "custom") {
    const startDate = activityPreferences.value.customStartDate;
    const endDate = activityPreferences.value.customEndDate;
    if (startDate && endDate && startDate <= endDate) return { startDate, endDate };
  }
  const days =
    rangeMode.value === "days7" ? 7 : rangeMode.value === "days30" ? 30 : rangeMode.value === "days90" ? 90 : 365;
  return rollingGitActivityRange(today.value, days);
});
const comparisonRange = computed(() => previousGitActivityRange(activityRange.value));
const readyRepositories = computed(() =>
  (store.workActivityReport?.repositories || []).filter((repository) => repository.state === "ready"),
);
const failedRepositories = computed(() =>
  (store.workActivityReport?.repositories || []).filter((repository) => repository.state === "failed"),
);
const visibleRepositories = computed(() =>
  focusedRepositoryPath.value
    ? readyRepositories.value.filter((repository) => repository.repositoryPath === focusedRepositoryPath.value)
    : readyRepositories.value,
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
  visibleRepositories.value.forEach((repository) => {
    repository.daily.forEach((day) => {
      if (day.date < activityRange.value.startDate || day.date > activityRange.value.endDate) return;
      const authorId =
        selectedAuthorId.value === currentAuthorSelection ? repository.currentAuthorId : selectedAuthorId.value;
      const commits = authorId ? day.authors[authorId] || 0 : selectedAuthorId.value ? 0 : day.commits;
      if (commits > 0) counts.set(day.date, (counts.get(day.date) || 0) + commits);
    });
  });
  return counts;
});
const comparisonCountsByDate = computed(() => {
  const counts = new Map<string, number>();
  visibleRepositories.value.forEach((repository) => {
    repository.daily.forEach((day) => {
      if (day.date < comparisonRange.value.startDate || day.date > comparisonRange.value.endDate) return;
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
const previousCommits = computed(() =>
  [...comparisonCountsByDate.value.values()].reduce((total, value) => total + value, 0),
);
const previousActiveDays = computed(() => comparisonCountsByDate.value.size);
const repositoryCommitCount = (
  repository: ProjectGitActivityRepository,
  range: { startDate: string; endDate: string },
) =>
  repository.daily.reduce((total, day) => {
    if (day.date < range.startDate || day.date > range.endDate) return total;
    const authorId =
      selectedAuthorId.value === currentAuthorSelection ? repository.currentAuthorId : selectedAuthorId.value;
    return total + (authorId ? day.authors[authorId] || 0 : selectedAuthorId.value ? 0 : day.commits);
  }, 0);
const activeProjects = computed(
  () =>
    visibleRepositories.value.filter((repository) => repositoryCommitCount(repository, activityRange.value) > 0).length,
);
const previousActiveProjects = computed(
  () =>
    visibleRepositories.value.filter((repository) => repositoryCommitCount(repository, comparisonRange.value) > 0)
      .length,
);
const comparisonLabel = (current: number, previous: number) => {
  const { percent } = gitActivityComparison(current, previous);
  if (percent === null) return `${t.value.activity.previousPeriod} ${previous}`;
  return `${t.value.activity.comparePrevious} ${percent >= 0 ? "+" : ""}${percent}% (${previous})`;
};
const comparisonTitle = computed(
  () =>
    `${t.value.activity.previousPeriod}: ${formatDate(comparisonRange.value.startDate)} - ${formatDate(comparisonRange.value.endDate)}`,
);
const busiestDay = computed(
  () =>
    [...countsByDate.value.entries()].sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]))[0] ||
    null,
);
const streaks = computed(() =>
  gitActivityStreaks(activityRange.value, new Set(countsByDate.value.keys()), today.value),
);
const filteredEntries = computed(() =>
  visibleRepositories.value.flatMap((repository) => {
    const authorId =
      selectedAuthorId.value === currentAuthorSelection ? repository.currentAuthorId : selectedAuthorId.value;
    return (repository.entries || [])
      .filter(
        (entry) =>
          entry.day >= activityRange.value.startDate &&
          entry.day <= activityRange.value.endDate &&
          (!authorId || entry.authorId === authorId),
      )
      .map((entry) => ({ ...entry, projectId: repository.repositoryPath }));
  }),
);
const hourlyCounts = computed(() => {
  const values = Array.from({ length: 24 }, () => 0);
  filteredEntries.value.forEach((entry) => (values[entry.hour] += 1));
  return values;
});
const maxHourlyCount = computed(() => Math.max(...hourlyCounts.value, 1));
const busiestHour = computed(() => {
  const count = Math.max(...hourlyCounts.value);
  return count > 0 ? { hour: hourlyCounts.value.indexOf(count), count } : null;
});
const conventionalCounts = computed(() => {
  const values = new Map<string, number>();
  filteredEntries.value.forEach((entry) => values.set(entry.type, (values.get(entry.type) || 0) + 1));
  return [...values.entries()].sort((left, right) => right[1] - left[1]);
});
const projectRows = computed(() => {
  const rows = readyRepositories.value.map((repository) => {
    const commits = repositoryCommitCount(repository, activityRange.value);
    const dates = repository.daily
      .filter((day) => day.date >= activityRange.value.startDate && day.date <= activityRange.value.endDate)
      .filter((day) => {
        const authorId =
          selectedAuthorId.value === currentAuthorSelection ? repository.currentAuthorId : selectedAuthorId.value;
        return (authorId ? day.authors[authorId] || 0 : selectedAuthorId.value ? 0 : day.commits) > 0;
      })
      .map((day) => day.date);
    return {
      repository,
      commits,
      activeDays: dates.length,
      recent: dates.at(-1) || "",
      share: totalCommits.value ? commits / totalCommits.value : 0,
    };
  });
  return rows.sort((left, right) => {
    if (projectSort.value === "recent") return right.recent.localeCompare(left.recent);
    return right[projectSort.value] - left[projectSort.value] || right.commits - left.commits;
  });
});
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
const rangeOptions = computed(() => [
  { value: "days7" as const, label: t.value.activity.days7 },
  { value: "days30" as const, label: t.value.activity.days30 },
  { value: "days90" as const, label: t.value.activity.days90 },
  { value: "currentYear" as const, label: t.value.activity.currentYear },
  { value: "rolling" as const, label: t.value.activity.rollingYear },
  { value: "custom" as const, label: t.value.activity.customRange },
]);
const projectSortOptions = computed(() => [
  { value: "commits" as const, label: t.value.activity.totalCommits },
  { value: "activeDays" as const, label: t.value.activity.activeDays },
  { value: "recent" as const, label: t.value.activity.recentActivity },
  { value: "share" as const, label: t.value.activity.share },
]);
const projectSortLabel = computed(
  () => projectSortOptions.value.find((option) => option.value === projectSort.value)?.label || "",
);
const customDatePickerValue = computed(() =>
  customDatePickerKind.value === "start"
    ? activityPreferences.value.customStartDate
    : customDatePickerKind.value === "end"
      ? activityPreferences.value.customEndDate
      : "",
);
const customDatePickerTitle = computed(() =>
  new Intl.DateTimeFormat(store.locale, { year: "numeric", month: "long" }).format(customDatePickerMonth.value),
);
const customDatePickerDays = computed(() => {
  const year = customDatePickerMonth.value.getFullYear();
  const month = customDatePickerMonth.value.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstVisibleDay = new Date(year, month, 1 - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstVisibleDay);
    date.setDate(firstVisibleDay.getDate() + index);
    const value = gitActivityDateInTimeZone(date, "local");
    return {
      value,
      label: String(date.getDate()),
      isCurrentMonth: date.getMonth() === month,
      isToday: value === gitActivityDateInTimeZone(new Date(), "local"),
      isSelected: value === customDatePickerValue.value,
      isInRange:
        Boolean(activityPreferences.value.customStartDate && activityPreferences.value.customEndDate) &&
        value >= activityPreferences.value.customStartDate &&
        value <= activityPreferences.value.customEndDate,
      disabled:
        customDatePickerKind.value === "end" &&
        Boolean(activityPreferences.value.customStartDate) &&
        value < activityPreferences.value.customStartDate,
    };
  });
});
const analysisTabs = computed(() => [
  {
    value: "day" as const,
    label: selectedDate.value
      ? `${t.value.activity.dailyRecords} · ${selectedDate.value.slice(5).replace("-", "/")}`
      : t.value.activity.dailyRecords,
    disabled: !selectedDate.value,
  },
  { value: "patterns" as const, label: t.value.activity.activityPatterns },
  { value: "projects" as const, label: t.value.activity.projectAnalysis },
  { value: "changes" as const, label: t.value.activity.changeStats },
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

const changeTotals = computed(() =>
  (changesReport.value?.repositories || []).reduce(
    (totals, repository) => ({
      commits: totals.commits + repository.commits,
      files: totals.files + repository.files,
      additions: totals.additions + repository.additions,
      deletions: totals.deletions + repository.deletions,
      binaryFiles: totals.binaryFiles + repository.binaryFiles,
    }),
    { commits: 0, files: 0, additions: 0, deletions: 0, binaryFiles: 0 },
  ),
);

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
    const report = await store.readGitActivityDay(
      {
        date,
        authorId:
          selectedAuthorId.value && selectedAuthorId.value !== currentAuthorSelection
            ? selectedAuthorId.value
            : undefined,
        currentUserOnly: selectedAuthorId.value === currentAuthorSelection,
        limit: 50,
        skip,
      },
      focusedRepositoryPath.value
        ? readyRepositories.value.find((repository) => repository.repositoryPath === focusedRepositoryPath.value)
            ?.projectPaths
        : undefined,
    );
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
  const { startDate } = comparisonRange.value;
  const { endDate } = activityRange.value;
  resetDayDetails();
  selectedDate.value = "";
  changesRequestGeneration += 1;
  changesReport.value = null;
  changesLoading.value = false;
  changesMessage.value = "";
  void store.loadGitActivity(force ? { startDate, endDate, force: true } : { startDate, endDate });
};

const setRangeMode = (mode: ActivityRangeMode) => {
  if (mode !== "custom") customDatePickerKind.value = null;
  rangeMode.value = mode;
};

const selectCalendarYear = (year: number) => {
  const normalizedYear = Math.min(9999, Math.max(1970, Math.round(year)));
  const range = calendarYearGitActivityRange(normalizedYear);
  store.setWorkActivityPreferences({
    rangeMode: "custom",
    selectedYear: normalizedYear,
    customStartDate: range.startDate,
    customEndDate: range.endDate,
  });
  customDatePickerKind.value = null;
};

const clearCustomDateRange = () => {
  store.setWorkActivityPreferences({ customStartDate: "", customEndDate: "" });
  customDatePickerKind.value = null;
};

const showCustomDatePickerMonth = (kind: CustomDatePickerKind) => {
  const value = kind === "start" ? activityPreferences.value.customStartDate : activityPreferences.value.customEndDate;
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : null;
  customDatePickerMonth.value = selected && Number.isFinite(selected.getTime()) ? selected : new Date();
};

const openCustomDatePicker = () => {
  if (customDatePickerKind.value) {
    customDatePickerKind.value = null;
    return;
  }
  const kind = "start";
  showCustomDatePickerMonth(kind);
  if (customDatePickerTriggerRef.value) positionDropdown(customDatePickerTriggerRef.value, customDatePickerPosition);
  customDatePickerKind.value = kind;
};

const activateCustomDatePicker = (kind: CustomDatePickerKind) => {
  showCustomDatePickerMonth(kind);
  customDatePickerKind.value = kind;
};

const shiftCustomDatePickerMonth = (months: number) => {
  customDatePickerMonth.value = new Date(
    customDatePickerMonth.value.getFullYear(),
    customDatePickerMonth.value.getMonth() + months,
    1,
  );
};

const shiftCustomDatePickerYear = (years: number) => {
  customDatePickerMonth.value = new Date(
    customDatePickerMonth.value.getFullYear() + years,
    customDatePickerMonth.value.getMonth(),
    1,
  );
};

const selectCustomDate = (value: string) => {
  if (customDatePickerKind.value === "start") {
    store.setWorkActivityPreferences({
      customStartDate: value,
      customEndDate: activityPreferences.value.customEndDate >= value ? activityPreferences.value.customEndDate : "",
    });
    customDatePickerKind.value = "end";
    return;
  }
  if (customDatePickerKind.value === "end") setActivityPreference("customEndDate", value);
  customDatePickerKind.value = null;
};

const selectAuthor = (authorId: string) => {
  selectedAuthorId.value = authorId;
  authorPickerOpen.value = false;
  resetDayDetails();
  changesReport.value = null;
  changesRequestGeneration += 1;
  if (analysisTab.value === "changes") void loadChanges();
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
  customDatePickerKind.value = null;
  projectSortOpen.value = false;
  authorPickerOpen.value = false;
  refScopePickerOpen.value = false;
  timeZonePickerOpen.value = false;
  projectScopeOpen.value = !projectScopeOpen.value;
  if (projectScopeOpen.value && projectScopeTriggerRef.value) {
    positionDropdown(projectScopeTriggerRef.value, projectScopeMenuPosition);
  }
};

const toggleAuthorPicker = () => {
  customDatePickerKind.value = null;
  projectSortOpen.value = false;
  projectScopeOpen.value = false;
  refScopePickerOpen.value = false;
  timeZonePickerOpen.value = false;
  authorPickerOpen.value = !authorPickerOpen.value;
  if (authorPickerOpen.value && authorPickerTriggerRef.value) {
    positionDropdown(authorPickerTriggerRef.value, authorPickerMenuPosition);
  }
};

const toggleRefScopePicker = () => {
  customDatePickerKind.value = null;
  projectSortOpen.value = false;
  projectScopeOpen.value = false;
  authorPickerOpen.value = false;
  timeZonePickerOpen.value = false;
  refScopePickerOpen.value = !refScopePickerOpen.value;
  if (refScopePickerOpen.value && refScopePickerTriggerRef.value) {
    positionDropdown(refScopePickerTriggerRef.value, refScopePickerMenuPosition);
  }
};

const toggleTimeZonePicker = () => {
  customDatePickerKind.value = null;
  projectSortOpen.value = false;
  projectScopeOpen.value = false;
  authorPickerOpen.value = false;
  refScopePickerOpen.value = false;
  timeZonePickerOpen.value = !timeZonePickerOpen.value;
  if (timeZonePickerOpen.value && timeZonePickerTriggerRef.value) {
    positionDropdown(timeZonePickerTriggerRef.value, timeZonePickerMenuPosition);
  }
};

const toggleProjectSort = () => {
  customDatePickerKind.value = null;
  projectScopeOpen.value = false;
  authorPickerOpen.value = false;
  refScopePickerOpen.value = false;
  timeZonePickerOpen.value = false;
  projectSortOpen.value = !projectSortOpen.value;
  if (projectSortOpen.value && projectSortTriggerRef.value) {
    positionDropdown(projectSortTriggerRef.value, projectSortMenuPosition);
  }
};

const selectProjectSort = (sort: ProjectSort) => {
  projectSort.value = sort;
  projectSortOpen.value = false;
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
  analysisTab.value = "day";
  void loadDayDetails();
};

const focusRepository = (repositoryPath: string) => {
  focusedRepositoryPath.value = focusedRepositoryPath.value === repositoryPath ? "" : repositoryPath;
  resetDayDetails();
  selectedDate.value = "";
  changesReport.value = null;
  changesRequestGeneration += 1;
};

const loadChanges = async (force = false) => {
  const requestGeneration = ++changesRequestGeneration;
  changesLoading.value = true;
  changesMessage.value = "";
  try {
    const projectPaths = focusedRepositoryPath.value
      ? readyRepositories.value.find((repository) => repository.repositoryPath === focusedRepositoryPath.value)
          ?.projectPaths
      : undefined;
    const report = await store.readGitActivityChanges(
      {
        ...activityRange.value,
        force,
        authorId:
          selectedAuthorId.value && selectedAuthorId.value !== currentAuthorSelection
            ? selectedAuthorId.value
            : undefined,
        currentUserOnly: selectedAuthorId.value === currentAuthorSelection,
      },
      projectPaths,
    );
    if (requestGeneration === changesRequestGeneration) changesReport.value = report;
  } catch (error) {
    if (requestGeneration === changesRequestGeneration) {
      changesMessage.value = error instanceof Error ? error.message : t.value.activity.readFailed;
    }
  } finally {
    if (requestGeneration === changesRequestGeneration) changesLoading.value = false;
  }
};

const setAnalysisTab = (tab: AnalysisTab) => {
  if (tab === "day" && !selectedDate.value) return;
  analysisTab.value = tab;
  if (tab === "changes" && !changesReport.value) void loadChanges();
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
  if (!projectSortTriggerRef.value?.contains(target) && !target.closest("[data-work-activity-sort-menu]")) {
    projectSortOpen.value = false;
  }
  if (!customDatePickerTriggerRef.value?.contains(target) && !target.closest("[data-work-activity-date-picker]")) {
    customDatePickerKind.value = null;
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
  if (projectSortOpen.value && projectSortTriggerRef.value) {
    positionDropdown(projectSortTriggerRef.value, projectSortMenuPosition);
  }
  if (customDatePickerKind.value) {
    if (customDatePickerTriggerRef.value) {
      positionDropdown(customDatePickerTriggerRef.value, customDatePickerPosition);
    }
  }
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (customDatePickerKind.value) {
    customDatePickerKind.value = null;
    event.detail.handle();
    return;
  }
  if (projectSortOpen.value) {
    projectSortOpen.value = false;
    event.detail.handle();
    return;
  }
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

watch(focusedRepositoryPath, () => {
  if (analysisTab.value === "changes") void loadChanges();
});

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
  changesRequestGeneration += 1;
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
      <div class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        <div
          class="flex h-7 max-w-full overflow-x-auto rounded-lg border border-border-subtle bg-surface"
          role="group"
          :aria-label="t.activity.range"
        >
          <button
            v-for="option in rangeOptions"
            :key="option.value"
            type="button"
            :class="
              cn(
                'inline-flex h-full shrink-0 items-center justify-center border-l border-border-subtle px-2 text-xs font-bold transition-colors first:border-l-0',
                rangeMode === option.value
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-variant',
              )
            "
            :aria-pressed="rangeMode === option.value"
            @click="setRangeMode(option.value)"
          >
            {{ option.label }}
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

    <section
      v-if="rangeMode === 'custom'"
      class="mb-3 flex flex-wrap items-center gap-2 border-y border-border-subtle py-2 text-xs"
    >
      <span class="font-bold text-on-surface-variant">{{ t.activity.customRange }}</span>
      <button
        ref="customDatePickerTriggerRef"
        type="button"
        class="ui-field ui-field-compact flex min-w-64 items-center justify-between gap-2 px-2 text-left"
        :aria-expanded="Boolean(customDatePickerKind)"
        @click="openCustomDatePicker"
      >
        <span
          class="min-w-0 truncate"
          :class="
            activityPreferences.customStartDate && activityPreferences.customEndDate
              ? 'text-on-surface'
              : 'text-on-surface-variant/70'
          "
        >
          {{ activityPreferences.customStartDate || t.activity.startDate }}
          <span class="px-1 text-on-surface-variant">-</span>
          {{ activityPreferences.customEndDate || t.activity.endDate }}
        </span>
        <CalendarDays :size="13" class="text-on-surface-variant" />
      </button>
      <span class="text-on-surface-variant">{{ t.activity.inclusiveRangeHint }}</span>

      <Teleport to="body">
        <Transition name="fade">
          <div
            v-if="customDatePickerKind"
            data-work-activity-date-picker
            class="date-picker-popover themed-scrollbar max-h-[calc(100vh-1rem)] overflow-y-auto"
            :style="{ right: `${customDatePickerPosition.right}px`, top: `${customDatePickerPosition.top}px` }"
          >
            <div class="mb-2 grid grid-cols-2 rounded-md bg-surface-container-high p-0.5">
              <button
                v-for="kind in ['start', 'end'] as const"
                :key="kind"
                type="button"
                :class="
                  cn(
                    'flex min-w-0 flex-col items-center rounded px-1.5 py-1 text-[10px] leading-tight transition-colors',
                    customDatePickerKind === kind
                      ? 'bg-surface text-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface',
                  )
                "
                @click="activateCustomDatePicker(kind)"
              >
                <span class="font-bold">{{ kind === "start" ? t.activity.startDate : t.activity.endDate }}</span>
                <span class="mt-0.5 min-h-3 whitespace-nowrap font-normal tabular-nums text-on-surface-variant">
                  {{
                    (kind === "start" ? activityPreferences.customStartDate : activityPreferences.customEndDate) || "—"
                  }}
                </span>
              </button>
            </div>
            <div class="mb-2 grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-1">
              <button
                type="button"
                class="popover-icon-button"
                :title="t.activity.previousYear"
                @click="shiftCustomDatePickerYear(-1)"
              >
                <ChevronLeft :size="13" /><ChevronLeft :size="13" class="-ml-2" />
              </button>
              <button
                type="button"
                class="popover-icon-button"
                :title="t.activity.previousMonth"
                @click="shiftCustomDatePickerMonth(-1)"
              >
                <ChevronLeft :size="14" />
              </button>
              <div class="text-center text-xs font-bold text-on-surface">{{ customDatePickerTitle }}</div>
              <button
                type="button"
                class="popover-icon-button"
                :title="t.activity.nextMonth"
                @click="shiftCustomDatePickerMonth(1)"
              >
                <ChevronRight :size="14" />
              </button>
              <button
                type="button"
                class="popover-icon-button"
                :title="t.activity.nextYear"
                @click="shiftCustomDatePickerYear(1)"
              >
                <ChevronRight :size="13" /><ChevronRight :size="13" class="-ml-2" />
              </button>
            </div>
            <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-on-surface-variant">
              <span v-for="label in weekdayLabels" :key="label">{{ label }}</span>
            </div>
            <div class="mt-1 grid grid-cols-7 gap-1">
              <button
                v-for="day in customDatePickerDays"
                :key="day.value"
                type="button"
                :disabled="day.disabled"
                :class="
                  cn(
                    'date-picker-day disabled:cursor-not-allowed disabled:opacity-25',
                    !day.isCurrentMonth && 'text-on-surface-variant/35',
                    day.isInRange && !day.isSelected && 'bg-primary/10 text-primary',
                    day.isToday && !day.isSelected && 'border-primary/35 text-primary',
                    day.isSelected && 'border-primary bg-primary text-on-primary',
                  )
                "
                @click="selectCustomDate(day.value)"
              >
                {{ day.label }}
              </button>
            </div>
            <div class="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                class="text-[10px] font-bold text-on-surface-variant hover:text-primary"
                @click="selectCalendarYear(customDatePickerMonth.getFullYear())"
              >
                {{ t.activity.selectCalendarYear.replace("{year}", String(customDatePickerMonth.getFullYear())) }}
              </button>
              <button
                type="button"
                class="text-[10px] font-bold text-on-surface-variant hover:text-primary"
                @click="selectCustomDate(today)"
              >
                {{ t.activity.today }}
              </button>
              <button
                type="button"
                class="text-[10px] font-bold text-on-surface-variant hover:text-primary"
                @click="clearCustomDateRange"
              >
                {{ t.activity.clearSelection }}
              </button>
            </div>
          </div>
        </Transition>
      </Teleport>
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

    <section
      v-if="focusedRepositoryPath"
      class="mb-2 flex items-center justify-between gap-2 border-y border-primary/30 bg-primary/5 px-2 py-1.5 text-xs"
    >
      <span class="min-w-0 truncate text-primary">
        {{ t.activity.temporaryFocus }}：{{ projectNamesForPaths(visibleRepositories[0]?.projectPaths || []) }}
      </span>
      <button
        type="button"
        class="inline-flex h-6 items-center gap-1 px-1.5 font-bold text-primary hover:bg-primary/10"
        @click="focusRepository('')"
      >
        <X :size="13" /> {{ t.activity.clearFocus }}
      </button>
    </section>

    <section class="mb-2 grid grid-cols-4 gap-1.5" :aria-busy="store.workActivityLoading">
      <div class="rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <div class="truncate text-[10px] font-bold text-on-surface-variant">{{ t.activity.totalCommits }}</div>
          <div class="shrink-0 text-base font-bold leading-none tabular-nums text-on-surface">{{ totalCommits }}</div>
        </div>
        <div class="mt-1 truncate text-[9px] tabular-nums text-on-surface-variant" :title="comparisonTitle">
          {{ comparisonLabel(totalCommits, previousCommits) }}
        </div>
      </div>
      <div class="rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <div class="truncate text-[10px] font-bold text-on-surface-variant">{{ t.activity.activeDays }}</div>
          <div class="shrink-0 text-base font-bold leading-none tabular-nums text-on-surface">{{ activeDays }}</div>
        </div>
        <div class="mt-1 truncate text-[9px] tabular-nums text-on-surface-variant" :title="comparisonTitle">
          {{ comparisonLabel(activeDays, previousActiveDays) }}
        </div>
      </div>
      <div class="rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <div class="truncate text-[10px] font-bold text-on-surface-variant">{{ t.activity.activeProjects }}</div>
          <div class="shrink-0 text-base font-bold leading-none tabular-nums text-on-surface">{{ activeProjects }}</div>
        </div>
        <div class="mt-1 truncate text-[9px] tabular-nums text-on-surface-variant" :title="comparisonTitle">
          {{ comparisonLabel(activeProjects, previousActiveProjects) }}
        </div>
      </div>
      <div class="rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 shadow-sm">
        <div class="text-[10px] font-bold text-on-surface-variant">{{ t.activity.busiestDay }}</div>
        <div class="mt-1 truncate text-xs font-bold text-on-surface">
          {{ busiestDay ? `${formatDate(busiestDay[0])} · ${busiestDay[1]}` : "—" }}
        </div>
      </div>
    </section>

    <section class="border-y border-border-subtle py-3" :aria-busy="store.workActivityLoading">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <CalendarDays :size="16" class="shrink-0 text-primary" />
          <h3 class="text-sm font-bold text-on-surface">{{ t.activity.heatmap }}</h3>
        </div>
        <div class="flex min-w-0 items-center gap-2">
          <button
            type="button"
            class="inline-flex min-w-0 items-center gap-1 text-[10px] text-on-surface-variant transition-colors hover:text-primary"
            :title="t.activity.criteria"
            :aria-expanded="criteriaOpen"
            @click="criteriaOpen = !criteriaOpen"
          >
            <Settings2 :size="12" class="shrink-0" />
            <span class="truncate">{{ criteriaSummary }}</span>
            <span v-if="excludedCommits" class="shrink-0 text-status-warning">
              · {{ t.activity.excludedCommits.replace("{count}", String(excludedCommits)) }}
            </span>
          </button>
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

      <div
        v-if="criteriaOpen"
        class="mb-3 grid gap-3 border-y border-border-subtle py-3 text-xs text-on-surface-variant lg:grid-cols-2"
      >
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

    <section class="border-b border-border-subtle py-3">
      <div
        v-overlay-scrollbar
        class="themed-scrollbar mb-3 flex overflow-x-auto border-b border-border-subtle"
        role="tablist"
        :aria-label="t.activity.analysis"
      >
        <button
          v-for="tab in analysisTabs"
          :key="tab.value"
          type="button"
          role="tab"
          class="inline-flex h-8 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :class="
            analysisTab === tab.value
              ? 'border-primary text-primary'
              : 'border-transparent text-on-surface-variant hover:text-on-surface'
          "
          :aria-selected="analysisTab === tab.value"
          :disabled="tab.disabled"
          @click="setAnalysisTab(tab.value)"
        >
          <BarChart3 v-if="tab.value === 'patterns'" :size="13" />
          <GitCompareArrows v-else-if="tab.value === 'changes'" :size="13" />
          <FolderGit2 v-else-if="tab.value === 'projects'" :size="13" />
          <CalendarDays v-else :size="13" />
          {{ tab.label }}
        </button>
      </div>

      <div v-if="analysisTab === 'projects'">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-on-surface-variant">
          <span>{{ t.activity.projectShareHint }}</span>
          <div class="flex items-center gap-1">
            <span>{{ t.activity.sortBy }}</span>
            <button
              ref="projectSortTriggerRef"
              type="button"
              class="inline-flex h-7 min-w-28 items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
              aria-haspopup="menu"
              :aria-expanded="projectSortOpen"
              @click="toggleProjectSort"
            >
              <span>{{ projectSortLabel }}</span>
              <ChevronDown :size="14" :class="projectSortOpen && 'rotate-180'" />
            </button>
          </div>
        </div>
        <Teleport to="body">
          <Transition name="fade">
            <div
              v-if="projectSortOpen"
              data-work-activity-sort-menu
              role="menu"
              class="fixed z-50 min-w-36 rounded-lg border border-border-subtle bg-surface p-1 shadow-xl"
              :style="{ right: `${projectSortMenuPosition.right}px`, top: `${projectSortMenuPosition.top}px` }"
            >
              <button
                v-for="option in projectSortOptions"
                :key="option.value"
                type="button"
                role="menuitemradio"
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors"
                :class="
                  projectSort === option.value
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-variant hover:bg-surface-variant'
                "
                :aria-checked="projectSort === option.value"
                @click="selectProjectSort(option.value)"
              >
                <Check v-if="projectSort === option.value" :size="14" />
                <span v-else class="w-3.5" />
                <span class="font-semibold">{{ option.label }}</span>
              </button>
            </div>
          </Transition>
        </Teleport>
        <div class="overflow-x-auto border-y border-border-subtle">
          <table class="w-full min-w-[34rem] text-left text-xs">
            <thead class="text-[10px] text-on-surface-variant">
              <tr>
                <th class="px-2 py-1.5">{{ t.activity.project }}</th>
                <th class="px-2 py-1.5 text-right">{{ t.activity.totalCommits }}</th>
                <th class="px-2 py-1.5 text-right">{{ t.activity.activeDays }}</th>
                <th class="px-2 py-1.5 text-right">{{ t.activity.recentActivity }}</th>
                <th class="px-2 py-1.5 text-right">{{ t.activity.share }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border-subtle">
              <tr
                v-for="row in projectRows"
                :key="row.repository.repositoryPath"
                class="cursor-pointer transition-colors hover:bg-surface-variant"
                :class="focusedRepositoryPath === row.repository.repositoryPath && 'bg-primary/10'"
                @click="focusRepository(row.repository.repositoryPath)"
              >
                <td
                  class="max-w-72 truncate px-2 py-2 font-bold text-on-surface"
                  :title="projectNamesForPaths(row.repository.projectPaths)"
                >
                  {{ projectNamesForPaths(row.repository.projectPaths) }}
                </td>
                <td class="px-2 py-2 text-right tabular-nums">{{ row.commits }}</td>
                <td class="px-2 py-2 text-right tabular-nums">{{ row.activeDays }}</td>
                <td class="px-2 py-2 text-right">{{ row.recent ? formatDate(row.recent) : "—" }}</td>
                <td class="px-2 py-2 text-right tabular-nums">{{ Math.round(row.share * 100) }}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else-if="analysisTab === 'patterns'" class="grid gap-4 lg:grid-cols-2">
        <div>
          <div class="mb-2 grid grid-cols-2 gap-2">
            <div class="border-y border-border-subtle px-2 py-2">
              <div class="text-[10px] text-on-surface-variant">{{ t.activity.currentStreak }}</div>
              <div class="text-lg font-bold tabular-nums">{{ streaks.current }}</div>
            </div>
            <div class="border-y border-border-subtle px-2 py-2">
              <div class="text-[10px] text-on-surface-variant">{{ t.activity.longestStreak }}</div>
              <div class="text-lg font-bold tabular-nums">{{ streaks.longest }}</div>
            </div>
          </div>
          <p class="text-[10px] text-on-surface-variant">{{ t.activity.streakHint }}</p>
          <h4 class="mt-3 text-xs font-bold text-on-surface">{{ t.activity.hourDistribution }}</h4>
          <div class="mt-2 grid grid-cols-[1.5rem_minmax(0,1fr)] gap-1">
            <div
              class="flex h-24 flex-col justify-between pb-4 text-right text-[8px] tabular-nums text-on-surface-variant"
            >
              <span>{{ maxHourlyCount }}</span
              ><span>0</span>
            </div>
            <div
              class="flex h-24 items-end gap-1 border-b border-border-subtle bg-[linear-gradient(to_bottom,transparent_49%,var(--color-border-subtle)_50%,transparent_51%)] px-1"
            >
              <div
                v-for="(count, hour) in hourlyCounts"
                :key="hour"
                class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                :title="t.activity.hourCount.replace('{hour}', String(hour)).replace('{count}', String(count))"
              >
                <div
                  class="w-full min-w-1 bg-primary/70"
                  :class="busiestHour?.hour === hour && 'bg-status-running'"
                  :style="{ height: `${count ? Math.max(4, (count / maxHourlyCount) * 72) : 1}px` }"
                />
                <span class="h-3 whitespace-nowrap text-[8px] text-on-surface-variant">{{
                  hour % 6 === 0 ? `${hour}h` : ""
                }}</span>
              </div>
            </div>
          </div>
        </div>
        <div>
          <h4 class="mb-2 text-xs font-bold text-on-surface">{{ t.activity.commitTypes }}</h4>
          <div class="space-y-1.5">
            <div
              v-for="[type, count] in conventionalCounts"
              :key="type"
              class="grid grid-cols-[5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs"
            >
              <span class="truncate font-mono text-on-surface-variant">{{ type }}</span>
              <span class="h-2 overflow-hidden bg-surface-container-high">
                <span
                  class="block h-full bg-status-running"
                  :style="{ width: `${totalCommits ? (count / totalCommits) * 100 : 0}%` }"
                />
              </span>
              <span class="text-right tabular-nums">{{ count }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="analysisTab === 'changes'">
        <div v-if="changesLoading" class="space-y-2" aria-busy="true">
          <div v-for="index in 3" :key="index" class="skeleton h-8 w-full" />
        </div>
        <p v-else-if="changesMessage" class="text-xs text-status-warning">{{ changesMessage }}</p>
        <div v-else-if="changesReport" class="space-y-3">
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div class="border-y border-border-subtle px-2 py-2">
              <div class="text-[10px] text-on-surface-variant">{{ t.activity.additions }}</div>
              <div class="font-bold tabular-nums text-status-success">+{{ changeTotals.additions }}</div>
            </div>
            <div class="border-y border-border-subtle px-2 py-2">
              <div class="text-[10px] text-on-surface-variant">{{ t.activity.deletions }}</div>
              <div class="font-bold tabular-nums text-status-error">-{{ changeTotals.deletions }}</div>
            </div>
            <div class="border-y border-border-subtle px-2 py-2">
              <div class="text-[10px] text-on-surface-variant">{{ t.activity.changedFiles }}</div>
              <div class="font-bold tabular-nums">{{ changeTotals.files }}</div>
            </div>
            <div class="border-y border-border-subtle px-2 py-2">
              <div class="text-[10px] text-on-surface-variant">{{ t.activity.binaryFiles }}</div>
              <div class="font-bold tabular-nums">{{ changeTotals.binaryFiles }}</div>
            </div>
          </div>
          <p class="text-[10px] text-on-surface-variant">{{ t.activity.changeStatsHint }}</p>
          <button
            type="button"
            class="h-7 rounded-md border border-border-subtle px-2 text-xs font-bold hover:bg-surface-variant"
            @click="loadChanges(true)"
          >
            {{ t.common.refresh }}
          </button>
        </div>
      </div>

      <div v-else class="py-1">
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
        <div
          v-else-if="dayDetailsMessage"
          class="border border-status-warning/30 px-3 py-3 text-sm text-status-warning"
        >
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
      </div>
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
