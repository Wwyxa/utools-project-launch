import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { computed, ref, type Ref } from "vue";
import { describe, expect, it, vi } from "vitest";

function loadScript<Exports>(file: string, imports: Record<string, unknown>, globals = {}, extra = ""): Exports {
  const source = readFileSync(path.resolve(file), "utf8");
  const script = file.endsWith(".vue") ? parse(source).descriptor.scriptSetup?.content : source;
  if (!script) throw new Error(`Missing script: ${file}`);
  const exports = {};
  runInNewContext(
    transpileModule(`${script}\n${extra}`, {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: (name: string) => imports[name] ?? {}, defineEmits: () => vi.fn(), ...globals },
  );
  return exports as Exports;
}

describe("storage migration recovery", () => {
  it("allows explicit partial entry, guards duplicate actions and keeps a failed deferral visible", async () => {
    const failed = { status: "failed", totalCount: 2, verifiedCount: 1, failedCount: 1, pendingCount: 0, items: [], failedItems: [] };
    let deferred = false;
    let finish: (result: { ok: boolean; error?: string }) => void = () => {};
    const deferMigration = vi.fn(() => new Promise<{ ok: boolean; error?: string }>((resolve) => { finish = resolve; }));
    const emit = vi.fn();
    const { probe } = loadScript<{
      probe: { canDefer: Ref<boolean>; errorMessage: Ref<string>; deferAndEnter(): Promise<void>; startMigration(): Promise<void> };
    }>("src/components/common/StartupGate.vue", {
      vue: { computed, ref, inject: () => ({ status: "migration-incomplete", migration: failed }) },
      "../../lib/projectBridge": { getProjectBridge: () => ({
        deferMigration,
        runMigration: vi.fn(),
        preflightStartup: () => ({ status: deferred ? "ready" : "migration-incomplete", migrationDeferred: deferred, migration: failed }),
      }) },
    }, { defineEmits: () => emit },
    "export const probe = { canDefer, errorMessage, deferAndEnter, startMigration };");
    expect(probe.canDefer.value).toBe(true);
    const rejected = probe.deferAndEnter();
    await probe.deferAndEnter();
    await probe.startMigration();
    expect(deferMigration).toHaveBeenCalledOnce();
    finish({ ok: false, error: "服务仍在运行" });
    await rejected;
    expect(emit).not.toHaveBeenCalled();
    expect(probe.errorMessage.value).toBe("服务仍在运行");
    const accepted = probe.deferAndEnter();
    deferred = true;
    finish({ ok: true });
    await accepted;
    expect(emit).toHaveBeenCalledExactlyOnceWith("ready");
  });

  it("blocks migration while stopping the service and restores the entry after completion", async () => {
    let finishStop: (result: { ok: boolean; error?: string }) => void = () => {};
    const stopMigrationService = vi.fn(
      () =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          finishStop = resolve;
        }),
    );
    const runMigration = vi.fn().mockResolvedValue({ ok: true, ledger: null });
    const emit = vi.fn();
    const { probe } = loadScript<{
      probe: {
        canStartMigration: Ref<boolean>;
        stopping: Ref<boolean>;
        serviceStopMessage: Ref<string>;
        stopService(): Promise<void>;
        startMigration(): Promise<void>;
        enterPlugin(): void;
      };
    }>(
      "src/components/common/StartupGate.vue",
      {
        vue: { computed, ref, inject: () => ({ status: "migration-required" }) },
        "../../lib/projectBridge": {
          getProjectBridge: () => ({
            runMigration,
            stopMigrationService,
            preflightStartup: () => ({ status: "ready", migration: null }),
          }),
        },
      },
      { defineEmits: () => emit },
      "export const probe = { canStartMigration, stopping, serviceStopMessage, stopService, startMigration, enterPlugin };",
    );

    const pending = probe.stopService();
    expect(probe.stopping.value).toBe(true);
    expect(probe.canStartMigration.value).toBe(false);
    await probe.startMigration();
    await probe.stopService();
    expect(runMigration).not.toHaveBeenCalled();
    expect(stopMigrationService).toHaveBeenCalledOnce();
    finishStop({ ok: true });
    await pending;
    expect(probe.stopping.value).toBe(false);
    expect(probe.canStartMigration.value).toBe(true);
    expect(probe.serviceStopMessage.value).toContain("服务已停止");
    await probe.startMigration();
    probe.enterPlugin();
    expect(emit).toHaveBeenCalledExactlyOnceWith("ready");
  });
});

