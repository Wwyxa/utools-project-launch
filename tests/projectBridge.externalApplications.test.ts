import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { getProjectBridge } from "../src/lib/projectBridge";
import { ProjectStatus } from "../src/types";
import type { ExternalApplicationPreferences, Project, ProjectBridge } from "../src/types";

const externalApplicationPreferencesV1Key = "utools-project-launch.local-external-applications.v1";
const preferencesKey = "utools-project-launch.local-external-applications.v2";
const localLegacyKey = "utools-project-launch.local-editor-settings.v1";
const sharedLegacyKey = "utools-project-launch.editor-settings.v1";
const terminalPreferencesV1Key = "utools-project-launch.settings.v1";
const terminalPreferencesV2Key = "utools-project-launch.local-settings.v2";

const defaults: ExternalApplicationPreferences = {
  schemaVersion: 2,
  mode: "auto",
  defaultApplicationId: "vscode",
  applications: [
    { id: "vscode", name: "VS Code", kind: "vscode", command: "code {path}", enabled: true, launchMode: "native" },
    { id: "cursor", name: "Cursor", kind: "cursor", command: "cursor {path}", enabled: true, launchMode: "native" },
  ],
};

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    api: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
};

const createDbStorage = (options: { failExternalApplicationV2Write?: boolean } = {}) => {
  const values = new Map<string, unknown>();
  return {
    values,
    api: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: unknown) => {
        if (options.failExternalApplicationV2Write && key === preferencesKey) {
          throw new Error("Unable to persist V2 external application preferences.");
        }
        values.set(key, value);
      },
      removeItem: (key: string) => values.delete(key),
    },
  };
};

