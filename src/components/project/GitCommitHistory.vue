<script lang="ts">
import type { CommitFileViewMode as RememberedCommitFileViewMode } from "../../lib/gitCommitFileTree";

let rememberedCommitFileViewMode: RememberedCommitFileViewMode = "list";
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import {
  Archive,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  CloudDownload,
  Copy,
  Filter,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  Github,
  List,
  ListChecks,
  ListTree,
  ListX,
  Pencil,
  Tag,
  Target,
  Trash2,
  Undo,
  WandSparkles,
  X,
} from "lucide-vue-next";
import type {
  ProjectGitActionResult,
  ProjectGitCommitRef,
  ProjectGitCommitSummary,
  ProjectGitFileChange,
  ProjectGitRepositoryTarget,
  ProjectGitTagInfo,
} from "../../types";
import {
  collapseGitStashAuxiliaryCommits,
  GIT_COMMIT_GRAPH_GEOMETRY,
  isGitStashCommit,
  layoutGitCommitGraph,
  selectGitCommitGraphWindow,
  type GitCommitGraphRow,
  type GitCommitGraphSegment,
} from "../../lib/gitCommitGraph";
import {
  buildCommitFileItems,
  normalizeCommitFilePath,
  type CommitFileDisplayItem,
  type CommitFileViewMode,
} from "../../lib/gitCommitFileTree";
import {
  clearGitCommitTooltipSessionsForProject,
  hasUsableGitCommitShortStats,
  loadGitCommitTooltipSessionDetails,
  markGitCommitTooltipSessionAvatarUnavailable,
  pruneGitCommitTooltipSession,
} from "../../lib/gitCommitTooltipSession";
import {
  gitCommitRefIdentity,
  presentGitCommitRefs,
  type GitCommitRefPresentationMember,
} from "../../lib/gitCommitRefs";
import { getGitHubCommitUrl } from "../../lib/gitHubCommitUrl";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { useI18n } from "../../lib/i18n";
import { renderMarkdown } from "../../lib/markdown";
import { getProjectBridge } from "../../lib/projectBridge";
import { cn, transferWheelAtScrollBoundary } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import ActionDialog from "../common/ActionDialog.vue";

defineOptions({ inheritAttrs: false });

type GitFeedbackState = "loading" | "success" | "warning" | "error";
type CommitReviewFileRequest = { commitHash: string; commitMessage: string; path: string };
type ExpandedCommitFilesState = {
  files: ProjectGitFileChange[];
  isLoading: boolean;
  error: string;
  requestGeneration: number;
  contextGeneration: number;
};
type CommitTooltipState = { commit: ProjectGitCommitSummary; top: number; bottom: number };
type PendingCommitTooltipState = { commit: ProjectGitCommitSummary; trigger: HTMLElement };
type CommitTooltipDetailsState = {
  hash: string;
  files: ProjectGitFileChange[] | null;
  isLoadingFiles: boolean;
  filesUnavailable: boolean;
  avatarUrl: string | null;
  isLoadingAvatar: boolean;
  requestGeneration: number;
  contextGeneration: number;
  contextKey: string;
};
type CommitTooltipSummary = {
  state: "loading" | "ready" | "unavailable";
  fileCount: number;
  additions: number;
  deletions: number;
};
type CommitTooltipContent = {
  title: string;
  body: string;
  renderedBody: string;
  authorInitials: string;
  authorAvatarClass: string;
};
type CommitContextMenuState = {
  commit: ProjectGitCommitSummary;
  x: number;
  y: number;
  opensUpward: boolean;
  maxHeight: number;
};
type CommitBranchRef = { kind: "local" | "remote"; name: string; current: boolean };
type CommitTagRef = { name: string };
type CommitSubmenuContent = { kind: "branch"; branch: CommitBranchRef } | { kind: "tag"; tag: CommitTagRef };
type CommitSubmenuState = CommitSubmenuContent & { left: number; top: number; parent: HTMLElement };
type RefDialogMode = "create-branch" | "rename-branch" | "create-tag";
type RefDialogState = { mode: RefDialogMode; commit: ProjectGitCommitSummary; sourceBranch?: string };
type TagInfoDialogState = {
  tagName: string;
  info: ProjectGitTagInfo | null;
  isLoading: boolean;
  error: string;
};
type GitHistoryAction = "cherry-pick" | "revert";
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
type GitGraphPathMode = "vertical" | "fanOut" | "fanIn";
type FloatingMenuPosition = { left: number; top: number };
type DatePickerKind = "since" | "until";

