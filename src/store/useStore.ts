import { defineStore } from "pinia";
import { aiStreamChunkRawText } from "../lib/aiReasoning";
import {
  dateKey,
  generateAutomationDailyPlan,
  getNextAutomationPlanEntry,
  validateAutomationSchedule,
} from "../lib/automationScheduler";
import { getProjectBridge, supportsRealProjectBridge } from "../lib/projectBridge";
import { deriveProjectStatus, mergeScriptRuntimeState } from "../lib/projectRuntimeState";
import { DEFAULT_AI_PROMPT_MODES, ProjectStatus } from "../types";
import type {
  AiPreferences,
  AiAnalyzeResult,
  AiStreamChunkPayload,
  AiModelInfo,
  AiPromptMode,
  DefaultTerminalKind,
  DefaultEditorKind,
  EnvironmentPreferences,
  EnvironmentToolKey,
  EnvironmentToolResult,
  Locale,
  LogEntry,
  Project,
  ProjectAutomationDailyPlan,
  ProjectAutomationExitConfig,
  ProjectAutomationHistoryEntry,
  ProjectAutomationInputStep,
  ProjectAutomationMissedPolicy,
  ProjectAutomationPlanEntry,
  ProjectAutomationSchedule,
  ProjectAutomationScriptInputConfig,
  ProjectAutomationScriptResult,
  ProjectAutomationTask,
  ProjectGitActionResult,
  ProjectGitCommitPage,
  ProjectGitCommitMessageDiffResult,
  ProjectConfigFile,
  ProjectBridgeEvent,
  ProjectEnvironmentEntry,
  ProjectFormValue,
  ProjectGitFileChange,
  ProjectGitFileDiffResult,
  ProjectGitSnapshot,
  ProjectGitStatusSnapshot,
  ProjectFileListResult,
  ProjectFileReadResult,
  ProjectFileWriteResult,
  ProjectIconKey,
  ProjectKind,
  ProjectVisibility,
  ProjectScript,
  ProjectScriptFormValue,
  TerminalPreferences,
  EditorPreferences,
  TodoItem,
} from "../types";

const bridge = getProjectBridge();

type AiAnalysisState = "idle" | "loading" | "success" | "warning" | "error";

interface AiStreamHandlers {
  onStart?: () => void;
  onChunk?: (chunk: AiStreamChunkPayload) => void;
  onDone?: (result: AiAnalyzeResult) => void;
}

const createScriptId = (projectId: string, index: number) => `${projectId}-script-${index + 1}`;
const createAiPromptModeId = () => `custom-${Date.now()}`;
const createTodoId = () => `todo-${Date.now()}`;
const createEnvId = () => `env-${Date.now()}`;
const createProjectId = () => `project-${Date.now()}`;
const createAutomationTaskId = () => `automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createAutomationRunId = () => `automation-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const defaultAutomationSchedule = (): ProjectAutomationSchedule => ({
  type: "fixed",
  startTime: "09:00",
  dailyCount: 1,
  intervalMinutes: 60,
});
const PROJECT_CONFIG_MESSAGE_CLEAR_DELAY_MS = 4000;
const AUTOMATION_HISTORY_LIMIT = 20;
const DEFAULT_AUTOMATION_MAX_RUNTIME_MINUTES = 30;
const DEFAULT_AUTOMATION_MISSED_GRACE_MINUTES = 5;
const projectKinds = new Set<ProjectKind>(["node", "python", "go", "executable", "custom"]);
const projectScriptStatuses = new Set<ProjectScript["status"]>(["IDLE", "RUNNING", "STOPPING", "ERROR", "STOPPED"]);
const projectScriptSources = new Set<NonNullable<ProjectScript["source"]>>(["manual", "package-json", "preset"]);
const automationMissedPolicies = new Set<ProjectAutomationMissedPolicy>(["grace-run", "run-now", "mark-missed"]);
let projectConfigMessageClearTimer: number | null = null;
let automationSchedulerTimer: number | null = null;
const gitSnapshotRefreshPromises = new Map<string, Promise<void>>();
const gitStatusRefreshPromises = new Map<string, Promise<void>>();
const gitSnapshotRefreshTokens = new Map<string, symbol>();
const gitMutationVersions = new Map<string, number>();
const gitRefMutationVersions = new Map<string, number>();
const ansiControlPattern =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

interface AutomationScriptRuntimeContext {
  runId: string;
  projectId: string;
  scriptId: string;
  scriptName: string;
  startedAt: string;
  steps: ProjectAutomationInputStep[];
  exitConfig?: ProjectAutomationExitConfig;
  output: string;
  stepIndex: number;
  waitingStepIndex: number | null;
  inputCompleted: boolean;
  settled: boolean;
  stopRequestedByAutomationExit: boolean;
  timers: number[];
  runtimeTimer: number | null;
  resolve: (result: ProjectAutomationScriptResult) => void;
}

const automationScriptContexts = new Map<string, AutomationScriptRuntimeContext>();

function automationScriptContextKey(projectId: string, scriptId: string) {
  return `${projectId}::${scriptId}`;
}

function clearAutomationSchedulerTimer() {
  if (automationSchedulerTimer) {
    window.clearTimeout(automationSchedulerTimer);
    automationSchedulerTimer = null;
  }
}

function clearAutomationContextTimers(context: AutomationScriptRuntimeContext) {
  context.timers.forEach((timer) => window.clearTimeout(timer));
  context.timers = [];
  if (context.runtimeTimer) {
    window.clearTimeout(context.runtimeTimer);
    context.runtimeTimer = null;
  }
}

function clearAutomationStepTimers(context: AutomationScriptRuntimeContext) {
  context.timers.forEach((timer) => window.clearTimeout(timer));
  context.timers = [];
  context.waitingStepIndex = null;
}

function settleAutomationScriptContext(context: AutomationScriptRuntimeContext, result: ProjectAutomationScriptResult) {
  if (context.settled) {
    return;
  }
  context.settled = true;
  clearAutomationContextTimers(context);
  automationScriptContexts.delete(automationScriptContextKey(context.projectId, context.scriptId));
  context.resolve(result);
}

function shouldAutomationExitOnOutput(context: AutomationScriptRuntimeContext) {
  return Boolean(
    context.inputCompleted && context.exitConfig?.matchText && context.output.includes(context.exitConfig.matchText),
  );
}

function cancelProjectConfigMessageClear() {
  if (projectConfigMessageClearTimer) {
    window.clearTimeout(projectConfigMessageClearTimer);
    projectConfigMessageClearTimer = null;
  }
}

function gitMutationVersion(projectId: string) {
  return gitMutationVersions.get(projectId) || 0;
}

function bumpGitMutationVersion(projectId: string) {
  gitMutationVersions.set(projectId, gitMutationVersion(projectId) + 1);
}

function gitRefMutationVersion(projectId: string) {
  return gitRefMutationVersions.get(projectId) || 0;
}

function bumpGitRefMutationVersion(projectId: string) {
  gitRefMutationVersions.set(projectId, gitRefMutationVersion(projectId) + 1);
}

function resolveProjectSortOrder(project: Project, fallbackIndex = 0): number {
  return typeof project.sortOrder === "number" && Number.isFinite(project.sortOrder)
    ? project.sortOrder
    : fallbackIndex;
}

