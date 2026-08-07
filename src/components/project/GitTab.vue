<script lang="ts">
import type { ProjectGitRepositoryTarget as RememberedProjectGitRepositoryTarget } from "../../types";

const rememberedGitRepositoryTargets = new Map<string, RememberedProjectGitRepositoryTarget>();
const rememberedRepositorySectionOpen = new Map<string, boolean>();
const rememberedTopInfoCollapsed = new Map<string, boolean>();
const rememberedChangesSectionOpen = new Map<string, boolean>();
const repositorySectionChoiceMade = new Set<string>();
const repositorySectionAutoOpened = new Set<string>();
const commitDraftsByContext = new Map<string, string>();
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleHelp,
  CloudDownload,
  CloudUpload,
  ClipboardCopy,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  GitBranch,
  GitPullRequestArrow,
  X,
  ChevronDown,
  ChevronRight,
  FileDiff,
  Minus,
  Plus,
  MoreHorizontal,
  FolderOpen,
  SquareTerminal,
  ExternalLink,
} from "lucide-vue-next";
import {
  Project,
  type ProjectGitSnapshot,
  type ProjectGitActionResult,
  type ProjectGitDiffScope,
  type ProjectGitFileChange,
  type ProjectGitFileDiffOptions,
  type ProjectGitFileDiffResult,
  type ProjectGitRemoteBranchSummary,
  type ProjectGitRemoteSummary,
  type ProjectGitRepositoryTarget,
} from "../../types";
import { cn } from "../../lib/utils";
import { type ProjectStatusMessageState, useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { useResizableSplit } from "../../composables/useResizableSplit";
import { gitRepositoryTargetsEqual } from "../../lib/gitRepositoryTarget";
import ActionDialog from "../ActionDialog.vue";
import GitDiffViewer from "./GitDiffViewer.vue";
import GitChangesPane from "./GitChangesPane.vue";
import GitCommitHistory from "./GitCommitHistory.vue";
import GitAiAnalysisDialog from "./GitAiAnalysisDialog.vue";
import { clearGitAiAnalysisSessionsForProject } from "../../lib/gitAiAnalysisSession";
import ExternalApplicationLaunchButton from "./ExternalApplicationLaunchButton.vue";

type GitActionState = ProjectStatusMessageState;
type GitRemoteActionName = "fetch" | "pull" | "push";
type RemoteDialogMode = "add" | "edit";
type WorktreeDiffScope = Exclude<ProjectGitDiffScope, "combined">;
type FileReviewSelection = { path: string; scope: WorktreeDiffScope };
type CommitReviewSelection = { commitHash: string; commitMessage: string; path: string };
type GitLeftContext = "changes" | "history";
type AppDialogKind = "danger" | "warning";
type AppActionDialog = {
  kind?: AppDialogKind;
  icon?: "alert" | "trash" | "undo";
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
};
type GitRepositoryRow = {
  key: string;
  target: ProjectGitRepositoryTarget;
  repositoryPath: string;
  depth: 0 | 1;
  name: string;
  kindLabel: string;
  branchLabel: string;
  changeCount: number | null;
  selectable: boolean;
  selected: boolean;
  health: "healthy" | "warning" | "unavailable";
  statusText: string;
  detailLines: string[];
};
type GitRepositoryMenuState = { row: GitRepositoryRow; x: number; y: number };
type FloatingMenuPosition = { left: number; top: number };

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
const activeRepositoryTarget = ref<ProjectGitRepositoryTarget>(
  rememberedGitRepositoryTargets.get(props.project.id) || { kind: "main" },
);
const repositorySectionOpen = ref(rememberedRepositorySectionOpen.get(props.project.id) || false);
const isTopInfoCollapsed = ref(rememberedTopInfoCollapsed.get(props.project.id) || false);
const repositoryContextGeneration = ref(0);
const repositoryMenu = ref<GitRepositoryMenuState | null>(null);
const changesSectionOpen = ref(false);
const leftContext = computed<GitLeftContext>(() => (changesSectionOpen.value ? "changes" : "history"));
const gitChangesTabRef = ref<HTMLButtonElement | null>(null);
const gitHistoryTabRef = ref<HTMLButtonElement | null>(null);
const changesToolbarRef = ref<HTMLElement | null>(null);
const commitHistoryToolbarRef = ref<HTMLElement | null>(null);
const isAiDialogOpen = ref(false);
const isBranchMenuOpen = ref(false);
const isRemoteMenuOpen = ref(false);
const branchMenuPosition = ref<FloatingMenuPosition>({ left: 8, top: 8 });
const remoteMenuPosition = ref<FloatingMenuPosition>({ left: 8, top: 8 });
const branchMenuRef = ref<HTMLElement | null>(null);
const remoteMenuRef = ref<HTMLElement | null>(null);
const remoteBranchQuery = ref("");
const isRemoteDialogOpen = ref(false);
const remoteDialogMode = ref<RemoteDialogMode>("add");
const remoteFormName = ref("");
const remoteFormUrl = ref("");
const gitActionMessage = ref("");
const gitActionState = ref<GitActionState>("idle");
const activeGitAction = ref("");
const isChangesPaneBusy = ref(false);
const isCommitHistoryBusy = ref(false);
const commitMessage = ref("");
const confirmationDialog = ref<AppActionDialog | null>(null);
const isConfirmationRunning = ref(false);
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
  defaultFirstRatio: 0.44,
  minFirstSize: 200,
  minSecondSize: 280,
});
let stopAppEscapeListener = () => {};

const gitWorkspaceSnapshot = computed(() => store.gitWorkspaces[props.project.id]);
const activeRepositoryContext = computed(() =>
  store.resolveGitRepositoryContext(props.project.id, activeRepositoryTarget.value),
);
const snapshot = computed(() => store.gitSnapshotForRepository(props.project.id, activeRepositoryTarget.value));
const files = computed(() => snapshot.value?.files || []);
const activeRepositoryChangeCount = computed(() => files.value.length);
const activeRepositoryCommitCount = computed(() => snapshot.value?.commitCount ?? 0);
const gitTabBadgeStyle = (count: number) => {
  if (count <= 0) return undefined;
  const badgeWidth = Math.max(12, String(count).length * 5 + 4);
  return { paddingRight: `${badgeWidth + 6}px` };
};
const worktreeSelection = ref<FileReviewSelection | null>(null);
const worktreeDiff = ref<ProjectGitFileDiffResult | null>(null);
const isLoadingWorktreeDiff = ref(false);
const commitReviewSelection = ref<CommitReviewSelection | null>(null);
const reviewScrollTop = ref(0);
const diffReadOptions = ref<Pick<ProjectGitFileDiffOptions, "fullFile" | "ignoreWhitespace">>({
  fullFile: false,
  ignoreWhitespace: false,
});
const currentDiffReadOptions = () => ({
  fullFile: diffReadOptions.value.fullFile === true,
  ignoreWhitespace: diffReadOptions.value.ignoreWhitespace === true,
});
const isDiffViewerExpanded = ref(false);
let diffRequestGeneration = 0;
const worktreeSelectionKey = (selection: FileReviewSelection) => `${selection.scope}:${selection.path}`;
const hasUncommittedChanges = computed(() => files.value.length > 0);
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
const selectedCommitHashes = ref<string[]>([]);
const topBarStatusText = computed(() => {
  const statusText = snapshot.value?.statusText || t.value.git.noRepo;
  const headHash = snapshot.value?.headHash;
  if (!snapshot.value?.isDetachedHead || !headHash) return statusText;

  const detachedHeadPrefix = `detached HEAD @ ${headHash} · `;
  return statusText.startsWith(detachedHeadPrefix) ? statusText.slice(detachedHeadPrefix.length) : statusText;
});
const remotes = computed(() => snapshot.value?.remotes || []);
const remoteBranches = computed(() => snapshot.value?.remoteBranches || []);
const filteredRemoteBranches = computed(() => {
  const query = remoteBranchQuery.value.trim().toLocaleLowerCase();
  if (!query) return remoteBranches.value;
  return remoteBranches.value.filter((branch) => branch.ref.toLocaleLowerCase().includes(query));
});
const remoteBranchGroups = computed(() =>
  remotes.value.map((remote) => ({
    remote,
    branches: filteredRemoteBranches.value.filter((branch) => branch.remote === remote.name),
  })),
);
const localBranchNames = computed(() => new Set((snapshot.value?.branches || []).map((branch) => branch.name)));
const upstream = computed(() => snapshot.value?.upstream || null);
const hasUpstream = computed(() => Boolean(upstream.value));
const currentLocalBranch = computed(() => snapshot.value?.branches?.find((branch) => branch.current)?.name || "");
const upstreamLabel = computed(() => upstream.value?.ref || "未设置 upstream");
const remoteStatusText = computed(() => {
  if (upstream.value) {
    return upstream.value.ref;
  }
  if (remotes.value.length > 0) {
    return "此分支未设置 upstream";
  }
  return "未配置 remote";
});
const canRunRemoteOperation = computed(() => hasUpstream.value && !isAnyGitWriteRunning.value);
const canInitializeGitRepository = computed(
  () =>
    activeRepositoryTarget.value.kind === "main" &&
    !snapshot.value?.repositoryPath &&
    !gitWorkspaceSnapshot.value?.repositoryPath &&
    props.project.pathExists !== false &&
    !store.gitRefreshing[props.project.id] &&
    !store.gitWorkspaceRefreshing[props.project.id] &&
    !isAnyGitWriteRunning.value,
);
const canPublishGitBranch = computed(
  () =>
    Boolean(snapshot.value?.repositoryPath) &&
    !snapshot.value?.isDetachedHead &&
    Boolean(currentLocalBranch.value) &&
    remotes.value.length > 0 &&
    !hasUpstream.value &&
    !isAnyGitWriteRunning.value,
);
const isGitSnapshotRefreshing = computed(() => {
  const context = activeRepositoryContext.value;
  if (!context || context.target.kind === "main") return Boolean(store.gitRefreshing[props.project.id]);
  return Boolean(store.gitRepositoryRefreshing[context.contextKey]);
});
const isGitStatusRefreshing = computed(() => {
  const context = activeRepositoryContext.value;
  if (!context || context.target.kind === "main") return Boolean(store.gitStatusRefreshing[props.project.id]);
  return Boolean(store.gitRepositoryStatusRefreshing[context.contextKey]);
});
const isGitRefreshing = computed(() => isGitSnapshotRefreshing.value || isGitStatusRefreshing.value);
const isGitWorkspaceRefreshing = computed(() => Boolean(store.gitWorkspaceRefreshing[props.project.id]));
const gitWorkspaceRelatedCount = computed(() => {
  const linkedWorktrees =
    gitWorkspaceSnapshot.value?.worktrees.entries.filter((entry) => entry.kind === "linked").length || 0;
  return linkedWorktrees + (gitWorkspaceSnapshot.value?.submodules.entries.length || 0);
});
const gitInteractionRefreshActiveIntervalMs = 2_000;
const gitInteractionRefreshNormalIntervalMs = 3_000;
const gitInteractionRefreshIdleIntervalMs = 5_000;
const gitInteractionRefreshActiveWindowMs = 4_000;
const gitInteractionRefreshNormalWindowMs = 12_000;
const gitInteractionRefreshHotWindowMs = 10_000;
const gitResumeRefreshDedupIntervalMs = 1_000;
let lastGitInteractionRefreshAt = 0;
let lastGitInteractionActivityAt = 0;
let lastGitResumeRefreshAt = 0;
let lastGitSnapshotChangeAt = 0;
let wasDocumentVisible = true;
let gitTabUnmounted = false;
let gitInteractionRefreshTimer: number | undefined;

