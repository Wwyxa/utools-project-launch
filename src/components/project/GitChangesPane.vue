<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Archive,
  Check,
  CircleCheck,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Undo,
  WandSparkles,
  X,
} from "lucide-vue-next";
import {
  AI_COMMIT_MESSAGE_MODE_ID,
  DEFAULT_AI_COMMIT_MESSAGE_PROMPT,
  type ProjectGitDiffScope,
  type ProjectGitFileChange,
  type ProjectGitRepositoryTarget,
} from "../../types";
import {
  aiReasoningCopyText,
  aiReasoningStateFromResult,
  appendAiStreamChunk,
  createAiReasoningStreamState,
  hasAiReasoningDisplay,
} from "../../lib/aiReasoning";
import { cn, transferWheelAtScrollBoundary } from "../../lib/utils";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import ActionDialog from "../ActionDialog.vue";

type AiState = "idle" | "loading" | "success" | "warning" | "error";
type GitFeedbackState = Exclude<AiState, "idle">;
type GitFileActionName = "stage" | "unstage" | "discard";
type WorktreeDiffScope = Exclude<ProjectGitDiffScope, "combined">;
type FileReviewSelection = { path: string; scope: WorktreeDiffScope };
type ActiveGitFileAction = { action: GitFileActionName; path: string };
type AppActionDialog = {
  tone?: "danger" | "warning";
  icon?: "alert" | "trash" | "undo";
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
};
type WorktreeGroup = {
  scope: WorktreeDiffScope;
  label: string;
  open: boolean;
  files: ProjectGitFileChange[];
};

