<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  CornerDownLeft,
  ExternalLink,
  GitPullRequest,
  RefreshCw,
  Sparkles,
} from "lucide-vue-next";
import type {
  GithubPrContext,
  GithubPullRequestSummary,
  GithubRepositoryMetadata,
  ProjectGitRepositoryTarget,
} from "../../types";
import { AI_PR_DESCRIPTION_MODE_ID, DEFAULT_AI_PR_DESCRIPTION_PROMPT } from "../../types";
import BaseModal from "../common/BaseModal.vue";
import UiSelect, { type UiSelectOption } from "../common/UiSelect.vue";
import { appendAiStreamChunk, createAiReasoningStreamState } from "../../lib/aiReasoning";
import { renderMarkdown } from "../../lib/markdown";
import { toggleMarkdownTaskAt } from "../../lib/markdownTasks";
import { cn } from "../../lib/utils";
import {
  orderGithubBaseRemotes,
  resolveDefaultGithubHeadRemote,
  type GithubRemoteRepository,
} from "../../lib/githubRepository";
import {
  composeGithubPrAiPrompt,
  composeGithubPrPrefill,
  githubPrTemplateName,
  splitGithubPrAiContent,
} from "../../lib/githubPrPrefill";
import { useStore } from "../../store/useStore";

type DialogPhase = "boot" | "ready" | "creating" | "created";
type FeedbackState = "idle" | "loading" | "success" | "warning" | "error";

const props = defineProps<{
  open: boolean;
  projectId: string;
  repositoryTarget: ProjectGitRepositoryTarget;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "feedback", state: FeedbackState, message: string, options?: { retainRemoteProgress?: boolean }): void;
}>();

const store = useStore();
const phase = ref<DialogPhase>("boot");
const bootError = ref("");
const bootWarning = ref("");
const baseRemoteName = ref("");
const baseRepo = ref<GithubRepositoryMetadata | null>(null);
const headRemote = ref<GithubRemoteRepository | null>(null);
const baseBranchName = ref("");
const templates = ref<string[]>([]);
const selectedTemplateIndex = ref(0);
const prContext = ref<GithubPrContext | null>(null);
const contextError = ref("");
const openPullRequest = ref<GithubPullRequestSummary | null>(null);
const prTitle = ref("");
const prDescription = ref("");
const isDraft = ref(false);
const titleTouched = ref(false);
const descriptionTouched = ref(false);
const aiState = ref<"idle" | "loading" | "error">("idle");
const aiMessage = ref("");
const aiResult = ref(createAiReasoningStreamState());
const aiVersions = ref<Array<{ title: string; description: string }>>([]);
const aiActiveVersionIndex = ref(-1);
const aiFollowUp = ref("");
const aiAbortRequested = ref(false);
const descriptionMode = ref<"edit" | "preview">("edit");
const createdPr = ref<GithubPullRequestSummary | null>(null);
const copiedValue = ref("");
const copiedTimer = ref<number | undefined>();
const isPushingBranch = ref(false);
let requestGeneration = 0;

