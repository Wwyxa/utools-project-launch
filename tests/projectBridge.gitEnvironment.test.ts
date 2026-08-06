import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { ProjectBridge } from "../src/types";

type Platform = "darwin" | "win32";
const gitEnvironmentMarker = "__UTOOLS_PROJECT_LAUNCH_GIT_ENV_BEGIN__";

interface PreloadFixture {
  env: NodeJS.ProcessEnv;
  shellEnvironment?: NodeJS.ProcessEnv;
  windowsUserEnvironment?: string;
  windowsMachineEnvironment?: string;
  shellFailure?: boolean;
  shellStdoutPrefix?: string;
}

interface ChildProcessOptions {
  env?: NodeJS.ProcessEnv;
}

const loadPreloadBridge = (platform: Platform, fixture: PreloadFixture) => {
  const nodeRequire = createRequire(import.meta.url);
  const projectPath = platform === "win32" ? "C:\\Projects\\repository" : "/Projects/repository";
  const execFileSync = vi.fn((command: string, args: string[], _options?: ChildProcessOptions) => {
    if (command === "/bin/zsh") {
      if (fixture.shellFailure) throw new Error("shell unavailable");
      return Buffer.from(
        `${fixture.shellStdoutPrefix || ""}\0${gitEnvironmentMarker}\0${Object.entries(fixture.shellEnvironment || {})
          .map(([name, value]) => `${name}=${value || ""}`)
          .join("\0")}\0`,
      );
    }
    if (command === "reg.exe") {
      if (args[1] === "HKCU\\Environment") return Buffer.from(fixture.windowsUserEnvironment || "");
      if (args[1] === "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")
        return Buffer.from(fixture.windowsMachineEnvironment || "");
      throw new Error("unknown registry key");
    }
    if (command !== "git") throw new Error(`unexpected command: ${command}`);
    if (args.includes("--show-toplevel")) return projectPath;
    if (args.includes("--cached")) return "diff --git a/file b/file\n";
    if (args.includes("--short")) return "abc1234\n";
    return "";
  });
  const spawnSync = vi.fn((_command: string, _args: string[], _options?: ChildProcessOptions) => ({
    status: 0,
    stdout: "",
    stderr: "",
  }));
  const childProcess = { ...nodeRequire("child_process"), execFileSync, spawnSync };
  const sandboxWindow: { projectBridge?: ProjectBridge } = {};
  const sandbox = {
    require: (id: string) =>
      id === "electron" ? { shell: {} } : id === "child_process" ? childProcess : nodeRequire(id),
    process: { platform, env: fixture.env, once: () => undefined, exit: () => undefined },
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
  return { bridge: sandboxWindow.projectBridge, execFileSync, spawnSync, projectPath };
};

describe("Git execution environment", () => {
  it("uses and caches the macOS login-shell environment for Git and its hooks", () => {
    const { bridge, execFileSync, spawnSync, projectPath } = loadPreloadBridge("darwin", {
      env: { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" },
      shellEnvironment: {
        PATH: "/Users/test/Library/pnpm:/Users/test/.volta/bin:/usr/bin",
        PNPM_HOME: "/Users/test/Library/pnpm",
        VOLTA_HOME: "/Users/test/.volta",
      },
    });

    expect(bridge.commitGitStaged(projectPath, "test: inherit shell environment")).toMatchObject({ ok: true });

    const shellCalls = execFileSync.mock.calls.filter(([command]) => command === "/bin/zsh");
    expect(shellCalls).toHaveLength(1);
    expect(shellCalls[0]?.[1]?.[1]).toBe(`printf '\\000${gitEnvironmentMarker}\\000'; env -0`);
    const gitOptions = execFileSync.mock.calls.filter(([command]) => command === "git").map(([, , options]) => options);
    expect(gitOptions).toHaveLength(3);
    gitOptions.forEach((options) => {
      expect(options?.env).toMatchObject({ PNPM_HOME: "/Users/test/Library/pnpm", VOLTA_HOME: "/Users/test/.volta" });
      expect(options?.env?.PATH).toBe("/Users/test/Library/pnpm:/Users/test/.volta/bin:/usr/bin:/bin");
    });
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["commit", "-m", "test: inherit shell environment"]),
      expect.objectContaining({
        env: expect.objectContaining({ PNPM_HOME: "/Users/test/Library/pnpm" }),
      }),
    );
  });

  it("merges Windows user and machine developer environments without duplicate PATH entries", () => {
    const { bridge, spawnSync, projectPath } = loadPreloadBridge("win32", {
      env: {
        Path: "C:\\Program Files\\Git\\cmd;C:\\Windows\\System32",
        USERPROFILE: "C:\\Users\\Test",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
      },
      windowsUserEnvironment: [
        "HKEY_CURRENT_USER\\Environment",
        "    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\pnpm;C:\\Tools\\Volta\\bin",
        "    PNPM_HOME    REG_SZ    C:\\Users\\Test\\AppData\\Local\\pnpm",
        "    VOLTA_HOME    REG_SZ    C:\\Tools\\Volta",
      ].join("\r\n"),
      windowsMachineEnvironment: [
        "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
        "    Path    REG_EXPAND_SZ    C:\\Windows\\System32;C:\\Program Files\\Git\\cmd",
      ].join("\r\n"),
    });

    expect(bridge.commitGitStaged(projectPath, "test: inherit Windows environment")).toMatchObject({ ok: true });

    const [, , options] = spawnSync.mock.calls[0]!;
    expect(options?.env).toMatchObject({
      PNPM_HOME: "C:\\Users\\Test\\AppData\\Local\\pnpm",
      VOLTA_HOME: "C:\\Tools\\Volta",
    });
    expect(options?.env?.PATH).toBe(
      "C:\\Users\\Test\\AppData\\Local\\pnpm;C:\\Tools\\Volta\\bin;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32",
    );
  });

  it("falls back to the host environment when login-shell discovery fails", () => {
    const { bridge, spawnSync, projectPath } = loadPreloadBridge("darwin", {
      env: { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin", PNPM_HOME: "/existing/pnpm" },
      shellFailure: true,
    });

    expect(bridge.commitGitStaged(projectPath, "test: fall back safely")).toMatchObject({ ok: true });

    const [, , options] = spawnSync.mock.calls[0]!;
    expect(options?.env).toMatchObject({ PATH: "/usr/bin:/bin", PNPM_HOME: "/existing/pnpm" });
  });

  it("ignores login-shell stdout before the marked environment stream", () => {
    const { bridge, spawnSync, projectPath } = loadPreloadBridge("darwin", {
      env: { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" },
      shellStdoutPrefix: "Loading developer profile...\n",
      shellEnvironment: { PATH: "/Users/test/Library/pnpm:/usr/bin", PNPM_HOME: "/Users/test/Library/pnpm" },
    });

    expect(bridge.commitGitStaged(projectPath, "test: ignore shell banner")).toMatchObject({ ok: true });

    const [, , options] = spawnSync.mock.calls[0]!;
    expect(options?.env).toMatchObject({ PNPM_HOME: "/Users/test/Library/pnpm" });
    expect(options?.env?.PATH).toBe("/Users/test/Library/pnpm:/usr/bin:/bin");
  });

  it("passes whitespace-ignore options to worktree and commit diffs", () => {
    const { bridge, execFileSync, projectPath } = loadPreloadBridge("darwin", {
      env: { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" },
    });

    bridge.readGitFileDiff(projectPath, "file.ts", { ignoreWhitespace: true });
    bridge.readGitCommitFileDiff(projectPath, "abc1234", "file.ts", undefined, { ignoreWhitespace: true });

    const gitDiffCalls = execFileSync.mock.calls
      .filter(
        ([command, args]) =>
          command === "git" &&
          (args.includes("diff") || args.includes("show")) &&
          args.includes("--ignore-space-change"),
      )
      .map(([, args]) => args);

    expect(gitDiffCalls).toHaveLength(3);
    gitDiffCalls.forEach((args) => {
      expect(args).toEqual(expect.arrayContaining(["--ignore-space-change", "--ignore-blank-lines", "--", "file.ts"]));
    });
  });
});
