<script lang="ts">
type CommitFileViewMode = "list" | "tree";

let rememberedCommitFileViewMode: CommitFileViewMode = "list";
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpToLine,
  CircleCheck,
  CloudDownload,
  CloudUpload,
  ClipboardCopy,
  FileSearch,
  Folder,
  GitBranch,
  GitPullRequestArrow,
  Clock3,
  X,
  Sparkles,
  SlidersHorizontal,
  WandSparkles,
  ChevronDown,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  GitCommitHorizontal,
  List,
  ListTree,
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
  type ProjectGitDiffScope,
  type ProjectGitFileChange,
  type ProjectGitFileDiffResult,
  type ProjectGitRemoteSummary,
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
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { useResizableSplit } from "../../composables/useResizableSplit";
import ProjectActionDialog from "./ProjectActionDialog.vue";
import GitDiffViewer from "./GitDiffViewer.vue";

type AiState = "idle" | "loading" | "success" | "warning" | "error";
type GitActionState = "idle" | "loading" | "success" | "warning" | "error";
type GitFileActionName = "stage" | "unstage" | "discard";
type GitRemoteActionName = "fetch" | "pull" | "push";
type RemoteDialogMode = "add" | "edit";
type ActiveGitFileAction = { action: GitFileActionName; path: string };
type WorktreeDiffScope = Exclude<ProjectGitDiffScope, "combined">;
type WorktreeSelection = { path: string; scope: WorktreeDiffScope };
type RightContext = "review" | "history";
type CommitReviewSelection = { commitHash: string; commitMessage: string; path: string };
type ExpandedCommitFilesState = {
  files: ProjectGitFileChange[];
  isLoading: boolean;
  error: string;
  requestGeneration: number;
  contextGeneration: number;
};
type CommitFileDirectoryItem = {
  kind: "directory";
  key: string;
  name: string;
  path: string;
  depth: number;
  isExpanded: boolean;
};
type CommitFileItem = { kind: "file"; key: string; file: ProjectGitFileChange; depth: number };
type CommitFileDisplayItem = CommitFileDirectoryItem | CommitFileItem;
type CommitFileTreeNode = { directories: Map<string, CommitFileTreeNode>; files: ProjectGitFileChange[] };
type CommitTooltipState = { commit: ProjectGitCommitSummary; x: number; y: number };
type CommitTooltipDetailsState = {
  files: ProjectGitFileChange[] | null;
  isLoadingFiles: boolean;
  filesUnavailable: boolean;
  avatarUrl: string | null;
  isLoadingAvatar: boolean;
  requestGeneration: number;
  contextGeneration: number;
};
type CommitTooltipSummary = {
  state: "loading" | "ready" | "unavailable";
  fileCount: number;
  additions: number;
  deletions: number;
};
type CommitContextMenuState = { commit: ProjectGitCommitSummary; x: number; y: number; height: number };
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
const splitContainerRef = ref<HTMLElement | null>(null);
const filesPaneRef = ref<HTMLElement | null>(null);
const filesScrollRef = ref<HTMLDivElement | null>(null);
const graphScrollRef = ref<HTMLDivElement | null>(null);
const showCommitFilters = ref(false);
const isAiDialogOpen = ref(false);
const aiMode = ref("summary");
const isAiModeMenuOpen = ref(false);
const aiDialogIncludeDiffContext = ref(true);
const aiDialogResult = ref(createAiReasoningStreamState());
const aiDialogMessage = ref("");
const aiDialogNotice = ref("");
const aiDialogState = ref<AiState>("idle");
const openDatePickerKind = ref<"since" | "until" | null>(null);
const datePickerMonth = ref(new Date());
const isBranchMenuOpen = ref(false);
const isRemoteMenuOpen = ref(false);
const isRemoteDialogOpen = ref(false);
const remoteDialogMode = ref<RemoteDialogMode>("add");
const remoteFormName = ref("");
const remoteFormUrl = ref("");
const gitActionMessage = ref("");
const gitActionState = ref<GitActionState>("idle");
const activeGitAction = ref("");
const activeGitFileActions = ref<ActiveGitFileAction[]>([]);
const bulkActionProgress = ref({ current: 0, total: 0 });
const gitToastMessage = ref("");
const gitToastState = ref<Exclude<GitActionState, "idle">>("loading");
const gitToastTimer = ref<number | undefined>();
const commitMessage = ref("");
const commitMessageTextareaRef = ref<HTMLTextAreaElement | null>(null);
const commitMessageAiResult = ref(createAiReasoningStreamState());
const commitMessageAiState = ref<AiState>("idle");
const confirmationDialog = ref<AppActionDialog | null>(null);
const isConfirmationRunning = ref(false);
const commitMessageTextareaMinHeight = 60;
const commitMessageTextareaMaxHeight = 192;
const {
  bounds: splitBounds,
  firstSize,
  gridTemplateStyle,
  handleSeparatorKeydown,
  isResizing,
  startResize,
} = useResizableSplit({
  containerRef: splitContainerRef,
  firstPaneRef: filesPaneRef,
  layoutKey: "git-main",
  orientation: "horizontal",
  defaultFirstRatio: 0.28,
  minFirstSize: 200,
  minSecondSize: 360,
});
let stopAppEscapeListener = () => {};

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
const files = computed(() => store.stagedFiles[props.project.id] || props.project.git?.files || []);
const stageableFiles = computed(() => files.value.filter(canStageFile));
const unstageableFiles = computed(() => files.value.filter(canUnstageFile));
const discardableFiles = computed(() => files.value);
const stagedFiles = computed(() => files.value.filter((file) => file.staged));
const stagedGroupOpen = ref(true);
const unstagedGroupOpen = ref(true);
const rightContext = ref<RightContext>("history");
const worktreeSelection = ref<WorktreeSelection | null>(null);
const worktreeDiff = ref<ProjectGitFileDiffResult | null>(null);
const isLoadingWorktreeDiff = ref(false);
const commitReviewSelection = ref<CommitReviewSelection | null>(null);
const reviewScrollTop = ref(0);
let diffRequestGeneration = 0;
const expandedCommitFiles = ref<Record<string, ExpandedCommitFilesState>>({});
const expandedCommitDirectories = ref<Record<string, Record<string, boolean>>>({});
const commitFileViewMode = ref<CommitFileViewMode>(rememberedCommitFileViewMode);
let commitFilesRequestGeneration = 0;
let commitFilesContextGeneration = 0;
const worktreeGroups = computed(() => [
  ...(stagedFiles.value.length > 0
    ? [{ scope: "staged" as const, label: "已暂存", open: stagedGroupOpen.value, files: stagedFiles.value }]
    : []),
  { scope: "unstaged" as const, label: "更改", open: unstagedGroupOpen.value, files: stageableFiles.value },
]);
const visibleWorktreeItems = computed(() =>
  worktreeGroups.value.flatMap((group) =>
    group.open ? group.files.map((file) => ({ file, scope: group.scope })) : [],
  ),
);
const worktreeSelectionKey = (selection: WorktreeSelection) => `${selection.scope}:${selection.path}`;
const isWorktreeSelected = (path: string, scope: WorktreeDiffScope) =>
  worktreeSelection.value?.path === path && worktreeSelection.value.scope === scope;
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
  return [{ name: snapshot.value?.branch || "main", current: true }];
});
const currentGitRefLabel = computed(() => {
  if (snapshot.value?.isDetachedHead) {
    return snapshot.value.headHash ? `HEAD @ ${snapshot.value.headHash}` : "detached HEAD";
  }
  return snapshot.value?.branch || "main";
});
const commitKeyword = ref("");
const commitAuthor = ref("");
const commitSince = ref("");
const commitUntil = ref("");
const selectedCommitHashes = ref<string[]>([]);
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
const topBarStatusText = computed(() => {
  const statusText = snapshot.value?.statusText || t.value.git.noRepo;
  const headHash = snapshot.value?.headHash;
  if (!snapshot.value?.isDetachedHead || !headHash) return statusText;

  const detachedHeadPrefix = `detached HEAD @ ${headHash} · `;
  return statusText.startsWith(detachedHeadPrefix) ? statusText.slice(detachedHeadPrefix.length) : statusText;
});
const remotes = computed(() => snapshot.value?.remotes || []);
const upstream = computed(() => snapshot.value?.upstream || null);
const hasUpstream = computed(() => Boolean(upstream.value));
const upstreamLabel = computed(() => upstream.value?.ref || "未设置 upstream");
const remoteStatusText = computed(() => {
  if (upstream.value) {
    return upstream.value.ref;
  }
  if (remotes.value.length > 0) {
    return "当前分支未设置 upstream";
  }
  return "未配置 remote";
});
const canRunRemoteOperation = computed(() => hasUpstream.value && !isAnyGitWriteRunning.value);
const isGitSnapshotRefreshing = computed(() => Boolean(store.gitRefreshing[props.project.id]));
const isGitStatusRefreshing = computed(() => Boolean(store.gitStatusRefreshing[props.project.id]));
const isGitRefreshing = computed(() => isGitSnapshotRefreshing.value || isGitStatusRefreshing.value);

