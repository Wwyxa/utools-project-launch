<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Play,
  Square,
  AlertTriangle,
  FolderOpen,
  Pencil,
  TerminalSquare,
  Code2,
  Trash2,
  ChevronDown,
  GripVertical,
  Link2,
} from "lucide-vue-next";
import { Project, ProjectStatus, ProjectIconKey } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { formatAbsoluteTime, formatRelativeTime } from "../../lib/time";
import ProjectIcon from "../project/ProjectIcon.vue";

const props = defineProps<{
  project: Project;
  isSorting?: boolean;
  isDragging?: boolean;
  showGroupBadge?: boolean;
  groupLabel?: string;
}>();

const emit = defineEmits<{
  (e: "select", id: string): void;
}>();

const store = useStore();
const t = useI18n();
const moreScriptsOpen = ref(false);
const moreScriptsRef = ref<HTMLElement | null>(null);
const scriptRowRef = ref<HTMLElement | null>(null);
const scriptMeasureRef = ref<HTMLElement | null>(null);
const visibleScriptLimit = ref(3);
const maxVisibleScriptButtons = 3;
const scriptButtonGapFallback = 6;
let scriptRowResizeObserver: ResizeObserver | null = null;
let visibleScriptMeasureFrame: number | null = null;

const isRunning = computed(() => props.project.status === ProjectStatus.RUNNING);
const isError = computed(() => props.project.status === ProjectStatus.ERROR);
const isTiny = computed(() => props.project.cardStyle === "tiny");
const isUnavailable = computed(() => props.project.pathExists === false);
const tinyRunTarget = computed(() => {
  const running = props.project.scripts.find((s) => s.status === "RUNNING");
  if (running) return running;
  const stopping = props.project.scripts.find((s) => s.status === "STOPPING");
  if (stopping) return stopping;
  return props.project.scripts[0] || null;
});
const quickLink = computed(() => props.project.quickLink?.trim() || "");
const displayGroupLabel = computed(() => props.groupLabel?.trim() || props.project.group?.trim() || "");
const activeScripts = computed(() =>
  props.project.scripts.filter((script) => script.status === "RUNNING" || script.status === "STOPPING"),
);
const prioritizedScripts = computed(() => {
  const activeIds = new Set(activeScripts.value.map((script) => script.id));
  return [...activeScripts.value, ...props.project.scripts.filter((script) => !activeIds.has(script.id))];
});
const visibleScripts = computed(() => prioritizedScripts.value.slice(0, visibleScriptLimit.value));

const parsePixelValue = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getFallbackVisibleScriptLimit = () => Math.min(prioritizedScripts.value.length, maxVisibleScriptButtons);

const calculateVisibleScriptLimit = () => {
  const scriptCount = prioritizedScripts.value.length;
  if (scriptCount === 0) {
    return 0;
  }

  const rowElement = scriptRowRef.value;
  const measureElement = scriptMeasureRef.value;
  if (!rowElement || !measureElement) {
    return getFallbackVisibleScriptLimit();
  }

  const availableWidth = rowElement.getBoundingClientRect().width;
  if (availableWidth <= 0) {
    return getFallbackVisibleScriptLimit();
  }

  const scriptButtonWidths = Array.from(
    measureElement.querySelectorAll<HTMLElement>("[data-script-measure-button]"),
  ).map((element) => Math.ceil(element.getBoundingClientRect().width));

  if (scriptButtonWidths.length === 0) {
    return getFallbackVisibleScriptLimit();
  }

  const moreButtonWidth = Math.ceil(
    measureElement.querySelector<HTMLElement>("[data-script-more-measure]")?.getBoundingClientRect().width || 0,
  );
  const rowStyle = window.getComputedStyle(rowElement);
  const gap = parsePixelValue(rowStyle.columnGap || rowStyle.gap, scriptButtonGapFallback);
  const maxCandidate = Math.min(scriptCount, maxVisibleScriptButtons, scriptButtonWidths.length);

  for (let candidate = maxCandidate; candidate >= 1; candidate -= 1) {
    const visibleWidth = scriptButtonWidths.slice(0, candidate).reduce((total, width) => total + width, 0);
    const visibleGaps = Math.max(candidate - 1, 0) * gap;
    const needsMoreButton = candidate < scriptCount;
    const totalWidth = visibleWidth + visibleGaps + (needsMoreButton ? moreButtonWidth + gap : 0);

    if (totalWidth <= availableWidth + 1) {
      return candidate;
    }
  }

  return 1;
};

