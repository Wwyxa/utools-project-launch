import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import type { ProjectBridge } from "../src/types";

type Platform = "darwin" | "linux" | "win32";
type SpawnOutcome = "spawn" | "error";

interface PreloadFixture {
  directories?: string[];
  files?: string[];
  where?: Record<string, string | Buffer>;
  which?: Record<string, string | Buffer>;
  gitAsyncOutput?: (args: readonly string[]) => string | undefined;
  spawnOutcomes?: SpawnOutcome[];
  env?: Record<string, string>;
  serviceEnabled?: boolean;
}

const loadPreloadBridge = (platform: Platform, fixture: PreloadFixture) => {
  const nodeRequire = createRequire(import.meta.url);
  const spawnOutcomes = [...(fixture.spawnOutcomes || [])];
  const bridgeEvents: unknown[] = [];
  const runtimeRecordErrors: unknown[] = [];
  const bridgeEventTypes: string[] = [];
  const servicePreferenceStorage = new Map<string, unknown>();
  if (fixture.serviceEnabled !== undefined) {
    servicePreferenceStorage.set("utools-project-launch.project-launch-service.v1", {
      schemaVersion: 1,
      enabled: fixture.serviceEnabled,
    });
  }
  const spawn = vi.fn(
    (
      _executable: string,
      _args: string[],
      _options: { cwd: string; detached: boolean; stdio: string; env?: NodeJS.ProcessEnv; windowsVerbatimArguments?: boolean },
    ) => {
      const outcome = spawnOutcomes.shift() || "spawn";
      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      const createStream = () => {
        const streamListeners = new Map<string, Array<(...args: unknown[]) => void>>();
        const stream = {
          on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
            const eventListeners = streamListeners.get(event) || [];
            eventListeners.push(listener);
            streamListeners.set(event, eventListeners);
            return stream;
          }),
          emit: (event: string, ...args: unknown[]) => {
            streamListeners.get(event)?.forEach((listener) => listener(...args));
          },
          setEncoding: vi.fn(),
        };
        return stream;
      };
      const stdout = createStream();
      const stderr = createStream();
      const child = {
        pid: 4100 + spawn.mock.calls.length,
        stdin: { destroyed: false, writableEnded: false, write: vi.fn() },
        stdout,
        stderr,
        once: vi.fn(),
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          const eventListeners = listeners.get(event) || [];
          eventListeners.push(listener);
          listeners.set(event, eventListeners);
          return child;
        }),
        emit: (event: string, ...args: unknown[]) => {
          listeners.get(event)?.forEach((listener) => listener(...args));
        },
        kill: vi.fn(),
        unref: vi.fn(),
      };
      child.once.mockImplementation((event: string, listener: (error?: Error) => void) => {
        if (event === outcome) listener(event === "error" ? new Error("launch failed") : undefined);
        return child;
      });
      return child;
    },
  );
  const fs = {
    ...nodeRequire("fs"),
    readFileSync: (target: string, ...args: unknown[]) =>
      nodeRequire("fs").readFileSync(
        platform === "win32" && target.startsWith("public\\preload\\") ? target.replaceAll("\\", "/") : target,
        ...args,
      ),
    statSync: (target: string) => {
      if (fixture.directories?.includes(target)) return { isDirectory: () => true, isFile: () => false };
      if (fixture.files?.includes(target)) return { isDirectory: () => false, isFile: () => true };
      throw new Error("not found");
    },
  };
  const lookupResult = (command: string, args: string[]) =>
    platform === "win32" && command === "where.exe"
      ? fixture.where?.[args[0]!]
      : platform === "linux" && command === "which"
        ? fixture.which?.[args[0]!]
        : undefined;
  const execFileSync = vi.fn((command: string, args: string[]) => {
    const resolved = lookupResult(command, args);
    if (resolved) return Buffer.isBuffer(resolved) ? resolved : Buffer.from(`${resolved}\r\n`);
    throw new Error("not found");
  });
  const execFile = vi.fn(
    (
      command: string,
      args: string[],
      options: { encoding?: string },
      callback: (error: Error | null, stdout: string | Buffer) => void,
    ) => {
      const gitOutput = command === "git" ? fixture.gitAsyncOutput?.(args) : undefined;
      const resolved = gitOutput ?? lookupResult(command, args);
      queueMicrotask(() => {
        if (resolved === undefined) {
          callback(new Error("not found"), options.encoding === "utf8" ? "" : Buffer.alloc(0));
          return;
        }
        callback(
          null,
          Buffer.isBuffer(resolved)
            ? resolved
            : options.encoding === "utf8"
              ? `${resolved}\r\n`
              : Buffer.from(`${resolved}\r\n`),
        );
      });
    },
  );
  const childProcess = {
    ...nodeRequire("child_process"),
    spawn,
    execFile,
    execFileSync,
  };
  const sandboxWindow: {
    projectBridge?: ProjectBridge;
    localStorage: object;
    utools: { dbStorage: object };
    dispatchEvent: (event: { type?: string; detail?: unknown }) => boolean;
  } = {
    localStorage: { getItem: () => null, setItem: () => undefined },
    utools: {
      dbStorage: {
        getItem: (key: string) => servicePreferenceStorage.get(key) ?? null,
        setItem: (key: string, value: unknown) => servicePreferenceStorage.set(key, value),
      },
    },
    dispatchEvent: (event) => {
      if (event.detail && typeof event.detail === "object" && "type" in event.detail && event.detail.type === "runtime-record-error") {
        runtimeRecordErrors.push(event.detail);
        return true;
      }
      if (event.type) bridgeEventTypes.push(event.type);
      bridgeEvents.push(event.detail);
      return true;
    },
  };
  const sandbox = {
    require: (id: string) => {
      if (id === "electron") return { shell: {} };
      if (id === "fs") return fs;
      if (id === "path") return platform === "win32" ? nodeRequire("path").win32 : nodeRequire("path").posix;
      if (id === "child_process") return childProcess;
      return nodeRequire(id);
    },
    process: {
      platform,
      env: { ...(platform === "win32" ? { ComSpec: "C:\\Windows\\System32\\cmd.exe" } : {}), ...fixture.env },
      once: () => undefined,
      exit: () => undefined,
    },
    Buffer,
    TextDecoder,
    CustomEvent: class {
      type: string;
      detail: unknown;

      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    console,
    setTimeout,
    clearTimeout,
    window: sandboxWindow,
  };
  createContext(sandbox);
  runInContext(readFileSync(resolve("public/preload.js"), "utf8"), sandbox);
  if (!sandboxWindow.projectBridge) throw new Error("The real preload did not register projectBridge.");
  return { bridge: sandboxWindow.projectBridge, spawn, execFile, execFileSync, bridgeEvents, bridgeEventTypes, runtimeRecordErrors };
};

