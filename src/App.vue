<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { type ProjectStatusMessageState, useStore } from "./store/useStore";
import Dashboard from "./components/dashboard/Dashboard.vue";
import ProjectDetails from "./components/project/ProjectDetails.vue";
import ProjectFormModal from "./components/project/ProjectFormModal.vue";
import ActionDialog from "./components/common/ActionDialog.vue";
import ActionStatusPopover from "./components/common/ActionStatusPopover.vue";
import SettingsTab from "./components/layout/SettingsTab.vue";
import EnvironmentTab from "./components/environment/EnvironmentTab.vue";
import { useI18n } from "./lib/i18n";
import { requestAppEscape } from "./lib/escape";
import type { ProjectBridgeEvent, ProjectGitRemoteProgressEvent } from "./types";

type GlobalProjectStatus = { message: string; state: ProjectStatusMessageState };
type GitRemoteProgressEntry = { timestamp: string; message: string; stage: string };

const store = useStore();
const storeMessages = useI18n();
const selectedProject = computed(() => store.selectedProject);
const activeTab = computed(() => store.activeTab);
const theme = computed(() => store.theme);
const gitRemoteProgressMessage = ref("");
const gitRemoteProgressEntries = ref<GitRemoteProgressEntry[]>([]);
const isGlobalProjectStatusExpanded = ref(false);
const globalProjectStatus = computed<GlobalProjectStatus | null>(() => {
  if (gitRemoteProgressMessage.value) {
    return { message: gitRemoteProgressMessage.value, state: "loading" };
  }
  if (store.projectStatusMessage) {
    return { message: store.projectStatusMessage, state: store.projectStatusMessageState };
  }
  if (Object.values(store.gitRepositoryRefreshing).some(Boolean)) {
    return { message: "正在刷新 Git 快照...", state: "loading" };
  }
  if (Object.values(store.gitRepositoryStatusRefreshing).some(Boolean)) {
    return { message: "正在更新 Git 状态...", state: "loading" };
  }
  if (Object.values(store.gitRepositoryLoadingMore).some(Boolean)) {
    return { message: "正在加载更多提交...", state: "loading" };
  }
  return null;
});
const gitRemoteProgressStage = (message: string) =>
  message
    .replace(/^remote:\s*/i, "")
    .split(":", 1)[0]
    ?.trim()
    .toLocaleLowerCase() || message;

const handleGitRemoteProgress = (event: Event) => {
  const progress = (event as CustomEvent<ProjectGitRemoteProgressEvent>).detail;
  if (!progress || progress.type !== "git-remote-progress") return;

  if (progress.phase === "complete") {
    gitRemoteProgressMessage.value = "";
    gitRemoteProgressEntries.value = [];
    isGlobalProjectStatusExpanded.value = false;
    return;
  }

  const entry: GitRemoteProgressEntry = {
    timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    message: progress.message,
    stage: progress.phase === "start" ? "start" : gitRemoteProgressStage(progress.message),
  };
  gitRemoteProgressMessage.value = progress.message;

  if (progress.phase === "start") {
    gitRemoteProgressEntries.value = [entry];
    isGlobalProjectStatusExpanded.value = true;
    return;
  }

  const entries = gitRemoteProgressEntries.value;
  const latest = entries[entries.length - 1];
  if (latest?.stage === entry.stage) {
    gitRemoteProgressEntries.value = [...entries.slice(0, -1), entry];
  } else {
    gitRemoteProgressEntries.value = [...entries, entry].slice(-20);
  }
};
let pluginOutHookRegistered = false;
let startupProjectLoadId = 0;