const props = withDefaults(
  defineProps<{
    projectId: string;
    repositoryTarget: ProjectGitRepositoryTarget;
    open: boolean;
    toolbarTarget?: HTMLElement | null;
    commitMessage: string;
    selection: FileReviewSelection | null;
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{
  (event: "update:open", value: boolean): void;
  (event: "update:commitMessage", value: string): void;
  (event: "select-file", selection: FileReviewSelection | null): void;
  (event: "open-file", relativePath: string): void;
  (event: "feedback", state: GitFeedbackState, message: string): void;
  (event: "busy-change", busy: boolean): void;
  (event: "worktree-action-started"): void;
  (event: "committed"): void;
}>();

const store = useStore();
const t = useI18n();
const filesScrollRef = ref<HTMLDivElement | null>(null);
const commitMessageTextareaRef = ref<HTMLTextAreaElement | null>(null);
const stagedGroupOpen = ref(true);
const unstagedGroupOpen = ref(true);
const activeGitAction = ref("");
const activeGitFileActions = ref<ActiveGitFileAction[]>([]);
const commitMessageAiResult = ref(createAiReasoningStreamState());
const commitMessageAiState = ref<AiState>("idle");
const confirmationDialog = ref<AppActionDialog | null>(null);
const isConfirmationRunning = ref(false);
const isAmendMode = ref(false);
const preAmendDraft = ref<string | null>(null);
const amendOriginalMessage = ref("");
const amendCommitMessage = ref("");
const moreMenuOpen = ref(false);
const moreMenuPosition = ref({ left: 8, top: 8 });
const moreMenuRef = ref<HTMLElement | null>(null);
const moreMenuOpener = ref<HTMLElement | null>(null);
const stashDialogOpen = ref(false);
const stashMessage = ref("");
const stashIncludeUntracked = ref(false);
const stashMessageInputRef = ref<HTMLInputElement | null>(null);
const stashDialogOpener = ref<HTMLElement | null>(null);
const repositoryContextGeneration = ref(0);
const commitMessageTextareaMinHeight = 32;
const commitMessageTextareaMaxHeight = 144;

const activeRepositoryContext = computed(() =>
  store.resolveGitRepositoryContext(props.projectId, props.repositoryTarget),
);
const snapshot = computed(() => store.gitSnapshotForRepository(props.projectId, props.repositoryTarget));
const files = computed(() => snapshot.value?.files || []);
const headCommit = computed(
  () =>
    snapshot.value?.commits?.find((commit) => commit.refNames?.some((ref) => ref.kind === "head" && ref.head)) ??
    snapshot.value?.commits?.find((commit) =>
      (commit.refs || "").split(",").some((ref) => ref.trim() === "HEAD" || /^HEAD ->\s+\S+$/.test(ref.trim())),
    ) ??
    null,
);
const headCommitMessage = computed(() => (headCommit.value?.body || headCommit.value?.message || "").trim());
const headActionBlockedMessage = computed(() => {
  if (props.disabled) return "当前仓库不可用，无法执行 Git 操作。";
  if (isChangesWriteBusy.value) return "正在执行 Git 操作。";
  if (!activeRepositoryContext.value || !snapshot.value?.repositoryPath) return "未检测到 Git 仓库。";
  if (snapshot.value.isDetachedHead) return "当前 HEAD 处于 detached 状态，请使用外部 Git 工具处理。";
  if (!(snapshot.value.branches || []).some((branch) => branch.current)) {
    return "当前 HEAD 未指向本地分支，请使用外部 Git 工具处理。";
  }
  if (!headCommit.value) return "当前分支没有可操作的提交。";
  return "";
});
const canStageFile = (file: ProjectGitFileChange) => file.unstaged || (!file.staged && file.unstaged !== false);
const canUnstageFile = (file: ProjectGitFileChange) => Boolean(file.staged);
const stageableFiles = computed(() => files.value.filter(canStageFile));
const unstageableFiles = computed(() => files.value.filter(canUnstageFile));
const discardableFiles = computed(() => files.value);
const stagedFiles = computed(() => files.value.filter((file) => file.staged));
const hasStagedChanges = computed(() => stagedFiles.value.length > 0);
const worktreeGroups = computed<WorktreeGroup[]>(() => [
  ...(stagedFiles.value.length > 0
    ? [{ scope: "staged" as const, label: "暂存的更改", open: stagedGroupOpen.value, files: stagedFiles.value }]
    : []),
  { scope: "unstaged" as const, label: "更改", open: unstagedGroupOpen.value, files: stageableFiles.value },
]);
const visibleWorktreeItems = computed(() =>
  worktreeGroups.value.flatMap((group) =>
    group.open ? group.files.map((file) => ({ file, scope: group.scope })) : [],
  ),
);
const isChangesWriteBusy = computed(() => Boolean(activeGitAction.value) || activeGitFileActions.value.length > 0);
const isStashDialogBusy = computed(() => activeGitAction.value === "stash");
const canCreateStash = computed(() => !props.disabled && !isChangesWriteBusy.value && files.value.length > 0);
const composerCommitMessage = computed(() => (isAmendMode.value ? amendCommitMessage.value : props.commitMessage));
const amendMessageChanged = computed(() => composerCommitMessage.value.trim() !== amendOriginalMessage.value);
const canCommitStaged = computed(() => {
  if (props.disabled || isChangesWriteBusy.value || !composerCommitMessage.value.trim()) return false;
  if (!isAmendMode.value) return hasStagedChanges.value;
  return !headActionBlockedMessage.value && (hasStagedChanges.value || amendMessageChanged.value);
});
const canStartAmend = computed(() => !isAmendMode.value && !headActionBlockedMessage.value);
const canUndoLastCommit = computed(() => !headActionBlockedMessage.value);
const isCommitActionActive = computed(() => activeGitAction.value === "commit" || activeGitAction.value === "amend");
const amendActionTitle = computed(() =>
  headActionBlockedMessage.value
    ? headActionBlockedMessage.value
    : isAmendMode.value
      ? "当前已处于修订上次提交模式"
      : "修订上次提交",
);
const undoLastCommitTitle = computed(() => headActionBlockedMessage.value || "撤销上次提交");
const commitActionTitle = computed(() => {
  if (isCommitActionActive.value) return isAmendMode.value ? "正在修订上次提交" : "正在提交 staged 变更";
  if (!isAmendMode.value) return hasStagedChanges.value ? "提交 staged 变更" : "没有 staged 变更可提交";
  if (headActionBlockedMessage.value) return headActionBlockedMessage.value;
  if (!composerCommitMessage.value.trim()) return "请先填写 commit message";
  return hasStagedChanges.value || amendMessageChanged.value ? "修订上次提交" : "修改提交信息或暂存变更后才能修订";
});
const commitMessageAiMode = computed(
  () =>
    store.aiPreferences.modes.find((mode) => mode.id === AI_COMMIT_MESSAGE_MODE_ID) ||
    store.aiPreferences.modes.find((mode) => mode.kind === "commit-message") ||
    null,
);
const commitMessagePromptTemplate = computed(
  () => commitMessageAiMode.value?.prompt.trim() || DEFAULT_AI_COMMIT_MESSAGE_PROMPT,
);

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

const reportFeedback = (state: GitFeedbackState, message: string) => emit("feedback", state, message);

const waitForVisualFeedback = async () => {
  await nextTick();
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
};

const moreMenuStyle = computed(() => ({
  left: `${moreMenuPosition.value.left}px`,
  top: `${moreMenuPosition.value.top}px`,
}));

const moreMenuItems = () =>
  moreMenuRef.value
    ? Array.from(moreMenuRef.value.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
        (item) => !(item instanceof HTMLButtonElement && item.disabled),
      )
    : [];

const closeMoreMenu = (restoreFocus = true) => {
  const opener = moreMenuOpener.value;
  moreMenuOpen.value = false;
  moreMenuOpener.value = null;
  if (restoreFocus) void nextTick(() => opener?.isConnected && opener.focus());
};

const openMoreMenu = async (trigger: HTMLElement) => {
  moreMenuOpener.value = trigger;
  moreMenuOpen.value = true;
  await nextTick();
  const menu = moreMenuRef.value;
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu?.getBoundingClientRect();
  const menuWidth = menuRect?.width || 112;
  const menuHeight = menuRect?.height || 80;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const left = Math.max(8, Math.min(triggerRect.right - menuWidth, viewportWidth - menuWidth - 8));
  const belowTop = triggerRect.bottom + 6;
  const top = belowTop + menuHeight <= viewportHeight - 8 ? belowTop : Math.max(8, triggerRect.top - menuHeight - 6);
  moreMenuPosition.value = { left, top };
  moreMenuItems()[0]?.focus();
};

const toggleMoreMenu = (event: MouseEvent) => {
  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!trigger) return;
  if (moreMenuOpen.value) {
    closeMoreMenu();
    return;
  }
  void openMoreMenu(trigger);
};

const handleMoreMenuKeydown = (event: KeyboardEvent) => {
  const current = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
  const items = moreMenuItems();
  if (!current || items.length === 0) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeMoreMenu();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const index = Math.max(0, items.indexOf(current));
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    items[event.key === "Home" ? 0 : items.length - 1]?.focus();
  }
};

