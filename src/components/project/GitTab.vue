<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  CircleAlert,
  CircleCheck,
  ClipboardCopy,
  FileSearch,
  GitBranch,
  UserCircle,
  Clock3,
  RefreshCw,
  X,
  Sparkles,
  Filter,
  SlidersHorizontal,
  WandSparkles,
  ChevronDown,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  GitCommitHorizontal,
  Minus,
  Plus,
  Undo,
} from "lucide-vue-next";
import {
  AI_COMMIT_MESSAGE_MODE_ID,
  DEFAULT_AI_COMMIT_MESSAGE_PROMPT,
  Project,
  type ProjectGitActionResult,
  type ProjectGitCommitSummary,
  type ProjectGitFileChange,
  type ProjectGitFileDiffResult,
} from "../../types";
import AiReasoningResult from "./AiReasoningResult.vue";
import {
  aiReasoningCopyText,
  aiReasoningStateFromResult,
  appendAiStreamChunk,
  createAiReasoningStreamState,
  hasAiReasoningDisplay,
} from "../../lib/aiReasoning";
import { cn, scrollToBoundary, transferWheelAtScrollBoundary } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { renderMarkdown } from "../../lib/markdown";

type AiState = "idle" | "loading" | "success" | "warning" | "error";
type GitActionState = "idle" | "loading" | "success" | "warning" | "error";
type GitFileActionName = "stage" | "unstage" | "discard";
type ActiveGitFileAction = { action: GitFileActionName; path: string };
type CommitTooltipState = { commit: ProjectGitCommitSummary; x: number; y: number };
type AppDialogKind = "danger" | "warning";
type AppActionDialog = {
  kind?: AppDialogKind;
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
};

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  (e: "open-file", relativePath: string): void;
}>();

const store = useStore();
const t = useI18n();
const filesScrollRef = ref<HTMLDivElement | null>(null);
const graphScrollRef = ref<HTMLDivElement | null>(null);
const showCommitFilters = ref(false);
const isAiDialogOpen = ref(false);
const aiMode = ref("summary");
const isAiModeMenuOpen = ref(false);
const aiDialogIncludeDiffContext = ref(true);
const aiDialogResult = ref(createAiReasoningStreamState());
const aiDialogMessage = ref("");
const aiDialogState = ref<AiState>("idle");
const commitAiMode = ref("summary");
const isCommitAiModeMenuOpen = ref(false);
const commitAiIncludeDiffContext = ref(true);
const commitAiResult = ref(createAiReasoningStreamState());
const commitAiMessage = ref("");
const commitAiState = ref<AiState>("idle");
const openDatePickerKind = ref<"since" | "until" | null>(null);
const datePickerMonth = ref(new Date());
const isBranchMenuOpen = ref(false);
const gitActionMessage = ref("");
const gitActionState = ref<GitActionState>("idle");
const activeGitAction = ref("");
const activeGitFileActions = ref<ActiveGitFileAction[]>([]);
const bulkActionProgress = ref({ current: 0, total: 0 });
const selectedGitFilePath = ref("");
const commitMessage = ref("");
const commitMessageTextareaRef = ref<HTMLTextAreaElement | null>(null);
const commitMessageAiResult = ref(createAiReasoningStreamState());
const commitMessageAiState = ref<AiState>("idle");
const confirmationDialog = ref<AppActionDialog | null>(null);
const isConfirmationRunning = ref(false);
const commitMessageTextareaMinHeight = 60;
const commitMessageTextareaMaxHeight = 124;

const resizeCommitMessageTextarea = () => {
  const textarea = commitMessageTextareaRef.value;
  if (!textarea) return;

  textarea.style.height = "auto";
  const nextHeight = Math.min(
    commitMessageTextareaMaxHeight,
    Math.max(commitMessageTextareaMinHeight, textarea.scrollHeight),
  );
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > commitMessageTextareaMaxHeight ? "auto" : "hidden";
};

const scheduleCommitMessageTextareaResize = () => {
  void nextTick(resizeCommitMessageTextarea);
};

const canStageFile = (file: ProjectGitFileChange) => file.unstaged || (!file.staged && file.unstaged !== false);
const canUnstageFile = (file: ProjectGitFileChange) => Boolean(file.staged);
const rowPrimaryGitFileAction = (file: ProjectGitFileChange): Exclude<GitFileActionName, "discard"> | null => {
  if (canStageFile(file)) return "stage";
  if (canUnstageFile(file)) return "unstage";
  return null;
};

const files = computed(() => store.stagedFiles[props.project.id] || props.project.git?.files || []);
const stageableFiles = computed(() => files.value.filter(canStageFile));
const unstageableFiles = computed(() => files.value.filter(canUnstageFile));
const discardableFiles = computed(() => files.value);
const stagedFiles = computed(() => files.value.filter((file) => file.staged));
const hasStagedChanges = computed(() => stagedFiles.value.length > 0);
const hasUncommittedChanges = computed(() => files.value.length > 0);
const bulkPrimaryGitFileAction = computed<Exclude<GitFileActionName, "discard"> | null>(() => {
  if (stageableFiles.value.length > 0) return "stage";
  if (unstageableFiles.value.length > 0) return "unstage";
  return null;
});
const bulkSecondaryGitFileAction = computed<Exclude<GitFileActionName, "discard"> | null>(() =>
  stageableFiles.value.length > 0 && unstageableFiles.value.length > 0 ? "unstage" : null,
);
const branchOptions = computed(() => {
  const branches = snapshot.value?.branches || [];
  if (branches.length > 0) return branches;
  return [{ name: snapshot.value?.branch || props.project.branch || "main", current: true }];
});
const currentGitRefLabel = computed(() => {
  if (snapshot.value?.isDetachedHead) {
    return snapshot.value.headHash ? `HEAD @ ${snapshot.value.headHash}` : "detached HEAD";
  }
  return snapshot.value?.branch || props.project.branch || "main";
});
const commitKeyword = ref("");
const commitAuthor = ref("");
const commitSince = ref("");
const commitUntil = ref("");
const selectedCommitHashes = ref<string[]>([]);
const selectedCommitHash = ref("");
const selectedCommit = computed(() => commits.value.find((commit) => commit.hash === selectedCommitHash.value));
const selectedCommitFiles = ref<ProjectGitFileChange[]>([]);
const isLoadingCommitFiles = ref(false);
const commits = computed(() => {
  const source = props.project.git?.commits || [];
  const keyword = commitKeyword.value.trim().toLowerCase();
  const author = commitAuthor.value.trim().toLowerCase();
  const since = commitSince.value ? new Date(commitSince.value).getTime() : 0;
  const until = commitUntil.value ? new Date(commitUntil.value).getTime() : Number.POSITIVE_INFINITY;

  return source.filter((commit) => {
    const commitTime = new Date(commit.date).getTime();
    if (Number.isFinite(since) && since > 0 && commitTime < since) return false;
    if (Number.isFinite(until) && until < Number.POSITIVE_INFINITY && commitTime > until + 24 * 60 * 60 * 1000)
      return false;
    if (author && !commit.author.toLowerCase().includes(author)) return false;
    if (keyword) {
      const body = commit.body || "";
      const searchable = `${commit.hash} ${commit.message} ${body} ${commit.refs || ""}`.toLowerCase();
      if (!searchable.includes(keyword)) return false;
    }
    return true;
  });
});
const snapshot = computed(() => props.project.git);
const isGitSnapshotRefreshing = computed(() => Boolean(store.gitRefreshing[props.project.id]));
const isGitStatusRefreshing = computed(() => Boolean(store.gitStatusRefreshing[props.project.id]));
const isGitRefreshing = computed(() => isGitSnapshotRefreshing.value || isGitStatusRefreshing.value);
const gitRefreshLabel = computed(() => (isGitRefreshing.value ? "正在刷新 Git 状态" : t.value.git.refresh));

// 全局统一 Loading 状态栏
const globalLoadingMessage = computed(() => {
  // AI 生成提交信息
  if (commitMessageAiState.value === "loading") {
    return "正在生成 commit message...";
  }
  
  // Git 刷新操作
  if (isGitSnapshotRefreshing.value) {
    return "正在刷新 Git 快照...";
  }
  if (isGitStatusRefreshing.value) {
    return "正在更新 Git 状态...";
  }
  
  // 加载更多提交
  if (isLoadingMore.value) {
    return "正在加载更多提交...";
  }
  
  // 批量操作进度
  if (activeGitAction.value && bulkActionProgress.value.total > 0) {
    const action = activeGitAction.value.replace("bulk:", "") as GitFileActionName;
    return gitBulkActionProgressMessage(action, bulkActionProgress.value.current, bulkActionProgress.value.total);
  }
  
  // 其他 Git 操作
  if (gitActionState.value === "loading" && gitActionMessage.value) {
    return gitActionMessage.value;
  }
  
  return "";
});

const showGlobalLoadingBar = computed(() => Boolean(globalLoadingMessage.value));

const repositoryPath = computed(() => snapshot.value?.repositoryPath || props.project.path);
const isLoadingMore = ref(false);
const selectedDiff = ref<ProjectGitFileDiffResult | null>(null);
const isLoadingDiff = ref(false);
const isDiffDialogOpen = ref(false);
const isCommitDetailOpen = ref(false);
const isAiDialogGenerating = computed(() => aiDialogState.value === "loading");
const aiModeOptions = computed(() => store.aiPreferences.modes.filter((mode) => mode.kind !== "commit-message"));
const resolveAiModeId = (modeId: string) =>
  aiModeOptions.value.some((option) => option.id === modeId) ? modeId : aiModeOptions.value[0]?.id || "summary";
const selectedAiMode = computed(
  () => aiModeOptions.value.find((option) => option.id === aiMode.value) || aiModeOptions.value[0],
);
const selectedCommitAiMode = computed(
  () => aiModeOptions.value.find((option) => option.id === commitAiMode.value) || aiModeOptions.value[0],
);
const commitMessageAiMode = computed(
  () =>
    store.aiPreferences.modes.find((mode) => mode.id === AI_COMMIT_MESSAGE_MODE_ID) ||
    store.aiPreferences.modes.find((mode) => mode.kind === "commit-message") ||
    null,
);
const weekDayLabels = ["日", "一", "二", "三", "四", "五", "六"];
const copiedText = ref("");
const copiedTimer = ref<number | undefined>();
const commitTooltip = ref<CommitTooltipState | null>(null);
const pendingCommitTooltip = ref<CommitTooltipState | null>(null);
let commitTooltipTimer: number | undefined;
const commitTooltipStyle = computed(() => {
  if (!commitTooltip.value) {
    return {};
  }

  const viewportWidth = globalThis.window?.innerWidth || 1024;
  const viewportHeight = globalThis.window?.innerHeight || 768;
  const tooltipMaxWidth = Math.min(384, Math.max(240, viewportWidth - 32));
  const tooltipHeight = Math.min(240, Math.max(140, viewportHeight - 64));
  const left = Math.min(Math.max(16, commitTooltip.value.x), Math.max(16, viewportWidth - tooltipMaxWidth - 16));
  const showAbove = commitTooltip.value.y - tooltipHeight - 10 >= 16;
  const top = showAbove
    ? commitTooltip.value.y - 10
    : Math.min(commitTooltip.value.y + 18, Math.max(16, viewportHeight - tooltipHeight - 16));

  return {
    left: `${left}px`,
    top: `${top}px`,
    maxWidth: `${tooltipMaxWidth}px`,
    transform: showAbove ? "translateY(-100%)" : "none",
  };
});

const handleRefresh = async () => {
  if (isGitRefreshing.value) return;
  await store.refreshGitSnapshot(props.project.id);
};

const clearCommitFilters = () => {
  commitKeyword.value = "";
  commitAuthor.value = "";
  commitSince.value = "";
  commitUntil.value = "";
  openDatePickerKind.value = null;
};

const toggleCommitFilters = () => {
  showCommitFilters.value = !showCommitFilters.value;
};

const openAiDialog = () => {
  resetAiDialogState();
  isAiDialogOpen.value = true;
};

const closeAiDialog = () => {
  isAiDialogOpen.value = false;
  isAiModeMenuOpen.value = false;
};

const closeFloatingControls = () => {
  isAiModeMenuOpen.value = false;
  isCommitAiModeMenuOpen.value = false;
  isBranchMenuOpen.value = false;
  openDatePickerKind.value = null;
};

const setGitActionResult = (state: GitActionState, message: string) => {
  gitActionState.value = state;
  gitActionMessage.value = message;
};

const isDirtyGitWriteBlock = (result: ProjectGitActionResult, options: { force?: boolean }) =>
  !options.force && !result.ok && result.message.includes("未提交变更");

const waitForVisualFeedback = async () => {
  await nextTick();
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
};

const closeConfirmationDialog = () => {
  if (isConfirmationRunning.value) return;
  confirmationDialog.value = null;
};

const confirmRiskyAction = async () => {
  const dialog = confirmationDialog.value;
  if (!dialog || isConfirmationRunning.value) return;

  isConfirmationRunning.value = true;
  try {
    await dialog.onConfirm();
    confirmationDialog.value = null;
  } finally {
    isConfirmationRunning.value = false;
  }
};

const gitFileActionLoadingMessage = (action: GitFileActionName) => {
  if (action === "stage") return "正在暂存文件...";
  if (action === "unstage") return "正在取消暂存...";
  return "正在丢弃文件变更...";
};

const gitBulkActionLoadingMessage = (action: GitFileActionName, count: number) => {
  if (action === "stage") return `正在暂存 ${count} 个文件...`;
  if (action === "unstage") return `正在取消暂存 ${count} 个文件...`;
  return `正在丢弃 ${count} 个文件变更...`;
};

