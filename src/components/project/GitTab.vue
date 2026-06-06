<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  ArrowDownToLine,
  ArrowUpToLine,
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
} from "lucide-vue-next";
import {
  Project,
  type ProjectGitCommitSummary,
  type ProjectGitFileChange,
  type ProjectGitFileDiffResult,
} from "../../types";
import { cn, scrollToBoundary, transferWheelAtScrollBoundary } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { renderMarkdown } from "../../lib/markdown";

type AiState = "idle" | "loading" | "success" | "warning" | "error";
type CommitTooltipState = { commit: ProjectGitCommitSummary; x: number; y: number };

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
const aiDialogResult = ref("");
const aiDialogMessage = ref("");
const aiDialogState = ref<AiState>("idle");
const aiDialogStreamingText = ref("");
const commitAiMode = ref("summary");
const isCommitAiModeMenuOpen = ref(false);
const commitAiResult = ref("");
const commitAiMessage = ref("");
const commitAiState = ref<AiState>("idle");
const commitAiStreamingText = ref("");
const openDatePickerKind = ref<"since" | "until" | null>(null);
const datePickerMonth = ref(new Date());

const files = computed(() => store.stagedFiles[props.project.id] || props.project.git?.files || []);
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
const repositoryPath = computed(() => snapshot.value?.repositoryPath || props.project.path);
const isLoadingMore = ref(false);
const selectedDiff = ref<ProjectGitFileDiffResult | null>(null);
const isLoadingDiff = ref(false);
const isDiffDialogOpen = ref(false);
const isCommitDetailOpen = ref(false);
const isAiDialogGenerating = computed(() => aiDialogState.value === "loading");
const aiModeOptions = computed(() => store.aiPreferences.modes);
const resolveAiModeId = (modeId: string) =>
  aiModeOptions.value.some((option) => option.id === modeId) ? modeId : aiModeOptions.value[0]?.id || "summary";
const selectedAiMode = computed(
  () => aiModeOptions.value.find((option) => option.id === aiMode.value) || aiModeOptions.value[0],
);
const selectedCommitAiMode = computed(
  () => aiModeOptions.value.find((option) => option.id === commitAiMode.value) || aiModeOptions.value[0],
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
  openDatePickerKind.value = null;
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
  const commitLines = aiScopedCommits.value
    .map((commit) => {
      const refs = commit.refs ? `\n  Refs: ${commit.refs}` : "";
      const body = commit.body ? `\n  Body: ${commit.body}` : "";
      return `- ${commit.hash}\n  Date: ${commit.date}\n  Author: ${commit.author}\n  Message: ${commit.message}${refs}${body}`;
    })
    .join("\n");
  const fileLines = (snapshot.value?.files || [])
    .map((file) => `- ${file.path} (+${file.additions}/-${file.deletions}, ${fileLabel(file.status)})`)
    .join("\n");

  return {
    commitLines: commitLines || "无提交",
    fileLines: fileLines || "当前没有工作区文件变更。",
  };
});

const buildAiPrompt = () => {
  const focus = selectedAiMode.value?.prompt || "请总结这些 Git 信息。";
  const scopeTitle = selectedCommitCount.value > 0 ? "当前手动选择的提交" : "当前筛选后的提交";

  return `${focus}\n\n要求：\n- 必须结合提交时间、commit message、body、refs，以及当前代码变更一起判断。\n- 不要只复述 commit message。\n- 输出面向开发者的结构化内容。\n\n${scopeTitle}：\n${commitScopeContext.value.commitLines}\n\n当前工作区代码变更：\n${commitScopeContext.value.fileLines}`;
};

const resetCommitAiState = () => {
  commitAiResult.value = "";
  commitAiStreamingText.value = "";
  commitAiMessage.value = "";
  commitAiState.value = "idle";
};

const commitAiDisplayResult = computed(() => commitAiStreamingText.value || commitAiResult.value);
const renderedCommitAiResult = computed(() => renderMarkdown(commitAiDisplayResult.value));
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

