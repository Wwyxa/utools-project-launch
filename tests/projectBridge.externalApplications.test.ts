import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { getProjectBridge } from "../src/lib/projectBridge";
import { ProjectStatus } from "../src/types";
import type { ExternalApplicationPreferences, Project, ProjectBridge } from "../src/types";

const preferencesKey = "utools-project-launch.local-external-applications.v1";
const localLegacyKey = "utools-project-launch.local-editor-settings.v1";
const sharedLegacyKey = "utools-project-launch.editor-settings.v1";
const terminalPreferencesKey = "utools-project-launch.local-settings.v1";
const terminalLegacyPreferencesKey = "utools-project-launch.settings.v1";

const defaults: ExternalApplicationPreferences = {
  schemaVersion: 1,
  defaultApplicationId: "vscode",
  applications: [
    { id: "vscode", name: "VS Code", kind: "vscode", command: "code {path}", enabled: true },
    { id: "cursor", name: "Cursor", kind: "cursor", command: "cursor {path}", enabled: true },
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

const createDbStorage = (options: { failExternalApplicationWrite?: boolean } = {}) => {
  const values = new Map<string, unknown>();
  return {
    values,
    api: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: unknown) => {
        if (options.failExternalApplicationWrite && key === preferencesKey) {
          throw new Error("Unable to persist external application preferences.");
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
  environment: Record<string, string> = {},
) => {
  const nodeRequire = createRequire(import.meta.url);
  const sandboxWindow: { projectBridge?: ProjectBridge; localStorage: typeof storage; utools: { dbStorage: object } } =
    {
      localStorage: storage,
      utools: { dbStorage },
    };
  const sandbox = {
    require: (id: string) => (id === "electron" ? { shell: {} } : (moduleOverrides[id] ?? nodeRequire(id))),
    process: {
      platform: process.platform,
      env: { ...process.env, ...environment },
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

  it("preserves the published external application V1 key", () => {
    const publishedPreferences = { ...defaults, defaultApplicationId: "cursor" };
    storage.values.set(preferencesKey, JSON.stringify(publishedPreferences));

    expect(getProjectBridge().loadExternalApplicationPreferences()).toEqual(publishedPreferences);
    expect(JSON.parse(storage.values.get(preferencesKey)!)).toEqual(publishedPreferences);
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
      schemaVersion: 1,
      defaultApplicationId: "vscode",
      applications: [
        defaults.applications[0],
        { ...defaults.applications[1], name: "changed", command: "bad", enabled: false },
        { id: "tool", name: "Tool", kind: "custom", command: "tool {path}", enabled: true },
      ],
    });
  });

  it("prefers the current V1 key and round-trips only normalized data", () => {
    storage.values.set(preferencesKey, JSON.stringify({ ...defaults, defaultApplicationId: "cursor" }));
    storage.values.set(localLegacyKey, JSON.stringify({ kind: "vscode", customCommand: "" }));
    expect(getProjectBridge().loadExternalApplicationPreferences().defaultApplicationId).toBe("cursor");

    getProjectBridge().saveExternalApplicationPreferences({
      schemaVersion: 1,
      defaultApplicationId: "missing",
      applications: defaults.applications.map((application) => ({ ...application, enabled: false })),
    });
    expect(getProjectBridge().loadExternalApplicationPreferences()).toEqual({
      ...defaults,
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
      applications: [
        ...defaults.applications,
        {
          id: "custom_20260806",
          name: "Custom Editor",
          kind: "custom",
          command: "tool {path}",
          enabled: true,
        },
      ],
    };
    const saveExternalApplicationPreferences = vi.fn<ProjectBridge["saveExternalApplicationPreferences"]>();
    const openExternalApplication = vi.fn<ProjectBridge["openExternalApplication"]>(async (payload) => ({
      launched: true,
      command: payload.application.command,
      cwd: payload.projectPath,
      applicationId: payload.application.id,
      resolvedApplicationId: payload.application.id,
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
    const { activeActionStatus } = await import("../src/components/common/actionStatus");
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
    expect(store.setDefaultExternalApplication("custom_20260806")).toBe(true);
    expect(store.setExternalApplicationEnabled("vscode", false)).toBe(true);
    expect(store.deleteExternalApplication("custom_20260806")).toBe(false);

    await store.openProjectInEditor(project.id);
    expect(openExternalApplication.mock.calls.at(-1)?.[0].application.id).toBe("custom_20260806");
    expect(activeActionStatus.value?.message).toContain("Custom Editor");
    expect(activeActionStatus.value?.message).not.toContain("custom_20260806");
    expect(store.externalApplicationPreferences.defaultApplicationId).toBe("custom_20260806");

    expect(store.setExternalApplicationEnabled("vscode", true)).toBe(true);
    await store.openProjectInEditor(project.id, "vscode");
    expect(openExternalApplication.mock.calls.at(-1)?.[0].application.id).toBe("vscode");
    expect(openExternalApplication.mock.calls.at(-1)?.[0].application.command).toBe('code --reuse-window "{path}"');
    expect(store.externalApplicationPreferences.defaultApplicationId).toBe("custom_20260806");
    expect(saveExternalApplicationPreferences).toHaveBeenCalledTimes(4);
  });

  it("opens only the configured default external application", async () => {
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
    store.projects = [
      {
        id: "manual-project",
        name: "Manual Project",
        path: "C:\\manual-project",
        type: "Custom",
        kind: "custom",
        status: ProjectStatus.STOPPED,
        scripts: [],
        env: {},
        pathExists: true,
      },
    ];

    await store.openProjectInEditor("manual-project");

    expect(openExternalApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        application: expect.objectContaining({ id: "vscode" }),
      }),
    );
    expect(openExternalApplication.mock.calls[0]?.[0]).not.toHaveProperty("mode");
    expect(openExternalApplication.mock.calls[0]?.[0]).not.toHaveProperty("applications");
  });
});

describe("uTools preload external application preferences", () => {
  const localDataDirEnv = "UTOOLS_PROJECT_LAUNCH_LOCAL_DATA_DIR";
  const legacyDataDirEnv = "UTOOLS_PROJECT_LAUNCH_LEGACY_DATA_DIR";

  const createMigrationFixture = () => {
    const localDataDirectory = mkdtempSync(join(tmpdir(), "utools-pl-extlocal-"));
    const legacyDataDirectory = mkdtempSync(join(tmpdir(), "utools-pl-extlegacy-"));
    const environment = {
      [localDataDirEnv]: localDataDirectory,
      [legacyDataDirEnv]: legacyDataDirectory,
    };
    const cleanup = () => {
      rmSync(localDataDirectory, { recursive: true, force: true });
      rmSync(legacyDataDirectory, { recursive: true, force: true });
    };
    return { environment, cleanup };
  };

  it("migrates terminal preferences from the legacy host key and persists them across a restart", async () => {
    const fixture = createMigrationFixture();
    try {
      const dbStorage = createDbStorage();
      const legacyPreferences = { kind: "powershell", customCommand: "" };
      dbStorage.values.set(terminalLegacyPreferencesKey, legacyPreferences);

      const bridge = loadPreloadBridge(createStorage().api, {}, dbStorage.api, fixture.environment);
      await expect(bridge.runMigration()).resolves.toMatchObject({ ok: true });
      expect(bridge.loadTerminalPreferences()).toEqual({ kind: "powershell", customCommand: "" });
      // Legacy data stays in place until data cleanup removes it.
      expect(dbStorage.values.has(terminalLegacyPreferencesKey)).toBe(true);

      const restartedBridge = loadPreloadBridge(createStorage().api, {}, createDbStorage().api, fixture.environment);
      expect(restartedBridge.loadTerminalPreferences()).toEqual({ kind: "powershell", customCommand: "" });
    } finally {
      fixture.cleanup();
    }
  });

  it("prefers the released local terminal key over the older host key during migration", async () => {
    const fixture = createMigrationFixture();
    try {
      const rendererStorage = createStorage();
      const dbStorage = createDbStorage();
      const preferences = { kind: "cmd", customCommand: "" };
      rendererStorage.values.set(terminalPreferencesKey, JSON.stringify(preferences));
      dbStorage.values.set(terminalLegacyPreferencesKey, { kind: "powershell", customCommand: "" });

      const bridge = loadPreloadBridge(rendererStorage.api, {}, dbStorage.api, fixture.environment);
      await bridge.runMigration();
      expect(bridge.loadTerminalPreferences()).toEqual(preferences);
    } finally {
      fixture.cleanup();
    }
  });

  it("migrates external application preferences from the legacy renderer key", async () => {
    const fixture = createMigrationFixture();
    try {
      const rendererStorage = createStorage();
      const preferences: ExternalApplicationPreferences = {
        schemaVersion: 1,
        defaultApplicationId: "tool",
        applications: [
          ...defaults.applications,
          { id: "tool", name: "Tool", kind: "custom", command: "tool {path}", enabled: true },
        ],
      };
      rendererStorage.values.set(preferencesKey, JSON.stringify(preferences));

      const bridge = loadPreloadBridge(rendererStorage.api, {}, createDbStorage().api, fixture.environment);
      await bridge.runMigration();
      expect(bridge.loadExternalApplicationPreferences()).toEqual(preferences);

      const restartedBridge = loadPreloadBridge(createStorage().api, {}, createDbStorage().api, fixture.environment);
      expect(restartedBridge.loadExternalApplicationPreferences()).toEqual(preferences);
    } finally {
      fixture.cleanup();
    }
  });

  it("migrates a legacy editor configuration into external application preferences", async () => {
    const fixture = createMigrationFixture();
    try {
      const storage = createStorage();
      storage.values.set(
        localLegacyKey,
        JSON.stringify({ kind: "custom", customCommand: '"C:\\Program Files\\App\\app.exe" {projectPath}' }),
      );
      const bridge = loadPreloadBridge(storage.api, {}, createDbStorage().api, fixture.environment);
      await bridge.runMigration();

      const preferences = bridge.loadExternalApplicationPreferences();
      expect(preferences.defaultApplicationId).toBe("legacy-custom-editor");
      expect(preferences.applications.at(-1)).toMatchObject({
        kind: "custom",
        command: '"C:\\Program Files\\App\\app.exe" {projectPath}',
        enabled: true,
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed when the local data directory is unavailable", () => {
    const bridge = loadPreloadBridge(createStorage().api, {}, createDbStorage().api, {
      [localDataDirEnv]: "",
      [legacyDataDirEnv]: "",
    });
    const result = bridge.saveExternalApplicationPreferences({ ...defaults, defaultApplicationId: "cursor" });
    expect(result.ok).toBe(false);
  });

  it("round-trips normalized preferences through the local state file", () => {
    const fixture = createMigrationFixture();
    try {
      const bridge = loadPreloadBridge(createStorage().api, {}, createDbStorage().api, fixture.environment);
      bridge.saveExternalApplicationPreferences({
        schemaVersion: 1,
        defaultApplicationId: "missing",
        applications: defaults.applications.map((application) => ({ ...application, enabled: false })),
      });
      expect(bridge.loadExternalApplicationPreferences()).toEqual({
        ...defaults,
        applications: [defaults.applications[0], { ...defaults.applications[1], enabled: false }],
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("launches editable application templates with a resolved host launcher and rejects reserved id mismatches", async () => {
    const fixture = createMigrationFixture();
    try {
      const nodeRequire = createRequire(import.meta.url);
      const child = { once: vi.fn(), unref: vi.fn() };
      child.once.mockImplementation((event: string, listener: () => void) => {
        if (event === "spawn") listener();
        return child;
      });
      const spawn = vi.fn(
        (
          _executable: string,
          _args: string[],
          _options: { cwd: string; detached: boolean; stdio: string; env?: NodeJS.ProcessEnv },
        ) => child,
      );
      const bridge = loadPreloadBridge(
        createStorage().api,
        { child_process: { ...nodeRequire("child_process"), spawn } },
        createDbStorage().api,
        fixture.environment,
      );
      const projectPath = resolve(".");

      const builtinResult = await bridge.openExternalApplication({
        projectPath,
        application: {
          id: "vscode",
          name: "Visual Studio Code",
          kind: "vscode",
          command: 'code --reuse-window "{path}"',
          enabled: true,
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

      const spoofedResult = await bridge.openExternalApplication({
        projectPath,
        application: { id: "spoofed", name: "Spoofed", kind: "vscode", command: "code {path}", enabled: true },
      });
      expect(spoofedResult).toMatchObject({ launched: false, code: "invalid-preference" });
      expect(spawn).toHaveBeenCalledTimes(2);

      const invalidResult = await bridge.openExternalApplication({
        projectPath,
        application: { id: "vscode", name: "Imposter", kind: "custom", command: "tool {path}", enabled: true },
      });
      expect(invalidResult.launched).toBe(false);
      expect(spawn).toHaveBeenCalledTimes(2);
    } finally {
      fixture.cleanup();
    }
  });
});