const gitBulkActionProgressMessage = (action: GitFileActionName, current: number, total: number) => {
  if (action === "stage") return `正在暂存 ${current}/${total} 个文件...`;
  if (action === "unstage") return `正在取消暂存 ${current}/${total} 个文件...`;
  return `正在丢弃 ${current}/${total} 个文件变更...`;
};

const bulkActionTargetFiles = (action: GitFileActionName) => {
  if (action === "stage") return stageableFiles.value;
  if (action === "unstage") return unstageableFiles.value;
  return discardableFiles.value;
};

const bulkActionTitle = (action: GitFileActionName) => {
  const count = bulkActionTargetFiles(action).length;
  if (action === "stage") return count > 0 ? `暂存全部 ${count} 个可暂存文件` : "没有可暂存的文件";
  if (action === "unstage") return count > 0 ? `取消暂存全部 ${count} 个 staged 文件` : "没有可取消暂存的文件";
  return count > 0 ? `丢弃全部 ${count} 个 changed 文件` : "没有可丢弃的文件变更";
};

const bulkActionAriaLabel = (action: GitFileActionName) => {
  if (action === "stage") return "暂存全部可暂存文件";
  if (action === "unstage") return "取消暂存全部 staged 文件";
  return "丢弃全部 changed 文件";
};

const isBulkGitActionActive = (action: GitFileActionName) => activeGitAction.value === `bulk:${action}`;

const executeBulkGitFileAction = async (action: GitFileActionName) => {
  if (activeGitAction.value || activeGitFileActions.value.length > 0) return;
  const targetFiles = bulkActionTargetFiles(action);
  if (targetFiles.length === 0) {
    setGitActionResult("warning", bulkActionTitle(action));
    return;
  }

  activeGitAction.value = `bulk:${action}`;
  const totalFiles = targetFiles.length;
  bulkActionProgress.value = { current: 0, total: totalFiles };
  
  // 显示初始进度
  setGitActionResult("loading", gitBulkActionProgressMessage(action, 0, totalFiles));
  await waitForVisualFeedback();
  
  // 启动一个进度模拟器（预估时间）
  const progressInterval = setInterval(() => {
    if (bulkActionProgress.value.current < totalFiles - 1) {
      bulkActionProgress.value.current++;
    }
  }, Math.max(50, Math.min(200, 1000 / totalFiles)));
  
  try {
    const paths = targetFiles.map((file) => file.path);
    const result =
      action === "stage"
        ? await store.stageGitFiles(props.project.id, paths)
        : action === "unstage"
          ? await store.unstageGitFiles(props.project.id, paths)
          : await store.discardGitFiles(props.project.id, paths);
    
    clearInterval(progressInterval);
    bulkActionProgress.value.current = totalFiles;
    
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法执行 Git 操作。");
      return;
    }
    
    if (action === "stage" || action === "unstage") {
      setGitActionResult("idle", "");
    } else {
      setGitActionResult(result.ok ? "success" : "error", result.message);
    }
  } catch (error) {
    clearInterval(progressInterval);
    setGitActionResult("error", error instanceof Error ? error.message : "Git 操作失败。");
  } finally {
    activeGitAction.value = "";
    bulkActionProgress.value = { current: 0, total: 0 };
  }
};

const executeGitFileAction = async (action: GitFileActionName, file: ProjectGitFileChange) => {
  if (activeGitAction.value || isGitFileBusy(file)) return;

  activeGitFileActions.value = [...activeGitFileActions.value, { action, path: file.path }];
  setGitActionResult("loading", action === "discard" ? gitFileActionLoadingMessage(action) : "");
  await waitForVisualFeedback();
  try {
    const result =
      action === "stage"
        ? await store.stageGitFile(props.project.id, file.path)
        : action === "unstage"
          ? await store.unstageGitFile(props.project.id, file.path)
          : await store.discardGitFile(props.project.id, file.path);
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法执行 Git 操作。");
      return;
    }
    if (result.ok && (action === "stage" || action === "unstage")) {
      setGitActionResult("idle", "");
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "Git 操作失败。");
  } finally {
    activeGitFileActions.value = activeGitFileActions.value.filter(
      (item) => item.action !== action || item.path !== file.path,
    );
  }
};

const requestDiscardGitFile = (file: ProjectGitFileChange) => {
  if (activeGitAction.value || isGitFileBusy(file)) return;
  confirmationDialog.value = {
    title: "丢弃文件变更",
    message: "此操作会还原该文件在工作区与暂存区中的本地变更。",
    detail: gitFileDisplayPath(file),
    confirmLabel: "丢弃变更",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeGitFileAction("discard", file),
  };
};

const runGitFileAction = async (action: GitFileActionName, file: ProjectGitFileChange) => {
  selectedGitFilePath.value = file.path;
  if (action === "discard") {
    requestDiscardGitFile(file);
    return;
  }
  await executeGitFileAction(action, file);
};

const runPrimaryGitFileAction = async (file: ProjectGitFileChange) => {
  const action = rowPrimaryGitFileAction(file);
  if (!action) return;
  await runGitFileAction(action, file);
};

const requestDiscardAllGitFiles = () => {
  if (activeGitAction.value || activeGitFileActions.value.length > 0 || discardableFiles.value.length === 0) return;
  confirmationDialog.value = {
    title: "丢弃全部文件变更",
    message: `此操作会还原 ${discardableFiles.value.length} 个 changed 文件在工作区与暂存区中的本地变更。`,
    detail: discardableFiles.value.map(gitFileDisplayPath).join("\n"),
    confirmLabel: "丢弃全部",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeBulkGitFileAction("discard"),
  };
};

const handleCommitStaged = async () => {
  if (activeGitAction.value || activeGitFileActions.value.length > 0) return;
  const message = commitMessage.value.trim();
  if (!message) {
    setGitActionResult("warning", "请先填写 commit message。");
    return;
  }
  if (!hasStagedChanges.value) {
    setGitActionResult("warning", "没有 staged 变更可提交。");
    return;
  }

  activeGitAction.value = "commit";
  setGitActionResult("loading", "正在提交 staged 变更...");
  await waitForVisualFeedback();
  try {
    const result = await store.commitGitStaged(props.project.id, message);
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法提交。");
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) {
      commitMessage.value = "";
      scheduleCommitMessageTextareaResize();
      clearCommitSelection();
    }
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "提交失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const executeSwitchBranch = async (branchName: string, options: { force?: boolean } = {}) => {
  if (
    !branchName ||
    branchName === snapshot.value?.branch ||
    activeGitAction.value ||
    activeGitFileActions.value.length > 0
  ) {
    return;
  }

  activeGitAction.value = `branch:${branchName}`;
  setGitActionResult("loading", options.force ? `正在强制切换到 ${branchName}...` : `正在切换到 ${branchName}...`);
  await waitForVisualFeedback();
  try {
    const result = await store.switchGitBranch(props.project.id, branchName, options);
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法切换分支。");
      return;
    }
    if (isDirtyGitWriteBlock(result, options)) {
      setGitActionResult("idle", "");
      requestForceSwitchBranch(branchName);
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) {
      clearCommitSelection();
      selectedCommitHash.value = "";
    }
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "切换分支失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const requestForceSwitchBranch = (branchName: string) => {
  confirmationDialog.value = {
    kind: "danger",
    title: "强制切换分支",
    message: `当前工作区存在未提交变更。强制切换到 ${branchName} 会丢弃这些本地变更。`,
    detail: formatGitFileLines(files.value, ""),
    confirmLabel: "强制切换",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeSwitchBranch(branchName, { force: true }),
  };
};

const handleSwitchBranch = async (branchName: string) => {
  isBranchMenuOpen.value = false;
  if (
    !branchName ||
    branchName === snapshot.value?.branch ||
    activeGitAction.value ||
    activeGitFileActions.value.length > 0
  ) {
    return;
  }
  if (hasUncommittedChanges.value) {
    requestForceSwitchBranch(branchName);
    return;
  }

  await executeSwitchBranch(branchName);
};

const commitHashMatches = (left?: string, right?: string) =>
  Boolean(left && right && (left === right || left.startsWith(right) || right.startsWith(left)));

const isSelectedCommitDetachedHead = computed(() =>
  Boolean(
    snapshot.value?.isDetachedHead &&
    selectedCommit.value &&
    commitHashMatches(selectedCommit.value.hash, snapshot.value.headHash),
  ),
);

const isSelectedCommitCurrentHead = computed(() =>
  Boolean(selectedCommit.value && commitHashMatches(selectedCommit.value.hash, snapshot.value?.headHash)),
);

const selectedCommitLocalBranchNames = computed(() => {
  const localBranches = new Set((snapshot.value?.branches || []).map((branch) => branch.name));
  return selectedCommitRefs.value
    .map((refName) => refName.replace(/^HEAD ->\s*/, "").trim())
    .filter((refName) => localBranches.has(refName));
});
const canCheckoutSelectedCommit = computed(
  () => Boolean(selectedCommit.value) && (!isSelectedCommitDetachedHead.value || selectedCommitLocalBranchNames.value.length > 0),
);
const selectedCommitCheckoutTitle = computed(() => {
  if (isSelectedCommitDetachedHead.value && selectedCommitLocalBranchNames.value.length === 0) {
    return "当前已处于该 detached HEAD 提交";
  }
  if (hasUncommittedChanges.value) {
    return "当前工作区存在未提交变更，点击后打开强制切换确认";
  }
  if (selectedCommitLocalBranchNames.value.length > 0) {
    return `切换到本地分支 ${selectedCommitLocalBranchNames.value[0]}`;
  }
  return "切换到此提交（detached HEAD）";
});
const selectedCommitCheckoutAriaLabel = computed(() => {
  if (isSelectedCommitDetachedHead.value && selectedCommitLocalBranchNames.value.length === 0) {
    return "当前已处于该 detached HEAD 提交";
  }
  if (hasUncommittedChanges.value) {
    return "打开强制切换提交确认";
  }
  return selectedCommitLocalBranchNames.value.length > 0 ? "切换到对应本地分支" : "切换到此提交";
});
const selectedCommitCheckoutLabel = computed(() => {
  if (selectedCommit.value && activeGitAction.value === `checkout:${selectedCommit.value.hash}`) {
    return "切换中";
  }
  if (hasUncommittedChanges.value) {
    return "确认强制切换";
  }
  return selectedCommitLocalBranchNames.value.length > 0 ? "切回分支" : "切换";
});

const executeCheckoutCommit = async (commit: ProjectGitCommitSummary, options: { force?: boolean } = {}) => {
  if (!commit || activeGitAction.value || activeGitFileActions.value.length > 0) return;

  activeGitAction.value = `checkout:${commit.hash}`;
  setGitActionResult("loading", options.force ? `正在强制切换到提交 ${commit.hash}...` : `正在切换到提交 ${commit.hash}...`);
  await waitForVisualFeedback();
  try {
    const result = await store.checkoutGitCommit(props.project.id, commit.hash, options);
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法切换提交。");
      return;
    }
    if (isDirtyGitWriteBlock(result, options)) {
      setGitActionResult("idle", "");
      requestForceCheckoutCommit(commit);
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) {
      clearCommitSelection();
    }
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "切换提交失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const requestForceCheckoutCommit = (commit: ProjectGitCommitSummary) => {
  confirmationDialog.value = {
    kind: "danger",
    title: "强制切换提交",
    message: `当前工作区存在未提交变更。强制切换到 ${commit.hash} 会丢弃这些本地变更；若该提交是本地分支 tip，将切回对应分支，否则进入 detached HEAD。`,
    detail: formatGitFileLines(files.value, ""),
    confirmLabel: "强制切换",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeCheckoutCommit(commit, { force: true }),
  };
};

const handleCheckoutSelectedCommit = async () => {
  const commit = selectedCommit.value;
  if (!commit || activeGitAction.value || activeGitFileActions.value.length > 0) return;
  if (hasUncommittedChanges.value) {
    requestForceCheckoutCommit(commit);
    return;
  }

  await executeCheckoutCommit(commit);
};

const commitMessagePromptTemplate = computed(
  () => commitMessageAiMode.value?.prompt.trim() || DEFAULT_AI_COMMIT_MESSAGE_PROMPT,
);

const renderCommitMessagePrompt = (diffScope: string, diffContent: string, truncated = false) => {
  const template = commitMessagePromptTemplate.value;
  const truncatedNote = truncated ? "- diff 已截断，请基于已有内容保守生成。" : "";
  const includesDiffContent = template.includes("{diffContent}");
  const includesTruncatedNote = template.includes("{truncatedNote}");
  let prompt = template
    .replace(/\{diffScope\}/g, diffScope)
    .replace(/\{diffContent\}/g, diffContent)
    .replace(/\{truncatedNote\}/g, truncatedNote);

  if (!includesDiffContent) {
    prompt = `${prompt.trim()}${truncatedNote && !includesTruncatedNote ? `\n${truncatedNote}` : ""}\n\n${diffScope}:\n${diffContent}`;
  }

  return prompt;
};

const replacePromptPlaceholders = (template: string, placeholders: Record<string, string>) =>
  Object.entries(placeholders).reduce((prompt, [name, value]) => prompt.replaceAll(`{${name}}`, value), template);

const buildCommonGitPromptPlaceholders = () => ({
  repositoryPath: repositoryPath.value,
  branch: currentGitRefLabel.value,
  statusText: snapshot.value?.statusText || t.value.git.noRepo,
  changedFiles: formatGitFileLines(snapshot.value?.files || [], "当前没有工作区文件变更。"),
});

const commonGitContextSection = () =>
  [
    `仓库路径：${repositoryPath.value}`,
    `当前引用：${currentGitRefLabel.value}`,
    `Git 状态：${snapshot.value?.statusText || t.value.git.noRepo}`,
  ].join("\n");

