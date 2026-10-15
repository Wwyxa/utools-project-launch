// @vitest-environment happy-dom

import { createApp, nextTick, reactive, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GitDiffViewer from "../src/components/project/GitDiffViewer.vue";
import { observeOverlayScrollbars } from "../src/lib/overlayScrollbar";

const apps: App[] = [];
const frames = new Map<number, FrameRequestCallback>();
const resizeCallbacks: Array<() => void> = [];
let frameId = 0;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(() => callback([], this as unknown as ResizeObserver));
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  frames.clear();
  resizeCallbacks.length = 0;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const settle = async () => {
  await nextTick();
  await nextTick();
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(0));
  await nextTick();
};

const mountDiff = (diff = "@@ -1,3 +1,3 @@\n-old first\n+new first\n context\n-old last\n+new last") => {
  const props = reactive({ diff, path: "example.ts", loading: false });
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp(GitDiffViewer, props);
  app.mount(root);
  app.onUnmount(observeOverlayScrollbars(root));
  apps.push(app);
  return { root, props };
};

const click = async (root: HTMLElement, label: string) => {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(button).not.toBeNull();
  button.click();
  await settle();
};

describe("Git diff viewer", () => {
  it("shows one line number per unified row, preferring the new number for context", async () => {
    const { root } = mountDiff("@@ -10,2 +20,2 @@\n-before\n+after\n context");
    await settle();
    const changed = root.querySelectorAll<HTMLElement>("[data-diff-change-block], .diff-active-hunk-end");
    expect(changed).toHaveLength(2);
    expect(changed[0].querySelector(".diff-line-number")?.textContent?.trim()).toBe("10");
    expect(changed[1].querySelector(".diff-line-number")?.textContent?.trim()).toBe("20");
    const lineNumbers = [...root.querySelectorAll(".diff-line-number")];
    expect(lineNumbers.map((element) => element.textContent?.trim())).toEqual(["10", "20", "21"]);
    expect(lineNumbers.every((element) => element.childElementCount === 0)).toBe(true);
    expect(lineNumbers[0].getAttribute("aria-label")).toBe("原文件第 10 行");
    expect(lineNumbers[2].getAttribute("aria-label")).toBe("新文件第 21 行");
    expect(changed[0].lastElementChild?.textContent).toBe("before");
    expect(changed[1].lastElementChild?.textContent).toBe("after");
    expect(root.querySelector('[aria-label="新增 1 行，删除 1 行"]')).not.toBeNull();
  });

  it("cycles through changes with buttons and scoped keyboard navigation", async () => {
    const { root } = mountDiff();
    await settle();
    await click(root, "下一个变更");
    expect(
      root.querySelector('[data-diff-change-block="change-block-1"]')?.classList.contains("diff-active-hunk"),
    ).toBe(true);
    const region = root.querySelector<HTMLElement>('[role="region"]')!;
    region.dispatchEvent(new KeyboardEvent("keydown", { key: "F7", bubbles: true, cancelable: true }));
    await settle();
    expect(
      root.querySelector('[data-diff-change-block="change-block-0"]')?.classList.contains("diff-active-hunk"),
    ).toBe(true);
    region.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F5", altKey: true, shiftKey: true, bubbles: true, cancelable: true }),
    );
    await settle();
    expect(
      root.querySelector('[data-diff-change-block="change-block-1"]')?.classList.contains("diff-active-hunk"),
    ).toBe(true);
  });

  it("supports whitespace markers without changing code text", async () => {
    const { root } = mountDiff("@@ -1 +1 @@\n-\tconst value = 1;\n+  const value = 2;");
    await settle();
    const text = [...root.querySelectorAll(".diff-code-row")].map((row) => row.lastElementChild?.textContent);
    await click(root, "显示空白字符");
    expect(root.querySelector(".diff-whitespace-tab")).not.toBeNull();
    expect(root.querySelector(".diff-whitespace-space")).not.toBeNull();
    expect([...root.querySelectorAll(".diff-code-row")].map((row) => row.lastElementChild?.textContent)).toEqual(text);
    await click(root, "隐藏空白字符");
    expect(root.querySelector(".diff-whitespace-space")).toBeNull();
  });

  it("sizes gutters for large line numbers", async () => {
    const { root } = mountDiff("@@ -100000 +200000 @@\n-before\n+after");
    await settle();
    expect(root.querySelector<HTMLElement>('[role="region"]')?.style.getPropertyValue("--diff-line-width")).toBe(
      "calc(6ch + 1rem)",
    );
  });

  it("keeps the visible code anchor when switching view modes", async () => {
    const { root } = mountDiff();
    await settle();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.diffRowId === "line-0") return new DOMRect(0, -20, 100, 20);
      if (this.dataset.diffRowId === "line-1") {
        return new DOMRect(0, this.closest('[aria-label="旧版代码"]') ? 200 : 20, 100, 20);
      }
      return new DOMRect(0, 0, 100, 20);
    });
    const scrollTo = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
      this: HTMLElement,
      ...args: [ScrollToOptions] | [number, number]
    ) {
      this.scrollTop = typeof args[0] === "object" ? args[0].top || 0 : args[1] || 0;
    });
    await click(root, "切换到双栏对比");
    const oldPane = root.querySelector<HTMLElement>('[aria-label="旧版代码"]')!;
    expect(scrollTo).toHaveBeenCalledWith({ top: 180 });
    expect(oldPane.scrollTop).toBe(180);
  });

  it("uses line shading without character shading for entirely added or deleted blocks", async () => {
    const { root } = mountDiff("@@ -0,0 +1,2 @@\n+const value = 1;\n+const other = 2;");
    await settle();
    expect(root.querySelectorAll(".diff-change-sign-addition")).toHaveLength(2);
    expect(root.querySelector("mark")).toBeNull();
  });

  it("keeps old and new syntax contexts separate in side-by-side mode", async () => {
    const { root } = mountDiff("@@ -1,2 +1,2 @@\n-/* comment\n+const value = 1;\n shared text");
    await click(root, "切换到双栏对比");
    expect(root.querySelector('[aria-label="旧版代码"] .diff-code-row:last-child .hljs-comment')?.textContent).toBe(
      "shared text",
    );
    expect(root.querySelector('[aria-label="新版代码"] .diff-code-row:last-child .hljs-comment')).toBeNull();
    expect(root.querySelector('[aria-label="开启长行换行"]')?.hasAttribute("disabled")).toBe(false);
  });

  it("aligns wrapped rows and lets them shrink again, including empty counterparts", async () => {
    const { root } = mountDiff("@@ -1,1 +1,2 @@\n-old\n+new\n+extra");
    await click(root, "切换到双栏对比");
    await click(root, "开启长行换行");
    const pane = root.querySelector('[aria-label="新版代码"]')!;
    const lastCode = pane.querySelector<HTMLElement>(".diff-code-row:last-child [data-diff-measure]")!;
    let height = 60;
    vi.spyOn(lastCode, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 100, height));
    resizeCallbacks.forEach((callback) => callback());
    await settle();
    const oldRow = root.querySelector<HTMLElement>('[aria-label="旧版代码"] .diff-code-row:last-child')!;
    expect(oldRow.style.minHeight).toBe("60px");
    expect(lastCode.parentElement?.style.minHeight).toBe("60px");
    height = 20;
    resizeCallbacks.forEach((callback) => callback());
    await settle();
    expect(oldRow.style.minHeight).toBe("20px");
    expect(lastCode.parentElement?.style.minHeight).toBe("20px");
    height = 60;
    resizeCallbacks.forEach((callback) => callback());
    await settle();
    await click(root, "关闭长行换行");
    expect(oldRow.style.minHeight).toBe("20px");
  });

  it("synchronizes side scrolling and preserves the active change while manually scrolling", async () => {
    const { root } = mountDiff();
    await click(root, "切换到双栏对比");
    const oldPane = root.querySelector<HTMLElement>('[aria-label="旧版代码"]')!;
    const newPane = root.querySelector<HTMLElement>('[aria-label="新版代码"]')!;
    newPane.scrollTop = 125;
    newPane.scrollLeft = 90;
    newPane.dispatchEvent(new Event("scroll"));
    expect(oldPane.scrollTop).toBe(125);
    expect(oldPane.scrollLeft).toBe(90);
    expect(
      root.querySelector('[data-diff-change-block="change-block-0"]')?.classList.contains("diff-active-hunk"),
    ).toBe(true);
  });
});
