<script setup lang="ts">
import { computed, ref, inject } from "vue";
import { ArrowRight, Check, LoaderCircle, RefreshCw, Square } from "lucide-vue-next";
import type { MigrationServiceStopProgress, MigrationSummary } from "../../types";
import { STARTUP_PREFLIGHT_KEY } from "../../lib/startupPreflight";
import { getProjectBridge } from "../../lib/projectBridge";

const preflight = inject(STARTUP_PREFLIGHT_KEY);
const bridge = getProjectBridge();
const emit = defineEmits<{ (event: "ready"): void }>();
const currentPreflight = ref(preflight);

const running = ref(false);
const stopping = ref(false);
const stopProgress = ref<MigrationServiceStopProgress | null>(null);
const stopFailed = ref(false);
const serviceStopMessage = ref("");
const progress = ref<MigrationSummary | null>(preflight?.migration ?? null);
const errorMessage = ref("");

const isUpgradeRequired = computed(() => currentPreflight.value?.status === "upgrade-required");
const isMigrationBlocked = computed(
  () => currentPreflight.value?.status === "migration-required" || currentPreflight.value?.status === "migration-incomplete",
);
const isReady = computed(
  () => currentPreflight.value?.status === "ready" || currentPreflight.value?.status === "browser-preview",
);
const canEnter = computed(() => isReady.value && !running.value && !stopping.value);
const itemsProcessed = computed(() => Boolean(progress.value && progress.value.pendingCount === 0 && progress.value.failedCount === 0));
const skippedCount = computed(() => progress.value?.items.filter((item) => item.status === "skipped").length ?? 0);
const successfulCount = computed(() => Math.max(0, (progress.value?.verifiedCount ?? 0) - skippedCount.value));
const processedCount = computed(() => (progress.value?.verifiedCount ?? 0) + (progress.value?.failedCount ?? 0));
const stopStatusText = computed(() => {
  const count = stopProgress.value?.activeRunCount ?? 0;
  switch (stopProgress.value?.stage) {
    case "stopping-scripts": return `正在停止运行中的脚本，${count} 个尚未结束。`;
    case "waiting-scripts": return `正在等待脚本退出，${count} 个尚未结束。`;
    case "stopping-service": return "脚本已结束，正在请求服务停止。";
    case "waiting-service": return "正在确认服务进程退出。";
    case "stopped": return "服务已停止。";
    default: return "正在检查旧服务的状态。";
  }
});

const headline = computed(() => {
  if (isUpgradeRequired.value) return "需要升级 uTools";
  if (stopping.value) {
    const stage = stopProgress.value?.stage;
    if (stage === "checking-service" || !stage) return "正在检查服务";
    if (stage === "stopping-scripts" || stage === "waiting-scripts") return "正在停止脚本";
    return "正在停止服务";
  }
  if (stopFailed.value) return "停止服务失败";
  if (isReady.value) return "数据迁移已完成";
  if (running.value) return itemsProcessed.value ? "正在确认迁移结果" : "正在迁移数据";
  if (errorMessage.value) return "迁移需要处理";
  if (isMigrationBlocked.value) {
    return currentPreflight.value?.status === "migration-required" ? "需要完成数据迁移" : "数据迁移未完成";
  }
  return "正在启动";
});

const description = computed(() => {
  if (isUpgradeRequired.value) {
    const detected = currentPreflight.value?.appVersion ? `当前版本：uTools ${currentPreflight.value.appVersion}。` : "";
    return `本插件依赖 uTools v8 的插件本地数据目录能力。${detected}请先将 uTools 升级到 v8 或更高版本，再打开本插件。迁移前不会读取或修改任何现有数据。`;
  }
  if (stopping.value) return stopStatusText.value;
  if (stopFailed.value) return "服务尚未确认停止，请重试停止服务。";
  if (isReady.value) return "迁移结果已保存，现在可以进入插件。";
  if (running.value && itemsProcessed.value) return "各项数据已处理，正在保存并确认整体迁移结果。";
  if (isMigrationBlocked.value) {
    return "检测到旧版本存放在同步数据库与本机目录中的数据。迁移会把设备配置、私有项目、服务数据与图标包移动到 uTools v8 的插件本地数据目录；公共项目仍保持跨设备同步。迁移过程会先写入并校验新位置，确认无误后才清理对应同步文档，旧目录会完整保留。";
  }
  return "";
});

