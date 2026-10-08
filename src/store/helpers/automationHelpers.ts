import type { ProjectAutomationSchedule, ProjectAutomationMissedPolicy, ProjectAutomationInputStep, ProjectAutomationExitConfig, ProjectAutomationScriptResult, ProjectBridgeEvent, LogEntry, ProjectBridgeProcessEvent, ProjectBridgeProcessStatusResult, ProjectAutomationScriptInputConfig, ProjectAutomationDailyPlan, ProjectAutomationPlanEntry, ProjectAutomationHistoryEntry, ProjectAutomationTask, ProjectBridgeStopProcessOptions, ProjectLaunchServiceRunLog } from "../../types";
import { validateAutomationSchedule } from "../../lib/automationScheduler";
import { bridge } from "./bridge";

export const defaultAutomationSchedule = (): ProjectAutomationSchedule => ({
  type: "fixed",
  startTime: "09:00",
  dailyCount: 1,
  intervalMinutes: 60,
});

export const AUTOMATION_HISTORY_LIMIT = 20;

export const DEFAULT_AUTOMATION_MAX_RUNTIME_MINUTES = 30;

export const DEFAULT_AUTOMATION_MISSED_GRACE_MINUTES = 5;

export const LIVE_PROJECT_LOG_ENTRY_LIMIT = 2_000;

export const waitForInitialPaint = (): Promise<void> => {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
};

export const automationMissedPolicies = new Set<ProjectAutomationMissedPolicy>(["grace-run", "run-now", "mark-missed"]);

export const automationSchedulerState = { timer: null as number | null };

