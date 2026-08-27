import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectBridge } from "../src/lib/projectBridge";
import { ProjectStatus, type Project } from "../src/types";

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
    const { useStore } = await import("../src/store/useStore");
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

  it("opens a copied project as an editable new draft with fresh runtime identities", async () => {
    stubWindow();
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const source: Project = {
      id: "source-project",
      name: "API",
      path: "/workspace/api",
      visibility: "private",
      type: "Node.js",
      kind: "node",
      icon: "node",
      cardStyle: "tiny",
      tinyCardButtonCount: 0,
      quickLink: "http://localhost:3000",
      group: "Services",
      description: "Source project",
      memo: "Keep this note",
      status: ProjectStatus.STOPPED,
      scripts: [
        {
          id: "source-script",
          name: "dev",
          command: "npm run dev",
          status: "IDLE",
          cwd: ".",
          note: "watch",
          source: "manual",
        },
      ],
      env: { API_PORT: "3000" },
      automationTasks: [],
    };
    store.projects = [source];

    store.openDuplicateProjectForm(source.id);

    expect(store.projectFormMode).toBe("duplicate");
    expect(store.projectFormDraft).toMatchObject({
      id: null,
      name: "API - Copy",
      path: source.path,
      quickLink: source.quickLink,
      group: source.group,
      cardStyle: source.cardStyle,
      tinyCardButtonCount: 0,
      description: source.description,
      memo: source.memo,
      envEntries: [expect.objectContaining({ key: "API_PORT", value: "3000" })],
      scripts: [expect.objectContaining({ id: "", command: "npm run dev", source: "manual" })],
    });

    const copiedProjectId = await store.saveProjectForm();
    const copiedProject = store.projects.find((project) => project.id === copiedProjectId);
    expect(copiedProject).toEqual(
      expect.objectContaining({
        id: expect.not.stringMatching(/^source-project$/),
        name: "API - Copy",
        env: { API_PORT: "3000" },
        cardStyle: "tiny",
        tinyCardButtonCount: 0,
      }),
    );
    expect(copiedProject?.scripts[0]?.id).not.toBe(source.scripts[0]?.id);
    expect(store.projects.find((project) => project.id === source.id)).toMatchObject({
      id: source.id,
      name: source.name,
      scripts: [expect.objectContaining({ id: source.scripts[0]?.id })],
    });
  });

  it("reorders persisted project scripts when their drag handles are dropped", async () => {
    stubWindow();
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const project: Project = {
      id: "ordered-project",
      name: "Ordered",
      path: "/workspace/ordered",
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [
        { id: "first", name: "first", command: "first", status: "IDLE", cwd: ".", note: "", source: "manual" },
        { id: "second", name: "second", command: "second", status: "IDLE", cwd: ".", note: "", source: "manual" },
      ],
      env: {},
    };
    store.projects = [project];

    expect(store.reorderProjectScripts(project.id, "first", "second")).toBe(true);
    expect(store.projects[0]?.scripts.map((script) => script.id)).toEqual(["second", "first"]);
  });

  it("places a dashboard project after its drop target when moving down", async () => {
    stubWindow();
    const { useStore } = await import("../src/store/useStore");
    setActivePinia(createPinia());
    const store = useStore();
    const projects: Project[] = ["first", "second", "third"].map((projectId) => ({
      id: projectId,
      name: projectId,
      path: `/workspace/${projectId}`,
      type: "Custom",
      kind: "custom",
      status: ProjectStatus.STOPPED,
      scripts: [],
      env: {},
    }));
    store.projects = projects;

    await expect(
      store.reorderProject(
        "first",
        "second",
        projects.map((project) => project.id),
        "after",
      ),
    ).resolves.toBe(true);
    expect(store.projects.map((project) => project.id)).toEqual(["second", "first", "third"]);
  });
});
