<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  CircleCheck,
  FileSearch,
  GitBranch,
  RefreshCw,
  X,
} from "lucide-vue-next";
import { Project, type ProjectGitFileChange, type ProjectGitFileDiffResult } from "../../types";
import { cn, scrollToBoundary, transferWheelAtScrollBoundary } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  (e: "open-file", relativePath: string): void;
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
const selectedDiff = ref<ProjectGitFileDiffResult | null>(null);
const isLoadingDiff = ref(false);
const isDiffDialogOpen = ref(false);

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

const handleOpenFile = (file: ProjectGitFileChange) => {
  if (file.status === "DELETED") return;
  emit("open-file", file.path);
};

const handleViewDiff = async (file: ProjectGitFileChange) => {
  isLoadingDiff.value = true;
  isDiffDialogOpen.value = true;
  selectedDiff.value = { path: file.path, diff: "" };
  try {
    selectedDiff.value = await store.readGitFileDiff(props.project.id, file.path);
  } finally {
    isLoadingDiff.value = false;
  }
};

const closeDiffDialog = () => {
  isDiffDialogOpen.value = false;
};

const diffLines = computed(() =>
  (selectedDiff.value?.diff || "").split("\n").map((content, index) => {
    const kind =
      content.startsWith("+++") || content.startsWith("---") || content.startsWith("diff --git")
        ? "meta"
        : content.startsWith("@@")
          ? "hunk"
          : content.startsWith("+")
            ? "add"
            : content.startsWith("-")
              ? "delete"
              : "context";
    return { id: `${index}-${content}`, number: index + 1, content, kind };
  }),
);

const refsForCommit = (refs?: string) =>
  (refs || "")
    .split(",")
    .map((refName) => refName.trim())
    .filter(Boolean);

const refClass = (refName: string) =>
  cn(
    "max-w-40 truncate rounded border px-1.5 py-px text-[9px] font-bold leading-3",
    refName.startsWith("tag:")
      ? "border-secondary/25 bg-secondary/10 text-secondary"
      : refName.includes("HEAD")
        ? "border-primary/70 bg-primary/10 text-primary"
        : /(?:^|\s|\/)main$/.test(refName)
          ? "border-status-running/35 bg-status-running/10 text-status-running"
          : "border-border-subtle bg-surface-container-low text-on-surface-variant",
  );

const isHeadCommit = (refs?: string) => Boolean(refs?.includes("HEAD"));
const graphStrokeColors = ["#2eaf7d", "#0ea5e9", "#f59e0b", "#d946ef", "#f43f5e", "#06b6d4", "#84cc16", "#8b5cf6"];
const laneWidth = 14;
const rowHeight = 28;
const dotRadius = 4.2;
const laneCenter = (lane: number) => lane * laneWidth + laneWidth / 2 + 2;
const minGraphColumnWidth = 50;
const maxGraphColumnWidth = 104;

const refsIncludeBranch = (refs: string | undefined, branch: string) =>
  refsForCommit(refs).some((refName) => {
    const cleanRef = refName.replace(/^HEAD ->\s*/, "").trim();
    return cleanRef === branch || cleanRef === `origin/${branch}`;
  });

