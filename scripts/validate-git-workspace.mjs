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
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git workspace 空格-"));
const projectRoot = path.join(fixtureRoot, "super project");
const linkedRoot = path.join(fixtureRoot, "linked ü");
const detachedRoot = path.join(fixtureRoot, "detached worktree");
const staleRoot = path.join(fixtureRoot, "stale worktree");
const submoduleSource = path.join(fixtureRoot, "submodule source");
const nestedSubmoduleSource = path.join(fixtureRoot, "nested submodule source");
const remoteRoot = path.join(fixtureRoot, "remote.git");

const run = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
const initializeRepository = (cwd) => {
  fs.mkdirSync(cwd, { recursive: true });
  run(cwd, "init", "-b", "main");
  run(cwd, "config", "user.email", "git-workspace@example.invalid");
  run(cwd, "config", "user.name", "Git Workspace Validation");
};
const commitFile = (cwd, relativePath, content, message) => {
  const targetPath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
  run(cwd, "add", "--", relativePath);
  run(cwd, "commit", "-m", message);
};

const sandbox = {
  Buffer,
  TextDecoder,
  clearTimeout,
  console: { warn() {}, error() {}, log() {} },
  process: { env: { ...process.env }, execPath: process.execPath, platform: process.platform, once() {}, exit() {} },
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

const oid40 = "a".repeat(40);
const oid64 = "b".repeat(64);
const worktreeFixture = [
  `worktree C:\\repo path`,
  `HEAD ${oid40}`,
  "branch refs/heads/main",
  "future-field ignored",
  "",
  "worktree /tmp/linked\nline",
  `HEAD ${oid40}`,
  "detached",
  "locked reason with\nline",
  "prunable gitdir file points to non-existent location",
  "",
  "worktree /tmp/bare",
  `HEAD ${oid40}`,
  "bare",
  "",
].join("\0");
const parsedWorktrees = sandbox.parseGitWorktreePorcelain(worktreeFixture, "sha1");
assert.equal(parsedWorktrees.length, 3);
assert.equal(parsedWorktrees[0].kind, "main");
assert.equal(parsedWorktrees[1].kind, "linked");
assert.equal(parsedWorktrees[1].head.kind, "detached");
assert.equal(parsedWorktrees[1].lockReason, "reason with\nline");
assert.equal(parsedWorktrees[1].prunable, true);
assert.equal(parsedWorktrees[2].kind, "bare");

const bareFirstWorktreeFixture = [
  "worktree /tmp/bare-main",
  `HEAD ${oid40}`,
  "bare",
  "",
  "worktree /tmp/bare-linked",
  `HEAD ${oid40}`,
  "branch refs/heads/linked",
  "",
].join("\0");
const parsedBareFirstWorktrees = sandbox.parseGitWorktreePorcelain(bareFirstWorktreeFixture, "sha1");
assert.equal(parsedBareFirstWorktrees[0].kind, "bare");
assert.equal(parsedBareFirstWorktrees[1].kind, "linked");

const statusFixture = [
  `# branch.oid ${oid64}`,
  "# branch.head feature",
  "# branch.upstream origin/feature",
  "# branch.ab +3 -2",
  "# unknown.header ignored",
  `1 M. N... 100644 100644 100644 ${oid64} ${oid64} staged name`,
  `1 .M N... 100644 100644 100644 ${oid64} ${oid64} unstaged name`,
  `1 MM N... 100644 100644 100644 ${oid64} ${oid64} mixed name`,
  `2 R. N... 100644 100644 100644 ${oid64} ${oid64} R100 renamed name`,
  "original\tname\nline",
  `u UU N... 100644 100644 100644 100644 ${oid64} ${oid64} ${oid64} conflict`,
  "? untracked directory/",
  "! ignored",
  "x future record",
  "",
].join("\0");
const parsedStatus = sandbox.parseGitWorkspaceStatus(statusFixture, "sha256");
assert.deepEqual(JSON.parse(JSON.stringify(parsedStatus.status)), {
  stagedEntries: 3,
  unstagedEntries: 2,
  untrackedEntries: 1,
  conflictedEntries: 1,
  upstream: { ref: "origin/feature", ahead: 3, behind: 2 },
});
assert.equal(parsedStatus.head.oid, oid64);
const statusWithoutOid = sandbox.parseGitWorkspaceStatus(
  ["# branch.head feature", "# branch.upstream origin/feature", ""].join("\0"),
  "sha1",
);
assert.equal(statusWithoutOid.head.kind, "branch");
assert.equal(statusWithoutOid.head.oid, null);
assert.equal(statusWithoutOid.status.upstream, null);

const configFixture = [
  "submodule.name.with.dots.path\nmodules/path with space",
  "submodule.name.with.dots.url\n../source\nwith-line",
  "submodule.name.with.dots.branch\n.",
  "unknown.key\nignored",
  "",
].join("\0");
const parsedConfig = sandbox.parseGitWorkspaceConfig(configFixture);
assert.equal(parsedConfig.records.get("name.with.dots").path, "modules/path with space");
assert.equal(parsedConfig.records.get("name.with.dots").url, "../source\nwith-line");

const indexFixture = [
  `160000 ${oid40} 0\tmodules/direct path`,
  `160000 ${"c".repeat(40)} 1\tmodules/conflicted`,
  `160000 ${"d".repeat(40)} 2\tmodules/conflicted`,
  `160000 ${"e".repeat(40)} 3\tmodules/conflicted`,
  `100644 ${"f".repeat(40)} 0\tmodules/not-gitlink\nline`,
  "160000 abc123 0\tmodules/abbreviated",
  "",
].join("\0");
const parsedIndex = sandbox.parseGitWorkspaceIndex(indexFixture, "sha1");
assert.equal(parsedIndex.entries.length, 5);
assert.equal(parsedIndex.entries[4].path, "modules/not-gitlink\nline");
assert.equal(parsedIndex.invalid, true);
assert.equal(sandbox.isGitWorkspaceObjectId(oid40, "sha1"), true);
assert.equal(sandbox.isGitWorkspaceObjectId(oid64, "sha256"), true);
assert.equal(sandbox.isGitWorkspaceObjectId(oid40, "sha256"), false);
assert.equal(sandbox.isGitWorkspaceObjectId("z".repeat(40), "sha1"), false);
assert.equal(sandbox.isGitWorkspaceObjectId("0".repeat(40), "sha1"), false);
assert.equal(sandbox.isGitWorkspaceObjectId("0".repeat(64), "sha256"), false);

let activeWorkers = 0;
let peakWorkers = 0;
await sandbox.runGitWorkspaceWorkerPool(
  Array.from({ length: 12 }, () => async () => {
    activeWorkers += 1;
    peakWorkers = Math.max(peakWorkers, activeWorkers);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeWorkers -= 1;
  }),
);
assert.equal(peakWorkers, 4);
const timeoutResult = await sandbox.runGitWorkspaceCommand(fixtureRoot, [], {
  executable: process.execPath,
  commandArgs: ["-e", "setTimeout(() => {}, 5000)"],
  timeoutMs: 20,
});
assert.equal(timeoutResult.timedOut, true);
assert.notEqual(timeoutResult.status, 0);
assert.equal(sandbox.gitWorkspaceFailure("worktree-status", timeoutResult, "timeout").code, "timeout");
const isolatedWorkerResults = [];
await sandbox.runGitWorkspaceWorkerPool([
  async () => {
    const result = await sandbox.runGitWorkspaceCommand(fixtureRoot, [], {
      executable: process.execPath,
      commandArgs: ["-e", "setTimeout(() => {}, 5000)"],
      timeoutMs: 20,
    });
    isolatedWorkerResults.push(result.timedOut ? "timeout" : "unexpected");
  },
  async () => {
    const result = await sandbox.runGitWorkspaceCommand(fixtureRoot, [], {
      executable: process.execPath,
      commandArgs: ["-e", "process.stdout.write('healthy')"],
      timeoutMs: 1000,
    });
    isolatedWorkerResults.push(result.stdout);
  },
]);
assert.deepEqual(isolatedWorkerResults.sort(), ["healthy", "timeout"]);
const boundedStderrResult = await sandbox.runGitWorkspaceCommand(fixtureRoot, [], {
  executable: process.execPath,
  commandArgs: ["-e", "process.stderr.write('x'.repeat(32768)); process.exit(1)"],
  timeoutMs: 1000,
});
assert.equal(Buffer.byteLength(boundedStderrResult.stderr), 16 * 1024);
const streamedRecords = [];
const streamedResult = await sandbox.runGitWorkspaceCommand(fixtureRoot, [], {
  executable: process.execPath,
  commandArgs: [
    "-e",
    "process.stdout.write(Buffer.concat([Buffer.from('路径'), Buffer.from([0]), Buffer.from('line' + String.fromCharCode(10) + '值'), Buffer.from([0])]))",
  ],
  stdoutRecordHandler: (record) => streamedRecords.push(record),
  timeoutMs: 1000,
});
assert.equal(streamedResult.status, 0);
assert.equal(streamedResult.stdout, "");
assert.deepEqual(streamedRecords, ["路径", "line\n值"]);

try {
  initializeRepository(submoduleSource);
  commitFile(submoduleSource, "module.txt", "module base\n", "module initial");
  initializeRepository(nestedSubmoduleSource);
  commitFile(nestedSubmoduleSource, "nested.txt", "nested base\n", "nested initial");

  initializeRepository(projectRoot);
  commitFile(projectRoot, "tracked.txt", "base\n", "initial");
  execFileSync("git", ["init", "--bare", remoteRoot], { stdio: "ignore" });
  run(projectRoot, "remote", "add", "origin", remoteRoot);
  run(projectRoot, "push", "-u", "origin", "main");
  fs.appendFileSync(path.join(projectRoot, "tracked.txt"), "ahead\n");
  run(projectRoot, "add", "--", "tracked.txt");
  run(projectRoot, "commit", "-m", "ahead commit");

  run(
    projectRoot,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "--name",
    "direct.name",
    submoduleSource,
    "modules/direct path",
  );
  const directPath = path.join(projectRoot, "modules", "direct path");
  run(directPath, "config", "user.email", "direct@example.invalid");
  run(directPath, "config", "user.name", "Direct Submodule Validation");
  run(
    directPath,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "--name",
    "nested.name",
    nestedSubmoduleSource,
    "nested/module",
  );
  run(directPath, "add", ".gitmodules", "nested/module");
  run(directPath, "commit", "-m", "add nested submodule");
  run(
    projectRoot,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "--name",
    "uninitialized.name",
    submoduleSource,
    "modules/uninitialized path",
  );
  fs.appendFileSync(
    path.join(projectRoot, ".gitmodules"),
    [
      "",
      '[submodule "config.only"]',
      "\tpath = modules/config only",
      "\turl = ../missing.git",
      '[submodule "wrong.mode"]',
      "\tpath = modules/not gitlink",
      "\turl = ../ordinary.git",
      '[submodule "conflicted.name"]',
      "\tpath = modules/conflicted path",
      "\turl = ../conflicted.git",
      '[submodule "missing.path"]',
      "\turl = ../missing-path.git",
      "",
    ].join("\n"),
  );
  run(projectRoot, "add", ".gitmodules", "modules/direct path", "modules/uninitialized path");
  run(projectRoot, "commit", "-m", "add direct submodules");
  run(projectRoot, "submodule", "deinit", "-f", "--", "modules/uninitialized path");
  run(projectRoot, "config", "submodule.direct.name.url", "../local override.git");
  run(projectRoot, "config", "submodule.direct.name.branch", "local-branch");
  const sourceHead = run(submoduleSource, "rev-parse", "HEAD").trim();

  run(projectRoot, "branch", "feature");
  run(projectRoot, "worktree", "add", linkedRoot, "feature");
  run(projectRoot, "worktree", "lock", "--reason", "validation lock", linkedRoot);
  run(projectRoot, "worktree", "add", "--detach", detachedRoot, "HEAD");
  run(projectRoot, "branch", "stale-branch");
  run(projectRoot, "worktree", "add", staleRoot, "stale-branch");
  fs.rmSync(staleRoot, { recursive: true, force: true });

  fs.writeFileSync(path.join(projectRoot, "tracked.txt"), "main conflict\n");
  run(projectRoot, "add", "--", "tracked.txt");
  run(projectRoot, "commit", "-m", "main conflict side");
  fs.writeFileSync(path.join(linkedRoot, "tracked.txt"), "linked conflict\n");
  run(linkedRoot, "add", "--", "tracked.txt");
  run(linkedRoot, "commit", "-m", "linked conflict side");
  assert.throws(() => run(linkedRoot, "merge", "main"));

  run(projectRoot, "update-index", "--add", "--cacheinfo", `160000,${sourceHead},modules/index only`);
  fs.mkdirSync(path.join(projectRoot, "modules"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "modules", "not gitlink"), "ordinary file\n");
  run(projectRoot, "add", "--", ".gitmodules", "modules/not gitlink");
  execFileSync("git", ["-C", projectRoot, "update-index", "--index-info"], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    input: [1, 2, 3].map((stage) => `160000 ${sourceHead} ${stage}\tmodules/conflicted path`).join("\n") + "\n",
    stdio: ["pipe", "pipe", "pipe"],
  });

  fs.appendFileSync(path.join(directPath, "module.txt"), "advanced checkout\n");
  run(directPath, "add", "--", "module.txt");
  run(directPath, "commit", "-m", "advance direct checkout");

  fs.appendFileSync(path.join(projectRoot, "tracked.txt"), "staged\n");
  run(projectRoot, "add", "--", "tracked.txt");
  fs.appendFileSync(path.join(projectRoot, "tracked.txt"), "unstaged\n");
  fs.mkdirSync(path.join(projectRoot, "untracked directory"));
  fs.writeFileSync(path.join(projectRoot, "untracked directory", "one.txt"), "one\n");
  fs.writeFileSync(path.join(projectRoot, "untracked directory", "two.txt"), "two\n");
  fs.appendFileSync(path.join(directPath, "module.txt"), "dirty\n");
  fs.writeFileSync(path.join(directPath, "untracked.txt"), "new\n");

  const snapshot = await sandbox.window.projectBridge.readGitWorkspaceSnapshot(projectRoot);
  assert.equal(snapshot.repositoryPath, path.resolve(projectRoot));
  assert.match(snapshot.objectFormat, /^sha(1|256)$/);
  assert.equal(snapshot.worktrees.entries.length, 4);
  const main = snapshot.worktrees.entries.find((entry) => entry.kind === "main");
  const linked = snapshot.worktrees.entries.find((entry) => sandbox.gitWorkspacePathsEqual(entry.path, linkedRoot));
  const detached = snapshot.worktrees.entries.find((entry) => sandbox.gitWorkspacePathsEqual(entry.path, detachedRoot));
  const stale = snapshot.worktrees.entries.find((entry) => sandbox.gitWorkspacePathsEqual(entry.path, staleRoot));
  assert.ok(main?.status.stagedEntries >= 1);
  assert.ok(main?.status.unstagedEntries >= 1);
  assert.equal(main?.status.untrackedEntries, 1);
  assert.ok(main?.status.upstream.ahead >= 1);
  assert.equal(linked?.locked, true);
  assert.equal(linked?.lockReason, "validation lock");
  assert.ok(linked?.status.conflictedEntries >= 1);
  assert.equal(detached?.head.kind, "detached");
  assert.equal(stale?.prunable, true);
  assert.equal(stale?.pathAvailable, false);
  assert.equal(stale?.failure.code, "path-unavailable");
  assert.equal(snapshot.worktrees.state, "partial");

  const direct = snapshot.submodules.entries.find((entry) => entry.name === "direct.name");
  const uninitialized = snapshot.submodules.entries.find((entry) => entry.name === "uninitialized.name");
  const configOnly = snapshot.submodules.entries.find((entry) => entry.name === "config.only");
  const wrongMode = snapshot.submodules.entries.find((entry) => entry.name === "wrong.mode");
  const conflicted = snapshot.submodules.entries.find((entry) => entry.name === "conflicted.name");
  const indexOnly = snapshot.submodules.entries.find((entry) => entry.configuration === "index-only");
  assert.equal(direct?.registration, "initialized");
  assert.equal(direct?.checkout, "available");
  assert.equal(direct?.index.kind, "recorded");
  assert.equal(direct?.index.recordedOid.length, snapshot.objectFormat === "sha256" ? 64 : 40);
  assert.equal(direct?.commitMismatch, true);
  assert.notEqual(direct?.head.oid, direct?.index.recordedOid);
  assert.equal(direct?.url.local, "../local override.git");
  assert.equal(direct?.branch.local, "local-branch");
  assert.ok(direct?.status.unstagedEntries >= 1);
  assert.equal(direct?.status.untrackedEntries, 1);
  assert.equal(uninitialized?.registration, "uninitialized");
  assert.equal(uninitialized?.checkout, "missing");
  assert.equal(configOnly?.index.kind, "missing");
  assert.equal(wrongMode?.index.kind, "not-gitlink");
  assert.equal(conflicted?.index.kind, "conflicted");
  assert.equal(conflicted?.index.conflictStages.length, 3);
  assert.equal(conflicted?.commitMismatch, null);
  assert.equal(indexOnly?.index.kind, "recorded");
  assert.equal(
    snapshot.submodules.entries.some((entry) => entry.path.includes("nested")),
    false,
  );
  assert.equal(snapshot.submodules.failure.code, "invalid-output");

  const mainStatusBeforeRelatedWrites = run(projectRoot, "status", "--porcelain=v1", "-z");
  const linkedWritePath = "linked-target-only.txt";
  const submoduleWritePath = "submodule-target-only.txt";
  fs.writeFileSync(path.join(linkedRoot, linkedWritePath), "linked only\n");
  fs.writeFileSync(path.join(directPath, submoduleWritePath), "submodule only\n");
  const linkedStageResult = await sandbox.window.projectBridge.stageGitFile(linkedRoot, linkedWritePath);
  const submoduleStageResult = await sandbox.window.projectBridge.stageGitFile(directPath, submoduleWritePath);
  assert.equal(linkedStageResult.ok, true);
  assert.equal(submoduleStageResult.ok, true);
  assert.equal(run(linkedRoot, "diff", "--cached", "--name-only", "--", linkedWritePath).trim(), linkedWritePath);
  assert.equal(run(directPath, "diff", "--cached", "--name-only", "--", submoduleWritePath).trim(), submoduleWritePath);
  assert.throws(() => run(projectRoot, "ls-files", "--error-unmatch", "--", linkedWritePath));
  assert.throws(() => run(projectRoot, "ls-files", "--error-unmatch", "--", submoduleWritePath));
  assert.equal(run(projectRoot, "status", "--porcelain=v1", "-z"), mainStatusBeforeRelatedWrites);

  const bareSnapshot = await sandbox.window.projectBridge.readGitWorkspaceSnapshot(remoteRoot);
  assert.equal(bareSnapshot.worktrees.entries[0].kind, "bare");
  assert.equal(bareSnapshot.worktrees.entries[0].status, null);
  assert.equal(bareSnapshot.submodules.state, "unavailable");

  const missingSnapshot = await sandbox.window.projectBridge.readGitWorkspaceSnapshot(
    path.join(fixtureRoot, "missing"),
  );
  assert.equal(missingSnapshot.worktrees.state, "unavailable");
  assert.equal(missingSnapshot.submodules.state, "unavailable");
  assert.equal(missingSnapshot.worktrees.failure.code, "not-a-repository");

  const sha256Root = path.join(fixtureRoot, "sha256 repository");
  fs.mkdirSync(sha256Root);
  try {
    run(sha256Root, "init", "--object-format=sha256", "-b", "main");
    run(sha256Root, "config", "user.email", "sha256@example.invalid");
    run(sha256Root, "config", "user.name", "SHA256 Validation");
    commitFile(sha256Root, "sha.txt", "sha256\n", "sha256 initial");
    const sha256Snapshot = await sandbox.window.projectBridge.readGitWorkspaceSnapshot(sha256Root);
    assert.equal(sha256Snapshot.objectFormat, "sha256");
    assert.equal(sha256Snapshot.worktrees.entries[0].head.oid.length, 64);
  } catch (error) {
    console.log("validate:git-workspace SHA-256 fixture skipped: unsupported by installed Git");
  }
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("validate:git-workspace passed");
