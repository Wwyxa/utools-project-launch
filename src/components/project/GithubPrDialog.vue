<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, CloudUpload, CornerDownLeft, ExternalLink, GitPullRequest, RefreshCw, Save, Sparkles } from "lucide-vue-next";
import type { ProjectGitRepositoryTarget } from "../../types";
import BaseModal from "../common/BaseModal.vue";
import ActionDialog from "../common/ActionDialog.vue";
import UiSelect from "../common/UiSelect.vue";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import type { GithubPrFeedbackListener } from "../../store/helpers/githubPrSession";

type FeedbackState = Parameters<GithubPrFeedbackListener>[0];

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
const session = store.githubPrSession(props.projectId, props.repositoryTarget);
const {
  phase,
  bootError,
  bootWarning,
  baseBranchName,
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
  createBlockedReason,
} = session;
const copiedValue = ref("");
const copiedTimer = ref<number | undefined>();
let unsubscribe: (() => unknown) | undefined;

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

const discardDialogOpen = ref(false);
const isBusy = session.isBusy;
const refreshInformation = () => void session.initialize(true);
const discardDraft = () => {
  discardDialogOpen.value = false;
  session.resetDraft();
  emit("close");
};

watch(
  () => props.open,
  (open) => {
    unsubscribe?.();
    unsubscribe = undefined;
    if (open) {
      unsubscribe = session.subscribe((state, message, options) => emit("feedback", state, message, options));
      void session.initialize();
    } else {
      discardDialogOpen.value = false;
      emit("feedback", "idle", "");
    }
  },
  { immediate: true },
);

watch(session.informationSignature, () => {
  if (props.open) void session.initialize();
});

