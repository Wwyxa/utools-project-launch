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
  assert.equal(
    unbornSnapshot.files.some((file) => file.path === "untracked.txt"),
    true,
  );

  const page = await bridge.readGitCommits(projectRoot, { limit: 20 });
  assert.equal(page.commits.length, 2);

  const [latestCommit, rootCommit] = page.commits;
  assert.match(latestCommit.hash, /^[0-9a-f]{40,64}$/);
  assert.match(rootCommit.hash, /^[0-9a-f]{40,64}$/);
  assert.deepEqual(Array.from(latestCommit.parents), [rootCommit.hash]);
  assert.deepEqual(Array.from(rootCommit.parents), []);
  const latestCommitFiles = await bridge.readGitCommitFiles(projectRoot, latestCommit.hash);
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
