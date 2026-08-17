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
      env: resolveGitExecutionEnvironment(),
    });
    return output.trim();
  } catch (error) {
    return null;
  }
}

function findGitRootAsync(startPath) {
  const resolvedPath = expandPath(startPath);

  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", resolvedPath, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", env: resolveGitExecutionEnvironment(), windowsHide: true },
      (error, stdout) => {
        resolve(error ? null : String(stdout || "").trim());
      },
    );
  });
}

function createGitReadFailure(operation, result, fallback) {
  const detail = String(result.stderr || result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const normalizedDetail = String(result.stderr || result.stdout || "").toLowerCase();
  const normalizedErrorCode = String(result.errorCode || "").toLowerCase();
  const code =
    normalizedErrorCode === "enoent" ||
    normalizedDetail.includes("enoent") ||
    normalizedDetail.includes("not recognized as an internal or external command")
      ? "git-unavailable"
      : normalizedDetail.includes("not a git repository") ||
          normalizedDetail.includes("does not appear to be a git repository")
        ? "not-a-repository"
        : "command-failed";

  return {
    code,
    operation,
    message:
      code === "git-unavailable"
        ? "未找到 Git 可执行文件，请检查 Git 安装或 PATH。"
        : code === "not-a-repository"
          ? "未检测到 Git 仓库。"
          : `${fallback}${detail ? `：${detail}` : ""}`,
    ...(typeof result.exitCode === "number" ? { exitCode: result.exitCode } : {}),
  };
}

async function findGitRootAsyncResult(startPath) {
  const result = await runGitAsyncResult(startPath, ["rev-parse", "--show-toplevel"]);
  if (!result.ok) {
    return { ok: false, failure: createGitReadFailure("repository", result, "无法定位 Git 仓库") };
  }

  const repositoryPath = result.stdout.trim();
  if (!repositoryPath) {
    return {
      ok: false,
      failure: {
        code: "invalid-output",
        operation: "repository",
        message: "Git 未返回有效的仓库路径。",
        exitCode: result.exitCode,
      },
    };
  }

  return { ok: true, repositoryPath };
}

function createEmptyGitStatusSnapshot(repositoryPath, now, statusText) {
  return {
    branch: "main",
    headHash: "",
    isDetachedHead: false,
    ahead: 0,
    behind: 0,
    files: [],
    branches: [],
    remotes: [],
    remoteBranches: [],
    upstream: null,
    base: null,
    repositoryPath,
    lastRefreshedAt: now,
    statusText,
  };
}

function createEmptyGitCommitPage(repositoryPath, now) {
  return {
    commits: [],
    commitCount: 0,
    hasMoreCommits: false,
    nextCommitSkip: 0,
    repositoryPath,
    lastRefreshedAt: now,
  };
}

function combineGitSnapshot(statusSnapshot, commitPage) {
  return {
    ...statusSnapshot,
    commits: commitPage.commits,
    commitCount: commitPage.commitCount,
    hasMoreCommits: commitPage.hasMoreCommits,
    nextCommitSkip: commitPage.nextCommitSkip,
    repositoryPath: statusSnapshot.repositoryPath || commitPage.repositoryPath,
    lastRefreshedAt: statusSnapshot.lastRefreshedAt || commitPage.lastRefreshedAt,
  };
}

function runGit(startPath, args) {
  const resolvedPath = expandPath(startPath);

  try {
    return execFileSync("git", ["-C", resolvedPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: resolveGitExecutionEnvironment(),
    });
  } catch (error) {
    return null;
  }
}

function runGitAsync(startPath, args) {
  const resolvedPath = expandPath(startPath);

  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", resolvedPath, ...args],
      { encoding: "utf8", env: resolveGitExecutionEnvironment(), windowsHide: true },
      (error, stdout) => {
        resolve(error ? null : String(stdout || ""));
      },
    );
  });
}

function runGitAsyncResult(startPath, args) {
  const resolvedPath = expandPath(startPath);

  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", resolvedPath, ...args],
      { encoding: "utf8", env: resolveGitExecutionEnvironment(), windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout || ""),
          stderr: String(stderr || error?.message || ""),
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          errorCode: error?.code,
        });
      },
    );
  });
}

function runGitDiff(startPath, args) {
  const resolvedPath = expandPath(startPath);

  try {
    return execFileSync("git", ["-C", resolvedPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: resolveGitExecutionEnvironment(),
    });
  } catch (error) {
    return error?.stdout ? String(error.stdout) : null;
  }
}

function runGitResult(startPath, args) {
  const resolvedPath = expandPath(startPath);
  const result = spawnSync("git", ["-C", resolvedPath, ...args], {
    encoding: "utf8",
    env: resolveGitExecutionEnvironment(),
    windowsHide: true,
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || result.error?.message || ""),
  };
}

function runGitRemoteCommandResult(startPath, args) {
  const resolvedPath = expandPath(startPath);

  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", resolvedPath, ...args],
      {
        encoding: "utf8",
        env: { ...resolveGitExecutionEnvironment(), GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
        timeout: 120000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const status = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        const timeoutMessage = error?.killed ? "远程 Git 操作超时，请检查网络或认证配置。" : "";
        resolve({
          status,
          stdout: String(stdout || ""),
          stderr: String(stderr || timeoutMessage || error?.message || ""),
        });
      },
    );
  });
}

function runGitWorkspaceCommand(startPath, args, options = {}) {
  const resolvedPath = expandPath(startPath);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || gitWorkspaceEntryTimeoutMs);
  const executable = options.executable || "git";
  const stdoutRecordHandler = typeof options.stdoutRecordHandler === "function" ? options.stdoutRecordHandler : null;
  const commandArgs = options.executable
    ? Array.isArray(options.commandArgs)
      ? options.commandArgs
      : []
    : ["-C", resolvedPath, ...args];

  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutDecoder = stdoutRecordHandler ? new TextDecoder() : null;
    let stdoutRecordRemainder = "";
    let stderrLength = 0;
    let timedOut = false;
    let settled = false;
    let spawnError = null;
    const child = spawn(executable, commandArgs, {
      env: { ...resolveGitExecutionEnvironment(), GIT_OPTIONAL_LOCKS: "0" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const emitStdoutRecords = (text, flush = false) => {
      stdoutRecordRemainder += text;
      let separator = stdoutRecordRemainder.indexOf("\0");
      while (separator >= 0) {
        stdoutRecordHandler(stdoutRecordRemainder.slice(0, separator));
        stdoutRecordRemainder = stdoutRecordRemainder.slice(separator + 1);
        separator = stdoutRecordRemainder.indexOf("\0");
      }
      if (flush && stdoutRecordRemainder) {
        stdoutRecordHandler(stdoutRecordRemainder);
        stdoutRecordRemainder = "";
      }
    };
    child.stdout?.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      if (stdoutRecordHandler && stdoutDecoder) {
        emitStdoutRecords(stdoutDecoder.decode(buffer, { stream: true }));
      } else {
        stdoutChunks.push(buffer);
      }
    });
    child.stderr?.on("data", (chunk) => {
      if (stderrLength >= gitWorkspaceStderrLimit) return;
      const buffer = Buffer.from(chunk);
      const remaining = gitWorkspaceStderrLimit - stderrLength;
      stderrChunks.push(buffer.subarray(0, remaining));
      stderrLength += Math.min(buffer.length, remaining);
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutRecordHandler && stdoutDecoder) {
        emitStdoutRecords(stdoutDecoder.decode(), true);
      }
      resolve({
        status: timedOut || spawnError ? 1 : typeof code === "number" ? code : 0,
        signal: signal || null,
        stdout: new TextDecoder().decode(Buffer.concat(stdoutChunks)),
        stderr: new TextDecoder().decode(Buffer.concat(stderrChunks)).trim(),
        timedOut,
        spawnError,
      });
    });
  });
}

function gitWorkspaceFailure(operation, result, fallbackMessage, fallbackCode = "command-failed") {
  if (result?.timedOut) {
    return { code: "timeout", operation, message: "Git 读取超时。" };
  }
  if (result?.spawnError?.code === "ENOENT") {
    return { code: "git-unavailable", operation, message: "未找到 Git 可执行文件。" };
  }
  if (result?.spawnError?.code === "EACCES" || result?.spawnError?.code === "EPERM") {
    return { code: "permission-denied", operation, message: "没有权限读取该 Git 路径。" };
  }
  const failure = {
    code: fallbackCode,
    operation,
    message: String(result?.stderr || fallbackMessage || "Git 读取失败。").slice(0, gitWorkspaceStderrLimit),
  };
  if (typeof result?.status === "number") failure.exitCode = result.status;
  return failure;
}

function isGitWorkspaceObjectId(value, objectFormat) {
  const length = objectFormat === "sha256" ? 64 : objectFormat === "sha1" ? 40 : 0;
  const normalized = String(value || "").toLowerCase();
  return length > 0 && !/^0+$/.test(normalized) && new RegExp(`^[0-9a-f]{${length}}$`).test(normalized);
}

function normalizeGitWorkspaceObjectId(value, objectFormat) {
  const normalized = String(value || "").toLowerCase();
  return isGitWorkspaceObjectId(normalized, objectFormat) ? normalized : null;
}

function parseGitWorktreePorcelain(output, objectFormat) {
  const entries = [];
  let current = null;

  const finish = () => {
    if (!current?.path) return;
    const oid = normalizeGitWorkspaceObjectId(current.headValue, objectFormat);
    const branchRef = current.branch || null;
    const branchName = branchRef?.startsWith("refs/heads/") ? branchRef.slice("refs/heads/".length) : branchRef;
    const kind = current.bare ? "bare" : entries.length > 0 ? "linked" : "main";
    const headKind = current.bare
      ? "bare"
      : current.detached
        ? "detached"
        : !oid && branchRef
          ? "unborn"
          : branchRef
            ? "branch"
            : oid
              ? "detached"
              : "unknown";
    entries.push({
      kind,
      path: current.path,
      head: { kind: headKind, ref: branchRef, name: branchName || null, oid },
      locked: current.locked,
      lockReason: current.lockReason,
      prunable: current.prunable,
      prunableReason: current.prunableReason,
    });
    current = null;
  };

  for (const field of String(output || "").split("\0")) {
    if (!field) {
      finish();
      continue;
    }
    const separator = field.indexOf(" ");
    const key = separator < 0 ? field : field.slice(0, separator);
    const value = separator < 0 ? "" : field.slice(separator + 1);
    if (key === "worktree") {
      finish();
      current = {
        path: value,
        headValue: "",
        branch: null,
        bare: false,
        detached: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
      };
      continue;
    }
    if (!current) continue;
    if (key === "HEAD") current.headValue = value;
    else if (key === "branch") current.branch = value;
    else if (key === "bare") current.bare = true;
    else if (key === "detached") current.detached = true;
    else if (key === "locked") {
      current.locked = true;
      current.lockReason = value || null;
    } else if (key === "prunable") {
      current.prunable = true;
      current.prunableReason = value || null;
    }
  }
  finish();
  return entries;
}

