<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from './store/useStore';
import Sidebar from './components/layout/Sidebar.vue';
import TopBar from './components/layout/TopBar.vue';
import Dashboard from './components/dashboard/Dashboard.vue';
import ProjectDetails from './components/project/ProjectDetails.vue';

const store = useStore();
const selectedProject = computed(() => store.selectedProject);
</script>

<template>
  <div class="flex min-h-screen bg-background">
    <Sidebar />
    <div class="ml-[200px] flex-1 flex flex-col h-screen overflow-hidden">
      <TopBar />
      <main class="flex-1 overflow-hidden">
        <Transition name="fade" mode="out-in">
          <div v-if="!store.selectedProjectId" key="dashboard" class="h-full overflow-y-auto">
            <Dashboard />
          </div>
          <div v-else key="details" class="h-full overflow-hidden">
            <ProjectDetails v-if="selectedProject" :project="selectedProject" />
          </div>
        </Transition>
      </main>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
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
