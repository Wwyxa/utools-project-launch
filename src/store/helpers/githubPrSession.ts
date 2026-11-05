import { computed, markRaw, ref } from "vue";
import type { GithubPrContext, GithubPullRequestSummary, GithubRepositoryMetadata, ProjectGitRepositoryTarget } from "../../types";
import { AI_PR_DESCRIPTION_MODE_ID, DEFAULT_AI_PR_DESCRIPTION_PROMPT } from "../../types";
import { appendAiStreamChunk, createAiReasoningStreamState } from "../../lib/aiReasoning";
import { renderMarkdown } from "../../lib/markdown";
import { toggleMarkdownTaskAt } from "../../lib/markdownTasks";
import { orderGithubBaseRemotes, resolveDefaultGithubHeadRemote, type GithubRemoteRepository } from "../../lib/githubRepository";
import { composeGithubPrAiPrompt, composeGithubPrPrefill, githubPrTemplateName, splitGithubPrAiContent } from "../../lib/githubPrPrefill";
import type { UiSelectOption } from "../../components/common/UiSelect.vue";
import type { AppStore } from "../appStoreShape";
import { gitRefMutationVersion } from "./gitHelpers";

type DialogPhase = "boot" | "ready" | "creating" | "created";
type FeedbackState = "idle" | "loading" | "success" | "warning" | "error";

export type GithubPrFeedbackListener = (state: FeedbackState, message: string, options?: { retainRemoteProgress?: boolean }) => void;

