import type { Directive } from "vue";
import {
  ClickScrollPlugin,
  OverlayScrollbars,
  type OverlayScrollbars as OverlayScrollbarsInstance,
} from "overlayscrollbars";

const instances = new WeakMap<HTMLElement, OverlayScrollbarsInstance>();
const scrollContainerSelector = ".themed-scrollbar, .overflow-auto, .overflow-y-auto, .overflow-x-auto, .overflow-scroll, .overflow-y-scroll, .overflow-x-scroll, .memo-rendered pre, .memo-rendered table";
const excludedSelector = "textarea, input, select, .scrollbar-hide, [data-native-scrollbar]";
const scrollbarOptions = {
  scrollbars: {
    theme: "os-theme-utools",
    autoHide: "move" as const,
    autoHideDelay: 400,
    autoHideSuspend: false,
    clickScroll: true,
  },
};

OverlayScrollbars.plugin(ClickScrollPlugin);

const withOverlayScrollbarTiming = <Result>(phase: "mount" | "update", operation: () => Result): Result => {
  const mark = window.__utoolsProjectLaunchStartupTiming?.mark;
  if (!mark) {
    return operation();
  }

  const startedAt = performance.now();
  mark(`overlay-scrollbar-${phase}-start`);
  const result = operation();
  mark(`overlay-scrollbar-${phase}-complete`, {
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  });
  return result;
};

export function getOverlayScrollbarScrollElements(element: HTMLElement | null) {
  if (!element) {
    return null;
  }

  const elements = instances.get(element)?.elements();
  return {
    scrollOffsetElement: elements?.scrollOffsetElement ?? element,
    scrollEventElement: elements?.scrollEventElement ?? element,
  };
}

export function observeOverlayScrollbars(root: HTMLElement = document.body) {
  const automaticInstances = new Map<HTMLElement, OverlayScrollbarsInstance>();
  const pending = new Set<HTMLElement>([root]);
  let frame: number | undefined;
  const isScrollContainer = (element: HTMLElement) => element.matches(scrollContainerSelector) &&
    !element.matches(excludedSelector) && !element.classList.contains("overflow-hidden");

  const flush = () => {
    frame = undefined;
    for (const [element, instance] of automaticInstances) {
      const scrollbar = instance.elements().scrollbarHorizontal.scrollbar;
      if (!root.contains(element) || !isScrollContainer(element) || !element.contains(scrollbar)) {
        instance.destroy();
        automaticInstances.delete(element);
        instances.delete(element);
        pending.add(element);
      }
    }
    const candidates = new Set<HTMLElement>();
    for (const element of pending) {
      if (!root.contains(element)) continue;
      if (element.matches(scrollContainerSelector)) candidates.add(element);
      element.querySelectorAll<HTMLElement>(scrollContainerSelector).forEach((child) => candidates.add(child));
    }
    pending.clear();
    for (const element of candidates) {
      if (
        !isScrollContainer(element) || instances.has(element) ||
        element.matches("[data-overlayscrollbars-initialize], [data-overlayscrollbars]") ||
        element.closest(".os-scrollbar")
      ) continue;
      const style = getComputedStyle(element);
      const instance = withOverlayScrollbarTiming("mount", () => OverlayScrollbars({
        target: element,
        elements: { viewport: element },
      }, {
        ...scrollbarOptions,
        overflow: {
          x: /^(hidden|clip)$/.test(style.overflowX) ? "hidden" : "scroll",
          y: /^(hidden|clip)$/.test(style.overflowY) ? "hidden" : "scroll",
        },
      }));
      instances.set(element, instance);
      automaticInstances.set(element, instance);
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target instanceof HTMLElement) pending.add(record.target);
      } else {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) pending.add(node);
        });
      }
    }
    if (frame === undefined) frame = requestAnimationFrame(flush);
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-native-scrollbar"] });
  flush();

  return () => {
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
    pending.clear();
    for (const [element, instance] of automaticInstances) {
      instance.destroy();
      instances.delete(element);
    }
    automaticInstances.clear();
  };
}

export const overlayScrollbar: Directive<HTMLElement> = {
  beforeMount(element) {
    element.setAttribute("data-overlayscrollbars-initialize", "");
  },
  mounted(element) {
    instances.set(
      element,
      withOverlayScrollbarTiming("mount", () =>
        OverlayScrollbars(element, scrollbarOptions),
      ),
    );
  },
  updated(element) {
    const instance = instances.get(element);
    if (instance) {
      withOverlayScrollbarTiming("update", () => instance.update());
    }
  },
  unmounted(element) {
    instances.get(element)?.destroy();
    instances.delete(element);
  },
};