describe("native project launchers", () => {
  it("opens macOS Terminal with separate arguments", async () => {
    const projectPath = "/Projects/中文 project";
    const { bridge, spawn } = loadPreloadBridge("darwin", {
      directories: [projectPath, "/System/Applications/Utilities/Terminal.app"],
    });

    await expect(
      bridge.openTerminal({
        projectPath,
        terminal: { kind: "terminal-app", customCommand: "" },
      }),
    ).resolves.toMatchObject({ launched: true, code: "launched", kind: "terminal-app" });
    expect(spawn).toHaveBeenCalledWith("/usr/bin/open", ["-a", "Terminal", projectPath], {
      cwd: projectPath,
      detached: true,
      stdio: "ignore",
    });
  });

  it("opens Linux terminal and editors with POSIX paths", async () => {
    const projectPath = "/home/test/中文 project";
    const terminalPath = "/usr/bin/x-terminal-emulator";
    const codePath = "/usr/bin/code";
    const cursorPath = "/usr/bin/cursor";
    const { bridge, spawn } = loadPreloadBridge("linux", {
      directories: [projectPath],
      files: [terminalPath, codePath, cursorPath],
      which: { "x-terminal-emulator": terminalPath, code: codePath, cursor: cursorPath },
    });

    await expect(
      bridge.openTerminal({
        projectPath,
        terminal: { kind: "linux-terminal", customCommand: "" },
      }),
    ).resolves.toMatchObject({ launched: true, code: "launched", kind: "linux-terminal" });
    expect(spawn).toHaveBeenNthCalledWith(1, terminalPath, [], {
      cwd: projectPath,
      detached: true,
      stdio: "ignore",
    });

    await expect(
      bridge.openExternalApplication({
        projectPath,
        application: {
          id: "vscode",
          name: "VS Code",
          kind: "vscode",
          command: "code {path}",
          enabled: true,
        },
      }),
    ).resolves.toMatchObject({ launched: true, code: "launched", resolvedApplicationId: "vscode" });
    expect(spawn).toHaveBeenNthCalledWith(2, codePath, [projectPath], {
      cwd: projectPath,
      detached: true,
      stdio: "ignore",
    });
  });

  it.runIf(process.platform === "win32")("passes literal paths through a real Windows batch launcher", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "project launcher & %USERPROFILE% !unsafe! "));
    const scriptPath = join(projectPath, "launcher.cmd");
    try {
      writeFileSync(scriptPath, '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "received=%~1"\r\nset received\r\n');
      const { bridge, spawn } = loadPreloadBridge("win32", {
        directories: [projectPath],
        files: [scriptPath],
        env: { ComSpec: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe" },
      });
      await bridge.openExternalApplication({
        projectPath,
        application: { id: "vscode", name: "VS Code", kind: "vscode", command: `"${scriptPath}" "{path}"`, enabled: true },
      });
      const [executable, args, options] = spawn.mock.calls[0]!;
      const result = spawnSync(executable, args, {
        cwd: options.cwd,
        env: options.env,
        windowsVerbatimArguments: options.windowsVerbatimArguments,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 10000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(`received=${projectPath}`);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("starts PowerShell in cwd without placing the project path in a command", async () => {
    const projectPath = "C:\\项目 & workspace; $(Get-ChildItem)";
    const powershellPath = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const { bridge, spawn } = loadPreloadBridge("win32", {
      directories: [projectPath],
      files: [powershellPath],
      env: { SystemRoot: "C:\\Windows" },
    });

    await expect(
      bridge.openTerminal({
        projectPath,
        terminal: { kind: "powershell", customCommand: "" },
      }),
    ).resolves.toMatchObject({ launched: true, code: "launched", kind: "powershell" });
    expect(spawn).toHaveBeenCalledWith(powershellPath, ["-NoExit"], {
      cwd: projectPath,
      detached: true,
      stdio: "ignore",
    });
  });

  it("does not treat a reused pid as the requested preload run", async () => {
    const { bridge } = loadPreloadBridge("linux", {
      directories: ["/workspace/project"],
    });
    const result = await bridge.runCommand({
      projectId: "project-1",
      scriptId: "script-1",
      command: "echo hello",
      cwd: "/workspace/project",
      env: {},
      label: "Project / Script",
    });

    expect(
      bridge.getProcessStatus(result.pid, {
        runId: "another-run",
        runtimeOwner: "preload",
      }),
    ).toEqual({ active: false });
  });
});
