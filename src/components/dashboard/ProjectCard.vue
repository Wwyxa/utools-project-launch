<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Play,
  Square,
  LoaderCircle,
  AlertTriangle,
  FolderOpen,
  Pencil,
  Copy,
  TerminalSquare,
  Trash2,
  ChevronRight,
  AppWindow,
  GripVertical,
  Link2,
  FileDiff,
  CalendarDays,
  Ellipsis,
  GitCommitHorizontal,
  Clock3,
} from "lucide-vue-next";
import {
  PROJECT_TINY_CARD_BUTTON_COUNT_DEFAULT,
  PROJECT_TINY_CARD_BUTTON_COUNT_MAX,
  Project,
  ProjectStatus,
  ProjectIconKey,
} from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { formatAbsoluteTime, formatRelativeTime } from "../../lib/time";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import ProjectIcon from "../project/ProjectIcon.vue";
import ExternalApplicationLaunchButton from "../project/ExternalApplicationLaunchButton.vue";

const PROJECT_CARD_WIDTH_MEASUREMENT_SAMPLE_LIMIT = 64;
let projectCardWidthMeasurementSampleCount = 0;
let projectCardWidthMeasurementTotalDurationMs = 0;
let projectCardWidthMeasurementMaxDurationMs = 0;
let projectCardWidthMeasurementFlushFrame: number | null = null;
let projectCardWidthMeasurementReported = false;

const resetProjectCardWidthMeasurement = () => {
  projectCardWidthMeasurementSampleCount = 0;
  projectCardWidthMeasurementTotalDurationMs = 0;
  projectCardWidthMeasurementMaxDurationMs = 0;
};

const flushProjectCardWidthMeasurement = () => {
  projectCardWidthMeasurementFlushFrame = null;
  const mark = window.__utoolsProjectLaunchStartupTiming?.mark;
  if (!mark || projectCardWidthMeasurementSampleCount === 0) {
    resetProjectCardWidthMeasurement();
    return;
  }

  mark("project-card-width-measurement-aggregate", {
    sampleCount: projectCardWidthMeasurementSampleCount,
    sampleLimit: PROJECT_CARD_WIDTH_MEASUREMENT_SAMPLE_LIMIT,
    sampleLimitReached: projectCardWidthMeasurementSampleCount === PROJECT_CARD_WIDTH_MEASUREMENT_SAMPLE_LIMIT ? 1 : 0,
    durationMs: Math.round(projectCardWidthMeasurementTotalDurationMs * 100) / 100,
    maxDurationMs: Math.round(projectCardWidthMeasurementMaxDurationMs * 100) / 100,
  });
  projectCardWidthMeasurementReported = true;
  resetProjectCardWidthMeasurement();
};

const recordProjectCardWidthMeasurement = (durationMs: number) => {
  if (
    projectCardWidthMeasurementReported ||
    projectCardWidthMeasurementSampleCount >= PROJECT_CARD_WIDTH_MEASUREMENT_SAMPLE_LIMIT
  ) {
    return;
  }

  projectCardWidthMeasurementSampleCount += 1;
  projectCardWidthMeasurementTotalDurationMs += durationMs;
  projectCardWidthMeasurementMaxDurationMs = Math.max(projectCardWidthMeasurementMaxDurationMs, durationMs);
  if (projectCardWidthMeasurementFlushFrame === null) {
    projectCardWidthMeasurementFlushFrame = window.requestAnimationFrame(flushProjectCardWidthMeasurement);
  }
};

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  project: Project;
  isSorting?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  dragOverPosition?: "before" | "after";
  showGroupBadge?: boolean;
  groupLabel?: string;
  showPathHint?: boolean;
}>();

const emit = defineEmits<{
  (e: "select", id: string): void;
}>();

const store = useStore();
const t = useI18n();
const tinyToolbarAlignRight = ref(false);
const tinyCardContextMenu = ref<{ x: number; y: number } | null>(null);
const tinyCardContextMenuRef = ref<HTMLElement | null>(null);
const actionMenuTriggerRef = ref<HTMLButtonElement | null>(null);
let cardActionMenuCloseTimer: number | null = null;
const tinyCardApplicationMenu = ref<{ x: number; y: number } | null>(null);
const tinyCardApplicationMenuRef = ref<HTMLElement | null>(null);
let tinyCardApplicationMenuCloseTimer: number | null = null;
const moreScriptsOpen = ref(false);
const moreScriptsRef = ref<HTMLElement | null>(null);
const moreScriptsMenuRef = ref<HTMLElement | null>(null);
const moreScriptsPosition = ref({ left: 8, top: 8 });
let moreScriptsCloseTimer: number | null = null;
const scriptRowRef = ref<HTMLElement | null>(null);
const scriptMeasureRef = ref<HTMLElement | null>(null);
let stopAppEscapeListener = () => {};
const visibleScriptLimit = ref(3);
const maxVisibleScriptButtons = 3;
const scriptButtonGapFallback = 6;
let scriptRowResizeObserver: ResizeObserver | null = null;
let visibleScriptMeasureFrame: number | null = null;
let initialWidthMeasurementRecorded = false;

const isRunning = computed(() => props.project.status === ProjectStatus.RUNNING);
const isError = computed(() => props.project.status === ProjectStatus.ERROR);
const isWarning = computed(() => props.project.status === ProjectStatus.WARNING);
const hasCardStatus = computed(() => isRunning.value || isError.value || isWarning.value);
const cardStatusLabel = computed(() => {
  if (isRunning.value) return t.value.common.running;
  if (isError.value) return t.value.common.error;
  return isWarning.value ? t.value.common.warning : "";
});
const isTiny = computed(() => props.project.cardStyle === "tiny");
const isUnavailable = computed(() => props.project.pathExists === false);
const quickLink = computed(() => props.project.quickLink?.trim() || "");
const enabledExternalApplications = computed(() =>
  store.externalApplicationPreferences.applications.filter((application) => application.enabled),
);
const defaultExternalApplication = computed(
  () =>
    enabledExternalApplications.value.find(
      (application) => application.id === store.externalApplicationPreferences.defaultApplicationId,
    ) ||
    enabledExternalApplications.value[0] ||
    null,
);
const otherExternalApplications = computed(() =>
  enabledExternalApplications.value.filter((application) => application.id !== defaultExternalApplication.value?.id),
);
const displayGroupLabel = computed(() => props.groupLabel?.trim() || props.project.group?.trim() || "");
const activeScripts = computed(() =>
  props.project.scripts.filter((script) => script.status === "RUNNING" || script.status === "STOPPING"),
);
const prioritizedScripts = computed(() => {
  const activeIds = new Set(activeScripts.value.map((script) => script.id));
  return [...activeScripts.value, ...props.project.scripts.filter((script) => !activeIds.has(script.id))];
});
const tinyVisibleScripts = computed(() => {
  const configuredCount = props.project.tinyCardButtonCount ?? PROJECT_TINY_CARD_BUTTON_COUNT_DEFAULT;
  const buttonCount = Math.min(PROJECT_TINY_CARD_BUTTON_COUNT_MAX, Math.max(0, Math.floor(configuredCount)));
  return prioritizedScripts.value.slice(0, buttonCount);
});
const visibleScripts = computed(() => prioritizedScripts.value.slice(0, visibleScriptLimit.value));

