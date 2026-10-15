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
  vi.clearAllMocks();
});

const settle = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

describe("automatic overlay scrollbars", () => {
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