const handleMoreMenuPointerDown = (event: PointerEvent) => {
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest("[data-git-changes-more-menu], [data-git-changes-more-menu-trigger]")
  ) {
    return;
  }
  closeMoreMenu(false);
};

const handleMoreMenuViewportChange = () => closeMoreMenu(false);

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
const isGitFileActionActive = (action: GitFileActionName, file: ProjectGitFileChange) =>
  activeGitFileActions.value.some((item) => item.action === action && item.path === file.path);
const isGitFileBusy = (file: ProjectGitFileChange) =>
  activeGitFileActions.value.some((item) => item.path === file.path);
const canRunFileAction = (file: ProjectGitFileChange | null, action: GitFileActionName) => {
  if (!file || props.disabled || activeGitAction.value || isGitFileBusy(file)) return false;
  if (action === "stage") return canStageFile(file);
  if (action === "unstage") return canUnstageFile(file);
  return true;
};

const isWorktreeSelected = (path: string, scope: WorktreeDiffScope) =>
  props.selection?.path === path && props.selection.scope === scope;
const resolveVisibleSelection = (selection: FileReviewSelection | null) => {
  if (!selection) return null;
  return visibleWorktreeItems.value.some((item) => item.file.path === selection.path && item.scope === selection.scope)
    ? selection
    : null;
};

const reconcileWorktreeSelection = (
  action: GitFileActionName,
  file: ProjectGitFileChange,
  sourceSelection: FileReviewSelection | null,
  discardSuccessor: FileReviewSelection | null,
) => {
  if (!sourceSelection || !isWorktreeSelected(file.path, sourceSelection.scope)) return;
  if (action === "discard") {
    emit("select-file", resolveVisibleSelection(discardSuccessor));
    return;
  }

  const targetScope: WorktreeDiffScope = action === "stage" ? "staged" : "unstaged";
  const targetFiles = targetScope === "staged" ? stagedFiles.value : stageableFiles.value;
  if (!targetFiles.some((item) => item.path === file.path)) {
    emit("select-file", null);
    return;
  }
  if (targetScope === "staged") stagedGroupOpen.value = true;
  else unstagedGroupOpen.value = true;
  emit("select-file", { path: file.path, scope: targetScope });
};

const executeGitFileAction = async (
  action: GitFileActionName,
  file: ProjectGitFileChange,
  sourceSelection: FileReviewSelection | null = null,
  discardSuccessor: FileReviewSelection | null = null,
) => {
  if (props.disabled || activeGitAction.value || isGitFileBusy(file)) return;

  emit("worktree-action-started");
  activeGitFileActions.value = [...activeGitFileActions.value, { action, path: file.path }];
  reportFeedback("loading", gitFileActionLoadingMessage(action));
  await waitForVisualFeedback();
  try {
    const result =
      action === "stage"
        ? await store.stageGitFile(props.projectId, file.path, props.repositoryTarget)
        : action === "unstage"
          ? await store.unstageGitFile(props.projectId, file.path, props.repositoryTarget)
          : await store.discardGitFile(props.projectId, file.path, props.repositoryTarget);
    if (!result) {
      reportFeedback("warning", "当前项目不可用，无法执行 Git 操作。");
      return;
    }

    reportFeedback(result.ok ? "success" : "error", result.message);
    if (result.ok) reconcileWorktreeSelection(action, file, sourceSelection, discardSuccessor);
  } catch (error) {
    reportFeedback("error", error instanceof Error ? error.message : "Git 操作失败。");
  } finally {
    activeGitFileActions.value = activeGitFileActions.value.filter(
      (item) => item.action !== action || item.path !== file.path,
    );
  }
};

const executeBulkGitFileAction = async (action: GitFileActionName) => {
  if (props.disabled || activeGitAction.value || activeGitFileActions.value.length > 0) return;
  const targetFiles = bulkActionTargetFiles(action);
  if (targetFiles.length === 0) {
    reportFeedback("warning", bulkActionTitle(action));
    return;
  }

  const sourceSelection = props.selection ? { ...props.selection } : null;
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
  const totalFiles = targetFiles.length;

  emit("worktree-action-started");
  activeGitAction.value = `bulk:${action}`;
  reportFeedback("loading", gitBulkActionLoadingMessage(action, totalFiles));
  await waitForVisualFeedback();
  try {
    const paths = targetFiles.map((file) => file.path);
    const result =
      action === "stage"
        ? await store.stageGitFiles(props.projectId, paths, { all: true }, props.repositoryTarget)
        : action === "unstage"
          ? await store.unstageGitFiles(props.projectId, paths, { all: true }, props.repositoryTarget)
          : await store.discardGitFiles(props.projectId, paths, { all: true }, props.repositoryTarget);
    if (!result) {
      reportFeedback("warning", "当前项目不可用，无法执行 Git 操作。");
      return;
    }

    reportFeedback(result.ok ? "success" : "error", result.message);
    if (result.ok && selectedFile) reconcileWorktreeSelection(action, selectedFile, sourceSelection, discardSuccessor);
  } catch (error) {
    reportFeedback("error", error instanceof Error ? error.message : "Git 操作失败。");
  } finally {
    activeGitAction.value = "";
  }
};

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