const parsePixelValue = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getFallbackVisibleScriptLimit = () => Math.min(prioritizedScripts.value.length, maxVisibleScriptButtons);

const calculateVisibleScriptLimit = () => {
  const scriptCount = prioritizedScripts.value.length;
  if (scriptCount === 0) {
    return 0;
  }

  const rowElement = scriptRowRef.value;
  const measureElement = scriptMeasureRef.value;
  if (!rowElement || !measureElement) {
    return getFallbackVisibleScriptLimit();
  }

  const availableWidth = rowElement.getBoundingClientRect().width;
  if (availableWidth <= 0) {
    return getFallbackVisibleScriptLimit();
  }

  const scriptButtonWidths = Array.from(
    measureElement.querySelectorAll<HTMLElement>("[data-script-measure-button]"),
  ).map((element) => Math.ceil(element.getBoundingClientRect().width));

  if (scriptButtonWidths.length === 0) {
    return getFallbackVisibleScriptLimit();
  }

  const moreButtonWidth = Math.ceil(
    measureElement.querySelector<HTMLElement>("[data-script-more-measure]")?.getBoundingClientRect().width || 0,
  );
  const rowStyle = window.getComputedStyle(rowElement);
  const gap = parsePixelValue(rowStyle.columnGap || rowStyle.gap, scriptButtonGapFallback);
  const maxCandidate = Math.min(scriptCount, maxVisibleScriptButtons, scriptButtonWidths.length);

  for (let candidate = maxCandidate; candidate >= 1; candidate -= 1) {
    const visibleWidth = scriptButtonWidths.slice(0, candidate).reduce((total, width) => total + width, 0);
    const visibleGaps = Math.max(candidate - 1, 0) * gap;
    const needsMoreButton = candidate < scriptCount;
    const totalWidth = visibleWidth + visibleGaps + (needsMoreButton ? moreButtonWidth + gap : 0);

    if (totalWidth <= availableWidth + 1) {
      return candidate;
    }
  }

  return 1;
};

const updateVisibleScriptLimit = () => {
  visibleScriptLimit.value = calculateVisibleScriptLimit();
};

const scheduleVisibleScriptMeasure = async () => {
  await nextTick();
  if (typeof window === "undefined") {
    updateVisibleScriptLimit();
    return;
  }

  if (visibleScriptMeasureFrame !== null) {
    window.cancelAnimationFrame(visibleScriptMeasureFrame);
  }
  visibleScriptMeasureFrame = window.requestAnimationFrame(() => {
    visibleScriptMeasureFrame = null;
    const shouldRecordInitialMeasurement =
      !initialWidthMeasurementRecorded &&
      !projectCardWidthMeasurementReported &&
      Boolean(window.__utoolsProjectLaunchStartupTiming?.mark);
    const measurementStartedAt = shouldRecordInitialMeasurement ? performance.now() : 0;
    updateVisibleScriptLimit();
    if (shouldRecordInitialMeasurement) {
      initialWidthMeasurementRecorded = true;
      recordProjectCardWidthMeasurement(performance.now() - measurementStartedAt);
    }
  });
};

watch(
  () => prioritizedScripts.value.map((script) => `${script.id}:${script.name}:${script.status}`).join("|"),
  () => {
    void scheduleVisibleScriptMeasure();
  },
  { immediate: true },
);

watch(
  scriptRowRef,
  (rowElement, previousRowElement) => {
    if (previousRowElement) {
      scriptRowResizeObserver?.unobserve(previousRowElement);
    }
    if (rowElement) {
      scriptRowResizeObserver?.observe(rowElement);
    }
    void scheduleVisibleScriptMeasure();
  },
  { flush: "post" },
);

onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    scriptRowResizeObserver = new ResizeObserver(() => {
      void scheduleVisibleScriptMeasure();
    });
    if (scriptRowRef.value) {
      scriptRowResizeObserver.observe(scriptRowRef.value);
    }
  } else {
    window.addEventListener("resize", scheduleVisibleScriptMeasure);
  }
  void scheduleVisibleScriptMeasure();
});

const hiddenRunningCount = computed(
  () =>
    activeScripts.value.filter((script) => !visibleScripts.value.some((visible) => visible.id === script.id)).length,
);
const hiddenScriptCount = computed(() => props.project.scripts.length - visibleScripts.value.length);
const hiddenScripts = computed(() => {
  const visibleIds = new Set(visibleScripts.value.map((script) => script.id));
  return props.project.scripts.filter((script) => !visibleIds.has(script.id));
});
const projectStack = computed<{ kind: ProjectIconKey; title: string; label: string }>(() => {
  const explicitIcon = props.project.icon as ProjectIconKey | undefined;
  const typeText = `${props.project.type} ${props.project.name}`.toLowerCase();
  const scriptText = props.project.scripts
    .map((script) => `${script.command} ${script.note || ""}`)
    .join(" ")
    .toLowerCase();
  const source = `${typeText} ${scriptText}`;

  if (explicitIcon && explicitIcon !== "custom") {
    const label = explicitIcon === "executable" ? "EXE" : explicitIcon.toUpperCase();
    return { kind: explicitIcon, title: label, label };
  }
  if (props.project.kind === "node" && /\b(vue|vite|nuxt)\b/.test(source)) {
    return { kind: "vue", title: "Vue", label: "Vue" };
  }
  if (props.project.kind === "node") {
    return { kind: "node", title: "Node.js", label: "node" };
  }
  if (props.project.kind === "python") {
    return { kind: "python", title: "Python", label: "Py" };
  }
  if (props.project.kind === "go") {
    return { kind: "go", title: "Go", label: "Go" };
  }
  if (props.project.kind === "executable") {
    return { kind: "executable", title: t.value.projectKinds.executable, label: "EXE" };
  }
  return { kind: "custom", title: props.project.type || t.value.projectKinds.custom, label: "DEV" };
});
const latestGitCommitAt = computed(
  () => props.project.gitLatestCommitAt || props.project.git?.commits?.[0]?.date || "",
);
const parentDirectory = computed(() => {
  const path = props.project.path.replace(/\\/g, "/").replace(/\/+$/, "");
  const separator = path.lastIndexOf("/");
  return separator > 0 ? path.slice(0, separator) : path;
});

