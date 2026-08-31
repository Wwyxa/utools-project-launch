<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardCopy,
  Eraser,
  History,
  Search,
  SendHorizontal,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { getOverlayScrollbarScrollElements } from "../../lib/overlayScrollbar";
import { cn, scrollToBoundary, transferWheelAtScrollBoundary } from "../../lib/utils";
import type { LogEntry, ProjectLaunchServiceLogDescriptor, ProjectScript } from "../../types";
import ActionDialog from "../common/ActionDialog.vue";

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
const historyDialogOpen = ref(false);
const historyLoading = ref(false);
const historyLoadingOlder = ref(false);
const historyError = ref("");
const historyOlderError = ref("");
const historyFeedback = ref("");
const historyFeedbackTone = ref<"success" | "error">("success");
const historyQuery = ref("");
const selectedHistoryRunId = ref("");
const historyRuns = ref<ProjectLaunchServiceLogDescriptor[]>([]);
const historyLogs = ref<LogEntry[]>([]);
const historyTruncated = ref(false);
const historyHasMore = ref(false);
const historyNextOffset = ref(0);
const copiedHistory = ref(false);
const historyClearOpen = ref(false);
const historyClearBusy = ref(false);
let logScrollEventElement: HTMLElement | Document | null = null;
let stopAppEscapeListener = () => {};
let historyLoadGeneration = 0;
let historyCopiedTimer: number | null = null;

const logFollowThreshold = 32;
const contextMenuWidth = 176;
const contextMenuHeight = 72;
const historyStatusKeys = ["starting", "running", "stopping", "stopped", "exited", "failed", "lost"] as const;

const getLogScrollElement = () => getOverlayScrollbarScrollElements(scrollRef.value)?.scrollOffsetElement ?? null;

const isNearBottom = (element: HTMLElement) =>
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
const serviceHistoryRuns = computed(() => historyRuns.value);
const selectedHistoryRun = computed(
  () => serviceHistoryRuns.value.find((run) => run.runId === selectedHistoryRunId.value) || null,
);
const filteredHistoryLogs = computed(() => {
  const normalized = historyQuery.value.trim().toLowerCase();
  if (!normalized) return historyLogs.value;
  return historyLogs.value.filter((log) => log.message.toLowerCase().includes(normalized));
});
const historyLogText = computed(() => historyLogs.value.map((log) => `[${log.timestamp}] ${log.message}`).join("\n"));
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
  const scrollElement = getLogScrollElement();
  if (scrollElement) {
    scrollToBoundary(scrollElement, "top");
    shouldFollowLogs.value = false;
  }
};

const scrollToBottom = async () => {
  await nextTick();
  const scrollElement = getLogScrollElement();
  if (scrollElement) {
    scrollToBoundary(scrollElement, "bottom");
    shouldFollowLogs.value = true;
  }
};

const handleLogScroll = () => {
  const scrollElement = getLogScrollElement();
  if (scrollElement) {
    shouldFollowLogs.value = isNearBottom(scrollElement);
  }
};

const handleLogWheel = (event: WheelEvent) => {
  transferWheelAtScrollBoundary(event, getLogScrollElement());
};

const formatHistoryDate = (value?: string) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "-";
};
const formatHistoryBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
};

const historyRunScriptName = (run: ProjectLaunchServiceLogDescriptor) =>
  props.scripts?.find((script) => script.id === run.scriptId)?.name || run.label || run.scriptId;
const historyRunCommand = (run: ProjectLaunchServiceLogDescriptor) =>
  store.projectLaunchServiceStatus?.runs?.find((candidate) => candidate.id === run.runId)?.command || run.label;

const historyStatusClass = (status: ProjectLaunchServiceLogDescriptor["status"]) => {
  if (status === "failed" || status === "lost") return "border-status-error/30 bg-status-error/10 text-status-error";
  if (status === "exited") return "border-status-running/30 bg-status-running/10 text-status-running";
  if (status === "stopped") return "border-border-subtle bg-surface-container-low text-on-surface-variant";
  return "border-status-warning/30 bg-status-warning/10 text-status-warning";
};

const historyStatusLabel = (status: ProjectLaunchServiceLogDescriptor["status"]) =>
  historyStatusKeys.includes(status) ? t.value.terminal.historyStatus[status] : status;

