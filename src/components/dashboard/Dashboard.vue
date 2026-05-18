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
  <div class="p-6">
    <div class="flex items-center justify-between gap-4 mb-6 sticky top-0 bg-background py-2 z-10">
      <div class="relative flex-1 max-w-md">
        <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t.common.search"
          class="pl-9 pr-4 py-2 bg-surface-container-lowest border border-border-subtle rounded-xl text-sm w-full focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
        />
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="handleRefreshAll"
          class="p-2 text-on-surface-variant hover:bg-surface-variant rounded-xl transition-colors bg-surface border border-border-subtle"
          :title="t.common.refresh"
        >
          <RefreshCw :size="18" />
        </button>
        <button
          @click="store.openCreateProjectForm"
          class="bg-primary text-white p-2 rounded-xl flex items-center justify-center hover:bg-primary/90 transition-colors"
          :title="t.dashboard.createHint"
        >
          <Plus :size="18" />
        </button>
      </div>
    </div>

    <div v-if="projects.length === 0" class="border border-dashed border-border-subtle rounded-xl p-8 text-center">
      <p class="text-sm text-on-surface-variant mb-4">{{ t.dashboard.empty }}</p>
      <button
        @click="store.openCreateProjectForm"
        class="bg-primary text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
      >
        {{ t.dashboard.createHint }}
      </button>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        @select="store.setSelectedProject"
      />
    </div>
  </div>
</template>