function normalizeQuickLink(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProjectGroup(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProjectVisibility(value: unknown): ProjectVisibility {
  return value === "private" ? "private" : "public";
}

function normalizeProjectKind(value: unknown): ProjectKind {
  return typeof value === "string" && projectKinds.has(value as ProjectKind) ? (value as ProjectKind) : "custom";
}

function normalizeProjectStatus(value: unknown): ProjectStatus {
  return Object.values(ProjectStatus).includes(value as ProjectStatus)
    ? (value as ProjectStatus)
    : ProjectStatus.STOPPED;
}

function normalizeProjectEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((env, [key, entryValue]) => {
    env[key] = typeof entryValue === "string" ? entryValue : String(entryValue ?? "");
    return env;
  }, {});
}

function normalizeProjectScripts(projectId: string, value: unknown): ProjectScript[] {
  const scripts = Array.isArray(value) ? value : [];
  const fallbackProjectId = projectId || "project";

  return scripts.reduce<ProjectScript[]>((normalizedScripts, script, index) => {
    if (!script || typeof script !== "object") {
      return normalizedScripts;
    }

    const candidate = script as Partial<ProjectScript>;
    const source = projectScriptSources.has(candidate.source as NonNullable<ProjectScript["source"]>)
      ? (candidate.source as NonNullable<ProjectScript["source"]>)
      : "manual";
    const status = projectScriptStatuses.has(candidate.status as ProjectScript["status"])
      ? (candidate.status as ProjectScript["status"])
      : "IDLE";

    normalizedScripts.push({
      id:
        typeof candidate.id === "string" && candidate.id.trim()
          ? candidate.id
          : createScriptId(fallbackProjectId, index),
      name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : "start",
      command: typeof candidate.command === "string" ? candidate.command : "",
      status,
      cwd: typeof candidate.cwd === "string" && candidate.cwd.trim() ? candidate.cwd : ".",
      pid: typeof candidate.pid === "number" ? candidate.pid : undefined,
      note: typeof candidate.note === "string" ? candidate.note : "",
      source,
    });

    return normalizedScripts;
  }, []);
}

function normalizeAutomationSchedule(value: unknown): ProjectAutomationSchedule {
  if (!value || typeof value !== "object") {
    return defaultAutomationSchedule();
  }

  const candidate = value as Partial<ProjectAutomationSchedule>;
  if (candidate.type === "random") {
    const schedule: ProjectAutomationSchedule = {
      type: "random",
      windowStart: typeof candidate.windowStart === "string" ? candidate.windowStart : "09:00",
      windowEnd: typeof candidate.windowEnd === "string" ? candidate.windowEnd : "18:00",
      dailyCount: Number.isInteger(candidate.dailyCount) ? Number(candidate.dailyCount) : 1,
      minIntervalMinutes: Number.isInteger(candidate.minIntervalMinutes) ? Number(candidate.minIntervalMinutes) : 30,
      maxIntervalMinutes: Number.isInteger(candidate.maxIntervalMinutes) ? Number(candidate.maxIntervalMinutes) : 180,
    };
    return validateAutomationSchedule(schedule).valid ? schedule : defaultAutomationSchedule();
  }

  const schedule: ProjectAutomationSchedule = {
    type: "fixed",
    startTime: typeof candidate.startTime === "string" ? candidate.startTime : "09:00",
    dailyCount: Number.isInteger(candidate.dailyCount) ? Number(candidate.dailyCount) : 1,
    intervalMinutes: Number.isInteger(candidate.intervalMinutes) ? Number(candidate.intervalMinutes) : 60,
  };
  return validateAutomationSchedule(schedule).valid ? schedule : defaultAutomationSchedule();
}

function normalizeAutomationMissedPolicy(value: unknown): ProjectAutomationMissedPolicy {
  return typeof value === "string" && automationMissedPolicies.has(value as ProjectAutomationMissedPolicy)
    ? (value as ProjectAutomationMissedPolicy)
    : "grace-run";
}

function normalizeAutomationMissedGraceMinutes(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : DEFAULT_AUTOMATION_MISSED_GRACE_MINUTES;
}

function normalizeAutomationInputSteps(value: unknown): ProjectAutomationInputStep[] {
  const steps = Array.isArray(value) ? value : [];
  return steps.reduce<ProjectAutomationInputStep[]>((normalizedSteps, step, index) => {
    if (!step || typeof step !== "object") {
      return normalizedSteps;
    }

    const candidate = step as Partial<ProjectAutomationInputStep>;
    normalizedSteps.push({
      id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `input-step-${index + 1}`,
      mode: candidate.mode === "output-match" ? "output-match" : "delay",
      value: typeof candidate.value === "string" ? candidate.value : "",
      delayMs: Number.isFinite(candidate.delayMs) ? Math.max(0, Number(candidate.delayMs)) : 1000,
      matchText: typeof candidate.matchText === "string" ? candidate.matchText : "",
      timeoutMs: Number.isFinite(candidate.timeoutMs) ? Math.max(1000, Number(candidate.timeoutMs)) : 30000,
    });
    return normalizedSteps;
  }, []);
}

function normalizeAutomationInputConfigs(value: unknown): ProjectAutomationScriptInputConfig[] {
  const configs = Array.isArray(value) ? value : [];
  return configs.reduce<ProjectAutomationScriptInputConfig[]>((normalizedConfigs, config) => {
    if (!config || typeof config !== "object") {
      return normalizedConfigs;
    }

    const candidate = config as Partial<ProjectAutomationScriptInputConfig>;
    if (typeof candidate.scriptId !== "string" || !candidate.scriptId.trim()) {
      return normalizedConfigs;
    }
    normalizedConfigs.push({ scriptId: candidate.scriptId, steps: normalizeAutomationInputSteps(candidate.steps) });
    return normalizedConfigs;
  }, []);
}

function normalizeAutomationExitConfigs(value: unknown): ProjectAutomationExitConfig[] {
  const configs = Array.isArray(value) ? value : [];
  return configs.reduce<ProjectAutomationExitConfig[]>((normalizedConfigs, config) => {
    if (!config || typeof config !== "object") {
      return normalizedConfigs;
    }

    const candidate = config as Partial<ProjectAutomationExitConfig>;
    if (typeof candidate.scriptId !== "string" || !candidate.scriptId.trim()) {
      return normalizedConfigs;
    }
    normalizedConfigs.push({
      scriptId: candidate.scriptId,
      enabled: Boolean(candidate.enabled),
      matchText: typeof candidate.matchText === "string" ? candidate.matchText : "",
    });
    return normalizedConfigs;
  }, []);
}

function normalizeAutomationDailyPlans(value: unknown): ProjectAutomationDailyPlan[] {
  const plans = Array.isArray(value) ? value : [];
  return plans.reduce<ProjectAutomationDailyPlan[]>((normalizedPlans, plan) => {
    if (!plan || typeof plan !== "object") {
      return normalizedPlans;
    }

    const candidate = plan as Partial<ProjectAutomationDailyPlan>;
    const entries = Array.isArray(candidate.entries)
      ? candidate.entries.reduce<ProjectAutomationPlanEntry[]>((normalizedEntries, entry, index) => {
          if (!entry || typeof entry !== "object") {
            return normalizedEntries;
          }
          const planEntry = entry as Partial<ProjectAutomationPlanEntry>;
          if (typeof planEntry.plannedAt !== "string" || !planEntry.plannedAt.trim()) {
            return normalizedEntries;
          }
          normalizedEntries.push({
            id: typeof planEntry.id === "string" && planEntry.id.trim() ? planEntry.id : `plan-entry-${index + 1}`,
            plannedAt: planEntry.plannedAt,
            status:
              planEntry.status === "running" ||
              planEntry.status === "completed" ||
              planEntry.status === "failed" ||
              planEntry.status === "skipped" ||
              planEntry.status === "missed"
                ? planEntry.status
                : "pending",
            runId: typeof planEntry.runId === "string" ? planEntry.runId : undefined,
            reason: typeof planEntry.reason === "string" ? planEntry.reason : undefined,
          });
          return normalizedEntries;
        }, [])
      : [];
    if (typeof candidate.date === "string" && candidate.date.trim()) {
      normalizedPlans.push({ date: candidate.date, entries });
    }
    return normalizedPlans;
  }, []);
}

function normalizeAutomationHistory(value: unknown): ProjectAutomationHistoryEntry[] {
  const history = Array.isArray(value) ? value : [];
  return history
    .reduce<ProjectAutomationHistoryEntry[]>((normalizedHistory, entry, index) => {
      if (!entry || typeof entry !== "object") {
        return normalizedHistory;
      }
      const candidate = entry as Partial<ProjectAutomationHistoryEntry>;
      normalizedHistory.push({
        id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `automation-history-${index + 1}`,
        taskId: typeof candidate.taskId === "string" ? candidate.taskId : "",
        taskName: typeof candidate.taskName === "string" ? candidate.taskName : "",
        projectId: typeof candidate.projectId === "string" ? candidate.projectId : "",
        projectName: typeof candidate.projectName === "string" ? candidate.projectName : "",
        plannedAt: typeof candidate.plannedAt === "string" ? candidate.plannedAt : "",
        startedAt: typeof candidate.startedAt === "string" ? candidate.startedAt : undefined,
        endedAt: typeof candidate.endedAt === "string" ? candidate.endedAt : undefined,
        status:
          candidate.status === "failed" || candidate.status === "skipped" || candidate.status === "missed"
            ? candidate.status
            : "completed",
        reason: typeof candidate.reason === "string" ? candidate.reason : undefined,
        scriptResults: Array.isArray(candidate.scriptResults) ? candidate.scriptResults : [],
      });
      return normalizedHistory;
    }, [])
    .sort(
      (left, right) =>
        new Date(right.endedAt || right.startedAt || right.plannedAt || 0).getTime() -
        new Date(left.endedAt || left.startedAt || left.plannedAt || 0).getTime(),
    )
    .slice(0, AUTOMATION_HISTORY_LIMIT);
}

function normalizeAutomationTasks(projectId: string, value: unknown): ProjectAutomationTask[] {
  const tasks = Array.isArray(value) ? value : [];
  return tasks.reduce<ProjectAutomationTask[]>((normalizedTasks, task, index) => {
    if (!task || typeof task !== "object") {
      return normalizedTasks;
    }

    const candidate = task as Partial<ProjectAutomationTask>;
    const now = new Date().toISOString();
    const automationTask: ProjectAutomationTask = {
      id:
        typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `${projectId}-automation-${index + 1}`,
      name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : `任务 ${index + 1}`,
      enabled: Boolean(candidate.enabled),
      scriptIds: Array.isArray(candidate.scriptIds)
        ? candidate.scriptIds.filter(
            (scriptId): scriptId is string => typeof scriptId === "string" && scriptId.trim().length > 0,
          )
        : [],
      schedule: normalizeAutomationSchedule(candidate.schedule),
      missedPolicy: normalizeAutomationMissedPolicy(candidate.missedPolicy),
      missedGraceMinutes: normalizeAutomationMissedGraceMinutes(candidate.missedGraceMinutes),
      notifyEnabled: candidate.notifyEnabled !== false,
      maxScriptRuntimeMinutes: Number.isFinite(candidate.maxScriptRuntimeMinutes)
        ? Math.max(1, Number(candidate.maxScriptRuntimeMinutes))
        : DEFAULT_AUTOMATION_MAX_RUNTIME_MINUTES,
      inputConfigs: normalizeAutomationInputConfigs(candidate.inputConfigs),
      exitConfigs: normalizeAutomationExitConfigs(candidate.exitConfigs),
      dailyPlans: normalizeAutomationDailyPlans(candidate.dailyPlans),
      history: normalizeAutomationHistory(candidate.history),
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : now,
    };
    normalizedTasks.push(automationTask);
    return normalizedTasks;
  }, []);
}

const currentDeviceId = bridge.loadDeviceId();

function isProjectVisibleOnCurrentDevice(project: Project): boolean {
  return normalizeProjectVisibility(project.visibility) === "public" || project.ownerDeviceId === currentDeviceId;
}

function toPersistedProject(project: Project, sortOrder?: number): Project {
  const projectKind = normalizeProjectKind(project.kind);
  const projectType = typeof project.type === "string" && project.type.trim() ? project.type : "Custom";
  const projectScripts = normalizeProjectScripts(project.id, project.scripts);
  const persistedStatus = project.pathExists === false ? ProjectStatus.WARNING : ProjectStatus.STOPPED;
  const persistedSortOrder =
    typeof sortOrder === "number" && Number.isFinite(sortOrder) ? sortOrder : resolveProjectSortOrder(project);

  return {
    id: project.id,
    name: project.name,
    path: project.path,
    visibility: normalizeProjectVisibility(project.visibility),
    ownerDeviceId: project.ownerDeviceId || currentDeviceId,
    type: projectType,
    kind: projectKind,
    icon: project.icon || inferProjectIcon(projectKind, projectType, project.name),
    cardStyle: project.cardStyle || "default",
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    description: project.description || "",
    status: persistedStatus,
    lastUpdated: project.lastUpdated || "",
    scripts: projectScripts.map((script) => ({
      id: script.id,
      name: script.name,
      command: script.command,
      cwd: script.cwd || ".",
      note: script.note || "",
      source: script.source || "manual",
      status: "IDLE",
    })),
    automationTasks: normalizeAutomationTasks(project.id, project.automationTasks).map((task) => ({
      ...task,
      dailyPlans: normalizeAutomationDailyPlans(task.dailyPlans),
      history: normalizeAutomationHistory(task.history),
    })),
    env: normalizeProjectEnv(project.env),
    memo: project.memo || "",
    todos: project.todos || [],
    git: null,
    gitLatestCommitAt: project.gitLatestCommitAt || project.git?.commits?.[0]?.date || "",
    sortOrder: persistedSortOrder,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function isImportableProject(project: Project): boolean {
  const scripts = Array.isArray(project.scripts) ? project.scripts : [];
  return Boolean(
    project &&
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    project.name.trim() &&
    typeof project.path === "string" &&
    project.path.trim() &&
    scripts.every((script) => typeof script.name === "string" && typeof script.command === "string"),
  );
}

function resolveScriptCwd(projectPath: string, scriptCwd: string | undefined): string {
  const cwd = scriptCwd?.trim();
  if (!cwd || cwd === ".") {
    return projectPath;
  }

  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(cwd)) {
    return cwd;
  }

  return `${projectPath.replace(/[\\/]$/, "")}/${cwd}`;
}

function normalizeGitSnapshot(snapshot: ProjectGitSnapshot | null | undefined): ProjectGitSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    branch: snapshot.branch || "main",
    headHash: snapshot.headHash || "",
    isDetachedHead: Boolean(snapshot.isDetachedHead),
    ahead: snapshot.ahead || 0,
    behind: snapshot.behind || 0,
    files: snapshot.files || [],
    commits: snapshot.commits || [],
    branches: snapshot.branches || [],
    remotes: snapshot.remotes || [],
    upstream: snapshot.upstream || null,
    hasMoreCommits: snapshot.hasMoreCommits || false,
    repositoryPath: snapshot.repositoryPath || "",
    lastRefreshedAt: snapshot.lastRefreshedAt || new Date().toISOString(),
    statusText: snapshot.statusText || "OK",
  };
}

function mergeGitStatusSnapshot(
  currentSnapshot: ProjectGitSnapshot | null | undefined,
  statusSnapshot: ProjectGitStatusSnapshot,
): ProjectGitSnapshot {
  return {
    branch: statusSnapshot.branch || currentSnapshot?.branch || "main",
    headHash: statusSnapshot.headHash || "",
    isDetachedHead: Boolean(statusSnapshot.isDetachedHead),
    ahead: statusSnapshot.ahead || 0,
    behind: statusSnapshot.behind || 0,
    files: statusSnapshot.files || [],
    commits: currentSnapshot?.commits || [],
    branches: statusSnapshot.branches || currentSnapshot?.branches || [],
    remotes: statusSnapshot.remotes || currentSnapshot?.remotes || [],
    upstream: statusSnapshot.upstream || null,
    hasMoreCommits: currentSnapshot?.hasMoreCommits || false,
    repositoryPath: statusSnapshot.repositoryPath || currentSnapshot?.repositoryPath || "",
    lastRefreshedAt: statusSnapshot.lastRefreshedAt || new Date().toISOString(),
    statusText: statusSnapshot.statusText || currentSnapshot?.statusText || "OK",
  };
}

function mergeGitCommitPage(currentSnapshot: ProjectGitSnapshot, commitPage: ProjectGitCommitPage): ProjectGitSnapshot {
  return {
    ...currentSnapshot,
    commits: [...currentSnapshot.commits, ...(commitPage.commits || [])],
    hasMoreCommits: commitPage.hasMoreCommits || false,
    repositoryPath: commitPage.repositoryPath || currentSnapshot.repositoryPath,
    lastRefreshedAt: commitPage.lastRefreshedAt || currentSnapshot.lastRefreshedAt,
  };
}

async function runGitRemoteMutation(
  projectId: string,
  project: Project,
  action: (projectPath: string) => Promise<ProjectGitActionResult>,
  refreshGitSnapshot: (projectId: string, options: { force?: boolean }) => Promise<void> | undefined,
) {
  const result = await action(project.path);
  bumpGitMutationVersion(projectId);
  bumpGitRefMutationVersion(projectId);
  await refreshGitSnapshot(projectId, { force: true });
  return result;
}

function replaceGitCommitPage(
  currentSnapshot: ProjectGitSnapshot,
  commitPage: ProjectGitCommitPage,
): ProjectGitSnapshot {
  return {
    ...currentSnapshot,
    commits: commitPage.commits || [],
    hasMoreCommits: commitPage.hasMoreCommits || false,
    repositoryPath: commitPage.repositoryPath || currentSnapshot.repositoryPath,
    lastRefreshedAt: commitPage.lastRefreshedAt || currentSnapshot.lastRefreshedAt,
  };
}

function scriptFromForm(projectId: string, script: ProjectScriptFormValue, index: number): ProjectScript {
  return {
    id: script.id || createScriptId(projectId, index),
    name: script.name.trim(),
    command: script.command.trim(),
    status: "IDLE",
    cwd: script.cwd.trim() || ".",
    note: script.note.trim(),
    source: script.source,
  };
}

function formFromProject(project: Project): ProjectFormValue {
  const projectKind = normalizeProjectKind(project.kind);
  const projectType = typeof project.type === "string" && project.type.trim() ? project.type : "Custom";
  const projectEnv = normalizeProjectEnv(project.env);
  const projectScripts = normalizeProjectScripts(project.id, project.scripts);

  return {
    id: project.id,
    name: project.name,
    path: project.path,
    visibility: normalizeProjectVisibility(project.visibility),
    type: projectType,
    kind: projectKind,
    icon: project.icon || inferProjectIcon(projectKind, projectType, project.name),
    cardStyle: project.cardStyle || "default",
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    description: project.description || "",
    memo: project.memo || "",
    envEntries: Object.entries(projectEnv).map(([key, value]) => ({
      id: `${project.id}-${key}`,
      key,
      value,
    })),
    scripts: projectScripts.map((script) => ({
      id: script.id,
      name: script.name,
      command: script.command,
      cwd: script.cwd || ".",
      note: script.note || "",
      source: script.source || "manual",
    })),
  };
}

function envFromEntries(entries: ProjectEnvironmentEntry[]): Record<string, string> {
  return entries.reduce<Record<string, string>>((accumulator, entry) => {
    const key = entry.key.trim();
    if (key) {
      accumulator[key] = entry.value;
    }
    return accumulator;
  }, {});
}

function inferProjectIcon(kind: ProjectKind, type = "", name = ""): ProjectIconKey {
  const source = `${kind} ${type} ${name}`.toLowerCase();
  if (/\b(vue|vite|nuxt)\b/.test(source)) return "vue";
  if (/\b(react|next)\b/.test(source)) return "react";
  if (/\bpython|py\b/.test(source)) return "python";
  if (/\bgo(lang)?\b/.test(source)) return "go";
  if (/\brust|cargo\b/.test(source)) return "rust";
  if (/\bjava|spring\b/.test(source)) return "java";
  if (/\bdocker|compose\b/.test(source)) return "docker";
  if (/\b(db|sql|mysql|postgres|redis|mongo)\b/.test(source)) return "database";
  if (/\b(browser|web|frontend)\b/.test(source)) return "browser";
  if (/\b(ai|llm|gpt|claude)\b/.test(source)) return "ai";
  if (kind === "node") return "node";
  if (kind === "python") return "python";
  if (kind === "go") return "go";
  if (kind === "executable") return "executable";
  return "custom";
}

function hydrateProject(project: Project): Project {
  const projectKind = normalizeProjectKind(project.kind);
  const projectType = typeof project.type === "string" && project.type.trim() ? project.type : "Custom";

  return {
    ...project,
    type: projectType,
    kind: projectKind,
    visibility: normalizeProjectVisibility(project.visibility),
    ownerDeviceId: project.ownerDeviceId || currentDeviceId,
    icon: project.icon || inferProjectIcon(projectKind, projectType, project.name),
    status: normalizeProjectStatus(project.status),
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    env: normalizeProjectEnv(project.env),
    description: project.description || "",
    memo: project.memo || "",
    todos: project.todos || [],
    git: normalizeGitSnapshot(project.git),
    pathExists: project.pathExists ?? true,
    unavailableReason: project.unavailableReason || "",
    sortOrder: resolveProjectSortOrder(project),
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString(),
    scripts: normalizeProjectScripts(project.id, project.scripts),
    automationTasks: normalizeAutomationTasks(project.id, project.automationTasks),
  };
}

function createLogEntry(message: string, type: LogEntry["type"]): LogEntry {
  return {
    timestamp: new Date().toLocaleTimeString(),
    message,
    type,
  };
}

function scheduleProcessStop(pid: number) {
  window.setTimeout(() => {
    void bridge.stopProcess(pid).catch(() => undefined);
  }, 0);
}