function createGitWorkspaceStatusParser(objectFormat) {
  const counts = { stagedEntries: 0, unstagedEntries: 0, untrackedEntries: 0, conflictedEntries: 0 };
  let branchOid = null;
  let branchOidInitial = false;
  let branchHead = null;
  let upstreamRef = null;
  let divergence = null;
  let consumeTypeTwoPath = false;

  const consume = (record) => {
    if (consumeTypeTwoPath) {
      consumeTypeTwoPath = false;
      return;
    }
    if (!record) return;
    if (record.startsWith("# branch.oid ")) {
      const value = record.slice("# branch.oid ".length);
      branchOidInitial = value === "(initial)";
      branchOid = branchOidInitial ? null : normalizeGitWorkspaceObjectId(value, objectFormat);
      return;
    }
    if (record.startsWith("# branch.head ")) {
      branchHead = record.slice("# branch.head ".length);
      return;
    }
    if (record.startsWith("# branch.upstream ")) {
      upstreamRef = record.slice("# branch.upstream ".length) || null;
      return;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = record.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (match) divergence = { ahead: Number(match[1]), behind: Number(match[2]) };
      return;
    }
    const kind = record[0];
    if (kind === "1" || kind === "2") {
      const statusCode = record.split(" ", 3)[1] || "..";
      if (statusCode[0] && statusCode[0] !== ".") counts.stagedEntries += 1;
      if (statusCode[1] && statusCode[1] !== ".") counts.unstagedEntries += 1;
      if (kind === "2") consumeTypeTwoPath = true;
    } else if (kind === "u") {
      counts.conflictedEntries += 1;
    } else if (kind === "?") {
      counts.untrackedEntries += 1;
    }
  };

  const result = () => {
    const detached = branchHead === "(detached)";
    const head = {
      kind: branchOidInitial
        ? "unborn"
        : detached
          ? "detached"
          : branchHead
            ? "branch"
            : branchOid
              ? "detached"
              : "unknown",
      ref: branchHead && !detached ? `refs/heads/${branchHead}` : null,
      name: branchHead && !detached ? branchHead : null,
      oid: branchOid,
    };
    return {
      head,
      status: {
        ...counts,
        upstream: upstreamRef && divergence ? { ref: upstreamRef, ...divergence } : null,
      },
    };
  };
  return { consume, result };
}

function parseGitWorkspaceStatus(output, objectFormat) {
  const parser = createGitWorkspaceStatusParser(objectFormat);
  String(output || "")
    .split("\0")
    .forEach(parser.consume);
  return parser.result();
}

function parseGitWorkspaceConfig(output) {
  const records = new Map();
  let invalid = false;
  for (const record of String(output || "").split("\0")) {
    if (!record) continue;
    const separator = record.indexOf("\n");
    if (separator < 0) {
      invalid = true;
      continue;
    }
    const key = record.slice(0, separator);
    const value = record.slice(separator + 1);
    if (!key.startsWith("submodule.")) continue;
    const suffix = [".path", ".url", ".branch"].find((candidate) => key.endsWith(candidate));
    if (!suffix) continue;
    const name = key.slice("submodule.".length, -suffix.length);
    if (!name) {
      invalid = true;
      continue;
    }
    const item = records.get(name) || { name, path: null, url: null, branch: null };
    item[suffix.slice(1)] = value;
    records.set(name, item);
  }
  return { records, invalid };
}

function createGitWorkspaceIndexParser(objectFormat = null, includedPaths = null) {
  const entries = [];
  let invalid = false;
  const consume = (record) => {
    if (!record) return;
    const match = record.match(/^(\d{6}) ([0-9a-fA-F]+) ([0-3])\t([\s\S]+)$/);
    if (!match) {
      invalid = true;
      return;
    }
    const oid = match[2].toLowerCase();
    if (objectFormat && !isGitWorkspaceObjectId(oid, objectFormat)) {
      invalid = true;
      return;
    }
    if (includedPaths && match[1] !== "160000" && !includedPaths.has(match[4])) return;
    entries.push({ mode: match[1], oid, stage: Number(match[3]), path: match[4] });
  };
  return { consume, result: () => ({ entries, invalid }) };
}

function parseGitWorkspaceIndex(output, objectFormat = null) {
  const parser = createGitWorkspaceIndexParser(objectFormat);
  String(output || "")
    .split("\0")
    .forEach(parser.consume);
  return parser.result();
}

async function runGitWorkspaceWorkerPool(tasks) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(gitWorkspaceWorkerLimit, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const taskIndex = nextIndex;
      nextIndex += 1;
      await tasks[taskIndex]();
    }
  });
  await Promise.all(workers);
}

function gitWorkspaceDirectoryAvailable(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch (error) {
    return false;
  }
}

function gitWorkspacePathsEqual(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value || "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function resolveGitWorkspaceChildPath(repositoryPath, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const targetPath = path.resolve(repositoryPath, relativePath);
  const relation = path.relative(repositoryPath, targetPath);
  return relation && relation !== ".." && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation)
    ? targetPath
    : null;
}

async function probeGitWorkspaceRepository(projectPath) {
  const bareResult = await runGitWorkspaceCommand(projectPath, ["rev-parse", "--is-bare-repository"]);
  if (bareResult.status !== 0) {
    const code = bareResult.spawnError?.code === "ENOENT" ? "git-unavailable" : "not-a-repository";
    return { failure: gitWorkspaceFailure("repository", bareResult, "未检测到 Git 仓库。", code) };
  }
  const bareText = bareResult.stdout.trim();
  if (bareText !== "true" && bareText !== "false") {
    return {
      failure: { code: "invalid-output", operation: "repository", message: "Git 返回了无法识别的仓库类型。" },
    };
  }

  const [gitDirResult, formatResult] = await Promise.all([
    runGitWorkspaceCommand(projectPath, ["rev-parse", "--absolute-git-dir"]),
    runGitWorkspaceCommand(projectPath, ["rev-parse", "--show-object-format=storage"]),
  ]);
  if (gitDirResult.status !== 0 || !gitDirResult.stdout.trim()) {
    return {
      failure: gitWorkspaceFailure("repository", gitDirResult, "无法解析 Git 目录。", "unsupported-output"),
    };
  }
  const objectFormat = formatResult.stdout.trim();
  if (formatResult.status !== 0 || (objectFormat !== "sha1" && objectFormat !== "sha256")) {
    return {
      failure: gitWorkspaceFailure("repository", formatResult, "当前 Git 不支持对象格式探测。", "unsupported-output"),
    };
  }

  const bare = bareText === "true";
  if (bare) {
    return { repositoryPath: path.resolve(gitDirResult.stdout.trim()), objectFormat, bare, failure: null };
  }
  const rootResult = await runGitWorkspaceCommand(projectPath, ["rev-parse", "--show-toplevel"]);
  if (rootResult.status !== 0 || !rootResult.stdout.trim()) {
    return { failure: gitWorkspaceFailure("repository", rootResult, "无法解析仓库根目录。", "invalid-output") };
  }
  return { repositoryPath: path.resolve(rootResult.stdout.trim()), objectFormat, bare, failure: null };
}

async function enumerateGitWorkspaceWorktrees(repository) {
  const result = await runGitWorkspaceCommand(repository.repositoryPath, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
    "--expire=now",
  ]);
  if (result.status !== 0) {
    return {
      entries: [],
      failure: gitWorkspaceFailure("worktree-list", result, "无法读取 linked worktrees。", "unsupported-output"),
      jobs: [],
      unavailable: true,
    };
  }
  const parsed = parseGitWorktreePorcelain(result.stdout, repository.objectFormat);
  if (!parsed.length) {
    return {
      entries: [],
      failure: { code: "invalid-output", operation: "worktree-list", message: "Git 未返回 worktree 记录。" },
      jobs: [],
      unavailable: true,
    };
  }

  const entries = parsed.map((entry) => {
    const pathAvailable = gitWorkspaceDirectoryAvailable(entry.path);
    return {
      ...entry,
      pathAvailable,
      objectFormat: repository.objectFormat,
      status: null,
      failure:
        !pathAvailable && entry.kind !== "bare"
          ? { code: "path-unavailable", operation: "worktree-status", message: "Worktree 路径当前不可访问。" }
          : null,
    };
  });
  const jobs = entries
    .filter((entry) => entry.kind !== "bare" && entry.pathAvailable)
    .map((entry) => async () => {
      const entryDeadline = Date.now() + gitWorkspaceEntryTimeoutMs;
      const statusParser = createGitWorkspaceStatusParser(repository.objectFormat);
      const statusResult = await runGitWorkspaceCommand(
        entry.path,
        [
          "--no-optional-locks",
          "status",
          "--porcelain=v2",
          "--branch",
          "--ahead-behind",
          "--untracked-files=normal",
          "-z",
        ],
        {
          timeoutMs: Math.max(1, entryDeadline - Date.now()),
          stdoutRecordHandler: statusParser.consume,
        },
      );
      if (statusResult.status !== 0) {
        entry.failure = gitWorkspaceFailure("worktree-status", statusResult, "无法读取 worktree 状态。");
        return;
      }
      const parsedStatus = statusParser.result();
      entry.status = parsedStatus.status;
      entry.head = parsedStatus.head.kind === "unknown" ? entry.head : parsedStatus.head;
    });
  return { entries, failure: null, jobs, unavailable: false };
}