const loadPreloadBridge = (
  storage: ReturnType<typeof createStorage>["api"],
  moduleOverrides: Record<string, unknown> = {},
  dbStorage: ReturnType<typeof createDbStorage>["api"] = createDbStorage().api,
) => {
  const nodeRequire = createRequire(import.meta.url);
  const sandboxWindow: { projectBridge?: ProjectBridge; localStorage: typeof storage; utools: { dbStorage: object } } =
    {
      localStorage: storage,
      utools: { dbStorage },
    };
  const sandbox = {
    require: (id: string) => (id === "electron" ? { shell: {} } : (moduleOverrides[id] ?? nodeRequire(id))),
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

describe("browser external application preferences", () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage();
    vi.stubGlobal("window", {
      navigator: { platform: "", userAgent: "vitest" },
      localStorage: storage.api,
      setTimeout,
      clearTimeout,
      projectBridge: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("persists complete defaults when no preference exists", () => {
    expect(getProjectBridge().loadExternalApplicationPreferences()).toEqual(defaults);
    expect(JSON.parse(storage.values.get(preferencesKey)!)).toEqual(defaults);
  });

  it("removes the external application V1 key after persisting V2", () => {
    const legacyPreferences = { ...defaults, mode: "manual" as const, defaultApplicationId: "cursor" };
    storage.values.set(externalApplicationPreferencesV1Key, JSON.stringify(legacyPreferences));

    expect(getProjectBridge().loadExternalApplicationPreferences()).toEqual(legacyPreferences);
    expect(storage.values.has(externalApplicationPreferencesV1Key)).toBe(false);
    expect(JSON.parse(storage.values.get(preferencesKey)!)).toEqual(legacyPreferences);
  });

  it.each([
    [localLegacyKey, { kind: "cursor", customCommand: "" }, "cursor"],
    [sharedLegacyKey, { kind: "vscode", customCommand: "" }, "vscode"],
  ])("migrates %s before writing the new local key", (key, legacy, expectedDefault) => {
    storage.values.set(key, JSON.stringify(legacy));
    expect(getProjectBridge().loadExternalApplicationPreferences().defaultApplicationId).toBe(expectedDefault);
    expect(storage.values.has(preferencesKey)).toBe(true);
  });

  it("migrates a valid custom editor command", () => {
    storage.values.set(
      localLegacyKey,
      JSON.stringify({ kind: "custom", customCommand: '"C:\\Program Files\\App\\app.exe" {projectPath}' }),
    );
    const preferences = getProjectBridge().loadExternalApplicationPreferences();
    expect(preferences.defaultApplicationId).toBe("legacy-custom-editor");
    expect(preferences.applications.at(-1)).toMatchObject({
      kind: "custom",
      command: '"C:\\Program Files\\App\\app.exe" {projectPath}',
      enabled: true,
    });
  });

  it("preserves valid built-in edits and normalizes invalid entries, duplicates, and a disabled default", () => {
    storage.values.set(
      preferencesKey,
      JSON.stringify({
        schemaVersion: 1,
        defaultApplicationId: "cursor",
        applications: [
          { id: "vscode", name: "changed", kind: "custom", command: "bad", enabled: true },
          { id: "cursor", name: "changed", kind: "cursor", command: "bad", enabled: false },
          { id: "tool", name: "Tool", kind: "custom", command: "tool {path}", enabled: true },
          { id: "tool", name: "Duplicate", kind: "custom", command: "duplicate", enabled: true },
          { id: "empty", name: "", kind: "custom", command: "", enabled: true },
        ],
      }),
    );

    expect(getProjectBridge().loadExternalApplicationPreferences()).toEqual({
      schemaVersion: 2,
      mode: "manual",
      defaultApplicationId: "vscode",
      applications: [
        defaults.applications[0],
        { ...defaults.applications[1], name: "changed", command: "bad", enabled: false, launchMode: "command" },
        { id: "tool", name: "Tool", kind: "custom", command: "tool {path}", enabled: true, launchMode: "command" },
      ],
    });
  });

  it("prefers the new key and round-trips only normalized data", () => {
    storage.values.set(preferencesKey, JSON.stringify({ ...defaults, defaultApplicationId: "cursor" }));
    storage.values.set(localLegacyKey, JSON.stringify({ kind: "vscode", customCommand: "" }));
    expect(getProjectBridge().loadExternalApplicationPreferences().defaultApplicationId).toBe("cursor");

    getProjectBridge().saveExternalApplicationPreferences({
      schemaVersion: 2,
      mode: "manual",
      defaultApplicationId: "missing",
      applications: defaults.applications.map((application) => ({ ...application, enabled: false })),
    });
    expect(getProjectBridge().loadExternalApplicationPreferences()).toEqual({
      ...defaults,
      mode: "manual",
      applications: [defaults.applications[0], { ...defaults.applications[1], enabled: false }],
    });
    expect(storage.values.has(localLegacyKey)).toBe(true);
  });

  it("does not fall through from an explicitly present empty key", () => {
    storage.values.set(preferencesKey, "");
    storage.values.set(sharedLegacyKey, JSON.stringify({ kind: "cursor", customCommand: "" }));
    expect(getProjectBridge().loadExternalApplicationPreferences()).toEqual(defaults);

    storage.values.delete(preferencesKey);
    storage.values.set(localLegacyKey, "");
    expect(getProjectBridge().loadExternalApplicationPreferences()).toEqual(defaults);
  });

  it("protects the default and keeps explicit launch selection temporary", async () => {
    const preferences: ExternalApplicationPreferences = {
      ...defaults,
      mode: "manual",
      applications: [
        ...defaults.applications,
        { id: "tool", name: "Tool", kind: "custom", command: "tool {path}", enabled: true, launchMode: "command" },
      ],
    };
    const saveExternalApplicationPreferences = vi.fn<ProjectBridge["saveExternalApplicationPreferences"]>();
    const openExternalApplication = vi.fn<ProjectBridge["openExternalApplication"]>(async (payload) => ({
      launched: true,
      command: payload.application.command,
      cwd: payload.projectPath,
      applicationId: payload.application.id,
      kind: payload.application.kind,
      code: "launched",
    }));
    window.projectBridge = {
      ...getProjectBridge(),
      loadExternalApplicationPreferences: () => structuredClone(preferences),
      saveExternalApplicationPreferences,
      openExternalApplication,
      pathExists: async () => true,
    };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project: Project = {
      id: "project",
      name: "Project",
      path: "C:\\project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [],
      env: {},
      pathExists: true,
    };
    store.projects = [project];

    expect(store.updateExternalApplication("vscode", "Visual Studio Code", 'code --reuse-window "{path}"')).toBe(true);
    expect(store.setExternalApplicationEnabled("vscode", false)).toBe(false);
    expect(store.deleteExternalApplication("vscode")).toBe(false);
    expect(store.setDefaultExternalApplication("tool")).toBe(true);
    expect(store.setExternalApplicationEnabled("vscode", false)).toBe(true);
    expect(store.deleteExternalApplication("tool")).toBe(false);

    await store.openProjectInEditor(project.id);
    expect(openExternalApplication.mock.calls.at(-1)?.[0].application.id).toBe("tool");
    expect(store.externalApplicationPreferences.defaultApplicationId).toBe("tool");

    expect(store.setExternalApplicationEnabled("vscode", true)).toBe(true);
    await store.openProjectInEditor(project.id, "vscode");
    expect(openExternalApplication.mock.calls.at(-1)?.[0].application.id).toBe("vscode");
    expect(openExternalApplication.mock.calls.at(-1)?.[0].application.command).toBe('code --reuse-window "{path}"');
    expect(store.externalApplicationPreferences.defaultApplicationId).toBe("tool");
    expect(saveExternalApplicationPreferences).toHaveBeenCalledTimes(4);
  });

  it("keeps the automatic candidate order when no editor is explicitly selected", async () => {
    const openExternalApplication = vi.fn<ProjectBridge["openExternalApplication"]>(async (payload) => ({
      launched: true,
      command: payload.application.command,
      cwd: payload.projectPath,
      applicationId: payload.application.id,
      kind: payload.application.kind,
      code: "launched",
    }));
    window.projectBridge = {
      ...getProjectBridge(),
      loadExternalApplicationPreferences: () => structuredClone(defaults),
      openExternalApplication,
      pathExists: async () => true,
    };
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [{
      id: "automatic-project",
      name: "Automatic Project",
      path: "C:\\automatic-project",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [],
      env: {},
      pathExists: true,
    }];

    await store.openProjectInEditor("automatic-project");

    expect(openExternalApplication).toHaveBeenCalledWith(expect.objectContaining({
      mode: "auto",
      application: expect.objectContaining({ id: "vscode" }),
      applications: expect.arrayContaining([
        expect.objectContaining({ id: "vscode" }),
        expect.objectContaining({ id: "cursor" }),
      ]),
    }));
  });
});

describe("uTools preload external application preferences", () => {
  it("persists terminal preferences across a uTools restart and migrates v1 storage", () => {
    const dbStorage = createDbStorage();
    const legacyPreferences = { kind: "powershell", customCommand: "" };
    dbStorage.values.set(terminalPreferencesV1Key, legacyPreferences);

    const preferences = loadPreloadBridge(createStorage().api, {}, dbStorage.api).loadTerminalPreferences();
    expect(preferences).toEqual({ schemaVersion: 2, mode: "manual", kind: "powershell", customCommand: "" });
    expect(dbStorage.values.get(terminalPreferencesV2Key)).toEqual(preferences);

    const restartedBridge = loadPreloadBridge(createStorage().api, {}, dbStorage.api);
    expect(restartedBridge.loadTerminalPreferences()).toEqual(preferences);
  });

  it("migrates renderer v2 terminal preferences before an older host preference", () => {
    const rendererStorage = createStorage();
    const dbStorage = createDbStorage();
    const preferences = { schemaVersion: 2, mode: "manual", kind: "cmd", customCommand: "" };
    rendererStorage.values.set(terminalPreferencesV2Key, JSON.stringify(preferences));
    dbStorage.values.set(terminalPreferencesV1Key, { kind: "powershell", customCommand: "" });

    expect(loadPreloadBridge(rendererStorage.api, {}, dbStorage.api).loadTerminalPreferences()).toEqual(preferences);
    expect(dbStorage.values.get(terminalPreferencesV2Key)).toEqual(preferences);

    const restartedBridge = loadPreloadBridge(createStorage().api, {}, dbStorage.api);
    expect(restartedBridge.loadTerminalPreferences()).toEqual(preferences);
  });

  it("persists across a uTools restart and migrates the renderer-local preference", () => {
    const rendererStorage = createStorage();
    const dbStorage = createDbStorage();
    const preferences: ExternalApplicationPreferences = {
      schemaVersion: 2,
      mode: "manual",
      defaultApplicationId: "tool",
      applications: [
        ...defaults.applications,
        { id: "tool", name: "Tool", kind: "custom", command: "tool {path}", enabled: true, launchMode: "command" },
      ],
    };
    rendererStorage.values.set(preferencesKey, JSON.stringify(preferences));

    expect(loadPreloadBridge(rendererStorage.api, {}, dbStorage.api).loadExternalApplicationPreferences()).toEqual(
      preferences,
    );
    expect(dbStorage.values.get(preferencesKey)).toEqual(preferences);

    const restartedBridge = loadPreloadBridge(createStorage().api, {}, dbStorage.api);
    expect(restartedBridge.loadExternalApplicationPreferences()).toEqual(preferences);
  });

  it("migrates renderer v2 external application preferences before an older host preference", () => {
    const rendererStorage = createStorage();
    const dbStorage = createDbStorage();
    const preferences: ExternalApplicationPreferences = {
      schemaVersion: 2,
      mode: "manual",
      defaultApplicationId: "tool",
      applications: [
        ...defaults.applications,
        { id: "tool", name: "Tool", kind: "custom", command: "tool {path}", enabled: true, launchMode: "command" },
      ],
    };
    rendererStorage.values.set(preferencesKey, JSON.stringify(preferences));
    dbStorage.values.set(externalApplicationPreferencesV1Key, { ...defaults, mode: "manual", defaultApplicationId: "cursor" });
    rendererStorage.values.set(externalApplicationPreferencesV1Key, JSON.stringify({ ...defaults, mode: "manual", defaultApplicationId: "cursor" }));

    expect(loadPreloadBridge(rendererStorage.api, {}, dbStorage.api).loadExternalApplicationPreferences()).toEqual(
      preferences,
    );
    expect(dbStorage.values.get(preferencesKey)).toEqual(preferences);
    expect(dbStorage.values.has(externalApplicationPreferencesV1Key)).toBe(false);
    expect(rendererStorage.values.has(externalApplicationPreferencesV1Key)).toBe(false);

    const restartedBridge = loadPreloadBridge(createStorage().api, {}, dbStorage.api);
    expect(restartedBridge.loadExternalApplicationPreferences()).toEqual(preferences);
  });

  it("keeps the external application V1 key when V2 persistence fails", () => {
    const dbStorage = createDbStorage({ failExternalApplicationV2Write: true });
    const legacyPreferences: ExternalApplicationPreferences = { ...defaults, mode: "manual", defaultApplicationId: "cursor" };
    dbStorage.values.set(externalApplicationPreferencesV1Key, legacyPreferences);

    expect(loadPreloadBridge(createStorage().api, {}, dbStorage.api).loadExternalApplicationPreferences()).toEqual(
      legacyPreferences,
    );
    expect(dbStorage.values.get(externalApplicationPreferencesV1Key)).toEqual(legacyPreferences);
    expect(dbStorage.values.has(preferencesKey)).toBe(false);
  });

  it("matches browser migration and normalization", () => {
    const storage = createStorage();
    storage.values.set(localLegacyKey, JSON.stringify({ kind: "cursor", customCommand: "" }));
    const bridge = loadPreloadBridge(storage.api);
    expect(bridge.loadExternalApplicationPreferences()).toEqual({ ...defaults, mode: "manual", defaultApplicationId: "cursor" });

    bridge.saveExternalApplicationPreferences({
      schemaVersion: 2,
      mode: "manual",
      defaultApplicationId: "missing",
      applications: [],
    });
    expect(bridge.loadExternalApplicationPreferences()).toEqual({ ...defaults, mode: "manual" });
  });

  it("does not fall through from an explicitly present empty key", () => {
    const storage = createStorage();
    storage.values.set(preferencesKey, "");
    storage.values.set(sharedLegacyKey, JSON.stringify({ kind: "cursor", customCommand: "" }));
    const bridge = loadPreloadBridge(storage.api);
    expect(bridge.loadExternalApplicationPreferences()).toEqual(defaults);
  });

  it("preserves valid built-in edits and normalizes damaged collections at the real preload boundary", () => {
    const storage = createStorage();
    storage.values.set(
      preferencesKey,
      JSON.stringify({
        schemaVersion: 1,
        defaultApplicationId: "cursor",
        applications: [
          { id: "vscode", name: "changed", kind: "custom", command: "bad", enabled: false },
          { id: "cursor", name: "changed", kind: "cursor", command: "bad", enabled: false },
          { id: "tool", name: "Tool", kind: "custom", command: "tool {path}", enabled: true },
          { id: "tool", name: "Duplicate", kind: "custom", command: "duplicate", enabled: true },
        ],
      }),
    );
    expect(loadPreloadBridge(storage.api).loadExternalApplicationPreferences()).toEqual({
      schemaVersion: 2,
      mode: "manual",
      defaultApplicationId: "tool",
      applications: [
        { ...defaults.applications[0], enabled: false },
        { ...defaults.applications[1], name: "changed", command: "bad", enabled: false, launchMode: "command" },
        { id: "tool", name: "Tool", kind: "custom", command: "tool {path}", enabled: true, launchMode: "command" },
      ],
    });
  });

  it("launches editable application templates with a resolved host launcher and rejects reserved id mismatches", async () => {
    const nodeRequire = createRequire(import.meta.url);
    const child = { once: vi.fn(), unref: vi.fn() };
    child.once.mockImplementation((event: string, listener: () => void) => {
      if (event === "spawn") listener();
      return child;
    });
    const spawn = vi.fn(
      (_executable: string, _args: string[], _options: { cwd: string; detached: boolean; stdio: string; env?: NodeJS.ProcessEnv }) => child,
    );
    const bridge = loadPreloadBridge(createStorage().api, {
      child_process: { ...nodeRequire("child_process"), spawn },
    });
    const projectPath = resolve(".");

    const builtinResult = await bridge.openExternalApplication({
      projectPath,
      application: {
        id: "vscode",
        name: "Visual Studio Code",
        kind: "vscode",
        command: 'code --reuse-window "{path}"',
        enabled: true,
        launchMode: "command",
      },
    });
    expect(builtinResult.launched).toBe(true);
    const [builtinExecutable, builtinArgs, builtinOptions] = spawn.mock.calls[0]!;
    expect(builtinExecutable).toEqual(expect.any(String));
    expect(builtinOptions).toMatchObject({ cwd: projectPath, detached: true, stdio: "ignore" });
    if (builtinOptions.env) {
      expect(builtinArgs).toEqual(expect.arrayContaining(["/d", "/v:off", "/s", "/c"]));
      expect(builtinOptions.env.UTOOLS_PROJECT_LAUNCH_ARGUMENT_1).toBe(projectPath);
    } else {
      expect(builtinArgs).toEqual(expect.arrayContaining(["--reuse-window", projectPath]));
    }

    const result = await bridge.openExternalApplication({
      projectPath,
      application: {
        id: "custom-tool",
        name: "Custom Tool",
        kind: "custom",
        command: '"C:\\Program Files\\Tool\\tool.exe" --target "{path}" --compat "{projectPath}"',
        enabled: true,
      },
    });
    expect(result.launched).toBe(true);
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "C:\\Program Files\\Tool\\tool.exe",
      ["--target", projectPath, "--compat", projectPath],
      { cwd: projectPath, detached: true, stdio: "ignore" },
    );

    const invalidResult = await bridge.openExternalApplication({
      projectPath,
      application: { id: "vscode", name: "Imposter", kind: "custom", command: "tool {path}", enabled: true },
    });
    expect(invalidResult.launched).toBe(false);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