const formatGitFileLines = (sourceFiles: ProjectGitFileChange[], emptyMessage: string) => {
  const lines = sourceFiles
    .map((file) => {
      const stagingState = [file.staged ? "staged" : "", file.unstaged ? "unstaged" : ""].filter(Boolean).join("/");
      const stagingSuffix = stagingState ? `, ${stagingState}` : "";
      return `- ${gitFileDisplayPath(file)} (+${file.additions}/-${file.deletions}, ${fileLabel(file.status)}${stagingSuffix})`;
    })
    .join("\n");

  return lines || emptyMessage;
};

const formatCommitLines = (sourceCommits: ProjectGitCommitSummary[], emptyMessage: string) => {
  const lines = sourceCommits
    .map((commit) => {
      const refs = commit.refs ? `\n  Refs: ${commit.refs}` : "";
      const body = commit.body ? `\n  Body: ${commit.body}` : "";
      return `- ${commit.hash}\n  Date: ${commit.date}\n  Author: ${commit.author}\n  Message: ${commit.message}${refs}${body}`;
    })
    .join("\n");

  return lines || emptyMessage;
};

const gitAiDiffContextMaxChars = 14000;

const buildGitAiDiffContext = async (
  sourceFiles: ProjectGitFileChange[],
  readDiff: (file: ProjectGitFileChange) => Promise<ProjectGitFileDiffResult | null>,
) => {
  if (sourceFiles.length === 0) {
    return { content: "", truncated: false };
  }

  let content = "";
  let truncated = false;
  for (const sourceFile of sourceFiles) {
    const result = await readDiff(sourceFile);
    const diff = result?.diff?.trim();
    if (!diff) {
      continue;
    }

    const nextSection = `${content ? "\n\n" : ""}--- ${gitFileDisplayPath(sourceFile)} ---\n${diff}`;
    if (content.length + nextSection.length > gitAiDiffContextMaxChars) {
      const remainingChars = Math.max(0, gitAiDiffContextMaxChars - content.length);
      if (remainingChars > 0) {
        content += nextSection.slice(0, remainingChars);
      }
      truncated = true;
      break;
    }
    content += nextSection;
  }

  return { content, truncated };
};

const workingTreeDiffContext = () =>
  buildGitAiDiffContext(snapshot.value?.files || [], (file) => store.readGitFileDiff(props.project.id, file.path));

const selectedCommitDiffContext = () => {
  const commitHash = selectedCommit.value?.hash || "";
  if (!commitHash) {
    return Promise.resolve({ content: "", truncated: false });
  }
  return buildGitAiDiffContext(selectedCommitFiles.value, (file) =>
    store.readGitCommitFileDiff(props.project.id, commitHash, file.path),
  );
};

const formatDiffContextSection = (title: string, diffContext: { content: string; truncated: boolean } | null) => {
  if (!diffContext) {
    return "代码 diff：未附加；请基于提交元数据和文件列表分析。";
  }
  if (!diffContext.content.trim()) {
    return "代码 diff：当前没有可附加的 diff 内容。";
  }
  const truncatedNote = diffContext.truncated ? "\n\n（diff 内容已按长度截断，请基于已有内容保守判断。）" : "";
  return `${title}：\n${diffContext.content}${truncatedNote}`;
};

const buildCommitMessagePrompt = async () => {
  const diffResult = await store.readGitCommitMessageDiff(props.project.id);
  if (!diffResult) {
    return { ok: false, prompt: "", message: "当前项目不可用，无法读取 Git diff。" };
  }
  if (!diffResult.ok || !diffResult.diff.trim()) {
    return { ok: false, prompt: "", message: diffResult.message || "当前没有可分析的 Git diff。" };
  }

  const scopeLabel = diffResult.scope === "staged" ? "staged diff" : "working-tree diff";
  return {
    ok: true,
    prompt: renderCommitMessagePrompt(scopeLabel, diffResult.diff, diffResult.truncated),
    message: "已填入提交信息。",
  };
};

const generateCommitMessage = async () => {
  if (commitMessageAiState.value === "loading") return;
  if (!store.aiPreferences.provider) {
    setGitActionResult("warning", t.value.git.aiUnavailable);
    commitMessageAiState.value = "warning";
    return;
  }

  commitMessageAiResult.value = createAiReasoningStreamState();
  commitMessageAiState.value = "loading";
  await waitForVisualFeedback();
  const promptResult = await buildCommitMessagePrompt();
  if (!promptResult.ok) {
    setGitActionResult("warning", promptResult.message);
    commitMessageAiState.value = "warning";
    return;
  }

  await store.analyzeGitWithAiStream(props.project.id, promptResult.prompt, {
    onChunk: (chunk) => {
      commitMessageAiResult.value = appendAiStreamChunk(commitMessageAiResult.value, chunk);
    },
    onDone: (result) => {
      const finalResult = aiReasoningStateFromResult(result);
      if (hasAiReasoningDisplay(finalResult) || !hasAiReasoningDisplay(commitMessageAiResult.value)) {
        commitMessageAiResult.value = finalResult;
      }
      const generated = aiReasoningCopyText(commitMessageAiResult.value).trim();
      if (result.ok && generated) {
        commitMessage.value = generated;
        scheduleCommitMessageTextareaResize();
        commitMessageAiState.value = "success";
        return;
      }
      setGitActionResult("warning", result.ok ? "AI 已返回成功，但没有生成内容。" : result.message || "AI 生成失败。");
      commitMessageAiState.value = result.ok ? "warning" : "error";
    },
  });
};

const isGitActionRunning = computed(() => Boolean(activeGitAction.value));
const isAnyGitWriteRunning = computed(() => Boolean(activeGitAction.value) || activeGitFileActions.value.length > 0);
const isGitFileActionActive = (action: GitFileActionName, file: ProjectGitFileChange) =>
  activeGitFileActions.value.some((item) => item.action === action && item.path === file.path);
const isGitFileBusy = (file: ProjectGitFileChange) =>
  activeGitFileActions.value.some((item) => item.path === file.path);
const canRunFileAction = (file: ProjectGitFileChange | null, action: GitFileActionName) => {
  if (!file || activeGitAction.value || isGitFileBusy(file)) return false;
  if (action === "stage") return canStageFile(file);
  if (action === "unstage") return canUnstageFile(file);
  return true;
};
const selectGitFileForActions = (file: ProjectGitFileChange) => {
  selectedGitFilePath.value = file.path;
};

const selectAiMode = (modeId: string) => {
  aiMode.value = resolveAiModeId(modeId);
  isAiModeMenuOpen.value = false;
};

const selectCommitAiMode = (modeId: string) => {
  commitAiMode.value = resolveAiModeId(modeId);
  isCommitAiModeMenuOpen.value = false;
};

const aiModeLabel = computed(() => selectedAiMode.value?.name || "总结");
const commitAiModeLabel = computed(() => selectedCommitAiMode.value?.name || "总结");
const aiResponseModeHint = computed(() =>
  store.aiPreferences.provider === "utools"
    ? "uTools 内置 AI 流式输出，响应片段实时追加。"
    : "Markdown 渲染，响应片段实时追加。",
);

const parseDateValue = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const datePickerValue = computed(() =>
  openDatePickerKind.value === "since"
    ? commitSince.value
    : openDatePickerKind.value === "until"
      ? commitUntil.value
      : "",
);

const datePickerTitle = computed(() =>
  new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(datePickerMonth.value),
);

const datePickerDays = computed(() => {
  const year = datePickerMonth.value.getFullYear();
  const month = datePickerMonth.value.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(year, month, 1 - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    const value = formatDateValue(date);
    return {
      value,
      label: String(date.getDate()),
      isCurrentMonth: date.getMonth() === month,
      isToday: value === formatDateValue(new Date()),
      isSelected: value === datePickerValue.value,
    };
  });
});

const openDatePicker = (kind: "since" | "until") => {
  const selectedDate = parseDateValue(kind === "since" ? commitSince.value : commitUntil.value);
  datePickerMonth.value = selectedDate || new Date();
  openDatePickerKind.value = openDatePickerKind.value === kind ? null : kind;
};

const shiftDatePickerMonth = (offset: number) => {
  datePickerMonth.value = new Date(datePickerMonth.value.getFullYear(), datePickerMonth.value.getMonth() + offset, 1);
};

const selectDatePickerDay = (value: string) => {
  if (openDatePickerKind.value === "since") {
    commitSince.value = value;
  } else if (openDatePickerKind.value === "until") {
    commitUntil.value = value;
  }
  openDatePickerKind.value = null;
};

const clearDatePickerValue = () => {
  if (openDatePickerKind.value === "since") {
    commitSince.value = "";
  } else if (openDatePickerKind.value === "until") {
    commitUntil.value = "";
  }
};

const activeCommitFilterCount = computed(
  () =>
    [commitKeyword.value.trim(), commitAuthor.value.trim(), commitSince.value, commitUntil.value].filter(Boolean)
      .length,
);

const hasCommitFilters = computed(() => activeCommitFilterCount.value > 0);
const selectedCommitHashSet = computed(() => new Set(selectedCommitHashes.value));
const selectedCommitCount = computed(() => selectedCommitHashes.value.length);
const manuallySelectedCommits = computed(() => {
  const selectedHashes = selectedCommitHashSet.value;
  return (props.project.git?.commits || []).filter((commit) => selectedHashes.has(commit.hash));
});
const aiScopedCommits = computed(() =>
  manuallySelectedCommits.value.length > 0 ? manuallySelectedCommits.value : commits.value,
);
const areAllVisibleCommitsSelected = computed(
  () => commits.value.length > 0 && commits.value.every((commit) => selectedCommitHashSet.value.has(commit.hash)),
);

const isCommitSelected = (hash: string) => selectedCommitHashSet.value.has(hash);

const toggleCommitSelection = (hash: string) => {
  if (isCommitSelected(hash)) {
    selectedCommitHashes.value = selectedCommitHashes.value.filter((selectedHash) => selectedHash !== hash);
    return;
  }
  selectedCommitHashes.value = [...selectedCommitHashes.value, hash];
};

const selectVisibleCommits = () => {
  const selectedHashes = new Set(selectedCommitHashes.value);
  commits.value.forEach((commit) => selectedHashes.add(commit.hash));
  selectedCommitHashes.value = Array.from(selectedHashes);
};

const clearCommitSelection = () => {
  selectedCommitHashes.value = [];
};

const filterStatusSummary = computed(() => {
  if (selectedCommitCount.value > 0) {
    return `已手动选择 ${selectedCommitCount.value} 条提交，AI 将只分析这些提交。`;
  }
  if (activeCommitFilterCount.value === 0) {
    return "当前未启用筛选条件。";
  }
  return `当前已启用 ${activeCommitFilterCount.value} 项筛选，匹配 ${commits.value.length} 条提交。`;
});

const commitScopeContext = computed(() => {
  return {
    commitLines: formatCommitLines(aiScopedCommits.value, "无提交"),
    fileLines: formatGitFileLines(snapshot.value?.files || [], "当前没有工作区文件变更。"),
  };
});

const buildAiPrompt = async () => {
  const template = selectedAiMode.value?.prompt || "请总结这些 Git 信息。";
  const scopeTitle = selectedCommitCount.value > 0 ? "当前手动选择的提交" : "当前筛选后的提交";
  const diffContext = aiDialogIncludeDiffContext.value ? await workingTreeDiffContext() : null;
  const prompt = replacePromptPlaceholders(template, {
    ...buildCommonGitPromptPlaceholders(),
    commits: commitScopeContext.value.commitLines,
  });
  const contextSections = [
    "要求：\n- 必须结合提交时间、commit message、body、refs，以及当前代码变更一起判断。\n- 不要只复述 commit message。\n- 输出面向开发者的结构化内容。",
    `仓库上下文：\n${commonGitContextSection()}`,
    `${scopeTitle}：\n${commitScopeContext.value.commitLines}`,
    `当前工作区变更文件：\n${commitScopeContext.value.fileLines}`,
    formatDiffContextSection("当前工作区代码 diff", diffContext),
  ].filter(Boolean);

  return `${prompt.trim()}\n\n${contextSections.join("\n\n")}`;
};

const resetCommitAiState = () => {
  commitAiResult.value = createAiReasoningStreamState();
  commitAiMessage.value = "";
  commitAiState.value = "idle";
};

const commitAiDisplayResult = computed(() => commitAiResult.value);
const hasCommitAiDisplayResult = computed(() => hasAiReasoningDisplay(commitAiDisplayResult.value));
const commitAiCopyContent = computed(() => aiReasoningCopyText(commitAiDisplayResult.value));
const commitBodyContent = computed(() => selectedCommit.value?.body || selectedCommit.value?.message || "");
const renderedCommitBody = computed(() => renderMarkdown(commitBodyContent.value));

const commitAiPanelHint = computed(() => {
  if (commitAiState.value === "loading") {
    return "";
  }
  if (commitAiMessage.value) {
    return commitAiMessage.value;
  }
  if (commitAiState.value === "error") {
    return "AI 分析失败。";
  }
  if (commitAiState.value === "idle") {
    return "选择模式后点击“生成”。";
  }
  return "";
});

const aiDialogDisplayResult = computed(() => aiDialogResult.value);
const hasAiDialogDisplayResult = computed(() => hasAiReasoningDisplay(aiDialogDisplayResult.value));
const aiDialogCopyContent = computed(() => aiReasoningCopyText(aiDialogDisplayResult.value));

const aiDialogPanelHint = computed(() => {
  if (aiDialogState.value === "loading") {
    return "";
  }
  if (aiDialogMessage.value) {
    return aiDialogMessage.value;
  }
  if (aiDialogState.value === "error") {
    return "AI 分析失败。";
  }
  if (aiDialogState.value === "idle") {
    return "点击“生成”开始。";
  }
  return "";
});