async function enumerateGitWorkspaceSubmodules(repository) {
  if (repository.bare) {
    return {
      entries: [],
      failure: { code: "path-unavailable", operation: "submodule-config", message: "裸仓库没有可读取的工作树。" },
      jobs: [],
      unavailable: true,
    };
  }

  const gitmodulesPath = path.join(repository.repositoryPath, ".gitmodules");
  const declaredPromise = fs.existsSync(gitmodulesPath)
    ? runGitWorkspaceCommand(repository.repositoryPath, [
        "config",
        "--null",
        "--file",
        ".gitmodules",
        "--get-regexp",
        "^submodule\\..*\\.(path|url|branch)$",
      ])
    : Promise.resolve({ status: 1, stdout: "", stderr: "", timedOut: false, spawnError: null });
  const [declaredResult, localResult] = await Promise.all([
    declaredPromise,
    runGitWorkspaceCommand(repository.repositoryPath, [
      "config",
      "--local",
      "--null",
      "--get-regexp",
      "^submodule\\..*\\.(url|branch)$",
    ]),
  ]);

  const declaredFailed = fs.existsSync(gitmodulesPath) && declaredResult.status !== 0 && declaredResult.status !== 1;
  const localFailed = localResult.status !== 0 && localResult.status !== 1;
  const declared = parseGitWorkspaceConfig(declaredResult.stdout);
  const local = parseGitWorkspaceConfig(localResult.stdout);
  const configuredIndexPaths = new Set(
    [...declared.records.values()].map((record) => record.path).filter((configuredPath) => configuredPath),
  );
  const indexParser = createGitWorkspaceIndexParser(repository.objectFormat, configuredIndexPaths);
  const indexResult = await runGitWorkspaceCommand(
    repository.repositoryPath,
    ["ls-files", "--stage", "--full-name", "-z"],
    { stdoutRecordHandler: indexParser.consume },
  );
  const indexFailed = indexResult.status !== 0;
  const index = indexParser.result();
  const declaredIncomplete = [...declared.records.values()].some((record) => !record.path || !record.url);
  const sourceFailure = declaredFailed
    ? gitWorkspaceFailure("submodule-config", declaredResult, "无法读取 .gitmodules。")
    : localFailed
      ? gitWorkspaceFailure("submodule-registration", localResult, "无法读取本地 submodule 配置。")
      : indexFailed
        ? gitWorkspaceFailure("submodule-index", indexResult, "无法读取 submodule gitlink。")
        : declared.invalid || declaredIncomplete || local.invalid || index.invalid
          ? { code: "invalid-output", operation: "submodule-config", message: "部分 submodule 元数据无法解析。" }
          : null;

  if (indexFailed && declared.records.size === 0) {
    return { entries: [], failure: sourceFailure, jobs: [], unavailable: true };
  }

  const indexByPath = new Map();
  for (const item of index.entries) {
    const list = indexByPath.get(item.path) || [];
    list.push(item);
    indexByPath.set(item.path, list);
  }
  const descriptors = [];
  const configuredPaths = new Set();
  for (const config of declared.records.values()) {
    if (!config.path) continue;
    descriptors.push({ name: config.name, path: config.path, declared: config });
    configuredPaths.add(config.path);
  }
  for (const [indexPath, stages] of indexByPath) {
    if (!configuredPaths.has(indexPath) && stages.some((stage) => stage.mode === "160000")) {
      descriptors.push({ name: null, path: indexPath, declared: null });
    }
  }

  const entries = descriptors.map((descriptor) => {
    const stages = indexByPath.get(descriptor.path) || [];
    const conflictStages = stages
      .filter((stage) => stage.stage >= 1 && stage.stage <= 3)
      .map((stage) => ({ stage: stage.stage, mode: stage.mode, oid: stage.oid }));
    const recorded = stages.find((stage) => stage.stage === 0 && stage.mode === "160000");
    const hasStageZero = stages.some((stage) => stage.stage === 0);
    const indexState = conflictStages.length
      ? { kind: "conflicted", recordedOid: null, conflictStages }
      : recorded
        ? {
            kind: "recorded",
            recordedOid: normalizeGitWorkspaceObjectId(recorded.oid, repository.objectFormat),
            conflictStages: [],
          }
        : { kind: hasStageZero ? "not-gitlink" : "missing", recordedOid: null, conflictStages: [] };
    const localConfig = descriptor.name ? local.records.get(descriptor.name) || null : null;
    const targetPath = resolveGitWorkspaceChildPath(repository.repositoryPath, descriptor.path);
    const pathAvailable = Boolean(targetPath && gitWorkspaceDirectoryAvailable(targetPath));
    const configuration = !targetPath ? "invalid" : descriptor.declared ? "configured" : "index-only";
    const configValue = (key) => {
      const declaredValue = descriptor.declared?.[key] || null;
      const localValue = localConfig?.[key] || null;
      return { declared: declaredValue, local: localValue, effective: localValue || declaredValue };
    };
    return {
      name: descriptor.name,
      path: targetPath || path.resolve(repository.repositoryPath, descriptor.path),
      pathAvailable,
      configuration,
      url: configValue("url"),
      branch: configValue("branch"),
      index: indexState,
      registration: descriptor.name ? (localConfig?.url ? "initialized" : "uninitialized") : "unknown",
      checkout: !targetPath || !pathAvailable ? "missing" : "unreadable",
      objectFormat: null,
      head: { kind: "unknown", ref: null, name: null, oid: null },
      commitMismatch: null,
      status: null,
      failure: !targetPath
        ? { code: "path-unavailable", operation: "submodule-status", message: "Submodule 路径越出当前仓库。" }
        : !pathAvailable
          ? { code: "path-unavailable", operation: "submodule-status", message: "Submodule checkout 当前不可访问。" }
          : null,
    };
  });

  const jobs = entries
    .filter((entry) => entry.pathAvailable && entry.configuration !== "invalid")
    .map((entry) => async () => {
      const entryDeadline = Date.now() + gitWorkspaceEntryTimeoutMs;
      const entryCommand = (args, options = {}) =>
        runGitWorkspaceCommand(entry.path, args, {
          ...options,
          timeoutMs: Math.max(1, entryDeadline - Date.now()),
        });
      const formatResult = await entryCommand(["rev-parse", "--show-object-format=storage"]);
      const objectFormat = formatResult.stdout.trim();
      if (formatResult.status !== 0) {
        entry.checkout = entry.registration === "uninitialized" ? "missing" : "not-repository";
        entry.failure = gitWorkspaceFailure(
          "submodule-status",
          formatResult,
          "路径不是当前仓库的 direct submodule checkout.",
        );
        return;
      }
      if (objectFormat !== "sha1" && objectFormat !== "sha256") {
        entry.checkout = "not-repository";
        entry.failure = {
          code: "invalid-output",
          operation: "submodule-status",
          message: "Submodule 对象格式无法识别。",
        };
        return;
      }
      const superprojectResult = await entryCommand(["rev-parse", "--show-superproject-working-tree"]);
      if (superprojectResult.status !== 0) {
        entry.checkout = entry.registration === "uninitialized" ? "missing" : "not-repository";
        entry.failure = gitWorkspaceFailure(
          "submodule-status",
          superprojectResult,
          "路径不是当前仓库的 direct submodule checkout.",
        );
        return;
      }
      if (!gitWorkspacePathsEqual(superprojectResult.stdout.trim(), repository.repositoryPath)) {
        entry.checkout = entry.registration === "uninitialized" ? "missing" : "not-repository";
        entry.failure = {
          code: "command-failed",
          operation: "submodule-status",
          message: "路径不是当前仓库的 direct submodule checkout.",
        };
        return;
      }
      const headResult = await entryCommand(["rev-parse", "HEAD"]);
      const branchResult = await entryCommand(["symbolic-ref", "--short", "-q", "HEAD"]);
      entry.objectFormat = objectFormat;
      const oid = normalizeGitWorkspaceObjectId(headResult.stdout.trim(), objectFormat);
      const branchName = branchResult.status === 0 ? branchResult.stdout.trim() : "";
      if (headResult.status !== 0 && !branchName) {
        entry.checkout = "unreadable";
        entry.failure = gitWorkspaceFailure("submodule-status", headResult, "无法读取 submodule HEAD。");
        return;
      }
      if (headResult.status === 0 && !oid) {
        entry.checkout = "unreadable";
        entry.failure = {
          code: "invalid-output",
          operation: "submodule-status",
          message: "Submodule HEAD 不是完整对象 ID。",
        };
        return;
      }
      entry.head = {
        kind: branchName ? "branch" : oid ? "detached" : "unborn",
        ref: branchName ? `refs/heads/${branchName}` : null,
        name: branchName || null,
        oid,
      };
      entry.checkout = "available";
      entry.commitMismatch =
        entry.index.kind === "recorded" && entry.index.recordedOid && oid ? entry.index.recordedOid !== oid : null;
      const statusParser = createGitWorkspaceStatusParser(objectFormat);
      const statusResult = await entryCommand(
        [
          "--no-optional-locks",
          "status",
          "--porcelain=v2",
          "--branch",
          "--ahead-behind",
          "--untracked-files=normal",
          "--ignore-submodules=dirty",
          "-z",
        ],
        { stdoutRecordHandler: statusParser.consume },
      );
      if (statusResult.status !== 0) {
        entry.failure = gitWorkspaceFailure("submodule-status", statusResult, "无法读取 submodule 状态。");
        return;
      }
      entry.status = statusParser.result().status;
      delete entry.status.upstream;
      entry.failure = null;
    });
  return { entries, failure: sourceFailure, jobs, unavailable: false };
}

async function readGitWorkspaceSnapshot(projectPath) {
  const lastRefreshedAt = new Date().toISOString();
  const repository = await probeGitWorkspaceRepository(projectPath);
  if (repository.failure) {
    const section = { state: "unavailable", entries: [], failure: repository.failure };
    return {
      repositoryPath: "",
      objectFormat: null,
      worktrees: section,
      submodules: { ...section },
      lastRefreshedAt,
    };
  }

  const [worktreeResult, submoduleResult] = await Promise.all([
    enumerateGitWorkspaceWorktrees(repository),
    enumerateGitWorkspaceSubmodules(repository),
  ]);
  await runGitWorkspaceWorkerPool([...worktreeResult.jobs, ...submoduleResult.jobs]);
  const toSection = (result) => ({
    state: result.unavailable
      ? "unavailable"
      : result.failure || result.entries.some((entry) => entry.failure)
        ? "partial"
        : "ready",
    entries: result.entries,
    failure: result.failure,
  });
  return {
    repositoryPath: repository.repositoryPath,
    objectFormat: repository.objectFormat,
    worktrees: toSection(worktreeResult),
    submodules: toSection(submoduleResult),
    lastRefreshedAt,
  };
}