const aiDialogDisplayResult = computed(() => aiDialogStreamingText.value || aiDialogResult.value);
const renderedAiDialogResult = computed(() => renderMarkdown(aiDialogDisplayResult.value));

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
  aiDialogResult.value = "";
  aiDialogMessage.value = "";
  aiDialogState.value = "idle";
  aiDialogStreamingText.value = "";
};

const generateAiAnalysis = async () => {
  if (store.aiPreferences.provider === "utools" && !store.aiPreferences.model) {
    aiDialogMessage.value = "请先从设置中选择一个 uTools 模型。";
    aiDialogState.value = "warning";
    return;
  }

  aiDialogResult.value = "";
  aiDialogStreamingText.value = "";
  aiDialogMessage.value = "";
  aiDialogState.value = "loading";

  await store.analyzeGitWithAiStream(props.project.id, buildAiPrompt(), {
    onChunk: (chunk) => {
      aiDialogStreamingText.value += chunk;
    },
    onDone: (result) => {
      if (!aiDialogStreamingText.value && result.content) {
        aiDialogStreamingText.value = result.content;
      }
      aiDialogResult.value = aiDialogStreamingText.value;
      aiDialogMessage.value = result.ok ? result.message || "" : result.message || "AI 分析失败。";
      aiDialogState.value = result.ok ? (aiDialogResult.value ? "success" : "warning") : "error";
      if (result.ok && !aiDialogResult.value) {
        aiDialogMessage.value = "AI 已返回成功，但没有生成内容。";
      }
    },
  });
};

const buildCommitAiPrompt = () => {
  const commit = selectedCommit.value;
  if (!commit) return "";
  const refs = commit.refs ? `\nRefs: ${commit.refs}` : "";
  const body = commit.body ? `\n\nCommit body:\n${commit.body}` : "";
  const fileLines = selectedCommitFiles.value
    .map((file) => `- ${file.path} (+${file.additions}/-${file.deletions}, ${fileLabel(file.status)})`)
    .join("\n");

  const focus = selectedCommitAiMode.value?.prompt || "请总结这个 Git 提交。";

  return `${focus}\n\n要求：\n- 结合 commit message、body、refs、作者、时间和该提交的变更文件判断。\n- 不要只复述标题。\n- 输出面向开发者的结构化内容。\n\nCommit:\nHash: ${commit.hash}\nDate: ${commit.date}\nAuthor: ${commit.author}\nMessage: ${commit.message}${refs}${body}\n\n该提交变更文件：\n${fileLines || "该提交暂无可显示的变更文件。"}`;
};