const updateVisibleScriptLimit = () => {
  visibleScriptLimit.value = calculateVisibleScriptLimit();
};

const scheduleVisibleScriptMeasure = async () => {
  await nextTick();
  if (typeof window === "undefined") {
    updateVisibleScriptLimit();
    return;
  }

  if (visibleScriptMeasureFrame !== null) {
    window.cancelAnimationFrame(visibleScriptMeasureFrame);
  }
  visibleScriptMeasureFrame = window.requestAnimationFrame(() => {
    visibleScriptMeasureFrame = null;
    updateVisibleScriptLimit();
  });
};

watch(
  () => prioritizedScripts.value.map((script) => `${script.id}:${script.name}:${script.status}`).join("|"),
  () => {
    void scheduleVisibleScriptMeasure();
  },
  { immediate: true },
);

watch(
  scriptRowRef,
  (rowElement, previousRowElement) => {
    if (previousRowElement) {
      scriptRowResizeObserver?.unobserve(previousRowElement);
    }
    if (rowElement) {
      scriptRowResizeObserver?.observe(rowElement);
    }
    void scheduleVisibleScriptMeasure();
  },
  { flush: "post" },
);

onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    scriptRowResizeObserver = new ResizeObserver(() => {
      void scheduleVisibleScriptMeasure();
    });
    if (scriptRowRef.value) {
      scriptRowResizeObserver.observe(scriptRowRef.value);
    }
  } else {
    window.addEventListener("resize", scheduleVisibleScriptMeasure);
  }
  void scheduleVisibleScriptMeasure();
});

const hiddenRunningCount = computed(
  () =>
    activeScripts.value.filter((script) => !visibleScripts.value.some((visible) => visible.id === script.id)).length,
);
const hiddenScriptCount = computed(() => props.project.scripts.length - visibleScripts.value.length);
const hiddenScripts = computed(() => {
  const visibleIds = new Set(visibleScripts.value.map((script) => script.id));
  return props.project.scripts.filter((script) => !visibleIds.has(script.id));
});
const projectStack = computed<{ kind: ProjectIconKey; title: string; label: string }>(() => {
  const explicitIcon = props.project.icon as ProjectIconKey | undefined;
  const typeText = `${props.project.type} ${props.project.name}`.toLowerCase();
  const scriptText = props.project.scripts
    .map((script) => `${script.command} ${script.note || ""}`)
    .join(" ")
    .toLowerCase();
  const source = `${typeText} ${scriptText}`;

  if (explicitIcon && explicitIcon !== "custom") {
    const label = explicitIcon === "executable" ? "EXE" : explicitIcon.toUpperCase();
    return { kind: explicitIcon, title: label, label };
  }
  if (props.project.kind === "node" && /\b(vue|vite|nuxt)\b/.test(source)) {
    return { kind: "vue", title: "Vue", label: "Vue" };
  }
  if (props.project.kind === "node") {
    return { kind: "node", title: "Node.js", label: "node" };
  }
  if (props.project.kind === "python") {
    return { kind: "python", title: "Python", label: "Py" };
  }
  if (props.project.kind === "go") {
    return { kind: "go", title: "Go", label: "Go" };
  }
  if (props.project.kind === "executable") {
    return { kind: "executable", title: t.value.projectKinds.executable, label: "EXE" };
  }
  return { kind: "custom", title: props.project.type || t.value.projectKinds.custom, label: "DEV" };
});
const displayPath = computed(() => {
  const normalizedPath = props.project.path.replace(/\\/g, "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length <= 2) {
    return normalizedPath;
  }
  return `.../${segments.slice(-2).join("/")}`;
});

const latestGitCommitAt = computed(
  () => props.project.gitLatestCommitAt || props.project.git?.commits?.[0]?.date || "",
);