const graphRows = computed(() => {
  const lanes: Array<string | null> = [];
  const laneColors = new Map<number, string>();
  let colorIndex = 0;
  let maxLane = 0;
  const currentBranch = snapshot.value?.branch || "";
  const visibleHashes = new Set(commits.value.map((commit) => commit.hash));

  const nextColor = () => graphStrokeColors[colorIndex++ % graphStrokeColors.length];
  const laneColor = (lane: number) => {
    if (!laneColors.has(lane)) {
      laneColors.set(lane, nextColor());
    }
    return laneColors.get(lane) || graphStrokeColors[0];
  };
  const findLane = (hash: string) => lanes.indexOf(hash);
  const allocLane = () => {
    const emptyLane = lanes.indexOf(null);
    if (emptyLane >= 0) return emptyLane;
    lanes.push(null);
    return lanes.length - 1;
  };

  if (currentBranch) {
    const headCommit = commits.value.find((commit) => refsIncludeBranch(commit.refs, currentBranch));
    if (headCommit) {
      lanes[0] = headCommit.hash;
      laneColors.set(0, nextColor());
    }
  }

  return commits.value.map((commit) => {
    const existingLane = findLane(commit.hash);
    let lane = existingLane;
    if (lane < 0) {
      lane = allocLane();
      lanes[lane] = commit.hash;
      laneColor(lane);
    }

    const color = laneColor(lane);
    const activeBefore = lanes
      .map((hash, index) => ({ hash, index }))
      .filter((item) => item.hash !== null)
      .map((item) => item.index);
    const rowLaneColors = new Map<number, string>();
    activeBefore.forEach((activeLane) => {
      rowLaneColors.set(activeLane, laneColor(activeLane));
    });

    const connections: Array<{ from: number; to: number; color: string }> = [];
    const parents = commit.parents || [];
    lanes[lane] = null;

    if (parents.length > 0) {
      const firstParent = parents[0];
      if (visibleHashes.has(firstParent)) {
        const existingFirstParentLane = findLane(firstParent);
        if (existingFirstParentLane >= 0) {
          connections.push({ from: lane, to: existingFirstParentLane, color });
        } else {
          lanes[lane] = firstParent;
          laneColors.set(lane, color);
          connections.push({ from: lane, to: lane, color });
        }
      }

      parents.slice(1).forEach((parentHash) => {
        if (!visibleHashes.has(parentHash)) {
          return;
        }
        let parentLane = findLane(parentHash);
        if (parentLane < 0) {
          parentLane = allocLane();
          lanes[parentLane] = parentHash;
          laneColors.set(parentLane, nextColor());
        }
        connections.push({ from: lane, to: parentLane, color });
      });
    }

    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }

    const activeAfter = lanes
      .map((hash, index) => ({ hash, index }))
      .filter((item) => item.hash !== null)
      .map((item) => item.index);
    const verticalSegments = Array.from(new Set([...activeBefore, ...activeAfter])).map((activeLane) => ({
      lane: activeLane,
      fromTop: activeBefore.includes(activeLane) && (activeLane !== lane || existingLane >= 0),
      toBottom: activeAfter.includes(activeLane),
      color: rowLaneColors.get(activeLane) || laneColor(activeLane),
    }));

    maxLane = Math.max(
      maxLane,
      lane,
      ...activeBefore,
      ...activeAfter,
      ...connections.map((connection) => connection.to),
    );

    return {
      commit,
      lane,
      color,
      verticalSegments,
      laneColors: rowLaneColors,
      connections,
      width: Math.max(58, (maxLane + 1) * laneWidth + 16),
    };
  });
});

const graphColumnWidth = computed(() =>
  Math.min(maxGraphColumnWidth, Math.max(minGraphColumnWidth, ...graphRows.value.map((row) => row.width))),
);

const graphRowColumns = computed(
  () => `${graphColumnWidth.value}px 4rem minmax(18rem, 1fr)`,
);
const gitGridColumns = "minmax(13rem,0.42fr) minmax(0,1.58fr)";

const fileLabel = (status: string) => {
  if (status === "ADDED") return t.value.git.added;
  if (status === "DELETED") return t.value.git.deleted;
  if (status === "RENAMED") return t.value.git.renamed;
  if (status === "UNTRACKED") return t.value.git.untracked;
  return t.value.git.modified;
};

const formatAbsoluteTime = (value?: string) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
};

const formatRelativeTime = (value?: string) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = Date.now() - date.getTime();
  const absDiff = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;

  if (absDiff < minute) return diffMs >= 0 ? "刚刚" : "即将";
  if (absDiff < hour)
    return diffMs >= 0
      ? `${Math.max(1, Math.round(absDiff / minute))} 分钟前`
      : `${Math.max(1, Math.round(absDiff / minute))} 分钟后`;
  if (absDiff < day)
    return diffMs >= 0
      ? `${Math.max(1, Math.round(absDiff / hour))} 小时前`
      : `${Math.max(1, Math.round(absDiff / hour))} 小时后`;
  if (absDiff < month)
    return diffMs >= 0
      ? `${Math.max(1, Math.round(absDiff / day))} 天前`
      : `${Math.max(1, Math.round(absDiff / day))} 天后`;
  if (absDiff < year)
    return diffMs >= 0
      ? `${Math.max(1, Math.round(absDiff / month))} 个月前`
      : `${Math.max(1, Math.round(absDiff / month))} 个月后`;
  return diffMs >= 0
    ? `${Math.max(1, Math.round(absDiff / year))} 年前`
    : `${Math.max(1, Math.round(absDiff / year))} 年后`;
};

