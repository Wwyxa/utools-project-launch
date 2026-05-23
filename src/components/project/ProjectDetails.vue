<script setup lang="ts">
import { computed, ref } from "vue";
import {
  CheckSquare,
  Code2,
  ExternalLink,
  Folder,
  GitCommitHorizontal,
  Pencil,
  ArrowLeft,
  RefreshCw,
  StickyNote,
  TerminalSquare,
  Trash2,
} from "lucide-vue-next";
import { Project, ProjectStatus } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import ScriptsTab from "./ScriptsTab.vue";
import GitTab from "./GitTab.vue";
import MemoTab from "./MemoTab.vue";
import FilesTab from "./FilesTab.vue";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();
type TabId = "info" | "scripts" | "files" | "git" | "memo";
const activeTab = ref<TabId>("scripts");
const fileOpenRequest = ref("");

const tabs = computed<Array<{ id: TabId; label: string }>>(() => [
  { id: "info", label: t.value.projectDetails.overview },
  { id: "scripts", label: t.value.projectDetails.scripts },
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
const runningScriptCount = computed(() => props.project.scripts.filter((script) => script.status === "RUNNING").length);
const stoppingScriptCount = computed(
  () => props.project.scripts.filter((script) => script.status === "STOPPING").length,
);
const activeScriptCount = computed(() => runningScriptCount.value + stoppingScriptCount.value);
const overviewMetrics = computed(() => [
  {
    icon: TerminalSquare,
    label: t.value.projectDetails.scripts,
    value: `${props.project.scripts.length}`,
    detail:
      activeScriptCount.value > 0
        ? `${activeScriptCount.value} ${stoppingScriptCount.value > 0 ? t.value.common.stopping : t.value.common.running}`
        : t.value.scripts.ready,
    tone: activeScriptCount.value > 0 ? "running" : "neutral",
  },
  {
    icon: CheckSquare,
    label: t.value.memo.taskList,
    value: `${projectTodos.value.filter((todo) => !todo.completed).length}/${projectTodos.value.length}`,
    detail: t.value.memo.taskList,
    tone: "neutral",
  },
  {
    icon: StickyNote,
    label: t.value.memo.title,
    value: memoContent.value.trim() ? `${memoContent.value.trim().split(/\s+/).length}` : "0",
    detail: t.value.memo.title,
    tone: memoContent.value.trim() ? "info" : "neutral",
  },
  {
    icon: GitCommitHorizontal,
    label: t.value.git.commits,
    value: latestCommit.value?.hash || "--",
    detail: latestCommit.value?.message || t.value.git.noRepo,
    tone: hasGitSnapshot.value ? "info" : "neutral",
  },
]);
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
const metricToneClass = (tone: string) => {
  if (tone === "running") {
    return "border-status-running/25 bg-status-running/10 text-status-running";
  }
  if (tone === "info") {
    return "border-status-info/25 bg-status-info/10 text-status-info";
  }
  return "border-border-subtle bg-surface-container-low text-on-surface-variant";
};

const handleOpenFolder = () => store.openProjectFolder(props.project.id);
const handleOpenTerminal = () => store.openProjectInTerminal(props.project.id);
const handleOpenEditor = () => store.openProjectInEditor(props.project.id);
const handleEdit = () => store.openEditProjectForm(props.project.id);
const handleBack = () => store.setSelectedProject(null);
const handleRefresh = () => {
  if (!isUnavailable.value) {
    void store.refreshGitSnapshot(props.project.id);
  }
};
const handleDelete = () => {
  store.requestDeleteProject(props.project.id);
};

const handleOpenGitFile = (relativePath: string) => {
  fileOpenRequest.value = relativePath;
  activeTab.value = "files";
};

const handleFileOpened = (relativePath: string) => {
  if (fileOpenRequest.value === relativePath) {
    fileOpenRequest.value = "";
  }
};
</script>

<template>
  <div class="flex h-full flex-1 flex-col overflow-hidden p-3">
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
          :disabled="isUnavailable"
          class="p-2 text-on-surface-variant hover:bg-surface-variant rounded-lg transition-colors shadow-sm bg-surface border border-border-subtle"
          :title="t.common.refresh"
          :aria-label="t.common.refresh"
        >
          <RefreshCw :size="18" />
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
          <ExternalLink :size="18" class="group-hover:text-primary" />
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

    <nav class="mb-3 flex gap-5 overflow-x-auto border-b border-border-subtle">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        @click="activeTab = tab.id"
        :class="
          cn(
            'pb-2 text-sm font-bold transition-all relative whitespace-nowrap',
            activeTab === tab.id ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface',
          )
        "
      >
        {{ tab.label }}
        <div v-if="activeTab === tab.id" class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
      </button>
    </nav>

    <div
      :class="
        cn(
          'themed-scrollbar min-h-0 flex-1 pr-1 [color-scheme:inherit]',
          activeTab === 'files' || activeTab === 'scripts' || activeTab === 'git' || activeTab === 'memo'
            ? 'overflow-hidden'
            : 'space-y-3 overflow-y-auto',
        )
      "
    >
      <div v-if="activeTab === 'info'" class="min-h-full space-y-3 overflow-y-auto pr-1">
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
                  {{ project.git?.branch || project.branch || "main" }}
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

        <section class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div
            v-for="metric in overviewMetrics"
            :key="metric.label"
            :class="cn('min-w-0 rounded-lg border p-3', metricToneClass(metric.tone))"
          >
            <div class="mb-2 flex items-center gap-2 text-xs font-semibold">
              <component :is="metric.icon" :size="14" />
              <span>{{ metric.label }}</span>
            </div>
            <div class="min-w-0 truncate font-mono text-sm font-bold text-on-surface" :title="metric.value">
              {{ metric.value }}
            </div>
            <div class="mt-1 truncate text-[11px] text-on-surface-variant" :title="metric.detail">
              {{ metric.detail }}
            </div>
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
