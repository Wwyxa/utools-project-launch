<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  History,
  Play,
  Plus,
  Power,
  Trash2,
  X,
} from "lucide-vue-next";
import type {
  Project,
  ProjectAutomationExitConfig,
  ProjectAutomationHistoryEntry,
  ProjectAutomationInputStep,
  ProjectAutomationMissedPolicy,
  ProjectAutomationSchedule,
  ProjectAutomationTask,
} from "../../types";
import { dateKey, generateAutomationDailyPlan, getNextAutomationPlanEntry } from "../../lib/automationScheduler";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";

const props = defineProps<{ project: Project }>();

const store = useStore();
const t = useI18n();
const editingTaskId = ref<string | null>(null);
const formDialogOpen = ref(false);
const feedback = ref("");
const isMissedPolicyMenuOpen = ref(false);

interface AutomationFormState {
  name: string;
  enabled: boolean;
  scriptIds: string[];
  scheduleType: "fixed" | "random";
  startTime: string;
  dailyCount: number;
  intervalMinutes: number;
  windowStart: string;
  windowEnd: string;
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
  missedPolicy: ProjectAutomationMissedPolicy;
  missedGraceMinutes: number;
  notifyEnabled: boolean;
  maxScriptRuntimeMinutes: number;
  inputConfigs: Record<string, ProjectAutomationInputStep[]>;
  exitConfigs: Record<string, ProjectAutomationExitConfig>;
}

const createDefaultForm = (): AutomationFormState => ({
  name: t.value.automation.defaultTaskName,
  enabled: true,
  scriptIds: props.project.scripts[0] ? [props.project.scripts[0].id] : [],
  scheduleType: "fixed",
  startTime: "09:00",
  dailyCount: 1,
  intervalMinutes: 60,
  windowStart: "09:00",
  windowEnd: "18:00",
  minIntervalMinutes: 30,
  maxIntervalMinutes: 180,
  missedPolicy: "grace-run",
  missedGraceMinutes: 5,
  notifyEnabled: true,
  maxScriptRuntimeMinutes: 30,
  inputConfigs: {},
  exitConfigs: {},
});

const form = reactive<AutomationFormState>(createDefaultForm());
const tasks = computed(() => props.project.automationTasks || []);
const activeProjectRunId = computed(() => store.automationActiveProjectRuns[props.project.id] || "");
const today = computed(() => dateKey());
const missedPolicyOptions = computed<{ id: ProjectAutomationMissedPolicy; label: string }[]>(() => [
  { id: "grace-run", label: t.value.automation.missedPolicyGraceRun },
  { id: "run-now", label: t.value.automation.missedPolicyRunNow },
  { id: "mark-missed", label: t.value.automation.missedPolicyMarkMissed },
]);
const missedPolicyLabel = computed(
  () =>
    missedPolicyOptions.value.find((option) => option.id === form.missedPolicy)?.label ||
    t.value.automation.missedPolicyGraceRun,
);

const resetForm = () => {
  Object.assign(form, createDefaultForm());
  editingTaskId.value = null;
  feedback.value = "";
  isMissedPolicyMenuOpen.value = false;
};

const openCreateTask = () => {
  resetForm();
  formDialogOpen.value = true;
};

const closeForm = () => {
  formDialogOpen.value = false;
  resetForm();
};

const scheduleFromForm = (): ProjectAutomationSchedule =>
  form.scheduleType === "fixed"
    ? {
        type: "fixed",
        startTime: form.startTime,
        dailyCount: Number(form.dailyCount),
        intervalMinutes: Number(form.intervalMinutes),
      }
    : {
        type: "random",
        windowStart: form.windowStart,
        windowEnd: form.windowEnd,
        dailyCount: Number(form.dailyCount),
        minIntervalMinutes: Number(form.minIntervalMinutes),
        maxIntervalMinutes: Number(form.maxIntervalMinutes),
      };

