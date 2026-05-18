<script setup lang="ts">
import { computed } from "vue";
import { FolderOpen, GitBranch, StickyNote, Settings, FileText, Plus, Terminal as TerminalIcon } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";

const store = useStore();
const t = useI18n();

const navItems = computed(() => [
  {
    id: "projects",
    icon: FolderOpen,
    label: t.value.sidebar.projects,
    active: store.activeTab === "projects",
    action: () => store.setActiveTab("projects"),
  },
  {
    id: "plugins",
    icon: GitBranch,
    label: t.value.sidebar.plugins,
    active: store.activeTab === "plugins",
    action: () => store.setActiveTab("plugins"),
  },
  {
    id: "memos",
    icon: StickyNote,
    label: t.value.sidebar.memos,
    active: store.activeTab === "memos",
    action: () => store.setActiveTab("memos"),
  },
  {
    id: "settings",
    icon: Settings,
    label: t.value.sidebar.settings,
    active: store.activeTab === "settings",
    action: () => store.setActiveTab("settings"),
  },
]);

const footerItems = computed(() => [{ icon: FileText, label: t.value.sidebar.docs }]);
</script>

<template>
  <aside
    class="fixed left-0 top-0 h-full w-[64px] border-r border-border-subtle bg-bg-soft-gray flex flex-col py-6 z-20"
  >
    <div class="flex flex-col items-center mb-6">
      <div
        class="w-10 h-10 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center mb-6 shadow-sm"
      >
        <TerminalIcon :size="22" />
      </div>

      <button
        @click="store.openCreateProjectForm"
        class="w-10 h-10 bg-primary-container text-on-primary rounded-full flex items-center justify-center hover:bg-primary transition-all active:scale-95 shadow-sm"
        :title="t.sidebar.newProject"
      >
        <Plus :size="20" />
      </button>
    </div>

    <nav class="flex-1 px-2 space-y-4">
      <button
        v-for="item in navItems"
        :key="item.id"
        @click="item.action"
        :title="item.label"
        :class="
          cn(
            'w-full flex flex-col items-center justify-center py-2 rounded-lg transition-all relative group',
            item.active ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant',
          )
        "
      >
        <component :is="item.icon" :size="22" :fill="item.active ? 'currentColor' : 'none'" />
        <div
          v-if="item.active"
          class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full"
        ></div>
      </button>
    </nav>

    <div class="mt-auto px-2 pt-4 border-t border-border-subtle space-y-4">
      <button
        v-for="item in footerItems"
        :key="item.label"
        :title="item.label"
        class="w-full flex items-center justify-center py-2 rounded-lg text-on-surface-variant hover:bg-surface-variant hover:text-on-surface transition-colors"
      >
        <component :is="item.icon" :size="22" />
      </button>
    </div>
  </aside>
</template>