function firstGitError(result, fallback) {
  return String(result.stderr || result.stdout || fallback || "Git 操作失败。").trim();
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

async function collectNumstatAsync(startPath, args) {
  const result = await collectNumstatAsyncResult(startPath, args);
  return result.ok ? result.value : new Map();
}

async function collectNumstatAsyncResult(startPath, args) {
  const outputResult = await runGitAsyncResult(startPath, args);
  if (!outputResult.ok) {
    return {
      ok: false,
      failure: createGitReadFailure("status", outputResult, "读取 Git 文件统计失败"),
    };
  }

  const result = new Map();
  outputResult.stdout.split(/\r?\n/).forEach((line) => {
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

  return { ok: true, value: result };
}

function parseGitStatusRecord(statusCode, filePath, originalPath = "") {
  if (!statusCode || !filePath) {
    return null;
  }

  const status =
    statusCode === "??"
      ? "UNTRACKED"
      : statusCode.includes("R")
        ? "RENAMED"
        : statusCode.includes("A")
          ? "ADDED"
          : statusCode.includes("D")
            ? "DELETED"
            : "MODIFIED";

  return {
    statusCode,
    path: filePath,
    status,
    staged: statusCode[0] !== " " && statusCode[0] !== "?",
    unstaged: statusCode[1] !== " " || statusCode === "??",
    originalPath: originalPath || undefined,
  };
}

function readGitStatusEntries(repositoryPath) {
  const statusOutput = runGit(repositoryPath, ["status", "--porcelain=v1", "-z"]);
  if (!statusOutput) {
    return [];
  }

  const records = statusOutput.split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const statusCode = record.slice(0, 2);
    const filePath = record.slice(3);
    const originalPath = statusCode.includes("R") ? records[++index] || "" : "";
    const entry = parseGitStatusRecord(statusCode, filePath, originalPath);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

async function readGitStatusEntriesAsync(repositoryPath) {
  const result = await readGitStatusEntriesAsyncResult(repositoryPath);
  return result.ok ? result.value : [];
}

async function readGitStatusEntriesAsyncResult(repositoryPath) {
  const statusResult = await runGitAsyncResult(repositoryPath, ["status", "--porcelain=v1", "-z"]);
  if (!statusResult.ok) {
    return {
      ok: false,
      failure: createGitReadFailure("status", statusResult, "读取 Git 文件状态失败"),
    };
  }

  const records = statusResult.stdout.split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const statusCode = record.slice(0, 2);
    const filePath = record.slice(3);
    const originalPath = statusCode.includes("R") ? records[++index] || "" : "";
    const entry = parseGitStatusRecord(statusCode, filePath, originalPath);
    if (entry) {
      entries.push(entry);
    }
  }
  return { ok: true, value: entries };
}

function readGitBranches(repositoryPath) {
  const output = runGit(repositoryPath, ["branch", "--format=%(refname:short)%09%(HEAD)"]);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => {
      const [name, marker] = line.split("\t");
      const branchName = String(name || "").trim();
      return branchName ? { name: branchName, current: String(marker || "").trim() === "*" } : null;
    })
    .filter(Boolean);
}

async function readGitBranchesAsync(repositoryPath) {
  const result = await readGitBranchesAsyncResult(repositoryPath);
  return result.ok ? result.value : [];
}

async function readGitBranchesAsyncResult(repositoryPath) {
  const outputResult = await runGitAsyncResult(repositoryPath, ["branch", "--format=%(refname:short)%09%(HEAD)"]);
  if (!outputResult.ok) {
    return {
      ok: false,
      failure: createGitReadFailure("status", outputResult, "读取 Git 分支失败"),
    };
  }

  const branches = outputResult.stdout
    .split(/\r?\n/)
    .map((line) => {
      const [name, marker] = line.split("\t");
      const branchName = String(name || "").trim();
      return branchName ? { name: branchName, current: String(marker || "").trim() === "*" } : null;
    })
    .filter(Boolean);
  return { ok: true, value: branches };
}

async function readGitRemotesAsync(repositoryPath) {
  const result = await readGitRemotesAsyncResult(repositoryPath);
  return result.ok ? result.value : [];
}

async function readGitRemotesAsyncResult(repositoryPath) {
  const outputResult = await runGitAsyncResult(repositoryPath, ["remote", "-v"]);
  if (!outputResult.ok) {
    return {
      ok: false,
      failure: createGitReadFailure("status", outputResult, "读取 Git remote 失败"),
    };
  }

  const remotes = new Map();
  outputResult.stdout.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^(\S+)\s+(.+)\s+\((fetch|push)\)$/);
    if (!match) {
      return;
    }
    const [, name, url, kind] = match;
    const current = remotes.get(name) || { name, fetchUrl: "", pushUrl: "" };
    if (kind === "fetch") {
      current.fetchUrl = url.trim();
    } else {
      current.pushUrl = url.trim();
    }
    remotes.set(name, current);
  });

  const values = Array.from(remotes.values()).map((remote) => ({
    ...remote,
    pushUrl: remote.pushUrl || remote.fetchUrl,
  }));
  return { ok: true, value: values };
}

async function readGitRemoteBranchesAsync(repositoryPath, remotes) {
  const result = await readGitRemoteBranchesAsyncResult(repositoryPath, remotes);
  return result.ok ? result.value : [];
}

async function readGitRemoteBranchesAsyncResult(repositoryPath, remotes) {
  const fieldSeparator = "\x1f";
  const outputResult = await runGitAsyncResult(repositoryPath, [
    "for-each-ref",
    `--format=%(refname)${fieldSeparator}%(objectname)`,
    "refs/remotes",
  ]);
  if (!outputResult.ok) {
    return {
      ok: false,
      failure: createGitReadFailure("status", outputResult, "读取 Git 远端分支失败"),
    };
  }

  const remoteNames = new Set(remotes.map((remote) => remote.name));
  const branches = outputResult.stdout
    .split(/\r?\n/)
    .map((line) => {
      const [fullName] = line.split(fieldSeparator);
      const normalizedName = String(fullName || "").trim();
      const prefix = "refs/remotes/";
      if (!normalizedName.startsWith(prefix)) {
        return null;
      }

      const relativeName = normalizedName.slice(prefix.length);
      const separatorIndex = relativeName.indexOf("/");
      if (separatorIndex <= 0) {
        return null;
      }

      const remote = relativeName.slice(0, separatorIndex);
      const branch = relativeName.slice(separatorIndex + 1);
      if (!remoteNames.has(remote) || !branch || branch === "HEAD") {
        return null;
      }

      return { remote, branch, ref: `${remote}/${branch}` };
    })
    .filter(Boolean)
    .sort((left, right) => left.ref.localeCompare(right.ref));
  return { ok: true, value: branches };
}

async function readGitUpstreamAsync(repositoryPath) {
  const branchResult = await runGitAsyncResult(repositoryPath, ["branch", "--show-current"]);
  if (!branchResult.ok) return null;
  const result = await readGitUpstreamAsyncResult(repositoryPath, branchResult.stdout.trim());
  return result.ok ? result.value : null;
}

async function readGitUpstreamAsyncResult(repositoryPath, branch) {
  if (!branch) return { ok: true, value: null };
  const refResult = await runGitAsyncResult(repositoryPath, [
    "for-each-ref",
    "--format=%(upstream:short)",
    `refs/heads/${branch}`,
  ]);
  if (!refResult.ok) {
    return {
      ok: false,
      failure: createGitReadFailure("status", refResult, "读取 Git upstream 失败"),
    };
  }
  const ref = refResult.stdout.trim().split(/\r?\n/)[0] || "";
  if (!ref || !ref.includes("/")) {
    return { ok: true, value: null };
  }

  const [remote, ...branchParts] = ref.split("/");
  const upstreamBranch = branchParts.join("/");
  if (!remote || !upstreamBranch) {
    return { ok: true, value: null };
  }

  const countsResult = await runGitAsyncResult(repositoryPath, [
    "rev-list",
    "--left-right",
    "--count",
    `HEAD...${ref}`,
  ]);
  if (!countsResult.ok) {
    return {
      ok: false,
      failure: createGitReadFailure("status", countsResult, "读取 Git ahead/behind 失败"),
    };
  }
  const counts = countsResult.stdout.trim().split(/\s+/);
  if (counts.length !== 2 || counts.some((value) => !/^\d+$/.test(value))) {
    return {
      ok: false,
      failure: {
        code: "invalid-output",
        operation: "status",
        message: "Git 返回了无效的 ahead/behind 状态。",
      },
    };
  }
  const ahead = Number(counts[0]);
  const behind = Number(counts[1]);

  return { ok: true, value: { remote, branch: upstreamBranch, ref, ahead, behind } };
}

