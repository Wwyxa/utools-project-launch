import { createPinia, setActivePinia } from "pinia";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parse } from "@vue/compiler-sfc";
import { computed, type ComputedRef } from "vue";
import { createSourceFile, isIdentifier, isVariableStatement, ModuleKind, ScriptKind, ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectBridge } from "../src/lib/projectBridge";
import { ProjectStatus, type Project, type ProjectAutomationTask, type ProjectBridge, type RuntimeRecord } from "../src/types";

function loadSummaryDeclarations<Probe>(file: string, names: string[], globals: Record<string, unknown>): Probe {
  const script = parse(readFileSync(file, "utf8")).descriptor.scriptSetup!.content;
  const source = createSourceFile(file, script, ScriptTarget.ES2022, true, ScriptKind.TS);
  const declarations = source.statements.filter((statement) => isVariableStatement(statement) &&
    statement.declarationList.declarations.some((declaration) => isIdentifier(declaration.name) && names.includes(declaration.name.text)));
  const exports = {};
  runInNewContext(transpileModule(`${declarations.map((statement) => statement.getText(source)).join("\n")}\nexport const probe = { ${names.join(", ")} };`, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText, { exports, computed, ...globals });
  return (exports as { probe: Probe }).probe;
}

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const stubWindow = () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    navigator: { platform: "Win32", userAgent: "vitest" },
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    projectBridge: undefined,
  });
};

