<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  MessageSquareText,
  Plus,
  Send,
  Sparkles,
  Undo,
  X,
} from "lucide-vue-next";
import type {
  ProjectGitCommitSummary,
  ProjectGitFileChange,
  ProjectGitFileDiffResult,
  ProjectGitRepositoryTarget,
} from "../../types";
import AiReasoningResult from "./AiReasoningResult.vue";
import {
  aiReasoningCopyText,
  aiReasoningStateFromResult,
  appendAiStreamChunk,
  createAiReasoningStreamState,
  hasAiReasoningDisplay,
} from "../../lib/aiReasoning";
import {
  appendGitAiAnalysisVersion,
  clearGitAiAnalysisSessionsForProject,
  composeGitAiRefinementPrompt,
  createGitAiAnalysisSession,
  deleteRememberedGitAiAnalysisSession,
  getRememberedGitAiAnalysisSession,
  resolveGitAiAnalysisVersion,
  restoreGitAiAnalysisVersion,
  setRememberedGitAiAnalysisSession,
  type GitAiAnalysisSession,
  type GitAiAnalysisSessionInput,
} from "../../lib/gitAiAnalysisSession";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";

type AiState = "idle" | "loading" | "success" | "warning" | "error";
type GitFeedbackState = Exclude<AiState, "idle">;
type SelectedCommitContext = { commit: ProjectGitCommitSummary; files: ProjectGitFileChange[] };

const props = defineProps<{
  open: boolean;
  projectId: string;
  repositoryTarget: ProjectGitRepositoryTarget;
  selectedCommitHashes: string[];
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "feedback", state: GitFeedbackState, message: string): void;
}>();

const store = useStore();
const t = useI18n();
const aiMode = ref("summary");
const isAiModeMenuOpen = ref(false);
const aiDialogIncludeDiffContext = ref(true);
const aiDialogResult = ref(createAiReasoningStreamState());
const aiDialogSession = ref<GitAiAnalysisSession | null>(null);
const aiDialogSessionContextKey = ref("");
const aiDialogFollowUp = ref("");
const isAiDialogComposerExpanded = ref(true);
const aiDialogMessage = ref("");
const aiDialogNotice = ref("");
const aiDialogState = ref<AiState>("idle");
const copiedText = ref("");
const copiedTimer = ref<number | undefined>();
let aiDialogRequestGeneration = 0;
let stopAppEscapeListener = () => {};

const activeRepositoryContext = computed(() =>
  store.resolveGitRepositoryContext(props.projectId, props.repositoryTarget),
);
const snapshot = computed(() => store.gitSnapshotForRepository(props.projectId, props.repositoryTarget));
const repositoryPath = computed(
  () => snapshot.value?.repositoryPath || activeRepositoryContext.value?.repositoryPath || "",
);
const currentGitRefLabel = computed(() => {
  if (snapshot.value?.isDetachedHead) {
    return snapshot.value.headHash ? `HEAD @ ${snapshot.value.headHash}` : "detached HEAD";
  }
  return snapshot.value?.branch || "main";
});
const aiModeOptions = computed(() => store.aiPreferences.modes.filter((mode) => mode.kind !== "commit-message"));
const resolveAiModeId = (modeId: string) =>
  aiModeOptions.value.some((option) => option.id === modeId) ? modeId : aiModeOptions.value[0]?.id || "summary";
