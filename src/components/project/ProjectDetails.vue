<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  CheckSquare,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GripHorizontal,
  Copy,
  Pencil,
  ArrowLeft,
  ChevronDown,
  RefreshCw,
  Network,
  TerminalSquare,
  Trash2,
} from "lucide-vue-next";
import { PROJECT_DETAILS_TAB_REORDER_COACH_MARK_VERSION, Project, ProjectStatus } from "../../types";
import type { ProjectDetailsTabId } from "../../types";
import { cn } from "../../lib/utils";
import { formatRelativeTime } from "../../lib/time";
import { addAppEscapeRequestListener } from "../../lib/escape";
import type { AppEscapeRequestEvent } from "../../lib/escape";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import ScriptsTab from "./ScriptsTab.vue";
import { clearGitAiAnalysisSessionsForProject } from "../../lib/gitAiAnalysisSession";
import GitTab from "./GitTab.vue";
import MemoTab from "./MemoTab.vue";
import FilesTab from "./FilesTab.vue";
import AutomationTab from "./AutomationTab.vue";
import ExternalApplicationLaunchButton from "./ExternalApplicationLaunchButton.vue";

type TabId = ProjectDetailsTabId;
const tabLongPressDelayMs = 350;
const tabPressMoveTolerance = 8;
const gitToggleIdleDelayMs = 3_000;
const gitInitialRefreshCacheMaxAgeMs = 15_000;
const gitInitialCommitLimit = 20;
const gitInitialTabActivationDedupIntervalMs = 2_000;

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();
type GitTabExpose = {
  refreshActiveRepository: () => Promise<void>;
  refreshForTabActivation: () => boolean;
  isRefreshRunning: () => boolean;
  isTopInfoCollapsed: boolean;
  toggleTopInfo: () => void;
};
const activeTab = ref<TabId>("scripts");
const tabOrder = ref<TabId[]>([...store.uiPreferences.projectDetails.tabOrder]);
const draggedTab = ref<TabId | null>(null);
const fileOpenRequest = ref("");
const detailsRootRef = ref<HTMLElement | null>(null);
const tabListRef = ref<HTMLElement | null>(null);
const gitTabRef = ref<GitTabExpose | null>(null);
const isGitTopInfoCollapsed = computed(() => gitTabRef.value?.isTopInfoCollapsed ?? false);
const isGitToggleIdle = ref(false);
const isManualRefreshRunning = ref(false);
const relatedProjectsOpen = ref(false);
const relatedProjects = computed(() => store.relatedProjectsFor(props.project.id));
const showTabOrderHint = computed(
  () => store.uiPreferences.coachMarks.projectDetailsTabReorder < PROJECT_DETAILS_TAB_REORDER_COACH_MARK_VERSION,
);
let tabLongPressTimer: number | null = null;
let activeTabPointerId: number | null = null;
let pressedTab: TabId | null = null;
let tabPressStartX = 0;
let tabPressStartY = 0;
let tabOrderChanged = false;
let suppressNextTabClick = false;
let suppressTabClickTimer: number | null = null;
let previousBodyUserSelect = "";
let gitToggleIdleTimer: number | null = null;
let initialGitRefreshProjectId: string | null = null;
let skipInitialGitTabActivation = false;
let initialGitTabActivationDedupUntil = 0;
let stopRelatedProjectsEscapeListener: (() => void) | null = null;

const tabLabels = computed<Record<TabId, string>>(() => ({
  info: t.value.projectDetails.overview,
  scripts: t.value.projectDetails.scripts,
  automation: t.value.projectDetails.automation,
  files: t.value.projectDetails.files,
  git: t.value.projectDetails.git,
  memo: t.value.projectDetails.memo,
}));
const tabs = computed(() => tabOrder.value.map((id) => ({ id, label: tabLabels.value[id] })));

