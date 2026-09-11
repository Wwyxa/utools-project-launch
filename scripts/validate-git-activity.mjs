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

const commitFile = ({ fileName, contents, message, name, email, date, committerDate = date }) => {
  fs.writeFileSync(path.join(projectRoot, fileName), contents);
  runGit(projectRoot, ["add", "--", fileName]);
  runGit(projectRoot, ["commit", "-m", message], {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: "Git Activity Validation",
    GIT_COMMITTER_EMAIL: "git-activity-validation@example.invalid",
    GIT_COMMITTER_DATE: committerDate,
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
  assert.equal(repository.currentAuthorId, "email:git-activity-validation@example.invalid");
  assert.equal(repository.daily.find((day) => day.date === localDate(firstDate))?.commits, 1);
  assert.equal(repository.daily.find((day) => day.date === localDate(secondDate))?.commits, 1);
  assert.equal(repository.entries.length, 2);
  assert.ok(repository.entries.every((entry) => Number.isInteger(entry.hour) && entry.hour >= 0 && entry.hour < 24));

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
  assert.equal(cachedReport.repositories[0].totalCommits, 3);
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

  const searchedDayPage = await bridge.readGitActivityDay([projectRoot], {
    date: localDate(thirdDate),
    query: "third",
    limit: 1,
  });
  assert.equal(searchedDayPage.totalCommits, 1);
  assert.equal(searchedDayPage.commits.length, 1);
  assert.equal(searchedDayPage.commits[0].message, "third activity");
  assert.equal(searchedDayPage.hasMore, false);

  const personalAuthorPage = await bridge.readGitActivityDay([projectRoot], {
    date: localDate(thirdDate),
    authorId: "email:alex.personal@example.invalid",
  });
  assert.equal(personalAuthorPage.totalCommits, 2);
  assert.deepEqual(
    Array.from(personalAuthorPage.commits).map((commit) => commit.message),
    ["fourth activity", "third activity"],
  );

  const unmatchedCurrentUserPage = await bridge.readGitActivityDay([projectRoot], {
    date: localDate(thirdDate),
    currentUserOnly: true,
  });
  assert.equal(unmatchedCurrentUserPage.totalCommits, 0);

  runGit(projectRoot, ["config", "user.email", "alex.personal@example.invalid"]);
  const currentUserPage = await bridge.readGitActivityDay([projectRoot], {
    date: localDate(thirdDate),
    currentUserOnly: true,
  });
  assert.equal(currentUserPage.currentUserOnly, true);
  assert.deepEqual(
    Array.from(currentUserPage.commits).map((commit) => commit.message),
    ["fourth activity", "third activity"],
  );

  const utcReport = await bridge.readGitActivity([projectRoot], { ...range, timeZone: "UTC", force: true });
  const kiritimatiReport = await bridge.readGitActivity([projectRoot], {
    ...range,
    timeZone: "Pacific/Kiritimati",
    force: true,
  });
  assert.equal(utcReport.repositories[0].daily.find((day) => day.date === "2026-02-02")?.commits, 1);
  assert.equal(utcReport.repositories[0].entries.find((entry) => entry.hash === rootHash)?.day, "2026-02-02");
  assert.equal(kiritimatiReport.repositories[0].daily.find((day) => day.date === "2026-02-03")?.commits, 1);

  const currentBranch = runGit(projectRoot, ["branch", "--show-current"]).trim();
  commitFile({
    fileName: "bot.txt",
    contents: "bot\n",
    message: "bot activity",
    name: "dependabot[bot]",
    email: "bot@users.noreply.github.com",
    date: "2026-03-01T12:00:00+00:00",
  });
  runGit(projectRoot, ["checkout", "-b", "merge-topic"]);
  commitFile({
    fileName: "merge-topic.txt",
    contents: "topic\n",
    message: "topic activity",
    name: "Casey",
    email: "casey@example.invalid",
    date: "2026-03-02T12:00:00+00:00",
  });
  runGit(projectRoot, ["checkout", currentBranch]);
  runGit(projectRoot, ["merge", "--no-ff", "merge-topic", "-m", "merge topic"], {
    GIT_AUTHOR_DATE: "2026-03-03T12:00:00+00:00",
    GIT_COMMITTER_DATE: "2026-03-03T12:00:00+00:00",
  });
  runGit(projectRoot, ["checkout", "-b", "unmerged-activity"]);
  commitFile({
    fileName: "unmerged.txt",
    contents: "unmerged\n",
    message: "unmerged activity",
    name: "Casey",
    email: "casey@example.invalid",
    date: "2026-03-04T12:00:00+00:00",
    committerDate: "2035-03-04T12:00:00+00:00",
  });
  runGit(projectRoot, ["checkout", currentBranch]);

  const filteredAll = await bridge.readGitActivity([projectRoot], {
    ...range,
    refScope: "all",
    timeZone: "UTC",
    hideMerges: true,
    excludeBots: true,
    identities: [
      {
        id: "alex",
        name: "Alex unified",
        emails: ["alex.personal@example.invalid", "alex.work@example.invalid"],
        names: [],
      },
    ],
    force: true,
  });
  assert.equal(filteredAll.repositories[0].totalCommits, 6);
  assert.equal(filteredAll.repositories[0].excludedMerges, 1);
  assert.equal(filteredAll.repositories[0].excludedBots, 1);
  assert.equal(filteredAll.repositories[0].authors.find((author) => author.id === "identity:alex")?.commits, 4);
  assert.equal(filteredAll.repositories[0].daily.find((day) => day.date === "2026-03-04")?.commits, 1);

  const currentScope = await bridge.readGitActivity([projectRoot], {
    ...range,
    refScope: "current",
    timeZone: "UTC",
    hideMerges: true,
    excludeBots: true,
    force: true,
  });
  assert.equal(currentScope.repositories[0].totalCommits, 5);
  assert.equal(currentScope.repositories[0].resolvedRef, "HEAD");

  runGit(projectRoot, ["update-ref", "refs/remotes/origin/develop", rootHash]);
  runGit(projectRoot, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop"]);
  const defaultScope = await bridge.readGitActivity([projectRoot], {
    ...range,
    refScope: "default",
    timeZone: "UTC",
    force: true,
  });
  assert.equal(defaultScope.repositories[0].resolvedRef, "refs/remotes/origin/develop");
  assert.equal(defaultScope.repositories[0].totalCommits, 1);

  const linkedWorktreeRoot = path.join(fixtureRoot, "linked-worktree");
  runGit(projectRoot, ["worktree", "add", "-b", "linked-activity", linkedWorktreeRoot, currentBranch]);
  fs.writeFileSync(path.join(linkedWorktreeRoot, "linked.txt"), "linked\n");
  runGit(linkedWorktreeRoot, ["add", "--", "linked.txt"]);
  runGit(linkedWorktreeRoot, ["commit", "-m", "linked worktree activity"], {
    GIT_AUTHOR_NAME: "Dana",
    GIT_AUTHOR_EMAIL: "dana@example.invalid",
    GIT_AUTHOR_DATE: "2026-03-05T12:00:00+00:00",
    GIT_COMMITTER_NAME: "Git Activity Validation",
    GIT_COMMITTER_EMAIL: "git-activity-validation@example.invalid",
    GIT_COMMITTER_DATE: "2026-03-05T12:00:00+00:00",
  });
  const worktreeScope = await bridge.readGitActivity([projectRoot, linkedWorktreeRoot], {
    ...range,
    refScope: "current",
    timeZone: "UTC",
    force: true,
  });
  assert.equal(worktreeScope.repositories.length, 1);
  assert.equal(worktreeScope.repositories[0].totalCommits, 8);
  assert.equal(worktreeScope.repositories[0].resolvedRef, "2 worktree HEADs");
  assert.deepEqual(
    Array.from(worktreeScope.repositories[0].projectPaths).sort(),
    [linkedWorktreeRoot, projectRoot].sort(),
  );

  const mergedIdentityPage = await bridge.readGitActivityDay([projectRoot], {
    date: "2026-02-07",
    timeZone: "UTC",
    identities: filteredAll.criteria.identities,
    authorId: "identity:alex",
    limit: 1,
  });
  const mergedIdentityNextPage = await bridge.readGitActivityDay([projectRoot], {
    date: "2026-02-07",
    timeZone: "UTC",
    identities: filteredAll.criteria.identities,
    authorId: "identity:alex",
    limit: 1,
    skip: 1,
  });
  assert.equal(mergedIdentityPage.totalCommits, 2);
  assert.equal(mergedIdentityPage.hasMore, true);
  assert.equal(mergedIdentityNextPage.hasMore, false);
  assert.notEqual(mergedIdentityPage.commits[0].hash, mergedIdentityNextPage.commits[0].hash);

  commitFile({
    fileName: "binary.dat",
    contents: Buffer.from([0, 1, 2, 3]),
    message: "feat(activity)!: add binary fixture",
    name: "Alex",
    email: "alex.personal@example.invalid",
    date: "2026-04-01T09:00:00+00:00",
  });
  const conventionalReport = await bridge.readGitActivity([projectRoot], {
    startDate: "2026-04-01",
    endDate: "2026-04-01",
    timeZone: "UTC",
    refScope: "current",
    force: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(conventionalReport.repositories[0].entries[0])), {
    hash: conventionalReport.repositories[0].entries[0].hash,
    date: "2026-04-01T09:00:00Z",
    day: "2026-04-01",
    authorId: "email:alex.personal@example.invalid",
    hour: 9,
    type: "feat",
    scope: "activity",
    breaking: true,
  });

  runGit(projectRoot, ["mv", "third.txt", "renamed-third.txt"]);
  runGit(projectRoot, ["commit", "-m", "refactor: rename fixture"], {
    GIT_AUTHOR_DATE: "2026-04-02T09:00:00+00:00",
    GIT_COMMITTER_DATE: "2026-04-02T09:00:00+00:00",
  });
  runGit(projectRoot, ["checkout", "-b", "change-stats-topic"]);
  commitFile({
    fileName: "change-stats-topic.txt",
    contents: "topic\n",
    message: "fix(stats): add topic fixture",
    name: "Alex",
    email: "alex.personal@example.invalid",
    date: "2026-04-03T09:00:00+00:00",
  });
  runGit(projectRoot, ["checkout", currentBranch]);
  runGit(projectRoot, ["merge", "--no-ff", "change-stats-topic", "-m", "merge change stats topic"], {
    GIT_AUTHOR_DATE: "2026-04-04T09:00:00+00:00",
    GIT_COMMITTER_DATE: "2026-04-04T09:00:00+00:00",
  });

  const changesRange = {
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    timeZone: "UTC",
    refScope: "current",
    force: true,
  };
  const changesWithMerge = await bridge.readGitActivityChanges([projectRoot], changesRange);
  const changesWithoutMerge = await bridge.readGitActivityChanges([projectRoot], {
    ...changesRange,
    hideMerges: true,
  });
  assert.equal(changesWithMerge.repositories[0].state, "ready");
  assert.equal(changesWithMerge.repositories[0].commits, 4);
  assert.equal(changesWithMerge.repositories[0].files, 4);
  assert.equal(changesWithMerge.repositories[0].binaryFiles, 1);
  assert.equal(changesWithMerge.repositories[0].additions, 2);
  assert.equal(changesWithMerge.repositories[0].deletions, 0);
  assert.equal(changesWithoutMerge.repositories[0].commits, 3);
  assert.equal(changesWithoutMerge.repositories[0].files, 3);
  assert.equal(changesWithoutMerge.repositories[0].additions, 1);
  const unmatchedAuthorChanges = await bridge.readGitActivityChanges([projectRoot], {
    ...changesRange,
    authorId: "email:nobody@example.invalid",
  });
  assert.equal(unmatchedAuthorChanges.repositories[0].commits, 0);
  assert.equal(unmatchedAuthorChanges.repositories[0].files, 0);

  console.log("Git activity validation passed.");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
