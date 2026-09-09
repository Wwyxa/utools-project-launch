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
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-activity-"));
const projectRoot = path.join(fixtureRoot, "project");
const nestedProjectRoot = path.join(projectRoot, "nested");
const nonGitRoot = path.join(fixtureRoot, "non-git");

const runGit = (repositoryPath, args, environment = {}) =>
  execFileSync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });

const localDate = (iso) => {
  const date = new Date(iso);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const commitFile = ({ fileName, contents, message, name, email, date }) => {
  fs.writeFileSync(path.join(projectRoot, fileName), contents);
  runGit(projectRoot, ["add", "--", fileName]);
  runGit(projectRoot, ["commit", "-m", message], {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: "Git Activity Validation",
    GIT_COMMITTER_EMAIL: "git-activity-validation@example.invalid",
    GIT_COMMITTER_DATE: date,
  });
};

const createPreloadBridge = () => {
  const sandbox = {
    Buffer,
    CustomEvent: class {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
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
  return sandbox.window.projectBridge;
};

try {
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(nestedProjectRoot, { recursive: true });
  fs.mkdirSync(nonGitRoot, { recursive: true });
  runGit(projectRoot, ["init"]);
  runGit(projectRoot, ["config", "user.name", "Git Activity Validation"]);
  runGit(projectRoot, ["config", "user.email", "git-activity-validation@example.invalid"]);

  const firstDate = "2026-02-03T00:30:00+14:00";
  const secondDate = "2026-02-05T16:30:00-08:00";
  const thirdDate = "2026-02-07T12:00:00+00:00";
  commitFile({
    fileName: "nested/first.txt",
    contents: "first\n",
    message: "first activity",
    name: "Alex",
    email: "alex.personal@example.invalid",
    date: firstDate,
  });
  const rootHash = runGit(projectRoot, ["rev-parse", "HEAD"]).trim();
  runGit(projectRoot, ["branch", "feature/activity", rootHash]);
  runGit(projectRoot, ["tag", "activity-base", rootHash]);
  runGit(projectRoot, ["update-ref", "refs/remotes/origin/feature/activity", rootHash]);
  commitFile({
    fileName: "second.txt",
    contents: "second\n",
    message: "second activity",
    name: "Alex",
    email: "alex.work@example.invalid",
    date: secondDate,
  });
  fs.writeFileSync(path.join(projectRoot, "stash.txt"), "stash\n");
  runGit(projectRoot, ["stash", "push", "--include-untracked", "-m", "activity stash"]);

  const bridge = createPreloadBridge();
  const range = { startDate: "2026-01-01", endDate: "2026-12-31" };
  const firstReport = await bridge.readGitActivity([projectRoot, nestedProjectRoot, nonGitRoot], range);
  assert.equal(firstReport.repositories.length, 2);

  const repository = firstReport.repositories.find((entry) => entry.repositoryPath === projectRoot);
  assert.ok(repository);
  assert.deepEqual(Array.from(repository.projectPaths).sort(), [nestedProjectRoot, projectRoot].sort());
  assert.equal(repository.state, "ready");
  assert.equal(repository.totalCommits, 2);
  assert.equal(repository.activeDays, 2);
  assert.equal(repository.authors.length, 2);
  assert.equal(repository.daily.find((day) => day.date === localDate(firstDate))?.commits, 1);
  assert.equal(repository.daily.find((day) => day.date === localDate(secondDate))?.commits, 1);

  const nonRepository = firstReport.repositories.find((entry) => entry.projectPaths.includes(nonGitRoot));
  assert.ok(nonRepository);
  assert.equal(nonRepository.state, "not-a-repository");

  commitFile({
    fileName: "third.txt",
    contents: "third\n",
    message: "third activity",
    name: "Alex",
    email: "alex.personal@example.invalid",
    date: thirdDate,
  });
  const cachedReport = await bridge.readGitActivity([projectRoot], range);
  assert.equal(cachedReport.repositories[0].totalCommits, 2);
  const refreshedReport = await bridge.readGitActivity([projectRoot], { ...range, force: true });
  assert.equal(refreshedReport.repositories[0].totalCommits, 3);
  assert.equal(refreshedReport.repositories[0].daily.find((day) => day.date === localDate(thirdDate))?.commits, 1);

  const fourthDate = "2026-02-07T13:00:00+00:00";
  commitFile({
    fileName: "fourth.txt",
    contents: "fourth\n",
    message: "fourth activity",
    name: "Alex",
    email: "alex.personal@example.invalid",
    date: fourthDate,
  });
  const latestReport = await bridge.readGitActivity([projectRoot], { ...range, force: true });
  assert.equal(latestReport.repositories[0].totalCommits, 4);

  const firstDayPage = await bridge.readGitActivityDay([projectRoot, nestedProjectRoot, nonGitRoot], {
    date: localDate(thirdDate),
    limit: 1,
  });
  assert.equal(firstDayPage.totalCommits, 2);
  assert.equal(firstDayPage.commits.length, 1);
  assert.equal(firstDayPage.commits[0].message, "fourth activity");
  assert.equal(firstDayPage.hasMore, true);
  assert.deepEqual(Array.from(firstDayPage.commits[0].projectPaths).sort(), [nestedProjectRoot, projectRoot].sort());
  assert.equal(firstDayPage.failedRepositories.length, 1);
  assert.equal(firstDayPage.failedRepositories[0].state, "not-a-repository");

  const secondDayPage = await bridge.readGitActivityDay([projectRoot], {
    date: localDate(thirdDate),
    limit: 1,
    skip: 1,
  });
  assert.equal(secondDayPage.commits.length, 1);
  assert.equal(secondDayPage.commits[0].message, "third activity");
  assert.equal(secondDayPage.hasMore, false);

  const personalAuthorPage = await bridge.readGitActivityDay([projectRoot], {
    date: localDate(thirdDate),
    authorId: "email:alex.personal@example.invalid",
  });
  assert.equal(personalAuthorPage.totalCommits, 2);
  assert.deepEqual(
    Array.from(personalAuthorPage.commits).map((commit) => commit.message),
    ["fourth activity", "third activity"],
  );

  console.log("Git activity validation passed.");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