const gitSnapshotRefreshSignature = (currentSnapshot: ProjectGitSnapshot | null) => {
  if (!currentSnapshot) return "";

  const commitSignature = currentSnapshot.commits.map((commit) => commit.hash).join("|");
  const fileSignature = currentSnapshot.files
    .map((file) =>
      [
        file.path,
        file.originalPath || "",
        file.status,
        file.staged ? "1" : "0",
        file.unstaged ? "1" : "0",
        file.additions,
        file.deletions,
      ].join(":\\u0000"),
    )
    .join("|");

  return [
    currentSnapshot.branch,
    currentSnapshot.headHash || "",
    currentSnapshot.isDetachedHead ? "1" : "0",
    currentSnapshot.ahead,
    currentSnapshot.behind,
    currentSnapshot.commitCount,
    commitSignature,
    fileSignature,
  ].join(":\\u0001");
};

const repositoryDisplayName = (repositoryPath: string, fallback: string) => {
  const normalized = repositoryPath.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || fallback;
};

const repositoryChangeCount = (
  status: {
    stagedEntries: number;
    unstagedEntries: number;
    untrackedEntries: number;
    conflictedEntries: number;
  } | null,
) =>
  status ? status.stagedEntries + status.unstagedEntries + status.untrackedEntries + status.conflictedEntries : null;

const repositoryChangeDetail = (
  status: {
    stagedEntries: number;
    unstagedEntries: number;
    untrackedEntries: number;
    conflictedEntries: number;
  } | null,
) =>
  status
    ? `变更：staged ${status.stagedEntries} · unstaged ${status.unstagedEntries} · untracked entries ${status.untrackedEntries} · conflicts ${status.conflictedEntries}`
    : "变更：不可用";

const repositoryUpstreamDetail = (upstream: { ref: string; ahead: number; behind: number } | null | undefined) =>
  upstream
    ? `Upstream：${upstream.ref} · ahead ${upstream.ahead} · behind ${upstream.behind}`
    : "Upstream：未配置或不可用";

const repositoryRows = computed<GitRepositoryRow[]>(() => {
  const workspace = gitWorkspaceSnapshot.value;
  const worktrees = workspace?.worktrees.entries || [];
  const mainWorktree = worktrees.find((entry) => entry.kind === "main" || entry.kind === "bare");
  const mainPath = mainWorktree?.path || workspace?.repositoryPath || props.project.path;
  const mainSelectable = mainWorktree
    ? mainWorktree.kind !== "bare" &&
      mainWorktree.pathAvailable &&
      !mainWorktree.prunable &&
      mainWorktree.failure === null
    : !workspace || Boolean(workspace.repositoryPath);
  const mainStatusText =
    mainWorktree?.failure?.message || (mainWorktree?.kind === "bare" ? "裸仓库不可作为工作区" : "主仓库");
  const mainRow: GitRepositoryRow = {
    key: `${props.project.id}:main`,
    target: { kind: "main" },
    repositoryPath: mainPath,
    depth: 0,
    name: repositoryDisplayName(mainPath, props.project.name),
    kindLabel: "主仓库",
    branchLabel:
      mainWorktree?.head.name ||
      (mainWorktree?.head.kind === "detached"
        ? `HEAD @ ${mainWorktree.head.oid?.slice(0, 7) || "unknown"}`
        : currentGitRefLabel.value),
    changeCount: repositoryChangeCount(mainWorktree?.status || null),
    selectable: mainSelectable,
    selected: activeRepositoryTarget.value.kind === "main",
    health: mainSelectable ? (mainWorktree?.locked ? "warning" : "healthy") : "unavailable",
    statusText: mainWorktree?.locked ? mainWorktree.lockReason || "已锁定，可正常使用" : mainStatusText,
    detailLines: [
      `HEAD：${mainWorktree?.head.oid || snapshot.value?.headHash || "不可用"}`,
      repositoryChangeDetail(mainWorktree?.status || null),
      repositoryUpstreamDetail(mainWorktree?.status?.upstream),
    ],
  };

  const submoduleRows = (workspace?.submodules.entries || []).map<GitRepositoryRow>((entry, index) => {
    const selectable = entry.pathAvailable && entry.checkout === "available" && entry.failure === null;
    const target = { kind: "submodule", path: entry.path } as const;
    return {
      key: `${props.project.id}:submodule:${entry.path}:${index}`,
      target,
      repositoryPath: entry.path,
      depth: 1,
      name: entry.name || repositoryDisplayName(entry.path, "submodule"),
      kindLabel: "子模块",
      branchLabel:
        entry.head.name ||
        (entry.head.kind === "detached" ? `HEAD @ ${entry.head.oid?.slice(0, 7) || "unknown"}` : entry.head.kind),
      changeCount: repositoryChangeCount(entry.status),
      selectable,
      selected: gitRepositoryTargetsEqual(activeRepositoryTarget.value, target),
      health: selectable ? (entry.commitMismatch ? "warning" : "healthy") : "unavailable",
      statusText:
        entry.failure?.message ||
        (entry.commitMismatch ? "检出提交与父仓库记录不一致" : selectable ? "可用" : `检出状态：${entry.checkout}`),
      detailLines: [
        `初始化：${entry.registration}`,
        `URL：${entry.url.declared || entry.url.local || entry.url.effective || "未配置"}`,
        `配置分支：${entry.branch.declared || entry.branch.local || entry.branch.effective || "未配置"}`,
        `父仓库记录：${entry.index.recordedOid || entry.index.kind}`,
        `检出提交：${entry.head.oid || "不可用"}`,
        repositoryChangeDetail(entry.status),
      ],
    };
  });

  const linkedRows = worktrees
    .filter((entry) => entry.kind === "linked")
    .map<GitRepositoryRow>((entry, index) => {
      const selectable = entry.pathAvailable && !entry.prunable && entry.failure === null;
      const target = { kind: "worktree", path: entry.path } as const;
      return {
        key: `${props.project.id}:worktree:${entry.path}:${index}`,
        target,
        repositoryPath: entry.path,
        depth: 0,
        name: repositoryDisplayName(entry.path, "worktree"),
        kindLabel: "工作树",
        branchLabel:
          entry.head.name ||
          (entry.head.kind === "detached" ? `HEAD @ ${entry.head.oid?.slice(0, 7) || "unknown"}` : entry.head.kind),
        changeCount: repositoryChangeCount(entry.status),
        selectable,
        selected: gitRepositoryTargetsEqual(activeRepositoryTarget.value, target),
        health: selectable ? (entry.locked ? "warning" : "healthy") : "unavailable",
        statusText:
          entry.failure?.message ||
          (entry.prunable
            ? entry.prunableReason || "可清理，路径不可用"
            : entry.locked
              ? entry.lockReason || "已锁定，可正常使用"
              : "可用"),
        detailLines: [
          `HEAD：${entry.head.oid || "不可用"}`,
          repositoryChangeDetail(entry.status),
          repositoryUpstreamDetail(entry.status?.upstream),
        ],
      };
    });

  return [mainRow, ...submoduleRows, ...linkedRows];
});

const selectedRepositoryRow = computed(
  () => repositoryRows.value.find((row) => row.selected) || repositoryRows.value[0],
);
const enabledExternalApplications = computed(() =>
  store.externalApplicationPreferences.applications.filter((application) => application.enabled),
);

const repositoryMenuStyle = computed(() => {
  if (!repositoryMenu.value) return {};
  const width = 288;
  const viewportWidth = globalThis.window?.innerWidth || 1024;
  const viewportHeight = globalThis.window?.innerHeight || 768;
  return {
    left: `${Math.max(8, Math.min(repositoryMenu.value.x, viewportWidth - width - 8))}px`,
    top: `${Math.max(8, Math.min(repositoryMenu.value.y, viewportHeight - 320))}px`,
    maxHeight: "calc(100vh - 1rem)",
  };
});

const positionFloatingMenu = (trigger: HTMLElement, width: number, estimatedHeight: number): FloatingMenuPosition => {
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
  const belowTop = rect.bottom + 6;
  const top = belowTop + estimatedHeight <= viewportHeight - 8 ? belowTop : Math.max(8, rect.top - estimatedHeight - 6);
  return { left, top };
};

const floatingMenuStyle = (position: FloatingMenuPosition, maxHeight = "calc(100vh - 1rem)") => ({
  left: `${position.left}px`,
  top: `${position.top}px`,
  maxHeight,
});

const toggleRepositorySection = () => {
  repositorySectionOpen.value = !repositorySectionOpen.value;
  rememberedRepositorySectionOpen.set(props.project.id, repositorySectionOpen.value);
  repositorySectionChoiceMade.add(props.project.id);
};

const toggleTopInfo = () => {
  isTopInfoCollapsed.value = !isTopInfoCollapsed.value;
  rememberedTopInfoCollapsed.set(props.project.id, isTopInfoCollapsed.value);
};

const changesSectionStateKey = (projectId = props.project.id, target = activeRepositoryTarget.value) =>
  store.resolveGitRepositoryContext(projectId, target)?.contextKey || projectId;

const restoreChangesSectionOpen = (projectId = props.project.id, target = activeRepositoryTarget.value) => {
  changesSectionOpen.value = rememberedChangesSectionOpen.get(changesSectionStateKey(projectId, target)) ?? false;
};

