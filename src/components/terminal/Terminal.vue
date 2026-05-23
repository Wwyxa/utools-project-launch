<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Search,
  SendHorizontal,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-vue-next";
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
const inputLine = ref("");
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
const selectedScript = computed(() => (props.scripts || []).find((script) => script.id === selectedScriptId.value));
const canSendInput = computed(() => selectedScript.value?.status === "RUNNING");
const terminalInputPlaceholder = computed(() =>
  canSendInput.value ? t.value.terminal.inputPlaceholder : t.value.terminal.inputDisabled,
);
const filteredLogs = computed(() => {
  const normalized = query.value.trim().toLowerCase();
  if (!normalized) {
    return projectLogs.value;
  }

  return projectLogs.value.filter((log) => log.message.toLowerCase().includes(normalized));
});

const resolveLogTone = (message: string, type: string) => {
  const normalized = message.toLowerCase();
  const trueError =
    !/\b(no errors?|0 errors?|without errors?)\b/.test(normalized) &&
    /\b(error|failed|failure|exception|fatal|panic|traceback|uncaught|denied|not found|eaddrinuse|enoent)\b|exit code [1-9]/.test(
      normalized,
    );
  const readyOutput =
    /\b(ready|listening|started|compiled|served|local:|network:|vite|webpack|next|nuxt|dev server|watching|hmr)\b/.test(
      normalized,
    );

  if (trueError || (type === "ERROR" && !readyOutput)) {
    return "text-status-error";
  }
  if (type === "WARN" || /\b(warn|warning|deprecated)\b/.test(normalized)) {
    return "text-status-warning";
  }
  if (type === "SUCCESS" || readyOutput || /\b(success|done)\b/.test(normalized)) {
    return "text-status-running";
  }
  if (type === "INFO" || /\b(info)\b/.test(normalized)) {
    return "text-status-info";
  }
  return "text-on-surface-variant";
};

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

const handleInputSubmit = async () => {
  if (!canSendInput.value || !selectedScriptId.value) {
    return;
  }

  const result = await store.sendScriptInput(props.projectId, selectedScriptId.value, inputLine.value);
  if (result.sent) {
    inputLine.value = "";
  }
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
    class="h-full min-h-[14rem] border border-border-subtle rounded-lg overflow-hidden flex flex-col bg-surface-container-lowest shadow-sm dark:border-slate-700/80 dark:bg-[#0d1117] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_16px_40px_rgba(0,0,0,0.18)]"
  >
    <div
      class="bg-surface-container-low px-3 py-2 flex items-center justify-between border-b border-border-subtle gap-3 dark:border-slate-700/80 dark:bg-[#111820]"
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <div class="flex items-center gap-2 min-w-0 shrink-0">
          <TerminalIcon :size="14" class="text-on-surface-variant dark:text-slate-400" />
          <span class="text-xs font-semibold text-on-surface dark:text-slate-100">{{ t.terminal.title }}</span>
        </div>
        <div class="h-4 w-px bg-border-subtle dark:bg-slate-700" />
        <div class="flex items-center gap-1 overflow-x-auto min-w-0">
          <div
            v-for="target in logTargets"
            :key="target.id"
            :class="
              cn(
                'h-6 rounded text-[10px] font-semibold whitespace-nowrap border transition-colors flex items-center overflow-hidden',
                selectedScriptId === target.id
                  ? 'bg-primary/10 text-primary border-primary/40 dark:bg-emerald-400/15 dark:text-emerald-100 dark:border-emerald-400/50'
                  : 'bg-surface text-on-surface-variant border-border-subtle hover:bg-surface-container dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800',
              )
            "
          >
            <button
              @click="selectedScriptId = target.id"
              class="h-full pl-2 pr-1 flex items-center gap-1.5 min-w-0"
              :title="target.name"
              :aria-label="target.name"
            >
              <span
                :class="[
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  target.status === 'RUNNING'
                    ? 'bg-status-running animate-pulse shadow-[0_0_8px_rgba(46,175,125,0.9)]'
                    : target.status === 'STOPPING'
                      ? 'bg-status-warning animate-pulse'
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
              :aria-label="t.common.close"
            >
              <X :size="10" />
            </button>
          </div>
        </div>
        <button
          @click="scrollToTop"
          class="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-variant transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
          :disabled="filteredLogs.length === 0"
          :title="t.terminal.scrollToTop"
          :aria-label="t.terminal.scrollToTop"
        >
          <ArrowUpToLine :size="12" />
        </button>
        <button
          @click="scrollToBottom"
          class="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-variant transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
          :disabled="filteredLogs.length === 0"
          :title="t.terminal.scrollToBottom"
          :aria-label="t.terminal.scrollToBottom"
        >
          <ArrowDownToLine :size="12" />
        </button>
        <button
          @click="handleClear"
          class="flex items-center gap-1.5 px-2 py-1 text-on-surface-variant hover:text-primary rounded hover:bg-surface-variant transition-colors shrink-0 dark:text-slate-400 dark:hover:text-emerald-200 dark:hover:bg-slate-800"
          :title="t.terminal.clear"
          :aria-label="t.terminal.clear"
        >
          <Trash2 :size="12" />
          <span class="text-[10px] font-medium">{{ t.terminal.clear }}</span>
        </button>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <div class="relative">
          <Search
            :size="12"
            class="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant/60 dark:text-slate-500"
          />
          <input
            v-model="query"
            type="text"
            :placeholder="t.terminal.filter"
            class="bg-surface border border-border-subtle rounded px-7 py-1 text-[10px] text-on-surface placeholder:text-on-surface-variant w-32 focus:outline-none focus:border-primary dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-400"
          />
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 bg-surface-container-lowest dark:bg-[#0d1117]">
      <div
        ref="scrollRef"
        @scroll="handleLogScroll"
        @wheel="handleLogWheel"
        class="h-full overflow-y-auto p-4 font-mono text-xs leading-relaxed text-on-surface dark:text-slate-300 [overscroll-behavior-y:contain]"
      >
        <div v-for="(log, index) in filteredLogs" :key="index" class="flex mb-1 group">
          <span class="w-20 text-right mr-4 shrink-0 text-on-surface-variant/70 select-none dark:text-slate-500">
            {{ log.timestamp }}
          </span>
          <span :class="cn('break-all', resolveLogTone(log.message, log.type))">
            {{ log.message }}
          </span>
        </div>
        <div v-if="logTargets.length === 0" class="text-on-surface-variant italic dark:text-slate-500">
          {{ t.terminal.ready }}
        </div>
        <div v-else-if="filteredLogs.length === 0" class="text-on-surface-variant italic dark:text-slate-500">
          {{ t.terminal.empty }}
        </div>
        <div class="animate-pulse text-primary dark:text-emerald-300 mt-1">_</div>
      </div>
    </div>
    <form
      class="flex items-center gap-2 border-t border-border-subtle bg-surface-container-low px-3 py-2 dark:border-slate-700/80 dark:bg-[#111820]"
      @submit.prevent="handleInputSubmit"
    >
      <input
        v-model="inputLine"
        type="text"
        :disabled="!canSendInput"
        :placeholder="terminalInputPlaceholder"
        class="min-w-0 flex-1 rounded border border-border-subtle bg-surface px-2 py-1 font-mono text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-55 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-400"
      />
      <button
        type="submit"
        :disabled="!canSendInput"
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 dark:hover:border-emerald-400/60 dark:hover:text-emerald-200"
        :title="t.terminal.sendInput"
        :aria-label="t.terminal.sendInput"
      >
        <SendHorizontal :size="13" />
      </button>
    </form>
  </div>
</template>
