import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parse } from "@vue/compiler-sfc";
import { compile } from "@vue/compiler-dom";
import { renderToString } from "@vue/server-renderer";
import * as Vue from "vue";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { computed, ref, type Ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { AppStore } from "../src/store/appStoreShape";
import type { MigrationRunResult, MigrationServiceStopProgress, MigrationSummary } from "../src/types";

type MigrationStore = Pick<AppStore,
  "dataToolsBusy" | "cleanupMessage" | "migrationProgress" | "refreshStorageOverview" | "reloadProjectsFromStorage"
>;
type MigrationActions = {
  retryStorageMigration(this: MigrationStore): Promise<MigrationRunResult | null>;
};

function loadScript<Exports>(file: string, imports: Record<string, unknown>, globals = {}, extra = ""): Exports {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
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
  it("blocks migration while stopping the service and restores the entry after completion", async () => {
    let finishStop: (result: { ok: boolean; error?: string }) => void = () => {};
    const stopMigrationService = vi.fn(() => new Promise<{ ok: boolean; error?: string }>((resolve) => {
      finishStop = resolve;
    }));
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
    }>("src/components/common/StartupGate.vue", {
      vue: { computed, ref, inject: () => ({ status: "migration-required" }) },
      "../../lib/projectBridge": { getProjectBridge: () => ({ runMigration, stopMigrationService, preflightStartup: () => ({ status: "ready", migration: null }) }) },
    }, { defineEmits: () => emit },
    "export const probe = { canStartMigration, stopping, serviceStopMessage, stopService, startMigration, enterPlugin };");

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

  it("displays a service stop failure and allows stopping again", async () => {
    const stopMigrationService = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "Stopping scripts timed out" })
      .mockResolvedValueOnce({ ok: true });
    const { probe } = loadScript<{
      probe: { stopService(): Promise<void>; errorMessage: Ref<string>; stopping: Ref<boolean>; headline: Ref<string>; stopFailed: Ref<boolean> };
    }>("src/components/common/StartupGate.vue", {
      vue: { computed, ref, inject: () => ({ status: "migration-required" }) },
      "../../lib/projectBridge": { getProjectBridge: () => ({ stopMigrationService }) },
    }, {}, "export const probe = { stopService, errorMessage, stopping, headline, stopFailed };");

    await probe.stopService();
    expect(probe.errorMessage.value).toBe("Stopping scripts timed out");
    expect(probe.stopping.value).toBe(false);
    expect(probe.headline.value).toBe("停止服务失败");
    expect(probe.stopFailed.value).toBe(true);
    await probe.stopService();
    expect(stopMigrationService).toHaveBeenCalledTimes(2);
    expect(probe.errorMessage.value).toBe("");
    expect(probe.stopFailed.value).toBe(false);
  });

  it("reports each stopping phase and remaining script count while waiting", async () => {
    let updateProgress: (progress: MigrationServiceStopProgress) => void = () => {};
    let finishStop: (result: { ok: boolean }) => void = () => {};
    const stopMigrationService = vi.fn((options: { onProgress: typeof updateProgress }) => {
      updateProgress = options.onProgress;
      return new Promise<{ ok: boolean }>((resolve) => { finishStop = resolve; });
    });
    const { probe } = loadScript<{
      probe: { stopService(): Promise<void>; headline: Ref<string>; stopStatusText: Ref<string> };
    }>("src/components/common/StartupGate.vue", {
      vue: { computed, ref, inject: () => ({ status: "migration-required" }) },
      "../../lib/projectBridge": { getProjectBridge: () => ({ stopMigrationService }) },
    }, {}, "export const probe = { stopService, headline, stopStatusText };");
    const pending = probe.stopService();
    expect(probe.headline.value).toBe("正在检查服务");
    updateProgress({ stage: "stopping-scripts", activeRunCount: 3 });
    expect(probe.headline.value).toBe("正在停止脚本");
    expect(probe.stopStatusText.value).toContain("3 个尚未结束");
    updateProgress({ stage: "waiting-scripts", activeRunCount: 1 });
    expect(probe.stopStatusText.value).toBe("正在等待脚本退出，1 个尚未结束。");
    updateProgress({ stage: "stopping-service", activeRunCount: 0 });
    expect(probe.headline.value).toBe("正在停止服务");
    expect(probe.stopStatusText.value).toContain("脚本已结束");
    updateProgress({ stage: "waiting-service", activeRunCount: 0 });
    expect(probe.stopStatusText.value).toBe("正在确认服务进程退出。");
    updateProgress({ stage: "stopped", activeRunCount: 0 });
    finishStop({ ok: true });
    await pending;
  });

  it("allows retrying after active service tasks finish", async () => {
    const runMigration = vi.fn()
      .mockResolvedValueOnce({ ok: false, blocked: "active-runs", message: "Tasks still active", ledger: null })
      .mockResolvedValueOnce({ ok: true, ledger: null });
    const emit = vi.fn();
    const { probe } = loadScript<{
      probe: { canStartMigration: Ref<boolean>; startMigration(): Promise<void>; enterPlugin(): void; errorMessage: Ref<string> };
    }>("src/components/common/StartupGate.vue", {
      vue: { computed, ref, inject: () => ({ status: "migration-required" }) },
      "../../lib/projectBridge": { getProjectBridge: () => ({ runMigration, preflightStartup: () => ({ status: "ready", migration: null }) }) },
    }, { defineEmits: () => emit },
    "export const probe = { canStartMigration, startMigration, enterPlugin, errorMessage };");

    await probe.startMigration();
    expect(probe.errorMessage.value).toBe("Tasks still active");
    expect(probe.canStartMigration.value).toBe(true);
    await probe.startMigration();
    expect(runMigration).toHaveBeenCalledTimes(2);
    probe.enterPlugin();
    expect(emit).toHaveBeenCalledExactlyOnceWith("ready");
  });

  it("shows returned migration failures and reloads projects only after success", async () => {
    const runMigration = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: "Old service authentication failed", ledger: null })
      .mockResolvedValueOnce({ ok: true, ledger: null });
    const { projectCatalogActions } = loadScript<{
      projectCatalogActions: MigrationActions;
    }>("src/store/actions/projectCatalog.ts", { "../helpers/bridge": { bridge: { runMigration } } });
    const reloadProjectsFromStorage = vi.fn().mockResolvedValue(undefined);
    const state = {
      dataToolsBusy: false,
      cleanupMessage: "",
      migrationProgress: null,
      refreshStorageOverview: vi.fn().mockResolvedValue(undefined),
      reloadProjectsFromStorage,
    };

    await projectCatalogActions.retryStorageMigration.call(state);
    expect(state.cleanupMessage).toBe("Old service authentication failed");
    expect(state.dataToolsBusy).toBe(false);
    expect(reloadProjectsFromStorage).not.toHaveBeenCalled();
    await projectCatalogActions.retryStorageMigration.call(state);
    expect(reloadProjectsFromStorage).toHaveBeenCalledOnce();
    expect(state.dataToolsBusy).toBe(false);
  });

  it("retains an exception message and unlocks settings for another attempt", async () => {
    const { projectCatalogActions } = loadScript<{
      projectCatalogActions: MigrationActions;
    }>("src/store/actions/projectCatalog.ts", {
      "../helpers/bridge": { bridge: { runMigration: vi.fn().mockRejectedValue(new Error("Write failed")) } },
    }, { Error });
    const state = {
      dataToolsBusy: false,
      cleanupMessage: "",
      migrationProgress: null,
      refreshStorageOverview: vi.fn().mockResolvedValue(undefined),
      reloadProjectsFromStorage: vi.fn().mockResolvedValue(undefined),
    };

    expect(await projectCatalogActions.retryStorageMigration.call(state)).toBeNull();
    expect(state.cleanupMessage).toBe("Write failed");
    expect(state.dataToolsBusy).toBe(false);
  });
});