const requestDiscardGitFile = (file: ProjectGitFileChange, scope: WorktreeDiffScope) => {
  if (props.disabled || activeGitAction.value || isGitFileBusy(file)) return;
  const sourceSelection = isWorktreeSelected(file.path, scope) ? { path: file.path, scope } : null;
  const currentIndex = visibleWorktreeItems.value.findIndex(
    (item) => item.file.path === file.path && item.scope === scope,
  );
  const nextItem = currentIndex >= 0 ? visibleWorktreeItems.value[currentIndex + 1] : undefined;
  const discardSuccessor = nextItem?.scope === scope ? { path: nextItem.file.path, scope } : null;
  confirmationDialog.value = {
    icon: "trash",
    title: "丢弃文件变更",
    message: "此操作会还原该文件在工作区与暂存区中的本地变更。",
    detail: gitFileDisplayPath(file),
    confirmLabel: "丢弃变更",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeGitFileAction("discard", file, sourceSelection, discardSuccessor),
  };
};

const requestDiscardAllGitFiles = () => {
  if (
    props.disabled ||
    activeGitAction.value ||
    activeGitFileActions.value.length > 0 ||
    discardableFiles.value.length === 0
  ) {
    return;
  }
  confirmationDialog.value = {
    icon: "trash",
    title: "丢弃全部文件变更",
    message: `此操作会还原 ${discardableFiles.value.length} 个 changed 文件在工作区与暂存区中的本地变更。`,
    detail: discardableFiles.value.map(gitFileDisplayPath).join("\n"),
    confirmLabel: "丢弃全部",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeBulkGitFileAction("discard"),
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

const closeConfirmationDialog = () => {
  if (!isConfirmationRunning.value) confirmationDialog.value = null;
};

const setComposerCommitMessage = (message: string) => {
  if (isAmendMode.value) {
    amendCommitMessage.value = message;
    return;
  }
  emit("update:commitMessage", message);
};

const leaveAmendMode = (restoreDraft: boolean) => {
  const draft = preAmendDraft.value;
  isAmendMode.value = false;
  preAmendDraft.value = null;
  amendOriginalMessage.value = "";
  amendCommitMessage.value = "";
  if (restoreDraft && draft !== null && props.commitMessage !== draft) emit("update:commitMessage", draft);
};

const startAmendMode = () => {
  if (!canStartAmend.value) return;
  const message = headCommitMessage.value;
  closeMoreMenu(false);
  preAmendDraft.value = props.commitMessage;
  amendOriginalMessage.value = message;
  amendCommitMessage.value = message;
  isAmendMode.value = true;
  scheduleCommitMessageTextareaResize();
};

const cancelAmendMode = () => {
  leaveAmendMode(true);
  closeMoreMenu(false);
};

const closeStashDialog = (restoreFocus = true, force = false) => {
  if (isStashDialogBusy.value && !force) return;
  stashDialogOpen.value = false;
  const opener = stashDialogOpener.value;
  stashDialogOpener.value = null;
  if (restoreFocus) void nextTick(() => opener?.isConnected && opener.focus());
};

const openStashDialog = async (event: MouseEvent) => {
  if (!canCreateStash.value) return;
  stashDialogOpener.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  stashMessage.value = "";
  stashIncludeUntracked.value = false;
  stashDialogOpen.value = true;
  await nextTick();
  stashMessageInputRef.value?.focus();
};

const handleCreateGitStash = async () => {
  if (!canCreateStash.value) return;
  let saved = false;
  emit("worktree-action-started");
  activeGitAction.value = "stash";
  reportFeedback("loading", t.value.git.stashSaving);
  await waitForVisualFeedback();
  try {
    const result = await store.createGitStash(
      props.projectId,
      stashMessage.value,
      { includeUntracked: stashIncludeUntracked.value },
      props.repositoryTarget,
    );
    if (!result) {
      reportFeedback("warning", "当前项目不可用，无法保存到 stash。");
      return;
    }
    reportFeedback(result.ok ? "success" : "error", result.message);
    if (result.ok) {
      saved = true;
      emit("select-file", null);
    }
  } catch (error) {
    reportFeedback("error", error instanceof Error ? error.message : "保存到 stash 失败。");
  } finally {
    activeGitAction.value = "";
    if (saved) closeStashDialog();
  }
};

const confirmRiskyAction = async () => {
  const dialog = confirmationDialog.value;
  if (!dialog || isConfirmationRunning.value) return;

  isConfirmationRunning.value = true;
  try {
    await dialog.onConfirm();
    if (confirmationDialog.value === dialog) confirmationDialog.value = null;
  } finally {
    isConfirmationRunning.value = false;
  }
};

const executeAmendLastCommit = async () => {
  const originContext = activeRepositoryContext.value;
  if (!originContext || !isAmendMode.value || !canCommitStaged.value) return;
  const originContextKey = originContext.contextKey;
  const originGeneration = repositoryContextGeneration.value;
  const isOriginVisible = () =>
    repositoryContextGeneration.value === originGeneration &&
    activeRepositoryContext.value?.contextKey === originContextKey;

  activeGitAction.value = "amend";
  reportFeedback("loading", "正在修订上次提交...");
  await waitForVisualFeedback();
  try {
    const result = await store.amendGitCommit(
      props.projectId,
      composerCommitMessage.value.trim(),
      originContext.target,
    );
    if (!isOriginVisible()) return;
    if (!result) {
      reportFeedback("warning", "当前项目不可用，无法修订上次提交。");
      return;
    }
    reportFeedback(result.ok ? "success" : "error", result.message);
    if (result.ok) {
      leaveAmendMode(false);
      emit("update:commitMessage", "");
      emit("committed");
    }
  } catch (error) {
    if (isOriginVisible()) reportFeedback("error", error instanceof Error ? error.message : "修订上次提交失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const requestAmendLastCommit = () => {
  if (!isAmendMode.value || !canCommitStaged.value) return;
  confirmationDialog.value = {
    tone: "warning",
    title: "修订上次提交",
    message: "此操作会重写当前 HEAD 提交。确认后，提交信息和 staged 变更会合并到上次提交。",
    detail: headCommit.value?.message || "",
    confirmLabel: "修订提交",
    cancelLabel: t.value.common.cancel,
    onConfirm: executeAmendLastCommit,
  };
};

const executeUndoLastCommit = async (allowMerge = false) => {
  const originContext = activeRepositoryContext.value;
  if (!originContext || !canUndoLastCommit.value) return;
  const originContextKey = originContext.contextKey;
  const originGeneration = repositoryContextGeneration.value;
  const isOriginVisible = () =>
    repositoryContextGeneration.value === originGeneration &&
    activeRepositoryContext.value?.contextKey === originContextKey;

  activeGitAction.value = "undo-last-commit";
  reportFeedback("loading", "正在撤销上次提交...");
  await waitForVisualFeedback();
  try {
    const result = await store.undoLastGitCommit(props.projectId, { allowMerge }, originContext.target);
    if (!isOriginVisible()) return;
    if (!result) {
      reportFeedback("warning", "当前项目不可用，无法撤销上次提交。");
      return;
    }
    if (!result.ok && result.blockReason === "merge-commit" && !allowMerge) {
      if (!props.open) return;
      confirmationDialog.value = {
        tone: "danger",
        icon: "undo",
        title: "按第一父提交撤销 merge commit",
        message: "上次提交是 merge commit。继续会按第一父提交移除该提交，并保留文件改动。",
        detail: headCommit.value?.message || "",
        confirmLabel: "按第一父提交撤销",
        cancelLabel: t.value.common.cancel,
        onConfirm: () => executeUndoLastCommit(true),
      };
      return;
    }
    reportFeedback(result.ok ? "success" : "error", result.message);
    if (result.ok) {
      leaveAmendMode(false);
      if (typeof result.commitMessage === "string") emit("update:commitMessage", result.commitMessage);
      emit("committed");
    }
  } catch (error) {
    if (isOriginVisible()) reportFeedback("error", error instanceof Error ? error.message : "撤销上次提交失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const requestUndoLastCommit = () => {
  if (!canUndoLastCommit.value) return;
  closeMoreMenu(false);
  confirmationDialog.value = {
    tone: "danger",
    icon: "undo",
    title: "撤销上次提交",
    message: "此操作将恢复上个提交的暂存和提交信息，不创建反向提交",
    detail: headCommit.value?.message || "",
    confirmLabel: "撤销",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeUndoLastCommit(),
  };
};

const handleCommitStaged = async () => {
  if (isAmendMode.value) {
    requestAmendLastCommit();
    return;
  }
  if (props.disabled || activeGitAction.value || activeGitFileActions.value.length > 0) return;
  const message = props.commitMessage.trim();
  if (!message) {
    reportFeedback("warning", "请先填写 commit message。");
    return;
  }
  if (!hasStagedChanges.value) {
    reportFeedback("warning", "没有 staged 变更可提交。");
    return;
  }

  activeGitAction.value = "commit";
  reportFeedback("loading", "正在提交 staged 变更...");
  await waitForVisualFeedback();
  try {
    const result = await store.commitGitStaged(props.projectId, message, props.repositoryTarget);
    if (!result) {
      reportFeedback("warning", "当前项目不可用，无法提交。");
      return;
    }
    reportFeedback(result.ok ? "success" : "error", result.message);
    if (result.ok) {
      emit("update:commitMessage", "");
      emit("committed");
    }
  } catch (error) {
    reportFeedback("error", error instanceof Error ? error.message : "提交失败。");
  } finally {
    activeGitAction.value = "";
  }
};

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

const buildCommitMessagePrompt = async (projectId: string, target: ProjectGitRepositoryTarget) => {
  const diffResult = await store.readGitCommitMessageDiff(projectId, target);
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
  if (props.disabled || commitMessageAiState.value === "loading") return;
  if (!store.aiPreferences.provider) {
    reportFeedback("warning", t.value.git.aiUnavailable);
    commitMessageAiState.value = "warning";
    return;
  }

  const originContext = activeRepositoryContext.value;
  if (!originContext) {
    reportFeedback("warning", "当前仓库不可用，无法生成 commit message。");
    return;
  }
  const originProjectId = props.projectId;
  const originContextKey = originContext.contextKey;
  const originGeneration = repositoryContextGeneration.value;
  let originResult = createAiReasoningStreamState();
  commitMessageAiResult.value = originResult;
  commitMessageAiState.value = "loading";
  reportFeedback("loading", "正在生成 commit message...");
  const isOriginVisible = () =>
    repositoryContextGeneration.value === originGeneration &&
    activeRepositoryContext.value?.contextKey === originContextKey;

  try {
    await waitForVisualFeedback();
    const promptResult = await buildCommitMessagePrompt(originProjectId, originContext.target);
    if (!promptResult.ok) {
      if (isOriginVisible()) {
        reportFeedback("warning", promptResult.message);
        commitMessageAiState.value = "warning";
      }
      return;
    }
    if (!isOriginVisible()) return;

    await store.analyzeGitWithAiStream(originProjectId, promptResult.prompt, {
      onChunk: (chunk) => {
        originResult = appendAiStreamChunk(originResult, chunk);
        if (isOriginVisible()) {
          commitMessageAiResult.value = originResult;
          const generated = aiReasoningCopyText(originResult);
          if (generated) setComposerCommitMessage(generated);
        }
      },
      onDone: (result) => {
        const finalResult = aiReasoningStateFromResult(result);
        if (hasAiReasoningDisplay(finalResult) || !hasAiReasoningDisplay(originResult)) {
          originResult = finalResult;
        }
        const generated = aiReasoningCopyText(originResult).trim();
        if (result.ok && generated) {
          if (isOriginVisible()) {
            commitMessageAiResult.value = originResult;
            commitMessageAiState.value = "success";
            setComposerCommitMessage(generated);
            reportFeedback("success", "已填入提交信息。");
          }
          return;
        }
        if (isOriginVisible()) {
          reportFeedback(
            result.ok ? "warning" : "error",
            result.ok ? "AI 已返回成功，但没有生成内容。" : result.message || "AI 生成失败。",
          );
          commitMessageAiState.value = result.ok ? "warning" : "error";
        }
      },
    });
  } catch (error) {
    if (isOriginVisible()) {
      reportFeedback("error", error instanceof Error ? error.message : "AI 生成失败。");
      commitMessageAiState.value = "error";
    }
  }
};

const toggleGroup = (scope: WorktreeDiffScope) => {
  if (scope === "staged") stagedGroupOpen.value = !stagedGroupOpen.value;
  else unstagedGroupOpen.value = !unstagedGroupOpen.value;
};

const handleCommitMessageInput = (event: Event) => {
  setComposerCommitMessage((event.target as HTMLTextAreaElement).value);
  resizeCommitMessageTextarea();
};

const handlePanelWheel = (event: WheelEvent) => {
  transferWheelAtScrollBoundary(event, filesScrollRef.value);
};

const requestOpenFile = (file: ProjectGitFileChange) => {
  if (file.status !== "DELETED") emit("open-file", file.path);
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (event.detail.handled) return;
  if (moreMenuOpen.value) {
    closeMoreMenu();
    event.detail.handle();
    return;
  }
  if (!stashDialogOpen.value || isStashDialogBusy.value) return;
  closeStashDialog();
  event.detail.handle();
};

let stopAppEscapeListener = () => {};
onMounted(() => {
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
  window.addEventListener("pointerdown", handleMoreMenuPointerDown);
  window.addEventListener("resize", handleMoreMenuViewportChange);
  window.addEventListener("scroll", handleMoreMenuViewportChange, true);
});

watch(isChangesWriteBusy, (busy) => emit("busy-change", busy), { immediate: true });

watch(
  () => activeRepositoryContext.value?.contextKey,
  () => {
    repositoryContextGeneration.value += 1;
    closeMoreMenu(false);
    leaveAmendMode(false);
    confirmationDialog.value = null;
    closeStashDialog(false, true);
    commitMessageAiResult.value = createAiReasoningStreamState();
    commitMessageAiState.value = "idle";
  },
  { immediate: true },
);

watch(
  () => props.projectId,
  () => {
    stagedGroupOpen.value = true;
    unstagedGroupOpen.value = true;
  },
);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      closeMoreMenu(false);
      confirmationDialog.value = null;
      leaveAmendMode(true);
    }
  },
);

watch([() => composerCommitMessage.value, () => props.open], scheduleCommitMessageTextareaResize, { immediate: true });

onBeforeUnmount(() => {
  closeMoreMenu(false);
  leaveAmendMode(false);
  stopAppEscapeListener();
  window.removeEventListener("pointerdown", handleMoreMenuPointerDown);
  window.removeEventListener("resize", handleMoreMenuViewportChange);
  window.removeEventListener("scroll", handleMoreMenuViewportChange, true);
  repositoryContextGeneration.value += 1;
  emit("busy-change", false);
});
</script>

<template>
  <section class="flex min-h-8 flex-col overflow-hidden">
    <div v-show="!toolbarTarget" class="git-section-bar">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-bold text-on-surface"
        :aria-expanded="open"
        :title="open ? '收起更改' : '展开更改'"
        :aria-label="open ? '收起更改' : '展开更改'"
        @click="emit('update:open', !open)"
      >
        <ChevronDown v-if="open" :size="13" class="shrink-0 text-on-surface-variant" />
        <ChevronRight v-else :size="13" class="shrink-0 text-on-surface-variant" />
        <h3 class="min-w-0 truncate">更改</h3>
        <span class="shrink-0 font-mono text-[10px] font-semibold text-on-surface-variant">{{ files.length }}</span>
      </button>
      <Teleport :to="toolbarTarget || 'body'" :disabled="!toolbarTarget">
        <div class="flex shrink-0 items-center gap-px">
          <button
            type="button"
            class="git-section-action git-section-ai-action"
            :disabled="disabled || isChangesWriteBusy || commitMessageAiState === 'loading'"
            :aria-busy="commitMessageAiState === 'loading'"
            :title="commitMessageAiState === 'loading' ? '正在生成 commit message' : 'AI 生成 commit message'"
            :aria-label="commitMessageAiState === 'loading' ? '正在生成 commit message' : 'AI 生成 commit message'"
            @click="generateCommitMessage"
          >
            <WandSparkles :size="13" :class="commitMessageAiState === 'loading' ? 'animate-pulse' : ''" />
          </button>
          <button
            type="button"
            class="git-section-action"
            :disabled="!canCreateStash"
            :aria-busy="isStashDialogBusy"
            :title="t.git.stashChanges"
            :aria-label="t.git.stashChanges"
            @click="openStashDialog($event)"
          >
            <Archive :size="13" :class="isStashDialogBusy ? 'animate-pulse' : ''" />
          </button>
          <button
            type="button"
            data-git-changes-more-menu-trigger
            class="git-section-action"
            :disabled="disabled"
            :aria-expanded="moreMenuOpen"
            aria-haspopup="menu"
            :title="disabled ? '当前仓库不可用，无法执行 Git 操作' : '更多 Git 操作'"
            :aria-label="disabled ? '当前仓库不可用，无法执行 Git 操作' : '更多 Git 操作'"
            @click="toggleMoreMenu"
          >
            <MoreHorizontal :size="13" />
          </button>
          <button
            type="button"
            :class="cn('git-section-action', canCommitStaged && 'toolbar-primary-button')"
            :disabled="!canCommitStaged"
            :aria-busy="isCommitActionActive"
            :title="commitActionTitle"
            :aria-label="commitActionTitle"
            @click="handleCommitStaged"
          >
            <Check :size="13" :class="isCommitActionActive ? 'animate-pulse' : ''" :stroke-width="2.5" />
          </button>
        </div>
      </Teleport>
    </div>
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="moreMenuOpen"
          ref="moreMenuRef"
          data-git-changes-more-menu
          class="fixed z-[90] w-max max-w-[calc(100vw-1rem)] rounded-lg border border-border-subtle bg-surface-container-lowest p-1 shadow-2xl"
          :style="moreMenuStyle"
          role="menu"
          @click.stop
          @keydown="handleMoreMenuKeydown"
        >
          <button
            v-if="!isAmendMode"
            type="button"
            role="menuitem"
            class="mode-menu-item mode-menu-item--leading mode-menu-item--compact"
            :disabled="!canStartAmend"
            :title="amendActionTitle"
            :aria-label="amendActionTitle"
            @click="startAmendMode"
          >
            <Pencil :size="13" />
            <span>修订上次提交</span>
          </button>
          <button
            v-else
            type="button"
            role="menuitem"
            class="mode-menu-item mode-menu-item--leading mode-menu-item--compact"
            title="恢复进入修订模式前的提交草稿"
            aria-label="取消修订上次提交"
            @click="cancelAmendMode"
          >
            <X :size="13" />
            <span>取消修订模式</span>
          </button>
          <div class="my-1 border-t border-border-subtle" />
          <button
            type="button"
            role="menuitem"
            class="mode-menu-item mode-menu-item--leading mode-menu-item--compact text-status-error hover:bg-status-error/10 hover:text-status-error"
            :disabled="!canUndoLastCommit"
            :title="undoLastCommitTitle"
            :aria-label="undoLastCommitTitle"
            @click="requestUndoLastCommit"
          >
            <Undo :size="13" />
            <span>撤销上次提交</span>
          </button>
        </div>
      </Transition>
    </Teleport>
    <div
      v-show="open"
      ref="filesScrollRef"
      v-overlay-scrollbar
      :class="
        cn(
          'themed-scrollbar min-h-0 overflow-x-hidden [overscroll-behavior-y:contain]',
          files.length > 0 ? 'flex-1 overflow-y-auto' : 'shrink-0 overflow-hidden',
        )
      "
      @wheel="handlePanelWheel"
    >
      <div class="shrink-0 border-b border-border-subtle bg-surface px-2 py-1.5">
        <div
          v-if="isAmendMode"
          class="mb-1 flex h-6 items-center gap-1.5 rounded border border-status-warning/30 bg-status-warning/10 px-1.5 text-[10px] font-bold text-status-warning"
        >
          <Pencil :size="12" />
          <span class="min-w-0 flex-1 truncate">修订上次提交</span>
          <button
            type="button"
            class="git-row-action"
            title="取消修订上次提交"
            aria-label="取消修订上次提交"
            @click="cancelAmendMode"
          >
            <X :size="12" />
          </button>
        </div>
        <textarea
          ref="commitMessageTextareaRef"
          :value="composerCommitMessage"
          rows="1"
          class="ui-field git-commit-message-input themed-scrollbar w-full min-w-0 shrink-0 resize-none overflow-hidden"
          placeholder="输入 commit message..."
          @input="handleCommitMessageInput"
        ></textarea>
      </div>

      <section
        v-for="group in worktreeGroups"
        v-if="files.length > 0"
        :key="group.scope"
        class="border-b border-border-subtle last:border-b-0"
      >
        <div class="git-subsection-bar">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 pl-1.5 text-left text-[11px] font-semibold transition-colors hover:text-on-surface"
            :aria-expanded="group.open"
            @click="toggleGroup(group.scope)"
          >
            <ChevronDown v-if="group.open" :size="12" />
            <ChevronRight v-else :size="12" />
            <span class="min-w-0 truncate">{{ group.label }}</span>
          </button>
          <div class="flex shrink-0 items-center gap-px">
            <button
              v-if="group.scope === 'staged' && group.files.length > 0"
              type="button"
              class="git-row-action"
              :disabled="disabled || isChangesWriteBusy"
              :aria-busy="isBulkGitActionActive('unstage')"
              :title="bulkActionTitle('unstage')"
              :aria-label="bulkActionAriaLabel('unstage')"
              @click.stop="executeBulkGitFileAction('unstage')"
            >
              <Minus :size="12" :class="isBulkGitActionActive('unstage') ? 'animate-pulse' : ''" />
            </button>
            <template v-else-if="group.files.length > 0">
              <button
                type="button"
                class="git-row-action"
                :disabled="disabled || isChangesWriteBusy"
                :aria-busy="isBulkGitActionActive('stage')"
                :title="bulkActionTitle('stage')"
                :aria-label="bulkActionAriaLabel('stage')"
                @click.stop="executeBulkGitFileAction('stage')"
              >
                <Plus :size="12" :class="isBulkGitActionActive('stage') ? 'animate-pulse' : ''" />
              </button>
            </template>
            <button
              v-if="group.scope === 'unstaged' && discardableFiles.length > 0"
              type="button"
              class="git-row-action git-action-danger"
              :disabled="disabled || isChangesWriteBusy"
              :aria-busy="isBulkGitActionActive('discard')"
              :title="bulkActionTitle('discard')"
              :aria-label="bulkActionAriaLabel('discard')"
              @click.stop="requestDiscardAllGitFiles"
            >
              <Undo :size="12" :class="isBulkGitActionActive('discard') ? 'animate-pulse' : ''" />
            </button>
          </div>
          <span
            :class="
              cn(
                'mr-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md border px-1 font-mono text-[10px] font-semibold leading-none tabular-nums',
                group.scope === 'staged'
                  ? 'border-status-running/40 bg-status-running/10 text-status-running'
                  : 'border-primary/40 bg-primary/10 text-primary',
              )
            "
          >
            {{ group.files.length }}
          </span>
        </div>
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
            @click="emit('select-file', { path: file.path, scope: group.scope })"
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
                  class="dark-readable-meta min-w-0 flex-1 truncate text-[10px] font-medium leading-4 text-on-surface-variant/65"
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
                class="git-row-action"
                :disabled="!canRunFileAction(file, group.scope === 'staged' ? 'unstage' : 'stage')"
                :aria-busy="isGitFileActionActive(group.scope === 'staged' ? 'unstage' : 'stage', file)"
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
                class="git-row-action git-action-danger"
                :disabled="!canRunFileAction(file, 'discard')"
                :aria-busy="isGitFileActionActive('discard', file)"
                :title="`丢弃文件变更：${gitFileDisplayPath(file)}`"
                aria-label="丢弃文件变更"
                @click.stop="runGitFileAction('discard', file, group.scope)"
              >
                <Undo :size="12" :class="isGitFileActionActive('discard', file) ? 'animate-pulse' : ''" />
              </button>
              <button
                type="button"
                class="git-row-action"
                :disabled="file.status === 'DELETED'"
                :title="file.status === 'DELETED' ? t.git.fileDeleted : t.git.openFile"
                :aria-label="file.status === 'DELETED' ? t.git.fileDeleted : t.git.openFile"
                @click.stop="requestOpenFile(file)"
              >
                <FileSearch :size="12" />
              </button>
            </div>
          </div>
          <div v-if="group.files.length === 0" class="px-3 py-2 text-[10px] text-on-surface-variant/70">暂无文件</div>
        </div>
      </section>
      <div v-if="files.length === 0" class="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-on-surface-variant">
        <CircleCheck :size="14" class="shrink-0 text-status-running" />
        <span class="leading-4">{{ t.git.cleanWorkingTree }}</span>
      </div>
    </div>

    <ActionDialog
      :open="Boolean(confirmationDialog)"
      :tone="confirmationDialog?.tone || 'danger'"
      :icon="confirmationDialog?.icon || 'alert'"
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
      <Transition name="scale">
        <div
          v-if="stashDialogOpen"
          class="fixed inset-0 z-[80] flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
          @click.self="() => closeStashDialog()"
        >
          <form
            class="w-[min(24rem,92vw)] overflow-hidden rounded-lg border border-outline-variant/70 bg-surface text-on-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="git-stash-dialog-title"
            @submit.prevent="handleCreateGitStash"
          >
            <div class="border-b border-border-subtle bg-surface-container-low px-4 py-3">
              <h3 id="git-stash-dialog-title" class="text-sm font-bold text-on-surface">{{ t.git.stashChanges }}</h3>
            </div>
            <div class="space-y-3 px-4 py-3">
              <label class="block text-xs font-bold text-on-surface">
                <span>{{ t.git.stashMessage }}</span>
                <input
                  ref="stashMessageInputRef"
                  v-model="stashMessage"
                  type="text"
                  autocomplete="off"
                  class="ui-field mt-1 w-full"
                  :disabled="isStashDialogBusy"
                  :placeholder="t.git.stashMessagePlaceholder"
                />
              </label>
              <label class="flex items-center gap-2 text-xs font-medium text-on-surface">
                <input
                  v-model="stashIncludeUntracked"
                  type="checkbox"
                  class="accent-primary"
                  :disabled="isStashDialogBusy"
                />
                <span>{{ t.git.stashIncludeUntracked }}</span>
              </label>
              <div class="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  class="git-dialog-secondary"
                  :disabled="isStashDialogBusy"
                  @click="() => closeStashDialog()"
                >
                  {{ t.common.cancel }}
                </button>
                <button type="submit" class="git-dialog-primary" :disabled="isStashDialogBusy">
                  <Archive :size="13" :class="isStashDialogBusy ? 'animate-pulse' : ''" />
                  {{ isStashDialogBusy ? t.git.stashSaving : t.git.stashSave }}
                </button>
              </div>
            </div>
          </form>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>
