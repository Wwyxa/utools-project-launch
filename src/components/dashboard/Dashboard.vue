<script setup lang="ts">
import { useStore } from '../../store/useStore';
import ProjectCard from './ProjectCard.vue';

const store = useStore();
</script>

<template>
  <div class="p-8">
    <header class="mb-8">
      <h2 class="text-2xl font-bold text-on-surface tracking-tight">Projects Dashboard</h2>
      <p class="text-sm text-on-surface-variant mt-1">Manage your active development environments.</p>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      <ProjectCard 
        v-for="project in store.projects"
        :key="project.id"
        :project="project"
        @select="store.setSelectedProject"
      />
    </div>
  </div>
</template>
