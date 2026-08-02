import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preloadSource = fs.readFileSync(path.join(repoRoot, "public", "preload.js"), "utf8");
const reportArguments = process.argv.slice(2);
if (
  reportArguments.length > 0 &&
  (reportArguments.length !== 2 ||
    reportArguments[0] !== "--report" ||
    !["before", "after"].includes(reportArguments[1]))
) {
  throw new Error("Invalid report target. Use: npm run benchmark:git-interactions -- --report before|after");
}
const reportTarget = reportArguments[1] || "before";
const usesPreloadedTooltipSummary = reportTarget === "after";
const reportFileName =
  reportTarget === "before" ? "git-interaction-performance-baseline.md" : "git-interaction-performance-after.md";
const taskDirectory = path.join(repoRoot, ".trellis", "tasks");
const activeResearchDirectory = path.join(taskDirectory, "08-01-git-interaction-performance", "research");
const archiveDirectory = path.join(taskDirectory, "archive");
const archivedResearchDirectory = fs.existsSync(archiveDirectory)
  ? fs
      .readdirSync(archiveDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(archiveDirectory, entry.name, "08-01-git-interaction-performance", "research"))
      .find((directory) => fs.existsSync(directory))
  : undefined;
const researchDirectory = fs.existsSync(activeResearchDirectory) ? activeResearchDirectory : archivedResearchDirectory;
if (!researchDirectory) {
  throw new Error("Cannot find the git-interaction-performance research directory.");
}
const isArchivedResearchDirectory = researchDirectory === archivedResearchDirectory;
const reportPath = path.join(researchDirectory, reportFileName);
const baselineReportPath = path.join(researchDirectory, "git-interaction-performance-baseline.md");
const warmSampleCount = 5;
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "git-interaction-performance-"));
const fixtureHome = path.join(fixtureRoot, "home");
const projectRoot = path.join(fixtureRoot, "project");
const fixtureEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: fixtureHome,
  USERPROFILE: fixtureHome,
  XDG_CONFIG_HOME: path.join(fixtureHome, ".config"),
};
const stageTargetPath = "stage-target.txt";

