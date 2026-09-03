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
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git bulk actions-"));

const run = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
const initializeRepository = (cwd) => {
  fs.mkdirSync(cwd, { recursive: true });
  run(cwd, "init", "-b", "main");
  run(cwd, "config", "user.email", "git-bulk-actions@example.invalid");
  run(cwd, "config", "user.name", "Git Bulk Actions Validation");
  run(cwd, "config", "core.autocrlf", "false");
};
const writeFile = (cwd, relativePath, content) => {
  const targetPath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
};
const commitAll = (cwd, message) => {
  run(cwd, "add", "--", ".");
  run(cwd, "commit", "-m", message);
};
const gitStatusLines = (cwd) =>
  run(cwd, "status", "--porcelain=v1")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

// Seed a worktree with one entry per status shape that bulk discard must handle:
// unstaged modification, staged modification, staged rename, staged new file,
// untracked file, and an untracked directory (which the bulk path must skip).
const createMixedFixture = (label) => {
  const projectRoot = path.join(fixtureRoot, label);
  initializeRepository(projectRoot);
  writeFile(projectRoot, "base-tracked.txt", "base\n");
  writeFile(projectRoot, "base-staged.txt", "base\n");
  writeFile(projectRoot, "base-rename-a.txt", "base\n");
  commitAll(projectRoot, "initial");

  writeFile(projectRoot, "base-tracked.txt", "dirty\n");
  writeFile(projectRoot, "base-staged.txt", "dirty\n");
  run(projectRoot, "add", "--", "base-staged.txt");
  run(projectRoot, "mv", "base-rename-a.txt", "base-rename-b.txt");
  writeFile(projectRoot, "nested/staged-new.txt", "new\n");
  run(projectRoot, "add", "--", "nested/staged-new.txt");
  writeFile(projectRoot, "untracked.txt", "untracked\n");
  writeFile(projectRoot, "untracked-dir/inner.txt", "inner\n");
  return projectRoot;
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

const { chunkGitPathspecs } = sandbox;

// Chunking keeps pathspec batches inside Windows command-line length limits.
assert.deepEqual(JSON.parse(JSON.stringify(chunkGitPathspecs([]))), []);
assert.equal(chunkGitPathspecs(Array.from({ length: 200 }, (_, index) => `f${index}`)).length, 1);
const oversizedCountChunks = chunkGitPathspecs(Array.from({ length: 201 }, (_, index) => `f${index}`));
assert.equal(oversizedCountChunks.length, 2);
assert.equal(oversizedCountChunks[0].length, 200);
const longPaths = Array.from({ length: 100 }, (_, index) => `p${index}/${"a".repeat(300)}`);
for (const chunk of chunkGitPathspecs(longPaths)) {
  assert.ok(chunk.length <= 200, "chunk count limit");
  assert.ok(chunk.reduce((total, item) => total + item.length + 1, 0) <= 16000, "chunk char limit");
}
assert.equal(
  chunkGitPathspecs(longPaths).reduce((total, chunk) => total + chunk.length, 0),
  longPaths.length,
);

// Empty requests report a clear no-op failure when the path is not a repository.
assert.equal(sandbox.discardGitFiles(fixtureRoot, []).message, "未检测到 Git 仓库。");

try {
  // Explicit subset discard: only requested paths are discarded, unknown paths are skipped.
  const explicitRoot = createMixedFixture("explicit subset");
  const explicitResult = sandbox.discardGitFiles(explicitRoot, [
    "base-tracked.txt",
    "nested/staged-new.txt",
    "missing.txt",
  ]);
  assert.equal(explicitResult.ok, true);
  assert.equal(explicitResult.count, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(explicitResult.paths)), ["base-tracked.txt", "nested/staged-new.txt"]);
  assert.equal(fs.readFileSync(path.join(explicitRoot, "base-tracked.txt"), "utf8"), "base\n");
  assert.equal(fs.existsSync(path.join(explicitRoot, "nested/staged-new.txt")), false);
  const explicitRemaining = gitStatusLines(explicitRoot);
  assert.ok(explicitRemaining.some((line) => line.startsWith("M  base-staged.txt")));
  assert.ok(explicitRemaining.some((line) => line.startsWith("R  base-rename-a.txt")));
  assert.ok(explicitRemaining.some((line) => line.startsWith("?? untracked.txt")));
  assert.ok(explicitRemaining.some((line) => line.startsWith("?? untracked-dir/")));

  // Discard all: every entry from the untracked-files=all status is cleaned with
  // one batch command per phase, including files inside untracked directories.
  const discardAllResult = sandbox.discardGitFiles(explicitRoot, [], { all: true });
  assert.equal(discardAllResult.ok, true);
  assert.equal(discardAllResult.count, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(discardAllResult.paths)), [
    "base-rename-b.txt",
    "base-staged.txt",
    "untracked-dir/inner.txt",
    "untracked.txt",
  ]);
  assert.equal(fs.readFileSync(path.join(explicitRoot, "base-staged.txt"), "utf8"), "base\n");
  assert.equal(fs.existsSync(path.join(explicitRoot, "base-rename-a.txt")), true);
  assert.equal(fs.existsSync(path.join(explicitRoot, "base-rename-b.txt")), false);
  assert.equal(fs.existsSync(path.join(explicitRoot, "untracked.txt")), false);
  assert.deepEqual(gitStatusLines(explicitRoot), []);

  // A clean tree has nothing to discard.
  const cleanRoot = path.join(fixtureRoot, "clean tree");
  initializeRepository(cleanRoot);
  writeFile(cleanRoot, "committed.txt", "base\n");
  commitAll(cleanRoot, "initial");
  const cleanResult = sandbox.discardGitFiles(cleanRoot, [], { all: true });
  assert.equal(cleanResult.ok, false);
  assert.equal(cleanResult.count, 0);
  assert.equal(cleanResult.message, "没有可丢弃的文件变更。");
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.discardGitFiles(cleanRoot, []))), {
    ok: false,
    count: 0,
    paths: [],
    message: "没有可丢弃的文件变更。",
  });

  // Path traversal attempts stay rejected.
  const escapeResult = sandbox.discardGitFiles(cleanRoot, ["../escape.txt"]);
  assert.equal(escapeResult.ok, false);
  assert.equal(escapeResult.message, "目标路径不在项目目录内。");

  // Git represents a nested repository as an untracked directory even with
  // --untracked-files=all. It must be rejected, rather than skipped as an
  // unmatched trailing-slash path while other files are discarded.
  const embeddedRoot = path.join(fixtureRoot, "embedded repository");
  initializeRepository(embeddedRoot);
  writeFile(embeddedRoot, "committed.txt", "base\n");
  commitAll(embeddedRoot, "initial");
  writeFile(embeddedRoot, "a-safe.txt", "untracked\n");
  const nestedRepositoryPath = path.join(embeddedRoot, "z-nested-repository");
  initializeRepository(nestedRepositoryPath);
  const embeddedResult = sandbox.discardGitFiles(embeddedRoot, ["a-safe.txt", "z-nested-repository/"]);
  assert.equal(embeddedResult.ok, false);
  assert.equal(embeddedResult.count, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(embeddedResult.paths)), ["a-safe.txt"]);
  assert.equal(fs.existsSync(path.join(embeddedRoot, "a-safe.txt")), false);
  assert.equal(fs.existsSync(nestedRepositoryPath), true);
  assert.ok(embeddedResult.message.includes("未跟踪目录或非普通文件"), embeddedResult.message);
  const embeddedAllResult = sandbox.discardGitFiles(embeddedRoot, [], { all: true });
  assert.equal(embeddedAllResult.ok, false);
  assert.equal(embeddedAllResult.count, 0);
  assert.ok(embeddedAllResult.message.includes("未跟踪目录或非普通文件"), embeddedAllResult.message);
  const embeddedSingleResult = sandbox.discardGitFile(embeddedRoot, "z-nested-repository/");
  assert.equal(embeddedSingleResult.ok, false);
  assert.ok(embeddedSingleResult.message.includes("未跟踪目录或非普通文件"), embeddedSingleResult.message);

  // A locked index fails the batch without discarding anything.
  const lockedRoot = createMixedFixture("locked index");
  const lockPath = path.join(lockedRoot, ".git", "index.lock");
  fs.writeFileSync(lockPath, "");
  const lockedResult = sandbox.discardGitFiles(lockedRoot, [], { all: true });
  assert.equal(lockedResult.ok, false);
  assert.equal(lockedResult.count, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(lockedResult.paths)), []);
  assert.ok(lockedResult.message.includes("index.lock"), lockedResult.message);
  fs.rmSync(lockPath, { force: true });
  const unlockedResult = sandbox.discardGitFiles(lockedRoot, [], { all: true });
  assert.equal(unlockedResult.ok, true);
  assert.deepEqual(gitStatusLines(lockedRoot), []);

  // A single staged-new-file discard must stop when the index cannot be
  // reset, so it does not remove the worktree file while leaving it staged.
  const lockedSingleRoot = createMixedFixture("locked single index");
  const lockedSinglePath = path.join(lockedSingleRoot, ".git", "index.lock");
  fs.writeFileSync(lockedSinglePath, "");
  const lockedSingleResult = sandbox.discardGitFile(lockedSingleRoot, "nested/staged-new.txt");
  assert.equal(lockedSingleResult.ok, false);
  assert.ok(lockedSingleResult.message.includes("index.lock"), lockedSingleResult.message);
  assert.equal(fs.existsSync(path.join(lockedSingleRoot, "nested/staged-new.txt")), true);
  fs.rmSync(lockedSinglePath, { force: true });
  const unlockedSingleResult = sandbox.discardGitFile(lockedSingleRoot, "nested/staged-new.txt");
  assert.equal(unlockedSingleResult.ok, true);
  assert.equal(fs.existsSync(path.join(lockedSingleRoot, "nested/staged-new.txt")), false);

  // A failing required smudge filter breaks the batch mid-way; the result must
  // still report how many files were discarded before the failure.
  const partialRoot = path.join(fixtureRoot, "partial failure");
  initializeRepository(partialRoot);
  run(partialRoot, "config", "filter.bulkblock.required", "true");
  run(partialRoot, "config", "filter.bulkblock.smudge", "exit 1");
  run(partialRoot, "config", "filter.bulkblock.clean", "cat");
  writeFile(partialRoot, ".gitattributes", "zblocked.bin filter=bulkblock\n");
  writeFile(partialRoot, "zblocked.bin", "base\n");
  for (let index = 1; index <= 250; index += 1) {
    writeFile(partialRoot, `bulk-${String(index).padStart(3, "0")}.txt`, "base\n");
  }
  commitAll(partialRoot, "initial");
  for (let index = 1; index <= 250; index += 1) {
    fs.appendFileSync(path.join(partialRoot, `bulk-${String(index).padStart(3, "0")}.txt`), "dirty\n");
  }
  fs.appendFileSync(path.join(partialRoot, "zblocked.bin"), "dirty\n");
  const partialResult = sandbox.discardGitFiles(partialRoot, [], { all: true });
  assert.equal(partialResult.ok, false);
  assert.ok(partialResult.count >= 200, `unexpected discarded count ${partialResult.count}`);
  assert.ok(partialResult.count <= 250, `unexpected discarded count ${partialResult.count}`);
  assert.equal(partialResult.paths.length, partialResult.count);
  assert.ok(partialResult.message.includes(`（已先丢弃 ${partialResult.count} 个文件）`), partialResult.message);
  const partialRemaining = sandbox.readGitStatusEntries(partialRoot);
  assert.ok(
    partialRemaining.some((entry) => entry.path === "zblocked.bin"),
    "zblocked.bin should remain dirty after the failed batch",
  );

  // A failing clean filter in a later pathspec chunk must not report the
  // entire stage request as completed.
  const stagePartialRoot = path.join(fixtureRoot, "partial stage failure");
  initializeRepository(stagePartialRoot);
  writeFile(stagePartialRoot, ".gitattributes", "zblocked.bin filter=bulkadd\n");
  writeFile(stagePartialRoot, "zblocked.bin", "base\n");
  for (let index = 1; index <= 250; index += 1) {
    writeFile(stagePartialRoot, `bulk-${String(index).padStart(3, "0")}.txt`, "base\n");
  }
  commitAll(stagePartialRoot, "initial");
  run(stagePartialRoot, "config", "filter.bulkadd.required", "true");
  run(stagePartialRoot, "config", "filter.bulkadd.clean", "exit 1");
  for (let index = 1; index <= 250; index += 1) {
    fs.appendFileSync(path.join(stagePartialRoot, `bulk-${String(index).padStart(3, "0")}.txt`), "dirty\n");
  }
  fs.appendFileSync(path.join(stagePartialRoot, "zblocked.bin"), "dirty\n");
  const partialStageResult = sandbox.stageGitFiles(stagePartialRoot, [], { all: true });
  assert.equal(partialStageResult.ok, false);
  assert.equal(partialStageResult.count, 200);
  assert.equal(partialStageResult.paths.length, partialStageResult.count);
  assert.equal(partialStageResult.paths[0], "bulk-001.txt");
  assert.equal(partialStageResult.paths.at(-1), "bulk-200.txt");
  const partialStageStatus = sandbox.readGitStatusEntries(stagePartialRoot);
  assert.ok(
    partialStageStatus.some((entry) => entry.path === "bulk-001.txt" && entry.staged && !entry.unstaged),
    "the completed stage chunk should be staged",
  );
  assert.ok(
    partialStageStatus.some((entry) => entry.path === "zblocked.bin" && entry.unstaged),
    "the failed stage path should remain unstaged",
  );

  // Bulk stage / unstage keep working through the chunked command path.
  const stageRoot = createMixedFixture("stage and unstage");
  const stageAllResult = sandbox.stageGitFiles(stageRoot, [], { all: true });
  assert.equal(stageAllResult.ok, true);
  assert.equal(stageAllResult.count, 3);
  const stagedLines = gitStatusLines(stageRoot);
  assert.ok(stagedLines.length > 0);
  assert.ok(
    stagedLines.every((line) => !line.startsWith("??") && line[1] === " "),
    stagedLines.join("\n"),
  );
  const unstageAllResult = sandbox.unstageGitFiles(stageRoot, [], { all: true });
  assert.equal(unstageAllResult.ok, true);
  assert.ok(unstageAllResult.count >= 4);
  const unstageCleanup = sandbox.discardGitFiles(stageRoot, [], { all: true });
  assert.equal(unstageCleanup.ok, true);
  assert.deepEqual(gitStatusLines(stageRoot), []);

  // Single-file discard keeps its per-file semantics.
  const singleRoot = createMixedFixture("single file");
  const singleResult = sandbox.discardGitFile(singleRoot, "base-tracked.txt");
  assert.equal(singleResult.ok, true);
  assert.equal(fs.readFileSync(path.join(singleRoot, "base-tracked.txt"), "utf8"), "base\n");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("validate:git-bulk-actions passed");
