import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createPinia, setActivePinia } from "pinia";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  type ProjectBridgeRunResult,
  type ProjectDetailsTabId,
  type ProjectLaunchServiceStatus,
  type UiPreferences,
} from "../src/types";

const uiPreferencesKey = "utools-project-launch.ui-preferences.v1";
const legacyTabOrderKey = "utools-project-launch.project-details-tab-order.v1";
const projectLaunchServicePreferencesKey = "utools-project-launch.project-launch-service.v1";
const defaultTabOrder: ProjectDetailsTabId[] = ["info", "scripts", "automation", "files", "git", "memo"];
const defaultOpenTab: ProjectDetailsTabId = "scripts";

const loadPreloadBridge = (
  storage: Map<string, unknown>,
  removeItem: (key: string) => void = (key) => {
    storage.delete(key);
  },
  environment: NodeJS.ProcessEnv = {},
  moduleOverrides: Record<string, unknown> = {},
  onBridgeEvent: (detail: unknown) => void = () => undefined,
) => {
  const nodeRequire = createRequire(import.meta.url);
  class SandboxCustomEvent {
    readonly type: string;
    readonly detail: unknown;

    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  const sandboxWindow: {
    projectBridge?: ProjectBridge;
    utools: { dbStorage: object };
    dispatchEvent: (event: { type?: string; detail?: unknown }) => boolean;
  } = {
    utools: {
      dbStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: unknown) => storage.set(key, value),
        removeItem,
      },
    },
    dispatchEvent: (event) => {
      if (event.type === "project-bridge-event") {
        onBridgeEvent(event.detail);
      }
      return true;
    },
  };
  const sandbox = {
    require: (id: string) => moduleOverrides[id] ?? (id === "electron" ? { shell: {} } : nodeRequire(id)),
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
    CustomEvent: SandboxCustomEvent,
    URL,
    setTimeout,
    clearTimeout,
    window: sandboxWindow,
  };
  createContext(sandbox);
  runInContext(readFileSync(resolve("public/preload.js"), "utf8"), sandbox);
  if (!sandboxWindow.projectBridge) throw new Error("The real preload did not register projectBridge.");
  return sandboxWindow.projectBridge;
};

const projectLaunchServiceAssetName = () => {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const architecture = process.arch === "x64" ? "amd64" : process.arch;
  return `project-launch-service-${platform}-${architecture}${platform === "windows" ? ".exe" : ""}`;
};

const projectLaunchServiceExecutableName = () => `project-launch-service${process.platform === "win32" ? ".exe" : ""}`;

