<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { type ProjectStatusMessageState, useStore } from "./store/useStore";
import Dashboard from "./components/dashboard/Dashboard.vue";
import ProjectDetails from "./components/project/ProjectDetails.vue";
import ProjectFormModal from "./components/project/ProjectFormModal.vue";
import ActionDialog from "./components/ActionDialog.vue";
import SettingsTab from "./components/layout/SettingsTab.vue";
import EnvironmentTab from "./components/environment/EnvironmentTab.vue";
import { useI18n } from "./lib/i18n";
import { cn } from "./lib/utils";
import { requestAppEscape } from "./lib/escape";
import type { ProjectBridgeEvent } from "./types";

type GlobalProjectStatus = { message: string; state: ProjectStatusMessageState };

const store = useStore();
const storeMessages = useI18n();
const selectedProject = computed(() => store.selectedProject);
const activeTab = computed(() => store.activeTab);
const theme = computed(() => store.theme);
const globalProjectStatus = computed<GlobalProjectStatus | null>(() => {
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
const globalProjectStatusIconClass = computed(() => {
  const state = globalProjectStatus.value?.state;
  if (state === "success") return "border-status-running bg-status-running";
  if (state === "warning") return "border-status-warning bg-status-warning";
  if (state === "error") return "border-status-error bg-status-error";
  return "animate-spin border-primary border-t-transparent";
});
const globalProjectStatusTextClass = computed(() => {
  const state = globalProjectStatus.value?.state;
  if (state === "success") return "text-status-running";
  if (state === "warning") return "text-status-warning";
  if (state === "error") return "text-status-error";
  return "text-primary";
});
const globalProjectStatusBorderClass = computed(() => {
  const state = globalProjectStatus.value?.state;
  if (state === "success") return "border-status-running/30";
  if (state === "warning") return "border-status-warning/30";
  if (state === "error") return "border-status-error/30";
  return "border-primary/30";
});
let pluginOutHookRegistered = false;

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
    await store.loadProjects();
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
  void store.loadProjects();
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
  window.addEventListener("focus", handleRuntimeResume);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("keydown", handleGlobalEscape, true);
  window.addEventListener("keyup", handleGlobalEscape, true);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateTheme);
});

onUnmounted(() => {
  window.removeEventListener("project-bridge-event", handleBridgeEvent);
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
    <Teleport to="body">
      <Transition name="slide-up">
        <div
          v-if="globalProjectStatus"
          :class="
            cn(
              'fixed right-4 top-16 z-50 flex max-w-xs items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 shadow-lg',
              globalProjectStatusBorderClass,
            )
          "
          role="status"
          aria-live="polite"
          :title="globalProjectStatus.message"
        >
          <div class="flex h-4 w-4 shrink-0 items-center justify-center">
            <div :class="cn('h-3 w-3 rounded-full border-2', globalProjectStatusIconClass)" />
          </div>
          <span :class="cn('text-xs font-medium', globalProjectStatusTextClass)">
            {{ globalProjectStatus.message }}
          </span>
        </div>
      </Transition>
    </Teleport>
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