describe("migration service asynchronous identity", () => {
  function createIdentityCheck(platform: string) {
    let finishQuery: (error: Error | null, output: string) => void = () => {};
    let alive = true;
    const execFile = vi.fn((_command, _args, _options, callback: typeof finishQuery) => {
      finishQuery = callback;
    });
    const spawnSync = vi.fn(() => { throw new Error("Synchronous queries must not be used"); });
    const { probe } = loadScript<{
      probe: { projectLaunchServiceProcessMatchesAsync(discovery: { pid: number; processIdentity: string }): Promise<boolean | null> };
    }>("public/preload/project-launch-service.js", {}, {
      process: {
        platform, env: {}, kill: () => {
          if (!alive) throw Object.assign(new Error("Exited"), { code: "ESRCH" });
        },
      },
      execFile,
      spawnSync,
      projectLaunchServiceRequestTimeoutMs: 3000,
    }, "export const probe = { projectLaunchServiceProcessMatchesAsync };");
    return { probe, execFile, spawnSync, finish: (error: Error | null, output: string) => finishQuery(error, output), exit: () => { alive = false; } };
  }

  it.each([
    { platform: "win32", executable: "powershell.exe", output: "123456", identity: "windows:123456" },
    { platform: "darwin", executable: "ps", output: "Wed Oct 14 14:00:00 2026", identity: "darwin:Wed Oct 14 14:00:00 2026" },
  ])("keeps the event loop free during $platform process queries", async ({ platform, executable, output, identity }) => {
    const { probe, execFile, spawnSync, finish } = createIdentityCheck(platform);
    let settled = false;
    const pending = probe.projectLaunchServiceProcessMatchesAsync({ pid: 123, processIdentity: identity });
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(execFile.mock.calls[0][0]).toBe(executable);
    expect(spawnSync).not.toHaveBeenCalled();
    finish(null, output);
    expect(await pending).toBe(true);
  });

  it("keeps unknown and mismatched identities distinct from exited processes", async () => {
    const unknown = createIdentityCheck("win32");
    const pendingUnknown = unknown.probe.projectLaunchServiceProcessMatchesAsync({ pid: 123, processIdentity: "windows:123" });
    unknown.finish(new Error("Denied"), "");
    expect(await pendingUnknown).toBeNull();
    const mismatch = createIdentityCheck("win32");
    const pendingMismatch = mismatch.probe.projectLaunchServiceProcessMatchesAsync({ pid: 123, processIdentity: "windows:123" });
    mismatch.finish(null, "456");
    expect(await pendingMismatch).toBe(false);
    const exited = createIdentityCheck("win32");
    const pendingExit = exited.probe.projectLaunchServiceProcessMatchesAsync({ pid: 123, processIdentity: "windows:123" });
    exited.exit();
    exited.finish(new Error("Exited"), "");
    expect(await pendingExit).toBe(false);
  });
});

