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
const unbornRoot = path.join(fixtureRoot, "unborn");
const uninitializedRoot = path.join(fixtureRoot, "uninitialized");
const publishProjectRoot = path.join(fixtureRoot, "publish-project");
const publishOriginRoot = path.join(fixtureRoot, "publish-origin.git");
const publishMirrorRoot = path.join(fixtureRoot, "publish-mirror.git");
const amendRoot = path.join(fixtureRoot, "amend");
const undoNormalRoot = path.join(fixtureRoot, "undo-normal");
const undoMergeRoot = path.join(fixtureRoot, "undo-merge");
const undoRootCommitRoot = path.join(fixtureRoot, "undo-root");
const undoEmptyRootCommitRoot = path.join(fixtureRoot, "undo-empty-root");
const undoRootRecoveryRoot = path.join(fixtureRoot, "undo-root-recovery");
const historyActionRoot = path.join(fixtureRoot, "history-actions");
const historyConflictRoot = path.join(fixtureRoot, "history-conflict");
const historyRevertConflictRoot = path.join(fixtureRoot, "history-revert-conflict");

const runGitAt = (repositoryPath, ...args) =>
  execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8" });
const runGit = (...args) => runGitAt(projectRoot, ...args);
const initializeRepository = (repositoryPath, email) => {
  fs.mkdirSync(repositoryPath, { recursive: true });
  runGitAt(repositoryPath, "init");
  runGitAt(repositoryPath, "config", "user.email", email);
  runGitAt(repositoryPath, "config", "user.name", "Git Commits Validation");
};
const normalizeLineEndings = (value) => value.replace(/\r\n/g, "\n");

fs.mkdirSync(projectRoot, { recursive: true });
runGit("init");
runGit("config", "user.email", "git-commits@example.invalid");
runGit("config", "user.name", "Git Commits Validation");
fs.writeFileSync(path.join(projectRoot, "history.txt"), "first\n");
runGit("add", "--", "history.txt");
runGit("commit", "-m", "first commit");
const chineseFileName = "中文文件名.txt";
fs.appendFileSync(path.join(projectRoot, "history.txt"), "second\n");
fs.writeFileSync(path.join(projectRoot, chineseFileName), "中文文件名\n");
runGit("add", "--", "history.txt", chineseFileName);
runGit("commit", "-m", "second commit");
const rootHash = runGit("rev-list", "--max-parents=0", "HEAD").trim();
runGit("branch", "feature,comma", rootHash);
runGit("tag", "lightweight,comma", rootHash);
runGit("tag", "-a", "annotated", "-m", "annotated message", rootHash);
fs.mkdirSync(unbornRoot, { recursive: true });
execFileSync("git", ["-C", unbornRoot, "init"], { encoding: "utf8" });
fs.writeFileSync(path.join(unbornRoot, "untracked.txt"), "untracked\n");