const props = withDefaults(
  defineProps<{
    projectId: string;
    repositoryTarget: ProjectGitRepositoryTarget;
    open: boolean;
    toolbarTarget?: HTMLElement | null;
    disabled?: boolean;
    selectedCommitHashes: string[];
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  (event: "update:open", value: boolean): void;
  (event: "update:selectedCommitHashes", value: string[]): void;
  (event: "review-file", request: CommitReviewFileRequest): void;
  (event: "request-ai"): void;
  (event: "feedback", state: GitFeedbackState, message: string): void;
  (event: "busy-change", busy: boolean): void;
}>();

const store = useStore();
const t = useI18n();
const graphScrollRef = ref<HTMLElement | null>(null);
const graphViewport = ref({ top: 0, height: 0 });
const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const commitFilterTriggerRef = ref<HTMLElement | null>(null);
const commitFiltersPopoverRef = ref<HTMLElement | null>(null);
const commitSinceDatePickerTriggerRef = ref<HTMLElement | null>(null);
const commitUntilDatePickerTriggerRef = ref<HTMLElement | null>(null);
const commitDatePickerPopoverRef = ref<HTMLElement | null>(null);
const commitDatePickerPosition = ref<FloatingMenuPosition>({ left: 8, top: 8 });
const showCommitFilters = ref(false);
const commitKeyword = ref("");
const commitAuthor = ref("");
const commitHash = ref("");
const commitSince = ref("");
const commitUntil = ref("");
const openDatePickerKind = ref<DatePickerKind | null>(null);
const datePickerMonth = ref(new Date());
const commitFileViewMode = ref<CommitFileViewMode>(rememberedCommitFileViewMode);
const expandedCommitFiles = ref<Record<string, ExpandedCommitFilesState>>({});
const expandedCommitDirectories = ref<Record<string, Record<string, boolean>>>({});
const commitTooltip = ref<CommitTooltipState | null>(null);
const pendingCommitTooltip = ref<PendingCommitTooltipState | null>(null);
const commitTooltipRef = ref<HTMLElement | null>(null);
const commitTooltipHeight = ref(0);
const commitTooltipReady = ref(false);
const commitTooltipDetails = ref<CommitTooltipDetailsState | null>(null);
const commitContextMenu = ref<CommitContextMenuState | null>(null);
const commitContextMenuRef = ref<HTMLElement | null>(null);
const commitSubmenu = ref<CommitSubmenuState | null>(null);
const commitSubmenuRef = ref<HTMLElement | null>(null);
const commitMenuOpener = ref<HTMLElement | null>(null);
const refDialog = ref<RefDialogState | null>(null);
const refDialogName = ref("");
const refDialogMessage = ref("");
const refDialogCheckout = ref(false);
const refDialogAnnotated = ref(false);
const refDialogError = ref("");
const refDialogInputRef = ref<HTMLInputElement | null>(null);
const tagInfoDialog = ref<TagInfoDialogState | null>(null);
const confirmationDialog = ref<AppActionDialog | null>(null);
const confirmationBusy = ref(false);
const activeAction = ref("");
const copiedText = ref("");
const copiedTimer = ref<number | undefined>();
let commitFilesRequestGeneration = 0;
let commitFilesContextGeneration = 0;
let commitTooltipDetailsRequestGeneration = 0;
let commitTooltipDetailsContextGeneration = 0;
let commitTooltipOpenTimer: number | undefined;
let commitTooltipCloseTimer: number | undefined;
let commitTooltipResizeObserver: ResizeObserver | null = null;
let commitTooltipLayoutScheduled = false;
let graphViewportFrame: number | undefined;
let graphViewportResizeObserver: ResizeObserver | null = null;
let pendingGraphScrollAnchor: { hash: string; offset: number } | null = null;
let graphScrollAnchorRestoreScheduled = false;
let loadMoreObserver: IntersectionObserver | null = null;
let loadMoreSentinelWasIntersecting = false;
let tagInfoRequestGeneration = 0;
let stopAppEscapeListener = () => {};

const context = computed(() => store.resolveGitRepositoryContext(props.projectId, props.repositoryTarget));
const snapshot = computed(() => store.gitSnapshotForRepository(props.projectId, props.repositoryTarget));
const projectPath = computed(() => store.projects.find((project) => project.id === props.projectId)?.path || "");
const tagPushRemotes = computed(() => {
  const remotes = snapshot.value?.remotes || [];
  const upstreamRemote = snapshot.value?.upstream?.remote;
  if (!upstreamRemote) return remotes;
  const upstream = remotes.find((remote) => remote.name === upstreamRemote);
  return upstream ? [upstream, ...remotes.filter((remote) => remote.name !== upstreamRemote)] : remotes;
});
const tagInfoDialogInfo = computed(() => tagInfoDialog.value?.info || null);
const isLoadingMore = computed(() => {
  const contextKey = context.value?.contextKey;
  return Boolean(contextKey && store.gitRepositoryLoadingMore[contextKey]);
});
const localWriteRunning = computed(
  () => Boolean(activeAction.value) || (store.gitWritesInProgress[props.projectId] || 0) > 0,
);
const isInteractionDisabled = computed(() => props.disabled || localWriteRunning.value);
const hasCommitFilters = computed(() =>
  Boolean(
    commitKeyword.value.trim() ||
    commitAuthor.value.trim() ||
    commitHash.value.trim() ||
    commitSince.value ||
    commitUntil.value,
  ),
);
const commitSearchInput = computed({
  get: () =>
    `${commitKeyword.value}${commitAuthor.value || commitHash.value ? ` / ${commitAuthor.value}` : ""}${
      commitHash.value ? ` / ${commitHash.value}` : ""
    }`,
  set: (value: string) => {
    const [keyword = "", author = "", hash = ""] = value.split("/", 3);
    commitKeyword.value = keyword.trim();
    commitAuthor.value = author.trim();
    commitHash.value = hash.trim();
  },
});
const weekDayLabels = ["日", "一", "二", "三", "四", "五", "六"];
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
const positionCommitDatePicker = (kind = openDatePickerKind.value) => {
  if (!kind) return;
  const trigger = kind === "since" ? commitSinceDatePickerTriggerRef.value : commitUntilDatePickerTriggerRef.value;
  if (!trigger) return;
  commitDatePickerPosition.value = positionFloatingMenu(trigger, 216, 292);
};
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
const openDatePicker = (kind: DatePickerKind) => {
  const selectedDate = parseDateValue(kind === "since" ? commitSince.value : commitUntil.value);
  datePickerMonth.value = selectedDate || new Date();
  if (openDatePickerKind.value === kind) {
    openDatePickerKind.value = null;
    return;
  }
  positionCommitDatePicker(kind);
  openDatePickerKind.value = kind;
};
const shiftDatePickerMonth = (offset: number) => {
  datePickerMonth.value = new Date(datePickerMonth.value.getFullYear(), datePickerMonth.value.getMonth() + offset, 1);
};
const selectDatePickerDay = (value: string) => {
  if (openDatePickerKind.value === "since") commitSince.value = value;
  else if (openDatePickerKind.value === "until") commitUntil.value = value;
  openDatePickerKind.value = null;
};
const clearDatePickerValue = () => {
  if (openDatePickerKind.value === "since") commitSince.value = "";
  else if (openDatePickerKind.value === "until") commitUntil.value = "";
};
const commits = computed(() => {
  const keyword = commitKeyword.value.trim().toLocaleLowerCase();
  const author = commitAuthor.value.trim().toLocaleLowerCase();
  const hash = commitHash.value.trim().toLocaleLowerCase();
  const since = commitSince.value ? new Date(`${commitSince.value}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const until = commitUntil.value ? new Date(`${commitUntil.value}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  return collapseGitStashAuxiliaryCommits(snapshot.value?.commits || []).filter((commit) => {
    const searchable = `${commit.message}\n${commit.body || ""}\n${commit.refs || ""}`.toLocaleLowerCase();
    const commitDate = new Date(commit.date).getTime();
    return (
      (!keyword || searchable.includes(keyword)) &&
      (!author || commit.author.toLocaleLowerCase().includes(author)) &&
      (!hash || commit.hash.toLocaleLowerCase().startsWith(hash)) &&
      (!Number.isFinite(commitDate) || (commitDate >= since && commitDate <= until))
    );
  });
});
const selectedCommitHashSet = computed(() => new Set(props.selectedCommitHashes));
const selectedCommitCount = computed(() => props.selectedCommitHashes.length);
const areAllVisibleCommitsSelected = computed(
  () => commits.value.length > 0 && commits.value.every((commit) => selectedCommitHashSet.value.has(commit.hash)),
);
const commitFileViewModeLabel = computed(() =>
  commitFileViewMode.value === "tree" ? "切换为平铺文件列表" : "切换为树形文件列表",
);

const clearCommitFilters = () => {
  commitKeyword.value = "";
  commitAuthor.value = "";
  commitHash.value = "";
  commitSince.value = "";
  commitUntil.value = "";
  openDatePickerKind.value = null;
};
const closeCommitFilters = () => {
  showCommitFilters.value = false;
  openDatePickerKind.value = null;
};
const toggleCommitFilters = () => {
  if (!props.open) emit("update:open", true);
  if (showCommitFilters.value) {
    closeCommitFilters();
    return;
  }
  showCommitFilters.value = true;
};
const updateSelectedHashes = (hashes: string[]) => emit("update:selectedCommitHashes", hashes);
const isCommitSelected = (hash: string) => selectedCommitHashSet.value.has(hash);
const toggleCommitSelection = (hash: string) =>
  updateSelectedHashes(
    isCommitSelected(hash)
      ? props.selectedCommitHashes.filter((selectedHash) => selectedHash !== hash)
      : [...props.selectedCommitHashes, hash],
  );
const selectVisibleCommits = () => {
  const next = new Set(props.selectedCommitHashes);
  commits.value.forEach((commit) => next.add(commit.hash));
  updateSelectedHashes([...next]);
};
const clearCommitSelection = () => updateSelectedHashes([]);

const isCommitDirectoryExpanded = (hash: string, path: string) =>
  expandedCommitDirectories.value[hash]?.[normalizeCommitFilePath(path)] !== false;
const gitFileDisplayPath = (file: ProjectGitFileChange) =>
  file.originalPath && file.originalPath !== file.path ? `${file.originalPath} -> ${file.path}` : file.path;
const gitFileName = (file: ProjectGitFileChange) => file.path.split(/[\\/]/).filter(Boolean).pop() || file.path;
const gitFileDirectory = (file: ProjectGitFileChange) =>
  file.path.split(/[\\/]/).filter(Boolean).slice(0, -1).join("/");
const toggleCommitDirectory = (hash: string, path: string) => {
  const normalizedPath = normalizeCommitFilePath(path);
  changeExpandedCommitFileGeometry(() => {
    const nextDirectories = { ...(expandedCommitDirectories.value[hash] || {}) };
    if (isCommitDirectoryExpanded(hash, normalizedPath)) nextDirectories[normalizedPath] = false;
    else delete nextDirectories[normalizedPath];
    const nextState = { ...expandedCommitDirectories.value };
    if (Object.keys(nextDirectories).length) nextState[hash] = nextDirectories;
    else delete nextState[hash];
    expandedCommitDirectories.value = nextState;
  });
};
const commitFileDisplayItems = (hash: string): CommitFileDisplayItem[] => {
  const state = expandedCommitFiles.value[hash];
  return state
    ? buildCommitFileItems(state.files, {
        mode: commitFileViewMode.value,
        collapsedPaths: expandedCommitDirectories.value[hash] || {},
      })
    : [];
};
const expandedCommitFilesHeight = (hash: string) => {
  const state = expandedCommitFiles.value[hash];
  if (!state) return 0;
  if (state.isLoading || state.error || state.files.length === 0) return 40;
  return Math.min(240, commitFileDisplayItems(hash).length * 24 + 10);
};
const isCommitFilesExpanded = (hash: string) => Boolean(expandedCommitFiles.value[hash]);
const clearExpandedCommitFiles = () => {
  commitFilesContextGeneration += 1;
  expandedCommitFiles.value = {};
  expandedCommitDirectories.value = {};
};
const closeExpandedCommitFiles = (hash: string) => {
  changeExpandedCommitFileGeometry(() => {
    const nextFiles = { ...expandedCommitFiles.value };
    const nextDirectories = { ...expandedCommitDirectories.value };
    delete nextFiles[hash];
    delete nextDirectories[hash];
    expandedCommitFiles.value = nextFiles;
    expandedCommitDirectories.value = nextDirectories;
  });
};
const stashForCommitHash = (hash: string) => commits.value.find((commit) => commit.hash === hash)?.stash;
const toggleCommitFiles = async (hash: string) => {
  hideCommitTooltip();
  if (isCommitFilesExpanded(hash)) {
    closeExpandedCommitFiles(hash);
    return;
  }
  const requestGeneration = ++commitFilesRequestGeneration;
  const contextGeneration = commitFilesContextGeneration;
  changeExpandedCommitFileGeometry(() => {
    expandedCommitFiles.value = {
      ...expandedCommitFiles.value,
      [hash]: { files: [], isLoading: true, error: "", requestGeneration, contextGeneration },
    };
  });
  try {
    const files = await store.readGitCommitFiles(
      props.projectId,
      hash,
      props.repositoryTarget,
      stashForCommitHash(hash),
    );
    const state = expandedCommitFiles.value[hash];
    if (state?.requestGeneration === requestGeneration && state.contextGeneration === contextGeneration) {
      changeExpandedCommitFileGeometry(() => {
        expandedCommitFiles.value = { ...expandedCommitFiles.value, [hash]: { ...state, files } };
      });
    }
  } catch (error) {
    const state = expandedCommitFiles.value[hash];
    if (state?.requestGeneration === requestGeneration && state.contextGeneration === contextGeneration) {
      changeExpandedCommitFileGeometry(() => {
        expandedCommitFiles.value = {
          ...expandedCommitFiles.value,
          [hash]: { ...state, error: error instanceof Error ? error.message : "读取提交文件失败。" },
        };
      });
    }
  } finally {
    const state = expandedCommitFiles.value[hash];
    if (state?.requestGeneration === requestGeneration && state.contextGeneration === contextGeneration) {
      changeExpandedCommitFileGeometry(() => {
        expandedCommitFiles.value = { ...expandedCommitFiles.value, [hash]: { ...state, isLoading: false } };
      });
    }
  }
};
const toggleCommitFileViewMode = () => {
  changeExpandedCommitFileGeometry(() => {
    commitFileViewMode.value = commitFileViewMode.value === "tree" ? "list" : "tree";
    rememberedCommitFileViewMode = commitFileViewMode.value;
  });
};

const graphRowPaddingX = 4;
const commitContextMenuViewportInset = 8;
const commitContextMenuMaxWidth = 208;
const commitContextMenuMaxHeight = 240;
const graphWindowOverscan = 256;
const { rowHeight, rowGap } = GIT_COMMIT_GRAPH_GEOMETRY;
const rowPitch = rowHeight + rowGap;
const graphStrokeColors = ["#2563eb", "#d97706", "#db2777", "#0f766e", "#7c3aed"];
const stashGraphColorIndex = 1;
const graphStrokeColor = (index: number) => graphStrokeColors[index % graphStrokeColors.length] || graphStrokeColors[0];
const graphNodeX = (lane: number) =>
  GIT_COMMIT_GRAPH_GEOMETRY.paddingX +
  lane * GIT_COMMIT_GRAPH_GEOMETRY.laneWidth +
  GIT_COMMIT_GRAPH_GEOMETRY.laneWidth / 2;
const graphPathData = (sourceX: number, sourceY: number, targetX: number, targetY: number, mode: GitGraphPathMode) => {
  if (sourceX === targetX) return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  const deltaY = targetY - sourceY;
  if (deltaY <= rowPitch) {
    const curveY = Math.max(rowHeight * 0.32, deltaY * 0.45);
    return `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + curveY} ${targetX} ${targetY - curveY} ${targetX} ${targetY}`;
  }
  const switchY =
    mode === "fanIn" ? Math.max(sourceY, targetY - rowPitch * 0.78) : Math.min(targetY, sourceY + rowPitch * 0.78);
  const curveY = Math.max(rowHeight * 0.28, Math.abs(switchY - sourceY) * 0.5);
  return mode === "fanIn"
    ? `M ${sourceX} ${sourceY} L ${sourceX} ${switchY} C ${sourceX} ${switchY + curveY} ${targetX} ${targetY - curveY} ${targetX} ${targetY}`
    : `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + curveY} ${targetX} ${switchY - curveY} ${targetX} ${switchY} L ${targetX} ${targetY}`;
};
const graphSegmentPathData = (segment: GitCommitGraphSegment) => {
  if (segment.kind === "root-termination" && segment.from.x === segment.to.x && segment.from.y === segment.to.y)
    return "";
  const mode: GitGraphPathMode =
    segment.kind === "duplicate-convergence" || segment.kind === "lane-shift"
      ? "fanIn"
      : segment.kind === "additional-parent-fan-out" || segment.kind === "first-parent-continuation"
        ? "fanOut"
        : "vertical";
  return graphPathData(segment.from.x, segment.from.y, segment.to.x, segment.to.y, mode);
};
const graphReferences = computed(() => {
  const references: { identity: string; name: string; colorIndex: number }[] = [];
  const currentSnapshot = snapshot.value;
  if (!currentSnapshot) return references;
  if (currentSnapshot.isDetachedHead) {
    references.push({ identity: gitCommitRefIdentity("head", "HEAD"), name: "HEAD", colorIndex: 0 });
  } else if (currentSnapshot.branch) {
    references.push({
      identity: gitCommitRefIdentity("local", currentSnapshot.branch),
      name: currentSnapshot.branch,
      colorIndex: 0,
    });
  }
  if (currentSnapshot.upstream?.ref) {
    references.push({
      identity: gitCommitRefIdentity("remote", currentSnapshot.upstream.ref),
      name: currentSnapshot.upstream.ref,
      colorIndex: 2,
    });
  }
  if (currentSnapshot.base?.ref) {
    references.push({
      identity: gitCommitRefIdentity("remote", currentSnapshot.base.ref),
      name: currentSnapshot.base.ref,
      colorIndex: 1,
    });
  }
  return references.filter(
    (reference, index) => references.findIndex((candidate) => candidate.identity === reference.identity) === index,
  );
});
const graphColorByRefIdentity = computed(() => {
  const colors: Record<string, number> = {};
  for (const reference of graphReferences.value) {
    colors[reference.identity] = reference.colorIndex;
  }
  return colors;
});
const graphCommitColorByHash = computed(() => {
  const colors: Record<string, number> = {};
  for (const commit of commits.value) {
    const refs = presentGitCommitRefs(commit, {
      branch: snapshot.value?.branch,
      headHash: snapshot.value?.headHash,
      isDetachedHead: snapshot.value?.isDetachedHead,
      branches: snapshot.value?.branches,
      remotes: snapshot.value?.remotes,
      upstream: snapshot.value?.upstream,
      base: snapshot.value?.base,
    }).full;
    const reference = graphReferences.value.find((candidate) =>
      refs.some((ref) => ref.identity === candidate.identity),
    );
    if (reference) {
      colors[commit.hash] = reference.colorIndex;
    } else if (isGitStashCommit(commit)) {
      colors[commit.hash] = stashGraphColorIndex;
    }
  }
  return colors;
});
const graphLayout = computed(() =>
  layoutGitCommitGraph(commits.value, {
    expandedRowHeights: Object.fromEntries(
      commits.value.map((commit) => [commit.hash, expandedCommitFilesHeight(commit.hash)]),
    ),
    colorIndexByCommitHash: graphCommitColorByHash.value,
  }),
);
const graphRows = computed(() => graphLayout.value.rows);
const graphWindow = computed(() =>
  selectGitCommitGraphWindow(graphLayout.value, {
    top: graphViewport.value.top,
    height: graphViewport.value.height,
    overscan: graphWindowOverscan,
  }),
);
const graphPaths = computed(() =>
  graphWindow.value.segments.flatMap(({ row, index, segment }) => {
    const d = graphSegmentPathData(segment);
    return d
      ? [
          {
            id: `${row.commit.hash}-${index}`,
            d,
            color: graphStrokeColor(segment.colorIndex),
            strokeDasharray:
              isGitStashCommit(row.commit) && (segment.fromLane === row.nodeLane || segment.toLane === row.nodeLane)
                ? "3 2"
                : undefined,
          },
        ]
      : [];
  }),
);
const graphNodes = computed(() =>
  graphWindow.value.nodes.map((row) => {
    const refs = commitRefPresentation(row.commit).full;
    const isHead = refs.some((ref) => ref.isCurrentHead);
    return {
      hash: row.commit.hash,
      x: graphNodeX(row.nodeLane),
      y: row.y,
      color: graphStrokeColor(row.nodeColorIndex),
      isHead,
      isMerge: row.isMerge,
      isStash: isGitStashCommit(row.commit),
    };
  }),
);
const graphCanvasWidth = computed(() => graphLayout.value.canvasWidth);
const graphContentHeight = computed(() => graphLayout.value.height);
const graphWindowHeight = computed(() => Math.max(0, graphWindow.value.bottom - graphWindow.value.top));
const graphViewBox = computed(
  () => `0 ${graphWindow.value.top} ${graphCanvasWidth.value} ${Math.max(1, graphWindowHeight.value)}`,
);
const graphLayerStyle = computed(() => ({
  left: `${graphRowPaddingX}px`,
  top: `${graphWindow.value.top}px`,
  width: `${graphCanvasWidth.value}px`,
  height: `${graphWindowHeight.value}px`,
}));
const graphSurfaceStyle = computed(() => ({
  minWidth: graphCanvasMinWidth.value,
  height: `${graphContentHeight.value}px`,
}));
const updateGraphViewport = () => {
  const root = graphScrollRef.value;
  const top = root?.scrollTop ?? 0;
  const height = root?.clientHeight ?? 0;
  if (graphViewport.value.top === top && graphViewport.value.height === height) return;
  graphViewport.value = { top, height };
};
const scheduleGraphViewportUpdate = () => {
  if (graphViewportFrame !== undefined) return;
  graphViewportFrame = window.requestAnimationFrame(() => {
    graphViewportFrame = undefined;
    updateGraphViewport();
  });
};
const observeGraphViewport = () => {
  graphViewportResizeObserver?.disconnect();
  graphViewportResizeObserver = null;
  const root = graphScrollRef.value;
  if (!root || !props.open) {
    updateGraphViewport();
    return;
  }
  if (typeof ResizeObserver !== "undefined") {
    graphViewportResizeObserver = new ResizeObserver(scheduleGraphViewportUpdate);
    graphViewportResizeObserver.observe(root);
  }
  scheduleGraphViewportUpdate();
};
const captureGraphScrollAnchor = () => {
  const root = graphScrollRef.value;
  if (!root) return null;
  const row = graphRows.value.find((candidate) => candidate.top + rowHeight + candidate.blockHeight > root.scrollTop);
  return row ? { hash: row.commit.hash, offset: root.scrollTop - row.top } : null;
};
const restoreGraphScrollAnchor = (anchor: { hash: string; offset: number } | null) => {
  if (!anchor) return;
  const root = graphScrollRef.value;
  const row = graphRows.value.find((candidate) => candidate.commit.hash === anchor.hash);
  if (!root || !row) return;
  const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
  root.scrollTop = Math.max(0, Math.min(row.top + anchor.offset, maxScrollTop));
  scheduleGraphViewportUpdate();
};
const changeExpandedCommitFileGeometry = (change: () => void) => {
  pendingGraphScrollAnchor ||= captureGraphScrollAnchor();
  change();
  if (graphScrollAnchorRestoreScheduled) return;
  graphScrollAnchorRestoreScheduled = true;
  void nextTick(() => {
    graphScrollAnchorRestoreScheduled = false;
    const anchor = pendingGraphScrollAnchor;
    pendingGraphScrollAnchor = null;
    restoreGraphScrollAnchor(anchor);
  });
};
const graphRowColumns = (row: GitCommitGraphRow) => `${row.graphWidth}px minmax(14rem, 1fr)`;
const graphRowMinWidth = (row: GitCommitGraphRow) => `max(16rem, calc(${row.graphWidth}px + 14rem + 9px))`;
const graphCanvasMinWidth = computed(() => `max(16rem, calc(${graphCanvasWidth.value}px + 14rem + 9px))`);

const refBadgeBaseClass = "git-ref-badge";
const refPresentation = (ref: GitCommitRefPresentationMember) => {
  if (ref.kind === "head") {
    return {
      refName: ref.name,
      label: ref.label,
      title: ref.title,
      icon: Target as Component,
      isHead: true,
      className: cn(refBadgeBaseClass, "git-ref-badge--current", "border-primary/70 bg-primary/10 text-primary"),
    };
  }
  if (ref.kind === "tag") {
    return {
      refName: ref.name,
      label: ref.label,
      title: ref.title,
      icon: Tag as Component,
      isHead: false,
      className: cn(refBadgeBaseClass, "border-tertiary/30 bg-tertiary/10 text-tertiary"),
    };
  }
  if (ref.kind === "stash") {
    return {
      refName: ref.name,
      label: ref.label,
      title: ref.title,
      icon: Archive as Component,
      isHead: false,
      className: cn(refBadgeBaseClass, "border-status-warning/35 bg-status-warning/10 text-status-warning"),
    };
  }
  if (ref.kind === "remote") {
    return {
      refName: ref.name,
      label: ref.label,
      title: ref.title,
      icon: Cloud as Component,
      isHead: false,
      className: cn(refBadgeBaseClass, "border-secondary/35 bg-secondary/10 text-secondary"),
    };
  }
  if (ref.kind === "local") {
    return {
      refName: ref.name,
      label: ref.label,
      title: ref.title,
      icon: (ref.isCurrentHead ? Target : GitBranch) as Component,
      isHead: ref.isCurrentHead,
      className: cn(
        refBadgeBaseClass,
        ref.isCurrentHead
          ? "git-ref-badge--current border-primary/70 bg-primary/10 text-primary"
          : "border-status-warning/35 bg-status-warning/10 text-status-warning",
      ),
    };
  }
  return {
    refName: ref.name,
    label: ref.label,
    title: ref.title,
    icon: null,
    isHead: false,
    className: cn(refBadgeBaseClass, "border-border-subtle bg-surface-container-low text-on-surface-variant"),
  };
};
const refGraphAccentStyle = (ref: GitCommitRefPresentationMember) => {
  if (ref.graphColorIndex === undefined) return undefined;
  const color = graphStrokeColor(ref.graphColorIndex);
  return { "--git-ref-graph-color": color };
};
const commitRefPresentation = (commit: ProjectGitCommitSummary) =>
  presentGitCommitRefs(commit, {
    branch: snapshot.value?.branch,
    headHash: snapshot.value?.headHash,
    isDetachedHead: snapshot.value?.isDetachedHead,
    branches: snapshot.value?.branches,
    remotes: snapshot.value?.remotes,
    upstream: snapshot.value?.upstream,
    base: snapshot.value?.base,
    graphColorByRefIdentity: graphColorByRefIdentity.value,
  });
const refPresentations = (commit: ProjectGitCommitSummary) =>
  commitRefPresentation(commit).full.map((ref) => ({
    ...refPresentation(ref),
    graphAccentStyle: refGraphAccentStyle(ref),
  }));
const compactCommitRefPresentations = (commit: ProjectGitCommitSummary) =>
  commitRefPresentation(commit).dense.members.map((ref) => ({
    ...refPresentation(ref),
    kind: ref.kind,
    showLabel: ref.display === "label",
    count: ref.memberNames.length,
    graphAccentStyle: refGraphAccentStyle(ref),
  }));
const commitHashMatches = (left?: string, right?: string) =>
  Boolean(left && right && (left === right || left.startsWith(right) || right.startsWith(left)));
const isCommitDetachedHead = (commit: ProjectGitCommitSummary) =>
  Boolean(snapshot.value?.isDetachedHead && commitHashMatches(commit.hash, snapshot.value.headHash));
const canCheckoutDetachedCommit = (commit: ProjectGitCommitSummary) => !isCommitDetachedHead(commit);
const hasAttachedLocalGitHead = () => snapshot.value?.branches?.some((branch) => branch.current) === true;
const gitHistoryActionUnavailableReason = (action: GitHistoryAction, commit: ProjectGitCommitSummary) => {
  if (isGitStashCommit(commit)) return "stash 提交不能用于 Cherry-pick 或 Revert";
  if ((commit.parents?.length || 0) > 1) return "合并提交暂不支持 Cherry-pick 或 Revert";
  if (snapshot.value?.isDetachedHead) return "当前 HEAD 处于 detached 状态";
  if (!hasAttachedLocalGitHead()) return "当前 HEAD 未指向本地分支";
  if (snapshot.value?.files.length) return "当前工作区存在未提交变更";
  if (action === "cherry-pick" && commitHashMatches(commit.hash, snapshot.value?.headHash)) {
    return "当前 HEAD 不能 Cherry-pick 到自身";
  }
  return "";
};
const detachedCheckoutTitle = (commit: ProjectGitCommitSummary) =>
  isCommitDetachedHead(commit) ? "当前已处于该分离 HEAD 提交" : "切换到此提交，并进入分离 HEAD 状态";
const isRemoteRef = (name: string) =>
  snapshot.value?.remotes?.some((remote) => name.startsWith(`${remote.name}/`)) ||
  /^(?:origin|upstream|remote|remotes\/[^/]+)\//.test(name);
const commitBranchRefs = (commit: ProjectGitCommitSummary): CommitBranchRef[] => {
  if (commit.refNames) {
    return commit.refNames
      .filter(
        (ref): ref is ProjectGitCommitRef & { kind: "local" | "remote" } =>
          ref.kind === "local" || ref.kind === "remote",
      )
      .map((ref) => ({ kind: ref.kind, name: ref.name, current: ref.kind === "local" && Boolean(ref.head) }));
  }
  const locals = new Set((snapshot.value?.branches || []).map((branch) => branch.name));
  return (commit.refs || "")
    .split(",")
    .map((name) => name.replace(/^HEAD ->\s*/, "").trim())
    .filter((name) => locals.has(name) || isRemoteRef(name))
    .map((name) => ({
      kind: locals.has(name) ? "local" : "remote",
      name,
      current: locals.has(name) && name === snapshot.value?.branch && !snapshot.value?.isDetachedHead,
    }));
};
const commitTagRefs = (commit: ProjectGitCommitSummary): CommitTagRef[] =>
  commit.refNames
    ? commit.refNames.filter((ref) => ref.kind === "tag").map((ref) => ({ name: ref.name }))
    : (commit.refs || "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.startsWith("tag:"))
        .map((name) => ({ name: name.replace(/^tag:\s*/, "") }));
const commitStashRef = (commit: ProjectGitCommitSummary) => {
  if (commit.stash?.selector) return commit.stash.selector;
  const structuredRef = commit.refNames?.find((ref) => ref.kind === "stash")?.name;
  if (structuredRef) return structuredRef;
  const legacyRef = (commit.refs || "")
    .split(",")
    .map((ref) => ref.trim())
    .find((ref) => ref === "refs/stash" || /^stash@\{\d+\}$/.test(ref));
  return legacyRef ? "stash@{0}" : null;
};

const commitTooltipVerticalLayout = computed(() => {
  const tooltip = commitTooltip.value;
  if (!tooltip) return null;
  const inset = 12;
  const viewportHeight = window.innerHeight;
  const maxHeight = Math.min(400, viewportHeight - inset * 2);
  const height = Math.min(commitTooltipHeight.value, maxHeight);
  const top = Math.min(
    Math.max(inset, (tooltip.top + tooltip.bottom) / 2 - height / 2),
    Math.max(inset, viewportHeight - height - inset),
  );
  return { top, height, maxHeight };
});
const tooltipStyle = computed(() => {
  const graphRect = graphScrollRef.value?.getBoundingClientRect();
  const layout = commitTooltipVerticalLayout.value;
  if (!graphRect || !layout) return {};
  const viewportWidth = window.innerWidth;
  return {
    left: `${graphRect.right + 8}px`,
    top: `${layout.top}px`,
    maxWidth: `${Math.max(1, Math.min(384, viewportWidth - graphRect.right - 20))}px`,
    maxHeight: `${layout.maxHeight}px`,
  };
});
const tooltipArrowStyle = computed(() => {
  const tooltip = commitTooltip.value;
  const layout = commitTooltipVerticalLayout.value;
  if (!tooltip || !layout) return {};
  const arrowHalfSize = 6;
  const rowCenter = (tooltip.top + tooltip.bottom) / 2;
  const minOffset = arrowHalfSize;
  const maxOffset = Math.max(arrowHalfSize, layout.height - arrowHalfSize);
  const top = Math.min(Math.max(minOffset, rowCenter - layout.top), maxOffset);
  return { top: `${top}px` };
});
const tooltipDetailsFor = (hash: string) => {
  const details = commitTooltipDetails.value;
  return details?.hash === hash ? details : null;
};
const tooltipSummary = (commit: ProjectGitCommitSummary): CommitTooltipSummary => {
  if (hasUsableGitCommitShortStats(commit.shortStats))
    return {
      state: "ready",
      fileCount: commit.shortStats.files,
      additions: commit.shortStats.additions,
      deletions: commit.shortStats.deletions,
    };
  const details = tooltipDetailsFor(commit.hash);
  if (!details || details.isLoadingFiles) return { state: "loading", fileCount: 0, additions: 0, deletions: 0 };
  if (!details.files || details.filesUnavailable)
    return { state: "unavailable", fileCount: 0, additions: 0, deletions: 0 };
  return details.files.reduce(
    (summary, file) => ({
      state: "ready" as const,
      fileCount: summary.fileCount + 1,
      additions: summary.additions + file.additions,
      deletions: summary.deletions + file.deletions,
    }),
    { state: "ready" as const, fileCount: 0, additions: 0, deletions: 0 },
  );
};
const tooltipContentCache = new WeakMap<ProjectGitCommitSummary, CommitTooltipContent>();
const commitAuthorInitials = (author: string) =>
  author
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => Array.from(name)[0] || "")
    .join("")
    .toUpperCase() || "?";
const commitAuthorAvatarClass = (author: string) => {
  const classes = [
    "bg-primary/15 text-primary",
    "bg-secondary/15 text-secondary",
    "bg-status-running/15 text-status-running",
    "bg-status-warning/15 text-status-warning",
  ];
  const index = Array.from(author).reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0);
  return classes[index % classes.length];
};
const commitDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const formatCommitTime = (value?: string) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { text: "", title: value || "" };
  const delta = Date.now() - date.getTime();
  const minutes = Math.round(Math.abs(delta) / 60000);
  const text =
    minutes < 1
      ? "刚刚"
      : minutes < 60
        ? `${minutes} 分钟${delta >= 0 ? "前" : "后"}`
        : minutes < 1440
          ? `${Math.round(minutes / 60)} 小时${delta >= 0 ? "前" : "后"}`
          : `${Math.round(minutes / 1440)} 天${delta >= 0 ? "前" : "后"}`;
  return {
    text,
    title: commitDateTimeFormatter.format(date),
  };
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
const tooltipBody = (commit: ProjectGitCommitSummary, usesFullMarkdown = commitTooltipUsesFullMarkdown(commit)) => {
  if (usesFullMarkdown) return (commit.body || commit.message).trim();

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
const tooltipTitle = (
  commit: ProjectGitCommitSummary,
  body = tooltipBody(commit),
  usesFullMarkdown = commitTooltipUsesFullMarkdown(commit),
) => {
  if (usesFullMarkdown) return "";

  const message = commit.message.trim();
  const bodyItems = markdownListItems(body).map(normalizeCommitText);
  const messageParts = message
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (messageParts.length > bodyItems.length && bodyItems.length > 0) {
    const tailParts = messageParts.slice(-bodyItems.length).map(normalizeCommitText);
    if (bodyItems.every((item, index) => item === tailParts[index])) {
      return messageParts.slice(0, -bodyItems.length).join(" - ");
    }
  }

  const bodyConventionalLines = markdownComparableLines(body)
    .filter((line) => conventionalCommitLinePattern.test(line))
    .map(normalizeCommitText);
  const messageConventionalSegments = conventionalCommitSegments(message).map(normalizeCommitText);
  if (messageConventionalSegments.length > bodyConventionalLines.length && bodyConventionalLines.length > 0) {
    const tailSegments = messageConventionalSegments.slice(-bodyConventionalLines.length);
    if (bodyConventionalLines.every((line, index) => line === tailSegments[index])) {
      return messageConventionalSegments.slice(0, -bodyConventionalLines.length).join(" ");
    }
  }

  return message;
};
const commitTooltipContent = computed(() => {
  const commit = commitTooltip.value?.commit;
  if (!commit) return null;

  let content = tooltipContentCache.get(commit);
  if (!content) {
    const usesFullMarkdown = commitTooltipUsesFullMarkdown(commit);
    const body = tooltipBody(commit, usesFullMarkdown);
    content = {
      title: tooltipTitle(commit, body, usesFullMarkdown),
      body,
      renderedBody: body ? renderMarkdown(body) : "",
      authorInitials: commitAuthorInitials(commit.author),
      authorAvatarClass: commitAuthorAvatarClass(commit.author),
    };
    tooltipContentCache.set(commit, content);
  }

  return { commit, ...content, time: formatCommitTime(commit.date) };
});
const commitTooltipDetailsForActiveCommit = computed(() => {
  const commit = commitTooltip.value?.commit;
  return commit ? tooltipDetailsFor(commit.hash) : null;
});
const commitTooltipSummaryForActiveCommit = computed<CommitTooltipSummary>(() => {
  const commit = commitTooltip.value?.commit;
  return commit ? tooltipSummary(commit) : { state: "loading", fileCount: 0, additions: 0, deletions: 0 };
});
const commitTooltipRefs = computed(() => {
  const commit = commitTooltip.value?.commit;
  return commit ? refPresentations(commit) : [];
});

const commitGitHubUrl = computed(() => {
  const commit = commitTooltip.value?.commit;
  return commit ? getGitHubCommitUrl(snapshot.value?.remotes || [], commit.hash) : undefined;
});

const openCommitOnGitHub = async () => {
  const url = commitGitHubUrl.value;
  if (url) await getProjectBridge().openPath(url);
};

const loadCommitTooltipDetails = (commit: ProjectGitCommitSummary) => {
  const repositoryContext = context.value;
  if (
    !repositoryContext ||
    (commitTooltipDetails.value?.hash === commit.hash &&
      commitTooltipDetails.value.contextKey === repositoryContext.contextKey)
  )
    return;
  const requestGeneration = ++commitTooltipDetailsRequestGeneration;
  const contextGeneration = commitTooltipDetailsContextGeneration;
  const contextKey = repositoryContext.contextKey;
  const hasPreloadedStats = hasUsableGitCommitShortStats(commit.shortStats);
  commitTooltipDetails.value = {
    hash: commit.hash,
    files: null,
    isLoadingFiles: !hasPreloadedStats,
    filesUnavailable: hasPreloadedStats,
    avatarUrl: null,
    isLoadingAvatar: true,
    requestGeneration,
    contextGeneration,
    contextKey,
  };
  const details = loadGitCommitTooltipSessionDetails(contextKey, commit.hash, {
    preloadedShortStats: commit.shortStats,
    loadFiles: hasPreloadedStats
      ? undefined
      : () => store.readGitCommitFiles(props.projectId, commit.hash, props.repositoryTarget, commit.stash),
    loadAvatar: () => store.readGitCommitAuthorAvatar(props.projectId, commit.hash, props.repositoryTarget),
  });
  void details.files.then((result) => {
    const state = commitTooltipDetails.value;
    if (
      !state ||
      state.hash !== commit.hash ||
      state.requestGeneration !== requestGeneration ||
      state.contextGeneration !== contextGeneration ||
      state.contextKey !== contextKey
    )
      return;
    commitTooltipDetails.value = {
      ...state,
      files: result.files,
      isLoadingFiles: false,
      filesUnavailable: result.unavailable,
    };
  });
  void details.avatar.then((result) => {
    const state = commitTooltipDetails.value;
    if (
      !state ||
      state.hash !== commit.hash ||
      state.requestGeneration !== requestGeneration ||
      state.contextGeneration !== contextGeneration ||
      state.contextKey !== contextKey
    )
      return;
    commitTooltipDetails.value = { ...state, avatarUrl: result.avatarUrl, isLoadingAvatar: false };
  });
};
const markCommitAvatarUnavailable = (hash: string) => {
  const state = commitTooltipDetails.value;
  if (!state || state.hash !== hash) return;
  markGitCommitTooltipSessionAvatarUnavailable(state.contextKey, hash);
  commitTooltipDetails.value = { ...state, avatarUrl: null, isLoadingAvatar: false };
};
const measureCommitTooltip = () => {
  const tooltip = commitTooltipRef.value;
  if (!tooltip) return;
  commitTooltipHeight.value = Math.ceil(tooltip.getBoundingClientRect().height);
};
const scheduleCommitTooltipLayout = () => {
  if (commitTooltipLayoutScheduled || !commitTooltip.value) return;
  commitTooltipLayoutScheduled = true;
  commitTooltipReady.value = false;
  void nextTick(() => {
    commitTooltipLayoutScheduled = false;
    if (!commitTooltip.value || !commitTooltipRef.value) return;
    measureCommitTooltip();
    commitTooltipReady.value = true;
  });
};
const handleCommitTooltipResize = () => {
  const tooltip = commitTooltipRef.value;
  if (!tooltip || Math.ceil(tooltip.getBoundingClientRect().height) === commitTooltipHeight.value) return;
  scheduleCommitTooltipLayout();
};
const clearCommitTooltipLayout = () => {
  commitTooltipReady.value = false;
  commitTooltipHeight.value = 0;
};
const createCommitTooltip = (commit: ProjectGitCommitSummary, trigger: HTMLElement): CommitTooltipState => {
  const rect = trigger.getBoundingClientRect();
  return { commit, top: rect.top, bottom: rect.bottom };
};
const cancelCommitTooltipClose = () => {
  window.clearTimeout(commitTooltipCloseTimer);
  commitTooltipCloseTimer = undefined;
};
const hideCommitTooltip = () => {
  window.clearTimeout(commitTooltipOpenTimer);
  window.clearTimeout(commitTooltipCloseTimer);
  commitTooltipOpenTimer = undefined;
  commitTooltipCloseTimer = undefined;
  pendingCommitTooltip.value = null;
  commitTooltip.value = null;
  clearCommitTooltipLayout();
};
const showCommitTooltip = (event: MouseEvent, commit: ProjectGitCommitSummary) => {
  window.clearTimeout(commitTooltipOpenTimer);
  commitTooltipOpenTimer = undefined;
  cancelCommitTooltipClose();
  const trigger = event.currentTarget as HTMLElement;
  if (commitTooltip.value) {
    commitTooltip.value = createCommitTooltip(commit, trigger);
    loadCommitTooltipDetails(commit);
    scheduleCommitTooltipLayout();
    return;
  }
  pendingCommitTooltip.value = { commit, trigger };
  window.clearTimeout(commitTooltipOpenTimer);
  commitTooltipOpenTimer = window.setTimeout(() => {
    const pendingTooltip = pendingCommitTooltip.value;
    pendingCommitTooltip.value = null;
    commitTooltipOpenTimer = undefined;
    if (!pendingTooltip || !pendingTooltip.trigger.isConnected) return;
    commitTooltip.value = createCommitTooltip(pendingTooltip.commit, pendingTooltip.trigger);
    loadCommitTooltipDetails(pendingTooltip.commit);
    scheduleCommitTooltipLayout();
  }, 450);
};
const scheduleCommitTooltipClose = () => {
  window.clearTimeout(commitTooltipOpenTimer);
  commitTooltipOpenTimer = undefined;
  window.clearTimeout(commitTooltipCloseTimer);
  commitTooltipCloseTimer = window.setTimeout(() => {
    pendingCommitTooltip.value = null;
    commitTooltip.value = null;
    clearCommitTooltipLayout();
    commitTooltipCloseTimer = undefined;
  }, 180);
};

const report = (state: GitFeedbackState, message: string) => emit("feedback", state, message);
const runAction = async <T extends ProjectGitActionResult | null>(name: string, operation: () => Promise<T>) => {
  if (isInteractionDisabled.value) return null;
  activeAction.value = name;
  try {
    return await operation();
  } catch (error) {
    report("error", error instanceof Error ? error.message : "Git 操作失败。");
    return null;
  } finally {
    activeAction.value = "";
  }
};
const requestConfirmation = (dialog: AppActionDialog) => {
  confirmationDialog.value = dialog;
};
const closeConfirmationDialog = () => {
  if (!confirmationBusy.value) confirmationDialog.value = null;
};
const confirmAction = async () => {
  const dialog = confirmationDialog.value;
  if (!dialog) return;
  confirmationBusy.value = true;
  try {
    await dialog.onConfirm();
    if (confirmationDialog.value === dialog) confirmationDialog.value = null;
  } finally {
    confirmationBusy.value = false;
  }
};
const checkoutCommit = async (commit: ProjectGitCommitSummary, force = false) => {
  if (!canCheckoutDetachedCommit(commit) || isInteractionDisabled.value) return;
  closeCommitContextMenu(false);
  const result = await runAction(`checkout:${commit.hash}`, () =>
    store.checkoutGitCommit(props.projectId, commit.hash, { detach: true, force }, props.repositoryTarget),
  );
  if (!result) return;
  if (!result.ok && !force && result.blockReason === "dirty-worktree") {
    requestConfirmation({
      icon: "trash",
      title: "强制切换到提交",
      message: `当前工作区存在未提交变更。继续切换到 ${commit.hash} 会丢弃这些本地变更。`,
      confirmLabel: "强制切换",
      cancelLabel: t.value.common.cancel,
      onConfirm: () => checkoutCommit(commit, true),
    });
    return;
  }
  report(result.ok ? "success" : "error", result.message);
  if (result.ok) clearCommitSelection();
};
const gitHistoryActionFailureGuidance =
  "操作未完成。你可以使用专业 Git 工具检查或重试；也可以先在设置中配置外部应用，直接通过插件打开外部 Git 工具。";
const showGitHistoryActionFailure = (action: GitHistoryAction, result: ProjectGitActionResult) => {
  requestConfirmation({
    tone: "warning",
    title: action === "cherry-pick" ? "Cherry-pick 未完成" : "Revert 未完成",
    message: gitHistoryActionFailureGuidance,
    detail: result.message,
    confirmLabel: "关闭",
    onConfirm: () => undefined,
  });
};
const requestGitHistoryAction = (action: GitHistoryAction, commit: ProjectGitCommitSummary) => {
  if (isInteractionDisabled.value || gitHistoryActionUnavailableReason(action, commit)) return;
  closeCommitContextMenu(false);
  const commitLabel = `${shortCommitHash(commit.hash)} · ${commit.message || "（无标题）"}`;
  requestConfirmation({
    tone: "warning",
    icon: action === "revert" ? "undo" : "alert",
    title: action === "cherry-pick" ? "Cherry-pick" : "Revert",
    message:
      action === "cherry-pick"
        ? `将 ${commitLabel} 应用到当前分支，并创建一个新提交。`
        : `将创建一个新的反向提交以回退 ${commitLabel} 的影响。`,
    detail: commitLabel,
    confirmLabel: action === "cherry-pick" ? "Cherry-pick" : "Revert",
    cancelLabel: t.value.common.cancel,
    onConfirm: async () => {
      const result = await runAction(`${action}:${commit.hash}`, () =>
        action === "cherry-pick"
          ? store.cherryPickGitCommit(props.projectId, commit.hash, props.repositoryTarget)
          : store.revertGitCommit(props.projectId, commit.hash, props.repositoryTarget),
      );
      if (!result) return;
      if (!result.ok) {
        showGitHistoryActionFailure(action, result);
        return;
      }
      report("success", result.message);
      clearCommitSelection();
    },
  });
};
const checkoutRemoteBranch = async (branchName: string, force = false) => {
  if (isInteractionDisabled.value) return;
  closeCommitContextMenu(false);
  const result = await runAction(`remote-checkout:${branchName}`, () =>
    store.checkoutGitRemoteBranch(props.projectId, branchName, { force }, props.repositoryTarget),
  );
  if (!result) return;
  if (!result.ok && !force && result.blockReason === "dirty-worktree") {
    requestConfirmation({
      icon: "trash",
      title: "强制检出远程分支",
      message: `当前工作区存在未提交变更。继续检出 ${branchName} 会丢弃这些本地变更。`,
      confirmLabel: "强制检出",
      cancelLabel: t.value.common.cancel,
      onConfirm: () => checkoutRemoteBranch(branchName, true),
    });
    return;
  }
  report(result.ok ? "success" : "error", result.message);
};
const checkoutLocalBranch = async (branchName: string) => {
  if (isInteractionDisabled.value) return;
  closeCommitContextMenu(false);
  const result = await runAction(`branch:${branchName}`, () =>
    store.switchGitBranch(props.projectId, branchName, {}, props.repositoryTarget),
  );
  if (!result) return;
  if (!result.ok && result.blockReason === "dirty-worktree") {
    requestConfirmation({
      icon: "trash",
      title: "强制切换分支",
      message: `当前工作区存在未提交变更。强制切换到 ${branchName} 会丢弃这些本地变更。`,
      confirmLabel: "强制切换",
      cancelLabel: t.value.common.cancel,
      onConfirm: async () => {
        const forced = await runAction(`branch:${branchName}`, () =>
          store.switchGitBranch(props.projectId, branchName, { force: true }, props.repositoryTarget),
        );
        if (forced) report(forced.ok ? "success" : "error", forced.message);
      },
    });
    return;
  }
  report(result.ok ? "success" : "error", result.message);
};
const deleteBranch = async (branchName: string, force = false) => {
  const result = await runAction(`delete-branch:${branchName}`, () =>
    store.deleteGitBranch(props.projectId, branchName, { force }, props.repositoryTarget),
  );
  if (!result) return;
  if (!result.ok && !force && result.blockReason === "unmerged-branch") {
    requestConfirmation({
      icon: "trash",
      title: "强制删除未合并分支",
      message: `分支 ${branchName} 包含尚未合并的提交。`,
      confirmLabel: "强制删除",
      cancelLabel: t.value.common.cancel,
      onConfirm: () => deleteBranch(branchName, true),
    });
    return;
  }
  report(result.ok ? "success" : "error", result.message);
};
const deleteTag = async (tagName: string) => {
  const result = await runAction(`delete-tag:${tagName}`, () =>
    store.deleteGitTag(props.projectId, tagName, props.repositoryTarget),
  );
  if (result) report(result.ok ? "success" : "error", result.message);
};
const executePushTag = async (tagName: string, remoteName: string) => {
  if (!remoteName || isInteractionDisabled.value) return;
  closeCommitContextMenu(false);
  const result = await runAction(`push-tag:${remoteName}:${tagName}`, () =>
    store.pushGitTag(props.projectId, tagName, remoteName, props.repositoryTarget),
  );
  if (result) report(result.ok ? "success" : "error", result.message);
};
const requestPushTag = (tagName: string, remoteName: string) => {
  if (!tagName || !remoteName || isInteractionDisabled.value) return;
  closeCommitContextMenu();
  requestConfirmation({
    tone: "warning",
    title: "推送 Git 标签",
    message: `将标签 ${tagName} 推送到 ${remoteName}。`,
    detail: `refs/tags/${tagName}`,
    confirmLabel: "推送标签",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => executePushTag(tagName, remoteName),
  });
};
const copyTagRef = async (name: string) => {
  try {
    await navigator.clipboard.writeText(name);
    copiedText.value = name;
    window.clearTimeout(copiedTimer.value);
    copiedTimer.value = window.setTimeout(() => (copiedText.value = ""), 1200);
    report("success", `已复制标签名：${name}`);
  } catch {
    report("error", "复制标签名失败。");
  }
};
const closeTagInfoDialog = () => {
  tagInfoRequestGeneration += 1;
  tagInfoDialog.value = null;
};
const openTagInfo = async (tagName: string) => {
  if (!tagName || isInteractionDisabled.value) return;
  closeCommitContextMenu(false);
  const requestGeneration = ++tagInfoRequestGeneration;
  tagInfoDialog.value = { tagName, info: null, isLoading: true, error: "" };
  let info: ProjectGitTagInfo | null = null;
  try {
    info = await store.readGitTagInfo(props.projectId, tagName, props.repositoryTarget);
  } catch {
    if (requestGeneration === tagInfoRequestGeneration) {
      tagInfoDialog.value = { tagName, info: null, isLoading: false, error: "无法读取标签信息。" };
    }
    return;
  }
  if (requestGeneration !== tagInfoRequestGeneration) return;
  tagInfoDialog.value = info
    ? { tagName, info, isLoading: false, error: "" }
    : { tagName, info: null, isLoading: false, error: "无法读取标签信息。" };
};
const executeStashAction = async (action: "apply" | "pop" | "drop", commit: ProjectGitCommitSummary) => {
  const stashRef = commitStashRef(commit);
  if (!stashRef || isInteractionDisabled.value) return null;
  closeCommitContextMenu(false);
  const result = await runAction(`stash:${action}:${stashRef}`, () => {
    if (action === "apply") return store.applyGitStash(props.projectId, stashRef, props.repositoryTarget);
    if (action === "pop") return store.popGitStash(props.projectId, stashRef, props.repositoryTarget);
    return store.dropGitStash(props.projectId, stashRef, props.repositoryTarget);
  });
  if (result) report(result.ok ? "success" : "error", result.message);
  return result;
};
const requestDeleteBranch = (branch: CommitBranchRef) => {
  if (branch.kind !== "local" || branch.current || isInteractionDisabled.value) return;
  closeCommitContextMenu();
  requestConfirmation({
    icon: "trash",
    title: "删除本地分支",
    message: `先使用 Git 安全删除分支 ${branch.name}。未合并分支不会被删除。`,
    confirmLabel: "安全删除",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => deleteBranch(branch.name),
  });
};
const requestDeleteTag = (tagName: string) => {
  if (isInteractionDisabled.value) return;
  closeCommitContextMenu();
  requestConfirmation({
    icon: "trash",
    title: "删除标签",
    message: `将删除标签 ${tagName}。此操作不会删除提交，但可能影响依赖该标签的发布或引用。`,
    confirmLabel: "删除标签",
    cancelLabel: t.value.common.cancel,
    onConfirm: () => deleteTag(tagName),
  });
};
const requestDropStash = (commit: ProjectGitCommitSummary) => {
  const stashRef = commitStashRef(commit);
  if (!stashRef || isInteractionDisabled.value) return;
  closeCommitContextMenu();
  requestConfirmation({
    icon: "trash",
    title: t.value.git.stashDropTitle,
    message: t.value.git.stashDropMessage,
    detail: stashRef,
    confirmLabel: t.value.git.stashDrop,
    cancelLabel: t.value.common.cancel,
    onConfirm: async (): Promise<void> => {
      await executeStashAction("drop", commit);
    },
  });
};
const openRefDialog = async (mode: RefDialogMode, commit: ProjectGitCommitSummary, sourceBranch?: string) => {
  refDialog.value = { mode, commit, sourceBranch };
  refDialogName.value = sourceBranch || "";
  refDialogMessage.value = "";
  refDialogCheckout.value = false;
  refDialogAnnotated.value = false;
  refDialogError.value = "";
  closeCommitContextMenu(false);
  await nextTick();
  refDialogInputRef.value?.focus();
};
const closeRefDialog = () => {
  if (!localWriteRunning.value) {
    refDialog.value = null;
    refDialogError.value = "";
  }
};
const submitRefDialog = async () => {
  const dialog = refDialog.value;
  const name = refDialogName.value.trim();
  if (!dialog || !name) {
    refDialogError.value = dialog?.mode === "create-tag" ? "请输入标签名称。" : "请输入分支名称。";
    return;
  }
  if (dialog.mode === "create-tag" && refDialogAnnotated.value && !refDialogMessage.value.trim()) {
    refDialogError.value = "请输入附注标签说明。";
    return;
  }
  let result: ProjectGitActionResult | null = null;
  if (dialog.mode === "create-branch")
    result = await runAction(`create-branch:${name}`, () =>
      store.createGitBranch(
        props.projectId,
        name,
        dialog.commit.hash,
        { checkout: refDialogCheckout.value },
        props.repositoryTarget,
      ),
    );
  else if (dialog.mode === "create-tag")
    result = await runAction(`create-tag:${name}`, () =>
      store.createGitTag(
        props.projectId,
        name,
        dialog.commit.hash,
        { annotated: refDialogAnnotated.value, message: refDialogMessage.value.trim() },
        props.repositoryTarget,
      ),
    );
  else
    result = await runAction(`rename-branch:${name}`, () =>
      store.renameGitBranch(props.projectId, dialog.sourceBranch || "", name, props.repositoryTarget),
    );
  if (!result) return;
  if (
    !result.ok &&
    result.blockReason === "dirty-worktree" &&
    dialog.mode === "create-branch" &&
    refDialogCheckout.value
  ) {
    requestConfirmation({
      icon: "trash",
      title: "创建并强制切换分支",
      message: `当前工作区存在未提交变更。继续创建并切换到 ${name} 会丢弃这些本地变更。`,
      confirmLabel: "创建并强制切换",
      cancelLabel: t.value.common.cancel,
      onConfirm: async () => {
        const forced = await runAction(`create-branch:${name}`, () =>
          store.createGitBranch(
            props.projectId,
            name,
            dialog.commit.hash,
            { checkout: true, force: true },
            props.repositoryTarget,
          ),
        );
        if (forced) report(forced.ok ? "success" : "error", forced.message);
      },
    });
    refDialog.value = null;
    return;
  }
  report(result.ok ? "success" : "error", result.message);
  if (result.ok) closeRefDialog();
  else refDialogError.value = result.message;
};

const clampMenu = (element: HTMLElement, left: number, top: number) => {
  const rect = element.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  return {
    left: Math.max(8, Math.min(left, viewportWidth - rect.width - 8)),
    top: Math.max(8, Math.min(top, viewportHeight - rect.height - 8)),
  };
};
const commitMenuItems = (element: HTMLElement | null) =>
  element
    ? Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
        (item) =>
          item.getAttribute("aria-disabled") !== "true" && !(item instanceof HTMLButtonElement && item.disabled),
      )
    : [];
const focusCommitMenuItem = (element: HTMLElement | null, current: HTMLElement, offset: number) => {
  const items = commitMenuItems(element);
  const index = items.indexOf(current);
  items[(Math.max(0, index) + offset + items.length) % items.length]?.focus();
};
const openCommitSubmenu = async (content: CommitSubmenuContent, parent: HTMLElement, focusFirst = false) => {
  const parentRect = parent.getBoundingClientRect();
  commitSubmenu.value = { ...content, left: parentRect.right + 4, top: parentRect.top, parent };
  await nextTick();
  const submenu = commitSubmenuRef.value;
  if (!submenu || !commitSubmenu.value) return;
  const rect = submenu.getBoundingClientRect();
  const preferredLeft =
    parentRect.right + 4 + rect.width <= window.innerWidth - 8
      ? parentRect.right + 4
      : parentRect.left - rect.width - 4;
  commitSubmenu.value = { ...commitSubmenu.value, ...clampMenu(submenu, preferredLeft, parentRect.top) };
  if (focusFirst) await nextTick(() => commitMenuItems(submenu)[0]?.focus());
};
const openCommitContextMenu = async (event: MouseEvent, commit: ProjectGitCommitSummary) => {
  hideCommitTooltip();
  closeCommitContextMenu(false);
  const row = event.currentTarget as HTMLElement;
  const rect = row.getBoundingClientRect();
  const eventTarget = event.target instanceof Element ? event.target.closest<HTMLElement>("button, [tabindex]") : null;
  commitMenuOpener.value =
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : eventTarget || row;
  const x = event.clientX || rect.left + graphRowPaddingX;
  const y = event.clientY || rect.bottom;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const opensUpward = y + commitContextMenuMaxHeight + commitContextMenuViewportInset > viewportHeight;
  const maxHeight = Math.max(
    0,
    Math.min(commitContextMenuMaxHeight, (opensUpward ? y : viewportHeight - y) - commitContextMenuViewportInset - 2),
  );
  const positionMenu = () => {
    const menu = commitContextMenuRef.value;
    const current = commitContextMenu.value;
    if (!menu || !current) return false;
    const menuWidth = menu.getBoundingClientRect().width || commitContextMenuMaxWidth;
    commitContextMenu.value = {
      ...current,
      x: Math.max(
        commitContextMenuViewportInset,
        Math.min(x, viewportWidth - menuWidth - commitContextMenuViewportInset),
      ),
    };
    return true;
  };
  commitContextMenu.value = {
    commit,
    x,
    y,
    opensUpward,
    maxHeight,
  };
  await nextTick();
  if (!positionMenu()) return;
  commitMenuItems(commitContextMenuRef.value)[0]?.focus();
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  positionMenu();
};
const closeCommitContextMenu = (restoreFocus = true) => {
  const opener = commitMenuOpener.value;
  commitMenuOpener.value = null;
  commitSubmenu.value = null;
  commitContextMenu.value = null;
  if (restoreFocus) void nextTick(() => opener?.isConnected && opener.focus());
};
const handleCommitRowClick = (event: MouseEvent, hash: string) => {
  if (event.ctrlKey || event.metaKey) toggleCommitSelection(hash);
  else void toggleCommitFiles(hash);
};
const handleCommitMenuKeydown = (event: KeyboardEvent, level: "main" | "submenu") => {
  const current = event.currentTarget as HTMLElement;
  const container = level === "main" ? commitContextMenuRef.value : commitSubmenuRef.value;
  if (event.key === "Escape") {
    event.preventDefault();
    if (level === "submenu") {
      const parent = commitSubmenu.value?.parent;
      commitSubmenu.value = null;
      void nextTick(() => parent?.focus());
    } else {
      closeCommitContextMenu();
    }
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (level === "main") commitSubmenu.value = null;
    focusCommitMenuItem(container, current, event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    if (level === "main") commitSubmenu.value = null;
    const items = commitMenuItems(container);
    items[event.key === "Home" ? 0 : items.length - 1]?.focus();
  } else if (level === "main" && event.key === "ArrowRight") {
    const commit = commitContextMenu.value?.commit;
    const branchIndex = current.dataset.branchIndex;
    const branch = commit && branchIndex !== undefined ? commitBranchRefs(commit)[Number(branchIndex)] : undefined;
    const tagIndex = current.dataset.tagIndex;
    const tag = commit && tagIndex !== undefined ? commitTagRefs(commit)[Number(tagIndex)] : undefined;
    if (branch || tag) {
      event.preventDefault();
      void openCommitSubmenu(branch ? { kind: "branch", branch } : { kind: "tag", tag: tag! }, current, true);
    }
  } else if (level === "submenu" && event.key === "ArrowLeft") {
    event.preventDefault();
    const parent = commitSubmenu.value?.parent;
    commitSubmenu.value = null;
    void nextTick(() => parent?.focus());
  }
};
const copyText = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    copiedText.value = value;
    window.clearTimeout(copiedTimer.value);
    copiedTimer.value = window.setTimeout(() => (copiedText.value = ""), 1200);
  } catch {
    report("error", "复制失败。");
  }
};
const copyBranchRef = async (name: string) => {
  try {
    await navigator.clipboard.writeText(name);
    copiedText.value = name;
    window.clearTimeout(copiedTimer.value);
    copiedTimer.value = window.setTimeout(() => (copiedText.value = ""), 1200);
    report("success", `已复制分支名：${name}`);
  } catch {
    report("error", "复制分支名失败。");
  }
};
const copyLabel = (value: string) => (copiedText.value === value ? t.value.common.copied : t.value.common.copy);
const shortCommitHash = (hash: string) => hash.slice(0, 7);

