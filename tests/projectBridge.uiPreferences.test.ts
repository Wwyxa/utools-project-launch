import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { getProjectBridge } from "../src/lib/projectBridge";
import {
  ProjectStatus,
  type Project,
  type ProjectBridge,
  type ProjectDetailsTabId,
  type UiPreferences,
} from "../src/types";

const uiPreferencesKey = "utools-project-launch.ui-preferences.v1";
const legacyTabOrderKey = "utools-project-launch.project-details-tab-order.v1";
const defaultTabOrder: ProjectDetailsTabId[] = ["info", "scripts", "automation", "files", "git", "memo"];

const loadPreloadBridge = (
  storage: Map<string, unknown>,
  removeItem: (key: string) => void = (key) => {
    storage.delete(key);
  },
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
    process: { platform: process.platform, env: process.env, once: () => undefined, exit: () => undefined },
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
});