const cardTimeMeta = computed(() => {
  const sourceTime =
    latestGitCommitAt.value || props.project.updatedAt || props.project.createdAt || props.project.lastUpdated;
  if (sourceTime) {
    const label = latestGitCommitAt.value
      ? t.value.projectActions.committedAt
      : props.project.updatedAt || !props.project.createdAt
        ? t.value.projectActions.updatedAt
        : t.value.projectActions.createdAt;
    return {
      title: formatAbsoluteTime(sourceTime),
      value: label.replace("{time}", formatRelativeTime(sourceTime)),
    };
  }
  return { title: "", value: "" };
});
const gitChangedFileCount = computed(
  () => props.project.git?.files.length ?? store.stagedFiles[props.project.id]?.length ?? 0,
);
const gitChangedFileLabel = computed(() =>
  t.value.git.changedFiles.replace("{count}", String(gitChangedFileCount.value)),
);
const lowSignalCardErrorPatterns = [
  /^exited with code (?:\d+|unknown)$/i,
  /\ba complete log of this run can be found in:/i,
];
const isLowSignalCardErrorMessage = (message: string) =>
  lowSignalCardErrorPatterns.some((pattern) => pattern.test(message.trim()));

const cardErrorMessage = computed(() => {
  const errorLogs = [...(store.logs[props.project.id] || [])]
    .reverse()
    .filter((log) => log.type === "ERROR" && log.message.trim());
  const specificErrorLog = errorLogs.find((log) => !isLowSignalCardErrorMessage(log.message));
  if (specificErrorLog) {
    return specificErrorLog.message.trim();
  }

  const erroredScript = props.project.scripts.find((script) => script.status === "ERROR");
  return erroredScript ? `${erroredScript.name}: ${t.value.common.error}` : "Exit code 1";
});

const handleCardSelect = () => {
  if (props.isSorting) {
    return;
  }
  if (isUnavailable.value) {
    store.openEditProjectForm(props.project.id);
    return;
  }
  emit("select", props.project.id);
};

const clearTinyCardApplicationMenuClose = () => {
  if (tinyCardApplicationMenuCloseTimer === null) return;
  window.clearTimeout(tinyCardApplicationMenuCloseTimer);
  tinyCardApplicationMenuCloseTimer = null;
};

const closeTinyCardApplicationMenu = () => {
  clearTinyCardApplicationMenuClose();
  tinyCardApplicationMenu.value = null;
};

const scheduleTinyCardApplicationMenuClose = () => {
  clearTinyCardApplicationMenuClose();
  tinyCardApplicationMenuCloseTimer = window.setTimeout(() => {
    tinyCardApplicationMenuCloseTimer = null;
    tinyCardApplicationMenu.value = null;
  }, 120);
};

const clearCardActionMenuClose = () => {
  if (cardActionMenuCloseTimer === null) return;
  window.clearTimeout(cardActionMenuCloseTimer);
  cardActionMenuCloseTimer = null;
};

const scheduleCardActionMenuClose = () => {
  if (isTiny.value) return;
  clearCardActionMenuClose();
  cardActionMenuCloseTimer = window.setTimeout(closeTinyCardContextMenu, 120);
};

const handleCardActionMenuFocusOut = (event: FocusEvent) => {
  if (isTiny.value) return;
  if (event.relatedTarget instanceof Node &&
    (actionMenuTriggerRef.value?.contains(event.relatedTarget) ||
      tinyCardContextMenuRef.value?.contains(event.relatedTarget))) return;
  closeTinyCardContextMenu();
};

function closeTinyCardContextMenu() {
  clearCardActionMenuClose();
  tinyCardContextMenu.value = null;
  closeTinyCardApplicationMenu();
  window.removeEventListener("resize", closeTinyCardContextMenu);
  document.removeEventListener("scroll", handleCardActionMenuScroll, true);
  if (!moreScriptsOpen.value) {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleDocumentKeyDown);
  }
}

const handleEdit = (event: MouseEvent) => {
  event.stopPropagation();
  closeTinyCardContextMenu();
  store.openEditProjectForm(props.project.id);
};

const handleDuplicate = (event: MouseEvent) => {
  event.stopPropagation();
  closeTinyCardContextMenu();
  store.openDuplicateProjectForm(props.project.id);
};

const handleOpenFolder = async (event: MouseEvent) => {
  event.stopPropagation();
  closeTinyCardContextMenu();
  if (isUnavailable.value) {
    return;
  }
  await store.openProjectFolder(props.project.id);
};

const handleOpenTerminal = async (event: MouseEvent) => {
  event.stopPropagation();
  closeTinyCardContextMenu();
  if (isUnavailable.value) {
    return;
  }
  await store.openProjectInTerminal(props.project.id);
};

const handleOpenEditor = async (applicationId?: string) => {
  closeTinyCardContextMenu();
  await store.openProjectInEditor(props.project.id, applicationId);
};

const handleOpenQuickLink = async (event: MouseEvent) => {
  event.stopPropagation();
  closeTinyCardContextMenu();
  if (!quickLink.value) {
    return;
  }
  await store.openProjectQuickLink(props.project.id);
};

const handleOpenWorkActivity = (event: MouseEvent) => {
  event.stopPropagation();
  closeTinyCardContextMenu();
  if (isUnavailable.value) return;
  store.openWorkActivity(props.project.id);
};

const handleScriptToggle = async (event: MouseEvent, scriptId: string, status: string) => {
  event.stopPropagation();
  if (isUnavailable.value) {
    return;
  }
  if (status === "RUNNING") {
    await store.stopScript(props.project.id, scriptId);
    closeMoreScripts();
    return;
  }
  if (status === "STOPPING") {
    closeMoreScripts();
    return;
  }
  await store.launchScript(props.project.id, scriptId);
  closeMoreScripts();
};

const handleDocumentPointerDown = (event: PointerEvent) => {
  const target = event.target as Node;
  const isWithinTinyCardMenu =
    tinyCardContextMenuRef.value?.contains(target) || tinyCardApplicationMenuRef.value?.contains(target) ||
    actionMenuTriggerRef.value?.contains(target);
  if (!moreScriptsRef.value?.contains(target) && !moreScriptsMenuRef.value?.contains(target)) {
    closeMoreScripts();
  }
  if (!isWithinTinyCardMenu) {
    closeTinyCardContextMenu();
  }
  if (!moreScriptsOpen.value && !tinyCardContextMenu.value && !tinyCardApplicationMenu.value) {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleDocumentKeyDown);
  }
};

const handleDocumentKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    const restoreActionFocus = Boolean(tinyCardContextMenu.value && !isTiny.value);
    closeMoreScripts();
    closeTinyCardContextMenu();
    if (restoreActionFocus) actionMenuTriggerRef.value?.focus();
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleDocumentKeyDown);
  }
};

const clearMoreScriptsClose = () => {
  if (moreScriptsCloseTimer === null) return;
  window.clearTimeout(moreScriptsCloseTimer);
  moreScriptsCloseTimer = null;
};

