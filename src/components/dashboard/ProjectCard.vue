<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
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
} from "lucide-vue-next";
import { Project, ProjectStatus } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import ProjectIcon from "../project/ProjectIcon.vue";

const props = defineProps<{
  project: Project;
  isSorting?: boolean;
  isDragging?: boolean;
}>();

const emit = defineEmits<{
  (e: "select", id: string): void;
}>();

const store = useStore();
const t = useI18n();
const moreScriptsOpen = ref(false);
const moreScriptsRef = ref<HTMLElement | null>(null);

const isRunning = computed(() => props.project.status === ProjectStatus.RUNNING);
const isError = computed(() => props.project.status === ProjectStatus.ERROR);
const isUnavailable = computed(() => props.project.pathExists === false);
const runningScripts = computed(() => props.project.scripts.filter((script) => script.status === "RUNNING"));
const visibleScripts = computed(() => {
  const runningIds = new Set(runningScripts.value.map((script) => script.id));
  const prioritizedScripts = [
    ...runningScripts.value,
    ...props.project.scripts.filter((script) => !runningIds.has(script.id)),
  ];
  const exposedScripts = [];
  const maxVisibleCount = prioritizedScripts.some((script) => script.name.length > 14) ? 1 : 2;

  for (const script of prioritizedScripts) {
    if (exposedScripts.length >= maxVisibleCount) {
      break;
    }
    exposedScripts.push(script);
  }

  return exposedScripts;
});
const hiddenRunningCount = computed(
  () =>
    runningScripts.value.filter((script) => !visibleScripts.value.some((visible) => visible.id === script.id)).length,
);
const hiddenScriptCount = computed(() => props.project.scripts.length - visibleScripts.value.length);
const hiddenScripts = computed(() => {
  const visibleIds = new Set(visibleScripts.value.map((script) => script.id));
  return props.project.scripts.filter((script) => !visibleIds.has(script.id));
});
const projectStack = computed(() => {
  const explicitIcon = props.project.icon;
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
    return "--";
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

  if (absDiff < minute) {
    return diffMs >= 0 ? "刚刚" : "即将";
  }
  if (absDiff < hour) {
    const minutes = Math.max(1, Math.round(absDiff / minute));
    return diffMs >= 0 ? `${minutes} 分钟前` : `${minutes} 分钟后`;
  }
  if (absDiff < day) {
    const hours = Math.max(1, Math.round(absDiff / hour));
    return diffMs >= 0 ? `${hours} 小时前` : `${hours} 小时后`;
  }
  if (absDiff < month) {
    const days = Math.max(1, Math.round(absDiff / day));
    return diffMs >= 0 ? `${days} 天前` : `${days} 天后`;
  }
  if (absDiff < year) {
    const months = Math.max(1, Math.round(absDiff / month));
    return diffMs >= 0 ? `${months} 个月前` : `${months} 个月后`;
  }

  const years = Math.max(1, Math.round(absDiff / year));
  return diffMs >= 0 ? `${years} 年前` : `${years} 年后`;
};

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
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeyDown);
});

const handleDelete = (event: MouseEvent) => {
  event.stopPropagation();
  store.requestDeleteProject(props.project.id);
};
</script>

<template>
  <div
    @click="handleCardSelect"
    :class="
      cn(
        'group relative self-stretch border border-border-subtle rounded-lg bg-surface transition-all overflow-visible hover:bg-surface-container hover:border-primary/35 hover:shadow-[0_0_0_1px_rgba(46,175,125,0.14),0_10px_24px_rgba(0,0,0,0.07)] focus-within:border-primary/50',
        isRunning && 'border-status-running/55 bg-status-running/[0.035] shadow-[0_0_0_1px_rgba(46,175,125,0.14),0_12px_28px_rgba(46,175,125,0.12)] hover:bg-status-running/[0.07] dark:bg-status-running/[0.08] dark:hover:bg-status-running/[0.12]',
        isDragging && 'opacity-55 scale-[0.99]',
        isSorting ? 'cursor-grab ring-1 ring-primary/30 border-primary/60 active:cursor-grabbing' : 'cursor-pointer',
      )
    "
  >
    <div class="p-2.5 min-h-36 h-full flex flex-col">
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

        <GripVertical v-if="isSorting" :size="16" class="shrink-0 text-on-surface-variant/55" />

        <div
          v-if="isError && !isSorting"
          :class="
            cn(
              'shrink-0 inline-flex max-w-[5rem] items-center gap-1 px-1.5 py-1 rounded-full text-[10px] font-bold uppercase whitespace-nowrap',
              'bg-status-error/10 text-status-error',
            )
          "
        >
          <span class="w-1.5 h-1.5 rounded-full bg-status-error" />
          <span class="truncate">
            {{ t.common.error }}
          </span>
        </div>
      </div>

      <p v-if="project.description" class="text-[11px] text-on-surface-variant/85 mt-1 line-clamp-1">
        {{ project.description }}
      </p>
      <p class="font-mono text-[10px] text-on-surface-variant/75 mt-0.5 max-w-full truncate" :title="project.path">
        {{ displayPath }}
      </p>
      <p v-if="isUnavailable" class="text-[11px] text-status-warning mt-1 line-clamp-1">
        {{ project.unavailableReason || "当前设备无法访问该路径" }}
      </p>

      <div
        v-if="visibleScripts.length > 0 || hiddenScriptCount > 0"
        class="flex min-w-0 items-center justify-start gap-1.5 mt-3 mb-2 flex-nowrap overflow-visible"
      >
        <button
          v-for="script in visibleScripts"
          :key="script.id"
          :title="script.command"
          @click="handleScriptToggle($event, script.id, script.status)"
          :disabled="isUnavailable"
          :class="
            cn(
              'inline-flex flex-none min-w-max items-center gap-1.5 whitespace-nowrap text-[10px] font-bold px-2 py-0.5 rounded border transition-colors',
              script.status === 'RUNNING'
                ? 'text-status-running bg-status-running/10 border-status-running/30 hover:bg-status-running/15'
                : 'text-on-surface-variant bg-surface-variant border-transparent hover:text-on-surface hover:bg-surface-container-high',
            )
          "
        >
          <Square v-if="script.status === 'RUNNING'" :size="8" class="shrink-0" fill="currentColor" />
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
              :disabled="isUnavailable"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-50"
              :title="script.command"
              :aria-label="
                script.status === 'RUNNING'
                  ? `${t.scripts.stopScript}: ${script.name}`
                  : `${t.scripts.startScript}: ${script.name}`
              "
              role="menuitem"
            >
              <Square
                v-if="script.status === 'RUNNING'"
                :size="9"
                class="shrink-0 text-status-running"
                fill="currentColor"
              />
              <Play v-else :size="10" class="shrink-0" fill="currentColor" />
              <span class="truncate">{{ script.name }}</span>
            </button>
          </div>
        </div>
      </div>

      <div
        class="mt-auto grid min-h-7 grid-cols-[minmax(0,1fr)_6.75rem] items-center gap-2 overflow-hidden border-t border-border-subtle pt-2"
      >
        <div class="min-w-0 text-[11px] text-on-surface-variant">
          <span v-if="isError" class="flex min-w-0 items-center gap-1 truncate text-status-error">
            <AlertTriangle :size="12" class="shrink-0" /> {{ project.git?.statusText || "Exit code 1" }}
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
