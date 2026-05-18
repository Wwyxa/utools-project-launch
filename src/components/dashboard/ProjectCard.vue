<script setup lang="ts">
import { Play, Square, RotateCcw, Terminal as TerminalIcon, Clock, AlertTriangle } from 'lucide-vue-next';
import { Project, ProjectStatus } from '../../types';
import { cn } from '../../lib/utils';

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void;
}>();

const isRunning = props.project.status === ProjectStatus.RUNNING;
const isError = props.project.status === ProjectStatus.ERROR;
</script>

<template>
  <div 
    @click="emit('select', project.id)"
    class="group relative border border-border-subtle rounded-xl p-5 bg-surface hover:bg-bg-soft-gray transition-all cursor-pointer flex flex-col h-full overflow-hidden"
  >
    <div class="flex justify-between items-start mb-4">
      <div>
        <h3 class="text-lg font-bold text-on-surface group-hover:text-primary transition-colors">
          {{ project.name }}
        </h3>
        <p class="font-mono text-xs text-on-surface-variant mt-1">{{ project.type }}</p>
        <div class="flex gap-1 mt-2">
          <span 
            v-for="s in project.scripts.slice(0, 2)" 
            :key="s.id" 
            class="text-[10px] uppercase font-bold text-on-surface-variant bg-surface-variant px-1.5 py-0.5 rounded"
          >
            {{ s.name }}
          </span>
          <span 
            v-if="project.scripts.length > 2" 
            class="text-[10px] font-bold text-on-surface-variant bg-surface-variant px-1.5 py-0.5 rounded"
          >
            +{{ project.scripts.length - 2 }}
          </span>
        </div>
      </div>
      
      <div :class="cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider',
        isRunning ? 'bg-status-running/10 text-status-running' : 
        isError ? 'bg-status-error/10 text-status-error' : 
        'bg-bg-soft-gray text-status-stopped border border-border-subtle'
      )">
        <span :class="cn(
          'w-1.5 h-1.5 rounded-full',
          isRunning ? 'bg-status-running' : isError ? 'bg-status-error' : 'bg-status-stopped'
        )" />
        {{ project.status.toLowerCase() }}
      </div>
    </div>

    <div class="mt-auto pt-4 flex items-center justify-between border-t border-border-subtle">
      <div class="flex items-center gap-1.5 text-xs text-on-surface-variant">
        <span v-if="isError" class="flex items-center gap-1 text-status-error">
          <AlertTriangle :size="12" /> Exit code 1
        </span>
        <span v-else class="flex items-center gap-1">
          <Clock :size="12" /> {{ project.lastUpdated || '--' }}
        </span>
      </div>

      <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button v-if="isRunning" class="p-1.5 text-on-surface-variant hover:text-status-error rounded hover:bg-surface transition-colors">
          <Square :size="16" fill="currentColor" />
        </button>
        <button v-else class="p-1.5 text-on-surface-variant hover:text-status-running rounded hover:bg-surface transition-colors">
          <Play :size="16" fill="currentColor" />
        </button>
        <button class="p-1.5 text-on-surface-variant hover:text-primary rounded hover:bg-surface transition-colors">
          <RotateCcw :size="16" />
        </button>
        <button class="p-1.5 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface transition-colors">
          <TerminalIcon :size="16" />
        </button>
      </div>
    </div>

    <!-- Status Edge -->
    <div :class="cn(
      'absolute left-0 top-0 bottom-0 w-1',
      isRunning ? 'bg-status-running' : isError ? 'bg-status-error' : 'transparent'
    )" />
  </div>
</template>
