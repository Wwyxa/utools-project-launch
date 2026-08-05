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
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-remotes-"));
const projectRoot = path.join(fixtureRoot, "project");
const originRoot = path.join(fixtureRoot, "origin.git");
const upstreamRoot = path.join(fixtureRoot, "upstream.git");
const unbornRoot = path.join(fixtureRoot, "unborn");

const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const initializeRepository = (cwd) => {
  fs.mkdirSync(cwd, { recursive: true });
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.email", "git-remotes@example.invalid");
  git(cwd, "config", "user.name", "Git Remotes Validation");
};
const commit = (cwd, name, content, message) => {
  fs.writeFileSync(path.join(cwd, name), content);
  git(cwd, "add", "--", name);
  git(cwd, "commit", "-m", message);
};

execFileSync("git", ["init", "--bare", originRoot], { encoding: "utf8" });
execFileSync("git", ["init", "--bare", upstreamRoot], { encoding: "utf8" });
initializeRepository(projectRoot);
commit(projectRoot, "README.md", "base\n", "initial commit");
git(projectRoot, "remote", "add", "origin", originRoot);
git(projectRoot, "remote", "add", "upstream", upstreamRoot);

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
  git(projectRoot, "switch", "-c", "feature/publish-origin");
  commit(projectRoot, "origin.txt", "origin\n", "publish origin");
  const publishOrigin = await bridge.publishGitBranch(projectRoot, "origin");
  assert.equal(publishOrigin.ok, true);
  assert.equal(publishOrigin.remote, "origin");
  assert.equal(publishOrigin.branch, "feature/publish-origin");
  assert.equal(git(originRoot, "show-ref", "--verify", "--hash", "refs/heads/feature/publish-origin").trim().length > 0, true);
  assert.equal(git(projectRoot, "config", "--get", "branch.feature/publish-origin.remote").trim(), "origin");
  assert.equal(
    git(projectRoot, "config", "--get", "branch.feature/publish-origin.merge").trim(),
    "refs/heads/feature/publish-origin",
  );
  const originSnapshot = await bridge.readGitStatusSnapshot(projectRoot);
  assert.equal(originSnapshot.upstream?.ref, "origin/feature/publish-origin");
  assert.equal((await bridge.publishGitBranch(projectRoot, "origin")).ok, false);

  git(projectRoot, "switch", "main");
  git(projectRoot, "switch", "-c", "feature/publish-upstream");
  commit(projectRoot, "upstream.txt", "upstream\n", "publish upstream");
  const publishUpstream = await bridge.publishGitBranch(projectRoot, "upstream");
  assert.equal(publishUpstream.ok, true);
  assert.equal(publishUpstream.remote, "upstream");
  assert.equal(git(upstreamRoot, "show-ref", "--verify", "--hash", "refs/heads/feature/publish-upstream").trim().length > 0, true);
  assert.equal(git(projectRoot, "config", "--get", "branch.feature/publish-upstream.remote").trim(), "upstream");

  git(projectRoot, "switch", "main");
  git(projectRoot, "switch", "-c", "feature/rejected");
  git(projectRoot, "remote", "add", "rejected", path.join(fixtureRoot, "missing.git"));
  const rejected = await bridge.publishGitBranch(projectRoot, "rejected");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.remote, "rejected");
  assert.throws(() => git(projectRoot, "config", "--get", "branch.feature/rejected.remote"));
  assert.equal((await bridge.publishGitBranch(projectRoot, "missing")).ok, false);
  assert.equal((await bridge.publishGitBranch(projectRoot, "origin;invalid")).ok, false);

  git(projectRoot, "checkout", "--detach");
  assert.equal((await bridge.publishGitBranch(projectRoot, "origin")).ok, false);

  fs.mkdirSync(unbornRoot, { recursive: true });
  git(unbornRoot, "init", "-b", "main");
  git(unbornRoot, "remote", "add", "origin", originRoot);
  assert.equal((await bridge.publishGitBranch(unbornRoot, "origin")).ok, false);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