const cardTimeMeta = computed(() => {
  const sourceTime =
    latestGitCommitAt.value || props.project.updatedAt || props.project.createdAt || props.project.lastUpdated;
  if (sourceTime) {
    return {
      symbol: latestGitCommitAt.value ? "⌁" : "◔",
      title: formatAbsoluteTime(sourceTime),
      value: formatRelativeTime(sourceTime),
    };
  }
  return { symbol: "•", title: "", value: "--" };
});
const lowSignalCardErrorPatterns = [
  /^exited with code (?:\d+|unknown)$/i,
  /\ba complete log of this run can be found in:/i,
];
const isLowSignalCardErrorMessage = (message: string) =>
  lowSignalCardErrorPatterns.some((pattern) => pattern.test(message.trim()));

const cardErrorMessage = computed(() => {
  const errorLogs = [...(store.logs[props.project.id] || [])]
    .reverse()
    .filter((log) => log.type === "ERROR" && log.message.trim());
  const specificErrorLog = errorLogs.find((log) => !isLowSignalCardErrorMessage(log.message));
  if (specificErrorLog) {
    return specificErrorLog.message.trim();
  }

  const erroredScript = props.project.scripts.find((script) => script.status === "ERROR");
  return erroredScript ? `${erroredScript.name}: ${t.value.common.error}` : "Exit code 1";
});

const handleCardSelect = () => {
  if (props.isSorting) {
    return;
  }
  if (isUnavailable.value) {
    store.openEditProjectForm(props.project.id);
    return;
  }
  emit("select", props.project.id);
};

const handleEdit = (event: MouseEvent) => {
  event.stopPropagation();
  store.openEditProjectForm(props.project.id);
};

const handleOpenFolder = async (event: MouseEvent) => {
  event.stopPropagation();
  if (isUnavailable.value) {
    return;
  }
  await store.openProjectFolder(props.project.id);
};

const handleOpenTerminal = async (event: MouseEvent) => {
  event.stopPropagation();
  if (isUnavailable.value) {
    return;
  }
  await store.openProjectInTerminal(props.project.id);
};

const handleOpenEditor = async (event: MouseEvent) => {
  event.stopPropagation();
  if (isUnavailable.value) {
    return;
  }
  await store.openProjectInEditor(props.project.id);
};

const handleOpenQuickLink = async (event: MouseEvent) => {
  event.stopPropagation();
  if (!quickLink.value) {
    return;
  }
  await store.openProjectQuickLink(props.project.id);
};

const handleScriptToggle = async (event: MouseEvent, scriptId: string, status: string) => {
  event.stopPropagation();
  if (isUnavailable.value) {
    return;
  }
  if (status === "RUNNING") {
    await store.stopScript(props.project.id, scriptId);
    moreScriptsOpen.value = false;
    return;
  }
  if (status === "STOPPING") {
    moreScriptsOpen.value = false;
    return;
  }
  await store.launchScript(props.project.id, scriptId);
  moreScriptsOpen.value = false;
};

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!moreScriptsRef.value?.contains(event.target as Node)) {
    moreScriptsOpen.value = false;
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleDocumentKeyDown);
  }
};

const handleDocumentKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    moreScriptsOpen.value = false;
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleDocumentKeyDown);
  }
};

const toggleMoreScripts = (event: MouseEvent) => {
  event.stopPropagation();
  moreScriptsOpen.value = !moreScriptsOpen.value;
  if (moreScriptsOpen.value) {
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
  } else {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("keydown", handleDocumentKeyDown);
  }
};

onBeforeUnmount(() => {
  if (visibleScriptMeasureFrame !== null) {
    window.cancelAnimationFrame(visibleScriptMeasureFrame);
  }
  scriptRowResizeObserver?.disconnect();
  window.removeEventListener("resize", scheduleVisibleScriptMeasure);
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeyDown);
});

const handleDelete = (event: MouseEvent) => {
  event.stopPropagation();
  store.requestDeleteProject(props.project.id);
};
</script>

