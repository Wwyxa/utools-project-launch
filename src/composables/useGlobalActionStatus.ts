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
    const latest = entries[entries.length - 1];
    const nextEntries =
      progress.phase === "start"
        ? [entry]
        : latest?.stage === entry.stage
          ? [...entries.slice(0, -1), entry]
          : [...entries, entry].slice(-20);
    showActionProgress({
      operationId: gitRemoteProgressOperationId,
      state: "loading",
      message,
      entries: nextEntries,
    });
  };

  watch(
    () => [actionStatus.value?.id, actionStatus.value?.isProgress, actionStatus.value?.entries.length] as const,
    () => {
      const status = actionStatus.value;
      isGlobalActionStatusExpanded.value = Boolean(status?.isProgress && status.entries.length > 0);
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