describe("migration progress rendering", () => {
  it("renders consistent totals and all individual failure and skip reasons", async () => {
    const summary: MigrationSummary = {
      status: "failed", startedAt: "", completedAt: "", totalCount: 27,
      verifiedCount: 25, failedCount: 2, pendingCount: 0,
      failedItems: [],
      items: [
        { id: "first", kind: "preferences", label: "First failure", status: "failed", error: "First reason with a long path" },
        { id: "second", kind: "private-project", label: "Second failure", status: "failed", error: "Second reason\nwith another line" },
        { id: "foreign", kind: "private-project", label: "Foreign project", status: "skipped", error: "Belongs to another device" },
      ],
    };
    summary.failedItems = summary.items.filter((item) => item.status === "failed");
    const { probe } = loadScript<{ probe: Record<string, unknown> }>("src/components/common/StartupGate.vue", {
      vue: { computed, ref, inject: () => ({ status: "migration-incomplete", migration: summary }) },
      "../../lib/projectBridge": { getProjectBridge: () => ({ stopMigrationService: async () => ({ ok: false, error: "Stop failed" }) }) },
    }, {}, "export const probe = { currentPreflight, isUpgradeRequired, isMigrationBlocked, isReady, headline, description, progress, progressPercent, processedCount, successfulCount, skippedCount, stopping, running, itemsProcessed, errorMessage, canEnter, canStartMigration, startButtonLabel, stopFailed, serviceStopMessage, stopStatusText, enterPlugin, startMigration, stopService };");
    const source = readFileSync(new URL("../src/components/common/StartupGate.vue", import.meta.url), "utf8");
    const template = parse(source).descriptor.template!.content;
    const render = runInNewContext(`(function () { ${compile(template, { mode: "function", prefixIdentifiers: true }).code} })()`, { Vue });
    const icon = { render: () => null };
    const app = Vue.createSSRApp({
      components: { ArrowRight: icon, Check: icon, LoaderCircle: icon, RefreshCw: icon, Square: icon },
      setup: () => probe,
      render,
    });
    app.directive("overlay-scrollbar", {});
    const html = await renderToString(app);
    expect(html).toContain("处理进度：27/27 项");
    expect(html).toContain("100%");
    expect(html).toContain("成功 24 项");
    expect(html).toContain("跳过 1 项");
    expect(html).toContain("失败 2 项");
    expect(html).toContain("First reason with a long path");
    expect(html).toContain("Second reason\nwith another line");
    expect(html).toContain("Belongs to another device");
    expect((html.match(/<details/g) ?? []).length).toBe(3);
    await (probe.stopService as () => Promise<void>)();
    const failedHtml = await renderToString(app);
    expect(failedHtml).toContain("停止服务失败");
    expect(failedHtml).toContain("重试停止服务");
  });
});

