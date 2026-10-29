import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as childProcess from "node:child_process";
import { execFileSync, spawnSync } from "node:child_process";
import { createPreloadSandbox } from "./helpers/preload-sandbox.mjs";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-integration-"));
const sandbox = createPreloadSandbox();
const bridge = sandbox.window.projectBridge;
const git = (repository, ...args) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitResult = (repository, ...args) => spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
const write = (repository, file, content) => fs.writeFileSync(path.join(repository, file), `${content}\n`);
const commit = (repository, file, content, message) => {
  write(repository, file, content);
  git(repository, "add", "--", file);
  git(repository, "commit", "-m", message);
  return git(repository, "rev-parse", "HEAD");
};
const createRepository = (name) => {
  const repository = path.join(fixtureRoot, name);
  fs.mkdirSync(repository, { recursive: true });
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Git Integration Validation");
  git(repository, "config", "user.email", "integration@example.invalid");
  git(repository, "config", "core.autocrlf", "false");
  git(repository, "config", "commit.gpgsign", "false");
  commit(repository, "first.txt", "base", "initial");
  return repository;
};
const preview = async (repository, kind, ref = "refs/heads/target") => {
  const result = await bridge.prepareGitIntegration(repository, kind, ref, "target");
  assert.equal(result.ok, true, result.message);
  return result.plan;
};
const createConflict = (name) => {
  const repository = createRepository(name);
  commit(repository, "second.txt", "base", "second base");
  git(repository, "switch", "-c", "feature");
  commit(repository, "first.txt", "feature first", "feature first");
  const featureHead = commit(repository, "second.txt", "feature second", "feature second");
  git(repository, "switch", "-c", "target", "main");
  commit(repository, "first.txt", "target first", "target first");
  commit(repository, "second.txt", "target second", "target second");
  git(repository, "switch", "feature");
  return { repository, featureHead };
};
const repositorySnapshot = (repository) => {
  const files = {};
  const visit = (directory, relative = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!relative && entry.name === ".git") continue;
      const entryPath = path.join(directory, entry.name);
      const entryRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(entryPath, entryRelative);
      else if (entry.isSymbolicLink()) files[entryRelative] = `link:${fs.readlinkSync(entryPath)}`;
      else files[entryRelative] = fs.readFileSync(entryPath).toString("base64");
    }
  };
  visit(repository);
  const indexPath = path.resolve(repository, git(repository, "rev-parse", "--git-path", "index"));
  return {
    refs: git(repository, "for-each-ref", "--format=%(refname) %(objectname)"),
    head: git(repository, "symbolic-ref", "HEAD"),
    index: fs.existsSync(indexPath) ? fs.readFileSync(indexPath).toString("base64") : null,
    status: git(repository, "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"),
    files,
  };
};
const simulatedBridge = (simulate) => {
  const commands = [];
  const overriddenProcess = {
    ...childProcess,
    execFile(command, args, options, callback) {
      if (command === "git") {
        commands.push({ args: args.slice(2), env: options.env });
        const result = simulate(args.slice(2), options);
        if (result) {
          setImmediate(() => callback(result.error || null, result.stdout || "", result.stderr || ""));
          return { stdin: { end() {} } };
        }
      }
      return childProcess.execFile(command, args, options, callback);
    },
    execFileSync() { throw new Error("同步子进程不应在准备或预测中运行"); },
    spawnSync() { throw new Error("同步子进程不应在准备或预测中运行"); },
  };
  const isolated = createPreloadSandbox({ child_process: overriddenProcess });
  return { isolated, bridge: isolated.window.projectBridge, commands };
};