function parseGitRemoteBranchRef(ref, remotes) {
  const normalizedRef = String(ref || "")
    .trim()
    .replace(/^refs\/remotes\//, "");
  const remote = remotes.find((candidate) => normalizedRef.startsWith(`${candidate.name}/`));
  if (!remote) {
    return null;
  }

  const branch = normalizedRef.slice(remote.name.length + 1);
  return branch ? { remote: remote.name, branch, ref: `${remote.name}/${branch}` } : null;
}

async function readGitBranchBaseAsync(repositoryPath, branch, remotes, upstream) {
  if (!branch || branch === "HEAD") {
    return null;
  }

  const resolveBase = async (ref) => {
    const base = parseGitRemoteBranchRef(ref, remotes);
    if (!base || base.ref === upstream?.ref) {
      return null;
    }

    const commit = await runGitAsync(repositoryPath, ["rev-parse", "--verify", "--quiet", `${base.ref}^{commit}`]);
    return commit ? base : null;
  };

  const configuredRef = String(
    (await runGitAsync(repositoryPath, ["config", "--get", `branch.${branch}.vscode-merge-base`])) || "",
  ).trim();
  const configuredBase = await resolveBase(configuredRef);
  if (configuredBase) {
    return configuredBase;
  }

  const reflogEntries = String(
    (await runGitAsync(repositoryPath, [
      "reflog",
      "show",
      "--format=%gs",
      "--grep-reflog=^branch: Created from ",
      `refs/heads/${branch}`,
    ])) || "",
  )
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (reflogEntries.length === 1) {
    const createdFrom = reflogEntries[0].match(/^branch: Created from (.+)$/)?.[1] || "";
    const reflogBase = await resolveBase(createdFrom);
    if (reflogBase) {
      return reflogBase;
    }
    if (createdFrom && createdFrom !== "HEAD") {
      const createdBranchUpstream = String(
        (await runGitAsync(repositoryPath, [
          "for-each-ref",
          "--format=%(upstream:short)",
          `refs/heads/${createdFrom}`,
        ])) || "",
      ).trim();
      const upstreamBase = await resolveBase(createdBranchUpstream);
      if (upstreamBase) {
        return upstreamBase;
      }
    }
  }

  const preferredRemoteNames = [
    upstream?.remote,
    remotes.find((remote) => remote.name === "origin")?.name,
    ...remotes.map((remote) => remote.name),
  ].filter((remote, index, names) => Boolean(remote) && names.indexOf(remote) === index);
  for (const remote of preferredRemoteNames) {
    const defaultRemoteRef = String(
      (await runGitAsync(repositoryPath, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`])) || "",
    ).trim();
    const defaultBase = await resolveBase(defaultRemoteRef);
    if (defaultBase) {
      return defaultBase;
    }
  }

  return null;
}

function parseGitHubRepository(remoteUrl) {
  const value = String(remoteUrl || "").trim();
  if (!value) {
    return null;
  }

  const scpLike = value.match(/^(?:[^@\s/:]+@)?github\.com:([^?#\s]+)$/i);
  let repositoryPath = scpLike?.[1] || "";
  if (!repositoryPath) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") {
        return null;
      }
      if (parsed.hostname.toLowerCase() !== "github.com") {
        return null;
      }
      repositoryPath = parsed.pathname;
    } catch {
      return null;
    }
  }

  const segments = repositoryPath
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (segments.length !== 2) {
    return null;
  }

  const [owner, repositoryWithSuffix] = segments;
  const repository = repositoryWithSuffix.replace(/\.git$/i, "");
  if (!owner || !repository || owner === "." || owner === ".." || repository === "." || repository === "..") {
    return null;
  }

  return { owner, repository };
}

function selectGitHubRepository(remotes, upstream) {
  const candidates = [];
  const addCandidate = (remote) => {
    if (remote && !candidates.includes(remote)) {
      candidates.push(remote);
    }
  };

  addCandidate(remotes.find((remote) => remote.name === upstream?.remote));
  addCandidate(remotes.find((remote) => remote.name === "origin"));
  remotes.forEach(addCandidate);

  for (const remote of candidates) {
    const repository = parseGitHubRepository(remote.fetchUrl) || parseGitHubRepository(remote.pushUrl);
    if (repository) {
      return repository;
    }
  }

  return null;
}

function cacheGitCommitAvatar(cacheKey, loader) {
  const cached = gitCommitAvatarResults.get(cacheKey);
  if (cached) {
    return cached;
  }

  const result = Promise.resolve()
    .then(loader)
    .catch(() => null);
  gitCommitAvatarResults.set(cacheKey, result);
  while (gitCommitAvatarResults.size > gitCommitAvatarResultLimit) {
    const oldestKey = gitCommitAvatarResults.keys().next().value;
    if (!oldestKey) {
      break;
    }
    gitCommitAvatarResults.delete(oldestKey);
  }
  return result;
}

async function fetchGitHubCommitAvatar(owner, repository, commitHash) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), gitCommitAvatarRequestTimeoutMs);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(commitHash)}`,
      { headers: { Accept: "application/vnd.github+json" }, signal: controller.signal },
    );
    if (!response.ok) {
      return null;
    }

    const avatarUrl = (await response.json())?.author?.avatar_url;
    const parsedAvatarUrl = new URL(String(avatarUrl || ""));
    return parsedAvatarUrl.protocol === "https:" ? parsedAvatarUrl.toString() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readGitCommitAuthorAvatar(projectPath, commitHash) {
  const hash = String(commitHash || "").trim();
  if (!/^[0-9a-f]{40,64}$/i.test(hash)) {
    return null;
  }

  const repositoryPath = await findGitRootAsync(projectPath);
  if (!repositoryPath) {
    return null;
  }

  const [remotes, upstream] = await Promise.all([
    readGitRemotesAsync(repositoryPath),
    readGitUpstreamAsync(repositoryPath),
  ]);
  const repository = selectGitHubRepository(remotes, upstream);
  if (!repository) {
    return null;
  }

  const cacheKey = `${repository.owner.toLowerCase()}/${repository.repository.toLowerCase()}:${hash.toLowerCase()}`;
  return cacheGitCommitAvatar(cacheKey, () => fetchGitHubCommitAvatar(repository.owner, repository.repository, hash));
}

function normalizeGitRemoteName(remoteName) {
  return typeof remoteName === "string" ? remoteName.trim() : "";
}

function normalizeGitRemoteUrl(remoteUrl) {
  return typeof remoteUrl === "string" ? remoteUrl.trim() : "";
}

function validateGitRemoteName(remoteName) {
  if (!remoteName) {
    return "请输入 remote 名称。";
  }
  if (remoteName.startsWith("-")) {
    return "remote 名称不能以 - 开头。";
  }
  if (!/^[A-Za-z0-9._-]+$/.test(remoteName)) {
    return "remote 名称只能包含字母、数字、点、下划线和短横线。";
  }
  return "";
}

function validateGitRemoteUrl(remoteUrl) {
  if (!remoteUrl) {
    return "请输入 remote URL。";
  }
  if (/[\u0000-\u001f\u007f]/.test(remoteUrl)) {
    return "remote URL 不能包含控制字符。";
  }
  return "";
}

async function resolveGitRemoteOperation(projectPath) {
  const repositoryPath = await findGitRootAsync(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  const upstream = await readGitUpstreamAsync(repositoryPath);
  if (!upstream) {
    return { ok: false, repositoryPath, message: "当前分支未设置 upstream，无法执行远程操作。" };
  }

  return { ok: true, repositoryPath, upstream };
}

async function resolveNamedGitRemoteOperation(projectPath, remoteName) {
  const repositoryPath = await findGitRootAsync(projectPath);
  const name = normalizeGitRemoteName(remoteName);
  const nameError = validateGitRemoteName(name);
  if (!repositoryPath) {
    return { ok: false, remote: name, message: "未检测到 Git 仓库。" };
  }
  if (nameError) {
    return { ok: false, remote: name, message: nameError };
  }

  const remotes = await readGitRemotesAsync(repositoryPath);
  if (!remotes.some((remote) => remote.name === name)) {
    return { ok: false, remote: name, message: `未找到 remote：${name}。` };
  }

  return { ok: true, repositoryPath, remote: name };
}

async function runGitRemoteResult(projectPath, args, successMessage) {
  const remoteContext = await resolveGitRemoteOperation(projectPath);
  if (!remoteContext.ok) {
    return { ok: false, message: remoteContext.message };
  }

  const result = await runGitRemoteCommandResult(remoteContext.repositoryPath, args(remoteContext.upstream));
  return result.status === 0
    ? {
        ok: true,
        remote: remoteContext.upstream.remote,
        branch: remoteContext.upstream.branch,
        message: successMessage(remoteContext.upstream),
      }
    : {
        ok: false,
        remote: remoteContext.upstream.remote,
        branch: remoteContext.upstream.branch,
        message: firstGitError(result, "远程 Git 操作失败。"),
      };
}

function readGitLocalBranchTips(repositoryPath) {
  const output = runGit(repositoryPath, ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads"]);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => {
      const [name, hash] = line.split("\t");
      const branchName = String(name || "").trim();
      const branchHash = String(hash || "").trim();
      return branchName && branchHash ? { name: branchName, hash: branchHash } : null;
    })
    .filter(Boolean);
}

function chooseGitBranchTip(repositoryPath, commitHash, preferredBranch = "") {
  const fullHash = (runGit(repositoryPath, ["rev-parse", `${commitHash}^{commit}`]) || "").trim();
  if (!fullHash) {
    return null;
  }

  const matchingBranches = readGitLocalBranchTips(repositoryPath).filter((branch) => branch.hash === fullHash);
  if (matchingBranches.length === 0) {
    return null;
  }

  const symbolicBranch = (runGit(repositoryPath, ["symbolic-ref", "--short", "-q", "HEAD"]) || "").trim();
  const preferredNames = [preferredBranch, symbolicBranch, "main", "master", "develop"].filter(
    (name) => typeof name === "string" && name.trim() && name !== "HEAD",
  );
  for (const preferredName of preferredNames) {
    const match = matchingBranches.find((branch) => branch.name === preferredName);
    if (match) {
      return match;
    }
  }

  return matchingBranches[0];
}

function resolveGitFilePath(repositoryPath, relativePath) {
  const resolved = resolveProjectChild(repositoryPath, relativePath);
  if (!resolved.relativePath) {
    throw new Error("请选择一个仓库内文件。");
  }
  return resolved;
}

function getGitFileStatus(repositoryPath, relativePath) {
  const normalizedPath = String(relativePath || "").replace(/\\/g, "/");
  return readGitStatusEntries(repositoryPath).find((entry) => entry.path === normalizedPath) || null;
}

function gitFileActionPaths(repositoryPath, status, fallbackPath) {
  const paths = status?.originalPath ? [status.originalPath, status.path] : [fallbackPath];
  return paths.map((filePath) => resolveGitFilePath(repositoryPath, filePath).relativePath);
}

function uniqueGitActionPaths(repositoryPath, relativePaths, filterStatus) {
  const actionPaths = new Set();
  const displayPaths = [];
  const requestedPaths = Array.isArray(relativePaths) ? relativePaths : [];

  requestedPaths.forEach((relativePath) => {
    const resolved = resolveGitFilePath(repositoryPath, relativePath);
    const status = getGitFileStatus(repositoryPath, resolved.relativePath);
    if (!filterStatus(status, resolved.relativePath)) {
      return;
    }
    gitFileActionPaths(repositoryPath, status, resolved.relativePath).forEach((filePath) => actionPaths.add(filePath));
    displayPaths.push(resolved.relativePath);
  });

  return { actionPaths: Array.from(actionPaths), displayPaths: Array.from(new Set(displayPaths)) };
}

function allGitActionPaths(repositoryPath, filterStatus) {
  const actionPaths = new Set();
  const displayPaths = [];
  readGitStatusEntries(repositoryPath).forEach((status) => {
    if (!filterStatus(status, status.path)) {
      return;
    }
    gitFileActionPaths(repositoryPath, status, status.path).forEach((filePath) => actionPaths.add(filePath));
    displayPaths.push(status.path);
  });

  return { actionPaths: Array.from(actionPaths), displayPaths: Array.from(new Set(displayPaths)) };
}

function readGitWorktreeStatus(repositoryPath) {
  return runGitResult(repositoryPath, ["status", "--porcelain"]);
}

function hasUncommittedGitChanges(repositoryPath) {
  const status = readGitWorktreeStatus(repositoryPath);
  return status.status !== 0 || Boolean(status.stdout.trim());
}

function fileExistsInHead(repositoryPath, relativePath) {
  const result = runGitResult(repositoryPath, ["cat-file", "-e", `HEAD:${relativePath}`]);
  return result.status === 0;
}

function removeGitWorktreePath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  const stats = fs.statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error("暂不支持从 Git 面板丢弃未跟踪目录或非普通文件，请在文件系统中确认后手动处理。");
  }
  fs.rmSync(targetPath, { force: true });
}

function truncateGitDiff(diff, maxLength = 32000) {
  if (diff.length <= maxLength) {
    return { diff, truncated: false };
  }
  return {
    diff: `${diff.slice(0, maxLength)}\n\n[diff 已截断，仅保留前 ${maxLength} 个字符]`,
    truncated: true,
  };
}

function readUntrackedFileDiffs(repositoryPath) {
  return readGitStatusEntries(repositoryPath)
    .filter((entry) => entry.status === "UNTRACKED")
    .map((entry) => {
      const resolved = resolveProjectChild(repositoryPath, entry.path);
      if (!fs.existsSync(resolved.targetPath) || !fs.statSync(resolved.targetPath).isFile()) {
        return `diff --git a/${entry.path} b/${entry.path}\nnew file mode 000000\n--- /dev/null\n+++ b/${entry.path}\n@@\n[未跟踪目录或非普通文件，已跳过内容 diff]`;
      }
      return runGitDiff(repositoryPath, ["diff", "--no-index", "--", os.devNull, entry.path]) || "";
    })
    .filter(Boolean);
}

function readGitCommitMessageDiff(projectPath) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, scope: "working-tree", diff: "", message: "未检测到 Git 仓库。" };
  }

  const stagedDiff = runGitDiff(repositoryPath, ["diff", "--cached"]);
  if (stagedDiff && stagedDiff.trim()) {
    return { ok: true, scope: "staged", ...truncateGitDiff(stagedDiff) };
  }

  const workingDiff = [runGitDiff(repositoryPath, ["diff"]), ...readUntrackedFileDiffs(repositoryPath)]
    .filter(Boolean)
    .join("\n");
  if (!workingDiff.trim()) {
    return { ok: false, scope: "working-tree", diff: "", message: "当前没有可用于生成提交信息的 diff。" };
  }

  return { ok: true, scope: "working-tree", ...truncateGitDiff(workingDiff) };
}

function stageGitFile(projectPath, relativePath) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  try {
    const resolved = resolveGitFilePath(repositoryPath, relativePath);
    const status = getGitFileStatus(repositoryPath, resolved.relativePath);
    const actionPaths = gitFileActionPaths(repositoryPath, status, resolved.relativePath);
    const result = runGitResult(repositoryPath, ["add", "--", ...actionPaths]);
    return result.status === 0
      ? { ok: true, path: resolved.relativePath, message: "已暂存文件变更。" }
      : { ok: false, path: resolved.relativePath, message: firstGitError(result, "暂存文件失败。") };
  } catch (error) {
    return { ok: false, message: error?.message || "暂存文件失败。" };
  }
}