const createPreloadBridge = (childProcess = require("child_process")) => {
  const sandbox = {
    TextDecoder,
    clearTimeout,
    console: { warn() {}, error() {}, log() {} },
    process: { env: { ...process.env }, platform: process.platform, once() {}, exit() {} },
    require(moduleName) {
      if (moduleName === "child_process") return childProcess;
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
  return sandbox.window.projectBridge;
};
const bridge = createPreloadBridge();

try {
  initializeRepository(historyActionRoot, "git-history-actions@example.invalid");
  const historyActionBranch = runGitAt(historyActionRoot, "branch", "--show-current").trim();
  fs.writeFileSync(path.join(historyActionRoot, "base.txt"), "base\n");
  runGitAt(historyActionRoot, "add", "--", "base.txt");
  runGitAt(historyActionRoot, "commit", "-m", "history base");
  runGitAt(historyActionRoot, "switch", "-c", "source");
  fs.writeFileSync(path.join(historyActionRoot, "picked.txt"), "picked\n");
  runGitAt(historyActionRoot, "add", "--", "picked.txt");
  runGitAt(historyActionRoot, "commit", "-m", "pick this commit");
  const sourceCommit = runGitAt(historyActionRoot, "rev-parse", "HEAD").trim();
  runGitAt(historyActionRoot, "switch", historyActionBranch);
  fs.writeFileSync(path.join(historyActionRoot, "target.txt"), "target\n");
  runGitAt(historyActionRoot, "add", "--", "target.txt");
  runGitAt(historyActionRoot, "commit", "-m", "target commit");
  const picked = await bridge.cherryPickGitCommit(historyActionRoot, sourceCommit);
  assert.equal(picked.ok, true);
  assert.match(fs.readFileSync(path.join(historyActionRoot, "picked.txt"), "utf8"), /^picked\r?\n$/);
  const reverted = await bridge.revertGitCommit(historyActionRoot, sourceCommit);
  assert.equal(reverted.ok, true);
  assert.equal(fs.existsSync(path.join(historyActionRoot, "picked.txt")), false);
  assert.equal((await bridge.cherryPickGitCommit(historyActionRoot, sourceCommit.slice(0, 7))).ok, false);
  const historyActionHead = runGitAt(historyActionRoot, "rev-parse", "HEAD").trim();
  assert.equal((await bridge.cherryPickGitCommit(historyActionRoot, historyActionHead)).ok, false);
  assert.equal(runGitAt(historyActionRoot, "rev-parse", "HEAD").trim(), historyActionHead);
  fs.writeFileSync(path.join(historyActionRoot, "staged.txt"), "staged\n");
  runGitAt(historyActionRoot, "add", "--", "staged.txt");
  const stagedCherryPick = await bridge.cherryPickGitCommit(historyActionRoot, sourceCommit);
  assert.equal(stagedCherryPick.ok, false);
  assert.equal(stagedCherryPick.blockReason, "dirty-worktree");
  assert.equal(runGitAt(historyActionRoot, "rev-parse", "HEAD").trim(), historyActionHead);
  runGitAt(historyActionRoot, "reset", "--", "staged.txt");
  fs.rmSync(path.join(historyActionRoot, "staged.txt"));
  fs.writeFileSync(path.join(historyActionRoot, "dirty.txt"), "dirty\n");
  const dirtyRevert = await bridge.revertGitCommit(historyActionRoot, sourceCommit);
  assert.equal(dirtyRevert.ok, false);
  assert.equal(dirtyRevert.blockReason, "dirty-worktree");
  assert.equal(runGitAt(historyActionRoot, "rev-parse", "HEAD").trim(), historyActionHead);
  fs.rmSync(path.join(historyActionRoot, "dirty.txt"));
  runGitAt(historyActionRoot, "checkout", "--detach");
  const historyActionDetachedHead = runGitAt(historyActionRoot, "rev-parse", "HEAD").trim();
  assert.equal((await bridge.revertGitCommit(historyActionRoot, sourceCommit)).ok, false);
  assert.equal(runGitAt(historyActionRoot, "rev-parse", "HEAD").trim(), historyActionDetachedHead);
  runGitAt(historyActionRoot, "switch", historyActionBranch);
  runGitAt(historyActionRoot, "update-ref", "refs/remotes/origin/HEAD", "HEAD");
  runGitAt(historyActionRoot, "symbolic-ref", "HEAD", "refs/remotes/origin/HEAD");
  const nonLocalHistoryActionSnapshot = await bridge.readGitStatusSnapshot(historyActionRoot);
  assert.equal(nonLocalHistoryActionSnapshot.isDetachedHead, false);
  assert.equal(
    nonLocalHistoryActionSnapshot.branches?.some((branch) => branch.current),
    false,
  );
  const nonLocalHeadCherryPick = await bridge.cherryPickGitCommit(historyActionRoot, sourceCommit);
  const nonLocalHeadRevert = await bridge.revertGitCommit(historyActionRoot, sourceCommit);
  assert.equal(nonLocalHeadCherryPick.ok, false);
  assert.equal(nonLocalHeadRevert.ok, false);
  assert.equal(nonLocalHeadCherryPick.message, "当前 HEAD 未指向本地分支，请使用外部 Git 工具处理。");
  assert.equal(nonLocalHeadRevert.message, "当前 HEAD 未指向本地分支，请使用外部 Git 工具处理。");
  runGitAt(historyActionRoot, "symbolic-ref", "HEAD", `refs/heads/${historyActionBranch}`);
  fs.writeFileSync(path.join(historyActionRoot, "stash.txt"), "stash\n");
  runGitAt(historyActionRoot, "stash", "push", "--include-untracked", "-m", "history action stash");
  const stashCommit = runGitAt(historyActionRoot, "rev-parse", "stash@{0}").trim();
  const blockedStashPick = await bridge.cherryPickGitCommit(historyActionRoot, stashCommit);
  assert.equal(blockedStashPick.ok, false);
  assert.match(blockedStashPick.message, /stash 提交不能用于 Cherry-pick 或 Revert/);
  assert.equal(blockedStashPick.blockReason, undefined);
  runGitAt(historyActionRoot, "stash", "drop", "stash@{0}");
  runGitAt(historyActionRoot, "switch", "-c", "merge-source");
  fs.writeFileSync(path.join(historyActionRoot, "merge-source.txt"), "source\n");
  runGitAt(historyActionRoot, "add", "--", "merge-source.txt");
  runGitAt(historyActionRoot, "commit", "-m", "merge source");
  runGitAt(historyActionRoot, "switch", historyActionBranch);
  fs.writeFileSync(path.join(historyActionRoot, "merge-target.txt"), "target\n");
  runGitAt(historyActionRoot, "add", "--", "merge-target.txt");
  runGitAt(historyActionRoot, "commit", "-m", "merge target");
  runGitAt(historyActionRoot, "merge", "--no-ff", "merge-source", "-m", "merge source");
  const mergeCommit = runGitAt(historyActionRoot, "rev-parse", "HEAD").trim();
  const blockedMergePick = await bridge.cherryPickGitCommit(historyActionRoot, mergeCommit);
  const blockedMergeRevert = await bridge.revertGitCommit(historyActionRoot, mergeCommit);
  assert.equal(blockedMergePick.blockReason, "merge-commit");
  assert.equal(blockedMergeRevert.blockReason, "merge-commit");

  initializeRepository(historyConflictRoot, "git-history-conflict@example.invalid");
  const historyConflictBranch = runGitAt(historyConflictRoot, "branch", "--show-current").trim();
  fs.writeFileSync(path.join(historyConflictRoot, "conflict.txt"), "base\n");
  runGitAt(historyConflictRoot, "add", "--", "conflict.txt");
  runGitAt(historyConflictRoot, "commit", "-m", "conflict base");
  runGitAt(historyConflictRoot, "switch", "-c", "source");
  fs.writeFileSync(path.join(historyConflictRoot, "conflict.txt"), "source\n");
  runGitAt(historyConflictRoot, "add", "--", "conflict.txt");
  runGitAt(historyConflictRoot, "commit", "-m", "conflict source");
  const conflictSourceCommit = runGitAt(historyConflictRoot, "rev-parse", "HEAD").trim();
  runGitAt(historyConflictRoot, "switch", historyConflictBranch);
  fs.writeFileSync(path.join(historyConflictRoot, "conflict.txt"), "target\n");
  runGitAt(historyConflictRoot, "add", "--", "conflict.txt");
  runGitAt(historyConflictRoot, "commit", "-m", "conflict target");
  const conflictHeadBefore = runGitAt(historyConflictRoot, "rev-parse", "HEAD").trim();
  const conflictIndexBefore = runGitAt(historyConflictRoot, "ls-files", "-s");
  const conflictWorktreeBefore = fs.readFileSync(path.join(historyConflictRoot, "conflict.txt"), "utf8");
  const conflict = await bridge.cherryPickGitCommit(historyConflictRoot, conflictSourceCommit);
  assert.equal(conflict.ok, false);
  assert.match(conflict.message, /已自动中止操作，仓库已恢复/);
  assert.match(conflict.message, /原始错误：/);
  assert.equal(runGitAt(historyConflictRoot, "rev-parse", "HEAD").trim(), conflictHeadBefore);
  assert.equal(runGitAt(historyConflictRoot, "ls-files", "-s"), conflictIndexBefore);
  assert.equal(
    normalizeLineEndings(fs.readFileSync(path.join(historyConflictRoot, "conflict.txt"), "utf8")),
    normalizeLineEndings(conflictWorktreeBefore),
  );
  assert.throws(() => runGitAt(historyConflictRoot, "rev-parse", "--verify", "CHERRY_PICK_HEAD"));
  assert.throws(() => runGitAt(historyConflictRoot, "cherry-pick", conflictSourceCommit));
  const matchingOperation = await bridge.cherryPickGitCommit(historyConflictRoot, conflictSourceCommit);
  const unknownOperation = await bridge.revertGitCommit(historyConflictRoot, conflictSourceCommit);
  assert.match(matchingOperation.message, /未完成的 Cherry-pick/);
  assert.match(unknownOperation.message, /其他未完成的 Git 操作/);
  assert.equal(runGitAt(historyConflictRoot, "rev-parse", "--verify", "CHERRY_PICK_HEAD").trim().length > 0, true);
  runGitAt(historyConflictRoot, "cherry-pick", "--abort");

  const realChildProcess = require("child_process");
  let statusFailureActionAttempted = false;
  const statusFailureBridge = createPreloadBridge({
    ...realChildProcess,
    spawnSync(command, args, options) {
      if (command === "git" && args[args.length - 2] === "status" && args[args.length - 1] === "--porcelain") {
        return { status: null, signal: "SIGTERM", stdout: "", stderr: "simulated status interruption" };
      }
      if (
        command === "git" &&
        args[args.length - 2] === "cherry-pick" &&
        args[args.length - 1] === conflictSourceCommit
      ) {
        statusFailureActionAttempted = true;
        return { status: 1, stdout: "", stderr: "history action should not execute" };
      }
      return realChildProcess.spawnSync(command, args, options);
    },
  });
  const statusFailure = await statusFailureBridge.cherryPickGitCommit(historyConflictRoot, conflictSourceCommit);
  assert.equal(statusFailure.ok, false);
  assert.match(statusFailure.message, /无法检查工作区状态.*simulated status interruption/);
  assert.equal(statusFailureActionAttempted, false);

  let simulatedHistoryActionStarted = false;
  let mismatchedAbortAttempts = 0;
  const mismatchedOperationBridge = createPreloadBridge({
    ...realChildProcess,
    spawnSync(command, args, options) {
      if (
        command === "git" &&
        args[args.length - 2] === "cherry-pick" &&
        args[args.length - 1] === conflictSourceCommit
      ) {
        simulatedHistoryActionStarted = true;
        return { status: 1, stdout: "", stderr: "simulated cherry-pick failure" };
      }
      if (
        command === "git" &&
        simulatedHistoryActionStarted &&
        args.includes("rev-parse") &&
        args[args.length - 1] === "CHERRY_PICK_HEAD"
      ) {
        return { status: 0, stdout: `${conflictHeadBefore}\n`, stderr: "" };
      }
      if (command === "git" && args[args.length - 2] === "cherry-pick" && args[args.length - 1] === "--abort") {
        mismatchedAbortAttempts += 1;
        return { status: 1, stdout: "", stderr: "unexpected abort" };
      }
      return realChildProcess.spawnSync(command, args, options);
    },
  });
  const mismatchedOperation = await mismatchedOperationBridge.cherryPickGitCommit(
    historyConflictRoot,
    conflictSourceCommit,
  );
  assert.equal(mismatchedOperation.ok, false);
  assert.match(mismatchedOperation.message, /simulated cherry-pick failure/);
  assert.equal(mismatchedAbortAttempts, 0);

  const abortFailureBridge = createPreloadBridge({
    ...realChildProcess,
    spawnSync(command, args, options) {
      if (command === "git" && args[args.length - 2] === "cherry-pick" && args[args.length - 1] === "--abort") {
        return { status: 1, stdout: "", stderr: "simulated abort failure" };
      }
      return realChildProcess.spawnSync(command, args, options);
    },
  });
  const abortFailure = await abortFailureBridge.cherryPickGitCommit(historyConflictRoot, conflictSourceCommit);
  assert.equal(abortFailure.ok, false);
  assert.match(abortFailure.message, /原始错误：/);
  assert.match(abortFailure.message, /自动中止错误：simulated abort failure/);
  assert.equal(runGitAt(historyConflictRoot, "rev-parse", "--verify", "CHERRY_PICK_HEAD").trim().length > 0, true);
  runGitAt(historyConflictRoot, "cherry-pick", "--abort");

  initializeRepository(historyRevertConflictRoot, "git-history-revert-conflict@example.invalid");
  fs.writeFileSync(path.join(historyRevertConflictRoot, "revert.txt"), "base\n");
  runGitAt(historyRevertConflictRoot, "add", "--", "revert.txt");
  runGitAt(historyRevertConflictRoot, "commit", "-m", "revert base");
  fs.writeFileSync(path.join(historyRevertConflictRoot, "revert.txt"), "to revert\n");
  runGitAt(historyRevertConflictRoot, "add", "--", "revert.txt");
  runGitAt(historyRevertConflictRoot, "commit", "-m", "revert target");
  const revertTargetCommit = runGitAt(historyRevertConflictRoot, "rev-parse", "HEAD").trim();
  fs.writeFileSync(path.join(historyRevertConflictRoot, "revert.txt"), "later\n");
  runGitAt(historyRevertConflictRoot, "add", "--", "revert.txt");
  runGitAt(historyRevertConflictRoot, "commit", "-m", "revert later");
  const revertConflictHeadBefore = runGitAt(historyRevertConflictRoot, "rev-parse", "HEAD").trim();
  const revertConflictIndexBefore = runGitAt(historyRevertConflictRoot, "ls-files", "-s");
  const revertConflictWorktreeBefore = fs.readFileSync(path.join(historyRevertConflictRoot, "revert.txt"), "utf8");
  const revertConflict = await bridge.revertGitCommit(historyRevertConflictRoot, revertTargetCommit);
  assert.equal(revertConflict.ok, false);
  assert.match(revertConflict.message, /已自动中止操作，仓库已恢复/);
  assert.match(revertConflict.message, /原始错误：/);
  assert.equal(runGitAt(historyRevertConflictRoot, "rev-parse", "HEAD").trim(), revertConflictHeadBefore);
  assert.equal(runGitAt(historyRevertConflictRoot, "ls-files", "-s"), revertConflictIndexBefore);
  assert.equal(
    normalizeLineEndings(fs.readFileSync(path.join(historyRevertConflictRoot, "revert.txt"), "utf8")),
    normalizeLineEndings(revertConflictWorktreeBefore),
  );
  assert.throws(() => runGitAt(historyRevertConflictRoot, "rev-parse", "--verify", "REVERT_HEAD"));

  initializeRepository(amendRoot, "git-amend@example.invalid");
  fs.writeFileSync(path.join(amendRoot, "amend.txt"), "first\n");
  runGitAt(amendRoot, "add", "--", "amend.txt");
  runGitAt(amendRoot, "commit", "-m", "original subject", "-m", "original body");
  const amendOriginalHash = runGitAt(amendRoot, "rev-parse", "HEAD").trim();
  const amendedMessage = "amended subject\n\namended body";
  const messageOnlyAmend = await bridge.amendGitCommit(amendRoot, amendedMessage);
  assert.equal(messageOnlyAmend.ok, true);
  assert.notEqual(runGitAt(amendRoot, "rev-parse", "HEAD").trim(), amendOriginalHash);
  assert.equal(runGitAt(amendRoot, "log", "-1", "--format=%B", "HEAD").trim(), amendedMessage);
  assert.equal(runGitAt(amendRoot, "status", "--porcelain").trim(), "");

  fs.appendFileSync(path.join(amendRoot, "amend.txt"), "second\n");
  runGitAt(amendRoot, "add", "--", "amend.txt");
  const stagedContentAmend = await bridge.amendGitCommit(amendRoot, amendedMessage);
  assert.equal(stagedContentAmend.ok, true);
  assert.match(runGitAt(amendRoot, "show", "HEAD:amend.txt"), /second/);
  assert.equal(runGitAt(amendRoot, "status", "--porcelain").trim(), "");

  initializeRepository(undoNormalRoot, "git-undo-normal@example.invalid");
  const undoNormalBranch = runGitAt(undoNormalRoot, "branch", "--show-current").trim();
  fs.writeFileSync(path.join(undoNormalRoot, "normal.txt"), "base\n");
  runGitAt(undoNormalRoot, "add", "--", "normal.txt");
  runGitAt(undoNormalRoot, "commit", "-m", "normal base");
  const normalParentHash = runGitAt(undoNormalRoot, "rev-parse", "HEAD").trim();
  fs.appendFileSync(path.join(undoNormalRoot, "normal.txt"), "second\n");
  runGitAt(undoNormalRoot, "add", "--", "normal.txt");
  runGitAt(undoNormalRoot, "commit", "-m", "normal undo subject", "-m", "normal undo body");
  const normalUndoMessage = runGitAt(undoNormalRoot, "log", "-1", "--format=%B", "HEAD").trim();
  const normalUndo = await bridge.undoLastGitCommit(undoNormalRoot);
  assert.equal(normalUndo.ok, true);
  assert.equal(normalUndo.commitMessage, normalUndoMessage);
  assert.equal(runGitAt(undoNormalRoot, "rev-parse", "HEAD").trim(), normalParentHash);
  assert.match(runGitAt(undoNormalRoot, "diff", "--cached", "--", "normal.txt"), /\+second/);
  assert.equal(runGitAt(undoNormalRoot, "diff", "--", "normal.txt"), "");

  runGitAt(undoNormalRoot, "checkout", "--detach");
  const detachedHead = runGitAt(undoNormalRoot, "rev-parse", "HEAD").trim();
  assert.equal((await bridge.amendGitCommit(undoNormalRoot, "detached amend")).ok, false);
  assert.equal((await bridge.undoLastGitCommit(undoNormalRoot)).ok, false);
  assert.equal(runGitAt(undoNormalRoot, "rev-parse", "HEAD").trim(), detachedHead);
  runGitAt(undoNormalRoot, "switch", undoNormalBranch);

  initializeRepository(undoMergeRoot, "git-undo-merge@example.invalid");
  const mergeBaseBranch = runGitAt(undoMergeRoot, "branch", "--show-current").trim();
  fs.writeFileSync(path.join(undoMergeRoot, "base.txt"), "base\n");
  runGitAt(undoMergeRoot, "add", "--", "base.txt");
  runGitAt(undoMergeRoot, "commit", "-m", "merge base");
  runGitAt(undoMergeRoot, "switch", "-c", "merge-feature");
  fs.writeFileSync(path.join(undoMergeRoot, "feature.txt"), "feature\n");
  runGitAt(undoMergeRoot, "add", "--", "feature.txt");
  runGitAt(undoMergeRoot, "commit", "-m", "feature commit");
  runGitAt(undoMergeRoot, "switch", mergeBaseBranch);
  fs.writeFileSync(path.join(undoMergeRoot, "main.txt"), "main\n");
  runGitAt(undoMergeRoot, "add", "--", "main.txt");
  runGitAt(undoMergeRoot, "commit", "-m", "main commit");
  const mergeFirstParent = runGitAt(undoMergeRoot, "rev-parse", "HEAD").trim();
  runGitAt(undoMergeRoot, "merge", "--no-ff", "merge-feature", "-m", "merge feature");
  const mergeUndoMessage = runGitAt(undoMergeRoot, "log", "-1", "--format=%B", "HEAD").trim();
  const blockedMergeUndo = await bridge.undoLastGitCommit(undoMergeRoot);
  assert.equal(blockedMergeUndo.ok, false);
  assert.equal(blockedMergeUndo.blockReason, "merge-commit");
  assert.equal(runGitAt(undoMergeRoot, "rev-parse", "HEAD").trim().length > 0, true);
  const malformedMergeConfirmation = await bridge.undoLastGitCommit(undoMergeRoot, { allowMerge: "true" });
  assert.equal(malformedMergeConfirmation.ok, false);
  assert.equal(malformedMergeConfirmation.blockReason, "merge-commit");
  const confirmedMergeUndo = await bridge.undoLastGitCommit(undoMergeRoot, { allowMerge: true });
  assert.equal(confirmedMergeUndo.ok, true);
  assert.equal(confirmedMergeUndo.commitMessage, mergeUndoMessage);
  assert.equal(runGitAt(undoMergeRoot, "rev-parse", "HEAD").trim(), mergeFirstParent);
  assert.match(runGitAt(undoMergeRoot, "diff", "--cached", "--", "feature.txt"), /\+feature/);

  initializeRepository(undoRootCommitRoot, "git-undo-root@example.invalid");
  fs.writeFileSync(path.join(undoRootCommitRoot, "root.txt"), "root\n");
  runGitAt(undoRootCommitRoot, "add", "--", "root.txt");
  runGitAt(undoRootCommitRoot, "commit", "-m", "root undo subject", "-m", "root undo body");
  const rootUndoMessage = runGitAt(undoRootCommitRoot, "log", "-1", "--format=%B", "HEAD").trim();
  const rootUndo = await bridge.undoLastGitCommit(undoRootCommitRoot);
  assert.equal(rootUndo.ok, true);
  assert.equal(rootUndo.commitMessage, rootUndoMessage);
  assert.throws(() => runGitAt(undoRootCommitRoot, "rev-parse", "--verify", "HEAD"));
  assert.equal(fs.existsSync(path.join(undoRootCommitRoot, "root.txt")), true);
  assert.match(runGitAt(undoRootCommitRoot, "status", "--porcelain"), /^\?\? root\.txt/m);

  initializeRepository(undoEmptyRootCommitRoot, "git-undo-empty-root@example.invalid");
  runGitAt(undoEmptyRootCommitRoot, "commit", "--allow-empty", "-m", "empty root undo");
  const emptyRootUndo = await bridge.undoLastGitCommit(undoEmptyRootCommitRoot);
  assert.equal(emptyRootUndo.ok, true);
  assert.equal(emptyRootUndo.commitMessage, "empty root undo");
  assert.throws(() => runGitAt(undoEmptyRootCommitRoot, "rev-parse", "--verify", "HEAD"));
  assert.equal(runGitAt(undoEmptyRootCommitRoot, "status", "--porcelain").trim(), "");

  initializeRepository(undoRootRecoveryRoot, "git-undo-root-recovery@example.invalid");
  fs.writeFileSync(path.join(undoRootRecoveryRoot, "recovery.txt"), "recovery\n");
  runGitAt(undoRootRecoveryRoot, "add", "--", "recovery.txt");
  runGitAt(undoRootRecoveryRoot, "commit", "-m", "root recovery");
  const rootRecoveryHash = runGitAt(undoRootRecoveryRoot, "rev-parse", "HEAD").trim();
  const recoveryIndexLock = path.resolve(
    undoRootRecoveryRoot,
    runGitAt(undoRootRecoveryRoot, "rev-parse", "--git-path", "index.lock").trim(),
  );
  fs.writeFileSync(recoveryIndexLock, "lock\n");
  try {
    const rootRecovery = await bridge.undoLastGitCommit(undoRootRecoveryRoot);
    assert.equal(rootRecovery.ok, false);
  } finally {
    fs.rmSync(recoveryIndexLock, { force: true });
  }
  assert.equal(runGitAt(undoRootRecoveryRoot, "rev-parse", "HEAD").trim(), rootRecoveryHash);
  assert.equal(runGitAt(undoRootRecoveryRoot, "diff", "--cached", "--name-only").trim(), "");

  fs.mkdirSync(uninitializedRoot, { recursive: true });
  const initialized = await bridge.initializeGitRepository(uninitializedRoot);
  assert.equal(initialized.ok, true);
  const initializedSnapshot = await bridge.readGitSnapshot(uninitializedRoot, { limit: 20 });
  assert.equal(path.resolve(initializedSnapshot.repositoryPath), path.resolve(uninitializedRoot));
  assert.equal((await bridge.initializeGitRepository(path.join(fixtureRoot, "missing"))).ok, false);
  const noRemotePublish = await bridge.publishGitBranch(unbornRoot, "origin");
  assert.equal(noRemotePublish.ok, false);
  assert.equal(noRemotePublish.message, "未找到 remote：origin。");

  fs.mkdirSync(publishProjectRoot, { recursive: true });
  runGitAt(publishProjectRoot, "init");
  runGitAt(publishProjectRoot, "config", "user.email", "git-publish@example.invalid");
  runGitAt(publishProjectRoot, "config", "user.name", "Git Publish Validation");
  fs.writeFileSync(path.join(publishProjectRoot, "publish.txt"), "publish\n");
  runGitAt(publishProjectRoot, "add", "--", "publish.txt");
  runGitAt(publishProjectRoot, "commit", "-m", "publish commit");
  execFileSync("git", ["init", "--bare", publishOriginRoot], { encoding: "utf8" });
  execFileSync("git", ["init", "--bare", publishMirrorRoot], { encoding: "utf8" });
  runGitAt(publishProjectRoot, "remote", "add", "origin", publishOriginRoot);
  runGitAt(publishProjectRoot, "remote", "add", "mirror", publishMirrorRoot);
  const publishBranch = runGitAt(publishProjectRoot, "branch", "--show-current").trim();
  const published = await bridge.publishGitBranch(publishProjectRoot, "mirror");
  assert.equal(published.ok, true);
  assert.equal(published.remote, "mirror");
  assert.equal(published.branch, publishBranch);
  assert.equal(
    runGitAt(publishProjectRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}").trim(),
    `mirror/${publishBranch}`,
  );
  assert.equal(
    runGitAt(publishMirrorRoot, "show-ref", "--verify", "--quiet", `refs/heads/${publishBranch}`).trim(),
    "",
  );
  assert.throws(() => runGitAt(publishOriginRoot, "show-ref", "--verify", "--quiet", `refs/heads/${publishBranch}`));
  assert.equal((await bridge.publishGitBranch(publishProjectRoot, "mirror")).ok, false);

  runGitAt(publishProjectRoot, "branch", "--unset-upstream");
  runGitAt(publishProjectRoot, "fetch", "mirror");
  runGitAt(publishProjectRoot, "symbolic-ref", "HEAD", `refs/remotes/mirror/${publishBranch}`);
  const nonLocalHeadPublish = await bridge.publishGitBranch(publishProjectRoot, "origin");
  assert.equal(nonLocalHeadPublish.ok, false);
  assert.equal(nonLocalHeadPublish.message, "当前 HEAD 未指向本地分支，无法发布当前分支。");
  const nonLocalHeadAmend = await bridge.amendGitCommit(publishProjectRoot, "remote attached amend");
  const nonLocalHeadUndo = await bridge.undoLastGitCommit(publishProjectRoot);
  assert.equal(nonLocalHeadAmend.ok, false);
  assert.equal(nonLocalHeadUndo.ok, false);
  assert.equal(nonLocalHeadAmend.message, "当前 HEAD 未指向本地分支，请使用外部 Git 工具处理。");
  assert.equal(nonLocalHeadUndo.message, "当前 HEAD 未指向本地分支，请使用外部 Git 工具处理。");

  runGitAt(publishProjectRoot, "symbolic-ref", "HEAD", `refs/heads/${publishBranch}`);
  runGitAt(publishProjectRoot, "checkout", "--detach");
  const detachedPublish = await bridge.publishGitBranch(publishProjectRoot, "origin");
  assert.equal(detachedPublish.ok, false);
  assert.equal(detachedPublish.message, "当前 HEAD 处于 detached 状态，无法发布当前分支。");

  const unbornSnapshot = await bridge.readGitSnapshot(unbornRoot, { limit: 20 });
  assert.equal(path.resolve(unbornSnapshot.repositoryPath), path.resolve(unbornRoot));
  assert.equal(unbornSnapshot.commits.length, 0);
  assert.equal(unbornSnapshot.commitCount, 0);
  assert.equal(
    unbornSnapshot.files.some((file) => file.path === "untracked.txt"),
    true,
  );

  fs.appendFileSync(path.join(projectRoot, "history.txt"), "staged working-tree change\n");
  runGit("add", "--", "history.txt");
  fs.appendFileSync(path.join(projectRoot, "history.txt"), "unstaged working-tree change\n");
  runGit("mv", chineseFileName, "renamed-stage.txt");
  fs.mkdirSync(path.join(projectRoot, "untracked", "nested"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "untracked", "nested", "entry.txt"), "untracked\n");

  const workingTree = await bridge.readGitWorkingTreeSnapshot(projectRoot);
  const partiallyStaged = workingTree.files.find((file) => file.path === "history.txt");
  const renamed = workingTree.files.find((file) => file.path === "renamed-stage.txt");
  const untracked = workingTree.files.find((file) => file.path === "untracked/nested/entry.txt");
  assert.equal(path.resolve(workingTree.repositoryPath), path.resolve(projectRoot));
  assert.equal(partiallyStaged?.staged, true);
  assert.equal(partiallyStaged?.unstaged, true);
  assert.equal(renamed?.status, "RENAMED");
  assert.equal(renamed?.staged, true);
  assert.equal(renamed?.originalPath, chineseFileName);
  assert.equal(untracked?.status, "UNTRACKED");
  assert.equal(untracked?.unstaged, true);
  runGit("reset", "--hard");
  runGit("clean", "-fd");

  const page = await bridge.readGitCommits(projectRoot, { limit: 20 });
  assert.equal(page.commits.length, 2);
  assert.equal(page.commitCount, 2);
  const snapshot = await bridge.readGitSnapshot(projectRoot, { limit: 20 });
  assert.equal(snapshot.commitCount, 2);

  const headBeforeNoOpAmend = runGit("rev-parse", "HEAD").trim();
  const noOpAmend = await bridge.amendGitCommit(projectRoot, "second commit");
  assert.equal(noOpAmend.ok, false);
  assert.equal(runGit("rev-parse", "HEAD").trim(), headBeforeNoOpAmend);

  const [latestCommit, rootCommit] = page.commits;
  assert.match(latestCommit.hash, /^[0-9a-f]{40,64}$/);
  assert.match(rootCommit.hash, /^[0-9a-f]{40,64}$/);
  assert.deepEqual(Array.from(latestCommit.parents), [rootCommit.hash]);
  assert.deepEqual(Array.from(rootCommit.parents), []);
  const latestCommitFiles = await bridge.readGitCommitFiles(projectRoot, latestCommit.hash);
  assert.ok(latestCommit.shortStats);
  assert.deepEqual(
    { ...latestCommit.shortStats },
    {
      files: latestCommitFiles.length,
      additions: latestCommitFiles.reduce((total, file) => total + file.additions, 0),
      deletions: latestCommitFiles.reduce((total, file) => total + file.deletions, 0),
    },
  );
  assert.equal(
    latestCommitFiles.some((file) => file.path === chineseFileName),
    true,
  );
  assert.deepEqual(
    Array.from(rootCommit.refNames, (ref) => ({ kind: ref.kind, name: ref.name })),
    [
      { kind: "local", name: "feature,comma" },
      { kind: "tag", name: "annotated" },
      { kind: "tag", name: "lightweight,comma" },
    ],
  );
  assert.equal(
    latestCommit.refNames.some((ref) => ref.kind === "head" && ref.head),
    true,
  );
  assert.equal(
    latestCommit.refNames.some((ref) => ref.kind === "local" && ref.head),
    true,
  );

  const untrackedOnlyPath = path.join(projectRoot, "untracked-only.txt");
  fs.writeFileSync(untrackedOnlyPath, "untracked only\n");
  assert.equal((await bridge.createGitStash(projectRoot, "ignored untracked")).ok, false);
  assert.equal(fs.existsSync(untrackedOnlyPath), true);
  fs.appendFileSync(path.join(projectRoot, "history.txt"), "first stash change\n");
  fs.writeFileSync(path.join(projectRoot, "staged-stash.txt"), "staged stash change\n");
  runGit("add", "staged-stash.txt");
  assert.equal((await bridge.createGitStash(projectRoot, "first stash", { includeUntracked: true })).ok, true);
  assert.equal(fs.existsSync(untrackedOnlyPath), false);
  fs.appendFileSync(path.join(projectRoot, "history.txt"), "second stash change\n");
  assert.equal((await bridge.createGitStash(projectRoot, "second stash")).ok, true);
  const stashPage = await bridge.readGitCommits(projectRoot, { limit: 20 });
  assert.equal(stashPage.nextCommitSkip, 2);
  assert.equal(stashPage.commits[0]?.stash?.selector, "stash@{0}");
  assert.equal(
    stashPage.commits.find((commit) => commit.refNames.some((ref) => ref.kind === "head" && ref.head))?.hash,
    latestCommit.hash,
  );
  const stashCommits = stashPage.commits.filter((commit) => commit.refNames.some((ref) => ref.kind === "stash"));
  assert.deepEqual(
    Array.from(stashCommits, (commit) => commit.refNames.find((ref) => ref.kind === "stash")?.name),
    ["stash@{0}", "stash@{1}"],
  );
  assert.deepEqual(
    Array.from(stashCommits, (commit) => Array.from(commit.parents || [])),
    [[latestCommit.hash], [latestCommit.hash]],
  );
  assert.deepEqual(
    Array.from(stashCommits, (commit) => ({
      selector: commit.stash?.selector,
      baseHash: commit.stash?.baseHash,
    })),
    [
      { selector: "stash@{0}", baseHash: latestCommit.hash },
      { selector: "stash@{1}", baseHash: latestCommit.hash },
    ],
  );
  assert.equal(stashCommits[0]?.stash?.untrackedFilesHash, null);
  assert.match(stashCommits[1]?.stash?.untrackedFilesHash || "", /^[0-9a-f]{40,64}$/);
  const firstStashFiles = await bridge.readGitCommitFiles(projectRoot, stashCommits[1].hash, stashCommits[1].stash);
  assert.deepEqual(
    Array.from(firstStashFiles, (file) => ({ path: file.path, status: file.status })).sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    [
      { path: "history.txt", status: "MODIFIED" },
      { path: "staged-stash.txt", status: "ADDED" },
      { path: "untracked-only.txt", status: "UNTRACKED" },
    ],
  );
  const firstStashStagedDiff = await bridge.readGitCommitFileDiff(
    projectRoot,
    stashCommits[1].hash,
    "staged-stash.txt",
    stashCommits[1].stash,
  );
  assert.match(firstStashStagedDiff.diff, /\+staged stash change/);
  const firstStashUntrackedDiff = await bridge.readGitCommitFileDiff(
    projectRoot,
    stashCommits[1].hash,
    "untracked-only.txt",
    stashCommits[1].stash,
  );
  assert.match(firstStashUntrackedDiff.diff, /\+untracked only/);
  assert.equal(
    stashPage.commits.some((commit) => /^(?:index|untracked files) on /.test(commit.message)),
    false,
  );
  assert.equal((await bridge.applyGitStash(projectRoot, "stash@{1}")).ok, true);
  assert.equal(fs.existsSync(untrackedOnlyPath), true);
  runGit("reset", "--hard");
  runGit("clean", "-fd");
  assert.equal((await bridge.dropGitStash(projectRoot, "stash@{1}")).ok, true);
  assert.equal((await bridge.applyGitStash(projectRoot, "stash@{0}")).ok, true);
  assert.match(fs.readFileSync(path.join(projectRoot, "history.txt"), "utf8"), /second stash change/);
  assert.equal((await bridge.dropGitStash(projectRoot, "stash@{0}")).ok, true);
  assert.equal(runGit("stash", "list").trim(), "");
  runGit("reset", "--hard");
  runGit("clean", "-fd");

  fs.appendFileSync(path.join(projectRoot, "history.txt"), "stash pop change\n");
  assert.equal((await bridge.createGitStash(projectRoot, "pop validation")).ok, true);
  assert.equal((await bridge.popGitStash(projectRoot, "stash@{0}")).ok, true);
  assert.match(fs.readFileSync(path.join(projectRoot, "history.txt"), "utf8"), /stash pop change/);
  assert.equal(runGit("stash", "list").trim(), "");
  runGit("reset", "--hard");
  runGit("clean", "-fd");

  assert.equal((await bridge.createGitBranch(projectRoot, "created", rootCommit.hash)).ok, true);
  assert.equal(runGit("rev-parse", "created").trim(), rootCommit.hash);
  assert.equal((await bridge.createGitBranch(projectRoot, "created", rootCommit.hash)).ok, false);
  assert.equal((await bridge.createGitTag(projectRoot, "created", rootCommit.hash)).ok, true);
  assert.equal(runGit("cat-file", "-t", "refs/tags/created").trim(), "commit");
  assert.equal(
    (
      await bridge.createGitTag(projectRoot, "annotated-action", rootCommit.hash, {
        annotated: true,
        message: "release",
      })
    ).ok,
    true,
  );
  assert.equal(runGit("cat-file", "-t", "annotated-action").trim(), "tag");
  assert.equal((await bridge.deleteGitTag(projectRoot, "lightweight,comma")).ok, true);
  assert.throws(() => runGit("show-ref", "--verify", "--quiet", "refs/tags/lightweight,comma"));
  assert.equal((await bridge.deleteGitTag(projectRoot, "annotated-action")).ok, true);
  assert.throws(() => runGit("show-ref", "--verify", "--quiet", "refs/tags/annotated-action"));
  assert.equal((await bridge.renameGitBranch(projectRoot, "created", "renamed")).ok, true);
  assert.equal((await bridge.deleteGitBranch(projectRoot, "renamed")).ok, true);

  runGit("switch", "-c", "unmerged", rootCommit.hash);
  fs.appendFileSync(path.join(projectRoot, "history.txt"), "unique\n");
  runGit("add", "--", "history.txt");
  runGit("commit", "-m", "unique commit");
  runGit("switch", "master");
  const safeDelete = await bridge.deleteGitBranch(projectRoot, "unmerged");
  assert.equal(safeDelete.ok, false);
  assert.equal(safeDelete.blockReason, "unmerged-branch");
  assert.equal(runGit("show-ref", "--verify", "--quiet", "refs/heads/unmerged"), "");
  assert.equal((await bridge.deleteGitBranch(projectRoot, "unmerged", { force: true })).ok, true);

  fs.appendFileSync(path.join(projectRoot, "history.txt"), "dirty\n");
  const dirtyCreate = await bridge.createGitBranch(projectRoot, "dirty-create", rootCommit.hash, { checkout: true });
  assert.equal(dirtyCreate.blockReason, "dirty-worktree");
  assert.throws(() => runGit("show-ref", "--verify", "--quiet", "refs/heads/dirty-create"));
  assert.equal(
    (await bridge.createGitBranch(projectRoot, "dirty-create", rootCommit.hash, { checkout: true, force: true })).ok,
    true,
  );
  assert.equal(runGit("branch", "--show-current").trim(), "dirty-create");
  runGit("switch", "master");
  assert.equal((await bridge.deleteGitBranch(projectRoot, "dirty-create")).ok, true);

  runGit("remote", "add", "origin", projectRoot);
  runGit("update-ref", "refs/remotes/origin/tracking", rootCommit.hash);
  const remotePage = await bridge.readGitCommits(projectRoot, { limit: 20 });
  const remoteRootCommit = remotePage.commits.find((commit) => commit.hash === rootCommit.hash);
  assert.deepEqual(
    Array.from(remoteRootCommit.refNames, (ref) => ({ kind: ref.kind, name: ref.name })).filter(
      (ref) => ref.kind === "remote",
    ),
    [{ kind: "remote", name: "origin/tracking" }],
  );
  fs.appendFileSync(path.join(projectRoot, "history.txt"), "remote dirty\n");
  const dirtyRemote = await bridge.checkoutGitRemoteBranch(projectRoot, "origin/tracking");
  assert.equal(dirtyRemote.blockReason, "dirty-worktree");
  assert.throws(() => runGit("show-ref", "--verify", "--quiet", "refs/heads/tracking"));
  assert.equal((await bridge.checkoutGitRemoteBranch(projectRoot, "origin/tracking", { force: true })).ok, true);
  assert.equal(runGit("branch", "--show-current").trim(), "tracking");
  runGit("switch", "master");
  fs.appendFileSync(path.join(projectRoot, "history.txt"), "detach dirty\n");
  const dirtyDetach = await bridge.checkoutGitCommit(projectRoot, rootCommit.hash, { detach: true });
  assert.equal(dirtyDetach.blockReason, "dirty-worktree");
  assert.equal(runGit("branch", "--show-current").trim(), "master");
  assert.equal((await bridge.checkoutGitCommit(projectRoot, rootCommit.hash, { detach: true, force: true })).ok, true);
  assert.throws(() => runGit("symbolic-ref", "-q", "HEAD"));
  runGit("switch", "master");
  assert.equal((await bridge.renameGitBranch(projectRoot, "master", "primary")).ok, true);
  assert.equal(runGit("branch", "--show-current").trim(), "primary");
  assert.equal((await bridge.deleteGitBranch(projectRoot, "primary")).ok, false);
  assert.equal((await bridge.createGitBranch(projectRoot, "bad name", rootCommit.hash)).ok, false);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