describe("migration protocol compatibility", () => {
  it("uses protocol 2 only when explicitly requested and still validates service identity", async () => {
    const headers: Array<Record<string, string>> = [];
    const { probe } = loadScript<{
      probe: {
        requestProjectLaunchService(discovery: unknown, token: string, method: string, url: string, body?: unknown, options?: unknown): Promise<unknown>;
        validateProjectLaunchServiceHealth(health: unknown, connection: unknown, protocolVersion?: number): unknown;
      };
    }>("public/preload/project-launch-service.js", {}, {
      Buffer,
      projectLaunchServiceProtocolVersion: 3,
      projectLaunchServiceRequestTimeoutMs: 100,
      http: {
        request(options: { headers: Record<string, string> }, callback: (response: EventEmitter) => void) {
          headers.push(options.headers);
          const request = new EventEmitter() as EventEmitter & { end(): void };
          request.end = () => {
            const response = Object.assign(new EventEmitter(), { statusCode: 200 });
            callback(response);
            response.emit("data", Buffer.from("{}"));
            response.emit("end");
          };
          return request;
        },
      },
    }, "export const probe = { requestProjectLaunchService, validateProjectLaunchServiceHealth };");
    const discovery = { port: 12345, protocolVersion: 2, pid: 42, instanceId: "old", processIdentity: "identity" };
    await probe.requestProjectLaunchService(discovery, "test", "GET", "/v1/health");
    await probe.requestProjectLaunchService(discovery, "test", "GET", "/v1/health", undefined, { protocolVersion: 2 });
    expect(headers.map((header) => header["X-Protocol-Version"])).toEqual(["3", "2"]);
    expect(() => probe.validateProjectLaunchServiceHealth(discovery, { discovery })).toThrow();
    expect(probe.validateProjectLaunchServiceHealth(discovery, { discovery }, 2)).toBe(discovery);
    expect(() => probe.validateProjectLaunchServiceHealth({ ...discovery, pid: 43 }, { discovery }, 2)).toThrow();
  });
});

describe("data cleanup directory scanning", () => {
  it("yields while reading files and measures nested files without following symbolic links", async () => {
    let finishRead: (stats: unknown) => void = () => {};
    const rootPath = path.resolve("scan-fixture");
    const synchronousRead = vi.fn(() => {
      throw new Error("Synchronous filesystem reads block the dialog");
    });
    const lstat = vi.fn((targetPath: string) =>
      targetPath === rootPath
        ? new Promise((resolve) => {
            finishRead = resolve;
          })
        : Promise.resolve({ isSymbolicLink: () => targetPath.endsWith("link"), isFile: () => true, size: 42 }),
    );
    const { probe } = loadScript<{ probe: { directoryEntrySizeBytes(targetPath: string): Promise<number> } }>(
      "public/preload/data-tools.js",
      {},
      {
        fs: {
          promises: { lstat, readdir: vi.fn().mockResolvedValue(["file", "link"]) },
          lstatSync: synchronousRead,
          readdirSync: synchronousRead,
        },
        path,
        migrationPreferenceKeys: [],
        storageKey: "legacy-projects",
      },
      "export const probe = { directoryEntrySizeBytes };",
    );
    let settled = false;
    const pending = probe.directoryEntrySizeBytes(rootPath);
    void pending.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(synchronousRead).not.toHaveBeenCalled();
    finishRead({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true });
    expect(await pending).toBe(42);
    expect(lstat).toHaveBeenCalledTimes(3);
  });
});