const loadProjectsWithStartupTiming = () => {
  const startupTiming = window.__utoolsProjectLaunchStartupTiming;
  if (!startupTiming?.mark) {
    return store.loadProjects();
  }

  const loadId = ++startupProjectLoadId;
  const startedAt = performance.now();
  startupTiming.mark("projects-load-start", { loadId });
  return store.loadProjects().finally(() => {
    startupTiming.mark?.("projects-load-complete", {
      loadId,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
  });
};

const extractPluginSearchText = (action: unknown): string => {
  if (!action || typeof action !== "object") {
    return "";
  }

  const payload = action as Record<string, unknown>;
  const values = [payload.payload, payload.text, payload.keyword, payload.cmd, payload.option];
  return values.find((value): value is string => typeof value === "string")?.trim() || "";
};

const handlePluginEnter = async (action?: unknown) => {
  const searchText = extractPluginSearchText(action);
  if (!store.projectsLoaded) {
    await loadProjectsWithStartupTiming();
  }
  void store.reconcileRuntimeProcessState();
  if (searchText) {
    store.openProjectByName(searchText);
  }
};

const handleRuntimeResume = () => {
  void store.reconcileRuntimeProcessState();
};

const handleVisibilityChange = () => {
  if (document.visibilityState === "visible") {
    handleRuntimeResume();
  }
};

const handleBridgeEvent = (event: Event) => {
  const customEvent = event as CustomEvent<ProjectBridgeEvent>;
  store.handleBridgeEvent(customEvent.detail);
};

const isTextEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);

const consumeEscape = (event: KeyboardEvent) => {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
};

const handleGlobalEscape = (event: KeyboardEvent) => {
  if (event.key !== "Escape") {
    return;
  }

  consumeEscape(event);

  if (event.type !== "keydown") {
    return;
  }

  if (requestAppEscape(event)) {
    return;
  }

  if (store.projectFormOpen) {
    store.closeProjectForm();
    return;
  }

  if (store.pendingDeleteProject) {
    store.cancelDeleteProject();
    return;
  }

  if (isTextEntryTarget(event.target)) {
    return;
  }

  if (store.selectedProjectId) {
    store.setSelectedProject(null);
    return;
  }

  if (store.activeTab === "settings" || store.activeTab === "environment") {
    store.setActiveTab("projects");
    return;
  }

  if (store.activeTab === "projects" && !store.selectedProjectId) {
    window.utools?.outPlugin?.();
  }
};

const updateTheme = () => {
  let isDark = false;
  if (theme.value === "auto") {
    isDark = window.utools?.isDarkColors() ?? window.matchMedia("(prefers-color-scheme: dark)").matches;
  } else {
    isDark = theme.value === "dark";
  }

  if (isDark) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
};

watch(theme, updateTheme);

onMounted(() => {
  updateTheme();
  void loadProjectsWithStartupTiming();
  window.utools?.onPluginEnter?.((action) => {
    updateTheme();
    void handlePluginEnter(action);
  });
  if (!pluginOutHookRegistered) {
    window.utools?.onPluginOut?.((isKill) => {
      if (isKill === true) {
        window.projectBridge?.stopAllProcesses?.();
      }
    });
    pluginOutHookRegistered = true;
  }
  window.addEventListener("project-bridge-event", handleBridgeEvent);
  window.addEventListener("git-remote-progress", handleGitRemoteProgress);
  window.addEventListener("focus", handleRuntimeResume);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("keydown", handleGlobalEscape, true);
  window.addEventListener("keyup", handleGlobalEscape, true);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateTheme);
});

onUnmounted(() => {
  window.removeEventListener("project-bridge-event", handleBridgeEvent);
  window.removeEventListener("git-remote-progress", handleGitRemoteProgress);
  window.removeEventListener("focus", handleRuntimeResume);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("keydown", handleGlobalEscape, true);
  window.removeEventListener("keyup", handleGlobalEscape, true);
  window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", updateTheme);
});
</script>

<template>
  <div class="flex min-h-screen bg-background">
    <div class="flex-1 flex flex-col h-screen overflow-hidden">
      <main class="flex-1 overflow-hidden">
        <Transition name="fade" mode="out-in">
          <div v-if="activeTab === 'projects'" key="projects" class="h-full overflow-hidden">
            <Transition name="fade" mode="out-in">
              <div
                v-if="!store.selectedProjectId"
                v-overlay-scrollbar
                key="dashboard"
                class="themed-scrollbar h-full overflow-y-auto"
              >
                <Dashboard />
              </div>
              <div v-else key="details" class="h-full overflow-hidden">
                <ProjectDetails v-if="selectedProject" :project="selectedProject" />
              </div>
            </Transition>
          </div>
          <div v-else-if="activeTab === 'settings'" key="settings" class="themed-scrollbar h-full overflow-y-auto">
            <SettingsTab />
          </div>
          <div v-else-if="activeTab === 'environment'" key="environment" class="h-full overflow-hidden">
            <EnvironmentTab />
          </div>
        </Transition>
      </main>
    </div>
    <ActionStatusPopover
      v-if="globalProjectStatus"
      class="fixed right-4 top-16 z-50 max-w-xs"
      :message="globalProjectStatus.message"
      :state="globalProjectStatus.state"
      :entries="gitRemoteProgressEntries"
      v-model:expanded="isGlobalProjectStatusExpanded"
    />
    <ProjectFormModal />
    <ActionDialog
      :open="Boolean(store.pendingDeleteProject)"
      tone="danger"
      icon="trash"
      :title="storeMessages.projectActions.deleteProject"
      :message="
        store.pendingDeleteProject
          ? storeMessages.projectActions.deleteConfirm.replace('{name}', store.pendingDeleteProject.name)
          : ''
      "
      :detail="store.pendingDeleteProject?.path || ''"
      :primary-label="storeMessages.common.delete"
      :cancel-label="storeMessages.common.cancel"
      @cancel="store.cancelDeleteProject"
      @primary="store.confirmDeleteProject"
    />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.fade-enter-from {
  opacity: 0;
  transform: translateX(10px);
}

.fade-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
</style>