function unstageGitFile(projectPath, relativePath) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  try {
    const resolved = resolveGitFilePath(repositoryPath, relativePath);
    const status = getGitFileStatus(repositoryPath, resolved.relativePath);
    const actionPaths = gitFileActionPaths(repositoryPath, status, resolved.relativePath);
    const result = runGitResult(repositoryPath, ["reset", "-q", "HEAD", "--", ...actionPaths]);
    return result.status === 0
      ? { ok: true, path: resolved.relativePath, message: "已取消暂存文件。" }
      : { ok: false, path: resolved.relativePath, message: firstGitError(result, "取消暂存失败。") };
  } catch (error) {
    return { ok: false, message: error?.message || "取消暂存失败。" };
  }
}

function discardGitFile(projectPath, relativePath) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  try {
    const resolved = resolveGitFilePath(repositoryPath, relativePath);
    const status = getGitFileStatus(repositoryPath, resolved.relativePath);
    if (!status) {
      return { ok: true, path: resolved.relativePath, message: "该文件没有可丢弃的变更。" };
    }

    if (
      status.status === "UNTRACKED" ||
      (status.statusCode[0] === "A" && !fileExistsInHead(repositoryPath, resolved.relativePath))
    ) {
      if (status.staged) {
        runGitResult(repositoryPath, ["reset", "-q", "HEAD", "--", resolved.relativePath]);
      }
      removeGitWorktreePath(resolved.targetPath);
      return { ok: true, path: resolved.relativePath, message: "已丢弃该文件变更。" };
    }

    const actionPaths = gitFileActionPaths(repositoryPath, status, resolved.relativePath);
    const result = runGitResult(repositoryPath, ["restore", "--staged", "--worktree", "--", ...actionPaths]);
    return result.status === 0
      ? { ok: true, path: resolved.relativePath, message: "已丢弃该文件变更。" }
      : { ok: false, path: resolved.relativePath, message: firstGitError(result, "丢弃文件变更失败。") };
  } catch (error) {
    return { ok: false, message: error?.message || "丢弃文件变更失败。" };
  }
}

function stageGitFiles(projectPath, relativePaths, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  try {
    const filterStatus = (status) =>
      Boolean(status && (status.unstaged || (!status.staged && status.unstaged !== false)));
    const { actionPaths, displayPaths } =
      options?.all === true
        ? allGitActionPaths(repositoryPath, filterStatus)
        : uniqueGitActionPaths(repositoryPath, relativePaths, filterStatus);
    if (actionPaths.length === 0) {
      return { ok: false, count: 0, paths: [], message: "没有可暂存的文件变更。" };
    }
    const result = runGitResult(repositoryPath, ["add", "--", ...actionPaths]);
    return result.status === 0
      ? { ok: true, count: displayPaths.length, paths: displayPaths, message: `已暂存 ${displayPaths.length} 个文件。` }
      : {
          ok: false,
          count: displayPaths.length,
          paths: displayPaths,
          message: firstGitError(result, "批量暂存失败。"),
        };
  } catch (error) {
    return { ok: false, message: error?.message || "批量暂存失败。" };
  }
}

function unstageGitFiles(projectPath, relativePaths, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  try {
    const filterStatus = (status) => Boolean(status?.staged);
    const { actionPaths, displayPaths } =
      options?.all === true
        ? allGitActionPaths(repositoryPath, filterStatus)
        : uniqueGitActionPaths(repositoryPath, relativePaths, filterStatus);
    if (actionPaths.length === 0) {
      return { ok: false, count: 0, paths: [], message: "没有可取消暂存的文件。" };
    }
    const result = runGitResult(repositoryPath, ["reset", "-q", "HEAD", "--", ...actionPaths]);
    return result.status === 0
      ? {
          ok: true,
          count: displayPaths.length,
          paths: displayPaths,
          message: `已取消暂存 ${displayPaths.length} 个文件。`,
        }
      : {
          ok: false,
          count: displayPaths.length,
          paths: displayPaths,
          message: firstGitError(result, "批量取消暂存失败。"),
        };
  } catch (error) {
    return { ok: false, message: error?.message || "批量取消暂存失败。" };
  }
}

function discardGitFiles(projectPath, relativePaths, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  const requestedPaths =
    options?.all === true
      ? allGitActionPaths(repositoryPath, (status) => Boolean(status)).displayPaths
      : Array.isArray(relativePaths)
        ? Array.from(new Set(relativePaths))
        : [];
  if (requestedPaths.length === 0) {
    return { ok: false, count: 0, paths: [], message: "没有可丢弃的文件变更。" };
  }

  const succeededPaths = [];
  for (const relativePath of requestedPaths) {
    const result = discardGitFile(projectPath, relativePath);
    if (!result.ok) {
      return {
        ...result,
        count: succeededPaths.length,
        paths: succeededPaths,
        message:
          succeededPaths.length > 0 ? `${result.message}（已先丢弃 ${succeededPaths.length} 个文件）` : result.message,
      };
    }
    if (result.path) {
      succeededPaths.push(result.path);
    }
  }

  return {
    ok: true,
    count: succeededPaths.length,
    paths: succeededPaths,
    message: succeededPaths.length > 0 ? `已丢弃 ${succeededPaths.length} 个文件变更。` : "没有可丢弃的文件变更。",
  };
}

function readAttachedGitHead(repositoryPath) {
  const headRef = (runGit(repositoryPath, ["symbolic-ref", "-q", "HEAD"]) || "").trim();
  if (!headRef) {
    return { ok: false, message: "当前 HEAD 处于 detached 状态，请使用外部 Git 工具处理。" };
  }

  const localBranchPrefix = "refs/heads/";
  if (!headRef.startsWith(localBranchPrefix) || headRef.length === localBranchPrefix.length) {
    return { ok: false, message: "当前 HEAD 未指向本地分支，请使用外部 Git 工具处理。" };
  }

  const commitHash = (runGit(repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]) || "").trim();
  if (!commitHash) {
    return { ok: false, message: "当前分支没有可操作的提交。" };
  }

  return {
    ok: true,
    branch: headRef.slice(localBranchPrefix.length),
    commitHash,
    commitMessage: (runGit(repositoryPath, ["log", "-1", "--format=%B", "HEAD"]) || "").trim(),
  };
}

function commitGitStaged(projectPath, message) {
  const repositoryPath = findGitRoot(projectPath);
  const commitMessage = typeof message === "string" ? message.trim() : "";
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (!commitMessage) {
    return { ok: false, message: "请先填写 commit message。" };
  }

  const stagedDiff = runGitDiff(repositoryPath, ["diff", "--cached"]);
  if (!stagedDiff || !stagedDiff.trim()) {
    return { ok: false, message: "没有 staged 变更可提交。" };
  }

  const result = runGitResult(repositoryPath, ["commit", "-m", commitMessage]);
  if (result.status !== 0) {
    return { ok: false, message: firstGitError(result, "提交失败。") };
  }

  const commitHash = (runGit(repositoryPath, ["rev-parse", "--short", "HEAD"]) || "").trim();
  return { ok: true, commitHash, message: commitHash ? `提交成功：${commitHash}` : "提交成功。" };
}

function amendGitCommit(projectPath, message) {
  const repositoryPath = findGitRoot(projectPath);
  const commitMessage = typeof message === "string" ? message.trim() : "";
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (!commitMessage) {
    return { ok: false, message: "请先填写 commit message。" };
  }

  const head = readAttachedGitHead(repositoryPath);
  if (!head.ok) return head;

  const stagedDiff = runGitResult(repositoryPath, ["diff", "--cached", "--quiet"]);
  if (stagedDiff.status > 1) {
    return { ok: false, message: firstGitError(stagedDiff, "无法读取 staged 变更。") };
  }
  if (stagedDiff.status === 0 && commitMessage === head.commitMessage) {
    return { ok: false, message: "提交信息未变化且没有 staged 变更，无需修订。" };
  }

  const result = runGitResult(repositoryPath, ["commit", "--amend", "-m", commitMessage]);
  if (result.status !== 0) {
    return { ok: false, message: firstGitError(result, "修订上次提交失败。") };
  }

  return {
    ok: true,
    branch: head.branch,
    commitHash: (runGit(repositoryPath, ["rev-parse", "HEAD"]) || head.commitHash).trim(),
    message: "已修订上次提交。",
  };
}

function restoreRootGitHead(repositoryPath, commitHash) {
  const restoreHead = runGitResult(repositoryPath, ["update-ref", "HEAD", commitHash]);
  if (restoreHead.status !== 0) {
    return { ok: false, message: firstGitError(restoreHead, "无法恢复 HEAD。") };
  }

  const restoreIndex = runGitResult(repositoryPath, ["read-tree", "HEAD"]);
  return restoreIndex.status === 0
    ? { ok: true }
    : { ok: false, message: firstGitError(restoreIndex, "无法恢复暂存区。") };
}

function undoLastGitCommit(projectPath, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  const head = readAttachedGitHead(repositoryPath);
  if (!head.ok) return head;

  const parentLine = (runGit(repositoryPath, ["rev-list", "--parents", "-n", "1", "HEAD"]) || "").trim();
  const parentParts = parentLine.split(/\s+/).filter(Boolean);
  if (parentParts[0] !== head.commitHash) {
    return { ok: false, message: "无法读取上次提交的父提交。" };
  }
  const parents = parentParts.slice(1);
  const isMergeCommit = parents.length > 1;
  if (isMergeCommit && options?.allowMerge !== true) {
    return {
      ok: false,
      blockReason: "merge-commit",
      commitHash: head.commitHash,
      message: "上次提交是 merge commit，需要再次确认后按第一父提交撤销。",
    };
  }

  if (parents.length > 0) {
    const reset = runGitResult(repositoryPath, ["reset", "--soft", "HEAD~"]);
    if (reset.status !== 0) {
      return { ok: false, message: firstGitError(reset, "撤销上次提交失败。") };
    }
    return {
      ok: true,
      branch: head.branch,
      commitHash: head.commitHash,
      commitMessage: head.commitMessage,
      message: isMergeCommit
        ? "已按第一父提交撤销上次 merge 提交，改动保留在 staged 状态。"
        : "已撤销上次提交，改动保留在 staged 状态。",
    };
  }

  const cachedFiles = runGitResult(repositoryPath, ["ls-files", "--cached", "-z"]);
  if (cachedFiles.status !== 0) {
    return { ok: false, message: firstGitError(cachedFiles, "无法读取 root commit 的暂存区。") };
  }

  const deleteHead = runGitResult(repositoryPath, ["update-ref", "-d", "HEAD", head.commitHash]);
  if (deleteHead.status !== 0) {
    return { ok: false, message: firstGitError(deleteHead, "无法移除 root commit。") };
  }

  const unstage = cachedFiles.stdout
    ? runGitResult(repositoryPath, ["rm", "--cached", "-r", "-f", "--", "."])
    : { status: 0 };
  if (unstage.status !== 0) {
    const recovery = restoreRootGitHead(repositoryPath, head.commitHash);
    const failure = firstGitError(unstage, "无法取消暂存 root commit 的文件。");
    return {
      ok: false,
      message: recovery.ok
        ? `${failure} 已恢复 HEAD 和暂存区。`
        : `${failure} 恢复 HEAD 或暂存区失败：${recovery.message}`,
    };
  }

  return {
    ok: true,
    branch: head.branch,
    commitHash: head.commitHash,
    commitMessage: head.commitMessage,
    message: "已撤销上次提交，文件保留在工作区且已取消暂存。",
  };
}