const createProjectLaunchServiceDownloadHttps = (
  binaryContents: Buffer,
  { redirectToReleaseAssets = false, chunkSize = 0 }: { redirectToReleaseAssets?: boolean; chunkSize?: number } = {},
) => {
  const assetName = projectLaunchServiceAssetName();
  const checksum = createHash("sha256").update(binaryContents).digest("hex");
  const checksumContents = Buffer.from(`${checksum}  ${assetName}\n`);
  const releaseContents = Buffer.from(
    JSON.stringify({
      assets: [
        {
          name: assetName,
          size: binaryContents.length,
          browser_download_url: `https://github.com/Wwyxa/utools-project-launch/releases/download/v1/${assetName}`,
        },
        {
          name: "checksums.txt",
          size: checksumContents.length,
          browser_download_url: "https://github.com/Wwyxa/utools-project-launch/releases/download/v1/checksums.txt",
        },
      ],
    }),
  );
  const responses = redirectToReleaseAssets
    ? [
        { contents: releaseContents },
        { location: "https://release-assets.githubusercontent.com/checksums.txt" },
        { contents: checksumContents },
        { location: `https://release-assets.githubusercontent.com/${assetName}` },
        { contents: binaryContents },
      ]
    : [{ contents: releaseContents }, { contents: checksumContents }, { contents: binaryContents }];

  return {
    get: vi.fn((_options: unknown, callback: (response: EventEmitter) => void) => {
      const nextResponse = responses.shift();
      if (!nextResponse) throw new Error("unexpected service download request");
      const request = new EventEmitter() as EventEmitter & { destroy: (error?: Error) => void };
      request.destroy = (error) => {
        if (error) queueMicrotask(() => request.emit("error", error));
      };
      queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          resume: () => void;
        };
        response.statusCode = nextResponse.location ? 302 : 200;
        response.headers = nextResponse.location
          ? { location: nextResponse.location }
          : { "content-length": String(nextResponse.contents!.length) };
        response.resume = () => undefined;
        callback(response);
        if (nextResponse.contents) {
          if (chunkSize > 0) {
            for (let offset = 0; offset < nextResponse.contents.length; offset += chunkSize) {
              response.emit("data", nextResponse.contents.subarray(offset, offset + chunkSize));
            }
          } else {
            response.emit("data", nextResponse.contents);
          }
          response.emit("end");
        }
      });
      return request;
    }),
  };
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
      projectDetails: { tabOrder: defaultTabOrder, defaultTab: defaultOpenTab },
      dashboard: { tinyCardActionTrigger: "hover" },
      coachMarks: { projectDetailsTabReorder: 0, projectDetailsTabDefault: 0 },
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
        projectDetails: { tabOrder: ["memo", "unknown", "memo", "info"], defaultTab: "unknown" },
        dashboard: { tinyCardActionTrigger: "unsupported" },
        coachMarks: { projectDetailsTabReorder: 1.5, projectDetailsTabDefault: 1.5 },
      }),
    );

    expect(getProjectBridge().loadUiPreferences()).toEqual({
      schemaVersion: 1,
      projectDetails: {
        tabOrder: ["memo", "info", "scripts", "automation", "files", "git"],
        defaultTab: defaultOpenTab,
      },
      dashboard: { tinyCardActionTrigger: "hover" },
      coachMarks: { projectDetailsTabReorder: 0, projectDetailsTabDefault: 0 },
    });
  });

  it("falls back safely for damaged JSON", () => {
    storage.set(uiPreferencesKey, "{");
    storage.set(legacyTabOrderKey, JSON.stringify(["scripts", "info"]));

    expect(getProjectBridge().loadUiPreferences()).toEqual({
      schemaVersion: 1,
      projectDetails: { tabOrder: defaultTabOrder, defaultTab: defaultOpenTab },
      dashboard: { tinyCardActionTrigger: "hover" },
      coachMarks: { projectDetailsTabReorder: 0, projectDetailsTabDefault: 0 },
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
      projectDetails: {
        tabOrder: ["memo", "info", "scripts", "automation", "files", "git"],
        defaultTab: defaultOpenTab,
      },
      dashboard: { tinyCardActionTrigger: "hover" },
      coachMarks: { projectDetailsTabReorder: 1, projectDetailsTabDefault: 0 },
    });
  });

  it("round-trips normalized preferences and removes the legacy order", () => {
    getProjectBridge().saveUiPreferences({
      schemaVersion: 1,
      projectDetails: { tabOrder: ["git", "git", "memo"], defaultTab: "memo" },
      dashboard: { tinyCardActionTrigger: "contextmenu" },
      coachMarks: { projectDetailsTabReorder: 2, projectDetailsTabDefault: 3 },
    });

    const preferences = getProjectBridge().loadUiPreferences();
    expect(preferences.projectDetails.tabOrder).toEqual(["git", "memo", "info", "scripts", "automation", "files"]);
    expect(preferences.projectDetails.defaultTab).toBe("memo");
    expect(preferences.dashboard.tinyCardActionTrigger).toBe("contextmenu");
    expect(preferences.coachMarks.projectDetailsTabReorder).toBe(2);
    expect(preferences.coachMarks.projectDetailsTabDefault).toBe(3);
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
      projectDetails: { tabOrder: [...defaultTabOrder], defaultTab: defaultOpenTab },
      dashboard: { tinyCardActionTrigger: "hover" },
      coachMarks: { projectDetailsTabReorder: 0, projectDetailsTabDefault: 0 },
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

    store.setProjectDetailsDefaultTab("memo");
    store.setProjectDetailsDefaultTab("memo");
    expect(store.uiPreferences.projectDetails.defaultTab).toBe("memo");
    expect(saveUiPreferences).toHaveBeenCalledTimes(1);

    store.setProjectDetailsTabOrder(["scripts", "info", "automation", "files", "git", "memo"]);
    expect(store.uiPreferences.projectDetails.defaultTab).toBe("memo");
    expect(saveUiPreferences).toHaveBeenCalledTimes(2);

    store.acknowledgeProjectDetailsTabReorderHint(1);
    store.acknowledgeProjectDetailsTabReorderHint(1);
    expect(store.uiPreferences.coachMarks.projectDetailsTabReorder).toBe(1);
    expect(saveUiPreferences).toHaveBeenCalledTimes(3);

    store.acknowledgeProjectDetailsTabDefaultHint(1);
    store.acknowledgeProjectDetailsTabDefaultHint(1);
    expect(store.uiPreferences.coachMarks.projectDetailsTabDefault).toBe(1);
    expect(saveUiPreferences).toHaveBeenCalledTimes(4);

    store.setTinyCardActionTrigger("hover");
    expect(saveUiPreferences).toHaveBeenCalledTimes(4);

    store.setTinyCardActionTrigger("contextmenu");
    expect(store.uiPreferences.dashboard.tinyCardActionTrigger).toBe("contextmenu");
    expect(saveUiPreferences).toHaveBeenCalledTimes(5);
  });

  it("verifies a manually placed Project Launch Service only during an explicit recheck", async () => {
    const installedStatus: ProjectLaunchServiceStatus = {
      state: "installed",
      installed: true,
      running: false,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
    };
    const getProjectLaunchServiceStatus = vi.fn<ProjectBridge["getProjectLaunchServiceStatus"]>(
      async () => installedStatus,
    );
    const verifyProjectLaunchServiceInstall = vi.fn<ProjectBridge["verifyProjectLaunchServiceInstall"]>(
      async () => installedStatus,
    );
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: false }),
      getProjectLaunchServiceStatus,
      verifyProjectLaunchServiceInstall,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    await store.refreshProjectLaunchServiceStatus();
    expect(verifyProjectLaunchServiceInstall).not.toHaveBeenCalled();

    await store.refreshProjectLaunchServiceStatus(true);
    expect(verifyProjectLaunchServiceInstall).toHaveBeenCalledOnce();
    expect(store.projectLaunchServiceStatus).toEqual(installedStatus);
    expect(getProjectLaunchServiceStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps renderer ownership when Project Launch Service rejects automation handoff", async () => {
    const saveProjectLaunchServicePreferences = vi.fn<ProjectBridge["saveProjectLaunchServicePreferences"]>();
    const stopProjectLaunchService = vi.fn<ProjectBridge["stopProjectLaunchService"]>();
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
      stopProjectLaunchService,
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
    expect(stopProjectLaunchService).toHaveBeenCalledOnce();
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

  it("sends a schedule-driven schema v1 automation configuration", async () => {
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
      reconcileProjectLaunchService: async () => healthyStatus,
      syncProjectLaunchServiceAutomation,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "legacy-schema-project",
        name: "Legacy schema project",
        path: "/workspace/legacy-schema-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [{ id: "legacy-schema-script", name: "dev", command: "echo legacy", status: "IDLE" }],
        automationTasks: [
          {
            id: "legacy-schema-task",
            name: "Legacy schema task",
            enabled: true,
            scriptIds: ["legacy-schema-script"],
            schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
            missedPolicy: "grace-run",
            missedGraceMinutes: 5,
            notifyEnabled: false,
            maxScriptRuntimeMinutes: 30,
            inputConfigs: [],
            exitConfigs: [],
            dailyPlans: [
              {
                date: dateKey(),
                entries: [{ id: "legacy-schema-entry", plannedAt: new Date().toISOString(), status: "pending" }],
              },
            ],
            history: [],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
          },
        ],
        env: {},
      },
    ];

    await store.synchronizeProjectLaunchServiceAutomation();

    expect(syncProjectLaunchServiceAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 1, revision: 1 }),
    );
    const task = syncProjectLaunchServiceAutomation.mock.calls[0]?.[0]?.projects[0]?.automationTasks[0];
    expect(task).toMatchObject({
      schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
      scheduleAlgorithmVersion: 1,
    });
    expect(task).not.toHaveProperty("dailyPlans");
  });

  it("includes a service manual run in the schema v1 payload", async () => {
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
      reconcileProjectLaunchService: async () => healthyStatus,
      syncProjectLaunchServiceAutomation,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project: Project = {
      id: "legacy-manual-project",
      name: "Legacy manual project",
      path: "/workspace/legacy-manual-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [{ id: "legacy-manual-script", name: "dev", command: "echo legacy", status: "IDLE" }],
      automationTasks: [
        {
          id: "legacy-manual-task",
          name: "Legacy manual task",
          enabled: false,
          scriptIds: ["legacy-manual-script"],
          schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
          missedPolicy: "grace-run",
          missedGraceMinutes: 5,
          notifyEnabled: false,
          maxScriptRuntimeMinutes: 30,
          inputConfigs: [],
          exitConfigs: [],
          dailyPlans: [],
          history: [],
          createdAt: "2026-08-15T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
      env: {},
    };
    window.projectBridge.reconcileProjectLaunchService = async () => healthyStatus;
    store.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
    store.projects = [project];

    await expect(store.runAutomationTaskNow(project.id, "legacy-manual-task")).resolves.toBe(true);

    const config = syncProjectLaunchServiceAutomation.mock.calls[0]?.[0];
    expect(config?.schemaVersion).toBe(1);
    if (!config || config.schemaVersion !== 1) {
      throw new Error("expected a schema v1 automation configuration");
    }
    const task = config.projects[0]?.automationTasks[0];
    expect(task?.manualRun).toMatchObject({ id: expect.any(String), plannedAt: expect.any(String) });
    expect(task).not.toHaveProperty("dailyPlans");
  });

  it("verifies an installed executable before enabling service mode", async () => {
    const saveProjectLaunchServicePreferences = vi.fn<ProjectBridge["saveProjectLaunchServicePreferences"]>();
    const verifyProjectLaunchServiceInstall = vi.fn<ProjectBridge["verifyProjectLaunchServiceInstall"]>();
    const startProjectLaunchService = vi.fn<ProjectBridge["startProjectLaunchService"]>();
    const reconcileProjectLaunchService = vi.fn<ProjectBridge["reconcileProjectLaunchService"]>();
    const syncProjectLaunchServiceAutomation = vi.fn<ProjectBridge["syncProjectLaunchServiceAutomation"]>();
    const installedStatus: ProjectLaunchServiceStatus = {
      state: "installed",
      installed: true,
      running: false,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
    };
    const healthyStatus: ProjectLaunchServiceStatus = {
      ...installedStatus,
      state: "healthy",
      running: true,
      automationRevision: 0,
    };
    verifyProjectLaunchServiceInstall.mockResolvedValue(installedStatus);
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
      getProjectLaunchServiceStatus: async () => installedStatus,
      verifyProjectLaunchServiceInstall,
      startProjectLaunchService,
      reconcileProjectLaunchService,
      syncProjectLaunchServiceAutomation,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    await store.setProjectLaunchServiceEnabled(true);

    expect(verifyProjectLaunchServiceInstall).toHaveBeenCalledOnce();
    expect(verifyProjectLaunchServiceInstall.mock.invocationCallOrder[0]).toBeLessThan(
      startProjectLaunchService.mock.invocationCallOrder[0]!,
    );
    expect(startProjectLaunchService).toHaveBeenCalledWith({ requireVerifiedInstall: false });
    expect(store.projectLaunchServicePreferences.enabled).toBe(true);
    expect(saveProjectLaunchServicePreferences).toHaveBeenCalledWith({ schemaVersion: 1, enabled: true });
  });

  it("clears service mode when service startup fails", async () => {
    const saveProjectLaunchServicePreferences = vi.fn<ProjectBridge["saveProjectLaunchServicePreferences"]>();
    const verifyProjectLaunchServiceInstall = vi.fn<ProjectBridge["verifyProjectLaunchServiceInstall"]>();
    const startProjectLaunchService = vi.fn<ProjectBridge["startProjectLaunchService"]>();
    const installedStatus: ProjectLaunchServiceStatus = {
      state: "installed",
      installed: true,
      running: false,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
    };
    const unavailableStatus: ProjectLaunchServiceStatus = {
      ...installedStatus,
      state: "unavailable",
      message: "service failed to start",
    };
    verifyProjectLaunchServiceInstall.mockResolvedValue(installedStatus);
    startProjectLaunchService.mockResolvedValue(unavailableStatus);
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: false }),
      saveProjectLaunchServicePreferences,
      getProjectLaunchServiceStatus: async () => installedStatus,
      verifyProjectLaunchServiceInstall,
      startProjectLaunchService,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    await store.setProjectLaunchServiceEnabled(true);

    expect(verifyProjectLaunchServiceInstall).toHaveBeenCalledOnce();
    expect(startProjectLaunchService).toHaveBeenCalledOnce();
    expect(store.projectLaunchServicePreferences.enabled).toBe(false);
    expect(saveProjectLaunchServicePreferences).not.toHaveBeenCalled();
    expect(store.projectLaunchServiceStatus).toMatchObject({
      state: "unavailable",
      message: "service failed to start",
    });
  });

  it("keeps service mode enabled while service-managed scripts are still active", async () => {
    const stopProjectLaunchService = vi.fn<ProjectBridge["stopProjectLaunchService"]>();
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
      automationRevision: 4,
    };
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
      stopProjectLaunchService,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projectLaunchServiceStatus = healthyStatus;
    store.projects = [
      {
        id: "active-service-project",
        name: "Active service project",
        path: "/workspace/active-service-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "active-service-script",
            name: "dev",
            command: "npm run dev",
            status: "RUNNING",
            runId: "active-service-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];

    expect(store.hasActiveProjectLaunchServiceRuns).toBe(true);
    await store.setProjectLaunchServiceEnabled(false);

    expect(stopProjectLaunchService).not.toHaveBeenCalled();
    expect(store.projectLaunchServicePreferences.enabled).toBe(true);
    expect(store.projectLaunchServiceStatus).toEqual(healthyStatus);
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
    await expect(store.launchScript("handoff-project", "handoff-script")).resolves.toBeNull();
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

    await vi.waitFor(() => expect(syncProjectLaunchServiceAutomation).toHaveBeenCalledTimes(1));
    const taskConfig = syncProjectLaunchServiceAutomation.mock.calls[0]?.[0]?.projects[0]?.automationTasks[0];
    expect(taskConfig).toMatchObject({
      id: expect.any(String),
      scheduleAlgorithmVersion: 1,
      schedule: expect.objectContaining({ type: "fixed" }),
    });
    expect(taskConfig).not.toHaveProperty("dailyPlans");
    expect(store.projects[0]?.automationTasks?.[0]?.dailyPlans).toEqual([]);
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
    expect(reconcileProjectLaunchService).toHaveBeenCalledOnce();
    expect(store.serviceAutomationTaskEntries(project.id, "unavailable-service-task")).toEqual([]);
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
    expect(syncProjectLaunchServiceAutomation).toHaveBeenCalledOnce();
    expect(store.projectLaunchServiceStatus).toMatchObject({
      state: "unavailable",
      message: "service rejected manual automation",
    });
  });

  it("rejects a duplicate service automation submission before the first snapshot", async () => {
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
    const project: Project = {
      id: "pending-service-automation-project",
      name: "Pending service automation project",
      path: "/workspace/pending-service-automation-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [{ id: "pending-service-automation-script", name: "dev", command: "echo pending", status: "IDLE" }],
      automationTasks: [
        {
          id: "pending-service-automation-task",
          name: "Pending service automation task",
          enabled: true,
          scriptIds: ["pending-service-automation-script"],
          schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
          missedPolicy: "grace-run",
          missedGraceMinutes: 5,
          notifyEnabled: false,
          maxScriptRuntimeMinutes: 30,
          inputConfigs: [],
          exitConfigs: [],
          dailyPlans: [],
          history: [],
          createdAt: "2026-08-15T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
      env: {},
    };
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
      reconcileProjectLaunchService: async () => healthyStatus,
      syncProjectLaunchServiceAutomation,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
    store.projects = [project];

    const firstSubmission = store.runAutomationTaskNow(project.id, "pending-service-automation-task");
    await expect(store.runAutomationTaskNow(project.id, "pending-service-automation-task")).resolves.toBe(false);
    await expect(firstSubmission).resolves.toBe(true);
    expect(syncProjectLaunchServiceAutomation).toHaveBeenCalledTimes(1);
    const config = syncProjectLaunchServiceAutomation.mock.calls[0]?.[0];
    if (!config || config.schemaVersion !== 1) {
      throw new Error("expected a schema v1 automation configuration");
    }
    expect(config.projects[0]?.automationTasks[0]?.manualRun).toMatchObject({
      id: expect.any(String),
      plannedAt: expect.any(String),
    });
  });

  it("keeps the original plan time when submitting a service automation entry early", async () => {
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
    const futureAt = new Date(Date.now() + 60_000).toISOString();
    const syncProjectLaunchServiceAutomation = vi.fn<ProjectBridge["syncProjectLaunchServiceAutomation"]>(
      async (config) => ({ accepted: true, revision: config.revision }),
    );
    const project: Project = {
      id: "early-service-automation-project",
      name: "Early service automation project",
      path: "/workspace/early-service-automation-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [{ id: "early-service-automation-script", name: "dev", command: "echo early", status: "IDLE" }],
      automationTasks: [
        {
          id: "early-service-automation-task",
          name: "Early service automation task",
          enabled: true,
          scriptIds: ["early-service-automation-script"],
          schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
          missedPolicy: "grace-run",
          missedGraceMinutes: 5,
          notifyEnabled: false,
          maxScriptRuntimeMinutes: 30,
          inputConfigs: [],
          exitConfigs: [],
          dailyPlans: [
            { date: dateKey(), entries: [{ id: "early-service-entry", plannedAt: futureAt, status: "pending" }] },
          ],
          history: [],
          createdAt: "2026-08-15T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
      env: {},
    };
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
      reconcileProjectLaunchService: async () => healthyStatus,
      syncProjectLaunchServiceAutomation,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
    store.projects = [project];
    store.projectLaunchServiceStatus = {
      ...healthyStatus,
      automation: {
        revision: 0,
        upcoming: [
          {
            projectId: project.id,
            taskId: "early-service-automation-task",
            planEntryId: "early-service-entry",
            plannedAt: futureAt,
          },
        ],
      },
    };

    await expect(
      store.runAutomationPlanEntryEarly(project.id, "early-service-automation-task", "early-service-entry"),
    ).resolves.toBe(true);

    const entry = store.projects[0]?.automationTasks?.[0]?.dailyPlans[0]?.entries[0];
    expect(entry?.plannedAt).toBe(futureAt);
    expect(syncProjectLaunchServiceAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        projects: [
          expect.objectContaining({
            automationTasks: [
              expect.objectContaining({
                runEarlyEntryId: "early-service-entry",
              }),
            ],
          }),
        ],
      }),
    );
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

  it("restores a service-lost script as stopped after service restart", async () => {
    const runId = "lost-service-run";
    const project: Project = {
      id: "lost-service-project",
      name: "Lost service project",
      path: "/workspace/lost-service-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.RUNNING,
      scripts: [
        {
          id: "lost-service-script",
          name: "dev",
          command: "npm run dev",
          status: "RUNNING",
          pid: 4242,
          runId,
          runtimeOwner: "service",
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
          id: runId,
          projectId: project.id,
          scriptId: "lost-service-script",
          label: "Lost service project / dev",
          command: "npm run dev",
          cwd: project.path,
          pid: 4242,
          status: "lost",
          startedAt: "2026-08-16T00:00:00.000Z",
          endedAt: "2026-08-16T00:00:01.000Z",
          error: "The persisted process identity could not be verified after service restart.",
        },
      ],
      events: [
        {
          cursor: 7,
          timestamp: "2026-08-16T00:00:01.000Z",
          type: "error",
          runId,
          projectId: project.id,
          scriptId: "lost-service-script",
          pid: 4242,
          message: "The persisted process identity could not be verified after service restart.",
        },
      ],
    };
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [project];

    store.handleBridgeEvent({ type: "service-state", status });

    const script = store.projects[0]?.scripts[0];
    expect(script).toMatchObject({ status: "STOPPED" });
    expect(script?.pid).toBeUndefined();
    expect(script?.runId).toBeUndefined();
    expect(script?.runtimeOwner).toBeUndefined();
    expect(store.projects[0]?.status).toBe(ProjectStatus.STOPPED);
    expect(store.scriptLogs[project.id]?.["lost-service-script"] || []).toEqual([]);
  });

  it("clears all script runtime identity when a project path becomes unavailable", async () => {
    window.projectBridge = {
      ...getProjectBridge(),
      pathExists: async () => false,
    };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "missing-project",
        name: "Missing project",
        path: "/workspace/missing-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "missing-script",
            name: "dev",
            command: "npm run dev",
            status: "RUNNING",
            pid: 4242,
            runId: "1234567890abcdef1234567890abcdef",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];

    await store.refreshProjectAvailability();

    const project = store.projects[0]!;
    const script = project.scripts[0]!;
    expect(project.status).toBe(ProjectStatus.WARNING);
    expect(script.status).toBe("IDLE");
    expect(script.pid).toBeUndefined();
    expect(script.runId).toBeUndefined();
    expect(script.runtimeOwner).toBeUndefined();
  });

  it("retains service-owned script identity when the service is unavailable", async () => {
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
    };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "restarted-service-project",
        name: "Restarted service project",
        path: "/workspace/restarted-service-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "restarted-service-script",
            name: "dev",
            command: "npm run dev",
            status: "RUNNING",
            pid: 4242,
            runId: "1234567890abcdef1234567890abcdef",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];
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

    store.reconcileProjectLaunchServiceRuntime(unavailableStatus);

    const project = store.projects[0]!;
    const script = project.scripts[0]!;
    expect(project.status).toBe(ProjectStatus.RUNNING);
    expect(script).toMatchObject({
      status: "RUNNING",
      pid: 4242,
      runId: "1234567890abcdef1234567890abcdef",
      runtimeOwner: "service",
    });
  });

  it("keeps a service run identity when refresh cannot reach the service", async () => {
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
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
      reconcileProjectLaunchService: async () => unavailableStatus,
      getProcessStatus: async () => ({
        active: false,
        serviceState: "unavailable",
        error: "Project Launch Service is unavailable.",
      }),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
    store.projects = [
      {
        id: "unavailable-refresh-project",
        name: "Unavailable refresh project",
        path: "/workspace/unavailable-refresh-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "unavailable-refresh-script",
            name: "dev",
            command: "echo unavailable",
            status: "RUNNING",
            pid: 8801,
            runId: "unavailable-refresh-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];

    await store.refreshProjectLaunchServiceStatus();

    expect(store.projectLaunchServiceStatus).toMatchObject({ state: "unavailable" });
    expect(store.projects[0]?.scripts[0]).toMatchObject({
      status: "RUNNING",
      pid: 8801,
      runId: "unavailable-refresh-run",
      runtimeOwner: "service",
    });
  });
});

describe("Project Launch Service preload installation", () => {
  const binaryContents = Buffer.from("verified-project-launch-service");

  const createBridge = (serviceRoot: string, moduleOverrides: Record<string, unknown> = {}) =>
    loadPreloadBridge(new Map(), undefined, { UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: serviceRoot }, moduleOverrides);

  it("reports a manually placed executable as installed", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    try {
      const bridge = createBridge(serviceRoot);
      const beforeInstall = await bridge.getProjectLaunchServiceStatus();
      mkdirSync(beforeInstall.directoryPath, { recursive: true });
      writeFileSync(beforeInstall.executablePath, binaryContents);

      await expect(bridge.getProjectLaunchServiceStatus()).resolves.toMatchObject({
        state: "installed",
        installed: true,
        running: false,
        message: "项目启动服务已安装，尚未运行。",
      });
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("normalizes null persisted automation and run log events", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const requestedPaths: string[] = [];
    const requestedBodies: string[] = [];
    const runID = "11111111111111111111111111111111";
    const http = {
      request: vi.fn((options: { path: string }, callback: (response: EventEmitter) => void) => {
        requestedPaths.push(options.path);
        const request = new EventEmitter() as EventEmitter & {
          destroy: (error?: Error) => void;
          end: () => void;
          write: (chunk: string) => void;
        };
        request.write = (chunk) => {
          requestedBodies.push(chunk);
        };
        request.destroy = (error) => {
          if (error) queueMicrotask(() => request.emit("error", error));
        };
        request.end = () => {
          const payload =
            options.path === "/v1/sync?after=0"
              ? {
                  health: {
                    protocolVersion: 2,
                    serviceVersion: "test",
                    instanceId: "existing-service",
                    pid: process.pid,
                    processIdentity: "test-process",
                  },
                  state: {
                    runs: [],
                    latestCursor: 0,
                    earliestCursor: 0,
                    automation: {
                      revision: 7,
                      executions: [
                        {
                          id: "execution",
                          projectId: "project",
                          taskId: "task",
                          planEntryId: "entry",
                          status: "completed",
                          currentScriptIndex: 0,
                          scriptResults: null,
                        },
                      ],
                    },
                  },
                  events: {
                    events: [],
                    latestCursor: 0,
                    earliestCursor: 0,
                    truncated: false,
                    nextCursor: 0,
                    hasMore: false,
                  },
                }
              : options.path === `/v1/runs/${runID}/log?before=0`
                ? {
                    runId: runID,
                    events: null,
                    truncated: false,
                    sizeBytes: 0,
                    hasMore: false,
                    nextOffset: 0,
                  }
                : options.path === "/v1/logs/clear"
                  ? { deletedCount: 1, releasedBytes: 128 }
                  : null;
          const response = new EventEmitter() as EventEmitter & { statusCode: number };
          response.statusCode = payload ? 200 : 404;
          queueMicrotask(() => {
            callback(response);
            response.emit("data", Buffer.from(JSON.stringify(payload || {})));
            response.emit("end");
          });
        };
        return request;
      }),
    };

    try {
      const bridge = createBridge(serviceRoot, { http });
      const installed = await bridge.getProjectLaunchServiceStatus();
      mkdirSync(installed.directoryPath, { recursive: true });
      writeFileSync(installed.executablePath, binaryContents);
      writeFileSync(join(installed.directoryPath, "token"), `${"a".repeat(64)}\n`);
      writeFileSync(
        join(installed.directoryPath, "discovery.json"),
        JSON.stringify({
          protocolVersion: 2,
          serviceVersion: "test",
          instanceId: "existing-service",
          pid: process.pid,
          processIdentity: "test-process",
          startedAt: new Date().toISOString(),
          host: "127.0.0.1",
          port: 3000,
          tokenPath: join(installed.directoryPath, "token"),
        }),
      );

      const reconciled = await bridge.reconcileProjectLaunchService();
      expect(reconciled).toMatchObject({
        state: "healthy",
        running: true,
        automationRevision: 7,
        automation: { revision: 7 },
      });
      expect(reconciled.automation?.executions?.[0]?.scriptResults).toEqual([]);
      await expect(bridge.getProjectLaunchServiceRunLogPage(runID, 0)).resolves.toMatchObject({
        runId: runID,
        events: [],
      });
      await expect(bridge.clearProjectLaunchServiceLogs({ runId: runID })).resolves.toMatchObject({
        deletedCount: 1,
        releasedBytes: 128,
      });
      await expect(bridge.clearProjectLaunchServiceLogs()).resolves.toMatchObject({
        deletedCount: 1,
        releasedBytes: 128,
      });
      expect(requestedPaths).toEqual([
        "/v1/sync?after=0",
        `/v1/runs/${runID}/log?before=0`,
        "/v1/logs/clear",
        "/v1/logs/clear",
      ]);
      expect(requestedBodies).toEqual([JSON.stringify({ runId: runID }), JSON.stringify({})]);
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("uses one combined synchronization request when the service supports it", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const requestedPaths: string[] = [];
    const https = createProjectLaunchServiceDownloadHttps(Buffer.from("updated-project-launch-service"));
    const storage = new Map<string, unknown>([
      [projectLaunchServicePreferencesKey, { schemaVersion: 1, enabled: true }],
    ]);
    const http = {
      request: vi.fn((options: { path: string }, callback: (response: EventEmitter) => void) => {
        requestedPaths.push(options.path);
        const request = new EventEmitter() as EventEmitter & {
          destroy: (error?: Error) => void;
          end: () => void;
        };
        request.destroy = (error) => {
          if (error) queueMicrotask(() => request.emit("error", error));
        };
        request.end = () => {
          const payload = options.path.startsWith("/v1/sync?after=")
            ? {
                health: {
                  protocolVersion: 2,
                  serviceVersion: "test",
                  instanceId: "sync-service",
                  pid: process.pid,
                  processIdentity: "sync-process",
                },
                state: {
                  runs: [],
                  latestCursor: 1,
                  earliestCursor: 1,
                  automation: { revision: 3, executions: [] },
                  scheduler: { state: "running" },
                },
                events: {
                  events: [
                    {
                      cursor: 1,
                      timestamp: "2026-08-17T00:00:00.000Z",
                      type: "stdout",
                      runId: "11111111111111111111111111111111",
                      projectId: "sync-project",
                      scriptId: "sync-script",
                      message: "sync output",
                    },
                  ],
                  latestCursor: 1,
                  earliestCursor: 1,
                  truncated: false,
                  nextCursor: 1,
                  hasMore: false,
                },
              }
            : { code: "not_found" };
          const response = new EventEmitter() as EventEmitter & { statusCode: number };
          response.statusCode = options.path.startsWith("/v1/sync?after=") ? 200 : 404;
          queueMicrotask(() => {
            callback(response);
            response.emit("data", Buffer.from(JSON.stringify(payload)));
            response.emit("end");
          });
        };
        return request;
      }),
    };

    try {
      const bridge = loadPreloadBridge(
        storage,
        undefined,
        { UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: serviceRoot },
        { http, https },
      );
      const installed = await bridge.getProjectLaunchServiceStatus();
      mkdirSync(installed.directoryPath, { recursive: true });
      writeFileSync(installed.executablePath, binaryContents);
      writeFileSync(join(installed.directoryPath, "token"), `${"a".repeat(64)}\n`);
      writeFileSync(
        join(installed.directoryPath, "discovery.json"),
        JSON.stringify({
          protocolVersion: 2,
          serviceVersion: "test",
          instanceId: "sync-service",
          pid: process.pid,
          processIdentity: "sync-process",
          startedAt: new Date().toISOString(),
          host: "127.0.0.1",
          port: 3000,
          tokenPath: join(installed.directoryPath, "token"),
        }),
      );

      const reconciled = await bridge.reconcileProjectLaunchService();

      expect(reconciled).toMatchObject({
        state: "healthy",
        running: true,
        automationRevision: 3,
        events: [expect.objectContaining({ message: "sync output" })],
      });
      const updateStatus = await bridge.checkProjectLaunchServiceUpdate();

      expect(updateStatus).toMatchObject({
        state: "healthy",
        running: true,
        scheduler: { state: "running" },
        updateAvailable: true,
        updateCheckError: false,
      });
      expect(requestedPaths).toEqual(["/v1/sync?after=0", "/v1/sync?after=1"]);
      expect(https.get).toHaveBeenCalledTimes(2);
      bridge.saveProjectLaunchServicePreferences({ schemaVersion: 1, enabled: false });
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("defers a service-state broadcast until the final event page", async () => {
    vi.useFakeTimers();
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const emittedEvents: Array<{ type?: string; status?: ProjectLaunchServiceStatus; message?: string }> = [];
    const requestedPaths: string[] = [];
    const storage = new Map<string, unknown>([
      [projectLaunchServicePreferencesKey, { schemaVersion: 1, enabled: true }],
    ]);
    const health = {
      protocolVersion: 2,
      serviceVersion: "test",
      instanceId: "paged-service",
      pid: process.pid,
      processIdentity: "paged-process",
    };
    const state = {
      runs: [
        {
          id: "11111111111111111111111111111111",
          projectId: "paged-project",
          scriptId: "one-shot-script",
          label: "Paged project / one shot",
          command: "echo paged",
          cwd: "C:\\workspace",
          pid: 8107,
          status: "exited",
          startedAt: "2026-08-25T09:00:00.000Z",
          endedAt: "2026-08-25T09:00:01.000Z",
          code: 0,
        },
      ],
      latestCursor: 3,
      earliestCursor: 1,
      automation: { revision: 0, executions: [] },
      scheduler: { state: "running" },
    };
    const http = {
      request: vi.fn((options: { path: string }, callback: (response: EventEmitter) => void) => {
        requestedPaths.push(options.path);
        const request = new EventEmitter() as EventEmitter & {
          destroy: (error?: Error) => void;
          end: () => void;
        };
        request.destroy = (error) => {
          if (error) queueMicrotask(() => request.emit("error", error));
        };
        request.end = () => {
          const payload =
            options.path === "/v1/sync?after=0"
              ? {
                  health,
                  state,
                  events: {
                    events: [
                      {
                        cursor: 1,
                        timestamp: "2026-08-25T09:00:00.000Z",
                        type: "started",
                        runId: "11111111111111111111111111111111",
                        projectId: "paged-project",
                        scriptId: "one-shot-script",
                        pid: 8107,
                      },
                    ],
                    latestCursor: 3,
                    earliestCursor: 1,
                    truncated: false,
                    nextCursor: 1,
                    hasMore: true,
                  },
                }
              : options.path === "/v1/sync?after=1"
                ? {
                    health,
                    state,
                    events: {
                      events: [
                        {
                          cursor: 2,
                          timestamp: "2026-08-25T09:00:00.500Z",
                          type: "stdout",
                          runId: "11111111111111111111111111111111",
                          projectId: "paged-project",
                          scriptId: "one-shot-script",
                          pid: 8107,
                          message: "paged output",
                        },
                        {
                          cursor: 3,
                          timestamp: "2026-08-25T09:00:01.000Z",
                          type: "exit",
                          runId: "11111111111111111111111111111111",
                          projectId: "paged-project",
                          scriptId: "one-shot-script",
                          pid: 8107,
                          code: 0,
                        },
                      ],
                      latestCursor: 3,
                      earliestCursor: 1,
                      truncated: false,
                      nextCursor: 3,
                      hasMore: false,
                    },
                  }
                : null;
          const response = new EventEmitter() as EventEmitter & { statusCode: number };
          response.statusCode = payload ? 200 : 404;
          queueMicrotask(() => {
            callback(response);
            response.emit("data", Buffer.from(JSON.stringify(payload || {})));
            response.emit("end");
          });
        };
        return request;
      }),
    };

    try {
      const bridge = loadPreloadBridge(
        storage,
        undefined,
        { UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: serviceRoot },
        { http },
        (detail) => {
          if (detail && typeof detail === "object") {
            emittedEvents.push(detail as { type?: string; status?: ProjectLaunchServiceStatus; message?: string });
          }
        },
      );
      const installed = await bridge.getProjectLaunchServiceStatus();
      mkdirSync(installed.directoryPath, { recursive: true });
      writeFileSync(installed.executablePath, binaryContents);
      writeFileSync(join(installed.directoryPath, "token"), `${"a".repeat(64)}\n`);
      writeFileSync(
        join(installed.directoryPath, "discovery.json"),
        JSON.stringify({
          protocolVersion: 2,
          serviceVersion: "test",
          instanceId: "paged-service",
          pid: process.pid,
          processIdentity: "paged-process",
          startedAt: new Date().toISOString(),
          host: "127.0.0.1",
          port: 3000,
          tokenPath: join(installed.directoryPath, "token"),
        }),
      );

      const reconciled = await bridge.reconcileProjectLaunchService();
      expect(reconciled).toMatchObject({ eventsHasMore: true, events: [expect.objectContaining({ cursor: 1 })] });
      expect(emittedEvents).toEqual([]);

      await vi.advanceTimersByTimeAsync(0);

      expect(requestedPaths).toEqual(["/v1/sync?after=0", "/v1/sync?after=1"]);
      expect(emittedEvents.map((event) => event.type)).toEqual(["stdout", "exit", "service-state"]);
      expect(emittedEvents[2]?.status).toMatchObject({ eventsHasMore: false, events: [] });
      bridge.saveProjectLaunchServicePreferences({ schemaVersion: 1, enabled: false });
    } finally {
      vi.useRealTimers();
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("suppresses unchanged empty service-state broadcasts", async () => {
    vi.useFakeTimers();
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const emittedEvents: Array<{ type?: string; status?: ProjectLaunchServiceStatus }> = [];
    const requestedPaths: string[] = [];
    const storage = new Map<string, unknown>([
      [projectLaunchServicePreferencesKey, { schemaVersion: 1, enabled: true }],
    ]);
    const http = {
      request: vi.fn((options: { path: string }, callback: (response: EventEmitter) => void) => {
        requestedPaths.push(options.path);
        const request = new EventEmitter() as EventEmitter & {
          destroy: (error?: Error) => void;
          end: () => void;
        };
        request.destroy = () => undefined;
        request.end = () => {
          const response = new EventEmitter() as EventEmitter & { statusCode: number };
          response.statusCode = 200;
          callback(response);
          response.emit(
            "data",
            Buffer.from(
              JSON.stringify({
                health: {
                  protocolVersion: 2,
                  serviceVersion: "test",
                  instanceId: "quiet-service",
                  pid: process.pid,
                  processIdentity: "quiet-process",
                },
                state: {
                  runs: [],
                  latestCursor: 0,
                  earliestCursor: 0,
                  automation: { revision: 0, executions: [] },
                  scheduler: { state: "running" },
                },
                events: {
                  events: [],
                  latestCursor: 0,
                  earliestCursor: 0,
                  truncated: false,
                  nextCursor: 0,
                  hasMore: false,
                },
              }),
            ),
          );
          response.emit("end");
        };
        return request;
      }),
    };

    try {
      const bridge = loadPreloadBridge(
        storage,
        undefined,
        { UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: serviceRoot },
        { http },
        (detail) => {
          if (detail && typeof detail === "object") {
            emittedEvents.push(detail as { type?: string; status?: ProjectLaunchServiceStatus });
          }
        },
      );
      const installed = await bridge.getProjectLaunchServiceStatus();
      mkdirSync(installed.directoryPath, { recursive: true });
      writeFileSync(installed.executablePath, binaryContents);
      writeFileSync(join(installed.directoryPath, "token"), `${"a".repeat(64)}\n`);
      writeFileSync(
        join(installed.directoryPath, "discovery.json"),
        JSON.stringify({
          protocolVersion: 2,
          serviceVersion: "test",
          instanceId: "quiet-service",
          pid: process.pid,
          processIdentity: "quiet-process",
          startedAt: new Date().toISOString(),
          host: "127.0.0.1",
          port: 3000,
          tokenPath: join(installed.directoryPath, "token"),
        }),
      );

      bridge.saveProjectLaunchServicePreferences({ schemaVersion: 1, enabled: true });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(750);

      expect(requestedPaths).toEqual(["/v1/sync?after=0", "/v1/sync?after=0"]);
      expect(emittedEvents.filter((event) => event.type === "service-state")).toHaveLength(1);
      bridge.saveProjectLaunchServicePreferences({ schemaVersion: 1, enabled: false });
    } finally {
      vi.useRealTimers();
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("records a manually placed executable after explicit verification", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    try {
      const bridge = createBridge(serviceRoot);
      const installed = await bridge.getProjectLaunchServiceStatus();
      mkdirSync(installed.directoryPath, { recursive: true });
      writeFileSync(installed.executablePath, binaryContents);

      const verified = await bridge.verifyProjectLaunchServiceInstall();

      expect(verified).toMatchObject({ state: "installed", installed: true, running: false });
      expect(JSON.parse(readFileSync(join(installed.directoryPath, "install.json"), "utf8"))).toEqual({
        schemaVersion: 1,
        assetName: installed.expectedAssetName,
        sha256: createHash("sha256").update(binaryContents).digest("hex"),
      });
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("reports an available service update without downloading it", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const https = createProjectLaunchServiceDownloadHttps(Buffer.from("updated-project-launch-service"));
    try {
      const bridge = createBridge(serviceRoot, { https });
      const status = await bridge.getProjectLaunchServiceStatus();
      mkdirSync(status.directoryPath, { recursive: true });
      writeFileSync(status.executablePath, binaryContents);

      const updateStatus = await bridge.checkProjectLaunchServiceUpdate();

      expect(updateStatus).toMatchObject({
        state: "installed",
        installed: true,
        running: false,
        updateAvailable: true,
      });
      expect(updateStatus.message).toContain("发现项目启动服务更新");
      expect(readFileSync(status.executablePath)).toEqual(binaryContents);
      expect(https.get).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("emits percentage progress while downloading the service binary", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const progressEvents: Array<{ type?: string; percent?: number; receivedBytes?: number; totalBytes?: number }> = [];
    const binary = Buffer.from("12345678");
    const https = createProjectLaunchServiceDownloadHttps(binary, { chunkSize: 2 });
    try {
      const bridge = loadPreloadBridge(
        new Map(),
        undefined,
        { UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: serviceRoot },
        { https },
        (detail) => {
          if (detail && typeof detail === "object") {
            progressEvents.push(
              detail as { type?: string; percent?: number; receivedBytes?: number; totalBytes?: number },
            );
          }
        },
      );

      await bridge.downloadProjectLaunchService();

      expect(progressEvents.filter((event) => event.type === "service-download-progress")).toEqual([
        {
          type: "service-download-progress",
          receivedBytes: 0,
          totalBytes: 8,
          percent: 0,
          timestamp: expect.any(String),
        },
        {
          type: "service-download-progress",
          receivedBytes: 2,
          totalBytes: 8,
          percent: 25,
          timestamp: expect.any(String),
        },
        {
          type: "service-download-progress",
          receivedBytes: 4,
          totalBytes: 8,
          percent: 50,
          timestamp: expect.any(String),
        },
        {
          type: "service-download-progress",
          receivedBytes: 6,
          totalBytes: 8,
          percent: 75,
          timestamp: expect.any(String),
        },
        {
          type: "service-download-progress",
          receivedBytes: 8,
          totalBytes: 8,
          percent: 100,
          timestamp: expect.any(String),
        },
      ]);
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("fails closed instead of starting an unverified executable during explicit enable", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const spawn = vi.fn(() => Object.assign(new EventEmitter(), { unref: vi.fn() }));
    try {
      const bridge = createBridge(serviceRoot, { child_process: { spawn } });
      const installed = await bridge.getProjectLaunchServiceStatus();
      mkdirSync(installed.directoryPath, { recursive: true });
      writeFileSync(installed.executablePath, binaryContents);

      await expect(bridge.startProjectLaunchService()).resolves.toMatchObject({
        state: "unavailable",
        installed: true,
        running: false,
      });
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("creates the service directory before opening it", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const openPath = vi.fn(() => "");
    try {
      const bridge = createBridge(serviceRoot, { electron: { shell: { openPath } } });
      const status = await bridge.getProjectLaunchServiceStatus();
      expect(existsSync(status.directoryPath)).toBe(false);

      await bridge.openProjectLaunchServiceDirectory();

      expect(existsSync(status.directoryPath)).toBe(true);
      expect(openPath).toHaveBeenCalledWith(status.directoryPath);
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("keeps automatic startup fail-closed after executable replacement", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const https = createProjectLaunchServiceDownloadHttps(binaryContents);
    const spawn = vi.fn(() => Object.assign(new EventEmitter(), { unref: vi.fn() }));
    try {
      const bridge = createBridge(serviceRoot, { https, child_process: { spawn } });

      const installed = await bridge.downloadProjectLaunchService();
      const metadataPath = join(installed.directoryPath, "install.json");
      expect(JSON.parse(readFileSync(metadataPath, "utf8"))).toEqual({
        schemaVersion: 1,
        assetName: installed.expectedAssetName,
        sha256: createHash("sha256").update(binaryContents).digest("hex"),
      });
      if (process.platform !== "win32") {
        expect(statSync(metadataPath).mode & 0o077).toBe(0);
      }

      writeFileSync(installed.executablePath, "replaced executable");
      bridge.saveProjectLaunchServicePreferences({ schemaVersion: 1, enabled: true });
      const reconciled = await bridge.reconcileProjectLaunchService();

      expect(reconciled).toMatchObject({ state: "unavailable", installed: true, running: false });
      expect(reconciled.message).toContain("文件已变更");
      expect(spawn).not.toHaveBeenCalled();
      expect(https.get).toHaveBeenCalledTimes(3);
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("downloads release assets redirected through release-assets.githubusercontent.com", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const https = createProjectLaunchServiceDownloadHttps(binaryContents, { redirectToReleaseAssets: true });
    try {
      const bridge = createBridge(serviceRoot, { https });

      const installed = await bridge.downloadProjectLaunchService();

      expect(readFileSync(installed.executablePath)).toEqual(binaryContents);
      expect(https.get.mock.calls.map(([options]) => (options as { hostname: string }).hostname)).toEqual([
        "api.github.com",
        "github.com",
        "release-assets.githubusercontent.com",
        "github.com",
        "release-assets.githubusercontent.com",
      ]);
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("cleans a partial file when service download directory creation fails", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const downloadsPath = join(serviceRoot, "service", "downloads");
    const partialPath = join(downloadsPath, `${projectLaunchServiceExecutableName()}.partial`);
    const nativeFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
    const fs = {
      ...nativeFs,
      mkdirSync: (directoryPath: string, options?: Parameters<typeof mkdirSync>[1]) => {
        if (directoryPath === downloadsPath) {
          mkdirSync(directoryPath, { recursive: true });
          writeFileSync(partialPath, "stale partial");
          throw new Error("download directory failure");
        }
        return mkdirSync(directoryPath, options);
      },
    };
    try {
      const bridge = createBridge(serviceRoot, { https: createProjectLaunchServiceDownloadHttps(binaryContents), fs });

      await expect(bridge.downloadProjectLaunchService()).rejects.toThrow("download directory failure");
      expect(existsSync(partialPath)).toBe(false);
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
  });

  it("cleans a partial file when service executable writing fails", async () => {
    const serviceRoot = mkdtempSync(join(tmpdir(), "utools-project-launch-service-"));
    const partialPath = join(serviceRoot, "service", "downloads", `${projectLaunchServiceExecutableName()}.partial`);
    const nativeFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
    const fs = {
      ...nativeFs,
      writeFileSync: (
        filePath: string,
        contents: Parameters<typeof writeFileSync>[1],
        options?: Parameters<typeof writeFileSync>[2],
      ) => {
        if (filePath === partialPath) {
          writeFileSync(filePath, contents, options);
          throw new Error("service executable write failure");
        }
        return writeFileSync(filePath, contents, options);
      },
    };
    try {
      const bridge = createBridge(serviceRoot, { https: createProjectLaunchServiceDownloadHttps(binaryContents), fs });

      await expect(bridge.downloadProjectLaunchService()).rejects.toThrow("service executable write failure");
      expect(existsSync(partialPath)).toBe(false);
    } finally {
      rmSync(serviceRoot, { recursive: true, force: true });
    }
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

  it("surfaces service download percentage progress through the global action status", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    const { activeActionStatus } = await import("../src/components/common/actionStatus");
    setActivePinia(createPinia());
    const store = useStore();

    store.handleBridgeEvent({
      type: "service-download-progress",
      receivedBytes: 42,
      totalBytes: 100,
      percent: 42,
    });

    expect(activeActionStatus.value).toMatchObject({ state: "loading", message: "正在下载并安装（42%）" });

    store.setLocale("en-US");
    store.handleBridgeEvent({
      type: "service-download-progress",
      receivedBytes: 75,
      totalBytes: 100,
      percent: 75,
    });

    expect(activeActionStatus.value?.message).toBe("Downloading and installing (75%)");
  });

  it("ignores terminal events from an older script run", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "runtime-project",
        name: "Runtime project",
        path: "/workspace/runtime-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        pathExists: true,
        scripts: [
          {
            id: "runtime-script",
            name: "dev",
            command: "echo runtime",
            status: "RUNNING",
            pid: 2202,
            runId: "new-run",
            runtimeOwner: "preload",
          },
        ],
        env: {},
      },
    ];

    store.handleBridgeEvent({
      type: "exit",
      projectId: "runtime-project",
      scriptId: "runtime-script",
      pid: 2201,
      runId: "old-run",
      runtimeOwner: "preload",
      code: 1,
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({
      status: "RUNNING",
      pid: 2202,
      runId: "new-run",
      runtimeOwner: "preload",
    });
    expect(store.logs["runtime-project"]).toBeUndefined();

    store.handleBridgeEvent({
      type: "exit",
      projectId: "runtime-project",
      scriptId: "runtime-script",
      pid: 2202,
      runId: "new-run",
      runtimeOwner: "preload",
      code: 0,
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "IDLE" });
    expect(store.projects[0]?.scripts[0]?.runId).toBeUndefined();
  });

  it("applies service events after an older service snapshot", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
    store.projects = [
      {
        id: "ordered-service-project",
        name: "Ordered service project",
        path: "/workspace/ordered-service-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "ordered-service-script",
            name: "dev",
            command: "echo ordered",
            status: "RUNNING",
            pid: 8101,
            runId: "ordered-old-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];

    store.reconcileProjectLaunchServiceRuntime({
      state: "healthy",
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      runs: [
        {
          id: "ordered-old-run",
          projectId: "ordered-service-project",
          scriptId: "ordered-service-script",
          label: "Ordered service project / dev",
          command: "echo ordered",
          cwd: "C:\\workspace",
          pid: 8101,
          status: "running",
          startedAt: "2026-08-15T09:00:00.000Z",
        },
      ],
      events: [
        {
          cursor: 10,
          timestamp: "2026-08-15T09:00:01.000Z",
          type: "exit",
          runId: "ordered-old-run",
          projectId: "ordered-service-project",
          scriptId: "ordered-service-script",
          pid: 8101,
          code: 0,
        },
        {
          cursor: 11,
          timestamp: "2026-08-15T09:00:02.000Z",
          type: "started",
          runId: "ordered-new-run",
          projectId: "ordered-service-project",
          scriptId: "ordered-service-script",
          pid: 8102,
          message: "echo ordered",
          cwd: "C:\\workspace",
        },
      ],
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({
      status: "RUNNING",
      pid: 8102,
      runId: "ordered-new-run",
      runtimeOwner: "service",
    });
  });

  it("does not replay completed service events into current terminal logs", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
    store.projects = [
      {
        id: "completed-service-project",
        name: "Completed service project",
        path: "C:\\workspace",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [{ id: "completed-service-script", name: "dev", command: "echo completed", status: "IDLE" }],
        env: {},
      },
    ];

    store.reconcileProjectLaunchServiceRuntime({
      state: "healthy",
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      runs: [],
      events: [
        {
          cursor: 91,
          timestamp: "2026-08-18T12:00:00.000Z",
          type: "started",
          runId: "completed-service-run",
          projectId: "completed-service-project",
          scriptId: "completed-service-script",
          pid: 8103,
          message: "echo completed",
          cwd: "C:\\workspace",
        },
        {
          cursor: 92,
          timestamp: "2026-08-18T12:00:01.000Z",
          type: "exit",
          runId: "completed-service-run",
          projectId: "completed-service-project",
          scriptId: "completed-service-script",
          pid: 8103,
          stoppedByUser: true,
          code: 0,
        },
      ],
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "IDLE" });
    expect(store.logs["completed-service-project"]).toBeUndefined();
    expect(store.scriptLogs["completed-service-project"]).toBeUndefined();
  });

  it("keeps current terminal logs scoped to active service runs", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
    store.projects = [
      {
        id: "active-service-project",
        name: "Active service project",
        path: "C:\\workspace",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [
          { id: "active-service-script", name: "dev", command: "echo active", status: "IDLE" },
          { id: "completed-service-script", name: "server", command: "echo completed", status: "IDLE" },
        ],
        env: {},
      },
    ];

    store.reconcileProjectLaunchServiceRuntime({
      state: "healthy",
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      runs: [
        {
          id: "active-service-run",
          projectId: "active-service-project",
          scriptId: "active-service-script",
          label: "Active service project / dev",
          command: "echo active",
          cwd: "C:\\workspace",
          pid: 8104,
          status: "running",
          startedAt: "2026-08-18T12:01:00.000Z",
        },
      ],
      events: [
        {
          cursor: 93,
          timestamp: "2026-08-18T11:00:00.000Z",
          type: "started",
          runId: "completed-service-run",
          projectId: "active-service-project",
          scriptId: "completed-service-script",
          pid: 8103,
          message: "echo completed",
          cwd: "C:\\workspace",
        },
        {
          cursor: 94,
          timestamp: "2026-08-18T11:00:01.000Z",
          type: "exit",
          runId: "completed-service-run",
          projectId: "active-service-project",
          scriptId: "completed-service-script",
          pid: 8103,
          stoppedByUser: true,
          code: 0,
        },
        {
          cursor: 95,
          timestamp: "2026-08-18T12:01:01.000Z",
          type: "stdout",
          runId: "active-service-run",
          projectId: "active-service-project",
          scriptId: "active-service-script",
          pid: 8104,
          message: "current run output",
        },
      ],
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({
      status: "RUNNING",
      pid: 8104,
      runId: "active-service-run",
      runtimeOwner: "service",
    });
    expect(store.scriptLogs["active-service-project"]?.["completed-service-script"]).toBeUndefined();
    expect(store.scriptLogs["active-service-project"]?.["active-service-script"]).toContainEqual(
      expect.objectContaining({ message: "current run output" }),
    );
  });

  it("replays buffered output when a current service run is already terminal in the snapshot", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
    store.projects = [
      {
        id: "buffered-service-project",
        name: "Buffered service project",
        path: "C:\\workspace",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "one-shot-script",
            name: "one shot",
            command: "echo buffered",
            status: "RUNNING",
            pid: 8105,
            runId: "buffered-service-run",
            runtimeOwner: "service",
          },
          {
            id: "long-running-script",
            name: "long running",
            command: "echo active",
            status: "RUNNING",
            pid: 8106,
            runId: "active-service-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];

    store.reconcileProjectLaunchServiceRuntime({
      state: "healthy",
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      runs: [
        {
          id: "buffered-service-run",
          projectId: "buffered-service-project",
          scriptId: "one-shot-script",
          label: "Buffered service project / one shot",
          command: "echo buffered",
          cwd: "C:\\workspace",
          pid: 8105,
          status: "exited",
          startedAt: "2026-08-25T09:00:00.000Z",
          endedAt: "2026-08-25T09:00:01.000Z",
          code: 0,
        },
        {
          id: "active-service-run",
          projectId: "buffered-service-project",
          scriptId: "long-running-script",
          label: "Buffered service project / long running",
          command: "echo active",
          cwd: "C:\\workspace",
          pid: 8106,
          status: "running",
          startedAt: "2026-08-25T09:00:00.000Z",
        },
      ],
      events: [
        {
          cursor: 96,
          timestamp: "2026-08-25T09:00:00.500Z",
          type: "stdout",
          runId: "buffered-service-run",
          projectId: "buffered-service-project",
          scriptId: "one-shot-script",
          pid: 8105,
          message: "buffered output",
        },
        {
          cursor: 97,
          timestamp: "2026-08-25T09:00:01.000Z",
          type: "exit",
          runId: "buffered-service-run",
          projectId: "buffered-service-project",
          scriptId: "one-shot-script",
          pid: 8105,
          code: 0,
        },
      ],
    });

    expect(store.scriptLogs["buffered-service-project"]?.["one-shot-script"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "buffered output" }),
        expect.objectContaining({ message: "exited with code 0" }),
      ]),
    );
    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "IDLE" });
    expect(store.projects[0]?.scripts[1]).toMatchObject({
      status: "RUNNING",
      runId: "active-service-run",
      runtimeOwner: "service",
    });
  });

  it("keeps a current service run until a later event page reaches its terminal event", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
    store.projects = [
      {
        id: "paged-service-project",
        name: "Paged service project",
        path: "C:\\workspace",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "one-shot-script",
            name: "one shot",
            command: "echo paged",
            status: "RUNNING",
            pid: 8107,
            runId: "paged-service-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
      {
        id: "other-active-service-project",
        name: "Other active service project",
        path: "C:\\workspace-other",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "long-running-script",
            name: "long running",
            command: "echo active",
            status: "RUNNING",
            pid: 8108,
            runId: "active-paged-service-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];

    store.reconcileProjectLaunchServiceRuntime({
      state: "healthy",
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      eventsHasMore: true,
      runs: [
        {
          id: "paged-service-run",
          projectId: "paged-service-project",
          scriptId: "one-shot-script",
          label: "Paged service project / one shot",
          command: "echo paged",
          cwd: "C:\\workspace",
          pid: 8107,
          status: "exited",
          startedAt: "2026-08-25T09:00:00.000Z",
          endedAt: "2026-08-25T09:00:01.000Z",
          code: 0,
        },
        {
          id: "active-paged-service-run",
          projectId: "other-active-service-project",
          scriptId: "long-running-script",
          label: "Other active service project / long running",
          command: "echo active",
          cwd: "C:\\workspace-other",
          pid: 8108,
          status: "running",
          startedAt: "2026-08-25T09:00:00.000Z",
        },
      ],
      events: [
        {
          cursor: 98,
          timestamp: "2026-08-25T09:00:00.000Z",
          type: "started",
          runId: "paged-service-run",
          projectId: "paged-service-project",
          scriptId: "one-shot-script",
          pid: 8107,
        },
      ],
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({
      status: "RUNNING",
      runId: "paged-service-run",
      runtimeOwner: "service",
    });

    store.handleBridgeEvent({
      type: "stdout",
      cursor: 99,
      timestamp: "2026-08-25T09:00:00.500Z",
      runId: "paged-service-run",
      projectId: "paged-service-project",
      scriptId: "one-shot-script",
      pid: 8107,
      runtimeOwner: "service",
      message: "paged output",
    });
    store.handleBridgeEvent({
      type: "exit",
      cursor: 100,
      timestamp: "2026-08-25T09:00:01.000Z",
      runId: "paged-service-run",
      projectId: "paged-service-project",
      scriptId: "one-shot-script",
      pid: 8107,
      runtimeOwner: "service",
      code: 0,
    });

    expect(store.scriptLogs["paged-service-project"]?.["one-shot-script"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "paged output" }),
        expect.objectContaining({ message: "exited with code 0" }),
      ]),
    );
    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "IDLE" });
    expect(store.projects[1]?.scripts[0]).toMatchObject({
      status: "RUNNING",
      runId: "active-paged-service-run",
      runtimeOwner: "service",
    });
  });

  it("does not append duplicate service output for the same event cursor", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "deduplicated-service-project",
        name: "Deduplicated service project",
        path: "/workspace/deduplicated-service-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "deduplicated-service-script",
            name: "dev",
            command: "echo output",
            status: "RUNNING",
            pid: 3301,
            runId: "deduplicated-service-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];
    const event = {
      type: "stdout" as const,
      projectId: "deduplicated-service-project",
      scriptId: "deduplicated-service-script",
      pid: 3301,
      cursor: 42,
      runId: "deduplicated-service-run",
      runtimeOwner: "service" as const,
      message: "one line",
    };

    store.handleBridgeEvent(event);
    store.handleBridgeEvent(event);

    expect(store.scriptLogs["deduplicated-service-project"]?.["deduplicated-service-script"]).toHaveLength(1);
    expect(store.logs["deduplicated-service-project"]).toHaveLength(1);
  });

  it("bounds live project and script logs together", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    for (let index = 0; index < 2_000; index += 1) {
      store.addLog(
        "bounded-log-project",
        { timestamp: "10:00:00", message: `first ${index}`, type: "INFO" },
        "first-script",
      );
    }
    store.addLog("bounded-log-project", { timestamp: "10:00:01", message: "second 0", type: "INFO" }, "second-script");

    expect(store.logs["bounded-log-project"]).toHaveLength(2_000);
    expect(store.scriptLogs["bounded-log-project"]?.["first-script"]).toHaveLength(1_999);
    expect(store.scriptLogs["bounded-log-project"]?.["first-script"]?.[0]?.message).toBe("first 1");
    expect(store.scriptLogs["bounded-log-project"]?.["second-script"]).toEqual([
      { timestamp: "10:00:01", message: "second 0", type: "INFO" },
    ]);
    expect(store.logs["bounded-log-project"]?.some((entry) => entry.message === "first 0")).toBe(false);
  });

  it("keeps reused log inputs aligned while trimming", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const reusedLog = { timestamp: "10:00:00", message: "reused", type: "INFO" as const };

    for (let index = 0; index < 2_000; index += 1) {
      store.addLog("reused-log-project", reusedLog, "first-script");
    }
    store.addLog("reused-log-project", reusedLog, "second-script");

    expect(store.logs["reused-log-project"]).toHaveLength(2_000);
    expect(store.scriptLogs["reused-log-project"]?.["first-script"]).toHaveLength(1_999);
    expect(store.scriptLogs["reused-log-project"]?.["second-script"]).toHaveLength(1);
  });

  it("accepts a legacy terminal event only when its pid matches the current run", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "legacy-event-project",
        name: "Legacy event project",
        path: "/workspace/legacy-event-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "legacy-event-script",
            name: "dev",
            command: "echo legacy",
            status: "RUNNING",
            pid: 5502,
            runId: "current-run",
            runtimeOwner: "preload",
          },
        ],
        env: {},
      },
    ];

    store.handleBridgeEvent({
      type: "exit",
      projectId: "legacy-event-project",
      scriptId: "legacy-event-script",
      pid: 5501,
      code: 1,
    });
    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "RUNNING", runId: "current-run" });

    store.handleBridgeEvent({
      type: "exit",
      projectId: "legacy-event-project",
      scriptId: "legacy-event-script",
      pid: 5502,
      code: 0,
    });
    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "IDLE" });
    expect(store.projects[0]?.scripts[0]?.runId).toBeUndefined();
  });

  it("preserves the current identity when a matching legacy started event arrives", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "legacy-started-project",
        name: "Legacy started project",
        path: "/workspace/legacy-started-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "legacy-started-script",
            name: "dev",
            command: "echo legacy-started",
            status: "RUNNING",
            pid: 6602,
            runId: "current-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];

    store.handleBridgeEvent({
      type: "started",
      projectId: "legacy-started-project",
      scriptId: "legacy-started-script",
      pid: 6602,
      message: "legacy event",
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({
      status: "RUNNING",
      pid: 6602,
      runId: "current-run",
      runtimeOwner: "service",
    });
  });

  it("rejects a delayed started event recorded as a terminal service run", async () => {
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjects: vi.fn(async () => []),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "snapshot-terminal-project",
        name: "Snapshot terminal project",
        path: "/workspace/snapshot-terminal-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [{ id: "snapshot-terminal-script", name: "dev", command: "echo terminal", status: "IDLE" }],
        env: {},
      },
    ];

    const status: ProjectLaunchServiceStatus = {
      state: "healthy",
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      runs: [
        {
          id: "snapshot-old-run",
          projectId: "snapshot-terminal-project",
          scriptId: "snapshot-terminal-script",
          label: "Snapshot terminal project / dev",
          command: "echo terminal",
          cwd: "C:\\workspace",
          status: "exited",
          startedAt: "2026-08-15T09:00:00.000Z",
          pid: 7701,
          endedAt: "2026-08-15T09:00:01.000Z",
          code: 0,
        },
      ],
    };

    store.handleBridgeEvent({ type: "service-state", status });
    store.handleBridgeEvent({
      type: "started",
      projectId: "snapshot-terminal-project",
      scriptId: "snapshot-terminal-script",
      pid: 7701,
      runId: "snapshot-old-run",
      runtimeOwner: "service",
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "IDLE" });
    expect(store.projects[0]?.scripts[0]?.runId).toBeUndefined();
  });

  it("waits for the matching run identity before applying a terminal event", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "pending-project",
        name: "Pending project",
        path: "/workspace/pending-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "pending-script",
            name: "dev",
            command: "echo pending",
            status: "RUNNING",
            pid: undefined,
          },
        ],
        env: {},
      },
    ];

    store.handleBridgeEvent({
      type: "exit",
      projectId: "pending-project",
      scriptId: "pending-script",
      pid: 3301,
      runId: "pending-run",
      runtimeOwner: "preload",
      code: 0,
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "RUNNING" });

    store.handleBridgeEvent({
      type: "started",
      projectId: "pending-project",
      scriptId: "pending-script",
      pid: 3301,
      runId: "pending-run",
      runtimeOwner: "preload",
      message: "echo pending",
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "IDLE" });
    expect(store.projects[0]?.scripts[0]?.runId).toBeUndefined();
  });

  it("ignores a delayed started event from a previously settled run", async () => {
    window.projectBridge = { ...getProjectBridge(), loadProjects: vi.fn(async () => []) };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "settled-project",
        name: "Settled project",
        path: "/workspace/settled-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        pathExists: true,
        scripts: [{ id: "settled-script", name: "dev", command: "echo settled", status: "IDLE" }],
        env: {},
      },
    ];

    store.handleBridgeEvent({
      type: "started",
      projectId: "settled-project",
      scriptId: "settled-script",
      pid: 4401,
      runId: "settled-old-run",
      runtimeOwner: "preload",
    });
    store.handleBridgeEvent({
      type: "exit",
      projectId: "settled-project",
      scriptId: "settled-script",
      pid: 4401,
      runId: "settled-old-run",
      runtimeOwner: "preload",
      code: 0,
    });
    store.handleBridgeEvent({
      type: "started",
      projectId: "settled-project",
      scriptId: "settled-script",
      pid: 4402,
      runId: "settled-new-run",
      runtimeOwner: "preload",
    });
    store.handleBridgeEvent({
      type: "exit",
      projectId: "settled-project",
      scriptId: "settled-script",
      pid: 4402,
      runId: "settled-new-run",
      runtimeOwner: "preload",
      code: 0,
    });

    store.handleBridgeEvent({
      type: "started",
      projectId: "settled-project",
      scriptId: "settled-script",
      pid: 4401,
      runId: "settled-old-run",
      runtimeOwner: "preload",
    });

    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "IDLE" });
    expect(store.projects[0]?.scripts[0]?.runId).toBeUndefined();
  });

  it("stops a service run by runId while its process is still starting", async () => {
    const stopProcess = vi.fn<ProjectBridge["stopProcess"]>(async () => undefined);
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjects: vi.fn(async () => []),
      stopProcess,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "starting-service-project",
        name: "Starting service project",
        path: "/workspace/starting-service-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "starting-service-script",
            name: "dev",
            command: "echo starting",
            status: "RUNNING",
            runId: "starting-service-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];

    await store.stopScript("starting-service-project", "starting-service-script");
    await vi.advanceTimersByTimeAsync(0);

    expect(store.projects[0]?.scripts[0]?.status).toBe("STOPPING");
    expect(stopProcess).toHaveBeenCalledWith(0, {
      runId: "starting-service-run",
      runtimeOwner: "service",
    });
  });

  it("stops a service launch once its run identity arrives", async () => {
    let resolveRun: (result: ProjectBridgeRunResult) => void = () => undefined;
    const runCommand = vi.fn<ProjectBridge["runCommand"]>(
      () =>
        new Promise<ProjectBridgeRunResult>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const stopProcess = vi.fn<ProjectBridge["stopProcess"]>(async () => undefined);
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjects: vi.fn(async () => []),
      runCommand,
      stopProcess,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
    store.projects = [
      {
        id: "pending-service-project",
        name: "Pending service project",
        path: "/workspace/pending-service-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [{ id: "pending-service-script", name: "dev", command: "echo pending", status: "IDLE" }],
        env: {},
      },
    ];

    const launch = store.launchScript("pending-service-project", "pending-service-script");
    await Promise.resolve();
    await store.stopScript("pending-service-project", "pending-service-script");

    expect(store.projects[0]?.scripts[0]?.status).toBe("STOPPING");
    expect(stopProcess).not.toHaveBeenCalled();

    resolveRun({
      pid: 0,
      startedAt: "2026-08-15T09:00:00.000Z",
      command: "echo pending",
      cwd: "/workspace/pending-service-project",
      runId: "pending-service-run",
      runtimeOwner: "service",
    });
    await launch;
    await vi.advanceTimersByTimeAsync(0);

    expect(stopProcess).toHaveBeenCalledWith(0, {
      runId: "pending-service-run",
      runtimeOwner: "service",
    });
  });

  it("sends input to a service run by runId while its process is still starting", async () => {
    const sendProcessInput = vi.fn<ProjectBridge["sendProcessInput"]>(async () => ({ sent: true }));
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjects: vi.fn(async () => []),
      sendProcessInput,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "input-service-project",
        name: "Input service project",
        path: "/workspace/input-service-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "input-service-script",
            name: "dev",
            command: "echo input",
            status: "RUNNING",
            runId: "input-service-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];

    await expect(store.sendScriptInput("input-service-project", "input-service-script", "hello")).resolves.toEqual({
      sent: true,
    });
    expect(sendProcessInput).toHaveBeenCalledWith(0, "hello", {
      runId: "input-service-run",
      runtimeOwner: "service",
    });
  });

  it("reconciles a pid-less service run by runId", async () => {
    const getProcessStatus = vi.fn<ProjectBridge["getProcessStatus"]>(async () => ({
      active: false,
      code: 0,
      runId: "pid-less-service-run",
      runtimeOwner: "service",
    }));
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjects: vi.fn(async () => []),
      getProcessStatus,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "pid-less-service-project",
        name: "PID-less service project",
        path: "/workspace/pid-less-service-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.RUNNING,
        scripts: [
          {
            id: "pid-less-service-script",
            name: "dev",
            command: "echo pid-less",
            status: "RUNNING",
            runId: "pid-less-service-run",
            runtimeOwner: "service",
          },
        ],
        env: {},
      },
    ];

    await store.reconcileRuntimeProcessState();

    expect(getProcessStatus).toHaveBeenCalledWith(0, {
      runId: "pid-less-service-run",
      runtimeOwner: "service",
    });
    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "IDLE" });
    expect(store.projects[0]?.scripts[0]?.runId).toBeUndefined();
  });

  it("applies live service automation snapshots, history, and one completion notification", async () => {
    const showNotification = vi.fn();
    const saveProjects = vi.fn<ProjectBridge["saveProjects"]>(async () => undefined);
    window.utools = {
      isDarkColors: () => false,
      onPluginEnter: () => undefined,
      outPlugin: () => false,
      showNotification,
    };
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjects: vi.fn(async () => []),
      saveProjects,
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "automation-project",
        name: "Automation project",
        path: "/workspace/automation-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [{ id: "automation-script", name: "dev", command: "echo automation", status: "IDLE" }],
        env: {},
        automationTasks: [
          {
            id: "automation-task",
            name: "Deploy task",
            enabled: true,
            scriptIds: ["automation-script"],
            schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
            missedPolicy: "grace-run",
            missedGraceMinutes: 5,
            notifyEnabled: true,
            maxScriptRuntimeMinutes: 30,
            inputConfigs: [],
            exitConfigs: [],
            dailyPlans: [
              {
                date: dateKey(),
                entries: [{ id: "automation-entry", plannedAt: "2026-08-15T09:00:00.000Z", status: "pending" }],
              },
            ],
            history: [],
            createdAt: "2026-08-15T00:00:00.000Z",
            updatedAt: "2026-08-15T00:00:00.000Z",
          },
        ],
      },
    ];

    const baseStatus: ProjectLaunchServiceStatus = {
      state: "healthy",
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      automationRevision: 4,
    };
    const execution = {
      id: "automation-run",
      projectId: "automation-project",
      taskId: "automation-task",
      planEntryId: "automation-entry",
      plannedAt: "2026-08-15T09:00:00.000Z",
      currentScriptIndex: 0,
      startedAt: "2026-08-15T09:00:01.000Z",
      scriptResults: [],
    };

    store.handleBridgeEvent({
      type: "service-state",
      status: {
        ...baseStatus,
        automation: {
          revision: 4,
          upcoming: [
            {
              projectId: "automation-project",
              taskId: "automation-task",
              planEntryId: "service-upcoming-entry",
              plannedAt: "2026-08-16T09:00:00.000Z",
            },
          ],
          executions: [{ ...execution, status: "running" }],
        },
      },
    });

    expect(store.projects[0]?.automationTasks?.[0]?.dailyPlans[0]?.entries[0]).toMatchObject({
      status: "running",
      runId: "automation-run",
    });
    expect(store.automationActiveProjectRuns["automation-project"]).toBe("automation-run");
    expect(store.serviceAutomationTaskEntries("automation-project", "automation-task")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "automation-entry", status: "running" }),
        expect.objectContaining({ id: "service-upcoming-entry", status: "pending" }),
      ]),
    );

    store.handleBridgeEvent({
      type: "service-state",
      status: {
        ...baseStatus,
        automation: {
          revision: 4,
          executions: [
            {
              ...execution,
              status: "completed",
              currentScriptIndex: 1,
              endedAt: "2026-08-15T09:01:00.000Z",
              scriptResults: [
                {
                  scriptId: "automation-script",
                  status: "completed",
                  startedAt: execution.startedAt,
                  endedAt: "2026-08-15T09:01:00.000Z",
                },
              ],
            },
          ],
        },
      },
    });

    const task = store.projects[0]?.automationTasks?.[0];
    expect(task?.dailyPlans[0]?.entries[0]?.status).toBe("completed");
    expect(store.automationActiveProjectRuns["automation-project"]).toBeUndefined();
    expect(task?.history).toHaveLength(1);
    expect(task?.history[0]).toMatchObject({ id: "automation-run", status: "completed" });
    expect(showNotification).toHaveBeenCalledWith("任务“Deploy task”已完成");
    await vi.waitFor(() => expect(saveProjects).toHaveBeenCalledTimes(1));
    expect(saveProjects.mock.calls[0]?.[0][0]?.automationTasks?.[0]?.observedServiceExecutionIds).toContain(
      "automation-run",
    );

    store.handleBridgeEvent({
      type: "service-state",
      status: {
        ...baseStatus,
        automation: {
          revision: 4,
          executions: [
            {
              ...execution,
              status: "completed",
              currentScriptIndex: 1,
              endedAt: "2026-08-15T09:01:00.000Z",
              scriptResults: [
                {
                  scriptId: "automation-script",
                  status: "completed",
                  startedAt: execution.startedAt,
                  endedAt: "2026-08-15T09:01:00.000Z",
                },
              ],
            },
          ],
        },
      },
    });

    expect(showNotification).toHaveBeenCalledTimes(1);

    task!.history = Array.from({ length: 20 }, (_, index) => ({
      id: `local-history-${index}`,
      taskId: "automation-task",
      taskName: "Deploy task",
      projectId: "automation-project",
      projectName: "Automation project",
      plannedAt: "2026-08-16T09:00:00.000Z",
      endedAt: "2026-08-16T09:01:00.000Z",
      status: "completed" as const,
      scriptResults: [],
    }));

    store.handleBridgeEvent({
      type: "service-state",
      status: {
        ...baseStatus,
        automation: {
          revision: 4,
          executions: [
            {
              ...execution,
              status: "completed",
              currentScriptIndex: 1,
              endedAt: "2026-08-15T09:01:00.000Z",
              scriptResults: [],
            },
          ],
        },
      },
    });

    store.handleBridgeEvent({
      type: "service-state",
      status: {
        ...baseStatus,
        automation: {
          revision: 4,
          executions: [
            {
              ...execution,
              status: "completed",
              currentScriptIndex: 1,
              endedAt: "2026-08-15T09:01:00.000Z",
              scriptResults: [],
            },
          ],
        },
      },
    });

    expect(showNotification).toHaveBeenCalledTimes(1);

    store.handleBridgeEvent({
      type: "service-state",
      status: {
        ...baseStatus,
        automation: { revision: 4, executions: [] },
      },
    });

    expect(store.automationActiveProjectRuns["automation-project"]).toBeUndefined();
  });

  it("reconciles the existing service run after an active-run conflict", async () => {
    const conflict = Object.assign(new Error("An active run already exists."), { code: "active_run_conflict" });
    const runCommand = vi.fn(async () => {
      throw conflict;
    });
    const reconcileProjectLaunchService = vi.fn(async () => ({
      state: "healthy" as const,
      installed: true,
      running: true,
      platform: "windows",
      architecture: "amd64",
      expectedAssetName: "project-launch-service-windows-amd64.exe",
      directoryPath: "C:\\service",
      executablePath: "C:\\service\\project-launch-service.exe",
      releaseUrl: "https://github.com/Wwyxa/utools-project-launch/releases",
      runs: [
        {
          id: "existing-service-run",
          projectId: "conflict-project",
          scriptId: "conflict-script",
          label: "Conflict project / script",
          command: "echo existing",
          cwd: "C:\\workspace",
          pid: 4422,
          status: "running" as const,
          startedAt: "2026-08-15T09:00:00.000Z",
        },
      ],
    }));
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjects: vi.fn(async () => []),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
      runCommand,
      reconcileProjectLaunchService,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "conflict-project",
        name: "Conflict project",
        path: "C:\\workspace",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [{ id: "conflict-script", name: "dev", command: "echo existing", status: "IDLE" }],
        env: {},
      },
    ];

    await expect(store.launchScript("conflict-project", "conflict-script")).resolves.toBeNull();

    expect(runCommand).toHaveBeenCalledOnce();
    expect(reconcileProjectLaunchService).toHaveBeenCalledOnce();
    expect(store.projects[0]?.scripts[0]).toMatchObject({
      status: "RUNNING",
      pid: 4422,
      runId: "existing-service-run",
      runtimeOwner: "service",
    });
  });

  it("does not leave a pid-less running script when an active-run conflict cannot be reconciled", async () => {
    const conflict = Object.assign(new Error("An active run already exists."), { code: "active_run_conflict" });
    const runCommand = vi.fn(async () => {
      throw conflict;
    });
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
      runs: [],
    };
    const reconcileProjectLaunchService = vi.fn(async () => healthyStatus);
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjects: vi.fn(async () => []),
      loadProjectLaunchServicePreferences: () => ({ schemaVersion: 1, enabled: true }),
      runCommand,
      reconcileProjectLaunchService,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [
      {
        id: "unreconciled-conflict-project",
        name: "Unreconciled conflict project",
        path: "C:\\workspace",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [{ id: "unreconciled-conflict-script", name: "dev", command: "echo conflict", status: "IDLE" }],
        env: {},
      },
    ];

    await expect(
      store.launchScript("unreconciled-conflict-project", "unreconciled-conflict-script"),
    ).resolves.toBeNull();

    expect(store.projects[0]?.scripts[0]).toMatchObject({ status: "ERROR" });
    expect(store.projects[0]?.scripts[0]?.pid).toBeUndefined();
    expect(store.projects[0]?.scripts[0]?.runId).toBeUndefined();
    expect(store.projects[0]?.scripts[0]?.runtimeOwner).toBeUndefined();
    expect(store.projectLaunchServiceStatus).toMatchObject({
      state: "unavailable",
      message: "项目启动服务存在活动运行，但当前窗口未能恢复其身份。",
    });
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
          projectDetails: { tabOrder: ["memo", "unknown", "memo"], defaultTab: "unknown" },
          dashboard: { tinyCardActionTrigger: "unsupported" },
          coachMarks: { projectDetailsTabReorder: 1, projectDetailsTabDefault: 1.5 },
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
    expect(bridge.loadUiPreferences().dashboard.tinyCardActionTrigger).toBe("hover");
    expect(bridge.loadUiPreferences().projectDetails.defaultTab).toBe(defaultOpenTab);
    expect(bridge.loadUiPreferences().coachMarks.projectDetailsTabDefault).toBe(0);
    expect(storage.has(legacyTabOrderKey)).toBe(false);

    bridge.saveUiPreferences({
      schemaVersion: 1,
      projectDetails: { tabOrder: ["git", "git", "memo"], defaultTab: "memo" },
      dashboard: { tinyCardActionTrigger: "contextmenu" },
      coachMarks: { projectDetailsTabReorder: 2, projectDetailsTabDefault: 3 },
    });
    const saved = storage.get(uiPreferencesKey) as UiPreferences;
    expect(saved.projectDetails.tabOrder).toEqual(["git", "memo", "info", "scripts", "automation", "files"]);
    expect(saved.projectDetails.defaultTab).toBe("memo");
    expect(saved.dashboard.tinyCardActionTrigger).toBe("contextmenu");
    expect(saved.coachMarks.projectDetailsTabDefault).toBe(3);
    expect(storage.has(legacyTabOrderKey)).toBe(false);
  });

  it("uses defaults instead of legacy data when the new configuration is invalid", () => {
    const storage = new Map<string, unknown>([
      [uiPreferencesKey, { schemaVersion: 2 }],
      [legacyTabOrderKey, ["scripts", "info", "automation", "files", "git", "memo"]],
    ]);

    expect(loadPreloadBridge(storage).loadUiPreferences()).toEqual({
      schemaVersion: 1,
      projectDetails: { tabOrder: defaultTabOrder, defaultTab: defaultOpenTab },
      dashboard: { tinyCardActionTrigger: "hover" },
      coachMarks: { projectDetailsTabReorder: 0, projectDetailsTabDefault: 0 },
    });
  });

  it("keeps readable current preferences when legacy cleanup fails", () => {
    const preferences: UiPreferences = {
      schemaVersion: 1,
      projectDetails: { tabOrder: ["memo", "info", "scripts", "automation", "files", "git"], defaultTab: "memo" },
      dashboard: { tinyCardActionTrigger: "hover" },
      coachMarks: { projectDetailsTabReorder: 1, projectDetailsTabDefault: 1 },
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
          protocolVersion: 2,
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
