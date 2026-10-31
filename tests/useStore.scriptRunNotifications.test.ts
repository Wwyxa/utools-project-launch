import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ProjectStatus, type Project, type ProjectScript } from "../src/types";

const stubWindow = (notifications: string[]) => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    navigator: { platform: "MacIntel", userAgent: "vitest" },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    projectBridge: undefined,
    utools: {
      showNotification: (body: string) => {
        notifications.push(body);
      },
    },
  });
};

const script = (id: string, status: ProjectScript["status"]): ProjectScript => ({
  id,
  name: `script-${id}`,
  command: "npm run demo",
  status,
});

const project = (scripts: ProjectScript[]): Project => ({
  id: "notify-project",
  name: "Notify Project",
  path: "/workspace/notify-project",
  type: "Custom",
  kind: "custom",
  status: ProjectStatus.STOPPED,
  scripts,
  env: {},
});

describe("script run finish notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("notifies armed runs once on a terminal status and keeps running ones armed", async () => {
    const notifications: string[] = [];
    stubWindow(notifications);
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [project([script("failed", "RUNNING"), script("done", "RUNNING")])];
    store.toggleScriptRunNotification("notify-project", "failed");
    store.toggleScriptRunNotification("notify-project", "done");

    store.notifyFinishedArmedScriptRuns();
    expect(notifications).toHaveLength(0);

    store.projects[0].scripts[0].status = "ERROR";
    store.projects[0].scripts[1].status = "IDLE";
    store.notifyFinishedArmedScriptRuns();

    expect(notifications).toEqual([
      "项目“Notify Project”脚本“script-failed”失败",
      "项目“Notify Project”脚本“script-done”已完成",
    ]);
    expect(store.scriptRunNotificationArmed).toEqual({});

    store.notifyFinishedArmedScriptRuns();
    expect(notifications).toHaveLength(2);
  });
});
