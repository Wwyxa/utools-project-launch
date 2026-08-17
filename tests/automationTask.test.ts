import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectBridge } from "../src/lib/projectBridge";
import { ProjectStatus, type Project, type ProjectAutomationTask, type ProjectBridge } from "../src/types";

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
    window.projectBridge = { ...fallback, runCommand, sendProcessInput };

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
  });
});