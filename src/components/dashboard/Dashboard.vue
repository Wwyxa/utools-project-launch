<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "../../store/useStore";
import ProjectCard from "./ProjectCard.vue";
import { useI18n } from "../../lib/i18n";

const store = useStore();
const t = useI18n();

const projects = computed(() => store.projects);
</script>

<template>
  <div class="p-8">
    <header class="mb-8 flex items-end justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold text-on-surface tracking-tight">{{ t.dashboard.title }}</h2>
        <p class="text-sm text-on-surface-variant mt-1">{{ t.dashboard.description }}</p>
      </div>
      <button
        @click="store.openCreateProjectForm"
        class="bg-primary-container text-on-primary px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary transition-colors"
      >
        {{ t.dashboard.createHint }}
      </button>
    </header>

    <div
      v-if="projects.length === 0"
      class="border border-dashed border-border-subtle rounded-xl p-8 text-sm text-on-surface-variant bg-surface"
    >
      {{ t.dashboard.empty }}
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        @select="store.setSelectedProject"
      />
    </div>
  </div>
</template>
