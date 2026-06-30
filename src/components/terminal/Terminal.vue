<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardCopy,
  Eraser,
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
const copiedTerminal = ref(false);
const copiedTimer = ref<number | null>(null);
const contextMenuPosition = ref<{ x: number; y: number } | null>(null);

const logFollowThreshold = 32;
const contextMenuWidth = 176;
const contextMenuHeight = 72;

const isNearBottom = (element: HTMLDivElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight <= logFollowThreshold;

const logTargets = computed(() =>
  (props.scripts || [])
    .map((script) => {
      const logs = store.scriptLogs[props.projectId]?.[script.id];
      return {
        ...script,
        count: logs?.length || 0,
        hasLogBucket: Boolean(logs),
      };
    })
    .filter((script) => {
      const closedLogCount = closedAt.value[script.id];
      const isClosed = closedLogCount !== undefined && script.count <= closedLogCount;
      const isCurrentClearedTerminal =
        script.id === selectedScriptId.value && script.count === 0 && script.hasLogBucket && !isClosed;

      return isCurrentClearedTerminal || (script.count > 0 && !isClosed);
    }),
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
const currentLogText = computed(() => filteredLogs.value.map((log) => `[${log.timestamp}] ${log.message}`).join("\n"));
const copyCurrentLabel = computed(() => (copiedTerminal.value ? t.value.common.copied : t.value.terminal.copyCurrent));
const hasCurrentLogs = computed(() => filteredLogs.value.length > 0);
const hasAnyLogs = computed(() =>
  Object.values(store.scriptLogs[props.projectId] || {}).some((logs) => logs.length > 0),
);
const contextMenuStyle = computed(() => ({
  left: `${contextMenuPosition.value?.x || 0}px`,
  top: `${contextMenuPosition.value?.y || 0}px`,
}));

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

const closeContextMenu = () => {
  contextMenuPosition.value = null;
};

const openContextMenu = (event: MouseEvent) => {
  event.preventDefault();
  const maxX = Math.max(8, window.innerWidth - contextMenuWidth - 8);
  const maxY = Math.max(8, window.innerHeight - contextMenuHeight - 8);
  contextMenuPosition.value = {
    x: Math.min(Math.max(8, event.clientX), maxX),
    y: Math.min(Math.max(8, event.clientY), maxY),
  };
};

const handleWindowKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    closeContextMenu();
  }
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
  closeContextMenu();
};

const handleClearCurrent = () => {
  if (!selectedScriptId.value) {
    return;
  }

  store.clearScriptLogs(props.projectId, selectedScriptId.value);
  closeContextMenu();
};

const handleCopyCurrent = async () => {
  if (!currentLogText.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentLogText.value);
    copiedTerminal.value = true;
    if (copiedTimer.value) {
      window.clearTimeout(copiedTimer.value);
    }
    copiedTimer.value = window.setTimeout(() => {
      copiedTerminal.value = false;
      copiedTimer.value = null;
    }, 1200);
  } catch (error) {
    copiedTerminal.value = false;
  }
  closeContextMenu();
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
  window.addEventListener("click", closeContextMenu);
  window.addEventListener("keydown", handleWindowKeydown);
  void scrollToBottom();
});
onBeforeUnmount(() => {
  window.removeEventListener("click", closeContextMenu);
  window.removeEventListener("keydown", handleWindowKeydown);
  if (copiedTimer.value) {
    window.clearTimeout(copiedTimer.value);
  }
});
</script>

<template>
  <div
    class="h-full min-h-[14rem] border border-border-subtle rounded-lg overflow-hidden flex flex-col bg-surface-container-lowest shadow-sm"
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
                  ? 'bg-primary/10 text-primary border-primary/40'
                  : 'bg-surface text-on-surface-variant border-border-subtle hover:bg-surface-container',
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
          class="p-1 text-on-surface-variant hover:text-status-error rounded hover:bg-surface-variant transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!hasAnyLogs"
          :title="t.terminal.clearAll"
          :aria-label="t.terminal.clearAll"
        >
          <Trash2 :size="12" />
        </button>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <div class="relative">
          <Search :size="12" class="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
          <input
            v-model="query"
            type="text"
            :placeholder="t.terminal.filter"
            class="bg-surface border border-border-subtle rounded px-7 py-1 text-[10px] text-on-surface placeholder:text-on-surface-variant w-32 focus:outline-none focus:border-primary"
          />
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 bg-surface-container-lowest">
      <div
        ref="scrollRef"
        @scroll="handleLogScroll"
        @wheel="handleLogWheel"
        @contextmenu="openContextMenu"
        class="h-full overflow-y-auto p-4 font-mono text-xs leading-relaxed text-on-surface [overscroll-behavior-y:contain]"
      >
        <div v-for="(log, index) in filteredLogs" :key="index" class="flex mb-1 group">
          <span class="w-20 text-right mr-4 shrink-0 text-on-surface-variant/70 select-none">
            {{ log.timestamp }}
          </span>
          <span :class="cn('break-all', resolveLogTone(log.message, log.type))">
            {{ log.message }}
          </span>
        </div>
        <div v-if="logTargets.length === 0" class="text-on-surface-variant italic">
          {{ t.terminal.ready }}
        </div>
        <div v-else-if="filteredLogs.length === 0" class="text-on-surface-variant italic">
          {{ t.terminal.empty }}
        </div>
        <div class="animate-pulse text-primary mt-1">_</div>
      </div>
    </div>
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="contextMenuPosition"
          class="fixed z-50 w-44 overflow-hidden rounded-lg border border-border-subtle bg-surface-container-high py-1 text-xs text-on-surface shadow-lg"
          :style="contextMenuStyle"
          role="menu"
          @click.stop
          @contextmenu.prevent
        >
          <button
            type="button"
            role="menuitem"
            class="flex h-8 w-full items-center gap-2 px-2.5 text-left transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="!hasCurrentLogs"
            @click="handleCopyCurrent"
          >
            <ClipboardCopy :size="13" class="text-on-surface-variant" />
            <span class="min-w-0 truncate">{{ copyCurrentLabel }}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            class="flex h-8 w-full items-center gap-2 px-2.5 text-left transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="!selectedScriptId || projectLogs.length === 0"
            @click="handleClearCurrent"
          >
            <Eraser :size="13" class="text-on-surface-variant" />
            <span class="min-w-0 truncate">{{ t.terminal.clearCurrent }}</span>
          </button>
        </div>
      </Transition>
    </Teleport>
    <form
      class="flex items-center gap-2 border-t border-border-subtle bg-surface-container-low px-3 py-2"
      @submit.prevent="handleInputSubmit"
    >
      <input
        v-model="inputLine"
        type="text"
        :disabled="!canSendInput"
        :placeholder="terminalInputPlaceholder"
        class="min-w-0 flex-1 rounded border border-border-subtle bg-surface px-2 py-1 font-mono text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
      />
      <button
        type="submit"
        :disabled="!canSendInput"
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
        :title="t.terminal.sendInput"
        :aria-label="t.terminal.sendInput"
      >
        <SendHorizontal :size="13" />
      </button>
    </form>
  </div>
</template>
