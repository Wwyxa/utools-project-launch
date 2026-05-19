const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { TextDecoder } = require("node:util");
const { shell } = require("electron");

const activeProcesses = new Map();
const userStoppedProcesses = new Set();
const storageKey = "utools-project-launch.projects.v1";
const projectDocPrefix = "utools-project-launch/project/";
const schemaVersion = 1;
const commonProjectDirs = [".", "frontend", "backend", "client", "server", "api"];

function createLegacyWindowsDecoder() {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    return new TextDecoder("gb18030");
  } catch (error) {
    return null;
  }
}

function createProcessOutputDecoder() {
  const utf8Decoder = new TextDecoder("utf-8");
  const legacyWindowsDecoder = createLegacyWindowsDecoder();

  return (chunk) => {
    const utf8Text = utf8Decoder.decode(chunk, { stream: true });
    if (!legacyWindowsDecoder || !utf8Text.includes("�")) {
      return utf8Text;
    }

    return legacyWindowsDecoder.decode(chunk, { stream: true });
  };
}

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

function logStorageError(action, error) {
  console.warn(`[utools-project-launch] ${action} failed`, error?.message || error);
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
      command: `npm run ${name}`,
      note: String(command),
      source: "package-json",
    }));

    return { scripts, packagePath };
  } catch (error) {
    return { scripts: [], packagePath };
  }
}

function toRelativeCwd(rootPath, targetPath) {
  const relativePath = path.relative(expandPath(rootPath), expandPath(targetPath));
  return relativePath ? relativePath.replace(/\\/g, "/") : ".";
}

