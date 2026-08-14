import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { getProjectBridge } from "../src/lib/projectBridge";
import { dateKey } from "../src/lib/automationScheduler";
import {
  ProjectStatus,
  type Project,
  type ProjectBridge,
  type ProjectDetailsTabId,
  type ProjectLaunchServiceStatus,
  type UiPreferences,
} from "../src/types";

const uiPreferencesKey = "utools-project-launch.ui-preferences.v1";
const legacyTabOrderKey = "utools-project-launch.project-details-tab-order.v1";
const projectLaunchServicePreferencesKey = "utools-project-launch.project-launch-service.v1";
const defaultTabOrder: ProjectDetailsTabId[] = ["info", "scripts", "automation", "files", "git", "memo"];

const loadPreloadBridge = (
  storage: Map<string, unknown>,
  removeItem: (key: string) => void = (key) => {
    storage.delete(key);
  },
  environment: NodeJS.ProcessEnv = {},
) => {
  const nodeRequire = createRequire(import.meta.url);
  const sandboxWindow: { projectBridge?: ProjectBridge; utools: { dbStorage: object } } = {
    utools: {
      dbStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: unknown) => storage.set(key, value),
        removeItem,
      },
    },
  };
  const sandbox = {
    require: (id: string) => (id === "electron" ? { shell: {} } : nodeRequire(id)),
    process: {
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      env: { ...process.env, ...environment },
      kill: process.kill.bind(process),
      once: () => undefined,
      exit: () => undefined,
    },
    Buffer,
    console,
    setTimeout,
    clearTimeout,
    window: sandboxWindow,
  };
  createContext(sandbox);
  runInContext(readFileSync(resolve("public/preload.js"), "utf8"), sandbox);
  if (!sandboxWindow.projectBridge) throw new Error("The real preload did not register projectBridge.");
  return sandboxWindow.projectBridge;
};