const setChangesSectionOpen = (open: boolean) => {
  const stateKey = changesSectionStateKey();
  changesSectionOpen.value = open;
  rememberedChangesSectionOpen.set(stateKey, open);
};

const refreshActiveRepository = async () => {
  const results = await Promise.allSettled([
    store.refreshGitSnapshot(props.project.id, { force: true }, activeRepositoryTarget.value),
    store.refreshGitWorkspace(props.project.id, { force: true }),
  ]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) {
    setGitActionResult("error", failure.reason instanceof Error ? failure.reason.message : "刷新 Git 仓库失败。");
  }
};

const isGitHistoryLoadingMore = computed(() => {
  const context = activeRepositoryContext.value;
  return Boolean(context && store.gitRepositoryLoadingMore[context.contextKey]);
});

const isRefreshRunning = () => isGitRefreshing.value || isGitWorkspaceRefreshing.value;

type GitSnapshotRefreshTrigger = "interaction" | "resume";

const gitInteractionRefreshIntervalFor = (trigger: GitSnapshotRefreshTrigger, now: number) => {
  if (trigger === "resume") return gitInteractionRefreshActiveIntervalMs;

  const timeSinceSnapshotChangeMs =
    lastGitSnapshotChangeAt > 0 ? Math.max(0, now - lastGitSnapshotChangeAt) : Number.POSITIVE_INFINITY;
  if (timeSinceSnapshotChangeMs <= gitInteractionRefreshHotWindowMs) {
    return gitInteractionRefreshActiveIntervalMs;
  }

  const timeSinceActivityMs =
    lastGitInteractionActivityAt > 0 ? Math.max(0, now - lastGitInteractionActivityAt) : Number.POSITIVE_INFINITY;
  if (timeSinceActivityMs <= gitInteractionRefreshActiveWindowMs) {
    return gitInteractionRefreshActiveIntervalMs;
  }
  if (timeSinceActivityMs <= gitInteractionRefreshNormalWindowMs) {
    return gitInteractionRefreshNormalIntervalMs;
  }
  return gitInteractionRefreshIdleIntervalMs;
};

const refreshGitSnapshotOnInteraction = (trigger: GitSnapshotRefreshTrigger = "interaction") => {
  if (gitTabUnmounted || isAnyGitWriteRunning.value || isRefreshRunning() || isGitHistoryLoadingMore.value)
    return false;

  const now = Date.now();
  if (trigger === "resume" && now - lastGitResumeRefreshAt < gitResumeRefreshDedupIntervalMs) return false;
  const refreshIntervalMs = gitInteractionRefreshIntervalFor(trigger, now);
  lastGitInteractionActivityAt = now;
  if (trigger === "interaction" && now - lastGitInteractionRefreshAt < refreshIntervalMs) {
    return false;
  }

  const previousSignature = gitSnapshotRefreshSignature(snapshot.value);
  lastGitInteractionRefreshAt = now;
  if (trigger === "resume") lastGitResumeRefreshAt = now;
  const originGeneration = repositoryContextGeneration.value;

  void store
    .refreshGitSnapshotForInteraction(props.project.id, activeRepositoryTarget.value)
    .then(() => {
      if (gitTabUnmounted || repositoryContextGeneration.value !== originGeneration) return;
      const nextSignature = gitSnapshotRefreshSignature(snapshot.value);
      const snapshotChanged = !previousSignature || !nextSignature || previousSignature !== nextSignature;
      if (snapshotChanged) lastGitSnapshotChangeAt = Date.now();
    })
    .catch((error) => {
      if (gitTabUnmounted || repositoryContextGeneration.value !== originGeneration) return;
      setGitActionResult("error", error instanceof Error ? error.message : "刷新 Git 仓库失败。");
    });
  return true;
};

const isGitTabRefreshExemptTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, a, input, textarea, select, option, label, summary, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [role='checkbox'], [role='switch'], [role='slider'], [role='textbox'], [role='combobox'], [role='treeitem'], [role='separator'], [contenteditable], [data-git-refresh-exempt]",
    ),
  );
};

const handleGitTabInteraction = (event: MouseEvent) => {
  if (isGitTabRefreshExemptTarget(event.target)) return;
  if (gitInteractionRefreshTimer !== undefined) return;
  const originProjectId = props.project.id;
  const originGeneration = repositoryContextGeneration.value;
  gitInteractionRefreshTimer = window.setTimeout(() => {
    gitInteractionRefreshTimer = undefined;
    if (
      gitTabUnmounted ||
      props.project.id !== originProjectId ||
      repositoryContextGeneration.value !== originGeneration
    ) {
      return;
    }
    refreshGitSnapshotOnInteraction();
  }, 0);
};

const handleGitWindowFocus = () => {
  if (document.visibilityState !== "visible") return;
  refreshGitSnapshotOnInteraction("resume");
};

const handleGitVisibilityChange = () => {
  const isVisible = document.visibilityState === "visible";
  if (!isVisible) {
    wasDocumentVisible = false;
    return;
  }
  if (!wasDocumentVisible) {
    wasDocumentVisible = true;
    refreshGitSnapshotOnInteraction("resume");
  }
};

const refreshForTabActivation = () => refreshGitSnapshotOnInteraction("resume");

defineExpose({ refreshActiveRepository, refreshForTabActivation, isRefreshRunning, isTopInfoCollapsed, toggleTopInfo });

const repositoryPath = computed(
  () => snapshot.value?.repositoryPath || activeRepositoryContext.value?.repositoryPath || props.project.path,
);
const selectedDiff = ref<ProjectGitFileDiffResult | null>(null);
const isLoadingDiff = ref(false);
const copiedText = ref("");
const copiedTimer = ref<number | undefined>();

const openAiDialog = () => {
  isAiDialogOpen.value = true;
};

const closeAiDialog = () => {
  isAiDialogOpen.value = false;
};

const closeFloatingControls = () => {
  isBranchMenuOpen.value = false;
  isRemoteMenuOpen.value = false;
  repositoryMenu.value = null;
};

const hasFloatingControlsOpen = () => isBranchMenuOpen.value || isRemoteMenuOpen.value || Boolean(repositoryMenu.value);

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (event.detail.handled) return;
  if (isDiffViewerExpanded.value) {
    isDiffViewerExpanded.value = false;
    event.detail.handle();
    return;
  }

  if (isRemoteDialogOpen.value) {
    closeRemoteDialog();
    event.detail.handle();
    return;
  }

  if (hasFloatingControlsOpen()) {
    closeFloatingControls();
    event.detail.handle();
  }
};

const clearRepositoryBoundState = (projectId = props.project.id) => {
  repositoryContextGeneration.value += 1;
  diffRequestGeneration += 1;
  closeFloatingControls();
  isRemoteDialogOpen.value = false;
  isAiDialogOpen.value = false;
  isDiffViewerExpanded.value = false;
  confirmationDialog.value = null;
  worktreeSelection.value = null;
  worktreeDiff.value = null;
  isLoadingWorktreeDiff.value = false;
  commitReviewSelection.value = null;
  selectedDiff.value = null;
  isLoadingDiff.value = false;
  selectedCommitHashes.value = [];
  isCommitHistoryBusy.value = false;
  clearGitAiAnalysisSessionsForProject(projectId);
  setGitActionResult("idle", "");
};

const selectGitRepository = (row: GitRepositoryRow) => {
  if (!row.selectable || isAnyGitWriteRunning.value) return;
  const nextContext = store.resolveGitRepositoryContext(props.project.id, row.target);
  if (!nextContext) {
    setGitActionResult("warning", "仓库状态已变化，请刷新后重试。");
    return;
  }
  if (gitRepositoryTargetsEqual(activeRepositoryTarget.value, nextContext.target)) {
    repositoryMenu.value = null;
    return;
  }

  const currentContext = activeRepositoryContext.value;
  if (currentContext) commitDraftsByContext.set(currentContext.contextKey, commitMessage.value);
  clearRepositoryBoundState();
  activeRepositoryTarget.value = nextContext.target;
  lastGitInteractionRefreshAt = 0;
  rememberedGitRepositoryTargets.set(props.project.id, nextContext.target);
  restoreChangesSectionOpen(props.project.id, nextContext.target);
  commitMessage.value = commitDraftsByContext.get(nextContext.contextKey) || "";
  if (!store.gitSnapshotForRepository(props.project.id, nextContext.target)) {
    void store.refreshGitSnapshot(props.project.id, { force: true }, nextContext.target);
  }
};

const openRepositoryMenu = (event: MouseEvent, row: GitRepositoryRow) => {
  event.stopPropagation();
  closeFloatingControls();
  repositoryMenu.value = { row, x: event.clientX, y: event.clientY };
};

const toggleBranchMenu = async (event: MouseEvent) => {
  const shouldOpen = !isBranchMenuOpen.value;
  closeFloatingControls();
  if (!shouldOpen) return;
  const trigger = event.currentTarget as HTMLElement;
  branchMenuPosition.value = positionFloatingMenu(trigger, 176, 256);
  isBranchMenuOpen.value = true;
  await nextTick();
  if (!branchMenuRef.value) return;
  branchMenuPosition.value = positionFloatingMenu(
    trigger,
    branchMenuRef.value.offsetWidth,
    branchMenuRef.value.offsetHeight,
  );
};

const toggleRemoteMenu = async (event: MouseEvent) => {
  const shouldOpen = !isRemoteMenuOpen.value;
  closeFloatingControls();
  if (!shouldOpen) return;
  const trigger = event.currentTarget as HTMLElement;
  remoteBranchQuery.value = "";
  remoteMenuPosition.value = positionFloatingMenu(trigger, 320, 320);
  isRemoteMenuOpen.value = shouldOpen;
  await nextTick();
  if (!remoteMenuRef.value) return;
  remoteMenuPosition.value = positionFloatingMenu(
    trigger,
    remoteMenuRef.value.offsetWidth,
    remoteMenuRef.value.offsetHeight,
  );
};

const runRepositoryExternalAction = (action: "terminal" | "folder") => {
  const row = repositoryMenu.value?.row;
  repositoryMenu.value = null;
  if (!row?.selectable) return;
  if (action === "terminal") void store.openGitRepositoryInTerminal(props.project.id, row.target);
  else void store.showGitRepositoryInFolder(props.project.id, row.target);
};

const openRepositoryWithApplication = (applicationId?: string, row = repositoryMenu.value?.row) => {
  repositoryMenu.value = null;
  if (!row?.selectable) return;
  void store.openGitRepositoryInEditor(props.project.id, row.target, applicationId);
};

