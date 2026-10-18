import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreloadSandbox } from "./helpers/preload-sandbox.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "public", "plugin.json"), "utf8"));
const preloadPackageScope = JSON.parse(fs.readFileSync(path.join(repoRoot, "public", "package.json"), "utf8"));
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-files-"));
const projectRoot = path.join(fixtureRoot, "project");
const outsideRoot = path.join(fixtureRoot, "outside");
const revealedPaths = [];

assert.equal(pluginManifest.preload, "preload.js", "uTools only accepts a .js preload entry");
assert.equal(
  preloadPackageScope.type,
  "commonjs",
  "the public package scope must keep preload.js compatible with uTools require()",
);

fs.mkdirSync(path.join(projectRoot, "src", "nested"), { recursive: true });
fs.mkdirSync(path.join(projectRoot, "node_modules", "hidden"), { recursive: true });
fs.mkdirSync(path.join(projectRoot, "src", "node_modules"), { recursive: true });
fs.mkdirSync(path.join(projectRoot, "__pycache__"), { recursive: true });
fs.mkdirSync(path.join(projectRoot, "src", "__pycache__"), { recursive: true });
fs.mkdirSync(path.join(projectRoot, "dist"), { recursive: true });
fs.mkdirSync(outsideRoot, { recursive: true });
fs.writeFileSync(path.join(projectRoot, "src", "nested", "target-one.txt"), "one");
fs.writeFileSync(path.join(projectRoot, "src", "target-two.txt"), "two");
fs.writeFileSync(path.join(projectRoot, "node_modules", "hidden", "target-hidden.txt"), "hidden");
fs.writeFileSync(path.join(projectRoot, "dist", "target-built.txt"), "built");
fs.writeFileSync(path.join(outsideRoot, "outside.txt"), "outside");

const {
  window: { projectBridge: bridge },
} = createPreloadSandbox({
  electron: {
    shell: {
      openExternal: () => Promise.resolve(),
      openPath: () => Promise.resolve(),
      showItemInFolder: (targetPath) => revealedPaths.push(targetPath),
    },
  },
});