const inputConfigsFromForm = () =>
  Object.entries(form.inputConfigs)
    .filter(([scriptId]) => form.scriptIds.includes(scriptId))
    .map(([scriptId, steps]) => ({ scriptId, steps }));

const exitConfigsFromForm = () =>
  Object.values(form.exitConfigs).filter((config) => form.scriptIds.includes(config.scriptId));

const loadTask = (task: ProjectAutomationTask) => {
  editingTaskId.value = task.id;
  feedback.value = "";
  isMissedPolicyMenuOpen.value = false;
  form.name = task.name;
  form.enabled = task.enabled;
  form.scriptIds = [...task.scriptIds];
  form.scheduleType = task.schedule.type;
  if (task.schedule.type === "fixed") {
    form.startTime = task.schedule.startTime;
    form.dailyCount = task.schedule.dailyCount;
    form.intervalMinutes = task.schedule.intervalMinutes;
  } else {
    form.windowStart = task.schedule.windowStart;
    form.windowEnd = task.schedule.windowEnd;
    form.dailyCount = task.schedule.dailyCount;
    form.minIntervalMinutes = task.schedule.minIntervalMinutes;
    form.maxIntervalMinutes = task.schedule.maxIntervalMinutes;
  }
  form.missedPolicy = task.missedPolicy;
  form.missedGraceMinutes = task.missedGraceMinutes;
  form.notifyEnabled = task.notifyEnabled;
  form.maxScriptRuntimeMinutes = task.maxScriptRuntimeMinutes;
  form.inputConfigs = Object.fromEntries(task.inputConfigs.map((config) => [config.scriptId, [...config.steps]]));
  form.exitConfigs = Object.fromEntries(task.exitConfigs.map((config) => [config.scriptId, { ...config }]));
};

const openEditTask = (task: ProjectAutomationTask) => {
  loadTask(task);
  formDialogOpen.value = true;
};

const toggleScript = (scriptId: string) => {
  form.scriptIds = form.scriptIds.includes(scriptId)
    ? form.scriptIds.filter((id) => id !== scriptId)
    : [...form.scriptIds, scriptId];
};

const moveSelectedScript = (scriptId: string, direction: "up" | "down") => {
  const currentIndex = form.scriptIds.indexOf(scriptId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= form.scriptIds.length) {
    return;
  }

  const nextScriptIds = [...form.scriptIds];
  const [scriptIdToMove] = nextScriptIds.splice(currentIndex, 1);
  nextScriptIds.splice(targetIndex, 0, scriptIdToMove);
  form.scriptIds = nextScriptIds;
};

const selectMissedPolicy = (policy: ProjectAutomationMissedPolicy) => {
  form.missedPolicy = policy;
  isMissedPolicyMenuOpen.value = false;
};

const selectedScripts = computed(() =>
  form.scriptIds
    .map((scriptId) => props.project.scripts.find((script) => script.id === scriptId))
    .filter((script): script is Project["scripts"][number] => Boolean(script)),
);

const orderedScripts = computed(() => {
  const selectedScriptIds = new Set(form.scriptIds);
  const selected = selectedScripts.value;
  const unselected = props.project.scripts.filter((script) => !selectedScriptIds.has(script.id));
  return [...selected, ...unselected];
});

const addInputStep = (scriptId: string) => {
  form.inputConfigs[scriptId] = [
    ...(form.inputConfigs[scriptId] || []),
    {
      id: `step-${Date.now()}`,
      mode: "output-match",
      value: "",
      delayMs: 1000,
      matchText: "",
      timeoutMs: 30000,
    },
  ];
};

const removeInputStep = (scriptId: string, stepId: string) => {
  form.inputConfigs[scriptId] = (form.inputConfigs[scriptId] || []).filter((step) => step.id !== stepId);
};

const toggleExitConfig = (scriptId: string) => {
  const current = form.exitConfigs[scriptId];
  form.exitConfigs[scriptId] = {
    scriptId,
    enabled: !current?.enabled,
    matchText: current?.matchText || "",
  };
};

