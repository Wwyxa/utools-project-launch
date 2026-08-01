import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectBridge } from "../lib/projectBridge";

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

describe("project form script discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("adds only selected unique candidates without removing manual entries", async () => {
    stubWindow();
    const fallback = getProjectBridge();
    window.projectBridge = {
      ...fallback,
      discoverProjectScripts: async () => ({
        scripts: [
          { name: "dev", command: "npm run dev", cwd: ".", source: "package-json" as const },
          { name: "start", command: "make start", cwd: ".", source: "makefile" as const },
        ],
      }),
    };
    const { useStore } = await import("./useStore");
    setActivePinia(createPinia());
    const store = useStore();
    store.openCreateProjectForm();
    store.updateProjectForm({ path: "/project" });
    store.updateScriptEntry(store.projectFormDraft.scripts[0]!.id, { command: "manual start" });

    const candidates = await store.discoverProjectFormScripts(["makefile"]);
    expect(store.importProjectFormScripts([candidates[1]!])).toBe(1);
    expect(store.importProjectFormScripts([candidates[1]!])).toBe(0);

    expect(store.projectFormDraft.scripts.map((script) => script.command)).toEqual(["manual start", "make start"]);
  });
});