// 全局统一 Loading 状态栏
const globalLoadingMessage = computed(() => {
  // AI 生成提交信息
  if (commitMessageAiState.value === "loading") {
    return "正在生成 commit message...";
  }

  // 显式 Git 写操作提示优先于后续刷新状态，避免操作结果一闪而过。
  if (gitToastMessage.value) {
    return gitToastMessage.value;
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

  return "";
});

const showGlobalLoadingBar = computed(() => Boolean(globalLoadingMessage.value));
const isGitToastVisible = computed(() => Boolean(gitToastMessage.value));
const globalLoadingIconClass = computed(() => {
  if (isGitToastVisible.value && gitToastState.value === "success") return "border-status-running bg-status-running";
  if (isGitToastVisible.value && gitToastState.value === "warning") return "border-status-warning bg-status-warning";
  if (isGitToastVisible.value && gitToastState.value === "error") return "border-status-error bg-status-error";
  return "animate-spin border-primary border-t-transparent";
});
const globalLoadingTextClass = computed(() => {
  if (isGitToastVisible.value && gitToastState.value === "success") return "text-status-running";
  if (isGitToastVisible.value && gitToastState.value === "warning") return "text-status-warning";
  if (isGitToastVisible.value && gitToastState.value === "error") return "text-status-error";
  return "text-primary";
});
const globalLoadingBorderClass = computed(() => {
  if (isGitToastVisible.value && gitToastState.value === "success") return "border-status-running/30";
  if (isGitToastVisible.value && gitToastState.value === "warning") return "border-status-warning/30";
  if (isGitToastVisible.value && gitToastState.value === "error") return "border-status-error/30";
  return "border-primary/30";
});

const repositoryPath = computed(() => snapshot.value?.repositoryPath || props.project.path);
const isLoadingMore = ref(false);
const selectedDiff = ref<ProjectGitFileDiffResult | null>(null);
const isLoadingDiff = ref(false);
const isAiDialogGenerating = computed(() => aiDialogState.value === "loading");
const aiModeOptions = computed(() => store.aiPreferences.modes.filter((mode) => mode.kind !== "commit-message"));
const resolveAiModeId = (modeId: string) =>
  aiModeOptions.value.some((option) => option.id === modeId) ? modeId : aiModeOptions.value[0]?.id || "summary";
const selectedAiMode = computed(
  () => aiModeOptions.value.find((option) => option.id === aiMode.value) || aiModeOptions.value[0],
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
const commitTooltipDetails = ref<Record<string, CommitTooltipDetailsState>>({});
const commitContextMenu = ref<CommitContextMenuState | null>(null);
const commitContextMenuRef = ref<HTMLElement | null>(null);
let commitTooltipOpenTimer: number | undefined;
let commitTooltipCloseTimer: number | undefined;
let commitTooltipDetailsRequestGeneration = 0;
let commitTooltipDetailsContextGeneration = 0;
const commitTooltipStyle = computed(() => {
  if (!commitTooltip.value) {
    return {};
  }

  const viewportWidth = globalThis.window?.innerWidth || 1024;
  const viewportHeight = globalThis.window?.innerHeight || 768;
  const horizontalInset = Math.min(16, Math.floor(viewportWidth / 2));
  const verticalInset = Math.min(16, Math.floor(viewportHeight / 2));
  const tooltipGap = 10;
  const belowTop = Math.max(verticalInset, commitTooltip.value.y + tooltipGap);
  const aboveBottom = Math.max(verticalInset, viewportHeight - commitTooltip.value.y + tooltipGap);
  const availableAbove = viewportHeight - aboveBottom - verticalInset;
  const availableBelow = viewportHeight - belowTop - verticalInset;
  const showTooltipBelow = availableAbove < 80 && availableBelow > availableAbove;
  const tooltipMaxWidth = Math.min(384, Math.max(1, viewportWidth - horizontalInset * 2));
  const tooltipMaxHeight = Math.min(400, Math.max(1, showTooltipBelow ? availableBelow : availableAbove));
  const left = Math.min(
    Math.max(horizontalInset, commitTooltip.value.x),
    Math.max(horizontalInset, viewportWidth - tooltipMaxWidth - horizontalInset),
  );

  return {
    left: `${left}px`,
    ...(showTooltipBelow ? { top: `${belowTop}px` } : { bottom: `${aboveBottom}px` }),
    maxWidth: `${tooltipMaxWidth}px`,
    maxHeight: `${tooltipMaxHeight}px`,
  };
});
const commitContextMenuStyle = computed(() => {
  if (!commitContextMenu.value) return {};
  const width = 200;
  const viewportWidth = globalThis.window?.innerWidth || 1024;
  const viewportHeight = globalThis.window?.innerHeight || 768;
  return {
    left: `${Math.max(12, Math.min(commitContextMenu.value.x, viewportWidth - width - 12))}px`,
    top: `${Math.max(12, Math.min(commitContextMenu.value.y, viewportHeight - commitContextMenu.value.height - 12))}px`,
  };
});

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
  isBranchMenuOpen.value = false;
  isRemoteMenuOpen.value = false;
  openDatePickerKind.value = null;
  commitContextMenu.value = null;
};

const hasFloatingControlsOpen = () =>
  isAiModeMenuOpen.value || isBranchMenuOpen.value || isRemoteMenuOpen.value || Boolean(openDatePickerKind.value);

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (event.detail.handled) return;
  if (commitTooltip.value || pendingCommitTooltip.value) {
    hideCommitTooltip();
    event.detail.handle();
    return;
  }
  if (commitContextMenu.value) {
    commitContextMenu.value = null;
    event.detail.handle();
    return;
  }
  if (isRemoteDialogOpen.value) {
    closeRemoteDialog();
    event.detail.handle();
    return;
  }

  if (isAiDialogOpen.value) {
    closeAiDialog();
    event.detail.handle();
    return;
  }

  if (hasFloatingControlsOpen()) {
    closeFloatingControls();
    event.detail.handle();
    return;
  }

  if (rightContext.value === "review") {
    rightContext.value = "history";
    event.detail.handle();
  }
};

const handleRightContextKeydown = async (event: KeyboardEvent) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  rightContext.value = event.key === "ArrowLeft" || event.key === "Home" ? "history" : "review";
  await nextTick();
  document.getElementById(`git-${rightContext.value}-tab`)?.focus();
};

const remoteActionLabel = (action: GitRemoteActionName) => {
  if (action === "fetch") return "Fetch";
  if (action === "pull") return "Pull";
  return "Push";
};

const remoteActionLoadingMessage = (action: GitRemoteActionName) => {
  if (action === "fetch") return "正在执行 Git fetch...";
  if (action === "pull") return "正在执行 Git pull...";
  return "正在执行 Git push...";
};

const remoteActionTitle = (action: GitRemoteActionName) => {
  if (!hasUpstream.value) return "当前分支未设置 upstream，无法执行远程操作";
  return `${remoteActionLabel(action)} ${upstreamLabel.value}`;
};

const executeGitRemoteAction = async (action: GitRemoteActionName) => {
  if (isAnyGitWriteRunning.value) return;
  if (!hasUpstream.value) {
    setGitActionResult("warning", "当前分支未设置 upstream，无法执行远程操作。");
    return;
  }

  activeGitAction.value = `remote:${action}`;
  setGitActionResult("loading", remoteActionLoadingMessage(action));
  await waitForVisualFeedback();
  try {
    const result =
      action === "fetch"
        ? await store.fetchGitRemote(props.project.id)
        : action === "pull"
          ? await store.pullGitRemote(props.project.id)
          : await store.pushGitRemote(props.project.id);
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法执行远程 Git 操作。");
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) {
      clearCommitSelection();
    }
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "远程 Git 操作失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const openAddRemoteDialog = () => {
  if (isAnyGitWriteRunning.value) return;
  isRemoteMenuOpen.value = false;
  remoteDialogMode.value = "add";
  remoteFormName.value = "";
  remoteFormUrl.value = "";
  isRemoteDialogOpen.value = true;
};

const openEditRemoteDialog = (remote: ProjectGitRemoteSummary) => {
  if (isAnyGitWriteRunning.value) return;
  isRemoteMenuOpen.value = false;
  remoteDialogMode.value = "edit";
  remoteFormName.value = remote.name;
  remoteFormUrl.value = remote.fetchUrl || remote.pushUrl;
  isRemoteDialogOpen.value = true;
};

const closeRemoteDialog = () => {
  if (isAnyGitWriteRunning.value) return;
  isRemoteDialogOpen.value = false;
};

const validateRemoteForm = () => {
  const name = remoteFormName.value.trim();
  const url = remoteFormUrl.value.trim();
  if (!name) return "请输入 remote 名称。";
  if (name.startsWith("-")) return "remote 名称不能以 - 开头。";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return "remote 名称只能包含字母、数字、点、下划线和短横线。";
  if (!url) return "请输入 remote URL。";
  if (/[\u0000-\u001f\u007f]/.test(url)) return "remote URL 不能包含控制字符。";
  return "";
};

const submitRemoteDialog = async () => {
  if (isAnyGitWriteRunning.value) return;
  const validationMessage = validateRemoteForm();
  if (validationMessage) {
    setGitActionResult("warning", validationMessage);
    return;
  }

  const name = remoteFormName.value.trim();
  const url = remoteFormUrl.value.trim();
  const action = remoteDialogMode.value === "add" ? "add" : "set-url";
  activeGitAction.value = `remote:${action}:${name}`;
  setGitActionResult("loading", remoteDialogMode.value === "add" ? "正在添加 remote..." : "正在更新 remote URL...");
  await waitForVisualFeedback();
  try {
    const result =
      remoteDialogMode.value === "add"
        ? await store.addGitRemote(props.project.id, name, url)
        : await store.setGitRemoteUrl(props.project.id, name, url);
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法更新 remote。");
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) {
      isRemoteDialogOpen.value = false;
    }
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "更新 remote 失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const executeRemoveRemote = async (remoteName: string) => {
  if (isAnyGitWriteRunning.value) return;
  activeGitAction.value = `remote:remove:${remoteName}`;
  setGitActionResult("loading", `正在删除 remote：${remoteName}...`);
  await waitForVisualFeedback();
  try {
    const result = await store.removeGitRemote(props.project.id, remoteName);
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法删除 remote。");
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "删除 remote 失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const requestRemoveRemote = (remote: ProjectGitRemoteSummary) => {
  if (isAnyGitWriteRunning.value) return;
  confirmationDialog.value = {
    kind: "danger",
    title: "删除 Git remote",
    message: `此操作会从当前仓库删除 remote：${remote.name}。`,
    detail: remote.fetchUrl || remote.pushUrl,
    confirmLabel: "删除 remote",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeRemoveRemote(remote.name),
  };
};

const setGitActionResult = (state: GitActionState, message: string) => {
  gitActionState.value = state;
  gitActionMessage.value = message;
  window.clearTimeout(gitToastTimer.value);
  if (state === "idle" || !message) {
    gitToastMessage.value = "";
    return;
  }
  gitToastState.value = state;
  gitToastMessage.value = message;
  if (state !== "loading") {
    gitToastTimer.value = window.setTimeout(() => {
      gitToastMessage.value = "";
    }, 2200);
  }
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

  const sourceSelection = worktreeSelection.value ? { ...worktreeSelection.value } : null;
  const selectedFile = sourceSelection ? files.value.find((file) => file.path === sourceSelection.path) || null : null;
  const selectedIndex = sourceSelection
    ? visibleWorktreeItems.value.findIndex(
        (item) => item.file.path === sourceSelection.path && item.scope === sourceSelection.scope,
      )
    : -1;
  const nextItem = selectedIndex >= 0 ? visibleWorktreeItems.value[selectedIndex + 1] : undefined;
  const discardSuccessor =
    sourceSelection && nextItem?.scope === sourceSelection.scope
      ? { path: nextItem.file.path, scope: sourceSelection.scope }
      : null;
  diffRequestGeneration += 1;
  isLoadingWorktreeDiff.value = false;
  activeGitAction.value = `bulk:${action}`;
  const totalFiles = targetFiles.length;
  bulkActionProgress.value = { current: 0, total: totalFiles };

  // 显示初始进度
  setGitActionResult("loading", gitBulkActionLoadingMessage(action, totalFiles));
  await waitForVisualFeedback();

  try {
    const paths = targetFiles.map((file) => file.path);
    const result =
      action === "stage"
        ? await store.stageGitFiles(props.project.id, paths, { all: true })
        : action === "unstage"
          ? await store.unstageGitFiles(props.project.id, paths, { all: true })
          : await store.discardGitFiles(props.project.id, paths, { all: true });

    bulkActionProgress.value.current = result?.count || totalFiles;

    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法执行 Git 操作。");
      return;
    }

    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok && selectedFile) {
      await reconcileWorktreeSelection(action, selectedFile, sourceSelection, discardSuccessor);
    }
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "Git 操作失败。");
  } finally {
    activeGitAction.value = "";
    bulkActionProgress.value = { current: 0, total: 0 };
  }
};

const resolveVisibleSelection = (selection: WorktreeSelection | null) => {
  if (!selection) return null;
  return visibleWorktreeItems.value.some((item) => item.file.path === selection.path && item.scope === selection.scope)
    ? selection
    : null;
};

const clearWorktreeReview = () => {
  diffRequestGeneration += 1;
  worktreeSelection.value = null;
  worktreeDiff.value = null;
  isLoadingWorktreeDiff.value = false;
};

const loadWorktreeDiff = async (selection: WorktreeSelection) => {
  const generation = ++diffRequestGeneration;
  worktreeSelection.value = selection;
  commitReviewSelection.value = null;
  rightContext.value = "review";
  isLoadingWorktreeDiff.value = true;
  worktreeDiff.value = { path: selection.path, scope: selection.scope, diff: "" };
  try {
    const result = await store.readGitFileDiff(props.project.id, selection.path, { scope: selection.scope });
    if (
      generation === diffRequestGeneration &&
      worktreeSelection.value &&
      worktreeSelectionKey(worktreeSelection.value) === worktreeSelectionKey(selection) &&
      result?.path === selection.path &&
      result.scope === selection.scope
    ) {
      worktreeDiff.value = result;
    }
  } catch (error) {
    if (generation === diffRequestGeneration) {
      worktreeDiff.value = {
        path: selection.path,
        scope: selection.scope,
        diff: "",
        message: error instanceof Error ? error.message : "读取 Git diff 失败。",
      };
    }
  } finally {
    if (generation === diffRequestGeneration) isLoadingWorktreeDiff.value = false;
  }
};