const resetAiDialogState = () => {
  aiDialogResult.value = createAiReasoningStreamState();
  aiDialogMessage.value = "";
  aiDialogState.value = "idle";
};

const generateAiAnalysis = async () => {
  aiDialogResult.value = createAiReasoningStreamState();
  aiDialogMessage.value = "";
  aiDialogState.value = "loading";
  await waitForVisualFeedback();

  const prompt = await buildAiPrompt();
  await store.analyzeGitWithAiStream(props.project.id, prompt, {
    onChunk: (chunk) => {
      aiDialogResult.value = appendAiStreamChunk(aiDialogResult.value, chunk);
    },
    onDone: (result) => {
      const finalResult = aiReasoningStateFromResult(result);
      if (hasAiReasoningDisplay(finalResult) || !hasAiDialogDisplayResult.value) {
        aiDialogResult.value = finalResult;
      }
      aiDialogMessage.value = result.ok ? result.message || "" : result.message || "AI 分析失败。";
      aiDialogState.value = result.ok ? (hasAiDialogDisplayResult.value ? "success" : "warning") : "error";
      if (result.ok && !hasAiDialogDisplayResult.value) {
        aiDialogMessage.value = "AI 已返回成功，但没有生成内容。";
      }
    },
  });
};

const buildCommitAiPrompt = async () => {
  const commit = selectedCommit.value;
  if (!commit) return "";
  const refs = commit.refs ? `\nRefs: ${commit.refs}` : "";
  const body = commit.body ? `\n\nCommit body:\n${commit.body}` : "";
  const fileLines = formatGitFileLines(selectedCommitFiles.value, "该提交暂无可显示的变更文件。");
  const template = selectedCommitAiMode.value?.prompt || "请总结这个 Git 提交。";
  const diffContext = commitAiIncludeDiffContext.value ? await selectedCommitDiffContext() : null;
  const prompt = replacePromptPlaceholders(template, {
    ...buildCommonGitPromptPlaceholders(),
    commitHash: commit.hash,
    commitMessage: commit.message,
    commitBody: commit.body || "",
    commitAuthor: commit.author,
    commitDate: commit.date,
    commitRefs: commit.refs || "",
    commitFiles: fileLines,
  });
  const contextSections = [
    "要求：\n- 结合 commit message、body、refs、作者、时间和该提交的变更文件判断。\n- 不要只复述标题。\n- 输出面向开发者的结构化内容。",
    `仓库上下文：\n${commonGitContextSection()}`,
    `Commit:\nHash: ${commit.hash}\nDate: ${commit.date}\nAuthor: ${commit.author}\nMessage: ${commit.message}${refs}${body}`,
    `该提交变更文件：\n${fileLines}`,
    formatDiffContextSection("该提交代码 diff", diffContext),
  ].filter(Boolean);

  return `${prompt.trim()}\n\n${contextSections.join("\n\n")}`;
};

const generateCommitAiAnalysis = async () => {
  if (!selectedCommit.value) return;
  if (!store.aiPreferences.provider) {
    commitAiMessage.value = t.value.git.aiUnavailable;
    commitAiState.value = "warning";
    return;
  }

  commitAiResult.value = createAiReasoningStreamState();
  commitAiMessage.value = "";
  commitAiState.value = "loading";
  await waitForVisualFeedback();
  const prompt = await buildCommitAiPrompt();
  await store.analyzeGitWithAiStream(props.project.id, prompt, {
    onChunk: (chunk) => {
      commitAiResult.value = appendAiStreamChunk(commitAiResult.value, chunk);
    },
    onDone: (result) => {
      const finalResult = aiReasoningStateFromResult(result);
      if (hasAiReasoningDisplay(finalResult) || !hasCommitAiDisplayResult.value) {
        commitAiResult.value = finalResult;
      }
      commitAiMessage.value = result.ok ? result.message || "" : result.message || "AI 分析失败。";
      commitAiState.value = result.ok ? (hasCommitAiDisplayResult.value ? "success" : "warning") : "error";
      if (result.ok && !hasCommitAiDisplayResult.value) {
        commitAiMessage.value = "AI 已返回成功，但没有生成内容。";
      }
    },
  });
};

const openCommitDetails = async (hash: string) => {
  selectedCommitHash.value = hash;
  resetCommitAiState();
  commitAiMode.value = resolveAiModeId(commitAiMode.value);
  selectedCommitFiles.value = [];
  isCommitDetailOpen.value = true;
  isLoadingCommitFiles.value = true;
  try {
    selectedCommitFiles.value = await store.readGitCommitFiles(props.project.id, hash);
  } finally {
    isLoadingCommitFiles.value = false;
  }
};

const closeCommitDetails = () => {
  isCommitDetailOpen.value = false;
  isCommitAiModeMenuOpen.value = false;
};

const copyText = async (value: string) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    copiedText.value = value;
    window.clearTimeout(copiedTimer.value);
    copiedTimer.value = window.setTimeout(() => {
      if (copiedText.value === value) copiedText.value = "";
    }, 1200);
  } catch (error) {
    copiedText.value = "";
  }
};

const copyLabel = computed(
  () => (value: string) => (copiedText.value === value ? t.value.common.copied : t.value.common.copy),
);

const handleLoadMore = async () => {
  if (isLoadingMore.value || !snapshot.value?.hasMoreCommits) return;
  isLoadingMore.value = true;
  try {
    await store.loadMoreGitCommits(props.project.id);
  } finally {
    isLoadingMore.value = false;
  }
};

const scrollGitPanel = async (target: "files" | "graph", boundary: "top" | "bottom") => {
  await nextTick();
  scrollToBoundary(target === "files" ? filesScrollRef.value : graphScrollRef.value, boundary);
};

const handlePanelWheel = (event: WheelEvent, target: "files" | "graph") => {
  transferWheelAtScrollBoundary(event, target === "files" ? filesScrollRef.value : graphScrollRef.value);
};

const handleOpenFile = (file: ProjectGitFileChange) => {
  if (file.status === "DELETED") return;
  emit("open-file", file.path);
};

const selectAndOpenGitFileDiff = (file: ProjectGitFileChange) => {
  selectGitFileForActions(file);
  void handleViewDiff(file);
};

const handleViewDiff = async (file: ProjectGitFileChange) => {
  isLoadingDiff.value = true;
  isDiffDialogOpen.value = true;
  selectedDiff.value = { path: file.path, diff: "" };
  try {
    selectedDiff.value =
      isCommitDetailOpen.value && selectedCommitHash.value
        ? await store.readGitCommitFileDiff(props.project.id, selectedCommitHash.value, file.path)
        : await store.readGitFileDiff(props.project.id, file.path);
  } finally {
    isLoadingDiff.value = false;
  }
};

const closeDiffDialog = () => {
  isDiffDialogOpen.value = false;
};

const handleEscapeKey = (event: KeyboardEvent) => {
  if (event.key === "Escape" && isDiffDialogOpen.value) {
    closeDiffDialog();
  }
};

const stopWatchingDiffDialog = watch(isDiffDialogOpen, (isOpen) => {
  if (isOpen) {
    window.addEventListener("keydown", handleEscapeKey);
  } else {
    window.removeEventListener("keydown", handleEscapeKey);
  }
});

const showCommitTooltip = (event: MouseEvent, commit: ProjectGitCommitSummary) => {
  window.clearTimeout(commitTooltipTimer);
  pendingCommitTooltip.value = { commit, x: event.clientX, y: event.clientY };
  commitTooltipTimer = window.setTimeout(() => {
    commitTooltip.value = pendingCommitTooltip.value;
  }, 450);
};

const moveCommitTooltip = (event: MouseEvent) => {
  if (pendingCommitTooltip.value) {
    pendingCommitTooltip.value = { ...pendingCommitTooltip.value, x: event.clientX, y: event.clientY };
  }
  if (!commitTooltip.value) return;
  commitTooltip.value = { ...commitTooltip.value, x: event.clientX, y: event.clientY };
};

const hideCommitTooltip = () => {
  window.clearTimeout(commitTooltipTimer);
  pendingCommitTooltip.value = null;
  commitTooltip.value = null;
};

onBeforeUnmount(() => {
  hideCommitTooltip();
  window.clearTimeout(copiedTimer.value);
  stopWatchingDiffDialog();
  window.removeEventListener("keydown", handleEscapeKey);
});

watch(
  () => aiModeOptions.value.map((mode) => mode.id).join("|"),
  () => {
    aiMode.value = resolveAiModeId(aiMode.value);
    commitAiMode.value = resolveAiModeId(commitAiMode.value);
  },
  { immediate: true },
);

watch(
  () => props.project.id,
  () => {
    clearCommitSelection();
    selectedGitFilePath.value = "";
    scheduleCommitMessageTextareaResize();
  },
);

watch(commitMessage, scheduleCommitMessageTextareaResize, { immediate: true });

watch(
  () => files.value.map((file) => file.path).join("|"),
  () => {
    if (!files.value.length) {
      selectedGitFilePath.value = "";
      return;
    }
    if (!files.value.some((file) => file.path === selectedGitFilePath.value)) {
      selectedGitFilePath.value = files.value[0].path;
    }
  },
  { immediate: true },
);

watch(
  () => (props.project.git?.commits || []).map((commit) => commit.hash).join("|"),
  () => {
    const availableHashes = new Set((props.project.git?.commits || []).map((commit) => commit.hash));
    selectedCommitHashes.value = selectedCommitHashes.value.filter((hash) => availableHashes.has(hash));
  },
);

const diffLines = computed(() =>
  (selectedDiff.value?.diff || "").split("\n").map((content, index) => {
    const kind =
      content.startsWith("+++") || content.startsWith("---") || content.startsWith("diff --git")
        ? "meta"
        : content.startsWith("@@")
          ? "hunk"
          : content.startsWith("+")
            ? "add"
            : content.startsWith("-")
              ? "delete"
              : "context";
    return { id: `${index}-${content}`, number: index + 1, content, kind };
  }),
);

const refsForCommit = (refs?: string) =>
  (refs || "")
    .split(",")
    .map((refName) => refName.trim())
    .filter(Boolean);

const selectedCommitRefs = computed(() => refsForCommit(selectedCommit.value?.refs));

const refClass = (refName: string) =>
  cn(
    "max-w-40 truncate rounded border px-1.5 py-px text-[9px] font-bold leading-3",
    refName.startsWith("tag:")
      ? "border-secondary/25 bg-secondary/10 text-secondary"
      : refName.includes("HEAD")
        ? "border-primary/70 bg-primary/10 text-primary"
        : /(?:^|\s|\/)main$/.test(refName)
          ? "border-status-running/35 bg-status-running/10 text-status-running"
          : "border-border-subtle bg-surface-container-low text-on-surface-variant",
  );

