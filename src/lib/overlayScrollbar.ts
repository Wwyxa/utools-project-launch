import type { Directive } from "vue";
import {
  ClickScrollPlugin,
  OverlayScrollbars,
  type OverlayScrollbars as OverlayScrollbarsInstance,
  type PartialOptions,
} from "overlayscrollbars";

const instances = new WeakMap<HTMLElement, OverlayScrollbarsInstance>();
const scrollContainerClasses = [
  "themed-scrollbar", "overflow-auto", "overflow-y-auto", "overflow-x-auto",
  "overflow-scroll", "overflow-y-scroll", "overflow-x-scroll",
];
const scrollContainerSelector = `${scrollContainerClasses.map((className) => `.${className}`).join(", ")}, .memo-rendered pre, .memo-rendered table`;
const observedClasses = [...scrollContainerClasses, "memo-rendered", "overflow-hidden", "scrollbar-hide", "os-scrollbar"];
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

const resetScrollbarOffsets = (instance: OverlayScrollbarsInstance) => {
  const { scrollbarHorizontal, scrollbarVertical } = instance.elements();
  // In-viewport scrollbars must not keep a shrunken document at its old scroll extent.
  for (const { scrollbar } of [scrollbarHorizontal, scrollbarVertical]) {
    if (scrollbar.style.transform !== "none") scrollbar.style.transform = "none";
  }
};

const createOverlayScrollbar = (element: HTMLElement, options: PartialOptions = {}) => {
  const instance = withOverlayScrollbarTiming("mount", () => OverlayScrollbars({
    target: element,
    elements: { viewport: element },
  }, { ...scrollbarOptions, ...options }));
  let frame: number | undefined;
  const scheduleUpdate = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      updateOverlayScrollbar(element);
    });
  };
  const resizeObserver = new ResizeObserver(scheduleUpdate);
  resizeObserver.observe(element);
  element.addEventListener("load", scheduleUpdate, true);
  const observer = new MutationObserver((records) => {
    const contentChanged = records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      return target && !target.closest(".os-scrollbar") &&
        !(record.type === "attributes" && target === element);
    });
    if (contentChanged) scheduleUpdate();
  });
  observer.observe(element, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "open", "src", "width", "height"],
  });
  instance.on("destroyed", () => {
    observer.disconnect();
    resizeObserver.disconnect();
    element.removeEventListener("load", scheduleUpdate, true);
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  return instance;
};

export function updateOverlayScrollbar(element: HTMLElement | null) {
  const instance = element && instances.get(element);
  if (instance) {
    resetScrollbarOffsets(instance);
    withOverlayScrollbarTiming("update", () => instance.update(true));
  }
}

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
      const instance = createOverlayScrollbar(element, {
        overflow: {
          x: /^(hidden|clip)$/.test(style.overflowX) ? "hidden" : "scroll",
          y: /^(hidden|clip)$/.test(style.overflowY) ? "hidden" : "scroll",
        },
      });
      instances.set(element, instance);
      automaticInstances.set(element, instance);
    }
  };

  const observer = new MutationObserver((records) => {
    let needsCleanup = false;
    for (const record of records) {
      if (record.type === "attributes") {
        const element = record.target;
        if (!(element instanceof HTMLElement)) continue;
        if (record.attributeName === "class") {
          const previousClasses = new Set((record.oldValue || "").split(/\s+/));
          if (!observedClasses.some((className) => previousClasses.has(className) !== element.classList.contains(className))) continue;
        }
        pending.add(element);
      } else {
        if (record.removedNodes.length > 0 && automaticInstances.size > 0) needsCleanup = true;
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) pending.add(node);
        });
      }
    }
    if (frame === undefined && (pending.size > 0 || needsCleanup)) frame = requestAnimationFrame(flush);
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "data-native-scrollbar"] });
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
    instances.set(element, createOverlayScrollbar(element));
  },
  updated(element) {
    updateOverlayScrollbar(element);
  },
  unmounted(element) {
    instances.get(element)?.destroy();
    instances.delete(element);
  },
};