describe("browser UI preferences fallback", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("window", {
      navigator: { platform: "", userAgent: "vitest" },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      setTimeout,
      clearTimeout,
      projectBridge: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns and persists complete defaults without stored preferences", () => {
    expect(getProjectBridge().loadUiPreferences()).toEqual({
      schemaVersion: 1,
      projectDetails: { tabOrder: defaultTabOrder },
      coachMarks: { projectDetailsTabReorder: 0 },
    });
    expect(JSON.parse(storage.get(uiPreferencesKey)!)).toMatchObject({ schemaVersion: 1 });
  });

  it.each([
    [defaultTabOrder, 0],
    [["scripts", "info", "automation", "files", "git", "memo"], 1],
  ])("migrates legacy order %j with coach mark version %i", (legacyOrder, expectedVersion) => {
    storage.set(legacyTabOrderKey, JSON.stringify(legacyOrder));

    const preferences = getProjectBridge().loadUiPreferences();

    expect(preferences.projectDetails.tabOrder).toEqual(legacyOrder);
    expect(preferences.coachMarks.projectDetailsTabReorder).toBe(expectedVersion);
    expect(JSON.parse(storage.get(uiPreferencesKey)!)).toEqual(preferences);
    expect(storage.has(legacyTabOrderKey)).toBe(false);
  });

  it("normalizes duplicate and unknown tabs and an invalid coach mark version", () => {
    storage.set(
      uiPreferencesKey,
      JSON.stringify({
        schemaVersion: 1,
        projectDetails: { tabOrder: ["memo", "unknown", "memo", "info"] },
        coachMarks: { projectDetailsTabReorder: 1.5 },
      }),
    );

    expect(getProjectBridge().loadUiPreferences()).toEqual({
      schemaVersion: 1,
      projectDetails: { tabOrder: ["memo", "info", "scripts", "automation", "files", "git"] },
      coachMarks: { projectDetailsTabReorder: 0 },
    });
  });

  it("falls back safely for damaged JSON", () => {
    storage.set(uiPreferencesKey, "{");
    storage.set(legacyTabOrderKey, JSON.stringify(["scripts", "info"]));

    expect(getProjectBridge().loadUiPreferences()).toEqual({
      schemaVersion: 1,
      projectDetails: { tabOrder: defaultTabOrder },
      coachMarks: { projectDetailsTabReorder: 0 },
    });
  });

  it("prefers an existing new configuration over the legacy order", () => {
    storage.set(
      uiPreferencesKey,
      JSON.stringify({
        schemaVersion: 1,
        projectDetails: { tabOrder: ["memo", "info"] },
        coachMarks: { projectDetailsTabReorder: 1 },
      }),
    );
    storage.set(legacyTabOrderKey, JSON.stringify(["scripts", "info"]));

    expect(getProjectBridge().loadUiPreferences().projectDetails.tabOrder).toEqual([
      "memo",
      "info",
      "scripts",
      "automation",
      "files",
      "git",
    ]);
  });

  it("keeps readable current preferences when legacy cleanup fails", () => {
    storage.set(
      uiPreferencesKey,
      JSON.stringify({
        schemaVersion: 1,
        projectDetails: { tabOrder: ["memo", "info"] },
        coachMarks: { projectDetailsTabReorder: 1 },
      }),
    );
    window.localStorage.removeItem = vi.fn(() => {
      throw new Error("storage unavailable");
    });

    expect(getProjectBridge().loadUiPreferences()).toEqual({
      schemaVersion: 1,
      projectDetails: { tabOrder: ["memo", "info", "scripts", "automation", "files", "git"] },
      coachMarks: { projectDetailsTabReorder: 1 },
    });
  });

  it("round-trips normalized preferences and removes the legacy order", () => {
    getProjectBridge().saveUiPreferences({
      schemaVersion: 1,
      projectDetails: { tabOrder: ["git", "git", "memo"] },
      coachMarks: { projectDetailsTabReorder: 2 },
    });

    const preferences = getProjectBridge().loadUiPreferences();
    expect(preferences.projectDetails.tabOrder).toEqual(["git", "memo", "info", "scripts", "automation", "files"]);
    expect(preferences.coachMarks.projectDetailsTabReorder).toBe(2);
    expect(storage.has(legacyTabOrderKey)).toBe(false);
  });

  it("keeps Project Launch Service disabled by default and normalizes stored preferences", () => {
    expect(getProjectBridge().loadProjectLaunchServicePreferences()).toEqual({ schemaVersion: 1, enabled: false });

    storage.set(projectLaunchServicePreferencesKey, JSON.stringify({ schemaVersion: 1, enabled: true }));
    expect(getProjectBridge().loadProjectLaunchServicePreferences()).toEqual({ schemaVersion: 1, enabled: true });

    storage.set(projectLaunchServicePreferencesKey, JSON.stringify({ schemaVersion: 2, enabled: true }));
    expect(getProjectBridge().loadProjectLaunchServicePreferences()).toEqual({ schemaVersion: 1, enabled: false });
  });

  it("fails closed instead of simulating a preload launch when service mode is enabled", async () => {
    getProjectBridge().saveProjectLaunchServicePreferences({ schemaVersion: 1, enabled: true });

    await expect(
      getProjectBridge().runCommand({
        projectId: "project",
        scriptId: "script",
        command: "echo browser-preview",
        cwd: "/workspace/project",
        env: {},
        label: "Project / Script",
      }),
    ).rejects.toThrow("项目启动服务在浏览器预览中不可用");
  });

  it("loads once and persists only effective store changes", async () => {
    const initialPreferences: UiPreferences = {
      schemaVersion: 1,
      projectDetails: { tabOrder: [...defaultTabOrder] },
      coachMarks: { projectDetailsTabReorder: 0 },
    };
    const loadUiPreferences = vi.fn(() => initialPreferences);
    const saveUiPreferences = vi.fn<ProjectBridge["saveUiPreferences"]>();
    window.projectBridge = { ...getProjectBridge(), loadUiPreferences, saveUiPreferences };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    expect(loadUiPreferences).toHaveBeenCalledTimes(1);
    await store.loadProjects();
    expect(loadUiPreferences).toHaveBeenCalledTimes(1);

    store.setProjectDetailsTabOrder([...initialPreferences.projectDetails.tabOrder]);
    expect(saveUiPreferences).not.toHaveBeenCalled();

    store.setProjectDetailsTabOrder(["scripts", "info", "automation", "files", "git", "memo"]);
    expect(saveUiPreferences).toHaveBeenCalledTimes(1);

    store.acknowledgeProjectDetailsTabReorderHint(1);
    store.acknowledgeProjectDetailsTabReorderHint(1);
    expect(store.uiPreferences.coachMarks.projectDetailsTabReorder).toBe(1);
    expect(saveUiPreferences).toHaveBeenCalledTimes(2);
  });

  it("keeps renderer ownership when Project Launch Service rejects automation handoff", async () => {
    const saveProjectLaunchServicePreferences = vi.fn<ProjectBridge["saveProjectLaunchServicePreferences"]>();
    const syncProjectLaunchServiceAutomation = vi.fn<ProjectBridge["syncProjectLaunchServiceAutomation"]>(
      async (config) => ({
        accepted: false,
        revision: config.revision,
        message: "service rejected automation configuration",
      }),
    );
    const healthyStatus = {
      state: "healthy" as const,
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      automationRevision: 0,
    };
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: false }),
      saveProjectLaunchServicePreferences,
      getProjectLaunchServiceStatus: async () => healthyStatus,
      startProjectLaunchService: async () => healthyStatus,
      reconcileProjectLaunchService: async () => healthyStatus,
      syncProjectLaunchServiceAutomation,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    await store.setProjectLaunchServiceEnabled(true);

    expect(syncProjectLaunchServiceAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 1, revision: 1 }),
    );
    expect(store.projectLaunchServicePreferences.enabled).toBe(false);
    expect(saveProjectLaunchServicePreferences).not.toHaveBeenCalled();
    expect(store.projectLaunchServiceStatus).toMatchObject({
      state: "unavailable",
      message: "service rejected automation configuration",
    });
  });

  it("starts Project Launch Service before synchronizing the first enabled handoff", async () => {
    const saveProjectLaunchServicePreferences = vi.fn<ProjectBridge["saveProjectLaunchServicePreferences"]>();
    const startProjectLaunchService = vi.fn<ProjectBridge["startProjectLaunchService"]>();
    const reconcileProjectLaunchService = vi.fn<ProjectBridge["reconcileProjectLaunchService"]>();
    const syncProjectLaunchServiceAutomation = vi.fn<ProjectBridge["syncProjectLaunchServiceAutomation"]>();
    const healthyStatus = {
      state: "healthy" as const,
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      automationRevision: 0,
    };
    startProjectLaunchService.mockResolvedValue(healthyStatus);
    reconcileProjectLaunchService.mockResolvedValue(healthyStatus);
    syncProjectLaunchServiceAutomation.mockImplementation(async (config) => ({
      accepted: true,
      revision: config.revision,
    }));
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: false }),
      saveProjectLaunchServicePreferences,
      startProjectLaunchService,
      reconcileProjectLaunchService,
      syncProjectLaunchServiceAutomation,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    await store.setProjectLaunchServiceEnabled(true);

    expect(startProjectLaunchService).toHaveBeenCalledTimes(1);
    expect(startProjectLaunchService.mock.invocationCallOrder[0]).toBeLessThan(
      reconcileProjectLaunchService.mock.invocationCallOrder[0]!,
    );
    expect(syncProjectLaunchServiceAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 1, revision: 1 }),
    );
    expect(store.projectLaunchServicePreferences.enabled).toBe(true);
    expect(saveProjectLaunchServicePreferences).toHaveBeenCalledWith({ schemaVersion: 1, enabled: true });
  });

  it("pauses renderer automation until Project Launch Service accepts the ownership handoff", async () => {
    const healthyStatus: ProjectLaunchServiceStatus = {
      state: "healthy",
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      automationRevision: 0,
    };
    let acceptHandoff: (result: { accepted: boolean; revision: number }) => void = () => undefined;
    const syncProjectLaunchServiceAutomation = vi.fn<ProjectBridge["syncProjectLaunchServiceAutomation"]>(
      () =>
        new Promise((resolve) => {
          acceptHandoff = resolve;
        }),
    );
    const runCommand = vi.fn<ProjectBridge["runCommand"]>(async () => ({
      pid: 99,
      startedAt: new Date().toISOString(),
      command: "echo renderer-run",
      cwd: "/workspace/handoff-project",
    }));
    const dueAt = new Date(Date.now() - 1_000).toISOString();
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: false }),
      startProjectLaunchService: async () => healthyStatus,
      reconcileProjectLaunchService: async () => healthyStatus,
      syncProjectLaunchServiceAutomation,
      runCommand,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "handoff-project",
        name: "Handoff project",
        path: "/workspace/handoff-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [{ id: "handoff-script", name: "dev", command: "echo renderer-run", status: "IDLE" }],
        automationTasks: [
          {
            id: "handoff-task",
            name: "Handoff task",
            enabled: true,
            scriptIds: ["handoff-script"],
            schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
            missedPolicy: "grace-run",
            missedGraceMinutes: 5,
            notifyEnabled: false,
            maxScriptRuntimeMinutes: 30,
            inputConfigs: [],
            exitConfigs: [],
            dailyPlans: [{ date: dateKey(), entries: [{ id: "handoff-entry", plannedAt: dueAt, status: "pending" }] }],
            history: [],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
          },
        ],
        env: {},
      },
    ];

    const enabling = store.setProjectLaunchServiceEnabled(true);
    await vi.waitFor(() => expect(syncProjectLaunchServiceAutomation).toHaveBeenCalledTimes(1));

    await store.runDueAutomationPlans();
    expect(runCommand).not.toHaveBeenCalled();

    acceptHandoff({ accepted: true, revision: 1 });
    await enabling;
    expect(store.projectLaunchServicePreferences.enabled).toBe(true);
  });

  it("synchronizes enabled automation changes with Project Launch Service", async () => {
    const healthyStatus: ProjectLaunchServiceStatus = {
      state: "healthy",
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      automationRevision: 0,
    };
    const syncProjectLaunchServiceAutomation = vi.fn<ProjectBridge["syncProjectLaunchServiceAutomation"]>(
      async (config) => ({ accepted: true, revision: config.revision }),
    );
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
      getProjectLaunchServiceStatus: async () => healthyStatus,
      reconcileProjectLaunchService: async () => healthyStatus,
      syncProjectLaunchServiceAutomation,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "service-project",
        name: "Service project",
        path: "/workspace/service-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [{ id: "service-script", name: "dev", command: "npm run dev", status: "IDLE" }],
        automationTasks: [],
        env: {},
      },
    ];

    expect(
      store.createAutomationTask("service-project", {
        name: "Service task",
        scriptIds: ["service-script"],
      }).ok,
    ).toBe(true);

    await vi.waitFor(() => {
      expect(syncProjectLaunchServiceAutomation).toHaveBeenCalledWith(
        expect.objectContaining({
          schemaVersion: 1,
          revision: 1,
          projects: [
            expect.objectContaining({
              id: "service-project",
              automationTasks: [expect.objectContaining({ id: expect.any(String) })],
            }),
          ],
        }),
      );
    });
  });

  it("blocks manual automation while the enabled Project Launch Service is unavailable", async () => {
    const unavailableStatus: ProjectLaunchServiceStatus = {
      state: "unavailable",
      installed: true,
      running: false,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      message: "Project Launch Service is unavailable.",
    };
    const reconcileProjectLaunchService = vi.fn<ProjectBridge["reconcileProjectLaunchService"]>(
      async () => unavailableStatus,
    );
    const futureAt = new Date(Date.now() + 60_000).toISOString();
    const project: Project = {
      id: "unavailable-service-project",
      name: "Unavailable service project",
      path: "/workspace/unavailable-service-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [{ id: "unavailable-service-script", name: "dev", command: "npm run dev", status: "IDLE" }],
      automationTasks: [
        {
          id: "unavailable-service-task",
          name: "Unavailable service task",
          enabled: true,
          scriptIds: ["unavailable-service-script"],
          schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
          missedPolicy: "grace-run",
          missedGraceMinutes: 5,
          notifyEnabled: false,
          maxScriptRuntimeMinutes: 30,
          inputConfigs: [],
          exitConfigs: [],
          dailyPlans: [
            { date: dateKey(), entries: [{ id: "unavailable-service-entry", plannedAt: futureAt, status: "pending" }] },
          ],
          history: [],
          createdAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
      ],
      env: {},
    };
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
      reconcileProjectLaunchService,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [project];

    await expect(store.runAutomationTaskNow(project.id, "unavailable-service-task")).resolves.toBe(false);
    await expect(
      store.runAutomationPlanEntryEarly(project.id, "unavailable-service-task", "unavailable-service-entry"),
    ).resolves.toBe(false);

    const task = store.projects[0]?.automationTasks?.[0];
    expect(reconcileProjectLaunchService).toHaveBeenCalledTimes(2);
    expect(task?.dailyPlans).toEqual([
      {
        date: dateKey(),
        entries: [{ id: "unavailable-service-entry", plannedAt: futureAt, status: "pending" }],
      },
    ]);
  });

  it("waits for Project Launch Service automation acknowledgement before reporting a manual run", async () => {
    const healthyStatus: ProjectLaunchServiceStatus = {
      state: "healthy",
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
    };
    const futureAt = new Date(Date.now() + 60_000).toISOString();
    const project: Project = {
      id: "rejected-service-project",
      name: "Rejected service project",
      path: "/workspace/rejected-service-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [{ id: "rejected-service-script", name: "dev", command: "npm run dev", status: "IDLE" }],
      automationTasks: [
        {
          id: "rejected-service-task",
          name: "Rejected service task",
          enabled: true,
          scriptIds: ["rejected-service-script"],
          schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
          missedPolicy: "grace-run",
          missedGraceMinutes: 5,
          notifyEnabled: false,
          maxScriptRuntimeMinutes: 30,
          inputConfigs: [],
          exitConfigs: [],
          dailyPlans: [
            { date: dateKey(), entries: [{ id: "rejected-service-entry", plannedAt: futureAt, status: "pending" }] },
          ],
          history: [],
          createdAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
      ],
      env: {},
    };
    const syncProjectLaunchServiceAutomation = vi.fn<ProjectBridge["syncProjectLaunchServiceAutomation"]>(
      async (config) => ({
        accepted: false,
        revision: config.revision,
        message: "service rejected manual automation",
      }),
    );
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
      reconcileProjectLaunchService: async () => healthyStatus,
      syncProjectLaunchServiceAutomation,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [project];

    await expect(store.runAutomationTaskNow(project.id, "rejected-service-task")).resolves.toBe(false);
    await expect(
      store.runAutomationPlanEntryEarly(project.id, "rejected-service-task", "rejected-service-entry"),
    ).resolves.toBe(false);

    const entry = store.projects[0]?.automationTasks?.[0]?.dailyPlans[0]?.entries[0];
    expect(entry).toEqual({ id: "rejected-service-entry", plannedAt: futureAt, status: "pending" });
    expect(syncProjectLaunchServiceAutomation).toHaveBeenCalledTimes(2);
    expect(store.projectLaunchServiceStatus).toMatchObject({
      state: "unavailable",
      message: "service rejected manual automation",
    });
  });

  it("restores service-owned script state and retained output after plugin reconnect", async () => {
    const project: Project = {
      id: "reconnected-project",
      name: "Reconnected project",
      path: "/workspace/reconnected-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [{ id: "reconnected-script", name: "dev", command: "npm run dev", status: "IDLE" }],
      automationTasks: [
        {
          id: "reconnected-task",
          name: "Reconnected task",
          enabled: true,
          scriptIds: ["reconnected-script"],
          schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
          missedPolicy: "grace-run",
          missedGraceMinutes: 5,
          notifyEnabled: false,
          maxScriptRuntimeMinutes: 30,
          inputConfigs: [],
          exitConfigs: [],
          dailyPlans: [
            {
              date: "2026-08-14",
              entries: [
                {
                  id: "reconnected-entry",
                  plannedAt: "2026-08-14T00:00:00.000Z",
                  status: "pending",
                },
              ],
            },
          ],
          history: [],
          createdAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
      ],
      env: {},
    };
    const status: ProjectLaunchServiceStatus = {
      state: "healthy",
      installed: true,
      running: true,
      platform: "linux",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-linux-amd64",
      directoryPath: "/service",
      executablePath: "/service/project-launch-service",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      runs: [
        {
          id: "1234567890abcdef1234567890abcdef",
          projectId: project.id,
          scriptId: "reconnected-script",
          label: "Reconnected project / dev",
          command: "npm run dev",
          cwd: project.path,
          pid: 4242,
          status: "running",
          startedAt: "2026-08-14T00:00:00.000Z",
        },
      ],
      events: [
        {
          cursor: 3,
          timestamp: "2026-08-14T00:00:01.000Z",
          type: "stdout",
          runId: "1234567890abcdef1234567890abcdef",
          projectId: project.id,
          scriptId: "reconnected-script",
          pid: 4242,
          message: "service output survived reconnect",
        },
      ],
      eventsTruncated: true,
      automationRevision: 4,
      automation: {
        revision: 4,
        executions: [
          {
            id: "reconnected-automation-run",
            projectId: project.id,
            taskId: "reconnected-task",
            planEntryId: "reconnected-entry",
            status: "completed",
            currentScriptIndex: 1,
            startedAt: "2026-08-14T00:00:00.000Z",
            endedAt: "2026-08-14T00:00:02.000Z",
            scriptResults: [
              {
                scriptId: "reconnected-script",
                status: "completed",
                startedAt: "2026-08-14T00:00:00.000Z",
                endedAt: "2026-08-14T00:00:02.000Z",
              },
            ],
          },
        ],
      },
    };
    const reconcileProjectLaunchService = vi.fn<ProjectBridge["reconcileProjectLaunchService"]>(async () => status);
    const getProjectLaunchServiceStatus = vi.fn<ProjectBridge["getProjectLaunchServiceStatus"]>(async () => ({
      ...status,
      runs: [],
      events: [],
      automation: { revision: 0 },
    }));
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
      loadProjects: async () => [project],
      pathExists: async () => true,
      reconcileProjectLaunchService,
      getProjectLaunchServiceStatus,
      getProcessStatus: async () => ({ active: true }),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    await store.loadProjects();
    await store.refreshProjectLaunchServiceStatus();

    const script = store.projects[0]?.scripts[0];
    expect(script).toMatchObject({
      status: "RUNNING",
      pid: 4242,
      runId: "1234567890abcdef1234567890abcdef",
      runtimeOwner: "service",
    });
    expect(store.projects[0]?.status).toBe(ProjectStatus.RUNNING);
    expect(reconcileProjectLaunchService).toHaveBeenCalled();
    expect(getProjectLaunchServiceStatus).not.toHaveBeenCalled();
    expect(store.projectLaunchServiceStatus?.eventsTruncated).toBe(true);
    expect(store.scriptLogs[project.id]?.["reconnected-script"]).toContainEqual(
      expect.objectContaining({
        message: "service output survived reconnect",
        timestamp: new Date("2026-08-14T00:00:01.000Z").toLocaleTimeString(),
      }),
    );
    const task = store.projects[0]?.automationTasks?.find((item) => item.id === "reconnected-task");
    const entry = task?.dailyPlans.flatMap((plan) => plan.entries).find((item) => item.id === "reconnected-entry");
    expect(entry).toMatchObject({ status: "completed", runId: "reconnected-automation-run" });
    expect(task?.history).toContainEqual(
      expect.objectContaining({
        id: "reconnected-automation-run",
        status: "completed",
        plannedAt: "2026-08-14T00:00:00.000Z",
      }),
    );
  });
});

describe("store startup timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      navigator: { platform: "", userAgent: "vitest" },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      setTimeout,
      clearTimeout,
      projectBridge: undefined,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("marks project loading subphases only when timing is enabled", async () => {
    const mark = vi.fn<(phase: string) => void>();
    window.__utoolsProjectLaunchStartupTiming = { preloadStartedAtEpochMs: 0, mark };
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    await store.loadProjects();

    expect(mark.mock.calls.map(([phase]) => phase)).toEqual([
      "projects-load-preferences-start",
      "projects-load-preferences-complete",
      "projects-load-storage-hydration-start",
      "projects-load-storage-hydration-complete",
      "projects-load-state-setup-start",
      "projects-load-state-setup-complete",
      "projects-load-path-availability-start",
      "projects-load-path-availability-complete",
      "projects-load-runtime-reconciliation-start",
      "projects-load-runtime-reconciliation-complete",
      "projects-load-automation-plan-recomputation-start",
      "projects-load-automation-plan-recomputation-complete",
    ]);

    mark.mockClear();
    window.__utoolsProjectLaunchStartupTiming = undefined;
    await store.loadProjects();

    expect(mark).not.toHaveBeenCalled();
  });

  it("keeps caught storage errors and immediate completion without animation frames", async () => {
    const loadProjects = vi.fn<ProjectBridge["loadProjects"]>(async () => {
      throw new Error("storage unavailable");
    });
    window.projectBridge = { ...getProjectBridge(), loadProjects };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const initialProjectIds = store.projects.map((project) => project.id);

    await expect(store.loadProjects()).resolves.toBeUndefined();

    expect(loadProjects).toHaveBeenCalledTimes(1);
    expect(store.projectsLoaded).toBe(true);
    expect(store.projects.map((project) => project.id)).toEqual(initialProjectIds);
  });

  it("waits for two animation frames before deferred work and load completion", async () => {
    let nextFrameCallbacks: FrameRequestCallback[] = [];
    let frameTimestamp = 0;
    let paintedFrameCount = 0;
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrameCallbacks.push(callback);
      return nextFrameCallbacks.length;
    });
    const advanceFrame = async () => {
      const frameCallbacks = nextFrameCallbacks;
      nextFrameCallbacks = [];
      frameTimestamp += 16;
      frameCallbacks.forEach((callback) => callback(frameTimestamp));
      await Promise.resolve();
      paintedFrameCount += 1;
    };
    const mark = vi.fn<(phase: string) => void>();
    const project: Project = {
      id: "startup-project",
      name: "Startup project",
      path: "/workspace/startup-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [],
      env: {},
      memo: "Hydrated memo",
    };
    let resolvePathExists: (exists: boolean) => void = () => undefined;
    const pathExistsResult = new Promise<boolean>((resolve) => {
      resolvePathExists = resolve;
    });
    let pathAvailabilityStartedAfterPaint = false;
    const pathExists = vi.fn(() => {
      pathAvailabilityStartedAfterPaint = paintedFrameCount > 0;
      return pathExistsResult;
    });
    window.requestAnimationFrame = requestAnimationFrame;
    window.__utoolsProjectLaunchStartupTiming = { preloadStartedAtEpochMs: 0, mark };
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjects: vi.fn(async () => [project]),
      pathExists,
      saveProjects: vi.fn(async () => undefined),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    let loadCompleted = false;
    const loadPromise = store.loadProjects().then(() => {
      loadCompleted = true;
    });

    await Promise.resolve();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(pathExists).not.toHaveBeenCalled();
    expect(store.projectsLoaded).toBe(true);
    expect(store.projects[0]?.name).toBe(project.name);
    expect(store.memoContent[project.id]).toBe(project.memo);
    expect(loadCompleted).toBe(false);

    await advanceFrame();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(pathExists).not.toHaveBeenCalled();
    expect(loadCompleted).toBe(false);

    await advanceFrame();
    expect(pathExists).toHaveBeenCalledTimes(1);
    expect(pathAvailabilityStartedAfterPaint).toBe(true);
    expect(loadCompleted).toBe(false);

    resolvePathExists(true);
    await loadPromise;

    expect(loadCompleted).toBe(true);
    expect(store.projects[0]?.pathExists).toBe(true);
    expect(mark.mock.calls.map(([phase]) => phase)).toEqual([
      "projects-load-preferences-start",
      "projects-load-preferences-complete",
      "projects-load-storage-hydration-start",
      "projects-load-storage-hydration-complete",
      "projects-load-state-setup-start",
      "projects-load-state-setup-complete",
      "projects-load-path-availability-start",
      "projects-load-path-availability-complete",
      "projects-load-runtime-reconciliation-start",
      "projects-load-runtime-reconciliation-complete",
      "projects-load-automation-plan-recomputation-start",
      "projects-load-automation-plan-recomputation-complete",
    ]);
  });
});

