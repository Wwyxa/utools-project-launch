import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { getProjectBridge } from "./projectBridge";
import type { ProjectBridge, ProjectDetailsTabId, UiPreferences } from "../types";

const uiPreferencesKey = "utools-project-launch.ui-preferences.v1";
const legacyTabOrderKey = "utools-project-launch.project-details-tab-order.v1";
const defaultTabOrder: ProjectDetailsTabId[] = ["info", "scripts", "automation", "files", "git", "memo"];

const loadPreloadBridge = (storage: Map<string, unknown>) => {
  const nodeRequire = createRequire(import.meta.url);
  const sandboxWindow: { projectBridge?: ProjectBridge; utools: { dbStorage: object } } = {
    utools: {
      dbStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: unknown) => storage.set(key, value),
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

  it("round-trips normalized preferences and keeps the legacy order synchronized", () => {
    getProjectBridge().saveUiPreferences({
      schemaVersion: 1,
      projectDetails: { tabOrder: ["git", "git", "memo"] },
      coachMarks: { projectDetailsTabReorder: 2 },
    });

    const preferences = getProjectBridge().loadUiPreferences();
    expect(preferences.projectDetails.tabOrder).toEqual(["git", "memo", "info", "scripts", "automation", "files"]);
    expect(preferences.coachMarks.projectDetailsTabReorder).toBe(2);
    expect(JSON.parse(storage.get(legacyTabOrderKey)!)).toEqual(preferences.projectDetails.tabOrder);
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

    const { useStore } = await import("../store/useStore");
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
  });

  it("prefers and normalizes the new configuration, then synchronizes both keys on save", () => {
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

    bridge.saveUiPreferences({
      schemaVersion: 1,
      projectDetails: { tabOrder: ["git", "git", "memo"] },
      coachMarks: { projectDetailsTabReorder: 2 },
    });
    const saved = storage.get(uiPreferencesKey) as UiPreferences;
    expect(saved.projectDetails.tabOrder).toEqual(["git", "memo", "info", "scripts", "automation", "files"]);
    expect(storage.get(legacyTabOrderKey)).toEqual(saved.projectDetails.tabOrder);
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
});