const generateCommitAiAnalysis = async () => {
  if (!selectedCommit.value) return;
  if (!store.aiPreferences.provider) {
    commitAiMessage.value = t.value.git.aiUnavailable;
    commitAiState.value = "warning";
    return;
  }
  if (store.aiPreferences.provider === "utools" && !store.aiPreferences.model) {
    commitAiMessage.value = "请先从设置中选择一个 uTools 模型。";
    commitAiState.value = "warning";
    return;
  }

  commitAiResult.value = "";
  commitAiStreamingText.value = "";
  commitAiMessage.value = "";
  commitAiState.value = "loading";
  await store.analyzeGitWithAiStream(props.project.id, buildCommitAiPrompt(), {
    onChunk: (chunk) => {
      commitAiStreamingText.value += chunk;
    },
    onDone: (result) => {
      if (!commitAiStreamingText.value && result.content) {
        commitAiStreamingText.value = result.content;
      }
      commitAiResult.value = commitAiStreamingText.value;
      commitAiMessage.value = result.ok ? result.message || "" : result.message || "AI 分析失败。";
      commitAiState.value = result.ok ? (commitAiResult.value ? "success" : "warning") : "error";
      if (result.ok && !commitAiResult.value) {
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
});

watch(
  () => store.aiPreferences.modes.map((mode) => mode.id).join("|"),
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
  },
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
const graphStrokeColors = ["#2eaf7d", "#0ea5e9", "#f59e0b", "#d946ef", "#f43f5e", "#06b6d4", "#84cc16", "#8b5cf6"];
const laneWidth = 14;
const rowHeight = 28;
const dotRadius = 4.2;
const laneCenter = (lane: number) => lane * laneWidth + laneWidth / 2 + 2;
const minGraphColumnWidth = 50;

const refsIncludeBranch = (refs: string | undefined, branch: string) =>
  refsForCommit(refs).some((refName) => {
    const cleanRef = refName.replace(/^HEAD ->\s*/, "").trim();
    return cleanRef === branch || cleanRef === `origin/${branch}`;
  });

const graphRows = computed(() => {
  const lanes: Array<string | null> = [];
  const laneColors = new Map<number, string>();
  let colorIndex = 0;
  let maxLane = 0;
  const currentBranch = snapshot.value?.branch || "";
  const visibleHashes = new Set(commits.value.map((commit) => commit.hash));

  const nextColor = () => graphStrokeColors[colorIndex++ % graphStrokeColors.length];
  const laneColor = (lane: number) => {
    if (!laneColors.has(lane)) {
      laneColors.set(lane, nextColor());
    }
    return laneColors.get(lane) || graphStrokeColors[0];
  };
  const findLane = (hash: string) => lanes.indexOf(hash);
  const allocLane = () => {
    const emptyLane = lanes.indexOf(null);
    if (emptyLane >= 0) return emptyLane;
    lanes.push(null);
    return lanes.length - 1;
  };

  if (currentBranch) {
    const headCommit = commits.value.find((commit) => refsIncludeBranch(commit.refs, currentBranch));
    if (headCommit) {
      lanes[0] = headCommit.hash;
      laneColors.set(0, nextColor());
    }
  }

  return commits.value.map((commit) => {
    const existingLane = findLane(commit.hash);
    let lane = existingLane;
    if (lane < 0) {
      lane = allocLane();
      lanes[lane] = commit.hash;
      laneColor(lane);
    }

    const color = laneColor(lane);
    const activeBefore = lanes
      .map((hash, index) => ({ hash, index }))
      .filter((item) => item.hash !== null)
      .map((item) => item.index);
    const rowLaneColors = new Map<number, string>();
    activeBefore.forEach((activeLane) => {
      rowLaneColors.set(activeLane, laneColor(activeLane));
    });

    const connections: Array<{ from: number; to: number; color: string }> = [];
    const parents = commit.parents || [];
    lanes[lane] = null;

    if (parents.length > 0) {
      const firstParent = parents[0];
      if (visibleHashes.has(firstParent)) {
        const existingFirstParentLane = findLane(firstParent);
        if (existingFirstParentLane >= 0) {
          connections.push({ from: lane, to: existingFirstParentLane, color });
        } else {
          lanes[lane] = firstParent;
          laneColors.set(lane, color);
          connections.push({ from: lane, to: lane, color });
        }
      }

      parents.slice(1).forEach((parentHash) => {
        if (!visibleHashes.has(parentHash)) {
          return;
        }
        let parentLane = findLane(parentHash);
        if (parentLane < 0) {
          parentLane = allocLane();
          lanes[parentLane] = parentHash;
          laneColors.set(parentLane, nextColor());
        }
        connections.push({ from: lane, to: parentLane, color });
      });
    }

    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }

    const activeAfter = lanes
      .map((hash, index) => ({ hash, index }))
      .filter((item) => item.hash !== null)
      .map((item) => item.index);
    const verticalSegments = Array.from(new Set([...activeBefore, ...activeAfter])).map((activeLane) => ({
      lane: activeLane,
      fromTop: activeBefore.includes(activeLane) && (activeLane !== lane || existingLane >= 0),
      toBottom: activeAfter.includes(activeLane),
      color: rowLaneColors.get(activeLane) || laneColor(activeLane),
    }));

    maxLane = Math.max(
      maxLane,
      lane,
      ...activeBefore,
      ...activeAfter,
      ...connections.map((connection) => connection.to),
    );

    return {
      commit,
      lane,
      color,
      verticalSegments,
      laneColors: rowLaneColors,
      connections,
      width: Math.max(58, (maxLane + 1) * laneWidth + 16),
    };
  });
});

const graphColumnWidth = computed(() => Math.max(minGraphColumnWidth, ...graphRows.value.map((row) => row.width)));

const graphRowColumns = computed(() => `1.25rem ${graphColumnWidth.value}px 4rem minmax(18rem, 1fr)`);
const graphRowMinWidth = computed(() => `max(31rem, calc(${graphColumnWidth.value}px + 25.375rem))`);
const gitGridColumns = "minmax(13rem,0.42fr) minmax(0,1.58fr)";
const commitDateLabel = (value?: string) => formatCommitTime(value).text;

const fileLabel = (status: string) => {
  if (status === "ADDED") return t.value.git.added;
  if (status === "DELETED") return t.value.git.deleted;
  if (status === "RENAMED") return t.value.git.renamed;
  if (status === "UNTRACKED") return t.value.git.untracked;
  return t.value.git.modified;
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
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden" @click="closeFloatingControls">
    <div class="border border-border-subtle rounded-lg bg-surface px-3 py-2 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0 text-xs">
        <GitBranch :size="16" class="text-primary shrink-0" />
        <button
          type="button"
          class="min-w-0 truncate rounded px-1 font-mono font-bold text-on-surface transition-colors hover:bg-surface-variant hover:text-primary"
          :title="`${t.common.copy}: ${snapshot?.branch || 'main'}`"
          :aria-label="`${t.common.copy}: ${snapshot?.branch || 'main'}`"
          @click="copyText(snapshot?.branch || 'main')"
        >
          {{ snapshot?.branch || "main" }}
        </button>
        <span class="text-on-surface-variant whitespace-nowrap">
          {{ t.git.ahead }} {{ snapshot?.ahead || 0 }} · {{ t.git.behind }} {{ snapshot?.behind || 0 }}
        </span>
        <span class="text-on-surface-variant truncate">{{ snapshot?.statusText || t.git.noRepo }}</span>
        <span class="text-on-surface-variant truncate hidden lg:inline">{{ repositoryPath }}</span>
      </div>
      <div class="flex gap-2 shrink-0">
        <button
          @click="handleRefresh"
          class="h-8 px-3 rounded border border-border-subtle bg-surface text-on-surface hover:bg-surface-variant text-xs font-bold flex items-center gap-2 transition-colors"
          :title="t.git.refresh"
          :aria-label="t.git.refresh"
        >
          <RefreshCw :size="14" />
        </button>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 gap-2 overflow-hidden" :style="{ gridTemplateColumns: gitGridColumns }">
      <div
        class="bg-surface border border-border-subtle rounded-lg overflow-hidden shadow-sm min-h-0 flex min-w-0 flex-col"
      >
        <div
          class="px-3 py-2 border-b border-border-subtle flex items-center justify-between gap-2 bg-surface-container-low"
        >
          <h3 class="min-w-0 truncate text-xs font-bold text-on-surface">{{ t.git.files }}</h3>
          <div class="flex items-center gap-1 shrink-0">
            <span class="mr-1 text-[10px] font-bold text-on-surface-variant">{{ files.length }}</span>
            <button
              @click="scrollGitPanel('files', 'top')"
              class="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-variant transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="files.length === 0"
              :title="t.git.scrollFilesToTop"
              :aria-label="t.git.scrollFilesToTop"
            >
              <ArrowUpToLine :size="12" />
            </button>
            <button
              @click="scrollGitPanel('files', 'bottom')"
              class="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-variant transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="files.length === 0"
              :title="t.git.scrollFilesToBottom"
              :aria-label="t.git.scrollFilesToBottom"
            >
              <ArrowDownToLine :size="12" />
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
            class="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 border-b border-border-subtle px-2.5 py-2 last:border-b-0 hover:bg-surface-container-low transition-all"
            :title="file.path"
            @click="handleViewDiff(file)"
          >
            <div class="flex min-w-0 items-center overflow-hidden">
              <div class="truncate">
                <p
                  :class="
                    cn(
                      'font-mono text-xs font-bold truncate',
                      file.status === 'DELETED' ? 'text-on-surface-variant line-through' : 'text-on-surface',
                    )
                  "
                  :title="file.path"
                >
                  {{ file.path }}
                </p>
                <div class="flex gap-3 text-[10px] font-bold mt-0.5">
                  <span v-if="file.additions > 0" class="text-status-running">+{{ file.additions }}</span>
                  <span v-if="file.deletions > 0" class="text-status-error">-{{ file.deletions }}</span>
                  <span class="text-on-surface-variant">{{ fileLabel(file.status) }}</span>
                </div>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-35"
                :disabled="file.status === 'DELETED'"
                :title="file.status === 'DELETED' ? t.git.fileDeleted : t.git.openFile"
                :aria-label="file.status === 'DELETED' ? t.git.fileDeleted : t.git.openFile"
                @click.stop="handleOpenFile(file)"
              >
                <FileSearch :size="14" />
              </button>
            </div>
          </div>
        </div>
        <div v-else class="flex flex-none items-center gap-1.5 px-2.5 py-2 text-[11px] text-on-surface-variant">
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
          class="min-h-0 flex-1 overflow-auto bg-surface-container-lowest p-2 text-on-surface [overscroll-behavior-y:contain]"
        >
          <div class="min-w-full space-y-0.5">
            <div
              v-for="row in graphRows"
              :key="row.commit.hash"
              :class="
                cn(
                  'group grid h-8 min-w-[31rem] cursor-pointer items-center gap-1.5 rounded px-2 text-xs transition-colors hover:bg-surface-container-high',
                  isCommitSelected(row.commit.hash) && 'bg-primary/5 ring-1 ring-primary/20 hover:bg-primary/10',
                )
              "
              :style="{ gridTemplateColumns: graphRowColumns, minWidth: graphRowMinWidth }"
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
              <div class="h-8 min-w-0 overflow-hidden">
                <svg
                  class="block h-8 w-full"
                  :viewBox="`0 0 ${graphColumnWidth} ${rowHeight}`"
                  preserveAspectRatio="xMinYMid meet"
                >
                  <line
                    v-for="segment in row.verticalSegments"
                    :key="`${row.commit.hash}-v-${segment.lane}`"
                    :x1="laneCenter(segment.lane)"
                    :y1="segment.fromTop ? 0 : rowHeight / 2"
                    :x2="laneCenter(segment.lane)"
                    :y2="segment.toBottom ? rowHeight : rowHeight / 2"
                    :stroke="segment.color"
                    stroke-width="2"
                    stroke-linecap="round"
                    opacity="0.42"
                  />
                  <line
                    v-for="(connection, index) in row.connections"
                    :key="`${row.commit.hash}-c-${index}`"
                    :x1="laneCenter(connection.from)"
                    :y1="rowHeight / 2"
                    :x2="laneCenter(connection.to)"
                    :y2="rowHeight"
                    :stroke="connection.color"
                    stroke-width="2"
                    stroke-linecap="round"
                    opacity="0.82"
                  />
                  <circle
                    :cx="laneCenter(row.lane)"
                    :cy="rowHeight / 2"
                    :r="isHeadCommit(row.commit.refs) ? dotRadius + 0.7 : dotRadius"
                    :fill="isHeadCommit(row.commit.refs) ? 'var(--color-surface)' : row.color"
                    :stroke="row.color"
                    :stroke-width="isHeadCommit(row.commit.refs) ? 2.4 : 1.4"
                  />
                </svg>
              </div>

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
                </div>
                <div class="mt-px truncate text-[9px] leading-3 text-on-surface-variant/75">
                  {{ row.commit.author }} · {{ formatCommitTime(row.commit.date).text }}
                </div>
              </div>
            </div>

            <div v-if="commits.length === 0" class="text-sm text-on-surface-variant p-3">{{ t.git.empty }}</div>
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
              v-if="aiDialogDisplayResult"
              type="button"
              class="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded border border-outline-variant/80 bg-surface-container-high text-on-surface-variant shadow-sm transition-colors hover:bg-surface-container-highest hover:text-primary dark:bg-surface-container-highest dark:text-on-surface dark:hover:bg-surface-variant"
              :title="copyLabel(aiDialogDisplayResult)"
              :aria-label="copyLabel(aiDialogDisplayResult)"
              @click="copyText(aiDialogDisplayResult)"
            >
              <ClipboardCopy :size="12" />
            </button>
            <div class="ai-result-panel h-full overflow-auto p-3">
              <div
                v-if="aiDialogDisplayResult"
                class="memo-rendered ai-markdown-result pr-7 text-on-surface"
                v-html="renderedAiDialogResult"
              ></div>
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
        class="flex h-[min(42rem,86vh)] w-[min(58rem,92vw)] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-2xl"
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
                  'grid grid-cols-[3.25rem_minmax(0,1fr)] whitespace-pre text-on-surface',
                  line.kind === 'add' && 'bg-status-running/10 text-on-surface',
                  line.kind === 'delete' && 'bg-status-error/10 text-on-surface',
                  line.kind === 'hunk' && 'bg-secondary/10 text-secondary',
                  line.kind === 'meta' && 'bg-surface-container-low text-on-surface-variant',
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
          class="flex h-11 items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4"
        >
          <div class="min-w-0">
            <h3 class="truncate text-sm font-bold text-on-surface">{{ t.git.commitDetails }}</h3>
            <p class="truncate font-mono text-[10px] font-bold text-on-surface-variant">{{ selectedCommit.hash }}</p>
          </div>
          <div class="flex items-center gap-2">
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
          <section class="rounded-lg border border-border-subtle bg-surface px-3 py-2">
            <div
              class="grid gap-2 text-xs text-on-surface-variant sm:grid-cols-[minmax(0,1.7fr)_auto_auto_auto] sm:items-center"
            >
              <div class="min-w-0">
                <div class="truncate font-semibold text-on-surface">{{ selectedCommit.message }}</div>
                <div class="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] font-medium text-on-surface-variant">
                  <span class="truncate">{{ selectedCommit.author }}</span>
                  <span class="text-on-surface-variant/60">·</span>
                  <span :title="formatAbsoluteTime(selectedCommit.date)">{{
                    commitDateLabel(selectedCommit.date)
                  }}</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5 sm:justify-self-end">
                <span
                  class="rounded border border-border-subtle bg-surface-container-low px-1.5 py-0.5 font-mono text-[10px] font-bold text-on-surface-variant"
                >
                  {{ selectedCommit.hash }}
                </span>
                <button
                  type="button"
                  class="inline-flex h-7 items-center gap-1.5 rounded border border-border-subtle bg-transparent px-2 text-[10px] font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
                  @click="copyText(selectedCommit.hash)"
                >
                  <ClipboardCopy :size="12" />
                  {{ copyLabel(selectedCommit.hash) }}
                </button>
              </div>
              <div class="flex flex-wrap gap-1.5 sm:justify-self-end sm:col-span-2">
                <span v-for="refName in refsForCommit(selectedCommit.refs)" :key="refName" :class="refClass(refName)">
                  {{ refName }}
                </span>
              </div>
            </div>
          </section>

          <div class="mt-2 grid min-h-0 flex-1 grid-cols-[minmax(13rem,0.78fr)_minmax(0,1.22fr)] gap-2.5">
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
                  v-if="commitAiDisplayResult"
                  type="button"
                  class="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded border border-outline-variant/80 bg-surface-container-high text-on-surface-variant shadow-sm transition-colors hover:bg-surface-container-highest hover:text-primary dark:bg-surface-container-highest dark:text-on-surface dark:hover:bg-surface-variant"
                  :title="copyLabel(commitAiDisplayResult)"
                  :aria-label="copyLabel(commitAiDisplayResult)"
                  @click="copyText(commitAiDisplayResult)"
                >
                  <ClipboardCopy :size="12" />
                </button>
                <div class="ai-result-panel h-full overflow-auto p-3">
                  <div
                    v-if="commitAiDisplayResult"
                    class="memo-rendered ai-markdown-result pr-7 text-on-surface"
                    v-html="renderedCommitAiResult"
                  ></div>
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