const copyRepositoryPath = () => {
  const repositoryPath = repositoryMenu.value?.row.repositoryPath || "";
  repositoryMenu.value = null;
  void copyText(repositoryPath);
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

const publishGitBranchTitle = () => {
  if (hasUpstream.value) return remoteActionTitle("push");
  if (!snapshot.value?.repositoryPath) return "未检测到 Git 仓库，无法发布当前分支";
  if (snapshot.value.isDetachedHead) return "当前 HEAD 处于 detached 状态，无法发布当前分支";
  if (!currentLocalBranch.value) return "当前 HEAD 未指向本地分支，无法发布当前分支";
  if (remotes.value.length === 0) return "当前仓库未配置 remote，无法发布当前分支";
  return remotes.value.length === 1
    ? `发布 ${currentLocalBranch.value} 到 ${remotes.value[0].name}`
    : "选择 remote 后发布当前分支";
};

const executeInitializeGitRepository = async () => {
  if (!canInitializeGitRepository.value) return;

  activeGitAction.value = "initialize";
  setGitActionResult("loading", "正在初始化 Git 仓库...");
  await waitForVisualFeedback();
  try {
    const result = await store.initializeGitRepository(props.project.id);
    if (!result) {
      setGitActionResult("warning", "当前项目目录不可用，无法初始化 Git 仓库。");
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) clearCommitSelection();
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "初始化 Git 仓库失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const executeGitRemoteAction = async (action: GitRemoteActionName) => {
  if (isAnyGitWriteRunning.value) return;
  isRemoteMenuOpen.value = false;
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
        ? await store.fetchGitRemote(props.project.id, activeRepositoryTarget.value)
        : action === "pull"
          ? await store.pullGitRemote(props.project.id, activeRepositoryTarget.value)
          : await store.pushGitRemote(props.project.id, activeRepositoryTarget.value);
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

const executeFetchGitRemoteByName = async (remoteName: string) => {
  if (isAnyGitWriteRunning.value || !remoteName) return;

  activeGitAction.value = `remote:fetch:${remoteName}`;
  setGitActionResult("loading", `正在刷新 ${remoteName} 的远端分支...`);
  await waitForVisualFeedback();
  try {
    const result = await store.fetchGitRemoteByName(props.project.id, remoteName, activeRepositoryTarget.value);
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法刷新 remote 分支。");
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) clearCommitSelection();
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "刷新 remote 分支失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const executeCheckoutRemoteBranch = async (remoteRef: string, force = false) => {
  if (isAnyGitWriteRunning.value || !remoteRef) return;

  isRemoteMenuOpen.value = false;
  activeGitAction.value = `remote:checkout:${remoteRef}`;
  setGitActionResult("loading", force ? `正在强制检出 ${remoteRef}...` : `正在检出 ${remoteRef}...`);
  await waitForVisualFeedback();
  try {
    const result = await store.checkoutGitRemoteBranch(
      props.project.id,
      remoteRef,
      { force },
      activeRepositoryTarget.value,
    );
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法检出远程分支。");
      return;
    }
    if (!result.ok && !force && result.blockReason === "dirty-worktree") {
      setGitActionResult("idle", "");
      confirmationDialog.value = {
        kind: "danger",
        icon: "trash",
        title: "强制检出远程分支",
        message: `当前工作区存在未提交变更。继续检出 ${remoteRef} 会丢弃这些本地变更。`,
        detail: remoteRef,
        confirmLabel: "强制检出",
        cancelLabel: t.value.common.cancel,
        onConfirm: () => executeCheckoutRemoteBranch(remoteRef, true),
      };
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) clearCommitSelection();
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "检出远程分支失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const requestCheckoutRemoteBranch = (branch: ProjectGitRemoteBranchSummary) => {
  if (isAnyGitWriteRunning.value || localBranchNames.value.has(branch.branch)) return;
  void executeCheckoutRemoteBranch(branch.ref);
};

const executeDeleteGitRemoteBranch = async (remoteName: string, branchName: string) => {
  if (isAnyGitWriteRunning.value || !remoteName || !branchName) return;

  isRemoteMenuOpen.value = false;
  activeGitAction.value = `remote:delete-branch:${remoteName}/${branchName}`;
  setGitActionResult("loading", `正在从 ${remoteName} 删除远端分支 ${branchName}...`);
  await waitForVisualFeedback();
  try {
    const result = await store.deleteGitRemoteBranch(
      props.project.id,
      remoteName,
      branchName,
      activeRepositoryTarget.value,
    );
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法删除远端分支。");
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) clearCommitSelection();
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "删除远端分支失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const requestDeleteGitRemoteBranch = (remote: ProjectGitRemoteSummary, branch: ProjectGitRemoteBranchSummary) => {
  if (isAnyGitWriteRunning.value) return;

  const trackingWarning =
    upstream.value?.ref === branch.ref ? "当前分支正在跟踪此远端分支；下次推送可能会重新创建它。" : "";
  confirmationDialog.value = {
    kind: "danger",
    icon: "trash",
    title: "删除远端分支",
    message: `将从 ${remote.name} 删除远端分支 ${branch.branch}。不会删除本地分支，此操作会影响远端仓库中的其他协作者。`,
    detail: [remote.pushUrl || remote.fetchUrl, trackingWarning].filter(Boolean).join("\n"),
    confirmLabel: "删除远端分支",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executeDeleteGitRemoteBranch(remote.name, branch.branch),
  };
};

const executePublishGitBranch = async (remoteName: string) => {
  if (!canPublishGitBranch.value || !remoteName) return;

  isRemoteMenuOpen.value = false;
  activeGitAction.value = `remote:publish:${remoteName}`;
  setGitActionResult("loading", `正在发布 ${currentLocalBranch.value} 到 ${remoteName}...`);
  await waitForVisualFeedback();
  try {
    const result = await store.publishGitBranch(props.project.id, remoteName, activeRepositoryTarget.value);
    if (!result) {
      setGitActionResult("warning", "当前项目不可用，无法发布 Git 分支。");
      return;
    }
    setGitActionResult(result.ok ? "success" : "error", result.message);
    if (result.ok) clearCommitSelection();
  } catch (error) {
    setGitActionResult("error", error instanceof Error ? error.message : "发布当前分支失败。");
  } finally {
    activeGitAction.value = "";
  }
};

const requestPublishGitBranch = (remote: ProjectGitRemoteSummary) => {
  const branch = currentLocalBranch.value;
  if (!canPublishGitBranch.value || !branch) return;

  isRemoteMenuOpen.value = false;
  confirmationDialog.value = {
    kind: "warning",
    title: "发布当前分支",
    message: `将 ${branch} 发布到 ${remote.name}/${branch} 并设置 upstream。`,
    detail: remote.pushUrl || remote.fetchUrl,
    confirmLabel: "发布分支",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executePublishGitBranch(remote.name),
  };
};

const handlePushAction = (event: MouseEvent) => {
  if (hasUpstream.value) {
    void executeGitRemoteAction("push");
    return;
  }
  if (!canPublishGitBranch.value) return;
  if (remotes.value.length === 1) {
    requestPublishGitBranch(remotes.value[0]);
    return;
  }
  event.stopPropagation();
  toggleRemoteMenu(event);
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
        ? await store.addGitRemote(props.project.id, name, url, activeRepositoryTarget.value)
        : await store.setGitRemoteUrl(props.project.id, name, url, activeRepositoryTarget.value);
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
    const result = await store.removeGitRemote(props.project.id, remoteName, activeRepositoryTarget.value);
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
    icon: "trash",
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
  store.setProjectStatusMessage(state, message);
};

const isDirtyGitWriteBlock = (result: ProjectGitActionResult, options: { force?: boolean }) =>
  !options.force && !result.ok && result.blockReason === "dirty-worktree";

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
    if (confirmationDialog.value === dialog) confirmationDialog.value = null;
  } finally {
    isConfirmationRunning.value = false;
  }
};

const clearWorktreeReview = () => {
  diffRequestGeneration += 1;
  isDiffViewerExpanded.value = false;
  worktreeSelection.value = null;
  worktreeDiff.value = null;
  isLoadingWorktreeDiff.value = false;
};

const loadWorktreeDiff = async (selection: FileReviewSelection) => {
  const generation = ++diffRequestGeneration;
  worktreeSelection.value = selection;
  commitReviewSelection.value = null;
  isLoadingWorktreeDiff.value = true;
  worktreeDiff.value = { path: selection.path, scope: selection.scope, diff: "" };
  try {
    const result = await store.readGitFileDiff(
      props.project.id,
      selection.path,
      { scope: selection.scope, ...currentDiffReadOptions() },
      activeRepositoryTarget.value,
    );
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

const executeSwitchBranch = async (branchName: string, options: { force?: boolean } = {}) => {
  if (!branchName || branchName === snapshot.value?.branch || isAnyGitWriteRunning.value) {
    return;
  }

  activeGitAction.value = `branch:${branchName}`;
  setGitActionResult("loading", options.force ? `正在强制切换到 ${branchName}...` : `正在切换到 ${branchName}...`);
  await waitForVisualFeedback();
  try {
    const result = await store.switchGitBranch(props.project.id, branchName, options, activeRepositoryTarget.value);
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
    icon: "trash",
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
  if (!branchName || branchName === snapshot.value?.branch || isAnyGitWriteRunning.value) {
    return;
  }
  if (hasUncommittedChanges.value) {
    requestForceSwitchBranch(branchName);
    return;
  }

  await executeSwitchBranch(branchName);
};

const fileLabel = (status: string) => {
  if (status === "ADDED") return t.value.git.added;
  if (status === "DELETED") return t.value.git.deleted;
  if (status === "RENAMED") return t.value.git.renamed;
  if (status === "UNTRACKED") return t.value.git.untracked;
  return t.value.git.modified;
};

const gitFileDisplayPath = (file: ProjectGitFileChange) =>
  file.originalPath && file.originalPath !== file.path ? `${file.originalPath} -> ${file.path}` : file.path;

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

const isGitActionRunning = computed(() => Boolean(activeGitAction.value));
const isAnyGitWriteRunning = computed(
  () =>
    Boolean(activeGitAction.value) ||
    isChangesPaneBusy.value ||
    isCommitHistoryBusy.value ||
    (store.gitWritesInProgress[props.project.id] || 0) > 0,
);
const isChangesPaneExternallyDisabled = computed(
  () =>
    Boolean(activeGitAction.value) ||
    isCommitHistoryBusy.value ||
    (!isChangesPaneBusy.value && (store.gitWritesInProgress[props.project.id] || 0) > 0),
);
const clearCommitSelection = () => {
  selectedCommitHashes.value = [];
};

const setLeftContext = (context: GitLeftContext, shouldFocus = false) => {
  setChangesSectionOpen(context === "changes");
  if (shouldFocus) {
    void nextTick(() => (context === "changes" ? gitChangesTabRef.value : gitHistoryTabRef.value)?.focus());
  }
};

const handleLeftContextKeydown = (event: KeyboardEvent) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  setLeftContext(event.key === "ArrowLeft" || event.key === "Home" ? "changes" : "history", true);
};

const copyText = async (value: string) => {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    copiedText.value = value;
    window.clearTimeout(copiedTimer.value);
    copiedTimer.value = window.setTimeout(() => {
      if (copiedText.value === value) copiedText.value = "";
    }, 1200);
    return true;
  } catch {
    copiedText.value = "";
    return false;
  }
};

const handleOpenFile = (relativePath: string) => {
  if (activeRepositoryTarget.value.kind !== "main") {
    void store.openGitRepositoryInEditor(props.project.id, activeRepositoryTarget.value);
    return;
  }
  emit("open-file", relativePath);
};

const handleChangesFileSelection = (selection: FileReviewSelection | null) => {
  if (selection) void loadWorktreeDiff(selection);
  else clearWorktreeReview();
};

const invalidateWorktreeDiffRequest = () => {
  diffRequestGeneration += 1;
  isLoadingWorktreeDiff.value = false;
};

const handleChangesFeedback = (state: Exclude<GitActionState, "idle">, message: string) => {
  setGitActionResult(state, message);
};

const handleViewDiff = async (commitHash: string, path: string, commitMessage?: string) => {
  const commit = (snapshot.value?.commits || []).find((item) => item.hash === commitHash);
  if (!commit) return;
  const generation = ++diffRequestGeneration;
  worktreeSelection.value = null;
  commitReviewSelection.value = { commitHash, commitMessage: commitMessage || commit.message, path };
  isLoadingDiff.value = true;
  selectedDiff.value = { path, diff: "" };
  try {
    const result = await store.readGitCommitFileDiff(
      props.project.id,
      commitHash,
      path,
      activeRepositoryTarget.value,
      commit.stash,
      currentDiffReadOptions(),
    );
    if (
      generation === diffRequestGeneration &&
      commitReviewSelection.value?.commitHash === commitHash &&
      commitReviewSelection.value.path === path
    ) {
      selectedDiff.value = result;
    }
  } catch (error) {
    if (generation === diffRequestGeneration) {
      selectedDiff.value = {
        path: path,
        diff: "",
        message: error instanceof Error ? error.message : "读取提交 diff 失败。",
      };
    }
  } finally {
    if (generation === diffRequestGeneration) isLoadingDiff.value = false;
  }
};

const updateDiffReadOptions = (options: Partial<Pick<ProjectGitFileDiffOptions, "fullFile" | "ignoreWhitespace">>) => {
  if (isLoadingWorktreeDiff.value || isLoadingDiff.value) return;
  const nextOptions = { ...diffReadOptions.value, ...options };
  if (
    nextOptions.fullFile === diffReadOptions.value.fullFile &&
    nextOptions.ignoreWhitespace === diffReadOptions.value.ignoreWhitespace
  ) {
    return;
  }

  diffReadOptions.value = nextOptions;
  if (worktreeSelection.value) {
    void loadWorktreeDiff(worktreeSelection.value);
  } else if (commitReviewSelection.value) {
    void handleViewDiff(
      commitReviewSelection.value.commitHash,
      commitReviewSelection.value.path,
      commitReviewSelection.value.commitMessage,
    );
  }
};

const toggleDiffViewerDialog = () => {
  if (!worktreeSelection.value && !commitReviewSelection.value) return;
  isDiffViewerExpanded.value = !isDiffViewerExpanded.value;
};

const closeDiffViewerDialog = () => {
  isDiffViewerExpanded.value = false;
};

const handleWindowPointerDown = (event: PointerEvent) => {
  const target = event.target;
  if (!(target instanceof Element && target.closest("[data-git-top-menu], [data-git-top-menu-trigger]"))) {
    isBranchMenuOpen.value = false;
    isRemoteMenuOpen.value = false;
  }
  if (target instanceof Element && target.closest("[data-repository-menu]")) return;
  repositoryMenu.value = null;
};

const handleFloatingViewportChange = (event: Event) => {
  if (
    event.type === "scroll" &&
    event.target instanceof Element &&
    event.target.closest("[data-git-top-menu], [data-repository-menu]")
  ) {
    return;
  }
  isBranchMenuOpen.value = false;
  isRemoteMenuOpen.value = false;
  repositoryMenu.value = null;
};

const restoreProjectRepositoryState = (projectId: string) => {
  let target = rememberedGitRepositoryTargets.get(projectId) || ({ kind: "main" } as const);
  const workspace = store.gitWorkspaces[projectId];
  if (workspace && !store.resolveGitRepositoryContext(projectId, target)) {
    target = { kind: "main" };
    rememberedGitRepositoryTargets.set(projectId, target);
  }
  activeRepositoryTarget.value = target;
  repositorySectionOpen.value = rememberedRepositorySectionOpen.get(projectId) || false;
  isTopInfoCollapsed.value = rememberedTopInfoCollapsed.get(projectId) || false;
  restoreChangesSectionOpen(projectId, target);
  const hasRelatedRepositories = Boolean(
    workspace &&
    (workspace.worktrees.entries.some((entry) => entry.kind === "linked") || workspace.submodules.entries.length > 0),
  );
  if (
    hasRelatedRepositories &&
    !repositorySectionChoiceMade.has(projectId) &&
    !repositorySectionAutoOpened.has(projectId)
  ) {
    repositorySectionOpen.value = true;
    rememberedRepositorySectionOpen.set(projectId, true);
    repositorySectionAutoOpened.add(projectId);
  }
  const context = store.resolveGitRepositoryContext(projectId, target);
  commitMessage.value = context ? commitDraftsByContext.get(context.contextKey) || "" : "";
  if (!workspace) void store.refreshGitWorkspace(projectId);
  if (context && !store.gitSnapshotForRepository(projectId, target)) {
    void store.refreshGitSnapshot(projectId, {}, target);
  }
};

onBeforeUnmount(() => {
  gitTabUnmounted = true;
  const context = activeRepositoryContext.value;
  if (context) commitDraftsByContext.set(context.contextKey, commitMessage.value);
  window.clearTimeout(copiedTimer.value);
  window.clearTimeout(gitInteractionRefreshTimer);
  gitInteractionRefreshTimer = undefined;
  window.removeEventListener("pointerdown", handleWindowPointerDown);
  window.removeEventListener("focus", handleGitWindowFocus);
  document.removeEventListener("visibilitychange", handleGitVisibilityChange);
  window.removeEventListener("resize", handleFloatingViewportChange);
  window.removeEventListener("scroll", handleFloatingViewportChange, true);
  stopAppEscapeListener();
});

onMounted(() => {
  wasDocumentVisible = document.visibilityState === "visible";
  window.addEventListener("pointerdown", handleWindowPointerDown);
  window.addEventListener("focus", handleGitWindowFocus);
  document.addEventListener("visibilitychange", handleGitVisibilityChange);
  window.addEventListener("resize", handleFloatingViewportChange);
  window.addEventListener("scroll", handleFloatingViewportChange, true);
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
  restoreProjectRepositoryState(props.project.id);
});

watch(
  () => props.project.id,
  (projectId, previousProjectId) => {
    lastGitInteractionRefreshAt = 0;
    lastGitInteractionActivityAt = 0;
    lastGitResumeRefreshAt = 0;
    lastGitSnapshotChangeAt = 0;
    const previousContext = store.resolveGitRepositoryContext(previousProjectId, activeRepositoryTarget.value);
    if (previousContext) commitDraftsByContext.set(previousContext.contextKey, commitMessage.value);
    clearRepositoryBoundState(previousProjectId);
    restoreProjectRepositoryState(projectId);
  },
);

watch(
  isGitSnapshotRefreshing,
  (refreshing) => {
    if (refreshing) lastGitInteractionRefreshAt = Date.now();
  },
  { immediate: true },
);

watch(
  commitMessage,
  (value) => {
    const context = activeRepositoryContext.value;
    if (context) commitDraftsByContext.set(context.contextKey, value);
  },
  { immediate: true },
);

watch(
  () => gitWorkspaceSnapshot.value?.lastRefreshedAt || "",
  () => {
    const workspace = gitWorkspaceSnapshot.value;
    if (!workspace) return;
    const hasRelatedRepositories = gitWorkspaceRelatedCount.value > 0;
    if (
      hasRelatedRepositories &&
      !repositorySectionChoiceMade.has(props.project.id) &&
      !repositorySectionAutoOpened.has(props.project.id)
    ) {
      repositorySectionOpen.value = true;
      rememberedRepositorySectionOpen.set(props.project.id, true);
      repositorySectionAutoOpened.add(props.project.id);
    }

    const context = store.resolveGitRepositoryContext(props.project.id, activeRepositoryTarget.value);
    if (!context && activeRepositoryTarget.value.kind !== "main") {
      clearRepositoryBoundState();
      activeRepositoryTarget.value = { kind: "main" };
      rememberedGitRepositoryTargets.set(props.project.id, { kind: "main" });
      restoreChangesSectionOpen(props.project.id, { kind: "main" });
      const mainContext = store.resolveGitRepositoryContext(props.project.id, { kind: "main" });
      commitMessage.value = mainContext ? commitDraftsByContext.get(mainContext.contextKey) || "" : "";
      setGitActionResult("warning", "之前选择的仓库已不可用，已返回主仓库。");
      if (mainContext && !store.gitSnapshotForRepository(props.project.id, { kind: "main" })) {
        void store.refreshGitSnapshot(props.project.id, {}, { kind: "main" });
      }
      return;
    }

    if (context && !store.gitSnapshotForRepository(props.project.id, context.target)) {
      void store.refreshGitSnapshot(props.project.id, {}, context.target);
    }
  },
);

watch(
  () => (snapshot.value?.commits || []).map((commit) => commit.hash).join("|"),
  () => {
    const availableHashes = new Set((snapshot.value?.commits || []).map((commit) => commit.hash));
    selectedCommitHashes.value = selectedCommitHashes.value.filter((hash) => availableHashes.has(hash));
  },
);
</script>

<template>
  <div
    class="relative flex h-full min-h-0 flex-col gap-3 overflow-hidden"
    @click.capture="handleGitTabInteraction"
    @click="closeFloatingControls"
  >
    <section
      id="git-top-info-panel"
      :aria-hidden="isTopInfoCollapsed"
      :inert="isTopInfoCollapsed"
      :class="
        cn(
          'overflow-hidden rounded-lg border bg-surface transition-all duration-300 ease-out',
          isTopInfoCollapsed
            ? '-mb-3 max-h-0 -translate-y-2 border-0 opacity-0 pointer-events-none'
            : 'mb-0 max-h-56 translate-y-0 border-border-subtle opacity-100',
        )
      "
    >
      <div class="flex min-h-11 items-center justify-between gap-2 px-2 py-1.5">
        <div class="flex min-w-0 flex-1 items-center gap-2 text-xs">
          <button
            v-if="gitWorkspaceRelatedCount > 0"
            type="button"
            class="flex h-7 min-w-0 max-w-56 shrink items-center gap-1.5 rounded border border-border-subtle bg-surface-container-low px-2 text-on-surface transition-colors hover:bg-surface-variant hover:text-primary"
            :title="`${repositorySectionOpen ? '收起' : '展开'}关联仓库列表（${gitWorkspaceRelatedCount} 个）`"
            :aria-label="`${repositorySectionOpen ? '收起' : '展开'}关联仓库列表（${gitWorkspaceRelatedCount} 个）`"
            :aria-expanded="repositorySectionOpen"
            @click="toggleRepositorySection"
          >
            <ChevronDown v-if="repositorySectionOpen" :size="12" class="shrink-0" />
            <ChevronRight v-else :size="12" class="shrink-0" />
            <FolderOpen :size="13" class="shrink-0 text-on-surface-variant" />
            <span class="min-w-0 flex-1 truncate text-[11px] font-bold" :title="selectedRepositoryRow?.repositoryPath">
              {{ selectedRepositoryRow?.name || project.name }}
            </span>
            <span
              class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-surface-variant px-1 font-mono text-[9px] font-bold leading-none text-on-surface-variant"
              :title="`${gitWorkspaceRelatedCount} 个关联仓库（子模块或关联工作树）`"
            >
              {{ gitWorkspaceRelatedCount }}
            </span>
          </button>
          <div class="min-w-0" data-git-refresh-exempt @click.stop>
            <button
              type="button"
              data-git-top-menu-trigger
              class="flex min-w-0 max-w-full items-center gap-1.5 rounded border border-border-subtle bg-surface-container-low px-2 py-1 font-mono text-[11px] font-bold text-on-surface transition-colors hover:bg-surface-variant hover:text-primary"
              :title="t.git.branch"
              :aria-label="t.git.branch"
              @click="toggleBranchMenu"
            >
              <GitBranch :size="13" class="shrink-0 text-primary" />
              <span class="min-w-0 truncate">{{ currentGitRefLabel }}</span>
              <ChevronDown :size="12" class="shrink-0 text-on-surface-variant" />
            </button>
            <Teleport to="body">
              <Transition name="fade">
                <div
                  v-if="isBranchMenuOpen"
                  ref="branchMenuRef"
                  data-git-top-menu
                  class="themed-scrollbar fixed z-[80] max-h-64 w-max max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border-subtle bg-surface-container-lowest p-1 text-xs shadow-2xl"
                  :style="floatingMenuStyle(branchMenuPosition, 'min(16rem, calc(100vh - 1rem))')"
                  role="menu"
                  @click.stop
                >
                  <button
                    v-for="branch in branchOptions"
                    :key="branch.name"
                    type="button"
                    role="menuitem"
                    :class="cn('mode-menu-item', branch.current && 'bg-primary/10 text-primary')"
                    :title="branch.name"
                    @click="handleSwitchBranch(branch.name)"
                  >
                    <span class="min-w-0 truncate font-mono">{{ branch.name }}</span>
                    <Check v-if="branch.current" :size="13" />
                  </button>
                </div>
              </Transition>
            </Teleport>
          </div>
          <button
            v-if="canInitializeGitRepository"
            type="button"
            class="flex h-7 shrink-0 items-center gap-1.5 rounded border border-border-subtle bg-surface-container-low px-2 text-[10px] font-bold text-on-surface transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-wait disabled:opacity-60"
            :disabled="isAnyGitWriteRunning"
            :aria-busy="activeGitAction === 'initialize'"
            title="初始化 Git 仓库"
            aria-label="初始化 Git 仓库"
            @click="executeInitializeGitRepository"
          >
            <GitBranch :size="13" class="shrink-0 text-primary" />
            <span>初始化 Git 仓库</span>
          </button>
          <span
            v-if="snapshot?.isDetachedHead"
            class="shrink-0 rounded border border-status-warning/30 bg-status-warning/10 px-2 py-1 text-[10px] font-bold text-status-warning"
          >
            detached HEAD
          </span>
          <div
            v-if="hasUpstream"
            class="flex shrink-0 items-center overflow-hidden rounded border border-border-subtle bg-surface-container-low text-[10px]"
            :title="repositoryUpstreamDetail(upstream)"
          >
            <span
              :class="
                cn(
                  'flex items-center gap-1 px-1.5 py-1 font-mono font-bold',
                  (snapshot?.ahead || 0) > 0 ? 'text-primary' : 'text-on-surface-variant',
                )
              "
            >
              <ArrowUp :size="11" aria-hidden="true" />
              {{ snapshot?.ahead || 0 }}
            </span>
            <span
              :class="
                cn(
                  'flex items-center gap-1 border-l border-border-subtle px-1.5 py-1 font-mono font-bold',
                  (snapshot?.behind || 0) > 0 ? 'text-status-warning' : 'text-on-surface-variant',
                )
              "
            >
              <ArrowDown :size="11" aria-hidden="true" />
              {{ snapshot?.behind || 0 }}
            </span>
          </div>
          <div class="min-w-0" data-git-refresh-exempt @click.stop>
            <button
              type="button"
              data-git-top-menu-trigger
              :class="
                cn(
                  'flex max-w-56 items-center gap-1 rounded border border-border-subtle bg-surface-container-low px-2 py-1 text-[10px] font-semibold transition-colors hover:bg-surface-variant',
                  upstream ? 'text-primary' : remotes.length > 0 ? 'text-status-warning' : 'text-on-surface-variant',
                )
              "
              :title="remoteStatusText"
              aria-label="Git remote 状态"
              @click="toggleRemoteMenu"
            >
              <span class="min-w-0 truncate">{{ remoteStatusText }}</span>
              <ChevronDown :size="11" class="shrink-0" />
            </button>
            <Teleport to="body">
              <Transition name="fade">
                <div
                  v-if="isRemoteMenuOpen"
                  ref="remoteMenuRef"
                  data-git-top-menu
                  class="fixed z-[80] w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-border-subtle bg-surface-container-lowest text-xs shadow-2xl"
                  :style="floatingMenuStyle(remoteMenuPosition)"
                  role="menu"
                  @click.stop
                >
                  <div v-overlay-scrollbar class="themed-scrollbar max-h-[calc(100vh-1rem)] overflow-y-auto">
                    <div class="flex items-center justify-between gap-2 border-b border-border-subtle px-2.5 py-1.5">
                      <span class="truncate text-[10px] font-bold uppercase text-on-surface-variant">Remote</span>
                      <span class="shrink-0 font-mono text-[10px] text-on-surface-variant"
                        >{{ remotes.length }} 个</span
                      >
                    </div>
                    <div v-if="remotes.length > 0" class="border-b border-border-subtle">
                      <div v-overlay-scrollbar class="themed-scrollbar max-h-36 overflow-y-auto py-0.5">
                        <div
                          v-for="remote in remotes"
                          :key="remote.name"
                          class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 hover:bg-surface-variant"
                        >
                          <div class="min-w-0">
                            <div class="flex min-w-0 items-center gap-1.5">
                              <span class="truncate font-mono text-[11px] font-bold text-on-surface">{{
                                remote.name
                              }}</span>
                              <span
                                v-if="upstream?.remote === remote.name"
                                class="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-px text-[9px] font-bold text-primary"
                              >
                                upstream
                              </span>
                            </div>
                            <p
                              class="truncate font-mono text-[10px] text-on-surface-variant"
                              :title="remote.fetchUrl || remote.pushUrl"
                            >
                              {{ remote.fetchUrl || remote.pushUrl }}
                            </p>
                          </div>
                          <div
                            class="flex shrink-0 items-center gap-px"
                            role="group"
                            :aria-label="`${remote.name} remote 管理操作`"
                          >
                            <button
                              v-if="canPublishGitBranch"
                              type="button"
                              class="git-section-action"
                              :disabled="isAnyGitWriteRunning"
                              :aria-busy="activeGitAction === `remote:publish:${remote.name}`"
                              :title="`发布当前分支到 ${remote.name}`"
                              :aria-label="`发布当前分支到 ${remote.name}`"
                              @click="requestPublishGitBranch(remote)"
                            >
                              <CloudUpload :size="12" />
                            </button>
                            <button
                              type="button"
                              class="git-section-action"
                              :disabled="isAnyGitWriteRunning"
                              :aria-busy="isAnyGitWriteRunning"
                              :title="`编辑 ${remote.name} URL`"
                              :aria-label="`编辑 ${remote.name} URL`"
                              @click="openEditRemoteDialog(remote)"
                            >
                              <SlidersHorizontal :size="12" />
                            </button>
                            <button
                              type="button"
                              class="git-section-action git-action-danger"
                              :disabled="isAnyGitWriteRunning"
                              :aria-busy="isAnyGitWriteRunning"
                              :title="`删除 ${remote.name}`"
                              :aria-label="`删除 ${remote.name}`"
                              @click="requestRemoveRemote(remote)"
                            >
                              <X :size="12" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div v-else class="border-b border-border-subtle px-2.5 py-3 text-[11px] text-on-surface-variant">
                      暂无 remote
                    </div>
                    <div v-if="remotes.length > 0" class="border-b border-border-subtle">
                      <div class="flex items-center justify-between gap-2 px-2.5 py-1.5">
                        <span class="text-[10px] font-bold uppercase text-on-surface-variant">远端分支</span>
                        <span class="font-mono text-[10px] text-on-surface-variant">{{ remoteBranches.length }}</span>
                      </div>
                      <label class="relative mx-2.5 mb-1.5 flex items-center">
                        <Search
                          :size="12"
                          class="pointer-events-none absolute left-2 text-on-surface-variant"
                          aria-hidden="true"
                        />
                        <input
                          v-model="remoteBranchQuery"
                          type="search"
                          class="h-7 w-full rounded border border-border-subtle bg-surface-container-low py-1 pl-7 pr-2 font-mono text-[10px] text-on-surface outline-none placeholder:text-on-surface-variant focus:border-primary"
                          placeholder="筛选远端分支"
                          aria-label="筛选远端分支"
                        />
                      </label>
                      <div
                        v-overlay-scrollbar
                        class="themed-scrollbar max-h-48 overflow-y-auto border-t border-border-subtle py-0.5"
                      >
                        <section
                          v-for="group in remoteBranchGroups"
                          :key="group.remote.name"
                          class="border-b border-border-subtle last:border-b-0"
                        >
                          <div
                            class="flex min-w-0 items-center gap-1.5 px-2.5 py-1 text-[10px] text-on-surface-variant"
                          >
                            <span class="min-w-0 flex-1 truncate font-mono font-bold text-on-surface">{{
                              group.remote.name
                            }}</span>
                            <span class="shrink-0 font-mono">{{ group.branches.length }}</span>
                            <button
                              type="button"
                              class="git-section-action"
                              :disabled="isAnyGitWriteRunning"
                              :aria-busy="activeGitAction === `remote:fetch:${group.remote.name}`"
                              :title="`刷新 ${group.remote.name} 的远端分支`"
                              :aria-label="`刷新 ${group.remote.name} 的远端分支`"
                              @click="executeFetchGitRemoteByName(group.remote.name)"
                            >
                              <RefreshCw
                                :size="12"
                                :class="activeGitAction === `remote:fetch:${group.remote.name}` ? 'animate-spin' : ''"
                              />
                            </button>
                          </div>
                          <div v-if="group.branches.length > 0" class="py-0.5">
                            <div
                              v-for="branch in group.branches"
                              :key="branch.ref"
                              class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1 hover:bg-surface-variant"
                            >
                              <div class="flex min-w-0 items-center gap-1.5">
                                <GitBranch :size="11" class="shrink-0 text-on-surface-variant" aria-hidden="true" />
                                <span
                                  class="min-w-0 flex-1 truncate font-mono text-[10px] text-on-surface"
                                  :title="branch.ref"
                                  >{{ branch.branch }}</span
                                >
                                <span
                                  v-if="upstream?.ref === branch.ref"
                                  class="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1 py-px text-[8px] font-bold text-primary"
                                >
                                  upstream
                                </span>
                                <span
                                  v-else-if="localBranchNames.has(branch.branch)"
                                  class="shrink-0 text-[8px] font-bold text-on-surface-variant"
                                >
                                  本地已存在
                                </span>
                              </div>
                              <div class="flex shrink-0 items-center gap-px">
                                <button
                                  v-if="!localBranchNames.has(branch.branch)"
                                  type="button"
                                  class="git-section-action"
                                  :disabled="isAnyGitWriteRunning"
                                  :aria-busy="activeGitAction === `remote:checkout:${branch.ref}`"
                                  :title="`检出 ${branch.ref} 为 tracking 分支`"
                                  :aria-label="`检出 ${branch.ref} 为 tracking 分支`"
                                  @click="requestCheckoutRemoteBranch(branch)"
                                >
                                  <CloudDownload :size="12" />
                                </button>
                                <button
                                  type="button"
                                  class="git-section-action git-action-danger"
                                  :disabled="isAnyGitWriteRunning"
                                  :aria-busy="activeGitAction === `remote:delete-branch:${branch.ref}`"
                                  :title="`删除 ${branch.ref} 的远端分支`"
                                  :aria-label="`删除 ${branch.ref} 的远端分支`"
                                  @click="requestDeleteGitRemoteBranch(group.remote, branch)"
                                >
                                  <Trash2 :size="12" />
                                </button>
                              </div>
                            </div>
                          </div>
                          <div v-else class="px-2.5 py-1.5 text-[10px] text-on-surface-variant">
                            {{ remoteBranchQuery ? "无匹配分支" : "尚未获取远端分支" }}
                          </div>
                        </section>
                      </div>
                    </div>
                    <div class="border-t border-border-subtle p-1">
                      <button
                        type="button"
                        role="menuitem"
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
              </Transition>
            </Teleport>
          </div>
          <span
            class="flex min-w-0 flex-1 items-center gap-1 border-l border-border-subtle pl-2 text-[10px] text-on-surface-variant"
            :title="topBarStatusText"
          >
            <FileDiff :size="12" class="shrink-0" aria-hidden="true" />
            <span class="min-w-0 truncate">{{ topBarStatusText }}</span>
          </span>
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
        </div>
        <div class="flex shrink-0 gap-1">
          <button
            type="button"
            class="git-top-action"
            :disabled="!canRunRemoteOperation"
            :aria-busy="activeGitAction === 'remote:fetch'"
            :title="remoteActionTitle('fetch')"
            :aria-label="remoteActionTitle('fetch')"
            @click="executeGitRemoteAction('fetch')"
          >
            <CloudDownload :size="14" :class="activeGitAction === 'remote:fetch' ? 'animate-pulse' : ''" />
          </button>
          <button
            type="button"
            class="git-top-action"
            :disabled="!canRunRemoteOperation"
            :aria-busy="activeGitAction === 'remote:pull'"
            :title="remoteActionTitle('pull')"
            :aria-label="remoteActionTitle('pull')"
            @click="executeGitRemoteAction('pull')"
          >
            <GitPullRequestArrow :size="14" :class="activeGitAction === 'remote:pull' ? 'animate-pulse' : ''" />
          </button>
          <button
            type="button"
            class="git-top-action"
            :disabled="!canRunRemoteOperation && !canPublishGitBranch"
            :aria-busy="activeGitAction === 'remote:push' || activeGitAction.startsWith('remote:publish:')"
            :title="publishGitBranchTitle()"
            :aria-label="publishGitBranchTitle()"
            @click="handlePushAction"
          >
            <CloudUpload
              :size="14"
              :class="
                activeGitAction === 'remote:push' || activeGitAction.startsWith('remote:publish:')
                  ? 'animate-pulse'
                  : ''
              "
            />
          </button>
        </div>
      </div>

      <div
        v-if="repositorySectionOpen && gitWorkspaceRelatedCount > 0"
        class="themed-scrollbar max-h-40 overflow-y-auto border-t border-border-subtle bg-surface-container-lowest py-1"
      >
        <div
          v-for="row in repositoryRows"
          :key="row.key"
          role="button"
          :tabindex="row.selectable && !isAnyGitWriteRunning ? 0 : -1"
          :aria-disabled="!row.selectable || isAnyGitWriteRunning"
          :aria-label="`${row.name}，${row.kindLabel}，${row.branchLabel}，${row.statusText}`"
          :class="
            cn(
              'group grid min-h-9 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-l-2 pr-1.5 transition-colors',
              row.depth === 1 ? 'pl-3' : 'pl-2',
              row.selected ? 'border-primary bg-primary/10' : 'border-transparent',
              row.selectable && !isAnyGitWriteRunning
                ? 'cursor-pointer hover:bg-surface-variant focus-visible:bg-surface-variant focus-visible:outline-none'
                : 'cursor-not-allowed opacity-65',
            )
          "
          @click="selectGitRepository(row)"
          @keydown.enter.prevent="selectGitRepository(row)"
          @keydown.space.prevent="selectGitRepository(row)"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span
              v-if="row.depth === 1"
              class="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border-subtle bg-surface-container-low text-on-surface-variant"
              title="子模块"
            >
              <FolderOpen :size="10" aria-hidden="true" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-1.5">
                <span class="truncate text-[11px] font-semibold text-on-surface" :title="row.repositoryPath">{{
                  row.name
                }}</span>
                <span
                  :class="
                    cn(
                      'shrink-0 rounded border border-border-subtle bg-surface-container-low px-1 py-px text-[8px] font-semibold leading-none',
                      row.target.kind === 'submodule' ? 'text-primary' : 'text-on-surface-variant',
                    )
                  "
                >
                  {{ row.kindLabel }}
                </span>
              </div>
              <div class="flex min-w-0 items-center gap-1.5 text-[9px] text-on-surface-variant">
                <span class="truncate font-mono">{{ row.branchLabel }}</span>
                <span v-if="row.changeCount !== null" class="shrink-0">{{ row.changeCount }} changes</span>
                <span
                  class="shrink-0 truncate"
                  :class="
                    row.health === 'unavailable'
                      ? 'text-status-error'
                      : row.health === 'warning'
                        ? 'text-status-warning'
                        : 'text-status-running'
                  "
                  :title="row.statusText"
                >
                  {{ row.statusText }}
                </span>
              </div>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-px" data-git-refresh-exempt @click.stop>
            <ExternalApplicationLaunchButton
              v-if="row.selected && row.selectable"
              :applications="store.externalApplicationPreferences.applications"
              :default-application-id="store.externalApplicationPreferences.defaultApplicationId"
              button-class="git-section-action"
              :icon-size="13"
              @launch="openRepositoryWithApplication($event, row)"
            />
            <button
              type="button"
              class="git-section-action"
              title="更多仓库操作"
              :aria-label="`${row.name} 更多操作`"
              @click="openRepositoryMenu($event, row)"
            >
              <MoreHorizontal :size="13" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="repositoryMenu"
          data-repository-menu
          class="themed-scrollbar fixed z-[80] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border-subtle bg-surface p-1 text-xs shadow-2xl"
          :style="repositoryMenuStyle"
          role="menu"
          @click.stop
        >
          <div class="border-b border-border-subtle px-2 py-1.5">
            <div class="truncate text-[11px] font-bold text-on-surface">{{ repositoryMenu.row.name }}</div>
            <div
              class="truncate font-mono text-[9px] text-on-surface-variant"
              :title="repositoryMenu.row.repositoryPath"
            >
              {{ repositoryMenu.row.repositoryPath }}
            </div>
            <div class="mt-1 text-[9px] text-on-surface-variant">{{ repositoryMenu.row.statusText }}</div>
            <div class="mt-1.5 space-y-1 border-t border-border-subtle pt-1.5">
              <div
                v-for="detail in repositoryMenu.row.detailLines"
                :key="detail"
                class="break-all font-mono text-[9px] leading-3 text-on-surface-variant"
              >
                {{ detail }}
              </div>
            </div>
          </div>
          <button
            v-for="application in repositoryMenu.row.selectable ? enabledExternalApplications : []"
            :key="application.id"
            type="button"
            role="menuitem"
            class="mode-menu-item"
            @click="openRepositoryWithApplication(application.id)"
          >
            <span class="truncate">{{ application.name }}</span>
            <Check
              v-if="application.id === store.externalApplicationPreferences.defaultApplicationId"
              :size="13"
              class="shrink-0 text-primary"
            />
            <ExternalLink v-else :size="13" class="shrink-0" />
          </button>
          <button
            v-if="repositoryMenu.row.selectable"
            type="button"
            role="menuitem"
            class="mode-menu-item"
            @click="runRepositoryExternalAction('terminal')"
          >
            <span>在终端中打开</span><SquareTerminal :size="13" />
          </button>
          <button
            v-if="repositoryMenu.row.selectable"
            type="button"
            role="menuitem"
            class="mode-menu-item"
            @click="runRepositoryExternalAction('folder')"
          >
            <span>在文件夹中显示</span><FolderOpen :size="13" />
          </button>
          <button type="button" role="menuitem" class="mode-menu-item" @click="copyRepositoryPath">
            <span>复制路径</span><ClipboardCopy :size="13" />
          </button>
        </div>
      </Transition>
    </Teleport>

    <div ref="splitContainerRef" class="relative grid min-h-0 flex-1 overflow-hidden" :style="gridTemplateStyle">
      <div
        ref="filesPaneRef"
        class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm"
      >
        <div
          class="flex h-8 shrink-0 min-w-0 items-center gap-1 overflow-x-clip border-b border-border-subtle bg-surface-container-low px-1.5"
        >
          <div
            role="tablist"
            aria-label="Git 左侧内容"
            class="flex h-6 shrink-0 items-center gap-0.5 rounded-md bg-surface-container-high p-0.5"
            @keydown="handleLeftContextKeydown"
          >
            <button
              id="git-changes-tab"
              ref="gitChangesTabRef"
              type="button"
              role="tab"
              aria-controls="git-changes-panel"
              :aria-selected="leftContext === 'changes'"
              :tabindex="leftContext === 'changes' ? 0 : -1"
              :aria-label="activeRepositoryChangeCount > 0 ? `更改（${activeRepositoryChangeCount} 项）` : '更改'"
              :style="gitTabBadgeStyle(activeRepositoryChangeCount)"
              :class="
                cn(
                  'relative h-5 rounded px-1.5 text-[10px] font-semibold text-on-surface-variant transition-colors hover:text-on-surface focus-visible:outline-none',
                  leftContext === 'changes' && 'bg-surface text-on-surface shadow-sm',
                )
              "
              @click="setLeftContext('changes')"
            >
              更改
              <span
                v-if="activeRepositoryChangeCount > 0"
                aria-hidden="true"
                class="absolute right-0.5 top-0.5 z-10 inline-flex h-3 min-w-3 items-center justify-center whitespace-nowrap rounded-full bg-primary px-0.5 font-mono text-[8px] font-bold leading-none text-on-primary shadow-sm"
              >
                {{ activeRepositoryChangeCount }}
              </span>
            </button>
            <button
              id="git-history-tab"
              ref="gitHistoryTabRef"
              type="button"
              role="tab"
              aria-controls="git-commit-history-panel"
              :aria-selected="leftContext === 'history'"
              :tabindex="leftContext === 'history' ? 0 : -1"
              :aria-label="activeRepositoryCommitCount > 0 ? `提交（${activeRepositoryCommitCount} 个提交）` : '提交'"
              :style="gitTabBadgeStyle(activeRepositoryCommitCount)"
              :class="
                cn(
                  'relative h-5 rounded px-1.5 text-[10px] font-semibold text-on-surface-variant transition-colors hover:text-on-surface focus-visible:outline-none',
                  leftContext === 'history' && 'bg-surface text-on-surface shadow-sm',
                )
              "
              @click="setLeftContext('history')"
            >
              提交
              <span
                v-if="activeRepositoryCommitCount > 0"
                aria-hidden="true"
                class="absolute right-0.5 top-0.5 z-10 inline-flex h-3 min-w-3 items-center justify-center whitespace-nowrap rounded-full border border-border-subtle bg-surface px-0.5 font-mono text-[8px] font-bold leading-none text-on-surface-variant shadow-sm"
              >
                {{ activeRepositoryCommitCount }}
              </span>
            </button>
          </div>
          <span
            v-if="leftContext === 'history'"
            class="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded text-on-surface-variant transition-colors hover:text-primary focus:text-primary focus:outline-none"
            role="img"
            tabindex="0"
            :title="t.git.historyInteractionsHint"
            :aria-label="t.git.historyInteractionsHint"
          >
            <CircleHelp :size="12" :stroke-width="1.8" aria-hidden="true" />
          </span>
          <div v-show="leftContext === 'changes'" class="flex min-w-0 flex-1 overflow-x-clip">
            <div ref="changesToolbarRef" class="git-left-toolbar ml-auto flex h-6 w-max shrink-0 items-center gap-px" />
          </div>
          <div v-show="leftContext === 'history'" class="flex min-w-0 flex-1 overflow-x-clip">
            <div
              ref="commitHistoryToolbarRef"
              class="git-left-toolbar ml-auto flex h-6 w-max shrink-0 items-center gap-px"
            />
          </div>
        </div>

        <div
          v-show="leftContext === 'changes'"
          id="git-changes-panel"
          role="tabpanel"
          aria-labelledby="git-changes-tab"
          class="flex min-h-0 flex-1 flex-col"
        >
          <GitChangesPane
            class="min-h-0 min-w-0 flex-1"
            :project-id="props.project.id"
            :repository-target="activeRepositoryTarget"
            :toolbar-target="changesToolbarRef"
            :open="leftContext === 'changes'"
            :commit-message="commitMessage"
            :selection="worktreeSelection"
            :disabled="isChangesPaneExternallyDisabled"
            @update:open="setChangesSectionOpen"
            @update:commit-message="(message) => (commitMessage = message)"
            @select-file="handleChangesFileSelection"
            @open-file="handleOpenFile"
            @feedback="handleChangesFeedback"
            @busy-change="(busy) => (isChangesPaneBusy = busy)"
            @worktree-action-started="invalidateWorktreeDiffRequest"
            @committed="clearCommitSelection"
          />
        </div>

        <div
          v-show="leftContext === 'history'"
          id="git-commit-history-panel"
          role="tabpanel"
          aria-labelledby="git-history-tab"
          class="flex min-h-0 flex-1 flex-col"
        >
          <GitCommitHistory
            class="min-h-0 min-w-0"
            :project-id="props.project.id"
            :repository-target="activeRepositoryTarget"
            :toolbar-target="commitHistoryToolbarRef"
            :open="leftContext === 'history'"
            :disabled="isAnyGitWriteRunning"
            :selected-commit-hashes="selectedCommitHashes"
            @update:selected-commit-hashes="(hashes) => (selectedCommitHashes = hashes)"
            @review-file="({ commitHash, commitMessage, path }) => handleViewDiff(commitHash, path, commitMessage)"
            @request-ai="openAiDialog"
            @feedback="setGitActionResult"
            @busy-change="(busy) => (isCommitHistoryBusy = busy)"
          />
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
        @pointerdown="startResize($event)"
        @keydown="handleSeparatorKeydown($event)"
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
        class="@container flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm"
      >
        <Teleport to="body" :disabled="!isDiffViewerExpanded">
          <div
            :class="
              isDiffViewerExpanded
                ? 'fixed inset-0 z-[90] flex items-center justify-center bg-scrim/35 p-4 backdrop-blur-sm'
                : 'flex min-h-0 flex-1 flex-col'
            "
            :role="isDiffViewerExpanded ? 'dialog' : undefined"
            :aria-modal="isDiffViewerExpanded ? 'true' : undefined"
            aria-label="放大 Git diff 审阅"
            @click.self="closeDiffViewerDialog"
          >
            <div
              :class="
                isDiffViewerExpanded
                  ? 'flex h-[min(92vh,72rem)] w-[min(96vw,96rem)] overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-2xl'
                  : 'flex min-h-0 flex-1 flex-col'
              "
            >
              <GitDiffViewer
                v-if="worktreeSelection || commitReviewSelection"
                v-model:scroll-top="reviewScrollTop"
                :diff="worktreeSelection ? worktreeDiff?.diff : selectedDiff?.diff"
                :path="worktreeSelection?.path || commitReviewSelection?.path || ''"
                :branch="currentGitRefLabel"
                :subtitle="worktreeSelection ? worktreeSelection.scope : commitReviewSelection?.commitMessage || ''"
                :loading="worktreeSelection ? isLoadingWorktreeDiff : isLoadingDiff"
                :message="(worktreeSelection ? worktreeDiff?.message : selectedDiff?.message) || t.git.diffEmpty"
                :full-file="diffReadOptions.fullFile"
                :ignore-whitespace="diffReadOptions.ignoreWhitespace"
                :expanded="isDiffViewerExpanded"
                @update:full-file="(fullFile) => updateDiffReadOptions({ fullFile })"
                @update:ignore-whitespace="(ignoreWhitespace) => updateDiffReadOptions({ ignoreWhitespace })"
                @toggle-expanded="toggleDiffViewerDialog"
              />
              <div
                v-else
                class="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-xs text-on-surface-variant"
              >
                从左侧变更列表或提交树展开文件中选择文件。
              </div>
            </div>
          </div>
        </Teleport>
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
              class="git-top-action"
              :disabled="isAnyGitWriteRunning"
              :aria-busy="isAnyGitWriteRunning"
              :title="t.common.close"
              :aria-label="t.common.close"
              @click="closeRemoteDialog"
            >
              <X :size="14" />
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
                class="git-dialog-secondary"
                :disabled="isAnyGitWriteRunning"
                @click="closeRemoteDialog"
              >
                {{ t.common.cancel }}
              </button>
              <button
                type="button"
                class="git-dialog-primary"
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

    <GitAiAnalysisDialog
      :open="isAiDialogOpen"
      :project-id="props.project.id"
      :repository-target="activeRepositoryTarget"
      :selected-commit-hashes="selectedCommitHashes"
      @close="closeAiDialog"
      @feedback="setGitActionResult"
    />

    <ActionDialog
      :open="Boolean(confirmationDialog)"
      :tone="confirmationDialog?.kind || 'danger'"
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
  </div>
</template>
