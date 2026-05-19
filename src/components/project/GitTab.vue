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
const isLoadingMore = ref(false);

const handleRefresh = async () => {
  await store.refreshGitSnapshot(props.project.id);
};

const handleLoadMore = async () => {
  if (isLoadingMore.value || !snapshot.value?.hasMoreCommits) return;
  isLoadingMore.value = true;
  try {
    await store.loadMoreGitCommits(props.project.id);
  } finally {
    isLoadingMore.value = false;
  }
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
    "max-w-40 truncate rounded border px-1.5 py-0.5 text-[9px] font-bold",
    refName.startsWith("tag:")
      ? "border-secondary/25 bg-secondary/10 text-secondary"
      : refName.includes("HEAD")
        ? "border-primary/70 bg-primary/10 text-primary"
        : /(?:^|\s|\/)main$/.test(refName)
          ? "border-status-running/35 bg-status-running/10 text-status-running"
          : "border-border-subtle bg-surface-container-low text-on-surface-variant",
  );

const graphStrokeColors = ["#2eaf7d", "#f59e0b", "#0ea5e9", "#f87171", "#a78bfa", "#22c55e"];
const graphColor = (lane: number) => graphStrokeColors[lane % graphStrokeColors.length];
const isHeadCommit = (refs?: string) => Boolean(refs?.includes("HEAD"));
const laneWidth = 14;
const rowHeight = 28;

const laneCenter = (lane: number) => lane * laneWidth + laneWidth / 2;

const graphRows = computed(() => {
  const lanes: string[] = [];
  let maxLane = 0;

  return commits.value.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      lane = lanes.findIndex((item) => !item);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = commit.hash;
    }

    const parents = commit.parents || [];
    const activeLanes = lanes
      .map((hash, index) => ({ hash, index }))
      .filter((item) => Boolean(item.hash));
    const parentLanes = parents.map((parentHash, parentIndex) => {
      let parentLane = parentIndex === 0 ? lane : lanes.indexOf(parentHash);
      if (parentLane < 0) {
        parentLane = lanes.findIndex((hash, index) => !hash && index !== lane);
        if (parentLane < 0) parentLane = lanes.length;
      }
      return { hash: parentHash, lane: parentLane };
    });

    lanes[lane] = parentLanes[0]?.hash || "";
    parentLanes.slice(1).forEach((parent) => {
      lanes[parent.lane] = parent.hash;
    });

    while (lanes.length && !lanes[lanes.length - 1]) {
      lanes.pop();
    }
    maxLane = Math.max(maxLane, lanes.length, lane + 1, ...parentLanes.map((parent) => parent.lane + 1));

    return {
      commit,
      lane,
      activeLanes,
      nextActiveLanes: lanes
        .map((hash, index) => ({ hash, index }))
        .filter((item) => Boolean(item.hash)),
      connections: parentLanes.length
        ? parentLanes.filter((parent) => parent.lane !== lane).map((parent) => ({ from: lane, to: parent.lane }))
        : [],
      width: Math.max(42, maxLane * laneWidth + laneWidth),
    };
  });
});

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
        class="bg-surface border border-border-subtle rounded-lg overflow-hidden shadow-sm min-h-0 flex flex-col self-start"
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
          v-if="files.length > 0"
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
        </div>
      </div>

      <div
        class="bg-surface border border-border-subtle rounded-lg overflow-hidden shadow-sm min-h-0 flex flex-col h-[32rem] max-h-[68vh]"
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
          <div class="min-w-[44rem] space-y-0.5">
            <div
              v-for="row in graphRows"
              :key="row.commit.hash"
              class="grid h-7 grid-cols-[4.25rem_4.25rem_minmax(0,1fr)_minmax(7rem,12rem)_minmax(5rem,8rem)_5.5rem] items-center gap-2 rounded px-2 text-xs hover:bg-surface-container-high"
            >
              <div class="h-7 overflow-hidden" :title="row.commit.graph || '*'">
                <svg class="h-7 overflow-visible" :width="row.width" :height="rowHeight" :viewBox="`0 0 ${row.width} ${rowHeight}`">
                  <line
                    v-for="activeLane in row.activeLanes"
                    :key="`v-${row.commit.hash}-${activeLane.index}`"
                    :x1="laneCenter(activeLane.index)"
                    y1="0"
                    :x2="laneCenter(activeLane.index)"
                    :y2="rowHeight / 2"
                    :stroke="graphColor(activeLane.index)"
                    stroke-width="2"
                    stroke-linecap="round"
                    opacity="0.78"
                  />
                  <line
                    v-for="activeLane in row.nextActiveLanes"
                    :key="`nv-${row.commit.hash}-${activeLane.index}`"
                    :x1="laneCenter(activeLane.index)"
                    :y1="rowHeight / 2"
                    :x2="laneCenter(activeLane.index)"
                    :y2="rowHeight"
                    :stroke="graphColor(activeLane.index)"
                    stroke-width="2"
                    stroke-linecap="round"
                    opacity="0.78"
                  />
                  <line
                    v-for="connection in row.connections"
                    :key="`c-${row.commit.hash}-${connection.from}-${connection.to}`"
                    :x1="laneCenter(connection.from)"
                    :y1="rowHeight / 2"
                    :x2="laneCenter(connection.to)"
                    :y2="rowHeight"
                    :stroke="graphColor(connection.to)"
                    stroke-width="2"
                    stroke-linecap="round"
                    opacity="0.95"
                  />
                  <circle
                    :cx="laneCenter(row.lane)"
                    :cy="rowHeight / 2"
                    :r="isHeadCommit(row.commit.refs) ? 4.8 : 4.2"
                    :fill="isHeadCommit(row.commit.refs) ? 'var(--color-surface)' : graphColor(row.lane)"
                    :stroke="graphColor(row.lane)"
                    :stroke-width="isHeadCommit(row.commit.refs) ? 2.4 : 1.4"
                  />
                </svg>
              </div>

              <span class="truncate font-mono font-semibold text-on-surface-variant" :title="row.commit.hash">{{
                row.commit.hash
              }}</span>
              <span class="truncate text-on-surface" :title="row.commit.message">{{ row.commit.message }}</span>
              <div class="flex min-w-0 gap-1 overflow-hidden">
                <span
                  v-for="refName in refsForCommit(row.commit.refs)"
                  :key="`${row.commit.hash}-${refName}`"
                  :class="refClass(refName)"
                  :title="refName"
                >
                  {{ refName }}
                </span>
              </div>
              <span class="truncate text-left text-on-surface-variant" :title="row.commit.author">{{ row.commit.author }}</span>
              <span class="text-right text-[10px] tabular-nums text-on-surface-variant">{{ row.commit.date }}</span>
            </div>

            <div v-if="commits.length === 0" class="text-sm text-on-surface-variant p-3">{{ t.git.empty }}</div>
            <button
              v-if="snapshot?.hasMoreCommits"
              type="button"
              class="mx-auto my-3 flex h-8 items-center rounded border border-border-subtle bg-surface px-3 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-wait disabled:opacity-60"
              :disabled="isLoadingMore"
              @click="handleLoadMore"
            >
              {{ isLoadingMore ? "加载中..." : "加载更多提交" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
