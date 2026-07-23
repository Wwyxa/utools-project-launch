import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preloadSource = fs.readFileSync(path.join(repoRoot, "public", "preload.js"), "utf8");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-files-"));
const projectRoot = path.join(fixtureRoot, "project");
const outsideRoot = path.join(fixtureRoot, "outside");
const revealedPaths = [];

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

const sandbox = {
  TextDecoder,
  clearTimeout,
  console: { warn() {}, error() {}, log() {} },
  process: { env: { ...process.env }, platform: process.platform, once() {}, exit() {} },
  require(moduleName) {
    if (moduleName === "electron") {
      return {
        shell: {
          openExternal: () => Promise.resolve(),
          openPath: () => Promise.resolve(),
          showItemInFolder(targetPath) {
            revealedPaths.push(targetPath);
          },
        },
      };
    }
    return require(moduleName);
  },
  setTimeout,
  window: {
    dispatchEvent() {},
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    utools: { onPluginOut() {} },
  },
};
sandbox.globalThis = sandbox;
vm.runInNewContext(preloadSource, sandbox, { filename: "public/preload.js" });
const bridge = sandbox.window.projectBridge;

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
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
