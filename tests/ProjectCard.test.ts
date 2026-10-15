// @vitest-environment happy-dom

import { createApp, nextTick, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectCard from "../src/components/dashboard/ProjectCard.vue";
import { ProjectStatus, type Project } from "../src/types";

const store = vi.hoisted(() => ({
  locale: "zh-CN",
  externalApplicationPreferences: { applications: [], defaultApplicationId: "" },
  uiPreferences: { dashboard: { tinyCardActionTrigger: "hover" } },
  stagedFiles: {},
  logs: {},
  launchScript: vi.fn().mockResolvedValue(undefined),
  stopScript: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/store/useStore", () => ({ useStore: () => store }));
vi.mock("../src/components/project/ProjectIcon.vue", () => ({ default: { template: "<span />" } }));
vi.mock("../src/components/project/ExternalApplicationLaunchButton.vue", () => ({
  default: { template: "<span />" },
}));

const apps: App[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const mountCard = (running = false) => {
  const project: Project = {
    id: "project-1",
    name: "Example",
    path: "D:/example",
    type: "Node.js",
    kind: "node",
    status: ProjectStatus.STOPPED,
    env: {},
    scripts: Array.from({ length: 6 }, (_, index) => ({
      id: `script-${index}`,
      name: `Command ${index}`,
      command: `npm run command-${index}`,
      status: running ? "RUNNING" : "IDLE",
    })),
  };
  const select = vi.fn();
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp(ProjectCard, { project, onSelect: select });
  app.directive("overlay-scrollbar", {});
  app.mount(root);
  apps.push(app);
  const trigger = root.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  const opener = trigger.parentElement!;
  return { root: document.body, trigger, opener, select };
};

describe("project card command panel", () => {
  it("opens on hover, stays open across the gap, and closes after leaving", async () => {
    const { root, trigger, opener } = mountCard();
    expect(root.querySelector('[role="menu"]')).toBeNull();
    opener.dispatchEvent(new MouseEvent("mouseenter"));
    await nextTick();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    trigger.click();
    await nextTick();
    expect(root.querySelector('[role="menu"]')).not.toBeNull();
    opener.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(100);
    root.querySelector('[role="menu"]')!.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(200);
    await nextTick();
    expect(root.querySelector('[role="menu"]')).not.toBeNull();
    root.querySelector('[role="menu"]')!.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(120);
    await nextTick();
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });

  it("opens for keyboard focus, retains internal focus, and closes with Escape", async () => {
    const { root, opener } = mountCard();
    opener.dispatchEvent(new FocusEvent("focusin"));
    await nextTick();
    const command = root.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    opener.dispatchEvent(new FocusEvent("focusout", { relatedTarget: command }));
    await nextTick();
    expect(root.querySelector('[role="menu"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });

  it.each([false, true])("executes a hidden command without selecting the card (running: %s)", async (running) => {
    const { root, trigger, select } = mountCard(running);
    trigger.click();
    await nextTick();
    root.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    await Promise.resolve();
    await nextTick();
    expect(running ? store.stopScript : store.launchScript).toHaveBeenCalledWith("project-1", "script-3");
    expect(select).not.toHaveBeenCalled();
    expect(root.querySelector('[role="menu"]')).toBeNull();
  });

});