const closeHistoryDialog = () => {
  historyLoadGeneration += 1;
  historyDialogOpen.value = false;
  selectedHistoryRunId.value = "";
  historyRuns.value = [];
  historyLogs.value = [];
  historyLoadingOlder.value = false;
  historyQuery.value = "";
  historyError.value = "";
  historyOlderError.value = "";
  historyFeedback.value = "";
  historyClearOpen.value = false;
  historyTruncated.value = false;
  historyHasMore.value = false;
  historyNextOffset.value = 0;
  copiedHistory.value = false;
};

const loadHistoryRun = async (run: ProjectLaunchServiceLogDescriptor) => {
  const requestGeneration = historyLoadGeneration + 1;
  historyLoadGeneration = requestGeneration;
  selectedHistoryRunId.value = run.runId;
  historyLoading.value = true;
  historyLoadingOlder.value = false;
  historyError.value = "";
  historyOlderError.value = "";
  historyFeedback.value = "";
  historyLogs.value = [];
  historyTruncated.value = run.truncated;
  historyHasMore.value = false;
  historyNextOffset.value = 0;
  try {
    const result = await store.loadProjectLaunchServiceRunLogPage(run.runId, 0);
    if (requestGeneration !== historyLoadGeneration) return;
    historyLogs.value = result.logs;
    historyTruncated.value = run.truncated || result.truncated;
    historyHasMore.value = result.hasMore === true;
    historyNextOffset.value = result.nextOffset || 0;
  } catch (error) {
    if (requestGeneration !== historyLoadGeneration) return;
    historyError.value = error instanceof Error ? error.message : t.value.terminal.historyUnavailable;
  } finally {
    if (requestGeneration === historyLoadGeneration) historyLoading.value = false;
  }
};

const loadOlderHistory = async () => {
  const run = selectedHistoryRun.value;
  if (!run || !historyHasMore.value || historyLoadingOlder.value) return;
  const requestGeneration = historyLoadGeneration;
  historyLoadingOlder.value = true;
  historyOlderError.value = "";
  try {
    const result = await store.loadProjectLaunchServiceRunLogPage(run.runId, historyNextOffset.value);
    if (requestGeneration !== historyLoadGeneration) return;
    historyLogs.value = [...result.logs, ...historyLogs.value];
    historyTruncated.value = historyTruncated.value || result.truncated;
    historyHasMore.value = result.hasMore === true;
    historyNextOffset.value = result.nextOffset || 0;
  } catch (error) {
    if (requestGeneration !== historyLoadGeneration) return;
    historyOlderError.value = error instanceof Error ? error.message : t.value.terminal.historyUnavailable;
  } finally {
    if (requestGeneration === historyLoadGeneration) historyLoadingOlder.value = false;
  }
};

const openHistoryDialog = async () => {
  const requestGeneration = historyLoadGeneration + 1;
  historyLoadGeneration = requestGeneration;
  historyDialogOpen.value = true;
  historyLoading.value = true;
  historyLoadingOlder.value = false;
  historyError.value = "";
  historyOlderError.value = "";
  historyFeedback.value = "";
  historyRuns.value = [];
  historyLogs.value = [];
  historyTruncated.value = false;
  historyHasMore.value = false;
  historyNextOffset.value = 0;
  try {
    const status = await store.refreshProjectLaunchServiceStatus();
    if (requestGeneration !== historyLoadGeneration) return;
    if (status.state !== "healthy" || !status.running) {
      throw new Error(status.message || t.value.terminal.historyUnavailable);
    }
    historyRuns.value = await store.listProjectLaunchServiceLogs(props.projectId);
    if (requestGeneration !== historyLoadGeneration) return;
    const firstRun = serviceHistoryRuns.value[0];
    if (firstRun) {
      await loadHistoryRun(firstRun);
    } else {
      historyLoading.value = false;
    }
  } catch (error) {
    historyLoading.value = false;
    historyError.value = error instanceof Error ? error.message : t.value.terminal.historyUnavailable;
  }
};

