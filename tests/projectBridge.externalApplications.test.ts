import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import type { ProjectBridge } from "../src/types";

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

const createDbStorage = () => {
  const values = new Map<string, unknown>();
  return {
    values,
    api: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: unknown) => {
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