export const ansiControlPattern =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export interface AutomationScriptRuntimeContext {
  runId: string;
  projectId: string;
  scriptId: string;
  scriptName: string;
  startedAt: string;
  steps: ProjectAutomationInputStep[];
  exitConfig?: ProjectAutomationExitConfig;
  continueAfterInput: boolean;
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

export const automationScriptContexts = new Map<string, AutomationScriptRuntimeContext>();

export type PendingRuntimeTerminalEvent = ProjectBridgeEvent & { type: "exit" | "error" };

export const pendingRuntimeTerminalEvents = new Map<string, PendingRuntimeTerminalEvent>();

export const pendingRuntimeTerminalEventLimit = 64;

export type RuntimeRunObservation = "active" | "pending-terminal" | "terminal";

export const runtimeRunObservations = new Map<string, RuntimeRunObservation>();

export const runtimeRunObservationLimit = 128;

export const observedServiceEvents = new Map<string, true>();

export const observedServiceEventLimit = 512;

export const liveLogScriptIds = new WeakMap<LogEntry, string>();

export function trimLiveProjectLogs(projectLogs: LogEntry[], scriptLogs?: Record<string, LogEntry[]>) {
  const overflow = projectLogs.length - LIVE_PROJECT_LOG_ENTRY_LIMIT;
  if (overflow <= 0) {
    return;
  }

  const removedLogs = projectLogs.splice(0, overflow);
  for (const log of removedLogs) {
    const scriptId = liveLogScriptIds.get(log);
    const scriptEntries = scriptId ? scriptLogs?.[scriptId] : undefined;
    if (!scriptEntries) {
      continue;
    }
    if (scriptEntries[0] === log) {
      scriptEntries.shift();
      continue;
    }
    const entryIndex = scriptEntries.indexOf(log);
    if (entryIndex >= 0) {
      scriptEntries.splice(entryIndex, 1);
    }
  }
}

export function automationScriptContextKey(projectId: string, scriptId: string) {
  return `${projectId}::${scriptId}`;
}

export function pendingRuntimeTerminalEventKey(projectId: string, scriptId: string, runId: string) {
  return `${projectId}\u0000${scriptId}\u0000${runId}`;
}

export function rememberRuntimeRun(key: string, observation: RuntimeRunObservation) {
  runtimeRunObservations.delete(key);
  runtimeRunObservations.set(key, observation);
  while (runtimeRunObservations.size > runtimeRunObservationLimit) {
    const oldestKey = runtimeRunObservations.keys().next().value;
    if (oldestKey === undefined) break;
    runtimeRunObservations.delete(oldestKey);
  }
}

export function hasObservedServiceEvent(event: ProjectBridgeProcessEvent) {
  const { cursor, runId } = event;
  if (
    event.runtimeOwner !== "service" ||
    !runId ||
    typeof cursor !== "number" ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0
  ) {
    return false;
  }

  const key = `${runId}\u0000${cursor}`;
  if (observedServiceEvents.has(key)) {
    return true;
  }
  observedServiceEvents.set(key, true);
  while (observedServiceEvents.size > observedServiceEventLimit) {
    const oldestKey = observedServiceEvents.keys().next().value;
    if (oldestKey === undefined) break;
    observedServiceEvents.delete(oldestKey);
  }
  return false;
}

export function isPendingRuntimeTerminalEvent(event: ProjectBridgeEvent): event is PendingRuntimeTerminalEvent {
  return event.type === "exit" || event.type === "error";
}

export function clearPendingRuntimeTerminalEvents(projectId: string, scriptId: string) {
  const prefix = `${projectId}\u0000${scriptId}\u0000`;
  for (const key of pendingRuntimeTerminalEvents.keys()) {
    if (key.startsWith(prefix)) {
      pendingRuntimeTerminalEvents.delete(key);
    }
  }
}

export function clearAutomationSchedulerTimer() {
  if (automationSchedulerState.timer) {
    window.clearTimeout(automationSchedulerState.timer);
    automationSchedulerState.timer = null;
  }
}

export function clearAutomationContextTimers(context: AutomationScriptRuntimeContext) {
  context.timers.forEach((timer) => window.clearTimeout(timer));
  context.timers = [];
  if (context.runtimeTimer) {
    window.clearTimeout(context.runtimeTimer);
    context.runtimeTimer = null;
  }
}

export function clearAutomationStepTimers(context: AutomationScriptRuntimeContext) {
  context.timers.forEach((timer) => window.clearTimeout(timer));
  context.timers = [];
  context.waitingStepIndex = null;
}

export function settleAutomationScriptContext(context: AutomationScriptRuntimeContext, result: ProjectAutomationScriptResult) {
  if (context.settled) {
    return;
  }
  context.settled = true;
  clearAutomationContextTimers(context);
  automationScriptContexts.delete(automationScriptContextKey(context.projectId, context.scriptId));
  context.resolve(result);
}

export function shouldAutomationExitOnOutput(context: AutomationScriptRuntimeContext) {
  return Boolean(
    context.inputCompleted && context.exitConfig?.matchText && context.output.includes(context.exitConfig.matchText),
  );
}

export function isSuccessfulAutomationProcessResult(
  result: Pick<ProjectBridgeProcessStatusResult, "code" | "error" | "automationExitMatched"> | null | undefined,
) {
  return Boolean(result && !result.error && (result.code === 0 || result.automationExitMatched === true));
}

export function normalizeAutomationSchedule(value: unknown): ProjectAutomationSchedule {
  if (!value || typeof value !== "object") {
    return defaultAutomationSchedule();
  }

  const candidate = value as Partial<{
    type: ProjectAutomationSchedule["type"];
    startTime: string;
    windowStart: string;
    windowEnd: string;
    dailyCount: number;
    intervalMinutes: number;
    minIntervalMinutes: number;
    maxIntervalMinutes: number;
  }>;
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

export function normalizeAutomationMissedPolicy(value: unknown): ProjectAutomationMissedPolicy {
  return typeof value === "string" && automationMissedPolicies.has(value as ProjectAutomationMissedPolicy)
    ? (value as ProjectAutomationMissedPolicy)
    : "grace-run";
}

export function normalizeAutomationMissedGraceMinutes(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : DEFAULT_AUTOMATION_MISSED_GRACE_MINUTES;
}

export function normalizeAutomationInputSteps(value: unknown): ProjectAutomationInputStep[] {
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

export function normalizeAutomationInputConfigs(value: unknown): ProjectAutomationScriptInputConfig[] {
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

export function normalizeAutomationExitConfigs(value: unknown): ProjectAutomationExitConfig[] {
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

export function normalizeAutomationDailyPlans(value: unknown): ProjectAutomationDailyPlan[] {
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

export function normalizeAutomationHistory(value: unknown): ProjectAutomationHistoryEntry[] {
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

export function normalizeAutomationTasks(projectId: string, value: unknown): ProjectAutomationTask[] {
  const tasks = Array.isArray(value) ? value : [];
  return tasks.reduce<ProjectAutomationTask[]>((normalizedTasks, task, index) => {
    if (!task || typeof task !== "object") {
      return normalizedTasks;
    }

    const candidate = task as Partial<ProjectAutomationTask>;
    const now = new Date().toISOString();
    const scriptIds = Array.isArray(candidate.scriptIds)
      ? candidate.scriptIds.filter(
        (scriptId): scriptId is string => typeof scriptId === "string" && scriptId.trim().length > 0,
      )
      : [];
    const automationTask: ProjectAutomationTask = {
      id:
        typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `${projectId}-automation-${index + 1}`,
      name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : `任务 ${index + 1}`,
      enabled: Boolean(candidate.enabled),
      scriptIds,
      continuousScriptIds: Array.isArray(candidate.continuousScriptIds)
        ? candidate.continuousScriptIds.filter(
          (scriptId): scriptId is string =>
            typeof scriptId === "string" && scriptId.trim().length > 0 && scriptIds.includes(scriptId),
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
      observedServiceExecutionIds: Array.isArray(candidate.observedServiceExecutionIds)
        ? [
          ...new Set(
            candidate.observedServiceExecutionIds.filter(
              (id): id is string => typeof id === "string" && Boolean(id.trim()),
            ),
          ),
        ].slice(-AUTOMATION_HISTORY_LIMIT)
        : [],
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : now,
    };
    normalizedTasks.push(automationTask);
    return normalizedTasks;
  }, []);
}

export function createLogEntry(message: string, type: LogEntry["type"], eventTimestamp?: string): LogEntry {
  const eventTime = eventTimestamp ? new Date(eventTimestamp) : null;
  return {
    timestamp:
      eventTime && !Number.isNaN(eventTime.getTime())
        ? eventTime.toLocaleTimeString()
        : new Date().toLocaleTimeString(),
    message,
    type,
  };
}

export function scheduleProcessStop(pid: number, options?: ProjectBridgeStopProcessOptions) {
  if (options?.automationExitMatched === true) {
    void bridge.stopProcess(pid, options).catch(() => undefined);
    return;
  }
  window.setTimeout(() => {
    void bridge.stopProcess(pid, options).catch(() => undefined);
  }, 0);
}

export function normalizeLogLines(message: string): string[] {
  const normalized = message.replace(ansiControlPattern, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  return normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

export function classifyProcessOutputLine(line: string, source: "stdout" | "stderr"): LogEntry["type"] {
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

export function retainedRunLogEntries(runLog: ProjectLaunchServiceRunLog): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const event of runLog.events) {
    const createEntry = (message: string, type: LogEntry["type"]) => createLogEntry(message, type, event.timestamp);
    if (event.type === "started") {
      entries.push(
        createEntry(
          [`started (pid ${event.pid || 0})`, event.message || "", event.cwd ? `cwd: ${event.cwd}` : ""]
            .filter(Boolean)
            .join(" · "),
          "SUCCESS",
        ),
      );
      continue;
    }
    if (event.type === "stdout" || event.type === "stderr") {
      const outputSource = event.type;
      normalizeLogLines(event.message || "").forEach((line) => {
        entries.push(createEntry(line, classifyProcessOutputLine(line, outputSource)));
      });
      continue;
    }
    if (event.type === "stdin") {
      entries.push(createEntry(`> ${event.message || ""}`, "INFO"));
      continue;
    }
    if (event.type === "exit") {
      const stopped = event.stoppedByUser === true;
      const succeeded = stopped || event.automationExitMatched === true || event.code === 0;
      entries.push(
        createEntry(
          stopped ? "stopped" : `exited with code ${event.code ?? "unknown"}`,
          succeeded ? "SUCCESS" : "ERROR",
        ),
      );
      continue;
    }
    entries.push(createEntry(normalizeLogLines(event.message || "command failed")[0] || "command failed", "ERROR"));
  }
  return entries;
}