const selectedAiMode = computed(
  () => aiModeOptions.value.find((option) => option.id === aiMode.value) || aiModeOptions.value[0],
);
const selectedCommitHashSet = computed(() => new Set(props.selectedCommitHashes));
const selectedCommitCount = computed(() => props.selectedCommitHashes.length);
const manuallySelectedCommits = computed(() => {
  const selectedHashes = selectedCommitHashSet.value;
  return (snapshot.value?.commits || []).filter((commit) => selectedHashes.has(commit.hash));
});
const filterStatusSummary = computed(() => {
  if (selectedCommitCount.value > 0) return `将分析所选 ${selectedCommitCount.value} 条历史提交。`;
  return "未选择提交，将分析当前工作区变更";
});
const isAiDialogGenerating = computed(() => aiDialogState.value === "loading");
const aiDialogActiveVersion = computed(() => {
  const session = aiDialogSession.value;
  return session ? resolveGitAiAnalysisVersion(session) : null;
});
const aiDialogActiveVersionIndex = computed(() => {
  const session = aiDialogSession.value;
  const version = aiDialogActiveVersion.value;
  return session && version ? session.versions.findIndex((candidate) => candidate.id === version.id) : -1;
});
const aiDialogHasVersions = computed(() => Boolean(aiDialogSession.value?.versions.length));
const isAiDialogSetupLocked = computed(() => aiDialogHasVersions.value);
const aiDialogCanGoToPreviousVersion = computed(
  () => !isAiDialogGenerating.value && aiDialogActiveVersionIndex.value > 0,
);
const aiDialogCanGoToNextVersion = computed(() => {
  const session = aiDialogSession.value;
  return Boolean(
    !isAiDialogGenerating.value && session && aiDialogActiveVersionIndex.value < session.versions.length - 1,
  );
});
const aiDialogCanRestoreVersion = computed(() => {
  const session = aiDialogSession.value;
  return Boolean(
    !isAiDialogGenerating.value &&
    session &&
    aiDialogActiveVersionIndex.value >= 0 &&
    aiDialogActiveVersionIndex.value < session.versions.length - 1,
  );
});
const aiDialogCanSubmitFollowUp = computed(() =>
  Boolean(
    !isAiDialogGenerating.value &&
    aiDialogActiveVersion.value &&
    aiDialogFollowUp.value.trim() &&
    aiDialogSession.value,
  ),
);
const aiDialogScopeSummary = computed(() => aiDialogSession.value?.scopeSummary || filterStatusSummary.value);
const aiDialogDisplayResult = computed(() => {
  if (isAiDialogGenerating.value && hasAiReasoningDisplay(aiDialogResult.value)) return aiDialogResult.value;
  return aiDialogActiveVersion.value?.result || aiDialogResult.value;
});
const hasAiDialogDisplayResult = computed(() => hasAiReasoningDisplay(aiDialogDisplayResult.value));
const aiDialogCopyContent = computed(() =>
  aiReasoningCopyText(aiDialogActiveVersion.value?.result || createAiReasoningStreamState()),
);
const aiDialogPanelHint = computed(() => {
  if (aiDialogState.value === "loading") return "";
  if (aiDialogMessage.value) return aiDialogMessage.value;
  if (aiDialogState.value === "error") return "AI 分析失败。";
  if (aiDialogState.value === "idle") return "点击“生成”开始。";
  return "";
});

const resetAiDialogState = () => {
  aiDialogResult.value = createAiReasoningStreamState();
  aiDialogFollowUp.value = "";
  isAiDialogComposerExpanded.value = true;
  aiDialogMessage.value = "";
  aiDialogNotice.value = "";
  aiDialogState.value = "idle";
};

const rememberAiDialogSession = (session: GitAiAnalysisSession, contextKey: string) => {
  if (!contextKey) return;
  setRememberedGitAiAnalysisSession(contextKey, session);
  aiDialogSessionContextKey.value = contextKey;
  aiDialogSession.value = session;
};

const clearAiDialogSession = (contextKey = aiDialogSessionContextKey.value) => {
  if (contextKey) deleteRememberedGitAiAnalysisSession(contextKey);
  aiDialogSession.value = null;
  aiDialogSessionContextKey.value = "";
  resetAiDialogState();
};

const loadAiDialogSession = (context = activeRepositoryContext.value) => {
  const contextKey = context?.contextKey || "";
  const session = contextKey ? getRememberedGitAiAnalysisSession(contextKey) : null;
  aiDialogSessionContextKey.value = contextKey;
  aiDialogSession.value = session;
  aiDialogResult.value = createAiReasoningStreamState();
  aiDialogFollowUp.value = "";
  aiDialogMessage.value = "";
  aiDialogNotice.value = session?.notice || "";
  aiDialogState.value = session?.versions.length ? "success" : "idle";
  if (session) {
    aiMode.value = resolveAiModeId(session.modeId);
    aiDialogIncludeDiffContext.value = session.includeDiffContext;
  }
};

