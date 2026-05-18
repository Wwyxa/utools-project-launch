<script setup lang="ts">
import { GitBranch, Download, Upload, Eye, Minus, PlusCircle, Trash2 } from 'lucide-vue-next';
import { Project } from '../../types';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const files = store.stagedFiles[props.project.id] || [];
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="bg-bg-soft-gray border border-border-subtle rounded-xl overflow-hidden shadow-sm">
      <div class="p-4 border-b border-border-subtle flex items-center justify-between">
        <div class="flex flex-col gap-1">
          <span class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Current Branch</span>
          <div class="flex items-center gap-2">
            <GitBranch :size="16" class="text-primary" />
            <span class="font-mono text-xs font-bold text-on-surface bg-surface border border-border-subtle px-2 py-0.5 rounded shadow-sm">
              {{ project.branch || 'main' }}
            </span>
          </div>
        </div>
        <div class="flex gap-2">
          <button class="h-9 px-4 rounded border border-border-subtle bg-surface text-on-surface hover:bg-surface-variant text-xs font-bold flex items-center gap-2 transition-colors">
            <Download :size="14" /> Pull
          </button>
          <button class="h-9 px-4 rounded bg-primary-container text-on-primary text-xs font-bold flex items-center gap-2 hover:bg-primary transition-colors">
            <Upload :size="14" /> Commit & Push
          </button>
        </div>
      </div>

      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-on-surface">Staged Changes</h3>
          <span class="text-[10px] font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full">
            {{ files.length }} files
          </span>
        </div>

        <div class="space-y-2">
          <div v-for="(file, idx) in files" :key="idx" class="group flex items-center justify-between p-3 border border-border-subtle rounded-lg hover:bg-bg-soft-gray transition-all">
            <div class="flex items-center gap-4 overflow-hidden">
              <div :class="cn(
                'w-8 h-8 rounded flex items-center justify-center shrink-0',
                file.status === 'ADDED' ? 'bg-primary-fixed' :
                file.status === 'DELETED' ? 'bg-error-container' :
                'bg-secondary-fixed'
              )">
                <PlusCircle v-if="file.status === 'ADDED'" :size="14" class="text-primary" />
                <Trash2 v-else-if="file.status === 'DELETED'" :size="14" class="text-error" />
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-secondary">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div class="truncate">
                <p :class="cn(
                  'font-mono text-xs font-bold truncate',
                  file.status === 'DELETED' ? 'text-on-surface-variant line-through' : 'text-on-surface'
                )">
                  {{ file.path }}
                </p>
                <div class="flex gap-3 text-[10px] font-bold mt-0.5">
                  <span v-if="file.additions > 0" class="text-status-running">+{{ file.additions }}</span>
                  <span v-if="file.deletions > 0" class="text-status-error">-{{ file.deletions }}</span>
                </div>
              </div>
            </div>

            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="p-1.5 text-on-surface-variant hover:bg-surface-container rounded"><Eye :size="14" /></button>
              <button class="p-1.5 text-on-surface-variant hover:bg-surface-container rounded"><Minus :size="14" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