const statusLabel = computed(() => {
  if (props.project.status === ProjectStatus.RUNNING) {
    return t.value.common.running;
  }
  if (props.project.status === ProjectStatus.ERROR) {
    return t.value.common.error;
  }
  if (props.project.status === ProjectStatus.WARNING) {
    return t.value.common.warning;
  }
  return t.value.common.stopped;
});
const isUnavailable = computed(() => props.project.pathExists === false);
const gitSnapshot = computed(() => store.gitSnapshotForRepository(props.project.id));
const hasGitSnapshot = computed(() => Boolean(gitSnapshot.value?.repositoryPath));
const latestCommit = computed(() => gitSnapshot.value?.commits?.[0]);
const projectTodos = computed(() => store.todos[props.project.id] || props.project.todos || []);
const memoContent = computed(() => store.memoContent[props.project.id] || props.project.memo || "");
const openTodoCount = computed(() => projectTodos.value.filter((todo) => !todo.completed).length);
const statusToneClass = computed(() => {
  if (props.project.status === ProjectStatus.RUNNING) {
    return "border-status-running/30 bg-status-running/10 text-status-running";
  }
  if (props.project.status === ProjectStatus.ERROR) {
    return "border-status-error/30 bg-status-error/10 text-status-error";
  }
  if (props.project.status === ProjectStatus.WARNING) {
    return "border-status-warning/30 bg-status-warning/10 text-status-warning";
  }
  return "border-border-subtle bg-surface-container-low text-on-surface-variant";
});
const isRefreshingProject = computed(
  () =>
    isManualRefreshRunning.value ||
    Boolean(store.gitRefreshing[props.project.id]) ||
    Boolean(store.gitStatusRefreshing[props.project.id]) ||
    (activeTab.value === "git" && Boolean(gitTabRef.value?.isRefreshRunning())),
);
const refreshButtonLabel = computed(() => {
  if (isRefreshingProject.value) {
    return t.value.common.refreshing;
  }
  if (isUnavailable.value) {
    return t.value.projectDetails.refreshUnavailable;
  }
  return t.value.common.refresh;
});
const refreshButtonClass = computed(() =>
  cn(
    "p-1.5 text-on-surface-variant hover:bg-surface-variant rounded-lg transition-colors shadow-sm bg-surface border border-border-subtle",
    isRefreshingProject.value
      ? "disabled:cursor-wait disabled:opacity-70"
      : "disabled:cursor-not-allowed disabled:opacity-45",
  ),
);

const handleOpenFolder = () => store.openProjectFolder(props.project.id);
const handleOpenTerminal = () => store.openProjectInTerminal(props.project.id);
const handleOpenEditor = (applicationId?: string) => store.openProjectInEditor(props.project.id, applicationId);
const handleEdit = () => store.openEditProjectForm(props.project.id);
const handleDuplicate = () => store.openDuplicateProjectForm(props.project.id);
const handleBack = () => store.setSelectedProject(null);
const handleRefresh = async () => {
  const projectId = props.project.id;
  if (isUnavailable.value || isRefreshingProject.value) {
    return;
  }

  isManualRefreshRunning.value = true;
  try {
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (activeTab.value === "git" && gitTabRef.value) {
      await gitTabRef.value.refreshActiveRepository();
    } else {
      await store.refreshGitSnapshot(projectId);
    }
  } finally {
    isManualRefreshRunning.value = false;
  }
};
const handleDelete = () => {
  store.requestDeleteProject(props.project.id);
};
const handleRelatedProjectSelect = (projectId: string) => {
  relatedProjectsOpen.value = false;
  store.setSelectedProject(projectId);
};
const handleRelatedProjectsEscape = (event: AppEscapeRequestEvent) => {
  if (!relatedProjectsOpen.value) {
    return;
  }
  relatedProjectsOpen.value = false;
  event.detail.handle();
};
const clearGitToggleIdleTimer = () => {
  if (gitToggleIdleTimer !== null) {
    window.clearTimeout(gitToggleIdleTimer);
    gitToggleIdleTimer = null;
  }
};
const scheduleGitToggleIdle = () => {
  clearGitToggleIdleTimer();
  if (activeTab.value !== "git") {
    isGitToggleIdle.value = false;
    return;
  }
  gitToggleIdleTimer = window.setTimeout(() => {
    isGitToggleIdle.value = true;
  }, gitToggleIdleDelayMs);
};
const activateGitToggle = () => {
  if (activeTab.value !== "git") return;
  isGitToggleIdle.value = false;
  clearGitToggleIdleTimer();
};
const toggleGitTopInfo = () => {
  activateGitToggle();
  gitTabRef.value?.toggleTopInfo();
};

const clearTabLongPressTimer = () => {
  if (tabLongPressTimer !== null) {
    window.clearTimeout(tabLongPressTimer);
    tabLongPressTimer = null;
  }
};

const restoreTabDragDocumentState = () => {
  document.body.style.userSelect = previousBodyUserSelect;
};

