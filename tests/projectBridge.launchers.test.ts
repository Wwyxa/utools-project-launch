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
  spawnOutcomes?: SpawnOutcome[];
  env?: Record<string, string>;
}

const loadPreloadBridge = (platform: Platform, fixture: PreloadFixture) => {
  const nodeRequire = createRequire(import.meta.url);
  const spawnOutcomes = [...(fixture.spawnOutcomes || [])];
  const spawn = vi.fn(
    (
      _executable: string,
      _args: string[],
      _options: { cwd: string; detached: boolean; stdio: string; env?: NodeJS.ProcessEnv },
    ) => {
      const outcome = spawnOutcomes.shift() || "spawn";
      const child = { once: vi.fn(), unref: vi.fn() };
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
      const resolved = lookupResult(command, args);
      queueMicrotask(() => {
        if (!resolved) {
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
  const sandboxWindow: { projectBridge?: ProjectBridge; localStorage: object; utools: { dbStorage: object } } = {
    localStorage: { getItem: () => null, setItem: () => undefined },
    utools: { dbStorage: { getItem: () => null, setItem: () => undefined } },
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
    console,
    setTimeout,
    clearTimeout,
    window: sandboxWindow,
  };
  createContext(sandbox);
  runInContext(readFileSync(resolve("public/preload.js"), "utf8"), sandbox);
  if (!sandboxWindow.projectBridge) throw new Error("The real preload did not register projectBridge.");
  return { bridge: sandboxWindow.projectBridge, spawn, execFile, execFileSync };
};

describe("native project launchers", () => {
  it("detects macOS apps without spawning and opens Terminal with separate arguments", async () => {
    const projectPath = "/Projects/中文 project";
    const { bridge, spawn } = loadPreloadBridge("darwin", {
      directories: [projectPath, "/System/Applications/Utilities/Terminal.app"],
    });

    const capabilities = await bridge.detectHostLaunchCapabilities({ scope: "terminals" });
    expect(capabilities.platform).toBe("darwin");
    expect(capabilities.terminals.find((candidate) => candidate.kind === "terminal-app")?.available).toBe(true);
    expect(spawn).not.toHaveBeenCalled();

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

  it("detects and opens Linux terminal and editors with POSIX paths", async () => {
    const projectPath = "/home/test/中文 project";
    const terminalPath = "/usr/bin/x-terminal-emulator";
    const codePath = "/usr/bin/code";
    const cursorPath = "/usr/bin/cursor";
    const { bridge, spawn, execFile, execFileSync } = loadPreloadBridge("linux", {
      directories: [projectPath],
      files: [terminalPath, codePath, cursorPath],
      which: { "x-terminal-emulator": terminalPath, code: codePath, cursor: cursorPath },
    });

    const terminalCapabilities = await bridge.detectHostLaunchCapabilities({ scope: "terminals" });
    expect(terminalCapabilities.platform).toBe("linux");
    expect(terminalCapabilities.terminals.find((candidate) => candidate.kind === "linux-terminal")?.available).toBe(
      true,
    );
    expect(terminalCapabilities.editors).toEqual([]);
    expect(execFile.mock.calls.map(([, args]) => args[0])).toEqual([
      "x-terminal-emulator",
      "gnome-terminal",
      "konsole",
      "xfce4-terminal",
      "kitty",
      "alacritty",
      "xterm",
    ]);

    const editorCapabilities = await bridge.detectHostLaunchCapabilities({ scope: "editors" });
    expect(editorCapabilities.terminals).toEqual([]);
    expect(editorCapabilities.editors.find((candidate) => candidate.kind === "vscode")?.available).toBe(true);
    expect(editorCapabilities.editors.find((candidate) => candidate.kind === "cursor")?.available).toBe(true);
    expect(execFileSync).not.toHaveBeenCalled();

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
    const { bridge, spawn, execFile, execFileSync } = loadPreloadBridge("win32", {
      directories: [projectPath],
      files: [codeShim, cursorShim],
      where: { "wt.exe": windowsApps, "code.cmd": codeShim, "cursor.cmd": cursorShim },
      env: { LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local" },
    });

    const terminalCapabilities = await bridge.detectHostLaunchCapabilities({ scope: "terminals" });
    expect(terminalCapabilities.terminals.find((candidate) => candidate.kind === "windows-terminal")?.available).toBe(
      true,
    );
    expect(terminalCapabilities.editors).toEqual([]);
    expect(execFile.mock.calls.map(([, args]) => args[0])).toEqual(["wt.exe", "wt", "pwsh.exe", "powershell.exe"]);

    const editorCapabilities = await bridge.detectHostLaunchCapabilities({ scope: "editors" });
    expect(editorCapabilities.terminals).toEqual([]);
    expect(editorCapabilities.editors.find((candidate) => candidate.kind === "vscode")?.available).toBe(true);
    expect(editorCapabilities.editors.find((candidate) => candidate.kind === "cursor")?.available).toBe(true);
    expect(execFileSync).not.toHaveBeenCalled();

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

  it("decodes legacy Windows where.exe paths before checking the executable", async () => {
    const codeShim = "C:\\Users\\\u4e2d\u6587\\AppData\\Roaming\\Code\\bin\\code.cmd";
    const legacyCodeShim = Buffer.concat([
      Buffer.from("C:\\Users\\", "ascii"),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
      Buffer.from("\\AppData\\Roaming\\Code\\bin\\code.cmd", "ascii"),
      Buffer.from([0x0d, 0x0a]),
    ]);
    const { bridge } = loadPreloadBridge("win32", {
      files: [codeShim],
      where: { "code.cmd": legacyCodeShim },
    });

    const capabilities = await bridge.detectHostLaunchCapabilities({ scope: "editors" });

    expect(capabilities.editors.find((candidate) => candidate.kind === "vscode")?.available).toBe(true);
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
});
