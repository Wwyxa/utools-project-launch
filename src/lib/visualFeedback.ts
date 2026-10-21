export const waitForInitialPaint = (): Promise<void> => {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
};

export const scheduleAfterInitialPaint = (callback: () => void) => {
  let pending = true;
  const run = () => {
    if (!pending) return;
    pending = false;
    window.clearTimeout(timer);
    callback();
  };
  const canPaint =
    typeof window.requestAnimationFrame === "function" &&
    (typeof document === "undefined" || document.visibilityState !== "hidden");
  const timer = window.setTimeout(run, canPaint ? 100 : 0);
  if (canPaint) void waitForInitialPaint().then(run);
};

export const waitForVisualFeedback = (): Promise<void> => new Promise(scheduleAfterInitialPaint);