import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAppMock, createPiniaMock, overlayScrollbarMock } = vi.hoisted(() => ({
  createAppMock: vi.fn(),
  createPiniaMock: vi.fn(() => ({})),
  overlayScrollbarMock: {},
}));

vi.mock("vue", () => ({ createApp: createAppMock }));
vi.mock("pinia", () => ({ createPinia: createPiniaMock }));
vi.mock("../src/App.vue", () => ({ default: {} }));
vi.mock("../src/lib/overlayScrollbar", () => ({ overlayScrollbar: overlayScrollbarMock }));

describe("renderer startup timing", () => {
  beforeEach(() => {
    vi.resetModules();
    createAppMock.mockReset();
    createPiniaMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks post-paint after two animation frames from renderer entry", async () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const timing = { preloadStartedAtEpochMs: 0 };
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const app = {
      use: vi.fn(),
      directive: vi.fn(),
      mount: vi.fn(),
    };
    app.use.mockReturnValue(app);
    app.directive.mockReturnValue(app);
    createAppMock.mockReturnValue(app);
    vi.stubGlobal("window", { __utoolsProjectLaunchStartupTiming: timing, requestAnimationFrame });

    await import("../src/main");

    const phases = () => consoleInfo.mock.calls.map(([, payload]) => JSON.parse(String(payload)).phase);

    expect(phases()).toContain("renderer-bootstrap-start");
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(phases()).not.toContain("renderer-post-paint");

    callbacks.shift()?.(16);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(3);
    expect(phases()).not.toContain("renderer-post-paint");

    callbacks.shift()?.(32);
    expect(phases()).toContain("renderer-first-frame");
    callbacks.shift()?.(48);
    expect(phases()).toContain("renderer-post-paint");
    consoleInfo.mockRestore();
  });
});
