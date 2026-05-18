<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "../../store/useStore";
import ProjectCard from "./ProjectCard.vue";
import { useI18n } from "../../lib/i18n";
import { Search, RefreshCw, Plus } from "lucide-vue-next";

const store = useStore();
const t = useI18n();

const searchQuery = ref("");
const projects = computed(() => {
  if (!searchQuery.value) return store.projects;
  const q = searchQuery.value.toLowerCase();
  return store.projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.type.toLowerCase().includes(q),
  );
});

const handleRefreshAll = () => {
  store.refreshProjects();
};
</script>

<template>
  <div class="min-h-full">
    <div class="dashboard-toolbar sticky top-0 z-20 px-6 py-2">
      <div class="flex items-center justify-between gap-4">
        <div class="relative flex-1 max-w-md">
          <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t.common.search"
            class="toolbar-search pl-9 pr-4 py-1.5 rounded-lg text-sm w-full transition-all"
          />
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="handleRefreshAll"
            class="toolbar-icon-button p-1.5 rounded-lg transition-colors"
            :title="t.common.refresh"
          >
            <RefreshCw :size="18" />
          </button>
          <button
            @click="store.openCreateProjectForm"
            class="toolbar-primary-button p-1.5 rounded-lg flex items-center justify-center transition-colors"
            :title="t.dashboard.createHint"
          >
            <Plus :size="18" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="projects.length === 0" class="m-6 border border-dashed border-border-subtle rounded-xl p-8 text-center">
      <p class="text-sm text-on-surface-variant mb-4">{{ t.dashboard.empty }}</p>
      <button
        @click="store.openCreateProjectForm"
        class="toolbar-primary-button px-4 py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm"
      >
        {{ t.dashboard.createHint }}
      </button>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 px-6 pt-4 pb-6">
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        @select="store.setSelectedProject"
      />
    </div>
  </div>
</template>