const saveTask = () => {
  const patch: Partial<ProjectAutomationTask> = {
    name: form.name.trim(),
    enabled: form.enabled,
    scriptIds: form.scriptIds,
    schedule: scheduleFromForm(),
    missedPolicy: form.missedPolicy,
    missedGraceMinutes: Number(form.missedGraceMinutes),
    notifyEnabled: form.notifyEnabled,
    maxScriptRuntimeMinutes: Number(form.maxScriptRuntimeMinutes),
    inputConfigs: inputConfigsFromForm(),
    exitConfigs: exitConfigsFromForm(),
  };
  const result = editingTaskId.value
    ? store.updateAutomationTask(props.project.id, editingTaskId.value, patch)
    : store.createAutomationTask(props.project.id, patch);
  feedback.value = result.message;
  if (result.ok) {
    closeForm();
  }
};

const taskPlan = (task: ProjectAutomationTask) =>
  task.dailyPlans.find((plan) => plan.date === today.value) ||
  generateAutomationDailyPlan(task.id, task.schedule, today.value);

const nextRun = (task: ProjectAutomationTask) => getNextAutomationPlanEntry(task.dailyPlans)?.plannedAt || "";
const scriptName = (scriptId: string) =>
  props.project.scripts.find((script) => script.id === scriptId)?.name || scriptId;
const formatDateTime = (value?: string) => (value ? new Date(value).toLocaleString() : t.value.common.never);
const formatTime = (value: string) =>
  value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";
const formatMinutes = (minutes: number) => t.value.automation.minutes.replace("{count}", String(minutes));
const historyTime = (entry: ProjectAutomationHistoryEntry) =>
  new Date(entry.endedAt || entry.startedAt || entry.plannedAt || 0).getTime();
const taskHistory = (task: ProjectAutomationTask) =>
  [...task.history].sort((left, right) => historyTime(right) - historyTime(left));
const latestHistory = (task: ProjectAutomationTask) => taskHistory(task)[0];
const runningEntry = (task: ProjectAutomationTask) =>
  task.dailyPlans.flatMap((plan) => plan.entries).find((entry) => entry.status === "running") || null;
const taskCurrentStatus = (task: ProjectAutomationTask) =>
  runningEntry(task)?.status || latestHistory(task)?.status || "pending";
const canRunTaskNow = (task: ProjectAutomationTask) => !runningEntry(task) && task.scriptIds.length > 0;

const statusLabel = (status: string) => {
  if (status === "completed") return t.value.automation.completed;
  if (status === "failed") return t.value.automation.failed;
  if (status === "skipped") return t.value.automation.skipped;
  if (status === "missed") return t.value.automation.missed;
  if (status === "running") return t.value.common.running;
  return t.value.automation.pending;
};

const statusClass = (status: string) =>
  status === "running"
    ? "border-status-info/30 bg-status-info/10 text-status-info"
    : status === "completed"
      ? "border-status-running/30 bg-status-running/10 text-status-running"
      : status === "failed"
        ? "border-status-error/30 bg-status-error/10 text-status-error"
        : status === "skipped" || status === "missed"
          ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
          : "border-border-subtle bg-surface-container-low text-on-surface-variant";
</script>