describe("startup migration completion", () => {
  const summary: MigrationSummary = {
    status: "in-progress", startedAt: "", completedAt: "", totalCount: 27,
    verifiedCount: 27, pendingCount: 0, failedCount: 0, failedItems: [], items: [],
  };

  function createGate() {
    let finishMigration: (result: MigrationRunResult) => void = () => {};
    const emit = vi.fn();
    const preflightStartup = vi.fn(() => ({
      status: "migration-incomplete", migration: summary, message: "The final result is not saved",
    }));
    const runMigration = vi.fn((options: { onProgress: (progress: MigrationSummary) => void }) => {
      options.onProgress(summary);
      return new Promise<MigrationRunResult>((resolve) => { finishMigration = resolve; });
    });
    const { probe } = loadScript<{
      probe: {
        headline: Ref<string>;
        canEnter: Ref<boolean>;
        canStartMigration: Ref<boolean>;
        errorMessage: Ref<string>;
        startMigration(): Promise<void>;
        enterPlugin(): void;
      };
    }>("src/components/common/StartupGate.vue", {
      vue: { computed, ref, inject: () => ({ status: "migration-incomplete", migration: summary }) },
      "../../lib/projectBridge": { getProjectBridge: () => ({ runMigration, preflightStartup }) },
    }, { defineEmits: () => emit },
    "export const probe = { headline, canEnter, canStartMigration, errorMessage, startMigration, enterPlugin };");
    return { probe, emit, preflightStartup, finish: (result: MigrationRunResult) => finishMigration(result) };
  }

  it("updates the heading after 27/27 items and offers entry without refreshing the page", async () => {
    const { probe, emit, preflightStartup, finish } = createGate();
    const pending = probe.startMigration();
    expect(probe.headline.value).toBe("正在确认迁移结果");
    expect(probe.canEnter.value).toBe(false);
    probe.enterPlugin();
    expect(emit).not.toHaveBeenCalled();
    const completed = { ...summary, status: "completed" };
    preflightStartup.mockReturnValue({ status: "ready", migration: completed, message: "" });
    finish({ ok: true, ledger: completed });
    await pending;
    expect(probe.headline.value).toBe("数据迁移已完成");
    expect(probe.canEnter.value).toBe(true);
    expect(probe.canStartMigration.value).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    probe.enterPlugin();
    expect(emit).toHaveBeenCalledExactlyOnceWith("ready");
  });

  it("does not treat 27/27 items as completed if the final result is not saved", async () => {
    const { probe, emit, finish } = createGate();
    const pending = probe.startMigration();
    finish({ ok: true, ledger: summary });
    await pending;
    expect(probe.canEnter.value).toBe(false);
    expect(probe.canStartMigration.value).toBe(true);
    expect(probe.errorMessage.value).toBe("The final result is not saved");
    probe.enterPlugin();
    expect(emit).not.toHaveBeenCalled();
  });

  it("rechecks readiness when entry is clicked and rejects newly pending data", async () => {
    const { probe, emit, preflightStartup, finish } = createGate();
    preflightStartup.mockReturnValue({ status: "ready", migration: { ...summary, status: "completed" }, message: "" });
    const pending = probe.startMigration();
    finish({ ok: true, ledger: { ...summary, status: "completed" } });
    await pending;
    preflightStartup.mockReturnValue({ status: "migration-required", migration: summary, message: "More data arrived" });
    probe.enterPlugin();
    expect(emit).not.toHaveBeenCalled();
    expect(probe.canEnter.value).toBe(false);
    expect(probe.errorMessage.value).toBe("More data arrived");
  });

  it("switches the root from the migration gate to the app only after the ready event", () => {
    let rootSetup: () => () => { component: string; props?: { onReady(): void } } = () => () => ({ component: "" });
    const app = { provide: vi.fn(), use: vi.fn(), directive: vi.fn(), mount: vi.fn() };
    loadScript("src/main.ts", {
      vue: {
        ref,
        defineComponent: (definition: { setup: typeof rootSetup }) => definition,
        h: (component: string, props?: { onReady(): void }) => ({ component, props }),
        createApp: (definition: { setup: typeof rootSetup }) => { rootSetup = definition.setup; return app; },
      },
      pinia: { createPinia: vi.fn() },
      "./App.vue": { default: "app" },
      "./components/common/StartupGate.vue": { default: "gate" },
      "./lib/projectBridge": { getProjectBridge: () => ({ preflightStartup: () => ({ status: "migration-required" }) }) },
    }, { window: {}, performance: { now: () => 0 } });
    const render = rootSetup();
    const initial = render();
    expect(initial.component).toBe("gate");
    initial.props?.onReady();
    expect(render().component).toBe("app");
    expect(app.mount).toHaveBeenCalledExactlyOnceWith("#root");
  });
});