describe("automation task execution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each([false, true])("restores shared execution history at startup and agrees across task views (service=%s)", async (enabled) => {
    stubWindow();
    const fallback = getProjectBridge();
    const task: ProjectAutomationTask = {
      id: "task", name: "Task", enabled: false, scriptIds: [], continuousScriptIds: [],
      schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
      missedPolicy: "mark-missed", missedGraceMinutes: 5, notifyEnabled: false,
      maxScriptRuntimeMinutes: 30, inputConfigs: [], exitConfigs: [], dailyPlans: [], history: [],
      createdAt: "2026-10-14T09:00:00Z", updatedAt: "2026-10-14T09:00:00Z",
    };
    const project: Project = {
      id: "history-project", name: "History project", path: "/workspace/history", type: "Custom", kind: "custom",
      status: ProjectStatus.STOPPED, scripts: [], env: {}, automationTasks: [task],
    };
    const record = (id: string, endedAt: string, status: "completed" | "failed", projectId = project.id): RuntimeRecord => ({
      schemaVersion: 1, source: "automation", runId: id.padStart(32, "0"), projectId, scriptId: "", label: "task",
      status: status === "failed" ? "failed" : "exited", startedAt: endedAt, endedAt,
      sizeBytes: 100, truncated: false, available: true,
      execution: { id, projectId, taskId: task.id, planEntryId: `${id}-entry`, plannedAt: endedAt, startedAt: endedAt, endedAt, status, currentScriptIndex: 0, scriptResults: [] },
    });
    const latestAt = "2026-10-15T10:00:00Z";
    const listRuntimeRecords = vi.fn().mockResolvedValue([
      record("old", "2026-10-14T10:00:00Z", "failed"), record("latest", latestAt, "completed"),
      record("foreign", "2026-10-16T10:00:00Z", "failed", "other-project"),
    ]);
    window.projectBridge = {
      ...fallback,
      loadProjects: vi.fn().mockResolvedValue([project]),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled }),
      loadRuntimeAutomationState: () => [],
      listRuntimeRecords,
    };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    vi.spyOn(store, "refreshProjectAvailability").mockResolvedValue(undefined);
    vi.spyOn(store, "reconcileRuntimeProcessState").mockResolvedValue(undefined);
    vi.spyOn(store, "refreshDashboardGitChangeCounts").mockResolvedValue(undefined);
    vi.spyOn(store, "recomputeAutomationPlans").mockImplementation(() => {});
    await store.loadProjects();
    expect(listRuntimeRecords).toHaveBeenCalledExactlyOnceWith("");
    const loadedTask = store.projects[0]!.automationTasks![0]!;
    expect(loadedTask.history.map((entry) => entry.id)).toEqual(["latest", "old"]);
    const dashboard = loadSummaryDeclarations<{ automationTasks: ComputedRef<Array<{ lastRunAt: string; currentStatus: string }>> }>(
      "src/components/dashboard/Dashboard.vue", ["automationHistoryTime", "sortedAutomationHistory", "automationTasks"], { store },
    );
    const projectView = loadSummaryDeclarations<{ latestResultAt(task: ProjectAutomationTask): string }>(
      "src/components/project/AutomationTab.vue", ["historyTime", "taskHistory", "latestHistory", "latestResultAt"], { store },
    );
    expect(dashboard.automationTasks.value[0]).toMatchObject({ lastRunAt: latestAt, currentStatus: "completed" });
    expect(projectView.latestResultAt(loadedTask)).toBe(latestAt);
    const dialogHistory = await store.loadRuntimeAutomationHistory(project.id, task.id);
    expect(dialogHistory.map((entry) => entry.id)).toEqual(["latest", "old"]);
    expect(loadedTask.history).toHaveLength(2);
    await store.reloadProjectsFromStorage();
    expect(store.projects[0]!.automationTasks![0]!.history[0]?.endedAt).toBe(latestAt);
    listRuntimeRecords.mockResolvedValue(Array.from({ length: 30 }, (_, index) =>
      record(`retained-${index}`, new Date(Date.UTC(2026, 8, index + 1)).toISOString(), "completed")));
    const retainedHistory = await store.loadRuntimeAutomationHistory(project.id, task.id);
    expect(retainedHistory).toHaveLength(32);
    expect(retainedHistory[0]?.endedAt).toBe(latestAt);
    expect(store.projects[0]!.automationTasks![0]!.history).toHaveLength(20);
  });

  it("starts the next script before a continuous script exits and avoids relaunching it", async () => {
    stubWindow();
    const fallback = getProjectBridge();
    const followerRun = deferred<Awaited<ReturnType<ProjectBridge["runCommand"]>>>();
    const runCommand = vi.fn<ProjectBridge["runCommand"]>(async (payload) => {
      if (payload.scriptId === "persistent-script") {
        return {
          pid: 1001,
          startedAt: "2026-08-17T10:00:00.000Z",
          command: payload.command,
          cwd: payload.cwd,
          runId: "run-persistent",
          runtimeOwner: "preload",
        };
      }
      return followerRun.promise;
    });
    const sendProcessInput = vi.fn<ProjectBridge["sendProcessInput"]>(async () => ({ sent: true }));
    window.projectBridge = {
      ...fallback, runCommand, sendProcessInput,
      saveRuntimeAutomationState: vi.fn(() => ({ ok: true })),
      saveRuntimeAutomationExecution: vi.fn(() => ({ ok: true })),
      appendRuntimeOperationLog: vi.fn(() => ({ ok: true })),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const task: ProjectAutomationTask = {
      id: "automation-task",
      name: "Automation task",
      enabled: false,
      scriptIds: ["persistent-script", "follower-script"],
      continuousScriptIds: ["persistent-script"],
      schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
      missedPolicy: "grace-run",
      missedGraceMinutes: 5,
      notifyEnabled: false,
      maxScriptRuntimeMinutes: 30,
      inputConfigs: [
        {
          scriptId: "persistent-script",
          steps: [
            {
              id: "input-step",
              mode: "delay",
              value: "ready",
              delayMs: 0,
              matchText: "",
              timeoutMs: 30_000,
            },
          ],
        },
      ],
      exitConfigs: [],
      dailyPlans: [
        {
          date: "2026-08-17",
          entries: [{ id: "automation-entry", plannedAt: new Date().toISOString(), status: "pending" }],
        },
      ],
      history: [],
      createdAt: "2026-08-17T09:00:00.000Z",
      updatedAt: "2026-08-17T09:00:00.000Z",
    };
    const project: Project = {
      id: "automation-project",
      name: "Automation project",
      path: "/workspace/automation-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      pathExists: true,
      scripts: [
        {
          id: "persistent-script",
          name: "persistent",
          command: "persistent",
          cwd: ".",
          note: "",
          source: "manual",
          status: "IDLE",
        },
        {
          id: "follower-script",
          name: "follower",
          command: "follower",
          cwd: ".",
          note: "",
          source: "manual",
          status: "IDLE",
        },
      ],
      env: {},
      automationTasks: [task],
    };
    store.projects = [project];

    const firstRun = store.runAutomationTask(project.id, task.id, "automation-entry");
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(2));
    expect(runCommand.mock.calls.map(([payload]) => payload.scriptId)).toEqual([
      "persistent-script",
      "follower-script",
    ]);
    expect(sendProcessInput).toHaveBeenCalledWith(1001, "ready", expect.anything());
    expect(store.projects[0]?.scripts[0]?.status).toBe("RUNNING");

    followerRun.resolve({
      pid: 1002,
      startedAt: "2026-08-17T10:00:01.000Z",
      command: "follower",
      cwd: "/workspace/automation-project",
      runId: "run-follower",
      runtimeOwner: "preload",
    });
    await vi.waitFor(() => expect(store.projects[0]?.scripts[1]?.runId).toBe("run-follower"));
    const automationRunId = runCommand.mock.calls[0]?.[0].automationRunId;
    store.handleBridgeEvent({
      type: "exit",
      projectId: project.id,
      scriptId: "follower-script",
      pid: 1002,
      runId: "run-follower",
      runtimeOwner: "preload",
      automationRunId,
      code: 0,
      signal: null,
      stoppedByUser: false,
    });
    await firstRun;

    const storedTask = store.projects[0]?.automationTasks?.[0];
    expect(storedTask?.dailyPlans[0]?.entries[0]?.status).toBe("completed");
    expect(storedTask?.history[0]?.scriptResults).toMatchObject([
      { scriptId: "persistent-script", status: "started" },
      { scriptId: "follower-script", status: "completed" },
    ]);

    const duplicateTask: ProjectAutomationTask = {
      ...storedTask!,
      id: "duplicate-task",
      name: "Duplicate task",
      scriptIds: ["persistent-script"],
      continuousScriptIds: ["persistent-script"],
      inputConfigs: [],
      dailyPlans: [
        {
          date: "2026-08-17",
          entries: [{ id: "duplicate-entry", plannedAt: new Date().toISOString(), status: "pending" }],
        },
      ],
      history: [],
    };
    store.projects[0]!.automationTasks = [storedTask!, duplicateTask];
    await store.runAutomationTask(project.id, duplicateTask.id, "duplicate-entry");

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(duplicateTask.dailyPlans[0]?.entries[0]?.status).toBe("completed");
    expect(duplicateTask.history[0]?.scriptResults).toMatchObject([
      { scriptId: "persistent-script", status: "started", reason: "脚本已在运行。" },
    ]);
    window.projectBridge.saveRuntimeAutomationState = vi.fn(() => ({ ok: false, error: "Disk full" }));
    const currentTask = store.projects[0]!.automationTasks!.find((task) => task.id === duplicateTask.id)!;
    currentTask.dailyPlans[0]!.entries.push({ id: "blocked-entry", plannedAt: new Date().toISOString(), status: "pending" });
    await store.runAutomationTask(project.id, duplicateTask.id, "blocked-entry");
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(currentTask.dailyPlans[0]?.entries.at(-1)?.status).toBe("failed");
    expect(store.localStateWriteError).toBe("Disk full");
    expect(store.automationActiveProjectRuns[project.id]).toBeUndefined();
  });
});