function toStoredProject(project) {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    type: project.type,
    kind: project.kind,
    status: "STOPPED",
    description: project.description || "",
    lastUpdated: project.lastUpdated || "",
    scripts: Array.isArray(project.scripts)
      ? project.scripts.map((script) => ({
          id: script.id,
          name: script.name,
          command: script.command,
          cwd: script.cwd || ".",
          note: script.note || "",
          source: script.source || "manual",
          status: "IDLE",
        }))
      : [],
    env: project.env || {},
    branch: project.branch || "main",
    memo: project.memo || "",
    todos: Array.isArray(project.todos) ? project.todos : [],
    git: null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeLegacyStoredProjects(projects) {
  const payload = {
    schemaVersion,
    updatedAt: new Date().toISOString(),
    projects: projects.map(toStoredProject),
  };

  if (window.utools?.dbStorage) {
    window.utools.dbStorage.setItem(storageKey, payload);
    return;
  }
  window.localStorage?.setItem(storageKey, JSON.stringify(payload));
}

function detectNodeUnit(rootPath, targetPath) {
  const packageResult = readPackageScripts(targetPath);
  if (!packageResult.packagePath) {
    return [];
  }

  const cwd = toRelativeCwd(rootPath, targetPath);
  return packageResult.scripts.map((script) => ({
    name: cwd === "." ? script.name : `${cwd}:${script.name}`,
    command: script.command,
    cwd,
    note: `package.json: ${toRelativeCwd(rootPath, packageResult.packagePath)}`,
    source: "package-json",
  }));
}

function detectPythonUnit(rootPath, targetPath) {
  const resolvedPath = expandPath(targetPath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    return [];
  }

  const cwd = toRelativeCwd(rootPath, targetPath);
  const scripts = [];
  const entry = ["main.py", "app.py"].find((fileName) => fs.existsSync(path.join(resolvedPath, fileName)));
  const hasPythonFiles = fs.readdirSync(resolvedPath).some((fileName) => fileName.endsWith(".py"));
  const hasTests =
    fs.existsSync(path.join(resolvedPath, "tests")) || fs.existsSync(path.join(resolvedPath, "pytest.ini"));

  if (entry) {
    scripts.push({
      name: cwd === "." ? "run" : `${cwd}:run`,
      command: `python ${entry}`,
      cwd,
      note: `Python entry: ${entry}`,
      source: "preset",
    });
  } else if (hasPythonFiles) {
    scripts.push({
      name: cwd === "." ? "run" : `${cwd}:run`,
      command: "python app.py",
      cwd,
      note: "Python run suggestion",
      source: "preset",
    });
  }

  if (hasTests) {
    scripts.push({
      name: cwd === "." ? "test" : `${cwd}:test`,
      command: "pytest",
      cwd,
      note: "Python test suggestion",
      source: "preset",
    });
  }

  return scripts;
}

function readLegacyStoredProjects() {
  try {
    if (window.utools?.dbStorage) {
      const stored = window.utools.dbStorage.getItem(storageKey);
      return Array.isArray(stored?.projects) ? stored.projects : Array.isArray(stored) ? stored : [];
    }

    const raw = window.localStorage?.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch (error) {
    return [];
  }
}

function readProjectDocs() {
  if (!window.utools?.db?.allDocs) {
    return [];
  }

  const result = window.utools.db.allDocs(projectDocPrefix);
  const rows = Array.isArray(result)
    ? result
    : Array.isArray(result?.rows)
      ? result.rows
      : Array.isArray(result?.docs)
        ? result.docs
        : result && typeof result === "object"
          ? Object.values(result)
          : [];
  return rows
    .map((row) => {
      const summary = row?.doc || row?.value || row;
      const docId = summary?._id || row?._id || row?.id;
      if (summary?.project) {
        return summary;
      }
      if (typeof docId === "string" && window.utools?.db?.get) {
        const doc = window.utools.db.get(docId);
        return doc?.error ? null : doc;
      }
      return summary;
    })
    .filter((doc) => doc && typeof doc._id === "string" && doc._id.startsWith(projectDocPrefix));
}

function readStoredProjects() {
  try {
    const docs = readProjectDocs();
    if (docs.length > 0) {
      return docs.map((doc) => doc.project).filter(Boolean);
    }

    const legacyProjects = readLegacyStoredProjects();
    if (legacyProjects.length > 0 && window.utools?.db?.put) {
      writeStoredProjects(legacyProjects);
    }
    return legacyProjects;
  } catch (error) {
    logStorageError("read projects", error);
    return readLegacyStoredProjects();
  }
}

function writeStoredProjects(projects) {
  if (window.utools?.db?.put) {
    try {
      const existingDocs = readProjectDocs();
      const existingByProjectId = new Map(existingDocs.map((doc) => [doc._id.replace(projectDocPrefix, ""), doc]));
      const projectIds = new Set(projects.map((project) => project.id));

      projects.forEach((project) => {
        const existing = existingByProjectId.get(project.id);
        const doc = toPlainJson({
          _id: `${projectDocPrefix}${project.id}`,
          schemaVersion,
          updatedAt: new Date().toISOString(),
          project: toStoredProject(project),
        });
        if (existing?._rev) {
          doc._rev = existing._rev;
        }
        const result = window.utools.db.put(doc);
        if (result?.error) {
          throw new Error(result.message || String(result.error));
        }

        if (result?.ok && result.rev) {
          doc._rev = result.rev;
        }
      });

      existingDocs.forEach((doc) => {
        const projectId = doc._id.replace(projectDocPrefix, "");
        if (!projectIds.has(projectId) && window.utools?.db?.remove) {
          const result = window.utools.db.remove(doc);
          if (result?.error) {
            logStorageError(`remove project ${projectId}`, result.message || result.error);
          }
        }
      });
      return;
    } catch (error) {
      logStorageError("save projects to uTools db", error);
      writeLegacyStoredProjects(projects);
      return;
    }
  }

  writeLegacyStoredProjects(projects);
}

function pathExists(projectPath) {
  try {
    return Boolean(projectPath) && fs.existsSync(expandPath(projectPath));
  } catch (error) {
    return false;
  }
}

function inspectProjectPath(projectPath) {
  const resolvedPath = expandPath(projectPath);
  const exists = pathExists(projectPath);
  const result = {
    pathExists: exists,
    name: path.basename(resolvedPath),
    kind: "custom",
    type: "自定义",
    branch: "main",
    scripts: [],
    packagePath: null,
    git: null,
  };

  if (!exists) {
    return {
      ...result,
      message: "路径不存在或当前设备无法访问，可手动保存后稍后重新定位。",
    };
  }

  const detectedScripts = commonProjectDirs.flatMap((dirName) => {
    const targetPath = dirName === "." ? resolvedPath : path.join(resolvedPath, dirName);
    return [...detectNodeUnit(resolvedPath, targetPath), ...detectPythonUnit(resolvedPath, targetPath)];
  });

  const hasNode = detectedScripts.some((script) => script.source === "package-json");
  const hasPython = detectedScripts.some((script) => script.note?.includes("Python"));
  const packageResult = readPackageScripts(projectPath);
  if (hasNode) {
    result.kind = "node";
    result.type = "Node.js";
    result.packagePath = packageResult.packagePath;
  } else if (hasPython) {
    result.kind = "python";
    result.type = "Python";
  }

  result.scripts = detectedScripts;

  result.git = readGitSnapshot(projectPath);
  result.branch = result.git?.branch || "main";
  return result;
}

async function pickProjectPath() {
  if (!window.utools?.showOpenDialog) {
    return { canceled: true, message: "当前环境不支持系统文件夹选择器，请手动填写路径。" };
  }

  const selected = await window.utools.showOpenDialog({
    title: "选择项目目录",
    properties: ["openDirectory"],
  });
  const filePath = Array.isArray(selected) ? selected[0] : selected?.filePaths?.[0];
  return filePath ? { path: filePath } : { canceled: true };
}

async function exportProjects(config) {
  const defaultPath = path.join(os.homedir(), `utools-projects-${new Date().toISOString().slice(0, 10)}.json`);
  const selected = window.utools?.showSaveDialog
    ? await window.utools.showSaveDialog({
        title: "导出项目配置",
        defaultPath,
        filters: [{ name: "JSON", extensions: ["json"] }],
      })
    : defaultPath;
  const targetPath = typeof selected === "string" ? selected : selected?.filePath;

  if (!targetPath) {
    return { canceled: true };
  }

  fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), "utf8");
  return { path: targetPath };
}