const removeTabPointerListeners = () => {
  window.removeEventListener("pointermove", handleTabPointerMove);
  window.removeEventListener("pointerup", stopTabPointerInteraction);
  window.removeEventListener("pointercancel", stopTabPointerInteraction);
  window.removeEventListener("blur", stopTabPointerInteraction);
};

const stopTabPointerInteraction = (event?: Event) => {
  if (event instanceof PointerEvent && activeTabPointerId !== event.pointerId) {
    return;
  }

  const didDrag = draggedTab.value !== null;
  clearTabLongPressTimer();
  removeTabPointerListeners();
  activeTabPointerId = null;
  pressedTab = null;
  draggedTab.value = null;

  if (didDrag) {
    restoreTabDragDocumentState();
    if (tabOrderChanged) {
      store.setProjectDetailsTabOrder(tabOrder.value);
    }
    suppressNextTabClick = true;
    if (suppressTabClickTimer !== null) window.clearTimeout(suppressTabClickTimer);
    suppressTabClickTimer = window.setTimeout(() => {
      suppressNextTabClick = false;
      suppressTabClickTimer = null;
    });
  }
  tabOrderChanged = false;
};

function handleTabPointerMove(event: PointerEvent) {
  if (activeTabPointerId !== event.pointerId) return;

  if (!draggedTab.value) {
    if (Math.hypot(event.clientX - tabPressStartX, event.clientY - tabPressStartY) > tabPressMoveTolerance) {
      clearTabLongPressTimer();
    }
    return;
  }

  event.preventDefault();
  const currentIndex = tabOrder.value.indexOf(draggedTab.value);
  const tabButtons = Array.from(tabListRef.value?.querySelectorAll<HTMLElement>("[data-project-tab]") || []);
  const nextIndex = tabButtons.findIndex((button) => {
    const bounds = button.getBoundingClientRect();
    return event.clientX < bounds.left + bounds.width / 2;
  });
  const insertionIndex = nextIndex < 0 ? tabOrder.value.length - 1 : nextIndex;
  if (insertionIndex === currentIndex) return;

  const nextOrder = [...tabOrder.value];
  nextOrder.splice(currentIndex, 1);
  nextOrder.splice(insertionIndex, 0, draggedTab.value);
  tabOrder.value = nextOrder;
  tabOrderChanged = true;
}

const handleTabPointerDown = (event: PointerEvent, tabId: TabId) => {
  if (!event.isPrimary || event.button !== 0 || activeTabPointerId !== null) return;

  activeTabPointerId = event.pointerId;
  pressedTab = tabId;
  tabPressStartX = event.clientX;
  tabPressStartY = event.clientY;
  tabOrderChanged = false;
  window.addEventListener("pointermove", handleTabPointerMove);
  window.addEventListener("pointerup", stopTabPointerInteraction);
  window.addEventListener("pointercancel", stopTabPointerInteraction);
  window.addEventListener("blur", stopTabPointerInteraction);
  tabLongPressTimer = window.setTimeout(() => {
    if (activeTabPointerId !== event.pointerId || pressedTab !== tabId) return;
    draggedTab.value = tabId;
    store.acknowledgeProjectDetailsTabReorderHint(PROJECT_DETAILS_TAB_REORDER_COACH_MARK_VERSION);
    previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
  }, tabLongPressDelayMs);
};

const handleTabClick = (tabId: TabId) => {
  if (suppressNextTabClick) {
    suppressNextTabClick = false;
    return;
  }
  activeTab.value = tabId;
};

const focusActiveTab = () => {
  void nextTick(() => {
    tabListRef.value?.querySelector<HTMLButtonElement>("[role='tab'][aria-selected='true']")?.focus();
  });
};

const isTextEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);

const isDetailKeyboardTarget = (target: EventTarget | null) =>
  target === document ||
  target === document.body ||
  target === document.documentElement ||
  (target instanceof Node && Boolean(detailsRootRef.value?.contains(target)));