const confirmClearHistory = async () => {
  const run = selectedHistoryRun.value;
  if (!run) return;
  historyLoadGeneration += 1;
  historyLoading.value = false;
  historyLoadingOlder.value = false;
  historyOlderError.value = "";
  historyClearBusy.value = true;
  historyFeedback.value = "";
  historyError.value = "";
  try {
    const result = await store.clearProjectLaunchServiceLogs({
      runId: run.runId,
    });
    historyRuns.value = await store.listProjectLaunchServiceLogs(props.projectId);
    selectedHistoryRunId.value = "";
    historyLogs.value = [];
    historyTruncated.value = false;
    historyHasMore.value = false;
    historyNextOffset.value = 0;
    try {
      await store.refreshProjectLaunchServiceLogRetention();
    } catch {
      // The clear result remains authoritative even if the follow-up usage read fails.
    }
    historyFeedbackTone.value = "success";
    historyFeedback.value = t.value.terminal.historyClearResult.replace(
      "{size}",
      formatHistoryBytes(result.releasedBytes),
    );
    historyClearOpen.value = false;
  } catch (error) {
    historyFeedbackTone.value = "error";
    historyFeedback.value = error instanceof Error ? error.message : t.value.terminal.historyClearError;
  } finally {
    historyClearBusy.value = false;
  }
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

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (historyDialogOpen.value) {
    closeHistoryDialog();
    event.detail.handle();
    return;
  }
  if (contextMenuPosition.value) {
    closeContextMenu();
    event.detail.handle();
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

const handleCopyHistory = async () => {
  if (!historyLogText.value) return;
  try {
    await navigator.clipboard.writeText(historyLogText.value);
    copiedHistory.value = true;
    if (historyCopiedTimer) window.clearTimeout(historyCopiedTimer);
    historyCopiedTimer = window.setTimeout(() => {
      copiedHistory.value = false;
      historyCopiedTimer = null;
    }, 1200);
  } catch (error) {
    copiedHistory.value = false;
  }
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
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
  window.addEventListener("click", closeContextMenu);
  window.addEventListener("keydown", handleWindowKeydown);
  logScrollEventElement = getOverlayScrollbarScrollElements(scrollRef.value)?.scrollEventElement ?? null;
  logScrollEventElement?.addEventListener("scroll", handleLogScroll);
  void scrollToBottom();
});
onBeforeUnmount(() => {
  stopAppEscapeListener();
  window.removeEventListener("click", closeContextMenu);
  window.removeEventListener("keydown", handleWindowKeydown);
  logScrollEventElement?.removeEventListener("scroll", handleLogScroll);
  logScrollEventElement = null;
  if (copiedTimer.value) {
    window.clearTimeout(copiedTimer.value);
  }
  if (historyCopiedTimer) {
    window.clearTimeout(historyCopiedTimer);
  }
});
</script>

<template>
  <div
    class="h-full min-h-[12rem] border border-border-subtle rounded-lg overflow-hidden flex flex-col bg-surface-container-lowest shadow-sm"
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
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
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
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
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
        <button
          v-if="store.projectLaunchServicePreferences.enabled"
          type="button"
          class="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-variant transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="store.projectLaunchServiceStatus?.state !== 'healthy'"
          :title="t.terminal.history"
          :aria-label="t.terminal.history"
          @click="openHistoryDialog"
        >
          <History :size="12" />
        </button>
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
        v-overlay-scrollbar
        @wheel="handleLogWheel"
        @contextmenu="openContextMenu"
        class="themed-scrollbar h-full overflow-y-auto px-0 py-3 font-mono text-xs leading-relaxed text-on-surface [overscroll-behavior-y:contain]"
      >
        <div class="min-w-0 w-full">
          <div
            v-for="(log, index) in filteredLogs"
            :key="index"
            class="group mb-1 grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-x-4"
          >
            <span class="terminal-log-timestamp min-w-0 select-none text-right">
              {{ log.timestamp }}
            </span>
            <span :class="cn('min-w-0 whitespace-pre-wrap break-words', resolveLogTone(log.message, log.type))">
              {{ log.message }}
            </span>
          </div>
          <div v-if="logTargets.length === 0" class="mb-1 grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-x-4">
            <span aria-hidden="true" />
            <span class="text-on-surface-variant italic">{{ t.terminal.ready }}</span>
          </div>
          <div v-else-if="filteredLogs.length === 0" class="mb-1 grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-x-4">
            <span aria-hidden="true" />
            <span class="text-on-surface-variant italic">{{ t.terminal.empty }}</span>
          </div>
          <div class="mt-1 grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-x-4">
            <span aria-hidden="true" />
            <span class="animate-pulse text-primary">_</span>
          </div>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <Transition name="scale">
        <div
          v-if="historyDialogOpen"
          class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/35 p-4 backdrop-blur-sm"
          @click.self="closeHistoryDialog"
        >
          <section
            class="flex h-[min(42rem,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="runtime-log-history-title"
          >
            <header class="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
              <div class="min-w-0">
                <h3 id="runtime-log-history-title" class="text-sm font-bold text-on-surface">
                  {{ t.terminal.history }}
                </h3>
                <p class="mt-0.5 truncate text-[10px] text-on-surface-variant">
                  {{ t.terminal.historyRetention }}
                </p>
              </div>
              <button
                type="button"
                class="rounded-md p-1.5 text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
                :title="t.common.close"
                :aria-label="t.common.close"
                @click="closeHistoryDialog"
              >
                <X :size="16" />
              </button>
            </header>

            <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[15rem_minmax(0,1fr)]">
              <aside
                class="flex min-h-0 max-h-48 flex-col border-b border-border-subtle md:max-h-none md:border-b-0 md:border-r"
              >
                <div
                  class="flex h-9 shrink-0 items-center justify-between border-b border-border-subtle px-3 text-[10px] font-semibold text-on-surface-variant"
                >
                  <span>{{ t.terminal.history }}</span>
                  <span>{{ serviceHistoryRuns.length }}</span>
                </div>
                <div v-overlay-scrollbar class="themed-scrollbar min-h-0 flex-1 overflow-y-auto">
                  <div class="min-w-0 w-full">
                    <button
                      v-for="run in serviceHistoryRuns"
                      :key="run.runId"
                      type="button"
                      :class="
                        cn(
                          'block w-full border-b border-border-subtle px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-variant',
                          selectedHistoryRunId === run.runId && 'bg-primary/10',
                        )
                      "
                      @click="loadHistoryRun(run)"
                    >
                      <span class="flex min-w-0 items-center gap-1.5">
                        <span
                          :class="
                            cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              run.status === 'exited'
                                ? 'bg-status-running'
                                : run.status === 'stopped'
                                  ? 'bg-status-stopped'
                                  : 'bg-status-error',
                            )
                          "
                        />
                        <span class="min-w-0 flex-1 truncate text-xs font-semibold text-on-surface">
                          {{ historyRunScriptName(run) }}
                        </span>
                      </span>
                      <span class="mt-1 flex items-center justify-between gap-2 text-[9px] text-on-surface-variant">
                        <span class="truncate font-mono">{{ formatHistoryDate(run.startedAt) }}</span>
                        <span
                          :class="
                            cn('shrink-0 rounded border px-1 py-0.5 font-semibold', historyStatusClass(run.status))
                          "
                        >
                          {{ historyStatusLabel(run.status) }}
                        </span>
                      </span>
                      <span
                        class="mt-1 block truncate font-mono text-[9px] text-on-surface-variant"
                        :title="historyRunCommand(run)"
                      >
                        {{ historyRunCommand(run) }}
                      </span>
                      <span class="mt-1 flex items-center justify-between gap-2 text-[9px] text-on-surface-variant">
                        <span>{{ t.terminal.historySize }} {{ formatHistoryBytes(run.sizeBytes) }}</span>
                        <span
                          v-if="run.truncated"
                          class="shrink-0 text-status-warning"
                          :title="t.terminal.historyTruncated"
                        >
                          {{ t.terminal.historyOutputTruncated }}
                        </span>
                      </span>
                    </button>
                    <p
                      v-if="!historyLoading && serviceHistoryRuns.length === 0"
                      class="px-3 py-6 text-center text-xs text-on-surface-variant"
                    >
                      {{ t.terminal.historyEmpty }}
                    </p>
                  </div>
                </div>
              </aside>

              <div class="flex min-h-0 flex-col bg-surface-container-lowest">
                <div
                  class="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-3 py-2"
                >
                  <div class="min-w-0">
                    <p class="truncate text-xs font-semibold text-on-surface">
                      {{ selectedHistoryRun ? historyRunScriptName(selectedHistoryRun) : t.terminal.historyEmpty }}
                    </p>
                    <p
                      v-if="selectedHistoryRun"
                      class="mt-0.5 truncate font-mono text-[9px] text-on-surface-variant"
                      :title="historyRunCommand(selectedHistoryRun)"
                    >
                      {{ historyRunCommand(selectedHistoryRun) }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="inline-flex h-7 w-7 items-center justify-center rounded border border-status-error/30 bg-surface text-status-error transition-colors hover:bg-status-error/10 disabled:cursor-not-allowed disabled:opacity-45"
                      :disabled="!selectedHistoryRun || historyClearBusy"
                      :title="t.terminal.historyClear"
                      :aria-label="t.terminal.historyClear"
                      @click="historyClearOpen = true"
                    >
                      <Trash2 :size="13" />
                    </button>
                    <template v-if="selectedHistoryRun">
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                        :disabled="historyLogs.length === 0"
                        :title="copiedHistory ? t.common.copied : t.terminal.historyCopy"
                        :aria-label="copiedHistory ? t.common.copied : t.terminal.historyCopy"
                        @click="handleCopyHistory"
                      >
                        <ClipboardCopy :size="13" />
                      </button>
                      <div class="relative w-36">
                        <Search
                          :size="12"
                          class="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant/60"
                        />
                        <input
                          v-model="historyQuery"
                          type="text"
                          :placeholder="t.terminal.filter"
                          class="h-7 w-full rounded border border-border-subtle bg-surface pl-7 pr-2 text-[10px] text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
                        />
                      </div>
                    </template>
                  </div>
                </div>
                <div
                  v-overlay-scrollbar
                  class="themed-scrollbar min-h-0 flex-1 overflow-y-auto px-0 py-3 font-mono text-xs leading-relaxed"
                >
                  <div class="min-w-0 w-full">
                    <p
                      v-if="historyFeedback"
                      :class="
                        cn(
                          'px-4 pb-2 text-[10px]',
                          historyFeedbackTone === 'error' ? 'text-status-error' : 'text-status-running',
                        )
                      "
                      role="status"
                      aria-live="polite"
                    >
                      {{ historyFeedback }}
                    </p>
                    <p v-if="historyLoading" class="px-4 py-4 text-on-surface-variant">
                      {{ t.terminal.historyLoading }}
                    </p>
                    <p v-else-if="historyError" class="px-4 py-4 text-status-error">
                      {{ historyError }}
                    </p>
                    <template v-else-if="selectedHistoryRun">
                      <div v-if="historyHasMore" class="px-4 pb-2">
                        <button
                          type="button"
                          class="rounded border border-border-subtle bg-surface px-2 py-1 text-[10px] text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                          :disabled="historyLoadingOlder"
                          @click="loadOlderHistory"
                        >
                          {{ historyLoadingOlder ? t.terminal.historyLoadingOlder : t.terminal.historyLoadOlder }}
                        </button>
                        <p v-if="historyOlderError" class="pt-1 text-[10px] text-status-error" role="status">
                          {{ historyOlderError }}
                        </p>
                      </div>
                      <div
                        v-for="(log, index) in filteredHistoryLogs"
                        :key="index"
                        class="mb-1 grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-x-4 px-4"
                      >
                        <span class="terminal-log-timestamp min-w-0 select-none text-right">
                          {{ log.timestamp }}
                        </span>
                        <span
                          :class="cn('min-w-0 whitespace-pre-wrap break-words', resolveLogTone(log.message, log.type))"
                        >
                          {{ log.message }}
                        </span>
                      </div>
                      <p v-if="filteredHistoryLogs.length === 0" class="px-4 py-4 italic text-on-surface-variant">
                        {{ t.terminal.empty }}
                      </p>
                      <p v-if="historyTruncated" class="px-4 pt-2 text-status-warning">
                        {{ t.terminal.historyTruncated }}
                      </p>
                    </template>
                    <p v-else class="px-4 py-4 text-on-surface-variant">
                      {{ t.terminal.historyEmpty }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
    <ActionDialog
      :open="historyClearOpen"
      tone="danger"
      icon="trash"
      :title="t.terminal.historyClearTitle"
      :message="t.terminal.historyClearMessage"
      :primary-label="t.terminal.historyClear"
      :busy="historyClearBusy"
      :busy-label="t.terminal.historyClearBusy"
      :cancel-label="t.common.cancel"
      @cancel="historyClearOpen = false"
      @primary="confirmClearHistory"
    />
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
      class="flex shrink-0 items-center gap-1.5 border-t border-border-subtle bg-surface-container-low px-2 py-1"
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
