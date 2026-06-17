<script setup lang="ts">
import { computed, watch } from "vue";
import { ArrowLeft, CheckCircle2, CircleAlert, CircleHelp, RefreshCw, Settings } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { EnvironmentToolKey, EnvironmentToolResult } from "../../types";

const store = useStore();
const t = useI18n();

const toolDefinitions: Array<{ key: EnvironmentToolKey; name: string }> = [
  { key: "node", name: "Node.js" },
  { key: "npm", name: "npm" },
  { key: "pnpm", name: "pnpm" },
  { key: "yarn", name: "Yarn" },
  { key: "python", name: "Python" },
  { key: "pip", name: "pip" },
  { key: "go", name: "Go" },
  { key: "git", name: "Git" },
  { key: "docker", name: "Docker" },
];

const enabledKeys = computed(() => new Set(store.environmentPreferences.enabledToolKeys));
const enabledDefinitions = computed(() => toolDefinitions.filter((tool) => enabledKeys.value.has(tool.key)));
const resultByKey = computed(() => new Map(store.environmentResults.map((result) => [result.key, result])));
const showInitialSkeleton = computed(
  () => enabledDefinitions.value.length > 0 && (!store.environmentChecked || store.environmentResults.length === 0),
);

const statusClass = (result?: EnvironmentToolResult) =>
  cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold",
    !result && "border-border-subtle bg-surface-container-low text-on-surface-variant",
    result?.status === "available" && "border-status-running/30 bg-status-running/10 text-status-running",
    result?.status === "missing" && "border-status-warning/30 bg-status-warning/10 text-status-warning",
    result?.status === "error" && "border-status-error/30 bg-status-error/10 text-status-error",
  );

const statusText = (result?: EnvironmentToolResult) => {
  if (!result) return store.environmentRefreshing ? t.value.environment.checking : t.value.environment.notChecked;
  if (result.status === "available") return t.value.environment.available;
  if (result.status === "missing") return t.value.environment.missing;
  return t.value.environment.error;
};

const formatTime = (value?: string) => {
  if (!value) return t.value.common.never;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

watch(
  enabledDefinitions,
  () => {
    if (!store.environmentChecked && !store.environmentRefreshing && enabledDefinitions.value.length > 0) {
      void store.refreshEnvironmentTools();
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="themed-scrollbar h-full overflow-y-auto p-2">
    <header class="mb-3 flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          @click="store.setActiveTab('projects')"
          class="rounded-lg border border-border-subtle bg-surface p-2 text-on-surface-variant shadow-sm transition-all active:scale-90 hover:bg-surface-variant"
          :title="t.common.back"
          :aria-label="t.common.back"
        >
          <ArrowLeft :size="20" />
        </button>
        <div class="min-w-0">
          <h2 class="truncate text-xl font-bold tracking-tight text-on-surface">{{ t.environment.title }}</h2>
          <p class="truncate text-xs text-on-surface-variant">{{ t.environment.subtitle }}</p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          @click="store.setActiveTab('settings')"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
          :title="t.environment.configure"
          :aria-label="t.environment.configure"
        >
          <Settings :size="14" />
          {{ t.environment.configure }}
        </button>
        <button
          type="button"
          @click="store.refreshEnvironmentTools"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-primary px-3 text-xs font-bold text-on-primary shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
          :disabled="store.environmentRefreshing || enabledDefinitions.length === 0"
          :title="t.common.refresh"
          :aria-label="t.common.refresh"
        >
          <RefreshCw :size="14" :class="store.environmentRefreshing && 'animate-spin'" />
          {{ t.common.refresh }}
        </button>
      </div>
    </header>

    <section
      class="rounded-lg border border-border-subtle bg-surface px-3.5 py-3 shadow-sm"
      :aria-busy="showInitialSkeleton"
    >
      <div
        v-if="enabledDefinitions.length === 0"
        class="rounded-lg border border-dashed border-border-subtle p-6 text-center text-sm text-on-surface-variant"
      >
        {{ t.environment.empty }}
      </div>
      <div v-else-if="showInitialSkeleton" class="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="tool in enabledDefinitions"
          :key="tool.key"
          class="min-w-0 rounded-lg border border-border-subtle bg-surface-container-low px-3 py-3"
        >
          <div class="mb-2 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-bold text-on-surface">{{ tool.name }}</h3>
            </div>
            <span
              class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[11px] font-bold text-on-surface-variant"
            >
              <RefreshCw :size="12" class="animate-spin" />
              {{ t.environment.checking }}
            </span>
          </div>
          <div class="space-y-2 text-xs">
            <div class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span class="text-on-surface-variant">{{ t.environment.version }}</span>
              <span class="h-3 w-24 animate-pulse rounded bg-surface-container-high" />
            </div>
            <div class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span class="text-on-surface-variant">{{ t.environment.path }}</span>
              <span class="h-3 w-full animate-pulse rounded bg-surface-container-high" />
            </div>
            <div class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span class="text-on-surface-variant">{{ t.environment.checkedAt }}</span>
              <span class="h-3 w-32 animate-pulse rounded bg-surface-container-high" />
            </div>
          </div>
        </article>
      </div>
      <div v-else class="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="tool in enabledDefinitions"
          :key="tool.key"
          class="min-w-0 rounded-lg border border-border-subtle bg-surface-container-low px-3 py-3"
        >
          <div class="mb-2 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-bold text-on-surface">{{ tool.name }}</h3>
            </div>
            <span :class="statusClass(resultByKey.get(tool.key))">
              <CheckCircle2 v-if="resultByKey.get(tool.key)?.status === 'available'" :size="12" />
              <CircleAlert v-else-if="resultByKey.get(tool.key)" :size="12" />
              <CircleHelp v-else :size="12" />
              {{ statusText(resultByKey.get(tool.key)) }}
            </span>
          </div>
          <dl class="space-y-1.5 text-xs">
            <div class="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
              <dt class="text-on-surface-variant">{{ t.environment.version }}</dt>
              <dd class="truncate font-mono text-on-surface">{{ resultByKey.get(tool.key)?.version || "-" }}</dd>
            </div>
            <div class="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
              <dt class="text-on-surface-variant">{{ t.environment.path }}</dt>
              <dd class="truncate font-mono text-on-surface" :title="resultByKey.get(tool.key)?.executablePath">
                {{ resultByKey.get(tool.key)?.executablePath || "-" }}
              </dd>
            </div>
            <div class="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
              <dt class="text-on-surface-variant">{{ t.environment.checkedAt }}</dt>
              <dd class="truncate text-on-surface">{{ formatTime(resultByKey.get(tool.key)?.checkedAt) }}</dd>
            </div>
            <div
              v-if="resultByKey.get(tool.key)?.error"
              class="rounded border border-status-error/20 bg-status-error/10 px-2 py-1 text-status-error"
            >
              {{ resultByKey.get(tool.key)?.error }}
            </div>
          </dl>
        </article>
      </div>
    </section>
  </div>
</template>
