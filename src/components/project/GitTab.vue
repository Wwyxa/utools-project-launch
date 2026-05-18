<script setup lang="ts">
import { computed } from "vue";
import { GitBranch, RefreshCw, Eye, Minus, PlusCircle, Trash2, Clock3 } from "lucide-vue-next";
import { Project } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();

const files = computed(() => store.stagedFiles[props.project.id] || props.project.git?.files || []);
const commits = computed(() => props.project.git?.commits || []);
const snapshot = computed(() => props.project.git);

const handleRefresh = async () => {
  await store.refreshGitSnapshot(props.project.id);
};

const fileLabel = (status: string) => {
  if (status === "ADDED") return t.value.git.added;
  if (status === "DELETED") return t.value.git.deleted;
  if (status === "RENAMED") return t.value.git.renamed;
  if (status === "UNTRACKED") return t.value.git.untracked;
  return t.value.git.modified;
};
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="bg-surface-container-low border border-border-subtle rounded-xl overflow-hidden shadow-sm">
      <div class="p-4 border-b border-border-subtle flex items-center justify-between gap-4">
        <div class="flex flex-col gap-1 min-w-0">
          <span class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{{ t.git.branch }}</span>
          <div class="flex items-center gap-2 flex-wrap">
            <GitBranch :size="16" class="text-primary" />
            <span
              class="font-mono text-xs font-bold text-on-surface bg-surface border border-border-subtle px-2 py-0.5 rounded shadow-sm"
            >
              {{ snapshot?.branch || "main" }}
            </span>
            <span class="text-xs text-on-surface-variant"
              >{{ t.git.ahead }} {{ snapshot?.ahead || 0 }} · {{ t.git.behind }} {{ snapshot?.behind || 0 }}</span
            >
          </div>
          <div class="text-xs text-on-surface-variant">{{ snapshot?.statusText || t.git.noRepo }}</div>
        </div>
        <div class="flex gap-2 shrink-0">
          <button
            @click="handleRefresh"
            class="h-9 px-4 rounded border border-border-subtle bg-surface text-on-surface hover:bg-surface-variant text-xs font-bold flex items-center gap-2 transition-colors"
          >
            <RefreshCw :size="14" /> {{ t.git.refresh }}
          </button>
        </div>
      </div>

      <div class="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-surface rounded-xl border border-border-subtle p-4">
          <div class="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">{{ t.git.files }}</div>
          <div class="mt-2 text-2xl font-bold text-on-surface">{{ files.length }}</div>
        </div>
        <div class="bg-surface rounded-xl border border-border-subtle p-4">
          <div class="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">{{ t.git.commits }}</div>
          <div class="mt-2 text-2xl font-bold text-on-surface">{{ commits.length }}</div>
        </div>
        <div class="bg-surface rounded-xl border border-border-subtle p-4">
          <div class="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">
            {{ t.git.statusText }}
          </div>
          <div class="mt-2 text-sm text-on-surface-variant">{{ snapshot?.repositoryPath || project.path }}</div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
        <div class="p-4 border-b border-border-subtle flex items-center justify-between">
          <h3 class="text-lg font-bold text-on-surface">{{ t.git.files }}</h3>
          <span
            class="text-[10px] font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full"
          >
            {{ files.length }} {{ t.common.noData }}
          </span>
        </div>

        <div class="space-y-2 p-4 max-h-[420px] overflow-y-auto">
          <div
            v-for="(file, idx) in files"
            :key="`${file.path}-${idx}`"
            class="group flex items-center justify-between p-3 border border-border-subtle rounded-lg hover:bg-surface-container transition-all"
          >
            <div class="flex items-center gap-4 overflow-hidden min-w-0">
              <div
                :class="
                  cn(
                    'w-8 h-8 rounded flex items-center justify-center shrink-0',
                    file.status === 'ADDED'
                      ? 'bg-primary-fixed'
                      : file.status === 'DELETED'
                        ? 'bg-error-container'
                        : 'bg-secondary-fixed',
                  )
                "
              >
                <PlusCircle v-if="file.status === 'ADDED'" :size="14" class="text-primary" />
                <Trash2 v-else-if="file.status === 'DELETED'" :size="14" class="text-error" />
                <Minus v-else :size="14" class="text-secondary" />
              </div>
              <div class="truncate">
                <p
                  :class="
                    cn(
                      'font-mono text-xs font-bold truncate',
                      file.status === 'DELETED' ? 'text-on-surface-variant line-through' : 'text-on-surface',
                    )
                  "
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

            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="p-1.5 text-on-surface-variant hover:bg-surface-container rounded" :title="t.common.edit">
                <Eye :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
        <div class="p-4 border-b border-border-subtle flex items-center justify-between">
          <h3 class="text-lg font-bold text-on-surface">{{ t.git.commits }}</h3>
          <Clock3 :size="16" class="text-on-surface-variant" />
        </div>
        <div class="space-y-2 p-4 max-h-[420px] overflow-y-auto">
          <div
            v-for="commit in commits"
            :key="commit.hash"
            class="p-3 border border-border-subtle rounded-lg bg-surface-container-low"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="font-mono text-xs font-bold text-on-surface">{{ commit.hash }}</div>
              <div class="text-[10px] text-on-surface-variant">{{ commit.date }}</div>
            </div>
            <div class="mt-2 text-sm font-medium text-on-surface">{{ commit.message }}</div>
            <div class="mt-1 text-xs text-on-surface-variant">{{ commit.author }}</div>
          </div>
          <div v-if="commits.length === 0" class="text-sm text-on-surface-variant p-3">{{ t.git.empty }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
