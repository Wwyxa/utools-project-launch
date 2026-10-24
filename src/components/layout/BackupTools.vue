<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ChevronDown, CloudUpload, Download, FolderOpen, RefreshCw, RotateCcw, Trash2 } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import type { BackupEntry, BackupRestoreOptions, BackupSummary } from "../../types";
import ActionDialog from "../common/ActionDialog.vue";
import { showActionStatus } from "../common/actionStatus";
import { waitForVisualFeedback } from "../../lib/visualFeedback";

const store = useStore();
const entries = ref<BackupEntry[]>([]);
const syncState = ref<null | 0 | 1>(null);
const busy = ref(false);
const preview = ref<BackupSummary | null>(null);
const restoreDialogOpen = ref(false);
const restoreConfirm = ref(false);
const pendingDelete = ref<BackupEntry | null>(null);
const cloudListOpen = ref(false);
const options = ref<BackupRestoreOptions>({
  projects: true,
  configuration: true,
  projectMode: "merge",
  pathFrom: "",
  pathTo: "",
});
const buttonClass = "ui-btn ui-btn--secondary";
const iconButtonClass = "ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm";

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sourceLabel(summary: BackupSummary) {
  const platform =
    ({ win32: "Windows", darwin: "macOS", linux: "Linux" } as Record<string, string>)[summary.source.platform] ||
    summary.source.platform;
  return [summary.source.hostname, platform, summary.source.arch].filter(Boolean).join(" · ");
}

function dateLabel(value: string) {
  return new Date(value).toLocaleString(store.locale);
}

async function refreshList() {
  const result = await store.listBackups();
  entries.value = result.entries;
  syncState.value = result.syncState;
}

async function run(operation: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await operation();
  } catch (reason) {
    showActionStatus({ state: "error", message: reason instanceof Error ? reason.message : String(reason) });
  } finally {
    busy.value = false;
  }
}

async function create(destination: "local" | "utools") {
  await run(async () => {
    const result = await store.createBackup({ destination });
    if (!result.canceled) {
      showActionStatus({
        state: "success",
        message: result.path ? "备份已导出到本地。" : "备份已保存到 uTools 数据库。",
      });
    }
    if (destination === "utools") await refreshList();
  });
  if (destination === "utools") {
    try {
      await refreshList();
    } catch {}
  }
}

async function prepare(entry?: BackupEntry) {
  preview.value = null;
  await run(async () => {
    const result = await store.prepareBackup({ source: entry ? "utools" : "local", id: entry?.id });
    preview.value = result.summary || null;
    options.value = { projects: true, configuration: true, projectMode: "merge", pathFrom: "", pathTo: "" };
    restoreDialogOpen.value = Boolean(preview.value);
  });
}

async function restore() {
  if (busy.value) return;
  const restoreOptions = { ...options.value };
  restoreConfirm.value = false;
  restoreDialogOpen.value = false;
  await run(async () => {
    showActionStatus({ state: "loading", message: "正在导入备份..." });
    await waitForVisualFeedback();
    const result = await store.restoreBackup(restoreOptions);
    preview.value = null;
    restoreConfirm.value = false;
    restoreDialogOpen.value = false;
    showActionStatus({ state: "success", message: "备份已导入。恢复前备份已保存在本机。" });
    await store.refreshStorageOverview();
  });
  restoreConfirm.value = false;
}

function requestRestore() {
  if (busy.value) return;
  if (
    (!options.value.projects && !options.value.configuration) ||
    Boolean(options.value.pathFrom) !== Boolean(options.value.pathTo)
  ) {
    return;
  }
  restoreConfirm.value = true;
}

async function remove() {
  const entry = pendingDelete.value;
  if (!entry || busy.value) return;
  pendingDelete.value = null;
  await run(async () => {
    showActionStatus({ state: "loading", message: "正在删除备份..." });
    await waitForVisualFeedback();
    await store.deleteBackup(entry.id);
    pendingDelete.value = null;
    await refreshList();
    showActionStatus({ state: "success", message: "备份已删除。" });
  });
  pendingDelete.value = null;
}

async function download(entry: BackupEntry) {
  await run(async () => {
    const result = await store.exportCloudBackup(entry.id);
    if (!result.canceled) showActionStatus({ state: "success", message: "备份已导出到本地。" });
  });
}

onMounted(() => {
  if (store.supportsBridge) void run(refreshList);
});
</script>