describe("late legacy data prompt", () => {
  function createPrompt() {
    const preflightStartup = vi.fn(() => ({ status: "ready", message: "" }));
    const store = {
      activeTab: "projects",
      selectedProjectId: null,
      theme: "light",
      dataToolsBusy: false,
      cleanupMessage: "",
      scheduleProjectCatalogReload: vi.fn().mockResolvedValue(undefined),
      retryStorageMigration: vi.fn().mockResolvedValue({ ok: true }),
      loadProjects: vi.fn().mockResolvedValue(undefined),
      setIconPackColorMode: vi.fn(),
    };
    const onDbPull = vi.fn();
    const mounted: (() => void)[] = [];
    const { probe } = loadScript<{
      probe: {
        handleDatabasePull(): void;
        resumeStorageMigration(): Promise<void>;
        migrationPromptOpen: Ref<boolean>;
        migrationPromptMessage: Ref<string>;
      };
    }>("src/App.vue", {
      vue: { computed, ref, watch: vi.fn(), onMounted: (callback: () => void) => mounted.push(callback), onUnmounted: vi.fn() },
      "./store/useStore": { useStore: () => store },
      "./lib/i18n": { useI18n: () => ref({ common: { search: "Search" } }) },
      "./composables/useGlobalActionStatus": { useGlobalActionStatus: () => ({}) },
      "./lib/projectBridge": { getProjectBridge: () => ({ preflightStartup }) },
    }, {
      console,
      window: {
        utools: { onDbPull },
        addEventListener: vi.fn(),
        matchMedia: () => ({ addEventListener: vi.fn() }),
      },
      document: {
        documentElement: { classList: { remove: vi.fn() } },
        addEventListener: vi.fn(),
      },
    }, "export const probe = { handleDatabasePull, resumeStorageMigration, migrationPromptOpen, migrationPromptMessage };");
    return { probe, store, preflightStartup, onDbPull, mounted };
  }

  it("registers one pull handler and prompts once without automatically migrating", async () => {
    const { probe, store, preflightStartup, onDbPull, mounted } = createPrompt();
    mounted[0]();
    await Promise.resolve();
    expect(onDbPull).toHaveBeenCalledExactlyOnceWith(probe.handleDatabasePull);
    expect(probe.migrationPromptOpen.value).toBe(false);

    preflightStartup.mockReturnValue({ status: "migration-required", message: "New local legacy data" });
    probe.handleDatabasePull();
    expect(probe.migrationPromptOpen.value).toBe(true);
    expect(probe.migrationPromptMessage.value).toBe("New local legacy data");
    expect(store.retryStorageMigration).not.toHaveBeenCalled();
    probe.migrationPromptOpen.value = false;
    probe.handleDatabasePull();
    expect(probe.migrationPromptOpen.value).toBe(false);
    expect(store.scheduleProjectCatalogReload).toHaveBeenCalledTimes(2);
  });

  it("keeps failures visible for retry and can prompt for later arrivals after success", async () => {
    const { probe, store, preflightStartup } = createPrompt();
    preflightStartup.mockReturnValue({ status: "migration-required", message: "New local legacy data" });
    probe.handleDatabasePull();
    store.cleanupMessage = "Old service is busy";
    store.retryStorageMigration.mockResolvedValueOnce({ ok: false });
    await probe.resumeStorageMigration();
    expect(probe.migrationPromptOpen.value).toBe(true);
    expect(probe.migrationPromptMessage.value).toBe("Old service is busy");
    await probe.resumeStorageMigration();
    expect(probe.migrationPromptOpen.value).toBe(false);
    probe.handleDatabasePull();
    expect(probe.migrationPromptOpen.value).toBe(true);
  });
});