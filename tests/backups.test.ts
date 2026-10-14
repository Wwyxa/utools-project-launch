import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { gunzipSync } from "node:zlib";

const temporaryDirectories: string[] = [];
const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "project-backup-test-"));
  temporaryDirectories.push(directory);
  const files = { path: join(directory, "backup.plbackup") };
  const documents = new Map<string, Record<string, unknown>>();
  const attachments = new Map<string, Buffer>();
  const nodeRequire = createRequire(import.meta.url);
  let failedAttachment = false;
  let failedRemoval = false;
  let syncState: number | null = 0;
  const db = {
    get: (id: string) => clone(documents.get(id) || null),
    allDocs: (prefix: string) => clone([...documents.values()].filter((doc) => String(doc._id).startsWith(prefix))),
    put: (document: Record<string, unknown>) => {
      const previous = documents.get(String(document._id));
      if (previous && previous._rev !== document._rev) return { error: true };
      const rev = String(Number(previous?._rev || 0) + 1);
      documents.set(String(document._id), clone({ ...document, _rev: rev }));
      return { ok: true, rev };
    },
    remove: (value: string | { _id: string }) => {
      const id = typeof value === "string" ? value : value._id;
      if (failedRemoval && attachments.has(id)) return { error: true };
      documents.delete(id);
      attachments.delete(id);
      return { ok: true };
    },
    postAttachment: (id: string, bytes: Uint8Array) => {
      if (failedAttachment) return { error: true };
      attachments.set(id, Buffer.from(bytes));
      documents.set(id, { _id: id });
      return { ok: true };
    },
    getAttachment: (id: string) => attachments.get(id) || null,
    replicateStateFromCloud: () => syncState,
  };
  const window = {
    projectBridge: undefined as unknown as import("../src/types").ProjectBridge,
    utools: {
      db,
      getPluginLocalDataPath: () => directory,
      getPluginTempPath: () => join(directory, "tmp"),
      showSaveDialog: () => files.path,
      showOpenDialog: () => [files.path],
    },
    dispatchEvent: () => true,
  };
  runInNewContext(readFileSync(resolve("public/preload.js"), "utf8"), {
    require: (id: string) => (id === "electron" ? { shell: {} } : nodeRequire(id)),
    process: {
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      env: {
        ...process.env,
        UTOOLS_PROJECT_LAUNCH_LOCAL_DATA_DIR: directory,
        UTOOLS_PROJECT_LAUNCH_LEGACY_DATA_DIR: join(directory, "legacy"),
      },
      once: () => {},
    },
    window,
    Buffer,
    console,
    URL,
    setTimeout,
    clearTimeout,
  });
  return {
    bridge: window.projectBridge,
    documents,
    attachments,
    files,
    directory,
    failAttachment: () => {
      failedAttachment = true;
    },
    failRemoval: () => {
      failedRemoval = true;
    },
    setSyncState: (value: number | null) => {
      syncState = value;
    },
  };
}

const project = (id: string, visibility: "public" | "private" = "public") =>
  ({
    id,
    name: id,
    path: "D:/develop/" + id,
    visibility,
    scripts: [],
    automationTasks: [],
    env: {},
    todos: [],
  }) as unknown as import("../src/types").Project;