const formatCommitTime = (value?: string) => ({
  text: formatRelativeTime(value),
  title: formatAbsoluteTime(value),
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
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
          :aria-label="t.git.refresh"
        >
          <RefreshCw :size="14" />
        </button>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 gap-2 overflow-hidden" :style="{ gridTemplateColumns: gitGridColumns }">
      <div class="bg-surface border border-border-subtle rounded-lg overflow-hidden shadow-sm min-h-0 flex min-w-0 flex-col">
        <div
          class="px-3 py-2 border-b border-border-subtle flex items-center justify-between gap-2 bg-surface-container-low"
        >
          <h3 class="min-w-0 truncate text-xs font-bold text-on-surface">{{ t.git.files }}</h3>
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
          class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overscroll-behavior-y:contain]"
        >
          <div
            v-for="(file, idx) in files"
            :key="`${file.path}-${idx}`"
            class="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 border-b border-border-subtle px-2.5 py-2 last:border-b-0 hover:bg-surface-container-low transition-all"
            :title="file.path"
            @click="handleViewDiff(file)"
          >
            <div class="flex min-w-0 items-center overflow-hidden">
              <div class="truncate">
                <p
                  :class="
                    cn(
                      'font-mono text-xs font-bold truncate',
                      file.status === 'DELETED' ? 'text-on-surface-variant line-through' : 'text-on-surface',
                    )
                  "
                  :title="file.path"
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
            <div class="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-35"
                :disabled="file.status === 'DELETED'"
                :title="file.status === 'DELETED' ? t.git.fileDeleted : t.git.openFile"
                :aria-label="file.status === 'DELETED' ? t.git.fileDeleted : t.git.openFile"
                @click.stop="handleOpenFile(file)"
              >
                <FileSearch :size="14" />
              </button>
            </div>
          </div>
        </div>
        <div
          v-else
          class="flex flex-none items-center gap-1.5 px-2.5 py-2 text-[11px] text-on-surface-variant"
        >
          <CircleCheck :size="14" class="shrink-0 text-status-running" />
          <span class="leading-4">{{ t.git.cleanWorkingTree }}</span>
        </div>
      </div>

      <div
        class="bg-surface border border-border-subtle rounded-lg overflow-hidden shadow-sm min-h-0 flex min-w-0 flex-col"
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
          class="min-h-0 flex-1 overflow-auto bg-surface-container-lowest p-2 text-on-surface [overscroll-behavior-y:contain]"
        >
          <div class="min-w-full space-y-0.5">
            <div
              v-for="row in graphRows"
              :key="row.commit.hash"
              class="grid h-8 min-w-[30rem] items-center gap-1.5 rounded px-2 text-xs hover:bg-surface-container-high"
              :style="{ gridTemplateColumns: graphRowColumns }"
            >
              <div class="h-8 min-w-0 overflow-hidden" :title="row.commit.graph || '*'">
                <svg
                  class="block h-8 w-full"
                  :viewBox="`0 0 ${row.width} ${rowHeight}`"
                  preserveAspectRatio="xMinYMid meet"
                >
                  <line
                    v-for="segment in row.verticalSegments"
                    :key="`${row.commit.hash}-v-${segment.lane}`"
                    :x1="laneCenter(segment.lane)"
                    :y1="segment.fromTop ? 0 : rowHeight / 2"
                    :x2="laneCenter(segment.lane)"
                    :y2="segment.toBottom ? rowHeight : rowHeight / 2"
                    :stroke="segment.color"
                    stroke-width="2"
                    stroke-linecap="round"
                    opacity="0.42"
                  />
                  <line
                    v-for="(connection, index) in row.connections"
                    :key="`${row.commit.hash}-c-${index}`"
                    :x1="laneCenter(connection.from)"
                    :y1="rowHeight / 2"
                    :x2="laneCenter(connection.to)"
                    :y2="rowHeight"
                    :stroke="connection.color"
                    stroke-width="2"
                    stroke-linecap="round"
                    opacity="0.82"
                  />
                  <circle
                    :cx="laneCenter(row.lane)"
                    :cy="rowHeight / 2"
                    :r="isHeadCommit(row.commit.refs) ? dotRadius + 0.7 : dotRadius"
                    :fill="isHeadCommit(row.commit.refs) ? 'var(--color-surface)' : row.color"
                    :stroke="row.color"
                    :stroke-width="isHeadCommit(row.commit.refs) ? 2.4 : 1.4"
                  />
                </svg>
              </div>

              <span class="truncate font-mono text-[10px] font-semibold text-on-surface-variant" :title="row.commit.hash">{{
                row.commit.hash
              }}</span>
              <div class="min-w-0 overflow-hidden">
                <div class="flex min-w-0 items-center gap-1.5 leading-4">
                  <span class="truncate text-[11px] font-semibold text-on-surface" :title="row.commit.message">{{ row.commit.message }}</span>
                  <span
                    v-for="refName in refsForCommit(row.commit.refs)"
                    :key="`${row.commit.hash}-${refName}`"
                    :class="refClass(refName)"
                    :title="refName"
                  >
                    {{ refName }}
                  </span>
                </div>
                <div class="mt-px truncate text-[9px] leading-3 text-on-surface-variant/75" :title="`${row.commit.author} · ${formatCommitTime(row.commit.date).title}`">
                  {{ row.commit.author }} · {{ formatCommitTime(row.commit.date).text }}
                </div>
              </div>
            </div>

            <div v-if="commits.length === 0" class="text-sm text-on-surface-variant p-3">{{ t.git.empty }}</div>
            <button
              v-if="snapshot?.hasMoreCommits"
              type="button"
              class="mx-auto my-3 flex h-8 items-center rounded border border-border-subtle bg-surface px-3 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-wait disabled:opacity-60"
              :disabled="isLoadingMore"
              @click="handleLoadMore"
            >
              {{ isLoadingMore ? t.git.loadingMore : t.git.loadMore }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="isDiffDialogOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
      @click.self="closeDiffDialog"
    >
      <div
        class="flex h-[min(42rem,86vh)] w-[min(58rem,92vw)] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-2xl"
      >
        <div
          class="flex h-11 items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4"
        >
          <div class="min-w-0">
            <h3 class="text-sm font-bold text-on-surface">{{ t.git.diffTitle }}</h3>
            <p v-if="selectedDiff" class="truncate font-mono text-[10px] font-bold text-on-surface-variant">
              {{ selectedDiff.path }}
            </p>
          </div>
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
            :title="t.common.close"
            :aria-label="t.common.close"
            @click="closeDiffDialog"
          >
            <X :size="15" />
          </button>
        </div>
        <div class="themed-scrollbar min-h-0 flex-1 overflow-auto bg-surface-container-lowest">
          <div v-if="isLoadingDiff" class="p-5 text-sm text-on-surface-variant">{{ t.git.diffLoading }}</div>
          <div v-else-if="selectedDiff?.diff" class="min-w-max py-3 font-mono text-xs leading-5">
            <div
              v-for="line in diffLines"
              :key="line.id"
              :class="
                cn(
                  'grid grid-cols-[3.25rem_minmax(0,1fr)] whitespace-pre text-on-surface',
                  line.kind === 'add' && 'bg-status-running/10 text-on-surface',
                  line.kind === 'delete' && 'bg-status-error/10 text-on-surface',
                  line.kind === 'hunk' && 'bg-secondary/10 text-secondary',
                  line.kind === 'meta' && 'bg-surface-container-low text-on-surface-variant',
                )
              "
            >
              <span class="select-none border-r border-border-subtle px-2 text-right text-on-surface-variant/60">
                {{ line.number }}
              </span>
              <span class="px-3">{{ line.content || " " }}</span>
            </div>
          </div>
          <div v-else class="p-5 text-sm text-on-surface-variant">
            {{ selectedDiff?.message || t.git.diffEmpty }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