function normalizeGitStashRef(value) {
  const stashRef = typeof value === "string" ? value.trim() : "";
  const match = /^(?:refs\/)?stash@\{(0|[1-9]\d*)\}$/.exec(stashRef);
  return match ? `stash@{${match[1]}}` : "";
}

function validateGitStashRef(repositoryPath, stashRef) {
  const normalized = normalizeGitStashRef(stashRef);
  return normalized &&
    runGitResult(repositoryPath, ["rev-parse", "--verify", "--quiet", `${normalized}^{commit}`]).status === 0
    ? normalized
    : "";
}

function createGitStash(projectPath, message, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const stashMessage = typeof message === "string" ? message.trim() : "";
  const includeUntracked = Boolean(options?.includeUntracked);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  const hasStashableChanges = readGitStatusEntries(repositoryPath).some(
    (status) => includeUntracked || status.status !== "UNTRACKED",
  );
  if (!hasStashableChanges) {
    return {
      ok: false,
      message: includeUntracked ? "当前没有可保存到 stash 的变更。" : "当前没有可保存到 stash 的已跟踪文件变更。",
    };
  }

  const args = ["stash", "push"];
  if (includeUntracked) args.push("--include-untracked");
  if (stashMessage) args.push("--message", stashMessage);
  const result = runGitResult(repositoryPath, args);
  return result.status === 0
    ? { ok: true, message: "已保存当前变更到 stash。" }
    : { ok: false, message: firstGitError(result, "保存到 stash 失败。") };
}

function applyGitStash(projectPath, stashRef) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  const normalized = validateGitStashRef(repositoryPath, stashRef);
  if (!normalized) {
    return { ok: false, message: "指定的 stash 不存在。" };
  }

  const result = runGitResult(repositoryPath, ["stash", "apply", normalized]);
  return result.status === 0
    ? { ok: true, message: `已应用 ${normalized}。` }
    : { ok: false, message: firstGitError(result, `应用 ${normalized} 失败。`) };
}

function popGitStash(projectPath, stashRef) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  const normalized = validateGitStashRef(repositoryPath, stashRef);
  if (!normalized) {
    return { ok: false, message: "指定的 stash 不存在。" };
  }

  const result = runGitResult(repositoryPath, ["stash", "pop", normalized]);
  return result.status === 0
    ? { ok: true, message: `已恢复并移除 ${normalized}。` }
    : { ok: false, message: firstGitError(result, `弹出 ${normalized} 失败。`) };
}

function dropGitStash(projectPath, stashRef) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  const normalized = validateGitStashRef(repositoryPath, stashRef);
  if (!normalized) {
    return { ok: false, message: "指定的 stash 不存在。" };
  }

  const result = runGitResult(repositoryPath, ["stash", "drop", normalized]);
  return result.status === 0
    ? { ok: true, message: `已删除 ${normalized}。` }
    : { ok: false, message: firstGitError(result, `删除 ${normalized} 失败。`) };
}

function switchGitBranch(projectPath, branchName, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const targetBranch = typeof branchName === "string" ? branchName.trim() : "";
  const force = Boolean(options && options.force);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (!targetBranch) {
    return { ok: false, message: "请选择要切换的本地分支。" };
  }
  const branches = readGitBranches(repositoryPath);
  const branch = branches.find((item) => item.name === targetBranch);
  if (!branch) {
    return { ok: false, message: "只能切换到已有本地分支。" };
  }
  if (branch.current) {
    return { ok: true, branch: targetBranch, message: "已经位于该分支。" };
  }
  if (!force && hasUncommittedGitChanges(repositoryPath)) {
    return {
      ok: false,
      blockReason: "dirty-worktree",
      message: "当前工作区存在未提交变更，请先提交、暂存或丢弃后再切换分支。",
    };
  }

  const result = runGitResult(
    repositoryPath,
    force ? ["switch", "--discard-changes", "--", targetBranch] : ["switch", "--", targetBranch],
  );
  return result.status === 0
    ? {
        ok: true,
        branch: targetBranch,
        message: force ? `已强制切换到 ${targetBranch}。` : `已切换到 ${targetBranch}。`,
      }
    : { ok: false, branch: targetBranch, message: firstGitError(result, "切换分支失败。") };
}

function checkoutGitCommit(projectPath, commitHash, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const targetHash = typeof commitHash === "string" ? commitHash.trim() : "";
  const force = Boolean(options && options.force);
  const preferredBranch = typeof options?.preferredBranch === "string" ? options.preferredBranch.trim() : "";
  const detach = Boolean(options && options.detach);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (!/^[0-9a-fA-F]{7,64}$/.test(targetHash)) {
    return { ok: false, message: "请选择一个有效的提交 hash。" };
  }
  const existsResult = runGitResult(repositoryPath, ["cat-file", "-e", `${targetHash}^{commit}`]);
  if (existsResult.status !== 0) {
    return { ok: false, commitHash: targetHash, message: "该提交不存在或不是有效 commit。" };
  }
  if (!force && hasUncommittedGitChanges(repositoryPath)) {
    return {
      ok: false,
      blockReason: "dirty-worktree",
      commitHash: targetHash,
      message: "当前工作区存在未提交变更，请先提交、暂存或丢弃后再切换提交。",
    };
  }

  const branchTip = detach ? null : chooseGitBranchTip(repositoryPath, targetHash, preferredBranch);
  if (branchTip) {
    const branchResult = runGitResult(
      repositoryPath,
      force ? ["switch", "--discard-changes", "--", branchTip.name] : ["switch", "--", branchTip.name],
    );
    if (branchResult.status !== 0) {
      return {
        ok: false,
        branch: branchTip.name,
        commitHash: targetHash,
        message: firstGitError(branchResult, "切换分支失败。"),
      };
    }

    const headHash = (runGit(repositoryPath, ["rev-parse", "--short", "HEAD"]) || targetHash).trim();
    return {
      ok: true,
      branch: branchTip.name,
      commitHash: headHash,
      isDetachedHead: false,
      message: headHash
        ? `已切换到本地分支 ${branchTip.name}（${headHash}）。`
        : `已切换到本地分支 ${branchTip.name}。`,
    };
  }

  const result = runGitResult(
    repositoryPath,
    force ? ["switch", "--discard-changes", "--detach", targetHash] : ["switch", "--detach", targetHash],
  );
  if (result.status !== 0) {
    return { ok: false, commitHash: targetHash, message: firstGitError(result, "切换到提交失败。") };
  }

  const headHash = (runGit(repositoryPath, ["rev-parse", "--short", "HEAD"]) || targetHash).trim();
  return {
    ok: true,
    commitHash: headHash,
    isDetachedHead: true,
    message: headHash ? `已切换到提交 ${headHash}，当前为 detached HEAD。` : "已切换到该提交，当前为 detached HEAD。",
  };
}

function normalizeGitRefName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateGitRefName(repositoryPath, namespace, name, emptyMessage) {
  if (!name) return emptyMessage;
  const result = runGitResult(repositoryPath, ["check-ref-format", `${namespace}/${name}`]);
  return result.status === 0 ? "" : "引用名称不符合 Git 规则。";
}

function gitRefExists(repositoryPath, fullName) {
  return runGitResult(repositoryPath, ["show-ref", "--verify", "--quiet", fullName]).status === 0;
}

function validateGitCommit(repositoryPath, commitHash) {
  const targetHash = normalizeGitRefName(commitHash);
  return targetHash && runGitResult(repositoryPath, ["cat-file", "-e", `${targetHash}^{commit}`]).status === 0
    ? targetHash
    : "";
}

function gitHistoryActionStatePathExists(repositoryPath, statePath) {
  const result = runGitResult(repositoryPath, ["rev-parse", "--git-path", statePath]);
  const resolvedPath = result.status === 0 ? result.stdout.trim() : "";
  return Boolean(resolvedPath && fs.existsSync(path.resolve(repositoryPath, resolvedPath)));
}

function gitHistoryActionRefExists(repositoryPath, refName) {
  return runGitResult(repositoryPath, ["rev-parse", "--verify", "--quiet", refName]).status === 0;
}

function gitHistoryActionInProgressMessage(repositoryPath, action) {
  const matchingRef = action === "cherry-pick" ? "CHERRY_PICK_HEAD" : "REVERT_HEAD";
  const matchingLabel = action === "cherry-pick" ? "Cherry-pick" : "Revert";
  if (
    gitHistoryActionRefExists(repositoryPath, matchingRef) ||
    gitHistoryActionStatePathExists(repositoryPath, matchingRef)
  ) {
    return `仓库已有未完成的 ${matchingLabel} 操作，请先使用专业 Git 工具处理。`;
  }

  const otherRefs = ["CHERRY_PICK_HEAD", "REVERT_HEAD", "MERGE_HEAD", "REBASE_HEAD"].filter(
    (refName) => refName !== matchingRef,
  );
  if (
    otherRefs.some(
      (refName) =>
        gitHistoryActionRefExists(repositoryPath, refName) || gitHistoryActionStatePathExists(repositoryPath, refName),
    ) ||
    ["rebase-apply", "rebase-merge", "sequencer", "BISECT_LOG", "index.lock"].some((statePath) =>
      gitHistoryActionStatePathExists(repositoryPath, statePath),
    )
  ) {
    return "检测到其他未完成的 Git 操作，请先使用专业 Git 工具处理。";
  }

  return "";
}

function validateGitHistoryActionCommit(repositoryPath, commitHash) {
  const requestedHash = normalizeGitRefName(commitHash);
  if (!/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(requestedHash)) {
    return { targetHash: "", message: "请选择完整的提交 hash。" };
  }

  const resolved = runGitResult(repositoryPath, ["rev-parse", "--verify", "--quiet", `${requestedHash}^{commit}`]);
  const targetHash = resolved.stdout.trim();
  if (resolved.status !== 0 || targetHash.toLowerCase() !== requestedHash.toLowerCase()) {
    return { targetHash: "", message: "目标提交不存在或不是有效 commit。" };
  }

  const stashesResult = runGitResult(repositoryPath, ["stash", "list", "--format=%H"]);
  if (stashesResult.status !== 0) {
    return { targetHash, message: firstGitError(stashesResult, "无法检查 stash 提交。") };
  }
  if (stashesResult.stdout.split(/\r?\n/).some((stashHash) => stashHash.trim() === targetHash)) {
    return { targetHash, message: "stash 提交不能用于 Cherry-pick 或 Revert。" };
  }

  const parentsResult = runGitResult(repositoryPath, ["rev-list", "--parents", "-n", "1", targetHash]);
  if (parentsResult.status !== 0) {
    return { targetHash, message: firstGitError(parentsResult, "无法读取目标提交。") };
  }
  const parents = parentsResult.stdout.trim().split(/\s+/).slice(1).filter(Boolean);
  if (parents.length > 1) {
    return { targetHash, blockReason: "merge-commit", message: "合并提交暂不支持 Cherry-pick 或 Revert。" };
  }

  return { targetHash };
}

