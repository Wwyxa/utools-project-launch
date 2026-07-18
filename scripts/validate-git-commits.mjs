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
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-commits-"));
const projectRoot = path.join(fixtureRoot, "project");

const runGit = (...args) => execFileSync("git", ["-C", projectRoot, ...args], { encoding: "utf8" });

fs.mkdirSync(projectRoot, { recursive: true });
runGit("init");
runGit("config", "user.email", "git-commits@example.invalid");
runGit("config", "user.name", "Git Commits Validation");
fs.writeFileSync(path.join(projectRoot, "history.txt"), "first\n");
runGit("add", "--", "history.txt");
runGit("commit", "-m", "first commit");
fs.appendFileSync(path.join(projectRoot, "history.txt"), "second\n");
runGit("add", "--", "history.txt");
runGit("commit", "-m", "second commit");

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
  const page = await bridge.readGitCommits(projectRoot, { limit: 20 });
  assert.equal(page.commits.length, 2);

  const [latestCommit, rootCommit] = page.commits;
  assert.match(latestCommit.hash, /^[0-9a-f]{40,64}$/);
  assert.match(rootCommit.hash, /^[0-9a-f]{40,64}$/);
  assert.deepEqual(Array.from(latestCommit.parents), [rootCommit.hash]);
  assert.deepEqual(Array.from(rootCommit.parents), []);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
