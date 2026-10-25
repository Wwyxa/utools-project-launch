// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { parse } from "@vue/compiler-sfc";
import { baseParse, compile } from "@vue/compiler-dom";
import { renderToString } from "@vue/server-renderer";
import * as Vue from "vue";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { computed, ref, type Ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { AppStore } from "../src/store/appStoreShape";
import { overlayScrollbar } from "../src/lib/overlayScrollbar";
import { OverlayScrollbars } from "overlayscrollbars";
import type {
  CleanupPlan,
  CleanupPlanItem,
  MigrationRunResult,
  MigrationServiceStopProgress,
  MigrationSummary,
} from "../src/types";

type MigrationStore = Pick<
  AppStore,
  "dataToolsBusy" | "cleanupMessage" | "migrationProgress" | "refreshStorageOverview" | "reloadProjectsFromStorage"
>;
type MigrationActions = {
  retryStorageMigration(this: MigrationStore): Promise<MigrationRunResult | null>;
};

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
  it("defers settings disk scans until after the first paint and cancels initialization on unmount", async () => {
    const frames: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();
    const store = {
      refreshAiModels: vi.fn().mockResolvedValue(undefined),
      aiPreferences: { provider: "custom" },
      projectLaunchServicePreferences: { enabled: false },
      refreshRuntimeRecordRetention: vi.fn().mockResolvedValue({ policy: {} }),
      refreshStorageOverview: vi.fn().mockResolvedValue(undefined),
      refreshGithubAuthStatus: vi.fn().mockResolvedValue(undefined),
    };
    let mount = () => {};
    let unmount = () => {};
    loadScript(
      "src/components/layout/SettingsTab.vue",
      {
        vue: {
          computed,
          ref,
          watch: vi.fn(),
          onMounted: (callback: () => void) => {
            mount = callback;
          },
          onUnmounted: (callback: () => void) => {
            unmount = callback;
          },
        },
        "../../store/useStore": { useStore: () => store },
        "../../lib/i18n": { useI18n: () => ref({}) },
        "../../lib/overlayScrollbar": { getOverlayScrollbarScrollElements: () => null },
      },
      {
        window: {
          navigator: { platform: "Win32" },
          requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
          cancelAnimationFrame,
        },
      },
    );
    mount();
    expect(store.refreshRuntimeRecordRetention).not.toHaveBeenCalled();
    expect(store.refreshStorageOverview).not.toHaveBeenCalled();
    frames[0]!(0);
    expect(store.refreshRuntimeRecordRetention).not.toHaveBeenCalled();
    frames[1]!(16);
    await Vue.nextTick();
    expect(store.refreshRuntimeRecordRetention).toHaveBeenCalledOnce();
    expect(store.refreshStorageOverview).toHaveBeenCalledOnce();
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(2);
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

  it("displays a service stop failure and allows stopping again", async () => {
    const stopMigrationService = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "Stopping scripts timed out" })
      .mockResolvedValueOnce({ ok: true });
    const { probe } = loadScript<{
      probe: {
        stopService(): Promise<void>;
        errorMessage: Ref<string>;
        stopping: Ref<boolean>;
        headline: Ref<string>;
        stopFailed: Ref<boolean>;
      };
    }>(
      "src/components/common/StartupGate.vue",
      {
        vue: { computed, ref, inject: () => ({ status: "migration-required" }) },
        "../../lib/projectBridge": { getProjectBridge: () => ({ stopMigrationService }) },
      },
      {},
      "export const probe = { stopService, errorMessage, stopping, headline, stopFailed };",
    );

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
      return new Promise<{ ok: boolean }>((resolve) => {
        finishStop = resolve;
      });
    });
    const { probe } = loadScript<{
      probe: { stopService(): Promise<void>; headline: Ref<string>; stopStatusText: Ref<string> };
    }>(
      "src/components/common/StartupGate.vue",
      {
        vue: { computed, ref, inject: () => ({ status: "migration-required" }) },
        "../../lib/projectBridge": { getProjectBridge: () => ({ stopMigrationService }) },
      },
      {},
      "export const probe = { stopService, headline, stopStatusText };",
    );
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
    const runMigration = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, blocked: "active-runs", message: "Tasks still active", ledger: null })
      .mockResolvedValueOnce({ ok: true, ledger: null });
    const emit = vi.fn();
    const { probe } = loadScript<{
      probe: {
        canStartMigration: Ref<boolean>;
        startMigration(): Promise<void>;
        enterPlugin(): void;
        errorMessage: Ref<string>;
      };
    }>(
      "src/components/common/StartupGate.vue",
      {
        vue: { computed, ref, inject: () => ({ status: "migration-required" }) },
        "../../lib/projectBridge": {
          getProjectBridge: () => ({ runMigration, preflightStartup: () => ({ status: "ready", migration: null }) }),
        },
      },
      { defineEmits: () => emit },
      "export const probe = { canStartMigration, startMigration, enterPlugin, errorMessage };",
    );

    await probe.startMigration();
    expect(probe.errorMessage.value).toBe("Tasks still active");
    expect(probe.canStartMigration.value).toBe(true);
    await probe.startMigration();
    expect(runMigration).toHaveBeenCalledTimes(2);
    probe.enterPlugin();
    expect(emit).toHaveBeenCalledExactlyOnceWith("ready");
  });

  it("shows returned migration failures and reloads projects only after success", async () => {
    const runMigration = vi
      .fn()
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
    }>(
      "src/store/actions/projectCatalog.ts",
      {
        "../helpers/bridge": { bridge: { runMigration: vi.fn().mockRejectedValue(new Error("Write failed")) } },
      },
      { Error },
    );
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

describe("settings data cleanup", () => {
  const personalItem: CleanupPlanItem = {
    id: "sync-legacy-dbstorage",
    category: "sync",
    label: "遗留 dbStorage 配置",
    description: "旧配置",
    recommendation: "review",
    safetyHint: "确认所有设备完成迁移后再清理。",
    keys: ["utools-project-launch.ai-settings.v1"],
    kind: "dbstorage-keys",
    paths: [],
    disabledReason: "",
    selectedByDefault: false,
    estimatedBytes: 0,
    count: 1,
  };
  const plan: CleanupPlan = {
    items: [
      personalItem,
      {
        ...personalItem,
        id: "local-private-projects",
        category: "local",
        label: "私有项目",
        recommendation: "keep",
        safetyHint: "仅有本机副本，建议保留。",
        keys: [],
        paths: ["C:/test/projects"],
      },
      {
        ...personalItem,
        id: "cache-temp-directory",
        category: "cache",
        label: "临时目录",
        recommendation: "recommended",
        keys: [],
        selectedByDefault: true,
      },
      {
        ...personalItem,
        id: "cache-git-activity",
        category: "cache",
        label: "Git 活动缓存",
        recommendation: "keep",
        keys: [],
        selectedByDefault: false,
      },
      {
        ...personalItem,
        id: "cache-service-downloads",
        category: "cache",
        label: "服务下载残留",
        keys: [],
        selectedByDefault: true,
        disabledReason: "服务正在运行",
      },
    ],
    serviceRunning: false,
    syncReplicating: false,
  };

  function createCleanupSettings() {
    let finishPaint: () => void = () => {};
    const paint = new Promise<void>((resolve) => {
      finishPaint = resolve;
    });
    let finishScan: (result: CleanupPlan) => void = () => {};
    let failScan: (error: Error) => void = () => {};
    const getCleanupPlan = vi.fn(
      () =>
        new Promise<CleanupPlan>((resolve, reject) => {
          finishScan = resolve;
          failScan = reject;
        }),
    );
    const { projectCatalogActions } = loadScript<{
      projectCatalogActions: {
        loadCleanupPlan(this: { cleanupPlan: CleanupPlan | null; cleanupMessage: string }): Promise<void>;
      };
    }>("src/store/actions/projectCatalog.ts", { "../helpers/bridge": { bridge: { getCleanupPlan } } }, { Error });
    const store = Vue.reactive({
      cleanupPlan: plan as CleanupPlan | null,
      cleanupSelectedIds: ["stale-selection"],
      cleanupResults: [],
      cleanupMessage: "stale message",
      cleanupRunning: false,
      projectLaunchServicePreferences: { enabled: false },
      loadCleanupPlan: () => projectCatalogActions.loadCleanupPlan.call(store),
      runCleanup: vi.fn(),
    });
    const { translations } = loadScript<{ translations: { "zh-CN": Record<string, unknown> } }>(
      "src/lib/i18n.ts",
      {},
      {},
      "export const translations = messages;",
    );
    const { probe } = loadScript<{
      probe: {
        store: typeof store;
        cleanupDialogOpen: Ref<boolean>;
        cleanupScanning: Ref<boolean>;
        cleanupConfirmOpen: Ref<boolean>;
        cleanupSelection: Ref<Record<string, boolean>>;
        cleanupRunnable: Ref<boolean>;
        openCleanupDialog(): Promise<void>;
        requestCleanupRun(): void;
        runSelectedCleanup(): void;
      } & Record<string, unknown>;
    }>(
      "src/components/layout/SettingsTab.vue",
      {
        vue: { computed, ref, watch: vi.fn(), onMounted: vi.fn(), onUnmounted: vi.fn() },
        "../../store/useStore": { useStore: () => store },
        "../../lib/i18n": { useI18n: () => ref(translations["zh-CN"]) },
        "../../store/helpers/automationHelpers": { waitForInitialPaint: () => paint },
        "../../lib/visualFeedback": { waitForVisualFeedback: () => Promise.resolve() },
        "../common/actionStatus": { showActionStatus: vi.fn() },
      },
      { window: { navigator: { platform: "Win32" } } },
      "export const probe = { store, t, cleanupDialogOpen, cleanupScanning, cleanupConfirmOpen, cleanupSelection, cleanupRunnable, cleanupItems, openCleanupDialog, requestCleanupRun, runSelectedCleanup, formatDataSize };",
    );

    function cleanupRender() {
      const source = readFileSync(path.resolve("src/components/layout/SettingsTab.vue"), "utf8");
      const template = baseParse(parse(source).descriptor.template!.content);
      // 清理弹窗现为 BaseModal 组件：抠出全部 BaseModal 实例（未 open 的不产出内容）
      template.children = template.children.filter((node) => node.type === 1 && node.tag === "BaseModal");
      const compiled = compile(template, {
        mode: "function",
        prefixIdentifiers: true,
        expressionPlugins: ["typescript"],
      });
      const renderCode = transpileModule(compiled.code, {
        compilerOptions: { target: ScriptTarget.ES2022 },
      }).outputText;
      return runInNewContext(`(function () { ${renderCode} })()`, { Vue });
    }

    // BaseModal 桩：还原真实组件的 role/aria-labelledby、滚动宿主（v-overlay-scrollbar + aria-busy）、
    // 头部关闭按钮与四个插槽，open 驱动渲染
    const baseModalStub = {
      props: ["open", "width", "height", "bodyClass", "bodyAriaBusy", "title", "ariaLabel", "labelledby", "showClose", "canClose", "as"],
      emits: ["close", "submit"],
      template:
        '<Teleport to="body"><div v-if="open" role="dialog" :aria-labelledby="labelledby || undefined">' +
        '<div><slot name="header" /><button type="button" aria-label="关闭" @click="$emit(\'close\')">x</button></div>' +
        '<div v-overlay-scrollbar :aria-busy="bodyAriaBusy || undefined"><slot /></div>' +
        "<slot name=\"footer\" /><slot name=\"footerLeft\" /></div></Teleport>",
    };

    async function renderCleanup() {
      const render = cleanupRender();
      const icon = { render: () => null };
      const app = Vue.createSSRApp({
        components: { X: icon, Info: icon, ChevronDown: icon, LoaderCircle: icon, BaseModal: baseModalStub },
        setup: () => probe,
        render,
      });
      app.directive("overlay-scrollbar", {});
      const context: { teleports?: Record<string, string> } = {};
      await renderToString(app, context);
      return context.teleports?.body || "";
    }

    function mountCleanup() {
      const icon = { render: () => null };
      const app = Vue.createApp({
        components: { X: icon, Info: icon, ChevronDown: icon, LoaderCircle: icon, BaseModal: baseModalStub },
        setup: () => probe,
        render: cleanupRender(),
      });
      app.directive("overlay-scrollbar", overlayScrollbar);
      const root = document.createElement("div");
      document.body.append(root);
      app.mount(root);
      return () => {
        app.unmount();
        root.remove();
      };
    }
    return {
      store,
      probe,
      getCleanupPlan,
      finishPaint,
      finishScan: (result = plan) => finishScan(result),
      failScan: (error: Error) => failScan(error),
      renderCleanup,
      mountCleanup,
    };
  }

  it("paints scanning feedback before starting work and keeps cleanup disabled until the scan finishes", async () => {
    const fixture = createCleanupSettings();
    const pending = fixture.probe.openCleanupDialog();
    expect(fixture.probe.cleanupScanning.value).toBe(true);
    expect(fixture.store.cleanupPlan).toBeNull();
    expect(fixture.store.cleanupSelectedIds).toEqual([]);
    expect(fixture.getCleanupPlan).not.toHaveBeenCalled();
    expect(fixture.probe.cleanupRunnable.value).toBe(false);
    fixture.probe.requestCleanupRun();
    expect(fixture.store.runCleanup).not.toHaveBeenCalled();
    expect(await fixture.renderCleanup()).toContain("正在扫描数据…");
    fixture.finishPaint();
    await vi.waitFor(() => expect(fixture.getCleanupPlan).toHaveBeenCalledOnce());
    expect(await fixture.renderCleanup()).toContain('aria-busy="true"');
    fixture.finishScan();
    await pending;
    expect(fixture.probe.cleanupScanning.value).toBe(false);
    expect(fixture.probe.cleanupSelection.value).toEqual({
      "sync-legacy-dbstorage": false,
      "local-private-projects": false,
      "cache-temp-directory": true,
      "cache-git-activity": false,
      "cache-service-downloads": false,
    });
    const html = await fixture.renderCleanup();
    expect(html).not.toContain("正在扫描数据…");
    for (const text of [
      "建议保留",
      "建议清理",
      "确认后清理",
      personalItem.keys[0],
      "C:/test/projects",
      personalItem.safetyHint,
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/<\/label>\s*<details/);
  });

  it("shows a scan failure and allows opening again to retry", async () => {
    const fixture = createCleanupSettings();
    const pending = fixture.probe.openCleanupDialog();
    fixture.finishPaint();
    await vi.waitFor(() => expect(fixture.getCleanupPlan).toHaveBeenCalledOnce());
    fixture.failScan(new Error("Cannot read storage"));
    await pending;
    expect(fixture.probe.cleanupScanning.value).toBe(false);
    expect(fixture.probe.cleanupRunnable.value).toBe(false);
    const html = await fixture.renderCleanup();
    expect(html).toContain("扫描失败，请关闭弹窗后重试。");
    expect(html).toContain("Cannot read storage");
    fixture.getCleanupPlan.mockResolvedValue(plan);
    await fixture.probe.openCleanupDialog();
    expect(fixture.probe.cleanupRunnable.value).toBe(true);
    expect(fixture.store.cleanupMessage).toBe("");
  });

  it("passes checkbox selections to execution and requires confirmation for sync data", async () => {
    const fixture = createCleanupSettings();
    fixture.finishPaint();
    fixture.getCleanupPlan.mockResolvedValue(plan);
    await fixture.probe.openCleanupDialog();
    fixture.probe.requestCleanupRun();
    expect(fixture.store.cleanupSelectedIds).toEqual(["cache-temp-directory"]);
    expect(fixture.store.runCleanup).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fixture.store.runCleanup).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fixture.probe.cleanupRunnable.value).toBe(true));
    fixture.store.runCleanup.mockClear();
    fixture.probe.cleanupSelection.value["sync-legacy-dbstorage"] = true;
    fixture.probe.requestCleanupRun();
    expect(fixture.probe.cleanupConfirmOpen.value).toBe(true);
    expect(fixture.store.runCleanup).not.toHaveBeenCalled();
    await fixture.probe.runSelectedCleanup();
    expect(fixture.store.cleanupSelectedIds).toEqual(["sync-legacy-dbstorage", "cache-temp-directory"]);
    expect(fixture.store.runCleanup).toHaveBeenCalledOnce();
  });

  it("keeps scanning feedback and results attached after the real scrollbar moves the content", async () => {
    const fixture = createCleanupSettings();
    const unmount = fixture.mountCleanup();
    try {
      const pending = fixture.probe.openCleanupDialog();
      await Vue.nextTick();
      const dialog = document.querySelector<HTMLElement>('[aria-labelledby="cleanup-dialog-title"]')!;
      const scrollHost = dialog.querySelector<HTMLElement>('[aria-busy="true"]')!;
      const scrollbar = OverlayScrollbars(scrollHost);
      expect(scrollbar).toBeDefined();
      expect(scrollbar!.elements().viewport.textContent).toContain("正在扫描数据…");
      expect(dialog.querySelectorAll<HTMLButtonElement>("button").item(2).disabled).toBe(true);
      fixture.finishPaint();
      await vi.waitFor(() => expect(fixture.getCleanupPlan).toHaveBeenCalledOnce());
      fixture.finishScan();
      await pending;
      await Vue.nextTick();
      expect(scrollbar!.elements().viewport.textContent).not.toContain("正在扫描数据…");
      expect(scrollbar!.elements().viewport.textContent).toContain(personalItem.label);
      expect(scrollbar!.elements().viewport.querySelectorAll("section")).toHaveLength(3);
      const details = scrollbar!.elements().viewport.querySelector("details")!;
      details.querySelector("summary")!.click();
      expect(details.open).toBe(true);
      expect(details.textContent).toContain(personalItem.keys[0]);
      expect(dialog.querySelectorAll<HTMLButtonElement>("button").item(2).disabled).toBe(false);
      dialog.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click();
      await Vue.nextTick();
      await vi.waitFor(() => expect(document.querySelector('[aria-labelledby="cleanup-dialog-title"]')).toBeNull());
    } finally {
      unmount();
    }
  });

  it("closes during a pending scan and renders the result when reopened", async () => {
    const fixture = createCleanupSettings();
    const unmount = fixture.mountCleanup();
    try {
      const pending = fixture.probe.openCleanupDialog();
      await Vue.nextTick();
      fixture.finishPaint();
      await vi.waitFor(() => expect(fixture.getCleanupPlan).toHaveBeenCalledOnce());
      document.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click();
      await Vue.nextTick();
      expect(fixture.probe.cleanupScanning.value).toBe(true);
      await vi.waitFor(() => expect(document.querySelector('[aria-labelledby="cleanup-dialog-title"]')).toBeNull());
      await fixture.probe.openCleanupDialog();
      await Vue.nextTick();
      expect(document.querySelector('[role="status"]')?.textContent).toContain("正在扫描数据…");
      expect(fixture.getCleanupPlan).toHaveBeenCalledOnce();
      fixture.finishScan();
      await pending;
      await Vue.nextTick();
      expect(document.querySelector('[aria-labelledby="cleanup-dialog-title"]')?.textContent).toContain(
        personalItem.label,
      );
    } finally {
      unmount();
    }
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

describe("migration service asynchronous identity", () => {
  function createIdentityCheck(platform: string) {
    let finishQuery: (error: Error | null, output: string) => void = () => {};
    let alive = true;
    const execFile = vi.fn((_command, _args, _options, callback: typeof finishQuery) => {
      finishQuery = callback;
    });
    const spawnSync = vi.fn(() => {
      throw new Error("Synchronous queries must not be used");
    });
    const { probe } = loadScript<{
      probe: {
        projectLaunchServiceProcessMatchesAsync(discovery: {
          pid: number;
          processIdentity: string;
        }): Promise<boolean | null>;
      };
    }>(
      "public/preload/project-launch-service.js",
      {},
      {
        process: {
          platform,
          env: {},
          kill: () => {
            if (!alive) throw Object.assign(new Error("Exited"), { code: "ESRCH" });
          },
        },
        execFile,
        spawnSync,
        projectLaunchServiceRequestTimeoutMs: 3000,
      },
      "export const probe = { projectLaunchServiceProcessMatchesAsync };",
    );
    return {
      probe,
      execFile,
      spawnSync,
      finish: (error: Error | null, output: string) => finishQuery(error, output),
      exit: () => {
        alive = false;
      },
    };
  }

  it.each([
    { platform: "win32", executable: "powershell.exe", output: "123456", identity: "windows:123456" },
    {
      platform: "darwin",
      executable: "ps",
      output: "Wed Oct 14 14:00:00 2026",
      identity: "darwin:Wed Oct 14 14:00:00 2026",
    },
  ])(
    "keeps the event loop free during $platform process queries",
    async ({ platform, executable, output, identity }) => {
      const { probe, execFile, spawnSync, finish } = createIdentityCheck(platform);
      let settled = false;
      const pending = probe.projectLaunchServiceProcessMatchesAsync({ pid: 123, processIdentity: identity });
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(execFile.mock.calls[0][0]).toBe(executable);
      expect(spawnSync).not.toHaveBeenCalled();
      finish(null, output);
      expect(await pending).toBe(true);
    },
  );

  it("keeps unknown and mismatched identities distinct from exited processes", async () => {
    const unknown = createIdentityCheck("win32");
    const pendingUnknown = unknown.probe.projectLaunchServiceProcessMatchesAsync({
      pid: 123,
      processIdentity: "windows:123",
    });
    unknown.finish(new Error("Denied"), "");
    expect(await pendingUnknown).toBeNull();
    const mismatch = createIdentityCheck("win32");
    const pendingMismatch = mismatch.probe.projectLaunchServiceProcessMatchesAsync({
      pid: 123,
      processIdentity: "windows:123",
    });
    mismatch.finish(null, "456");
    expect(await pendingMismatch).toBe(false);
    const exited = createIdentityCheck("win32");
    const pendingExit = exited.probe.projectLaunchServiceProcessMatchesAsync({
      pid: 123,
      processIdentity: "windows:123",
    });
    exited.exit();
    exited.finish(new Error("Exited"), "");
    expect(await pendingExit).toBe(false);
  });
});

describe("migration progress rendering", () => {
  it("renders consistent totals and all individual failure and skip reasons", async () => {
    const summary: MigrationSummary = {
      status: "failed",
      startedAt: "",
      completedAt: "",
      totalCount: 27,
      verifiedCount: 25,
      failedCount: 2,
      pendingCount: 0,
      failedItems: [],
      items: [
        {
          id: "first",
          kind: "preferences",
          label: "First failure",
          status: "failed",
          error: "First reason with a long path",
        },
        {
          id: "second",
          kind: "private-project",
          label: "Second failure",
          status: "failed",
          error: "Second reason\nwith another line",
        },
        {
          id: "foreign",
          kind: "private-project",
          label: "Foreign project",
          status: "skipped",
          error: "Belongs to another device",
        },
      ],
    };
    summary.failedItems = summary.items.filter((item) => item.status === "failed");
    const { probe } = loadScript<{ probe: Record<string, unknown> }>(
      "src/components/common/StartupGate.vue",
      {
        vue: { computed, ref, inject: () => ({ status: "migration-incomplete", migration: summary }) },
        "../../lib/projectBridge": {
          getProjectBridge: () => ({ stopMigrationService: async () => ({ ok: false, error: "Stop failed" }) }),
        },
      },
      {},
      "export const probe = { currentPreflight, isUpgradeRequired, isMigrationBlocked, isReady, headline, description, progress, progressPercent, processedCount, successfulCount, skippedCount, stopping, running, itemsProcessed, errorMessage, canEnter, canStartMigration, startButtonLabel, stopFailed, serviceStopMessage, stopStatusText, enterPlugin, startMigration, stopService };",
    );
    const source = readFileSync(path.resolve("src/components/common/StartupGate.vue"), "utf8");
    const template = parse(source).descriptor.template!.content;
    const render = runInNewContext(
      `(function () { ${compile(template, { mode: "function", prefixIdentifiers: true }).code} })()`,
      { Vue },
    );
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
    status: "in-progress",
    startedAt: "",
    completedAt: "",
    totalCount: 27,
    verifiedCount: 27,
    pendingCount: 0,
    failedCount: 0,
    failedItems: [],
    items: [],
  };

  function createGate() {
    let finishMigration: (result: MigrationRunResult) => void = () => {};
    const emit = vi.fn();
    const preflightStartup = vi.fn(() => ({
      status: "migration-incomplete",
      migration: summary,
      message: "The final result is not saved",
    }));
    const runMigration = vi.fn((options: { onProgress: (progress: MigrationSummary) => void }) => {
      options.onProgress(summary);
      return new Promise<MigrationRunResult>((resolve) => {
        finishMigration = resolve;
      });
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
    }>(
      "src/components/common/StartupGate.vue",
      {
        vue: { computed, ref, inject: () => ({ status: "migration-incomplete", migration: summary }) },
        "../../lib/projectBridge": { getProjectBridge: () => ({ runMigration, preflightStartup }) },
      },
      { defineEmits: () => emit },
      "export const probe = { headline, canEnter, canStartMigration, errorMessage, startMigration, enterPlugin };",
    );
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
    preflightStartup.mockReturnValue({
      status: "migration-required",
      migration: summary,
      message: "More data arrived",
    });
    probe.enterPlugin();
    expect(emit).not.toHaveBeenCalled();
    expect(probe.canEnter.value).toBe(false);
    expect(probe.errorMessage.value).toBe("More data arrived");
  });

  it("switches the root from the migration gate to the app only after the ready event", () => {
    let rootSetup: () => () => { component: string; props?: { onReady(): void } } = () => () => ({ component: "" });
    const app = { provide: vi.fn(), use: vi.fn(), directive: vi.fn(), mount: vi.fn(), onUnmount: vi.fn() };
    const stopScrollbars = vi.fn();
    const observeOverlayScrollbars = vi.fn(() => stopScrollbars);
    loadScript(
      "src/main.ts",
      {
        vue: {
          ref,
          defineComponent: (definition: { setup: typeof rootSetup }) => definition,
          h: (component: string, props?: { onReady(): void }) => ({ component, props }),
          createApp: (definition: { setup: typeof rootSetup }) => {
            rootSetup = definition.setup;
            return app;
          },
        },
        pinia: { createPinia: vi.fn() },
        "./App.vue": { default: "app" },
        "./components/common/StartupGate.vue": { default: "gate" },
        "./lib/projectBridge": {
          getProjectBridge: () => ({ preflightStartup: () => ({ status: "migration-required" }) }),
        },
        "./lib/overlayScrollbar": { overlayScrollbar, observeOverlayScrollbars },
      },
      { window: {}, performance: { now: () => 0 } },
    );
    const render = rootSetup();
    const initial = render();
    expect(initial.component).toBe("gate");
    initial.props?.onReady();
    expect(render().component).toBe("app");
    expect(app.mount).toHaveBeenCalledExactlyOnceWith("#root");
    expect(observeOverlayScrollbars).toHaveBeenCalledOnce();
    expect(app.onUnmount).toHaveBeenCalledExactlyOnceWith(stopScrollbars);
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
    }>(
      "src/App.vue",
      {
        vue: {
          computed,
          ref,
          watch: vi.fn(),
          onMounted: (callback: () => void) => mounted.push(callback),
          onUnmounted: vi.fn(),
        },
        "./store/useStore": { useStore: () => store },
        "./lib/i18n": { useI18n: () => ref({ common: { search: "Search" } }) },
        "./composables/useGlobalActionStatus": { useGlobalActionStatus: () => ({}) },
        "./lib/projectBridge": { getProjectBridge: () => ({ preflightStartup }) },
        "./lib/visualFeedback": { waitForVisualFeedback: () => Promise.resolve() },
      },
      {
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
      },
      "export const probe = { handleDatabasePull, resumeStorageMigration, migrationPromptOpen, migrationPromptMessage };",
    );
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
