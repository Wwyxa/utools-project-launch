import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeActionStatus,
  completeActionProgress,
  dismissActionStatus,
  showActionProgress,
  showActionStatus,
} from "../src/components/common/actionStatus";
import { isNewProgressOperation, mergeGitRemoteProgressEntry } from "../src/composables/useGlobalActionStatus";

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

  it("updates the current remote progress stage and only auto-expands a new operation", () => {
    const startEntry = { timestamp: "12:00:00", message: "开始: git fetch", stage: "start" };
    const outputEntry = { timestamp: "12:00:01", message: "Receiving objects: 50%", stage: "receiving objects" };
    const laterOutputEntry = { timestamp: "12:00:02", message: "Receiving objects: 75%", stage: "receiving objects" };
    const nextStageEntry = { timestamp: "12:00:03", message: "Resolving deltas: 100%", stage: "resolving deltas" };
    const firstStatus = {
      id: 1,
      operationId: "git-remote-progress",
      isProgress: true,
      state: "loading" as const,
      message: startEntry.message,
      entries: [startEntry],
    };
    const outputEntries = mergeGitRemoteProgressEntry(firstStatus.entries, outputEntry, "output");
    const updatedStatus = {
      ...firstStatus,
      id: 2,
      message: laterOutputEntry.message,
      entries: mergeGitRemoteProgressEntry(outputEntries, laterOutputEntry, "output"),
    };
    const nextStageEntries = mergeGitRemoteProgressEntry(updatedStatus.entries, nextStageEntry, "output");

    expect(updatedStatus.entries).toEqual([startEntry, laterOutputEntry]);
    expect(nextStageEntries).toEqual([startEntry, laterOutputEntry, nextStageEntry]);
    expect(isNewProgressOperation(firstStatus, null)).toBe(true);
    expect(isNewProgressOperation(updatedStatus, firstStatus)).toBe(false);
    expect(isNewProgressOperation({ ...updatedStatus, state: "success" as const }, updatedStatus)).toBe(false);
    expect(isNewProgressOperation({ ...updatedStatus, state: "success" as const }, null)).toBe(false);
    expect(isNewProgressOperation(updatedStatus, { ...updatedStatus, state: "success" as const })).toBe(true);
  });
});
