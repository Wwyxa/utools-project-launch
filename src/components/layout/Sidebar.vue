<script setup lang="ts">
import { computed } from "vue";
import {
  FolderOpen,
  GitBranch,
  StickyNote,
  Settings,
  FileText,
  LogOut,
  Plus,
  Terminal as TerminalIcon,
  Languages,
} from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";

const store = useStore();
const t = useI18n();

const navItems = computed(() => [
  { icon: FolderOpen, label: t.value.sidebar.projects, active: true, action: () => store.setSelectedProject(null) },
  { icon: GitBranch, label: t.value.sidebar.projects, active: false, action: () => store.setSelectedProject(null) },
  { icon: StickyNote, label: t.value.sidebar.memos, active: false, action: () => store.setSelectedProject(null) },
  { icon: Settings, label: t.value.sidebar.settings, active: false, action: () => store.setSelectedProject(null) },
]);

const footerItems = computed(() => [
  { icon: FileText, label: t.value.sidebar.docs },
  { icon: LogOut, label: t.value.sidebar.logout },
]);
</script>

<template>
  <aside
    class="fixed left-0 top-0 h-full w-[220px] border-r border-border-subtle bg-bg-soft-gray flex flex-col py-6 z-20"
  >
    <div class="px-4 mb-6">
      <div class="flex items-center gap-2 mb-3">
        <div
          class="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center"
        >
          <TerminalIcon :size="18" />
        </div>
        <div>
          <h1 class="text-lg font-bold text-on-surface leading-tight">{{ t.app.title }}</h1>
          <p class="text-[10px] text-on-surface-variant font-medium">{{ t.app.subtitle }}</p>
        </div>
      </div>
      <button
        @click="store.openCreateProjectForm"
        class="w-full mt-3 bg-primary-container text-on-primary py-2 px-3 rounded flex items-center justify-center gap-2 text-xs font-semibold hover:bg-primary transition-colors"
      >
        <Plus :size="14" />
        {{ t.sidebar.newProject }}
      </button>
      <button
        @click="store.setLocale(store.locale === 'zh-CN' ? 'en-US' : 'zh-CN')"
        class="w-full mt-2 bg-surface border border-border-subtle text-on-surface py-2 px-3 rounded flex items-center justify-center gap-2 text-xs font-semibold hover:bg-surface-variant transition-colors"
      >
        <Languages :size="14" />
        {{ store.locale === "zh-CN" ? "中文 / English" : "English / 中文" }}
      </button>
    </div>

    <nav class="flex-1 px-2 space-y-1">
      <button
        v-for="item in navItems"
        :key="item.label"
        @click="item.action"
        :class="
          cn(
            'w-full flex items-center gap-3 py-2 px-4 rounded-lg transition-colors text-sm',
            item.active
              ? 'bg-surface-container border-l-[3px] border-primary font-bold text-on-surface'
              : 'text-on-surface-variant hover:bg-surface-variant',
          )
        "
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
