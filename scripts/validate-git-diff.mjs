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
runGit("config", "core.commentchar", ";");
fs.writeFileSync(path.join(projectRoot, "mixed.txt"), "base\n");
const contextLines = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`);
fs.writeFileSync(path.join(projectRoot, "working-context.txt"), `${contextLines.join("\n")}\n`);
fs.writeFileSync(path.join(projectRoot, "commit-context.txt"), `${contextLines.join("\n")}\n`);
fs.writeFileSync(path.join(projectRoot, "whitespace-only.txt"), "value = 1\n");
fs.writeFileSync(path.join(projectRoot, "whitespace-and-content.txt"), "value = 1\nstay\n");
fs.writeFileSync(path.join(projectRoot, "commit-whitespace-only.txt"), "value = 1\n");
fs.writeFileSync(path.join(projectRoot, "commit-whitespace-and-content.txt"), "value = 1\nstay\n");
runGit("add", "--", "mixed.txt");
runGit(
  "add",
  "--",
  "working-context.txt",
  "commit-context.txt",
  "whitespace-only.txt",
  "whitespace-and-content.txt",
  "commit-whitespace-only.txt",
  "commit-whitespace-and-content.txt",
);
runGit("commit", "-m", "initial");
const changedCommitContext = contextLines.map((line, index) =>
  index === 1 || index === 10 ? `${line} changed` : line,
);
fs.writeFileSync(path.join(projectRoot, "commit-context.txt"), `${changedCommitContext.join("\n")}\n`);
runGit("add", "--", "commit-context.txt");
runGit("commit", "-m", "context commit");
const contextCommitHash = runGit("rev-parse", "HEAD").trim();
fs.writeFileSync(path.join(projectRoot, "commit-whitespace-only.txt"), "value   = 1\n\n");
fs.writeFileSync(path.join(projectRoot, "commit-whitespace-and-content.txt"), "value   = 1\nstay changed\n\n");
runGit("add", "--", "commit-whitespace-only.txt", "commit-whitespace-and-content.txt");
runGit("commit", "-m", "whitespace commit");
const whitespaceCommitHash = runGit("rev-parse", "HEAD").trim();
fs.writeFileSync(path.join(projectRoot, "mixed.txt"), "staged\n");
runGit("add", "--", "mixed.txt");
fs.writeFileSync(path.join(projectRoot, "mixed.txt"), "unstaged\n");
fs.writeFileSync(path.join(projectRoot, "untracked.txt"), "new file\n");
const changedWorkingContext = contextLines.map((line, index) =>
  index === 1 || index === 10 ? `${line} changed` : line,
);
fs.writeFileSync(path.join(projectRoot, "working-context.txt"), `${changedWorkingContext.join("\n")}\n`);
fs.writeFileSync(path.join(projectRoot, "whitespace-only.txt"), "value   = 1\n\n");
fs.writeFileSync(path.join(projectRoot, "whitespace-and-content.txt"), "value   = 1\nstay changed\n\n");

const sandbox = {
  CustomEvent,
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

  const defaultWorkingContext = bridge.readGitFileDiff(projectRoot, "working-context.txt", { scope: "unstaged" });
  assert.doesNotMatch(defaultWorkingContext.diff, / line-6/);
  const fullWorkingContext = bridge.readGitFileDiff(projectRoot, "working-context.txt", {
    scope: "unstaged",
    fullFile: true,
  });
  assert.match(fullWorkingContext.diff, / line-6/);

  const whitespaceOnly = bridge.readGitFileDiff(projectRoot, "whitespace-only.txt", {
    scope: "unstaged",
    ignoreWhitespace: true,
  });
  assert.equal(whitespaceOnly.diff, "");

  const whitespaceAndContent = bridge.readGitFileDiff(projectRoot, "whitespace-and-content.txt", {
    scope: "unstaged",
    ignoreWhitespace: true,
  });
  assert.match(whitespaceAndContent.diff, /\+stay changed/);
  assert.doesNotMatch(whitespaceAndContent.diff, /^[+-]value/m);

  const defaultCommitContext = bridge.readGitCommitFileDiff(projectRoot, contextCommitHash, "commit-context.txt");
  assert.doesNotMatch(defaultCommitContext.diff, / line-6/);
  const fullCommitContext = bridge.readGitCommitFileDiff(
    projectRoot,
    contextCommitHash,
    "commit-context.txt",
    undefined,
    {
      fullFile: true,
    },
  );
  assert.match(fullCommitContext.diff, / line-6/);

  const whitespaceOnlyCommit = bridge.readGitCommitFileDiff(
    projectRoot,
    whitespaceCommitHash,
    "commit-whitespace-only.txt",
    undefined,
    { ignoreWhitespace: true },
  );
  assert.equal(whitespaceOnlyCommit.diff, "");
  const whitespaceAndContentCommit = bridge.readGitCommitFileDiff(
    projectRoot,
    whitespaceCommitHash,
    "commit-whitespace-and-content.txt",
    undefined,
    { ignoreWhitespace: true },
  );
  assert.match(whitespaceAndContentCommit.diff, /\+stay changed/);
  assert.doesNotMatch(whitespaceAndContentCommit.diff, /^[+-]value/m);

  runGit("stash", "push", "-u", "-m", "diff validation stash");
  const stashHash = runGit("rev-parse", "refs/stash").trim();
  const [, stashBaseHash] = runGit("rev-list", "--parents", "-n", "1", stashHash).trim().split(" ");
  const stash = { baseHash: stashBaseHash, untrackedFilesHash: null };
  const defaultStashContext = bridge.readGitCommitFileDiff(projectRoot, stashHash, "working-context.txt", stash);
  assert.doesNotMatch(defaultStashContext.diff, / line-6/);
  const fullStashContext = bridge.readGitCommitFileDiff(projectRoot, stashHash, "working-context.txt", stash, {
    fullFile: true,
  });
  assert.match(fullStashContext.diff, / line-6/);
  const whitespaceOnlyStash = bridge.readGitCommitFileDiff(projectRoot, stashHash, "whitespace-only.txt", stash, {
    ignoreWhitespace: true,
  });
  assert.equal(whitespaceOnlyStash.diff, "");
  const whitespaceAndContentStash = bridge.readGitCommitFileDiff(
    projectRoot,
    stashHash,
    "whitespace-and-content.txt",
    stash,
    { ignoreWhitespace: true },
  );
  assert.match(whitespaceAndContentStash.diff, /\+stay changed/);
  assert.doesNotMatch(whitespaceAndContentStash.diff, /^[+-]value/m);

  const baseBranchName = runGit("symbolic-ref", "--short", "HEAD").trim();
  const originPath = path.join(fixtureRoot, "origin.git");
  runGit("init", "--bare", originPath);
  runGit("remote", "add", "origin", originPath);
  fs.writeFileSync(path.join(projectRoot, "base-advance.txt"), "base advance\n");
  runGit("add", "--", "base-advance.txt");
  runGit("commit", "-m", "base advance");
  runGit("push", "origin", baseBranchName);
  runGit("fetch", "origin");
  runGit("remote", "set-head", "origin", baseBranchName);

  const initialBaseSnapshot = await bridge.readGitStatusSnapshot(projectRoot);
  assert.equal(initialBaseSnapshot.mergeInProgress, false);
  assert.equal(initialBaseSnapshot.base?.behind, 0);

  const divergeHash = runGit("rev-parse", "HEAD~1").trim();
  runGit("switch", "-c", "feature/merge-base", divergeHash);
  const beforeMergeSnapshot = await bridge.readGitStatusSnapshot(projectRoot);
  assert.equal(beforeMergeSnapshot.base?.ref, `origin/${baseBranchName}`);
  assert.equal(beforeMergeSnapshot.base?.behind, 1);

  const fastForward = await bridge.mergeGitBaseBranch(projectRoot);
  assert.equal(fastForward.ok, true);
  assert.match(fastForward.message, /已快进合并/);
  assert.equal(runGit("rev-parse", "HEAD").trim(), runGit("rev-parse", `origin/${baseBranchName}`).trim());

  fs.writeFileSync(path.join(projectRoot, "conflict-file.txt"), "feature\n");
  runGit("add", "--", "conflict-file.txt");
  runGit("commit", "-m", "feature conflict");
  runGit("switch", "--", baseBranchName);
  fs.writeFileSync(path.join(projectRoot, "conflict-file.txt"), "base\n");
  runGit("add", "--", "conflict-file.txt");
  runGit("commit", "-m", "base conflict");
  runGit("push", "origin", baseBranchName);
  runGit("switch", "--", "feature/merge-base");

  const conflictResult = await bridge.mergeGitBaseBranch(projectRoot);
  assert.equal(conflictResult.ok, false);
  assert.equal(conflictResult.conflicted, true);
  assert.deepEqual([...(conflictResult.conflictedFiles || [])], ["conflict-file.txt"]);
  assert.match(String(conflictResult.mergeCommitMessage || ""), /^Merge /);
  const mergingSnapshot = await bridge.readGitStatusSnapshot(projectRoot);
  assert.equal(mergingSnapshot.mergeInProgress, true);
  assert.match(String(mergingSnapshot.mergeCommitMessage || ""), /^Merge /);
  assert.doesNotMatch(String(mergingSnapshot.mergeCommitMessage || ""), /Conflicts/);

  fs.writeFileSync(path.join(projectRoot, "conflict-file.txt"), "resolved\n");
  runGit("add", "--", "conflict-file.txt");
  const mergeCommit = bridge.commitGitStaged(projectRoot, String(mergingSnapshot.mergeCommitMessage || ""));
  assert.equal(mergeCommit.ok, true);
  assert.equal(runGit("rev-list", "--parents", "-n", "1", "HEAD").trim().split(/\s+/).length, 3);
  const finishedSnapshot = await bridge.readGitStatusSnapshot(projectRoot);
  assert.equal(finishedSnapshot.mergeInProgress, false);
  assert.equal(finishedSnapshot.mergeCommitMessage, null);

  runGit("switch", "--", baseBranchName);
  fs.writeFileSync(path.join(projectRoot, "conflict-file.txt"), "base again\n");
  runGit("add", "--", "conflict-file.txt");
  runGit("commit", "-m", "base conflict round two");
  runGit("push", "origin", baseBranchName);
  runGit("switch", "--", "feature/merge-base");

  const secondConflict = await bridge.mergeGitBaseBranch(projectRoot);
  assert.equal(secondConflict.ok, false);
  assert.equal(secondConflict.conflicted, true);
  const abort = await bridge.abortGitMerge(projectRoot);
  assert.equal(abort.ok, true);
  const abortedSnapshot = await bridge.readGitStatusSnapshot(projectRoot);
  assert.equal(abortedSnapshot.mergeInProgress, false);
  assert.equal(abortedSnapshot.mergeCommitMessage, null);
  assert.equal(runGit("status", "--porcelain").trim(), "");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
