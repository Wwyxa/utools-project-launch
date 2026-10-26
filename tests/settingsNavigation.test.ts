// @vitest-environment happy-dom

import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsTab from "../src/components/layout/SettingsTab.vue";
import { useStore } from "../src/store/useStore";
import type { ProjectLaunchServiceLogRetentionPolicy } from "../src/types";

const scrollElements = vi.hoisted(() => new WeakMap<HTMLElement, HTMLElement>());
vi.mock("../src/lib/overlayScrollbar", () => ({
  getOverlayScrollbarScrollElements: (element: HTMLElement | null) => {
    const viewport = element && scrollElements.get(element);
    return viewport ? { scrollOffsetElement: viewport, scrollEventElement: viewport } : null;
  },
}));

const apps: App[] = [];

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

const mountSettings = (configure?: (store: ReturnType<typeof useStore>) => void) => {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp(SettingsTab);
  const pinia = createPinia();
  app.use(pinia);
  const store = useStore(pinia);
  configure?.(store);
  app.directive("overlay-scrollbar", {
    mounted(element: HTMLElement) {
      const viewport = document.createElement("div");
      element.append(viewport);
      scrollElements.set(element, viewport);
    },
  });
  app.mount(root);
  apps.push(app);
  const sections = [...root.querySelectorAll<HTMLElement>("[data-settings-section]")];
  const content = sections[0].parentElement!.parentElement!;
  const viewport = scrollElements.get(content)!;
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 5000 },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 50, 600, 600));
  sections.forEach((section, index) => {
    vi.spyOn(section, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 74 + index * 400 - viewport.scrollTop, 600, 400),
    );
  });
  const scrollTo = vi
    .spyOn(viewport, "scrollTo")
    .mockImplementation((...args: [ScrollToOptions] | [number, number]) => {
      viewport.scrollTop = typeof args[0] === "object" ? args[0].top || 0 : args[1] || 0;
    });
  return { app, root, sections, viewport, scrollTo, store };
};

describe("settings sidebar navigation", () => {
  it("keeps a clicked group selected when its scroll position is clamped at the bottom", async () => {
    const { root, viewport, scrollTo } = mountSettings();
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 3200 });
    scrollTo.mockImplementation((...args: [ScrollToOptions] | [number, number]) => {
      const top = typeof args[0] === "object" ? args[0].top || 0 : args[1] || 0;
      viewport.scrollTop = Math.min(top, viewport.scrollHeight - viewport.clientHeight);
    });
    root.querySelector<HTMLButtonElement>('nav [aria-controls="settings-data"]')!.click();
    viewport.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(viewport.scrollTop).toBe(2600);
    expect(root.querySelector('nav [aria-current="location"]')?.getAttribute("aria-controls")).toBe("settings-data");
    expect(document.activeElement?.id).toBe("settings-data");

    viewport.scrollTop = 2400;
    viewport.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(root.querySelector('nav [aria-current="location"]')?.getAttribute("aria-controls")).toBe("settings-backup");
  });
});

const mountRetentionSettings = async () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
  const policy: ProjectLaunchServiceLogRetentionPolicy = {
    persist: true,
    maxCompletedRunsPerProject: 20,
    maxBytesPerRun: 1024 * 1024,
    maxBytesTotal: 10 * 1024 * 1024,
  };
  const mounted = mountSettings((store) => {
    store.supportsBridge = true;
    vi.spyOn(store, "listBackups").mockResolvedValue({ entries: [], syncState: null });
    vi.spyOn(store, "refreshAiModels").mockResolvedValue(undefined);
    vi.spyOn(store, "refreshStorageOverview").mockResolvedValue(undefined);
    vi.spyOn(store, "refreshRuntimeRecordRetention").mockImplementation(async () => {
      const status = { policy: { ...policy }, usage: { totalBytes: 0, fileCount: 0 } };
      store.projectLaunchServiceLogRetentionStatus = status;
      return status;
    });
  });
  frames.shift()!(0);
  frames.shift()!(16);
  await nextTick();
  const save = vi.spyOn(mounted.store, "updateRuntimeRecordRetention").mockImplementation(async (updated) => {
    const status = { policy: { ...updated }, usage: { totalBytes: 0, fileCount: 0 } };
    mounted.store.projectLaunchServiceLogRetentionStatus = status;
    return status;
  });
  const section = mounted.root.querySelector<HTMLElement>("#settings-logs")!;
  return { ...mounted, section, policy, save };
};

describe("log retention automatic saving", () => {
  it("saves the switch immediately and numeric values when editing is committed", async () => {
    const { section, policy, save } = await mountRetentionSettings();
    const toggle = section.querySelector<HTMLInputElement>('input[role="switch"]')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    await nextTick();
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...policy, persist: false });

    const input = section.querySelector<HTMLInputElement>('input[type="number"]')!;
    input.value = "30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(save).toHaveBeenCalledTimes(1);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    expect(save).toHaveBeenLastCalledWith({
      ...policy,
      persist: false,
      maxCompletedRunsPerProject: 30,
    });
  });

  it("blocks invalid input and allows retrying after a save failure", async () => {
    const { section, save } = await mountRetentionSettings();
    const input = section.querySelector<HTMLInputElement>('input[type="number"]')!;
    for (const value of ["", "0", "1.5"]) {
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await nextTick();
      expect(save).not.toHaveBeenCalled();
      expect(section.querySelector('[role="status"]')).not.toBeNull();
    }
    save.mockRejectedValueOnce(new Error("Storage unavailable"));
    input.value = "30";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    await nextTick();
    expect(section.querySelector('[role="status"]')?.textContent).toContain("Storage unavailable");
    expect(input.disabled).toBe(false);
    input.value = "31";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    await nextTick();
    expect(save).toHaveBeenCalledTimes(2);
    expect(section.querySelector('[role="status"]')).toBeNull();
  });
});
