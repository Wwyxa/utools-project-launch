<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { ArrowDownToLine, ArrowUpToLine, Search, Terminal as TerminalIcon, Trash2, X } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn, scrollToBoundary, transferWheelAtScrollBoundary } from "../../lib/utils";
import type { ProjectScript } from "../../types";

const props = defineProps<{
  projectId: string;
  scripts?: Pick<ProjectScript, "id" | "name" | "status">[];
}>();

const store = useStore();
const t = useI18n();
const scrollRef = ref<HTMLDivElement | null>(null);
const query = ref("");
const selectedScriptId = ref("");
const closedAt = ref<Record<string, number>>({});
const shouldFollowLogs = ref(true);

const logFollowThreshold = 32;

const isNearBottom = (element: HTMLDivElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight <= logFollowThreshold;

const logTargets = computed(() =>
  (props.scripts || [])
    .map((script) => ({
      ...script,
      count: store.scriptLogs[props.projectId]?.[script.id]?.length || 0,
    }))
    .filter((script) => script.count > 0 && script.count > (closedAt.value[script.id] ?? -1)),
);
const projectLogs = computed(() =>
  selectedScriptId.value ? store.scriptLogs[props.projectId]?.[selectedScriptId.value] || [] : [],
);
const filteredLogs = computed(() => {
  const normalized = query.value.trim().toLowerCase();
  if (!normalized) {
    return projectLogs.value;
  }

  return projectLogs.value.filter((log) => log.message.toLowerCase().includes(normalized));
});

const scrollToTop = async () => {
  await nextTick();
  if (scrollRef.value) {
    scrollToBoundary(scrollRef.value, "top");
    shouldFollowLogs.value = false;
  }
};

const scrollToBottom = async () => {
  await nextTick();
  if (scrollRef.value) {
    scrollToBoundary(scrollRef.value, "bottom");
    shouldFollowLogs.value = true;
  }
};

const handleLogScroll = () => {
  if (scrollRef.value) {
    shouldFollowLogs.value = isNearBottom(scrollRef.value);
  }
};

const handleLogWheel = (event: WheelEvent) => {
  transferWheelAtScrollBoundary(event, scrollRef.value);
};

const closeTarget = (scriptId: string) => {
  closedAt.value = {
    ...closedAt.value,
    [scriptId]: store.scriptLogs[props.projectId]?.[scriptId]?.length || 0,
  };
};

const handleClear = () => {
  store.clearLogs(props.projectId);
  closedAt.value = {};
  selectedScriptId.value = "";
};

watch(
  () => filteredLogs.value.length,
  () => {
    if (shouldFollowLogs.value) {
      void scrollToBottom();
    }
  },
);
watch(selectedScriptId, () => {
  void scrollToBottom();
});
watch(
  logTargets,
  (targets) => {
    if (!targets.some((target) => target.id === selectedScriptId.value)) {
      selectedScriptId.value = targets[0]?.id || "";
    }
  },
  { immediate: true },
);
onMounted(() => {
  void scrollToBottom();
});
</script>

<template>
  <div
    class="border border-border-subtle rounded-lg overflow-hidden flex flex-col h-[26rem] min-h-[22rem] max-h-[52vh] bg-surface shadow-sm"
  >
    <div
      class="bg-surface-container-low px-3 py-2 flex items-center justify-between border-b border-border-subtle gap-3"
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <div class="flex items-center gap-2 min-w-0 shrink-0">
          <TerminalIcon :size="14" class="text-on-surface-variant" />
          <span class="text-xs font-semibold text-on-surface">{{ t.terminal.title }}</span>
        </div>
        <div class="h-4 w-px bg-border-subtle" />
        <div class="flex items-center gap-1 overflow-x-auto min-w-0">
          <div
            v-for="target in logTargets"
            :key="target.id"
            :class="
              cn(
                'h-6 rounded text-[10px] font-semibold whitespace-nowrap border transition-colors flex items-center overflow-hidden',
                selectedScriptId === target.id
                  ? 'bg-primary text-on-primary border-primary'
                  : 'bg-surface text-on-surface-variant border-border-subtle hover:bg-surface-variant',
              )
            "
          >
            <button
              @click="selectedScriptId = target.id"
              class="h-full pl-2 pr-1 flex items-center gap-1.5 min-w-0"
              :title="target.name"
            >
              <span
                :class="[
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  target.status === 'RUNNING'
                    ? 'bg-status-running'
                    : target.status === 'ERROR'
                      ? 'bg-status-error'
                      : 'bg-status-stopped',
                ]"
              />
              <span class="max-w-28 truncate">{{ target.name }}</span>
              <span class="text-[9px] opacity-70">{{ target.count }}</span>
            </button>
            <button
              @click="closeTarget(target.id)"
              class="h-full px-1.5 hover:bg-on-surface/10"
              :title="t.common.close"
            >
              <X :size="10" />
            </button>
          </div>
        </div>
        <button
          @click="scrollToTop"
          class="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-variant transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="filteredLogs.length === 0"
          :title="t.terminal.scrollToTop"
          :aria-label="t.terminal.scrollToTop"
        >
          <ArrowUpToLine :size="12" />
        </button>
        <button
          @click="scrollToBottom"
          class="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-variant transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="filteredLogs.length === 0"
          :title="t.terminal.scrollToBottom"
          :aria-label="t.terminal.scrollToBottom"
        >
          <ArrowDownToLine :size="12" />
        </button>
        <button
          @click="handleClear"
          class="flex items-center gap-1.5 px-2 py-1 text-on-surface-variant hover:text-primary rounded hover:bg-surface-variant transition-colors shrink-0"
          :title="t.terminal.clear"
        >
          <Trash2 :size="12" />
          <span class="text-[10px] font-medium">{{ t.terminal.clear }}</span>
        </button>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <div class="relative">
          <Search :size="12" class="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
          <input
            v-model="query"
            type="text"
            :placeholder="t.terminal.filter"
            class="bg-surface border border-border-subtle rounded px-7 py-1 text-[10px] w-32 focus:outline-none focus:border-primary"
          />
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 bg-surface-container-lowest">
      <div
        ref="scrollRef"
        @scroll="handleLogScroll"
        @wheel="handleLogWheel"
        class="h-full overflow-y-auto p-4 font-mono text-xs leading-relaxed text-on-surface [overscroll-behavior-y:contain]"
      >
        <div v-for="(log, index) in filteredLogs" :key="index" class="flex mb-1 group">
          <span class="w-20 text-right mr-4 shrink-0 text-on-surface-variant/60 select-none">
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
                      ? 'text-tertiary'
                      : 'text-on-surface',
              )
            "
          >
            {{ log.message }}
          </span>
        </div>
        <div v-if="logTargets.length === 0" class="text-on-surface-variant/70 italic">{{ t.terminal.ready }}</div>
        <div v-else-if="filteredLogs.length === 0" class="text-on-surface-variant/70 italic">
          {{ t.terminal.empty }}
        </div>
        <div class="animate-pulse text-primary mt-1">_</div>
      </div>
    </div>
  </div>
</template>
