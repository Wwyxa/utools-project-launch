// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { observeOverlayScrollbars } from "../src/lib/overlayScrollbar";

const { initialize } = vi.hoisted(() => ({
  initialize: vi.fn((target: { target: HTMLElement; elements: { viewport: HTMLElement } }) => {
    const scrollbar = document.createElement("div");
    target.target.append(scrollbar);
    return {
      destroy: vi.fn(() => scrollbar.remove()),
      elements: () => ({
        scrollOffsetElement: target.elements.viewport,
        scrollEventElement: target.elements.viewport,
        scrollbarHorizontal: { scrollbar },
      }),
    };
  }),
}));

vi.mock("overlayscrollbars", () => ({
  ClickScrollPlugin: {},
  OverlayScrollbars: Object.assign(initialize, { plugin: vi.fn() }),
}));

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const settle = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

describe("automatic overlay scrollbars", () => {
  it("does not schedule scans for animation or visual class changes", async () => {
    document.body.innerHTML = '<section><div class="overflow-y-auto"></div><button></button></section>';
    stop = observeOverlayScrollbars();
    await settle();
    const scheduleFrame = vi.spyOn(window, "requestAnimationFrame");
    const container = document.body.querySelector("div")!;
    document.body.querySelector("section")!.classList.add("scale-enter-active");
    document.body.querySelector("button")!.classList.add("text-primary");
    container.classList.add("bg-surface");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(scheduleFrame).not.toHaveBeenCalled();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("keeps responding to scroll eligibility and native scrollbar changes", async () => {
    document.body.innerHTML = '<div class="overflow-y-auto overflow-hidden"></div>';
    const container = document.body.firstElementChild!;
    stop = observeOverlayScrollbars();
    expect(initialize).not.toHaveBeenCalled();
    container.classList.remove("overflow-hidden");
    await settle();
    expect(initialize).toHaveBeenCalledTimes(1);
    const instance = initialize.mock.results[0].value;
    container.setAttribute("data-native-scrollbar", "");
    await settle();
    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledTimes(1);
    container.removeAttribute("data-native-scrollbar");
    await settle();
    expect(initialize).toHaveBeenCalledTimes(2);
    container.classList.add("scrollbar-hide");
    await settle();
    expect(initialize.mock.results[1].value.destroy).toHaveBeenCalledOnce();
  });

  it("initializes Markdown scrollers when the ancestor becomes a rendered memo", async () => {
    document.body.innerHTML = '<section><pre>code</pre><table></table></section>';
    stop = observeOverlayScrollbars();
    expect(initialize).not.toHaveBeenCalled();
    document.body.firstElementChild!.classList.add("memo-rendered");
    await settle();
    expect(initialize).toHaveBeenCalledTimes(2);
    document.body.firstElementChild!.classList.remove("memo-rendered");
    await settle();
    for (const result of initialize.mock.results) expect(result.value.destroy).toHaveBeenCalledOnce();
  });

  it("destroys detached scrollers even when no elements are added", async () => {
    document.body.innerHTML = '<div class="overflow-y-auto"></div>';
    stop = observeOverlayScrollbars();
    await settle();
    const instance = initialize.mock.results[0].value;
    document.body.firstElementChild!.remove();
    await settle();
    expect(instance.destroy).toHaveBeenCalledOnce();
  });

  it("initializes new scrollers once without taking over explicit or native controls", async () => {
    document.body.innerHTML = `
      <div class="overflow-auto" data-overlayscrollbars-initialize></div>
      <textarea class="themed-scrollbar"></textarea>
    `;
    stop = observeOverlayScrollbars();
    expect(initialize).not.toHaveBeenCalled();
    const container = document.createElement("div");
    document.body.append(container);
    container.className = "overflow-y-auto";
    await settle();
    expect(initialize).toHaveBeenCalledTimes(1);
    container.classList.add("themed-scrollbar");
    container.append(document.createElement("span"));
    await settle();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("restores scrollbars after content replacement and cleans up on stop", async () => {
    document.body.innerHTML = '<div class="memo-rendered themed-scrollbar"></div>';
    stop = observeOverlayScrollbars();
    const instance = initialize.mock.results[0].value;
    document.body.firstElementChild!.innerHTML = "<p>updated preview</p>";
    await settle();
    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector("p")?.textContent).toBe("updated preview");
    stop();
    stop = undefined;
    expect(initialize.mock.results[1].value.destroy).toHaveBeenCalledOnce();
  });
});