const snapshot = computed(() => store.gitSnapshotForRepository(props.projectId, props.repositoryTarget));
const currentBranch = computed(() => snapshot.value?.branch || "");
const githubBaseRemotes = computed(() => orderGithubBaseRemotes(snapshot.value?.remotes || []));
const baseRepoLabel = computed(() => {
  if (baseRepo.value) return `${baseRepo.value.owner}/${baseRepo.value.repository}`;
  const remote = githubBaseRemotes.value.find((item) => item.remoteName === baseRemoteName.value);
  return remote ? `${remote.owner}/${remote.repository}` : "";
});
const baseRemoteOptions = computed<UiSelectOption[]>(() =>
  githubBaseRemotes.value.map((remote) => ({
    value: remote.remoteName,
    label: remote.remoteName,
    hint: `${remote.owner}/${remote.repository}`,
  })),
);
const baseBranchOptions = computed<UiSelectOption[]>(() => {
  const remoteName = baseRemoteName.value;
  const branches = new Set(
    (snapshot.value?.remoteBranches || [])
      .filter((branch) => branch.remote === remoteName)
      .map((branch) => branch.branch),
  );
  if (baseRepo.value?.defaultBranch) branches.add(baseRepo.value.defaultBranch);
  if (baseBranchName.value) branches.add(baseBranchName.value);
  return [...branches].sort((left, right) => left.localeCompare(right)).map((branch) => ({ value: branch, label: branch }));
});
const templateOptions = computed<UiSelectOption[]>(() =>
  templates.value.map((body, index) => ({ value: String(index), label: githubPrTemplateName(body, index) })),
);
const selectedTemplate = computed(() => templates.value[selectedTemplateIndex.value] || "");
const baseRemoteSelectModel = computed({
  get: () => baseRemoteName.value,
  set: (value: string | null) => {
    const remoteName = String(value || "");
    if (remoteName && remoteName !== baseRemoteName.value) void changeBaseRemote(remoteName);
  },
});
const baseBranchSelectModel = computed({
  get: () => baseBranchName.value,
  set: (value: string | null) => {
    const branch = String(value || "");
    if (branch && branch !== baseBranchName.value) void changeBaseBranch(branch);
  },
});
const selectedTemplateSelectModel = computed({
  get: () => String(selectedTemplateIndex.value),
  set: (value: string | null) => {
    const index = Number(value ?? 0);
    const nextIndex = Number.isSafeInteger(index) && index >= 0 && index < templates.value.length ? index : 0;
    if (nextIndex === selectedTemplateIndex.value) return;
    selectedTemplateIndex.value = nextIndex;
    if (!descriptionTouched.value) applyPrefill();
  },
});
const upstream = computed(() => snapshot.value?.upstream || null);
const isBranchTrackedOnHeadRemote = computed(
  () => Boolean(upstream.value && headRemote.value && upstream.value.remote === headRemote.value.remoteName),
);
const needsPublish = computed(() => Boolean(headRemote.value && !isBranchTrackedOnHeadRemote.value));
const needsPush = computed(
  () => Boolean(isBranchTrackedOnHeadRemote.value && (upstream.value?.ahead ?? 0) > 0),
);
const hasCommitsAgainstBase = computed(() => (prContext.value?.totalCommits ?? 0) > 0);
const isAiGenerating = computed(() => aiState.value === "loading");
const aiModePrompt = computed(() => {
  const mode =
    store.aiPreferences.modes.find((item) => item.id === AI_PR_DESCRIPTION_MODE_ID) ||
    store.aiPreferences.modes.find((item) => item.kind === "pr-description");
  return mode?.prompt?.trim() || DEFAULT_AI_PR_DESCRIPTION_PROMPT;
});
const createBlockedReason = computed(() => {
  if (phase.value === "created") return "";
  if (needsPublish.value) return `分支尚未发布到 ${headRemote.value?.remoteName || "远端"}，请先推送。`;
  if (needsPush.value) return "本地还有未推送的提交，请先推送。";
  if (openPullRequest.value) return `当前分支已有 PR #${openPullRequest.value.number}。`;
  if (prContext.value && !hasCommitsAgainstBase.value) return "源分支相对目标分支没有新的提交。";
  if (!prTitle.value.trim()) return "请填写 PR 标题。";
  return "";
});
const canCreate = computed(() => phase.value === "ready" && !createBlockedReason.value);

const reportFeedback = (
  state: FeedbackState,
  message: string,
  options?: { retainRemoteProgress?: boolean },
) => emit("feedback", state, message, options);

/** 弹窗引导各阶段的浮层提示；idle 用于收起。 */
const bootStep = (message: string) => reportFeedback("loading", message);
const finishBootSteps = (generation: number) => {
  if (generation === requestGeneration) reportFeedback("idle", "");
};

const applyPrefill = () => {
  const context = prContext.value;
  if (!context || !baseRepo.value) return;
  const prefill = composeGithubPrPrefill({
    headBranch: context.headBranch,
    repoDefaultBranch: baseRepo.value.defaultBranch,
    nonMergeCommitCount: context.nonMergeCommitCount,
    commits: context.commits,
    template: selectedTemplate.value,
  });
  if (!titleTouched.value) prTitle.value = prefill.title;
  if (!descriptionTouched.value) prDescription.value = prefill.description;
};

const loadRemoteBranches = async () => {
  // 目标分支候选来自远端分支列表；quiet fetch 不占用全局远端进度浮层，
  // 失败也不阻塞流程，仅使用现有快照。
  try {
    await store.fetchGitRemoteByName(props.projectId, baseRemoteName.value, props.repositoryTarget, {
      quiet: true,
    });
  } catch {
    /* 使用当前快照中的远端分支 */
  }
};

