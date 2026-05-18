<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Terminal as TerminalIcon, Trash2, ArrowDown, X, Search } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

const props = defineProps<{
  projectId: string;
}>();

const store = useStore();
const t = useI18n();
const scrollRef = ref<HTMLDivElement | null>(null);
const query = ref("");
const projectLogs = computed(() => store.logs[props.projectId] || []);
const filteredLogs = computed(() => {
  if (!query.value.trim()) {
    return projectLogs.value;
  }

  const normalized = query.value.toLowerCase();
  return projectLogs.value.filter((log) => log.message.toLowerCase().includes(normalized));
});

const scrollToBottom = () => {
  setTimeout(() => {
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
    }
  }, 0);
};

watch(projectLogs, scrollToBottom, { deep: true });
onMounted(scrollToBottom);
</script>

<template>
  <div class="mt-8 border border-border-subtle rounded-xl overflow-hidden flex flex-col h-64 shadow-sm">
    <div class="bg-bg-soft-gray px-4 py-2 flex items-center justify-between border-b border-border-subtle gap-4">
      <div class="flex items-center gap-3 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <TerminalIcon :size="14" class="text-on-surface-variant shrink-0" />
          <span class="text-xs font-semibold text-on-surface truncate"
            >{{ t.terminal.title }} - {{ store.selectedProject?.name }}</span
          >
        </div>
        <div class="h-4 w-px bg-border-subtle" />
        <button
          @click="store.clearLogs(projectId)"
          class="flex items-center gap-1.5 px-2 py-1 text-on-surface-variant hover:text-primary rounded hover:bg-surface-variant transition-colors"
        >
          <Trash2 :size="12" />
          <span class="text-[10px] font-medium">{{ t.terminal.clear }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-2 py-1 text-primary bg-primary/10 rounded hover:bg-primary/20 transition-colors"
        >
          <ArrowDown :size="12" />
          <span class="text-[10px] font-medium">{{ t.terminal.autoScroll }}</span>
        </button>
      </div>

      <div class="flex items-center gap-3 shrink-0">
        <div class="relative">
          <Search :size="12" class="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
          <input
            v-model="query"
            type="text"
            :placeholder="t.terminal.filter"
            class="bg-surface border border-border-subtle rounded px-7 py-1 text-[10px] w-40 focus:outline-none focus:border-primary"
          />
        </div>
        <button @click="query = ''" class="text-on-surface-variant hover:text-on-surface">
          <X :size="14" />
        </button>
      </div>
    </div>

    <div ref="scrollRef" class="bg-[#1E1E1E] flex-1 p-4 overflow-y-auto font-mono text-xs leading-relaxed">
      <div v-for="(log, index) in filteredLogs" :key="index" class="flex mb-1 group">
        <span class="w-20 text-right mr-4 shrink-0 text-white/30 select-none">
          {{ log.timestamp }}
        </span>
        <span
          :class="
            cn(
              'break-all',
              log.type === 'SUCCESS'
                ? 'text-status-running'
                : log.type === 'ERROR'
                  ? 'text-status-error'
                  : log.type === 'WARN'
                    ? 'text-[#f59e0b]'
                    : 'text-[#D4D4D4]',
            )
          "
        >
          {{ log.message }}
        </span>
      </div>
      <div v-if="filteredLogs.length === 0" class="text-white/20 italic">{{ t.terminal.empty }}</div>
      <div class="animate-pulse text-primary mt-1">_</div>
    </div>
  </div>
</template>