const handleDetailKeydown = (event: KeyboardEvent) => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (
    !isDetailKeyboardTarget(event.target) ||
    store.projectFormOpen ||
    Boolean(store.pendingDeleteProject) ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    isTextEntryTarget(target) ||
    target?.closest("[role='separator']")
  ) {
    return;
  }

  let direction = 0;
  if (event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey)) {
    direction = -1;
  } else if (event.key === "ArrowRight" || event.key === "Tab") {
    direction = 1;
  } else {
    return;
  }

  const currentIndex = tabs.value.findIndex((tab) => tab.id === activeTab.value);
  const nextIndex = (currentIndex + direction + tabs.value.length) % tabs.value.length;
  event.preventDefault();
  activeTab.value = tabs.value[nextIndex].id;
  focusActiveTab();
};

const handleOpenGitFile = (relativePath: string) => {
  fileOpenRequest.value = relativePath;
  activeTab.value = "files";
};

const normalizedRelativePath = (relativePath: string) => relativePath.replace(/\\/g, "/");

const handleFileOpened = (relativePath: string) => {
  if (normalizedRelativePath(fileOpenRequest.value) === normalizedRelativePath(relativePath)) {
    fileOpenRequest.value = "";
  }
};

const handleFileOpenCanceled = (relativePath: string) => {
  if (normalizedRelativePath(fileOpenRequest.value) === normalizedRelativePath(relativePath)) {
    fileOpenRequest.value = "";
  }
};

const scheduleInitialGitRefresh = () => {
  const projectId = props.project.id;
  if (isUnavailable.value || initialGitRefreshProjectId === projectId) return;

  initialGitRefreshProjectId = projectId;
  skipInitialGitTabActivation = true;
  initialGitTabActivationDedupUntil = Date.now() + gitInitialTabActivationDedupIntervalMs;
  void nextTick(() => {
    if (initialGitRefreshProjectId !== projectId) return;
    if (props.project.id !== projectId || isUnavailable.value) {
      initialGitRefreshProjectId = null;
      return;
    }

    void store
      .refreshGitSnapshotForInteraction(
        projectId,
        { kind: "main" },
        {
          maxAgeMs: gitInitialRefreshCacheMaxAgeMs,
          limit: gitInitialCommitLimit,
        },
      )
      .finally(() => {
        if (initialGitRefreshProjectId === projectId) initialGitRefreshProjectId = null;
      });
  });
};

const refreshGitForTabActivation = () => {
  const projectId = props.project.id;
  void nextTick(() => {
    if (props.project.id !== projectId || activeTab.value !== "git") {
      return;
    }
    if (
      initialGitRefreshProjectId === projectId ||
      (skipInitialGitTabActivation && Date.now() < initialGitTabActivationDedupUntil)
    ) {
      skipInitialGitTabActivation = false;
      return;
    }
    skipInitialGitTabActivation = false;
    gitTabRef.value?.refreshForTabActivation();
  });
};

onMounted(() => {
  scheduleInitialGitRefresh();
  focusActiveTab();
  stopRelatedProjectsEscapeListener = addAppEscapeRequestListener(handleRelatedProjectsEscape);
  window.addEventListener("keydown", handleDetailKeydown);
});

onUnmounted(() => {
  stopTabPointerInteraction();
  clearGitToggleIdleTimer();
  initialGitRefreshProjectId = null;
  skipInitialGitTabActivation = false;
  initialGitTabActivationDedupUntil = 0;
  stopRelatedProjectsEscapeListener?.();
  stopRelatedProjectsEscapeListener = null;
  if (suppressTabClickTimer !== null) window.clearTimeout(suppressTabClickTimer);
  if (store.selectedProjectId !== props.project.id) {
    clearGitAiAnalysisSessionsForProject(props.project.id);
  }
  window.removeEventListener("keydown", handleDetailKeydown);
});

watch(
  () => props.project.id,
  (projectId, previousProjectId) => {
    clearGitAiAnalysisSessionsForProject(previousProjectId);
    if (initialGitRefreshProjectId === previousProjectId) initialGitRefreshProjectId = null;
    skipInitialGitTabActivation = false;
    initialGitTabActivationDedupUntil = 0;
    relatedProjectsOpen.value = false;
    scheduleInitialGitRefresh();
    focusActiveTab();
  },
);

watch(
  activeTab,
  (tabId) => {
    clearGitToggleIdleTimer();
    isGitToggleIdle.value = tabId === "git";
    if (tabId === "git") refreshGitForTabActivation();
  },
  { immediate: true },
);