const disconnectLoadMoreObserver = () => {
  loadMoreObserver?.disconnect();
  loadMoreObserver = null;
  loadMoreSentinelWasIntersecting = false;
};
const loadMore = async () => {
  if (isLoadingMore.value || !snapshot.value?.hasMoreCommits) return;
  await store.loadMoreGitCommits(props.projectId, props.repositoryTarget);
};
const observeLoadMoreSentinel = () => {
  const root = graphScrollRef.value;
  const sentinel = loadMoreSentinelRef.value;
  const contextKey = context.value?.contextKey;
  if (!root || !sentinel || !props.open || !contextKey || typeof IntersectionObserver === "undefined") return;
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          loadMoreSentinelWasIntersecting = false;
          continue;
        }
        if (loadMoreSentinelWasIntersecting) continue;
        loadMoreSentinelWasIntersecting = true;
        if (context.value?.contextKey === contextKey) void loadMore();
      }
    },
    { root, rootMargin: "0px 0px 120px 0px", threshold: 0 },
  );
  loadMoreObserver.observe(sentinel);
};
const closeHistoryFloatingControls = () => {
  hideCommitTooltip();
  closeCommitContextMenu(false);
  refDialog.value = null;
  refDialogError.value = "";
  closeTagInfoDialog();
  confirmationDialog.value = null;
  closeCommitFilters();
};
const clearHistoryState = () => {
  commitFilesContextGeneration += 1;
  commitTooltipDetailsContextGeneration += 1;
  clearExpandedCommitFiles();
  commitTooltipDetails.value = null;
  closeHistoryFloatingControls();
  disconnectLoadMoreObserver();
};
const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (event.detail.handled) return;
  if (commitTooltip.value || pendingCommitTooltip.value) {
    hideCommitTooltip();
    event.detail.handle();
  } else if (commitContextMenu.value) {
    if (commitSubmenu.value) {
      const parent = commitSubmenu.value.parent;
      commitSubmenu.value = null;
      void nextTick(() => parent.focus());
    } else {
      closeCommitContextMenu();
    }
    event.detail.handle();
  } else if (refDialog.value) {
    closeRefDialog();
    event.detail.handle();
  } else if (tagInfoDialog.value) {
    closeTagInfoDialog();
    event.detail.handle();
  } else if (showCommitFilters.value) {
    closeCommitFilters();
    event.detail.handle();
  }
};
const handleWindowPointerDown = (event: PointerEvent) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest("[data-commit-context-menu]")) closeCommitContextMenu(false);
  if (
    !commitFilterTriggerRef.value?.contains(target) &&
    !commitFiltersPopoverRef.value?.contains(target) &&
    !commitDatePickerPopoverRef.value?.contains(target)
  ) {
    closeCommitFilters();
  }
};
const handleFloatingViewportChange = (event: Event) => {
  const isTooltipScroll =
    event.type === "scroll" && event.target instanceof Node && commitTooltipRef.value?.contains(event.target);
  const isGraphScroll = event.type === "scroll" && event.target === graphScrollRef.value;
  if (!isTooltipScroll && !isGraphScroll) hideCommitTooltip();
  if (openDatePickerKind.value) positionCommitDatePicker();
  if (
    event.type === "scroll" &&
    event.target instanceof Element &&
    event.target.closest("[data-commit-context-menu]")
  ) {
    commitSubmenu.value = null;
    return;
  }
  closeCommitContextMenu(false);
};