const loadBaseRepoData = async (generation: number) => {
  const remote = githubBaseRemotes.value.find((item) => item.remoteName === baseRemoteName.value);
  if (!remote) {
    bootError.value = "未找到可用的 GitHub 远端。";
    return;
  }
  const metadataResult = await store.readGithubRepositoryMetadata(remote.owner, remote.repository);
  if (generation !== requestGeneration) return;
  if (!metadataResult.ok) {
    bootError.value = metadataResult.failure.message;
    return;
  }
  let metadata = metadataResult.value;
  let effectiveRemoteName = remote.remoteName;
  // fork 仓库：PR 默认目标为上游父仓库；若本地配置了指向父仓库的 remote，则用它读取基点引用。
  if (metadata.isFork && metadata.parent) {
    const parentRemote = githubBaseRemotes.value.find(
      (item) =>
        item.owner.toLowerCase() === metadata.parent!.owner.toLowerCase() &&
        item.repository.toLowerCase() === metadata.parent!.repository.toLowerCase(),
    );
    if (parentRemote) effectiveRemoteName = parentRemote.remoteName;
    metadata = {
      ...metadata,
      owner: metadata.parent.owner,
      repository: metadata.parent.repository,
      nodeId: metadata.parent.nodeId || metadata.nodeId,
      defaultBranch: metadata.parent.defaultBranch || metadata.defaultBranch,
    };
  }
  baseRemoteName.value = effectiveRemoteName;
  baseRepo.value = metadata;

  if (!baseBranchName.value) {
    baseBranchName.value =
      snapshot.value?.base?.remote === effectiveRemoteName
        ? snapshot.value.base.branch
        : metadata.defaultBranch;
  }

  if (generation === requestGeneration) bootStep("正在获取 PR 模板...");
  const templatesResult = await store.readGithubPullRequestTemplates(metadata.owner, metadata.repository);
  if (generation !== requestGeneration) return;
  let bodies = templatesResult.ok ? templatesResult.value : [];
  if (templatesResult.ok && bodies.length === 0) {
    // 回退 owner 级模板仓库 {owner}/.github。
    if (generation === requestGeneration) bootStep("正在获取 owner 级 PR 模板...");
    const fallback = await store.readGithubPullRequestTemplates(metadata.owner, ".github");
    if (generation !== requestGeneration) return;
    if (fallback.ok) bodies = fallback.value;
  }
  templates.value = bodies;
  selectedTemplateIndex.value = 0;
};

const loadOpenPullRequest = async (generation: number) => {
  const head = headRemote.value;
  const base = baseRepo.value;
  const branch = currentBranch.value;
  if (!head || !base || !branch) return;
  const result = await store.readGithubOpenPullRequest(base.owner, base.repository, head.owner, branch);
  if (generation !== requestGeneration) return;
  openPullRequest.value = result.ok ? result.value : null;
};

const loadPrContext = async (generation: number) => {
  const branch = currentBranch.value;
  const base = baseBranchName.value;
  if (!branch || !base || !baseRemoteName.value) return;
  const result = await store.readGithubPrContext(props.projectId, props.repositoryTarget, {
    baseRemote: baseRemoteName.value,
    baseBranch: base,
    headBranch: branch,
  });
  if (generation !== requestGeneration) return;
  if (!result) {
    contextError.value = "当前项目不可用，无法读取 PR 上下文。";
    return;
  }
  if (result.ok) {
    prContext.value = result.value;
    contextError.value = "";
  } else {
    prContext.value = null;
    contextError.value = result.failure.message;
  }
  applyPrefill();
};

const runBoot = async () => {
  const generation = ++requestGeneration;
  phase.value = "boot";
  bootError.value = "";
  bootWarning.value = "";
  contextError.value = "";
  baseRepo.value = null;
  templates.value = [];
  selectedTemplateIndex.value = 0;
  prContext.value = null;
  openPullRequest.value = null;
  prTitle.value = "";
  prDescription.value = "";
  titleTouched.value = false;
  descriptionTouched.value = false;
  isDraft.value = false;
  aiState.value = "idle";
  aiMessage.value = "";
  aiResult.value = createAiReasoningStreamState();
  aiVersions.value = [];
  aiActiveVersionIndex.value = -1;
  aiFollowUp.value = "";
  aiAbortRequested.value = false;
  createdPr.value = null;

  if (!snapshot.value?.repositoryPath) {
    bootError.value = "Git 快照未就绪，请稍后重试。";
    phase.value = "ready";
    return;
  }

  const headCandidate = resolveDefaultGithubHeadRemote(snapshot.value?.remotes || [], upstream.value);
  if (!headCandidate) {
    bootError.value = "当前仓库没有配置 GitHub 远端，无法创建 PR。";
    return;
  }
  headRemote.value = headCandidate;
  if (!currentBranch.value) {
    bootError.value = snapshot.value?.isDetachedHead ? "当前处于 detached HEAD，请先切回分支。" : "未检测到当前分支。";
    return;
  }
  const baseCandidate = githubBaseRemotes.value[0];
  if (!baseCandidate) {
    bootError.value = "当前仓库没有配置 GitHub 远端，无法创建 PR。";
    return;
  }
  baseRemoteName.value = baseCandidate.remoteName;
  baseBranchName.value = "";

  try {
    bootStep("正在刷新远端分支...");
    await loadRemoteBranches();
    if (generation !== requestGeneration) return;
    bootStep("正在获取仓库信息...");
    await loadBaseRepoData(generation);
    if (generation !== requestGeneration || bootError.value) return;
    bootStep("正在读取提交范围与已有 PR...");
    await Promise.all([loadOpenPullRequest(generation), loadPrContext(generation)]);
    if (generation !== requestGeneration) return;
    if (contextError.value) bootWarning.value = contextError.value;
    phase.value = "ready";
  } catch (error) {
    if (generation !== requestGeneration) return;
    bootError.value = error instanceof Error ? error.message : "初始化 GitHub PR 信息失败。";
    phase.value = "ready";
  } finally {
    finishBootSteps(generation);
  }
};

