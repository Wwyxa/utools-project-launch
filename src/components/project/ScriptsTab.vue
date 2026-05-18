<script setup lang="ts">
import { ref } from 'vue';
import { Terminal as TerminalIcon, Play, Square, Settings, Copy, Check, ChevronDown } from 'lucide-vue-next';
import { Project } from '../../types';
import { cn } from '../../lib/utils';

const props = defineProps<{
  project: Project;
}>();

const copiedId = ref<string | null>(null);

const handleCopy = (id: string, text: string) => {
  navigator.clipboard.writeText(text);
  copiedId.value = id;
  setTimeout(() => copiedId.value = null, 2000);
};
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div class="lg:col-span-2 space-y-6">
      <!-- Global Control -->
      <div class="bg-surface border border-border-subtle rounded-lg p-4 flex justify-between items-center shadow-sm">
        <div>
          <div class="text-lg font-bold text-on-surface">Development Server</div>
          <div class="text-xs text-on-surface-variant mt-1">Start all necessary services for local development.</div>
        </div>
        <div class="flex items-center gap-4">
          <label class="flex items-center cursor-pointer group">
            <input type="checkbox" class="sr-only peer" checked />
            <div class="w-10 h-6 bg-surface-container rounded-full peer peer-checked:bg-primary transition-colors relative">
              <div class="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm" />
            </div>
            <span class="ml-3 text-xs font-semibold text-on-surface">Auto-start both</span>
          </label>
          <button class="bg-primary-container text-on-primary py-2 px-4 rounded-md flex items-center gap-2 text-sm font-bold hover:bg-primary transition-colors">
            <Play :size="16" fill="currentColor" />
            Start All
          </button>
        </div>
      </div>

      <!-- Script Groups -->
      <div v-for="group in ['Frontend', 'Backend']" :key="group" class="bg-surface border border-border-subtle rounded-lg overflow-hidden group/card shadow-sm">
        <div class="bg-bg-soft-gray p-4 border-b border-border-subtle flex justify-between items-center">
          <div class="flex items-center gap-2">
            <TerminalIcon :size="18" class="text-on-surface-variant" />
            <h3 class="font-bold text-on-surface">{{ group }}</h3>
          </div>
          <span class="px-2 py-0.5 rounded-full bg-status-running/10 text-status-running text-[10px] font-bold uppercase tracking-wider">
            Active
          </span>
        </div>
        
        <div class="p-4 space-y-4">
          <div class="space-y-4">
            <div class="flex items-center justify-between text-on-surface-variant">
              <div class="flex items-center gap-2 text-[10px] font-bold uppercase">
                <TerminalIcon :size="14" />
                Auto-detected Scripts
              </div>
              <span class="text-[10px] opacity-60">Scanned from package.json</span>
            </div>

            <div class="space-y-2">
              <div v-for="script in project.scripts" :key="script.id" class="flex items-center justify-between p-3 bg-bg-soft-gray/50 rounded border border-border-subtle hover:border-primary/30 transition-colors">
                <div class="flex items-center gap-4">
                  <div class="font-mono text-xs font-bold text-on-surface w-16">{{ script.name }}</div>
                  <div :class="cn(
                    'px-2 py-0.5 rounded-full text-[9px] font-bold border',
                    script.status === 'RUNNING' ? 'bg-status-running/10 text-status-running border-status-running/20' : 'bg-status-stopped/10 text-status-stopped border-status-stopped/20'
                  )">
                    {{ script.status }}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button class="p-1.5 text-on-surface-variant hover:text-primary transition-colors">
                    <Settings :size="16" />
                  </button>
                  <button v-if="script.status === 'RUNNING'" class="bg-status-error text-white text-xs font-bold py-1.5 px-3 rounded flex items-center gap-1.5 hover:bg-opacity-90">
                    <Square :size="12" fill="currentColor" /> Stop
                  </button>
                  <button v-else class="bg-primary text-white text-xs font-bold py-1.5 px-3 rounded flex items-center gap-1.5 hover:bg-opacity-90">
                    <Play :size="12" fill="currentColor" /> Run
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Sidebar: Environment -->
    <div class="space-y-6">
      <div class="bg-surface border border-border-subtle rounded-lg overflow-hidden shadow-sm">
        <div class="bg-bg-soft-gray p-4 border-b border-border-subtle flex justify-between items-center">
          <h3 class="font-bold text-on-surface">Environment</h3>
          <button class="text-on-surface-variant hover:text-primary transition-colors">
            <ChevronDown :size="18" />
          </button>
        </div>
        <div class="divide-y divide-border-subtle">
          <div v-for="(value, key) in project.env" :key="key" class="p-3 hover:bg-bg-soft-gray/50 transition-colors group">
            <div class="flex justify-between items-start mb-1">
              <span class="font-mono text-xs font-bold text-secondary">{{ key }}</span>
              <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  @click="handleCopy(key, value)"
                  class="p-1 text-on-surface-variant hover:text-primary"
                >
                  <Check v-if="copiedId === key" :size="12" />
                  <Copy v-else :size="12" />
                </button>
              </div>
            </div>
            <div class="font-mono text-xs text-on-surface-variant bg-bg-soft-gray/30 p-2 rounded truncate">
              {{ value }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