export function createGithubPrSession(store: AppStore, projectId: string, repositoryTarget: ProjectGitRepositoryTarget, branch: string) {
  const listeners = new Set<GithubPrFeedbackListener>();
  let feedback: { state: FeedbackState; message: string; options?: { retainRemoteProgress?: boolean } } | null = null;

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
  const isPushingBranch = ref(false);
  const isSavingPullRequest = ref(false);
  let requestGeneration = 0;
  let initialized = false;
  let initialization: Promise<void> | null = null;
  let loadedContextSignature = "";
  let loadedRepositorySignature = "";
  let loadedToken = "";
  let disposed = false;

  const snapshot = computed(() => store.gitSnapshotForRepository(projectId, repositoryTarget));
  const repositorySignature = computed(() => JSON.stringify([
    snapshot.value?.remotes,
    store.githubAuthStatus?.source,
    store.githubAuthStatus?.login,
  ]));
  const contextSignature = computed(() => JSON.stringify([
    snapshot.value?.headHash,
    snapshot.value?.remoteBranches,
    snapshot.value?.upstream,
    baseRemoteName.value,
    baseBranchName.value,
    gitRefMutationVersion(projectId),
  ]));
  const informationSignature = computed(() => JSON.stringify([
    repositorySignature.value,
    contextSignature.value,
    store.githubAuthPreferences.personalAccessToken,
  ]));
  const isBusy = computed(() => phase.value === "boot" || phase.value === "creating" || isPushingBranch.value || isSavingPullRequest.value || aiState.value === "loading");
  const currentBranch = computed(() => branch);
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
    if (bootError.value || contextError.value) return bootError.value || contextError.value;
    if (needsPublish.value) return `分支尚未发布到 ${headRemote.value?.remoteName || "远端"}，请先推送。`;
    if (needsPush.value) return "本地还有未推送的提交，请先推送。";
    if (openPullRequest.value) return `当前分支已有 PR #${openPullRequest.value.number}。`;
    if (prContext.value && !hasCommitsAgainstBase.value) return "源分支相对目标分支没有新的提交。";
    if (!prTitle.value.trim()) return "请填写 PR 标题。";
    return "";
  });
  const canCreate = computed(() => phase.value === "ready" && !isBusy.value && !createBlockedReason.value);
  const hasPullRequestChanges = computed(() =>
    Boolean(openPullRequest.value && (
      prTitle.value.trim() !== openPullRequest.value.title ||
      prDescription.value !== (openPullRequest.value.body || "")
    )),
  );
  const canSavePullRequest = computed(() =>
    phase.value === "ready" && !bootError.value && Boolean(prTitle.value.trim()) && hasPullRequestChanges.value && !isSavingPullRequest.value && !isPushingBranch.value && !isAiGenerating.value,
  );

  const reportFeedback = (
    state: FeedbackState,
    message: string,
    options?: { retainRemoteProgress?: boolean },
  ) => {
    if (disposed) return;
    feedback = { state, message, options };
    for (const listener of listeners) listener(state, message, options);
  };

  /** 弹窗引导各阶段的浮层提示；idle 用于收起。 */
  const bootStep = (message: string) => reportFeedback("loading", message);
  const finishBootSteps = (generation: number) => {
    if (generation === requestGeneration) reportFeedback("idle", "");
  };

  const applyPrefill = () => {
    if (openPullRequest.value) {
      if (!titleTouched.value) prTitle.value = openPullRequest.value.title;
      if (!descriptionTouched.value) prDescription.value = openPullRequest.value.body || "";
      if (!initialized) isDraft.value = openPullRequest.value.isDraft;
      return;
    }
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
      const result = await store.fetchGitRemoteByName(projectId, baseRemoteName.value, repositoryTarget, {
        quiet: true,
      });
      if (result && !result.ok) bootWarning.value = result.message;
    } catch (error) {
      bootWarning.value = error instanceof Error ? error.message : "获取远端分支失败，使用已有分支信息。";
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
    if (baseRepo.value && (
      baseRepo.value.owner.toLowerCase() !== metadata.owner.toLowerCase()
      || baseRepo.value.repository.toLowerCase() !== metadata.repository.toLowerCase()
    )) {
      baseBranchName.value = "";
      templates.value = [];
      selectedTemplateIndex.value = 0;
      openPullRequest.value = null;
      prContext.value = null;
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
      else {
        bootWarning.value = fallback.failure.message;
        return;
      }
    }
    if (!templatesResult.ok) {
      bootWarning.value = templatesResult.failure.message;
      return;
    }
    const previousTemplate = selectedTemplate.value;
    templates.value = bodies;
    selectedTemplateIndex.value = Math.max(0, bodies.indexOf(previousTemplate));
  };

  const loadOpenPullRequest = async (generation: number) => {
    const head = headRemote.value;
    const base = baseRepo.value;
    const branch = currentBranch.value;
    if (!head || !base || !branch) return;
    const result = await store.readGithubOpenPullRequest(base.owner, base.repository, head.owner, branch);
    if (generation !== requestGeneration) return;
    if (!result.ok) {
      bootWarning.value = result.failure.message;
      return;
    }
    const hadPullRequest = Boolean(openPullRequest.value);
    openPullRequest.value = result.value;
    if (openPullRequest.value) {
      baseBranchName.value = openPullRequest.value.baseBranch || baseBranchName.value;
      if (!hadPullRequest && !titleTouched.value && !descriptionTouched.value) descriptionMode.value = "preview";
      applyPrefill();
    }
  };

  const loadPrContext = async (generation: number) => {
    const branch = currentBranch.value;
    const base = baseBranchName.value;
    if (!branch || !base || !baseRemoteName.value) return;
    const signature = contextSignature.value;
    const result = await store.readGithubPrContext(projectId, repositoryTarget, {
      baseRemote: baseRemoteName.value,
      baseBranch: base,
      headBranch: branch,
    });
    if (generation !== requestGeneration || signature !== contextSignature.value) return;
    loadedContextSignature = signature;
    if (!result) {
      contextError.value = "当前项目不可用，无法读取 PR 上下文。";
      return;
    }
    if (result.ok) {
      prContext.value = result.value;
      contextError.value = "";
    } else {
      contextError.value = result.failure.message;
    }
    applyPrefill();
  };

  const runBoot = async () => {
    const generation = ++requestGeneration;
    const startingRepositorySignature = repositorySignature.value;
    const startingToken = store.githubAuthPreferences.personalAccessToken;
    phase.value = "boot";
    bootError.value = "";
    bootWarning.value = "";
    contextError.value = "";
    try {
      if (!snapshot.value?.repositoryPath || !branch) {
        bootError.value = "Git 快照或当前分支未就绪，请稍后重试。";
        return;
      }
      const headCandidate = resolveDefaultGithubHeadRemote(snapshot.value.remotes || [], upstream.value);
      const baseCandidate = githubBaseRemotes.value.find((remote) => remote.remoteName === baseRemoteName.value)
        || githubBaseRemotes.value[0];
      if (!headCandidate || !baseCandidate) {
        bootError.value = "当前仓库没有配置 GitHub 远端，无法创建 PR。";
        return;
      }
      headRemote.value = headCandidate;
      if (baseRemoteName.value !== baseCandidate.remoteName) {
        baseRemoteName.value = baseCandidate.remoteName;
        baseBranchName.value = "";
      }
      bootStep("正在刷新远端分支...");
      await loadRemoteBranches();
      if (generation !== requestGeneration || snapshot.value?.branch !== branch) return;
      bootStep("正在获取仓库信息...");
      await loadBaseRepoData(generation);
      if (generation !== requestGeneration || bootError.value) return;
      bootStep("正在读取提交范围与已有 PR...");
      await loadOpenPullRequest(generation);
      if (generation !== requestGeneration) return;
      await loadPrContext(generation);
      if (generation !== requestGeneration) return;
      initialized = true;
      loadedRepositorySignature = startingRepositorySignature;
      loadedToken = startingToken;
      if (contextError.value) bootWarning.value = contextError.value;
    } catch (error) {
      if (generation !== requestGeneration) return;
      bootError.value = error instanceof Error ? error.message : "初始化 GitHub PR 信息失败。";
    } finally {
      if (generation === requestGeneration) phase.value = "ready";
      finishBootSteps(generation);
    }
  };

  const initialize = (force = false): Promise<void> => {
    if (disposed || snapshot.value?.branch !== branch) return Promise.resolve();
    if (initialization) return initialization;
    if (phase.value === "creating" || isPushingBranch.value || isSavingPullRequest.value || isAiGenerating.value) return Promise.resolve();
    if (phase.value === "created") {
      phase.value = "ready";
      createdPr.value = null;
      titleTouched.value = false;
      descriptionTouched.value = false;
      descriptionMode.value = "preview";
      applyPrefill();
    }
    const reloadRepository = force || !initialized || Boolean(bootError.value) || loadedRepositorySignature !== repositorySignature.value
      || loadedToken !== store.githubAuthPreferences.personalAccessToken;
    if (!reloadRepository && !contextError.value && loadedContextSignature === contextSignature.value) return Promise.resolve();
    const refreshContext = async () => {
      phase.value = "boot";
      const generation = ++requestGeneration;
      bootStep("正在更新提交范围...");
      try {
        await loadPrContext(generation);
        if (generation === requestGeneration) bootWarning.value = contextError.value;
      } finally {
        if (generation === requestGeneration) phase.value = "ready";
        finishBootSteps(generation);
      }
    };
    initialization = (reloadRepository ? runBoot() : refreshContext())
      .catch((error: unknown) => {
        contextError.value = error instanceof Error ? error.message : "刷新 PR 信息失败。";
        bootWarning.value = contextError.value;
      })
      .finally(() => {
        initialization = null;
        if (initialized && !bootError.value && !contextError.value && (
          loadedContextSignature !== contextSignature.value || loadedRepositorySignature !== repositorySignature.value
          || loadedToken !== store.githubAuthPreferences.personalAccessToken
        )) void initialize();
      });
    return initialization;
  };

  const resetDraft = () => {
    if (isBusy.value) return;
    requestGeneration += 1;
    initialized = false;
    loadedContextSignature = "";
    loadedRepositorySignature = "";
    bootError.value = "";
    bootWarning.value = "";
    baseRemoteName.value = "";
    baseBranchName.value = "";
    baseRepo.value = null;
    headRemote.value = null;
    templates.value = [];
    selectedTemplateIndex.value = 0;
    prContext.value = null;
    contextError.value = "";
    openPullRequest.value = null;
    prTitle.value = "";
    prDescription.value = "";
    titleTouched.value = false;
    descriptionTouched.value = false;
    isDraft.value = false;
    descriptionMode.value = "edit";
    aiState.value = "idle";
    aiMessage.value = "";
    aiResult.value = createAiReasoningStreamState();
    aiVersions.value = [];
    aiActiveVersionIndex.value = -1;
    aiFollowUp.value = "";
    aiAbortRequested.value = false;
    createdPr.value = null;
    feedback = null;
  };

  const changeBaseRemote = async (remoteName: string) => {
    if (remoteName === baseRemoteName.value || isBusy.value) return;
    baseRemoteName.value = remoteName;
    baseRepo.value = null;
    baseBranchName.value = "";
    templates.value = [];
    openPullRequest.value = null;
    prContext.value = null;
    await initialize(true);
  };

  const changeBaseBranch = async (branch: string) => {
    if (branch === baseBranchName.value || isBusy.value) return;
    baseBranchName.value = branch;
    prContext.value = null;
    contextError.value = "";
    await initialize();
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
    await store.analyzeGitWithAiStream(projectId, prompt, {
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
    void initialize();
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

  const renderedDescription = computed(() => renderMarkdown(prDescription.value, { interactiveTasks: !isSavingPullRequest.value }));

  const handlePreviewTaskClick = (event: MouseEvent) => {
    if (isSavingPullRequest.value || isAiGenerating.value || phase.value === "creating") return;
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

  const savePullRequest = async () => {
    const pullRequest = openPullRequest.value;
    const base = baseRepo.value;
    if (!canSavePullRequest.value || !pullRequest || !base) return;
    const generation = requestGeneration;
    const title = prTitle.value.trim();
    const body = prDescription.value;
    isSavingPullRequest.value = true;
    reportFeedback("loading", `正在保存 PR #${pullRequest.number} 修改...`);
    try {
      const result = await store.updateGithubPullRequest({
        owner: base.owner,
        repository: base.repository,
        number: pullRequest.number,
        title,
        body,
      });
      if (generation !== requestGeneration) return;
      if (result.ok) {
        openPullRequest.value = result.value;
        prTitle.value = result.value.title;
        prDescription.value = result.value.body ?? body;
        titleTouched.value = false;
        descriptionTouched.value = false;
        reportFeedback("success", `PR #${pullRequest.number} 修改已保存。`);
      } else {
        reportFeedback("error", result.failure.message);
      }
    } catch (error) {
      if (generation !== requestGeneration) return;
      reportFeedback("error", error instanceof Error ? error.message : "保存 PR 修改失败。");
    } finally {
      if (generation === requestGeneration) isSavingPullRequest.value = false;
      void initialize();
    }
  };

  const pushBranch = async () => {
    if (isPushingBranch.value || isSavingPullRequest.value || !headRemote.value) return;
    isPushingBranch.value = true;
    reportFeedback("loading", needsPublish.value ? "正在发布分支..." : "正在推送提交...", { retainRemoteProgress: true });
    try {
      const result = needsPublish.value
        ? await store.publishGitBranch(projectId, headRemote.value.remoteName, repositoryTarget)
        : await store.pushGitRemote(projectId, repositoryTarget);
      if (!result) {
        reportFeedback("warning", "当前项目不可用，无法推送分支。", { retainRemoteProgress: true });
        return;
      }
      if (result.ok) {
        await store.refreshGitSnapshot(projectId, { force: true }, repositoryTarget);
        if (!openPullRequest.value) await loadPrContext(requestGeneration);
      }
      const message = result.ok && openPullRequest.value
        ? `提交已推送到源分支，PR #${openPullRequest.value.number} 已更新。`
        : result.message;
      reportFeedback(result.ok ? "success" : "error", message, { retainRemoteProgress: true });
    } catch (error) {
      reportFeedback("error", error instanceof Error ? error.message : "推送分支失败。", { retainRemoteProgress: true });
    } finally {
      isPushingBranch.value = false;
      void initialize();
    }
  };

  const createPullRequest = async () => {
    if (!canCreate.value || !baseRepo.value || !headRemote.value) return;
    const generation = requestGeneration;
    const body = prDescription.value;
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
        body,
        draft: isDraft.value,
      });
      if (generation !== requestGeneration) return;
      if (result.ok) {
        // 创建接口未返回正文，已有 PR 模式沿用本次成功提交的正文。
        createdPr.value = { ...result.value, body };
        openPullRequest.value = createdPr.value;
        aiVersions.value = [];
        aiActiveVersionIndex.value = -1;
        aiFollowUp.value = "";
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
      if (generation !== requestGeneration) return;
      reportFeedback("error", error instanceof Error ? error.message : "创建 GitHub PR 失败。");
      phase.value = "ready";
    }
  };


  return markRaw({
    phase,
    bootError,
    bootWarning,
    baseRemoteName,
    baseBranchName,
    selectedTemplateIndex,
    contextError,
    openPullRequest,
    prTitle,
    prDescription,
    isDraft,
    aiState,
    aiMessage,
    aiVersions,
    aiActiveVersionIndex,
    aiFollowUp,
    descriptionMode,
    createdPr,
    isPushingBranch,
    isSavingPullRequest,
    currentBranch,
    baseRepoLabel,
    baseRemoteSelectModel,
    baseBranchSelectModel,
    selectedTemplateSelectModel,
    needsPublish,
    needsPush,
    isAiGenerating,
    canCreate,
    hasPullRequestChanges,
    canSavePullRequest,
    changeBaseRemote,
    changeBaseBranch,
    reprefill,
    generateWithAi,
    submitAiFollowUp,
    regenerateAi,
    stopAiGeneration,
    selectAiVersion,
    renderedDescription,
    handlePreviewTaskClick,
    savePullRequest,
    pushBranch,
    createPullRequest,
    baseRemoteOptions,
    baseBranchOptions,
    templateOptions,
    headRemote,
    upstream,
    baseRepo,
    prContext,
    titleTouched,
    descriptionTouched,
    aiResult,
    createBlockedReason,
    projectId,
    initialize,
    resetDraft,
    informationSignature,
    isBusy,
    subscribe(listener: GithubPrFeedbackListener) {
      listeners.add(listener);
      if (feedback?.state === "loading") listener(feedback.state, feedback.message, feedback.options);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      requestGeneration += 1;
      aiAbortRequested.value = true;
      listeners.clear();
    },
  });
}

export type GithubPrSession = ReturnType<typeof createGithubPrSession>;
