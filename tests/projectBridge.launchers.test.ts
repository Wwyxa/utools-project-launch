import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
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

interface TestProcessChild {
  emit(event: string, ...args: unknown[]): void;
  kill(): void;
  stdout: { emit(event: string, ...args: unknown[]): void; setEncoding(encoding: string): void };
  stderr: { emit(event: string, ...args: unknown[]): void; setEncoding(encoding: string): void };
}

const loadPreloadBridge = (platform: Platform, fixture: PreloadFixture) => {
  const nodeRequire = createRequire(import.meta.url);
  const spawnOutcomes = [...(fixture.spawnOutcomes || [])];
  const bridgeEvents: unknown[] = [];
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
      _options: { cwd: string; detached: boolean; stdio: string; env?: NodeJS.ProcessEnv },
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
  return { bridge: sandboxWindow.projectBridge, spawn, execFile, execFileSync, bridgeEvents, bridgeEventTypes };
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

  it("uses Windows app execution aliases and PATH command shims", async () => {
    const projectPath = "C:\\Projects\\workspace & %USERPROFILE% !unsafe!";
    const windowsApps = "C:\\Users\\Test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe";
    const codeShim = "C:\\Users\\Test\\AppData\\Roaming\\Code\\bin\\code.cmd";
    const cursorShim = "C:\\Users\\Test\\AppData\\Roaming\\Cursor\\bin\\cursor.cmd";
    const { bridge, spawn } = loadPreloadBridge("win32", {
      directories: [projectPath],
      files: [codeShim, cursorShim],
      where: { "wt.exe": windowsApps, "code.cmd": codeShim, "cursor.cmd": cursorShim },
      env: { LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local" },
    });

    await expect(
      bridge.openTerminal({
        projectPath,
        terminal: { kind: "windows-terminal", customCommand: "" },
      }),
    ).resolves.toMatchObject({ launched: true, code: "launched", kind: "windows-terminal" });
    expect(spawn).toHaveBeenNthCalledWith(1, windowsApps, ["-d", projectPath], {
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
          command: 'code --reuse-window "{path}"',
          enabled: true,
        },
      }),
    ).resolves.toMatchObject({ launched: true, code: "launched", resolvedApplicationId: "vscode" });
    const [commandExecutable, commandArgs, commandOptions] = spawn.mock.calls[1]!;
    expect(commandExecutable).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(commandArgs).toEqual([
      "/d",
      "/v:off",
      "/s",
      "/c",
      '"%UTOOLS_PROJECT_LAUNCH_COMMAND%" "%UTOOLS_PROJECT_LAUNCH_ARGUMENT_0%" "%UTOOLS_PROJECT_LAUNCH_ARGUMENT_1%"',
    ]);
    expect(commandArgs.join(" ")).not.toContain(projectPath);
    expect(commandOptions).toMatchObject({
      cwd: projectPath,
      detached: true,
      stdio: "ignore",
      env: {
        UTOOLS_PROJECT_LAUNCH_COMMAND: codeShim,
        UTOOLS_PROJECT_LAUNCH_ARGUMENT_0: "--reuse-window",
        UTOOLS_PROJECT_LAUNCH_ARGUMENT_1: projectPath,
      },
    });
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

  it("does not open another terminal when the selected Windows Terminal fails", async () => {
    const projectPath = "C:\\Projects\\fallback";
    const windowsTerminalPath = "C:\\Users\\Test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe";
    const powershellPath = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const { bridge, spawn } = loadPreloadBridge("win32", {
      directories: [projectPath],
      files: [powershellPath],
      spawnOutcomes: ["error", "spawn"],
      where: { "wt.exe": windowsTerminalPath },
      env: { LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local", SystemRoot: "C:\\Windows" },
    });

    await expect(
      bridge.openTerminal({
        projectPath,
        terminal: { kind: "windows-terminal", customCommand: "" },
      }),
    ).resolves.toMatchObject({
      launched: false,
      code: "application-unavailable",
      kind: "windows-terminal",
    });
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(windowsTerminalPath, ["-d", projectPath], {
      cwd: projectPath,
      detached: true,
      stdio: "ignore",
    });
  });

  it("does not open another editor when the selected VS Code launcher fails", async () => {
    const projectPath = "C:\\Projects\\editor-fallback";
    const codeShim = "C:\\Users\\Test\\AppData\\Roaming\\Code\\bin\\code.cmd";
    const cursorShim = "C:\\Users\\Test\\AppData\\Roaming\\Cursor\\bin\\cursor.cmd";
    const { bridge, spawn } = loadPreloadBridge("win32", {
      directories: [projectPath],
      files: [codeShim, cursorShim],
      spawnOutcomes: ["error", "spawn"],
      where: { "code.cmd": codeShim, "cursor.cmd": cursorShim },
    });

    await expect(
      bridge.openExternalApplication({
        projectPath,
        application: { id: "vscode", name: "VS Code", kind: "vscode", command: "code {path}", enabled: true },
      }),
    ).resolves.toMatchObject({
      launched: false,
      code: "application-unavailable",
      applicationId: "vscode",
    });
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[0]).toBe(codeShim);
  });

  it("keeps one stable identity across direct process lifecycle events", async () => {
    const { bridge, spawn, bridgeEvents } = loadPreloadBridge("linux", {
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
    const child = spawn.mock.results.at(-1)?.value as TestProcessChild;
    child.stdout.emit("data", Buffer.from("hello\n"));
    child.stderr.emit("data", Buffer.from("warning\n"));
    child.emit("close", 0, null);

    const processEvents = bridgeEvents.filter(
      (event): event is { type: string; runId?: string; runtimeOwner?: string } =>
        Boolean(event && typeof event === "object" && "type" in event),
    );
    expect(processEvents.map((event) => event.type)).toEqual(["started", "stdout", "stderr", "exit"]);
    expect(new Set(processEvents.map((event) => `${event.runId}:${event.runtimeOwner}`)).size).toBe(1);
    expect(processEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ runId: result.runId, runtimeOwner: "preload" })]),
    );
  });

  it("streams remote Git progress without exposing ANSI control sequences", async () => {
    const projectPath = "/workspace/project";
    const { bridge, spawn, bridgeEvents, bridgeEventTypes } = loadPreloadBridge("linux", {
      gitAsyncOutput: (args) => {
        if (args.includes("--show-toplevel")) return projectPath;
        if (args.includes("remote")) return "origin\thttps://example.test/owner/repository.git (fetch)\n";
        return undefined;
      },
    });

    const resultPromise = bridge.fetchGitRemoteByName(projectPath, "origin");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const child = spawn.mock.results[0]?.value as TestProcessChild;
    child.stderr.emit("data", "\u001b[2KReceiving objects: 5");
    child.stderr.emit("data", "0%\r");
    child.stderr.emit("data", "Resolving deltas: 100%");
    child.emit("close", 0, null);

    await expect(resultPromise).resolves.toMatchObject({ ok: true, remote: "origin" });
    expect(bridgeEventTypes).toEqual([
      "git-remote-progress",
      "git-remote-progress",
      "git-remote-progress",
      "git-remote-progress",
    ]);
    expect(spawn).toHaveBeenCalledWith(
      "git",
      ["-C", projectPath, "fetch", "--progress", "--prune", "origin"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"], windowsHide: true }),
    );
    expect(bridgeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "git-remote-progress",
          repositoryPath: projectPath,
          phase: "start",
          message: "开始: git fetch --progress --prune origin",
        }),
        expect.objectContaining({ phase: "output", message: "Receiving objects: 50%" }),
        expect.objectContaining({ phase: "output", message: "Resolving deltas: 100%" }),
        expect.objectContaining({ phase: "complete", message: "" }),
      ]),
    );
  });

  it("keeps explicit preload control local when service mode is enabled", async () => {
    const { bridge } = loadPreloadBridge("linux", {
      directories: ["/workspace/project"],
      serviceEnabled: false,
    });
    const result = await bridge.runCommand({
      projectId: "project-1",
      scriptId: "script-1",
      command: "echo hello",
      cwd: "/workspace/project",
      env: {},
      label: "Project / Script",
    });

    bridge.saveProjectLaunchServicePreferences({ schemaVersion: 1, enabled: true });

    expect(bridge.getProcessStatus(result.pid, { runId: result.runId, runtimeOwner: "preload" })).toMatchObject({
      active: true,
      runId: result.runId,
      runtimeOwner: "preload",
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