function runGitHistoryAction(projectPath, action, commitHash) {
  const repositoryPath = findGitRoot(projectPath);
  const actionLabel = action === "cherry-pick" ? "Cherry-pick" : "Revert";
  const actionHead = action === "cherry-pick" ? "CHERRY_PICK_HEAD" : "REVERT_HEAD";
  if (!repositoryPath) return { ok: false, message: "未检测到 Git 仓库。" };

  const target = validateGitHistoryActionCommit(repositoryPath, commitHash);
  if (!target.targetHash) return { ok: false, message: target.message };
  if (target.message)
    return { ok: false, commitHash: target.targetHash, blockReason: target.blockReason, message: target.message };

  const head = readAttachedGitHead(repositoryPath);
  if (!head.ok) return { ...head, commitHash: target.targetHash };
  const operationMessage = gitHistoryActionInProgressMessage(repositoryPath, action);
  if (operationMessage) return { ok: false, commitHash: target.targetHash, message: operationMessage };
  const worktreeStatus = readGitWorktreeStatus(repositoryPath);
  if (worktreeStatus.status !== 0) {
    return {
      ok: false,
      commitHash: target.targetHash,
      message: `无法检查工作区状态：${firstGitError(worktreeStatus, "Git status 失败。")}`,
    };
  }
  if (worktreeStatus.stdout.trim()) {
    return {
      ok: false,
      blockReason: "dirty-worktree",
      commitHash: target.targetHash,
      message: "当前工作区存在未提交变更，请先提交、暂存或丢弃后再执行。",
    };
  }
  if (action === "cherry-pick" && target.targetHash === head.commitHash) {
    return { ok: false, commitHash: target.targetHash, message: "当前 HEAD 不能 Cherry-pick 到自身。" };
  }

  const result = runGitResult(
    repositoryPath,
    action === "cherry-pick" ? ["cherry-pick", target.targetHash] : ["revert", "--no-edit", target.targetHash],
  );
  if (result.status === 0) {
    return {
      ok: true,
      commitHash: target.targetHash,
      message:
        action === "cherry-pick"
          ? `已将提交 ${target.targetHash.slice(0, 7)} 应用到当前分支。`
          : `已创建撤销提交以回退 ${target.targetHash.slice(0, 7)}。`,
    };
  }

  const operationError = firstGitError(result, `${actionLabel} 失败。`);
  const actionHeadResult = runGitResult(repositoryPath, ["rev-parse", "--verify", "--quiet", actionHead]);
  if (
    actionHeadResult.status !== 0 ||
    actionHeadResult.stdout.trim().toLowerCase() !== target.targetHash.toLowerCase()
  ) {
    return { ok: false, commitHash: target.targetHash, message: operationError };
  }

  const abort = runGitResult(repositoryPath, [action, "--abort"]);
  if (abort.status === 0) {
    return {
      ok: false,
      commitHash: target.targetHash,
      message: `${actionLabel} 发生冲突，已自动中止操作，仓库已恢复。原始错误：${operationError}`,
    };
  }

  return {
    ok: false,
    commitHash: target.targetHash,
    message: `${actionLabel} 发生冲突，自动中止失败。原始错误：${operationError} 自动中止错误：${firstGitError(abort, `${actionLabel} 自动中止失败。`)}`,
  };
}

function cherryPickGitCommit(projectPath, commitHash) {
  return runGitHistoryAction(projectPath, "cherry-pick", commitHash);
}

function revertGitCommit(projectPath, commitHash) {
  return runGitHistoryAction(projectPath, "revert", commitHash);
}

function createGitBranch(projectPath, branchName, commitHash, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const name = normalizeGitRefName(branchName);
  const checkout = Boolean(options && options.checkout);
  const force = Boolean(options && options.force);
  if (!repositoryPath) return { ok: false, message: "未检测到 Git 仓库。" };
  const nameError = validateGitRefName(repositoryPath, "refs/heads", name, "请填写分支名称。");
  if (nameError) return { ok: false, message: nameError };
  const targetHash = validateGitCommit(repositoryPath, commitHash);
  if (!targetHash) return { ok: false, message: "目标提交不存在或不是有效 commit。" };
  if (gitRefExists(repositoryPath, `refs/heads/${name}`))
    return { ok: false, branch: name, message: "本地分支已存在。" };
  if (checkout && !force && hasUncommittedGitChanges(repositoryPath)) {
    return {
      ok: false,
      branch: name,
      blockReason: "dirty-worktree",
      message: "当前工作区存在未提交变更，无法创建并切换分支。",
    };
  }

  const args = checkout
    ? force
      ? ["switch", "--discard-changes", "-c", name, targetHash]
      : ["switch", "-c", name, targetHash]
    : ["branch", "--", name, targetHash];
  const result = runGitResult(repositoryPath, args);
  return result.status === 0
    ? {
        ok: true,
        branch: name,
        commitHash: targetHash,
        message: checkout ? `已创建并切换到分支 ${name}。` : `已创建分支 ${name}。`,
      }
    : { ok: false, branch: name, commitHash: targetHash, message: firstGitError(result, "创建分支失败。") };
}

function createGitTag(projectPath, tagName, commitHash, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const name = normalizeGitRefName(tagName);
  const annotated = Boolean(options && options.annotated);
  const message = typeof options?.message === "string" ? options.message.trim() : "";
  if (!repositoryPath) return { ok: false, message: "未检测到 Git 仓库。" };
  const nameError = validateGitRefName(repositoryPath, "refs/tags", name, "请填写标签名称。");
  if (nameError) return { ok: false, message: nameError };
  if (annotated && !message) return { ok: false, message: "请填写附注标签说明。" };
  const targetHash = validateGitCommit(repositoryPath, commitHash);
  if (!targetHash) return { ok: false, message: "目标提交不存在或不是有效 commit。" };
  if (gitRefExists(repositoryPath, `refs/tags/${name}`)) return { ok: false, message: "标签已存在。" };

  const result = runGitResult(
    repositoryPath,
    annotated ? ["tag", "-a", "-m", message, "--", name, targetHash] : ["tag", "--", name, targetHash],
  );
  return result.status === 0
    ? { ok: true, commitHash: targetHash, message: `已创建${annotated ? "附注" : "轻量"}标签 ${name}。` }
    : { ok: false, commitHash: targetHash, message: firstGitError(result, "创建标签失败。") };
}

function deleteGitTag(projectPath, tagName) {
  const repositoryPath = findGitRoot(projectPath);
  const name = normalizeGitRefName(tagName);
  if (!repositoryPath) return { ok: false, message: "未检测到 Git 仓库。" };
  if (!name || !gitRefExists(repositoryPath, `refs/tags/${name}`)) return { ok: false, message: "标签不存在。" };

  const result = runGitResult(repositoryPath, ["tag", "-d", "--", name]);
  return result.status === 0
    ? { ok: true, message: `已删除标签 ${name}。` }
    : { ok: false, message: firstGitError(result, "删除标签失败。") };
}

function renameGitBranch(projectPath, branchName, nextBranchName) {
  const repositoryPath = findGitRoot(projectPath);
  const name = normalizeGitRefName(branchName);
  const nextName = normalizeGitRefName(nextBranchName);
  if (!repositoryPath) return { ok: false, message: "未检测到 Git 仓库。" };
  if (!gitRefExists(repositoryPath, `refs/heads/${name}`))
    return { ok: false, branch: name, message: "本地分支不存在。" };
  const nameError = validateGitRefName(repositoryPath, "refs/heads", nextName, "请填写新的分支名称。");
  if (nameError) return { ok: false, branch: name, message: nameError };
  if (gitRefExists(repositoryPath, `refs/heads/${nextName}`))
    return { ok: false, branch: nextName, message: "同名本地分支已存在。" };

  const result = runGitResult(repositoryPath, ["branch", "-m", "--", name, nextName]);
  return result.status === 0
    ? { ok: true, branch: nextName, message: `已将分支 ${name} 重命名为 ${nextName}。` }
    : { ok: false, branch: name, message: firstGitError(result, "重命名分支失败。") };
}

function deleteGitBranch(projectPath, branchName, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const name = normalizeGitRefName(branchName);
  const force = Boolean(options && options.force);
  if (!repositoryPath) return { ok: false, message: "未检测到 Git 仓库。" };
  const branch = readGitBranches(repositoryPath).find((item) => item.name === name);
  if (!branch) return { ok: false, branch: name, message: "本地分支不存在。" };
  if (branch.current) return { ok: false, branch: name, message: "不能删除当前检出的分支。" };

  if (!force) {
    const upstreamResult = runGitResult(repositoryPath, ["rev-parse", "--verify", "--quiet", `${name}@{upstream}`]);
    const comparisonRef = upstreamResult.status === 0 ? `${name}@{upstream}` : "HEAD";
    if (
      runGitResult(repositoryPath, ["merge-base", "--is-ancestor", `refs/heads/${name}`, comparisonRef]).status !== 0
    ) {
      return { ok: false, branch: name, blockReason: "unmerged-branch", message: `分支 ${name} 包含尚未合并的提交。` };
    }
  }

  const result = runGitResult(repositoryPath, ["branch", force ? "-D" : "-d", "--", name]);
  return result.status === 0
    ? { ok: true, branch: name, message: force ? `已强制删除分支 ${name}。` : `已删除分支 ${name}。` }
    : { ok: false, branch: name, message: firstGitError(result, "删除分支失败。") };
}

function checkoutGitRemoteBranch(projectPath, remoteRef, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const name = normalizeGitRefName(remoteRef).replace(/^refs\/remotes\//, "");
  const force = Boolean(options && options.force);
  if (!repositoryPath) return { ok: false, message: "未检测到 Git 仓库。" };
  if (!name || !gitRefExists(repositoryPath, `refs/remotes/${name}`))
    return { ok: false, message: "远程跟踪分支不存在。" };
  if (!force && hasUncommittedGitChanges(repositoryPath)) {
    return {
      ok: false,
      branch: name,
      blockReason: "dirty-worktree",
      message: "当前工作区存在未提交变更，无法检出远程分支。",
    };
  }

  const result = runGitResult(
    repositoryPath,
    force ? ["switch", "--discard-changes", "--track", "--", name] : ["switch", "--track", "--", name],
  );
  return result.status === 0
    ? { ok: true, branch: name.split("/").slice(1).join("/"), message: `已检出远程分支 ${name}。` }
    : { ok: false, branch: name, message: firstGitError(result, "检出远程分支失败。") };
}