const isHeadCommit = (refs?: string) => Boolean(refs?.includes("HEAD"));
const graphStrokeColors = ["#0ea5e9", "#e91e9d", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4", "#f43f5e", "#84cc16"];
const laneWidth = 14;
const graphPaddingX = 5;
const graphRowPaddingX = 4;
const graphRowGapX = 4;
const graphSelectionColumnWidth = 16;
const rowHeight = 30;
const rowGap = 1;
const rowPitch = rowHeight + rowGap;
const dotRadius = 3.9;
const laneCenter = (lane: number) => lane * laneWidth + laneWidth / 2 + graphPaddingX;
const minGraphColumnWidth = 36;
const graphLayerLeft = graphRowPaddingX + graphSelectionColumnWidth + graphRowGapX;

type GitGraphRow = { commit: ProjectGitCommitSummary; lane: number; color: string; y: number };
type GitGraphPath = { id: string; d: string; color: string; opacity: number };
type GitGraphNode = { hash: string; x: number; y: number; color: string; isHead: boolean };
type GitGraphPathMode = "vertical" | "fanOut" | "fanIn";
type GitGraphEdge = {
  sourceHash: string;
  parentHash: string;
  parentIndex: number;
  color: string;
};

const refsIncludeBranch = (refs: string | undefined, branch: string) =>
  refsForCommit(refs).some((refName) => {
    const cleanRef = refName.replace(/^HEAD ->\s*/, "").trim();
    return cleanRef === branch || cleanRef === `origin/${branch}`;
  });

const graphPathData = (sourceX: number, sourceY: number, targetX: number, targetY: number, mode: GitGraphPathMode) => {
  if (sourceX === targetX) {
    return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  }

  const deltaY = targetY - sourceY;
  if (deltaY <= rowPitch) {
    const curveY = Math.max(rowHeight * 0.32, deltaY * 0.45);
    return `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + curveY} ${targetX} ${targetY - curveY} ${targetX} ${targetY}`;
  }

  if (mode === "fanIn") {
    const switchY = Math.max(sourceY, targetY - rowPitch * 0.78);
    const curveY = Math.max(rowHeight * 0.28, (targetY - switchY) * 0.5);
    return `M ${sourceX} ${sourceY} L ${sourceX} ${switchY} C ${sourceX} ${switchY + curveY} ${targetX} ${targetY - curveY} ${targetX} ${targetY}`;
  }

  const switchY = Math.min(targetY, sourceY + rowPitch * 0.78);
  const curveY = Math.max(rowHeight * 0.28, (switchY - sourceY) * 0.5);
  return `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + curveY} ${targetX} ${switchY - curveY} ${targetX} ${switchY} L ${targetX} ${targetY}`;
};

const graphLayout = computed(() => {
  const visibleCommits = commits.value;
  const visibleIndex = new Map(visibleCommits.map((commit, index) => [commit.hash, index]));
  const activeLanes: Array<string | null> = [];
  const laneColors = new Map<number, string>();
  let colorIndex = 0;
  let maxLane = 0;
  const rows: GitGraphRow[] = [];
  const edges: GitGraphEdge[] = [];
  const currentBranch = snapshot.value?.branch || "";

  const nextColor = () => graphStrokeColors[colorIndex++ % graphStrokeColors.length];
  const ensureLaneColor = (lane: number) => {
    if (!laneColors.has(lane)) {
      laneColors.set(lane, nextColor());
    }
    return laneColors.get(lane) || graphStrokeColors[0];
  };
  const setLaneColor = (lane: number, color: string) => {
    laneColors.set(lane, color);
    return color;
  };
  const findLane = (hash: string) => activeLanes.indexOf(hash);
  const allocLane = (color = nextColor(), startLane = 0) => {
    const firstCandidate = Math.max(0, startLane);
    let lane = -1;
    for (let index = firstCandidate; index < activeLanes.length; index += 1) {
      if (activeLanes[index] === null) {
        lane = index;
        break;
      }
    }
    if (lane < 0) {
      lane = Math.max(firstCandidate, activeLanes.length);
      while (activeLanes.length <= lane) {
        activeLanes.push(null);
      }
    }
    setLaneColor(lane, color);
    return lane;
  };

  if (currentBranch) {
    const headCommit = visibleCommits.find((commit) => refsIncludeBranch(commit.refs, currentBranch));
    if (headCommit) {
      activeLanes[0] = headCommit.hash;
      setLaneColor(0, nextColor());
    }
  }

  visibleCommits.forEach((commit, index) => {
    const existingLane = findLane(commit.hash);
    let lane = existingLane;
    if (lane < 0) {
      lane = allocLane();
      activeLanes[lane] = commit.hash;
    }

    const color = ensureLaneColor(lane);
    rows.push({ commit, lane, color, y: index * rowPitch + rowHeight / 2 });
    maxLane = Math.max(maxLane, lane);
    activeLanes[lane] = null;

    (commit.parents || []).forEach((parentHash, parentIndex) => {
      if (!visibleIndex.has(parentHash)) {
        return;
      }

      let parentLane = findLane(parentHash);
      if (parentLane < 0) {
        if (parentIndex === 0 && activeLanes[lane] === null) {
          parentLane = lane;
          activeLanes[parentLane] = parentHash;
          setLaneColor(parentLane, color);
        } else {
          parentLane = allocLane(undefined, parentIndex > 0 ? lane + 1 : 0);
          activeLanes[parentLane] = parentHash;
        }
      } else if (parentIndex === 0 && parentLane > lane && activeLanes[lane] === null) {
        activeLanes[parentLane] = null;
        parentLane = lane;
        activeLanes[parentLane] = parentHash;
        setLaneColor(parentLane, color);
      }

      const parentColor = parentIndex === 0 ? color : ensureLaneColor(parentLane);
      edges.push({
        sourceHash: commit.hash,
        parentHash,
        parentIndex,
        color: parentColor,
      });
      maxLane = Math.max(maxLane, parentLane);
    });

    while (activeLanes.length && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop();
    }
  });

  const rowByHash = new Map(rows.map((row) => [row.commit.hash, row]));
  const paths = edges.flatMap((edge) => {
    const sourceRow = rowByHash.get(edge.sourceHash);
    const parentRow = rowByHash.get(edge.parentHash);
    if (!sourceRow || !parentRow || parentRow.y <= sourceRow.y) {
      return [];
    }

    const sourceX = laneCenter(sourceRow.lane);
    const targetX = laneCenter(parentRow.lane);
    const sourceY = sourceRow.y;
    const targetY = parentRow.y;
    const mode = sourceRow.lane === parentRow.lane ? "vertical" : edge.parentIndex > 0 ? "fanOut" : "fanIn";

    return [
      {
        id: `${edge.sourceHash}-${edge.parentHash}-${edge.parentIndex}`,
        d: graphPathData(sourceX, sourceY, targetX, targetY, mode),
        color: edge.color,
        opacity: edge.parentIndex === 0 ? 0.82 : 0.72,
      },
    ];
  });
  const nodes = rows.map((row) => ({
    hash: row.commit.hash,
    x: laneCenter(row.lane),
    y: row.y,
    color: row.color,
    isHead: isHeadCommit(row.commit.refs),
  }));
  const laneCount = rows.length > 0 ? maxLane + 1 : 1;
  const columnWidth = Math.max(minGraphColumnWidth, laneCount * laneWidth + graphPaddingX * 2);
  const height = rows.length > 0 ? rows.length * rowHeight + Math.max(0, rows.length - 1) * rowGap : 0;

  return { rows, paths, nodes, columnWidth, height };
});

const graphRows = computed(() => graphLayout.value.rows);
const graphPaths = computed(() => graphLayout.value.paths);
const graphNodes = computed(() => graphLayout.value.nodes);
const graphColumnWidth = computed(() => graphLayout.value.columnWidth);
const graphContentHeight = computed(() => graphLayout.value.height);
const graphViewBox = computed(() => `0 0 ${graphColumnWidth.value} ${Math.max(rowHeight, graphContentHeight.value)}`);
const graphLayerStyle = computed(() => ({
  left: `${graphLayerLeft}px`,
  width: `${graphColumnWidth.value}px`,
  height: `${graphContentHeight.value}px`,
}));

const graphRowColumns = computed(
  () => `${graphSelectionColumnWidth}px ${graphColumnWidth.value}px 3.25rem minmax(14rem, 1fr)`,
);
const graphRowMinWidth = computed(() => `max(24rem, calc(${graphColumnWidth.value}px + 18.5rem))`);
const gitGridColumns = "minmax(15rem,0.46fr) minmax(0,1.54fr)";
const commitDateLabel = (value?: string) => formatCommitTime(value).text;

const fileLabel = (status: string) => {
  if (status === "ADDED") return t.value.git.added;
  if (status === "DELETED") return t.value.git.deleted;
  if (status === "RENAMED") return t.value.git.renamed;
  if (status === "UNTRACKED") return t.value.git.untracked;
  return t.value.git.modified;
};

const fileStatusCode = (status: string) => {
  if (status === "ADDED") return "A";
  if (status === "DELETED") return "D";
  if (status === "RENAMED") return "R";
  if (status === "UNTRACKED") return "U";
  return "M";
};

const gitFileDisplayPath = (file: ProjectGitFileChange) =>
  file.originalPath && file.originalPath !== file.path ? `${file.originalPath} -> ${file.path}` : file.path;

const gitFileName = (file: ProjectGitFileChange) => file.path.split(/[\\/]/).filter(Boolean).pop() || file.path;
const gitFileDirectory = (file: ProjectGitFileChange) => {
  const parts = file.path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
};

const formatAbsoluteTime = (value?: string) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
};

const formatRelativeTime = (value?: string) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = Date.now() - date.getTime();
  const absDiff = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;

  if (absDiff < minute) return diffMs >= 0 ? "刚刚" : "即将";
  if (absDiff < hour)
    return diffMs >= 0
      ? `${Math.max(1, Math.round(absDiff / minute))} 分钟前`
      : `${Math.max(1, Math.round(absDiff / minute))} 分钟后`;
  if (absDiff < day)
    return diffMs >= 0
      ? `${Math.max(1, Math.round(absDiff / hour))} 小时前`
      : `${Math.max(1, Math.round(absDiff / hour))} 小时后`;
  if (absDiff < month)
    return diffMs >= 0
      ? `${Math.max(1, Math.round(absDiff / day))} 天前`
      : `${Math.max(1, Math.round(absDiff / day))} 天后`;
  if (absDiff < year)
    return diffMs >= 0
      ? `${Math.max(1, Math.round(absDiff / month))} 个月前`
      : `${Math.max(1, Math.round(absDiff / month))} 个月后`;
  return diffMs >= 0
    ? `${Math.max(1, Math.round(absDiff / year))} 年前`
    : `${Math.max(1, Math.round(absDiff / year))} 年后`;
};

const formatCommitTime = (value?: string) => ({
  text: formatRelativeTime(value),
  title: formatAbsoluteTime(value),
});

const renderCommitMessage = (message: string) => renderMarkdown(message || "");
const unorderedListLinePattern = /^[-*+]\s+/;
const unorderedListItemPattern = /^[-*+]\s+(.+)$/;
const conventionalCommitPrefixPattern =
  "(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test|change)(?:\\([^)]+\\))?!?:\\s+";
const conventionalCommitLinePattern = new RegExp(`^${conventionalCommitPrefixPattern}.+`, "i");
const conventionalCommitSplitPattern = new RegExp(`\\s+(?=${conventionalCommitPrefixPattern})`, "gi");

const normalizeCommitText = (value: string) => value.replace(/\s+/g, " ").trim();

const markdownListItems = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => unorderedListItemPattern.exec(line.trim())?.[1]?.trim() || "")
    .filter(Boolean);

const markdownComparableLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      return unorderedListItemPattern.exec(trimmed)?.[1]?.trim() || trimmed;
    })
    .filter(Boolean);

const conventionalCommitSegments = (value: string) =>
  value
    .split(conventionalCommitSplitPattern)
    .map((part) => part.trim())
    .filter((part) => conventionalCommitLinePattern.test(part));

const commitTooltipUsesFullMarkdown = (commit: ProjectGitCommitSummary) => {
  const message = commit.message.trim();
  const source = (commit.body || message).trim();
  const firstContentLine =
    source
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() || "";
  return unorderedListLinePattern.test(message) && unorderedListLinePattern.test(firstContentLine);
};

const commitTooltipBody = (commit: ProjectGitCommitSummary) => {
  if (commitTooltipUsesFullMarkdown(commit)) {
    return (commit.body || commit.message).trim();
  }

  const body = (commit.body || "").trim();
  const message = commit.message.trim();
  if (!body || body === message) return "";

  const lines = body.split(/\r?\n/);
  const firstLine = lines[0]?.trim() || "";
  if (firstLine && (firstLine === message || message.startsWith(firstLine) || firstLine.startsWith(message))) {
    return lines.slice(1).join("\n").trim();
  }
  return body;
};