watch(
  commitTooltipRef,
  (tooltip, previousTooltip) => {
    if (previousTooltip) commitTooltipResizeObserver?.unobserve(previousTooltip);
    if (tooltip) {
      commitTooltipResizeObserver?.observe(tooltip);
      scheduleCommitTooltipLayout();
    }
  },
  { flush: "post" },
);
watch(
  () => activeAction.value,
  (action) => emit("busy-change", Boolean(action)),
  { immediate: true },
);
watch(
  () => props.open,
  (open) => {
    if (!open) closeHistoryFloatingControls();
  },
);
watch(
  () => [graphScrollRef.value, loadMoreSentinelRef.value, props.open, context.value?.contextKey],
  () => {
    disconnectLoadMoreObserver();
    if (props.open) void nextTick(observeLoadMoreSentinel);
  },
  { flush: "post" },
);
watch(
  () => [graphScrollRef.value, props.open],
  () => observeGraphViewport(),
  { flush: "post" },
);
watch(
  graphWindow,
  (nextWindow) => {
    const renderedHashes = new Set(nextWindow.rows.map((row) => row.commit.hash));
    const tooltipHash = commitTooltip.value?.commit.hash || pendingCommitTooltip.value?.commit.hash;
    if (tooltipHash && !renderedHashes.has(tooltipHash)) hideCommitTooltip();
    if (commitContextMenu.value && !renderedHashes.has(commitContextMenu.value.commit.hash)) {
      closeCommitContextMenu(false);
    }
  },
  { flush: "pre" },
);
watch(
  () => context.value?.contextKey || "",
  () => clearHistoryState(),
);
watch(
  [() => props.projectId, () => projectPath.value],
  ([projectId, nextProjectPath], [previousProjectId, previousProjectPath]) => {
    if (projectId !== previousProjectId) {
      clearGitCommitTooltipSessionsForProject(previousProjectId);
      return;
    }
    if (nextProjectPath !== previousProjectPath) {
      clearGitCommitTooltipSessionsForProject(projectId);
      clearHistoryState();
    }
  },
);
watch(
  () => (snapshot.value?.commits || []).map((commit) => commit.hash).join("|"),
  () => {
    const hashes = new Set((snapshot.value?.commits || []).map((commit) => commit.hash));
    const selected = props.selectedCommitHashes.filter((hash) => hashes.has(hash));
    if (selected.length !== props.selectedCommitHashes.length) updateSelectedHashes(selected);
    const contextKey = context.value?.contextKey;
    if (contextKey) pruneGitCommitTooltipSession(contextKey, hashes);
  },
);
onMounted(() => {
  if (typeof ResizeObserver !== "undefined")
    commitTooltipResizeObserver = new ResizeObserver(handleCommitTooltipResize);
  observeGraphViewport();
  window.addEventListener("pointerdown", handleWindowPointerDown);
  window.addEventListener("resize", handleFloatingViewportChange);
  window.addEventListener("scroll", handleFloatingViewportChange, true);
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});
onBeforeUnmount(() => {
  clearHistoryState();
  if (store.selectedProjectId !== props.projectId) {
    clearGitCommitTooltipSessionsForProject(props.projectId);
  }
  commitTooltipResizeObserver?.disconnect();
  graphViewportResizeObserver?.disconnect();
  clearCommitTooltipLayout();
  if (graphViewportFrame !== undefined) window.cancelAnimationFrame(graphViewportFrame);
  pendingGraphScrollAnchor = null;
  graphScrollAnchorRestoreScheduled = false;
  window.clearTimeout(copiedTimer.value);
  window.removeEventListener("pointerdown", handleWindowPointerDown);
  window.removeEventListener("resize", handleFloatingViewportChange);
  window.removeEventListener("scroll", handleFloatingViewportChange, true);
  stopAppEscapeListener();
});
</script>

