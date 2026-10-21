// @vitest-environment happy-dom

import { createApp, nextTick, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FilesTab from "../src/components/project/FilesTab.vue";
import { ProjectStatus, type Project, type ProjectFileApplication } from "../src/types";

const store = vi.hoisted(() => ({
  locale: "en-US",
  listProjectFiles: vi.fn(),
  listProjectFileApplications: vi.fn(),
  openProjectFileWith: vi.fn(),
}));

vi.mock("../src/store/useStore", () => ({ useStore: () => store }));
vi.mock("../src/components/common/FileIcon.vue", () => ({ default: { template: "<span />" } }));

const apps: App[] = [];
const flush = async () => {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
};

beforeEach(() => {
  store.listProjectFiles.mockResolvedValue({
    entries: [
      {
        name: "note.txt",
        relativePath: "note.txt",
        path: "/project/note.txt",
        kind: "file",
        extension: ".txt",
        size: 4,
      },
    ],
  });
  store.listProjectFileApplications.mockResolvedValue([
    { id: "editor", name: "Text Editor", icon: "data:image/png;base64,icon" },
  ]);
  store.openProjectFileWith.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

const mountMenu = async () => {
  const project: Project = {
    id: "project-1",
    name: "Example",
    path: "/project",
    type: "Custom",
    kind: "custom",
    status: ProjectStatus.STOPPED,
    env: {},
    scripts: [],
  };
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp(FilesTab, { project });
  app.directive("overlay-scrollbar", {});
  app.mount(root);
  apps.push(app);
  await flush();
  root
    .querySelector<HTMLElement>('[data-tree-path="note.txt"]')!
    .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }));
  await nextTick();
  return document.body.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
};

describe("file open-with submenu", () => {
  it("loads associated applications on hover and opens the selected application", async () => {
    const trigger = await mountMenu();
    expect(store.listProjectFileApplications).toHaveBeenCalledWith("project-1", "note.txt");
    trigger.dispatchEvent(new MouseEvent("mouseenter"));
    await flush();
    const submenu = document.body.querySelector<HTMLElement>('[role="menu"][aria-label="Open with"]')!;
    expect(submenu.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,icon");
    expect(submenu.textContent).toContain("Text Editor");
    expect(submenu.textContent).toContain("Choose another application");
    expect(store.listProjectFileApplications).toHaveBeenCalledTimes(1);
    submenu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    await flush();
    expect(store.openProjectFileWith).toHaveBeenCalledWith("project-1", "note.txt", "editor");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("supports keyboard entry and return without closing the parent menu", async () => {
    const trigger = await mountMenu();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    const submenu = document.body.querySelector<HTMLElement>('[role="menu"][aria-label="Open with"]')!;
    expect(document.activeElement?.textContent).toContain("Text Editor");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement?.textContent).toContain("Choose another application");
    submenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.querySelectorAll('[role="menu"]')).toHaveLength(1);
  });

  it("keeps the other-application action available when association lookup fails", async () => {
    store.listProjectFileApplications.mockRejectedValue(new Error("unavailable"));
    const trigger = await mountMenu();
    trigger.click();
    await flush();
    const submenu = document.body.querySelector<HTMLElement>('[role="menu"][aria-label="Open with"]')!;
    expect(submenu.textContent).toContain("Unable to load applications");
    expect(submenu.querySelector('[role="status"]')?.getAttribute("title")).toBe("unavailable");
    submenu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    await flush();
    expect(store.openProjectFileWith).toHaveBeenCalledWith("project-1", "note.txt", undefined);
  });

  it("discards late application results after the menu closes", async () => {
    let resolveApplications!: (applications: ProjectFileApplication[]) => void;
    store.listProjectFileApplications.mockReturnValue(
      new Promise<ProjectFileApplication[]>((resolve) => {
        resolveApplications = resolve;
      }),
    );
    const trigger = await mountMenu();
    trigger.click();
    await flush();
    document.body.click();
    resolveApplications([{ id: "late", name: "Late Application" }]);
    await flush();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(store.openProjectFileWith).not.toHaveBeenCalled();
  });
});