try {
  const fastForward = createRepository("fast-forward");
  git(fastForward, "branch", "feature");
  git(fastForward, "switch", "-c", "target");
  const targetHead = commit(fastForward, "target.txt", "target", "target");
  git(fastForward, "switch", "feature");
  git(fastForward, "config", "merge.ff", "false");
  git(fastForward, "config", "merge.autoStash", "true");
  const gitVersion = /git version (\d+)\.(\d+)/.exec(git(fastForward, "--version"));
  assert.ok(gitVersion, "unable to determine Git version for real prediction tests");
  const supports = (minor) => Number(gitVersion[1]) > 2 || (Number(gitVersion[1]) === 2 && Number(gitVersion[2]) >= minor);
  const residualRebaseHead = path.resolve(fastForward, git(fastForward, "rev-parse", "--git-path", "REBASE_HEAD"));
  const residualRebaseHash = git(fastForward, "rev-parse", "HEAD");
  fs.writeFileSync(residualRebaseHead, `${residualRebaseHash}\n`);
  const residualSnapshot = repositorySnapshot(fastForward);
  for (const kind of ["merge", "rebase"]) {
    await preview(fastForward, kind);
    assert.deepEqual(repositorySnapshot(fastForward), residualSnapshot);
    assert.equal(fs.readFileSync(residualRebaseHead, "utf8"), `${residualRebaseHash}\n`);
  }
  const fastForwardPlan = await preview(fastForward, "merge");
  const fastForwardSnapshot = repositorySnapshot(fastForward);
  assert.equal((await bridge.predictGitIntegrationConflicts(fastForward, fastForwardPlan)).state, supports(38) ? "clean" : "unsupported");
  assert.deepEqual(repositorySnapshot(fastForward), fastForwardSnapshot);
  const fastForwardResult = await bridge.integrateGitCommit(fastForward, await preview(fastForward, "merge"));
  assert.equal(fastForwardResult.ok, true, fastForwardResult.message);
  assert.equal(git(fastForward, "rev-parse", "HEAD"), targetHead);
  assert.equal(git(fastForward, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 2);

  const dirty = createRepository("dirty");
  git(dirty, "branch", "target");
  git(dirty, "config", "status.showUntrackedFiles", "no");
  write(dirty, "untracked.txt", "untracked");
  assert.equal((await bridge.prepareGitIntegration(dirty, "merge", "refs/heads/target", "target")).blockReason, "dirty-worktree");
  fs.unlinkSync(path.join(dirty, "untracked.txt"));
  write(dirty, "first.txt", "modified");
  assert.equal((await bridge.prepareGitIntegration(dirty, "rebase", "refs/heads/target", "target")).blockReason, "dirty-worktree");
  git(dirty, "stash", "push", "-m", "test stash");
  const stashHash = git(dirty, "rev-parse", "stash@{0}");
  assert.equal((await bridge.prepareGitIntegration(dirty, "merge", stashHash, "stash")).ok, false);
  assert.equal((await bridge.prepareGitIntegration(dirty, "merge", "refs/stash", "stash")).ok, false);
  assert.equal((await bridge.prepareGitIntegration(dirty, "merge", "target", "target")).ok, false);
  assert.equal((await bridge.prepareGitIntegration(dirty, "merge", git(dirty, "rev-parse", "HEAD"), "commit")).ok, true);
  git(dirty, "update-ref", "refs/remotes/origin/target", git(dirty, "rev-parse", "target"));
  assert.equal((await preview(dirty, "merge", "refs/remotes/origin/target")).targetHash, git(dirty, "rev-parse", "target"));
  git(dirty, "switch", "--detach", "HEAD");
  assert.equal((await bridge.prepareGitIntegration(dirty, "merge", "refs/heads/target", "target")).ok, false);
  git(dirty, "switch", "main");
  for (const stateName of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer", "BISECT_LOG", "index.lock"]) {
    const statePath = path.resolve(dirty, git(dirty, "rev-parse", "--git-path", stateName));
    fs.writeFileSync(statePath, "in progress");
    for (const kind of ["merge", "rebase"]) {
      const blocked = await bridge.prepareGitIntegration(dirty, kind, "refs/heads/target", "target");
      assert.equal(blocked.ok, false, `${kind}: ${stateName}`);
      assert.match(blocked.message, /未完成/, `${kind}: ${stateName}`);
    }
    fs.unlinkSync(statePath);
  }
  git(dirty, "branch", "CHERRY_PICK_HEAD");
  assert.equal((await bridge.prepareGitIntegration(dirty, "merge", "refs/heads/target", "target")).ok, false);
  git(dirty, "branch", "-D", "CHERRY_PICK_HEAD");
  const predictablePlan = await preview(dirty, "merge");
  const lowVersion = simulatedBridge((args) => args[0] === "--version" ? { stdout: "git version 2.37.5" } : null);
  assert.equal((await lowVersion.bridge.predictGitIntegrationConflicts(dirty, predictablePlan)).state, "unsupported");
  const oldReplay = simulatedBridge((args) => args[0] === "--version" ? { stdout: "git version 2.43.1" } : null);
  const rebaseIdentityPlan = { ...predictablePlan, kind: "rebase" };
  assert.equal((await oldReplay.bridge.predictGitIntegrationConflicts(dirty, rebaseIdentityPlan)).state, "unsupported");
  const killedChild = simulatedBridge((args) => args[0] === "merge-tree" ? { error: Object.assign(new Error("killed"), { code: 1, killed: true, signal: "SIGTERM" }) } : null);
  assert.equal((await killedChild.bridge.predictGitIntegrationConflicts(dirty, predictablePlan)).state, supports(38) ? "unknown" : "unsupported");
  assert.equal((await bridge.predictGitIntegrationConflicts(dirty, { ...predictablePlan, targetRef: "target" })).state, "unknown");

  const stale = createRepository("stale");
  git(stale, "branch", "target");
  const stalePlan = await preview(stale, "merge");
  commit(stale, "new.txt", "new", "new head");
  assert.equal((await bridge.predictGitIntegrationConflicts(stale, stalePlan)).state, "unknown");
  assert.equal((await bridge.integrateGitCommit(stale, stalePlan)).ok, false);
  const staleTargetPlan = await preview(stale, "merge");
  git(stale, "update-ref", "refs/heads/target", git(stale, "rev-parse", "HEAD"));
  assert.equal((await bridge.predictGitIntegrationConflicts(stale, staleTargetPlan)).state, "unknown");
  assert.equal((await bridge.integrateGitCommit(stale, staleTargetPlan)).ok, false);

  const divergent = createRepository("divergent");
  git(divergent, "switch", "-c", "feature");
  commit(divergent, "feature.txt", "feature", "feature");
  git(divergent, "switch", "-c", "target", "main");
  commit(divergent, "target.txt", "target", "target");
  git(divergent, "switch", "feature");
  assert.equal((await bridge.integrateGitCommit(divergent, await preview(divergent, "merge"))).ok, true);
  assert.equal(git(divergent, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3);
  assert.equal(git(divergent, "status", "--porcelain"), "");
  const mergedRebasePlan = await preview(divergent, "rebase", "refs/heads/main");
  assert.equal(mergedRebasePlan.hasMergeCommits, true);
  const replayHelp = gitResult(divergent, "replay", "-h");
  const supportsLinearize = `${replayHelp.stdout}\n${replayHelp.stderr}`.includes("--linearize");
  const mergedSnapshot = repositorySnapshot(divergent);
  const mergedPrediction = await bridge.predictGitIntegrationConflicts(divergent, mergedRebasePlan);
  assert.equal(mergedPrediction.state, supports(44) ? supportsLinearize ? "clean" : "unknown" : "unsupported");
  assert.deepEqual(repositorySnapshot(divergent), mergedSnapshot);
  assert.equal((await bridge.predictGitIntegrationConflicts(divergent, { ...mergedRebasePlan, hasMergeCommits: false })).state, supports(44) ? "unknown" : "unsupported");
  commit(divergent, "first.txt", "feature change", "feature after merge");
  git(divergent, "switch", "main");
  commit(divergent, "first.txt", "main change", "advance main");
  git(divergent, "switch", "feature");
  const mergedConflictPlan = await preview(divergent, "rebase", "refs/heads/main");
  const mergedConflictSnapshot = repositorySnapshot(divergent);
  const mergedConflictPrediction = await bridge.predictGitIntegrationConflicts(divergent, mergedConflictPlan);
  assert.equal(mergedConflictPrediction.state, supports(44) ? supportsLinearize ? "conflicts" : "unknown" : "unsupported");
  if (mergedConflictPrediction.state === "conflicts") assert.equal(mergedConflictPrediction.message, "检测到变基冲突。");
  assert.deepEqual(repositorySnapshot(divergent), mergedConflictSnapshot);

  const mergeConflict = createConflict("merge-conflict");
  const mergeConflictPlan = await preview(mergeConflict.repository, "merge");
  const mergeConflictSnapshot = repositorySnapshot(mergeConflict.repository);
  assert.equal((await bridge.predictGitIntegrationConflicts(mergeConflict.repository, mergeConflictPlan)).state, supports(38) ? "conflicts" : "unsupported");
  assert.deepEqual(repositorySnapshot(mergeConflict.repository), mergeConflictSnapshot);
  const failedMerge = await bridge.integrateGitCommit(mergeConflict.repository, await preview(mergeConflict.repository, "merge"));
  assert.equal(failedMerge.ok, false);
  assert.equal(failedMerge.conflicted, true);
  const mergeSnapshot = await bridge.readGitStatusSnapshot(mergeConflict.repository);
  assert.equal(mergeSnapshot.mergeInProgress, true);
  assert.equal(mergeSnapshot.files.filter((file) => file.conflicted).length, 2);
  assert.equal((await bridge.prepareGitIntegration(mergeConflict.repository, "rebase", "refs/heads/target", "target")).ok, false);
  assert.equal((await bridge.abortGitMerge(mergeConflict.repository)).ok, true);
  assert.equal(git(mergeConflict.repository, "rev-parse", "HEAD"), mergeConflict.featureHead);

  const rebase = createRepository("rebase");
  git(rebase, "switch", "-c", "feature");
  commit(rebase, "feature.txt", "one", "feature change");
  const oldFeature = commit(rebase, "feature.txt", "two", "fixup! feature change");
  git(rebase, "branch", "side", oldFeature);
  git(rebase, "switch", "-c", "target", "main");
  commit(rebase, "target.txt", "target", "target");
  git(rebase, "switch", "feature");
  for (const key of ["rebase.autoStash", "rebase.autoSquash", "rebase.updateRefs", "rebase.rebaseMerges"]) git(rebase, "config", key, "true");
  git(rebase, "config", "replay.refAction", "update");
  fs.writeFileSync(path.resolve(rebase, git(rebase, "rev-parse", "--git-path", "REBASE_HEAD")), `${oldFeature}\n`);
  const rebasePlan = await preview(rebase, "rebase");
  const hostileEnvironment = simulatedBridge(() => null);
  hostileEnvironment.isolated.process.env.GIT_REPLAY_UPDATE_REFS = "1";
  const rebaseSnapshot = repositorySnapshot(rebase);
  assert.equal((await hostileEnvironment.bridge.predictGitIntegrationConflicts(rebase, rebasePlan)).state, supports(44) ? "clean" : "unsupported");
  assert.deepEqual(repositorySnapshot(rebase), rebaseSnapshot);
  if (supports(44)) {
    const replay = hostileEnvironment.commands.find(({ args }) => args.includes("replay") && !args.includes("-h"));
    assert.ok(replay);
    assert.equal(replay.env.GIT_REPLAY_UPDATE_REFS, "0");
    assert.ok(replay.args.includes("replay.refAction=print"));
  }
  assert.equal((await bridge.integrateGitCommit(rebase, await preview(rebase, "rebase"))).ok, true);
  assert.equal(git(rebase, "rev-list", "--count", "target..HEAD"), "2");
  assert.equal(git(rebase, "rev-parse", "side"), oldFeature);
  assert.equal(git(rebase, "log", "-1", "--format=%s"), "fixup! feature change");

  const empty = createRepository("empty-commit");
  git(empty, "switch", "-c", "feature");
  git(empty, "commit", "--allow-empty", "-m", "intentional empty");
  commit(empty, "feature.txt", "feature", "feature change");
  git(empty, "switch", "-c", "target", "main");
  commit(empty, "target.txt", "target", "target change");
  git(empty, "switch", "feature");
  git(empty, "config", "rebase.backend", "apply");
  assert.equal((await bridge.integrateGitCommit(empty, await preview(empty, "rebase"))).ok, true);
  assert.equal(git(empty, "rev-list", "--count", "target..feature"), "2");
  assert.equal(git(empty, "log", "--format=%s", "target..feature"), "feature change\nintentional empty");
  assert.equal(git(empty, "diff-tree", "--no-commit-id", "--name-only", "feature~1"), "");

  const conflict = createConflict("conflict");
  git(conflict.repository, "config", "rebase.abbreviateCommands", "true");
  const conflictPlan = await preview(conflict.repository, "rebase");
  const conflictSnapshot = repositorySnapshot(conflict.repository);
  assert.equal((await bridge.predictGitIntegrationConflicts(conflict.repository, conflictPlan)).state, supports(44) ? "conflicts" : "unsupported");
  assert.deepEqual(repositorySnapshot(conflict.repository), conflictSnapshot);
  const stopped = await bridge.integrateGitCommit(conflict.repository, conflictPlan);
  assert.equal(stopped.ok, false);
  assert.equal(stopped.rebaseInProgress.interactive, false);
  let state = (await bridge.readGitStatusSnapshot(conflict.repository)).rebaseInProgress;
  assert.equal(state.branch, "feature");
  assert.equal(state.interactive, false);
  assert.equal(state.canContinue, false);
  assert.equal(state.step, 1);
  assert.equal(state.total, 2);
  const stillRunning = await sandbox.gitIntegrationResult(conflict.repository, { status: 0 }, "变基继续完成。", "变基失败。");
  assert.equal(stillRunning.ok, true);
  assert.match(stillRunning.message, /仍在进行/);
  assert.equal(stillRunning.rebaseInProgress.canContinue, false);
  const conflictedWorkingTree = await bridge.readGitWorkingTreeSnapshot(conflict.repository);
  assert.equal(conflictedWorkingTree.files.find((file) => file.path === "first.txt")?.conflicted, true);
  assert.equal(conflictedWorkingTree.rebaseInProgress.canContinue, false);
  assert.equal((await createPreloadSandbox().window.projectBridge.readGitSnapshot(conflict.repository)).files.find((file) => file.path === "first.txt")?.conflicted, true);
  assert.equal((await bridge.continueGitRebase(conflict.repository)).ok, false);
  assert.equal((await bridge.commitGitStaged(conflict.repository, "unsafe")).ok, false);
  assert.equal((await bridge.checkoutGitCommit(conflict.repository, conflict.featureHead, { force: true, detach: true })).ok, false);
  assert.equal((await bridge.unstageGitFile(conflict.repository, "first.txt")).ok, false);
  write(conflict.repository, "first.txt", "resolved first");
  assert.equal((await bridge.stageGitFile(conflict.repository, "first.txt")).ok, true);
  const stagedWorkingTree = await bridge.readGitWorkingTreeSnapshot(conflict.repository);
  assert.notEqual(stagedWorkingTree.files.find((file) => file.path === "first.txt")?.conflicted, true);
  assert.equal(stagedWorkingTree.rebaseInProgress.canContinue, true);
  assert.equal((await bridge.readGitStatusSnapshot(conflict.repository)).rebaseInProgress.canContinue, true);
  state = (await bridge.readGitSnapshot(conflict.repository)).rebaseInProgress;
  assert.equal(state.canContinue, true);
  assert.equal((await bridge.continueGitRebase(conflict.repository)).ok, false);
  state = (await bridge.readGitStatusSnapshot(conflict.repository)).rebaseInProgress;
  assert.equal(state.step, 2);
  assert.equal(state.canContinue, false);
  assert.equal((await bridge.skipGitRebase(conflict.repository)).ok, true);
  assert.equal((await bridge.readGitStatusSnapshot(conflict.repository)).rebaseInProgress, null);
  assert.equal(git(conflict.repository, "branch", "--show-current"), "feature");
  assert.equal(git(conflict.repository, "rev-list", "--count", "target..feature"), "1");

  const continued = createConflict("continue");
  git(continued.repository, "config", "core.editor", "exit 42");
  assert.equal((await bridge.integrateGitCommit(continued.repository, await preview(continued.repository, "rebase"))).ok, false);
  write(continued.repository, "first.txt", "resolved first");
  assert.equal((await bridge.stageGitFile(continued.repository, "first.txt")).ok, true);
  assert.equal((await bridge.continueGitRebase(continued.repository)).ok, false);
  write(continued.repository, "second.txt", "resolved second");
  assert.equal((await bridge.stageGitFile(continued.repository, "second.txt")).ok, true);
  assert.equal((await bridge.continueGitRebase(continued.repository)).ok, true);
  assert.equal(git(continued.repository, "rev-list", "--count", "target..feature"), "2");
  assert.equal((await bridge.readGitStatusSnapshot(continued.repository)).rebaseInProgress, null);

  const hooked = createConflict("hooked");
  const hookPath = path.resolve(hooked.repository, git(hooked.repository, "rev-parse", "--git-path", "hooks/pre-rebase"));
  fs.writeFileSync(hookPath, "#!/bin/sh\nexit 17\n");
  fs.chmodSync(hookPath, 0o755);
  assert.equal((await bridge.integrateGitCommit(hooked.repository, await preview(hooked.repository, "rebase"))).ok, false);
  assert.equal(git(hooked.repository, "rev-parse", "HEAD"), hooked.featureHead);
  assert.equal((await bridge.readGitStatusSnapshot(hooked.repository)).rebaseInProgress, null);

  const worktree = createConflict("worktree-main");
  const worktreePath = path.join(fixtureRoot, "linked-worktree");
  git(worktree.repository, "switch", "main");
  git(worktree.repository, "worktree", "add", worktreePath, "feature");
  const linkedPlan = await preview(worktreePath, "rebase");
  const linkedSnapshot = repositorySnapshot(worktreePath);
  const mainSnapshot = repositorySnapshot(worktree.repository);
  assert.equal((await bridge.predictGitIntegrationConflicts(worktreePath, linkedPlan)).state, supports(44) ? "conflicts" : "unsupported");
  assert.deepEqual(repositorySnapshot(worktreePath), linkedSnapshot);
  assert.deepEqual(repositorySnapshot(worktree.repository), mainSnapshot);
  assert.equal((await bridge.integrateGitCommit(worktreePath, await preview(worktreePath, "rebase"))).ok, false);
  const reloadedBridge = createPreloadSandbox().window.projectBridge;
  assert.equal((await reloadedBridge.readGitSnapshot(worktreePath)).rebaseInProgress.branch, "feature");
  assert.equal((await reloadedBridge.readGitStatusSnapshot(worktree.repository)).rebaseInProgress, null);
  assert.equal((await reloadedBridge.abortGitRebase(worktreePath)).ok, true);
  assert.equal(git(worktreePath, "rev-parse", "HEAD"), worktree.featureHead);
  assert.equal((await reloadedBridge.readGitStatusSnapshot(worktreePath)).rebaseInProgress, null);

  const unsupported = createConflict("unsupported-todo");
  assert.equal((await bridge.integrateGitCommit(unsupported.repository, await preview(unsupported.repository, "rebase"))).ok, false);
  const todoPath = path.resolve(unsupported.repository, git(unsupported.repository, "rev-parse", "--git-path", "rebase-merge/git-rebase-todo"));
  fs.appendFileSync(todoPath, "\nexec false\n");
  assert.equal((await bridge.readGitStatusSnapshot(unsupported.repository)).rebaseInProgress.interactive, true);
  assert.equal((await bridge.continueGitRebase(unsupported.repository)).ok, false);
  assert.equal((await bridge.skipGitRebase(unsupported.repository)).ok, false);
  assert.equal((await bridge.abortGitRebase(unsupported.repository)).ok, true);

  const interactive = createConflict("interactive");
  assert.notEqual(gitResult(interactive.repository, "-c", "sequence.editor=:", "rebase", "-i", "target").status, 0);
  const interactiveState = (await bridge.readGitStatusSnapshot(interactive.repository)).rebaseInProgress;
  assert.equal(interactiveState.interactive, true);
  assert.equal((await bridge.continueGitRebase(interactive.repository)).ok, false);
  assert.equal((await bridge.skipGitRebase(interactive.repository)).ok, false);
  assert.equal((await bridge.abortGitRebase(interactive.repository)).ok, true);

  const am = createConflict("am");
  const patchPath = path.join(fixtureRoot, "change.patch");
  fs.writeFileSync(patchPath, execFileSync("git", ["-C", am.repository, "format-patch", "--stdout", "main..feature"], { encoding: "utf8" }));
  git(am.repository, "switch", "target");
  assert.notEqual(gitResult(am.repository, "am", patchPath).status, 0);
  assert.equal((await bridge.readGitStatusSnapshot(am.repository)).rebaseInProgress, null);
  assert.equal((await bridge.abortGitRebase(am.repository)).ok, false);
  assert.equal((await bridge.prepareGitIntegration(am.repository, "merge", "refs/heads/main", "main")).ok, false);
  git(am.repository, "am", "--abort");

  console.log("Git integration validation passed.");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}