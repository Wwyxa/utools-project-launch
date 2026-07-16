<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  CheckSquare,
  Code2,
  Folder,
  FolderOpen,
  GitCommitHorizontal,
  Pencil,
  ArrowLeft,
  RefreshCw,
  TerminalSquare,
  Trash2,
} from "lucide-vue-next";
import { Project, ProjectStatus } from "../../types";
import { cn } from "../../lib/utils";
import { formatRelativeTime } from "../../lib/time";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import ScriptsTab from "./ScriptsTab.vue";
import GitTab from "./GitTab.vue";
import MemoTab from "./MemoTab.vue";
import FilesTab from "./FilesTab.vue";
import AutomationTab from "./AutomationTab.vue";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();
type TabId = "info" | "scripts" | "automation" | "files" | "git" | "memo";
const activeTab = ref<TabId>("scripts");
const fileOpenRequest = ref("");
const detailsRootRef = ref<HTMLElement | null>(null);
const tabListRef = ref<HTMLElement | null>(null);

const tabs = computed<Array<{ id: TabId; label: string }>>(() => [
  { id: "info", label: t.value.projectDetails.overview },
  { id: "scripts", label: t.value.projectDetails.scripts },
  { id: "automation", label: t.value.projectDetails.automation },
  { id: "files", label: t.value.projectDetails.files },
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
  if (props.project.status === ProjectStatus.WARNING) {
    return t.value.common.warning;
  }
  return t.value.common.stopped;
});
const isUnavailable = computed(() => props.project.pathExists === false);
const hasGitSnapshot = computed(() => Boolean(props.project.git?.repositoryPath));
const latestCommit = computed(() => props.project.git?.commits?.[0]);
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
  () => Boolean(store.gitRefreshing[props.project.id]) || Boolean(store.gitStatusRefreshing[props.project.id]),
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
    "p-2 text-on-surface-variant hover:bg-surface-variant rounded-lg transition-colors shadow-sm bg-surface border border-border-subtle",
    isRefreshingProject.value
      ? "disabled:cursor-wait disabled:opacity-70"
      : "disabled:cursor-not-allowed disabled:opacity-45",
  ),
);

const handleOpenFolder = () => store.openProjectFolder(props.project.id);
const handleOpenTerminal = () => store.openProjectInTerminal(props.project.id);
const handleOpenEditor = () => store.openProjectInEditor(props.project.id);
const handleEdit = () => store.openEditProjectForm(props.project.id);
const handleBack = () => store.setSelectedProject(null);
const handleRefresh = async () => {
  const projectId = props.project.id;
  if (isUnavailable.value || store.gitRefreshing[projectId] || store.gitStatusRefreshing[projectId]) {
    return;
  }

  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await store.refreshGitSnapshot(projectId);
};
const handleDelete = () => {
  store.requestDeleteProject(props.project.id);
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

const scheduleInitialGitRefresh = () => {
  if (isUnavailable.value || store.gitRefreshing[props.project.id] || store.gitStatusRefreshing[props.project.id]) {
    return;
  }
  void nextTick(() => {
    void store.refreshGitSnapshot(props.project.id);
  });
};

onMounted(() => {
  scheduleInitialGitRefresh();
  focusActiveTab();
  window.addEventListener("keydown", handleDetailKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleDetailKeydown);
});

watch(
  () => props.project.id,
  () => {
    scheduleInitialGitRefresh();
    focusActiveTab();
  },
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
  <div ref="detailsRootRef" class="flex h-full flex-1 flex-col overflow-hidden p-3">
    <div class="mb-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-4 min-w-0">
        <button
          type="button"
          @click="handleBack"
          class="p-2 hover:bg-surface-variant rounded-lg text-on-surface-variant transition-all active:scale-90 border border-border-subtle bg-surface shadow-sm"
          :title="t.common.back"
          :aria-label="t.common.back"
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
          type="button"
          @click="handleRefresh"
          :disabled="isUnavailable || isRefreshingProject"
          :class="refreshButtonClass"
          :title="refreshButtonLabel"
          :aria-label="refreshButtonLabel"
        >
          <RefreshCw :size="18" :class="isRefreshingProject && 'animate-spin'" />
        </button>
        <button
          type="button"
          @click="handleOpenTerminal"
          :disabled="isUnavailable"
          class="bg-surface border border-border-subtle group text-on-surface hover:bg-surface-variant p-2 rounded-lg transition-all shadow-sm"
          :title="t.projectActions.openInTerminal"
          :aria-label="t.projectActions.openInTerminal"
        >
          <TerminalSquare :size="18" class="group-hover:text-primary" />
        </button>
        <button
          type="button"
          @click="handleOpenEditor"
          :disabled="isUnavailable"
          class="bg-surface border border-border-subtle group text-on-surface hover:bg-surface-variant p-2 rounded-lg transition-all shadow-sm"
          :title="t.projectActions.openInEditor"
          :aria-label="t.projectActions.openInEditor"
        >
          <Code2 :size="18" class="group-hover:text-primary" />
        </button>
        <button
          type="button"
          @click="handleOpenFolder"
          :disabled="isUnavailable"
          class="bg-surface border border-border-subtle group text-on-surface hover:bg-surface-variant p-2 rounded-lg transition-all shadow-sm"
          :title="t.projectDetails.openProject"
          :aria-label="t.projectDetails.openProject"
        >
          <FolderOpen :size="18" class="group-hover:text-primary" />
        </button>
        <button
          type="button"
          @click="handleEdit"
          class="bg-primary text-on-primary p-2 rounded-lg transition-all hover:bg-primary/90 shadow-sm"
          :title="t.common.edit"
          :aria-label="t.common.edit"
        >
          <Pencil :size="18" />
        </button>
        <button
          type="button"
          @click="handleDelete"
          class="bg-surface border border-border-subtle text-on-surface-variant hover:text-status-error hover:bg-status-error/10 p-2 rounded-lg transition-all shadow-sm"
          :title="t.projectActions.deleteProject"
          :aria-label="t.projectActions.deleteProject"
        >
          <Trash2 :size="18" />
        </button>
      </div>
    </div>

    <nav ref="tabListRef" role="tablist" class="mb-3 flex gap-5 overflow-x-auto border-b border-border-subtle">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :id="`project-tab-${tab.id}`"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :aria-controls="`project-tabpanel-${tab.id}`"
        :tabindex="activeTab === tab.id ? 0 : -1"
        @click="activeTab = tab.id"
        :class="
          cn(
            'relative whitespace-nowrap pb-2 text-sm font-bold outline-none ring-0 transition-all focus:outline-none focus-visible:outline-none focus-visible:ring-0',
            activeTab === tab.id ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface',
          )
        "
      >
        {{ tab.label }}
        <div v-if="activeTab === tab.id" class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
      </button>
    </nav>

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
      />
      <GitTab v-if="activeTab === 'git'" :project="project" @open-file="handleOpenGitFile" />
      <MemoTab v-if="activeTab === 'memo'" :project="project" :active="activeTab === 'memo'" />
    </div>
  </div>
</template>