const changeBaseRemote = async (remoteName: string) => {
  if (remoteName === baseRemoteName.value || phase.value === "boot") return;
  // 使在途的旧请求失效，避免旧仓库数据写回新选择。
  const generation = ++requestGeneration;
  baseRemoteName.value = remoteName;
  baseRepo.value = null;
  baseBranchName.value = "";
  templates.value = [];
  openPullRequest.value = null;
  prContext.value = null;
  bootWarning.value = "";
  contextError.value = "";
  phase.value = "boot";
  try {
    bootStep(`正在刷新 ${remoteName} 远端分支...`);
    await loadRemoteBranches();
    if (generation !== requestGeneration) return;
    bootStep("正在获取仓库信息...");
    await loadBaseRepoData(generation);
    if (generation !== requestGeneration || bootError.value) {
      phase.value = "ready";
      return;
    }
    bootStep("正在读取提交范围与已有 PR...");
    await Promise.all([loadOpenPullRequest(generation), loadPrContext(generation)]);
    if (generation !== requestGeneration) return;
    if (contextError.value) bootWarning.value = contextError.value;
    phase.value = "ready";
  } finally {
    finishBootSteps(generation);
  }
};

const changeBaseBranch = async (branch: string) => {
  if (branch === baseBranchName.value || phase.value === "boot") return;
  baseBranchName.value = branch;
  prContext.value = null;
  contextError.value = "";
  const generation = requestGeneration;
  await loadPrContext(generation);
  if (contextError.value) bootWarning.value = contextError.value;
};

const reprefill = () => {
  titleTouched.value = false;
  descriptionTouched.value = false;
  applyPrefill();
};

const runAiGeneration = async (options: { instruction?: string; previous?: { title: string; description: string } | null }) => {
  if (isAiGenerating.value) return;
  const context = prContext.value;
  const base = baseRepo.value;
  if (!context || !base) {
    aiMessage.value = "PR 上下文未就绪，无法生成。";
    aiState.value = "error";
    return;
  }
  const generation = requestGeneration;
  const snapshotBefore = { title: prTitle.value, description: prDescription.value };
  aiState.value = "loading";
  aiMessage.value = "";
  aiAbortRequested.value = false;
  aiResult.value = createAiReasoningStreamState();
  const prompt = composeGithubPrAiPrompt({
    modePrompt: aiModePrompt.value,
    context,
    repositoryLabel: baseRepoLabel.value,
    template: selectedTemplate.value,
    remoteName: headRemote.value?.remoteName || baseRemoteName.value,
    previous: options.previous ?? null,
    instruction: options.instruction,
  });
  await store.analyzeGitWithAiStream(props.projectId, prompt, {
    onChunk: (chunk) => {
      if (generation !== requestGeneration || aiAbortRequested.value) return;
      aiResult.value = appendAiStreamChunk(aiResult.value, chunk);
      // 生成过程实时写入描述区，完成后会被解析结果替换。
      if (aiResult.value.content) prDescription.value = aiResult.value.content;
    },
    onDone: (result) => {
      if (generation !== requestGeneration) return;
      if (aiAbortRequested.value) {
        aiState.value = "idle";
        aiMessage.value = "已停止生成，描述区保留已生成的内容。";
        return;
      }
      if (result.ok) {
        const content = result.content || aiResult.value.content;
        const { title, description } = splitGithubPrAiContent(content);
        prTitle.value = title || snapshotBefore.title;
        prDescription.value = description || aiResult.value.content || snapshotBefore.description;
        titleTouched.value = true;
        descriptionTouched.value = true;
        aiVersions.value = [...aiVersions.value, { title: prTitle.value, description: prDescription.value }].slice(-5);
        aiActiveVersionIndex.value = aiVersions.value.length - 1;
        aiState.value = "idle";
        aiMessage.value = "";
        return;
      }
      prTitle.value = snapshotBefore.title;
      prDescription.value = snapshotBefore.description;
      aiState.value = "error";
      aiMessage.value = result.message || "AI 生成失败。";
    },
  });
};