const progressPercent = computed(() => {
  const summary = progress.value;
  if (!summary || summary.totalCount === 0) return isReady.value ? 100 : 0;
  return Math.round((processedCount.value / summary.totalCount) * 100);
});

const canStartMigration = computed(() => {
  return isMigrationBlocked.value && !running.value && !stopping.value;
});

const startButtonLabel = computed(() => {
  if ((!stopFailed.value && errorMessage.value) || (progress.value && (progress.value.failedCount > 0 || progress.value.verifiedCount > 0))) {
    return "重试迁移";
  }
  return "开始迁移";
});

const applyProgress = (summary: MigrationSummary | null) => {
  if (summary) progress.value = summary;
};

const refreshStartupStatus = () => {
  currentPreflight.value = bridge.preflightStartup();
  applyProgress(currentPreflight.value.migration);
  return currentPreflight.value;
};

const enterPlugin = () => {
  if (running.value || stopping.value) return;
  try {
    const latest = refreshStartupStatus();
    stopFailed.value = false;
    if (latest.status === "ready" || latest.status === "browser-preview") {
      emit("ready");
      return;
    }
    errorMessage.value = latest.message || "迁移结果尚未确认，请重试迁移。";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法确认迁移结果，请重试。";
  }
};

const startMigration = async () => {
  if (running.value || stopping.value) return;
  running.value = true;
  errorMessage.value = "";
  stopFailed.value = false;
  serviceStopMessage.value = "";
  try {
    const result = await bridge.runMigration({ onProgress: applyProgress });
    applyProgress(result.ledger);
    if (result.ok) {
      const latest = refreshStartupStatus();
      if (!isReady.value) errorMessage.value = latest.message || "仍有待迁移的数据，请继续迁移。";
      return;
    }
    if (result.blocked === "active-runs") {
      errorMessage.value = result.message || "项目启动服务仍有运行中的任务，请先结束任务。";
      return;
    }
    errorMessage.value = result.message || "迁移失败，旧数据保持完整，可重试。";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "迁移执行失败，旧数据保持完整。";
  } finally {
    running.value = false;
  }
};