<template>
  <div class="h-full min-h-0 overflow-hidden">
    <section
      class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm"
    >
      <div class="ui-panel-header">
        <div class="ui-panel-title">
          <CalendarClock :size="14" class="text-primary" />
          <span>{{ t.automation.title }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="ui-panel-meta">{{ tasks.length }}</span>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2 py-1 text-xs font-semibold text-on-surface hover:bg-surface-variant"
            :title="t.automation.newTask"
            :aria-label="t.automation.newTask"
            @click="openCreateTask"
          >
            <Plus :size="13" />
            {{ t.automation.newTask }}
          </button>
        </div>
      </div>
      <div class="themed-scrollbar h-full min-h-0 space-y-3 overflow-auto p-3 pb-12">
        <div
          v-if="tasks.length === 0"
          class="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border-subtle bg-surface-container-low p-6 text-sm text-on-surface-variant"
        >
          <span>{{ t.automation.empty }}</span>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90"
            @click="openCreateTask"
          >
            <Plus :size="13" />
            {{ t.automation.newTask }}
          </button>
        </div>
        <article
          v-for="task in tasks"
          :key="task.id"
          class="rounded-lg border border-border-subtle bg-surface-container-low p-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="truncate text-sm font-bold text-on-surface">{{ task.name }}</h3>
                <span
                  :class="
                    cn(
                      'rounded-full border px-2 py-0.5 text-[10px] font-bold',
                      task.enabled
                        ? 'border-status-running/30 bg-status-running/10 text-status-running'
                        : 'border-border-subtle bg-surface text-on-surface-variant',
                    )
                  "
                >
                  {{ task.enabled ? t.automation.enabled : t.automation.disabled }}
                </span>
              </div>
              <p class="mt-1 truncate text-xs text-on-surface-variant">
                {{ task.scriptIds.map(scriptName).join(" -> ") }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                class="rounded-lg border border-border-subtle bg-surface p-1.5 text-on-surface-variant hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="!canRunTaskNow(task)"
                :title="t.automation.runNow"
                :aria-label="t.automation.runNow"
                @click="store.runAutomationTaskNow(project.id, task.id)"
              >
                <Play :size="14" />
              </button>
              <button
                type="button"
                :class="
                  cn(
                    'rounded-lg border p-1.5 text-on-surface-variant hover:bg-surface-variant',
                    task.enabled
                      ? 'border-status-running/30 bg-status-running/10 text-status-running'
                      : 'border-border-subtle bg-surface',
                  )
                "
                :title="task.enabled ? t.automation.disableTask : t.automation.enableTask"
                :aria-label="task.enabled ? t.automation.disableTask : t.automation.enableTask"
                @click="store.updateAutomationTask(project.id, task.id, { enabled: !task.enabled })"
              >
                <Power :size="14" />
              </button>
              <button
                type="button"
                class="rounded-lg border border-border-subtle bg-surface p-1.5 text-on-surface-variant hover:bg-surface-variant"
                :title="task.notifyEnabled ? t.automation.notificationsOn : t.automation.notificationsOff"
                :aria-label="task.notifyEnabled ? t.automation.notificationsOn : t.automation.notificationsOff"
                @click="store.updateAutomationTask(project.id, task.id, { notifyEnabled: !task.notifyEnabled })"
              >
                <Bell v-if="task.notifyEnabled" :size="14" />
                <BellOff v-else :size="14" />
              </button>
              <button
                type="button"
                class="rounded-lg border border-border-subtle bg-surface px-2 py-1 text-xs font-semibold text-on-surface hover:bg-surface-variant"
                @click="openEditTask(task)"
              >
                {{ t.common.edit }}
              </button>
              <button
                type="button"
                class="rounded-lg border border-border-subtle bg-surface p-1.5 text-on-surface-variant hover:bg-status-error/10 hover:text-status-error"
                :title="t.common.delete"
                :aria-label="t.common.delete"
                @click="store.deleteAutomationTask(project.id, task.id)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div class="rounded-lg border border-border-subtle bg-surface px-2 py-2">
              <div class="text-[10px] font-semibold text-on-surface-variant">{{ t.automation.nextRun }}</div>
              <div class="mt-1 truncate font-mono font-bold text-on-surface">{{ formatDateTime(nextRun(task)) }}</div>
            </div>
            <div class="rounded-lg border border-border-subtle bg-surface px-2 py-2">
              <div class="text-[10px] font-semibold text-on-surface-variant">{{ t.automation.latestResult }}</div>
              <div
                :class="
                  cn(
                    'mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold',
                    statusClass(taskCurrentStatus(task)),
                  )
                "
              >
                <span
                  v-if="taskCurrentStatus(task) === 'running'"
                  class="h-1.5 w-1.5 rounded-full bg-status-info animate-pulse"
                />
                {{ statusLabel(taskCurrentStatus(task)) }}
              </div>
            </div>
            <div class="rounded-lg border border-border-subtle bg-surface px-2 py-2">
              <div class="text-[10px] font-semibold text-on-surface-variant">{{ t.automation.maxRuntime }}</div>
              <div class="mt-1 font-mono font-bold text-on-surface">
                {{ formatMinutes(task.maxScriptRuntimeMinutes) }}
              </div>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <span
              v-for="entry in taskPlan(task).entries"
              :key="entry.id"
              :class="
                cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold',
                  statusClass(entry.status),
                )
              "
            >
              <Clock :size="11" /> {{ formatTime(entry.plannedAt) }} · {{ statusLabel(entry.status) }}
            </span>
          </div>
          <details class="mt-3 rounded-lg border border-border-subtle bg-surface px-3 py-2">
            <summary
              class="flex cursor-pointer list-none items-center gap-2 text-xs font-bold text-on-surface [&::-webkit-details-marker]:hidden"
            >
              <History :size="13" class="text-primary" /> {{ t.automation.history }}
            </summary>
            <div class="mt-2 space-y-2">
              <div v-if="taskHistory(task).length === 0" class="text-xs text-on-surface-variant">
                {{ t.common.noData }}
              </div>
              <div
                v-for="entry in taskHistory(task)"
                :key="entry.id"
                class="rounded-md border border-border-subtle bg-surface-container-low px-2 py-2 text-xs"
              >
                <div class="flex items-center justify-between gap-2">
                  <span
                    :class="cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', statusClass(entry.status))"
                    >{{ statusLabel(entry.status) }}</span
                  >
                  <span class="font-mono text-[10px] text-on-surface-variant">{{ formatDateTime(entry.endedAt) }}</span>
                </div>
                <div class="mt-1 grid gap-1 text-[10px] text-on-surface-variant sm:grid-cols-2">
                  <span>{{ t.automation.plannedAt }}: {{ formatDateTime(entry.plannedAt) }}</span>
                  <span>{{ t.automation.finishedAt }}: {{ formatDateTime(entry.endedAt) }}</span>
                </div>
                <p v-if="entry.reason" class="mt-1 text-on-surface-variant">{{ entry.reason }}</p>
              </div>
            </div>
          </details>
        </article>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="scale">
        <div v-if="formDialogOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            class="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-xl"
            @click.stop="isMissedPolicyMenuOpen = false"
          >
            <div class="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
              <div class="min-w-0">
                <h3 class="text-sm font-bold text-on-surface">
                  {{ editingTaskId ? t.automation.editTask : t.automation.createTask }}
                </h3>
                <p class="mt-0.5 text-xs text-on-surface-variant">{{ t.automation.formHint }}</p>
              </div>
              <button
                type="button"
                class="rounded-lg border border-border-subtle bg-surface-container-low p-1.5 text-on-surface-variant hover:bg-surface-variant"
                :title="t.common.close"
                :aria-label="t.common.close"
                @click.stop="closeForm"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="themed-scrollbar min-h-0 flex-1 overflow-auto p-4">
              <div class="space-y-3 text-xs">
                <section class="rounded-lg border border-border-subtle bg-surface-container-low p-3">
                  <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem]">
                    <label class="block">
                      <span class="mb-1 block font-semibold text-on-surface-variant">{{ t.automation.taskName }}</span>
                      <input
                        v-model="form.name"
                        type="text"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                      />
                    </label>
                    <label class="block">
                      <span class="mb-1 block font-semibold text-on-surface-variant">{{
                        t.automation.maxRuntime
                      }}</span>
                      <input
                        v-model.number="form.maxScriptRuntimeMinutes"
                        type="number"
                        min="1"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-on-surface"
                      />
                    </label>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <label
                      class="inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 font-semibold text-on-surface"
                    >
                      <input v-model="form.enabled" type="checkbox" /> {{ t.automation.enabled }}
                    </label>
                    <label
                      class="inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 font-semibold text-on-surface"
                    >
                      <input v-model="form.notifyEnabled" type="checkbox" /> {{ t.automation.notifications }}
                    </label>
                  </div>
                </section>
                <section class="rounded-lg border border-border-subtle bg-surface-container-low p-3">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div class="font-semibold text-on-surface">{{ t.automation.scripts }}</div>
                      <p class="mt-0.5 text-[11px] text-on-surface-variant">{{ t.automation.scriptOrderHint }}</p>
                    </div>
                    <span
                      class="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[10px] font-bold text-on-surface-variant"
                    >
                      {{ selectedScripts.length }}
                    </span>
                  </div>
                  <div class="space-y-1">
                    <label
                      v-for="script in orderedScripts"
                      :key="script.id"
                      class="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-on-surface"
                    >
                      <input
                        type="checkbox"
                        :checked="form.scriptIds.includes(script.id)"
                        @change="toggleScript(script.id)"
                      />
                      <span class="truncate font-mono">{{ script.name }}</span>
                      <span v-if="form.scriptIds.includes(script.id)" class="ml-auto flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          class="rounded border border-border-subtle bg-surface p-1 text-on-surface-variant hover:bg-surface-variant disabled:opacity-40"
                          :disabled="form.scriptIds.indexOf(script.id) === 0"
                          :title="t.automation.moveScriptUp"
                          :aria-label="t.automation.moveScriptUp"
                          @click.prevent="moveSelectedScript(script.id, 'up')"
                        >
                          <ArrowUp :size="12" />
                        </button>
                        <button
                          type="button"
                          class="rounded border border-border-subtle bg-surface p-1 text-on-surface-variant hover:bg-surface-variant disabled:opacity-40"
                          :disabled="form.scriptIds.indexOf(script.id) === form.scriptIds.length - 1"
                          :title="t.automation.moveScriptDown"
                          :aria-label="t.automation.moveScriptDown"
                          @click.prevent="moveSelectedScript(script.id, 'down')"
                        >
                          <ArrowDown :size="12" />
                        </button>
                      </span>
                    </label>
                  </div>
                </section>
                <section class="rounded-lg border border-border-subtle bg-surface-container-low p-3">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <div class="font-semibold text-on-surface">{{ t.automation.schedule }}</div>
                    <div class="flex rounded-lg border border-border-subtle bg-surface p-1">
                      <button
                        type="button"
                        :class="
                          cn(
                            'rounded-md px-3 py-1.5 font-bold',
                            form.scheduleType === 'fixed' ? 'bg-primary text-on-primary' : 'text-on-surface-variant',
                          )
                        "
                        @click="form.scheduleType = 'fixed'"
                      >
                        {{ t.automation.fixed }}
                      </button>
                      <button
                        type="button"
                        :class="
                          cn(
                            'rounded-md px-3 py-1.5 font-bold',
                            form.scheduleType === 'random' ? 'bg-primary text-on-primary' : 'text-on-surface-variant',
                          )
                        "
                        @click="form.scheduleType = 'random'"
                      >
                        {{ t.automation.random }}
                      </button>
                    </div>
                  </div>
                  <div v-if="form.scheduleType === 'fixed'" class="grid gap-2 sm:grid-cols-3">
                    <label>
                      <span class="mb-1 block text-on-surface-variant">{{ t.automation.startTime }}</span>
                      <input
                        v-model="form.startTime"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 font-mono"
                      />
                    </label>
                    <label>
                      <span class="mb-1 block text-on-surface-variant">{{ t.automation.dailyCount }}</span>
                      <input
                        v-model.number="form.dailyCount"
                        type="number"
                        min="1"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"
                      />
                    </label>
                    <label>
                      <span class="mb-1 block text-on-surface-variant">{{ t.automation.interval }}</span>
                      <input
                        v-model.number="form.intervalMinutes"
                        type="number"
                        min="1"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"
                      />
                    </label>
                  </div>
                  <div v-else class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <label>
                      <span class="mb-1 block text-on-surface-variant">{{ t.automation.windowStart }}</span>
                      <input
                        v-model="form.windowStart"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 font-mono"
                      />
                    </label>
                    <label>
                      <span class="mb-1 block text-on-surface-variant">{{ t.automation.windowEnd }}</span>
                      <input
                        v-model="form.windowEnd"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 font-mono"
                      />
                    </label>
                    <label>
                      <span class="mb-1 block text-on-surface-variant">{{ t.automation.dailyCount }}</span>
                      <input
                        v-model.number="form.dailyCount"
                        type="number"
                        min="1"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"
                      />
                    </label>
                    <label>
                      <span class="mb-1 block text-on-surface-variant">{{ t.automation.minInterval }}</span>
                      <input
                        v-model.number="form.minIntervalMinutes"
                        type="number"
                        min="0"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"
                      />
                    </label>
                    <label>
                      <span class="mb-1 block text-on-surface-variant">{{ t.automation.maxInterval }}</span>
                      <input
                        v-model.number="form.maxIntervalMinutes"
                        type="number"
                        min="1"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"
                      />
                    </label>
                  </div>
                  <div class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <div>
                      <span class="mb-1 block text-on-surface-variant">{{ t.automation.missedPolicy }}</span>
                      <div class="relative" @click.stop>
                        <button
                          type="button"
                          class="ui-field flex w-full items-center justify-between gap-2 text-left font-normal"
                          @click="isMissedPolicyMenuOpen = !isMissedPolicyMenuOpen"
                        >
                          <span>{{ missedPolicyLabel }}</span>
                          <ChevronDown :size="14" class="text-on-surface-variant" />
                        </button>
                        <div v-if="isMissedPolicyMenuOpen" class="mode-menu-popover" @click.stop>
                          <button
                            v-for="option in missedPolicyOptions"
                            :key="option.id"
                            type="button"
                            :class="
                              cn(
                                'mode-menu-item text-xs font-normal',
                                form.missedPolicy === option.id && 'bg-primary/10 text-primary',
                              )
                            "
                            @click="selectMissedPolicy(option.id)"
                          >
                            <span>{{ option.label }}</span>
                            <Check v-if="form.missedPolicy === option.id" :size="13" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <label v-if="form.missedPolicy === 'grace-run'">
                      <span class="mb-1 block text-on-surface-variant">{{ t.automation.missedGrace }}</span>
                      <input
                        v-model.number="form.missedGraceMinutes"
                        type="number"
                        min="0"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"
                      />
                    </label>
                  </div>
                </section>
                <details class="rounded-lg border border-border-subtle bg-surface-container-low p-3">
                  <summary
                    class="cursor-pointer list-none font-bold text-on-surface [&::-webkit-details-marker]:hidden"
                  >
                    {{ t.automation.inputSteps }}
                  </summary>
                  <p class="mt-1 text-[11px] leading-4 text-on-surface-variant">
                    {{ t.automation.outputMatchScopeHint }}
                  </p>
                  <div
                    v-for="scriptId in form.scriptIds"
                    :key="scriptId"
                    class="mt-2 rounded-lg border border-border-subtle bg-surface p-3"
                  >
                    <div class="mb-2 flex items-center justify-between gap-2">
                      <span class="font-mono font-bold text-on-surface">{{ scriptName(scriptId) }}</span>
                      <button
                        type="button"
                        class="rounded-lg border border-border-subtle px-3 py-1.5 font-semibold text-primary hover:bg-surface-variant"
                        @click="addInputStep(scriptId)"
                      >
                        {{ t.common.add }}
                      </button>
                    </div>
                    <div
                      v-for="step in form.inputConfigs[scriptId] || []"
                      :key="step.id"
                      class="mb-2 space-y-2 rounded-lg border border-border-subtle bg-surface-container-low p-2"
                    >
                      <div class="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          :class="
                            cn(
                              'rounded-md px-3 py-1.5 font-bold',
                              step.mode === 'output-match'
                                ? 'bg-primary text-on-primary'
                                : 'bg-surface text-on-surface-variant',
                            )
                          "
                          @click="step.mode = 'output-match'"
                        >
                          {{ t.automation.outputMatch }}
                        </button>
                        <button
                          type="button"
                          :class="
                            cn(
                              'rounded-md px-3 py-1.5 font-bold',
                              step.mode === 'delay'
                                ? 'bg-primary text-on-primary'
                                : 'bg-surface text-on-surface-variant',
                            )
                          "
                          @click="step.mode = 'delay'"
                        >
                          {{ t.automation.delay }}
                        </button>
                        <button
                          type="button"
                          class="ml-auto rounded-md px-2 py-1.5 text-status-error hover:bg-status-error/10"
                          @click="removeInputStep(scriptId, step.id)"
                        >
                          <Trash2 :size="13" />
                        </button>
                      </div>
                      <input
                        v-model="step.value"
                        class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"
                        :placeholder="t.automation.inputValue"
                      />
                      <div class="grid gap-2 sm:grid-cols-2">
                        <template v-if="step.mode === 'output-match'">
                          <label class="block">
                            <span class="mb-1 block text-[11px] font-semibold text-on-surface-variant">
                              {{ t.automation.matchText }}
                            </span>
                            <input
                              v-model="step.matchText"
                              class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"
                            />
                          </label>
                          <label class="block">
                            <span class="mb-1 block text-[11px] font-semibold text-on-surface-variant">
                              {{ t.automation.timeoutMs }}
                            </span>
                            <input
                              v-model.number="step.timeoutMs"
                              type="number"
                              min="1000"
                              class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"
                            />
                          </label>
                          <p class="sm:col-span-2 text-[11px] leading-4 text-on-surface-variant">
                            {{ t.automation.timeoutHint }}
                          </p>
                        </template>
                        <template v-else>
                          <label class="block">
                            <span class="mb-1 block text-[11px] font-semibold text-on-surface-variant">
                              {{ t.automation.delayMs }}
                            </span>
                            <input
                              v-model.number="step.delayMs"
                              type="number"
                              min="0"
                              class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2"
                            />
                          </label>
                          <p class="sm:col-span-2 text-[11px] leading-4 text-on-surface-variant">
                            {{ t.automation.delayHint }}
                          </p>
                        </template>
                      </div>
                    </div>
                    <label class="mt-2 flex items-center gap-2 text-on-surface-variant">
                      <input
                        type="checkbox"
                        :checked="form.exitConfigs[scriptId]?.enabled"
                        @change="toggleExitConfig(scriptId)"
                      />
                      {{ t.automation.keywordExit }}
                    </label>
                    <input
                      v-if="form.exitConfigs[scriptId]?.enabled"
                      v-model="form.exitConfigs[scriptId].matchText"
                      class="mt-1 w-full rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2"
                      :placeholder="t.automation.exitKeyword"
                    />
                    <p
                      v-if="form.exitConfigs[scriptId]?.enabled"
                      class="mt-1 text-[11px] leading-4 text-on-surface-variant"
                    >
                      {{ t.automation.keywordExitHint }}
                    </p>
                  </div>
                </details>
              </div>
            </div>
            <div class="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3">
              <p
                v-if="feedback"
                class="min-w-0 flex-1 rounded-lg border border-status-error/20 bg-status-error/10 px-3 py-2 text-xs text-status-error"
              >
                {{ feedback }}
              </p>
              <span v-else class="min-w-0 flex-1" />
              <button
                type="button"
                class="rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface hover:bg-surface-variant"
                @click.stop="closeForm"
              >
                {{ t.common.cancel }}
              </button>
              <button
                type="button"
                class="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary/90"
                @click.stop="saveTask"
              >
                {{ t.common.save }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
