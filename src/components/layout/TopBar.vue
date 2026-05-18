<script setup lang="ts">
import { computed } from "vue";
import { Search, RefreshCw, Bell, ArrowLeft, Languages } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";

const store = useStore();
const t = useI18n();

const title = computed(() => (store.selectedProject ? store.selectedProject.name : t.value.app.title));
</script>

<template>
  <header
    class="h-16 border-b border-border-subtle bg-surface flex items-center justify-between px-6 sticky top-0 z-10"
  >
    <div class="flex items-center gap-4 min-w-0">
      <button
        v-if="store.selectedProjectId"
        @click="store.setSelectedProject(null)"
        class="p-1 hover:bg-surface-variant rounded-full text-on-surface-variant transition-transform active:scale-90"
      >
        <ArrowLeft :size="20" />
      </button>
      <div class="min-w-0">
        <h2 class="text-xl font-bold text-primary truncate">{{ title }}</h2>
        <p class="text-xs text-on-surface-variant truncate">
          {{ store.selectedProject ? `${store.selectedProject.type} · ${store.selectedProject.path}` : t.app.subtitle }}
        </p>
      </div>
    </div>

    <div class="flex items-center gap-4">
      <div class="relative">
        <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <input
          type="text"
          :placeholder="t.common.search"
          class="pl-9 pr-4 py-1.5 bg-bg-soft-gray border border-border-subtle rounded-full text-sm w-48 focus:w-64 focus:outline-none focus:border-primary transition-all"
        />
      </div>
      <button
        @click="store.setLocale(store.locale === 'zh-CN' ? 'en-US' : 'zh-CN')"
        class="p-2 text-on-surface-variant hover:bg-bg-soft-gray rounded-full transition-colors"
        :title="t.common.language"
      >
        <Languages :size="20" />
      </button>
      <div class="flex items-center gap-2">
        <button
          @click="store.selectedProjectId && store.refreshGitSnapshot(store.selectedProjectId)"
          class="p-2 text-on-surface-variant hover:bg-bg-soft-gray rounded-full transition-colors"
        >
          <RefreshCw :size="20" />
        </button>
        <button class="p-2 text-on-surface-variant hover:bg-bg-soft-gray rounded-full transition-colors relative">
          <Bell :size="20" />
          <span class="absolute top-2 right-2 w-2 h-2 bg-status-error rounded-full border border-surface"></span>
        </button>
      </div>
    </div>
  </header>
</template>