const closeMoreScripts = () => {
  clearMoreScriptsClose();
  moreScriptsOpen.value = false;
  window.removeEventListener("resize", closeMoreScripts);
  document.removeEventListener("scroll", handleMoreScriptsScroll, true);
  if (!tinyCardContextMenu.value && !tinyCardApplicationMenu.value) {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleDocumentKeyDown);
  }
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (tinyCardContextMenu.value || tinyCardApplicationMenu.value) {
    closeTinyCardContextMenu();
    if (!isTiny.value) actionMenuTriggerRef.value?.focus();
    event.detail.handle();
    return;
  }
  if (!moreScriptsOpen.value) return;
  closeMoreScripts();
  event.detail.handle();
};

const handleMoreScriptsScroll = (event: Event) => {
  if (event.target instanceof Node && moreScriptsMenuRef.value?.contains(event.target)) return;
  closeMoreScripts();
};

const openMoreScripts = async () => {
  if (props.isSorting) return;
  clearMoreScriptsClose();
  if (moreScriptsOpen.value) return;
  moreScriptsOpen.value = true;
  closeTinyCardContextMenu();
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeyDown);
  window.addEventListener("resize", closeMoreScripts);
  document.addEventListener("scroll", handleMoreScriptsScroll, true);
  await nextTick();
  const opener = moreScriptsRef.value;
  const menu = moreScriptsMenuRef.value;
  if (!moreScriptsOpen.value || !opener || !menu) return;
  const openerRect = opener.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const top = openerRect.bottom + 4 + menuRect.height <= viewportHeight - 8
    ? openerRect.bottom + 4
    : openerRect.top - menuRect.height - 4;
  moreScriptsPosition.value = {
    left: Math.max(8, Math.min(openerRect.right - menuRect.width, viewportWidth - menuRect.width - 8)),
    top: Math.max(8, Math.min(top, viewportHeight - menuRect.height - 8)),
  };
};

const scheduleMoreScriptsClose = () => {
  clearMoreScriptsClose();
  moreScriptsCloseTimer = window.setTimeout(closeMoreScripts, 120);
};

const handleMoreScriptsFocusOut = (event: FocusEvent) => {
  if (
    event.relatedTarget instanceof Node &&
    (moreScriptsRef.value?.contains(event.relatedTarget) || moreScriptsMenuRef.value?.contains(event.relatedTarget))
  ) return;
  closeMoreScripts();
};

watch([hiddenScriptCount, isTiny, () => props.isSorting, () => props.project.id], () => {
  closeMoreScripts();
  closeTinyCardContextMenu();
});

onMounted(() => {
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});

onBeforeUnmount(() => {
  if (visibleScriptMeasureFrame !== null) {
    window.cancelAnimationFrame(visibleScriptMeasureFrame);
  }
  scriptRowResizeObserver?.disconnect();
  window.removeEventListener("resize", scheduleVisibleScriptMeasure);
  closeMoreScripts();
  closeTinyCardContextMenu();
  stopAppEscapeListener();
});

const handleDelete = (event: MouseEvent) => {
  event.stopPropagation();
  closeTinyCardContextMenu();
  store.requestDeleteProject(props.project.id);
};

const handleTinyCardContextMenu = async (event: MouseEvent) => {
  if (props.isSorting || store.uiPreferences.dashboard.tinyCardActionTrigger !== "contextmenu") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  await openCardActionMenu(event.clientX, event.clientY);
};

const handleCardActionMenuScroll = (event: Event) => {
  if (event.target instanceof Node &&
    (tinyCardContextMenuRef.value?.contains(event.target) || tinyCardApplicationMenuRef.value?.contains(event.target))) return;
  closeTinyCardContextMenu();
};

const openCardActionMenu = async (x: number, y: number, openerTop?: number, focusMenu = false) => {
  clearCardActionMenuClose();
  closeMoreScripts();
  closeTinyCardApplicationMenu();
  tinyCardContextMenu.value = { x, y };
  await nextTick();

  const menu = tinyCardContextMenuRef.value;
  const position = tinyCardContextMenu.value;
  if (!menu || !position) return;
  const rect = menu.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const inset = 8;
  const top = openerTop !== undefined && y + rect.height > viewportHeight - inset
    ? openerTop - rect.height - 4
    : y;
  tinyCardContextMenu.value = {
    x: Math.max(inset, Math.min(openerTop === undefined ? position.x : x - rect.width, viewportWidth - rect.width - inset)),
    y: Math.max(inset, Math.min(top, viewportHeight - rect.height - inset)),
  };
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeyDown);
  window.addEventListener("resize", closeTinyCardContextMenu);
  document.addEventListener("scroll", handleCardActionMenuScroll, true);
  if (focusMenu) menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
};

const openRegularCardActionMenu = async (focusMenu = false) => {
  if (props.isSorting) return;
  clearCardActionMenuClose();
  if (tinyCardContextMenu.value) {
    if (focusMenu) tinyCardContextMenuRef.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return;
  }
  const opener = actionMenuTriggerRef.value;
  if (!opener) return;
  const rect = opener.getBoundingClientRect();
  await openCardActionMenu(rect.right, rect.bottom + 4, rect.top, focusMenu);
};

const handleActionMenuKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Tab") {
    closeTinyCardContextMenu();
    if (!isTiny.value) actionMenuTriggerRef.value?.focus();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const menu = event.currentTarget as HTMLElement;
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'));
  if (items.length === 0) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[nextIndex]?.focus();
};

const openTinyCardApplicationMenu = async (event: MouseEvent | FocusEvent) => {
  if (!tinyCardContextMenu.value || otherExternalApplications.value.length === 0) {
    return;
  }
  clearTinyCardApplicationMenuClose();
  const opener = event.currentTarget as HTMLElement | null;
  if (!opener) return;

  const openerRect = opener.getBoundingClientRect();
  tinyCardApplicationMenu.value = { x: openerRect.right + 4, y: openerRect.top };
  await nextTick();

  const menu = tinyCardApplicationMenuRef.value;
  if (!menu) return;
  const menuRect = menu.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const inset = 8;
  const left =
    openerRect.right + menuRect.width + 4 <= viewportWidth - inset
      ? openerRect.right + 4
      : openerRect.left - menuRect.width - 4;
  tinyCardApplicationMenu.value = {
    x: Math.max(inset, Math.min(left, viewportWidth - menuRect.width - inset)),
    y: Math.max(inset, Math.min(openerRect.top, viewportHeight - menuRect.height - inset)),
  };
};

const updateTinyToolbarAlignment = (event: Event) => {
  const cardRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tinyToolbarAlignRight.value = cardRect.left + cardRect.width / 2 > window.innerWidth / 2;
};
</script>

