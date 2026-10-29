import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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
    const avatarDirectory = join(target.directory, "cache", "git-avatars");
    mkdirSync(avatarDirectory, { recursive: true });
    writeFileSync(join(avatarDirectory, "existing.json"), "existing-avatar");
    target.files.path = source.files.path;
    const preview = await target.bridge.prepareBackup({ source: "local" });
    expect(preview.summary?.projectCount).toBe(2);
    expect(preview.summary?.source.hostname).toBeTruthy();
    const result = await target.bridge.restoreBackup(restoreOptions);
    expect(result.ok).toBe(true);
    expect(readFileSync(join(avatarDirectory, "existing.json"), "utf8")).toBe("existing-avatar");
    expect(gunzipSync(readFileSync(result.recoveryPath)).toString("utf8")).toContain("project-launch-backup");
    expect((await target.bridge.loadProjects()).map((entry) => entry.path)).toEqual(["/work/public", "/work/private"]);
    expect(target.bridge.loadProjectEnvironmentOverrides("public").env.TOKEN).toBe("private-value");
    expect([...target.documents.keys()].some((id) => id.endsWith("/private"))).toBe(false);
    expect(readFileSync(join(target.directory, "local-state.v1.json"), "utf8")).not.toMatch(
      /deviceId|nativeId|hostname/,
    );
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
