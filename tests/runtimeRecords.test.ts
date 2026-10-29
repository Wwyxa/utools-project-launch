import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeRecord, RuntimeRecordLog, ProjectLaunchServiceLogRetentionPolicy } from "../src/types";

const directories: string[] = [];
function openRecords(directory = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-records-")), recordFs = fs) {
  if (!directories.includes(directory)) directories.push(directory);
  const api = runInNewContext(fs.readFileSync("public/preload/runtime-records.js", "utf8") + `
    ({ beginRuntimeRecord, appendRuntimeRecordEvent, listRuntimeRecords, readRuntimeRecordLogPage,
      clearRuntimeRecords, updateRuntimeRecordRetention, getRuntimeRecordRetention, wrapRuntimeOperation,
      saveRuntimeAutomationState, loadRuntimeAutomationState, saveRuntimeAutomationExecution })`, {
    fs: recordFs, path, crypto, process, Buffer, console, setTimeout, clearTimeout,
    pluginLocalDataDirectory: () => directory,
    writeJsonFileAtomic: (target: string, value: unknown) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target + ".tmp", JSON.stringify(value));
      fs.renameSync(target + ".tmp", target);
    },
    localStateWriteError: (error: Error) => ({ ok: false, error: error.message }),
  }) as {
    beginRuntimeRecord(payload: { projectId: string; scriptId: string }): string;
    appendRuntimeRecordEvent(event: { runId: string; type: string; message?: string; code?: number }): void;
    listRuntimeRecords(projectId: string): Promise<RuntimeRecord[]>;
    readRuntimeRecordLogPage(runId: string, offset?: number): Promise<RuntimeRecordLog>;
    clearRuntimeRecords(scope?: { runId: string } | { projectId: string }): Promise<unknown>;
    updateRuntimeRecordRetention(policy: ProjectLaunchServiceLogRetentionPolicy): Promise<unknown>;
    getRuntimeRecordRetention(): Promise<{ policy: ProjectLaunchServiceLogRetentionPolicy; usage: { totalBytes: number } }>;
    wrapRuntimeOperation(label: string, operation: (payload: unknown) => unknown): (payload: unknown) => unknown;
    saveRuntimeAutomationState(projectId: string, tasks: import("../src/types").RuntimeAutomationTaskState[]): { ok: boolean };
    loadRuntimeAutomationState(projectId: string): import("../src/types").RuntimeAutomationTaskState[];
    saveRuntimeAutomationExecution(execution: import("../src/types").ProjectLaunchServiceAutomationExecution): { ok: boolean };
  };
  return { api, directory };
}
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe("common runtime records", () => {
  it("clears all completed project logs without affecting other projects or active runs", async () => {
    const { api } = openRecords();
    const completed = ["project", "project", "other"].map((projectId) => {
      const runId = api.beginRuntimeRecord({ projectId, scriptId: "script" });
      api.appendRuntimeRecordEvent({ runId, type: "stdout", message: projectId });
      api.appendRuntimeRecordEvent({ runId, type: "exit", code: 0 });
      return runId;
    });
    const active = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    api.appendRuntimeRecordEvent({ runId: active, type: "stdout", message: "active" });

    await expect(api.clearRuntimeRecords({ projectId: "" })).rejects.toThrow();
    await expect(api.clearRuntimeRecords({ projectId: "project" })).resolves.toMatchObject({ deletedCount: 2 });
    expect(await api.listRuntimeRecords("project")).toEqual([]);
    expect((await api.listRuntimeRecords("other")).map((record) => record.runId)).toEqual([completed[2]]);
    expect((await api.readRuntimeRecordLogPage(active)).events[0]?.message).toBe("active");
    api.appendRuntimeRecordEvent({ runId: active, type: "exit", code: 0 });
  });

  it("retains direct output across a fresh preload and clears only the requested completed run", async () => {
    const { api, directory } = openRecords();
    const first = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    api.appendRuntimeRecordEvent({ runId: first, type: "stdout", message: "\u4f60\u597d\n" });
    api.appendRuntimeRecordEvent({ runId: first, type: "exit", code: 0 });
    const second = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    api.appendRuntimeRecordEvent({ runId: second, type: "stdout", message: "second" });
    api.appendRuntimeRecordEvent({ runId: second, type: "exit", code: 1 });
    const reopened = openRecords(directory).api;
    expect(await reopened.listRuntimeRecords("project")).toHaveLength(2);
    expect((await reopened.readRuntimeRecordLogPage(first)).events[0]?.message).toBe("\u4f60\u597d\n");
    await reopened.clearRuntimeRecords({ runId: first });
    expect((await reopened.listRuntimeRecords("project")).filter((record) => record.available).map((record) => record.runId)).toEqual([second]);
  });

  it("paginates complete UTF-8 JSONL events and detects malformed interior records", async () => {
    const { api, directory } = openRecords();
    const runId = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    const messages = Array.from({ length: 70 }, (_, index) => `${index}:` + "\u4e2d".repeat(1500));
    for (const message of messages) api.appendRuntimeRecordEvent({ runId, type: "stdout", message });
    api.appendRuntimeRecordEvent({ runId, type: "exit", code: 0 });
    const page = await api.readRuntimeRecordLogPage(runId);
    expect(page.hasMore).toBe(true);
    const older = await api.readRuntimeRecordLogPage(runId, page.nextOffset);
    expect([...older.events, ...page.events].filter((event) => event.type === "stdout").map((event) => event.message)).toEqual(messages);
    fs.appendFileSync(path.join(directory, "runtime/logs", `${runId}.log`), "broken\n");
    await expect(api.readRuntimeRecordLogPage(runId)).rejects.toThrow();
  });

  it("rejects traversal and invalid retention policies", async () => {
    const { api } = openRecords();
    await expect(api.readRuntimeRecordLogPage("../state")).rejects.toThrow();
    await expect(api.updateRuntimeRecordRetention({ persist: true, maxCompletedRunsPerProject: 0, maxBytesPerRun: 1024, maxBytesTotal: 2048 })).rejects.toThrow();
  });

  it("finishes a run after an earlier output write failure and permits cleanup", async () => {
    const recordFs = { ...fs };
    const { api, directory } = openRecords(undefined, recordFs);
    const runId = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    recordFs.openSync = () => { throw new Error("Injected log write failure"); };
    api.appendRuntimeRecordEvent({ runId, type: "stdout", message: "x".repeat(70000) });
    recordFs.openSync = fs.openSync;
    api.appendRuntimeRecordEvent({ runId, type: "exit", code: 0 });
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "runtime/logs", `${runId}.json`), "utf8"));
    expect(metadata).toMatchObject({ status: "exited", truncated: true, durableWriteError: "Injected log write failure" });
    expect(Number.isFinite(Date.parse(metadata.endedAt))).toBe(true);
    expect((await api.listRuntimeRecords("project"))[0]?.runId).toBe(runId);
    await api.clearRuntimeRecords({ runId });
    expect(await api.listRuntimeRecords("project")).toEqual([]);
    expect(fs.existsSync(path.join(directory, "runtime/logs", `${runId}.json`))).toBe(false);
  });

  it("records operation failures without persisting sensitive arguments", async () => {
    const { api } = openRecords();
    const result = { ok: false };
    const invoke = api.wrapRuntimeOperation("Save file", () => result);
    expect(invoke({ projectId: "project", apiKey: "TOP-SECRET", content: "PRIVATE-CONTENT" })).toBe(result);
    const records = await api.listRuntimeRecords("project");
    expect(records[0]?.status).toBe("failed");
    const events = await api.readRuntimeRecordLogPage(records[0]!.runId);
    expect(JSON.stringify(events)).not.toContain("TOP-SECRET");
    expect(JSON.stringify(events)).not.toContain("PRIVATE-CONTENT");
  });

  it("rejects concurrent automation claims and keeps claims after log cleanup", async () => {
    const { api, directory } = openRecords();
    const plannedAt = new Date().toISOString();
    const tasks: import("../src/types").RuntimeAutomationTaskState[] = [{ taskId: "task", history: [], dailyPlans: [{ date: "2026-10-15", entries: [{ id: "entry", plannedAt, status: "pending" }] }] }];
    expect(api.saveRuntimeAutomationState("project", tasks).ok).toBe(true);
    tasks[0]!.dailyPlans[0]!.entries[0]!.status = "running";
    tasks[0]!.dailyPlans[0]!.entries[0]!.runId = "first";
    expect(api.saveRuntimeAutomationState("project", tasks).ok).toBe(true);
    tasks[0]!.dailyPlans[0]!.entries[0]!.runId = "second";
    expect(openRecords(directory).api.saveRuntimeAutomationState("project", tasks).ok).toBe(false);
    await api.clearRuntimeRecords();
    expect(api.loadRuntimeAutomationState("project")[0]?.dailyPlans[0]?.entries[0]?.runId).toBe("first");
  });
});