function normalizeLogLines(message: string): string[] {
  const normalized = message.replace(ansiControlPattern, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  return normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function classifyProcessOutputLine(line: string, source: "stdout" | "stderr"): LogEntry["type"] {
  const normalized = line.toLowerCase();
  const benignErrorPattern = /\b(no errors?|0 errors?|without errors?)\b/;
  const errorPattern =
    /\b(error|failed|failure|exception|fatal|panic|traceback|uncaught|denied|not found|eaddrinuse|enoent)\b|exit code [1-9]/;
  const warningPattern = /\b(warn|warning|deprecated)\b/;
  const readyPattern =
    /\b(ready|listening|started|compiled|served|local:|network:|vite|webpack|next|nuxt|dev server|watching|hmr)\b/;

  if (!benignErrorPattern.test(normalized) && errorPattern.test(normalized)) {
    return "ERROR";
  }
  if (warningPattern.test(normalized)) {
    return "WARN";
  }
  if (readyPattern.test(normalized)) {
    return "SUCCESS";
  }

  return source === "stderr" ? "INFO" : "INFO";
}

function demoProject(id: string, project: Project): Project {
  return hydrateProject({
    ...project,
    id,
  });
}

const demoProjects: Project[] = [
  demoProject("project-node-1", {
    id: "project-node-1",
    name: "AI Portfolio",
    path: "~/projects/ai-portfolio",
    type: "Node.js",
    kind: "node",
    icon: "node",
    description: "Frontend plus backend app with package scripts.",
    status: ProjectStatus.RUNNING,
    lastUpdated: "2h ago",
    scripts: [
      {
        id: "project-node-1-script-1",
        name: "dev",
        command: "npm run dev",
        status: "RUNNING",
        cwd: ".",
        source: "package-json",
        note: "frontend dev server",
      },
      {
        id: "project-node-1-script-2",
        name: "server",
        command: "npm run server",
        status: "IDLE",
        cwd: ".",
        source: "package-json",
        note: "backend api",
      },
    ],
    env: { PORT: "3000", DB_HOST: "localhost", API_KEY: "••••••••••••••••" },
    memo: "# Launch notes\n\nRun frontend first, then backend.",
    todos: [
      { id: "t1", text: "Check package scripts", completed: true },
      { id: "t2", text: "Verify Git snapshot", completed: false },
    ],
    git: {
      branch: "feature/memo-integration",
      ahead: 1,
      behind: 0,
      files: [
        { path: "src/components/MemoTab.vue", additions: 18, deletions: 5, status: "MODIFIED" },
        { path: "src/lib/projectBridge.ts", additions: 120, deletions: 0, status: "ADDED" },
      ],
      commits: [
        { hash: "c2561e6", author: "wyxa", date: "2026-05-18", message: "docs: init" },
        {
          hash: "adcd228",
          author: "wyxa",
          date: "2026-05-17",
          message: "chore(task): archive 00-bootstrap-guidelines",
        },
      ],
      repositoryPath: "~/projects/ai-portfolio",
      lastRefreshedAt: new Date().toISOString(),
      statusText: "2 files modified",
    },
  }),
  demoProject("project-python-1", {
    id: "project-python-1",
    name: "Data Scraper",
    path: "~/projects/data-scraper",
    type: "Python",
    kind: "python",
    description: "A Python automation project with custom launch commands.",
    status: ProjectStatus.STOPPED,
    scripts: [
      {
        id: "project-python-1-script-1",
        name: "run",
        command: "python main.py",
        status: "IDLE",
        cwd: ".",
        source: "manual",
      },
      {
        id: "project-python-1-script-2",
        name: "test",
        command: "pytest",
        status: "IDLE",
        cwd: ".",
        source: "manual",
      },
    ],
    env: { DB_URL: "postgresql://localhost:5432" },
    memo: "Remember to activate the virtual environment before launch.",
    todos: [{ id: "t3", text: "Add virtual env bootstrap", completed: false }],
    git: {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [],
      commits: [],
      repositoryPath: "~/projects/data-scraper",
      lastRefreshedAt: new Date().toISOString(),
      statusText: "工作区干净",
    },
  }),
  demoProject("project-go-1", {
    id: "project-go-1",
    name: "Finance App",
    path: "~/projects/finance-app",
    type: "Go",
    kind: "go",
    description: "Go service with a compiled binary target.",
    status: ProjectStatus.ERROR,
    scripts: [
      {
        id: "project-go-1-script-1",
        name: "run",
        command: "go run main.go",
        status: "ERROR",
        cwd: ".",
        source: "manual",
      },
      {
        id: "project-go-1-script-2",
        name: "build",
        command: "go build -o bin/finance-app",
        status: "IDLE",
        cwd: ".",
        source: "manual",
      },
    ],
    env: { PORT: "8080" },
    memo: "Binary launch is supported through executable scripts.",
    todos: [],
    git: {
      branch: "main",
      ahead: 0,
      behind: 2,
      files: [{ path: "cmd/server/main.go", additions: 6, deletions: 3, status: "MODIFIED" }],
      commits: [{ hash: "f7f4ce7", author: "wyxa", date: "2026-05-16", message: "init" }],
      repositoryPath: "~/projects/finance-app",
      lastRefreshedAt: new Date().toISOString(),
      statusText: "1 file modified",
    },
  }),
];

function createBlankProjectForm(): ProjectFormValue {
  return {
    id: null,
    name: "",
    path: "",
    visibility: "private",
    type: "Node.js",
    kind: "node",
    icon: "node",
    cardStyle: "default",
    quickLink: "",
    group: "",
    description: "",
    memo: "",
    envEntries: [],
    scripts: [
      {
        id: `script-${Date.now()}`,
        name: "dev",
        command: "npm run dev",
        cwd: ".",
        note: "",
        source: "manual",
      },
    ],
  };
}

export const useStore = defineStore("app", {
  state: () => ({
    locale: "zh-CN" as Locale,
    activeTab: "projects" as "projects" | "settings" | "environment",
    theme: "auto" as "light" | "dark" | "auto",
    terminalPreferences: bridge.loadTerminalPreferences(),
    editorPreferences: bridge.loadEditorPreferences(),
    environmentPreferences: bridge.loadEnvironmentPreferences(),
    environmentResults: [] as EnvironmentToolResult[],
    environmentChecked: false,
    environmentRefreshing: false,
    aiPreferences: bridge.loadAiPreferences(),
    aiModels: [] as AiModelInfo[],
    aiModelRefreshing: false,
    aiModelRefreshMessage: "",
    aiModelTesting: false,
    aiModelTestMessage: "",
    aiModelTestOk: null as boolean | null,
    aiAnalyzing: false,
    aiAnalysisResult: "",
    aiAnalysisMessage: "",
    aiAnalysisState: "idle" as AiAnalysisState,
    supportsBridge: supportsRealProjectBridge(),
    projectsLoaded: false,
    projectStorageMessage: "",
    projectConfigMessage: "",
    projectFormInspectionMessage: "",
    projectFormInspecting: false,
    projectFormCwdSuggestions: ["."] as string[],
    projectFormOpen: false,
    projectFormMode: "create" as "create" | "edit",
    projectFormDraft: createBlankProjectForm() as ProjectFormValue,
    pendingDeleteProjectId: null as string | null,
    projects: supportsRealProjectBridge() ? [] : demoProjects,
    selectedProjectId: null as string | null,
    automationActiveProjectRuns: {} as Record<string, string>,
    automationNextTimerAt: "",
    projectDetailsTabRequest: null as { projectId: string; tab: "automation" | "memo"; requestedAt: number } | null,
    logs: {
      "project-node-1": [
        { timestamp: "10:42:01", message: "> npm run dev", type: "INFO" },
        { timestamp: "10:42:02", message: "VITE v6 ready in 320 ms", type: "SUCCESS" },
        { timestamp: "10:45:12", message: "[hmr] src/components/project/MemoTab.vue updated.", type: "SUCCESS" },
      ],
      "project-go-1": [
        { timestamp: "09:12:11", message: "> go run main.go", type: "ERROR" },
        { timestamp: "09:12:12", message: "build failed: exit status 1", type: "ERROR" },
      ],
    } as Record<string, LogEntry[]>,
    scriptLogs: {
      "project-node-1": {
        "project-node-1-script-1": [
          { timestamp: "10:42:01", message: "> npm run dev", type: "INFO" },
          { timestamp: "10:42:02", message: "VITE v6 ready in 320 ms", type: "SUCCESS" },
          { timestamp: "10:45:12", message: "[hmr] src/components/project/MemoTab.vue updated.", type: "SUCCESS" },
        ],
      },
      "project-go-1": {
        "project-go-1-script-1": [
          { timestamp: "09:12:11", message: "> go run main.go", type: "ERROR" },
          { timestamp: "09:12:12", message: "build failed: exit status 1", type: "ERROR" },
        ],
      },
    } as Record<string, Record<string, LogEntry[]>>,
    stagedFiles: {
      "project-node-1": [
        { path: "src/components/MemoTab.vue", additions: 12, deletions: 4, status: "MODIFIED" },
        { path: "src/utils/markdownParser.ts", additions: 85, deletions: 0, status: "ADDED" },
      ],
      "project-go-1": [{ path: "cmd/server/main.go", additions: 6, deletions: 3, status: "MODIFIED" }],
    } as Record<string, ProjectGitFileChange[]>,
    gitRefreshing: {} as Record<string, boolean>,
    gitStatusRefreshing: {} as Record<string, boolean>,
    todos: {
      "project-node-1": [
        { id: "t1", text: "Review launch commands", completed: true },
        { id: "t2", text: "Check Git snapshot", completed: false },
      ],
      "project-python-1": [{ id: "t3", text: "Add environment bootstrap", completed: false }],
    } as Record<string, TodoItem[]>,
    memoContent: {
      "project-node-1": "# Launch notes\n\nRun frontend first, then backend.",
      "project-python-1": "Remember to activate the virtual environment before launch.",
      "project-go-1": "Binary launch is supported through executable scripts.",
    } as Record<string, string>,
  }),

  getters: {
    visibleProjects: (state): Project[] => state.projects.filter(isProjectVisibleOnCurrentDevice),
    availableProjects: (state): Project[] =>
      state.projects.filter((project) => isProjectVisibleOnCurrentDevice(project) && project.pathExists !== false),
    unavailableProjects: (state): Project[] =>
      state.projects.filter((project) => isProjectVisibleOnCurrentDevice(project) && project.pathExists === false),
    selectedProject: (state): Project | undefined =>
      state.projects.find((project) => project.id === state.selectedProjectId),
    pendingDeleteProject: (state): Project | undefined =>
      state.projects.find((project) => project.id === state.pendingDeleteProjectId),
    currentMessages: (state) => (state.locale === "zh-CN" ? "zh-CN" : "en-US"),
  },

  actions: {
    async loadProjects() {
      this.terminalPreferences = bridge.loadTerminalPreferences();
      this.editorPreferences = bridge.loadEditorPreferences();
      this.environmentPreferences = bridge.loadEnvironmentPreferences();
      this.aiPreferences = bridge.loadAiPreferences();
      try {
        const storedProjects = await bridge.loadProjects();
        if (this.supportsBridge || storedProjects.length > 0) {
          this.projects = storedProjects.map(hydrateProject);
          this.selectedProjectId = this.projects.some(
            (project) => project.id === this.selectedProjectId && isProjectVisibleOnCurrentDevice(project),
          )
            ? this.selectedProjectId
            : null;
        }
      } catch (error) {
        this.projectStorageMessage = "项目配置读取失败，已保留当前会话数据";
      }

      this.projectsLoaded = true;
      await this.refreshProjectAvailability();
      this.projects.forEach((project) => {
        this.memoContent[project.id] = project.memo || this.memoContent[project.id] || "";
        this.todos[project.id] = project.todos || this.todos[project.id] || [];
        this.logs[project.id] = this.logs[project.id] || [];
        this.scriptLogs[project.id] = this.scriptLogs[project.id] || {};
        this.stagedFiles[project.id] = project.git?.files || this.stagedFiles[project.id] || [];
      });
      this.recomputeAutomationPlans();
      void this.reconcileRuntimeProcessState();
    },
    async persistProjects() {
      try {
        const persistedProjects = this.projects.map((project, index) => {
          const persistedProject = toPersistedProject(project, index);
          project.sortOrder = persistedProject.sortOrder;
          return persistedProject;
        });
        await bridge.saveProjects(persistedProjects);
        this.projectStorageMessage = "";
      } catch (error) {
        this.projectStorageMessage = "项目配置保存失败，请稍后重试";
      }
    },
    async refreshProjectAvailability() {
      await Promise.all(
        this.projects.map(async (project) => {
          if (!isProjectVisibleOnCurrentDevice(project)) {
            return;
          }
          const exists = await bridge.pathExists(project.path);
          project.pathExists = exists;
          project.unavailableReason = exists ? "" : "当前设备无法访问该路径";
          if (exists && project.status === ProjectStatus.WARNING) {
            project.status = ProjectStatus.STOPPED;
          }
          if (!exists) {
            project.status = ProjectStatus.WARNING;
            project.scripts.forEach((script) => {
              script.status = "IDLE";
              script.pid = undefined;
            });
          }
        }),
      );
    },
    setLocale(locale: Locale) {
      this.locale = locale;
    },
    setTheme(theme: "light" | "dark" | "auto") {
      this.theme = theme;
    },
    setProjectConfigMessage(message: string) {
      cancelProjectConfigMessageClear();
      this.projectConfigMessage = message;
      if (!message) {
        return;
      }

      projectConfigMessageClearTimer = window.setTimeout(() => {
        if (this.projectConfigMessage === message) {
          this.projectConfigMessage = "";
        }
        projectConfigMessageClearTimer = null;
      }, PROJECT_CONFIG_MESSAGE_CLEAR_DELAY_MS);
    },
    setDefaultTerminal(kind: DefaultTerminalKind) {
      this.terminalPreferences.kind = kind;
      bridge.saveTerminalPreferences(this.terminalPreferences);
    },
    setDefaultTerminalCustomCommand(command: string) {
      this.terminalPreferences.customCommand = command;
      bridge.saveTerminalPreferences(this.terminalPreferences);
    },
    setDefaultEditor(kind: DefaultEditorKind) {
      this.editorPreferences.kind = kind;
      bridge.saveEditorPreferences(this.editorPreferences);
    },
    setDefaultEditorCustomCommand(command: string) {
      this.editorPreferences.customCommand = command;
      bridge.saveEditorPreferences(this.editorPreferences);
    },
    setEnvironmentToolEnabled(key: EnvironmentToolKey, enabled: boolean) {
      const keys = new Set<EnvironmentToolKey>(this.environmentPreferences.enabledToolKeys);
      if (enabled) {
        keys.add(key);
      } else {
        keys.delete(key);
      }
      const nextPreferences: EnvironmentPreferences = { enabledToolKeys: Array.from(keys) };
      this.environmentPreferences = nextPreferences;
      bridge.saveEnvironmentPreferences(nextPreferences);
      if (!enabled) {
        this.environmentResults = this.environmentResults.filter((result) => result.key !== key);
      }
    },
    async refreshEnvironmentTools() {
      if (this.environmentRefreshing) {
        return;
      }
      this.environmentRefreshing = true;
      const requestedKeys = [...this.environmentPreferences.enabledToolKeys];
      try {
        this.environmentResults = await bridge.detectEnvironmentTools(requestedKeys);
      } catch (error) {
        const checkedAt = new Date().toISOString();
        this.environmentResults = requestedKeys.map((key) => ({
          key,
          name: key,
          status: "error",
          version: "",
          executablePath: "",
          checkedAt,
          error: error instanceof Error ? error.message : "环境检测失败。",
        }));
      } finally {
        this.environmentChecked = true;
        this.environmentRefreshing = false;
      }
    },
    setAiPreferences(patch: Partial<AiPreferences>) {
      this.aiPreferences = { ...this.aiPreferences, ...patch };
      bridge.saveAiPreferences(this.aiPreferences);
    },
    addAiPromptMode() {
      const id = createAiPromptModeId();
      const nextMode: AiPromptMode = {
        id,
        name: "自定义模式",
        prompt: "请基于以下 Git 信息输出面向开发者的结构化内容。",
        builtIn: false,
        kind: "git-analysis",
      };
      this.aiPreferences = { ...this.aiPreferences, modes: [...this.aiPreferences.modes, nextMode] };
      bridge.saveAiPreferences(this.aiPreferences);
      return id;
    },
    updateAiPromptMode(modeId: string, patch: Partial<Pick<AiPromptMode, "name" | "prompt">>) {
      const modes = this.aiPreferences.modes.map((mode) =>
        mode.id === modeId
          ? {
              ...mode,
              name: typeof patch.name === "string" ? patch.name : mode.name,
              prompt: typeof patch.prompt === "string" ? patch.prompt : mode.prompt,
            }
          : mode,
      );
      this.aiPreferences = { ...this.aiPreferences, modes };
      bridge.saveAiPreferences(this.aiPreferences);
    },
    deleteAiPromptMode(modeId: string) {
      const modes = this.aiPreferences.modes.filter((mode) => mode.builtIn || mode.id !== modeId);
      this.aiPreferences = {
        ...this.aiPreferences,
        modes: modes.length > 0 ? modes : DEFAULT_AI_PROMPT_MODES.map((mode) => ({ ...mode })),
      };
      bridge.saveAiPreferences(this.aiPreferences);
    },
    resetAiPromptModes() {
      this.aiPreferences = {
        ...this.aiPreferences,
        modes: DEFAULT_AI_PROMPT_MODES.map((mode) => ({ ...mode })),
      };
      bridge.saveAiPreferences(this.aiPreferences);
    },
    async refreshAiModels() {
      this.aiModelRefreshing = true;
      this.aiModelRefreshMessage = "";
      try {
        this.aiModels = await bridge.listAiModels({ ...this.aiPreferences });
        if (
          this.aiPreferences.provider === "utools" &&
          this.aiPreferences.model &&
          !this.aiModels.some(
            (model) => model.id === this.aiPreferences.model || model.name === this.aiPreferences.model,
          )
        ) {
          this.aiModelRefreshMessage = "当前配置的 uTools 模型未在可用列表中找到，建议重新选择。";
        }
        if (this.aiPreferences.provider !== "utools" && this.aiModels.length === 0) {
          this.aiModelRefreshMessage = "未从当前供应商获取到模型，可手动填写模型 ID。";
        }
      } catch (error) {
        this.aiModels = [];
        this.aiModelRefreshMessage = error instanceof Error ? error.message : "获取模型列表失败。";
      } finally {
        this.aiModelRefreshing = false;
      }
    },
    async testAiConfiguration() {
      this.aiModelTesting = true;
      this.aiModelTestMessage = "";
      this.aiModelTestOk = null;
      try {
        const result = await bridge.testAiConnection({ ...this.aiPreferences });
        this.aiModelTestOk = result.ok;
        this.aiModelTestMessage = result.ok
          ? result.message || "AI 连接测试成功。"
          : result.message || "AI 连接测试失败。";
        return result;
      } catch (error) {
        const result = { ok: false, message: error instanceof Error ? error.message : "AI 连接测试失败。" };
        this.aiModelTestOk = false;
        this.aiModelTestMessage = result.message;
        return result;
      } finally {
        this.aiModelTesting = false;
      }
    },
    async analyzeGitWithAiStream(projectId: string, prompt: string, handlers: AiStreamHandlers = {}) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        const result: AiAnalyzeResult = { ok: false, content: "", message: "项目不存在，无法进行 AI 分析。" };
        handlers.onDone?.(result);
        return result;
      }
      let finalResult: AiAnalyzeResult | undefined;
      let completed = false;
      handlers.onStart?.();
      try {
        await bridge.analyzeWithAiStream(
          { preferences: { ...this.aiPreferences }, prompt },
          (chunk) => {
            handlers.onChunk?.(chunk);
          },
          (result) => {
            completed = true;
            finalResult = result;
            handlers.onDone?.(result);
          },
        );
      } catch (error) {
        if (!completed) {
          finalResult = {
            ok: false,
            content: "",
            message: error instanceof Error ? error.message : "AI 分析失败。",
          };
          handlers.onDone?.(finalResult);
        }
      }
      return finalResult;
    },
    async analyzeGitWithAi(projectId: string, prompt: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return;
      }
      this.aiAnalyzing = true;
      this.aiAnalysisMessage = "";
      this.aiAnalysisResult = "";
      this.aiAnalysisState = "loading";
      try {
        await this.analyzeGitWithAiStream(projectId, prompt, {
          onChunk: (chunk) => {
            this.aiAnalysisResult += aiStreamChunkRawText(chunk);
          },
          onDone: (result) => {
            if (!this.aiAnalysisResult && result.content) {
              this.aiAnalysisResult = result.content;
            }
            this.aiAnalysisMessage = result.ok ? result.message || "" : result.message || "AI analysis failed";
            this.aiAnalysisState = result.ok ? (this.aiAnalysisResult ? "success" : "warning") : "error";
            if (!result.ok && !this.aiAnalysisMessage) {
              this.aiAnalysisMessage = "AI 分析失败。";
            }
            if (result.ok && !this.aiAnalysisResult) {
              this.aiAnalysisMessage = "AI 已返回成功，但没有生成内容。";
            }
          },
        });
      } finally {
        this.aiAnalyzing = false;
      }
    },
    setActiveTab(tab: "projects" | "settings" | "environment") {
      this.activeTab = tab;
      this.selectedProjectId = null;
    },
    setSelectedProject(id: string | null) {
      this.selectedProjectId = id;
      if (id) {
        this.activeTab = "projects";
      }
    },
    openProjectByName(query: string) {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) {
        return false;
      }

      const matchedProject =
        this.projects.find(
          (project) => isProjectVisibleOnCurrentDevice(project) && project.name.toLowerCase() === normalizedQuery,
        ) ||
        this.projects.find(
          (project) => isProjectVisibleOnCurrentDevice(project) && project.name.toLowerCase().includes(normalizedQuery),
        );
      if (!matchedProject) {
        return false;
      }

      this.activeTab = "projects";
      if (matchedProject.pathExists === false) {
        this.openEditProjectForm(matchedProject.id);
      } else {
        this.selectedProjectId = matchedProject.id;
      }
      return true;
    },
    openCreateProjectForm() {
      this.projectFormMode = "create";
      this.projectFormDraft = createBlankProjectForm();
      this.projectFormInspectionMessage = "";
      this.projectFormCwdSuggestions = ["."];
      this.projectFormOpen = true;
    },
    openEditProjectForm(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return;
      }

      this.projectFormMode = "edit";
      this.projectFormDraft = formFromProject(project);
      this.projectFormInspectionMessage =
        project.pathExists === false ? project.unavailableReason || "当前路径不可用" : "";
      void this.refreshProjectFormCwdSuggestions(project.path);
      this.projectFormOpen = true;
    },
    closeProjectForm() {
      this.projectFormOpen = false;
      this.projectFormDraft = createBlankProjectForm();
      this.projectFormInspectionMessage = "";
      this.projectFormCwdSuggestions = ["."];
    },
    updateProjectForm(patch: Partial<ProjectFormValue>) {
      this.projectFormDraft = {
        ...this.projectFormDraft,
        ...patch,
      };
    },
    async inspectCurrentProjectPath() {
      const projectPath = this.projectFormDraft.path.trim();
      if (!projectPath) {
        this.projectFormInspectionMessage = "";
        return;
      }

      this.projectFormInspecting = true;
      const currentName = this.projectFormDraft.name.trim();
      try {
        const result = await bridge.inspectProjectPath(projectPath);
        const scripts = result.scripts.map((script, index) => ({
          id: `script-${Date.now()}-${index}`,
          name: script.name,
          command: script.command,
          cwd: script.cwd || ".",
          note: script.note || (result.packagePath ? `package.json: ${result.packagePath}` : ""),
          source: script.source || "package-json",
        })) satisfies ProjectScriptFormValue[];

        this.projectFormDraft = {
          ...this.projectFormDraft,
          name: currentName || result.name || this.projectFormDraft.name,
          kind: result.kind || this.projectFormDraft.kind,
          type: result.type || this.projectFormDraft.type,
          icon:
            this.projectFormDraft.icon ||
            inferProjectIcon(
              result.kind || this.projectFormDraft.kind,
              result.type || this.projectFormDraft.type,
              result.name || currentName,
            ),
          scripts: scripts.length > 0 ? scripts : this.projectFormDraft.scripts,
        };
        await this.refreshProjectFormCwdSuggestions(projectPath);
        this.projectFormInspectionMessage =
          result.message || (result.pathExists ? "已识别路径信息" : "当前路径不可用，可保存后重新定位");
      } finally {
        this.projectFormInspecting = false;
      }
    },
    async refreshProjectFormCwdSuggestions(projectPath = this.projectFormDraft.path) {
      const normalizedPath = projectPath.trim();
      if (!normalizedPath) {
        this.projectFormCwdSuggestions = ["."];
        return;
      }

      try {
        const suggestions = await bridge.listProjectSubdirectories(normalizedPath);
        this.projectFormCwdSuggestions = Array.from(new Set([".", ...suggestions.filter(Boolean)]));
      } catch (error) {
        this.projectFormCwdSuggestions = ["."];
      }
    },
    async pickProjectPath() {
      const result = await bridge.pickProjectPath();
      if (result.path) {
        this.updateProjectForm({ path: result.path });
        await this.inspectCurrentProjectPath();
        return;
      }

      if (result.message) {
        this.projectFormInspectionMessage = result.message;
      }
    },
    async pickQuickLinkPath() {
      const result = await bridge.pickQuickLinkPath();
      if (result.path) {
        this.updateProjectForm({ quickLink: result.path });
        return;
      }

      if (result.message) {
        this.projectFormInspectionMessage = result.message;
      }
    },
    addEnvironmentEntry() {
      this.projectFormDraft.envEntries.push({
        id: createEnvId(),
        key: "",
        value: "",
      });
    },
    updateEnvironmentEntry(entryId: string, patch: Partial<ProjectEnvironmentEntry>) {
      const entry = this.projectFormDraft.envEntries.find((item) => item.id === entryId);
      if (entry) {
        Object.assign(entry, patch);
      }
    },
    removeEnvironmentEntry(entryId: string) {
      this.projectFormDraft.envEntries = this.projectFormDraft.envEntries.filter((item) => item.id !== entryId);
    },
    addScriptEntry() {
      this.projectFormDraft.scripts.push({
        id: `script-${Date.now()}`,
        name: "start",
        command: "",
        cwd: ".",
        note: "",
        source: "manual",
      });
    },
    updateScriptEntry(scriptId: string, patch: Partial<ProjectScriptFormValue>) {
      const script = this.projectFormDraft.scripts.find((item) => item.id === scriptId);
      if (script) {
        Object.assign(script, patch);
      }
    },
    removeScriptEntry(scriptId: string) {
      this.projectFormDraft.scripts = this.projectFormDraft.scripts.filter((item) => item.id !== scriptId);
    },
    moveScriptEntry(scriptId: string, direction: "up" | "down") {
      const currentIndex = this.projectFormDraft.scripts.findIndex((item) => item.id === scriptId);
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= this.projectFormDraft.scripts.length) {
        return;
      }

      const scripts = [...this.projectFormDraft.scripts];
      const [script] = scripts.splice(currentIndex, 1);
      scripts.splice(targetIndex, 0, script);
      this.projectFormDraft.scripts = scripts;
    },
    reorderScriptEntry(scriptId: string, targetScriptId: string) {
      if (scriptId === targetScriptId) {
        return;
      }

      const scripts = [...this.projectFormDraft.scripts];
      const currentIndex = scripts.findIndex((item) => item.id === scriptId);
      const targetIndex = scripts.findIndex((item) => item.id === targetScriptId);
      if (currentIndex < 0 || targetIndex < 0) {
        return;
      }

      const [script] = scripts.splice(currentIndex, 1);
      const insertIndex = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
      scripts.splice(insertIndex, 0, script);
      this.projectFormDraft.scripts = scripts;
    },
    async saveProjectForm() {
      const current = this.projectFormDraft;
      const payload: ProjectFormValue = {
        ...current,
        envEntries: current.envEntries.filter((entry) => entry.key.trim()),
      };
      const projectId = payload.id || createProjectId();
      const now = new Date().toISOString();
      const env = envFromEntries(payload.envEntries);
      const formScripts = payload.scripts
        .filter((script) => script.name.trim() && script.command.trim())
        .map((script, index) => scriptFromForm(projectId, script, index));
      if (formScripts.length === 0) {
        this.projectFormInspectionMessage = "请至少填写一个可运行脚本。";
        return null;
      }
      const existingProject = this.projects.find((item) => item.id === projectId);
      const pathExists = await bridge.pathExists(payload.path);
      const scripts = pathExists ? mergeScriptRuntimeState(formScripts, existingProject?.scripts || []) : formScripts;
      const project: Project = hydrateProject({
        id: projectId,
        name: payload.name.trim(),
        path: payload.path.trim(),
        visibility: payload.visibility,
        ownerDeviceId:
          payload.visibility === "private" ? currentDeviceId : existingProject?.ownerDeviceId || currentDeviceId,
        type: payload.type,
        kind: payload.kind,
        icon: payload.icon,
        cardStyle: payload.cardStyle,
        quickLink: payload.quickLink.trim(),
        group: normalizeProjectGroup(payload.group),
        description: payload.description,
        status:
          this.projectFormMode === "edit"
            ? pathExists
              ? existingProject?.status === ProjectStatus.RUNNING
                ? ProjectStatus.RUNNING
                : ProjectStatus.STOPPED
              : ProjectStatus.WARNING
            : pathExists
              ? ProjectStatus.STOPPED
              : ProjectStatus.WARNING,
        lastUpdated: new Date().toLocaleString(),
        scripts,
        automationTasks: existingProject?.automationTasks || [],
        env,
        memo: payload.memo,
        todos: this.todos[projectId] || existingProject?.todos || [],
        git: existingProject?.git || null,
        pathExists,
        unavailableReason: pathExists ? "" : "当前设备无法访问该路径",
        createdAt: existingProject?.createdAt || now,
        updatedAt: now,
      });
      project.status = deriveProjectStatus(project);

      const existingIndex = this.projects.findIndex((item) => item.id === projectId);
      if (existingIndex >= 0) {
        this.projects.splice(existingIndex, 1, project);
      } else {
        this.projects.unshift(project);
        this.logs[projectId] = [];
        this.scriptLogs[projectId] = {};
        this.stagedFiles[projectId] = [];
        this.todos[projectId] = [];
      }

      this.memoContent[projectId] = payload.memo;
      this.selectedProjectId = projectId;
      this.projectFormOpen = false;
      this.projectFormDraft = createBlankProjectForm();
      await this.persistProjects();
      return projectId;
    },
    async deleteProject(projectId: string) {
      const existingIndex = this.projects.findIndex((item) => item.id === projectId);
      if (existingIndex < 0) {
        return false;
      }

      this.projects.splice(existingIndex, 1);
      delete this.logs[projectId];
      delete this.scriptLogs[projectId];
      delete this.stagedFiles[projectId];
      delete this.todos[projectId];
      delete this.memoContent[projectId];
      delete this.automationActiveProjectRuns[projectId];

      if (this.selectedProjectId === projectId) {
        this.selectedProjectId = null;
        this.activeTab = "projects";
      }

      if (this.projectFormDraft.id === projectId) {
        this.closeProjectForm();
      }

      this.scheduleAutomationTimer();
      await this.persistProjects();
      return true;
    },
    requestDeleteProject(projectId: string) {
      if (this.projects.some((item) => item.id === projectId)) {
        this.pendingDeleteProjectId = projectId;
      }
    },
    cancelDeleteProject() {
      this.pendingDeleteProjectId = null;
    },
    async confirmDeleteProject() {
      const projectId = this.pendingDeleteProjectId;
      if (!projectId) {
        return false;
      }

      this.pendingDeleteProjectId = null;
      return this.deleteProject(projectId);
    },
    async refreshProjectScripts(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }

      const result = await bridge.readPackageScripts(project.path);
      if (result.scripts.length > 0) {
        const previousScripts = project.scripts;
        const previousScriptsByName = new Map<string, ProjectScript>(
          previousScripts.map((script) => [script.name, script]),
        );
        const refreshedScripts: ProjectScript[] = result.scripts.map((script, index) => ({
          id: previousScriptsByName.get(script.name)?.id || `${project.id}-package-${index + 1}`,
          name: script.name,
          command: script.command,
          status: "IDLE",
          cwd: script.cwd || ".",
          note: script.note || (result.packagePath ? `package.json: ${result.packagePath}` : ""),
          source: script.source || "package-json",
        }));
        project.scripts = mergeScriptRuntimeState(refreshedScripts, previousScripts);
        project.status = deriveProjectStatus(project);
        await this.persistProjects();
      }
    },
    async refreshProjects() {
      await this.refreshProjectAvailability();
      await Promise.all(
        this.projects
          .filter((project) => isProjectVisibleOnCurrentDevice(project) && project.pathExists !== false)
          .map((project) => this.refreshGitSnapshot(project.id)),
      );
    },
    async moveProject(projectId: string, direction: "top" | "up" | "down", scopeProjectIds?: string[]) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return false;
      }

      const isUnavailable = project.pathExists === false;
      const isSameSection = (item: Project) =>
        isProjectVisibleOnCurrentDevice(item) &&
        (isUnavailable ? item.pathExists === false : item.pathExists !== false);
      const sectionProjects = this.projects.filter(isSameSection);
      const sectionProjectIds = new Set(sectionProjects.map((item) => item.id));
      const scopedSectionProjects = (scopeProjectIds || [])
        .filter((id) => sectionProjectIds.has(id))
        .map((id) => sectionProjects.find((item) => item.id === id))
        .filter((item): item is Project => Boolean(item));
      const activeSectionProjects = scopedSectionProjects.length > 0 ? scopedSectionProjects : sectionProjects;
      const currentSectionIndex = activeSectionProjects.findIndex((item) => item.id === projectId);
      const targetSectionIndex =
        direction === "top" ? 0 : direction === "up" ? currentSectionIndex - 1 : currentSectionIndex + 1;

      if (
        currentSectionIndex < 0 ||
        currentSectionIndex === targetSectionIndex ||
        targetSectionIndex < 0 ||
        targetSectionIndex >= activeSectionProjects.length
      ) {
        return false;
      }

      const anchorProject = activeSectionProjects[targetSectionIndex];
      const reorderedSectionProjects = [...sectionProjects];
      const movedProjectIndex = reorderedSectionProjects.findIndex((item) => item.id === projectId);
      if (movedProjectIndex < 0) {
        return false;
      }

      const [movedProject] = reorderedSectionProjects.splice(movedProjectIndex, 1);
      const anchorIndex = reorderedSectionProjects.findIndex((item) => item.id === anchorProject.id);
      if (anchorIndex < 0) {
        return false;
      }

      reorderedSectionProjects.splice(direction === "down" ? anchorIndex + 1 : anchorIndex, 0, movedProject);
      let sectionIndex = 0;
      this.projects = this.projects.map((item) => {
        if (!isSameSection(item)) {
          return item;
        }

        const nextProject = reorderedSectionProjects[sectionIndex];
        sectionIndex += 1;
        return nextProject;
      });
      await this.persistProjects();
      return true;
    },
    async reorderProject(projectId: string, targetProjectId: string, scopeProjectIds?: string[]) {
      if (projectId === targetProjectId) {
        return false;
      }

      const project = this.projects.find((item) => item.id === projectId);
      const targetProject = this.projects.find((item) => item.id === targetProjectId);
      if (!project || !targetProject || !isProjectVisibleOnCurrentDevice(project)) {
        return false;
      }

      const isUnavailable = project.pathExists === false;
      const isSameSection = (item: Project) =>
        isProjectVisibleOnCurrentDevice(item) &&
        (isUnavailable ? item.pathExists === false : item.pathExists !== false);
      if (!isSameSection(targetProject)) {
        return false;
      }

      const sectionProjects = this.projects.filter(isSameSection);
      const sectionProjectIds = new Set(sectionProjects.map((item) => item.id));
      const scopedSectionProjects = (scopeProjectIds || [])
        .filter((id) => sectionProjectIds.has(id))
        .map((id) => sectionProjects.find((item) => item.id === id))
        .filter((item): item is Project => Boolean(item));
      const activeSectionProjects = scopedSectionProjects.length > 0 ? scopedSectionProjects : sectionProjects;
      if (!activeSectionProjects.some((item) => item.id === projectId)) {
        return false;
      }
      if (!activeSectionProjects.some((item) => item.id === targetProjectId)) {
        return false;
      }

      if (scopedSectionProjects.length > 0) {
        const reorderedScopedProjects = [...scopedSectionProjects];
        const currentScopedIndex = reorderedScopedProjects.findIndex((item) => item.id === projectId);
        const targetScopedIndex = reorderedScopedProjects.findIndex((item) => item.id === targetProjectId);
        if (currentScopedIndex < 0 || targetScopedIndex < 0) {
          return false;
        }

        const [movedProject] = reorderedScopedProjects.splice(currentScopedIndex, 1);
        const nextTargetScopedIndex = reorderedScopedProjects.findIndex((item) => item.id === targetProjectId);
        reorderedScopedProjects.splice(nextTargetScopedIndex, 0, movedProject);

        const scopedProjectIds = new Set(reorderedScopedProjects.map((item) => item.id));
        let scopedIndex = 0;
        this.projects = this.projects.map((item) => {
          if (!isSameSection(item) || !scopedProjectIds.has(item.id)) {
            return item;
          }

          const nextProject = reorderedScopedProjects[scopedIndex];
          scopedIndex += 1;
          return nextProject;
        });
        await this.persistProjects();
        return true;
      }

      const reorderedSectionProjects = [...sectionProjects];
      const movedProjectIndex = reorderedSectionProjects.findIndex((item) => item.id === projectId);
      const targetIndex = reorderedSectionProjects.findIndex((item) => item.id === targetProjectId);
      if (movedProjectIndex < 0 || targetIndex < 0) {
        return false;
      }

      const [movedProject] = reorderedSectionProjects.splice(movedProjectIndex, 1);
      const nextTargetIndex = reorderedSectionProjects.findIndex((item) => item.id === targetProjectId);
      reorderedSectionProjects.splice(nextTargetIndex, 0, movedProject);

      let sectionIndex = 0;
      this.projects = this.projects.map((item) => {
        if (!isSameSection(item)) {
          return item;
        }

        const nextProject = reorderedSectionProjects[sectionIndex];
        sectionIndex += 1;
        return nextProject;
      });
      await this.persistProjects();
      return true;
    },
    async refreshGitSnapshot(projectId: string, options: { force?: boolean } = {}) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }

      const existingRefresh = gitSnapshotRefreshPromises.get(projectId);
      if (existingRefresh && !options.force) {
        return existingRefresh;
      }

      this.gitRefreshing[projectId] = true;
      this.gitStatusRefreshing[projectId] = true;
      const refreshToken = Symbol(projectId);
      gitSnapshotRefreshTokens.set(projectId, refreshToken);
      const refreshPromise = (async () => {
        const startedAtVersion = gitMutationVersion(projectId);
        const startedAtRefVersion = gitRefMutationVersion(projectId);
        try {
          const snapshot = await bridge.readGitSnapshot(project.path, { limit: 80, skip: 0 });
          if (startedAtVersion !== gitMutationVersion(projectId)) {
            const normalizedSnapshot =
              startedAtRefVersion === gitRefMutationVersion(projectId) ? normalizeGitSnapshot(snapshot) : null;
            if (project.git && normalizedSnapshot) {
              project.git = replaceGitCommitPage(project.git, normalizedSnapshot);
              project.gitLatestCommitAt = project.git.commits[0]?.date || project.gitLatestCommitAt || "";
            }
            return;
          }
          project.git = normalizeGitSnapshot(snapshot);
          if (project.git) {
            project.gitLatestCommitAt = project.git.commits[0]?.date || project.gitLatestCommitAt || "";
            this.stagedFiles[projectId] = project.git.files;
          }
          await this.persistProjects();
        } finally {
          if (gitSnapshotRefreshTokens.get(projectId) === refreshToken) {
            gitSnapshotRefreshPromises.delete(projectId);
            gitSnapshotRefreshTokens.delete(projectId);
            this.gitRefreshing[projectId] = false;
            this.gitStatusRefreshing[projectId] = Boolean(gitStatusRefreshPromises.get(projectId));
          }
        }
      })();
      gitSnapshotRefreshPromises.set(projectId, refreshPromise);
      return refreshPromise;
    },
    async refreshGitStatusSnapshot(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }

      const existingRefresh = gitStatusRefreshPromises.get(projectId);
      if (existingRefresh) {
        return existingRefresh;
      }

      this.gitStatusRefreshing[projectId] = true;
      const refreshPromise = (async () => {
        try {
          let needsAnotherRead = true;
          while (needsAnotherRead) {
            const startedAtVersion = gitMutationVersion(projectId);
            const statusSnapshot = await bridge.readGitStatusSnapshot(project.path);
            project.git = mergeGitStatusSnapshot(project.git, statusSnapshot);
            this.stagedFiles[projectId] = project.git.files;
            needsAnotherRead = startedAtVersion !== gitMutationVersion(projectId);
          }
        } finally {
          gitStatusRefreshPromises.delete(projectId);
          this.gitStatusRefreshing[projectId] = Boolean(gitSnapshotRefreshPromises.get(projectId));
        }
      })();
      gitStatusRefreshPromises.set(projectId, refreshPromise);
      return refreshPromise;
    },
    async loadMoreGitCommits(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false || !project.git) {
        return;
      }

      const commitPage = await bridge.readGitCommits(project.path, { limit: 80, skip: project.git.commits.length });
      project.git = mergeGitCommitPage(project.git, commitPage);
    },
    async listProjectFiles(projectId: string, relativePath = ""): Promise<ProjectFileListResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.listProjectFiles(project.path, relativePath);
    },
    async readProjectFile(projectId: string, relativePath: string): Promise<ProjectFileReadResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.readProjectFile(project.path, relativePath);
    },
    async readGitFileDiff(projectId: string, relativePath: string): Promise<ProjectGitFileDiffResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.readGitFileDiff(project.path, relativePath);
    },
    async readGitCommitFileDiff(
      projectId: string,
      commitHash: string,
      relativePath: string,
    ): Promise<ProjectGitFileDiffResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.readGitCommitFileDiff(project.path, commitHash, relativePath);
    },
    async readGitCommitFiles(projectId: string, commitHash: string): Promise<ProjectGitFileChange[]> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return [];
      }

      return bridge.readGitCommitFiles(project.path, commitHash);
    },
    async readGitCommitMessageDiff(projectId: string): Promise<ProjectGitCommitMessageDiffResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.readGitCommitMessageDiff(project.path);
    },
    async stageGitFile(projectId: string, relativePath: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.stageGitFile(project.path, relativePath);
      if (result.ok || (result.count || 0) > 0) {
        bumpGitMutationVersion(projectId);
        await this.refreshGitStatusSnapshot(projectId);
      }
      return result;
    },
    async unstageGitFile(projectId: string, relativePath: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.unstageGitFile(project.path, relativePath);
      if (result.ok || (result.count || 0) > 0) {
        bumpGitMutationVersion(projectId);
        await this.refreshGitStatusSnapshot(projectId);
      }
      return result;
    },
    async discardGitFile(projectId: string, relativePath: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.discardGitFile(project.path, relativePath);
      if (result.ok || (result.count || 0) > 0) {
        bumpGitMutationVersion(projectId);
        await this.refreshGitSnapshot(projectId, { force: true });
      }
      return result;
    },
    async stageGitFiles(
      projectId: string,
      relativePaths: string[],
      options: { all?: boolean } = {},
    ): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.stageGitFiles(project.path, relativePaths, options);
      if (result.ok) {
        bumpGitMutationVersion(projectId);
        await this.refreshGitStatusSnapshot(projectId);
      }
      return result;
    },
    async unstageGitFiles(
      projectId: string,
      relativePaths: string[],
      options: { all?: boolean } = {},
    ): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.unstageGitFiles(project.path, relativePaths, options);
      if (result.ok) {
        bumpGitMutationVersion(projectId);
        await this.refreshGitStatusSnapshot(projectId);
      }
      return result;
    },
    async discardGitFiles(
      projectId: string,
      relativePaths: string[],
      options: { all?: boolean } = {},
    ): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.discardGitFiles(project.path, relativePaths, options);
      if (result.ok) {
        bumpGitMutationVersion(projectId);
        await this.refreshGitSnapshot(projectId, { force: true });
      }
      return result;
    },
    async commitGitStaged(projectId: string, message: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.commitGitStaged(project.path, message);
      if (result.ok) {
        bumpGitMutationVersion(projectId);
        bumpGitRefMutationVersion(projectId);
        await this.refreshGitSnapshot(projectId, { force: true });
      }
      return result;
    },
    async switchGitBranch(
      projectId: string,
      branchName: string,
      options: { force?: boolean } = {},
    ): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.switchGitBranch(project.path, branchName, options);
      if (result.ok) {
        bumpGitMutationVersion(projectId);
        bumpGitRefMutationVersion(projectId);
        await this.refreshGitSnapshot(projectId, { force: true });
      }
      return result;
    },
    async checkoutGitCommit(
      projectId: string,
      commitHash: string,
      options: { force?: boolean } = {},
    ): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.checkoutGitCommit(project.path, commitHash, {
        ...options,
        preferredBranch: project.git?.branch,
      });
      if (result.ok) {
        bumpGitMutationVersion(projectId);
        bumpGitRefMutationVersion(projectId);
        await this.refreshGitSnapshot(projectId, { force: true });
      }
      return result;
    },
    async fetchGitRemote(projectId: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return runGitRemoteMutation(projectId, project, bridge.fetchGitRemote, (id, options) =>
        this.refreshGitSnapshot(id, options),
      );
    },
    async pullGitRemote(projectId: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return runGitRemoteMutation(projectId, project, bridge.pullGitRemote, (id, options) =>
        this.refreshGitSnapshot(id, options),
      );
    },
    async pushGitRemote(projectId: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return runGitRemoteMutation(projectId, project, bridge.pushGitRemote, (id, options) =>
        this.refreshGitSnapshot(id, options),
      );
    },
    async addGitRemote(
      projectId: string,
      remoteName: string,
      remoteUrl: string,
    ): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return runGitRemoteMutation(
        projectId,
        project,
        (projectPath) => bridge.addGitRemote(projectPath, remoteName, remoteUrl),
        (id, options) => this.refreshGitSnapshot(id, options),
      );
    },
    async setGitRemoteUrl(
      projectId: string,
      remoteName: string,
      remoteUrl: string,
    ): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return runGitRemoteMutation(
        projectId,
        project,
        (projectPath) => bridge.setGitRemoteUrl(projectPath, remoteName, remoteUrl),
        (id, options) => this.refreshGitSnapshot(id, options),
      );
    },
    async removeGitRemote(projectId: string, remoteName: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return runGitRemoteMutation(
        projectId,
        project,
        (projectPath) => bridge.removeGitRemote(projectPath, remoteName),
        (id, options) => this.refreshGitSnapshot(id, options),
      );
    },
    async writeProjectFile(
      projectId: string,
      relativePath: string,
      content: string,
    ): Promise<ProjectFileWriteResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.writeProjectFile(project.path, relativePath, content);
    },
    automationTaskValidation(projectId: string, task: ProjectAutomationTask) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return { valid: false, message: "项目不存在。" };
      }
      if (!task.name.trim()) {
        return { valid: false, message: "请填写任务名称。" };
      }
      if (task.scriptIds.length === 0) {
        return { valid: false, message: "请至少选择一个脚本。" };
      }
      const missingScriptId = task.scriptIds.find(
        (scriptId) => !project.scripts.some((script) => script.id === scriptId),
      );
      if (missingScriptId) {
        return { valid: false, message: `脚本不存在：${missingScriptId}` };
      }
      const scheduleValidation = validateAutomationSchedule(task.schedule);
      if (!scheduleValidation.valid) {
        return scheduleValidation;
      }
      if (task.missedPolicy === "grace-run" && task.missedGraceMinutes < 0) {
        return { valid: false, message: "错过宽限时间不能小于 0。" };
      }
      const invalidMatchStep = task.inputConfigs
        .flatMap((config) => config.steps)
        .find((step) => step.mode === "output-match" && (!step.matchText.trim() || step.timeoutMs < 1000));
      if (invalidMatchStep) {
        return { valid: false, message: "输出匹配输入需要匹配文本和超时时间。" };
      }
      const invalidExit = task.exitConfigs.find((config) => config.enabled && !config.matchText.trim());
      if (invalidExit) {
        return { valid: false, message: "关键词退出需要填写匹配文本。" };
      }
      return { valid: true, message: "" };
    },
    scheduleAutomationTimer() {
      clearAutomationSchedulerTimer();
      const now = new Date();
      const today = dateKey(now);
      const upcoming: Array<{ projectId: string; taskId: string; entry: ProjectAutomationPlanEntry }> = [];

      this.projects.forEach((project) => {
        project.automationTasks = normalizeAutomationTasks(project.id, project.automationTasks);
        project.automationTasks.forEach((task) => {
          if (!task.enabled) {
            return;
          }
          const existingPlan = task.dailyPlans.find((plan) => plan.date === today);
          if (!existingPlan) {
            task.dailyPlans = [generateAutomationDailyPlan(task.id, task.schedule, today), ...task.dailyPlans].slice(
              0,
              7,
            );
          }
          const nextEntry = getNextAutomationPlanEntry(task.dailyPlans, now);
          if (nextEntry) {
            upcoming.push({ projectId: project.id, taskId: task.id, entry: nextEntry });
          }
        });
      });

      upcoming.sort(
        (left, right) => new Date(left.entry.plannedAt).getTime() - new Date(right.entry.plannedAt).getTime(),
      );
      const next = upcoming[0];
      this.automationNextTimerAt = next?.entry.plannedAt || "";
      if (!next) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 5, 0);
        automationSchedulerTimer = window.setTimeout(
          () => {
            this.recomputeAutomationPlans();
          },
          Math.max(1000, Math.min(tomorrow.getTime() - now.getTime(), 2_147_483_647)),
        );
        return;
      }
      const delay = Math.max(0, Math.min(new Date(next.entry.plannedAt).getTime() - now.getTime(), 2_147_483_647));
      automationSchedulerTimer = window.setTimeout(() => {
        void this.runDueAutomationPlans();
      }, delay);
    },
    markMissedAutomationPlans() {
      const nowTime = Date.now();
      let changed = false;
      this.projects.forEach((project) => {
        project.automationTasks?.forEach((task) => {
          if (!task.enabled) {
            return;
          }
          task.dailyPlans.forEach((plan) => {
            plan.entries.forEach((entry) => {
              const plannedTime = new Date(entry.plannedAt).getTime();
              const graceMs = task.missedPolicy === "grace-run" ? task.missedGraceMinutes * 60_000 : 0;
              const shouldMiss =
                entry.status === "pending" &&
                plannedTime < nowTime &&
                (task.missedPolicy === "mark-missed" ||
                  (task.missedPolicy === "grace-run" && nowTime - plannedTime > graceMs));
              if (shouldMiss) {
                this.finishAutomationPlanEntry(project, task, entry, "missed", "插件未运行或计划时间已错过。", []);
                changed = true;
              }
            });
          });
        });
      });
      if (changed) {
        void this.persistProjects();
      }
    },
    async reconcileOrphanedAutomationRuns() {
      let changed = false;
      for (const project of this.projects) {
        for (const task of project.automationTasks || []) {
          for (const plan of task.dailyPlans) {
            for (const entry of plan.entries) {
              if (entry.status !== "running") {
                continue;
              }

              const hasActiveRun = this.automationActiveProjectRuns[project.id] === entry.runId;
              const hasRunningScript = task.scriptIds.some((scriptId) => {
                const script = project.scripts.find((item) => item.id === scriptId);
                return script?.status === "RUNNING" || script?.status === "STOPPING";
              });
              const hasAutomationContext = task.scriptIds.some((scriptId) =>
                automationScriptContexts.has(automationScriptContextKey(project.id, scriptId)),
              );
              if (hasRunningScript || hasAutomationContext) {
                continue;
              }
              if (hasActiveRun) {
                delete this.automationActiveProjectRuns[project.id];
              }

              const matchingHistory = task.history.find(
                (historyEntry) => historyEntry.id === entry.runId || historyEntry.plannedAt === entry.plannedAt,
              );
              if (matchingHistory) {
                entry.status = matchingHistory.status;
                entry.runId = matchingHistory.id;
                entry.reason = matchingHistory.reason;
                changed = true;
                continue;
              }

              const recentResults = await Promise.all(
                task.scriptIds.map(async (scriptId) => {
                  try {
                    return { scriptId, result: await bridge.getRecentProcessResult(project.id, scriptId) };
                  } catch (error) {
                    return { scriptId, result: null };
                  }
                }),
              );
              const entryPlannedTime = new Date(entry.plannedAt).getTime();
              const relevantResults = recentResults.filter(({ result }) => {
                if (!result?.endedAt) {
                  return false;
                }
                return new Date(result.endedAt).getTime() >= entryPlannedTime;
              });

              if (relevantResults.length === task.scriptIds.length && relevantResults.length > 0) {
                const failedResult = relevantResults.find(({ result }) => result?.error || result?.code !== 0);
                this.finishAutomationPlanEntry(
                  project,
                  task,
                  entry,
                  failedResult ? "failed" : "completed",
                  failedResult
                    ? failedResult.result?.error || `脚本退出码 ${failedResult.result?.code ?? "unknown"}。`
                    : "",
                  relevantResults.map(({ scriptId, result }) => ({
                    scriptId,
                    scriptName: project.scripts.find((script) => script.id === scriptId)?.name || scriptId,
                    status: result?.error || result?.code !== 0 ? "failed" : "completed",
                    endedAt: result?.endedAt,
                    reason:
                      result?.error || (result?.code !== 0 ? `脚本退出码 ${result?.code ?? "unknown"}。` : undefined),
                  })),
                  entry.runId,
                  false,
                );
                changed = true;
                continue;
              }

              this.finishAutomationPlanEntry(
                project,
                task,
                entry,
                "skipped",
                "任务运行状态已失效，已在应用恢复时忽略。",
                [],
                entry.runId,
                false,
              );
              changed = true;
            }
          }
        }
      }
      return changed;
    },
    async reconcileRuntimeProcessState() {
      const runningScripts = this.projects.flatMap((project) =>
        project.scripts
          .filter((script) => (script.status === "RUNNING" || script.status === "STOPPING") && script.pid)
          .map((script) => ({ project, script, pid: script.pid as number })),
      );
      let changed = false;

      const statuses = await Promise.all(
        runningScripts.map(async ({ project, script, pid }) => {
          try {
            return { project, script, pid, status: await bridge.getProcessStatus(pid) };
          } catch (error) {
            return { project, script, pid, status: { active: true } };
          }
        }),
      );

      statuses.forEach(({ project, script, pid, status }) => {
        if (status.active) {
          return;
        }

        changed = true;
        if (status.error) {
          this.handleBridgeEvent({
            type: "error",
            projectId: project.id,
            scriptId: script.id,
            pid,
            message: status.error,
          });
          return;
        }

        this.handleBridgeEvent({
          type: "exit",
          projectId: project.id,
          scriptId: script.id,
          pid,
          code: status.code ?? 0,
          signal: status.signal ?? null,
          stoppedByUser: Boolean(status.stoppedByUser || script.status === "STOPPING"),
        });
      });

      await Promise.resolve();
      if (await this.reconcileOrphanedAutomationRuns()) {
        changed = true;
      }
      if (changed) {
        this.scheduleAutomationTimer();
        void this.persistProjects();
      }
    },
    async runDueAutomationPlans() {
      this.markMissedAutomationPlans();
      const nowTime = Date.now();
      const dueEntries: Array<{ project: Project; task: ProjectAutomationTask; entry: ProjectAutomationPlanEntry }> =
        [];
      this.projects.forEach((project) => {
        project.automationTasks?.forEach((task) => {
          if (!task.enabled) {
            return;
          }
          task.dailyPlans.forEach((plan) => {
            plan.entries.forEach((entry) => {
              if (entry.status === "pending" && new Date(entry.plannedAt).getTime() <= nowTime) {
                dueEntries.push({ project, task, entry });
              }
            });
          });
        });
      });

      for (const due of dueEntries) {
        if (this.automationActiveProjectRuns[due.project.id]) {
          this.finishAutomationPlanEntry(due.project, due.task, due.entry, "skipped", "同项目已有任务正在运行。", []);
          continue;
        }
        void this.runAutomationTask(due.project.id, due.task.id, due.entry.id);
      }

      this.scheduleAutomationTimer();
      void this.persistProjects();
    },
    recomputeAutomationPlans(projectId?: string) {
      const today = dateKey();
      this.projects
        .filter((project) => !projectId || project.id === projectId)
        .forEach((project) => {
          project.automationTasks = normalizeAutomationTasks(project.id, project.automationTasks).map((task) => {
            const todayPlan = task.dailyPlans.find((plan) => plan.date === today);
            return {
              ...task,
              dailyPlans: todayPlan
                ? [todayPlan, ...task.dailyPlans.filter((plan) => plan.date !== today)].slice(0, 7)
                : [generateAutomationDailyPlan(task.id, task.schedule, today), ...task.dailyPlans].slice(0, 7),
            };
          });
        });
      this.markMissedAutomationPlans();
      void this.runDueAutomationPlans();
    },
    createAutomationTask(projectId: string, patch: Partial<ProjectAutomationTask>) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return { ok: false, message: "项目不存在。" };
      }
      const now = new Date().toISOString();
      const firstScriptId = project.scripts[0]?.id;
      const task: ProjectAutomationTask = normalizeAutomationTasks(projectId, [
        {
          id: createAutomationTaskId(),
          name: patch.name || "任务",
          enabled: patch.enabled ?? true,
          scriptIds: patch.scriptIds?.length ? patch.scriptIds : firstScriptId ? [firstScriptId] : [],
          schedule: patch.schedule || defaultAutomationSchedule(),
          notifyEnabled: patch.notifyEnabled ?? true,
          maxScriptRuntimeMinutes: patch.maxScriptRuntimeMinutes || DEFAULT_AUTOMATION_MAX_RUNTIME_MINUTES,
          inputConfigs: patch.inputConfigs || [],
          exitConfigs: patch.exitConfigs || [],
          dailyPlans: [],
          history: [],
          missedPolicy: patch.missedPolicy || "grace-run",
          missedGraceMinutes: patch.missedGraceMinutes ?? DEFAULT_AUTOMATION_MISSED_GRACE_MINUTES,
          createdAt: now,
          updatedAt: now,
        },
      ])[0];
      const validation = this.automationTaskValidation(projectId, task);
      if (!validation.valid) {
        return { ok: false, message: validation.message };
      }
      task.dailyPlans = [generateAutomationDailyPlan(task.id, task.schedule, dateKey())];
      project.automationTasks = [task, ...(project.automationTasks || [])];
      project.updatedAt = now;
      this.scheduleAutomationTimer();
      void this.persistProjects();
      return { ok: true, message: "", task };
    },
    duplicateAutomationTask(projectId: string, taskId: string, name: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const sourceTask = project?.automationTasks?.find((item) => item.id === taskId);
      if (!project || !sourceTask) {
        return { ok: false, message: "任务不存在。" };
      }

      const now = new Date().toISOString();
      const task: ProjectAutomationTask = normalizeAutomationTasks(projectId, [
        {
          ...sourceTask,
          id: createAutomationTaskId(),
          name,
          scriptIds: [...sourceTask.scriptIds],
          inputConfigs: sourceTask.inputConfigs.map((config) => ({
            scriptId: config.scriptId,
            steps: config.steps.map((step) => ({ ...step })),
          })),
          exitConfigs: sourceTask.exitConfigs.map((config) => ({ ...config })),
          dailyPlans: [],
          history: [],
          createdAt: now,
          updatedAt: now,
        },
      ])[0];
      const validation = this.automationTaskValidation(projectId, task);
      if (!validation.valid) {
        return { ok: false, message: validation.message };
      }

      task.dailyPlans = [generateAutomationDailyPlan(task.id, task.schedule, dateKey())];
      const sourceIndex = (project.automationTasks || []).findIndex((item) => item.id === taskId);
      project.automationTasks = [
        ...(project.automationTasks || []).slice(0, sourceIndex + 1),
        task,
        ...(project.automationTasks || []).slice(sourceIndex + 1),
      ];
      project.updatedAt = now;
      this.scheduleAutomationTimer();
      void this.persistProjects();
      return { ok: true, message: "", task };
    },
    updateAutomationTask(projectId: string, taskId: string, patch: Partial<ProjectAutomationTask>) {
      const project = this.projects.find((item) => item.id === projectId);
      const task = project?.automationTasks?.find((item) => item.id === taskId);
      if (!project || !task) {
        return { ok: false, message: "任务不存在。" };
      }
      const nextTask: ProjectAutomationTask = normalizeAutomationTasks(projectId, [
        {
          ...task,
          ...patch,
          dailyPlans: patch.schedule ? [] : task.dailyPlans,
          updatedAt: new Date().toISOString(),
        },
      ])[0];
      const validation = this.automationTaskValidation(projectId, nextTask);
      if (!validation.valid) {
        return { ok: false, message: validation.message };
      }
      if (patch.schedule || !nextTask.dailyPlans.some((plan) => plan.date === dateKey())) {
        nextTask.dailyPlans = [generateAutomationDailyPlan(nextTask.id, nextTask.schedule, dateKey())];
      }
      Object.assign(task, nextTask);
      project.updatedAt = new Date().toISOString();
      this.scheduleAutomationTimer();
      void this.persistProjects();
      return { ok: true, message: "", task };
    },
    deleteAutomationTask(projectId: string, taskId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return false;
      }
      project.automationTasks = (project.automationTasks || []).filter((task) => task.id !== taskId);
      project.updatedAt = new Date().toISOString();
      this.scheduleAutomationTimer();
      void this.persistProjects();
      return true;
    },
    openProjectAutomation(projectId: string) {
      this.selectedProjectId = projectId;
      this.activeTab = "projects";
      this.projectDetailsTabRequest = { projectId, tab: "automation", requestedAt: Date.now() };
    },
    openProjectMemo(projectId: string) {
      this.selectedProjectId = projectId;
      this.activeTab = "projects";
      this.projectDetailsTabRequest = { projectId, tab: "memo", requestedAt: Date.now() };
    },
    finishAutomationPlanEntry(
      project: Project,
      task: ProjectAutomationTask,
      entry: ProjectAutomationPlanEntry,
      status: ProjectAutomationHistoryEntry["status"],
      reason: string,
      scriptResults: ProjectAutomationScriptResult[],
      runId = entry.runId || createAutomationRunId(),
      notify = true,
    ) {
      entry.status = status;
      entry.runId = runId;
      entry.reason = reason || undefined;
      const endedAt = new Date().toISOString();
      task.history = [
        {
          id: runId,
          taskId: task.id,
          taskName: task.name,
          projectId: project.id,
          projectName: project.name,
          plannedAt: entry.plannedAt,
          startedAt: status === "missed" || status === "skipped" ? undefined : endedAt,
          endedAt,
          status,
          reason: reason || undefined,
          scriptResults,
        },
        ...task.history,
      ].slice(0, AUTOMATION_HISTORY_LIMIT);
      task.updatedAt = endedAt;
      if (notify && task.notifyEnabled) {
        try {
          window.utools?.showNotification?.(
            `任务“${task.name}”${status === "completed" ? "已完成" : status === "missed" ? "已错过" : status === "skipped" ? "已跳过" : "失败"}${reason ? `：${reason}` : ""}`,
          );
        } catch (error) {
          // Notifications are best-effort and must not affect automation execution.
        }
      }
    },
    async runAutomationTask(projectId: string, taskId: string, entryId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const task = project?.automationTasks?.find((item) => item.id === taskId);
      const entry = task?.dailyPlans.flatMap((plan) => plan.entries).find((item) => item.id === entryId);
      if (!project || !task || !entry || entry.status !== "pending") {
        return;
      }
      const runId = createAutomationRunId();
      entry.status = "running";
      entry.runId = runId;
      this.automationActiveProjectRuns[projectId] = runId;
      const scriptResults: ProjectAutomationScriptResult[] = [];
      let finalStatus: ProjectAutomationHistoryEntry["status"] = "completed";
      let finalReason = "";
      const startedAt = new Date().toISOString();

      try {
        for (const scriptId of task.scriptIds) {
          const script = project.scripts.find((item) => item.id === scriptId);
          if (!script) {
            finalStatus = "failed";
            finalReason = `脚本不存在：${scriptId}`;
            scriptResults.push({ scriptId, scriptName: scriptId, status: "failed", reason: finalReason });
            break;
          }
          if (
            project.pathExists === false ||
            !script.command.trim() ||
            script.status === "RUNNING" ||
            script.status === "STOPPING"
          ) {
            const scriptBusy = script.status === "RUNNING" || script.status === "STOPPING";
            finalStatus = scriptBusy ? "skipped" : "failed";
            finalReason =
              project.pathExists === false
                ? "项目路径不可用。"
                : !script.command.trim()
                  ? "脚本命令为空。"
                  : "脚本已在运行或停止中。";
            scriptResults.push({
              scriptId,
              scriptName: script.name,
              status: scriptBusy ? "skipped" : "failed",
              reason: finalReason,
            });
            break;
          }

          const inputConfig = task.inputConfigs.find((config) => config.scriptId === scriptId);
          const exitConfig = task.exitConfigs.find(
            (config) => config.scriptId === scriptId && config.enabled && config.matchText.trim(),
          );
          const result = await this.runAutomationScript(
            projectId,
            scriptId,
            inputConfig?.steps || [],
            exitConfig,
            task.maxScriptRuntimeMinutes,
          );
          scriptResults.push(result);
          if (result.status !== "completed") {
            finalStatus = "failed";
            finalReason = result.reason || `${script.name} 执行失败。`;
            break;
          }
        }
      } catch (error) {
        if (finalStatus === "completed") {
          finalStatus = "failed";
          finalReason = error instanceof Error ? error.message : "任务执行失败。";
        }
      }

      delete this.automationActiveProjectRuns[projectId];
      entry.status = finalStatus;
      const endedAt = new Date().toISOString();
      task.history = [
        {
          id: runId,
          taskId: task.id,
          taskName: task.name,
          projectId: project.id,
          projectName: project.name,
          plannedAt: entry.plannedAt,
          startedAt,
          endedAt,
          status: finalStatus,
          reason: finalReason || undefined,
          scriptResults,
        },
        ...task.history,
      ].slice(0, AUTOMATION_HISTORY_LIMIT);
      entry.reason = finalReason || undefined;
      task.updatedAt = endedAt;
      if (task.notifyEnabled) {
        try {
          window.utools?.showNotification?.(
            `任务“${task.name}”${finalStatus === "completed" ? "已完成" : "失败"}${finalReason ? `：${finalReason}` : ""}`,
          );
        } catch (error) {
          // Notifications are best-effort and must not affect automation execution.
        }
      }
      this.scheduleAutomationTimer();
      void this.persistProjects();
    },
    runAutomationTaskNow(projectId: string, taskId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const task = project?.automationTasks?.find((item) => item.id === taskId);
      if (!project || !task || task.scriptIds.length === 0 || this.automationActiveProjectRuns[projectId]) {
        return false;
      }

      const now = new Date();
      const today = dateKey(now);
      let todayPlan = task.dailyPlans.find((plan) => plan.date === today);
      if (!todayPlan) {
        todayPlan = generateAutomationDailyPlan(task.id, task.schedule, today);
        task.dailyPlans = [todayPlan, ...task.dailyPlans].slice(0, 7);
      }

      const plannedAt = now.toISOString();
      const manualEntry: ProjectAutomationPlanEntry = {
        id: `${task.id}-${plannedAt}-manual`,
        plannedAt,
        status: "pending",
        reason: "手动立即执行。",
      };
      todayPlan.entries = [...todayPlan.entries, manualEntry].sort(
        (left, right) => new Date(left.plannedAt).getTime() - new Date(right.plannedAt).getTime(),
      );
      void this.runAutomationTask(projectId, taskId, manualEntry.id);
      return true;
    },
    ignoreMissedAutomationTask(projectId: string, taskId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const task = project?.automationTasks?.find((item) => item.id === taskId);
      const missedEntry = task?.history.find((entry) => entry.status === "missed");
      if (!project || !task || !missedEntry) {
        return false;
      }

      const endedAt = new Date().toISOString();
      task.history = [
        {
          id: createAutomationRunId(),
          taskId: task.id,
          taskName: task.name,
          projectId: project.id,
          projectName: project.name,
          plannedAt: missedEntry.plannedAt,
          endedAt,
          status: "skipped",
          reason: "已忽略错过任务。",
          scriptResults: [],
        },
        ...task.history,
      ].slice(0, AUTOMATION_HISTORY_LIMIT);
      task.updatedAt = endedAt;
      void this.persistProjects();
      return true;
    },
    runAutomationScript(
      projectId: string,
      scriptId: string,
      steps: ProjectAutomationInputStep[],
      exitConfig: ProjectAutomationExitConfig | undefined,
      maxRuntimeMinutes: number,
    ): Promise<ProjectAutomationScriptResult> {
      const project = this.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      if (!project || !script) {
        return Promise.resolve({ scriptId, scriptName: scriptId, status: "failed", reason: "脚本不存在。" });
      }
      const startedAt = new Date().toISOString();
      return new Promise((resolve) => {
        const context: AutomationScriptRuntimeContext = {
          runId: createAutomationRunId(),
          projectId,
          scriptId,
          scriptName: script.name,
          startedAt,
          steps,
          exitConfig,
          output: "",
          stepIndex: 0,
          waitingStepIndex: null,
          inputCompleted: steps.length === 0,
          settled: false,
          stopRequestedByAutomationExit: false,
          timers: [],
          runtimeTimer: null,
          resolve,
        };
        automationScriptContexts.set(automationScriptContextKey(projectId, scriptId), context);
        context.runtimeTimer = window.setTimeout(
          () => {
            void this.stopScript(projectId, scriptId);
            settleAutomationScriptContext(context, {
              scriptId,
              scriptName: script.name,
              status: "timeout",
              startedAt,
              endedAt: new Date().toISOString(),
              reason: `脚本运行超过 ${maxRuntimeMinutes} 分钟。`,
            });
          },
          Math.max(1, maxRuntimeMinutes) * 60_000,
        );

        void this.launchScript(projectId, scriptId).then((result) => {
          if (!result) {
            settleAutomationScriptContext(context, {
              scriptId,
              scriptName: script.name,
              status: "failed",
              startedAt,
              endedAt: new Date().toISOString(),
              reason: "脚本启动失败。",
            });
            return;
          }
          this.advanceAutomationInputStep(context);
        });
      });
    },
    async sendAutomationInput(context: AutomationScriptRuntimeContext, value: string) {
      let result: Awaited<ReturnType<typeof this.sendScriptInput>>;
      try {
        result = await this.sendScriptInput(context.projectId, context.scriptId, value);
      } catch (error) {
        result = { sent: false, message: error instanceof Error ? error.message : "自动输入发送失败。" };
      }
      if (!result.sent) {
        void this.stopScript(context.projectId, context.scriptId);
        settleAutomationScriptContext(context, {
          scriptId: context.scriptId,
          scriptName: context.scriptName,
          status: "failed",
          startedAt: context.startedAt,
          endedAt: new Date().toISOString(),
          reason: result.message || "自动输入发送失败。",
        });
        return false;
      }
      return true;
    },
    advanceAutomationInputStep(context: AutomationScriptRuntimeContext) {
      if (context.settled) {
        return;
      }
      clearAutomationStepTimers(context);
      const step = context.steps[context.stepIndex];
      if (!step) {
        context.inputCompleted = true;
        if (shouldAutomationExitOnOutput(context)) {
          context.stopRequestedByAutomationExit = true;
          void this.stopScript(context.projectId, context.scriptId);
        }
        return;
      }
      if (step.mode === "delay") {
        const timer = window.setTimeout(
          () => {
            void this.sendAutomationInput(context, step.value).then((sent) => {
              if (!sent || context.settled) {
                return;
              }
              context.stepIndex += 1;
              this.advanceAutomationInputStep(context);
            });
          },
          Math.max(0, step.delayMs),
        );
        context.timers.push(timer);
        return;
      }

      context.waitingStepIndex = context.stepIndex;
      const timeout = window.setTimeout(
        () => {
          void this.stopScript(context.projectId, context.scriptId);
          settleAutomationScriptContext(context, {
            scriptId: context.scriptId,
            scriptName: context.scriptName,
            status: "failed",
            startedAt: context.startedAt,
            endedAt: new Date().toISOString(),
            reason: `等待输出匹配“${step.matchText}”超时。`,
          });
        },
        Math.max(1000, step.timeoutMs),
      );
      context.timers.push(timeout);
      if (step.matchText.trim() && context.output.includes(step.matchText)) {
        void this.consumeAutomationOutputMatch(context);
      }
    },
    async consumeAutomationOutputMatch(context: AutomationScriptRuntimeContext) {
      const step = context.steps[context.stepIndex];
      if (!step || step.mode !== "output-match" || context.waitingStepIndex !== context.stepIndex) {
        return;
      }
      clearAutomationStepTimers(context);
      const sent = await this.sendAutomationInput(context, step.value);
      if (!sent || context.settled) {
        return;
      }
      context.stepIndex += 1;
      this.advanceAutomationInputStep(context);
    },
    handleAutomationBridgeEvent(event: ProjectBridgeEvent) {
      const context = automationScriptContexts.get(automationScriptContextKey(event.projectId, event.scriptId));
      if (!context || context.settled) {
        return;
      }
      if (event.type === "stdout" || event.type === "stderr") {
        context.output += event.message || "";
        const currentStep = context.steps[context.stepIndex];
        if (
          currentStep?.mode === "output-match" &&
          currentStep.matchText.trim() &&
          context.output.includes(currentStep.matchText)
        ) {
          void this.consumeAutomationOutputMatch(context);
        }
        if (shouldAutomationExitOnOutput(context)) {
          context.stopRequestedByAutomationExit = true;
          void this.stopScript(event.projectId, event.scriptId);
        }
      }
      if (event.type === "exit") {
        const success = event.code === 0 || context.stopRequestedByAutomationExit;
        settleAutomationScriptContext(context, {
          scriptId: context.scriptId,
          scriptName: context.scriptName,
          status: success ? "completed" : event.stoppedByUser ? "stopped" : "failed",
          startedAt: context.startedAt,
          endedAt: new Date().toISOString(),
          reason: success
            ? undefined
            : event.stoppedByUser
              ? "脚本已被手动停止。"
              : `脚本退出码 ${event.code ?? "unknown"}。`,
        });
      }
      if (event.type === "error") {
        settleAutomationScriptContext(context, {
          scriptId: context.scriptId,
          scriptName: context.scriptName,
          status: "failed",
          startedAt: context.startedAt,
          endedAt: new Date().toISOString(),
          reason: event.message || "脚本执行错误。",
        });
      }
    },
    async launchScript(projectId: string, scriptId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      if (
        !project ||
        !script ||
        project.pathExists === false ||
        script.status === "RUNNING" ||
        script.status === "STOPPING" ||
        !script.command.trim()
      ) {
        return null;
      }

      script.status = "RUNNING";
      script.pid = undefined;
      project.status = deriveProjectStatus(project);
      project.lastUpdated = new Date().toLocaleString();

      try {
        const result = await bridge.runCommand({
          projectId,
          scriptId,
          command: script.command,
          cwd: resolveScriptCwd(project.path, script.cwd),
          env: project.env,
          label: `${project.name} / ${script.name}`,
        });

        if (script.status === "RUNNING") {
          script.pid = result.pid;
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
        }
        return result;
      } catch (error) {
        script.status = "ERROR";
        script.pid = undefined;
        project.status = deriveProjectStatus(project);
        project.lastUpdated = new Date().toLocaleString();
        this.addLog(
          projectId,
          createLogEntry(error instanceof Error ? error.message : "command failed", "ERROR"),
          scriptId,
        );
        return null;
      }
    },
    async launchAllScripts(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return [];
      }

      const launchableScripts = project.scripts.filter(
        (script) => script.status !== "RUNNING" && script.status !== "STOPPING" && script.command.trim(),
      );
      const results = [];
      for (const script of launchableScripts) {
        const result = await this.launchScript(projectId, script.id);
        if (result) {
          results.push(result);
        }
      }
      return results;
    },
    async stopScript(projectId: string, scriptId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      if (!project || !script || script.status !== "RUNNING") {
        return;
      }

      const pid = script.pid;
      this.addLog(projectId, createLogEntry(`[${script.name}] stop requested`, "WARN"), scriptId);
      script.status = pid ? "STOPPING" : "STOPPED";
      project.status = deriveProjectStatus(project);
      project.lastUpdated = new Date().toLocaleString();
      void this.persistProjects();

      if (pid) {
        scheduleProcessStop(pid);
      } else {
        this.addLog(projectId, createLogEntry(`[${script.name}] stopped`, "SUCCESS"), scriptId);
      }
    },
    stopRunningScriptsForPluginExit() {
      this.projects.forEach((project) => {
        let projectUpdated = false;
        project.scripts.forEach((script) => {
          if (script.status !== "RUNNING" && script.status !== "STOPPING") {
            return;
          }

          if (script.pid) {
            const pid = script.pid;
            scheduleProcessStop(pid);
            script.status = "STOPPING";
          } else {
            script.status = "STOPPED";
          }
          this.addLog(project.id, createLogEntry(`[${script.name}] stop requested`, "WARN"), script.id);
          projectUpdated = true;
        });

        if (projectUpdated) {
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
        }
      });
      void this.persistProjects();
    },
    async sendScriptInput(projectId: string, scriptId: string, input: string) {
      const line = input;
      const project = this.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      if (!project || !script || script.status !== "RUNNING" || !script.pid) {
        return { sent: false, message: "当前选中的脚本不可输入。" };
      }

      const result = await bridge.sendProcessInput(script.pid, line);
      if (!result.sent) {
        this.addLog(projectId, createLogEntry(result.message || "输入发送失败。", "WARN"), scriptId);
      }
      return result;
    },
    async openProjectFolder(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }

      await bridge.showItemInFolder(project.path);
    },
    async openProjectInTerminal(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }
      const terminalPreferences = { ...this.terminalPreferences };

      if (terminalPreferences.kind === "builtin") {
        this.addLog(
          projectId,
          createLogEntry(`No external terminal selected; external launch skipped for ${project.path}.`, "INFO"),
        );
        project.lastUpdated = new Date().toLocaleString();
        return;
      }

      try {
        const result = await bridge.openTerminal({
          projectPath: project.path,
          terminal: terminalPreferences,
        });

        project.lastUpdated = new Date().toLocaleString();

        if (result.launched) {
          this.addLog(projectId, createLogEntry(`Open terminal (${result.kind}): ${result.command}`, "INFO"));
          return;
        }

        this.addLog(
          projectId,
          createLogEntry(`Failed to open terminal (${result.kind}): ${result.message || "unknown error"}`, "ERROR"),
        );
      } catch (error) {
        project.lastUpdated = new Date().toLocaleString();
        this.addLog(
          projectId,
          createLogEntry(
            `Failed to open terminal (${terminalPreferences.kind}): ${error instanceof Error ? error.message : String(error)}`,
            "ERROR",
          ),
        );
      }
    },
    async openProjectInEditor(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }
      const editorPreferences = { ...this.editorPreferences } satisfies EditorPreferences;
      try {
        const result = await bridge.openEditor({ projectPath: project.path, editor: editorPreferences });
        project.lastUpdated = new Date().toLocaleString();
        if (result.launched) {
          this.addLog(projectId, createLogEntry(`Open editor (${result.kind}): ${result.command}`, "INFO"));
          return;
        }
        this.addLog(
          projectId,
          createLogEntry(`Failed to open editor (${result.kind}): ${result.message || "unknown error"}`, "ERROR"),
        );
      } catch (error) {
        project.lastUpdated = new Date().toLocaleString();
        this.addLog(
          projectId,
          createLogEntry(
            `Failed to open editor (${editorPreferences.kind}): ${error instanceof Error ? error.message : String(error)}`,
            "ERROR",
          ),
        );
      }
    },
    async openProjectQuickLink(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const quickLink = project?.quickLink?.trim();
      if (!project || !quickLink) {
        return;
      }

      try {
        await bridge.openPath(quickLink);
      } catch (error) {
        this.addLog(
          projectId,
          createLogEntry(
            `Failed to open quick link: ${error instanceof Error ? error.message : String(error)}`,
            "WARN",
          ),
        );
      }
    },
    addLog(projectId: string, log: LogEntry, scriptId?: string) {
      if (!this.logs[projectId]) {
        this.logs[projectId] = [];
      }
      this.logs[projectId].push(log);
      if (scriptId) {
        if (!this.scriptLogs[projectId]) {
          this.scriptLogs[projectId] = {};
        }
        if (!this.scriptLogs[projectId][scriptId]) {
          this.scriptLogs[projectId][scriptId] = [];
        }
        this.scriptLogs[projectId][scriptId].push(log);
      }
    },
    clearLogs(projectId: string) {
      this.logs[projectId] = [];
      this.scriptLogs[projectId] = {};
    },
    clearScriptLogs(projectId: string, scriptId: string) {
      const scriptEntries = this.scriptLogs[projectId]?.[scriptId] || [];
      if (scriptEntries.length > 0) {
        const entriesToRemove = new Set(scriptEntries);
        this.logs[projectId] = (this.logs[projectId] || []).filter((log) => !entriesToRemove.has(log));
      }
      if (this.scriptLogs[projectId]) {
        this.scriptLogs[projectId][scriptId] = [];
      }
    },
    addTodo(projectId: string, text: string) {
      if (!this.todos[projectId]) {
        this.todos[projectId] = [];
      }
      this.todos[projectId].push({ id: createTodoId(), text, completed: false });
      this.todos[projectId] = [...this.todos[projectId]].sort(
        (left, right) => Number(left.completed) - Number(right.completed),
      );
      this.syncProjectTodos(projectId);
    },
    toggleTodo(projectId: string, todoId: string) {
      const todo = this.todos[projectId]?.find((item) => item.id === todoId);
      if (todo) {
        todo.completed = !todo.completed;
        this.todos[projectId] = [...this.todos[projectId]].sort(
          (left, right) => Number(left.completed) - Number(right.completed),
        );
        this.syncProjectTodos(projectId);
      }
    },
    updateTodo(projectId: string, todoId: string, text: string) {
      const trimmedText = text.trim();
      const todo = this.todos[projectId]?.find((item) => item.id === todoId);
      if (!todo || !trimmedText || todo.text === trimmedText) {
        return;
      }

      todo.text = trimmedText;
      this.todos[projectId] = [...this.todos[projectId]];
      this.syncProjectTodos(projectId);
    },
    deleteTodo(projectId: string, todoId: string) {
      this.todos[projectId] = (this.todos[projectId] || []).filter((item) => item.id !== todoId);
      this.syncProjectTodos(projectId);
    },
    reorderTodo(projectId: string, todoId: string, targetTodoId: string) {
      if (todoId === targetTodoId) {
        return;
      }

      const todos = [...(this.todos[projectId] || [])];
      const currentIndex = todos.findIndex((item) => item.id === todoId);
      const targetIndex = todos.findIndex((item) => item.id === targetTodoId);
      if (currentIndex < 0 || targetIndex < 0) {
        return;
      }

      const [todo] = todos.splice(currentIndex, 1);
      const insertIndex = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
      todos.splice(insertIndex, 0, todo);
      this.todos[projectId] = todos;
      this.syncProjectTodos(projectId);
    },
    syncProjectTodos(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (project) {
        project.todos = this.todos[projectId] || [];
        project.updatedAt = new Date().toISOString();
        void this.persistProjects();
      }
    },
    updateMemo(projectId: string, content: string) {
      this.memoContent[projectId] = content;
      const project = this.projects.find((item) => item.id === projectId);
      if (project) {
        project.memo = content;
        project.updatedAt = new Date().toISOString();
        void this.persistProjects();
      }
    },
    async exportProjectConfig() {
      const config: ProjectConfigFile = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        projects: this.projects.map((project, index) => toPersistedProject(project, index)),
      };
      const result = await bridge.exportProjects(config);
      this.setProjectConfigMessage(
        result.canceled ? "已取消导出" : result.path ? `已导出到 ${result.path}` : "已导出项目配置",
      );
    },
    async importProjectConfig() {
      const result = await bridge.importProjects();
      if (result.canceled || !result.config) {
        this.setProjectConfigMessage(result.message || "已取消导入");
        return;
      }

      const existingKeys = new Set(
        this.projects.map((project) => `${project.path.toLowerCase()}::${project.name.toLowerCase()}`),
      );
      if (result.config.schemaVersion !== 1 || !Array.isArray(result.config.projects)) {
        this.setProjectConfigMessage("配置文件格式不受支持");
        return;
      }

      const incoming = result.config.projects
        .filter(isImportableProject)
        .map((project, index) => hydrateProject(toPersistedProject(project, index)));
      const accepted: Project[] = [];
      let skipped = result.config.projects.length - incoming.length;

      incoming.forEach((project) => {
        const key = `${project.path.toLowerCase()}::${project.name.toLowerCase()}`;
        if (this.projects.some((item) => item.id === project.id) || existingKeys.has(key)) {
          skipped += 1;
          return;
        }
        existingKeys.add(key);
        accepted.push({ ...project, id: project.id || createProjectId() });
      });

      this.projects = [...accepted, ...this.projects];
      await this.refreshProjectAvailability();
      this.recomputeAutomationPlans();
      await this.persistProjects();
      this.setProjectConfigMessage(`已导入 ${accepted.length} 个项目，跳过 ${skipped} 个重复项目`);
    },
    handleBridgeEvent(event: ProjectBridgeEvent) {
      const project = this.projects.find((item) => item.id === event.projectId);
      const script = project?.scripts.find((item) => item.id === event.scriptId);

      if (event.type === "started") {
        if (script) {
          script.status = "RUNNING";
          script.pid = event.pid;
        }
        if (project) {
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
        }
        this.addLog(event.projectId, createLogEntry(`started (pid ${event.pid})`, "SUCCESS"), event.scriptId);
      }

      if (event.type === "stdout" || event.type === "stderr") {
        const outputSource = event.type;
        normalizeLogLines(event.message || "").forEach((line) => {
          this.addLog(
            event.projectId,
            createLogEntry(line, classifyProcessOutputLine(line, outputSource)),
            event.scriptId,
          );
        });
      }

      if (event.type === "stdin") {
        this.addLog(event.projectId, createLogEntry(`> ${event.message || ""}`, "INFO"), event.scriptId);
      }

      if (event.type === "exit") {
        const isStopped = Boolean(event.stoppedByUser || script?.status === "STOPPING");
        const isSuccess = event.code === 0;
        if (script) {
          script.status = isStopped ? "STOPPED" : isSuccess ? "IDLE" : "ERROR";
          script.pid = undefined;
        }
        if (project) {
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
        }
        this.addLog(
          event.projectId,
          createLogEntry(
            isStopped ? "stopped" : `exited with code ${event.code ?? "unknown"}`,
            isSuccess || isStopped ? "SUCCESS" : "ERROR",
          ),
          event.scriptId,
        );
      }

      if (event.type === "error") {
        if (script) {
          script.status = "ERROR";
          script.pid = undefined;
        }
        if (project) {
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
        }
        this.addLog(
          event.projectId,
          createLogEntry(normalizeLogLines(event.message || "command failed")[0] || "command failed", "ERROR"),
          event.scriptId,
        );
      }
      this.handleAutomationBridgeEvent(event);
    },
  },
});
