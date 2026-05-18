<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useStore } from "./store/useStore";
import Sidebar from "./components/layout/Sidebar.vue";
import Dashboard from "./components/dashboard/Dashboard.vue";
import ProjectDetails from "./components/project/ProjectDetails.vue";
import ProjectFormModal from "./components/project/ProjectFormModal.vue";
import SettingsTab from "./components/layout/SettingsTab.vue";
import type { ProjectBridgeEvent } from "./types";

const store = useStore();
const selectedProject = computed(() => store.selectedProject);
const activeTab = computed(() => store.activeTab);
const theme = computed(() => store.theme);

const handleBridgeEvent = (event: Event) => {
  const customEvent = event as CustomEvent<ProjectBridgeEvent>;
  store.handleBridgeEvent(customEvent.detail);
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
  window.addEventListener("project-bridge-event", handleBridgeEvent);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateTheme);
});

onUnmounted(() => {
  window.removeEventListener("project-bridge-event", handleBridgeEvent);
  window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", updateTheme);
});
</script>

<template>
  <div class="flex min-h-screen bg-background">
    <Sidebar />
    <div class="ml-[64px] flex-1 flex flex-col h-screen overflow-hidden">
      <main class="flex-1 overflow-hidden">
        <Transition name="fade" mode="out-in">
          <div v-if="activeTab === 'projects'" key="projects" class="h-full overflow-hidden">
            <Transition name="fade" mode="out-in">
              <div v-if="!store.selectedProjectId" key="dashboard" class="h-full overflow-y-auto">
                <Dashboard />
              </div>
              <div v-else key="details" class="h-full overflow-hidden">
                <ProjectDetails v-if="selectedProject" :project="selectedProject" />
              </div>
            </Transition>
          </div>
          <div v-else-if="activeTab === 'plugins'" key="plugins" class="h-full p-8 overflow-y-auto">
            <h2 class="text-2xl font-bold mb-4 text-on-surface">{{ t.sidebar.plugins }}</h2>
            <p class="text-on-surface-variant">{{ t.common.comingSoon }}</p>
          </div>
          <div v-else-if="activeTab === 'memos'" key="memos" class="h-full p-8 overflow-y-auto">
            <h2 class="text-2xl font-bold mb-4 text-on-surface">{{ t.sidebar.memos }}</h2>
            <p class="text-on-surface-variant">{{ t.common.comingSoon }}</p>
          </div>
          <div v-else-if="activeTab === 'settings'" key="settings" class="h-full overflow-y-auto">
            <SettingsTab />
          </div>
        </Transition>
      </main>
    </div>
    <ProjectFormModal />
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
