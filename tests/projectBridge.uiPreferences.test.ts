import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createPinia, setActivePinia } from "pinia";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  type ProjectLaunchServiceStatus,
  type UiPreferences,
} from "../src/types";

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
      env: {
        ...process.env,
        ...(environment.UTOOLS_PROJECT_LAUNCH_LOCAL_DATA_DIR
          ? { UTOOLS_PROJECT_LAUNCH_LEGACY_DATA_DIR: join(environment.UTOOLS_PROJECT_LAUNCH_LOCAL_DATA_DIR, "legacy") }
          : {}),
        ...environment,
      },
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

describe("uTools preload UI preferences", () => {
  it("round-trips current preferences through the local state file", () => {
    const localDataDirectory = mkdtempSync(join(tmpdir(), "utools-project-launch-localdata-"));
    try {
      const preferences: UiPreferences = {
        schemaVersion: 1,
        iconPackId: "builtin",
        projectDetails: { tabOrder: ["memo", "info", "scripts", "automation", "files", "git"], defaultTab: "memo" },
        dashboard: { tinyCardActionTrigger: "hover" },
        coachMarks: { projectDetailsTabReorder: 1, projectDetailsTabDefault: 1 },
      };
      const environment = { UTOOLS_PROJECT_LAUNCH_LOCAL_DATA_DIR: localDataDirectory };
      const bridge = loadPreloadBridge(new Map(), undefined, environment);

      expect(bridge.saveUiPreferences(preferences)).toMatchObject({ ok: true });
      expect(bridge.loadUiPreferences()).toEqual(preferences);

      const restartedBridge = loadPreloadBridge(new Map(), undefined, environment);
      expect(restartedBridge.loadUiPreferences()).toEqual(preferences);
    } finally {
      rmSync(localDataDirectory, { recursive: true, force: true });
    }
  });
});

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
});

describe("Project Launch Service preload installation", () => {
  const binaryContents = Buffer.from("verified-project-launch-service");

  const createBridge = (serviceRoot: string, moduleOverrides: Record<string, unknown> = {}) =>
    loadPreloadBridge(new Map(), undefined, { UTOOLS_PROJECT_LAUNCH_LOCAL_DATA_DIR: serviceRoot }, moduleOverrides);

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
});

describe("store project catalog refresh", () => {
  beforeEach(() => {
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
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("passes a loaded catalog baseline and explicit project deletions to persistence", async () => {
    const persistedProject: Project = {
      id: "persisted-baseline-project",
      name: "Persisted Baseline Project",
      path: "C:/workspace/persisted-baseline-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [],
      env: {},
      memo: "initial memo",
    };
    const saveProjects = vi.fn<ProjectBridge["saveProjects"]>(async () => undefined);
    window.projectBridge = {
      ...getProjectBridge(),
      loadProjects: vi.fn<ProjectBridge["loadProjects"]>(async () => [persistedProject]),
      saveProjects,
      pathExists: vi.fn(async () => true),
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    await store.reloadProjectsFromStorage();

    store.projects[0]!.memo = "locally updated memo";
    await store.persistProjects();

    expect(saveProjects.mock.calls[0]?.[1]).toMatchObject({
      baseProjects: [expect.objectContaining({ id: persistedProject.id, memo: "initial memo" })],
      removedProjectIds: [],
    });

    await store.deleteProject(persistedProject.id);

    expect(saveProjects.mock.calls[1]?.[0]).toEqual([]);
    expect(saveProjects.mock.calls[1]?.[1]).toMatchObject({
      removedProjectIds: [persistedProject.id],
    });
  });
});
