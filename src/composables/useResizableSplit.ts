import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export type SplitOrientation = "horizontal" | "vertical";

const splitSizes = new Map<string, number>();

interface ResizableSplitOptions {
  containerRef: Ref<HTMLElement | null>;
  firstPaneRef: Ref<HTMLElement | null>;
  layoutKey: string;
  orientation: SplitOrientation;
  defaultFirstRatio: number;
  minFirstSize: number;
  minSecondSize: number;
  separatorSize?: number;
  keyboardStep?: number;
}

export const useResizableSplit = ({
  containerRef,
  firstPaneRef,
  layoutKey,
  orientation,
  defaultFirstRatio,
  minFirstSize,
  minSecondSize,
  separatorSize = 8,
  keyboardStep = 16,
}: ResizableSplitOptions) => {
  let preferredFirstSize = splitSizes.get(layoutKey) ?? null;
  const firstSize = ref<number | null>(preferredFirstSize);
  const isResizing = ref(false);
  const availableSize = ref(0);
  let activePointerId: number | null = null;
  let activeSeparator: HTMLElement | null = null;
  let startClientPosition = 0;
  let startFirstSize = 0;
  let resizeObserver: ResizeObserver | null = null;
  let previousUserSelect = "";
  let previousCursor = "";

  const effectiveSeparatorSize = computed(() =>
    availableSize.value > 0 ? Math.min(separatorSize, availableSize.value) : separatorSize,
  );

  const bounds = computed(() => {
    const available = Math.max(0, availableSize.value - effectiveSeparatorSize.value);
    const minimumTotal = minFirstSize + minSecondSize;

    if (available < minimumTotal) {
      const constrainedFirstSize = minimumTotal > 0 ? (available * minFirstSize) / minimumTotal : 0;
      return { min: constrainedFirstSize, max: constrainedFirstSize };
    }

    return { min: minFirstSize, max: available - minSecondSize };
  });

  const clampFirstSize = (size: number) => Math.min(bounds.value.max, Math.max(bounds.value.min, size));

  const setFirstSize = (size: number) => {
    const nextSize = clampFirstSize(size);
    firstSize.value = nextSize;
    preferredFirstSize = nextSize;
    splitSizes.set(layoutKey, nextSize);
  };

  const elementSize = (element: HTMLElement | null) => {
    const rect = element?.getBoundingClientRect();
    return orientation === "horizontal" ? (rect?.width ?? 0) : (rect?.height ?? 0);
  };

  const measureContainer = () => {
    const container = containerRef.value;
    const containerSize = orientation === "horizontal" ? (container?.clientWidth ?? 0) : (container?.clientHeight ?? 0);
    availableSize.value = containerSize;
    if (containerSize <= 0) return;

    const defaultSize = (containerSize - effectiveSeparatorSize.value) * defaultFirstRatio;
    firstSize.value = clampFirstSize(preferredFirstSize ?? defaultSize);
  };

  const restoreDocumentInteraction = () => {
    document.body.style.userSelect = previousUserSelect;
    document.body.style.cursor = previousCursor;
  };

  const stopResize = (event?: PointerEvent) => {
    if (event && activePointerId !== event.pointerId) return;
    if (!isResizing.value) return;

    const pointerId = activePointerId;
    const separator = activeSeparator;
    isResizing.value = false;
    activePointerId = null;
    activeSeparator = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
    window.removeEventListener("blur", handleWindowBlur);
    separator?.removeEventListener("lostpointercapture", stopResize);
    try {
      if (pointerId !== null && separator?.hasPointerCapture(pointerId)) {
        separator.releasePointerCapture(pointerId);
      }
    } finally {
      restoreDocumentInteraction();
    }
  };

  const handleWindowBlur = () => stopResize();

  const handlePointerMove = (event: PointerEvent) => {
    if (!isResizing.value || activePointerId !== event.pointerId) return;
    const clientPosition = orientation === "horizontal" ? event.clientX : event.clientY;
    setFirstSize(startFirstSize + clientPosition - startClientPosition);
  };

  const startResize = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || isResizing.value) return;

    const renderedFirstSize = elementSize(firstPaneRef.value);
    startClientPosition = orientation === "horizontal" ? event.clientX : event.clientY;
    measureContainer();
    startFirstSize = clampFirstSize(renderedFirstSize || firstSize.value || 0);
    firstSize.value = startFirstSize;
    const separator = event.currentTarget as HTMLElement;
    try {
      separator.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    activePointerId = event.pointerId;
    activeSeparator = separator;
    isResizing.value = true;
    previousUserSelect = document.body.style.userSelect;
    previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = orientation === "horizontal" ? "col-resize" : "row-resize";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    window.addEventListener("blur", handleWindowBlur);
    separator.addEventListener("lostpointercapture", stopResize);
    event.preventDefault();
  };

  const handleSeparatorKeydown = (event: KeyboardEvent) => {
    const decreaseKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const increaseKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (event.key !== decreaseKey && event.key !== increaseKey) return;

    measureContainer();
    const direction = event.key === decreaseKey ? -1 : 1;
    setFirstSize((firstSize.value ?? 0) + direction * keyboardStep);
    event.preventDefault();
  };

  const gridTemplate = computed(() => {
    if (firstSize.value === null) {
      const secondRatio = Math.max(0.01, 1 - defaultFirstRatio);
      return `${defaultFirstRatio}fr ${effectiveSeparatorSize.value}px minmax(0, ${secondRatio}fr)`;
    }
    return `${firstSize.value}px ${effectiveSeparatorSize.value}px minmax(0, 1fr)`;
  });

  const gridTemplateStyle = computed(() =>
    orientation === "horizontal"
      ? { gridTemplateColumns: gridTemplate.value }
      : { gridTemplateRows: gridTemplate.value },
  );
  const separatorOrientation = computed<"horizontal" | "vertical">(() =>
    orientation === "horizontal" ? "vertical" : "horizontal",
  );

  onMounted(() => {
    measureContainer();
    if (containerRef.value && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measureContainer);
      resizeObserver.observe(containerRef.value);
    }
  });

  onBeforeUnmount(() => {
    stopResize();
    resizeObserver?.disconnect();
  });

  return {
    bounds,
    firstSize,
    gridTemplateStyle,
    handleSeparatorKeydown,
    isResizing,
    separatorOrientation,
    startResize,
  };
};
