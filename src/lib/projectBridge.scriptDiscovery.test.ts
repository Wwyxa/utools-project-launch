import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectBridge } from "../types";

const fixtureDirectories: string[] = [];

const createFixtureDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "utools-script-discovery-"));
  fixtureDirectories.push(directory);
  return directory;
};

const loadPreloadBridge = (
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    moduleOverrides?: Record<string, unknown>;
  } = {},
) => {
  const nodeRequire = createRequire(import.meta.url);
  const sandboxWindow: { projectBridge?: ProjectBridge; dispatchEvent: () => void } = { dispatchEvent: () => undefined };
  const sandbox = {
    require: (id: string) => (id === "electron" ? { shell: {} } : (options.moduleOverrides?.[id] ?? nodeRequire(id))),
    process: {
      platform: options.platform ?? process.platform,
      env: options.env ?? process.env,
      once: () => undefined,
      exit: () => undefined,
    },
    Buffer,
    console,
    CustomEvent: class {
      constructor(_type: string, _init: unknown) {}
    },
    setTimeout,
    clearTimeout,
    window: sandboxWindow,
  };
  createContext(sandbox);
  runInContext(readFileSync(resolve("public/preload.js"), "utf8"), sandbox);
  if (!sandboxWindow.projectBridge) throw new Error("The real preload did not register projectBridge.");
  return sandboxWindow.projectBridge;
};

afterEach(() => {
  fixtureDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("project script discovery", () => {
  it("keeps path inspection metadata-only so it cannot replace form scripts", async () => {
    const directory = createFixtureDirectory();
    writeFileSync(join(directory, "package.json"), '{"scripts":{"dev":"vite"}}', "utf8");

    const inspection = await loadPreloadBridge().inspectProjectPath(directory);

    expect(inspection.pathExists).toBe(true);
    expect(inspection.scripts).toEqual([]);
  });

  it("discovers package scripts in common directories and only ordinary root Makefile targets", async () => {
    const directory = createFixtureDirectory();
    writeFileSync(join(directory, "package.json"), '{"scripts":{"dev":"vite","build":"vite build"}}', "utf8");
    const frontend = join(directory, "frontend");
    mkdirSync(frontend);
    writeFileSync(join(frontend, "package.json"), '{"scripts":{"test":"vitest run"}}', "utf8");
    writeFileSync(
      join(directory, "Makefile"),
      [
        ".PHONY: dev build phony-only",
        "dev: ## start locally",
        "build test: ## build and test",
        "%.o: %.c",
        "VERSION := 1",
        "$(GENERATED): input",
        "unsafe;target: input",
        "include local.mk",
        "\t@echo recipe",
      ].join("\n"),
      "utf8",
    );

    const bridge = loadPreloadBridge();
    const result = await bridge.discoverProjectScripts(directory, { sources: ["package-json", "makefile"] });

    expect(result.scripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "dev", command: "npm run dev", cwd: ".", source: "package-json" }),
        expect.objectContaining({ name: "build", command: "npm run build", cwd: ".", source: "package-json" }),
        expect.objectContaining({ name: "frontend:test", command: "npm run test", cwd: "frontend", source: "package-json" }),
        expect.objectContaining({ name: "dev", command: "make dev", cwd: ".", source: "makefile" }),
        expect.objectContaining({ name: "build", command: "make build", cwd: ".", source: "makefile" }),
        expect.objectContaining({ name: "test", command: "make test", cwd: ".", source: "makefile" }),
        expect.objectContaining({ name: "phony-only", command: "make phony-only", cwd: ".", source: "makefile" }),
      ]),
    );
    expect(result.scripts.map((script) => script.command)).not.toEqual(
      expect.arrayContaining(["make %.o", "make $(GENERATED)", "make unsafe;target"]),
    );
    expect((await bridge.discoverProjectScripts(directory, { sources: ["package-json"] })).scripts).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ source: "makefile" })]),
    );
    expect((await bridge.discoverProjectScripts(directory, { sources: ["makefile"] })).scripts).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ source: "package-json" })]),
    );
  });

  it("returns no candidates for a missing project path", () => {
    expect(loadPreloadBridge().discoverProjectScripts(join(tmpdir(), "missing-utools-script-project"), { sources: ["makefile"] })).toEqual(
      expect.objectContaining({ scripts: [], message: expect.any(String) }),
    );
  });

  it("uses an explicit platform shell for commands instead of relying on Node's implicit shell", () => {
    const child = {
      pid: 42,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    };
    const spawn = vi.fn(() => child);
    const nodeRequire = createRequire(import.meta.url);
    const run = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv) => {
      const bridge = loadPreloadBridge({
        platform,
        env,
        moduleOverrides: { child_process: { ...nodeRequire("child_process"), spawn } },
      });
      bridge.runCommand({
        projectId: "project",
        scriptId: "script",
        command: "node --version",
        cwd: "/project",
        env: { PROJECT_VALUE: "set" },
        label: "script",
      });
    };

    run("darwin", { SHELL: "/bin/zsh" });
    expect(spawn).toHaveBeenLastCalledWith(
      "/bin/zsh",
      ["-ilc", "node --version"],
      expect.objectContaining({ cwd: "/project", shell: false, env: { SHELL: "/bin/zsh", PROJECT_VALUE: "set" } }),
    );

    run("win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" });
    expect(spawn).toHaveBeenLastCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      ["/d", "/s", "/c", "node --version"],
      expect.objectContaining({ cwd: "/project", shell: false, env: { ComSpec: "C:\\Windows\\System32\\cmd.exe", PROJECT_VALUE: "set" } }),
    );
  });
});
