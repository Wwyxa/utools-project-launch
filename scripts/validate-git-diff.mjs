import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preloadSource = fs.readFileSync(path.join(repoRoot, "public", "preload.js"), "utf8");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-diff-"));
const projectRoot = path.join(fixtureRoot, "project");

const runGit = (...args) => execFileSync("git", ["-C", projectRoot, ...args], { encoding: "utf8" });

fs.mkdirSync(projectRoot, { recursive: true });
runGit("init");
runGit("config", "user.email", "git-diff@example.invalid");
runGit("config", "user.name", "Git Diff Validation");
fs.writeFileSync(path.join(projectRoot, "mixed.txt"), "base\n");
runGit("add", "--", "mixed.txt");
runGit("commit", "-m", "initial");
fs.writeFileSync(path.join(projectRoot, "mixed.txt"), "staged\n");
runGit("add", "--", "mixed.txt");
fs.writeFileSync(path.join(projectRoot, "mixed.txt"), "unstaged\n");
fs.writeFileSync(path.join(projectRoot, "untracked.txt"), "new file\n");

const sandbox = {
  TextDecoder,
  clearTimeout,
  console: { warn() {}, error() {}, log() {} },
  process: { env: { ...process.env }, platform: process.platform, once() {}, exit() {} },
  require(moduleName) {
    if (moduleName === "electron") {
      return {
        shell: { openExternal: () => Promise.resolve(), openPath: () => Promise.resolve(), showItemInFolder() {} },
      };
    }
    return require(moduleName);
  },
  setTimeout,
  window: {
    dispatchEvent() {},
    localStorage: { getItem: () => null, setItem() {} },
    utools: { onPluginOut() {} },
  },
};
sandbox.globalThis = sandbox;
vm.runInNewContext(preloadSource, sandbox, { filename: "public/preload.js" });
const bridge = sandbox.window.projectBridge;

try {
  const staged = bridge.readGitFileDiff(projectRoot, "mixed.txt", { scope: "staged" });
  assert.equal(staged.scope, "staged");
  assert.match(staged.diff, /\+staged/);
  assert.doesNotMatch(staged.diff, /\+unstaged/);

  const unstaged = bridge.readGitFileDiff(projectRoot, "mixed.txt", { scope: "unstaged" });
  assert.equal(unstaged.scope, "unstaged");
  assert.match(unstaged.diff, /\+unstaged/);
  assert.doesNotMatch(unstaged.diff, /\+staged/);

  const combined = bridge.readGitFileDiff(projectRoot, "mixed.txt");
  assert.equal(combined.scope, "combined");
  assert.match(combined.diff, /\+staged/);
  assert.match(combined.diff, /\+unstaged/);

  const untracked = bridge.readGitFileDiff(projectRoot, "untracked.txt", { scope: "unstaged" });
  assert.match(untracked.diff, /\+new file/);
  assert.equal(bridge.readGitFileDiff(projectRoot, "untracked.txt", { scope: "staged" }).diff, "");

  const empty = bridge.readGitFileDiff(projectRoot, "", { scope: "unstaged" });
  assert.equal(empty.scope, "unstaged");
  assert.equal(empty.diff, "");
  assert.throws(() => bridge.readGitFileDiff(projectRoot, "../outside.txt", { scope: "staged" }));

  const normalized = bridge.readGitFileDiff(projectRoot, "mixed.txt", { scope: "unknown" });
  assert.equal(normalized.scope, "combined");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