const restoreOptions = {
  projects: true,
  configuration: true,
  projectMode: "replace" as const,
  pathFrom: "D:/develop",
  pathTo: "/work",
};

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("project backups through the real preload", () => {
  it("round trips private projects, local overrides and settings across preload instances", async () => {
    const source = fixture();
    await source.bridge.saveProjects([project("public"), project("private", "private")]);
    source.bridge.saveProjectEnvironmentOverrides("public", {
      env: { TOKEN: "private-value" },
      localOnlyEnvKeys: ["TOKEN"],
    });
    source.bridge.saveUiPreferences({} as import("../src/types").UiPreferences);
    await source.bridge.createBackup({ destination: "local" });
    const target = fixture();
    target.files.path = source.files.path;
    const preview = await target.bridge.prepareBackup({ source: "local" });
    expect(preview.summary?.projectCount).toBe(2);
    expect(preview.summary?.source.hostname).toBeTruthy();
    const result = await target.bridge.restoreBackup(restoreOptions);
    expect(result.ok).toBe(true);
    expect(gunzipSync(readFileSync(result.recoveryPath)).toString("utf8")).toContain("project-launch-backup");
    expect((await target.bridge.loadProjects()).map((entry) => entry.path)).toEqual(["/work/public", "/work/private"]);
    expect(target.bridge.loadProjectEnvironmentOverrides("public").env.TOKEN).toBe("private-value");
    expect([...target.documents.keys()].some((id) => id.endsWith("/private"))).toBe(false);
    expect(readFileSync(join(target.directory, "local-state.v1.json"), "utf8")).not.toMatch(
      /deviceId|nativeId|hostname/,
    );
  });

  it("manages cloud snapshots and retains a deletable entry after an attachment failure", async () => {
    const context = fixture();
    await context.bridge.saveProjects([project("one")]);
    const created = await context.bridge.createBackup({ destination: "utools" });
    expect(context.attachments.size).toBe(1);
    const list = await context.bridge.listBackups();
    expect(list.entries[0]).toMatchObject({ name: expect.stringMatching(/^备份-/), complete: true, projectCount: 1 });
    await context.bridge.prepareBackup({ source: "utools", id: created.id });
    await context.bridge.exportCloudBackup(created.id!);
    expect(gunzipSync(readFileSync(context.files.path)).toString("utf8")).toContain("project-launch-backup");
    context.setSyncState(1);
    await expect(context.bridge.deleteBackup(created.id!)).rejects.toThrow("拉取");
    context.setSyncState(0);
    await context.bridge.deleteBackup(created.id!);
    expect(context.attachments.size).toBe(0);
    context.failAttachment();
    await expect(context.bridge.createBackup({ destination: "utools" })).rejects.toThrow("未完成");
    const failed = (await context.bridge.listBackups()).entries[0];
    expect(failed.complete).toBe(false);
    await context.bridge.deleteBackup(failed.id);
    expect((await context.bridge.listBackups()).entries).toEqual([]);
  });

  it("rejects damaged content and keeps metadata when attachment deletion fails", async () => {
    const context = fixture();
    const created = await context.bridge.createBackup({ destination: "utools" });
    const attachmentId = [...context.attachments.keys()][0];
    context.attachments.set(attachmentId, Buffer.from("damaged"));
    await expect(context.bridge.prepareBackup({ source: "utools", id: created.id })).rejects.toThrow("校验");
    context.failRemoval();
    await expect(context.bridge.deleteBackup(created.id!)).rejects.toThrow("删除失败");
    expect((await context.bridge.listBackups()).entries).toHaveLength(1);
  });

  it("restores only the selected category and merges matching projects instead of skipping them", async () => {
    const context = fixture();
    await context.bridge.saveProjects([project("one")]);
    context.bridge.saveProjectEnvironmentOverrides("one", { env: { KEY: "old" }, localOnlyEnvKeys: ["KEY"] });
    await context.bridge.createBackup({ destination: "local" });
    await context.bridge.saveProjects([{ ...project("one"), memo: "new" }, project("two")]);
    await context.bridge.prepareBackup({ source: "local" });
    await context.bridge.restoreBackup({ ...restoreOptions, projects: false });
    expect((await context.bridge.loadProjects()).map((entry) => entry.id)).toEqual(["one", "two"]);
    expect((await context.bridge.loadProjects())[0].memo).toBe("new");
    await context.bridge.prepareBackup({ source: "local" });
    await context.bridge.restoreBackup({ ...restoreOptions, configuration: false, projectMode: "merge" });
    expect((await context.bridge.loadProjects()).map((entry) => entry.id)).toEqual(["one", "two"]);
    expect((await context.bridge.loadProjects())[0].memo).toBe("");
    writeFileSync(context.files.path, '{"format":"invalid"}');
    await expect(context.bridge.prepareBackup({ source: "local" })).rejects.toThrow("格式");
    await expect(context.bridge.restoreBackup(restoreOptions)).rejects.toThrow("预览");
  });

  it("uses one attachment for a large backup and blocks missing content without changing projects", async () => {
    const context = fixture();
    await context.bridge.saveProjects([
      { ...project("large", "private"), memo: randomBytes(7 * 1024 * 1024).toString("base64") },
    ]);
    const created = await context.bridge.createBackup({ destination: "utools" });
    expect(context.attachments.size).toBe(1);
    expect([...context.attachments.values()][0].length).toBeLessThanOrEqual(10_000_000);
    await context.bridge.prepareBackup({ source: "utools", id: created.id });
    context.attachments.delete([...context.attachments.keys()][0]);
    await expect(context.bridge.prepareBackup({ source: "utools", id: created.id })).rejects.toThrow("同步完整");
    await expect(context.bridge.restoreBackup(restoreOptions)).rejects.toThrow("预览");
    expect((await context.bridge.loadProjects())[0].path).toBe("D:/develop/large");
  });

  it("rejects oversized database backups before writing and still allows local export", async () => {
    const context = fixture();
    await context.bridge.saveProjects([
      { ...project("large", "private"), memo: randomBytes(10 * 1024 * 1024).toString("base64") },
    ]);
    await expect(context.bridge.createBackup({ destination: "utools" })).rejects.toThrow("改用本地导出");
    expect(context.documents.size).toBe(0);
    expect(context.attachments.size).toBe(0);
    await context.bridge.createBackup({ destination: "local" });
    expect(readFileSync(context.files.path).length).toBeGreaterThan(10_000_000);
    const preview = await context.bridge.prepareBackup({ source: "local" });
    expect(preview.summary?.projectCount).toBe(1);
  });

  it("excludes service and icon pack directories from backup content", async () => {
    const context = fixture();
    for (const name of ["service", "icon-packs"]) {
      const directory = join(context.directory, name);
      mkdirSync(directory);
      writeFileSync(join(directory, "resource.bin"), randomBytes(6 * 1024 * 1024));
    }
    await context.bridge.saveProjects([project("one", "private")]);
    await context.bridge.createBackup({ destination: "utools" });
    expect(context.attachments.size).toBe(1);
    const bytes = [...context.attachments.values()][0];
    expect(bytes.length).toBeLessThan(10_000);
    const payload = JSON.parse(gunzipSync(bytes).toString("utf8"));
    expect(Object.keys(payload).sort()).toEqual(["createdAt", "format", "localState", "projects", "source", "version"]);
    expect(payload.projects).toHaveLength(1);
    expect(payload.localState).toEqual({
      schemaVersion: 1,
      preferences: {},
      workspace: {
        dashboardProjectGroup: "all",
        workActivity: { selectionInitialized: false, preferences: null, selectedProjectIds: [] },
      },
      publicProjectOverrides: {},
    });
  });

  it("keeps device configuration on a projects-only restore and pauses imported automation", async () => {
    const context = fixture();
    const settings = context.bridge.loadUiPreferences();
    await context.bridge.saveProjects([
      {
        ...project("one"),
        automationTasks: [{ id: "task", name: "task", enabled: true }],
      } as unknown as import("../src/types").Project,
    ]);
    context.bridge.saveUiPreferences({
      ...settings,
      projectDetails: { ...settings.projectDetails, defaultTab: "memo" },
    });
    await context.bridge.createBackup({ destination: "local" });
    context.bridge.saveUiPreferences({
      ...settings,
      projectDetails: { ...settings.projectDetails, defaultTab: "scripts" },
    });
    await context.bridge.prepareBackup({ source: "local" });
    await context.bridge.restoreBackup({ ...restoreOptions, configuration: false });
    expect(context.bridge.loadUiPreferences().projectDetails.defaultTab).toBe("scripts");
    const restoredProjects = await context.bridge.loadProjects();
    expect(restoredProjects[0]?.automationTasks?.[0]?.enabled).toBe(false);
    await context.bridge.prepareBackup({ source: "local" });
    await context.bridge.restoreBackup({ ...restoreOptions, projects: false });
    expect(context.bridge.loadUiPreferences().projectDetails.defaultTab).toBe("memo");
  });
});
