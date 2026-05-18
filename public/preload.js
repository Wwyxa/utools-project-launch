const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { shell } = require("electron");

const activeProcesses = new Map();

function expandPath(inputPath) {
  if (!inputPath) {
    return "";
  }

  if (inputPath.startsWith("~")) {
    return path.join(os.homedir(), inputPath.slice(1));
  }

  return path.resolve(inputPath);
}

function emit(detail) {
  window.dispatchEvent(new CustomEvent("project-bridge-event", { detail }));
}

function findGitRoot(startPath) {
  const resolvedPath = expandPath(startPath);

  try {
    const output = execFileSync("git", ["-C", resolvedPath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output.trim();
  } catch (error) {
    return null;
  }
}

function runGit(startPath, args) {
  const resolvedPath = expandPath(startPath);

  try {
    return execFileSync("git", ["-C", resolvedPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return null;
  }
}

function collectNumstat(startPath, args) {
  const output = runGit(startPath, args);
  if (!output) {
    return new Map();
  }

  const result = new Map();
  output.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) {
      return;
    }

    const [additions, deletions, ...rest] = line.split(/\t/);
    const filePath = rest.join("\t");
    result.set(filePath, {
      additions: additions === "-" ? 0 : Number(additions),
      deletions: deletions === "-" ? 0 : Number(deletions),
    });
  });

  return result;
}

function readPackageScripts(projectPath) {
  const resolvedPath = expandPath(projectPath);
  const packagePath = path.join(resolvedPath, "package.json");

  if (!fs.existsSync(packagePath)) {
    return { scripts: [], packagePath: null };
  }

  try {
    const raw = fs.readFileSync(packagePath, "utf8");
    const parsed = JSON.parse(raw);
    const scripts = Object.entries(parsed.scripts || {}).map(([name, command]) => ({
      name,
      command: String(command),
    }));

    return { scripts, packagePath };
  } catch (error) {
    return { scripts: [], packagePath };
  }
}

function readGitSnapshot(projectPath) {
  const repositoryPath = findGitRoot(projectPath);
  const now = new Date().toISOString();

  if (!repositoryPath) {
    return {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [],
      commits: [],
      repositoryPath: "",
      lastRefreshedAt: now,
      statusText: "未检测到 Git 仓库",
    };
  }

  const branchOutput = runGit(repositoryPath, ["status", "--short", "--branch"]);
  const statusOutput = runGit(repositoryPath, ["status", "--short"]);
  const commitOutput = runGit(repositoryPath, ["log", "-5", "--pretty=format:%h\t%an\t%ad\t%s", "--date=short"]);
  const numstatOutput = collectNumstat(repositoryPath, ["diff", "--numstat"]);
  const cachedNumstatOutput = collectNumstat(repositoryPath, ["diff", "--cached", "--numstat"]);
  const fileMap = new Map();

  if (statusOutput) {
    statusOutput.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) {
        return;
      }

      const statusCode = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const filePath = rawPath.includes("->") ? rawPath.split("->").pop().trim() : rawPath;
      const status =
        statusCode === "??"
          ? "UNTRACKED"
          : rawPath.includes("->")
            ? "RENAMED"
            : statusCode.includes("A")
              ? "ADDED"
              : statusCode.includes("D")
                ? "DELETED"
                : "MODIFIED";

      const additions = numstatOutput.get(filePath)?.additions ?? cachedNumstatOutput.get(filePath)?.additions ?? 0;
      const deletions = numstatOutput.get(filePath)?.deletions ?? cachedNumstatOutput.get(filePath)?.deletions ?? 0;

      fileMap.set(filePath, {
        path: filePath,
        additions,
        deletions,
        status,
      });
    });
  }

  const commits = [];
  if (commitOutput) {
    commitOutput.split(/\r?\n/).forEach((line) => {
      const [hash, author, date, message] = line.split(/\t/);
      if (!hash) {
        return;
      }

      commits.push({ hash, author, date, message });
    });
  }

  const branchLine = branchOutput ? branchOutput.split(/\r?\n/)[0] : "";
  const branchMatch = branchLine.match(/^##\s+([^\.\s]+)(?:\.\.\.(?:[^\s]+))?(?:\s+\[(.+)\])?/);
  const branch = branchMatch?.[1] || "main";
  const upstreamInfo = branchMatch?.[2] || "";
  const aheadMatch = upstreamInfo.match(/ahead\s+(\d+)/);
  const behindMatch = upstreamInfo.match(/behind\s+(\d+)/);

  return {
    branch,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    files: Array.from(fileMap.values()),
    commits,
    repositoryPath,
    lastRefreshedAt: now,
    statusText: fileMap.size === 0 ? "工作区干净" : `${fileMap.size} 个文件变更`,
  };
}

function runCommand(payload) {
  const resolvedCwd = expandPath(payload.cwd);
  const child = spawn(payload.command, {
    cwd: resolvedCwd,
    env: { ...process.env, ...payload.env },
    shell: true,
    windowsHide: true,
  });

  activeProcesses.set(child.pid, child);

  emit({
    type: "started",
    projectId: payload.projectId,
    scriptId: payload.scriptId,
    pid: child.pid,
    message: payload.command,
  });

  child.stdout?.on("data", (chunk) => {
    emit({
      type: "stdout",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: child.pid,
      message: String(chunk),
    });
  });

  child.stderr?.on("data", (chunk) => {
    emit({
      type: "stderr",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: child.pid,
      message: String(chunk),
    });
  });

  child.on("close", (code, signal) => {
    activeProcesses.delete(child.pid);
    emit({
      type: "exit",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: child.pid,
      code,
      signal,
    });
  });

  return {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    command: payload.command,
    cwd: resolvedCwd,
  };
}

function stopProcess(pid) {
  const child = activeProcesses.get(pid);

  if (child && !child.killed) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        // ignore
      }
    }
  }

  activeProcesses.delete(pid);
}

window.projectBridge = {
  readPackageScripts,
  readGitSnapshot,
  runCommand,
  stopProcess,
  openPath: (targetPath) => shell.openPath(expandPath(targetPath)),
  showItemInFolder: (targetPath) => shell.showItemInFolder(expandPath(targetPath)),
};
