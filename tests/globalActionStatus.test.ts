import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeActionStatus,
  completeActionProgress,
  dismissActionStatus,
  showActionProgress,
  showActionStatus,
} from "../src/components/common/actionStatus";

describe("global action status", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
    dismissActionStatus();
  });

  afterEach(() => {
    dismissActionStatus();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps loading visible and dismisses only the matching completed action", async () => {
    vi.useFakeTimers();

    const loadingId = showActionStatus({ state: "loading", message: "正在同步远端..." });
    expect(activeActionStatus.value).toMatchObject({ id: loadingId, state: "loading", message: "正在同步远端..." });

    vi.advanceTimersByTime(10_000);
    expect(activeActionStatus.value?.id).toBe(loadingId);

    const completedId = showActionStatus({ state: "success", message: "远端同步完成" });
    dismissActionStatus(loadingId);
    expect(activeActionStatus.value?.id).toBe(completedId);

    vi.advanceTimersByTime(3199);
    expect(activeActionStatus.value?.id).toBe(completedId);
    vi.advanceTimersByTime(1);
    expect(activeActionStatus.value).toBeNull();
  });

  it("keeps generic progress visible until the matching result arrives", async () => {
    vi.useFakeTimers();
    const operationId = "project-refresh";

    showActionProgress({
      operationId,
      state: "loading",
      message: "正在刷新项目...",
      entries: [{ timestamp: "12:00:00", message: "正在刷新项目...", stage: "start" }],
    });
    showActionProgress({
      operationId,
      state: "loading",
      message: "正在同步配置...",
      entries: [
        { timestamp: "12:00:00", message: "正在刷新项目...", stage: "start" },
        { timestamp: "12:00:01", message: "正在同步配置...", stage: "configuration" },
      ],
    });

    expect(activeActionStatus.value).toMatchObject({
      isProgress: true,
      operationId,
      state: "loading",
      message: "正在同步配置...",
      entries: [
        expect.objectContaining({ message: "正在刷新项目..." }),
        expect.objectContaining({ message: "正在同步配置..." }),
      ],
    });

    completeActionProgress("success", "项目刷新完成。", operationId);
    expect(activeActionStatus.value).toMatchObject({
      isProgress: true,
      operationId,
      state: "success",
      message: "项目刷新完成。",
      entries: [
        expect.objectContaining({ message: "正在刷新项目..." }),
        expect.objectContaining({ message: "正在同步配置..." }),
      ],
    });
  });

  it("does not let an older progress operation replace a newer one", () => {
    showActionProgress({
      operationId: "older-operation",
      state: "loading",
      message: "正在执行较早操作...",
      entries: [{ timestamp: "12:00:00", message: "正在执行较早操作..." }],
    });
    const newerOperationId = showActionProgress({
      operationId: "newer-operation",
      state: "loading",
      message: "正在执行较新操作...",
      entries: [{ timestamp: "12:00:01", message: "正在执行较新操作..." }],
    });

    expect(completeActionProgress("success", "较早操作完成。", "older-operation")).toBe(0);
    expect(activeActionStatus.value?.id).toBe(newerOperationId);
  });
});
