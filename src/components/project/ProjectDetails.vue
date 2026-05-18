<script setup lang="ts">
import { ref, computed } from 'vue';
import { ExternalLink, Folder } from 'lucide-vue-next';
import { Project } from '../../types';
import { cn } from '../../lib/utils';
import ScriptsTab from './ScriptsTab.vue';
import GitTab from './GitTab.vue';
import MemoTab from './MemoTab.vue';
import Terminal from '../terminal/Terminal.vue';

const props = defineProps<{
  project: Project;
}>();

const activeTab = ref<'info' | 'scripts' | 'git' | 'memo'>('scripts');

const tabs = [
  { id: 'info', label: 'Basic Info' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'git', label: 'Git' },
  { id: 'memo', label: 'Memo' },
];
</script>

<template>
  <div class="p-8 flex-1 flex flex-col h-full overflow-hidden">
    <!-- Project Header -->
    <div class="mb-8 flex justify-between items-start">
      <div>
        <h2 class="text-2xl font-bold text-on-surface">{{ project.name }}</h2>
        <div class="flex items-center gap-3 text-xs font-medium text-on-surface-variant mt-1">
          <span class="flex items-center gap-1.5">
            <Folder :size="14" /> {{ project.path }}
          </span>
          <span class="w-1 h-1 rounded-full bg-border-subtle" />
          <span class="flex items-center gap-1.5 text-status-running bg-status-running/10 px-2 py-0.5 rounded-full">
            <span class="w-1.5 h-1.5 rounded-full bg-status-running" />
            {{ project.status === 'RUNNING' ? 'Running' : project.status }}
          </span>
        </div>
      </div>
      <button class="bg-surface border border-border-subtle group text-on-surface hover:bg-surface-variant px-4 py-2 rounded-lg flex items-center gap-2 text-xs font-bold transition-all">
        <ExternalLink :size="14" class="group-hover:text-primary" />
        Open in VS Code
      </button>
    </div>

    <!-- Tab Navigation -->
    <nav class="flex gap-8 border-b border-border-subtle mb-8">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="activeTab = tab.id as any"
        :class="cn(
          'pb-4 text-sm font-bold transition-all relative',
          activeTab === tab.id 
            ? 'text-primary' 
            : 'text-on-surface-variant hover:text-on-surface'
        )"
      >
        {{ tab.label }}
        <div v-if="activeTab === tab.id" class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full shadow-[0_-2px_6px_rgba(46,175,125,0.4)]" />
      </button>
    </nav>

    <!-- Tab Content -->
    <div class="flex-1 overflow-y-auto scrollbar-hide pr-1">
      <ScriptsTab v-if="activeTab === 'scripts'" :project="project" />
      <GitTab v-if="activeTab === 'git'" :project="project" />
      <MemoTab v-if="activeTab === 'memo'" :project="project" />
      <div v-if="activeTab === 'info'" class="bg-bg-soft-gray/50 border border-border-subtle p-8 rounded-xl text-center">
        <div class="text-on-surface-variant text-sm italic">Project summary and architecture diagrams coming soon.</div>
      </div>
      
      <!-- Persistent Terminal -->
      <Terminal :projectId="project.id" />
    </div>
  </div>
</template>
