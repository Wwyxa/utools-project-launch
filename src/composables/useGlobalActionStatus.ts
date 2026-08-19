import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  activeActionStatus,
  showActionProgress,
  type ActionStatus,
  type ActionStatusEntry,
} from "../components/common/actionStatus";
import { gitRemoteProgressOperationId, gitRemoteProgressStage } from "../lib/gitRemoteProgress";
import { useStore } from "../store/useStore";
import type { ProjectGitRemoteProgressEvent } from "../types";

type AppStore = ReturnType<typeof useStore>;

export type GlobalActionStatus = {
  message: string;
  state: ActionStatus["state"];
  entries: readonly ActionStatusEntry[];
};

type ActionStatusSnapshot = {
  operationId?: string;
  isProgress: boolean;
  state: ActionStatus["state"];
  entries: readonly ActionStatusEntry[];
};

export const mergeGitRemoteProgressEntry = (
  entries: readonly ActionStatusEntry[],
  entry: ActionStatusEntry,
  phase: ProjectGitRemoteProgressEvent["phase"],
) => {
  if (phase === "start") {
    return [entry];
  }

  const latestEntry = entries[entries.length - 1];
  if (latestEntry?.stage && latestEntry.stage === entry.stage) {
    return [...entries.slice(0, -1), entry];
  }

  return [...entries, entry].slice(-20);
};

export const isNewProgressOperation = (
  status: ActionStatusSnapshot | null | undefined,
  previousStatus: ActionStatusSnapshot | null | undefined,
) =>
  Boolean(status?.isProgress && status.state === "loading" && status.entries.length > 0) &&
  (!previousStatus?.isProgress ||
    previousStatus.operationId !== status.operationId ||
    previousStatus.state !== "loading" ||
    previousStatus.entries.length === 0);

export const useGlobalActionStatus = (store: AppStore) => {
  const actionStatus = activeActionStatus;
  const isGlobalActionStatusExpanded = ref(false);
  const globalActionStatus = computed<GlobalActionStatus | null>(() => {
    if (actionStatus.value) {
      return actionStatus.value;
    }
    if (Object.values(store.gitRepositoryRefreshing).some(Boolean)) {
      return { message: "正在刷新 Git 快照...", state: "loading", entries: [] };
    }
    if (Object.values(store.gitRepositoryStatusRefreshing).some(Boolean)) {
      return { message: "正在更新 Git 状态...", state: "loading", entries: [] };
    }
    if (Object.values(store.gitRepositoryLoadingMore).some(Boolean)) {
      return { message: "正在加载更多提交...", state: "loading", entries: [] };
    }
    return null;
  });

  const handleGitRemoteProgress = (event: Event) => {
    const progress = (event as CustomEvent<ProjectGitRemoteProgressEvent>).detail;
    if (!progress || progress.type !== "git-remote-progress") return;

    const status = actionStatus.value;
    if (progress.phase === "complete") {
      if (!status?.isProgress || status.operationId !== gitRemoteProgressOperationId || status.state !== "loading") {
        return;
      }
      showActionProgress({
        operationId: gitRemoteProgressOperationId,
        state: "loading",
        message: store.locale === "zh-CN" ? "正在确认远端操作结果..." : "Confirming remote Git result...",
        entries: status.entries,
      });
      return;
    }

    const message = progress.message.trim();
    if (!message) return;

    const entry: ActionStatusEntry = {
      timestamp: new Date().toLocaleTimeString(store.locale, { hour12: false }),
      message,
      stage: progress.phase === "start" ? "start" : gitRemoteProgressStage(message),
    };
    const entries = status?.isProgress && status.operationId === gitRemoteProgressOperationId ? status.entries : [];
    const nextEntries = mergeGitRemoteProgressEntry(entries, entry, progress.phase);
    showActionProgress({
      operationId: gitRemoteProgressOperationId,
      state: "loading",
      message,
      entries: nextEntries,
    });
  };

  watch(
    actionStatus,
    (status, previousStatus) => {
      if (isNewProgressOperation(status, previousStatus)) {
        isGlobalActionStatusExpanded.value = true;
      } else if (!status?.isProgress) {
        isGlobalActionStatusExpanded.value = false;
      }
    },
    { immediate: true },
  );

  onMounted(() => {
    window.addEventListener("git-remote-progress", handleGitRemoteProgress);
  });

  onUnmounted(() => {
    window.removeEventListener("git-remote-progress", handleGitRemoteProgress);
  });

  return { globalActionStatus, isGlobalActionStatusExpanded };
};