<template>
  <section v-bind="$attrs" :class="['flex min-h-0 flex-col', open ? 'flex-1' : 'shrink-0']">
    <Teleport v-if="toolbarTarget" :to="toolbarTarget">
      <div class="flex shrink-0 items-center gap-px">
        <span v-if="selectedCommitCount" class="mr-1 font-mono text-[10px] font-semibold text-primary">{{
          selectedCommitCount
        }}</span>
        <button
          type="button"
          class="git-section-action"
          :disabled="!commits.length || areAllVisibleCommitsSelected || isInteractionDisabled"
          title="选择全部可见提交"
          aria-label="选择全部可见提交"
          @click="selectVisibleCommits"
        >
          <ListChecks :size="13" />
        </button>
        <button
          v-if="selectedCommitCount"
          type="button"
          class="git-section-action"
          title="清空提交选择"
          aria-label="清空提交选择"
          @click="clearCommitSelection"
        >
          <ListX :size="13" />
        </button>
        <button
          ref="commitFilterTriggerRef"
          type="button"
          :class="
            cn('git-section-action', (showCommitFilters || hasCommitFilters) && 'bg-surface-variant text-primary')
          "
          :title="showCommitFilters ? '关闭筛选' : '筛选提交'"
          :aria-label="showCommitFilters ? '关闭筛选' : '筛选提交'"
          :aria-pressed="showCommitFilters"
          @click.stop="toggleCommitFilters"
        >
          <Filter :size="13" />
        </button>
        <button
          type="button"
          class="git-section-action git-section-ai-action"
          :disabled="isInteractionDisabled"
          title="AI 分析"
          aria-label="AI 分析"
          @click="emit('request-ai')"
        >
          <WandSparkles :size="13" />
        </button>
        <button
          type="button"
          class="git-section-action"
          :title="commitFileViewModeLabel"
          :aria-label="commitFileViewModeLabel"
          :aria-pressed="commitFileViewMode === 'tree'"
          @click="toggleCommitFileViewMode"
        >
          <List v-if="commitFileViewMode === 'tree'" :size="13" /><ListTree v-else :size="13" />
        </button>
      </div>
    </Teleport>
    <div v-show="open" class="relative flex min-h-0 flex-1 flex-col">
      <Transition name="fade">
        <div
          v-if="showCommitFilters"
          ref="commitFiltersPopoverRef"
          class="absolute right-2 top-2 z-30 w-72 max-w-[calc(100%-1rem)] rounded-md border border-border-subtle bg-surface-container-lowest shadow-lg"
          role="dialog"
          aria-label="筛选提交"
          @click.stop
        >
          <div class="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-1.5 p-2">
            <div class="col-span-full flex min-w-0 items-center gap-1">
              <input
                v-model="commitSearchInput"
                type="text"
                class="ui-field ui-field-compact min-w-0 flex-1"
                :placeholder="`${t.git.keyword} / ${t.git.author} / ${t.git.hash}`"
                :title="`${t.git.keyword} / ${t.git.author} / ${t.git.hash}`"
                :aria-label="`${t.git.keyword} / ${t.git.author} / ${t.git.hash}`"
              />
              <button
                v-if="hasCommitFilters"
                type="button"
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
                :title="t.git.clearFilters"
                :aria-label="t.git.clearFilters"
                @click="clearCommitFilters"
              >
                <X :size="12" />
              </button>
            </div>
            <div class="relative min-w-0">
              <button
                ref="commitSinceDatePickerTriggerRef"
                type="button"
                class="ui-field ui-field-compact flex min-w-0 w-full items-center justify-between gap-0.5 px-1.5 text-left"
                @click.stop="openDatePicker('since')"
              >
                <span
                  class="dark-readable-meta min-w-0 truncate whitespace-nowrap"
                  :class="commitSince ? 'text-on-surface' : 'text-on-surface-variant/70'"
                  >{{ commitSince || t.git.since }}</span
                >
                <CalendarDays :size="13" class="text-on-surface-variant" />
              </button>
              <Teleport to="body">
                <div
                  v-if="openDatePickerKind === 'since'"
                  ref="commitDatePickerPopoverRef"
                  class="date-picker-popover themed-scrollbar max-h-[calc(100vh-1rem)] overflow-y-auto"
                  :style="floatingMenuStyle(commitDatePickerPosition)"
                  @click.stop
                >
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      class="popover-icon-button"
                      title="上个月"
                      aria-label="上个月"
                      @click="shiftDatePickerMonth(-1)"
                    >
                      <ChevronLeft :size="14" />
                    </button>
                    <div class="text-xs font-bold text-on-surface">{{ datePickerTitle }}</div>
                    <button
                      type="button"
                      class="popover-icon-button"
                      title="下个月"
                      aria-label="下个月"
                      @click="shiftDatePickerMonth(1)"
                    >
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
                  <div class="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      class="text-[10px] font-bold text-on-surface-variant hover:text-primary"
                      @click="selectDatePickerDay(formatDateValue(new Date()))"
                    >
                      今天</button
                    ><button
                      type="button"
                      class="text-[10px] font-bold text-on-surface-variant hover:text-primary"
                      @click="clearDatePickerValue"
                    >
                      清除日期
                    </button>
                  </div>
                </div>
              </Teleport>
            </div>
            <div class="relative min-w-0">
              <button
                ref="commitUntilDatePickerTriggerRef"
                type="button"
                class="ui-field ui-field-compact flex min-w-0 w-full items-center justify-between gap-0.5 px-1.5 text-left"
                @click.stop="openDatePicker('until')"
              >
                <span
                  class="dark-readable-meta min-w-0 truncate whitespace-nowrap"
                  :class="commitUntil ? 'text-on-surface' : 'text-on-surface-variant/70'"
                  >{{ commitUntil || t.git.until }}</span
                >
                <CalendarDays :size="13" class="text-on-surface-variant" />
              </button>
              <Teleport to="body">
                <div
                  v-if="openDatePickerKind === 'until'"
                  ref="commitDatePickerPopoverRef"
                  class="date-picker-popover themed-scrollbar max-h-[calc(100vh-1rem)] overflow-y-auto"
                  :style="floatingMenuStyle(commitDatePickerPosition)"
                  @click.stop
                >
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      class="popover-icon-button"
                      title="上个月"
                      aria-label="上个月"
                      @click="shiftDatePickerMonth(-1)"
                    >
                      <ChevronLeft :size="14" />
                    </button>
                    <div class="text-xs font-bold text-on-surface">{{ datePickerTitle }}</div>
                    <button
                      type="button"
                      class="popover-icon-button"
                      title="下个月"
                      aria-label="下个月"
                      @click="shiftDatePickerMonth(1)"
                    >
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
                  <div class="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      class="text-[10px] font-bold text-on-surface-variant hover:text-primary"
                      @click="selectDatePickerDay(formatDateValue(new Date()))"
                    >
                      今天</button
                    ><button
                      type="button"
                      class="text-[10px] font-bold text-on-surface-variant hover:text-primary"
                      @click="clearDatePickerValue"
                    >
                      清除日期
                    </button>
                  </div>
                </div>
              </Teleport>
            </div>
          </div>
        </div>
      </Transition>
      <div
        ref="graphScrollRef"
        class="themed-scrollbar min-h-0 flex-1 overflow-auto bg-surface-container-lowest p-2 text-on-surface [overscroll-behavior-y:contain]"
        @scroll.passive="scheduleGraphViewportUpdate"
        @wheel="transferWheelAtScrollBoundary($event, graphScrollRef)"
      >
        <div class="min-w-full">
          <div v-if="graphRows.length" class="relative min-w-full overflow-hidden" :style="graphSurfaceStyle">
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
                :stroke-dasharray="path.strokeDasharray"
                fill="none"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <g v-for="node in graphNodes" :key="node.hash">
                <rect
                  v-if="node.isStash && !node.isHead"
                  :x="node.x - 4.3"
                  :y="node.y - 4.3"
                  width="8.6"
                  height="8.6"
                  rx="1.6"
                  :fill="node.color"
                  stroke="var(--color-surface-container-lowest)"
                  stroke-width="1.5"
                />
                <template v-else>
                  <circle
                    v-if="node.isHead || node.isMerge"
                    :cx="node.x"
                    :cy="node.y"
                    :r="node.isHead ? 6.8 : 6.1"
                    :fill="node.color"
                    stroke="var(--color-surface-container-lowest)"
                    stroke-width="1.6"
                  />
                  <circle
                    :cx="node.x"
                    :cy="node.y"
                    :r="node.isHead ? 3 : node.isMerge ? 2.5 : 4.2"
                    :fill="node.isHead ? 'var(--color-surface-container-lowest)' : node.color"
                    stroke="var(--color-surface-container-lowest)"
                    :stroke-width="node.isHead || node.isMerge ? 1.3 : 1.6"
                  />
                </template>
              </g>
            </svg>
            <template v-for="row in graphWindow.rows" :key="row.commit.hash">
              <div
                role="button"
                tabindex="0"
                v-memo="[row, isCommitSelected(row.commit.hash), expandedCommitFiles[row.commit.hash]]"
                :aria-expanded="isCommitFilesExpanded(row.commit.hash)"
                :aria-controls="`git-commit-files-${row.commit.hash}`"
                :class="
                  cn(
                    'group absolute left-0 z-10 grid w-full min-w-[16rem] cursor-pointer items-center gap-px px-1 text-xs transition-colors hover:bg-surface-container-high',
                    isCommitSelected(row.commit.hash) && 'bg-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]',
                  )
                "
                :style="{
                  top: `${row.top}px`,
                  gridTemplateColumns: graphRowColumns(row),
                  minWidth: graphRowMinWidth(row),
                  height: `${rowHeight}px`,
                }"
                @click="handleCommitRowClick($event, row.commit.hash)"
                @keydown.enter.prevent="toggleCommitFiles(row.commit.hash)"
                @keydown.space.prevent="toggleCommitFiles(row.commit.hash)"
                @keydown.contextmenu.prevent="openCommitContextMenu($event as unknown as MouseEvent, row.commit)"
                @contextmenu.prevent="openCommitContextMenu($event, row.commit)"
                @mouseenter="showCommitTooltip($event, row.commit)"
                @mouseleave="scheduleCommitTooltipClose"
              >
                <div class="col-start-2 min-w-0 self-stretch py-px">
                  <div class="flex min-w-0 items-stretch gap-1.5">
                    <div class="min-w-0 flex-1 py-px">
                      <span class="block min-w-0 truncate text-[11px] font-semibold leading-4 text-on-surface">{{
                        row.commit.message
                      }}</span>
                      <div
                        class="dark-readable-meta mt-0 flex min-w-0 items-center gap-1 text-[9px] font-medium leading-3 text-on-surface-variant/75"
                      >
                        <span class="shrink-0">{{ shortCommitHash(row.commit.hash) }}</span
                        ><span aria-hidden="true">·</span><span class="min-w-0 truncate">{{ row.commit.author }}</span
                        ><span v-if="formatCommitTime(row.commit.date).text" aria-hidden="true">·</span
                        ><span v-if="formatCommitTime(row.commit.date).text" class="shrink-0">{{
                          formatCommitTime(row.commit.date).text
                        }}</span>
                      </div>
                    </div>
                    <div class="flex shrink-0 items-stretch gap-1 py-0.5">
                      <span
                        v-for="ref in compactCommitRefPresentations(row.commit)"
                        :key="`${row.commit.hash}-${ref.kind}-${ref.refName}`"
                        :class="
                          cn(
                            ref.className,
                            'git-ref-badge--history',
                            ref.graphAccentStyle && 'git-ref-badge--graph-linked',
                            ref.showLabel && 'git-ref-badge--dense-label',
                            !ref.showLabel && ref.count === 1 && 'git-ref-badge--history-icon',
                            !ref.showLabel && ref.count > 1 && 'w-[18px] justify-center px-0',
                          )
                        "
                        :style="ref.graphAccentStyle"
                        :title="ref.title"
                        ><span v-if="!ref.showLabel && ref.count > 1" class="text-[8px] leading-none">{{
                          ref.count
                        }}</span
                        ><component
                          v-if="ref.icon"
                          :is="ref.icon"
                          :size="15"
                          :stroke-width="2.25"
                          aria-hidden="true"
                        /><span v-if="ref.showLabel" class="min-w-0 truncate">{{ ref.label }}</span></span
                      >
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="isCommitFilesExpanded(row.commit.hash)"
                :id="`git-commit-files-${row.commit.hash}`"
                class="absolute left-0 z-10 w-full overflow-hidden border-y border-outline-variant/50 bg-surface-container py-1 pr-2"
                :style="{
                  top: `${row.top + rowHeight}px`,
                  height: `${expandedCommitFilesHeight(row.commit.hash)}px`,
                  minWidth: graphRowMinWidth(row),
                  paddingLeft: `${graphRowPaddingX + row.graphWidth + 4}px`,
                }"
              >
                <div
                  v-if="expandedCommitFiles[row.commit.hash]?.isLoading"
                  class="flex h-full items-center gap-2 px-1.5 text-[10px] text-on-surface-variant"
                  aria-busy="true"
                >
                  正在加载变更...
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
                    ><button
                      v-if="item.kind === 'directory'"
                      type="button"
                      class="flex min-h-6 w-full items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container-high"
                      :style="{ paddingLeft: `${6 + item.depth * 14}px` }"
                      :title="item.path"
                      :aria-expanded="item.isExpanded"
                      @click.stop="toggleCommitDirectory(row.commit.hash, item.path)"
                    >
                      <ChevronDown v-if="item.isExpanded" :size="13" /><ChevronRight v-else :size="13" /><Folder
                        :size="13"
                        class="text-primary/75"
                      /><span class="min-w-0 truncate font-mono">{{ item.name }}</span></button
                    ><button
                      v-else
                      type="button"
                      class="group grid min-h-6 w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left hover:bg-surface-container-high"
                      :style="
                        commitFileViewMode === 'tree' ? { paddingLeft: `${6 + (item.depth + 1) * 14}px` } : undefined
                      "
                      :title="gitFileDisplayPath(item.file)"
                      @click.stop="
                        emit('review-file', {
                          commitHash: row.commit.hash,
                          commitMessage: row.commit.message,
                          path: item.file.path,
                        })
                      "
                    >
                      <span
                        class="flex h-4 w-4 items-center justify-center rounded-[3px] bg-surface-container-highest font-mono text-[9px] font-black text-on-surface-variant"
                        >{{ item.file.status.slice(0, 1) }}</span
                      ><span class="flex min-w-0 items-baseline gap-1 overflow-hidden"
                        ><span
                          :class="
                            cn(
                              'shrink-0 truncate font-mono text-[11px] font-semibold',
                              item.file.status === 'DELETED' && 'text-on-surface-variant line-through',
                            )
                          "
                          >{{ gitFileName(item.file) }}</span
                        ><span
                          v-if="commitFileViewMode === 'list' && gitFileDirectory(item.file)"
                          class="dark-readable-meta min-w-0 truncate text-[10px] text-on-surface-variant/75"
                          >{{ gitFileDirectory(item.file) }}</span
                        ></span
                      ><span class="whitespace-nowrap font-mono text-[9px] font-semibold"
                        ><span v-if="item.file.additions" class="text-status-running">+{{ item.file.additions }}</span
                        ><span v-if="item.file.deletions" class="ml-1 text-status-error"
                          >-{{ item.file.deletions }}</span
                        ></span
                      >
                    </button></template
                  >
                </div>
              </div>
            </template>
          </div>
          <div v-else class="p-3 text-sm text-on-surface-variant">{{ t.git.empty }}</div>
          <div
            v-if="snapshot?.hasMoreCommits"
            ref="loadMoreSentinelRef"
            class="flex h-8 shrink-0 items-center justify-center"
            :aria-busy="isLoadingMore"
          >
            <span
              v-if="isLoadingMore"
              class="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent"
            />
          </div>
        </div>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="commitTooltipContent"
      ref="commitTooltipRef"
      data-commit-tooltip
      :class="
        cn(
          'commit-tooltip-panel fixed z-[70] w-max max-w-full select-text rounded-lg text-left',
          !commitTooltipReady && 'invisible',
        )
      "
      :style="tooltipStyle"
      @mouseenter="cancelCommitTooltipClose"
      @mouseleave="scheduleCommitTooltipClose"
    >
      <span
        aria-hidden="true"
        class="absolute left-0 z-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-outline-variant/70 bg-surface-container-lowest"
        :style="tooltipArrowStyle"
      />
      <div
        class="relative z-10 flex max-w-full flex-col overflow-hidden rounded-lg border border-outline-variant/70 bg-surface-container-lowest"
      >
        <div class="shrink-0 border-b border-border-subtle bg-surface-container-low px-3 py-1.5">
          <div class="flex min-w-0 items-center gap-2">
            <div
              class="relative flex h-7 w-7 shrink-0 overflow-hidden rounded-full border border-outline-variant/70 bg-surface-container"
            >
              <img
                v-if="commitTooltipDetailsForActiveCommit?.avatarUrl"
                :src="commitTooltipDetailsForActiveCommit.avatarUrl"
                :alt="`${commitTooltipContent.commit.author} 的头像`"
                class="h-full w-full object-cover"
                referrerpolicy="no-referrer"
                @error="markCommitAvatarUnavailable(commitTooltipContent.commit.hash)"
              /><span
                v-else
                :class="
                  cn(
                    'flex h-full w-full items-center justify-center text-[10px] font-bold',
                    commitTooltipContent.authorAvatarClass,
                    commitTooltipDetailsForActiveCommit?.isLoadingAvatar && 'animate-pulse',
                  )
                "
                >{{ commitTooltipContent.authorInitials }}</span
              >
            </div>
            <div class="min-w-0 flex flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span class="min-w-0 break-words text-[11px] font-bold leading-4 text-on-surface">
                {{ commitTooltipContent.commit.author }}
              </span>
              <span
                v-if="commitTooltipContent.time.text"
                class="dark-readable-meta inline-flex items-center gap-1 text-[10px] font-semibold leading-4 text-on-surface-variant"
              >
                <Clock3 :size="11" class="dark-readable-meta shrink-0 text-on-surface-variant/70" />
                {{ commitTooltipContent.time.text }}
              </span>
              <span
                v-if="commitTooltipContent.time.title"
                class="dark-readable-meta break-words text-[10px] font-medium leading-4 text-on-surface-variant/80"
              >
                ({{ commitTooltipContent.time.title }})
              </span>
            </div>
          </div>
        </div>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 py-2">
          <p
            v-if="commitTooltipContent.title"
            class="shrink-0 break-words text-[12px] font-bold leading-5 text-on-surface"
          >
            {{ commitTooltipContent.title }}
          </p>
          <div
            v-if="commitTooltipContent.body"
            v-overlay-scrollbar
            :class="
              cn(
                'commit-tooltip-body themed-scrollbar min-h-0 flex-1 overflow-y-auto',
                commitTooltipContent.title && 'mt-1',
              )
            "
          >
            <div
              class="memo-rendered commit-tooltip-rendered block text-on-surface"
              v-html="commitTooltipContent.renderedBody"
            />
          </div>
          <div
            class="mt-2 flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-t border-border-subtle/80 pt-2 text-[10px] font-medium leading-4"
            :aria-busy="commitTooltipSummaryForActiveCommit.state === 'loading'"
            aria-live="polite"
          >
            <button
              type="button"
              class="shrink-0 cursor-copy font-mono text-[10px] font-semibold text-on-surface-variant transition-colors hover:text-primary"
              :title="`${copyLabel(commitTooltipContent.commit.hash)}完整 commit hash`"
              :aria-label="`${copyLabel(commitTooltipContent.commit.hash)}完整 commit hash`"
              @click.stop="copyText(commitTooltipContent.commit.hash)"
            >
              {{ shortCommitHash(commitTooltipContent.commit.hash) }}</button
            ><span aria-hidden="true" class="h-3 w-px shrink-0 bg-border-subtle" /><span
              v-if="commitTooltipSummaryForActiveCommit.state === 'loading'"
              class="text-on-surface-variant"
              >正在读取变更摘要...</span
            ><span
              v-else-if="commitTooltipSummaryForActiveCommit.state === 'unavailable'"
              class="text-on-surface-variant"
              >变更摘要暂不可用</span
            ><template v-else
              ><span class="text-on-surface-variant"
                >变更 {{ commitTooltipSummaryForActiveCommit.fileCount }} 个文件</span
              >
              <span class="text-status-running">{{ commitTooltipSummaryForActiveCommit.additions }} 行 (+)</span>
              <span class="text-status-error"
                >{{ commitTooltipSummaryForActiveCommit.deletions }} 行 (-)</span
              ></template
            >
            <template v-if="commitGitHubUrl">
              <span aria-hidden="true" class="h-3 w-px shrink-0 bg-border-subtle" />
              <button
                type="button"
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                title="在 GitHub 中打开此提交"
                aria-label="在 GitHub 中打开此提交"
                @click.stop="openCommitOnGitHub"
              >
                <Github :size="14" />
              </button>
            </template>
          </div>
          <div v-if="commitTooltipRefs.length" class="mt-2 flex flex-wrap gap-1">
            <span
              v-for="ref in commitTooltipRefs"
              :key="`tooltip-${ref.refName}`"
              :class="
                cn(ref.className, 'git-ref-badge--tooltip', ref.graphAccentStyle && 'git-ref-badge--graph-linked')
              "
              :style="ref.graphAccentStyle"
              :title="ref.title"
              ><component v-if="ref.icon" :is="ref.icon" :size="12" /><span class="git-ref-badge__tooltip-label">{{
                ref.label
              }}</span></span
            >
          </div>
        </div>
      </div>
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="commitContextMenu"
      ref="commitContextMenuRef"
      data-commit-context-menu
      class="fixed z-[75] w-fit min-w-[7.85rem] max-w-[13rem] rounded-md border border-outline-variant/70 bg-surface-container-lowest shadow-2xl"
      role="menu"
      :style="{
        left: `${commitContextMenu.x}px`,
        top: `${commitContextMenu.y}px`,
        transform: commitContextMenu.opensUpward ? 'translateY(-100%)' : undefined,
      }"
      @click.stop
    >
      <div
        v-overlay-scrollbar
        class="themed-scrollbar max-h-60 overflow-y-auto p-0.5"
        :style="{ maxHeight: `${commitContextMenu.maxHeight}px` }"
      >
        <button
          type="button"
          role="menuitem"
          class="git-history-menu-item"
          :disabled="isInteractionDisabled"
          @click="openRefDialog('create-branch', commitContextMenu.commit)"
          @keydown="handleCommitMenuKeydown($event, 'main')"
        >
          <GitBranch :size="12" />新建分支
        </button>
        <button
          type="button"
          role="menuitem"
          class="git-history-menu-item"
          :disabled="isInteractionDisabled"
          @click="openRefDialog('create-tag', commitContextMenu.commit)"
          @keydown="handleCommitMenuKeydown($event, 'main')"
        >
          <Tag :size="12" />新建标签
        </button>
        <div class="mx-1 my-1 border-t border-border-subtle" role="separator" />
        <button
          type="button"
          role="menuitem"
          class="git-history-menu-item"
          :disabled="
            isInteractionDisabled || Boolean(gitHistoryActionUnavailableReason('cherry-pick', commitContextMenu.commit))
          "
          :title="
            gitHistoryActionUnavailableReason('cherry-pick', commitContextMenu.commit) || '将该提交应用到当前分支'
          "
          @click="requestGitHistoryAction('cherry-pick', commitContextMenu.commit)"
          @keydown="handleCommitMenuKeydown($event, 'main')"
        >
          <GitCommitHorizontal :size="12" />Cherry-pick
        </button>
        <button
          type="button"
          role="menuitem"
          class="git-history-menu-item"
          :disabled="
            isInteractionDisabled || Boolean(gitHistoryActionUnavailableReason('revert', commitContextMenu.commit))
          "
          :title="gitHistoryActionUnavailableReason('revert', commitContextMenu.commit) || '创建反向提交以回退该提交'"
          @click="requestGitHistoryAction('revert', commitContextMenu.commit)"
          @keydown="handleCommitMenuKeydown($event, 'main')"
        >
          <Undo :size="12" />Revert
        </button>
        <button
          type="button"
          role="menuitem"
          class="git-history-menu-item"
          :disabled="isInteractionDisabled || !canCheckoutDetachedCommit(commitContextMenu.commit)"
          @click="checkoutCommit(commitContextMenu.commit)"
          @keydown="handleCommitMenuKeydown($event, 'main')"
        >
          <GitCommitHorizontal :size="12" />切换（分离 HEAD）
        </button>
        <template v-if="commitStashRef(commitContextMenu.commit)">
          <div class="mx-1 my-1 border-t border-border-subtle" role="separator" />
          <button
            type="button"
            role="menuitem"
            class="git-history-menu-item"
            :disabled="isInteractionDisabled"
            @click="executeStashAction('apply', commitContextMenu.commit)"
            @keydown="handleCommitMenuKeydown($event, 'main')"
          >
            <Archive :size="12" />{{ t.git.stashApply }}
          </button>
          <button
            type="button"
            role="menuitem"
            class="git-history-menu-item"
            :disabled="isInteractionDisabled"
            @click="executeStashAction('pop', commitContextMenu.commit)"
            @keydown="handleCommitMenuKeydown($event, 'main')"
          >
            <Undo :size="12" />{{ t.git.stashPop }}
          </button>
          <button
            type="button"
            role="menuitem"
            class="git-history-menu-item text-status-error"
            :disabled="isInteractionDisabled"
            @click="requestDropStash(commitContextMenu.commit)"
            @keydown="handleCommitMenuKeydown($event, 'main')"
          >
            <Trash2 :size="12" />{{ t.git.stashDrop }}
          </button>
        </template>
        <div
          v-if="commitBranchRefs(commitContextMenu.commit).length || commitTagRefs(commitContextMenu.commit).length"
          class="mx-1 my-1 border-t border-border-subtle"
          role="separator"
        />
        <template v-if="commitBranchRefs(commitContextMenu.commit).length">
          <div
            v-for="(branch, branchIndex) in commitBranchRefs(commitContextMenu.commit)"
            :key="`${commitContextMenu.commit.hash}:${branch.kind}:${branch.name}`"
            role="menuitem"
            tabindex="0"
            :data-branch-index="branchIndex"
            aria-haspopup="menu"
            :aria-expanded="
              commitSubmenu?.kind === 'branch' &&
              commitSubmenu.branch.kind === branch.kind &&
              commitSubmenu.branch.name === branch.name
            "
            class="git-history-menu-item cursor-default"
            @click="openCommitSubmenu({ kind: 'branch', branch }, $event.currentTarget as HTMLElement)"
            @mouseenter="openCommitSubmenu({ kind: 'branch', branch }, $event.currentTarget as HTMLElement)"
            @keydown="handleCommitMenuKeydown($event, 'main')"
          >
            <component :is="branch.kind === 'remote' ? Cloud : GitBranch" :size="12" class="shrink-0" />
            <button
              type="button"
              tabindex="-1"
              class="min-w-0 flex-1 truncate text-left font-mono"
              :title="copyLabel(branch.name)"
              @click.stop="copyBranchRef(branch.name)"
            >
              {{ branch.name }}
            </button>
            <Check v-if="branch.current" :size="11" class="shrink-0 text-primary" />
            <ChevronRight v-else :size="11" class="shrink-0 text-on-surface-variant" />
          </div>
        </template>
        <template v-if="commitTagRefs(commitContextMenu.commit).length">
          <div
            v-for="(tag, tagIndex) in commitTagRefs(commitContextMenu.commit)"
            :key="`${commitContextMenu.commit.hash}:tag:${tag.name}`"
            role="menuitem"
            tabindex="0"
            :data-tag-index="tagIndex"
            aria-haspopup="menu"
            :aria-expanded="commitSubmenu?.kind === 'tag' && commitSubmenu.tag.name === tag.name"
            class="git-history-menu-item cursor-default"
            @click="openCommitSubmenu({ kind: 'tag', tag }, $event.currentTarget as HTMLElement)"
            @mouseenter="openCommitSubmenu({ kind: 'tag', tag }, $event.currentTarget as HTMLElement)"
            @keydown="handleCommitMenuKeydown($event, 'main')"
          >
            <Tag :size="12" class="shrink-0 text-tertiary" />
            <button
              type="button"
              tabindex="-1"
              class="min-w-0 flex-1 truncate text-left font-mono"
              :title="copyLabel(tag.name)"
              @click.stop="copyTagRef(tag.name)"
            >
              {{ tag.name }}
            </button>
            <ChevronRight :size="11" class="ml-auto shrink-0 text-on-surface-variant" />
          </div>
        </template>
      </div>
    </div>
    <div
      v-if="commitSubmenu && commitContextMenu"
      ref="commitSubmenuRef"
      data-commit-context-menu
      class="fixed z-[76] w-fit min-w-[7.85rem] max-w-[13rem] rounded-md border border-outline-variant/70 bg-surface-container-lowest shadow-2xl"
      role="menu"
      :aria-label="
        commitSubmenu.kind === 'branch' ? `${commitSubmenu.branch.name} 操作` : `${commitSubmenu.tag.name} 操作`
      "
      :style="{ left: `${commitSubmenu.left}px`, top: `${commitSubmenu.top}px` }"
      @click.stop
    >
      <div v-overlay-scrollbar class="themed-scrollbar max-h-60 overflow-y-auto p-0.5">
        <template v-if="commitSubmenu.kind === 'branch'">
          <button
            type="button"
            role="menuitem"
            class="git-history-menu-item"
            :disabled="isInteractionDisabled || commitSubmenu.branch.current"
            @click="
              commitSubmenu.branch.kind === 'local'
                ? checkoutLocalBranch(commitSubmenu.branch.name)
                : checkoutRemoteBranch(commitSubmenu.branch.name)
            "
            @keydown="handleCommitMenuKeydown($event, 'submenu')"
          >
            <component :is="commitSubmenu.branch.kind === 'local' ? GitBranch : CloudDownload" :size="12" />
            {{ commitSubmenu.branch.kind === "local" ? "切换到分支" : "检出为 tracking 分支" }}
          </button>
          <template v-if="commitSubmenu.branch.kind === 'local'">
            <div class="mx-1 my-1 border-t border-border-subtle" role="separator" />
            <button
              type="button"
              role="menuitem"
              class="git-history-menu-item"
              :disabled="isInteractionDisabled"
              @click="openRefDialog('rename-branch', commitContextMenu.commit, commitSubmenu.branch.name)"
              @keydown="handleCommitMenuKeydown($event, 'submenu')"
            >
              <Pencil :size="12" />重命名分支
            </button>
            <button
              type="button"
              role="menuitem"
              class="git-history-menu-item text-status-error"
              :disabled="isInteractionDisabled || commitSubmenu.branch.current"
              :title="commitSubmenu.branch.current ? '不能删除当前检出的分支' : '先执行安全删除'"
              @click="requestDeleteBranch(commitSubmenu.branch)"
              @keydown="handleCommitMenuKeydown($event, 'submenu')"
            >
              <Trash2 :size="12" />删除分支
            </button>
          </template>
        </template>
        <template v-else>
          <button
            type="button"
            role="menuitem"
            class="git-history-menu-item"
            :disabled="isInteractionDisabled"
            @click="openTagInfo(commitSubmenu.tag.name)"
            @keydown="handleCommitMenuKeydown($event, 'submenu')"
          >
            <List :size="12" />查看标签
          </button>
          <template v-if="tagPushRemotes.length">
            <button
              v-for="remote in tagPushRemotes"
              :key="`${commitSubmenu.tag.name}:${remote.name}`"
              type="button"
              role="menuitem"
              class="git-history-menu-item"
              :disabled="isInteractionDisabled"
              :title="`推送到 ${remote.name}`"
              @click="requestPushTag(commitSubmenu.tag.name, remote.name)"
              @keydown="handleCommitMenuKeydown($event, 'submenu')"
            >
              <Cloud :size="12" />{{ tagPushRemotes.length === 1 ? "推送标签" : `推送到 ${remote.name}` }}
            </button>
          </template>
          <button
            v-else
            type="button"
            role="menuitem"
            class="git-history-menu-item"
            disabled
            title="当前没有可用的推送 remote"
            @keydown="handleCommitMenuKeydown($event, 'submenu')"
          >
            <Cloud :size="12" />推送标签
          </button>
          <div class="mx-1 my-1 border-t border-border-subtle" role="separator" />
          <button
            type="button"
            role="menuitem"
            class="git-history-menu-item"
            :disabled="isInteractionDisabled"
            @click="copyTagRef(commitSubmenu.tag.name)"
            @keydown="handleCommitMenuKeydown($event, 'submenu')"
          >
            <Copy :size="12" />复制标签名
          </button>
          <button
            type="button"
            role="menuitem"
            class="git-history-menu-item text-status-error"
            :disabled="isInteractionDisabled"
            @click="requestDeleteTag(commitSubmenu.tag.name)"
            @keydown="handleCommitMenuKeydown($event, 'submenu')"
          >
            <Trash2 :size="12" />删除标签
          </button>
        </template>
      </div>
    </div>
  </Teleport>
  <Teleport to="body"
    ><Transition name="scale"
      ><div
        v-if="refDialog"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        @click.self="closeRefDialog"
      >
        <form
          class="w-[min(26rem,94vw)] overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-2xl"
          @submit.prevent="submitRefDialog"
          @click.stop
        >
          <header
            class="flex h-11 items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4"
          >
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-on-surface">
                {{
                  refDialog.mode === "create-tag"
                    ? "新建标签"
                    : refDialog.mode === "rename-branch"
                      ? "重命名分支"
                      : "新建分支"
                }}
              </h3>
              <p class="truncate font-mono text-[10px] text-on-surface-variant">
                {{ shortCommitHash(refDialog.commit.hash) }} · {{ refDialog.commit.message }}
              </p>
            </div>
            <button
              type="button"
              class="git-top-action"
              :disabled="isInteractionDisabled"
              title="关闭"
              aria-label="关闭"
              @click="closeRefDialog"
            >
              <X :size="15" />
            </button>
          </header>
          <div class="space-y-3 p-4">
            <label class="block text-xs font-bold text-on-surface"
              ><span>{{ refDialog.mode === "create-tag" ? "标签名称" : "分支名称" }}</span
              ><input
                ref="refDialogInputRef"
                v-model="refDialogName"
                class="ui-field mt-1 w-full font-mono"
                type="text"
                :disabled="isInteractionDisabled"
                :aria-invalid="Boolean(refDialogError)" /></label
            ><label
              v-if="refDialog.mode === 'create-tag' && refDialogAnnotated"
              class="block text-xs font-bold text-on-surface"
              ><span>标签说明</span
              ><textarea
                v-model="refDialogMessage"
                class="ui-field mt-1 min-h-20 w-full resize-y"
                :disabled="isInteractionDisabled"
              />
            </label>
            <p v-if="refDialogError" class="text-[11px] font-medium text-status-error">{{ refDialogError }}</p>
          </div>
          <div class="flex items-center gap-3 border-t border-border-subtle px-4 py-3">
            <label v-if="refDialog.mode === 'create-branch'" class="flex items-center gap-2 text-xs text-on-surface"
              ><input
                v-model="refDialogCheckout"
                type="checkbox"
                class="h-3 w-3 accent-primary"
                :disabled="isInteractionDisabled"
              />创建后切换</label
            ><label v-else-if="refDialog.mode === 'create-tag'" class="flex items-center gap-2 text-xs text-on-surface"
              ><input
                v-model="refDialogAnnotated"
                type="checkbox"
                class="h-3 w-3 accent-primary"
                :disabled="isInteractionDisabled"
              />附注标签</label
            >
            <div class="ml-auto flex gap-2">
              <button
                type="button"
                class="git-dialog-secondary"
                :disabled="isInteractionDisabled"
                @click="closeRefDialog"
              >
                {{ t.common.cancel }}</button
              ><button type="submit" class="git-dialog-primary" :disabled="isInteractionDisabled">
                <Check :size="13" />{{ isInteractionDisabled ? "处理中" : "确认" }}
              </button>
            </div>
          </div>
        </form>
      </div></Transition
    ></Teleport
  >
  <Teleport to="body">
    <Transition name="scale">
      <div
        v-if="tagInfoDialog"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-tag-info-title"
        @click.self="closeTagInfoDialog"
      >
        <section
          class="w-[min(30rem,94vw)] overflow-hidden rounded-lg border border-border-subtle bg-surface text-on-surface shadow-2xl"
          @click.stop
        >
          <header
            class="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4 py-3"
          >
            <div class="flex min-w-0 items-center gap-3">
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-tertiary/30 bg-tertiary/10 text-tertiary"
              >
                <Tag :size="16" />
              </div>
              <div class="min-w-0">
                <h3 id="git-tag-info-title" class="text-sm font-bold text-on-surface">查看标签</h3>
                <p class="truncate font-mono text-[11px] text-on-surface-variant">{{ tagInfoDialog.tagName }}</p>
              </div>
            </div>
            <button type="button" class="git-top-action" title="关闭" aria-label="关闭" @click="closeTagInfoDialog">
              <X :size="14" />
            </button>
          </header>
          <div class="space-y-3 px-4 py-4">
            <div v-if="tagInfoDialog.isLoading" class="flex items-center gap-2 py-5 text-xs text-on-surface-variant">
              <Clock3 :size="14" class="animate-spin" />正在读取标签信息...
            </div>
            <p
              v-else-if="tagInfoDialog.error"
              class="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error"
            >
              {{ tagInfoDialog.error }}
            </p>
            <template v-else-if="tagInfoDialogInfo">
              <dl class="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                <dt class="text-on-surface-variant">类型</dt>
                <dd class="font-medium text-on-surface">
                  {{ tagInfoDialogInfo.kind === "annotated" ? "附注标签" : "轻量标签" }}
                </dd>
                <dt class="text-on-surface-variant">目标提交</dt>
                <dd class="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    class="min-w-0 truncate font-mono text-left text-primary hover:underline"
                    :title="copyLabel(tagInfoDialogInfo.targetHash) + '完整 commit hash'"
                    @click="copyText(tagInfoDialogInfo.targetHash)"
                  >
                    {{ tagInfoDialogInfo.targetHash }}
                  </button>
                  <Check
                    v-if="copiedText === tagInfoDialogInfo.targetHash"
                    :size="12"
                    class="shrink-0 text-status-running"
                  />
                </dd>
                <template v-if="tagInfoDialogInfo.tagger">
                  <dt class="text-on-surface-variant">创建者</dt>
                  <dd class="break-words text-on-surface">{{ tagInfoDialogInfo.tagger }}</dd>
                </template>
              </dl>
              <div class="border-t border-border-subtle pt-3">
                <div class="mb-2 flex items-center justify-between gap-3">
                  <h4 class="text-xs font-bold text-on-surface">附注说明</h4>
                  <span v-if="tagInfoDialogInfo.kind === 'lightweight'" class="text-[10px] text-on-surface-variant"
                    >轻量标签没有附注说明</span
                  >
                </div>
                <pre
                  class="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border-subtle bg-surface-container-low px-3 py-3 font-mono text-xs leading-5 text-on-surface"
                  >{{ tagInfoDialogInfo.message || "此标签没有附注说明。" }}</pre
                >
              </div>
            </template>
          </div>
          <footer class="flex justify-end border-t border-border-subtle px-4 py-3">
            <button type="button" class="git-dialog-secondary" @click="closeTagInfoDialog">关闭</button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
  <ActionDialog
    :open="Boolean(confirmationDialog)"
    :tone="confirmationDialog?.tone || 'danger'"
    :icon="confirmationDialog?.icon || 'alert'"
    :title="confirmationDialog?.title || ''"
    :message="confirmationDialog?.message || ''"
    :detail="confirmationDialog?.detail"
    :primary-label="confirmationDialog?.confirmLabel || ''"
    :cancel-label="confirmationDialog?.cancelLabel"
    :busy="confirmationBusy"
    busy-label="处理中"
    @cancel="confirmationDialog = null"
    @primary="confirmAction"
  />
</template>