const hasAiDialogFinalContent = (result: ReturnType<typeof createAiReasoningStreamState>) =>
  Boolean(aiReasoningCopyText(result).trim());

const finalAiDialogResult = (result: ReturnType<typeof createAiReasoningStreamState>) =>
  hasAiDialogFinalContent(result) ? result : aiDialogResult.value;

const reportAiDialogFailure = (state: "warning" | "error", message: string) => {
  aiDialogResult.value = createAiReasoningStreamState();
  aiDialogMessage.value = message;
  aiDialogState.value = state;
  emit("feedback", state, message);
};

const selectAiMode = (modeId: string) => {
  if (isAiDialogSetupLocked.value || isAiDialogGenerating.value) return;
  aiMode.value = resolveAiModeId(modeId);
  isAiModeMenuOpen.value = false;
};

const selectAiDialogVersion = (offset: -1 | 1) => {
  const session = aiDialogSession.value;
  const nextIndex = aiDialogActiveVersionIndex.value + offset;
  const nextVersion = session?.versions[nextIndex];
  if (!session || !nextVersion || isAiDialogGenerating.value) return;
  rememberAiDialogSession({ ...session, activeVersionId: nextVersion.id }, aiDialogSessionContextKey.value);
  aiDialogMessage.value = "";
  aiDialogState.value = "success";
};

const restoreAiDialogVersion = () => {
  const session = aiDialogSession.value;
  const version = aiDialogActiveVersion.value;
  if (!session || !version || isAiDialogGenerating.value) return;
  const restoredSession = restoreGitAiAnalysisVersion(session, version.id);
  if (restoredSession === session) return;
  rememberAiDialogSession(restoredSession, aiDialogSessionContextKey.value);
  aiDialogResult.value = createAiReasoningStreamState();
  aiDialogMessage.value = "";
  aiDialogState.value = "success";
};

const startNewAiAnalysis = () => {
  if (isAiDialogGenerating.value) return;
  isAiModeMenuOpen.value = false;
  clearAiDialogSession();
};

