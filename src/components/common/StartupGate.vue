<script setup lang="ts">
import { computed, ref, inject } from "vue";
import type { MigrationSummary } from "../types";
import { STARTUP_PREFLIGHT_KEY } from "../../lib/startupPreflight";
import { getProjectBridge } from "../../lib/projectBridge";

const preflight = inject(STARTUP_PREFLIGHT_KEY);
const bridge = getProjectBridge();

const running = ref(false);
const progress = ref<MigrationSummary | null>(preflight?.migration ?? null);
const errorMessage = ref("");
const blockedMessage = ref("");

const isUpgradeRequired = computed(() => preflight?.status === "upgrade-required");
const isMigrationBlocked = computed(
  () => preflight?.status === "migration-required" || preflight?.status === "migration-incomplete",
);

const headline = computed(() => {
  if (isUpgradeRequired.value) return "需要升级 uTools";
  if (isMigrationBlocked.value) {
    return preflight?.status === "migration-required" ? "需要完成数据迁移" : "数据迁移未完成";
  }
  return "正在启动";
});

const description = computed(() => {
  if (isUpgradeRequired.value) {
    const detected = preflight?.appVersion ? `当前版本：uTools ${preflight.appVersion}。` : "";
    return `本插件依赖 uTools v8 的插件本地数据目录能力。${detected}请先将 uTools 升级到 v8 或更高版本，再打开本插件。迁移前不会读取或修改任何现有数据。`;
  }
  if (isMigrationBlocked.value) {
    return "检测到旧版本存放在同步数据库与本机目录中的数据。迁移会把设备配置、私有项目、服务数据与图标包移动到 uTools v8 的插件本地数据目录；公共项目仍保持跨设备同步。迁移过程会先写入并校验新位置，确认无误后才清理对应同步文档，旧目录会完整保留。";
  }
  return "";
});

const progressPercent = computed(() => {
  const summary = progress.value;
  if (!summary || summary.totalCount === 0) return 0;
  return Math.round(((summary.verifiedCount + summary.failedCount) / summary.totalCount) * 100);
});

const canStartMigration = computed(() => {
  return isMigrationBlocked.value && !running.value && blockedMessage.value !== "active-runs";
});

const startButtonLabel = computed(() => {
  if (progress.value && (progress.value.failedCount > 0 || progress.value.verifiedCount > 0)) {
    return "重试迁移";
  }
  return "开始迁移";
});

const applyProgress = (summary: MigrationSummary | null) => {
  if (summary) progress.value = summary;
};

const startMigration = async () => {
  if (running.value) return;
  running.value = true;
  errorMessage.value = "";
  blockedMessage.value = "";
  try {
    const result = await bridge.runMigration({ onProgress: applyProgress });
    applyProgress(result.ledger);
    if (result.ok) {
      // Reload so the normal App boots against the completed migration ledger.
      window.location.reload();
      return;
    }
    if (result.blocked === "active-runs") {
      blockedMessage.value = "active-runs";
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
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-6">
    <div class="w-full max-w-xl rounded-xl border border-border bg-surface p-6 shadow-sm">
      <div class="mb-4 flex items-center gap-3">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full text-lg"
          :class="isUpgradeRequired ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'"
        >
          {{ isUpgradeRequired ? "!" : "↑" }}
        </div>
        <h1 class="text-lg font-semibold text-foreground">{{ headline }}</h1>
      </div>

      <p class="mb-4 text-sm leading-6 text-muted-foreground">{{ description }}</p>

      <div v-if="isUpgradeRequired" class="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
        <div>当前检测到的 uTools 版本：{{ preflight?.appVersion || "未知" }}</div>
        <div>最低要求：uTools v8（需要 getPluginLocalDataPath / getPluginTempPath 能力）</div>
      </div>

      <template v-if="isMigrationBlocked">
        <div v-if="progress" class="mb-4">
          <div class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>迁移进度：{{ progress.verifiedCount }}/{{ progress.totalCount }} 项已校验</span>
            <span>{{ progressPercent }}%</span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-blue-600 transition-all"
              :style="{ width: `${progressPercent}%` }"
            />
          </div>
          <ul class="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs" v-overlay-scrollbar>
            <li
              v-for="item in progress.items"
              :key="item.id"
              class="flex items-center justify-between gap-2 rounded px-2 py-1"
              :class="{
                'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300': item.status === 'verified',
                'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300': item.status === 'failed',
                'bg-muted text-muted-foreground': item.status === 'skipped',
              }"
            >
              <span class="truncate">{{ item.label }}</span>
              <span class="shrink-0">
                {{
                  item.status === "verified"
                    ? "已完成"
                    : item.status === "failed"
                      ? "失败"
                      : item.status === "skipped"
                        ? "跳过"
                        : "待迁移"
                }}
              </span>
            </li>
          </ul>
          <p v-if="progress.failedItems.length" class="mt-2 text-xs text-red-600 dark:text-red-400">
            {{ progress.failedItems[0].label }}：{{ progress.failedItems[0].error }}
          </p>
        </div>

        <p v-if="errorMessage" class="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {{ errorMessage }}
        </p>

        <div class="flex items-center gap-3">
          <button
            v-if="canStartMigration"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            :disabled="running"
            @click="startMigration"
          >
            {{ running ? "迁移中…" : startButtonLabel }}
          </button>
          <span v-if="running" class="text-xs text-muted-foreground">正在迁移，请不要关闭 uTools…</span>
          <span v-else-if="!canStartMigration && blockedMessage" class="text-xs text-amber-600 dark:text-amber-400">
            {{ errorMessage }}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
