<script setup lang="ts">
import { computed, watch } from "vue";
import { ArrowLeft, CheckCircle2, CircleAlert, CircleHelp, RefreshCw, Settings } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { EnvironmentToolResult } from "../../types";

const store = useStore();
const t = useI18n();

const enabledKeys = computed(() => new Set(store.environmentPreferences.enabledToolKeys));
const enabledDefinitions = computed(() => [
  ...store.builtinEnvironmentTools
    .filter((tool) => enabledKeys.value.has(tool.key))
    .map((tool) => ({
      ...tool,
      command:
        store.environmentPreferences.builtinOverrides.find((item) => item.key === tool.key)?.command || tool.command,
    })),
  ...store.environmentPreferences.customTools
    .filter((tool) => tool.enabled)
    .map((tool) => ({ key: tool.id, name: tool.name, command: tool.command })),
]);
const resultByKey = computed(() => new Map(store.environmentResults.map((result) => [result.key, result])));
const isRefreshing = (key: string) => store.environmentRefreshingKeys[key] === true;

const statusClass = (key: string, result?: EnvironmentToolResult) =>
  cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold",
    !result && "border-border-subtle bg-surface-container-low text-on-surface-variant",
    isRefreshing(key) && "border-primary/30 bg-primary/10 text-primary",
    !isRefreshing(key) &&
      result?.status === "available" &&
      "border-status-running/30 bg-status-running/10 text-status-running",
    !isRefreshing(key) &&
      result?.status === "missing" &&
      "border-status-warning/30 bg-status-warning/10 text-status-warning",
    !isRefreshing(key) && result?.status === "error" && "border-status-error/30 bg-status-error/10 text-status-error",
  );

const statusText = (key: string, result?: EnvironmentToolResult) => {
  if (isRefreshing(key)) return t.value.environment.checking;
  if (!result) return t.value.environment.notChecked;
  if (result.status === "available") return t.value.environment.available;
  if (result.status === "missing") return t.value.environment.missing;
  return t.value.environment.error;
};

watch(
  () => [
    enabledDefinitions.value.map((tool) => tool.key).join("|"),
    store.environmentRefreshing,
    store.environmentResults.map((result) => result.key).join("|"),
  ],
  () => {
    if (store.environmentRefreshing) return;
    const missingKeys = enabledDefinitions.value.map((tool) => tool.key).filter((key) => !resultByKey.value.has(key));
    if (missingKeys.length > 0) void store.refreshEnvironmentTools(missingKeys);
  },
  { immediate: true },
);
</script>

<template>
  <div class="themed-scrollbar h-full overflow-y-auto p-2">
    <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
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
          <span class="hidden sm:inline">{{ t.environment.configure }}</span>
        </button>
        <button
          type="button"
          @click="store.refreshEnvironmentTools()"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-primary px-3 text-xs font-bold text-on-primary shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
          :disabled="store.environmentRefreshing || enabledDefinitions.length === 0"
          :title="t.common.refresh"
          :aria-label="t.common.refresh"
        >
          <RefreshCw :size="14" :class="store.environmentRefreshing && 'animate-spin'" />
          <span class="hidden sm:inline">{{ t.common.refresh }}</span>
        </button>
      </div>
    </header>

    <section :aria-busy="store.environmentRefreshing">
      <div
        v-if="enabledDefinitions.length === 0"
        class="rounded border border-dashed border-border-subtle px-3 py-2 text-sm text-on-surface-variant"
      >
        {{ t.environment.empty }}
      </div>
      <div v-else>
        <div
          class="hidden grid-cols-[minmax(7rem,0.7fr)_minmax(16rem,1.35fr)_minmax(10rem,1.7fr)_auto] items-center gap-3 border-b border-border-subtle px-2 pb-1.5 text-[10px] font-bold text-on-surface-variant md:grid"
        >
          <span>{{ t.environment.tool }}</span>
          <span>{{ t.environment.version }}</span>
          <span>{{ t.environment.path }}</span>
          <span class="sr-only">{{ t.common.status }}</span>
        </div>
        <article
          v-for="tool in enabledDefinitions"
          :key="tool.key"
          class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-border-subtle px-2 py-2.5 transition-colors last:border-b-0 hover:bg-surface-container-low md:grid-cols-[minmax(7rem,0.7fr)_minmax(16rem,1.35fr)_minmax(10rem,1.7fr)_auto] md:gap-3"
        >
          <div class="min-w-0">
            <h3 class="truncate text-sm font-bold text-on-surface" :title="tool.name">{{ tool.name }}</h3>
          </div>
          <div
            class="col-span-2 grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-xs md:col-span-1 md:col-start-2 md:row-start-1 md:block"
          >
            <span class="text-on-surface-variant md:hidden">{{ t.environment.version }}</span>
            <span v-if="isRefreshing(tool.key) && !resultByKey.get(tool.key)" class="skeleton h-3 w-20" />
            <span v-else class="block truncate font-mono text-on-surface" :title="resultByKey.get(tool.key)?.version">
              {{ resultByKey.get(tool.key)?.version || "-" }}
            </span>
          </div>
          <div
            class="col-span-2 grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-xs md:col-span-1 md:col-start-3 md:row-start-1 md:block"
          >
            <span class="text-on-surface-variant md:hidden">{{ t.environment.path }}</span>
            <span v-if="isRefreshing(tool.key) && !resultByKey.get(tool.key)" class="skeleton h-3 w-full" />
            <span
              v-else
              :class="[
                'block truncate font-mono',
                resultByKey.get(tool.key)?.error ? 'text-status-error' : 'text-on-surface',
              ]"
              :title="resultByKey.get(tool.key)?.error || resultByKey.get(tool.key)?.executablePath"
            >
              {{ resultByKey.get(tool.key)?.error || resultByKey.get(tool.key)?.executablePath || "-" }}
            </span>
          </div>
          <span
            :class="[
              statusClass(tool.key, resultByKey.get(tool.key)),
              'col-start-2 row-start-1 md:col-start-4 md:row-start-1',
            ]"
          >
            <RefreshCw v-if="isRefreshing(tool.key)" :size="12" class="animate-spin" />
            <CheckCircle2 v-else-if="resultByKey.get(tool.key)?.status === 'available'" :size="12" />
            <CircleAlert v-else-if="resultByKey.get(tool.key)" :size="12" />
            <CircleHelp v-else :size="12" />
            {{ statusText(tool.key, resultByKey.get(tool.key)) }}
          </span>
        </article>
      </div>
    </section>
  </div>
</template>