watch(
  () => store.projectDetailsTabRequest,
  (request) => {
    if (request?.projectId === props.project.id) {
      activeTab.value = request.tab;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    ref="detailsRootRef"
    class="flex h-full flex-1 flex-col overflow-hidden px-3 py-2"
    @click="relatedProjectsOpen = false"
  >
    <div class="mb-2 flex min-w-0 items-center gap-2">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          @click="handleBack"
          class="p-1.5 hover:bg-surface-variant rounded-lg text-on-surface-variant transition-all active:scale-90 border border-border-subtle bg-surface shadow-sm"
          :title="t.common.back"
          :aria-label="t.common.back"
        >
          <ArrowLeft :size="18" />
        </button>
        <div class="min-w-0">
          <h2 class="truncate text-base font-bold leading-tight text-on-surface">{{ project.name }}</h2>
          <div class="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-on-surface-variant">
            <Folder :size="12" class="shrink-0" />
            <span class="truncate">{{ project.path }}</span>
          </div>
        </div>
        <div v-if="relatedProjects.length > 0" class="relative shrink-0 self-center" @click.stop>
          <button
            type="button"
            class="group rounded-md p-1 text-primary/80 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            :title="t.projectDetails.relatedProjects"
            :aria-label="t.projectDetails.relatedProjects"
            :aria-expanded="relatedProjectsOpen"
            @click="relatedProjectsOpen = !relatedProjectsOpen"
          >
            <Network :size="17" class="transition-colors" />
          </button>
          <div
            v-if="relatedProjectsOpen"
            class="absolute left-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-xl"
          >
            <div
              class="border-b border-border-subtle bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface"
            >
              {{ t.projectDetails.relatedProjects }}
            </div>
            <div class="p-1">
              <button
                v-for="relatedProject in relatedProjects"
                :key="relatedProject.id"
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-container"
                :title="relatedProject.path"
                @click="handleRelatedProjectSelect(relatedProject.id)"
              >
                <Folder :size="15" class="shrink-0 text-primary" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-on-surface">{{ relatedProject.name }}</span>
                  <span class="block truncate text-[11px] text-on-surface-variant">{{ relatedProject.path }}</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          @click="handleRefresh"
          :disabled="isUnavailable || isRefreshingProject"
          :class="refreshButtonClass"
          :title="refreshButtonLabel"
          :aria-label="refreshButtonLabel"
        >
          <RefreshCw :size="16" :class="isRefreshingProject && 'animate-spin'" />
        </button>
        <button
          type="button"
          @click="handleOpenTerminal"
          :disabled="isUnavailable"
          class="bg-surface border border-border-subtle group text-on-surface hover:bg-surface-variant p-1.5 rounded-lg transition-all shadow-sm"
          :title="t.projectActions.openInTerminal"
          :aria-label="t.projectActions.openInTerminal"
        >
          <TerminalSquare :size="16" class="group-hover:text-primary" />
        </button>
        <ExternalApplicationLaunchButton
          :applications="store.externalApplicationPreferences.applications"
          :default-application-id="store.externalApplicationPreferences.defaultApplicationId"
          :disabled="isUnavailable"
          button-class="bg-surface border border-border-subtle group text-on-surface hover:bg-surface-variant p-1.5 rounded-lg transition-all shadow-sm disabled:opacity-50"
          icon-class="group-hover:text-primary"
          :icon-size="16"
          @launch="handleOpenEditor"
        />
        <button
          type="button"
          @click="handleOpenFolder"
          :disabled="isUnavailable"
          class="bg-surface border border-border-subtle group text-on-surface hover:bg-surface-variant p-1.5 rounded-lg transition-all shadow-sm"
          :title="t.projectDetails.openProject"
          :aria-label="t.projectDetails.openProject"
        >
          <FolderOpen :size="16" class="group-hover:text-primary" />
        </button>
        <button
          type="button"
          @click="handleEdit"
          class="bg-primary text-on-primary p-1.5 rounded-lg transition-all hover:bg-primary/90 shadow-sm"
          :title="t.common.edit"
          :aria-label="t.common.edit"
        >
          <Pencil :size="16" />
        </button>
        <button
          type="button"
          @click="handleDuplicate"
          class="bg-surface border border-border-subtle text-on-surface-variant hover:text-primary hover:bg-primary/10 p-1.5 rounded-lg transition-all shadow-sm"
          :title="t.projectActions.duplicateProject"
          :aria-label="t.projectActions.duplicateProject"
        >
          <Copy :size="16" />
        </button>
        <button
          type="button"
          @click="handleDelete"
          class="bg-surface border border-border-subtle text-on-surface-variant hover:text-status-error hover:bg-status-error/10 p-1.5 rounded-lg transition-all shadow-sm"
          :title="t.projectActions.deleteProject"
          :aria-label="t.projectActions.deleteProject"
        >
          <Trash2 :size="16" />
        </button>
      </div>
    </div>

    <div
      :class="
        cn(
          'flex min-w-0 items-end border-b border-border-subtle',
          activeTab === 'git' && !isGitTopInfoCollapsed ? 'mb-3' : 'mb-2',
        )
      "
    >
      <div class="relative min-w-0 flex-1">
        <nav ref="tabListRef" role="tablist" class="flex min-w-0 gap-5 overflow-x-auto">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            :id="`project-tab-${tab.id}`"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.id"
            :aria-controls="`project-tabpanel-${tab.id}`"
            :aria-grabbed="draggedTab === tab.id"
            :tabindex="activeTab === tab.id ? 0 : -1"
            data-project-tab
            @pointerdown="handleTabPointerDown($event, tab.id)"
            @click="handleTabClick(tab.id)"
            :class="
              cn(
                'relative touch-none select-none whitespace-nowrap pb-1.5 text-sm font-bold outline-none ring-0 transition-all focus:outline-none focus-visible:outline-none focus-visible:ring-0 cursor-default',
                activeTab === tab.id ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface',
                draggedTab === tab.id && 'z-10 scale-[1.03] text-primary opacity-70',
              )
            "
          >
            {{ tab.label }}
            <div v-if="activeTab === tab.id" class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
          </button>
        </nav>
        <button
          v-if="activeTab === 'git' && gitTabRef"
          type="button"
          :class="
            cn(
              'absolute left-1/2 top-full z-20 flex h-4 w-9 -translate-x-1/2 -translate-y-px items-center justify-center rounded-b-lg border border-t-0 border-border-subtle bg-surface-container-lowest text-primary outline-none transition-all duration-300 ease-out hover:border-primary hover:bg-primary hover:text-on-primary hover:opacity-100 hover:blur-0 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary',
              isGitToggleIdle ? 'opacity-40 blur-[0.4px] shadow-none' : 'opacity-100 blur-0 shadow-md',
            )
          "
          :title="isGitTopInfoCollapsed ? '展开顶部 Git 信息栏' : '收起顶部 Git 信息栏'"
          :aria-label="isGitTopInfoCollapsed ? '展开顶部 Git 信息栏' : '收起顶部 Git 信息栏'"
          :aria-expanded="!isGitTopInfoCollapsed"
          aria-controls="git-top-info-panel"
          @pointerenter="activateGitToggle"
          @pointerleave="scheduleGitToggleIdle"
          @focus="activateGitToggle"
          @blur="scheduleGitToggleIdle"
          @click="toggleGitTopInfo"
        >
          <ChevronDown
            :size="13"
            :class="cn('transition-transform duration-300 ease-out', !isGitTopInfoCollapsed && 'rotate-180')"
          />
        </button>
      </div>
      <span
        v-if="showTabOrderHint"
        role="note"
        :aria-label="t.projectDetails.reorderTabsHint"
        class="pointer-events-none ml-2 inline-flex shrink-0 items-center gap-1 pb-1.5 text-[11px] font-medium text-on-surface-variant opacity-50 sm:ml-3"
      >
        <GripHorizontal :size="12" :stroke-width="1.5" />
        <span class="hidden whitespace-nowrap sm:inline">{{ t.projectDetails.reorderTabsHint }}</span>
      </span>
    </div>

    <div
      :id="`project-tabpanel-${activeTab}`"
      role="tabpanel"
      :aria-labelledby="`project-tab-${activeTab}`"
      :class="
        cn(
          'min-h-0 flex-1 [color-scheme:inherit]',
          activeTab === 'files' ||
            activeTab === 'scripts' ||
            activeTab === 'git' ||
            activeTab === 'memo' ||
            activeTab === 'automation'
            ? 'overflow-hidden'
            : 'themed-scrollbar space-y-3 overflow-y-auto',
        )
      "
    >
      <div v-if="activeTab === 'info'" class="min-h-full space-y-3">
        <section class="rounded-lg border border-border-subtle bg-surface p-3 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <span
                  :class="
                    cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold',
                      statusToneClass,
                    )
                  "
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-current" />
                  {{ statusLabel }}
                </span>
                <span
                  class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-container-low px-2 py-1 text-xs font-medium text-on-surface-variant"
                >
                  <Folder :size="12" />
                  {{ project.git?.branch || "main" }}
                </span>
                <span
                  class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-subtle bg-surface-container-low px-2 py-1 text-xs font-medium text-on-surface-variant"
                >
                  <GitCommitHorizontal :size="12" />
                  <span class="truncate">{{ project.git?.statusText || t.git.noRepo }}</span>
                </span>
                <button
                  v-if="!hasGitSnapshot && !isUnavailable && !isRefreshingProject"
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
                  title="前往 Git 标签页初始化仓库"
                  aria-label="前往 Git 标签页初始化仓库"
                  @click="activeTab = 'git'"
                >
                  <GitBranch :size="12" />
                  <span>初始化 Git 仓库</span>
                </button>
              </div>
              <p class="text-sm leading-6 text-on-surface-variant">
                {{ project.description || t.projectDetails.noScripts }}
              </p>
            </div>
            <div class="text-right text-[11px] text-on-surface-variant">
              <div class="font-semibold">{{ t.common.lastUpdated }}</div>
              <div>{{ project.lastUpdated || project.updatedAt || t.common.never }}</div>
            </div>
          </div>
        </section>

        <section class="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div
            class="min-w-0 rounded-lg border border-border-subtle bg-surface-container-low p-3"
            :class="hasGitSnapshot ? 'border-status-info/25' : ''"
          >
            <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
              <GitCommitHorizontal :size="14" />
              <span>{{ t.git.commits }}</span>
            </div>
            <div
              class="min-w-0 truncate font-mono text-sm font-bold text-on-surface"
              :title="latestCommit?.message || t.git.noRepo"
            >
              {{ latestCommit?.hash || "--" }}
            </div>
            <div
              class="mt-1 truncate text-[11px] text-on-surface-variant"
              :title="latestCommit?.message || t.git.noRepo"
            >
              {{ latestCommit?.message || t.git.noRepo }}
              <span v-if="latestCommit" class="ml-1 text-on-surface-variant/70"
                >· {{ formatRelativeTime(latestCommit.date) }}</span
              >
            </div>
          </div>
          <div class="min-w-0 rounded-lg border border-border-subtle bg-surface-container-low p-3">
            <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
              <CheckSquare :size="14" />
              <span>{{ t.memo.taskList }}</span>
            </div>
            <div
              class="min-w-0 truncate font-mono text-sm font-bold text-on-surface"
              :title="`${openTodoCount}/${projectTodos.length}`"
            >
              {{ openTodoCount }}/{{ projectTodos.length }}
            </div>
            <div class="mt-1 truncate text-[11px] text-on-surface-variant">{{ t.memo.title }}</div>
          </div>
        </section>

        <section class="rounded-lg border border-border-subtle bg-surface p-3 shadow-sm">
          <div class="mb-2 text-xs font-semibold text-on-surface-variant">{{ t.projectDetails.scripts }}</div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="script in project.scripts"
              :key="script.id"
              :class="
                cn(
                  'rounded-full border px-2 py-1 text-[11px] font-semibold',
                  script.status === 'RUNNING'
                    ? 'border-status-running/25 bg-status-running/10 text-status-running'
                    : script.status === 'STOPPING'
                      ? 'border-status-warning/25 bg-status-warning/10 text-status-warning'
                      : script.status === 'ERROR'
                        ? 'border-status-error/25 bg-status-error/10 text-status-error'
                        : 'border-border-subtle bg-surface-container-low text-on-surface-variant',
                )
              "
            >
              {{ script.name }}
            </span>
          </div>
        </section>
      </div>

      <ScriptsTab v-if="activeTab === 'scripts'" :project="project" />
      <AutomationTab v-if="activeTab === 'automation'" :project="project" />
      <FilesTab
        v-if="activeTab === 'files'"
        :project="project"
        :open-relative-path="fileOpenRequest"
        @opened="handleFileOpened"
        @open-canceled="handleFileOpenCanceled"
      />
      <GitTab v-if="activeTab === 'git'" ref="gitTabRef" :project="project" @open-file="handleOpenGitFile" />
      <MemoTab v-if="activeTab === 'memo'" :project="project" :active="activeTab === 'memo'" />
    </div>
  </div>
</template>