const stopService = async () => {
  if (running.value || stopping.value) return;
  stopping.value = true;
  stopProgress.value = null;
  stopFailed.value = false;
  errorMessage.value = "";
  serviceStopMessage.value = "";
  try {
    const result = await bridge.stopMigrationService({
      onProgress: (update) => { stopProgress.value = update; },
    });
    if (!result.ok) {
      stopFailed.value = true;
      errorMessage.value = result.error || "停止服务失败，请重试。";
      return;
    }
    serviceStopMessage.value = "服务已停止，可以继续迁移。";
  } catch (error) {
    stopFailed.value = true;
    errorMessage.value = error instanceof Error ? error.message : "停止服务失败，请重试。";
  } finally {
    stopping.value = false;
  }
};
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-6">
    <div class="w-full max-w-xl rounded-xl border border-border bg-surface p-6 shadow-sm">
      <div class="mb-4 flex items-center gap-3">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full text-lg"
          :class="isUpgradeRequired ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'"
        >
          <Check v-if="isReady" :size="20" />
          <LoaderCircle v-else-if="running || stopping" :size="20" class="animate-spin" />
          <span v-else>{{ isUpgradeRequired ? "!" : "↑" }}</span>
        </div>
        <h1 class="text-lg font-semibold text-foreground">{{ headline }}</h1>
      </div>

      <p class="mb-4 text-sm leading-6 text-muted-foreground">{{ description }}</p>

      <div v-if="isUpgradeRequired" class="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
        <div>当前检测到的 uTools 版本：{{ currentPreflight?.appVersion || "未知" }}</div>
        <div>最低要求：uTools v8（需要 getPluginLocalDataPath / getPluginTempPath 能力）</div>
      </div>

      <template v-if="isMigrationBlocked || isReady">
        <div v-if="progress" class="mb-4">
          <div class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>处理进度：{{ processedCount }}/{{ progress.totalCount }} 项</span>
            <span>{{ progressPercent }}%</span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-blue-600 transition-all"
              :style="{ width: `${progressPercent}%` }"
            />
          </div>
          <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" role="status">
            <span>成功 {{ successfulCount }} 项</span>
            <span>跳过 {{ skippedCount }} 项</span>
            <span :class="{ 'text-destructive': progress.failedCount > 0 }">失败 {{ progress.failedCount }} 项</span>
          </div>
          <ul class="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs" v-overlay-scrollbar>
            <li
              v-for="item in progress.items"
              :key="item.id"
              class="rounded px-2 py-1"
              :class="{
                'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300': item.status === 'verified',
                'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300': item.status === 'failed',
                'bg-muted text-muted-foreground': item.status === 'skipped',
              }"
            >
              <div class="flex items-center justify-between gap-2">
              <span class="min-w-0 break-all">{{ item.label }}</span>
              <span class="shrink-0">
                {{
                  item.status === "verified"
                    ? "已完成"
                    : item.status === "failed"
                      ? "失败"
                      : item.status === "skipped"
                        ? "跳过"
                        : item.status === "copied"
                          ? "已复制，待确认"
                          : "待迁移"
                }}
              </span>
              </div>
              <details v-if="item.error" class="mt-1">
                <summary class="cursor-pointer py-1">{{ item.status === "skipped" ? "查看跳过原因" : "查看失败原因" }}</summary>
                <p class="whitespace-pre-wrap break-all py-1 leading-5">{{ item.error }}</p>
              </details>
            </li>
          </ul>
          <p v-if="progress.failedItems.length" class="mt-2 text-xs text-red-600 dark:text-red-400">
            {{ progress.failedCount }} 项失败，可展开对应项查看原因后重试。
          </p>
        </div>

        <p v-if="errorMessage" class="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {{ errorMessage }}
        </p>

        <div class="flex flex-wrap items-center gap-3">
          <button
            v-if="isReady"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            :disabled="!canEnter"
            @click="enterPlugin"
          >
            <ArrowRight :size="14" />
            进入插件
          </button>
          <button
            v-else
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
            :class="stopFailed ? 'border border-border bg-transparent text-foreground' : 'bg-blue-600 text-white hover:bg-blue-700'"
            :disabled="!canStartMigration"
            @click="startMigration"
          >
            <LoaderCircle v-if="running" :size="14" class="animate-spin" />
            <RefreshCw v-else :size="14" />
            {{ running ? "迁移中…" : startButtonLabel }}
          </button>
          <button
            v-if="!isReady"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
            :class="stopFailed ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-border bg-transparent text-foreground'"
            :disabled="running || stopping"
            title="先停止运行中的脚本，再停止旧服务"
            @click="stopService"
          >
            <LoaderCircle v-if="stopping" :size="14" class="animate-spin" />
            <Square v-else :size="14" />
            {{ stopping ? "正在停止…" : stopFailed ? "重试停止服务" : "停止服务" }}
          </button>
          <button
            v-if="!isReady && itemsProcessed"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground disabled:opacity-60"
            :disabled="running || stopping"
            @click="enterPlugin"
          >
            <RefreshCw :size="14" />
            重新检查结果
          </button>
          <span v-if="serviceStopMessage" role="status" class="text-xs text-muted-foreground">
            {{ serviceStopMessage }}
          </span>
          <span v-if="running" class="text-xs text-muted-foreground">正在迁移，请不要关闭 uTools…</span>
          <span v-if="stopping" role="status" class="text-xs text-muted-foreground">
            {{ stopStatusText }}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