async function importProjects() {
  const selected = window.utools?.showOpenDialog
    ? await window.utools.showOpenDialog({
        title: "导入项目配置",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      })
    : null;
  const filePath = Array.isArray(selected) ? selected[0] : selected?.filePaths?.[0];

  if (!filePath) {
    return { canceled: true };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed.schemaVersion !== schemaVersion || !Array.isArray(parsed.projects)) {
      return { canceled: true, message: "配置文件格式不受支持。" };
    }

    return { config: parsed };
  } catch (error) {
    return { canceled: true, message: "无法读取配置文件。" };
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
  const commitOutput = runGit(repositoryPath, [
    "log",
    "--all",
    "--graph",
    "--decorate=short",
    "--max-count=200",
    "--pretty=format:%h\t%P\t%an\t%ad\t%D\t%s",
    "--date=short",
  ]);
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
      const hashIndex = line.search(/[0-9a-f]{7,40}\t/);
      if (hashIndex < 0) {
        return;
      }

      const graph = line.slice(0, hashIndex).trimEnd();
      const [hash, parentText, author, date, refs, ...messageParts] = line.slice(hashIndex).split("\t");
      if (!hash) {
        return;
      }

      commits.push({
        hash,
        graph: graph || "*",
        parents: parentText ? parentText.split(" ").filter(Boolean) : [],
        author,
        date,
        refs,
        message: messageParts.join("\t"),
      });
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
  const decodeStdout = createProcessOutputDecoder();
  const decodeStderr = createProcessOutputDecoder();
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
      message: decodeStdout(chunk),
    });
  });

  child.stderr?.on("data", (chunk) => {
    emit({
      type: "stderr",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: child.pid,
      message: decodeStderr(chunk),
    });
  });

  child.on("close", (code, signal) => {
    activeProcesses.delete(child.pid);
    const stoppedByUser = userStoppedProcesses.delete(child.pid);
    emit({
      type: "exit",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: child.pid,
      code,
      signal,
      stoppedByUser,
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
    userStoppedProcesses.add(pid);
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

  if (!child) {
    userStoppedProcesses.delete(pid);
  }
}

window.projectBridge = {
  loadProjects: readStoredProjects,
  saveProjects: writeStoredProjects,
  inspectProjectPath,
  pickProjectPath,
  pathExists,
  exportProjects,
  importProjects,
  readPackageScripts,
  readGitSnapshot,
  runCommand,
  stopProcess,
  openPath: (targetPath) => shell.openPath(expandPath(targetPath)),
  showItemInFolder: (targetPath) => shell.showItemInFolder(expandPath(targetPath)),
};
