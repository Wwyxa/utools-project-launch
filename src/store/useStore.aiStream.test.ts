import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { getProjectBridge } from "../lib/projectBridge";
import { ProjectStatus, type Project } from "../types";

const stubWindow = () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    navigator: { platform: "MacIntel", userAgent: "vitest" },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    projectBridge: undefined,
  });
};

const project: Project = {
  id: "ai-project",
  name: "AI Project",
  path: "/workspace/ai-project",
  type: "Custom",
  kind: "custom",
  status: ProjectStatus.STOPPED,
  scripts: [],
  env: {},
};

describe("AI stream completion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reports a terminal error when the bridge omits its completion callback", async () => {
    stubWindow();
    const fallback = getProjectBridge();
    window.projectBridge = {
      ...fallback,
      analyzeWithAiStream: async (_payload, onChunk) => {
        onChunk({ content: "partial result" });
      },
    };
    const { useStore } = await import("./useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [project];
    const onDone = vi.fn();

    const result = await store.analyzeGitWithAiStream(project.id, "prompt", { onDone });

    expect(result).toEqual({ ok: false, content: "", message: "AI 流式响应未返回完成结果。" });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(result);
  });

  it("forwards only the first terminal result from the bridge", async () => {
    stubWindow();
    const fallback = getProjectBridge();
    window.projectBridge = {
      ...fallback,
      analyzeWithAiStream: async (_payload, _onChunk, onDone) => {
        onDone({ ok: true, content: "complete result" });
        onDone({ ok: false, content: "", message: "duplicate terminal result" });
      },
    };
    const { useStore } = await import("./useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.projects = [project];
    const onDone = vi.fn();

    const result = await store.analyzeGitWithAiStream(project.id, "prompt", { onDone });

    expect(result).toEqual({ ok: true, content: "complete result" });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(result);
  });
});