<template>
  <div v-if="isTiny" v-bind="$attrs" class="group relative flex items-center">
    <div
      @click="handleCardSelect"
      @contextmenu="handleTinyCardContextMenu"
      @pointerenter="updateTinyToolbarAlignment"
      @focusin="updateTinyToolbarAlignment"
      :class="
        cn(
          'relative border border-border-subtle rounded-lg bg-surface shadow-[var(--project-card-shadow)] transition-all overflow-visible hover:bg-surface-container hover:border-primary/35 hover:shadow-[var(--project-card-hover-shadow)] focus-within:border-primary/50',
          'flex shrink-0 min-w-[4rem] max-w-[20rem] hover:after:absolute hover:after:inset-x-0 hover:after:top-full hover:after:h-8',
          isRunning &&
            'border-status-running/55 bg-status-running/[0.035] shadow-[var(--project-card-running-shadow)] hover:bg-status-running/[0.07] dark:bg-status-running/[0.08] dark:hover:bg-status-running/[0.12]',
          isDragging && 'opacity-55 scale-[0.99]',
          isSorting ? 'cursor-grab ring-1 ring-primary/30 border-primary/60 active:cursor-grabbing' : 'cursor-pointer',
          isDragOver &&
            (dragOverPosition === 'after'
              ? 'bg-primary/10 ring-1 ring-inset ring-primary/35 after:absolute after:-bottom-2 after:inset-x-3 after:z-20 after:h-0.5 after:rounded-full after:bg-primary after:pointer-events-none'
              : 'bg-primary/10 ring-1 ring-inset ring-primary/35 before:absolute before:-top-2 before:inset-x-3 before:z-20 before:h-0.5 before:rounded-full before:bg-primary before:pointer-events-none'),
        )
      "
    >
      <div class="flex items-center gap-1.5 py-1.5 px-2.5 min-h-0">
        <span
          class="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden"
          :title="projectStack.title"
          :aria-label="projectStack.title"
        >
          <ProjectIcon :icon="projectStack.kind" size="sm" />
        </span>
        <h3
          class="min-w-0 flex-1 truncate text-sm font-bold text-on-surface group-hover:text-primary transition-colors"
        >
          {{ project.name }}
        </h3>
        <span
          :class="cn('inline-flex shrink-0 items-center', !hasCardStatus && 'invisible')"
          :role="hasCardStatus ? 'status' : undefined"
          :title="hasCardStatus ? cardStatusLabel : undefined"
          :aria-label="hasCardStatus ? cardStatusLabel : undefined"
          :aria-hidden="hasCardStatus ? undefined : 'true'"
        >
          <span
            :class="
              cn(
                'h-2 w-2 rounded-full',
                isRunning ? 'bg-status-running animate-pulse' : isError ? 'bg-status-error' : 'bg-status-warning',
              )
            "
          />
        </span>
        <GripVertical
          v-if="isSorting"
          :size="14"
          class="shrink-0 text-on-surface-variant/55 dark:text-on-surface-variant"
        />
        <template v-else>
          <button
            v-for="script in tinyVisibleScripts"
            :key="script.id"
            type="button"
            @click.stop="handleScriptToggle($event, script.id, script.status)"
            :disabled="isUnavailable || script.status === 'STOPPING'"
            :aria-busy="script.status === 'STOPPING'"
            :class="
              cn(
                'inline-flex shrink-0 items-center justify-center h-6 w-6 rounded transition-colors',
                script.status === 'RUNNING'
                  ? 'text-status-running hover:bg-status-running/10'
                  : script.status === 'STOPPING'
                    ? 'text-status-warning cursor-wait'
                    : 'text-on-surface-variant/60 dark:text-on-surface-variant hover:text-status-running hover:bg-on-surface/5 dark:hover:bg-surface-container-high',
              )
            "
            :title="`${script.status === 'RUNNING' ? t.scripts.stopScript : script.status === 'STOPPING' ? t.common.stopping : t.scripts.startScript}: ${script.name}`"
            :aria-label="`${script.status === 'RUNNING' ? t.scripts.stopScript : script.status === 'STOPPING' ? t.common.stopping : t.scripts.startScript}: ${script.name}`"
          >
            <LoaderCircle v-if="script.status === 'STOPPING'" :size="13" class="animate-spin" />
            <Square v-else-if="script.status === 'RUNNING'" :size="13" fill="currentColor" />
            <Play v-else :size="13" fill="currentColor" />
          </button>
        </template>
      </div>
      <div
        v-if="!isSorting && store.uiPreferences.dashboard.tinyCardActionTrigger === 'hover'"
        :class="
          cn(
            'absolute top-[calc(100%+0.25rem)] z-30 flex items-center gap-0.5 rounded-md border border-outline-variant/60 dark:border-outline-variant bg-surface-container-lowest px-1 py-0.5 shadow-md transition-all',
            tinyToolbarAlignRight ? 'right-0' : 'left-0',
            'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
          )
        "
        @click.stop
      >
        <button
          v-if="quickLink && !isSorting"
          type="button"
          @click="handleOpenQuickLink"
          class="p-0.5 text-on-surface-variant/60 dark:text-on-surface-variant hover:text-primary rounded hover:bg-on-surface/5 dark:hover:bg-surface-container-high transition-colors"
          :title="t.projectActions.openQuickLink"
          :aria-label="t.projectActions.openQuickLink"
        >
          <Link2 :size="13" />
        </button>
        <button
          v-if="!isSorting"
          @click.stop="handleOpenTerminal"
          class="p-0.5 text-on-surface-variant/70 dark:text-on-surface-variant hover:text-status-running rounded hover:bg-on-surface/5 dark:hover:bg-surface-container-high transition-colors"
          :disabled="isUnavailable"
          :title="t.projectActions.openInTerminal"
          :aria-label="t.projectActions.openInTerminal"
        >
          <TerminalSquare :size="13" />
        </button>
        <ExternalApplicationLaunchButton
          v-if="!isSorting"
          :applications="store.externalApplicationPreferences.applications"
          :default-application-id="store.externalApplicationPreferences.defaultApplicationId"
          :disabled="isUnavailable"
          button-class="p-0.5 text-on-surface-variant/70 dark:text-on-surface-variant hover:text-primary rounded hover:bg-on-surface/5 dark:hover:bg-surface-container-high transition-colors disabled:opacity-50"
          :icon-size="13"
          @launch="handleOpenEditor"
        />
        <button
          v-if="!isSorting"
          @click.stop="handleOpenFolder"
          class="p-0.5 text-on-surface-variant/70 dark:text-on-surface-variant hover:text-on-surface rounded hover:bg-on-surface/5 dark:hover:bg-surface-container-high transition-colors"
          :disabled="isUnavailable"
          :title="t.common.openFolder"
          :aria-label="t.common.openFolder"
        >
          <FolderOpen :size="13" />
        </button>
        <button
          v-if="!isSorting"
          type="button"
          @click.stop="handleOpenWorkActivity"
          class="p-0.5 text-on-surface-variant/70 dark:text-on-surface-variant hover:text-primary rounded hover:bg-on-surface/5 dark:hover:bg-surface-container-high transition-colors"
          :disabled="isUnavailable"
          :title="t.activity.title"
          :aria-label="t.activity.title"
        >
          <CalendarDays :size="13" />
        </button>
        <button
          v-if="!isSorting"
          @click.stop="handleEdit"
          class="p-0.5 text-on-surface-variant/70 dark:text-on-surface-variant hover:text-primary rounded hover:bg-on-surface/5 dark:hover:bg-surface-container-high transition-colors"
          :title="t.common.edit"
          :aria-label="t.common.edit"
        >
          <Pencil :size="13" />
        </button>
        <button
          v-if="!isSorting"
          @click.stop="handleDuplicate"
          class="p-0.5 text-on-surface-variant/70 dark:text-on-surface-variant hover:text-primary rounded hover:bg-on-surface/5 dark:hover:bg-surface-container-high transition-colors"
          :title="t.projectActions.duplicateProject"
          :aria-label="t.projectActions.duplicateProject"
        >
          <Copy :size="13" />
        </button>
        <button
          v-if="!isSorting"
          @click.stop="handleDelete"
          class="p-0.5 text-on-surface-variant/70 dark:text-on-surface-variant hover:text-status-error rounded hover:bg-on-surface/5 dark:hover:bg-surface-container-high transition-colors"
          :title="t.projectActions.deleteProject"
          :aria-label="t.projectActions.deleteProject"
        >
          <Trash2 :size="13" />
        </button>
      </div>
      <div
        :class="
          cn(
            'absolute -left-px -top-px -bottom-px w-[5px] rounded-l-lg rounded-r-none pointer-events-none',
            isRunning
              ? 'bg-status-running'
              : isError
                ? 'bg-status-error'
                : isWarning
                  ? 'bg-status-warning'
                  : 'transparent',
          )
        "
      />
    </div>
  </div>
  <div
    v-else
    v-bind="$attrs"
    @click="handleCardSelect"
    :class="
      cn(
        'group relative border border-border-subtle rounded-lg bg-surface shadow-[var(--project-card-shadow)] transition-all overflow-visible hover:bg-surface-container hover:border-primary/35 hover:shadow-[var(--project-card-hover-shadow)] focus-within:border-primary/50',
        isRunning &&
          'border-status-running/55 bg-status-running/[0.035] shadow-[var(--project-card-running-shadow)] hover:bg-status-running/[0.07] dark:bg-status-running/[0.08] dark:hover:bg-status-running/[0.12]',
        isDragging && 'opacity-55 scale-[0.99]',
        isSorting ? 'cursor-grab ring-1 ring-primary/30 border-primary/60 active:cursor-grabbing' : 'cursor-pointer',
        isDragOver &&
          (dragOverPosition === 'after'
            ? 'bg-primary/10 ring-1 ring-inset ring-primary/35 after:absolute after:-bottom-2 after:inset-x-3 after:z-20 after:h-0.5 after:rounded-full after:bg-primary after:pointer-events-none'
            : 'bg-primary/10 ring-1 ring-inset ring-primary/35 before:absolute before:-top-2 before:inset-x-3 before:z-20 before:h-0.5 before:rounded-full before:bg-primary before:pointer-events-none'),
      )
    "
  >
    <div class="p-3 min-h-28 h-full flex flex-col">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span
              class="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden"
              :title="projectStack.title"
              :aria-label="projectStack.title"
            >
              <ProjectIcon :icon="projectStack.kind" size="sm" />
            </span>
            <h3
              class="min-w-0 truncate text-sm font-semibold text-on-surface group-hover:text-primary transition-colors"
              :title="`${project.name}\n${project.path}`"
            >
              {{ project.name }}
            </h3>
            <span
              v-if="hasCardStatus"
              class="inline-flex shrink-0 items-center"
              role="status"
              :title="cardStatusLabel"
              :aria-label="cardStatusLabel"
            >
              <span
                :class="
                  cn(
                    'h-2 w-2 rounded-full',
                    isRunning ? 'bg-status-running animate-pulse' : isError ? 'bg-status-error' : 'bg-status-warning',
                  )
                "
              />
            </span>
          </div>
        </div>

        <div v-if="isSorting || quickLink" class="flex shrink-0 items-center justify-end gap-1">
          <button
            v-if="quickLink && !isSorting"
            type="button"
            @click="handleOpenQuickLink"
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:border-primary/40 hover:bg-surface-container hover:text-primary"
            :title="t.projectActions.openQuickLink"
            :aria-label="t.projectActions.openQuickLink"
          >
            <Link2 :size="13" />
          </button>

          <GripVertical
            v-if="isSorting"
            :size="16"
            class="shrink-0 text-on-surface-variant/55 dark:text-on-surface-variant"
          />
        </div>
      </div>

      <p
        v-if="project.description"
        class="text-xs text-on-surface-variant/80 dark:text-on-surface-variant mt-1 line-clamp-1"
        :title="project.description"
      >
        {{ project.description }}
      </p>
      <p
        v-if="showPathHint"
        class="mt-1 truncate font-mono text-[11px] text-on-surface-variant/70"
        :title="project.path"
      >
        {{ parentDirectory }}
      </p>
      <p v-if="isUnavailable" class="text-[11px] text-status-warning mt-1 line-clamp-1">
        {{ project.unavailableReason || "当前设备无法访问该路径" }}
      </p>

      <div
        v-if="prioritizedScripts.length > 0"
        ref="scriptRowRef"
        class="flex min-w-0 items-center justify-start gap-1.5 mt-2 mb-2 flex-nowrap overflow-visible"
      >
        <button
          v-for="script in visibleScripts"
          :key="script.id"
          :title="script.command"
          :aria-label="`${script.status === 'RUNNING' ? t.scripts.stopScript : script.status === 'STOPPING' ? t.common.stopping : t.scripts.startScript}: ${script.name}`"
          @click="handleScriptToggle($event, script.id, script.status)"
          :disabled="isUnavailable || script.status === 'STOPPING'"
          :aria-busy="script.status === 'STOPPING'"
          :class="
            cn(
              'inline-flex h-6 flex-none min-w-max items-center gap-1.5 whitespace-nowrap text-[11px] font-medium px-2 rounded border transition-colors disabled:opacity-50',
              script.status === 'RUNNING'
                ? 'text-status-running bg-status-running/10 border-status-running/30 hover:bg-status-running/15'
                : script.status === 'STOPPING'
                  ? 'text-status-warning bg-status-warning/10 border-status-warning/30 cursor-wait'
                  : 'text-on-surface-variant bg-surface-variant border-transparent hover:text-on-surface hover:bg-surface-container-high',
            )
          "
        >
          <LoaderCircle v-if="script.status === 'STOPPING'" :size="10" class="shrink-0 animate-spin" />
          <Square
            v-else-if="script.status === 'RUNNING'"
            :size="10"
            class="shrink-0"
            fill="currentColor"
          />
          <Play v-else :size="11" class="shrink-0" fill="currentColor" />
          <span>{{ script.name }}</span>
        </button>
        <div
          v-if="hiddenScriptCount > 0"
          ref="moreScriptsRef"
          class="relative shrink-0"
          @mouseenter="openMoreScripts"
          @mouseleave="scheduleMoreScriptsClose"
          @focusin="openMoreScripts"
          @focusout="handleMoreScriptsFocusOut"
          @click.stop
        >
          <button
            type="button"
            @click="openMoreScripts"
            :class="cn(
              'inline-flex h-[21px] w-5 flex-none items-center justify-center whitespace-nowrap rounded-full border border-dashed text-[10px] font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              moreScriptsOpen
                ? 'border-primary/40 bg-primary/10 text-primary'
                : hiddenRunningCount > 0
                  ? 'border-status-running/40 text-status-running hover:bg-status-running/10'
                  : 'border-outline-variant bg-surface-variant text-on-surface-variant hover:border-primary/40 hover:bg-primary/10 hover:text-primary',
            )"
            aria-haspopup="menu"
            :aria-expanded="moreScriptsOpen"
            :aria-label="t.projectActions.moreScripts.replace('{count}', String(hiddenScriptCount))"
            :title="
              hiddenRunningCount > 0
                ? t.projectActions.moreRunning.replace('{count}', String(hiddenRunningCount))
                : t.projectActions.moreScripts.replace('{count}', String(hiddenScriptCount))
            "
          >
            <span>{{ hiddenScriptCount > 99 ? '99+' : hiddenScriptCount }}</span>
          </button>
          <Teleport to="body">
            <div
              v-if="moreScriptsOpen"
              ref="moreScriptsMenuRef"
              class="menu-pop fixed z-[75] w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-outline-variant/80 bg-surface-container-lowest p-2 shadow-lg"
              :style="{ left: `${moreScriptsPosition.left}px`, top: `${moreScriptsPosition.top}px` }"
              @click.stop
              @mouseenter="clearMoreScriptsClose"
              @mouseleave="scheduleMoreScriptsClose"
              @focusin="clearMoreScriptsClose"
              @focusout="handleMoreScriptsFocusOut"
              role="menu"
              :aria-label="`其他命令 (${hiddenScriptCount})`"
            >
              <div
                :class="cn(
                  'grid max-h-[min(12rem,calc(100vh-2rem))] gap-1.5 overflow-y-auto',
                  hiddenScripts.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
                )"
              >
                <button
                  v-for="script in hiddenScripts"
                  :key="script.id"
                  type="button"
                  @click="handleScriptToggle($event, script.id, script.status)"
                  :disabled="isUnavailable || script.status === 'STOPPING'"
                  :aria-busy="script.status === 'STOPPING'"
                  :class="
                    cn(
                      'inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded border px-2 text-left text-[11px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      script.status === 'RUNNING'
                        ? 'border-status-running/30 bg-status-running/10 text-status-running hover:bg-status-running/15'
                        : script.status === 'STOPPING'
                          ? 'border-status-warning/30 bg-status-warning/10 text-status-warning cursor-wait'
                          : 'border-transparent bg-surface-variant text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                    )
                  "
                  :title="script.command"
                  :aria-label="
                    script.status === 'RUNNING'
                      ? `${t.scripts.stopScript}: ${script.name}`
                      : script.status === 'STOPPING'
                        ? `${t.common.stopping}: ${script.name}`
                        : `${t.scripts.startScript}: ${script.name}`
                  "
                  role="menuitem"
                >
                  <LoaderCircle v-if="script.status === 'STOPPING'" :size="10" class="shrink-0 animate-spin" />
                  <Square
                    v-else-if="script.status === 'RUNNING'"
                    :size="10"
                    class="shrink-0 text-status-running"
                    fill="currentColor"
                  />
                  <Play v-else :size="11" class="shrink-0" fill="currentColor" />
                  <span class="truncate">{{ script.name }}</span>
                </button>
              </div>
            </div>
          </Teleport>
        </div>
      </div>

      <div
        v-if="prioritizedScripts.length > 0"
        ref="scriptMeasureRef"
        class="pointer-events-none fixed -left-[10000px] top-0 flex items-center gap-1.5 opacity-0"
        aria-hidden="true"
      >
        <span
          v-for="script in prioritizedScripts"
          :key="script.id"
          data-script-measure-button
          :class="
            cn(
              'inline-flex h-6 flex-none min-w-max items-center gap-1.5 whitespace-nowrap text-[11px] font-medium px-2 rounded border',
              script.status === 'RUNNING'
                ? 'border-status-running/30'
                : script.status === 'STOPPING'
                  ? 'border-status-warning/30'
                  : 'border-transparent',
            )
          "
        >
          <Square
            v-if="script.status === 'RUNNING' || script.status === 'STOPPING'"
            :size="10"
            class="shrink-0"
            fill="currentColor"
          />
          <Play v-else :size="11" class="shrink-0" fill="currentColor" />
          <span>{{ script.name }}</span>
        </span>
        <span
          data-script-more-measure
          class="inline-flex h-[21px] w-5 flex-none items-center justify-center whitespace-nowrap rounded-full border p-0 text-[10px] font-bold tabular-nums"
        />
      </div>

      <div class="mt-auto flex min-h-6 items-center border-t border-border-subtle pt-1">
        <div class="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-on-surface-variant">
          <span
            v-if="isError"
            class="flex min-w-0 items-center gap-1 truncate text-status-error"
            :title="cardErrorMessage"
          >
            <AlertTriangle :size="12" class="shrink-0" />
            <span class="truncate">{{ cardErrorMessage }}</span>
          </span>
          <span
            v-else-if="cardTimeMeta.value"
            class="flex min-w-0 items-center gap-1 truncate"
            :title="cardTimeMeta.title || cardTimeMeta.value"
          >
            <GitCommitHorizontal v-if="latestGitCommitAt" :size="12" class="shrink-0" />
            <Clock3 v-else :size="12" class="shrink-0" />
            <span class="truncate">{{ cardTimeMeta.value }}</span>
          </span>
          <span
            v-if="gitChangedFileCount > 0"
            class="inline-flex shrink-0 items-center gap-1 font-medium text-status-warning"
            :title="gitChangedFileLabel"
            :aria-label="gitChangedFileLabel"
          >
            <FileDiff :size="12" aria-hidden="true" />
            <span>{{ gitChangedFileCount }}</span>
          </span>
        </div>
        <div v-if="!isSorting" class="ml-2 flex shrink-0 items-center justify-end gap-0.5" @click.stop>
            <ExternalApplicationLaunchButton
              :applications="store.externalApplicationPreferences.applications"
              :default-application-id="store.externalApplicationPreferences.defaultApplicationId"
              :disabled="isUnavailable"
              button-class="inline-flex h-5 w-5 items-center justify-center rounded text-on-surface-variant/70 transition-colors hover:bg-on-surface/5 hover:text-primary dark:text-on-surface-variant dark:hover:bg-surface-container-high disabled:opacity-50"
              :icon-size="14"
              @launch="handleOpenEditor"
            />
            <button
              @click="handleOpenTerminal"
              class="inline-flex h-5 w-5 items-center justify-center rounded text-on-surface-variant/70 transition-colors hover:bg-on-surface/5 hover:text-status-running dark:text-on-surface-variant dark:hover:bg-surface-container-high disabled:opacity-50"
              :disabled="isUnavailable"
              :title="t.projectActions.openInTerminal"
              :aria-label="t.projectActions.openInTerminal"
            >
              <TerminalSquare :size="14" />
            </button>
            <button
              ref="actionMenuTriggerRef"
              type="button"
              @click="openRegularCardActionMenu(true)"
              @mouseenter="openRegularCardActionMenu()"
              @mouseleave="scheduleCardActionMenuClose"
              @keydown.down.prevent="openRegularCardActionMenu(true)"
              @focusout="handleCardActionMenuFocusOut"
              class="inline-flex h-5 w-5 items-center justify-center rounded text-on-surface-variant/70 transition-colors hover:bg-on-surface/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-on-surface-variant dark:hover:bg-surface-container-high"
              aria-haspopup="menu"
              :aria-expanded="Boolean(tinyCardContextMenu)"
              :title="t.projectActions.moreActions"
              :aria-label="t.projectActions.moreActions"
            >
              <Ellipsis :size="15" />
            </button>
        </div>
      </div>
    </div>
    <div
      :class="
        cn(
          'absolute -left-px -top-px -bottom-px w-[5px] rounded-l-lg rounded-r-none pointer-events-none',
          isRunning
            ? 'bg-status-running'
            : isError
              ? 'bg-status-error'
              : isWarning
                ? 'bg-status-warning'
                : 'transparent',
        )
      "
    />
  </div>
  <Teleport to="body">
    <div
      v-if="tinyCardContextMenu"
      ref="tinyCardContextMenuRef"
      class="tiny-card-context-menu menu-pop fixed z-[75] w-fit max-w-[min(13rem,calc(100vw-1rem))] overflow-hidden rounded-md border border-outline-variant/70 bg-surface-container-lowest p-px shadow-2xl"
      role="menu"
      :aria-label="isTiny ? t.settings.tinyCardActionTrigger : t.projectActions.moreActions"
      :style="{ left: `${tinyCardContextMenu.x}px`, top: `${tinyCardContextMenu.y}px` }"
      @click.stop
      @contextmenu.prevent
      @keydown="handleActionMenuKeyDown"
      @mouseenter="clearCardActionMenuClose"
      @mouseleave="scheduleCardActionMenuClose"
      @focusin="clearCardActionMenuClose"
      @focusout="handleCardActionMenuFocusOut"
    >
      <div v-overlay-scrollbar class="themed-scrollbar max-h-[calc(100vh-1.5rem)] overflow-y-auto">
        <button
          v-if="isTiny && quickLink"
          type="button"
          role="menuitem"
          class="mode-menu-item mode-menu-item--leading"
          @click="handleOpenQuickLink"
        >
          <Link2 :size="14" class="shrink-0" />
          <span class="min-w-0 truncate">{{ t.projectActions.menuOpenQuickLink }}</span>
        </button>
        <button
          v-if="isTiny"
          type="button"
          role="menuitem"
          class="mode-menu-item mode-menu-item--leading"
          :disabled="isUnavailable"
          @click="handleOpenTerminal"
        >
          <TerminalSquare :size="14" class="shrink-0" />
          <span class="min-w-0 truncate">{{ t.projectActions.menuOpenTerminal }}</span>
        </button>
        <button
          v-if="isTiny && defaultExternalApplication"
          type="button"
          role="menuitem"
          class="mode-menu-item mode-menu-item--leading"
          :disabled="isUnavailable"
          @mouseenter="openTinyCardApplicationMenu"
          @mouseleave="scheduleTinyCardApplicationMenuClose"
          @focusin="openTinyCardApplicationMenu"
          @click="handleOpenEditor(defaultExternalApplication.id)"
          :title="defaultExternalApplication.name"
        >
          <AppWindow :size="14" class="shrink-0" />
          <span class="min-w-0 truncate">{{ defaultExternalApplication.name }}</span>
          <ChevronRight v-if="otherExternalApplications.length > 0" :size="14" class="ml-auto shrink-0" />
        </button>
        <button
          type="button"
          role="menuitem"
          class="mode-menu-item mode-menu-item--leading"
          :disabled="isUnavailable"
          @click="handleOpenFolder"
        >
          <FolderOpen :size="14" class="shrink-0" />
          <span class="min-w-0 truncate">{{ t.common.openFolder }}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          class="mode-menu-item mode-menu-item--leading"
          :disabled="isUnavailable"
          @click="handleOpenWorkActivity"
        >
          <CalendarDays :size="14" class="shrink-0" />
          <span class="min-w-0 truncate">{{ t.activity.title }}</span>
        </button>
        <div class="mx-0.5 my-px border-t border-border-subtle" role="separator" />
        <button type="button" role="menuitem" class="mode-menu-item mode-menu-item--leading" @click="handleEdit">
          <Pencil :size="14" class="shrink-0" />
          <span class="min-w-0 truncate">{{ t.projectActions.menuEditProject }}</span>
        </button>
        <button type="button" role="menuitem" class="mode-menu-item mode-menu-item--leading" @click="handleDuplicate">
          <Copy :size="14" class="shrink-0" />
          <span class="min-w-0 truncate">{{ t.projectActions.menuDuplicateProject }}</span>
        </button>
        <div class="mx-0.5 my-px border-t border-border-subtle" role="separator" />
        <button
          type="button"
          role="menuitem"
          class="mode-menu-item mode-menu-item--leading text-status-error hover:bg-status-error/10"
          @click="handleDelete"
        >
          <Trash2 :size="14" class="shrink-0" />
          <span class="min-w-0 truncate">{{ t.projectActions.deleteProject }}</span>
        </button>
      </div>
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="tinyCardApplicationMenu"
      ref="tinyCardApplicationMenuRef"
      class="menu-pop fixed z-[76] w-fit max-w-[min(13rem,calc(100vw-1rem))] overflow-hidden rounded-md border border-outline-variant/70 bg-surface-container-lowest p-px shadow-2xl"
      role="menu"
      :aria-label="t.projectActions.chooseApplication"
      :style="{ left: `${tinyCardApplicationMenu.x}px`, top: `${tinyCardApplicationMenu.y}px` }"
      @click.stop
      @contextmenu.prevent
      @mouseenter="clearTinyCardApplicationMenuClose"
      @mouseleave="scheduleTinyCardApplicationMenuClose"
      @focusin="clearTinyCardApplicationMenuClose"
    >
      <div v-overlay-scrollbar class="themed-scrollbar max-h-[calc(100vh-1.5rem)] overflow-y-auto">
        <button
          v-for="application in otherExternalApplications"
          :key="application.id"
          type="button"
          role="menuitem"
          class="mode-menu-item mode-menu-item--tiny-submenu"
          :title="application.name"
          @click="handleOpenEditor(application.id)"
        >
          <span class="min-w-0 truncate">{{ application.name }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>
