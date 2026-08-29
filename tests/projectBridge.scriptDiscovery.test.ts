import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectBridge, ProjectBridgeEvent } from "../src/types";

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
    onBridgeEvent?: (event: ProjectBridgeEvent) => void;
  } = {},
) => {
  const nodeRequire = createRequire(import.meta.url);
  const sandboxWindow: {
    projectBridge?: ProjectBridge;
    dispatchEvent: (event: { type?: string; detail?: unknown }) => boolean;
  } = {
    dispatchEvent: (event) => {
      if (event.type === "project-bridge-event") {
        options.onBridgeEvent?.(event.detail as ProjectBridgeEvent);
      }
      return true;
    },
  };
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
      type: string;
      detail: unknown;

      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
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
        expect.objectContaining({
          name: "frontend:test",
          command: "npm run test",
          cwd: "frontend",
          source: "package-json",
        }),
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
    expect(
      loadPreloadBridge().discoverProjectScripts(join(tmpdir(), "missing-utools-script-project"), {
        sources: ["makefile"],
      }),
    ).toEqual(expect.objectContaining({ scripts: [], message: expect.any(String) }));
  });

  it("reports malformed package.json instead of silently presenting an empty scan", async () => {
    const directory = createFixtureDirectory();
    writeFileSync(join(directory, "package.json"), '{"scripts":', "utf8");

    const result = await loadPreloadBridge().discoverProjectScripts(directory, { sources: ["package-json"] });

    expect(result.scripts).toEqual([]);
    expect(result.message).toContain("无法解析");
    expect(result.message).toContain("package.json");
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
      expect.objectContaining({
        cwd: resolve("/project"),
        shell: false,
        detached: true,
        env: { SHELL: "/bin/zsh", PROJECT_VALUE: "set" },
      }),
    );

    run("win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" });
    expect(spawn).toHaveBeenLastCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      ["/d", "/s", "/c", "node --version"],
      expect.objectContaining({
        cwd: resolve("/project"),
        shell: false,
        detached: false,
        env: { ComSpec: "C:\\Windows\\System32\\cmd.exe", PROJECT_VALUE: "set" },
      }),
    );
  });

  it("decodes split GB18030 script output on Windows", () => {
    let stdoutListener: ((chunk: Buffer) => void) | undefined;
    let closeListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
    const child = {
      pid: 42,
      stdout: {
        on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
          if (event === "data") stdoutListener = listener;
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (event === "close") {
          closeListener = listener as (code: number | null, signal: NodeJS.Signals | null) => void;
        }
      }),
    };
    const spawn = vi.fn(() => child);
    const nodeRequire = createRequire(import.meta.url);
    const events: ProjectBridgeEvent[] = [];
    const bridge = loadPreloadBridge({
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      moduleOverrides: { child_process: { ...nodeRequire("child_process"), spawn } },
      onBridgeEvent: (event) => events.push(event),
    });

    bridge.runCommand({
      projectId: "project",
      scriptId: "script",
      command: "echo test111",
      cwd: "C:\\project",
      env: {},
      label: "script",
    });

    const output = Buffer.from([
      0x74, 0x65, 0x73, 0x74, 0x31, 0x31, 0x31, 0x20, 0xcf, 0xee, 0xc4, 0xbf, 0xc6, 0xf4, 0xb6, 0xaf, 0x0d, 0x0a,
    ]);
    stdoutListener?.(output.subarray(0, 9));
    stdoutListener?.(output.subarray(9));
    closeListener?.(0, null);

    const stdoutMessages = events.reduce<string[]>((messages, event) => {
      if (event.type === "stdout" && "message" in event) {
        messages.push(event.message || "");
      }
      return messages;
    }, []);
    expect(stdoutMessages).toEqual(["test111 \u9879\u76ee\u542f\u52a8\r\n"]);
  });
});
