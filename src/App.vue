<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useStore } from "./store/useStore";
import Dashboard from "./components/dashboard/Dashboard.vue";
import ProjectDetails from "./components/project/ProjectDetails.vue";
import ProjectFormModal from "./components/project/ProjectFormModal.vue";
import SettingsTab from "./components/layout/SettingsTab.vue";
import { useI18n } from "./lib/i18n";
import type { ProjectBridgeEvent } from "./types";

const store = useStore();
const storeMessages = useI18n();
const selectedProject = computed(() => store.selectedProject);
const activeTab = computed(() => store.activeTab);
const theme = computed(() => store.theme);

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
  if (searchText) {
    store.openProjectByName(searchText);
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

  if (isTextEntryTarget(event.target)) {
    return;
  }

  if (event.type !== "keydown") {
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

  if (store.selectedProjectId) {
    store.setSelectedProject(null);
    return;
  }

  if (store.activeTab === "settings") {
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
    void handlePluginEnter(action);
  });
  window.addEventListener("project-bridge-event", handleBridgeEvent);
  window.addEventListener("keydown", handleGlobalEscape, true);
  window.addEventListener("keyup", handleGlobalEscape, true);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateTheme);
});

onUnmounted(() => {
  window.removeEventListener("project-bridge-event", handleBridgeEvent);
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
              <div v-if="!store.selectedProjectId" key="dashboard" class="themed-scrollbar h-full overflow-y-auto">
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
        </Transition>
      </main>
    </div>
    <ProjectFormModal />
    <Teleport to="body">
      <div
        v-if="store.pendingDeleteProject"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
        @click.self="store.cancelDeleteProject"
      >
        <div class="w-full max-w-sm rounded-xl border border-border-subtle bg-surface p-5 shadow-2xl">
          <h2 class="text-base font-bold text-on-surface">{{ store.pendingDeleteProject.name }}</h2>
          <p class="mt-2 text-sm text-on-surface-variant">
            {{ store.pendingDeleteProject ? store.pendingDeleteProject.path : "" }}
          </p>
          <p class="mt-4 text-sm text-on-surface-variant">
            {{
              store.pendingDeleteProject
                ? storeMessages.projectActions.deleteConfirm.replace("{name}", store.pendingDeleteProject.name)
                : ""
            }}
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <button
              @click="store.cancelDeleteProject"
              class="rounded-lg border border-border-subtle bg-surface px-4 py-2 text-sm font-semibold text-on-surface hover:bg-surface-variant"
            >
              {{ storeMessages.common.cancel }}
            </button>
            <button
              @click="store.confirmDeleteProject"
              class="rounded-lg bg-status-error px-4 py-2 text-sm font-bold text-white hover:bg-status-error/90"
            >
              {{ storeMessages.common.delete }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
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