const reconcileWorktreeSelection = async (
  action: GitFileActionName,
  file: ProjectGitFileChange,
  sourceSelection: WorktreeSelection | null,
  discardSuccessor: WorktreeSelection | null,
) => {
  if (!sourceSelection || !isWorktreeSelected(file.path, sourceSelection.scope)) return;
  if (action === "discard") {
    const nextSelection = resolveVisibleSelection(discardSuccessor);
    if (nextSelection) await loadWorktreeDiff(nextSelection);
    else clearWorktreeReview();
    return;
  }

  const targetScope: WorktreeDiffScope = action === "stage" ? "staged" : "unstaged";
  const targetFiles = targetScope === "staged" ? stagedFiles.value : stageableFiles.value;
  if (!targetFiles.some((item) => item.path === file.path)) {
    clearWorktreeReview();
    return;
  }
  if (targetScope === "staged") stagedGroupOpen.value = true;
  else unstagedGroupOpen.value = true;
  await loadWorktreeDiff({ path: file.path, scope: targetScope });
};

const executeGitFileAction = async (
  action: GitFileActionName,
  file: ProjectGitFileChange,
  sourceSelection: WorktreeSelection | null = null,
  discardSuccessor: WorktreeSelection | null = null,
) => {
  if (activeGitAction.value || isGitFileBusy(file)) return;

  diffRequestGeneration += 1;
  isLoadingWorktreeDiff.value = false;
  activeGitFileActions.value = [...activeGitFileActions.value, { action, path: file.path }];
  setGitActionResult("loading", gitFileActionLoadingMessage(action));
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

    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) {
      await reconcileWorktreeSelection(action, file, sourceSelection, discardSuccessor);
    }
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "Git 操作失败。");
  } finally {
    activeGitFileActions.value = activeGitFileActions.value.filter(
      (item) => item.action !== action || item.path !== file.path,
    );
  }
};

const requestDiscardGitFile = (file: ProjectGitFileChange, scope: WorktreeDiffScope) => {
  if (activeGitAction.value || isGitFileBusy(file)) return;
  const sourceSelection = isWorktreeSelected(file.path, scope) ? { path: file.path, scope } : null;
  const currentIndex = visibleWorktreeItems.value.findIndex(
    (item) => item.file.path === file.path && item.scope === scope,
  );
  const nextItem = currentIndex >= 0 ? visibleWorktreeItems.value[currentIndex + 1] : undefined;
  const discardSuccessor = nextItem?.scope === scope ? { path: nextItem.file.path, scope } : null;
  confirmationDialog.value = {
    title: "丢弃文件变更",
    message: "此操作会还原该文件在工作区与暂存区中的本地变更。",
    detail: gitFileDisplayPath(file),
    confirmLabel: "丢弃变更",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeGitFileAction("discard", file, sourceSelection, discardSuccessor),
  };
};

const runGitFileAction = async (action: GitFileActionName, file: ProjectGitFileChange, scope: WorktreeDiffScope) => {
  const sourceSelection = isWorktreeSelected(file.path, scope) ? { path: file.path, scope } : null;
  if (action === "discard") {
    requestDiscardGitFile(file, scope);
    return;
  }
  await executeGitFileAction(action, file, sourceSelection);
};

const runScopedPrimaryGitFileAction = async (file: ProjectGitFileChange, scope: WorktreeDiffScope) => {
  await runGitFileAction(scope === "staged" ? "unstage" : "stage", file, scope);
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

const commitLocalBranchNames = (commit: ProjectGitCommitSummary) => {
  const localBranches = new Set((snapshot.value?.branches || []).map((branch) => branch.name));
  return refsForCommit(commit.refs)
    .map((refName) => refName.replace(/^HEAD ->\s*/, "").trim())
    .filter((refName) => localBranches.has(refName));
};
const isCommitDetachedHead = (commit: ProjectGitCommitSummary) =>
  Boolean(snapshot.value?.isDetachedHead && commitHashMatches(commit.hash, snapshot.value.headHash));
const canCheckoutDetachedCommit = (commit: ProjectGitCommitSummary) => !isCommitDetachedHead(commit);
const detachedCheckoutTitle = (commit: ProjectGitCommitSummary) => {
  if (isCommitDetachedHead(commit)) return "当前已处于该分离 HEAD 提交";
  if (hasUncommittedChanges.value) return "工作区存在未提交变更，切换前需要确认";
  return "切换到此提交，并进入分离 HEAD 状态";
};
const branchCheckoutTitle = (branchName: string) => {
  if (branchName === snapshot.value?.branch && !snapshot.value?.isDetachedHead) return "当前分支";
  if (hasUncommittedChanges.value) return `工作区存在未提交变更，切换到 ${branchName} 前需要确认`;
  return `切换到本地分支 ${branchName}`;
};

const executeCheckoutCommit = async (commit: ProjectGitCommitSummary, options: { force?: boolean } = {}) => {
  if (!commit || activeGitAction.value || activeGitFileActions.value.length > 0) return;

  activeGitAction.value = `checkout:${commit.hash}`;
  setGitActionResult(
    "loading",
    options.force ? `正在强制切换到提交 ${commit.hash}...` : `正在切换到提交 ${commit.hash}...`,
  );
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
    title: "强制切换到提交",
    message: `当前工作区存在未提交变更。继续切换到 ${commit.hash} 会丢弃这些本地变更；若没有本地分支指向该提交，HEAD 将进入分离状态。`,
    detail: formatGitFileLines(files.value, ""),
    confirmLabel: "强制切换",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeCheckoutCommit(commit, { force: true }),
  };
};

const handleCheckoutCommit = async (commit: ProjectGitCommitSummary) => {
  commitContextMenu.value = null;
  if (!commit || activeGitAction.value || activeGitFileActions.value.length > 0) return;
  if (hasUncommittedChanges.value) {
    requestForceCheckoutCommit(commit);
    return;
  }

  await executeCheckoutCommit(commit);
};

const handleCheckoutCommitBranch = async (branchName: string) => {
  commitContextMenu.value = null;
  if (branchName === snapshot.value?.branch && !snapshot.value?.isDetachedHead) {
    setGitActionResult("success", `已经位于分支 ${branchName}。`);
    return;
  }
  await handleSwitchBranch(branchName);
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
const selectAiMode = (modeId: string) => {
  aiMode.value = resolveAiModeId(modeId);
  isAiModeMenuOpen.value = false;
};

const aiModeLabel = computed(() => selectedAiMode.value?.name || "总结");
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
    return `将分析所选 ${selectedCommitCount.value} 条历史提交。`;
  }
  return "未选择提交，将分析当前工作区变更";
});

type SelectedCommitContext = { commit: ProjectGitCommitSummary; files: ProjectGitFileChange[] };

const buildSelectedHistoryContext = async () => {
  const contexts: SelectedCommitContext[] = [];
  for (const commit of manuallySelectedCommits.value) {
    let commitFiles: ProjectGitFileChange[] = [];
    try {
      commitFiles = await store.readGitCommitFiles(props.project.id, commit.hash);
    } catch {
      commitFiles = [];
    }
    contexts.push({ commit, files: commitFiles });
  }

  const metadata = formatCommitLines(
    contexts.map((context) => context.commit),
    "无提交",
  );
  const fileSummaries = contexts
    .map(
      ({ commit, files: commitFiles }) =>
        `Commit ${commit.hash}：\n${formatGitFileLines(commitFiles, "- 该提交暂无可显示的变更文件。")}`,
    )
    .join("\n\n");

  let diffContent = "";
  let truncated = false;
  if (aiDialogIncludeDiffContext.value) {
    outer: for (const { commit, files: commitFiles } of contexts) {
      for (const file of commitFiles) {
        let result: ProjectGitFileDiffResult | null = null;
        try {
          result = await store.readGitCommitFileDiff(props.project.id, commit.hash, file.path);
        } catch {
          continue;
        }
        const diff = result?.diff?.trim();
        if (!diff) continue;
        const section = `${diffContent ? "\n\n" : ""}--- ${commit.hash} · ${gitFileDisplayPath(file)} ---\n${diff}`;
        const remaining = gitAiDiffContextMaxChars - diffContent.length;
        if (section.length > remaining) {
          if (remaining > 0) diffContent += section.slice(0, remaining);
          truncated = true;
          break outer;
        }
        diffContent += section;
      }
    }
  }

  return { metadata, fileSummaries, diffContent, truncated };
};

const buildAiPrompt = async () => {
  const template = selectedAiMode.value?.prompt || "请总结这些 Git 信息。";
  if (selectedCommitCount.value > 0) {
    const historyContext = await buildSelectedHistoryContext();
    const prompt = replacePromptPlaceholders(template, {
      ...buildCommonGitPromptPlaceholders(),
      commits: historyContext.metadata,
      changedFiles: historyContext.fileSummaries,
    });
    const diffSection = aiDialogIncludeDiffContext.value
      ? historyContext.diffContent
        ? `所选提交代码 diff：\n${historyContext.diffContent}`
        : "所选提交代码 diff：当前没有可附加的 diff 内容。"
      : "所选提交代码 diff：未附加；请基于提交元数据和文件列表分析。";
    return {
      prompt: `${prompt.trim()}\n\n要求：\n- 只分析下列所选历史提交，不得引用当前工作区变更。\n- 必须结合每条提交的完整 message、body、refs、作者、时间和文件列表。\n- 输出面向开发者的结构化内容。\n\n仓库上下文：\n${commonGitContextSection()}\n\n所选提交完整信息：\n${historyContext.metadata}\n\n所选提交文件：\n${historyContext.fileSummaries}\n\n${diffSection}`,
      truncated: historyContext.truncated,
    };
  }

  const diffContext = aiDialogIncludeDiffContext.value ? await workingTreeDiffContext() : null;
  const fileLines = formatGitFileLines(snapshot.value?.files || [], "当前没有工作区文件变更。");
  const prompt = replacePromptPlaceholders(template, {
    ...buildCommonGitPromptPlaceholders(),
    commits: "未选择历史提交。",
  });
  return {
    prompt: `${prompt.trim()}\n\n要求：\n- 只分析当前工作区变更。\n- 输出面向开发者的结构化内容。\n\n仓库上下文：\n${commonGitContextSection()}\n\n当前工作区变更文件：\n${fileLines}\n\n${formatDiffContextSection("当前工作区代码 diff", diffContext)}`,
    truncated: Boolean(diffContext?.truncated),
  };
};

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
  aiDialogNotice.value = "";
  aiDialogState.value = "idle";
};