try {
  assert.deepEqual(Array.from(bridge.listProjectSubdirectories(projectRoot)), [".", "src", "src/nested"]);

  const rootList = bridge.listProjectFiles(projectRoot);
  assert.equal(
    rootList.entries.some((entry) => entry.name === "node_modules"),
    false,
  );
  assert.equal(
    rootList.entries.some((entry) => entry.name === "dist"),
    false,
  );

  const search = await bridge.searchProjectFiles(projectRoot, "target", { limit: 20 });
  assert.deepEqual(Array.from(search.entries, (entry) => entry.relativePath).sort(), [
    "src/nested/target-one.txt",
    "src/target-two.txt",
  ]);
  assert.equal(search.truncated, false);
  const limitedSearch = await bridge.searchProjectFiles(projectRoot, "target", { limit: 1 });
  assert.equal(limitedSearch.entries.length, 1);
  assert.equal(limitedSearch.truncated, true);

  const createdDirectory = bridge.createProjectEntry(projectRoot, "src", "created", "directory");
  assert.equal(createdDirectory.ok, true);
  const createdFile = bridge.createProjectEntry(projectRoot, "src/created", "note.txt", "file");
  assert.equal(createdFile.ok, true);
  assert.equal(fs.readFileSync(path.join(projectRoot, "src", "created", "note.txt"), "utf8"), "");
  assert.equal(bridge.createProjectEntry(projectRoot, "src/created", "note.txt", "file").ok, false);

  for (const invalidName of [
    "",
    ".",
    "..",
    "bad/name",
    "bad\\name",
    "CON",
    "trailing.",
    "trailing ",
    "bad\u0000name",
  ]) {
    assert.equal(bridge.createProjectEntry(projectRoot, "src", invalidName, "file").ok, false, invalidName);
  }
  assert.equal(bridge.createProjectEntry(projectRoot, "../outside", "escape.txt", "file").ok, false);

  fs.writeFileSync(path.join(projectRoot, "src", "created", "note.txt"), "preserved");
  const renamed = bridge.renameProjectEntry(projectRoot, "src/created/note.txt", "renamed.txt");
  assert.equal(renamed.ok, true);
  assert.equal(renamed.previousRelativePath, "src/created/note.txt");
  assert.equal(renamed.relativePath, "src/created/renamed.txt");
  assert.equal(fs.readFileSync(path.join(projectRoot, "src", "created", "renamed.txt"), "utf8"), "preserved");
  assert.equal(bridge.renameProjectEntry(projectRoot, "", "renamed-root").ok, false);
  assert.equal(bridge.deleteProjectEntry(projectRoot, "").ok, false);
  assert.equal(bridge.deleteProjectEntry(projectRoot, "../outside/outside.txt").ok, false);

  const deleted = bridge.deleteProjectEntry(projectRoot, "src/created");
  assert.equal(deleted.ok, true);
  assert.equal(deleted.kind, "directory");
  assert.equal(fs.existsSync(path.join(projectRoot, "src", "created")), false);

  let symlinkCreated = false;
  try {
    fs.symlinkSync(
      outsideRoot,
      path.join(projectRoot, "outside-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    symlinkCreated = true;
  } catch {
    symlinkCreated = false;
  }
  if (symlinkCreated) {
    assert.equal(bridge.createProjectEntry(projectRoot, "outside-link", "escaped.txt", "file").ok, false);
    assert.equal(bridge.deleteProjectEntry(projectRoot, "outside-link/outside.txt").ok, false);
    assert.throws(() => bridge.listProjectFiles(projectRoot, "outside-link"));
    assert.throws(() => bridge.readProjectFile(projectRoot, "outside-link/outside.txt"));
    assert.throws(() => bridge.writeProjectFile(projectRoot, "outside-link/outside.txt", "escaped"));
    assert.equal(fs.readFileSync(path.join(outsideRoot, "outside.txt"), "utf8"), "outside");
    const symlinkSearch = await bridge.searchProjectFiles(projectRoot, "outside", { limit: 20 });
    assert.equal(
      symlinkSearch.entries.some((entry) => entry.relativePath.includes("outside-link")),
      false,
    );
  }

  let internalSymlinkCreated = false;
  try {
    fs.symlinkSync(
      path.join(projectRoot, "src", "nested"),
      path.join(projectRoot, "nested-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    internalSymlinkCreated = true;
  } catch {
    internalSymlinkCreated = false;
  }
  if (internalSymlinkCreated) {
    assert.equal(bridge.renameProjectEntry(projectRoot, "nested-link", "renamed-link").ok, false);
    assert.equal(bridge.deleteProjectEntry(projectRoot, "nested-link").ok, false);
    assert.equal(fs.existsSync(path.join(projectRoot, "src", "nested", "target-one.txt")), true);
  }

  bridge.showProjectEntryInFolder(projectRoot, "src/target-two.txt");
  assert.equal(revealedPaths.at(-1), fs.realpathSync(path.join(projectRoot, "src", "target-two.txt")));
  assert.throws(() => bridge.showProjectEntryInFolder(projectRoot, "../outside/outside.txt"));

  const openWithRelativePath = "src/a 'quoted' $ file.txt";
  fs.writeFileSync(path.join(projectRoot, openWithRelativePath), "open with");
  const openWithPath = fs.realpathSync(path.join(projectRoot, openWithRelativePath));
  const macApplication = path.join(fixtureRoot, "Test Editor.app");
  const linuxApplication = path.join(fixtureRoot, "Test Editor.desktop");
  fs.mkdirSync(macApplication);
  fs.writeFileSync(linuxApplication, "[Desktop Entry]\nType=Application\nExec=editor %f\n");

  for (const platform of ["win32", "darwin", "linux"]) {
    const calls = [];
    let launchError = null;
    let selectedApplication = platform === "darwin" ? macApplication : linuxApplication;
    const sandbox = createPreloadSandbox({
      child_process: {
        ...childProcess,
        execFile(executable, args, options, callback) {
          calls.push({ executable, args: Array.from(args), options });
          callback(launchError);
        },
      },
    });
    sandbox.process.platform = platform;
    sandbox.window.utools.showOpenDialog = () => (selectedApplication ? [selectedApplication] : undefined);
    const openWith = sandbox.window.projectBridge.openProjectFileWith;

    await openWith(projectRoot, openWithRelativePath);
    assert.equal(calls.length, 1, platform);
    assert.equal(calls[0].options.shell, undefined, "File paths must not pass through a shell");
    assert.deepEqual(
      calls[0].args,
      platform === "win32"
        ? ["shell32.dll,OpenAs_RunDLL", openWithPath]
        : platform === "darwin"
          ? ["-a", macApplication, openWithPath]
          : ["launch", linuxApplication, openWithPath],
    );
    assert.equal(
      calls[0].executable,
      platform === "win32"
        ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "rundll32.exe")
        : platform === "darwin"
          ? "/usr/bin/open"
          : "gio",
    );

    await assert.rejects(() => openWith(projectRoot, "../outside/outside.txt"));
    await assert.rejects(() => openWith(projectRoot, "src"));
    assert.equal(calls.length, 1, "Invalid targets must not launch an application");
    launchError = new Error("launch failed");
    await assert.rejects(() => openWith(projectRoot, openWithRelativePath), /launch failed/);

    if (platform !== "win32") {
      const launchesBeforeCancel = calls.length;
      selectedApplication = undefined;
      await openWith(projectRoot, openWithRelativePath);
      assert.equal(calls.length, launchesBeforeCancel, "Cancelling must not launch an application");
      selectedApplication = openWithPath;
      await assert.rejects(() => openWith(projectRoot, openWithRelativePath));
      assert.equal(calls.length, launchesBeforeCancel, "Invalid applications must not launch");
    }
  }

  const applicationDirectory = path.join(fixtureRoot, "applications");
  fs.mkdirSync(applicationDirectory);
  const desktopPath = path.join(applicationDirectory, "test-editor.desktop");
  fs.writeFileSync(
    desktopPath,
    "[Desktop Entry]\nType=Application\nName=Test Editor\nName[zh_CN]=Localized Editor\nExec=editor %f\n[Desktop Action Other]\nName=Other\n",
  );
  fs.writeFileSync(
    path.join(applicationDirectory, "hidden.desktop"),
    "[Desktop Entry]\nType=Application\nHidden=true\nName=Hidden\n",
  );
  for (const platform of ["win32", "darwin", "linux"]) {
    const calls = [];
    const applicationId = platform === "linux" ? desktopPath : macApplication;
    const application = { id: applicationId, name: "Test Editor", iconPath: applicationId };
    const sandbox = createPreloadSandbox({
      child_process: {
        ...childProcess,
        execFile(executable, args, options, callback) {
          calls.push({ executable, args: Array.from(args), options });
          let output = "";
          if (executable === "powershell.exe") output = JSON.stringify([application, application]);
          else if (executable === "/usr/bin/osascript") output = JSON.stringify([application, application]);
          else if (args[0] === "info") output = "  standard::content-type: text/plain\n";
          else if (args[0] === "mime")
            output =
              "Registered applications:\n  test-editor.desktop\n  hidden.desktop\n  missing.desktop\nRecommended applications:\n  test-editor.desktop\n";
          callback(null, output);
        },
      },
    });
    sandbox.process.platform = platform;
    sandbox.process.env.XDG_DATA_HOME = fixtureRoot;
    sandbox.process.env.XDG_DATA_DIRS = fixtureRoot;
    sandbox.process.env.LC_MESSAGES = "zh_CN.UTF-8";
    sandbox.window.utools.getFileIconAsync = async () => "data:image/png;base64,icon";
    const applicationBridge = sandbox.window.projectBridge;
    const [applications] = await Promise.all([
      applicationBridge.listProjectFileApplications(projectRoot, openWithRelativePath),
      applicationBridge.listProjectFileApplications(projectRoot, "src/target-two.txt"),
    ]);
    if (platform === "win32") {
      assert.equal(calls.length, 1, "Concurrent files with the same extension must share a query");
      await applicationBridge.listProjectFileApplications(projectRoot, "src/target-two.txt");
      assert.equal(calls.length, 1, "Cached extensions must not start another PowerShell process");
    }
    assert.equal(applications.length, 1, "Duplicate, missing and hidden applications must be excluded");
    assert.equal(applications[0].id, applicationId);
    assert.equal(applications[0].name, platform === "linux" ? "Localized Editor" : "Test Editor");
    assert.equal(applications[0].icon, "data:image/png;base64,icon");
    await assert.rejects(() => applicationBridge.listProjectFileApplications(projectRoot, "../outside/outside.txt"));
    await applicationBridge.openProjectFileWith(projectRoot, openWithRelativePath, applicationId);
    const launch = calls.at(-1);
    assert.equal(launch.options.shell, undefined);
    if (platform === "win32") {
      assert.equal(launch.executable, "powershell.exe");
      assert.equal(launch.args.includes("-File"), false, "PowerShell cannot read scripts inside an ASAR archive");
      const command = Buffer.from(launch.args[launch.args.indexOf("-EncodedCommand") + 1], "base64").toString(
        "utf16le",
      );
      assert.ok(
        command.includes("public static class FileApplications"),
        "The script must be read by preload and passed inline",
      );
      assert.ok(
        command.endsWith(`} '${openWithPath.replace(/'/g, "''")}' '${applicationId.replace(/'/g, "''")}'`),
        "Paths must be passed as escaped PowerShell literals",
      );
    } else {
      assert.deepEqual(
        launch.args,
        platform === "darwin" ? ["-a", applicationId, openWithPath] : ["launch", applicationId, openWithPath],
      );
      await assert.rejects(() =>
        applicationBridge.openProjectFileWith(projectRoot, openWithRelativePath, "unregistered"),
      );
    }
  }

  let retryCalls = 0;
  const retrySandbox = createPreloadSandbox({
    child_process: {
      ...childProcess,
      execFile(executable, args, options, callback) {
        retryCalls += 1;
        callback(retryCalls === 1 ? new Error("temporary lookup failure") : null, "[]");
      },
    },
  });
  retrySandbox.process.platform = "win32";
  const retryLookup = () =>
    retrySandbox.window.projectBridge.listProjectFileApplications(projectRoot, openWithRelativePath);
  await assert.rejects(retryLookup, /temporary lookup failure/);
  await retryLookup();
  assert.equal(retryCalls, 2, "Failed queries must not be cached");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
