import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import type { ProjectBridge } from "../src/types";

type Platform = "darwin" | "win32";

const loadPreloadBridge = (platform: Platform, paths: string[]) => {
  const nodeRequire = createRequire(import.meta.url);
  const spawn = vi.fn(() => {
    const child = { once: vi.fn(), unref: vi.fn() };
    child.once.mockImplementation((event: string, listener: () => void) => {
      if (event === "spawn") listener();
      return child;
    });
    return child;
  });
  const fs = {
    ...nodeRequire("fs"),
    statSync: (target: string) => {
      if (paths.includes(target)) return { isDirectory: () => true, isFile: () => target.endsWith(".exe") };
      throw new Error("not found");
    },
  };
  const childProcess = {
    ...nodeRequire("child_process"),
    spawn,
    execFileSync: vi.fn((command: string) => {
      if (platform === "win32" && command === "where.exe") return "C:\\Program Files\\Microsoft VS Code\\Code.exe\r\n";
      throw new Error("not found");
    }),
  };
  const sandboxWindow: { projectBridge?: ProjectBridge; localStorage: object; utools: { dbStorage: object } } = {
    localStorage: { getItem: () => null, setItem: () => undefined },
    utools: { dbStorage: { getItem: () => null, setItem: () => undefined } },
  };
  const sandbox = {
    require: (id: string) => {
      if (id === "electron") return { shell: {} };
      if (id === "fs") return fs;
      if (id === "child_process") return childProcess;
      return nodeRequire(id);
    },
    process: { platform, env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" }, once: () => undefined, exit: () => undefined },
    Buffer,
    console,
    setTimeout,
    clearTimeout,
    window: sandboxWindow,
  };
  createContext(sandbox);
  runInContext(readFileSync(resolve("public/preload.js"), "utf8"), sandbox);
  if (!sandboxWindow.projectBridge) throw new Error("The real preload did not register projectBridge.");
  return { bridge: sandboxWindow.projectBridge, spawn };
};

describe("native project launchers", () => {
  it("detects macOS apps without spawning and opens Terminal with separate arguments", async () => {
    const projectPath = "/Projects/中文 project";
    const { bridge, spawn } = loadPreloadBridge("darwin", [projectPath, "/System/Applications/Utilities/Terminal.app"]);

    const capabilities = await bridge.detectHostLaunchCapabilities();
    expect(capabilities.platform).toBe("darwin");
    expect(capabilities.terminals.find((candidate) => candidate.kind === "terminal-app")?.available).toBe(true);
    expect(spawn).not.toHaveBeenCalled();

    await expect(
      bridge.openTerminal({
        projectPath,
        terminal: { schemaVersion: 2, mode: "auto", kind: "terminal-app", customCommand: "" },
      }),
    ).resolves.toMatchObject({ launched: true, code: "launched", resolvedKind: "terminal-app" });
    expect(spawn).toHaveBeenCalledWith("/usr/bin/open", ["-a", "Terminal", projectPath], {
      cwd: projectPath,
      detached: true,
      stdio: "ignore",
    });
  });

  it("starts Windows CMD in cwd without placing the path in a shell command", async () => {
    const projectPath = "/项目 & workspace";
    const { bridge, spawn } = loadPreloadBridge("win32", [projectPath, "C:\\Windows\\System32\\cmd.exe"]);

    await expect(
      bridge.openTerminal({
        projectPath,
        terminal: { schemaVersion: 2, mode: "manual", kind: "cmd", customCommand: "" },
      }),
    ).resolves.toMatchObject({ launched: true, code: "launched", resolvedKind: "cmd" });
    expect(spawn).toHaveBeenCalledWith("C:\\Windows\\System32\\cmd.exe", ["/d", "/k"], {
      cwd: projectPath,
      detached: true,
      stdio: "ignore",
    });
  });
});
