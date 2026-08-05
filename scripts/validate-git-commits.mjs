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

const runGit = (...args) => execFileSync("git", ["-C", projectRoot, ...args], { encoding: "utf8" });

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
