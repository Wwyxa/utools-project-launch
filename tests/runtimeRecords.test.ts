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
    clearRuntimeRecords(scope?: { runId: string }): Promise<unknown>;
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
  it("retains direct output across a fresh preload and clears only the requested completed run", async () => {
    const { api, directory } = openRecords();
    const first = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    api.appendRuntimeRecordEvent({ runId: first, type: "stdout", message: "你好\n" });
    api.appendRuntimeRecordEvent({ runId: first, type: "exit", code: 0 });
    const second = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    api.appendRuntimeRecordEvent({ runId: second, type: "stdout", message: "second" });
    api.appendRuntimeRecordEvent({ runId: second, type: "exit", code: 1 });
    const reopened = openRecords(directory).api;
    expect(await reopened.listRuntimeRecords("project")).toHaveLength(2);
    expect((await reopened.readRuntimeRecordLogPage(first)).events[0]?.message).toBe("你好\n");
    await reopened.clearRuntimeRecords({ runId: first });
    expect((await reopened.listRuntimeRecords("project")).filter((record) => record.available).map((record) => record.runId)).toEqual([second]);
  });

  it("paginates complete UTF-8 JSONL events and detects malformed interior records", async () => {
    const { api, directory } = openRecords();
    const runId = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    for (let index = 0; index < 70; index++) api.appendRuntimeRecordEvent({ runId, type: "stdout", message: `${index}:` + "中".repeat(1500) });
    api.appendRuntimeRecordEvent({ runId, type: "exit", code: 0 });
    const page = await api.readRuntimeRecordLogPage(runId);
    expect(page.hasMore).toBe(true);
    const older = await api.readRuntimeRecordLogPage(runId, page.nextOffset);
    expect([...older.events, ...page.events].filter((event) => event.type === "stdout")).toHaveLength(70);
    fs.appendFileSync(path.join(directory, "runtime/logs", `${runId}.log`), "broken\n");
    await expect(api.readRuntimeRecordLogPage(runId)).rejects.toThrow();
  });

  it("does not persist disabled output or remove active writers when clearing", async () => {
    const { api } = openRecords();
    const policy = { persist: false, maxCompletedRunsPerProject: 2, maxBytesPerRun: 1024, maxBytesTotal: 2048 };
    await api.updateRuntimeRecordRetention(policy);
    const disabled = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    api.appendRuntimeRecordEvent({ runId: disabled, type: "stdout", message: "disabled" });
    api.appendRuntimeRecordEvent({ runId: disabled, type: "exit", code: 0 });
    expect(await api.listRuntimeRecords("project")).toEqual([]);
    await api.updateRuntimeRecordRetention({ ...policy, persist: true });
    const active = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    api.appendRuntimeRecordEvent({ runId: active, type: "stdout", message: "active" });
    await api.clearRuntimeRecords();
    expect((await api.readRuntimeRecordLogPage(active)).events[0]?.message).toBe("active");
    api.appendRuntimeRecordEvent({ runId: active, type: "exit", code: 0 });
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

  it("finishes an existing automation record after persistence is disabled without adding output", async () => {
    const { api, directory } = openRecords();
    const execution: import("../src/types").ProjectLaunchServiceAutomationExecution = {
      id: "automation-run", projectId: "project", taskId: "task", planEntryId: "entry",
      plannedAt: new Date().toISOString(), startedAt: new Date().toISOString(),
      status: "running", currentScriptIndex: 0, scriptResults: [],
    };
    expect(api.saveRuntimeAutomationExecution(execution).ok).toBe(true);
    const runId = crypto.createHash("sha256").update(`automation:${execution.id}`).digest("hex").slice(0, 32);
    api.appendRuntimeRecordEvent({ runId, type: "stdout", message: "before disabling" });
    await api.updateRuntimeRecordRetention({ persist: false, maxCompletedRunsPerProject: 200, maxBytesPerRun: 5242880, maxBytesTotal: 104857600 });
    const outputPath = path.join(directory, "runtime/logs", `${runId}.log`);
    const previousOutput = fs.readFileSync(outputPath, "utf8");
    const finished = { ...execution, status: "completed" as const, endedAt: new Date().toISOString() };
    expect(api.saveRuntimeAutomationExecution(finished).ok).toBe(true);
    const records = await api.listRuntimeRecords("project");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "exited", endedAt: finished.endedAt, execution: { status: "completed" } });
    expect(fs.readFileSync(outputPath, "utf8")).toBe(previousOutput);
    expect(api.saveRuntimeAutomationExecution({ ...finished, id: "disabled-new-run" }).ok).toBe(true);
    expect(await api.listRuntimeRecords("project")).toHaveLength(1);
    await api.clearRuntimeRecords({ runId });
    expect(await api.listRuntimeRecords("project")).toEqual([]);
  });

    it("queries records, policy and pages without synchronous file reads or global writer flushes", async () => {
      const { api, directory } = openRecords();
      const completed = api.beginRuntimeRecord({ projectId: "project", scriptId: "completed" });
      api.appendRuntimeRecordEvent({ runId: completed, type: "stdout", message: "completed" });
      api.appendRuntimeRecordEvent({ runId: completed, type: "exit", code: 0 });
      const rejectSync = () => { throw new Error("Unexpected synchronous query I/O"); };
      const queryFs = { ...fs };
      const query = openRecords(directory, queryFs).api;
      const active = query.beginRuntimeRecord({ projectId: "another-project", scriptId: "running" });
      query.appendRuntimeRecordEvent({ runId: active, type: "stdout", message: "still buffered" });
      Object.assign(queryFs, { readFileSync: rejectSync, readdirSync: rejectSync, openSync: rejectSync, appendFileSync: rejectSync });
      try {
        expect(await query.listRuntimeRecords("project")).toHaveLength(1);
        expect((await query.getRuntimeRecordRetention()).usage.totalBytes).toBeGreaterThan(0);
        expect((await query.readRuntimeRecordLogPage(completed)).events[0]?.message).toBe("completed");
        expect(fs.existsSync(path.join(directory, "runtime/logs", `${active}.log`))).toBe(false);
      } finally {
        Object.assign(queryFs, fs);
        query.appendRuntimeRecordEvent({ runId: active, type: "exit", code: 0 });
      }
    });

  it("ignores developer log remnants and service-state policies", async () => {
    const { api, directory } = openRecords();
    const runId = "12345678901234567890123456789012";
    fs.mkdirSync(path.join(directory, "service/logs"), { recursive: true });
    fs.writeFileSync(path.join(directory, "service/state.json"), JSON.stringify({ logRetention: { persist: false, maxCompletedRunsPerProject: 1, maxBytesPerRun: 1024, maxBytesTotal: 2048 }, runs: [{ id: runId, projectId: "legacy", scriptId: "script", status: "exited", startedAt: new Date().toISOString() }] }));
    fs.writeFileSync(path.join(directory, "service/logs", `${runId}.log`), JSON.stringify({ cursor: 1, runId, type: "stdout", timestamp: new Date().toISOString(), message: "legacy output" }) + "\n");
    expect(await api.listRuntimeRecords("legacy")).toEqual([]);
    expect((await api.getRuntimeRecordRetention()).policy.persist).toBe(true);
    await api.clearRuntimeRecords();
    expect(await openRecords(directory).api.listRuntimeRecords("legacy")).toHaveLength(0);
    expect(fs.existsSync(path.join(directory, "service/logs", `${runId}.log`))).toBe(true);
  });

  it("preserves oversized Unicode output across complete-record pages", async () => {
    const { api } = openRecords();
    const runId = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    const message = "中文😀".repeat(30000);
    api.appendRuntimeRecordEvent({ runId, type: "stdout", message });
    api.appendRuntimeRecordEvent({ runId, type: "exit", code: 0 });
    let page = await api.readRuntimeRecordLogPage(runId);
    let events = page.events;
    while (page.hasMore) {
      page = await api.readRuntimeRecordLogPage(runId, page.nextOffset);
      events = [...page.events, ...events];
    }
    expect(events.filter((event) => event.type === "stdout").map((event) => event.message).join("")).toBe(message);
  });

  it("enables persistence during an existing run and preserves its metadata", async () => {
    const { api } = openRecords();
    const policy = { persist: false, maxCompletedRunsPerProject: 2, maxBytesPerRun: 1024, maxBytesTotal: 2048 };
    await api.updateRuntimeRecordRetention(policy);
    const runId = api.beginRuntimeRecord({ projectId: "project", scriptId: "script" });
    api.appendRuntimeRecordEvent({ runId, type: "stdout", message: "before" });
    await api.updateRuntimeRecordRetention({ ...policy, persist: true });
    api.appendRuntimeRecordEvent({ runId, type: "stdout", message: "after" });
    const result = await api.readRuntimeRecordLogPage(runId);
    expect(result.events.map((event) => event.message)).toEqual(["after"]);
    api.appendRuntimeRecordEvent({ runId, type: "exit", code: 0 });
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