const commitTooltipTitle = (commit: ProjectGitCommitSummary) => {
  if (commitTooltipUsesFullMarkdown(commit)) return "";

  const message = commit.message.trim();
  const body = commitTooltipBody(commit);
  const bodyItems = markdownListItems(body).map(normalizeCommitText);
  const messageParts = message
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (messageParts.length > bodyItems.length && bodyItems.length > 0) {
    const tailParts = messageParts.slice(-bodyItems.length).map(normalizeCommitText);
    const tailMatchesBody = bodyItems.every((item, index) => item === tailParts[index]);
    if (tailMatchesBody) {
      return messageParts.slice(0, -bodyItems.length).join(" - ");
    }
  }

  const bodyConventionalLines = markdownComparableLines(body)
    .filter((line) => conventionalCommitLinePattern.test(line))
    .map(normalizeCommitText);
  const messageConventionalSegments = conventionalCommitSegments(message).map(normalizeCommitText);
  if (messageConventionalSegments.length > bodyConventionalLines.length && bodyConventionalLines.length > 0) {
    const tailSegments = messageConventionalSegments.slice(-bodyConventionalLines.length);
    const tailMatchesBody = bodyConventionalLines.every((line, index) => line === tailSegments[index]);
    if (tailMatchesBody) {
      return messageConventionalSegments.slice(0, -bodyConventionalLines.length).join(" ");
    }
  }

  return message;
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden relative" @click="closeFloatingControls">
    <!-- 全局 Loading 提示 - 右下角浮动 Toast -->
    <Transition name="slide-up">
      <div
        v-if="showGlobalLoadingBar"
        class="fixed top-16 right-4 z-50 border border-primary/30 rounded-lg bg-surface shadow-lg px-3 py-2.5 flex items-center gap-2.5 max-w-xs"
      >
        <div class="flex h-4 w-4 items-center justify-center shrink-0">
          <div class="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
        </div>
        <span class="text-xs font-medium text-primary">{{ globalLoadingMessage }}</span>
      </div>
    </Transition>

    <div class="border border-border-subtle rounded-lg bg-surface px-3 py-2 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0 text-xs">
        <GitBranch :size="16" class="text-primary shrink-0" />
        <div class="relative min-w-0" @click.stop>
          <button
            type="button"
            class="flex max-w-48 items-center gap-1 rounded px-1.5 py-1 font-mono font-bold text-on-surface transition-colors hover:bg-surface-variant hover:text-primary"
            :title="t.git.branch"
            :aria-label="t.git.branch"
            @click="isBranchMenuOpen = !isBranchMenuOpen"
          >
            <span class="min-w-0 truncate">{{ currentGitRefLabel }}</span>
            <ChevronDown :size="12" class="shrink-0 text-on-surface-variant" />
          </button>
          <div v-if="isBranchMenuOpen" class="mode-menu-popover min-w-44" @click.stop>
            <button
              v-for="branch in branchOptions"
              :key="branch.name"
              type="button"
              :class="cn('mode-menu-item', branch.current && 'bg-primary/10 text-primary')"
              :title="branch.name"
              @click="handleSwitchBranch(branch.name)"
            >
              <span class="min-w-0 truncate font-mono">{{ branch.name }}</span>
              <Check v-if="branch.current" :size="13" />
            </button>
          </div>
        </div>
        <span
          v-if="snapshot?.isDetachedHead"
          class="shrink-0 rounded-full border border-status-warning/30 bg-status-warning/10 px-2 py-0.5 text-[10px] font-bold text-status-warning"
        >
          detached HEAD
        </span>
        <span class="text-on-surface-variant whitespace-nowrap">
          {{ t.git.ahead }} {{ snapshot?.ahead || 0 }} · {{ t.git.behind }} {{ snapshot?.behind || 0 }}
        </span>
        <span class="text-on-surface-variant truncate">{{ snapshot?.statusText || t.git.noRepo }}</span>
        <span
          v-if="gitActionMessage"
          :class="
            cn(
              'hidden max-w-72 truncate rounded-full border px-2 py-0.5 text-[10px] font-bold lg:inline',
              gitActionState === 'success' && 'border-status-running/30 bg-status-running/10 text-status-running',
              gitActionState === 'warning' && 'border-status-warning/30 bg-status-warning/10 text-status-warning',
              gitActionState === 'error' && 'border-status-error/30 bg-status-error/10 text-status-error',
              (gitActionState === 'idle' || gitActionState === 'loading') &&
                'border-border-subtle bg-surface-container-low text-on-surface-variant',
            )
          "
          :title="gitActionMessage"
        >
          {{ gitActionMessage }}
        </span>
        <span
          v-if="isGitSnapshotRefreshing || isGitStatusRefreshing"
          class="hidden shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary lg:inline"
        >
          {{ isGitSnapshotRefreshing ? "正在刷新" : "正在更新状态" }}
        </span>
        <span class="text-on-surface-variant truncate hidden lg:inline">{{ repositoryPath }}</span>
      </div>
      <div class="flex gap-2 shrink-0">
        <button
          @click="handleRefresh"
          :disabled="isGitRefreshing"
          class="h-8 px-3 rounded border border-border-subtle bg-surface text-on-surface hover:bg-surface-variant text-xs font-bold flex items-center gap-2 transition-colors"
          :title="gitRefreshLabel"
          :aria-label="gitRefreshLabel"
        >
          <RefreshCw :size="14" :class="isGitRefreshing && 'animate-spin'" />
        </button>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 gap-2 overflow-hidden" :style="{ gridTemplateColumns: gitGridColumns }">
      <div
        class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm"
      >
        <div class="border-b border-border-subtle bg-surface px-2 py-1.5">
          <div class="flex min-w-0 items-start gap-1.5">
            <textarea
              ref="commitMessageTextareaRef"
              v-model="commitMessage"
              rows="1"
              class="themed-scrollbar h-[3.75rem] max-h-[7.75rem] min-h-[3.75rem] min-w-0 flex-1 resize-none overflow-hidden rounded border border-transparent bg-surface-container-low px-2 py-1.5 text-xs leading-4 text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/55 focus:border-primary/45 focus:bg-surface"
              placeholder="输入 commit message..."
              @input="resizeCommitMessageTextarea"
            ></textarea>
            <div class="flex shrink-0 flex-col items-center gap-1">
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded border border-border-subtle bg-primary text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
                :disabled="isAnyGitWriteRunning || !hasStagedChanges || !commitMessage.trim()"
                :title="activeGitAction === 'commit' ? '正在提交 staged 变更' : '提交 staged 变更'"
                :aria-label="activeGitAction === 'commit' ? '正在提交 staged 变更' : '提交 staged 变更'"
                @click="handleCommitStaged"
              >
                <GitCommitHorizontal :size="13" :class="activeGitAction === 'commit' ? 'animate-pulse' : ''" />
              </button>
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-wait disabled:opacity-60"
                :disabled="isAnyGitWriteRunning || commitMessageAiState === 'loading'"
                :title="commitMessageAiState === 'loading' ? '正在生成 commit message' : 'AI 生成 commit message'"
                :aria-label="commitMessageAiState === 'loading' ? '正在生成 commit message' : 'AI 生成 commit message'"
                @click="generateCommitMessage"
              >
                <WandSparkles :size="13" :class="commitMessageAiState === 'loading' ? 'animate-pulse' : ''" />
              </button>
            </div>
          </div>
        </div>

        <div
          class="flex h-8 items-center justify-between gap-1 border-b border-border-subtle bg-surface-container-low px-2"
        >
          <div class="flex min-w-0 items-center gap-1.5">
            <h3 class="min-w-0 truncate text-[11px] font-bold text-on-surface">{{ t.git.files }}</h3>
            <span
              v-if="stageableFiles.length > 0"
              class="hidden shrink-0 font-mono text-[10px] font-semibold text-status-warning sm:inline"
              :title="`${stageableFiles.length} 个可暂存文件`"
            >
              W {{ stageableFiles.length }}
            </span>
            <span
              v-if="unstageableFiles.length > 0"
              class="hidden shrink-0 font-mono text-[10px] font-semibold text-primary sm:inline"
              :title="`${unstageableFiles.length} 个 staged 文件`"
            >
              S {{ unstageableFiles.length }}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-px">
            <button
              v-if="bulkPrimaryGitFileAction"
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="isAnyGitWriteRunning"
              :title="bulkActionTitle(bulkPrimaryGitFileAction)"
              :aria-label="bulkActionAriaLabel(bulkPrimaryGitFileAction)"
              @click="executeBulkGitFileAction(bulkPrimaryGitFileAction)"
            >
              <Plus
                v-if="bulkPrimaryGitFileAction === 'stage'"
                :size="13"
                :class="isBulkGitActionActive('stage') ? 'animate-pulse' : ''"
              />
              <Minus v-else :size="13" :class="isBulkGitActionActive('unstage') ? 'animate-pulse' : ''" />
            </button>
            <button
              v-if="bulkSecondaryGitFileAction"
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant/70 transition-colors hover:bg-surface-variant hover:text-secondary disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="isAnyGitWriteRunning"
              :title="bulkActionTitle(bulkSecondaryGitFileAction)"
              :aria-label="bulkActionAriaLabel(bulkSecondaryGitFileAction)"
              @click="executeBulkGitFileAction(bulkSecondaryGitFileAction)"
            >
              <Minus :size="13" :class="isBulkGitActionActive('unstage') ? 'animate-pulse' : ''" />
            </button>
            <button
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-status-error disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="isAnyGitWriteRunning || discardableFiles.length === 0"
              :title="bulkActionTitle('discard')"
              :aria-label="bulkActionAriaLabel('discard')"
              @click="requestDiscardAllGitFiles"
            >
              <Undo :size="13" :class="isBulkGitActionActive('discard') ? 'animate-pulse' : ''" />
            </button>
          </div>
        </div>

        <div
          v-if="files.length > 0"
          ref="filesScrollRef"
          @wheel="handlePanelWheel($event, 'files')"
          class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overscroll-behavior-y:contain]"
        >
          <div
            v-for="(file, idx) in files"
            :key="`${file.path}-${idx}`"
            :class="
              cn(
                'group relative grid min-h-[1.875rem] cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-b border-border-subtle px-2 py-0.5 last:border-b-0 transition-colors hover:bg-surface-container-low focus-within:bg-surface-container-low',
                selectedGitFilePath === file.path && 'bg-primary/5 shadow-[inset_2px_0_0_var(--color-primary)]',
              )
            "
            :title="gitFileDisplayPath(file)"
            @click="selectAndOpenGitFileDiff(file)"
          >
            <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
              <span
                :class="
                  cn(
                    'w-3 shrink-0 text-center font-mono text-[10px] font-black leading-4',
                    file.status === 'ADDED' && 'text-status-running',
                    file.status === 'DELETED' && 'text-status-error',
                    file.status === 'RENAMED' && 'text-secondary',
                    file.status === 'UNTRACKED' && 'text-primary',
                    file.status === 'MODIFIED' && 'text-on-surface-variant',
                  )
                "
                :title="fileLabel(file.status)"
              >
                {{ fileStatusCode(file.status) }}
              </span>
              <div class="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden">
                <span
                  :class="
                    cn(
                      'min-w-0 truncate font-mono text-[11px] font-bold leading-4',
                      file.status === 'DELETED' ? 'text-on-surface-variant line-through' : 'text-on-surface',
                    )
                  "
                >
                  {{ gitFileName(file) }}
                </span>
                <span
                  v-if="gitFileDirectory(file)"
                  class="hidden min-w-0 truncate text-[10px] font-medium leading-4 text-on-surface-variant/65 sm:inline"
                >
                  {{ gitFileDirectory(file) }}
                </span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1 text-[10px] font-bold leading-4">
              <span v-if="file.additions > 0" class="text-status-running">+{{ file.additions }}</span>
              <span v-if="file.deletions > 0" class="text-status-error">-{{ file.deletions }}</span>
              <span v-if="file.staged" class="font-mono text-primary" title="staged" aria-label="staged">S</span>
              <span v-if="file.unstaged" class="font-mono text-status-warning" title="unstaged" aria-label="unstaged"
                >W</span
              >
            </div>
            <div
              :class="
                cn(
                  'absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-px rounded border border-border-subtle bg-surface-container-low px-0.5 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
                  isGitFileBusy(file) && 'opacity-100',
                )
              "
            >
              <button
                v-if="rowPrimaryGitFileAction(file)"
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded text-on-surface-variant/80 transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-wait disabled:opacity-45"
                :disabled="!canRunFileAction(file, rowPrimaryGitFileAction(file) || 'stage')"
                :title="
                  rowPrimaryGitFileAction(file) === 'stage'
                    ? `暂存文件：${gitFileDisplayPath(file)}`
                    : `取消暂存：${gitFileDisplayPath(file)}`
                "
                :aria-label="rowPrimaryGitFileAction(file) === 'stage' ? '暂存文件' : '取消暂存文件'"
                @click.stop="runPrimaryGitFileAction(file)"
              >
                <Plus
                  v-if="rowPrimaryGitFileAction(file) === 'stage'"
                  :size="12"
                  :class="isGitFileActionActive('stage', file) ? 'animate-pulse' : ''"
                />
                <Minus v-else :size="12" :class="isGitFileActionActive('unstage', file) ? 'animate-pulse' : ''" />
              </button>
              <button
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded text-on-surface-variant/80 transition-colors hover:bg-surface-variant hover:text-status-error disabled:cursor-wait disabled:opacity-45"
                :disabled="!canRunFileAction(file, 'discard')"
                :title="`丢弃文件变更：${gitFileDisplayPath(file)}`"
                aria-label="丢弃文件变更"
                @click.stop="runGitFileAction('discard', file)"
              >
                <Undo :size="12" :class="isGitFileActionActive('discard', file) ? 'animate-pulse' : ''" />
              </button>
              <button
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded text-on-surface-variant/80 transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                :disabled="file.status === 'DELETED'"
                :title="file.status === 'DELETED' ? t.git.fileDeleted : t.git.openFile"
                :aria-label="file.status === 'DELETED' ? t.git.fileDeleted : t.git.openFile"
                @click.stop="handleOpenFile(file)"
              >
                <FileSearch :size="12" />
              </button>
            </div>
          </div>
        </div>
        <div v-else class="flex flex-none items-center gap-1.5 px-2 py-1.5 text-[11px] text-on-surface-variant">
          <CircleCheck :size="14" class="shrink-0 text-status-running" />
          <span class="leading-4">{{ t.git.cleanWorkingTree }}</span>
        </div>
      </div>

      <div
        class="bg-surface border border-border-subtle rounded-lg overflow-hidden shadow-sm min-h-0 flex min-w-0 flex-col"
      >
        <div
          class="px-3 py-2 border-b border-border-subtle flex items-center justify-between gap-2 bg-surface-container-low"
        >
          <h3 class="text-sm font-bold text-on-surface">{{ t.git.graph }}</h3>
          <div class="flex items-center gap-1 shrink-0">
            <button
              @click="scrollGitPanel('graph', 'top')"
              class="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-variant transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="commits.length === 0"
              :title="t.git.scrollGraphToTop"
              :aria-label="t.git.scrollGraphToTop"
            >
              <ArrowUpToLine :size="12" />
            </button>
            <button
              @click="scrollGitPanel('graph', 'bottom')"
              class="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-variant transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="commits.length === 0"
              :title="t.git.scrollGraphToBottom"
              :aria-label="t.git.scrollGraphToBottom"
            >
              <ArrowDownToLine :size="12" />
            </button>
          </div>
        </div>
        <div
          ref="graphScrollRef"
          @wheel="handlePanelWheel($event, 'graph')"
          class="themed-scrollbar min-h-0 flex-1 overflow-auto bg-surface-container-lowest p-2 text-on-surface [overscroll-behavior-y:contain]"
        >
          <div class="min-w-full">
            <div
              v-if="graphRows.length > 0"
              class="relative min-w-full overflow-hidden"
              :style="{ minWidth: graphRowMinWidth }"
            >
              <svg
                class="pointer-events-none absolute top-0 z-20 block overflow-hidden"
                :style="graphLayerStyle"
                :viewBox="graphViewBox"
                preserveAspectRatio="xMinYMin meet"
              >
                <path
                  v-for="path in graphPaths"
                  :key="path.id"
                  :d="path.d"
                  :stroke="path.color"
                  :opacity="path.opacity"
                  fill="none"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <circle
                  v-for="node in graphNodes"
                  :key="node.hash"
                  :cx="node.x"
                  :cy="node.y"
                  :r="node.isHead ? dotRadius + 0.9 : dotRadius"
                  :fill="node.isHead ? 'var(--color-surface-container-lowest)' : node.color"
                  :stroke="node.color"
                  :stroke-width="node.isHead ? 2.5 : 1.5"
                />
              </svg>
              <div
                v-for="(row, rowIndex) in graphRows"
                :key="row.commit.hash"
                :class="
                  cn(
                    'group relative z-10 grid min-w-[24rem] cursor-pointer items-center gap-1 rounded px-1.5 text-xs transition-colors hover:bg-surface-container-high',
                    isCommitSelected(row.commit.hash) && 'bg-primary/5 ring-1 ring-primary/20 hover:bg-primary/10',
                    snapshot?.isDetachedHead &&
                      commitHashMatches(row.commit.hash, snapshot?.headHash) &&
                      'bg-status-warning/10 ring-1 ring-status-warning/25',
                  )
                "
                :style="{
                  gridTemplateColumns: graphRowColumns,
                  minWidth: graphRowMinWidth,
                  height: `${rowHeight}px`,
                  marginTop: rowIndex === 0 ? '0' : `${rowGap}px`,
                }"
                @click="openCommitDetails(row.commit.hash)"
              >
                <button
                  type="button"
                  :class="
                    cn(
                      'flex h-4 w-4 items-center justify-center rounded-[4px] border text-on-surface-variant/80 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70 group-hover:border-outline-variant',
                      isCommitSelected(row.commit.hash)
                        ? 'border-primary bg-primary text-on-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-on-primary)_18%,transparent)] hover:bg-primary hover:text-on-primary'
                        : 'border-border-subtle bg-transparent',
                    )
                  "
                  :title="isCommitSelected(row.commit.hash) ? '取消选择该提交' : '选择该提交'"
                  :aria-label="isCommitSelected(row.commit.hash) ? '取消选择该提交' : '选择该提交'"
                  @click.stop="toggleCommitSelection(row.commit.hash)"
                >
                  <Check v-if="isCommitSelected(row.commit.hash)" :size="10" :stroke-width="3" />
                </button>
                <div class="min-w-0 self-stretch" aria-hidden="true"></div>

                <span
                  class="truncate rounded font-mono text-[10px] font-semibold text-on-surface-variant hover:text-primary"
                  :title="row.commit.hash"
                  @click.stop="copyText(row.commit.hash)"
                  >{{ row.commit.hash }}</span
                >
                <div class="min-w-0 overflow-hidden">
                  <div class="flex min-w-0 items-center gap-1.5 leading-4">
                    <span
                      class="min-w-0 truncate text-[11px] font-semibold text-on-surface"
                      @mouseenter="showCommitTooltip($event, row.commit)"
                      @mousemove="moveCommitTooltip"
                      @mouseleave="hideCommitTooltip"
                    >
                      {{ row.commit.message }}
                    </span>
                    <span
                      v-for="refName in refsForCommit(row.commit.refs)"
                      :key="`${row.commit.hash}-${refName}`"
                      :class="refClass(refName)"
                      :title="refName"
                    >
                      {{ refName }}
                    </span>
                    <span
                      v-if="snapshot?.isDetachedHead && commitHashMatches(row.commit.hash, snapshot?.headHash)"
                      class="shrink-0 rounded border border-status-warning/30 bg-status-warning/10 px-1.5 py-px text-[9px] font-bold leading-3 text-status-warning"
                    >
                      HEAD
                    </span>
                  </div>
                  <div class="mt-px truncate text-[9px] leading-3 text-on-surface-variant/75">
                    {{ row.commit.author }} · {{ formatCommitTime(row.commit.date).text }}
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-on-surface-variant p-3">{{ t.git.empty }}</div>
            <button
              v-if="snapshot?.hasMoreCommits"
              type="button"
              class="mx-auto my-3 flex h-8 items-center rounded border border-border-subtle bg-surface px-3 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-wait disabled:opacity-60"
              :disabled="isLoadingMore"
              @click="handleLoadMore"
            >
              {{ isLoadingMore ? t.git.loadingMore : t.git.loadMore }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <section class="rounded-lg border border-border-subtle bg-surface px-3 py-2 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Filter :size="14" class="text-primary" />
          <h3 class="text-xs font-bold text-on-surface">{{ t.git.filters }}</h3>
          <span
            v-if="selectedCommitCount > 0"
            class="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary"
          >
            已选 {{ selectedCommitCount }}
          </span>
          <span
            v-if="hasCommitFilters"
            class="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary"
          >
            {{ commits.length }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-transparent px-2.5 py-1.5 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="commits.length === 0 || areAllVisibleCommitsSelected"
            @click="selectVisibleCommits"
          >
            <Check :size="13" />
            全选可见
          </button>
          <button
            v-if="selectedCommitCount > 0"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-transparent px-2.5 py-1.5 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
            @click="clearCommitSelection"
          >
            <X :size="13" />
            清空选择
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-transparent px-2.5 py-1.5 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
            @click="toggleCommitFilters"
          >
            <SlidersHorizontal :size="13" />
            {{ showCommitFilters ? t.common.close : "筛选" }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-primary px-3 py-1.5 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90"
            :disabled="!store.aiPreferences.model && store.aiPreferences.provider === 'utools'"
            @click="openAiDialog"
          >
            <WandSparkles :size="13" />
            AI生成
          </button>
        </div>
      </div>
      <Transition name="fade">
        <div v-if="showCommitFilters" class="mt-3">
          <div
            class="grid gap-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(8.5rem,0.75fr)_minmax(8.5rem,0.75fr)_2.25rem]"
          >
            <input v-model="commitKeyword" type="text" class="ui-field" :placeholder="t.git.keyword" />
            <input v-model="commitAuthor" type="text" class="ui-field" :placeholder="t.git.author" />
            <div class="relative">
              <button
                type="button"
                class="ui-field flex w-full items-center justify-between gap-2 text-left"
                @click.stop="openDatePicker('since')"
              >
                <span :class="commitSince ? 'text-on-surface' : 'text-on-surface-variant/70'">
                  {{ commitSince || t.git.since }}
                </span>
                <CalendarDays :size="14" class="text-on-surface-variant" />
              </button>
              <div
                v-if="openDatePickerKind === 'since'"
                class="date-picker-popover date-picker-popover-above"
                @click.stop
              >
                <div class="mb-2 flex items-center justify-between gap-2">
                  <button type="button" class="popover-icon-button" @click="shiftDatePickerMonth(-1)">
                    <ChevronLeft :size="14" />
                  </button>
                  <div class="text-xs font-bold text-on-surface">{{ datePickerTitle }}</div>
                  <button type="button" class="popover-icon-button" @click="shiftDatePickerMonth(1)">
                    <ChevronRight :size="14" />
                  </button>
                </div>
                <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-on-surface-variant">
                  <span v-for="label in weekDayLabels" :key="label">{{ label }}</span>
                </div>
                <div class="mt-1 grid grid-cols-7 gap-1">
                  <button
                    v-for="day in datePickerDays"
                    :key="`since-${day.value}`"
                    type="button"
                    :class="
                      cn(
                        'date-picker-day',
                        !day.isCurrentMonth && 'text-on-surface-variant/35',
                        day.isToday && !day.isSelected && 'border-primary/35 text-primary',
                        day.isSelected && 'border-primary bg-primary text-on-primary',
                      )
                    "
                    @click="selectDatePickerDay(day.value)"
                  >
                    {{ day.label }}
                  </button>
                </div>
                <button
                  type="button"
                  class="mt-2 text-[10px] font-bold text-on-surface-variant hover:text-primary"
                  @click="clearDatePickerValue"
                >
                  清除日期
                </button>
              </div>
            </div>
            <div class="relative">
              <button
                type="button"
                class="ui-field flex w-full items-center justify-between gap-2 text-left"
                @click.stop="openDatePicker('until')"
              >
                <span :class="commitUntil ? 'text-on-surface' : 'text-on-surface-variant/70'">
                  {{ commitUntil || t.git.until }}
                </span>
                <CalendarDays :size="14" class="text-on-surface-variant" />
              </button>
              <div
                v-if="openDatePickerKind === 'until'"
                class="date-picker-popover date-picker-popover-above"
                @click.stop
              >
                <div class="mb-2 flex items-center justify-between gap-2">
                  <button type="button" class="popover-icon-button" @click="shiftDatePickerMonth(-1)">
                    <ChevronLeft :size="14" />
                  </button>
                  <div class="text-xs font-bold text-on-surface">{{ datePickerTitle }}</div>
                  <button type="button" class="popover-icon-button" @click="shiftDatePickerMonth(1)">
                    <ChevronRight :size="14" />
                  </button>
                </div>
                <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-on-surface-variant">
                  <span v-for="label in weekDayLabels" :key="label">{{ label }}</span>
                </div>
                <div class="mt-1 grid grid-cols-7 gap-1">
                  <button
                    v-for="day in datePickerDays"
                    :key="`until-${day.value}`"
                    type="button"
                    :class="
                      cn(
                        'date-picker-day',
                        !day.isCurrentMonth && 'text-on-surface-variant/35',
                        day.isToday && !day.isSelected && 'border-primary/35 text-primary',
                        day.isSelected && 'border-primary bg-primary text-on-primary',
                      )
                    "
                    @click="selectDatePickerDay(day.value)"
                  >
                    {{ day.label }}
                  </button>
                </div>
                <button
                  type="button"
                  class="mt-2 text-[10px] font-bold text-on-surface-variant hover:text-primary"
                  @click="clearDatePickerValue"
                >
                  清除日期
                </button>
              </div>
            </div>
            <button
              type="button"
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-transparent text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="!hasCommitFilters"
              :title="t.git.clearFilters"
              :aria-label="t.git.clearFilters"
              @click="clearCommitFilters"
            >
              <X :size="14" />
            </button>
          </div>
        </div>
      </Transition>
    </section>

    <div
      v-if="isAiDialogOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
      @click.self="closeAiDialog"
    >
      <div
        class="flex h-[min(46rem,90vh)] w-[min(58rem,94vw)] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-2xl"
        @click.stop
      >
        <div
          class="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4 py-3"
        >
          <div class="min-w-0">
            <h3 class="text-sm font-bold text-on-surface">AI 生成</h3>
            <p class="truncate text-[10px] font-medium text-on-surface-variant">{{ filterStatusSummary }}</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
              :title="t.common.close"
              :aria-label="t.common.close"
              @click="closeAiDialog"
            >
              <X :size="15" />
            </button>
          </div>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
          <div class="flex shrink-0 flex-wrap items-end gap-2">
            <label class="block w-48 text-xs font-semibold uppercase text-on-surface-variant">
              <div class="relative mt-1">
                <button
                  type="button"
                  class="ui-field flex w-full items-center justify-between gap-2 text-left font-semibold normal-case"
                  @click.stop="isAiModeMenuOpen = !isAiModeMenuOpen"
                >
                  <span>{{ aiModeLabel }}</span>
                  <ChevronDown :size="14" class="text-on-surface-variant" />
                </button>
                <div v-if="isAiModeMenuOpen" class="mode-menu-popover" @click.stop>
                  <button
                    v-for="option in aiModeOptions"
                    :key="option.id"
                    type="button"
                    :class="cn('mode-menu-item', aiMode === option.id && 'bg-primary/10 text-primary')"
                    @click="selectAiMode(option.id)"
                  >
                    <span>{{ option.name }}</span>
                    <Check v-if="aiMode === option.id" :size="13" />
                  </button>
                </div>
              </div>
            </label>
            <label
              class="mb-0.5 inline-flex h-8 items-center gap-1.5 rounded border border-border-subtle bg-surface px-2 text-[10px] font-bold normal-case text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
              title="包含代码 diff 上下文"
            >
              <input
                v-model="aiDialogIncludeDiffContext"
                type="checkbox"
                class="h-3 w-3 accent-primary"
                :disabled="isAiDialogGenerating"
              />
              <span>Diff</span>
            </label>
            <button
              type="button"
              class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-subtle bg-primary px-3 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
              :disabled="isAiDialogGenerating"
              @click="generateAiAnalysis"
            >
              <Sparkles :size="13" />
              {{ isAiDialogGenerating ? "生成中" : "生成" }}
            </button>
          </div>
          <div
            class="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border-subtle bg-surface-container-low text-xs leading-5 text-on-surface-variant"
          >
            <button
              v-if="aiDialogCopyContent"
              type="button"
              class="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded border border-outline-variant/80 bg-surface-container-high text-on-surface-variant shadow-sm transition-colors hover:bg-surface-container-highest hover:text-primary dark:bg-surface-container-highest dark:text-on-surface dark:hover:bg-surface-variant"
              :title="copyLabel(aiDialogCopyContent)"
              :aria-label="copyLabel(aiDialogCopyContent)"
              @click="copyText(aiDialogCopyContent)"
            >
              <ClipboardCopy :size="12" />
            </button>
            <div class="ai-result-panel h-full overflow-auto p-3">
              <AiReasoningResult v-if="hasAiDialogDisplayResult" :result="aiDialogDisplayResult" />
              <div
                v-else-if="aiDialogPanelHint"
                :class="aiDialogState === 'error' ? 'text-status-error' : 'text-on-surface-variant'"
              >
                {{ aiDialogPanelHint }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="isDiffDialogOpen"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
      @click.self="closeDiffDialog"
    >
      <div
        class="flex h-[85vh] w-[90vw] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-2xl"
      >
        <div
          class="flex h-11 items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4"
        >
          <div class="min-w-0">
            <h3 class="text-sm font-bold text-on-surface">{{ t.git.diffTitle }}</h3>
            <p v-if="selectedDiff" class="truncate font-mono text-[10px] font-bold text-on-surface-variant">
              {{ selectedDiff.path }}
            </p>
          </div>
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
            :title="t.common.close"
            :aria-label="t.common.close"
            @click="closeDiffDialog"
          >
            <X :size="15" />
          </button>
        </div>
        <div class="themed-scrollbar min-h-0 flex-1 overflow-auto bg-surface-container-lowest">
          <div v-if="isLoadingDiff" class="p-5 text-sm text-on-surface-variant">{{ t.git.diffLoading }}</div>
          <div v-else-if="selectedDiff?.diff" class="min-w-max py-3 font-mono text-xs leading-5">
            <div
              v-for="line in diffLines"
              :key="line.id"
              :class="
                cn(
                  'grid grid-cols-[3.25rem_minmax(0,1fr)] whitespace-pre',
                  line.kind === 'add' && 'bg-green-500/15 text-green-700 dark:bg-green-400/10 dark:text-green-300',
                  line.kind === 'delete' && 'bg-red-500/15 text-red-700 dark:bg-red-400/10 dark:text-red-300',
                  line.kind === 'hunk' && 'bg-blue-500/10 text-blue-600 dark:bg-blue-400/8 dark:text-blue-400',
                  line.kind === 'meta' && 'bg-surface-container-low text-on-surface-variant/70',
                  line.kind === 'context' && 'text-on-surface',
                )
              "
            >
              <span class="select-none border-r border-border-subtle px-2 text-right text-on-surface-variant/60">
                {{ line.number }}
              </span>
              <span class="px-3">{{ line.content || " " }}</span>
            </div>
          </div>
          <div v-else class="p-5 text-sm text-on-surface-variant">
            {{ selectedDiff?.message || t.git.diffEmpty }}
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="isCommitDetailOpen && selectedCommit"
      class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
      @click.self="closeCommitDetails"
    >
      <div
        class="flex h-[min(46rem,90vh)] w-[min(58rem,94vw)] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-2xl"
      >
        <div
          class="flex min-h-14 items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4 py-2"
        >
          <div class="min-w-0 flex-1 py-0.5">
            <div class="flex min-w-0 items-center">
              <span class="block min-w-0 truncate text-sm font-semibold leading-5 text-on-surface" :title="selectedCommit.message">
                {{ selectedCommit.message }}
              </span>
            </div>
            <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] font-medium leading-4 text-on-surface-variant">
              <button
                type="button"
                class="inline-flex h-5 max-w-28 shrink-0 items-center gap-1 rounded border border-border-subtle bg-surface px-1.5 font-mono font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
                :title="copyLabel(selectedCommit.hash)"
                :aria-label="copyLabel(selectedCommit.hash)"
                @click="copyText(selectedCommit.hash)"
              >
                <span class="truncate">{{ selectedCommit.hash }}</span>
                <ClipboardCopy :size="10" />
              </button>
              <span class="max-w-28 truncate" :title="selectedCommit.author">{{ selectedCommit.author }}</span>
              <span class="text-on-surface-variant/60">·</span>
              <span class="shrink-0" :title="formatAbsoluteTime(selectedCommit.date)">
                {{ commitDateLabel(selectedCommit.date) }}
              </span>
              <span
                v-if="isSelectedCommitCurrentHead"
                :class="
                  cn(
                    'shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold leading-3',
                    isSelectedCommitDetachedHead
                      ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                      : 'border-primary/30 bg-primary/10 text-primary',
                  )
                "
              >
                {{ isSelectedCommitDetachedHead ? "detached HEAD" : "当前 HEAD" }}
              </span>
              <span
                v-for="refName in selectedCommitRefs"
                :key="refName"
                :class="cn(refClass(refName), 'max-w-28 shrink-0')"
                :title="refName"
              >
                {{ refName }}
              </span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="inline-flex h-7 max-w-32 items-center gap-1.5 rounded border border-primary/25 bg-primary/10 px-2 text-[10px] font-bold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-55"
              :disabled="isGitActionRunning || !canCheckoutSelectedCommit"
              :title="selectedCommitCheckoutTitle"
              :aria-label="selectedCommitCheckoutAriaLabel"
              @click="handleCheckoutSelectedCommit"
            >
              <GitCommitHorizontal :size="12" />
              <span class="truncate">{{ selectedCommitCheckoutLabel }}</span>
            </button>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
              :title="t.common.close"
              :aria-label="t.common.close"
              @click="closeCommitDetails"
            >
              <X :size="15" />
            </button>
          </div>
        </div>
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-container-lowest p-2.5">
          <div class="grid min-h-0 flex-1 grid-cols-[minmax(13rem,0.78fr)_minmax(0,1.22fr)] gap-2.5">
            <section
              class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface px-2.5 py-2.5"
            >
              <div class="mb-2 flex items-center justify-between gap-2">
                <h4 class="text-xs font-bold text-on-surface">{{ t.git.changedFiles }}</h4>
                <span class="text-[10px] font-bold text-on-surface-variant">{{ selectedCommitFiles.length }}</span>
              </div>
              <div class="themed-scrollbar min-h-24 flex-1 space-y-1 overflow-auto pr-1">
                <button
                  v-for="file in selectedCommitFiles"
                  :key="`detail-${file.path}`"
                  type="button"
                  class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-border-subtle bg-surface-container-low px-2 py-1.5 text-left font-mono text-[10px] font-bold text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
                  :title="file.path"
                  @click="handleViewDiff(file)"
                >
                  <span class="truncate">{{ file.path }}</span>
                  <span class="whitespace-nowrap">
                    <span v-if="file.additions > 0" class="text-status-running">+{{ file.additions }}</span>
                    <span v-if="file.deletions > 0" class="ml-1 text-status-error">-{{ file.deletions }}</span>
                  </span>
                </button>
                <p v-if="isLoadingCommitFiles" class="text-xs text-on-surface-variant">正在读取变更文件...</p>
                <p v-else-if="selectedCommitFiles.length === 0" class="text-xs text-on-surface-variant">
                  该提交暂无可显示的变更文件。
                </p>
              </div>
              <div class="mt-2 shrink-0 border-t border-border-subtle pt-2">
                <div class="relative">
                  <button
                    type="button"
                    class="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded border border-outline-variant/80 bg-surface-container-high text-on-surface-variant shadow-sm transition-colors hover:bg-surface-container-highest hover:text-primary dark:bg-surface-container-highest dark:text-on-surface dark:hover:bg-surface-variant"
                    :title="copyLabel(commitBodyContent)"
                    :aria-label="copyLabel(commitBodyContent)"
                    @click="copyText(commitBodyContent)"
                  >
                    <ClipboardCopy :size="12" />
                  </button>
                  <div
                    class="memo-rendered ai-markdown-result max-h-40 overflow-auto rounded border border-border-subtle bg-surface-container-low px-2 py-2 pr-8 text-on-surface lg:max-h-52"
                    v-html="renderedCommitBody"
                  ></div>
                </div>
              </div>
            </section>

            <section class="flex min-h-0 flex-col rounded-lg border border-border-subtle bg-surface px-2.5 py-2.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                  <Sparkles :size="14" class="shrink-0 text-primary" />
                  <div class="min-w-0">
                    <h4 class="text-xs font-bold text-on-surface">{{ t.git.aiSummary }}</h4>
                    <p class="truncate text-[10px] font-medium text-on-surface-variant">
                      {{ aiResponseModeHint }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <div class="relative w-28">
                    <button
                      type="button"
                      class="ui-field flex h-8 w-full items-center justify-between gap-2 px-2 text-left text-xs font-bold"
                      @click.stop="isCommitAiModeMenuOpen = !isCommitAiModeMenuOpen"
                    >
                      <span>{{ commitAiModeLabel }}</span>
                      <ChevronDown :size="13" class="text-on-surface-variant" />
                    </button>
                    <div v-if="isCommitAiModeMenuOpen" class="mode-menu-popover" @click.stop>
                      <button
                        v-for="option in aiModeOptions"
                        :key="`commit-${option.id}`"
                        type="button"
                        :class="cn('mode-menu-item', commitAiMode === option.id && 'bg-primary/10 text-primary')"
                        @click="selectCommitAiMode(option.id)"
                      >
                        <span>{{ option.name }}</span>
                        <Check v-if="commitAiMode === option.id" :size="13" />
                      </button>
                    </div>
                  </div>
                  <label
                    class="inline-flex h-8 items-center gap-1.5 rounded border border-border-subtle bg-surface px-2 text-[10px] font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
                    title="包含代码 diff 上下文"
                  >
                    <input
                      v-model="commitAiIncludeDiffContext"
                      type="checkbox"
                      class="h-3 w-3 accent-primary"
                      :disabled="commitAiState === 'loading'"
                    />
                    <span>Diff</span>
                  </label>
                  <button
                    type="button"
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-primary px-3 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
                    :disabled="commitAiState === 'loading'"
                    @click="generateCommitAiAnalysis"
                  >
                    <Sparkles :size="13" />
                    {{ commitAiState === "loading" ? "生成中" : "生成" }}
                  </button>
                </div>
              </div>
              <div
                class="relative mt-2 min-h-0 flex-1 overflow-hidden rounded-lg border border-border-subtle bg-surface-container-low text-xs leading-5 text-on-surface-variant"
              >
                <button
                  v-if="commitAiCopyContent"
                  type="button"
                  class="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded border border-outline-variant/80 bg-surface-container-high text-on-surface-variant shadow-sm transition-colors hover:bg-surface-container-highest hover:text-primary dark:bg-surface-container-highest dark:text-on-surface dark:hover:bg-surface-variant"
                  :title="copyLabel(commitAiCopyContent)"
                  :aria-label="copyLabel(commitAiCopyContent)"
                  @click="copyText(commitAiCopyContent)"
                >
                  <ClipboardCopy :size="12" />
                </button>
                <div class="ai-result-panel h-full overflow-auto p-3">
                  <AiReasoningResult v-if="hasCommitAiDisplayResult" :result="commitAiDisplayResult" />
                  <div
                    v-else-if="commitAiPanelHint"
                    :class="commitAiState === 'error' ? 'text-status-error' : 'text-on-surface-variant'"
                  >
                    {{ commitAiPanelHint }}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="confirmationDialog"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
        @click.self="closeConfirmationDialog"
      >
        <div
          class="w-[min(24rem,92vw)] overflow-hidden rounded-lg border border-outline-variant/70 bg-surface text-on-surface shadow-2xl"
          role="dialog"
          aria-modal="true"
          @click.stop
        >
          <div class="border-b border-border-subtle bg-surface-container-low px-4 py-3">
            <div class="flex items-start gap-3">
              <div
                :class="
                  cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                    (confirmationDialog.kind || 'danger') === 'warning'
                      ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                      : 'border-status-error/30 bg-status-error/10 text-status-error',
                  )
                "
              >
                <CircleAlert v-if="(confirmationDialog.kind || 'danger') === 'warning'" :size="16" />
                <Undo v-else :size="16" />
              </div>
              <div class="min-w-0">
                <h3 class="text-sm font-bold text-on-surface">{{ confirmationDialog.title }}</h3>
                <p class="mt-1 text-xs leading-5 text-on-surface-variant">{{ confirmationDialog.message }}</p>
              </div>
            </div>
          </div>
          <div class="px-4 py-3">
            <p
              v-if="confirmationDialog.detail"
              class="rounded border border-border-subtle bg-surface-container-low px-2 py-2 font-mono text-[11px] font-bold text-on-surface-variant break-all"
            >
              {{ confirmationDialog.detail }}
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button
                v-if="(confirmationDialog.kind || 'danger') === 'danger' || confirmationDialog.cancelLabel"
                type="button"
                class="inline-flex h-8 items-center rounded-lg border border-border-subtle bg-transparent px-3 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-wait disabled:opacity-60"
                :disabled="isConfirmationRunning"
                @click="closeConfirmationDialog"
              >
                {{ confirmationDialog.cancelLabel || t.common.cancel }}
              </button>
              <button
                type="button"
                :class="
                  cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors disabled:cursor-wait disabled:opacity-70',
                    (confirmationDialog.kind || 'danger') === 'warning'
                      ? 'border-primary/30 bg-primary text-on-primary hover:bg-primary/90'
                      : 'border-status-error/30 bg-status-error text-on-error hover:bg-status-error/90',
                  )
                "
                :disabled="isConfirmationRunning"
                @click="confirmRiskyAction"
              >
                <Undo v-if="(confirmationDialog.kind || 'danger') === 'danger'" :size="13" />
                {{ isConfirmationRunning ? "处理中" : confirmationDialog.confirmLabel }}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="commitTooltip"
        class="commit-tooltip-panel pointer-events-none fixed z-[70] w-max overflow-hidden rounded-lg border border-outline-variant/70 bg-surface-container-lowest text-left shadow-2xl"
        :style="commitTooltipStyle"
      >
        <div class="border-b border-border-subtle bg-surface-container-low px-3 py-2.5">
          <p v-if="commitTooltipTitle(commitTooltip.commit)" class="text-[12px] font-bold leading-5 text-on-surface">
            {{ commitTooltipTitle(commitTooltip.commit) }}
          </p>
          <div
            :class="
              cn(
                'flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-on-surface-variant',
                commitTooltipTitle(commitTooltip.commit) && 'mt-2',
              )
            "
          >
            <span class="inline-flex min-w-0 items-center gap-1.5">
              <UserCircle :size="12" class="shrink-0 text-on-surface-variant/70" />
              <span class="truncate">{{ commitTooltip.commit.author }}</span>
            </span>
            <span class="inline-flex min-w-0 items-center gap-1.5">
              <Clock3 :size="12" class="shrink-0 text-on-surface-variant/70" />
              <span>{{ formatCommitTime(commitTooltip.commit.date).text }}</span>
              <span v-if="formatCommitTime(commitTooltip.commit.date).title" class="text-on-surface-variant/70">
                ({{ formatCommitTime(commitTooltip.commit.date).title }})
              </span>
            </span>
          </div>
          <div v-if="refsForCommit(commitTooltip.commit.refs).length" class="mt-2 flex flex-wrap gap-1">
            <span
              v-for="refName in refsForCommit(commitTooltip.commit.refs)"
              :key="`tooltip-${commitTooltip.commit.hash}-${refName}`"
              :class="refClass(refName)"
            >
              {{ refName }}
            </span>
          </div>
        </div>
        <div
          v-if="commitTooltipBody(commitTooltip.commit)"
          class="commit-tooltip-body max-h-52 overflow-auto px-3 py-2.5"
        >
          <div
            class="memo-rendered commit-tooltip-rendered block text-on-surface"
            v-html="renderCommitMessage(commitTooltipBody(commitTooltip.commit))"
          ></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