const generateWithAi = () =>
  runAiGeneration({
    previous: null,
    instruction: undefined,
  });

const submitAiFollowUp = () => {
  if (isAiGenerating.value || aiVersions.value.length === 0) return;
  const instruction = aiFollowUp.value.trim();
  if (!instruction) return;
  void runAiGeneration({ instruction, previous: aiVersions.value[aiActiveVersionIndex.value] || null });
  aiFollowUp.value = "";
};

const regenerateAi = () => {
  if (isAiGenerating.value || aiVersions.value.length === 0) return;
  void runAiGeneration({ instruction: undefined, previous: aiVersions.value[aiActiveVersionIndex.value] || null });
};

const stopAiGeneration = () => {
  if (!isAiGenerating.value) return;
  aiAbortRequested.value = true;
};

const selectAiVersion = (offset: -1 | 1) => {
  if (isAiGenerating.value) return;
  const nextIndex = aiActiveVersionIndex.value + offset;
  const version = aiVersions.value[nextIndex];
  if (!version) return;
  aiActiveVersionIndex.value = nextIndex;
  prTitle.value = version.title;
  prDescription.value = version.description;
  titleTouched.value = true;
  descriptionTouched.value = true;
};

const renderedDescription = computed(() => renderMarkdown(prDescription.value, { interactiveTasks: true }));

const handlePreviewTaskClick = (event: MouseEvent) => {
  if (isAiGenerating.value || phase.value === "creating") return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
  if (!target.classList.contains("markdown-task-checkbox")) return;
  const index = Number(target.getAttribute("data-task-index"));
  if (!Number.isSafeInteger(index) || index < 0) return;
  event.preventDefault();
  const next = toggleMarkdownTaskAt(prDescription.value, index);
  if (next !== prDescription.value) {
    prDescription.value = next;
    descriptionTouched.value = true;
  }
};

const pushBranch = async () => {
  if (isPushingBranch.value || !headRemote.value) return;
  isPushingBranch.value = true;
  reportFeedback("loading", needsPublish.value ? "正在发布分支..." : "正在推送提交...", { retainRemoteProgress: true });
  try {
    const result = needsPublish.value
      ? await store.publishGitBranch(props.projectId, headRemote.value.remoteName, props.repositoryTarget)
      : await store.pushGitRemote(props.projectId, props.repositoryTarget);
    if (!result) {
      reportFeedback("warning", "当前项目不可用，无法推送分支。", { retainRemoteProgress: true });
      return;
    }
    reportFeedback(result.ok ? "success" : "error", result.message, { retainRemoteProgress: true });
    if (result.ok) {
      await store.refreshGitSnapshot(props.projectId, { force: true }, props.repositoryTarget);
      await loadPrContext(requestGeneration);
    }
  } catch (error) {
    reportFeedback("error", error instanceof Error ? error.message : "推送分支失败。", { retainRemoteProgress: true });
  } finally {
    isPushingBranch.value = false;
  }
};

const createPullRequest = async () => {
  if (!canCreate.value || !baseRepo.value || !headRemote.value) return;
  phase.value = "creating";
  reportFeedback("loading", "正在创建 GitHub PR...");
  try {
    const result = await store.createGithubPullRequest({
      owner: baseRepo.value.owner,
      repository: baseRepo.value.repository,
      repositoryId: baseRepo.value.nodeId,
      base: baseBranchName.value,
      headOwner: headRemote.value.owner,
      headRepository: headRemote.value.repository,
      headBranch: currentBranch.value,
      title: prTitle.value.trim(),
      body: prDescription.value,
      draft: isDraft.value,
    });
    if (result.ok) {
      createdPr.value = result.value;
      openPullRequest.value = result.value;
      phase.value = "created";
      reportFeedback("success", `PR #${result.value.number} 创建成功。`);
      return;
    }
    const failureMessage = /no commits between/i.test(result.failure.message)
      ? "GitHub 提示源分支与目标分支没有差异，请确认分支已推送且包含新提交。"
      : result.failure.message;
    bootWarning.value = "";
    reportFeedback("error", failureMessage);
    phase.value = "ready";
  } catch (error) {
    reportFeedback("error", error instanceof Error ? error.message : "创建 GitHub PR 失败。");
    phase.value = "ready";
  }
};