describe("uTools preload UI preferences", () => {
  it.each([
    [defaultTabOrder, 0],
    [["scripts", "info", "automation", "files", "git", "memo"], 1],
  ])("migrates legacy order %j with coach mark version %i", (legacyOrder, expectedVersion) => {
    const storage = new Map<string, unknown>([[legacyTabOrderKey, legacyOrder]]);
    const bridge = loadPreloadBridge(storage);

    const preferences = bridge.loadUiPreferences();

    expect(preferences.projectDetails.tabOrder).toEqual(legacyOrder);
    expect(preferences.coachMarks.projectDetailsTabReorder).toBe(expectedVersion);
    expect(storage.get(uiPreferencesKey)).toEqual(preferences);
    expect(storage.has(legacyTabOrderKey)).toBe(false);
  });

  it("prefers and normalizes the new configuration, then removes the legacy key", () => {
    const storage = new Map<string, unknown>([
      [
        uiPreferencesKey,
        {
          schemaVersion: 1,
          projectDetails: { tabOrder: ["memo", "unknown", "memo"] },
          coachMarks: { projectDetailsTabReorder: 1 },
        },
      ],
      [legacyTabOrderKey, ["scripts", "info"]],
    ]);
    const bridge = loadPreloadBridge(storage);

    expect(bridge.loadUiPreferences().projectDetails.tabOrder).toEqual([
      "memo",
      "info",
      "scripts",
      "automation",
      "files",
      "git",
    ]);
    expect(storage.has(legacyTabOrderKey)).toBe(false);

    bridge.saveUiPreferences({
      schemaVersion: 1,
      projectDetails: { tabOrder: ["git", "git", "memo"] },
      coachMarks: { projectDetailsTabReorder: 2 },
    });
    const saved = storage.get(uiPreferencesKey) as UiPreferences;
    expect(saved.projectDetails.tabOrder).toEqual(["git", "memo", "info", "scripts", "automation", "files"]);
    expect(storage.has(legacyTabOrderKey)).toBe(false);
  });

  it("uses defaults instead of legacy data when the new configuration is invalid", () => {
    const storage = new Map<string, unknown>([
      [uiPreferencesKey, { schemaVersion: 2 }],
      [legacyTabOrderKey, ["scripts", "info", "automation", "files", "git", "memo"]],
    ]);

    expect(loadPreloadBridge(storage).loadUiPreferences()).toEqual({
      schemaVersion: 1,
      projectDetails: { tabOrder: defaultTabOrder },
      coachMarks: { projectDetailsTabReorder: 0 },
    });
  });

  it("keeps readable current preferences when legacy cleanup fails", () => {
    const preferences: UiPreferences = {
      schemaVersion: 1,
      projectDetails: { tabOrder: ["memo", "info", "scripts", "automation", "files", "git"] },
      coachMarks: { projectDetailsTabReorder: 1 },
    };
    const storage = new Map<string, unknown>([[uiPreferencesKey, preferences]]);
    const bridge = loadPreloadBridge(storage, () => {
      throw new Error("storage unavailable");
    });

    expect(bridge.loadUiPreferences()).toEqual(preferences);
  });

  it("persists Project Launch Service preferences separately from project data", () => {
    const storage = new Map<string, unknown>();
    const bridge = loadPreloadBridge(storage);

    expect(bridge.loadProjectLaunchServicePreferences()).toEqual({ schemaVersion: 1, enabled: false });

    bridge.saveProjectLaunchServicePreferences({ schemaVersion: 1, enabled: true });
    expect(storage.get(projectLaunchServicePreferencesKey)).toEqual({ schemaVersion: 1, enabled: true });
  });

  it("removes stale service discovery when a live PID has a different process identity", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const serviceDirectory = join(applicationDirectory, "service");
    const executableName = `project-launch-service${process.platform === "win32" ? ".exe" : ""}`;
    const discoveryPath = join(serviceDirectory, "discovery.json");

    try {
      mkdirSync(serviceDirectory, { recursive: true });
      writeFileSync(join(serviceDirectory, executableName), "");
      writeFileSync(join(serviceDirectory, "token"), `${"a".repeat(64)}\n`);
      writeFileSync(
        discoveryPath,
        JSON.stringify({
          protocolVersion: 1,
          serviceVersion: "test",
          instanceId: "stale-instance",
          pid: process.pid,
          processIdentity: "reused-pid-identity",
          startedAt: new Date().toISOString(),
          host: "127.0.0.1",
          port: 1,
          tokenPath: join(serviceDirectory, "token"),
        }),
      );

      await loadPreloadBridge(new Map(), undefined, {
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
      }).getProjectLaunchServiceStatus();

      expect(existsSync(discoveryPath)).toBe(false);
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });
});