function runGit(args, options = {}) {
  return execFileSync("git", ["-C", projectRoot, ...args], {
    encoding: "utf8",
    env: { ...fixtureEnv, ...(options.env || {}) },
    input: options.input,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitDate(index) {
  return new Date(Date.UTC(2024, 0, 1, 0, Math.floor(index / 60), index % 60)).toISOString();
}

function runGitAtDate(args, index) {
  const date = gitDate(index);
  return runGit(args, { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

function appendCommit(relativePath, content, message, index) {
  fs.appendFileSync(path.join(projectRoot, relativePath), content);
  runGit(["add", "--", relativePath]);
  runGitAtDate(["commit", "-m", message], index);
  return runGit(["rev-parse", "HEAD"]).trim();
}

function createFixture() {
  fs.mkdirSync(fixtureHome, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  runGit(["init", "-b", "main"]);
  runGit(["config", "--global", "user.name", "Git Interaction Benchmark"]);
  runGit(["config", "--global", "user.email", "git-interaction-benchmark@example.invalid"]);

  fs.writeFileSync(path.join(projectRoot, "history.txt"), "commit 001\n");
  fs.writeFileSync(path.join(projectRoot, "tracked-change.txt"), "tracked base\n");
  fs.writeFileSync(path.join(projectRoot, "rename-source.txt"), "rename base\n");
  fs.writeFileSync(path.join(projectRoot, stageTargetPath), "stage target base\n");
  runGit(["add", "--", "history.txt", "tracked-change.txt", "rename-source.txt", stageTargetPath]);
  runGitAtDate(["commit", "-m", "commit 001"], 1);

  const mainHashes = [runGit(["rev-parse", "HEAD"]).trim()];
  for (let index = 2; index <= 30; index += 1) {
    mainHashes.push(
      appendCommit("history.txt", `commit ${String(index).padStart(3, "0")}\n`, `commit ${index}`, index),
    );
  }

  const featureBaseHash = mainHashes.at(-1);
  assert.ok(featureBaseHash);
  runGit(["branch", "feature/fixture", featureBaseHash]);
  for (let index = 31; index <= 50; index += 1) {
    mainHashes.push(
      appendCommit("history.txt", `commit ${String(index).padStart(3, "0")}\n`, `commit ${index}`, index),
    );
  }

  runGit(["switch", "feature/fixture"]);
  for (let index = 51; index <= 55; index += 1) {
    appendCommit("feature-history.txt", `feature ${index}\n`, `feature ${index}`, index);
  }

  runGit(["switch", "main"]);
  runGitAtDate(["merge", "--no-ff", "feature/fixture", "-m", "merge feature fixture"], 56);
  for (let index = 57; index <= 90; index += 1) {
    mainHashes.push(
      appendCommit("history.txt", `commit ${String(index).padStart(3, "0")}\n`, `commit ${index}`, index),
    );
  }

  assert.equal(runGit(["rev-list", "--count", "--all"]).trim(), "90");
  runGit(["tag", "fixture-lightweight", mainHashes[9]]);
  runGitAtDate(["tag", "-a", "fixture-annotated", "-m", "fixture annotated tag", mainHashes[19]], 91);
  runGit(["branch", "archive/fixture", featureBaseHash]);
  runGit(["remote", "add", "origin", "https://github.com/example/performance-fixture.git"]);
  const headHash = runGit(["rev-parse", "HEAD"]).trim();
  runGit(["update-ref", "refs/remotes/origin/main", headHash]);
  runGit(["update-ref", "refs/remotes/origin/fixture", featureBaseHash]);
  runGit(["config", "branch.main.remote", "origin"]);
  runGit(["config", "branch.main.merge", "refs/heads/main"]);

  fs.appendFileSync(path.join(projectRoot, "tracked-change.txt"), "staged change\n");
  runGit(["add", "--", "tracked-change.txt"]);
  fs.appendFileSync(path.join(projectRoot, "tracked-change.txt"), "unstaged change\n");
  runGit(["mv", "rename-source.txt", "renamed-stage.txt"]);
  fs.appendFileSync(path.join(projectRoot, stageTargetPath), "candidate working-tree change\n");

  for (let index = 0; index < 24; index += 1) {
    const directoryPath = path.join(projectRoot, "untracked", `level-${index % 4}`, `bucket-${index % 3}`);
    fs.mkdirSync(directoryPath, { recursive: true });
    fs.writeFileSync(
      path.join(directoryPath, `entry-${String(index).padStart(2, "0")}.txt`),
      `${"fixture line\n".repeat(16)}`,
    );
  }
  fs.writeFileSync(path.join(projectRoot, "untracked", "level-0", "payload.txt"), `${"payload\n".repeat(8192)}`);

  return {
    latestHash: headHash,
    adjacentHash: runGit(["rev-parse", "HEAD~1"]).trim(),
    gitVersion: runGit(["--version"]).trim(),
  };
}

function isGitExecutable(executable) {
  return (
    path
      .basename(String(executable || ""))
      .replace(/\.exe$/i, "")
      .toLowerCase() === "git"
  );
}

function categorizeGitCommand(args) {
  const commandArgs = args.map((value) => String(value));
  if (commandArgs.includes("log")) return "history";
  if (commandArgs.includes("show")) return "detail";
  if (commandArgs.includes("add") || commandArgs.includes("reset") || commandArgs.includes("restore")) return "write";
  if (commandArgs.includes("status")) return "status";
  if (commandArgs.includes("diff")) return commandArgs.includes("--numstat") ? "numstat" : "status";
  if (commandArgs.includes("for-each-ref") || commandArgs.includes("symbolic-ref") || commandArgs.includes("remote")) {
    return "refs";
  }
  if (
    commandArgs.includes("worktree") ||
    commandArgs.includes("ls-files") ||
    commandArgs.includes("config") ||
    commandArgs.includes("--show-object-format") ||
    commandArgs.includes("--show-superproject-working-tree")
  ) {
    return "workspace";
  }
  if (commandArgs.includes("rev-parse")) return commandArgs.includes("HEAD") ? "refs" : "root";
  return "git";
}

function countBy(values, key) {
  return values.reduce((counts, value) => {
    const name = key(value);
    counts[name] = (counts[name] || 0) + 1;
    return counts;
  }, {});
}

function createRecorder() {
  const events = [];
  let readdirSyncCalls = 0;
  let readFileSyncCalls = 0;
  let bytesRead = 0;
  let httpCalls = 0;
  const resolvedFixtureRoot = path.resolve(fixtureRoot);
  const fixturePrefix = `${resolvedFixtureRoot}${path.sep}`;

  const isFixturePath = (filePath) => {
    if (typeof filePath !== "string") return false;
    const resolvedPath = path.resolve(filePath);
    return resolvedPath === resolvedFixtureRoot || resolvedPath.startsWith(fixturePrefix);
  };

  return {
    startGit(kind, executable, args) {
      if (!isGitExecutable(executable)) return null;
      const event = {
        kind,
        category: categorizeGitCommand(args),
        startedAt: performance.now(),
        endedAt: null,
        status: null,
      };
      events.push(event);
      return event;
    },
    finishGit(event, status) {
      if (!event || event.endedAt !== null) return;
      event.endedAt = performance.now();
      event.status = status;
    },
    recordDirectoryRead(filePath) {
      if (isFixturePath(filePath)) readdirSyncCalls += 1;
    },
    recordFileRead(filePath, result) {
      if (!isFixturePath(filePath)) return;
      readFileSyncCalls += 1;
      bytesRead += Buffer.isBuffer(result) ? result.length : Buffer.byteLength(String(result || ""));
    },
    recordHttp() {
      httpCalls += 1;
    },
    reset() {
      events.length = 0;
      readdirSyncCalls = 0;
      readFileSyncCalls = 0;
      bytesRead = 0;
      httpCalls = 0;
    },
    snapshot() {
      return {
        gitChildren: events.length,
        gitCategories: countBy(events, (event) => event.category),
        filesystem: { readdirSyncCalls, readFileSyncCalls, bytesRead },
        httpCalls,
      };
    },
  };
}

function processStatus(error) {
  if (!error) return 0;
  return typeof error.code === "number" ? error.code : String(error.code || "error");
}

function lastCallbackIndex(args) {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    if (typeof args[index] === "function") return index;
  }
  return -1;
}

function createChildProcessProxy(recorder) {
  const childProcess = require("node:child_process");
  const wrapSync =
    (method) =>
    (...args) => {
      const event = recorder.startGit(method, args[0], Array.isArray(args[1]) ? args[1] : []);
      try {
        const result = childProcess[method](...args);
        recorder.finishGit(event, result?.status ?? 0);
        return result;
      } catch (error) {
        recorder.finishGit(event, processStatus(error));
        throw error;
      }
    };
  const wrapExecFile = (...args) => {
    const event = recorder.startGit("execFile", args[0], Array.isArray(args[1]) ? args[1] : []);
    const callbackIndex = lastCallbackIndex(args);
    if (callbackIndex >= 0) {
      const callback = args[callbackIndex];
      args[callbackIndex] = function wrappedCallback(error, ...callbackArgs) {
        recorder.finishGit(event, processStatus(error));
        return callback.call(this, error, ...callbackArgs);
      };
    }
    try {
      const child = childProcess.execFile(...args);
      if (callbackIndex < 0 && event && child) {
        let settled = false;
        const finish = (status) => {
          if (settled) return;
          settled = true;
          recorder.finishGit(event, status);
        };
        child.once("close", finish);
        child.once("error", (error) => finish(processStatus(error)));
      }
      return child;
    } catch (error) {
      recorder.finishGit(event, processStatus(error));
      throw error;
    }
  };
  const wrapSpawn = (...args) => {
    const event = recorder.startGit("spawn", args[0], Array.isArray(args[1]) ? args[1] : []);
    try {
      const child = childProcess.spawn(...args);
      if (event && child) {
        let settled = false;
        const finish = (status) => {
          if (settled) return;
          settled = true;
          recorder.finishGit(event, status);
        };
        child.once("close", finish);
        child.once("error", (error) => finish(processStatus(error)));
      }
      return child;
    } catch (error) {
      recorder.finishGit(event, processStatus(error));
      throw error;
    }
  };

  return new Proxy(childProcess, {
    get(target, property) {
      if (property === "execFile") return wrapExecFile;
      if (property === "execFileSync") return wrapSync("execFileSync");
      if (property === "spawn") return wrapSpawn;
      if (property === "spawnSync") return wrapSync("spawnSync");
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function createFsProxy(recorder) {
  return new Proxy(fs, {
    get(target, property) {
      if (property === "readdirSync") {
        return (...args) => {
          const result = target.readdirSync(...args);
          recorder.recordDirectoryRead(args[0]);
          return result;
        };
      }
      if (property === "readFileSync") {
        return (...args) => {
          const result = target.readFileSync(...args);
          recorder.recordFileRead(args[0], result);
          return result;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function createMeasuredBridge() {
  const recorder = createRecorder();
  const childProcess = createChildProcessProxy(recorder);
  const measuredFs = createFsProxy(recorder);
  const bridgeEvents = [];
  const sandbox = {
    AbortController,
    Buffer,
    TextDecoder,
    URL,
    clearTimeout,
    console: { warn() {}, error() {}, log() {} },
    fetch: async () => {
      recorder.recordHttp();
      return {
        ok: true,
        async json() {
          return { author: { avatar_url: "https://avatars.example.invalid/fixture.png" } };
        },
      };
    },
    performance,
    process: { env: { ...fixtureEnv }, execPath: process.execPath, platform: process.platform, once() {}, exit() {} },
    require(moduleName) {
      if (moduleName === "electron") {
        return {
          shell: { openExternal: () => Promise.resolve(), openPath: () => Promise.resolve(), showItemInFolder() {} },
        };
      }
      if (moduleName === "child_process" || moduleName === "node:child_process") return childProcess;
      if (moduleName === "fs" || moduleName === "node:fs") return measuredFs;
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

  const bridge = new Proxy(sandbox.window.projectBridge, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args) => {
        const event = { method: String(property), startedAt: performance.now(), endedAt: null };
        bridgeEvents.push(event);
        try {
          const result = value.apply(target, args);
          if (!result || typeof result.then !== "function") {
            event.endedAt = performance.now();
            return result;
          }
          return result.then(
            (value) => {
              event.endedAt = performance.now();
              return value;
            },
            (error) => {
              event.endedAt = performance.now();
              throw error;
            },
          );
        } catch (error) {
          event.endedAt = performance.now();
          throw error;
        }
      };
    },
  });

  return {
    bridge,
    reset() {
      recorder.reset();
      bridgeEvents.length = 0;
    },
    snapshot() {
      const bridgeCalls = countBy(bridgeEvents, (event) => event.method);
      const bridgeDurations = bridgeEvents.reduce((durations, event) => {
        durations[event.method] =
          (durations[event.method] || 0) + Math.max(0, (event.endedAt || performance.now()) - event.startedAt);
        return durations;
      }, {});
      return { ...recorder.snapshot(), bridgeCalls, bridgeDurations };
    },
  };
}

async function measure(context, execute) {
  context.reset();
  const startedAt = performance.now();
  const outcome = await execute(context.bridge);
  const sample = { durationMs: performance.now() - startedAt, ...context.snapshot() };
  await outcome?.background;
  return sample;
}

async function measureScenario({ name, uiRequestNote, prepare, preload, execute }) {
  const measurePrepared = async (context) => {
    prepare();
    const preloaded = preload ? await preload(context.bridge) : undefined;
    return measure(context, (bridge) => execute(bridge, preloaded));
  };
  const coldContext = createMeasuredBridge();
  const coldSample = await measurePrepared(coldContext);

  const warmContext = createMeasuredBridge();
  await measurePrepared(warmContext);
  const warmSamples = [];
  for (let index = 0; index < warmSampleCount; index += 1) {
    warmSamples.push(await measurePrepared(warmContext));
  }

  return { name, uiRequestNote, coldSample, warmSamples };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function representativeSample(samples) {
  const middle = median(samples.map((sample) => sample.durationMs));
  return [...samples].sort(
    (left, right) => Math.abs(left.durationMs - middle) - Math.abs(right.durationMs - middle),
  )[0];
}

function formatDuration(value) {
  return `${value.toFixed(2)} ms`;
}

function readReportedWarmMedians() {
  if (!fs.existsSync(baselineReportPath)) {
    throw new Error("Cannot write an after report without git-interaction-performance-baseline.md.");
  }

  const medians = new Map();
  for (const line of fs.readFileSync(baselineReportPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\| (.+?) \| [^|]* \| [^|]* \| ([\d.]+) ms \|/);
    if (match) medians.set(match[1], Number(match[2]));
  }
  return medians;
}

function formatComparisonDelta(beforeMs, afterMs) {
  if (Math.max(Math.abs(beforeMs), Math.abs(afterMs)) < 0.05) {
    return "not meaningful (<0.05 ms)";
  }
  const deltaMs = afterMs - beforeMs;
  const percent = beforeMs === 0 ? 0 : (deltaMs / beforeMs) * 100;
  return `${deltaMs >= 0 ? "+" : ""}${deltaMs.toFixed(2)} ms (${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%)`;
}

function formatCounts(counts) {
  const values = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return values.length > 0 ? values.map(([name, count]) => `${name}=${count}`).join(", ") : "none";
}

function formatFilesystem(sample) {
  return `dirs=${sample.filesystem.readdirSyncCalls}, files=${sample.filesystem.readFileSyncCalls}, bytes=${sample.filesystem.bytesRead}`;
}

function formatBridge(sample) {
  const methods = Object.keys(sample.bridgeCalls).sort();
  return methods.length > 0
    ? methods
        .map(
          (method) => `${method}=${sample.bridgeCalls[method]}/${formatDuration(sample.bridgeDurations[method] || 0)}`,
        )
        .join(", ")
    : "none";
}

function slowestBridge(sample) {
  return Object.entries(sample.bridgeDurations).sort(([, left], [, right]) => right - left)[0] || ["none", 0];
}

function writeReport(fixture, scenarios) {
  const scenarioByName = Object.fromEntries(scenarios.map((scenario) => [scenario.name, scenario]));
  const initialSnapshotScenarioName =
    reportTarget === "after" ? "initial coordinated parent/GitTab model" : "initial forced contention model";
  const initialSnapshotSample = representativeSample(scenarioByName[initialSnapshotScenarioName].warmSamples);
  const stageSample = representativeSample(scenarioByName["single-file stage"].warmSamples);
  const unstageSample = representativeSample(scenarioByName["single-file unstage"].warmSamples);
  const appendSample = representativeSample(scenarioByName["append history page"].warmSamples);
  const coldTooltipSample = representativeSample(scenarioByName["tooltip cold open"].warmSamples);
  const warmTooltipSample = representativeSample(scenarioByName["tooltip warm A-B-A switch"].warmSamples);
  const remountTooltipSample = representativeSample(scenarioByName["tooltip remount same-hash return"].warmSamples);
  const [stageSlowestMethod, stageSlowestDuration] = slowestBridge(stageSample);
  const [unstageSlowestMethod, unstageSlowestDuration] = slowestBridge(unstageSample);
  const nextOptimization =
    reportTarget === "after"
      ? "This report includes parent/GitTab initial snapshot coordination, the post-write working-tree foreground path, and tooltip preloaded-summary/session reuse. Pagination ref enumeration and rendered-frame latency remain unoptimized in this slice."
      : stageSlowestMethod === "readGitWorkspaceSnapshot" || unstageSlowestMethod === "readGitWorkspaceSnapshot"
        ? "Keep the Git-derived status refresh in the stage/unstage foreground path and move only workspace inventory completion behind the user-visible result, with an explicit background refresh and existing full-refresh recovery."
        : "Measure the status reader's command and untracked-scan substeps before changing the post-write refresh boundary; this baseline does not support moving workspace inventory first.";
  const writePathMethod =
    reportTarget === "after"
      ? "- Stage and unstage time the post-write foreground path: write action, start workspace inventory in the background, then await `readGitWorkingTreeSnapshot`. The sample is captured before the background inventory settles, though counters can include work it already started."
      : "- Stage and unstage time the current foreground-equivalent sequence: write action, then concurrent `readGitStatusSnapshot` and `readGitWorkspaceSnapshot`. Fixture setup and postcondition assertions are excluded from recorded counts and wall time.";
  const tooltipMeasurementMethod =
    reportTarget === "after"
      ? "- Tooltip scenarios load one history page before the measured interval, select commits from that result, and validate their preloaded `shortStats`. A visible tooltip then runs only the optional avatar bridge call; it does not run per-hover `readGitCommitFiles`."
      : "- Tooltip baseline scenarios load one history page before the measured interval to select commits, then model the historical full-file plus optional-avatar detail work.";
  const tooltipConclusions =
    reportTarget === "after"
      ? `- The cold tooltip summary comes from the preloaded history record; its visible-card enhancement made ${coldTooltipSample.gitChildren} Git child processes and ${formatBridge(coldTooltipSample)}, with no per-hover \`readGitCommitFiles\` bridge call.\n- The A-B-A tooltip session model made ${warmTooltipSample.gitChildren} Git child processes and ${formatBridge(warmTooltipSample)}. Each visible summary is preloaded; the return to A reuses the renderer-session avatar entry without additional bridge work.\n- The remount-return tooltip model made ${remountTooltipSample.gitChildren} Git child processes and ${formatBridge(remountTooltipSample)}. A new component instance reuses the renderer-session avatar entry while its summary remains preloaded.\n`
      : `- The A-B-A tooltip session model made ${warmTooltipSample.gitChildren} Git child processes and ${formatBridge(warmTooltipSample)}. The return to A uses the renderer-session entry and therefore issues no additional bridge call in that model; leave-before-delay records zero bridge and HTTP work.\n- The remount-return tooltip model made ${remountTooltipSample.gitChildren} Git child processes and ${formatBridge(remountTooltipSample)}. It reuses the renderer-session entry across the new component instance, so the second visible card issues no additional detail bridge read.\n`;
  const scope =
    reportTarget === "after"
      ? `## Scope\n\n- This post-change measurement includes parent/GitTab initial snapshot coordination, the existing post-write working-tree path, and tooltip preloaded-summary/renderer-session reuse. The independent before report remains \`research/git-interaction-performance-baseline.md\`.\n- Visible tooltip summaries come from the already-loaded history result; only optional avatar enrichment remains, with no per-hover \`readGitCommitFiles\` work.\n- The coordinated parent/GitTab model makes ${initialSnapshotSample.gitChildren} Git children through ${formatBridge(initialSnapshotSample)}; the historical forced two-request model remains in \`--report before\`.\n- Initial snapshot work beyond this coordination, pagination ref enumeration, and rendered-frame latency remain outside this slice.\n\n`
      : "";

  const summaryRows = scenarios.map((scenario) => {
    const representative = representativeSample(scenario.warmSamples);
    return `| ${scenario.name} | ${formatDuration(scenario.coldSample.durationMs)} | ${scenario.warmSamples
      .map((sample) => sample.durationMs.toFixed(2))
      .join(
        ", ",
      )} | ${formatDuration(median(scenario.warmSamples.map((sample) => sample.durationMs)))} | ${scenario.uiRequestNote}; ${formatBridge(
      representative,
    )} | ${formatCounts(representative.gitCategories)} | ${formatFilesystem(representative)} | ${representative.httpCalls} |`;
  });

  const rawSections = scenarios
    .map((scenario) => {
      const samples = [
        ["VM/cache-cold", scenario.coldSample],
        ...scenario.warmSamples.map((sample, index) => [`warm ${index + 1}`, sample]),
      ];
      const rows = samples.map(
        ([label, sample]) =>
          `| ${label} | ${formatDuration(sample.durationMs)} | ${sample.gitChildren} | ${formatCounts(sample.gitCategories)} | ${formatFilesystem(
            sample,
          )} | ${formatBridge(sample)} | ${sample.httpCalls} |`,
      );
      return `### ${scenario.name}\n\n| Sample | Wall time | Git children | Git categories | Fixture-local synchronous fs | Bridge calls / summed bridge time | HTTP |\n| --- | ---: | ---: | --- | --- | --- | ---: |\n${rows.join(
        "\n",
      )}`;
    })
    .join("\n\n");

  const comparison =
    reportTarget === "after"
      ? (() => {
          const beforeMedians = readReportedWarmMedians();
          const beforeScenarioNames = {
            "initial coordinated parent/GitTab model": "initial forced contention model",
          };
          const notes = {
            "initial coordinated parent/GitTab model": "One request replaces the forced duplicate model.",
            "tooltip cold open":
              "Preloaded short stats make the summary ready immediately; only optional avatar work remains.",
            "tooltip warm A-B-A switch":
              "Each visible summary is preloaded, while the A return reuses the renderer-session avatar entry.",
            "single-file stage": "Foreground uses the working-tree snapshot; workspace inventory is background work.",
            "single-file unstage": "Foreground uses the working-tree snapshot; workspace inventory is background work.",
            "tooltip remount same-hash return":
              "Preloaded summary needs no file read, and the renderer-session avatar entry survives component remount.",
          };
          const rows = scenarios.map((scenario) => {
            const beforeName = beforeScenarioNames[scenario.name] || scenario.name;
            const beforeMedian = beforeMedians.get(beforeName);
            const afterMedian = median(scenario.warmSamples.map((sample) => sample.durationMs));
            const note = notes[scenario.name] || "No deliberate model change; treat timing delta as host variance.";
            return Number.isFinite(beforeMedian)
              ? `| ${scenario.name} | ${formatDuration(beforeMedian)} | ${formatDuration(afterMedian)} | ${formatComparisonDelta(beforeMedian, afterMedian)} | ${note} |`
              : `| ${scenario.name} | unavailable | ${formatDuration(afterMedian)} | unavailable | Historical baseline row is unavailable; do not claim a timing change. |`;
          });
          return `## Before / After Comparison\n\n- Before medians are read from the preserved pre-change report; after medians are generated by this invocation using the same documented fixture and protocol. They are not simultaneous samples, so command/bridge/filesystem counts remain the causal evidence and time-only changes on unchanged models are host variance.\n- Delta is \`after - before\`; a negative value is faster.\n\n| Flow | Before warm median | After warm median | Delta | Interpretation |\n| --- | ---: | ---: | ---: | --- |\n${rows.join("\n")}\n\n`;
        })()
      : "";

  const report = `# Git Interaction Performance ${reportTarget === "before" ? "Baseline (Before)" : "After"}

## Command

\`npm run benchmark:git-interactions -- --report ${reportTarget}\`

${scope}## Method

- The harness uses only Node.js standard-library modules, creates the real \`public/preload.js\` in a fresh VM, and proxies its Git child-process APIs plus \`readdirSync\` and \`readFileSync\` below the temporary fixture root.
- Each scenario has one fresh-VM/cache-cold sample, one unreported warm-up, and ${warmSampleCount} warm samples on the same fixture and VM. Warm medians are the middle of five samples. VM/cache-cold does not claim to flush operating-system filesystem caches.
- The GitHub-shaped remote never contacts a network. \`fetch\` is an in-VM deterministic stub and its calls are counted separately.
${writePathMethod}
${tooltipMeasurementMethod}

## Fixture

- ${fixture.gitVersion}; a temporary repository initialized with fixture-local \`HOME\`, global Git identity, \`GIT_CONFIG_NOSYSTEM=1\`, and fixed author/committer dates.
- Exactly 90 commits: mainline history, a five-commit \`feature/fixture\` divergence, a real no-fast-forward merge, an old archive branch, a lightweight tag, and an annotated tag.
- A GitHub-shaped \`origin\` and synthetic upstream refs exist only as local configuration.
- Working tree includes one tracked file with staged and unstaged changes, a staged rename, an unstaged single-file action target, and 25 nested untracked files including a deterministic payload.

## ${reportTarget === "before" ? "Before" : "After"} Table

| Flow | VM/cache-cold | Raw warm wall samples (ms) | Warm median | UI model and bridge calls | Git child categories | Fixture-local synchronous fs | HTTP |
| --- | ---: | --- | ---: | --- | --- | --- | ---: |
${summaryRows.join("\n")}

${comparison}## Raw Samples

${rawSections}

## Bottleneck Conclusions

${
  reportTarget === "after"
    ? `- The coordinated parent/GitTab initial-request median sample made ${initialSnapshotSample.gitChildren} Git child processes and ${formatBridge(initialSnapshotSample)}. Both callers share one bridge request; the unchanged before model remains two \`readGitSnapshot\` calls and 32 Git children.\n`
    : ""
}
- The stage foreground median sample made ${stageSample.gitChildren} Git child processes and ${formatBridge(stageSample)}. Its longest bridge operation was \`${stageSlowestMethod}\` at ${formatDuration(stageSlowestDuration)}. Bridge operation durations overlap when status and workspace reads run concurrently, so their summed values are diagnostic rather than additive wall time.
- The unstage foreground median sample made ${unstageSample.gitChildren} Git child processes and ${formatBridge(unstageSample)}. Its longest bridge operation was \`${unstageSlowestMethod}\` at ${formatDuration(unstageSlowestDuration)}.
- The append-page median sample made ${appendSample.gitChildren} Git child processes, including ${appendSample.gitCategories.refs || 0} ref-category calls. Ref reuse is not justified until an optimization reruns this exact fixture and improves the same measurement.
${tooltipConclusions}

## Unknowns

- The harness invokes real preload bridge methods but does not mount Vue. Focused renderer-session tests cover the delayed start, remount reuse, and stale-context rejection; whether component scheduling triggers the deliberate initial full-snapshot contention model still needs a focused Store/component bridge-spy regression.
- It does not measure rendered-frame latency, actual host browser event timing, linked-worktree/submodule inventory growth, or a selected-file diff reload.
- Antivirus, indexer activity, Git version, and OS cache state can affect absolute times. Compare subsequent optimization runs on this same machine and fixture.

## Narrow Next Optimization

${nextOptimization}
`;

  if (!isArchivedResearchDirectory) {
    fs.writeFileSync(reportPath, report, "utf8");
  }
}

function prepareStage() {
  runGit(["reset", "-q", "HEAD", "--", stageTargetPath]);
}

function prepareUnstage() {
  prepareStage();
  runGit(["add", "--", stageTargetPath]);
}

function noPreparation() {}

function assertValidPreloadedShortStats(commit) {
  assert.ok(commit);
  assert.ok(commit.shortStats);
  assert.equal(
    [commit.shortStats.files, commit.shortStats.additions, commit.shortStats.deletions].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ),
    true,
  );
}

async function readVisibleTooltipCommits(bridge, hashes) {
  const history = await bridge.readGitCommits(projectRoot, { limit: 80, skip: 0 });
  assert.equal(history.commits.length, 80);
  return hashes.map((hash) => {
    const commit = history.commits.find((item) => item.hash === hash);
    assert.ok(commit, `Missing visible tooltip commit ${hash}.`);
    assertValidPreloadedShortStats(commit);
    return commit;
  });
}

async function readTooltipDetails(bridge, commit) {
  assertValidPreloadedShortStats(commit);
  const avatar = bridge.readGitCommitAuthorAvatar(projectRoot, commit.hash);
  if (!usesPreloadedTooltipSummary) {
    const [files, avatarUrl] = await Promise.all([bridge.readGitCommitFiles(projectRoot, commit.hash), avatar]);
    assert.ok(Array.isArray(files));
    assert.equal(typeof avatarUrl === "string" || avatarUrl === null, true);
    return;
  }

  const avatarUrl = await avatar;
  assert.equal(typeof avatarUrl === "string" || avatarUrl === null, true);
}

function createTooltipRendererSession(bridge) {
  const details = new Map();
  return {
    load(commit) {
      if (!details.has(commit.hash)) {
        details.set(commit.hash, readTooltipDetails(bridge, commit));
      }
      return details.get(commit.hash);
    },
  };
}

function createTooltipRenderer(session) {
  const details = new Map();
  return (commit) => {
    if (!details.has(commit.hash)) {
      details.set(commit.hash, session.load(commit));
    }
    return details.get(commit.hash);
  };
}

function assertTooltipAfterBridgeCalls(scenarios) {
  if (!usesPreloadedTooltipSummary) return;
  const expectedBridgeCalls = {
    "tooltip leave before delay": {},
    "tooltip cold open": { readGitCommitAuthorAvatar: 1 },
    "tooltip warm A-B-A switch": { readGitCommitAuthorAvatar: 2 },
    "tooltip remount same-hash return": { readGitCommitAuthorAvatar: 1 },
  };

  for (const [name, expected] of Object.entries(expectedBridgeCalls)) {
    const scenario = scenarios.find((item) => item.name === name);
    assert.ok(scenario, `Missing tooltip scenario ${name}.`);
    for (const sample of [scenario.coldSample, ...scenario.warmSamples]) {
      assert.deepEqual(sample.bridgeCalls, expected, `${name} used unexpected bridge calls.`);
    }
  }
}

try {
  const fixture = createFixture();
  const scenarios = [
    await measureScenario({
      name: "initial history load",
      uiRequestNote: "UI model=1 initial refresh",
      prepare: noPreparation,
      execute: async (bridge) => {
        const snapshot = await bridge.readGitSnapshot(projectRoot, { limit: 80, skip: 0 });
        assert.equal(snapshot.commits.length, 80);
        assert.equal(snapshot.hasMoreCommits, true);
      },
    }),
    await measureScenario({
      name: reportTarget === "after" ? "initial coordinated parent/GitTab model" : "initial forced contention model",
      uiRequestNote:
        reportTarget === "after"
          ? "UI/store model=parent plus GitTab joins one initial request"
          : "UI model=parent plus forced GitTab contender",
      prepare: noPreparation,
      execute: async (bridge) => {
        const parentRefresh = bridge.readGitSnapshot(projectRoot, { limit: 80, skip: 0 });
        const gitTabRefresh =
          reportTarget === "after" ? parentRefresh : bridge.readGitSnapshot(projectRoot, { limit: 80, skip: 0 });
        const snapshots = await Promise.all([parentRefresh, gitTabRefresh]);
        assert.equal(
          snapshots.every((snapshot) => snapshot.commits.length === 80),
          true,
        );
      },
    }),
    await measureScenario({
      name: "append history page",
      uiRequestNote: "UI model=1 sentinel edge",
      prepare: noPreparation,
      execute: async (bridge) => {
        const page = await bridge.readGitCommits(projectRoot, { limit: 80, skip: 80 });
        assert.equal(page.commits.length, 10);
        assert.equal(page.hasMoreCommits, false);
      },
    }),
    await measureScenario({
      name: "tooltip leave before delay",
      uiRequestNote: "UI model=loaded-history commit enters then leaves before delay; bridge=0",
      prepare: noPreparation,
      preload: async (bridge) => {
        const [commit] = await readVisibleTooltipCommits(bridge, [fixture.latestHash]);
        return commit;
      },
      execute: async (_bridge, commit) => {
        assertValidPreloadedShortStats(commit);
        let detailStart = false;
        const timer = setTimeout(() => {
          detailStart = true;
        }, 450);
        clearTimeout(timer);
        assert.equal(detailStart, false);
      },
    }),
    await measureScenario({
      name: "tooltip cold open",
      uiRequestNote:
        reportTarget === "after"
          ? "UI model=1 visible tooltip; preloaded shortStats; optional avatar only"
          : "UI model=1 visible tooltip; legacy full files plus optional avatar",
      prepare: noPreparation,
      preload: async (bridge) => {
        const [commit] = await readVisibleTooltipCommits(bridge, [fixture.latestHash]);
        return commit;
      },
      execute: (bridge, commit) => readTooltipDetails(bridge, commit),
    }),
    await measureScenario({
      name: "tooltip warm A-B-A switch",
      uiRequestNote:
        reportTarget === "after"
          ? "UI model=three visible commits; preloaded shortStats; renderer-session cached A avatar return"
          : "UI model=three visible commits; renderer-session cached A return",
      prepare: noPreparation,
      preload: (bridge) => readVisibleTooltipCommits(bridge, [fixture.latestHash, fixture.adjacentHash]),
      execute: async (bridge, [latestCommit, adjacentCommit]) => {
        const session = createTooltipRendererSession(bridge);
        const load = createTooltipRenderer(session);
        await load(latestCommit);
        await load(adjacentCommit);
        await load(latestCommit);
      },
    }),
    await measureScenario({
      name: "tooltip remount same-hash return",
      uiRequestNote:
        reportTarget === "after"
          ? "UI model=same hash after component remount; preloaded shortStats; renderer-session avatar reuse"
          : "UI model=same hash after component remount; component-local cache reset",
      prepare: noPreparation,
      preload: async (bridge) => {
        const [commit] = await readVisibleTooltipCommits(bridge, [fixture.latestHash]);
        return commit;
      },
      execute: async (bridge, commit) => {
        const session = createTooltipRendererSession(bridge);
        const firstMount = createTooltipRenderer(session);
        await firstMount(commit);
        const remountSession = reportTarget === "before" ? createTooltipRendererSession(bridge) : session;
        const remount = createTooltipRenderer(remountSession);
        await remount(commit);
      },
    }),
    await measureScenario({
      name: "single-file stage",
      uiRequestNote:
        reportTarget === "after"
          ? "UI/store model=1 action; foreground working-tree, workspace background"
          : "UI/store model=1 action; foreground status plus workspace",
      prepare: prepareStage,
      execute: async (bridge) => {
        const result = await bridge.stageGitFile(projectRoot, stageTargetPath);
        assert.equal(result.ok, true);
        if (reportTarget === "after") {
          const background = bridge.readGitWorkspaceSnapshot(projectRoot);
          const workingTreeSnapshot = await bridge.readGitWorkingTreeSnapshot(projectRoot);
          assert.equal(
            workingTreeSnapshot.files.some((file) => file.path === stageTargetPath && file.staged),
            true,
          );
          return { background };
        }
        const [statusSnapshot] = await Promise.all([
          bridge.readGitStatusSnapshot(projectRoot),
          bridge.readGitWorkspaceSnapshot(projectRoot),
        ]);
        assert.equal(
          statusSnapshot.files.some((file) => file.path === stageTargetPath && file.staged),
          true,
        );
      },
    }),
    await measureScenario({
      name: "single-file unstage",
      uiRequestNote:
        reportTarget === "after"
          ? "UI/store model=1 action; foreground working-tree, workspace background"
          : "UI/store model=1 action; foreground status plus workspace",
      prepare: prepareUnstage,
      execute: async (bridge) => {
        const result = await bridge.unstageGitFile(projectRoot, stageTargetPath);
        assert.equal(result.ok, true);
        if (reportTarget === "after") {
          const background = bridge.readGitWorkspaceSnapshot(projectRoot);
          const workingTreeSnapshot = await bridge.readGitWorkingTreeSnapshot(projectRoot);
          assert.equal(
            workingTreeSnapshot.files.some((file) => file.path === stageTargetPath && !file.staged && file.unstaged),
            true,
          );
          return { background };
        }
        const [statusSnapshot] = await Promise.all([
          bridge.readGitStatusSnapshot(projectRoot),
          bridge.readGitWorkspaceSnapshot(projectRoot),
        ]);
        assert.equal(
          statusSnapshot.files.some((file) => file.path === stageTargetPath && !file.staged && file.unstaged),
          true,
        );
      },
    }),
  ];

  assertTooltipAfterBridgeCalls(scenarios);
  writeReport(fixture, scenarios);
  console.log("benchmark:git-interactions passed");
  if (isArchivedResearchDirectory) {
    console.log(
      reportTarget === "after"
        ? `Verified against archived baseline without persisting a report: ${path.relative(repoRoot, baselineReportPath)}`
        : "Archived task report was not persisted.",
    );
  } else {
    console.log(`Report: ${path.relative(repoRoot, reportPath)}`);
  }
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