const copyText = async (value: string) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    copiedValue.value = value;
    window.clearTimeout(copiedTimer.value);
    copiedTimer.value = window.setTimeout(() => {
      copiedValue.value = "";
    }, 1200);
  } catch {
    copiedValue.value = "";
  }
};

const openUrl = (url: string) => {
  void store.openExternalUrl(url);
};

watch(
  () => props.open,
  (open) => {
    if (open) void runBoot();
    else requestGeneration += 1;
  },
);

onBeforeUnmount(() => {
  requestGeneration += 1;
  window.clearTimeout(copiedTimer.value);
});
</script>

<template>
  <BaseModal
    :open="open"
    :width="720"
    height="min(44rem,90vh)"
    title="创建 GitHub PR"
    aria-label="创建 GitHub PR"
    body-class="p-0"
    :can-close="phase !== 'creating'"
    @close="emit('close')"
  >
    <template #header>
      <div class="min-w-0">
        <h3 class="text-sm font-bold text-on-surface">创建 GitHub PR</h3>
        <p class="truncate text-[10px] font-medium text-on-surface-variant">
          {{ baseRepoLabel || "解析 GitHub 仓库中..." }}
          <template v-if="currentBranch && baseBranchName"> · {{ currentBranch }} → {{ baseBranchName }}</template>
        </p>
      </div>
    </template>

    <div class="flex h-full min-h-0 flex-col gap-3 p-3">
      <div v-if="bootError" class="ui-banner ui-banner--error px-2 py-1.5 text-[11px] font-bold">
        {{ bootError }}
      </div>

      <template v-if="phase === 'created' && createdPr">
        <div class="ui-banner ui-banner--positive px-2 py-1.5 text-[11px] font-bold">
          PR #{{ createdPr.number }} 创建成功{{ createdPr.isDraft ? "（草稿）" : "" }}
        </div>
        <div class="rounded-lg border border-border-subtle bg-surface-container-low p-3 text-xs">
          <p class="break-all font-semibold text-on-surface">{{ createdPr.title }}</p>
          <p v-if="createdPr.url" class="mt-1 break-all font-mono text-[10px] text-on-surface-variant">{{ createdPr.url }}</p>
        </div>
        <div class="flex justify-end gap-2">
          <button v-if="createdPr.url" type="button" class="ui-btn ui-btn--secondary" @click="copyText(createdPr.url)">
            {{ copiedValue === createdPr.url ? "已复制" : "复制链接" }}
          </button>
          <button v-if="createdPr.url" type="button" class="ui-btn ui-btn--primary" @click="openUrl(createdPr.url)">
            <ExternalLink :size="13" />
            在浏览器打开
          </button>
        </div>
      </template>

      <template v-else-if="phase !== 'boot' || !bootError">
        <div v-if="openPullRequest" class="ui-banner ui-banner--warning flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-bold">
          <span class="min-w-0 truncate">
            当前分支已有 open PR #{{ openPullRequest.number }}：{{ openPullRequest.title }}
          </span>
          <span class="flex shrink-0 items-center gap-1">
            <button
              v-if="openPullRequest.url"
              type="button"
              class="ui-btn ui-btn--secondary ui-btn--sm"
              @click="openUrl(openPullRequest.url)"
            >
              打开
            </button>
            <button
              v-if="openPullRequest.url"
              type="button"
              class="ui-btn ui-btn--ghost ui-btn--sm"
              @click="copyText(openPullRequest.url)"
            >
              {{ copiedValue === openPullRequest.url ? "已复制" : "复制" }}
            </button>
          </span>
        </div>

        <div v-if="needsPublish || needsPush" class="ui-banner ui-banner--warning flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-bold">
          <span class="min-w-0">
            {{
              needsPublish
                ? `当前分支未跟踪 ${headRemote?.remoteName || "远端"}，创建 PR 前需要发布分支。`
                : `本地有 ${upstream?.ahead ?? 0} 个未推送提交，创建 PR 前需要推送。`
            }}
          </span>
          <button
            type="button"
            class="ui-btn ui-btn--secondary ui-btn--sm shrink-0"
            :disabled="isPushingBranch"
            :aria-busy="isPushingBranch"
            @click="pushBranch"
          >
            <CloudUpload :size="12" />
            {{ isPushingBranch ? "推送中" : needsPublish ? "发布分支" : "推送提交" }}
          </button>
        </div>

        <div class="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <label class="block min-w-0 text-[10px] font-bold text-on-surface-variant">
            <span>目标仓库</span>
            <UiSelect
              v-model="baseRemoteSelectModel"
              class="mt-1"
              :options="baseRemoteOptions"
              :disabled="phase === 'boot' || baseRemoteOptions.length <= 1"
              aria-label="PR 目标仓库"
              compact
            />
          </label>
          <label class="block min-w-0 text-[10px] font-bold text-on-surface-variant">
            <span>目标分支</span>
            <UiSelect
              v-model="baseBranchSelectModel"
              class="mt-1"
              :options="baseBranchOptions"
              :disabled="phase === 'boot' || !baseRepo"
              searchable
              aria-label="PR 目标分支"
              compact
            />
          </label>
          <label class="block min-w-0 text-[10px] font-bold text-on-surface-variant">
            <span>PR 模板</span>
            <UiSelect
              v-model="selectedTemplateSelectModel"
              class="mt-1"
              :options="templateOptions.length > 0 ? templateOptions : [{ value: '0', label: '无模板' }]"
              :disabled="phase === 'boot' || templateOptions.length === 0"
              aria-label="PR 描述模板"
              compact
            />
          </label>
        </div>

        <div v-if="prContext" class="shrink-0 truncate text-[10px] text-on-surface-variant">
          {{ prContext.totalCommits }} 个提交（非 merge {{ prContext.nonMergeCommitCount }}）
          <template v-if="prContext.commitsTruncated"> · 已截断 </template>
          <template v-if="prContext.diffTruncated"> · diff 已截断</template>
        </div>
        <div v-else-if="bootWarning" class="ui-banner ui-banner--warning px-2 py-1 text-[10px] font-bold">
          {{ bootWarning }}
        </div>

        <label class="block shrink-0 text-[10px] font-bold text-on-surface-variant">
          <span>标题</span>
          <input
            v-model="prTitle"
            type="text"
            class="ui-field mt-1 w-full"
            placeholder="PR 标题"
            :disabled="phase === 'boot' || phase === 'creating'"
            aria-label="PR 标题"
            @input="titleTouched = true"
          />
        </label>

        <div class="flex min-h-0 flex-1 flex-col">
          <div class="mb-1 flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <span class="text-[10px] font-bold text-on-surface-variant">描述</span>
            </div>
            <div class="flex items-center gap-1.5">
              <div class="ui-segment" role="group" aria-label="描述编辑方式">
                <button
                  type="button"
                  :class="cn('ui-segment-item ui-segment-item--sm', descriptionMode === 'edit' && 'is-active')"
                  :aria-pressed="descriptionMode === 'edit'"
                  @click="descriptionMode = 'edit'"
                >
                  编辑
                </button>
                <button
                  type="button"
                  :class="cn('ui-segment-item ui-segment-item--sm', descriptionMode === 'preview' && 'is-active')"
                  :aria-pressed="descriptionMode === 'preview'"
                  @click="descriptionMode = 'preview'"
                >
                  预览
                </button>
              </div>
              <button
                type="button"
                class="ui-btn ui-btn--ghost ui-btn--sm"
                :disabled="phase === 'boot' || !prContext"
                title="按模板与提交记录重新预填"
                @click="reprefill"
              >
                <RefreshCw :size="12" />
                重新预填
              </button>
              <button
                type="button"
                class="ui-btn ui-btn--secondary ui-btn--sm"
                :disabled="isAiGenerating || phase === 'boot' || !prContext"
                :aria-busy="isAiGenerating"
                @click="generateWithAi"
              >
                <Sparkles :size="12" />
                {{ isAiGenerating ? "生成中" : "AI 生成" }}
              </button>
            </div>
          </div>
          <textarea
            v-if="descriptionMode === 'edit'"
            v-model="prDescription"
            class="ui-field themed-scrollbar min-h-0 w-full flex-1 resize-none font-mono text-[11px] leading-5"
            placeholder="PR 描述（模板 + 提交记录自动预填，可用 AI 生成）"
            :disabled="phase === 'creating' || isAiGenerating"
            :aria-busy="isAiGenerating || undefined"
            aria-label="PR 描述"
            @input="descriptionTouched = true"
          />
          <div
            v-else
            class="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border-subtle bg-surface-container-lowest"
          >
            <div
              v-overlay-scrollbar
              class="themed-scrollbar min-h-0 flex-1 overflow-auto text-[11px] leading-5"
              :aria-busy="isAiGenerating || undefined"
              aria-label="PR 描述预览"
              @click="handlePreviewTaskClick"
            >
              <!-- 字号设在父级：.memo-rendered 的 font-size:inherit 位于 CSS 层级之外，
                   会压过同元素上的 Tailwind 字号工具类。 -->
              <div
                class="memo-rendered memo-rendered--compact px-3 py-2 text-on-surface"
                v-html="renderedDescription"
              ></div>
            </div>
          </div>
          <div v-if="isAiGenerating" class="mt-1 flex shrink-0 items-center justify-between gap-2">
            <span class="min-w-0 truncate text-[10px] font-semibold text-primary">
              AI 生成中，内容实时写入描述区...
            </span>
            <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm shrink-0" @click="stopAiGeneration">
              停止并保留当前内容
            </button>
          </div>
          <div v-else-if="aiVersions.length > 0" class="mt-1 flex shrink-0 flex-wrap items-center gap-1.5">
            <div class="flex h-7 items-center overflow-hidden rounded-md border border-border-subtle bg-surface">
              <span class="flex h-full items-center border-r border-border-subtle px-1.5 text-[10px] font-bold text-on-surface-variant">
                版本 {{ aiActiveVersionIndex + 1 }}/{{ aiVersions.length }}
              </span>
              <button
                type="button"
                class="git-section-action git-section-action--segment"
                title="上一版"
                aria-label="上一版"
                :disabled="aiActiveVersionIndex <= 0"
                @click="selectAiVersion(-1)"
              >
                <ChevronLeft :size="13" />
              </button>
              <button
                type="button"
                class="git-section-action git-section-action--segment"
                title="下一版"
                aria-label="下一版"
                :disabled="aiActiveVersionIndex >= aiVersions.length - 1"
                @click="selectAiVersion(1)"
              >
                <ChevronRight :size="13" />
              </button>
            </div>
            <input
              v-model="aiFollowUp"
              type="text"
              class="ui-field h-7 min-w-40 flex-1 py-0.5 text-[11px]"
              placeholder="修改要求，如：更简洁、补充测试说明（回车发送）"
              :disabled="phase === 'creating'"
              aria-label="AI 生成修改要求"
              @keydown.enter.prevent="submitAiFollowUp"
            />
            <button
              type="button"
              class="ui-btn ui-btn--secondary ui-btn--sm shrink-0"
              :disabled="!aiFollowUp.trim()"
              @click="submitAiFollowUp"
            >
              <CornerDownLeft :size="12" />
              发送
            </button>
            <button
              type="button"
              class="ui-btn ui-btn--ghost ui-btn--sm shrink-0"
              title="基于当前版本重新生成一版"
              @click="regenerateAi"
            >
              <RefreshCw :size="12" />
              重新生成
            </button>
          </div>
          <p v-if="aiState === 'error' && aiMessage" class="mt-1 text-[10px] font-semibold text-status-error">
            {{ aiMessage }}
          </p>
          <p v-else-if="aiMessage" class="mt-1 text-[10px] font-semibold text-on-surface-variant">
            {{ aiMessage }}
          </p>
        </div>

        <div class="flex shrink-0 items-center justify-between gap-2">
          <label class="inline-flex h-8 items-center gap-1.5 text-[11px] font-semibold text-on-surface-variant">
            <input v-model="isDraft" type="checkbox" class="h-4 w-4 accent-primary" :disabled="phase === 'creating'" />
            创建为草稿
          </label>
          <div class="flex items-center gap-2">
            <span v-if="createBlockedReason" class="max-w-64 truncate text-[10px] font-semibold text-on-surface-variant" :title="createBlockedReason">
              {{ createBlockedReason }}
            </span>
            <button type="button" class="ui-btn ui-btn--ghost" :disabled="phase === 'creating'" @click="emit('close')">
              关闭
            </button>
            <button
              type="button"
              class="ui-btn ui-btn--primary"
              :disabled="!canCreate || phase === 'creating'"
              :aria-busy="phase === 'creating'"
              :title="createBlockedReason || '创建 GitHub PR'"
              @click="createPullRequest"
            >
              <GitPullRequest :size="13" />
              {{ phase === "creating" ? "创建中..." : "创建 PR" }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </BaseModal>
</template>