const waitForVisualFeedback = async () => {
  await nextTick();
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
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

const replacePromptPlaceholders = (template: string, placeholders: Record<string, string>) =>
  Object.entries(placeholders).reduce((prompt, [name, value]) => prompt.replaceAll(`{${name}}`, value), template);

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

const gitAiDiffContextMaxChars = 14000;

const buildGitAiDiffContext = async (
  sourceFiles: ProjectGitFileChange[],
  readDiff: (file: ProjectGitFileChange) => Promise<ProjectGitFileDiffResult | null>,
) => {
  if (sourceFiles.length === 0) return { content: "", truncated: false };

  let content = "";
  let truncated = false;
  for (const sourceFile of sourceFiles) {
    const result = await readDiff(sourceFile);
    const diff = result?.diff?.trim();
    if (!diff) continue;

    const nextSection = `${content ? "\n\n" : ""}--- ${gitFileDisplayPath(sourceFile)} ---\n${diff}`;
    if (content.length + nextSection.length > gitAiDiffContextMaxChars) {
      const remainingChars = Math.max(0, gitAiDiffContextMaxChars - content.length);
      if (remainingChars > 0) content += nextSection.slice(0, remainingChars);
      truncated = true;
      break;
    }
    content += nextSection;
  }

  return { content, truncated };
};

const workingTreeDiffContext = (target: ProjectGitRepositoryTarget) =>
  buildGitAiDiffContext(snapshot.value?.files || [], (file) =>
    store.readGitFileDiff(props.projectId, file.path, undefined, target),
  );

const formatDiffContextSection = (title: string, diffContext: { content: string; truncated: boolean } | null) => {
  if (!diffContext) return "代码 diff：未附加；请基于提交元数据和文件列表分析。";
  if (!diffContext.content.trim()) return "代码 diff：当前没有可附加的 diff 内容。";
  const truncatedNote = diffContext.truncated ? "\n\n（diff 内容已按长度截断，请基于已有内容保守判断。）" : "";
  return `${title}：\n${diffContext.content}${truncatedNote}`;
};

const buildSelectedHistoryContext = async (target: ProjectGitRepositoryTarget) => {
  const contexts: SelectedCommitContext[] = [];
  for (const commit of manuallySelectedCommits.value) {
    let commitFiles: ProjectGitFileChange[] = [];
    try {
      commitFiles = await store.readGitCommitFiles(props.projectId, commit.hash, target);
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
          result = await store.readGitCommitFileDiff(props.projectId, commit.hash, file.path, target);
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

const buildAiPrompt = async (target: ProjectGitRepositoryTarget) => {
  const template = selectedAiMode.value?.prompt || "请总结这些 Git 信息。";
  if (selectedCommitCount.value > 0) {
    const historyContext = await buildSelectedHistoryContext(target);
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

  const diffContext = aiDialogIncludeDiffContext.value ? await workingTreeDiffContext(target) : null;
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

const isCurrentAiRequest = (contextKey: string, requestGeneration: number) =>
  activeRepositoryContext.value?.contextKey === contextKey && aiDialogRequestGeneration === requestGeneration;

const generateAiAnalysis = async () => {
  if (isAiDialogSetupLocked.value) return;
  const originContext = activeRepositoryContext.value;
  if (!originContext) return;
  const originAiDialogRequestGeneration = aiDialogRequestGeneration;
  isAiModeMenuOpen.value = false;
  aiDialogResult.value = createAiReasoningStreamState();
  aiDialogMessage.value = "";
  aiDialogState.value = "loading";
  await waitForVisualFeedback();

  const promptResult = await buildAiPrompt(originContext.target);
  if (!isCurrentAiRequest(originContext.contextKey, originAiDialogRequestGeneration)) return;

  aiDialogNotice.value = promptResult.truncated
    ? selectedCommitCount.value > 0
      ? "Diff 已截断，所有提交信息已保留"
      : "工作区 Diff 已截断"
    : "";
  const sessionInput: GitAiAnalysisSessionInput = {
    basePrompt: promptResult.prompt,
    scopeSummary: filterStatusSummary.value,
    notice: aiDialogNotice.value,
    modeId: aiMode.value,
    includeDiffContext: aiDialogIncludeDiffContext.value,
  };
  await store.analyzeGitWithAiStream(props.projectId, promptResult.prompt, {
    onChunk: (chunk) => {
      if (!isCurrentAiRequest(originContext.contextKey, originAiDialogRequestGeneration)) return;
      aiDialogResult.value = appendAiStreamChunk(aiDialogResult.value, chunk);
    },
    onDone: (result) => {
      if (!isCurrentAiRequest(originContext.contextKey, originAiDialogRequestGeneration)) return;
      const completedResult = finalAiDialogResult(aiReasoningStateFromResult(result));
      if (result.ok && hasAiDialogFinalContent(completedResult)) {
        rememberAiDialogSession(
          appendGitAiAnalysisVersion(createGitAiAnalysisSession(sessionInput), completedResult),
          originContext.contextKey,
        );
        aiDialogResult.value = completedResult;
        aiDialogMessage.value = result.message || "";
        aiDialogState.value = "success";
        return;
      }
      reportAiDialogFailure(
        result.ok ? "warning" : "error",
        result.ok ? "AI 已返回成功，但没有生成内容。" : result.message || "AI 分析失败。",
      );
    },
  });
};

const refineAiAnalysis = async () => {
  const session = aiDialogSession.value;
  const sourceVersion = aiDialogActiveVersion.value;
  const instruction = aiDialogFollowUp.value.trim();
  const prompt = session && sourceVersion ? composeGitAiRefinementPrompt(session, sourceVersion.id, instruction) : null;
  if (!session || !sourceVersion || !prompt || isAiDialogGenerating.value) return;

  const originContext = activeRepositoryContext.value;
  if (!originContext) return;
  const originAiDialogRequestGeneration = aiDialogRequestGeneration;
  aiDialogResult.value = createAiReasoningStreamState();
  aiDialogMessage.value = "";
  aiDialogState.value = "loading";
  await waitForVisualFeedback();

  if (!isCurrentAiRequest(originContext.contextKey, originAiDialogRequestGeneration)) return;

  await store.analyzeGitWithAiStream(props.projectId, prompt, {
    onChunk: (chunk) => {
      if (!isCurrentAiRequest(originContext.contextKey, originAiDialogRequestGeneration)) return;
      aiDialogResult.value = appendAiStreamChunk(aiDialogResult.value, chunk);
    },
    onDone: (result) => {
      if (!isCurrentAiRequest(originContext.contextKey, originAiDialogRequestGeneration)) return;
      const completedResult = finalAiDialogResult(aiReasoningStateFromResult(result));
      if (result.ok && hasAiDialogFinalContent(completedResult)) {
        rememberAiDialogSession(
          appendGitAiAnalysisVersion(session, completedResult, sourceVersion.id, instruction),
          originContext.contextKey,
        );
        aiDialogResult.value = completedResult;
        aiDialogFollowUp.value = "";
        aiDialogMessage.value = result.message || "";
        aiDialogState.value = "success";
        return;
      }
      reportAiDialogFailure(
        result.ok ? "warning" : "error",
        result.ok ? "AI 已返回成功，但没有生成内容。" : result.message || "AI 分析失败。",
      );
    },
  });
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

const copyLabel = computed(
  () => (value: string) => (copiedText.value === value ? t.value.common.copied : t.value.common.copy),
);

const requestClose = () => {
  isAiModeMenuOpen.value = false;
  emit("close");
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!props.open || event.detail.handled) return;
  requestClose();
  event.detail.handle();
};

onMounted(() => {
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});

onBeforeUnmount(() => {
  aiDialogRequestGeneration += 1;
  if (store.selectedProjectId !== props.projectId) clearGitAiAnalysisSessionsForProject(props.projectId);
  window.clearTimeout(copiedTimer.value);
  stopAppEscapeListener();
});

watch(
  () => aiModeOptions.value.map((mode) => mode.id).join("|"),
  () => {
    aiMode.value = resolveAiModeId(aiMode.value);
  },
  { immediate: true },
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      if (!isAiDialogGenerating.value) loadAiDialogSession();
      return;
    }
    isAiModeMenuOpen.value = false;
  },
  { immediate: true },
);

watch(
  () => activeRepositoryContext.value?.contextKey || "",
  (contextKey, previousContextKey) => {
    if (contextKey === previousContextKey) return;
    aiDialogRequestGeneration += 1;
    if (props.open) loadAiDialogSession();
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="scale">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
        @click.self="requestClose"
      >
        <div
          class="flex h-[min(46rem,90vh)] w-[min(58rem,94vw)] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="git-ai-analysis-dialog-title"
          @click.stop
        >
          <div
            class="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4 py-3"
          >
            <div class="min-w-0">
              <h3 id="git-ai-analysis-dialog-title" class="text-sm font-bold text-on-surface">AI 生成</h3>
              <p class="truncate text-[10px] font-medium text-on-surface-variant">{{ aiDialogScopeSummary }}</p>
            </div>
            <button
              type="button"
              class="git-top-action"
              :title="t.common.close"
              :aria-label="t.common.close"
              @click="requestClose"
            >
              <X :size="14" />
            </button>
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
            <div class="flex shrink-0 flex-wrap items-end gap-2">
              <div class="relative w-48">
                <button
                  type="button"
                  class="ui-field flex w-full items-center justify-between gap-2 text-left font-semibold normal-case disabled:cursor-not-allowed disabled:opacity-65"
                  :disabled="isAiDialogSetupLocked || isAiDialogGenerating"
                  aria-haspopup="menu"
                  :aria-expanded="isAiModeMenuOpen"
                  @click.stop="isAiModeMenuOpen = !isAiModeMenuOpen"
                >
                  <span>{{ selectedAiMode?.name || "总结" }}</span>
                  <ChevronDown :size="14" class="text-on-surface-variant" />
                </button>
                <div
                  v-if="isAiModeMenuOpen && !isAiDialogSetupLocked"
                  v-overlay-scrollbar
                  class="mode-menu-popover"
                  role="menu"
                  @click.stop
                >
                  <button
                    v-for="option in aiModeOptions"
                    :key="option.id"
                    type="button"
                    :class="cn('mode-menu-item', aiMode === option.id && 'bg-primary/10 text-primary')"
                    role="menuitemradio"
                    :aria-checked="aiMode === option.id"
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
                  :disabled="isAiDialogGenerating || isAiDialogSetupLocked"
                />
                <span>Diff</span>
              </label>
              <button
                v-if="!isAiDialogSetupLocked"
                type="button"
                class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-subtle bg-primary px-3 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
                :disabled="isAiDialogGenerating"
                @click="generateAiAnalysis"
              >
                <Sparkles :size="13" />
                {{ isAiDialogGenerating ? "生成中" : "生成" }}
              </button>
              <button
                v-else
                type="button"
                class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant disabled:cursor-wait disabled:opacity-70"
                :disabled="isAiDialogGenerating"
                @click="startNewAiAnalysis"
              >
                <Plus :size="13" />
                新分析
              </button>
              <span
                v-if="aiDialogNotice"
                class="inline-flex h-9 max-w-full items-center truncate rounded-lg border border-status-warning/30 bg-status-warning/10 px-2.5 text-[10px] font-bold text-status-warning"
                :title="aiDialogNotice"
              >
                {{ aiDialogNotice }}
              </span>
            </div>
            <div
              v-if="aiDialogMessage && aiDialogState !== 'success' && hasAiDialogDisplayResult"
              :class="[
                'flex shrink-0 items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-[10px] font-bold',
                aiDialogState === 'error'
                  ? 'border-status-error/30 bg-status-error/10 text-status-error'
                  : 'border-status-warning/30 bg-status-warning/10 text-status-warning',
              ]"
            >
              <span class="min-w-0 break-words">{{ aiDialogMessage }}</span>
              <button
                v-if="aiDialogCanSubmitFollowUp"
                type="button"
                class="shrink-0 text-[10px] font-bold underline underline-offset-2"
                @click="refineAiAnalysis"
              >
                重试
              </button>
            </div>
            <div class="relative min-h-0 flex-1">
              <div
                v-if="aiDialogHasVersions"
                class="absolute -top-8 right-2 z-20 flex h-6 items-center overflow-hidden rounded-md border border-border-subtle bg-surface shadow-sm"
              >
                <span
                  class="flex h-full items-center border-r border-border-subtle px-2 text-[10px] font-bold text-on-surface-variant"
                >
                  版本 {{ aiDialogActiveVersionIndex + 1 }}/{{ aiDialogSession?.versions.length }}
                </span>
                <button
                  type="button"
                  class="git-section-action git-section-action--segment"
                  title="上一版"
                  aria-label="上一版"
                  :disabled="!aiDialogCanGoToPreviousVersion"
                  @click="selectAiDialogVersion(-1)"
                >
                  <ChevronLeft :size="14" />
                </button>
                <button
                  type="button"
                  class="git-section-action git-section-action--segment"
                  title="下一版"
                  aria-label="下一版"
                  :disabled="!aiDialogCanGoToNextVersion"
                  @click="selectAiDialogVersion(1)"
                >
                  <ChevronRight :size="14" />
                </button>
                <button
                  type="button"
                  class="git-section-action git-section-action--segment"
                  title="将此版本作为最新版本"
                  aria-label="将此版本作为最新版本"
                  :disabled="!aiDialogCanRestoreVersion"
                  @click="restoreAiDialogVersion"
                >
                  <Undo :size="13" />
                </button>
                <button
                  v-if="aiDialogCopyContent"
                  type="button"
                  class="git-section-action"
                  :title="copyLabel(aiDialogCopyContent)"
                  :aria-label="copyLabel(aiDialogCopyContent)"
                  :disabled="isAiDialogGenerating"
                  :aria-busy="isAiDialogGenerating"
                  @click="copyText(aiDialogCopyContent)"
                >
                  <ClipboardCopy :size="12" />
                </button>
              </div>
              <div
                class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-container-low text-xs leading-5 text-on-surface-variant"
              >
                <div
                  :class="['ai-result-panel min-h-0 flex-1 overflow-auto p-3', aiDialogHasVersions && 'pb-16']"
                  :aria-busy="isAiDialogGenerating"
                >
                  <AiReasoningResult v-if="hasAiDialogDisplayResult" :result="aiDialogDisplayResult" />
                  <div
                    v-else-if="aiDialogPanelHint"
                    :class="aiDialogState === 'error' ? 'text-status-error' : 'text-on-surface-variant'"
                  >
                    {{ aiDialogPanelHint }}
                  </div>
                </div>
              </div>
              <div
                v-if="aiDialogHasVersions"
                :class="[
                  'absolute bottom-2 right-2 z-20 flex h-9 items-center justify-end transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                  isAiDialogComposerExpanded ? 'w-[calc(100%-1rem)]' : 'w-9',
                ]"
              >
                <div
                  :class="[
                    'flex min-w-0 items-center gap-1.5 overflow-hidden transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
                    isAiDialogComposerExpanded
                      ? 'mr-1.5 flex-1 translate-x-0 opacity-100 delay-75'
                      : 'pointer-events-none w-0 translate-x-3 opacity-0',
                  ]"
                  :aria-hidden="!isAiDialogComposerExpanded"
                  :inert="!isAiDialogComposerExpanded"
                >
                  <textarea
                    id="git-ai-follow-up"
                    v-model="aiDialogFollowUp"
                    rows="1"
                    class="ui-field h-9 min-h-9 min-w-0 flex-1 resize-none overflow-y-hidden border-outline-variant/80 bg-surface-container-lowest py-1 text-xs leading-5 shadow-md"
                    placeholder="例如：只保留高风险问题，并补充测试建议"
                    :disabled="isAiDialogGenerating"
                    aria-label="输入修改要求或追问"
                    @keydown.enter.exact.prevent="refineAiAnalysis"
                  />
                  <button
                    type="button"
                    class="git-ai-composer-action flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/70 bg-primary text-on-primary shadow-md transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-primary/90 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
                    title="发送修改要求"
                    aria-label="发送修改要求"
                    :disabled="!aiDialogCanSubmitFollowUp"
                    @click="refineAiAnalysis"
                  >
                    <Send :size="14" />
                  </button>
                </div>
                <button
                  type="button"
                  class="git-ai-composer-action flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-container-high text-on-surface-variant shadow-md transition-[background-color,color,box-shadow,transform] duration-200 hover:scale-105 hover:bg-surface-variant hover:text-on-surface hover:shadow-lg active:scale-95 motion-reduce:transform-none motion-reduce:transition-none"
                  :title="isAiDialogComposerExpanded ? '收起修改输入框' : '向左展开修改输入框'"
                  :aria-label="isAiDialogComposerExpanded ? '收起修改输入框' : '向左展开修改输入框'"
                  @click="isAiDialogComposerExpanded = !isAiDialogComposerExpanded"
                >
                  <span class="relative h-4 w-4">
                    <MessageSquareText
                      :size="16"
                      :class="[
                        'absolute inset-0 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
                        isAiDialogComposerExpanded
                          ? 'rotate-12 scale-75 opacity-0'
                          : 'rotate-0 scale-100 opacity-100 delay-100',
                      ]"
                    />
                    <X
                      :size="16"
                      :class="[
                        'absolute inset-0 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
                        isAiDialogComposerExpanded
                          ? 'rotate-0 scale-100 opacity-100 delay-100'
                          : '-rotate-12 scale-75 opacity-0',
                      ]"
                    />
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