const generateAiAnalysis = async () => {
  aiDialogResult.value = createAiReasoningStreamState();
  aiDialogMessage.value = "";
  aiDialogState.value = "loading";
  await waitForVisualFeedback();

  const promptResult = await buildAiPrompt();
  aiDialogNotice.value = promptResult.truncated
    ? selectedCommitCount.value > 0
      ? "Diff 已截断，所有提交信息已保留"
      : "工作区 Diff 已截断"
    : "";
  await store.analyzeGitWithAiStream(props.project.id, promptResult.prompt, {
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

const isCommitFilesExpanded = (hash: string) => Boolean(expandedCommitFiles.value[hash]);

const commitFileViewModeLabel = computed(() =>
  commitFileViewMode.value === "tree" ? "切换为平铺文件列表" : "切换为树形文件列表",
);

const toggleCommitFileViewMode = () => {
  commitFileViewMode.value = commitFileViewMode.value === "list" ? "tree" : "list";
  rememberedCommitFileViewMode = commitFileViewMode.value;
};

const clearExpandedCommitFiles = () => {
  commitFilesContextGeneration += 1;
  expandedCommitFiles.value = {};
  expandedCommitDirectories.value = {};
};

const clearCommitTooltipDetails = () => {
  commitTooltipDetailsContextGeneration += 1;
  commitTooltipDetails.value = {};
};

const pruneCommitTooltipDetails = (availableHashes: Set<string>) => {
  const nextState: Record<string, CommitTooltipDetailsState> = {};
  for (const [hash, state] of Object.entries(commitTooltipDetails.value)) {
    if (availableHashes.has(hash)) nextState[hash] = state;
  }
  commitTooltipDetails.value = nextState;
};

const pruneExpandedCommitFiles = (availableHashes: Set<string>) => {
  const nextState: Record<string, ExpandedCommitFilesState> = {};
  for (const [hash, state] of Object.entries(expandedCommitFiles.value)) {
    if (availableHashes.has(hash)) nextState[hash] = state;
  }
  expandedCommitFiles.value = nextState;

  const nextDirectories: Record<string, Record<string, boolean>> = {};
  for (const [hash, directories] of Object.entries(expandedCommitDirectories.value)) {
    if (nextState[hash]) nextDirectories[hash] = directories;
  }
  expandedCommitDirectories.value = nextDirectories;
};

const closeExpandedCommitFiles = (hash: string) => {
  const nextState = { ...expandedCommitFiles.value };
  delete nextState[hash];
  expandedCommitFiles.value = nextState;

  const nextDirectories = { ...expandedCommitDirectories.value };
  delete nextDirectories[hash];
  expandedCommitDirectories.value = nextDirectories;
};

const nextCommitFilesRequestGeneration = () => {
  commitFilesRequestGeneration += 1;
  return commitFilesRequestGeneration;
};

const isCurrentExpandedCommitFilesRequest = (hash: string, requestGeneration: number, contextGeneration: number) => {
  const state = expandedCommitFiles.value[hash];
  return (
    contextGeneration === commitFilesContextGeneration &&
    state?.requestGeneration === requestGeneration &&
    state.contextGeneration === contextGeneration
  );
};

const isCurrentCommitTooltipDetailsRequest = (hash: string, requestGeneration: number, contextGeneration: number) => {
  const state = commitTooltipDetails.value[hash];
  return (
    contextGeneration === commitTooltipDetailsContextGeneration &&
    state?.requestGeneration === requestGeneration &&
    state.contextGeneration === contextGeneration
  );
};

const loadCommitTooltipDetails = (commit: ProjectGitCommitSummary) => {
  const hash = commit.hash;
  if (!hash || commitTooltipDetails.value[hash]) return;

  const requestGeneration = ++commitTooltipDetailsRequestGeneration;
  const contextGeneration = commitTooltipDetailsContextGeneration;
  const canReadFiles = Boolean(snapshot.value?.repositoryPath);
  commitTooltipDetails.value = {
    ...commitTooltipDetails.value,
    [hash]: {
      files: null,
      isLoadingFiles: canReadFiles,
      filesUnavailable: !canReadFiles,
      avatarUrl: null,
      isLoadingAvatar: true,
      requestGeneration,
      contextGeneration,
    },
  };

  if (canReadFiles) {
    void store
      .readGitCommitFiles(props.project.id, hash)
      .then((files) => {
        if (!isCurrentCommitTooltipDetailsRequest(hash, requestGeneration, contextGeneration)) return;
        const state = commitTooltipDetails.value[hash];
        commitTooltipDetails.value = {
          ...commitTooltipDetails.value,
          [hash]: { ...state, files, isLoadingFiles: false },
        };
      })
      .catch(() => {
        if (!isCurrentCommitTooltipDetailsRequest(hash, requestGeneration, contextGeneration)) return;
        const state = commitTooltipDetails.value[hash];
        commitTooltipDetails.value = {
          ...commitTooltipDetails.value,
          [hash]: { ...state, files: null, isLoadingFiles: false, filesUnavailable: true },
        };
      });
  }

  void store
    .readGitCommitAuthorAvatar(props.project.id, hash)
    .then((avatarUrl) => {
      if (!isCurrentCommitTooltipDetailsRequest(hash, requestGeneration, contextGeneration)) return;
      const state = commitTooltipDetails.value[hash];
      commitTooltipDetails.value = {
        ...commitTooltipDetails.value,
        [hash]: { ...state, avatarUrl, isLoadingAvatar: false },
      };
    })
    .catch(() => {
      if (!isCurrentCommitTooltipDetailsRequest(hash, requestGeneration, contextGeneration)) return;
      const state = commitTooltipDetails.value[hash];
      commitTooltipDetails.value = {
        ...commitTooltipDetails.value,
        [hash]: { ...state, isLoadingAvatar: false },
      };
    });
};

const markCommitAvatarUnavailable = (hash: string) => {
  const state = commitTooltipDetails.value[hash];
  if (!state) return;
  commitTooltipDetails.value = {
    ...commitTooltipDetails.value,
    [hash]: { ...state, avatarUrl: null, isLoadingAvatar: false },
  };
};

const toggleCommitFiles = async (hash: string) => {
  hideCommitTooltip();
  if (isCommitFilesExpanded(hash)) {
    closeExpandedCommitFiles(hash);
    return;
  }

  const requestGeneration = nextCommitFilesRequestGeneration();
  const contextGeneration = commitFilesContextGeneration;
  expandedCommitFiles.value = {
    ...expandedCommitFiles.value,
    [hash]: {
      files: [],
      isLoading: true,
      error: "",
      requestGeneration,
      contextGeneration,
    },
  };
  try {
    const result = await store.readGitCommitFiles(props.project.id, hash);
    if (isCurrentExpandedCommitFilesRequest(hash, requestGeneration, contextGeneration)) {
      expandedCommitFiles.value = {
        ...expandedCommitFiles.value,
        [hash]: {
          ...expandedCommitFiles.value[hash],
          files: result,
        },
      };
    }
  } catch (error) {
    if (isCurrentExpandedCommitFilesRequest(hash, requestGeneration, contextGeneration)) {
      const message = error instanceof Error ? error.message : "读取提交文件失败。";
      expandedCommitFiles.value = {
        ...expandedCommitFiles.value,
        [hash]: {
          ...expandedCommitFiles.value[hash],
          files: [],
          error: message,
        },
      };
    }
  } finally {
    if (isCurrentExpandedCommitFilesRequest(hash, requestGeneration, contextGeneration)) {
      expandedCommitFiles.value = {
        ...expandedCommitFiles.value,
        [hash]: {
          ...expandedCommitFiles.value[hash],
          isLoading: false,
        },
      };
    }
  }
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

const selectAndOpenGitFileDiff = (file: ProjectGitFileChange, scope: WorktreeDiffScope) => {
  void loadWorktreeDiff({ path: file.path, scope });
};

const navigateWorktreeFile = (direction: -1 | 1) => {
  const items = visibleWorktreeItems.value;
  if (!items.length) return;
  const currentIndex = worktreeSelection.value
    ? items.findIndex(
        (item) => item.file.path === worktreeSelection.value?.path && item.scope === worktreeSelection.value?.scope,
      )
    : -1;
  const nextIndex = currentIndex < 0 ? (direction > 0 ? 0 : items.length - 1) : currentIndex + direction;
  const nextItem = items[Math.max(0, Math.min(items.length - 1, nextIndex))];
  if (nextItem) void loadWorktreeDiff({ path: nextItem.file.path, scope: nextItem.scope });
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

const handleGitTabKeydown = (event: KeyboardEvent) => {
  if (!event.altKey || isEditableTarget(event.target)) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    navigateWorktreeFile(event.key === "ArrowUp" ? -1 : 1);
  }
};

const handleViewDiff = async (commitHash: string, file: ProjectGitFileChange) => {
  const commit = (props.project.git?.commits || []).find((item) => item.hash === commitHash);
  if (!commit) return;
  const generation = ++diffRequestGeneration;
  worktreeSelection.value = null;
  commitReviewSelection.value = { commitHash, commitMessage: commit.message, path: file.path };
  rightContext.value = "review";
  isLoadingDiff.value = true;
  selectedDiff.value = { path: file.path, diff: "" };
  try {
    const result = await store.readGitCommitFileDiff(props.project.id, commitHash, file.path);
    if (
      generation === diffRequestGeneration &&
      commitReviewSelection.value?.commitHash === commitHash &&
      commitReviewSelection.value.path === file.path &&
      result?.path === file.path
    ) {
      selectedDiff.value = result;
    }
  } catch (error) {
    if (generation === diffRequestGeneration) {
      selectedDiff.value = {
        path: file.path,
        diff: "",
        message: error instanceof Error ? error.message : "读取提交 diff 失败。",
      };
    }
  } finally {
    if (generation === diffRequestGeneration) isLoadingDiff.value = false;
  }
};

const cancelCommitTooltipClose = () => {
  window.clearTimeout(commitTooltipCloseTimer);
};

const showCommitTooltip = (event: MouseEvent, commit: ProjectGitCommitSummary) => {
  window.clearTimeout(commitTooltipOpenTimer);
  cancelCommitTooltipClose();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  pendingCommitTooltip.value = { commit, x: rect.left, y: rect.top };
  commitTooltipOpenTimer = window.setTimeout(() => {
    commitTooltip.value = pendingCommitTooltip.value;
    if (commitTooltip.value) {
      loadCommitTooltipDetails(commitTooltip.value.commit);
    }
  }, 450);
};

const scheduleCommitTooltipClose = () => {
  window.clearTimeout(commitTooltipOpenTimer);
  commitTooltipCloseTimer = window.setTimeout(() => {
    pendingCommitTooltip.value = null;
    commitTooltip.value = null;
  }, 180);
};

const hideCommitTooltip = () => {
  window.clearTimeout(commitTooltipOpenTimer);
  window.clearTimeout(commitTooltipCloseTimer);
  pendingCommitTooltip.value = null;
  commitTooltip.value = null;
};

const openCommitContextMenu = async (event: MouseEvent, commit: ProjectGitCommitSummary) => {
  hideCommitTooltip();
  const row = event.currentTarget as HTMLElement;
  const rowRect = row.getBoundingClientRect();
  const openedFromKeyboard = event.clientX === 0 && event.clientY === 0;
  const branchCount = commitLocalBranchNames(commit).length;
  commitContextMenu.value = {
    commit,
    x: openedFromKeyboard ? rowRect.left + graphLayerLeft : event.clientX,
    y: openedFromKeyboard ? rowRect.bottom : event.clientY,
    height: branchCount > 0 ? Math.min(320, 36 + branchCount * 28) : 44,
  };
  await nextTick();
  commitContextMenuRef.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
};

const handleWindowPointerDown = (event: PointerEvent) => {
  const target = event.target;
  if (target instanceof Element && target.closest("[data-commit-context-menu]")) return;
  commitContextMenu.value = null;
};

onBeforeUnmount(() => {
  hideCommitTooltip();
  clearExpandedCommitFiles();
  clearCommitTooltipDetails();
  window.clearTimeout(copiedTimer.value);
  window.clearTimeout(gitToastTimer.value);
  window.removeEventListener("pointerdown", handleWindowPointerDown);
  stopAppEscapeListener();
});

onMounted(() => {
  window.addEventListener("pointerdown", handleWindowPointerDown);
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});

watch(
  () => aiModeOptions.value.map((mode) => mode.id).join("|"),
  () => {
    aiMode.value = resolveAiModeId(aiMode.value);
  },
  { immediate: true },
);

watch(
  () => props.project.id,
  () => {
    diffRequestGeneration += 1;
    clearExpandedCommitFiles();
    clearCommitTooltipDetails();
    clearCommitSelection();
    rightContext.value = "history";
    worktreeSelection.value = null;
    worktreeDiff.value = null;
    isLoadingWorktreeDiff.value = false;
    commitReviewSelection.value = null;
    stagedGroupOpen.value = true;
    unstagedGroupOpen.value = true;
    selectedDiff.value = null;
    hideCommitTooltip();
    commitContextMenu.value = null;
    scheduleCommitMessageTextareaResize();
  },
);

watch(commitMessage, scheduleCommitMessageTextareaResize, { immediate: true });

watch(
  () => (props.project.git?.commits || []).map((commit) => commit.hash).join("|"),
  () => {
    const availableHashes = new Set((props.project.git?.commits || []).map((commit) => commit.hash));
    selectedCommitHashes.value = selectedCommitHashes.value.filter((hash) => availableHashes.has(hash));
    pruneExpandedCommitFiles(availableHashes);
    pruneCommitTooltipDetails(availableHashes);
  },
);

watch(
  () => props.project.git?.repositoryPath || "",
  () => {
    clearCommitTooltipDetails();
    hideCommitTooltip();
  },
);

const refsForCommit = (refs?: string) =>
  (refs || "")
    .split(",")
    .map((refName) => refName.trim())
    .filter(Boolean);

const refClass = (refName: string) =>
  cn(
    "max-w-40 truncate rounded border px-1.5 py-px text-[9px] font-bold leading-3",
    refName.startsWith("tag:")
      ? "border-secondary/25 bg-secondary/10 text-secondary"
      : refName.includes("HEAD")
        ? "border-primary/70 bg-primary/10 text-primary"
        : /^(?:origin|upstream|remote|remotes\/[^/]+)\//.test(refName)
          ? "border-secondary/30 bg-secondary/10 text-secondary"
          : /(?:^|\s|\/)(?:main|master)$/.test(refName)
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
const createCommitFileTreeNode = (): CommitFileTreeNode => ({ directories: new Map(), files: [] });
const compareCommitFileTreeNames = (left: string, right: string) => (left === right ? 0 : left < right ? -1 : 1);
const commitFileItemKey = (file: ProjectGitFileChange) => `file:${file.originalPath || ""}:${file.path}`;
const normalizeCommitFilePath = (path: string) => path.replace(/\\/g, "/").split("/").filter(Boolean).join("/");

const isCommitDirectoryExpanded = (hash: string, path: string) =>
  expandedCommitDirectories.value[hash]?.[normalizeCommitFilePath(path)] !== false;

const toggleCommitDirectory = (hash: string, path: string) => {
  const normalizedPath = normalizeCommitFilePath(path);
  const nextDirectories = { ...(expandedCommitDirectories.value[hash] || {}) };
  if (isCommitDirectoryExpanded(hash, normalizedPath)) {
    nextDirectories[normalizedPath] = false;
  } else {
    delete nextDirectories[normalizedPath];
  }

  const nextState = { ...expandedCommitDirectories.value };
  if (Object.keys(nextDirectories).length > 0) nextState[hash] = nextDirectories;
  else delete nextState[hash];
  expandedCommitDirectories.value = nextState;
};

const commitFileTreeItems = (hash: string, files: ProjectGitFileChange[]): CommitFileDisplayItem[] => {
  const root = createCommitFileTreeNode();
  for (const file of files) {
    const segments = normalizeCommitFilePath(file.path).split("/").filter(Boolean);
    if (segments.length === 0) {
      root.files.push(file);
      continue;
    }

    let node = root;
    for (const directoryName of segments.slice(0, -1)) {
      let directory = node.directories.get(directoryName);
      if (!directory) {
        directory = createCommitFileTreeNode();
        node.directories.set(directoryName, directory);
      }
      node = directory;
    }
    node.files.push(file);
  }

  const items: CommitFileDisplayItem[] = [];
  const appendItems = (node: CommitFileTreeNode, parentPath: string, depth: number) => {
    for (const [name, directory] of [...node.directories.entries()].sort(([left], [right]) =>
      compareCommitFileTreeNames(left, right),
    )) {
      let compactName = name;
      let compactPath = parentPath ? `${parentPath}/${name}` : name;
      let compactDirectory = directory;
      while (compactDirectory.files.length === 0 && compactDirectory.directories.size === 1) {
        const [childName, childDirectory] = [...compactDirectory.directories.entries()][0]!;
        compactName += ` \\ ${childName}`;
        compactPath = `${compactPath}/${childName}`;
        compactDirectory = childDirectory;
      }

      const isExpanded = isCommitDirectoryExpanded(hash, compactPath);
      items.push({
        kind: "directory",
        key: `directory:${compactPath}`,
        name: compactName,
        path: compactPath,
        depth,
        isExpanded,
      });
      if (isExpanded) appendItems(compactDirectory, compactPath, depth + 1);
    }
    for (const file of [...node.files].sort((left, right) =>
      compareCommitFileTreeNames(normalizeCommitFilePath(left.path), normalizeCommitFilePath(right.path)),
    )) {
      items.push({ kind: "file", key: commitFileItemKey(file), file, depth });
    }
  };

  appendItems(root, "", 0);
  return items;
};

const createCommitFileDisplayItems = (hash: string, files: ProjectGitFileChange[]): CommitFileDisplayItem[] =>
  commitFileViewMode.value === "tree"
    ? commitFileTreeItems(hash, files)
    : files.map((file): CommitFileItem => ({ kind: "file", key: commitFileItemKey(file), file, depth: 0 }));

const expandedCommitFileDisplayItems = computed<Record<string, CommitFileDisplayItem[]>>(() => {
  const itemsByHash: Record<string, CommitFileDisplayItem[]> = {};
  for (const [hash, state] of Object.entries(expandedCommitFiles.value)) {
    itemsByHash[hash] = createCommitFileDisplayItems(hash, state.files);
  }
  return itemsByHash;
});

const commitFileDisplayItems = (hash: string) => expandedCommitFileDisplayItems.value[hash] || [];

const expandedCommitFilesHeight = (hash: string) => {
  const state = expandedCommitFiles.value[hash];
  if (!state) return 0;
  if (state.isLoading || state.error || state.files.length === 0) return 40;
  return Math.min(240, commitFileDisplayItems(hash).length * 24 + 10);
};
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
  let expandedHeight = 0;

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
    rows.push({ commit, lane, color, y: index * rowPitch + rowHeight / 2 + expandedHeight });
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
    expandedHeight += expandedCommitFilesHeight(commit.hash);
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
  const height = rows.length > 0 ? rows.length * rowHeight + Math.max(0, rows.length - 1) * rowGap + expandedHeight : 0;

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

const shortCommitHash = (hash: string) => hash.slice(0, 7);

const commitTooltipDetailsFor = (hash: string) => commitTooltipDetails.value[hash] || null;

const commitTooltipSummary = (commit: ProjectGitCommitSummary): CommitTooltipSummary => {
  const details = commitTooltipDetailsFor(commit.hash);
  if (!details || details.isLoadingFiles) {
    return { state: "loading", fileCount: 0, additions: 0, deletions: 0 };
  }
  if (details.filesUnavailable || !details.files) {
    return { state: "unavailable", fileCount: 0, additions: 0, deletions: 0 };
  }

  return details.files.reduce(
    (summary, file) => ({
      state: "ready",
      fileCount: summary.fileCount + 1,
      additions: summary.additions + file.additions,
      deletions: summary.deletions + file.deletions,
    }),
    { state: "ready", fileCount: 0, additions: 0, deletions: 0 } as CommitTooltipSummary,
  );
};

const commitAuthorInitials = (author: string) => {
  const names = author.trim().split(/\s+/).filter(Boolean);
  const initials = names
    .slice(0, 2)
    .map((name) => Array.from(name)[0] || "")
    .join("")
    .toUpperCase();
  return initials || "?";
};

const commitAuthorAvatarClass = (author: string) => {
  const colorClasses = [
    "bg-primary/15 text-primary",
    "bg-secondary/15 text-secondary",
    "bg-status-running/15 text-status-running",
    "bg-status-warning/15 text-status-warning",
  ];
  const colorIndex = Array.from(author).reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0);
  return colorClasses[colorIndex % colorClasses.length];
};

const renderCommitMessage = (message: string) => renderMarkdown(message || "");
const fullCommitMessage = (commit: ProjectGitCommitSummary) => {
  const message = commit.message.trim();
  const body = (commit.body || "").trim();
  if (!body || body === message || body.startsWith(`${message}\n`)) return body || message;
  return `${message}\n\n${body}`;
};
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
  <div
    class="relative flex h-full min-h-0 flex-col gap-3 overflow-hidden"
    @click="closeFloatingControls"
    @keydown="handleGitTabKeydown"
  >
    <!-- 全局 Loading 提示 - 右下角浮动 Toast -->
    <Transition name="slide-up">
      <div
        v-if="showGlobalLoadingBar"
        :class="
          cn(
            'fixed right-4 top-16 z-50 flex max-w-xs items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 shadow-lg',
            globalLoadingBorderClass,
          )
        "
      >
        <div class="flex h-4 w-4 items-center justify-center shrink-0">
          <div :class="cn('h-3 w-3 rounded-full border-2', globalLoadingIconClass)"></div>
        </div>
        <span :class="cn('text-xs font-medium', globalLoadingTextClass)">{{ globalLoadingMessage }}</span>
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
        <span v-if="hasUpstream" class="text-on-surface-variant whitespace-nowrap">
          {{ t.git.ahead }} {{ snapshot?.ahead || 0 }} · {{ t.git.behind }} {{ snapshot?.behind || 0 }}
        </span>
        <div class="relative min-w-0" @click.stop>
          <button
            type="button"
            :class="
              cn(
                'flex max-w-56 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors hover:bg-surface-variant',
                upstream
                  ? 'border-primary/25 bg-primary/10 text-primary'
                  : remotes.length > 0
                    ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                    : 'border-border-subtle bg-surface-container-low text-on-surface-variant',
              )
            "
            :title="remoteStatusText"
            aria-label="Git remote 状态"
            @click="isRemoteMenuOpen = !isRemoteMenuOpen"
          >
            <span class="min-w-0 truncate">{{ remoteStatusText }}</span>
            <ChevronDown :size="11" class="shrink-0" />
          </button>
          <div v-if="isRemoteMenuOpen" class="mode-menu-popover min-w-72" @click.stop>
            <div class="border-b border-border-subtle px-2 py-1.5">
              <div class="truncate text-[10px] font-bold uppercase text-on-surface-variant">Remote</div>
            </div>
            <div v-if="remotes.length > 0" class="max-h-52 overflow-y-auto py-1">
              <div
                v-for="remote in remotes"
                :key="remote.name"
                class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 hover:bg-surface-variant"
              >
                <div class="min-w-0">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate font-mono text-[11px] font-bold text-on-surface">{{ remote.name }}</span>
                    <span
                      v-if="upstream?.remote === remote.name"
                      class="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-px text-[9px] font-bold text-primary"
                    >
                      upstream
                    </span>
                  </div>
                  <p class="truncate font-mono text-[10px] text-on-surface-variant" :title="remote.fetchUrl">
                    {{ remote.fetchUrl || remote.pushUrl }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-px">
                  <button
                    type="button"
                    class="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="isAnyGitWriteRunning"
                    :title="`编辑 ${remote.name} URL`"
                    :aria-label="`编辑 ${remote.name} URL`"
                    @click="openEditRemoteDialog(remote)"
                  >
                    <SlidersHorizontal :size="12" />
                  </button>
                  <button
                    type="button"
                    class="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface hover:text-status-error disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="isAnyGitWriteRunning"
                    :title="`删除 ${remote.name}`"
                    :aria-label="`删除 ${remote.name}`"
                    @click="requestRemoveRemote(remote)"
                  >
                    <X :size="12" />
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="px-2 py-2 text-[11px] text-on-surface-variant">暂无 remote</div>
            <div class="border-t border-border-subtle p-1">
              <button
                type="button"
                class="mode-menu-item"
                :disabled="isAnyGitWriteRunning"
                @click="openAddRemoteDialog"
              >
                <span>添加 Git remote</span>
                <Plus :size="13" />
              </button>
            </div>
          </div>
        </div>
        <span class="text-on-surface-variant truncate">{{ topBarStatusText }}</span>
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
      <div class="flex gap-1.5 shrink-0">
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canRunRemoteOperation"
          :title="remoteActionTitle('fetch')"
          :aria-label="remoteActionTitle('fetch')"
          @click="executeGitRemoteAction('fetch')"
        >
          <CloudDownload :size="14" :class="activeGitAction === 'remote:fetch' ? 'animate-pulse' : ''" />
        </button>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canRunRemoteOperation"
          :title="remoteActionTitle('pull')"
          :aria-label="remoteActionTitle('pull')"
          @click="executeGitRemoteAction('pull')"
        >
          <GitPullRequestArrow :size="14" :class="activeGitAction === 'remote:pull' ? 'animate-pulse' : ''" />
        </button>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canRunRemoteOperation"
          :title="remoteActionTitle('push')"
          :aria-label="remoteActionTitle('push')"
          @click="executeGitRemoteAction('push')"
        >
          <CloudUpload :size="14" :class="activeGitAction === 'remote:push' ? 'animate-pulse' : ''" />
        </button>
      </div>
    </div>

    <div ref="splitContainerRef" class="relative grid min-h-0 flex-1 overflow-hidden" :style="gridTemplateStyle">
      <div
        ref="filesPaneRef"
        class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm"
      >
        <div class="border-b border-border-subtle bg-surface px-2 py-1.5">
          <div class="flex min-w-0 flex-col gap-1.5">
            <textarea
              ref="commitMessageTextareaRef"
              v-model="commitMessage"
              rows="1"
              class="themed-scrollbar h-[3.75rem] max-h-[12rem] min-h-[3.75rem] w-full min-w-0 shrink-0 resize-none overflow-hidden rounded border border-transparent bg-surface-container-low px-2 py-1.5 text-xs leading-4 text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/55 focus:border-primary/45 focus:bg-surface"
              placeholder="输入 commit message..."
              @input="resizeCommitMessageTextarea"
            ></textarea>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="flex h-6 flex-1 items-center justify-center gap-1 rounded border border-border-subtle bg-primary px-2 text-xs font-medium text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
                :disabled="isAnyGitWriteRunning || !hasStagedChanges || !commitMessage.trim()"
                :title="activeGitAction === 'commit' ? '正在提交 staged 变更' : '提交 staged 变更'"
                :aria-label="activeGitAction === 'commit' ? '正在提交 staged 变更' : '提交 staged 变更'"
                @click="handleCommitStaged"
              >
                <Check :size="12" :class="activeGitAction === 'commit' ? 'animate-pulse' : ''" :stroke-width="2.5" />
                <span>提交</span>
              </button>
              <button
                type="button"
                class="flex h-6 flex-1 items-center justify-center gap-1 rounded border border-border-subtle bg-surface px-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-wait disabled:opacity-60"
                :disabled="isAnyGitWriteRunning || commitMessageAiState === 'loading'"
                :title="commitMessageAiState === 'loading' ? '正在生成 commit message' : 'AI 生成 commit message'"
                :aria-label="commitMessageAiState === 'loading' ? '正在生成 commit message' : 'AI 生成 commit message'"
                @click="generateCommitMessage"
              >
                <WandSparkles :size="12" :class="commitMessageAiState === 'loading' ? 'animate-pulse' : ''" />
                <span>AI 生成</span>
              </button>
            </div>
          </div>
        </div>

        <div class="ui-panel-header">
          <div class="ui-panel-title">
            <h3 class="min-w-0 truncate">{{ t.git.files }}</h3>
          </div>
          <div class="flex min-w-0 items-center gap-1.5">
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
          <section
            v-for="group in worktreeGroups"
            :key="group.scope"
            class="border-b border-border-subtle last:border-b-0"
          >
            <button
              type="button"
              class="flex h-7 w-full items-center gap-1.5 bg-surface-container-low px-2 text-left text-[10px] font-bold text-on-surface-variant transition-colors hover:bg-surface-container"
              :aria-expanded="group.open"
              @click="
                group.scope === 'staged'
                  ? (stagedGroupOpen = !stagedGroupOpen)
                  : (unstagedGroupOpen = !unstagedGroupOpen)
              "
            >
              <ChevronDown v-if="group.open" :size="12" />
              <ChevronRight v-else :size="12" />
              <span>{{ group.label }}</span>
              <span class="ml-auto font-mono text-[9px]">{{ group.files.length }}</span>
            </button>
            <div v-if="group.open">
              <div
                v-for="file in group.files"
                :key="`${group.scope}:${file.path}`"
                :class="
                  cn(
                    'group relative grid min-h-[1.875rem] cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-t border-border-subtle px-2 py-0.5 transition-colors hover:bg-surface-container-low focus-within:bg-surface-container-low',
                    isWorktreeSelected(file.path, group.scope) &&
                      'bg-primary/5 shadow-[inset_2px_0_0_var(--color-primary)]',
                  )
                "
                :title="gitFileDisplayPath(file)"
                @click="selectAndOpenGitFileDiff(file, group.scope)"
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
                          'max-w-full shrink-0 truncate font-mono text-[11px] font-bold leading-4',
                          file.status === 'DELETED' ? 'text-on-surface-variant line-through' : 'text-on-surface',
                        )
                      "
                    >
                      {{ gitFileName(file) }}
                    </span>
                    <span
                      v-if="gitFileDirectory(file)"
                      class="min-w-0 flex-1 truncate text-[10px] font-medium leading-4 text-on-surface-variant/65"
                    >
                      {{ gitFileDirectory(file) }}
                    </span>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-1 text-[10px] font-bold leading-4">
                  <span v-if="file.additions > 0" class="text-status-running">+{{ file.additions }}</span>
                  <span v-if="file.deletions > 0" class="text-status-error">-{{ file.deletions }}</span>
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
                    type="button"
                    class="flex h-5 w-5 items-center justify-center rounded text-on-surface-variant/80 transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-wait disabled:opacity-45"
                    :disabled="!canRunFileAction(file, group.scope === 'staged' ? 'unstage' : 'stage')"
                    :title="
                      group.scope === 'staged'
                        ? `取消暂存：${gitFileDisplayPath(file)}`
                        : `暂存文件：${gitFileDisplayPath(file)}`
                    "
                    :aria-label="group.scope === 'staged' ? '取消暂存文件' : '暂存文件'"
                    @click.stop="runScopedPrimaryGitFileAction(file, group.scope)"
                  >
                    <Minus
                      v-if="group.scope === 'staged'"
                      :size="12"
                      :class="isGitFileActionActive('unstage', file) ? 'animate-pulse' : ''"
                    />
                    <Plus v-else :size="12" :class="isGitFileActionActive('stage', file) ? 'animate-pulse' : ''" />
                  </button>
                  <button
                    type="button"
                    class="flex h-5 w-5 items-center justify-center rounded text-on-surface-variant/80 transition-colors hover:bg-surface-variant hover:text-status-error disabled:cursor-wait disabled:opacity-45"
                    :disabled="!canRunFileAction(file, 'discard')"
                    :title="`丢弃文件变更：${gitFileDisplayPath(file)}`"
                    aria-label="丢弃文件变更"
                    @click.stop="runGitFileAction('discard', file, group.scope)"
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
              <div v-if="group.files.length === 0" class="px-3 py-2 text-[10px] text-on-surface-variant/70">
                暂无文件
              </div>
            </div>
          </section>
        </div>
        <div v-else class="flex flex-none items-center gap-1.5 px-2 py-1.5 text-[11px] text-on-surface-variant">
          <CircleCheck :size="14" class="shrink-0 text-status-running" />
          <span class="leading-4">{{ t.git.cleanWorkingTree }}</span>
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        :aria-label="t.git.resizePanels"
        :aria-valuemin="Math.round(splitBounds.min)"
        :aria-valuemax="Math.round(splitBounds.max)"
        :aria-valuenow="Math.round(firstSize ?? 0)"
        tabindex="0"
        :class="
          cn('group/split relative z-20 cursor-col-resize touch-none outline-none', isResizing && 'bg-primary/10')
        "
        @pointerdown="startResize"
        @keydown="handleSeparatorKeydown"
      >
        <span
          :class="
            cn(
              'absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-border-subtle transition-colors group-hover/split:bg-primary group-focus/split:bg-primary',
              isResizing && 'bg-primary',
            )
          "
        />
      </div>

      <div
        class="@container bg-surface border border-border-subtle rounded-lg overflow-hidden shadow-sm min-h-0 flex min-w-0 flex-col"
      >
        <div
          class="flex h-10 shrink-0 flex-nowrap items-center justify-between gap-2 border-b border-border-subtle bg-surface-container-low px-3"
        >
          <div
            role="tablist"
            aria-label="Git 右侧内容"
            class="inline-flex h-7 shrink-0 overflow-hidden rounded border border-border-subtle bg-surface"
            @keydown="handleRightContextKeydown"
          >
            <button
              id="git-history-tab"
              type="button"
              role="tab"
              aria-controls="git-commit-history-panel"
              :aria-selected="rightContext === 'history'"
              :tabindex="rightContext === 'history' ? 0 : -1"
              :class="
                cn(
                  'px-2.5 text-[10px] font-bold transition-colors',
                  rightContext === 'history'
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-variant',
                )
              "
              @click="rightContext = 'history'"
            >
              提交树
            </button>
            <button
              id="git-review-tab"
              type="button"
              role="tab"
              aria-controls="git-review-panel"
              :aria-selected="rightContext === 'review'"
              :tabindex="rightContext === 'review' ? 0 : -1"
              :class="
                cn(
                  'border-l border-border-subtle px-2.5 text-[10px] font-bold transition-colors',
                  rightContext === 'review'
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-variant',
                )
              "
              @click="rightContext = 'review'"
            >
              审阅
            </button>
          </div>
          <div v-if="rightContext === 'history'" class="flex min-w-0 flex-nowrap items-center justify-end gap-1">
            <span
              v-if="selectedCommitCount > 0"
              class="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary"
              >已选 {{ selectedCommitCount }}</span
            >
            <span
              v-if="hasCommitFilters"
              class="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary"
              >{{ commits.length }}</span
            >
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded border border-border-subtle text-on-surface hover:bg-surface-variant disabled:opacity-45"
              :disabled="commits.length === 0 || areAllVisibleCommitsSelected"
              title="选择全部可见提交"
              aria-label="选择全部可见提交"
              @click="selectVisibleCommits"
            >
              <Check :size="13" />
            </button>
            <button
              v-if="selectedCommitCount > 0"
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded border border-border-subtle text-on-surface-variant hover:bg-surface-variant"
              title="清空提交选择"
              aria-label="清空提交选择"
              @click="clearCommitSelection"
            >
              <X :size="13" />
            </button>
            <button
              type="button"
              :class="
                cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded border',
                  showCommitFilters || hasCommitFilters
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border-subtle text-on-surface',
                )
              "
              :title="showCommitFilters ? t.common.close : '筛选提交'"
              :aria-label="showCommitFilters ? t.common.close : '筛选提交'"
              :aria-pressed="showCommitFilters"
              @click="toggleCommitFilters"
            >
              <SlidersHorizontal :size="13" />
            </button>
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded border border-border-subtle bg-primary text-on-primary disabled:opacity-45"
              :disabled="!store.aiPreferences.model && store.aiPreferences.provider === 'utools'"
              title="AI 分析"
              aria-label="AI 分析"
              @click="openAiDialog"
            >
              <WandSparkles :size="13" />
            </button>
            <span class="mx-0.5 h-4 w-px bg-border-subtle" aria-hidden="true" />
            <button
              type="button"
              class="rounded p-1 text-on-surface-variant hover:bg-surface-variant disabled:opacity-40"
              :disabled="commits.length === 0"
              :title="t.git.scrollGraphToTop"
              :aria-label="t.git.scrollGraphToTop"
              @click="scrollGitPanel('graph', 'top')"
            >
              <ArrowUpToLine :size="12" />
            </button>
            <button
              type="button"
              class="rounded p-1 text-on-surface-variant hover:bg-surface-variant disabled:opacity-40"
              :disabled="commits.length === 0"
              :title="t.git.scrollGraphToBottom"
              :aria-label="t.git.scrollGraphToBottom"
              @click="scrollGitPanel('graph', 'bottom')"
            >
              <ArrowDownToLine :size="12" />
            </button>
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded border border-border-subtle text-on-surface-variant transition-colors hover:bg-surface-variant"
              :title="commitFileViewModeLabel"
              :aria-label="commitFileViewModeLabel"
              :aria-pressed="commitFileViewMode === 'tree'"
              @click="toggleCommitFileViewMode"
            >
              <List v-if="commitFileViewMode === 'tree'" :size="13" />
              <ListTree v-else :size="13" />
            </button>
          </div>
          <div v-else class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            <div class="min-w-0 flex-1 text-right">
              <div class="truncate font-mono text-[10px] font-bold text-on-surface">
                {{ worktreeSelection?.path || commitReviewSelection?.path || "选择文件开始审阅" }}
              </div>
              <div
                v-if="worktreeSelection || commitReviewSelection"
                class="truncate text-[9px] text-on-surface-variant"
              >
                {{ worktreeSelection ? worktreeSelection.scope : commitReviewSelection?.commitMessage }}
              </div>
            </div>
            <template v-if="worktreeSelection">
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant hover:bg-surface-variant disabled:opacity-35"
                :disabled="visibleWorktreeItems.length === 0"
                title="上一个可见文件"
                aria-label="上一个可见文件"
                @click="navigateWorktreeFile(-1)"
              >
                <ChevronLeft :size="14" />
              </button>
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant hover:bg-surface-variant disabled:opacity-35"
                :disabled="visibleWorktreeItems.length === 0"
                title="下一个可见文件"
                aria-label="下一个可见文件"
                @click="navigateWorktreeFile(1)"
              >
                <ChevronRight :size="14" />
              </button>
            </template>
          </div>
        </div>
        <div
          v-show="rightContext === 'review'"
          id="git-review-panel"
          role="tabpanel"
          aria-labelledby="git-review-tab"
          class="flex min-h-0 flex-1 flex-col"
        >
          <GitDiffViewer
            v-if="worktreeSelection || commitReviewSelection"
            v-model:scroll-top="reviewScrollTop"
            :diff="worktreeSelection ? worktreeDiff?.diff : selectedDiff?.diff"
            :loading="worktreeSelection ? isLoadingWorktreeDiff : isLoadingDiff"
            :message="(worktreeSelection ? worktreeDiff?.message : selectedDiff?.message) || t.git.diffEmpty"
          />
          <div
            v-else
            class="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-xs text-on-surface-variant"
          >
            从左侧变更列表或提交树展开文件中选择文件。
          </div>
        </div>
        <div
          v-show="rightContext === 'history'"
          id="git-commit-history-panel"
          role="tabpanel"
          aria-labelledby="git-history-tab"
          class="flex min-h-0 flex-1 flex-col"
        >
          <div class="flex min-h-0 flex-1 flex-col">
            <div class="border-b border-border-subtle bg-surface-container-low">
              <Transition name="fade">
                <div v-if="showCommitFilters" class="border-t border-border-subtle px-3 py-1.5">
                  <div
                    class="grid gap-1.5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(8.5rem,0.75fr)_minmax(8.5rem,0.75fr)_2rem]"
                  >
                    <input
                      v-model="commitKeyword"
                      type="text"
                      class="ui-field ui-field-compact"
                      :placeholder="t.git.keyword"
                    />
                    <input
                      v-model="commitAuthor"
                      type="text"
                      class="ui-field ui-field-compact"
                      :placeholder="t.git.author"
                    />
                    <div class="relative">
                      <button
                        type="button"
                        class="ui-field ui-field-compact flex w-full items-center justify-between gap-2 text-left"
                        @click.stop="openDatePicker('since')"
                      >
                        <span :class="commitSince ? 'text-on-surface' : 'text-on-surface-variant/70'">
                          {{ commitSince || t.git.since }}
                        </span>
                        <CalendarDays :size="13" class="text-on-surface-variant" />
                      </button>
                      <div v-if="openDatePickerKind === 'since'" class="date-picker-popover" @click.stop>
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
                        class="ui-field ui-field-compact flex w-full items-center justify-between gap-2 text-left"
                        @click.stop="openDatePicker('until')"
                      >
                        <span :class="commitUntil ? 'text-on-surface' : 'text-on-surface-variant/70'">
                          {{ commitUntil || t.git.until }}
                        </span>
                        <CalendarDays :size="13" class="text-on-surface-variant" />
                      </button>
                      <div
                        v-if="openDatePickerKind === 'until'"
                        class="date-picker-popover date-picker-popover-end"
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
                      class="inline-flex h-8 w-8 items-center justify-center rounded border border-border-subtle bg-transparent text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-45"
                      :disabled="!hasCommitFilters"
                      :title="t.git.clearFilters"
                      :aria-label="t.git.clearFilters"
                      @click="clearCommitFilters"
                    >
                      <X :size="13" />
                    </button>
                  </div>
                </div>
              </Transition>
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
                  <template v-for="(row, rowIndex) in graphRows" :key="row.commit.hash">
                    <div
                      :class="
                        cn(
                          'group relative z-10 grid min-w-[24rem] cursor-pointer items-center gap-1 rounded px-1.5 text-xs transition-colors hover:bg-surface-container-high',
                          isCommitSelected(row.commit.hash) &&
                            'bg-primary/5 ring-1 ring-primary/20 hover:bg-primary/10',
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
                      @pointerdown="hideCommitTooltip"
                      @click="toggleCommitFiles(row.commit.hash)"
                      @contextmenu.prevent="openCommitContextMenu($event, row.commit)"
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

                      <button
                        type="button"
                        class="truncate rounded text-left font-mono text-[10px] font-semibold text-on-surface-variant hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
                        :title="row.commit.hash"
                        :aria-label="`复制提交 hash ${row.commit.hash}`"
                        @click.stop="copyText(row.commit.hash)"
                      >
                        {{ shortCommitHash(row.commit.hash) }}
                      </button>
                      <button
                        type="button"
                        class="min-w-0 overflow-hidden rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
                        :aria-expanded="isCommitFilesExpanded(row.commit.hash)"
                        :aria-controls="`git-commit-files-${row.commit.hash}`"
                        @click.stop="toggleCommitFiles(row.commit.hash)"
                      >
                        <div class="flex min-w-0 items-center gap-1.5 leading-4">
                          <span
                            class="min-w-0 truncate text-[11px] font-semibold text-on-surface"
                            @mouseenter="showCommitTooltip($event, row.commit)"
                            @mouseleave="scheduleCommitTooltipClose"
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
                      </button>
                    </div>
                    <div
                      v-if="isCommitFilesExpanded(row.commit.hash)"
                      :id="`git-commit-files-${row.commit.hash}`"
                      class="relative z-10 overflow-hidden border-y border-outline-variant/50 bg-surface-container py-1 pr-2"
                      :style="{
                        height: `${expandedCommitFilesHeight(row.commit.hash)}px`,
                        minWidth: graphRowMinWidth,
                        paddingLeft: `${graphLayerLeft + graphColumnWidth + 4}px`,
                      }"
                      aria-live="polite"
                    >
                      <span
                        aria-hidden="true"
                        class="absolute bottom-1 top-1 w-px bg-primary/45"
                        :style="{ left: `${graphLayerLeft + graphColumnWidth}px` }"
                      ></span>
                      <div
                        v-if="expandedCommitFiles[row.commit.hash]?.isLoading"
                        class="flex h-full items-center gap-2 px-1.5 text-[10px] font-medium text-on-surface-variant"
                        aria-busy="true"
                      >
                        <span
                          class="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
                        ></span>
                        <span>正在加载变更...</span>
                      </div>
                      <div
                        v-else-if="expandedCommitFiles[row.commit.hash]?.error"
                        class="px-1.5 py-2 text-[10px] text-status-error"
                      >
                        {{ expandedCommitFiles[row.commit.hash]?.error }}
                      </div>
                      <div
                        v-else-if="!expandedCommitFiles[row.commit.hash]?.files.length"
                        class="px-1.5 py-2 text-[10px] text-on-surface-variant"
                      >
                        该提交暂无可显示的变更文件。
                      </div>
                      <div v-else class="themed-scrollbar h-full overflow-auto">
                        <template
                          v-for="item in commitFileDisplayItems(row.commit.hash)"
                          :key="`${row.commit.hash}:${item.key}`"
                        >
                          <button
                            v-if="item.kind === 'directory'"
                            type="button"
                            class="flex min-h-6 w-full items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-[10px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
                            :style="{ paddingLeft: `${6 + item.depth * 14}px` }"
                            :title="item.path"
                            :aria-label="`${item.isExpanded ? '收起' : '展开'}目录 ${item.path}`"
                            :aria-expanded="item.isExpanded"
                            @click.stop="toggleCommitDirectory(row.commit.hash, item.path)"
                          >
                            <ChevronDown v-if="item.isExpanded" :size="13" class="shrink-0 text-on-surface-variant" />
                            <ChevronRight v-else :size="13" class="shrink-0 text-on-surface-variant" />
                            <Folder :size="13" class="shrink-0 text-primary/75" />
                            <span class="min-w-0 truncate font-mono" :title="item.path">{{ item.name }}</span>
                          </button>
                          <button
                            v-else
                            type="button"
                            class="group grid min-h-6 w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-sm border border-transparent px-1.5 py-0.5 text-left transition-colors hover:border-outline-variant/50 hover:bg-surface-container-high"
                            :style="
                              commitFileViewMode === 'tree'
                                ? { paddingLeft: `${6 + (item.depth + 1) * 14}px` }
                                : undefined
                            "
                            :title="gitFileDisplayPath(item.file)"
                            @click.stop="handleViewDiff(row.commit.hash, item.file)"
                          >
                            <span
                              :class="
                                cn(
                                  'flex h-4 w-4 items-center justify-center rounded-[3px] font-mono text-[9px] font-black leading-none',
                                  item.file.status === 'ADDED' && 'bg-status-running/10 text-status-running',
                                  item.file.status === 'DELETED' && 'bg-status-error/10 text-status-error',
                                  item.file.status === 'RENAMED' && 'bg-secondary/10 text-secondary',
                                  item.file.status === 'UNTRACKED' && 'bg-primary/10 text-primary',
                                  item.file.status === 'MODIFIED' &&
                                    'bg-surface-container-highest text-on-surface-variant',
                                )
                              "
                              :title="fileLabel(item.file.status)"
                            >
                              {{ fileStatusCode(item.file.status) }}
                            </span>
                            <span class="flex min-w-0 items-baseline gap-1 overflow-hidden">
                              <span
                                :class="
                                  cn(
                                    'shrink-0 truncate font-mono text-[11px] font-semibold leading-4 text-on-surface group-hover:text-primary',
                                    item.file.status === 'DELETED' && 'text-on-surface-variant line-through',
                                  )
                                "
                              >
                                {{ gitFileName(item.file) }}
                              </span>
                              <span
                                v-if="commitFileViewMode === 'list' && gitFileDirectory(item.file)"
                                class="min-w-0 truncate text-[10px] leading-4 text-on-surface-variant/75"
                              >
                                {{ gitFileDirectory(item.file) }}
                              </span>
                            </span>
                            <span class="whitespace-nowrap font-mono text-[9px] font-semibold">
                              <span v-if="item.file.additions > 0" class="text-status-running"
                                >+{{ item.file.additions }}</span
                              >
                              <span v-if="item.file.deletions > 0" class="ml-1 text-status-error"
                                >-{{ item.file.deletions }}</span
                              >
                            </span>
                          </button>
                        </template>
                      </div>
                    </div>
                  </template>
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
      </div>
    </div>

    <Transition name="scale">
      <div
        v-if="isRemoteDialogOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
        @click.self="closeRemoteDialog"
      >
        <div
          class="w-[min(28rem,94vw)] overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-2xl"
          @click.stop
        >
          <div
            class="flex h-11 items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4"
          >
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-on-surface">
                {{ remoteDialogMode === "add" ? "添加 Git remote" : "编辑 Git remote" }}
              </h3>
              <p class="truncate text-[10px] font-medium text-on-surface-variant">
                {{ remoteDialogMode === "add" ? "配置远程仓库地址" : remoteFormName }}
              </p>
            </div>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="isAnyGitWriteRunning"
              :title="t.common.close"
              :aria-label="t.common.close"
              @click="closeRemoteDialog"
            >
              <X :size="15" />
            </button>
          </div>
          <div class="space-y-3 p-4">
            <label class="block text-xs font-bold text-on-surface">
              <span>Remote 名称</span>
              <input
                v-model="remoteFormName"
                type="text"
                class="ui-field mt-1 w-full font-mono"
                :disabled="remoteDialogMode === 'edit' || isAnyGitWriteRunning"
                placeholder="origin"
              />
            </label>
            <label class="block text-xs font-bold text-on-surface">
              <span>Remote URL</span>
              <input
                v-model="remoteFormUrl"
                type="text"
                class="ui-field mt-1 w-full font-mono"
                :disabled="isAnyGitWriteRunning"
                placeholder="git@github.com:owner/repo.git"
              />
            </label>
            <div class="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                class="inline-flex h-8 items-center rounded-lg border border-border-subtle bg-transparent px-3 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isAnyGitWriteRunning"
                @click="closeRemoteDialog"
              >
                {{ t.common.cancel }}
              </button>
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-primary px-3 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
                :disabled="isAnyGitWriteRunning"
                @click="submitRemoteDialog"
              >
                <Check :size="13" />
                {{ remoteDialogMode === "add" ? "添加" : "保存" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="scale">
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
              <div class="relative w-48">
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
              v-if="aiDialogNotice"
              class="shrink-0 rounded border border-status-warning/30 bg-status-warning/10 px-2.5 py-1.5 text-[10px] font-bold text-status-warning"
            >
              {{ aiDialogNotice }}
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
    </Transition>

    <ProjectActionDialog
      :open="Boolean(confirmationDialog)"
      :tone="confirmationDialog?.kind || 'danger'"
      :title="confirmationDialog?.title || ''"
      :message="confirmationDialog?.message || ''"
      :detail="confirmationDialog?.detail"
      :primary-label="confirmationDialog?.confirmLabel || ''"
      :cancel-label="confirmationDialog?.cancelLabel"
      :busy="isConfirmationRunning"
      busy-label="处理中"
      @cancel="closeConfirmationDialog"
      @primary="confirmRiskyAction"
    />
    <Teleport to="body">
      <div
        v-if="commitTooltip"
        class="commit-tooltip-panel fixed z-[70] flex w-max max-w-full select-text flex-col overflow-hidden rounded-lg border border-outline-variant/70 bg-surface-container-lowest text-left shadow-2xl"
        :style="commitTooltipStyle"
        @mouseenter="cancelCommitTooltipClose"
        @mouseleave="scheduleCommitTooltipClose"
      >
        <div class="shrink-0 border-b border-border-subtle bg-surface-container-low px-3 py-1.5">
          <div class="flex min-w-0 items-center gap-2">
            <div class="relative flex h-7 w-7 shrink-0 overflow-hidden rounded-full border border-outline-variant/70 bg-surface-container">
              <img
                v-if="commitTooltipDetailsFor(commitTooltip.commit.hash)?.avatarUrl"
                :src="commitTooltipDetailsFor(commitTooltip.commit.hash)?.avatarUrl || undefined"
                :alt="`${commitTooltip.commit.author} 的头像`"
                class="h-full w-full object-cover"
                referrerpolicy="no-referrer"
                @error="markCommitAvatarUnavailable(commitTooltip.commit.hash)"
              />
              <span
                v-else
                :class="
                  cn(
                    'flex h-full w-full items-center justify-center text-[10px] font-bold',
                    commitAuthorAvatarClass(commitTooltip.commit.author),
                    commitTooltipDetailsFor(commitTooltip.commit.hash)?.isLoadingAvatar && 'animate-pulse',
                  )
                "
                aria-hidden="true"
              >
                {{ commitAuthorInitials(commitTooltip.commit.author) }}
              </span>
            </div>
            <div class="min-w-0 flex flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span class="min-w-0 break-words text-[11px] font-bold leading-4 text-on-surface">
                {{ commitTooltip.commit.author }}
              </span>
              <span
                v-if="formatCommitTime(commitTooltip.commit.date).text"
                class="inline-flex items-center gap-1 text-[10px] font-semibold leading-4 text-on-surface-variant"
              >
                <Clock3 :size="11" class="shrink-0 text-on-surface-variant/70" />
                {{ formatCommitTime(commitTooltip.commit.date).text }}
              </span>
              <span
                v-if="formatCommitTime(commitTooltip.commit.date).title"
                class="break-words text-[10px] font-medium leading-4 text-on-surface-variant/80"
              >
                ({{ formatCommitTime(commitTooltip.commit.date).title }})
              </span>
            </div>
            <button
              type="button"
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant hover:bg-surface-variant hover:text-primary"
              :title="copyLabel(fullCommitMessage(commitTooltip.commit))"
              :aria-label="copyLabel(fullCommitMessage(commitTooltip.commit))"
              @click="copyText(fullCommitMessage(commitTooltip.commit))"
            >
              <ClipboardCopy :size="12" />
            </button>
          </div>
        </div>
        <div class="min-w-0 px-3 py-2">
          <p
            v-if="commitTooltipTitle(commitTooltip.commit)"
            class="break-words text-[12px] font-bold leading-5 text-on-surface"
          >
            {{ commitTooltipTitle(commitTooltip.commit) }}
          </p>
          <div
            v-if="commitTooltipBody(commitTooltip.commit)"
            :class="cn('commit-tooltip-body themed-scrollbar max-h-64 overflow-y-auto', commitTooltipTitle(commitTooltip.commit) && 'mt-1')"
          >
            <div
              class="memo-rendered commit-tooltip-rendered block text-on-surface"
              v-html="renderCommitMessage(commitTooltipBody(commitTooltip.commit))"
            ></div>
          </div>
          <div
            class="mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 border-t border-border-subtle/80 pt-2 text-[10px] font-medium leading-4"
            :aria-busy="commitTooltipSummary(commitTooltip.commit).state === 'loading'"
            aria-live="polite"
          >
            <span v-if="commitTooltipSummary(commitTooltip.commit).state === 'loading'" class="text-on-surface-variant">
              正在读取变更摘要...
            </span>
            <span v-else-if="commitTooltipSummary(commitTooltip.commit).state === 'unavailable'" class="text-on-surface-variant">
              变更摘要暂不可用
            </span>
            <template v-else>
              <span class="text-on-surface-variant">已更改 {{ commitTooltipSummary(commitTooltip.commit).fileCount }} 个文件,</span>
              <span class="text-status-running">{{ commitTooltipSummary(commitTooltip.commit).additions }} 行插入(+),</span>
              <span class="text-status-error">{{ commitTooltipSummary(commitTooltip.commit).deletions }} 行删除(-)</span>
            </template>
          </div>
          <div
            v-if="refsForCommit(commitTooltip.commit.refs).length"
            class="mt-2 flex flex-wrap gap-1"
          >
            <span
              v-for="refName in refsForCommit(commitTooltip.commit.refs)"
              :key="`tooltip-${commitTooltip.commit.hash}-${refName}`"
              :class="refClass(refName)"
            >
              {{ refName }}
            </span>
          </div>
        </div>
      </div>
      <div
        v-if="commitContextMenu"
        ref="commitContextMenuRef"
        data-commit-context-menu
        role="menu"
        aria-label="提交操作"
        class="themed-scrollbar fixed z-[75] max-h-80 w-[200px] overflow-y-auto rounded-md border border-outline-variant/70 bg-surface-container-lowest p-1 shadow-2xl"
        :style="commitContextMenuStyle"
        @click.stop
      >
        <template v-if="commitLocalBranchNames(commitContextMenu.commit).length > 0">
          <div
            class="flex h-7 items-center gap-2 px-2 text-[10px] font-bold text-on-surface-variant"
            role="presentation"
          >
            <ArrowRightLeft :size="14" />
            <span>切换到分支</span>
          </div>
          <button
            v-for="branchName in commitLocalBranchNames(commitContextMenu.commit)"
            :key="`${commitContextMenu.commit.hash}:${branchName}`"
            type="button"
            role="menuitem"
            class="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] font-semibold text-on-surface transition-colors hover:bg-surface-variant focus-visible:bg-surface-variant focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="isGitActionRunning"
            :title="branchCheckoutTitle(branchName)"
            @click="handleCheckoutCommitBranch(branchName)"
          >
            <GitBranch :size="13" class="shrink-0 text-on-surface-variant" />
            <span class="min-w-0 flex-1 truncate">{{ branchName }}</span>
            <span
              v-if="branchName === snapshot?.branch && !snapshot?.isDetachedHead"
              class="shrink-0 text-[9px] text-on-surface-variant/70"
            >
              当前
            </span>
          </button>
        </template>
        <button
          v-else
          type="button"
          role="menuitem"
          class="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-on-surface transition-colors hover:bg-surface-variant focus-visible:bg-surface-variant focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
          :disabled="isGitActionRunning || !canCheckoutDetachedCommit(commitContextMenu.commit)"
          :title="detachedCheckoutTitle(commitContextMenu.commit)"
          @click="handleCheckoutCommit(commitContextMenu.commit)"
        >
          <GitCommitHorizontal :size="13" class="shrink-0 text-on-surface-variant" />
          <span class="min-w-0 flex-1 truncate text-[11px] font-semibold">
            {{ activeGitAction === `checkout:${commitContextMenu.commit.hash}` ? "正在切换" : "切换到此提交" }}
          </span>
          <span
            class="shrink-0 rounded bg-surface-container-high px-1 py-0.5 text-[8px] font-bold text-on-surface-variant"
          >
            分离 HEAD
          </span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
