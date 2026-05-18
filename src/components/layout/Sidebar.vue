<script setup lang="ts">
import { FolderOpen, GitBranch, StickyNote, Settings, FileText, LogOut, Plus, Terminal as TerminalIcon } from 'lucide-vue-next';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';

const store = useStore();

const navItems = [
  { icon: FolderOpen, label: 'Projects', active: true },
  { icon: GitBranch, label: 'Git' },
  { icon: StickyNote, label: 'Memos' },
  { icon: Settings, label: 'Settings' },
];

const footerItems = [
  { icon: FileText, label: 'Docs' },
  { icon: LogOut, label: 'Logout' },
];
</script>

<template>
  <aside class="fixed left-0 top-0 h-full w-[200px] border-r border-border-subtle bg-bg-soft-gray flex flex-col py-6 z-20">
    <div class="px-4 mb-8">
      <div class="flex items-center gap-2 mb-2">
        <div class="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center">
          <TerminalIcon :size="18" />
        </div>
        <div>
          <h1 class="text-lg font-bold text-on-surface leading-tight">uTools PM</h1>
          <p class="text-[10px] text-on-surface-variant font-medium">Developer Tools</p>
        </div>
      </div>
      <button class="w-full mt-4 bg-primary-container text-on-primary py-2 px-3 rounded flex items-center justify-center gap-2 text-xs font-semibold hover:bg-primary transition-colors">
        <Plus :size="14" />
        New Project
      </button>
    </div>

    <nav class="flex-1 px-2 space-y-1">
      <button
        v-for="item in navItems"
        :key="item.label"
        @click="item.label === 'Projects' && store.setSelectedProject(null)"
        :class="cn(
          'w-full flex items-center gap-3 py-2 px-4 rounded-lg transition-colors text-sm',
          item.active 
            ? 'bg-surface-container border-l-[3px] border-primary font-bold text-on-surface' 
            : 'text-on-surface-variant hover:bg-surface-variant'
        )"
      >
        <component :is="item.icon" :size="18" :fill="item.active ? 'currentColor' : 'none'" />
        {{ item.label }}
      </button>
    </nav>

    <div class="mt-auto px-2 pt-4 border-t border-border-subtle space-y-1">
      <button
        v-for="item in footerItems"
        :key="item.label"
        class="w-full flex items-center gap-3 py-2 px-4 rounded-lg text-on-surface-variant hover:bg-surface-variant transition-colors text-sm"
      >
        <component :is="item.icon" :size="18" />
        {{ item.label }}
      </button>
    </div>
  </aside>
</template>
