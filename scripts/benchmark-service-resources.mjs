import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const usage = `Usage:
  npm run benchmark:service-resources -- --label <scenario> --pid <pid> [options]

Options:
  --pid <pid>                    Repeat for every measured process.
  --duration <seconds>           Sampling duration. Default: 60.
  --interval <milliseconds>      Sampling interval. Default: 1000.
  --service-log-dir <path>       Include retained log file count and bytes.
  --counter <name=value>         Include a manually observed scenario counter.
  --output <path>                Write the JSON report to a file.
  --help                         Show this help text.

Example:
  npm run benchmark:service-resources -- --label service-on-idle --pid 1234 --pid 5678 --duration 60 --service-log-dir "$env:USERPROFILE\\.utools-project-launch\\service\\logs" --output .\\artifacts\\service-on-idle.json`;

function valueAfter(argumentsList, index, option) {
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function positiveInteger(value, option, allowZero = false) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(`${option} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
  }
  return parsed;
}

function positiveNumber(value, option, allowZero = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < (allowZero ? 0 : Number.EPSILON)) {
    throw new Error(`${option} must be ${allowZero ? "a non-negative" : "a positive"} number.`);
  }
  return parsed;
}

function parseCounter(value) {
  const match = String(value).match(/^([A-Za-z][A-Za-z0-9_.-]*)=([0-9]+(?:\.[0-9]+)?)$/);
  if (!match) {
    throw new Error("--counter must use name=value with a non-negative numeric value.");
  }
  return { name: match[1], value: Number(match[2]) };
}

function parseArguments(argumentsList) {
  const options = {
    label: "",
    pids: [],
    durationSeconds: 60,
    intervalMilliseconds: 1000,
    serviceLogDirectory: "",
    counters: {},
    outputPath: "",
    help: false,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    switch (argument) {
      case "--help":
        options.help = true;
        break;
      case "--label":
        options.label = valueAfter(argumentsList, index, argument).trim();
        index += 1;
        break;
      case "--pid":
        options.pids.push(positiveInteger(valueAfter(argumentsList, index, argument), argument));
        index += 1;
        break;
      case "--duration":
        options.durationSeconds = positiveNumber(valueAfter(argumentsList, index, argument), argument, true);
        index += 1;
        break;
      case "--interval":
        options.intervalMilliseconds = positiveInteger(valueAfter(argumentsList, index, argument), argument);
        index += 1;
        break;
      case "--service-log-dir":
        options.serviceLogDirectory = valueAfter(argumentsList, index, argument);
        index += 1;
        break;
      case "--counter": {
        const counter = parseCounter(valueAfter(argumentsList, index, argument));
        options.counters[counter.name] = counter.value;
        index += 1;
        break;
      }
      case "--output":
        options.outputPath = valueAfter(argumentsList, index, argument);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  options.pids = [...new Set(options.pids)];
  if (!options.help && !options.label) throw new Error("--label is required.");
  if (!options.help && options.pids.length === 0) throw new Error("At least one --pid is required.");
  return options;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function windowsPowerShellPath() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  return systemRoot
    ? path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

function readWindowsProcesses(pids) {
  const command = `$ErrorActionPreference = 'SilentlyContinue'; $processIds = @(${pids.join(",")}); Get-Process -Id $processIds -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, WorkingSet64, PrivateMemorySize64, CPU | ConvertTo-Json -Compress`;
  const output = execFileSync(
    windowsPowerShellPath(),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  ).trim();
  if (!output) return [];
  const payload = JSON.parse(output);
  const rows = Array.isArray(payload) ? payload : [payload];
  return rows
    .map((row) => ({
      pid: Number(row.Id),
      name: String(row.ProcessName || "unknown"),
      rssBytes: Number(row.WorkingSet64) || 0,
      privateBytes: Number(row.PrivateMemorySize64) || 0,
      cpuSeconds: Number(row.CPU) || 0,
    }))
    .filter((row) => Number.isSafeInteger(row.pid) && row.pid > 0);
}

function readLogUsage(directoryPath) {
  if (!directoryPath) return undefined;
  const summary = { path: path.resolve(directoryPath), available: true, fileCount: 0, totalBytes: 0 };
  const directories = [summary.path];
  try {
    while (directories.length > 0) {
      const currentDirectory = directories.pop();
      if (!currentDirectory) continue;
      for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
        const entryPath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
          directories.push(entryPath);
        } else if (entry.isFile()) {
          summary.fileCount += 1;
          summary.totalBytes += statSync(entryPath).size;
        }
      }
    }
  } catch (error) {
    return { ...summary, available: false, error: error instanceof Error ? error.message : String(error) };
  }
  return summary;
}

function sampledProcess(row, expectedPid) {
  return row || { pid: expectedPid, name: "", rssBytes: 0, privateBytes: 0, cpuSeconds: 0, unavailable: true };
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function aggregateSample(processes) {
  return processes.reduce(
    (total, process) => ({
      rssBytes: total.rssBytes + process.rssBytes,
      privateBytes: total.privateBytes + process.privateBytes,
      cpuSeconds: total.cpuSeconds + process.cpuSeconds,
    }),
    { rssBytes: 0, privateBytes: 0, cpuSeconds: 0 },
  );
}

function summarizeProcess(pid, samples) {
  const observations = samples.map((sample) => sample.processes.find((process) => process.pid === pid)).filter(Boolean);
  const available = observations.filter((process) => !process.unavailable);
  if (available.length === 0) return { pid, availableSamples: 0, missingSamples: samples.length };
  const first = available[0];
  const last = available.at(-1);
  const elapsedMilliseconds = Math.max(1, samples.at(-1).elapsedMilliseconds - samples[0].elapsedMilliseconds);
  const cpuDeltaSeconds = Math.max(0, last.cpuSeconds - first.cpuSeconds);
  return {
    pid,
    name: last.name,
    availableSamples: available.length,
    missingSamples: samples.length - available.length,
    rssBytes: {
      initial: first.rssBytes,
      final: last.rssBytes,
      average: Math.round(average(available.map((process) => process.rssBytes))),
      peak: Math.max(...available.map((process) => process.rssBytes)),
    },
    privateBytes: {
      initial: first.privateBytes,
      final: last.privateBytes,
      average: Math.round(average(available.map((process) => process.privateBytes))),
      peak: Math.max(...available.map((process) => process.privateBytes)),
    },
    cpu: {
      initialSeconds: first.cpuSeconds,
      finalSeconds: last.cpuSeconds,
      deltaSeconds: cpuDeltaSeconds,
      percentOfOneCore: Number(((cpuDeltaSeconds * 1000 * 100) / elapsedMilliseconds).toFixed(2)),
    },
  };
}

function summarizeAggregate(samples) {
  const totals = samples.map((sample) => aggregateSample(sample.processes));
  const first = totals[0];
  const last = totals.at(-1);
  const elapsedMilliseconds = Math.max(1, samples.at(-1).elapsedMilliseconds - samples[0].elapsedMilliseconds);
  const cpuDeltaSeconds = Math.max(0, last.cpuSeconds - first.cpuSeconds);
  return {
    rssBytes: {
      initial: first.rssBytes,
      final: last.rssBytes,
      average: Math.round(average(totals.map((total) => total.rssBytes))),
      peak: Math.max(...totals.map((total) => total.rssBytes)),
    },
    privateBytes: {
      initial: first.privateBytes,
      final: last.privateBytes,
      average: Math.round(average(totals.map((total) => total.privateBytes))),
      peak: Math.max(...totals.map((total) => total.privateBytes)),
    },
    cpu: {
      deltaSeconds: cpuDeltaSeconds,
      percentOfOneCore: Number(((cpuDeltaSeconds * 1000 * 100) / elapsedMilliseconds).toFixed(2)),
    },
  };
}

async function sampleScenario(options) {
  const startedAt = new Date().toISOString();
  const startedAtPerformance = performance.now();
  const samples = [];
  const takeSample = () => {
    const rowsByPid = new Map(readWindowsProcesses(options.pids).map((row) => [row.pid, row]));
    samples.push({
      elapsedMilliseconds: Math.round(performance.now() - startedAtPerformance),
      processes: options.pids.map((pid) => sampledProcess(rowsByPid.get(pid), pid)),
    });
  };

  takeSample();
  const durationMilliseconds = Math.round(options.durationSeconds * 1000);
  while (performance.now() - startedAtPerformance < durationMilliseconds) {
    const remainingMilliseconds = durationMilliseconds - (performance.now() - startedAtPerformance);
    await wait(Math.min(options.intervalMilliseconds, Math.max(1, remainingMilliseconds)));
    takeSample();
  }

  return {
    schemaVersion: 1,
    label: options.label,
    startedAt,
    completedAt: new Date().toISOString(),
    platform: process.platform,
    logicalCpuCount: os.cpus().length,
    requestedDurationSeconds: options.durationSeconds,
    actualDurationMilliseconds: samples.at(-1).elapsedMilliseconds,
    sampleIntervalMilliseconds: options.intervalMilliseconds,
    counters: options.counters,
    serviceLogUsage: readLogUsage(options.serviceLogDirectory),
    aggregate: summarizeAggregate(samples),
    processes: options.pids.map((pid) => summarizeProcess(pid, samples)),
    samples,
  };
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  console.log(usage);
} else {
  if (process.platform !== "win32") {
    throw new Error(
      "This benchmark currently supports Windows because it samples private process memory through PowerShell.",
    );
  }
  const report = await sampleScenario(options);
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath) {
    const outputPath = path.resolve(options.outputPath);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serializedReport, "utf8");
    console.log(`Wrote resource benchmark report to ${outputPath}`);
  }
  console.log(serializedReport);
}
