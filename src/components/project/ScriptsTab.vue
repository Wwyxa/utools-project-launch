<script setup lang="ts">
import { computed } from "vue";
import { Terminal as TerminalIcon, Play, Square, Settings, RefreshCcw, FolderOpen, AlertCircle } from "lucide-vue-next";
import { Project } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();

const groups = computed(() => {
  return [{ group: "commands", scripts: props.project.scripts }];
});
const isUnavailable = computed(() => props.project.pathExists === false);

const handleRefresh = async () => {
  if (isUnavailable.value) {
    return;
  }
  await store.refreshProjectScripts(props.project.id);
};

const handleStart = async (scriptId: string) => {
  if (isUnavailable.value) {
    return;
  }
  await store.launchScript(props.project.id, scriptId);
};

const handleStop = async (scriptId: string) => {
  if (isUnavailable.value) {
    return;
  }
  await store.stopScript(props.project.id, scriptId);
};

const handleOpenFolder = async () => {
  if (isUnavailable.value) {
    return;
  }
  await store.openProjectFolder(props.project.id);
};
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div class="lg:col-span-2 space-y-6">
      <div
        class="bg-surface border border-border-subtle rounded-xl p-4 flex justify-between items-center shadow-sm gap-4"
      >
        <div class="min-w-0">
          <div class="text-lg font-bold text-on-surface">{{ t.scripts.title }}</div>
          <div class="text-xs text-on-surface-variant mt-1">{{ t.projectDetails.manualScriptsHint }}</div>
        </div>
        <div class="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <button
            @click="handleRefresh"
            :disabled="isUnavailable"
            class="h-9 px-4 rounded border border-border-subtle bg-surface text-on-surface hover:bg-surface-variant text-xs font-bold flex items-center gap-2 transition-colors"
          >
            <RefreshCcw :size="14" /> {{ t.scripts.refreshScripts }}
          </button>
          <button
            @click="handleOpenFolder"
            :disabled="isUnavailable"
            class="h-9 px-4 rounded border border-border-subtle bg-surface text-on-surface hover:bg-surface-variant text-xs font-bold flex items-center gap-2 transition-colors"
          >
            <FolderOpen :size="14" /> {{ t.common.openFolder }}
          </button>
        </div>
      </div>

      <div
        v-if="groups.length === 0"
        class="border border-dashed border-border-subtle rounded-xl p-8 text-sm text-on-surface-variant bg-surface"
      >
        {{ t.projectDetails.noScripts }}
      </div>

      <div
        v-for="group in groups"
        :key="group.group"
        class="bg-surface border border-border-subtle rounded-xl overflow-hidden group/card shadow-sm"
      >
        <div class="bg-surface-container-low p-4 border-b border-border-subtle flex justify-between items-center">
          <div class="flex items-center gap-2 min-w-0">
            <TerminalIcon :size="18" class="text-on-surface-variant" />
            <h3 class="font-bold text-on-surface">{{ t.scripts.manual }}</h3>
          </div>
          <span
            class="px-2 py-0.5 rounded-full bg-status-running/10 text-status-running text-[10px] font-bold uppercase tracking-wider"
          >
            {{
              group.scripts.filter((script) => script.status === "RUNNING").length ? t.scripts.running : t.scripts.ready
            }}
          </span>
        </div>

        <div class="p-4 space-y-3">
          <div class="flex items-center justify-between text-on-surface-variant text-xs">
            <div class="flex items-center gap-2 font-bold uppercase tracking-wider">
              <TerminalIcon :size="14" />
              {{
                group.group === "main" && project.kind === "node" ? t.projectDetails.packageScripts : t.scripts.manual
              }}
            </div>
            <span class="opacity-60">{{
              project.kind === "node" ? t.projectDetails.packageScriptsHint : t.projectDetails.manualScriptsHint
            }}</span>
          </div>

          <div class="space-y-2">
            <div
              v-for="script in group.scripts"
              :key="script.id"
              class="flex items-start justify-between gap-3 p-3 bg-surface-container-low rounded border border-border-subtle hover:bg-surface-container hover:border-primary/30 transition-colors"
            >
              <div class="flex items-start gap-3 min-w-0">
                <div class="font-mono text-xs font-bold text-on-surface w-20 shrink-0 truncate">{{ script.name }}</div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <div
                      :class="
                        cn(
                          'px-2 py-0.5 rounded-full text-[9px] font-bold border',
                          script.status === 'RUNNING'
                            ? 'bg-status-running/10 text-status-running border-status-running/20'
                            : script.status === 'ERROR'
                              ? 'bg-status-error/10 text-status-error border-status-error/20'
                              : 'bg-status-stopped/10 text-status-stopped border-status-stopped/20',
                        )
                      "
                    >
                      {{ script.status }}
                    </div>
                    <span class="text-[10px] text-on-surface-variant">{{ script.note || script.source }}</span>
                  </div>
                  <div class="mt-2 font-mono text-xs text-on-surface-variant break-all">{{ script.command }}</div>
                  <div class="mt-1 text-[10px] text-on-surface-variant">
                    {{ t.scripts.cwd }}: {{ script.cwd || "." }}
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button
                  class="p-1.5 text-on-surface-variant hover:text-primary transition-colors"
                  :title="t.common.edit"
                >
                  <Settings :size="16" />
                </button>
                <button
                  v-if="script.status === 'RUNNING'"
                  @click="handleStop(script.id)"
                  :disabled="isUnavailable"
                  class="bg-status-error text-white text-xs font-bold py-1.5 px-3 rounded flex items-center gap-1.5 hover:bg-opacity-90"
                >
                  <Square :size="12" fill="currentColor" /> {{ t.scripts.stopScript }}
                </button>
                <button
                  v-else
                  @click="handleStart(script.id)"
                  :disabled="isUnavailable || !script.command.trim()"
                  class="bg-primary text-on-primary text-xs font-bold py-1.5 px-3 rounded flex items-center gap-1.5 hover:bg-opacity-90"
                >
                  <Play :size="12" fill="currentColor" /> {{ t.scripts.startScript }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="space-y-6">
      <div class="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
        <div class="bg-surface-container-low p-4 border-b border-border-subtle flex justify-between items-center">
          <h3 class="font-bold text-on-surface">{{ t.common.status }}</h3>
          <button class="text-on-surface-variant hover:text-primary transition-colors">
            <AlertCircle :size="18" />
          </button>
        </div>
        <div class="divide-y divide-border-subtle">
          <div
            v-for="(value, key) in project.env"
            :key="key"
            class="p-3 hover:bg-surface-container transition-colors group"
          >
            <div class="flex justify-between items-start mb-1">
              <span class="font-mono text-xs font-bold text-secondary">{{ key }}</span>
              <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="p-1 text-on-surface-variant hover:text-primary">
                  <Settings :size="12" />
                </button>
              </div>
            </div>
            <div class="font-mono text-xs text-on-surface-variant bg-surface-container-low p-2 rounded truncate">
              {{ value }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
