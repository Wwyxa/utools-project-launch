<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { ArrowDownToLine, ArrowUpToLine, GitBranch, RefreshCw, Minus, PlusCircle, Trash2 } from "lucide-vue-next";
import { Project } from "../../types";
import { cn, scrollToBoundary, transferWheelAtScrollBoundary } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();
const filesScrollRef = ref<HTMLDivElement | null>(null);
const graphScrollRef = ref<HTMLDivElement | null>(null);

const files = computed(() => store.stagedFiles[props.project.id] || props.project.git?.files || []);
const commits = computed(() => props.project.git?.commits || []);
const snapshot = computed(() => props.project.git);
const repositoryPath = computed(() => snapshot.value?.repositoryPath || props.project.path);

const handleRefresh = async () => {
  await store.refreshGitSnapshot(props.project.id);
};

const scrollGitPanel = async (target: "files" | "graph", boundary: "top" | "bottom") => {
  await nextTick();
  scrollToBoundary(target === "files" ? filesScrollRef.value : graphScrollRef.value, boundary);
};

const handlePanelWheel = (event: WheelEvent, target: "files" | "graph") => {
  transferWheelAtScrollBoundary(event, target === "files" ? filesScrollRef.value : graphScrollRef.value);
};

const refsForCommit = (refs?: string) =>
  (refs || "")
    .split(",")
    .map((refName) => refName.trim())
    .filter(Boolean);

const refClass = (refName: string) =>
  cn(
    "max-w-40 truncate rounded px-1.5 py-0.5 text-[9px] font-bold",
    refName.startsWith("tag:")
      ? "bg-secondary-fixed text-secondary"
      : refName.includes("HEAD")
        ? "bg-primary text-on-primary"
        : "bg-status-running/10 text-status-running",
  );

const fileLabel = (status: string) => {
  if (status === "ADDED") return t.value.git.added;
  if (status === "DELETED") return t.value.git.deleted;
  if (status === "RENAMED") return t.value.git.renamed;
  if (status === "UNTRACKED") return t.value.git.untracked;
  return t.value.git.modified;
};
</script>

<template>
  <div class="flex flex-col gap-3 min-h-full">
    <div class="border border-border-subtle rounded-lg bg-surface px-3 py-2 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0 text-xs">
        <GitBranch :size="16" class="text-primary shrink-0" />
        <span class="font-mono font-bold text-on-surface truncate">{{ snapshot?.branch || "main" }}</span>
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
        >
          <RefreshCw :size="14" />
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 items-start lg:grid-cols-[minmax(14rem,0.65fr)_minmax(0,1.35fr)] gap-3 min-h-0">
      <div
        :class="
          cn(
            'bg-surface border border-border-subtle rounded-lg overflow-hidden shadow-sm min-h-0 flex flex-col',
            files.length > 0 ? 'h-[26rem] max-h-[56vh]' : 'self-start',
          )
        "
      >
        <div
          class="px-3 py-2 border-b border-border-subtle flex items-center justify-between gap-2 bg-surface-container-low"
        >
          <h3 class="text-sm font-bold text-on-surface">{{ t.git.files }}</h3>
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
          ref="filesScrollRef"
          @wheel="handlePanelWheel($event, 'files')"
          class="min-h-0 flex-1 overflow-y-auto [overscroll-behavior-y:contain]"
        >
          <div
            v-for="(file, idx) in files"
            :key="`${file.path}-${idx}`"
            class="group flex items-center justify-between px-3 py-2 border-b border-border-subtle last:border-b-0 hover:bg-surface-container-low transition-all"
          >
            <div class="flex items-center gap-3 overflow-hidden min-w-0">
              <div
                :class="
                  cn(
                    'w-7 h-7 rounded flex items-center justify-center shrink-0',
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
          </div>
          <div v-if="files.length === 0" class="text-sm text-on-surface-variant p-3">{{ t.git.empty }}</div>
        </div>
      </div>

      <div
        class="bg-surface border border-border-subtle rounded-lg overflow-hidden shadow-sm min-h-0 flex flex-col h-[26rem] max-h-[56vh]"
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
          class="min-h-0 flex-1 overflow-auto bg-surface-container-lowest text-on-surface p-2 [overscroll-behavior-y:contain]"
        >
          <div class="min-w-[40rem] space-y-0.5">
            <div
              v-for="commit in commits"
              :key="commit.hash"
              class="flex items-start gap-3 rounded px-2 py-1.5 hover:bg-surface-container-high"
            >
              <div class="w-14 shrink-0 font-mono text-xs leading-4 whitespace-pre text-secondary select-none pt-0.5">
                {{ commit.graph || "*" }}
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 min-w-0 font-mono text-xs leading-5">
                  <span class="text-primary font-bold shrink-0">{{ commit.hash }}</span>
                  <span class="text-on-surface truncate" :title="commit.message">{{ commit.message }}</span>
                </div>

                <div v-if="refsForCommit(commit.refs).length" class="mt-1 flex flex-wrap gap-1">
                  <span
                    v-for="refName in refsForCommit(commit.refs)"
                    :key="`${commit.hash}-${refName}`"
                    :class="refClass(refName)"
                    :title="refName"
                  >
                    {{ refName }}
                  </span>
                </div>
              </div>

              <div class="shrink-0 text-[10px] text-on-surface-variant whitespace-nowrap text-right leading-4 pt-0.5">
                <div>{{ commit.date }}</div>
                <div class="truncate max-w-40" :title="commit.author">{{ commit.author }}</div>
                <div>{{ commit.hash }}</div>
              </div>
            </div>

            <div v-if="commits.length === 0" class="text-sm text-on-surface-variant p-3">{{ t.git.empty }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