<template>
  <div class="min-w-0 space-y-3">
    <div class="flex flex-wrap gap-2">
      <button type="button" :class="buttonClass" :disabled="busy || !store.supportsBridge" @click="prepare()">
        <FolderOpen :size="14" />从本地备份导入
      </button>
      <button type="button" :class="buttonClass" :disabled="busy || !store.supportsBridge" @click="create('local')">
        <Download :size="14" />导出本地备份
      </button>
    </div>
    <p class="text-xs leading-5 text-on-surface-variant">
      备份包含所有项目、插件配置及其中的环境变量和密钥；项目源文件不包含在内。
    </p>
    <p v-if="!store.supportsBridge" class="text-xs text-on-surface-variant">请在 uTools 中管理备份。</p>

    <div class="flex min-h-9 flex-wrap items-center justify-start gap-3">
      <button type="button" :class="buttonClass" :disabled="busy || !store.supportsBridge" @click="create('utools')">
        <CloudUpload :size="14" />备份到 uTools
      </button>
      <div class="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          class="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-on-surface"
          :aria-expanded="cloudListOpen"
          @click="cloudListOpen = !cloudListOpen"
        >
          <ChevronDown :size="14" :class="cloudListOpen ? 'rotate-180' : ''" />
          <span>当前备份（{{ entries.length }}）</span>
        </button>
        <button
          type="button"
          :class="iconButtonClass"
          :disabled="busy || !store.supportsBridge"
          title="刷新备份列表"
          aria-label="刷新备份列表"
          @click="run(refreshList)"
        >
          <RefreshCw :size="14" />
        </button>
      </div>
    </div>
    <div v-if="cloudListOpen" class="space-y-2">
      <ul v-if="entries.length" class="max-h-80 divide-y divide-border-subtle overflow-y-auto">
        <li
          v-for="entry in entries"
          :key="entry.id"
          class="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2"
        >
          <div class="min-w-0 flex-1 basis-48">
            <div class="flex min-w-0 items-center gap-1.5 text-sm font-medium text-on-surface">
              <span class="break-all">{{ entry.name }}</span>
              <span v-if="!entry.complete" class="shrink-0 text-xs text-status-warning">未完成／同步中</span>
            </div>
            <p class="mt-1 break-words text-xs text-on-surface-variant">{{ sourceLabel(entry) }}</p>
            <p class="mt-0.5 text-xs text-on-surface-variant">
              {{ dateLabel(entry.createdAt) }} · {{ entry.projectCount }} 个项目 · {{ sizeLabel(entry.bytes) }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button type="button" :class="buttonClass" :disabled="busy || !entry.complete" @click="prepare(entry)">
              <RotateCcw :size="13" />导入
            </button>
            <button
              type="button"
              :class="buttonClass"
              :disabled="busy || !entry.complete"
              title="导出到本地"
              aria-label="导出到本地"
              @click="download(entry)"
            >
              <Download :size="14" />
            </button>
            <button
              type="button"
              class="ui-btn ui-btn--danger-ghost ui-btn--icon"
              :disabled="busy || syncState === 1"
              title="删除备份"
              aria-label="删除备份"
              @click="pendingDelete = entry"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </li>
      </ul>
      <p v-else class="py-2 text-xs text-on-surface-variant">暂无 uTools 备份</p>
    </div>
  </div>
  <ActionDialog
    :open="restoreDialogOpen && Boolean(preview)"
    tone="warning"
    icon="archive"
    :width="512"
    title="导入备份"
    :message="preview ? `${sourceLabel(preview)} · ${dateLabel(preview.createdAt)} · ${preview.projectCount} 个项目` : ''"
    primary-label="导入所选数据"
    cancel-label="取消"
    :busy="busy"
    @primary="requestRestore"
    @cancel="restoreDialogOpen = false"
  >
    <fieldset :disabled="busy" class="flex flex-wrap gap-5 text-sm text-on-surface">
      <legend class="mb-2 text-xs font-semibold text-on-surface-variant">导入内容</legend>
      <label class="inline-flex items-center gap-2"
        ><input v-model="options.projects" type="checkbox" class="accent-primary" />所有项目</label
      >
      <label class="inline-flex items-center gap-2"
        ><input v-model="options.configuration" type="checkbox" class="accent-primary" />插件配置</label
      >
    </fieldset>
    <template v-if="options.projects">
      <fieldset :disabled="busy" class="flex flex-wrap gap-4 text-xs text-on-surface-variant">
        <legend class="mb-2 font-semibold">项目恢复方式</legend>
        <label class="inline-flex items-center gap-1.5"
          ><input
            v-model="options.projectMode"
            type="radio"
            value="merge"
            name="backup-project-mode"
            class="accent-primary"
          />合并（同 ID 项目使用备份内容）</label
        >
        <label class="inline-flex items-center gap-1.5"
          ><input
            v-model="options.projectMode"
            type="radio"
            value="replace"
            name="backup-project-mode"
            class="accent-primary"
          />替换所有项目</label
        >
      </fieldset>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="grid min-w-0 gap-1 text-xs text-on-surface-variant"
          >原项目根目录（可选）<input
            v-model="options.pathFrom"
            :disabled="busy"
            class="ui-field"
            placeholder="D:\develop"
        /></label>
        <label class="grid min-w-0 gap-1 text-xs text-on-surface-variant"
          >新项目根目录<input
            v-model="options.pathTo"
            :disabled="busy"
            class="ui-field"
            placeholder="/Users/me/develop"
        /></label>
      </div>
    </template>
    <p class="text-xs text-on-surface-variant">
      导入的自动任务保持暂停；恢复配置时项目启动服务保持关闭。导入前会在本机保存恢复前备份。
    </p>
  </ActionDialog>
  <ActionDialog
    :open="restoreConfirm"
    tone="warning"
    title="确认导入备份"
    :message="
      !options.projects
        ? '备份中的插件配置将写入当前设备。'
        : options.projectMode === 'replace'
          ? '当前所有项目将被备份中的项目替换，公共项目的变更会同步到其他设备。'
          : '同 ID 项目会被备份覆盖，其他项目保留；公共项目的变更会同步到其他设备。'
    "
    :detail="options.configuration ? '插件配置将替换为备份中的配置。' : ''"
    primary-label="确认导入"
    cancel-label="取消"
    :busy="busy"
    @primary="restore"
    @cancel="restoreConfirm = false"
  />
  <ActionDialog
    :open="Boolean(pendingDelete)"
    icon="trash"
    title="删除 uTools 备份"
    :message="`删除“${pendingDelete?.name || ''}”？此删除会同步到其他设备。`"
    detail="不会删除当前已导入的项目或本地备份文件。"
    primary-label="删除备份"
    :busy="busy"
    @primary="remove"
    @cancel="pendingDelete = null"
  />
</template>