<template>
  <div v-if="isTiny" class="group relative flex items-center">
    <div
      @click="handleCardSelect"
      :class="
        cn(
          'relative border border-border-subtle rounded-lg bg-surface shadow-[0_8px_22px_rgba(15,23,42,0.045),0_1px_3px_rgba(15,23,42,0.04)] transition-all overflow-visible hover:bg-surface-container hover:border-primary/35 hover:shadow-[0_14px_34px_rgba(15,23,42,0.085),0_0_0_1px_rgba(46,175,125,0.12)] focus-within:border-primary/50',
          'flex shrink-0 min-w-[8rem] max-w-[14rem] after:absolute after:inset-x-0 after:top-full after:h-8',
          isRunning &&
            'border-status-running/55 bg-status-running/[0.035] shadow-[0_12px_30px_rgba(46,175,125,0.13),0_1px_4px_rgba(15,23,42,0.045)] hover:bg-status-running/[0.07] dark:bg-status-running/[0.08] dark:hover:bg-status-running/[0.12]',
          isDragging && 'opacity-55 scale-[0.99]',
          isSorting ? 'cursor-grab ring-1 ring-primary/30 border-primary/60 active:cursor-grabbing' : 'cursor-pointer',
        )
      "
    >
      <div class="flex items-center gap-1.5 py-1.5 px-2.5 min-h-0">
        <span
          class="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden"
          :title="projectStack.title"
          :aria-label="projectStack.title"
        >
          <ProjectIcon :icon="projectStack.kind" size="sm" />
        </span>
        <h3
          class="min-w-0 flex-1 truncate text-sm font-bold text-on-surface group-hover:text-primary transition-colors"
        >
          {{ project.name }}
        </h3>
        <GripVertical v-if="isSorting" :size="14" class="shrink-0 text-on-surface-variant/55" />
        <button
          v-else-if="tinyRunTarget"
          type="button"
          @click.stop="handleScriptToggle($event, tinyRunTarget.id, tinyRunTarget.status)"
          :disabled="isUnavailable || tinyRunTarget.status === 'STOPPING'"
          :class="
            cn(
              'inline-flex shrink-0 items-center justify-center h-6 w-6 rounded transition-colors',
              tinyRunTarget.status === 'RUNNING'
                ? 'text-status-running hover:bg-status-running/10'
                : tinyRunTarget.status === 'STOPPING'
                  ? 'text-status-warning cursor-wait'
                  : 'text-on-surface-variant/60 hover:text-status-running hover:bg-on-surface/5',
            )
          "
          :title="tinyRunTarget.status === 'RUNNING' ? t.scripts.stopScript : t.scripts.startScript"
          :aria-label="tinyRunTarget.status === 'RUNNING' ? t.scripts.stopScript : t.scripts.startScript"
        >
          <Square
            v-if="tinyRunTarget.status === 'RUNNING' || tinyRunTarget.status === 'STOPPING'"
            :size="13"
            fill="currentColor"
          />
          <Play v-else :size="13" fill="currentColor" />
        </button>
      </div>
      <div
        :class="
          cn(
            'absolute top-[calc(100%+0.25rem)] right-0 z-30 flex items-center gap-0.5 rounded-md border border-outline-variant/60 bg-surface-container-lowest px-1 py-0.5 shadow-md transition-all',
            'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
          )
        "
        @click.stop
      >
        <button
          v-if="quickLink && !isSorting"
          type="button"
          @click="handleOpenQuickLink"
          class="p-0.5 text-on-surface-variant/60 hover:text-primary rounded hover:bg-on-surface/5 transition-colors"
          :title="t.projectActions.openQuickLink"
          :aria-label="t.projectActions.openQuickLink"
        >
          <Link2 :size="13" />
        </button>
        <button
          v-if="!isSorting"
          @click.stop="handleOpenTerminal"
          class="p-0.5 text-on-surface-variant/70 hover:text-status-running rounded hover:bg-on-surface/5 transition-colors"
          :disabled="isUnavailable"
          :title="t.projectActions.openInTerminal"
          :aria-label="t.projectActions.openInTerminal"
        >
          <TerminalSquare :size="13" />
        </button>
        <button
          v-if="!isSorting"
          @click.stop="handleOpenEditor"
          class="p-0.5 text-on-surface-variant/70 hover:text-primary rounded hover:bg-on-surface/5 transition-colors"
          :disabled="isUnavailable"
          :title="t.projectActions.openInEditor"
          :aria-label="t.projectActions.openInEditor"
        >
          <Code2 :size="13" />
        </button>
        <button
          v-if="!isSorting"
          @click.stop="handleOpenFolder"
          class="p-0.5 text-on-surface-variant/70 hover:text-on-surface rounded hover:bg-on-surface/5 transition-colors"
          :disabled="isUnavailable"
          :title="t.common.openFolder"
          :aria-label="t.common.openFolder"
        >
          <FolderOpen :size="13" />
        </button>
        <button
          v-if="!isSorting"
          @click.stop="handleEdit"
          class="p-0.5 text-on-surface-variant/70 hover:text-primary rounded hover:bg-on-surface/5 transition-colors"
          :title="t.common.edit"
          :aria-label="t.common.edit"
        >
          <Pencil :size="13" />
        </button>
        <button
          v-if="!isSorting"
          @click.stop="handleDelete"
          class="p-0.5 text-on-surface-variant/70 hover:text-status-error rounded hover:bg-on-surface/5 transition-colors"
          :title="t.projectActions.deleteProject"
          :aria-label="t.projectActions.deleteProject"
        >
          <Trash2 :size="13" />
        </button>
      </div>
      <div
        :class="
          cn(
            'absolute -left-px -top-px -bottom-px w-[5px] rounded-l-lg rounded-r-none pointer-events-none',
            isRunning ? 'bg-status-running' : isError ? 'bg-status-error' : 'transparent',
          )
        "
      />
    </div>
  </div>
  <div
    v-else
    @click="handleCardSelect"
    :class="
      cn(
        'group relative mb-2.5 border border-border-subtle rounded-lg bg-surface shadow-[0_8px_22px_rgba(15,23,42,0.045),0_1px_3px_rgba(15,23,42,0.04)] transition-all overflow-visible hover:bg-surface-container hover:border-primary/35 hover:shadow-[0_14px_34px_rgba(15,23,42,0.085),0_0_0_1px_rgba(46,175,125,0.12)] focus-within:border-primary/50',
        isRunning &&
          'border-status-running/55 bg-status-running/[0.035] shadow-[0_12px_30px_rgba(46,175,125,0.13),0_1px_4px_rgba(15,23,42,0.045)] hover:bg-status-running/[0.07] dark:bg-status-running/[0.08] dark:hover:bg-status-running/[0.12]',
        isDragging && 'opacity-55 scale-[0.99]',
        isSorting ? 'cursor-grab ring-1 ring-primary/30 border-primary/60 active:cursor-grabbing' : 'cursor-pointer',
      )
    "
  >
    <div class="p-3 min-h-36 h-full flex flex-col">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span
              class="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden"
              :title="projectStack.title"
              :aria-label="projectStack.title"
            >
              <ProjectIcon :icon="projectStack.kind" size="sm" />
            </span>
            <h3 class="min-w-0 truncate text-sm font-bold text-on-surface group-hover:text-primary transition-colors">
              {{ project.name }}
            </h3>
            <span
              v-if="isRunning"
              class="inline-flex shrink-0 items-center gap-1 rounded-full border border-status-running/25 bg-status-running/10 px-1.5 py-0.5 text-[9px] font-bold text-status-running"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse" />
              {{ t.common.running }}
            </span>
          </div>
        </div>

        <div v-if="isSorting || quickLink || isError" class="flex shrink-0 items-center justify-end gap-1">
          <button
            v-if="quickLink && !isSorting"
            type="button"
            @click="handleOpenQuickLink"
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:border-primary/40 hover:bg-surface-container hover:text-primary"
            :title="t.projectActions.openQuickLink"
            :aria-label="t.projectActions.openQuickLink"
          >
            <Link2 :size="13" />
          </button>

          <GripVertical v-if="isSorting" :size="16" class="shrink-0 text-on-surface-variant/55" />

          <div
            v-else-if="isError"
            :class="
              cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full border border-status-error/25 bg-status-error/10 px-1.5 py-0.5 text-[9px] font-bold text-status-error',
              )
            "
          >
            <span class="h-1.5 w-1.5 rounded-full bg-status-error" />
            <span class="truncate">
              {{ t.common.error }}
            </span>
          </div>
        </div>
      </div>

      <p v-if="project.description" class="text-xs text-on-surface-variant/80 mt-1 line-clamp-1">
        {{ project.description }}
      </p>
      <p class="font-mono text-[11px] text-on-surface-variant/60 mt-0.5 max-w-full truncate" :title="project.path">
        {{ displayPath }}
      </p>
      <p v-if="isUnavailable" class="text-[11px] text-status-warning mt-1 line-clamp-1">
        {{ project.unavailableReason || "当前设备无法访问该路径" }}
      </p>

      <div
        v-if="prioritizedScripts.length > 0"
        ref="scriptRowRef"
        class="flex min-w-0 items-center justify-start gap-1.5 mt-3 mb-2.5 flex-nowrap overflow-visible"
      >
        <button
          v-for="script in visibleScripts"
          :key="script.id"
          :title="script.command"
          @click="handleScriptToggle($event, script.id, script.status)"
          :disabled="isUnavailable || script.status === 'STOPPING'"
          :class="
            cn(
              'inline-flex flex-none min-w-max items-center gap-1.5 whitespace-nowrap text-[10px] font-bold px-2 py-0.5 rounded border transition-colors',
              script.status === 'RUNNING'
                ? 'text-status-running bg-status-running/10 border-status-running/30 hover:bg-status-running/15'
                : script.status === 'STOPPING'
                  ? 'text-status-warning bg-status-warning/10 border-status-warning/30 cursor-wait'
                  : 'text-on-surface-variant bg-surface-variant border-transparent hover:text-on-surface hover:bg-surface-container-high',
            )
          "
        >
          <Square
            v-if="script.status === 'RUNNING' || script.status === 'STOPPING'"
            :size="8"
            class="shrink-0"
            fill="currentColor"
          />
          <Play v-else :size="9" class="shrink-0" fill="currentColor" />
          <span>{{ script.name }}</span>
        </button>
        <div v-if="hiddenScriptCount > 0" ref="moreScriptsRef" class="relative shrink-0">
          <button
            type="button"
            @click="toggleMoreScripts"
            class="inline-flex flex-none items-center justify-center whitespace-nowrap text-[10px] font-bold text-on-surface-variant bg-surface-variant px-2 py-0.5 rounded border border-transparent transition-colors hover:text-on-surface hover:bg-surface-container-high"
            aria-haspopup="menu"
            :aria-expanded="moreScriptsOpen"
            :aria-label="`显示 ${hiddenScriptCount} 个隐藏脚本`"
            :title="
              hiddenRunningCount > 0
                ? t.projectActions.moreRunning.replace('{count}', String(hiddenRunningCount))
                : undefined
            "
          >
            <ChevronDown :size="10" />
          </button>
          <div
            v-if="moreScriptsOpen"
            class="absolute right-0 top-[calc(100%+0.25rem)] z-30 w-44 overflow-hidden rounded-lg border border-outline-variant/80 bg-surface-container-lowest p-1 shadow-[0_18px_44px_rgba(0,0,0,0.20),0_0_0_1px_rgba(255,255,255,0.45)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)]"
            @click.stop
            role="menu"
          >
            <button
              v-for="script in hiddenScripts"
              :key="script.id"
              type="button"
              @click="handleScriptToggle($event, script.id, script.status)"
              :disabled="isUnavailable || script.status === 'STOPPING'"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-50"
              :title="script.command"
              :aria-label="
                script.status === 'RUNNING'
                  ? `${t.scripts.stopScript}: ${script.name}`
                  : script.status === 'STOPPING'
                    ? `${t.common.stopping}: ${script.name}`
                    : `${t.scripts.startScript}: ${script.name}`
              "
              role="menuitem"
            >
              <Square
                v-if="script.status === 'RUNNING' || script.status === 'STOPPING'"
                :size="9"
                :class="script.status === 'STOPPING' ? 'shrink-0 text-status-warning' : 'shrink-0 text-status-running'"
                fill="currentColor"
              />
              <Play v-else :size="10" class="shrink-0" fill="currentColor" />
              <span class="truncate">{{ script.name }}</span>
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="prioritizedScripts.length > 0"
        ref="scriptMeasureRef"
        class="pointer-events-none fixed -left-[10000px] top-0 flex items-center gap-1.5 opacity-0"
        aria-hidden="true"
      >
        <span
          v-for="script in prioritizedScripts"
          :key="script.id"
          data-script-measure-button
          :class="
            cn(
              'inline-flex flex-none min-w-max items-center gap-1.5 whitespace-nowrap text-[10px] font-bold px-2 py-0.5 rounded border',
              script.status === 'RUNNING'
                ? 'border-status-running/30'
                : script.status === 'STOPPING'
                  ? 'border-status-warning/30'
                  : 'border-transparent',
            )
          "
        >
          <Square
            v-if="script.status === 'RUNNING' || script.status === 'STOPPING'"
            :size="8"
            class="shrink-0"
            fill="currentColor"
          />
          <Play v-else :size="9" class="shrink-0" fill="currentColor" />
          <span>{{ script.name }}</span>
        </span>
        <span
          data-script-more-measure
          class="inline-flex flex-none items-center justify-center whitespace-nowrap text-[10px] font-bold px-2 py-0.5 rounded border border-transparent"
        >
          <ChevronDown :size="10" />
        </span>
      </div>

      <div
        class="mt-auto grid min-h-7 grid-cols-[minmax(0,1fr)_6.75rem] items-center gap-2 overflow-hidden border-t border-border-subtle pt-2"
      >
        <div class="min-w-0 text-[11px] text-on-surface-variant">
          <span
            v-if="isError"
            class="flex min-w-0 items-center gap-1 truncate text-status-error"
            :title="cardErrorMessage"
          >
            <AlertTriangle :size="12" class="shrink-0" />
            <span class="truncate">{{ cardErrorMessage }}</span>
          </span>
          <span
            v-else
            class="flex min-w-0 items-center gap-1 truncate"
            :title="cardTimeMeta.title || cardTimeMeta.value"
          >
            <span class="shrink-0 text-[11px] text-on-surface-variant/85">{{ cardTimeMeta.symbol }}</span>
            <span class="truncate">{{ cardTimeMeta.value }}</span>
          </span>
        </div>
        <div
          :class="
            cn(
              'flex w-[6.75rem] shrink-0 items-center justify-end gap-0.5 transition-all',
              isSorting
                ? 'opacity-100'
                : 'opacity-0 translate-y-1 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:pointer-events-auto',
            )
          "
          @click.stop
        >
          <template v-if="isSorting" />
          <template v-else>
            <button
              @click.stop="handleOpenTerminal"
              class="p-1 text-on-surface-variant/70 hover:text-status-running rounded hover:bg-on-surface/5 transition-colors"
              :disabled="isUnavailable"
              :title="t.projectActions.openInTerminal"
              :aria-label="t.projectActions.openInTerminal"
            >
              <TerminalSquare :size="15" />
            </button>
            <button
              @click.stop="handleOpenEditor"
              class="p-1 text-on-surface-variant/70 hover:text-primary rounded hover:bg-on-surface/5 transition-colors"
              :disabled="isUnavailable"
              :title="t.projectActions.openInEditor"
              :aria-label="t.projectActions.openInEditor"
            >
              <Code2 :size="15" />
            </button>
            <button
              @click.stop="handleOpenFolder"
              class="p-1 text-on-surface-variant/70 hover:text-on-surface rounded hover:bg-on-surface/5 transition-colors"
              :disabled="isUnavailable"
              :title="t.common.openFolder"
              :aria-label="t.common.openFolder"
            >
              <FolderOpen :size="15" />
            </button>
            <button
              @click.stop="handleEdit"
              class="p-1 text-on-surface-variant/70 hover:text-primary rounded hover:bg-on-surface/5 transition-colors"
              :title="t.common.edit"
              :aria-label="t.common.edit"
            >
              <Pencil :size="15" />
            </button>
            <button
              @click.stop="handleDelete"
              class="p-1 text-on-surface-variant/70 hover:text-status-error rounded hover:bg-on-surface/5 transition-colors"
              :title="t.projectActions.deleteProject"
              :aria-label="t.projectActions.deleteProject"
            >
              <Trash2 :size="15" />
            </button>
          </template>
        </div>
      </div>
    </div>
    <div
      :class="
        cn(
          'absolute -left-px -top-px -bottom-px w-[5px] rounded-l-lg rounded-r-none pointer-events-none',
          isRunning ? 'bg-status-running' : isError ? 'bg-status-error' : 'transparent',
        )
      "
    />
  </div>
</template>
