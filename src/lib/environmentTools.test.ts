import { createPinia, setActivePinia } from "pinia";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectBridge } from "./projectBridge";
import {
  environmentToolRequest,
  formatEnvironmentArguments,
  parseEnvironmentArguments,
  validateCustomEnvironmentToolInput,
} from "./environmentTools";
import type { EnvironmentPreferences, EnvironmentToolRequest, EnvironmentToolResult, ProjectBridge } from "../types";

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const resultFor = (request: EnvironmentToolRequest): EnvironmentToolResult => ({
  key: request.kind === "custom" ? request.id : request.key,
  name: request.kind === "custom" ? request.name : request.key,
  status: "available",
  version: "1.0.0",
  executablePath: "C:\\tools\\tool.exe",
  checkedAt: "2026-07-20T10:00:00.000Z",
});

const stubWindow = (storedEnvironment: unknown = null) => {
  const storage = new Map<string, string>();
  if (storedEnvironment !== null) {
    storage.set("utools-project-launch.environment-settings.v1", JSON.stringify(storedEnvironment));
  }
  vi.stubGlobal("window", {
    navigator: { platform: "Win32", userAgent: "vitest" },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    },
    projectBridge: undefined,
  });
};

describe("environment tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("parses quoted arguments and rejects shell operators", () => {
    expect(parseEnvironmentArguments('--version "long value"')).toEqual(["--version", "long value"]);
    expect(parseEnvironmentArguments(formatEnvironmentArguments(["--path", "C:\\Program Files\\Java"]))).toEqual([
      "--path",
      "C:\\Program Files\\Java",
    ]);
    expect(parseEnvironmentArguments('"unfinished')).toBeNull();
    expect(
      validateCustomEnvironmentToolInput({ name: "Java", command: "java", versionArgs: ["-version"] }).errors,
    ).toEqual({});
    expect(
      validateCustomEnvironmentToolInput({ name: "Bad", command: "java & whoami", versionArgs: [] }).errors,
    ).toEqual({ command: "unsafe" });
  });

  it("normalizes old preferences, preserves an explicit empty built-in list, and filters invalid custom tools", () => {
    stubWindow({
      enabledToolKeys: [],
      customTools: [
        { id: "custom-java", name: "Java", command: "java", versionArgs: ["-version"], enabled: true },
        { id: "bad", name: "Bad", command: "java | more", versionArgs: [], enabled: true },
      ],
      builtinOverrides: [
        { key: "python", command: "py", versionArgs: ["--version"] },
        { key: "git", command: "git & whoami", versionArgs: ["--version"] },
        { key: "unknown", command: "tool", versionArgs: ["--version"] },
      ],
    });

    const bridge = getProjectBridge();
    const preferences: EnvironmentPreferences = {
      enabledToolKeys: [],
      customTools: [{ id: "custom-java", name: "Java", command: "java", versionArgs: ["-version"], enabled: true }],
      builtinOverrides: [{ key: "python", command: "py", versionArgs: ["--version"] }],
    };
    expect(bridge.loadEnvironmentPreferences()).toEqual(preferences);

    bridge.saveEnvironmentPreferences(preferences);
    expect(bridge.loadEnvironmentPreferences()).toEqual(preferences);
  });

  it("builds trusted built-in and validated override requests separately", () => {
    expect(environmentToolRequest("node", [], [])).toEqual({ kind: "builtin", key: "node" });
    expect(environmentToolRequest("python", [], [{ key: "python", command: "py", versionArgs: ["-V"] }])).toEqual({
      kind: "builtin-override",
      key: "python",
      command: "py",
      versionArgs: ["-V"],
    });
    expect(
      environmentToolRequest("python", [], [{ key: "python", command: "py & whoami", versionArgs: ["-V"] }]),
    ).toBeNull();
  });

  it("publishes out-of-order results immediately, isolates failures, and runs at most four requests", async () => {
    stubWindow();
    const pending = new Map<string, ReturnType<typeof deferred<EnvironmentToolResult>>>();
    const detectEnvironmentTool = vi.fn<ProjectBridge["detectEnvironmentTool"]>((request) => {
      const operation = deferred<EnvironmentToolResult>();
      pending.set(request.kind === "custom" ? request.id : request.key, operation);
      return operation.promise;
    });
    const fallback = getProjectBridge();
    window.projectBridge = {
      ...fallback,
      loadEnvironmentPreferences: () => ({
        enabledToolKeys: ["node", "npm", "pnpm", "yarn", "docker"],
        customTools: [],
        builtinOverrides: [],
      }),
      detectEnvironmentTool,
    };
    const { useStore } = await import("../store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    const refresh = store.refreshEnvironmentTools();
    expect(detectEnvironmentTool).toHaveBeenCalledTimes(4);
    pending.get("npm")!.resolve(resultFor({ kind: "builtin", key: "npm" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.environmentResults.map((result) => result.key)).toEqual(["npm"]);
    expect(store.environmentRefreshingKeys.npm).toBe(false);
    expect(detectEnvironmentTool).toHaveBeenCalledTimes(5);

    pending.get("pnpm")!.reject(new Error("pnpm failed"));
    pending.get("node")!.resolve(resultFor({ kind: "builtin", key: "node" }));
    pending.get("yarn")!.resolve(resultFor({ kind: "builtin", key: "yarn" }));
    pending.get("docker")!.resolve(resultFor({ kind: "builtin", key: "docker" }));
    await refresh;

    expect(store.environmentResults).toHaveLength(5);
    expect(store.environmentResults.find((result) => result.key === "pnpm")).toMatchObject({
      status: "error",
      error: "pnpm failed",
    });
    expect(store.environmentRefreshing).toBe(false);
  });

  it.each(["edit", "disable", "delete"] as const)("drops a late result after a custom tool is %s", async (change) => {
    stubWindow();
    const operation = deferred<EnvironmentToolResult>();
    const fallback = getProjectBridge();
    window.projectBridge = {
      ...fallback,
      loadEnvironmentPreferences: () => ({
        enabledToolKeys: [],
        customTools: [{ id: "custom-java", name: "Java", command: "java", versionArgs: ["-version"], enabled: true }],
        builtinOverrides: [],
      }),
      detectEnvironmentTool: () => operation.promise,
    };
    const { useStore } = await import("../store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    const refresh = store.refreshEnvironmentTools(["custom-java"]);
    if (change === "edit") {
      store.updateCustomEnvironmentTool("custom-java", {
        name: "Java 2",
        command: "java2",
        versionArgs: ["--version"],
      });
    } else if (change === "disable") {
      store.setCustomEnvironmentToolEnabled("custom-java", false);
    } else {
      store.deleteCustomEnvironmentTool("custom-java");
    }
    operation.resolve({
      key: "custom-java",
      name: "Java",
      status: "available",
      version: "old",
      executablePath: "old-java.exe",
      checkedAt: "2026-07-20T10:00:00.000Z",
    });
    await refresh;

    expect(store.environmentResults).toEqual([]);
    expect(store.environmentRefreshingKeys["custom-java"]).toBe(false);
  });

  it("does not start a queued custom request after it is disabled", async () => {
    stubWindow();
    const pending = new Map<string, ReturnType<typeof deferred<EnvironmentToolResult>>>();
    const detectEnvironmentTool = vi.fn<ProjectBridge["detectEnvironmentTool"]>((request) => {
      const operation = deferred<EnvironmentToolResult>();
      pending.set(request.kind === "custom" ? request.id : request.key, operation);
      return operation.promise;
    });
    const fallback = getProjectBridge();
    window.projectBridge = {
      ...fallback,
      loadEnvironmentPreferences: () => ({
        enabledToolKeys: ["node", "npm", "pnpm", "yarn"],
        customTools: [{ id: "custom-java", name: "Java", command: "java", versionArgs: ["-version"], enabled: true }],
        builtinOverrides: [],
      }),
      detectEnvironmentTool,
    };
    const { useStore } = await import("../store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    const refresh = store.refreshEnvironmentTools();
    expect(detectEnvironmentTool).toHaveBeenCalledTimes(4);
    store.setCustomEnvironmentToolEnabled("custom-java", false);
    pending.get("node")!.resolve(resultFor({ kind: "builtin", key: "node" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(detectEnvironmentTool).toHaveBeenCalledTimes(4);
    for (const key of ["npm", "pnpm", "yarn"]) {
      pending.get(key)!.resolve(resultFor({ kind: "builtin", key: key as "npm" | "pnpm" | "yarn" }));
    }
    await refresh;
  });

  it("keeps the newer result when refreshes for the same key finish out of order", async () => {
    stubWindow();
    const operations = [deferred<EnvironmentToolResult>(), deferred<EnvironmentToolResult>()];
    const fallback = getProjectBridge();
    window.projectBridge = {
      ...fallback,
      loadEnvironmentPreferences: () => ({ enabledToolKeys: ["node"], customTools: [], builtinOverrides: [] }),
      detectEnvironmentTool: vi
        .fn<ProjectBridge["detectEnvironmentTool"]>()
        .mockReturnValueOnce(operations[0]!.promise)
        .mockReturnValueOnce(operations[1]!.promise),
    };
    const { useStore } = await import("../store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    const olderRefresh = store.refreshEnvironmentTools(["node"]);
    const newerRefresh = store.refreshEnvironmentTools(["node"]);
    operations[1]!.resolve({ ...resultFor({ kind: "builtin", key: "node" }), version: "new" });
    await newerRefresh;

    expect(store.environmentResults[0]?.version).toBe("new");
    expect(store.environmentRefreshing).toBe(true);

    operations[0]!.resolve({ ...resultFor({ kind: "builtin", key: "node" }), version: "old" });
    await olderRefresh;

    expect(store.environmentResults[0]?.version).toBe("new");
    expect(store.environmentRefreshing).toBe(false);
  });

  it("saves and restores an override while invalidating its current result", async () => {
    stubWindow();
    const fallback = getProjectBridge();
    const saveEnvironmentPreferences = vi.fn<ProjectBridge["saveEnvironmentPreferences"]>();
    window.projectBridge = {
      ...fallback,
      loadEnvironmentPreferences: () => ({ enabledToolKeys: ["python"], customTools: [], builtinOverrides: [] }),
      saveEnvironmentPreferences,
    };
    const { useStore } = await import("../store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.environmentResults = [resultFor({ kind: "builtin", key: "python" })];

    expect(store.saveBuiltinEnvironmentToolOverride("python", { command: "py", versionArgs: ["-V"] })).toMatchObject({
      ok: true,
      override: { key: "python", command: "py", versionArgs: ["-V"] },
    });
    expect(store.environmentResults).toEqual([]);
    expect(store.environmentPreferences.builtinOverrides).toEqual([
      { key: "python", command: "py", versionArgs: ["-V"] },
    ]);

    store.restoreBuiltinEnvironmentTool("python");
    expect(store.environmentPreferences.builtinOverrides).toEqual([]);
    expect(saveEnvironmentPreferences).toHaveBeenCalledTimes(2);
  });

  it("does not start a queued built-in override after it is restored", async () => {
    stubWindow();
    const pending = new Map<string, ReturnType<typeof deferred<EnvironmentToolResult>>>();
    const detectEnvironmentTool = vi.fn<ProjectBridge["detectEnvironmentTool"]>((request) => {
      const operation = deferred<EnvironmentToolResult>();
      pending.set(request.kind === "custom" ? request.id : request.key, operation);
      return operation.promise;
    });
    const fallback = getProjectBridge();
    window.projectBridge = {
      ...fallback,
      loadEnvironmentPreferences: () => ({
        enabledToolKeys: ["node", "npm", "pnpm", "yarn", "python"],
        customTools: [],
        builtinOverrides: [{ key: "python", command: "py", versionArgs: ["-V"] }],
      }),
      detectEnvironmentTool,
    };
    const { useStore } = await import("../store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    const refresh = store.refreshEnvironmentTools();
    expect(detectEnvironmentTool).toHaveBeenCalledTimes(4);
    store.restoreBuiltinEnvironmentTool("python");
    pending.get("node")!.resolve(resultFor({ kind: "builtin", key: "node" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(detectEnvironmentTool).toHaveBeenCalledTimes(4);
    for (const key of ["npm", "pnpm", "yarn"] as const) {
      pending.get(key)!.resolve(resultFor({ kind: "builtin", key }));
    }
    await refresh;
  });

  it.runIf(process.platform === "win32")(
    "detects validated Windows command shims through the real preload",
    async () => {
      const fixtureDirectory = mkdtempSync(join(tmpdir(), "utools-environment-shim-"));
      const fixtureCommand = "utools-environment-shim-test";
      const fixtureShellPath = join(fixtureDirectory, fixtureCommand);
      const fixturePath = join(fixtureDirectory, `${fixtureCommand}.cmd`);
      const originalPath = process.env.PATH;
      writeFileSync(fixtureShellPath, "#!/bin/sh\necho should-not-run\n", "utf8");
      writeFileSync(
        fixturePath,
        '@echo off\r\nif "%~1"=="-v" (\r\n  echo 9.8.7\r\n  exit /b 0\r\n)\r\nexit /b 2\r\n',
        "utf8",
      );
      process.env.PATH = `${fixtureDirectory};${originalPath || ""}`;

      try {
        const nodeRequire = createRequire(import.meta.url);
        const sandboxWindow: { projectBridge?: ProjectBridge } = {};
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
        const preloadBridge = sandboxWindow.projectBridge;
        expect(preloadBridge).toBeDefined();
        if (!preloadBridge) throw new Error("The real preload did not register projectBridge.");

        const result = await preloadBridge.detectEnvironmentTool({
          kind: "custom",
          id: "custom-shim",
          name: "Command Shim",
          command: fixtureCommand,
          versionArgs: ["-v"],
        });
        expect(result).toMatchObject({ status: "available", version: "9.8.7" });
        expect(resolve(result.executablePath).toLowerCase()).toBe(resolve(fixturePath).toLowerCase());

        const unsafeResult = await preloadBridge.detectEnvironmentTool({
          kind: "custom",
          id: "unsafe-shim",
          name: "Unsafe Shim",
          command: fixtureCommand,
          versionArgs: ["%PATH%"],
        });
        expect(unsafeResult).toMatchObject({
          status: "missing",
          error: "Windows command shim contains unsupported shell characters.",
        });
      } finally {
        process.env.PATH = originalPath;
        rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    },
  );
});