onBeforeUnmount(() => {
  unsubscribe?.();
  if (props.open) emit("feedback", "idle", "");
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
    :can-close="phase !== 'creating' && !isPushingBranch && !isSavingPullRequest"
    @close="emit('close')"
  >
    <template #header>
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <h3 class="shrink-0 text-sm font-bold text-on-surface">创建 GitHub PR</h3>
            <span class="truncate text-[10px] text-on-surface-variant" title="关闭后保留当前编辑内容">关闭后保留当前编辑内容</span>
          </div>
          <p class="truncate text-[10px] font-medium text-on-surface-variant">
            {{ baseRepoLabel || "解析 GitHub 仓库中..." }}
            <template v-if="currentBranch && baseBranchName"> · {{ currentBranch }} → {{ openPullRequest?.baseBranch || baseBranchName }}</template>
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button v-if="!openPullRequest && phase !== 'created'" type="button" class="ui-btn ui-btn--ghost ui-btn--sm" :disabled="isBusy" @click="discardDialogOpen = true">
            放弃草稿
          </button>
          <button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" :disabled="isBusy" title="刷新仓库、分支和 PR 信息，保留已编辑内容" @click="refreshInformation">
            <RefreshCw :size="12" />
            刷新信息
          </button>
        </div>
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
        <div v-if="openPullRequest" class="ui-banner ui-banner--positive flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-[11px] font-semibold" role="status">
          <span class="min-w-0 flex-1">当前分支已有 PR #{{ openPullRequest.number }}{{ openPullRequest.isDraft ? "（草稿）" : "（待合并）" }}</span>
          <button v-if="openPullRequest.url" type="button" class="ui-btn ui-btn--ghost ui-btn--sm" @click="copyText(openPullRequest.url)">
            {{ copiedValue === openPullRequest.url ? "已复制" : "复制链接" }}
          </button>
          <button v-if="openPullRequest.url" type="button" class="ui-btn ui-btn--secondary ui-btn--sm" @click="openUrl(openPullRequest.url)">
            <ExternalLink :size="12" />
            打开 PR
          </button>
        </div>
        <div v-if="needsPublish || needsPush" class="ui-banner ui-banner--warning flex shrink-0 items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-bold">
          <span class="min-w-0">
            {{
              needsPublish
                ? openPullRequest
                  ? `当前分支未跟踪 ${headRemote?.remoteName || "远端"}，发布分支后将更新 PR #${openPullRequest.number}。`
                  : `当前分支未跟踪 ${headRemote?.remoteName || "远端"}，创建 PR 前需要发布分支。`
                : openPullRequest
                  ? `${upstream?.ahead ?? 0} 个本地提交待推送，推送后将更新 PR #${openPullRequest.number}。`
                  : `本地有 ${upstream?.ahead ?? 0} 个未推送提交，创建 PR 前需要推送。`
            }}
          </span>
          <button
            type="button"
            class="ui-btn ui-btn--secondary ui-btn--sm shrink-0"
            :disabled="isPushingBranch || isSavingPullRequest || (!needsPublish && !needsPush)"
            :aria-busy="isPushingBranch"
            @click="pushBranch"
          >
            <CloudUpload :size="12" />
            {{ isPushingBranch ? "推送中..." : needsPublish ? "发布分支" : openPullRequest ? `推送 ${upstream?.ahead ?? 0} 个提交` : "推送提交" }}
          </button>
        </div>

        <div class="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <label class="block min-w-0 text-[10px] font-bold text-on-surface-variant">
            <span>目标仓库</span>
            <UiSelect
              v-model="baseRemoteSelectModel"
              class="mt-1"
              :options="baseRemoteOptions"
              :disabled="phase === 'boot' || !!openPullRequest || baseRemoteOptions.length <= 1"
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
              :disabled="phase === 'boot' || !!openPullRequest || !baseRepo"
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
              :disabled="phase === 'boot' || !!openPullRequest || templateOptions.length === 0"
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
            :disabled="phase === 'boot' || phase === 'creating' || isSavingPullRequest"
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
                :disabled="phase === 'boot' || !!openPullRequest || !prContext"
                title="按模板与提交记录重新预填"
                @click="reprefill"
              >
                <RefreshCw :size="12" />
                重新预填
              </button>
              <button
                type="button"
                class="ui-btn ui-btn--secondary ui-btn--sm"
                :disabled="isAiGenerating || phase === 'boot' || !!openPullRequest || !prContext"
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
            :disabled="phase === 'creating' || isAiGenerating || isSavingPullRequest"
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

        <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <label class="inline-flex h-8 items-center gap-1.5 text-[11px] font-semibold text-on-surface-variant">
            <input v-model="isDraft" type="checkbox" class="h-4 w-4 accent-primary" :disabled="phase === 'creating' || !!openPullRequest" />
            创建为草稿
          </label>
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <span v-if="createBlockedReason" class="max-w-64 truncate text-[10px] font-semibold text-on-surface-variant" :title="createBlockedReason">
              {{ createBlockedReason }}
            </span>
            <button type="button" class="ui-btn ui-btn--ghost" :disabled="phase === 'creating' || isPushingBranch || isSavingPullRequest" @click="emit('close')">
              关闭
            </button>
            <button
              v-if="openPullRequest"
              type="button"
              class="ui-btn ui-btn--secondary"
              :disabled="!canSavePullRequest"
              :aria-busy="isSavingPullRequest"
              :title="!prTitle.trim() ? '请填写 PR 标题' : hasPullRequestChanges ? '保存标题和描述到当前 PR' : '标题和描述没有修改'"
              @click="savePullRequest"
            >
              <Save :size="13" />
              {{ isSavingPullRequest ? "保存中..." : "保存修改" }}
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
  <ActionDialog
    :open="discardDialogOpen"
    title="放弃 PR 草稿"
    message="将清空标题、描述、分支选择和 AI 生成记录。再次打开时会重新初始化。"
    primary-label="放弃草稿"
    cancel-label="保留草稿"
    :primary-disabled="isBusy"
    @primary="discardDraft"
    @cancel="discardDialogOpen = false"
  />
</template>
