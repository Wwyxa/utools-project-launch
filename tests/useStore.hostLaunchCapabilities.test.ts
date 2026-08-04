import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectBridge } from "../src/lib/projectBridge";
import type { HostLaunchCapabilities, HostLaunchCapabilityRequest, ProjectBridge } from "../src/types";

const stubWindow = () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    navigator: { platform: "Win32", userAgent: "vitest" },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    setTimeout,
    clearTimeout,
    projectBridge: undefined,
  });
};

describe("host launch capability detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not detect launch capabilities while loading projects", async () => {
    stubWindow();
    const fallback = getProjectBridge();
    const detectHostLaunchCapabilities = vi.fn<ProjectBridge["detectHostLaunchCapabilities"]>();
    window.projectBridge = {
      ...fallback,
      loadProjects: vi.fn(async () => []),
      detectHostLaunchCapabilities,
    };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    await store.loadProjects();

    expect(store.projectsLoaded).toBe(true);
    expect(detectHostLaunchCapabilities).not.toHaveBeenCalled();
  });

  it("tracks and merges terminal and editor detection independently", async () => {
    stubWindow();
    const fallback = getProjectBridge();
    const resolvers = new Map<HostLaunchCapabilityRequest["scope"], (capabilities: HostLaunchCapabilities) => void>();
    const detectHostLaunchCapabilities = vi.fn<ProjectBridge["detectHostLaunchCapabilities"]>(
      (request) => new Promise((resolve) => resolvers.set(request.scope, resolve)),
    );
    window.projectBridge = { ...fallback, detectHostLaunchCapabilities };

    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();

    const terminalDetection = store.refreshHostLaunchCapabilities("terminals");
    void store.refreshHostLaunchCapabilities("terminals");
    expect(store.hostTerminalCapabilitiesRefreshing).toBe(true);
    expect(store.hostEditorCapabilitiesRefreshing).toBe(false);
    expect(store.projectStatusMessage).toBe("正在检测可用终端...");
    expect(detectHostLaunchCapabilities).toHaveBeenCalledTimes(1);
    expect(detectHostLaunchCapabilities).toHaveBeenLastCalledWith({ scope: "terminals" });

    resolvers.get("terminals")?.({
      platform: "win32",
      terminals: [
        { kind: "windows-terminal", name: "Windows Terminal", available: true },
        { kind: "powershell", name: "PowerShell", available: true },
        { kind: "cmd", name: "CMD", available: true },
      ],
      editors: [],
      checkedAt: "2026-08-04T12:00:00.000Z",
    });
    await terminalDetection;
    expect(store.hostTerminalCapabilitiesRefreshing).toBe(false);
    expect(store.hostLaunchCapabilities?.terminals).toHaveLength(3);
    expect(store.projectStatusMessageState).toBe("success");

    const editorDetection = store.refreshHostLaunchCapabilities("editors");
    expect(store.hostTerminalCapabilitiesRefreshing).toBe(false);
    expect(store.hostEditorCapabilitiesRefreshing).toBe(true);
    expect(store.projectStatusMessage).toBe("正在检测可用预置应用...");
    resolvers.get("editors")?.({
      platform: "win32",
      terminals: [],
      editors: [
        { kind: "vscode", name: "VS Code", available: true },
        { kind: "cursor", name: "Cursor", available: false },
      ],
      checkedAt: "2026-08-04T12:01:00.000Z",
    });
    await editorDetection;

    expect(store.hostEditorCapabilitiesRefreshing).toBe(false);
    expect(store.hostLaunchCapabilities?.terminals).toHaveLength(3);
    expect(store.hostLaunchCapabilities?.editors).toEqual([
      { kind: "vscode", name: "VS Code", available: true },
      { kind: "cursor", name: "Cursor", available: false },
    ]);
    expect(store.projectStatusMessage).toBe("预置应用检测完成，发现 1 个可用项。");
    store.setProjectStatusMessage("idle", "");
  });
});
