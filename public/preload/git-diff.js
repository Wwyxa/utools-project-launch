function normalizeGitDiffOptions(options = {}) {
  const requestedScope = String(options?.scope || "combined");
  return {
    scope: ["combined", "staged", "unstaged"].includes(requestedScope) ? requestedScope : "combined",
    fullFile: options?.fullFile === true,
    ignoreWhitespace: options?.ignoreWhitespace === true,
  };
}

function gitDiffOptionArgs(options) {
  const args = [];
  if (options.fullFile) args.push("--unified=999999999");
  if (options.ignoreWhitespace) args.push("--ignore-space-change", "--ignore-blank-lines");
  return args;
}

function readGitFileDiff(projectPath, relativePath, options = {}) {
  const normalizedOptions = normalizeGitDiffOptions(options);
  const { scope } = normalizedOptions;
  const diffOptions = gitDiffOptionArgs(normalizedOptions);
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { path: relativePath || "", scope, diff: "", message: "未检测到 Git 仓库" };
  }

  const resolved = resolveProjectChild(repositoryPath, relativePath);
  const diffPath = resolved.relativePath;
  if (!diffPath) {
    return { path: "", scope, diff: "", message: "请选择文件查看 diff。" };
  }

  const status = getGitFileStatus(repositoryPath, diffPath);
  const headDiff = scope === "staged" ? "" : runGitDiff(repositoryPath, ["diff", ...diffOptions, "--", diffPath]);
  const cachedDiff =
    scope === "unstaged" ? "" : runGitDiff(repositoryPath, ["diff", "--cached", ...diffOptions, "--", diffPath]);

  const isFileUntracked =
    status?.status === "UNTRACKED" ||
    (fs.existsSync(resolved.targetPath) &&
      fs.statSync(resolved.targetPath).isFile() &&
      runGitResult(repositoryPath, ["ls-files", "--error-unmatch", "--", diffPath]).status !== 0);

  let untrackedDiff = "";
  if (scope !== "staged" && isFileUntracked) {
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    untrackedDiff =
      runGitDiff(repositoryPath, ["diff", "--no-index", ...diffOptions, "--", nullDevice, diffPath]) || "";
    if (!untrackedDiff) {
      try {
        const content = fs.readFileSync(resolved.targetPath, "utf-8");
        const lines = content.split(/\r?\n/);
        untrackedDiff = `diff --git a/${diffPath} b/${diffPath}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/${diffPath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`;
      } catch (readErr) {
        untrackedDiff = "";
      }
    }
  }

  const diff = [cachedDiff, headDiff, untrackedDiff].filter(Boolean).join("\n");

  return {
    path: diffPath,
    scope,
    diff,
    message:
      diff || scope === "combined"
        ? diff
          ? ""
          : "该文件暂无可显示的 diff。"
        : scope === "staged"
          ? "该文件暂无已暂存 diff。"
          : "该文件暂无未暂存 diff。",
  };
}

function parseGitCommitFileChanges(numstatOutput, statusOutput) {
  const numstatLines = numstatOutput.split(/\r?\n/);
  const statusLines = statusOutput.split(/\r?\n/);
  const statusByPath = new Map();

  statusLines.forEach((line) => {
    const parts = line.split(/\t+/).filter(Boolean);
    if (parts.length < 2) return;
    const code = parts[0];
    const filePath = parts[parts.length - 1];
    statusByPath.set(
      filePath,
      code.startsWith("A") ? "ADDED" : code.startsWith("D") ? "DELETED" : code.startsWith("R") ? "RENAMED" : "MODIFIED",
    );
  });

  return numstatLines
    .map((line) => line.split(/\t+/).filter(Boolean))
    .filter((parts) => parts.length >= 3)
    .map((parts) => {
      const filePath = parts[parts.length - 1];
      return {
        path: filePath,
        additions: parts[0] === "-" ? 0 : Number(parts[0]) || 0,
        deletions: parts[1] === "-" ? 0 : Number(parts[1]) || 0,
        status: statusByPath.get(filePath) || "MODIFIED",
      };
    });
}

function readGitFileChanges(repositoryPath, numstatArgs, statusArgs) {
  const numstatOutput = runGit(repositoryPath, numstatArgs);
  const statusOutput = runGit(repositoryPath, statusArgs);
  if (numstatOutput === null || statusOutput === null) {
    throw new Error("无法读取提交变更。");
  }
  return parseGitCommitFileChanges(numstatOutput, statusOutput);
}

function normalizeGitStashDiffDetails(value) {
  if (!value || typeof value !== "object") return null;
  const baseHash = typeof value.baseHash === "string" ? value.baseHash.trim() : "";
  const untrackedFilesHash = typeof value.untrackedFilesHash === "string" ? value.untrackedFilesHash.trim() : "";
  return baseHash ? { baseHash, untrackedFilesHash: untrackedFilesHash || null } : null;
}

function readGitStashFileChanges(repositoryPath, hash, stash) {
  const gitPathOptions = ["-c", "core.quotePath=false"];
  const trackedChanges = readGitFileChanges(
    repositoryPath,
    [...gitPathOptions, "diff", "--numstat", stash.baseHash, hash],
    [...gitPathOptions, "diff", "--name-status", stash.baseHash, hash],
  );
  if (!stash.untrackedFilesHash) return trackedChanges;

  const untrackedChanges = readGitFileChanges(
    repositoryPath,
    [...gitPathOptions, "diff-tree", "--no-commit-id", "--root", "-r", "--numstat", stash.untrackedFilesHash],
    [...gitPathOptions, "diff-tree", "--no-commit-id", "--root", "-r", "--name-status", stash.untrackedFilesHash],
  ).map((file) => ({ ...file, status: file.status === "ADDED" ? "UNTRACKED" : file.status }));
  return [...trackedChanges, ...untrackedChanges];
}

function readGitCommitFiles(projectPath, commitHash, stash) {
  const repositoryPath = findGitRoot(projectPath);
  const hash = String(commitHash || "").trim();
  if (!repositoryPath) {
    throw new Error("未检测到 Git 仓库。");
  }
  if (!hash) {
    return [];
  }

  const stashDetails = normalizeGitStashDiffDetails(stash);
  if (stashDetails) {
    return readGitStashFileChanges(repositoryPath, hash, stashDetails);
  }

  const gitPathOptions = ["-c", "core.quotePath=false"];
  return readGitFileChanges(
    repositoryPath,
    [...gitPathOptions, "show", "--format=", "--numstat", hash],
    [...gitPathOptions, "show", "--format=", "--name-status", hash],
  );
}

function readGitStashFileDiff(repositoryPath, hash, relativePath, stash, diffOptions) {
  const trackedDiff = runGitDiff(repositoryPath, ["diff", ...diffOptions, stash.baseHash, hash, "--", relativePath]);
  if (trackedDiff) return trackedDiff;
  if (!stash.untrackedFilesHash) return "";
  return (
    runGitDiff(repositoryPath, [
      "diff-tree",
      "--no-commit-id",
      "--root",
      "-r",
      "-p",
      ...diffOptions,
      stash.untrackedFilesHash,
      "--",
      relativePath,
    ]) || ""
  );
}

function readGitCommitFileDiff(projectPath, commitHash, relativePath, stash, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const hash = String(commitHash || "").trim();
  const filePath = String(relativePath || "").trim();
  if (!repositoryPath || !hash || !filePath) {
    return { path: filePath, diff: "", message: "提交或文件信息为空，无法读取 diff。" };
  }

  const resolved = resolveProjectChild(repositoryPath, filePath);
  const stashDetails = normalizeGitStashDiffDetails(stash);
  const diffOptions = gitDiffOptionArgs(normalizeGitDiffOptions(options));
  const diff = stashDetails
    ? readGitStashFileDiff(repositoryPath, hash, resolved.relativePath, stashDetails, diffOptions)
    : runGitDiff(repositoryPath, ["show", "--format=", ...diffOptions, hash, "--", resolved.relativePath]) || "";
  return {
    path: resolved.relativePath,
    diff,
    message: diff ? "" : "该提交中此文件暂无可显示的 diff。",
  };
}

function listProjectSubdirectories(projectPath) {
  const resolvedPath = expandPath(projectPath);

  try {
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
      return ["."];
    }

    const visibleDirectories = (directoryPath) =>
      fs
        .readdirSync(directoryPath, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            !entry.name.startsWith(".") &&
            !ignoredFileTreeDirs.has(entry.name),
        )
        .sort((left, right) => left.name.localeCompare(right.name));

    return visibleDirectories(resolvedPath).reduce(
      (suggestions, entry) => [
        ...suggestions,
        entry.name,
        ...visibleDirectories(path.join(resolvedPath, entry.name)).map((child) => `${entry.name}/${child.name}`),
      ],
      ["."],
    );
  } catch (error) {
    return ["."];
  }
}

async function inspectProjectPath(projectPath) {
  const resolvedPath = expandPath(projectPath);
  const exists = pathExists(projectPath);
  const result = {
    pathExists: exists,
    name: path.basename(resolvedPath),
    branch: "main",
    scripts: [],
    packagePath: null,
    git: null,
    gitLatestCommitAt: "",
  };

  if (!exists) {
    return {
      ...result,
      message: "路径不存在或当前设备无法访问，可手动保存后稍后重新定位。",
    };
  }

  result.git = await readGitSnapshot(projectPath);
  result.gitLatestCommitAt = result.git?.commits?.[0]?.date || "";
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

async function pickQuickLinkPath() {
  if (!window.utools?.showOpenDialog) {
    return { canceled: true, message: "当前环境不支持系统路径选择器，请手动填写路径。" };
  }

  const selected = await window.utools.showOpenDialog({
    title: "选择快捷访问路径",
    properties: ["openFile", "openDirectory"],
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

function parseGitWorkingTreeFiles(repositoryPath, statusEntries, numstatOutput, cachedNumstatOutput) {
  const fileMap = new Map();

  statusEntries.forEach((entry) => {
    const pathStats = numstatOutput.get(entry.path) ?? cachedNumstatOutput.get(entry.path);
    const originalPathStats = entry.originalPath
      ? (numstatOutput.get(entry.originalPath) ?? cachedNumstatOutput.get(entry.originalPath))
      : null;
    const additions = pathStats?.additions ?? originalPathStats?.additions ?? 0;
    const deletions = pathStats?.deletions ?? originalPathStats?.deletions ?? 0;

    // 如果路径以 / 结尾，说明是未跟踪的文件夹，需要展开
    if (entry.path.endsWith("/") || entry.path.endsWith("\\")) {
      const folderPath = path.join(repositoryPath, entry.path);
      try {
        // 递归读取文件夹下的所有文件
        const expandedFiles = [];
        function walkDir(dirPath, basePath) {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const ent of entries) {
            const fullPath = path.join(dirPath, ent.name);
            const relativePath = path.relative(repositoryPath, fullPath).replace(/\\/g, "/");
            if (ent.isDirectory()) {
              walkDir(fullPath, basePath);
            } else if (ent.isFile()) {
              // 计算新文件的行数作为 additions
              let lineCount = 0;
              try {
                const content = fs.readFileSync(fullPath, "utf-8");
                lineCount = content.split(/\r?\n/).length;
              } catch (err) {
                lineCount = 0;
              }
              expandedFiles.push({
                path: relativePath,
                originalPath: undefined,
                additions: lineCount,
                deletions: 0,
                status: "UNTRACKED",
                staged: false,
                unstaged: true,
              });
            }
          }
        }
        walkDir(folderPath, entry.path);
        // 将展开的文件添加到 fileMap
        expandedFiles.forEach((file) => {
          fileMap.set(file.path, file);
        });
      } catch (err) {
        // 如果读取失败，保留原始文件夹条目（稍后过滤）
        fileMap.set(entry.path, {
          path: entry.path,
          originalPath: entry.originalPath,
          additions,
          deletions,
          status: entry.status,
          staged: entry.staged,
          unstaged: entry.unstaged,
        });
      }
    } else {
      fileMap.set(entry.path, {
        path: entry.path,
        originalPath: entry.originalPath,
        additions,
        deletions,
        status: entry.status,
        staged: entry.staged,
        unstaged: entry.unstaged,
      });
    }
  });

  return {
    files: Array.from(fileMap.values()).filter((file) => {
      // 过滤掉文件夹条目（路径以 / 或 \ 结尾）
      return !file.path.endsWith("/") && !file.path.endsWith("\\");
    }),
    changeCount: fileMap.size,
  };
}

async function readGitWorkingTreeData(repositoryPath) {
  const result = await readGitWorkingTreeDataResult(repositoryPath);
  return result.ok ? result.value : { files: [], changeCount: 0 };
}

async function readGitWorkingTreeDataResult(repositoryPath) {
  const [statusResult, numstatResult, cachedNumstatResult] = await Promise.all([
    readGitStatusEntriesAsyncResult(repositoryPath),
    collectNumstatAsyncResult(repositoryPath, ["diff", "--numstat"]),
    collectNumstatAsyncResult(repositoryPath, ["diff", "--cached", "--numstat"]),
  ]);
  const failedResult = [statusResult, numstatResult, cachedNumstatResult].find((result) => !result.ok);
  if (failedResult && !failedResult.ok) return failedResult;
  return {
    ok: true,
    value: parseGitWorkingTreeFiles(repositoryPath, statusResult.value, numstatResult.value, cachedNumstatResult.value),
  };
}

async function readGitWorkingTreeSnapshotResult(projectPath) {
  const now = new Date().toISOString();
  const rootResult = await findGitRootAsyncResult(projectPath);

  if (!rootResult.ok) {
    return {
      ok: false,
      value: null,
      failure: rootResult.failure,
    };
  }

  const repositoryPath = rootResult.repositoryPath;
  const workingTreeResult = await readGitWorkingTreeDataResult(repositoryPath);
  if (!workingTreeResult.ok) return { ...workingTreeResult, value: null };
  const workingTree = workingTreeResult.value;
  return {
    ok: true,
    value: {
      files: workingTree.files,
      repositoryPath,
      lastRefreshedAt: now,
      statusText: workingTree.changeCount === 0 ? "工作区干净" : `${workingTree.changeCount} 个文件变更`,
    },
  };
}

async function readGitWorkingTreeSnapshot(projectPath) {
  const result = await readGitWorkingTreeSnapshotResult(projectPath);
  return result.ok
    ? result.value
    : {
        files: [],
        repositoryPath: "",
        lastRefreshedAt: new Date().toISOString(),
        statusText: result.failure.message,
      };
}

async function readGitStatusSnapshotResult(projectPath) {
  const now = new Date().toISOString();
  const rootResult = await findGitRootAsyncResult(projectPath);

  if (!rootResult.ok) {
    return {
      ok: false,
      value: createEmptyGitStatusSnapshot(
        "",
        now,
        rootResult.failure.code === "git-unavailable" ? rootResult.failure.message : "未检测到 Git 仓库",
      ),
      failure: rootResult.failure,
    };
  }

  const repositoryPath = rootResult.repositoryPath;
  const [branchOutput, symbolicBranchOutput, headHashOutput, workingTreeResult, branchesResult, remotesResult] =
    await Promise.all([
      runGitAsyncResult(repositoryPath, ["status", "--short", "--branch"]),
      runGitAsync(repositoryPath, ["symbolic-ref", "--short", "-q", "HEAD"]),
      runGitAsync(repositoryPath, ["rev-parse", "--short", "HEAD"]),
      readGitWorkingTreeDataResult(repositoryPath),
      readGitBranchesAsyncResult(repositoryPath),
      readGitRemotesAsyncResult(repositoryPath),
    ]);
  if (!branchOutput.ok) {
    return {
      ok: false,
      value: null,
      failure: createGitReadFailure("status", branchOutput, "读取 Git 状态失败"),
    };
  }
  const failedResult = [workingTreeResult, branchesResult, remotesResult].find((result) => !result.ok);
  if (failedResult && !failedResult.ok) return { ...failedResult, value: null };

  const symbolicBranch = String(symbolicBranchOutput || "").trim();
  const headHash = String(headHashOutput || "").trim();
  const isDetachedHead = !symbolicBranch && Boolean(headHash);
  const branchLine = branchOutput.stdout ? branchOutput.stdout.split(/\r?\n/)[0] : "";
  const branchMatch = branchLine.match(/^##\s+([^\.\s]+)(?:\.\.\.(?:[^\s]+))?(?:\s+\[(.+)\])?/);
  const branch = symbolicBranch || (isDetachedHead ? "HEAD" : branchMatch?.[1] || "main");
  const upstreamInfo = branchMatch?.[2] || "";
  const aheadMatch = upstreamInfo.match(/ahead\s+(\d+)/);
  const behindMatch = upstreamInfo.match(/behind\s+(\d+)/);
  const upstreamResult = await readGitUpstreamAsyncResult(repositoryPath, symbolicBranch);
  if (!upstreamResult.ok) return { ...upstreamResult, value: null };
  const workingTree = workingTreeResult.value;
  const branches = branchesResult.value;
  const remotes = remotesResult.value;
  const upstream = upstreamResult.value;
  const ahead = upstream?.ahead ?? (aheadMatch ? Number(aheadMatch[1]) : 0);
  const behind = upstream?.behind ?? (behindMatch ? Number(behindMatch[1]) : 0);
  const base = await readGitBranchBaseAsync(repositoryPath, symbolicBranch, remotes, upstream);
  const remoteBranchesResult = await readGitRemoteBranchesAsyncResult(repositoryPath, remotes);
  if (!remoteBranchesResult.ok) return { ...remoteBranchesResult, value: null };
  const remoteBranches = remoteBranchesResult.value;

  return {
    ok: true,
    value: {
      branch,
      headHash,
      isDetachedHead,
      ahead,
      behind,
      files: workingTree.files,
      branches,
      remotes,
      remoteBranches,
      upstream,
      base,
      repositoryPath,
      lastRefreshedAt: now,
      statusText: `${isDetachedHead && headHash ? `detached HEAD @ ${headHash} · ` : ""}${workingTree.changeCount === 0 ? "工作区干净" : `${workingTree.changeCount} 个文件变更`}`,
    },
  };
}

async function readGitStatusSnapshot(projectPath) {
  const result = await readGitStatusSnapshotResult(projectPath);
  return result.value || createEmptyGitStatusSnapshot("", new Date().toISOString(), result.failure.message);
}

function fetchGitRemote(projectPath) {
  return runGitRemoteResult(
    projectPath,
    (upstream) => ["fetch", "--progress", "--prune", upstream.remote],
    (upstream) => `已从 ${upstream.remote} 获取远程更新。`,
  );
}

async function fetchGitRemoteByName(projectPath, remoteName) {
  const remoteContext = await resolveNamedGitRemoteOperation(projectPath, remoteName);
  if (!remoteContext.ok) {
    return { ok: false, remote: remoteContext.remote, message: remoteContext.message };
  }

  const result = await runGitRemoteCommandResult(remoteContext.repositoryPath, [
    "fetch",
    "--progress",
    "--prune",
    remoteContext.remote,
  ]);
  return result.status === 0
    ? { ok: true, remote: remoteContext.remote, message: `已从 ${remoteContext.remote} 获取远程更新。` }
    : {
        ok: false,
        remote: remoteContext.remote,
        message: firstGitError(result, "刷新 remote 分支失败。"),
      };
}

function pullGitRemote(projectPath) {
  return runGitRemoteResult(
    projectPath,
    (upstream) => ["pull", "--progress", "--ff", "--no-rebase", upstream.remote, upstream.branch],
    (upstream) => `已从 ${upstream.ref} 拉取更新。`,
  );
}

function normalizeGitPushTagNames(options = {}) {
  if (!Array.isArray(options?.tagNames)) return [];
  return [
    ...new Set(options.tagNames.map((tagName) => (typeof tagName === "string" ? tagName.trim() : "")).filter(Boolean)),
  ];
}

async function pushGitTag(projectPath, tagName, remoteName = "") {
  const name = normalizeGitRefName(tagName);
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) return { ok: false, message: "未检测到 Git 仓库。" };
  const nameError = validateGitRefName(repositoryPath, "refs/tags", name, "请输入标签名称。");
  if (nameError) return { ok: false, message: nameError };
  if (!gitRefExists(repositoryPath, `refs/tags/${name}`)) return { ok: false, message: "标签不存在。" };

  const requestedRemote = normalizeGitRemoteName(remoteName);
  const remoteContext = requestedRemote
    ? await resolveNamedGitRemoteOperation(projectPath, requestedRemote)
    : await (async () => {
        const upstream = await readGitUpstreamAsync(repositoryPath);
        if (upstream) return { ok: true, repositoryPath, remote: upstream.remote };
        const remotes = await readGitRemotesAsync(repositoryPath);
        return remotes.length === 1
          ? { ok: true, repositoryPath, remote: remotes[0].name }
          : {
              ok: false,
              repositoryPath,
              message: remotes.length > 1 ? "当前仓库有多个 remote，请指定推送目标。" : "当前仓库未配置 remote。",
            };
      })();
  if (!remoteContext.ok) return { ok: false, remote: remoteContext.remote, message: remoteContext.message };

  const result = await runGitRemoteCommandResult(remoteContext.repositoryPath, [
    "push",
    "--progress",
    remoteContext.remote,
    `refs/tags/${name}:refs/tags/${name}`,
  ]);
  return result.status === 0
    ? { ok: true, remote: remoteContext.remote, message: `已将标签 ${name} 推送到 ${remoteContext.remote}。` }
    : {
        ok: false,
        remote: remoteContext.remote,
        message: firstGitError(result, "推送 Git 标签失败。"),
      };
}

function pushGitRemote(projectPath, options = {}) {
  const tagNames = normalizeGitPushTagNames(options);
  return runGitRemoteResult(
    projectPath,
    (upstream) => [
      "push",
      "--progress",
      upstream.remote,
      `HEAD:${upstream.branch}`,
      ...tagNames.map((tagName) => `refs/tags/${tagName}:refs/tags/${tagName}`),
    ],
    (upstream) =>
      tagNames.length > 0
        ? `已推送到 ${upstream.ref}，并推送 ${tagNames.length} 个标签。`
        : `已推送到 ${upstream.ref}。`,
  );
}

function initializeGitRepository(projectPath) {
  const projectDirectory = typeof projectPath === "string" ? projectPath.trim() : "";
  if (!projectDirectory) {
    return { ok: false, message: "项目目录不可用，无法初始化 Git 仓库。" };
  }

  try {
    if (!fs.statSync(expandPath(projectDirectory)).isDirectory()) {
      return { ok: false, message: "项目目录不可用，无法初始化 Git 仓库。" };
    }
  } catch {
    return { ok: false, message: "项目目录不可用，无法初始化 Git 仓库。" };
  }

  const result = runGitResult(projectDirectory, ["init"]);
  return result.status === 0
    ? { ok: true, message: "已初始化 Git 仓库。" }
    : { ok: false, message: firstGitError(result, "初始化 Git 仓库失败。") };
}

async function publishGitBranch(projectPath, remoteName) {
  const repositoryPath = await findGitRootAsync(projectPath);
  const name = normalizeGitRemoteName(remoteName);
  const nameError = validateGitRemoteName(name);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (nameError) {
    return { ok: false, message: nameError };
  }

  const remotes = await readGitRemotesAsync(repositoryPath);
  if (!remotes.some((remote) => remote.name === name)) {
    return { ok: false, remote: name, message: `未找到 remote：${name}。` };
  }

  const headRef = String((await runGitAsync(repositoryPath, ["symbolic-ref", "-q", "HEAD"])) || "").trim();
  if (!headRef) {
    return { ok: false, remote: name, message: "当前 HEAD 处于 detached 状态，无法发布当前分支。" };
  }
  const localBranchPrefix = "refs/heads/";
  if (!headRef.startsWith(localBranchPrefix) || headRef.length === localBranchPrefix.length) {
    return { ok: false, remote: name, message: "当前 HEAD 未指向本地分支，无法发布当前分支。" };
  }
  const branch = headRef.slice(localBranchPrefix.length);

  const headCommit = String(
    (await runGitAsync(repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"])) || "",
  ).trim();
  if (!headCommit) {
    return { ok: false, remote: name, branch, message: "当前分支尚无提交，无法发布。" };
  }

  const upstream = await readGitUpstreamAsync(repositoryPath);
  if (upstream) {
    return { ok: false, remote: name, branch, message: `当前分支已设置 upstream：${upstream.ref}。` };
  }

  const result = await runGitRemoteCommandResult(repositoryPath, [
    "push",
    "--progress",
    "--set-upstream",
    name,
    `HEAD:${branch}`,
  ]);
  return result.status === 0
    ? { ok: true, remote: name, branch, message: `已发布 ${branch} 到 ${name}/${branch} 并设置 upstream。` }
    : { ok: false, remote: name, branch, message: firstGitError(result, "发布当前分支失败。") };
}

async function addGitRemote(projectPath, remoteName, remoteUrl) {
  const repositoryPath = await findGitRootAsync(projectPath);
  const name = normalizeGitRemoteName(remoteName);
  const url = normalizeGitRemoteUrl(remoteUrl);
  const nameError = validateGitRemoteName(name);
  const urlError = validateGitRemoteUrl(url);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (nameError) {
    return { ok: false, message: nameError };
  }
  if (urlError) {
    return { ok: false, remote: name, message: urlError };
  }

  const result = runGitResult(repositoryPath, ["remote", "add", name, url]);
  return result.status === 0
    ? { ok: true, remote: name, message: `已添加 remote：${name}。` }
    : { ok: false, remote: name, message: firstGitError(result, "添加 remote 失败。") };
}

async function setGitRemoteUrl(projectPath, remoteName, remoteUrl) {
  const repositoryPath = await findGitRootAsync(projectPath);
  const name = normalizeGitRemoteName(remoteName);
  const url = normalizeGitRemoteUrl(remoteUrl);
  const nameError = validateGitRemoteName(name);
  const urlError = validateGitRemoteUrl(url);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (nameError) {
    return { ok: false, message: nameError };
  }
  if (urlError) {
    return { ok: false, remote: name, message: urlError };
  }

  const result = runGitResult(repositoryPath, ["remote", "set-url", name, url]);
  return result.status === 0
    ? { ok: true, remote: name, message: `已更新 ${name} 的 URL。` }
    : { ok: false, remote: name, message: firstGitError(result, "更新 remote URL 失败。") };
}

async function unsetGitUpstreamsForDeletedRemoteBranch(repositoryPath, remoteName, branchName) {
  const fieldSeparator = "\x1f";
  const deletedRemoteRef = `${remoteName}/${branchName}`;
  const branchesResult = await runGitAsyncResult(repositoryPath, [
    "for-each-ref",
    `--format=%(refname:short)${fieldSeparator}%(upstream:short)`,
    "refs/heads",
  ]);
  if (!branchesResult.ok) {
    return firstGitError(branchesResult, "无法读取本地分支 upstream。");
  }

  const trackingBranches = branchesResult.stdout
    .split(/\r?\n/)
    .map((line) => {
      const [branch, upstream] = line.split(fieldSeparator);
      return String(upstream || "").trim() === deletedRemoteRef ? String(branch || "").trim() : "";
    })
    .filter(Boolean);
  for (const localBranch of trackingBranches) {
    const unsetResult = await runGitAsyncResult(repositoryPath, ["branch", "--unset-upstream", "--", localBranch]);
    if (!unsetResult.ok) {
      return firstGitError(unsetResult, `无法解除本地分支 ${localBranch} 的 upstream。`);
    }
  }

  return "";
}

async function removeGitRemote(projectPath, remoteName) {
  const repositoryPath = await findGitRootAsync(projectPath);
  const name = normalizeGitRemoteName(remoteName);
  const nameError = validateGitRemoteName(name);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (nameError) {
    return { ok: false, message: nameError };
  }

  const result = runGitResult(repositoryPath, ["remote", "remove", name]);
  return result.status === 0
    ? { ok: true, remote: name, message: `已删除 remote：${name}。` }
    : { ok: false, remote: name, message: firstGitError(result, "删除 remote 失败。") };
}

function readGitTagInfo(projectPath, tagName) {
  const repositoryPath = findGitRoot(projectPath);
  const name = normalizeGitRefName(tagName);
  if (!repositoryPath || !name) return null;
  if (validateGitRefName(repositoryPath, "refs/tags", name, "请输入标签名称。")) return null;

  const fullRef = `refs/tags/${name}`;
  if (!gitRefExists(repositoryPath, fullRef)) return null;

  const objectHash = (runGit(repositoryPath, ["rev-parse", fullRef]) || "").trim();
  const objectType = (runGit(repositoryPath, ["cat-file", "-t", fullRef]) || "").trim();
  if (!objectHash || !objectType) return null;

  if (objectType === "commit") {
    const targetHash = (runGit(repositoryPath, ["rev-parse", `${fullRef}^{commit}`]) || "").trim();
    return targetHash ? { name, kind: "lightweight", targetHash, objectHash, message: "" } : null;
  }
  if (objectType !== "tag") return null;

  const rawTag = runGit(repositoryPath, ["cat-file", "-p", fullRef]);
  if (rawTag === null) return null;
  const objectMatch = rawTag.match(/^object ([0-9a-f]{40,64})$/m);
  const typeMatch = rawTag.match(/^type ([^\r\n]+)$/m);
  if (!objectMatch || typeMatch?.[1] !== "commit") return null;

  const targetHash = (runGit(repositoryPath, ["rev-parse", `${objectMatch[1]}^{commit}`]) || "").trim();
  if (!targetHash) return null;
  const headerEnd = rawTag.match(/\r?\n\r?\n/);
  const message =
    headerEnd?.index === undefined
      ? ""
      : rawTag
          .slice(headerEnd.index + headerEnd[0].length)
          .replace(/\r\n/g, "\n")
          .trim();
  const tagger = rawTag.match(/^tagger ([^\r\n]+)$/m)?.[1]?.trim() || "";
  return {
    name,
    kind: "annotated",
    targetHash,
    objectHash,
    message,
    ...(tagger ? { tagger } : {}),
  };
}

async function deleteGitRemoteBranch(projectPath, remoteName, branchName) {
  const remoteContext = await resolveNamedGitRemoteOperation(projectPath, remoteName);
  if (!remoteContext.ok) {
    return { ok: false, remote: remoteContext.remote, message: remoteContext.message };
  }

  const branch = normalizeGitRefName(branchName);
  const branchError = validateGitRefName(remoteContext.repositoryPath, "refs/heads", branch, "请填写远端分支名称。");
  if (branchError) {
    return { ok: false, remote: remoteContext.remote, branch, message: branchError };
  }
  if (branch === "HEAD") {
    return { ok: false, remote: remoteContext.remote, branch, message: "不能删除 remote 的 HEAD 符号引用。" };
  }

  const result = await runGitRemoteCommandResult(remoteContext.repositoryPath, [
    "push",
    "--progress",
    "--delete",
    remoteContext.remote,
    `refs/heads/${branch}`,
  ]);
  if (result.status !== 0) {
    return {
      ok: false,
      remote: remoteContext.remote,
      branch,
      message: firstGitError(result, "删除远端分支失败。"),
    };
  }

  const upstreamError = await unsetGitUpstreamsForDeletedRemoteBranch(
    remoteContext.repositoryPath,
    remoteContext.remote,
    branch,
  );
  return upstreamError
    ? {
        ok: false,
        remote: remoteContext.remote,
        branch,
        message: `已从 ${remoteContext.remote} 删除远端分支 ${branch}，但无法解除本地 upstream：${upstreamError}`,
      }
    : {
        ok: true,
        remote: remoteContext.remote,
        branch,
        message: `已从 ${remoteContext.remote} 删除远端分支 ${branch}。`,
      };
}

async function readGitStashes(repositoryPath) {
  const result = await readGitStashesResult(repositoryPath);
  return result.ok ? result.value : [];
}

async function readGitStashesResult(repositoryPath) {
  const fieldSeparator = "\x1f";
  const stashResult = await runGitAsyncResult(repositoryPath, [
    "stash",
    "list",
    `--format=%H${fieldSeparator}%P${fieldSeparator}%an${fieldSeparator}%ad${fieldSeparator}%s`,
    "--date=iso-strict",
  ]);
  if (!stashResult.ok) {
    return {
      ok: false,
      failure: createGitReadFailure("history", stashResult, "读取 Git stash 失败"),
    };
  }
  const stashes = [];

  stashResult.stdout.split(/\r?\n/).forEach((line, index) => {
    const [hash, parentText, author, date, message] = line.split(fieldSeparator);
    const parents = parentText ? parentText.split(" ").filter(Boolean) : [];
    const baseHash = parents[0];
    if (!hash || !baseHash) return;
    stashes.push({
      hash,
      baseHash,
      selector: `stash@{${index}}`,
      untrackedFilesHash: parents.length === 3 ? parents[2] || null : null,
      author: author || "",
      date: date || "",
      message: message || "",
    });
  });

  return { ok: true, value: stashes };
}

async function readGitCommitRefs(repositoryPath, stashes = []) {
  const result = await readGitCommitRefsResult(repositoryPath, stashes);
  return result.ok ? result.value : new Map();
}

async function readGitCommitRefsResult(repositoryPath, stashes = []) {
  const fieldSeparator = "\x1f";
  const [refResult, symbolicHead, headHash] = await Promise.all([
    runGitAsyncResult(repositoryPath, [
      "for-each-ref",
      `--format=%(objectname)${fieldSeparator}%(*objectname)${fieldSeparator}%(refname)`,
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ]),
    runGitAsync(repositoryPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    runGitAsync(repositoryPath, ["rev-parse", "HEAD"]),
  ]);
  if (!refResult.ok) {
    return {
      ok: false,
      failure: createGitReadFailure("history", refResult, "读取 Git 提交引用失败"),
    };
  }
  const refsByCommit = new Map();
  const currentBranch = String(symbolicHead || "").trim();

  const addRef = (commitHash, ref) => {
    if (!commitHash) return;
    const refs = refsByCommit.get(commitHash) || [];
    refs.push(ref);
    refsByCommit.set(commitHash, refs);
  };

  refResult.stdout.split(/\r?\n/).forEach((line) => {
    const [objectHash, peeledHash, fullName] = line.split(fieldSeparator);
    if (!fullName) return;
    if (fullName.startsWith("refs/heads/")) {
      const name = fullName.slice("refs/heads/".length);
      addRef(objectHash, { kind: "local", name, head: name === currentBranch || undefined });
    } else if (fullName.startsWith("refs/remotes/")) {
      addRef(objectHash, { kind: "remote", name: fullName.slice("refs/remotes/".length) });
    } else if (fullName.startsWith("refs/tags/")) {
      addRef(peeledHash || objectHash, { kind: "tag", name: fullName.slice("refs/tags/".length) });
    }
  });

  stashes.forEach((stash) => addRef(stash.hash, { kind: "stash", name: stash.selector }));

  const currentHash = String(headHash || "").trim();
  if (currentHash) {
    addRef(currentHash, {
      kind: "head",
      name: currentBranch ? `HEAD -> ${currentBranch}` : "HEAD",
      head: true,
    });
  }
  return { ok: true, value: refsByCommit };
}

function insertGitStashes(commits, stashes, refsByCommit) {
  const stashesByHash = new Map();
  const stashesByBaseHash = new Map();
  const stashMetadata = (stash) => ({
    selector: stash.selector,
    baseHash: stash.baseHash,
    untrackedFilesHash: stash.untrackedFilesHash,
  });

  stashes.forEach((stash) => {
    if (stashesByHash.has(stash.hash)) return;
    stashesByHash.set(stash.hash, stash);
    const baseStashes = stashesByBaseHash.get(stash.baseHash) || [];
    baseStashes.push(stash);
    stashesByBaseHash.set(stash.baseHash, baseStashes);
  });

  const insertedStashHashes = new Set();
  const stashCommit = (stash) => ({
    hash: stash.hash,
    parents: [stash.baseHash],
    author: stash.author,
    date: stash.date,
    refs: stash.selector,
    refNames: refsByCommit.get(stash.hash) || [{ kind: "stash", name: stash.selector }],
    stash: stashMetadata(stash),
    message: stash.message,
    body: stash.message,
  });
  const displayedCommits = [];

  commits.forEach((commit) => {
    const baseStashes = stashesByBaseHash.get(commit.hash) || [];
    baseStashes.forEach((stash) => {
      if (insertedStashHashes.has(stash.hash)) return;
      displayedCommits.push(stashCommit(stash));
      insertedStashHashes.add(stash.hash);
    });

    const matchingStash = stashesByHash.get(commit.hash);
    if (matchingStash) {
      displayedCommits.push({
        ...commit,
        parents: [matchingStash.baseHash],
        refs: matchingStash.selector,
        refNames: refsByCommit.get(commit.hash) || commit.refNames,
        stash: stashMetadata(matchingStash),
      });
      insertedStashHashes.add(commit.hash);
      return;
    }
    displayedCommits.push(commit);
  });

  return displayedCommits;
}

async function readGitCommitsResult(projectPath, options = {}) {
  const now = new Date().toISOString();
  const limit = Math.min(100, Math.max(20, Number(options.limit) || 80));
  const skip = Math.max(0, Number(options.skip) || 0);
  const rootResult = await findGitRootAsyncResult(projectPath);

  if (!rootResult.ok) {
    return {
      ok: false,
      value: createEmptyGitCommitPage("", now),
      failure: rootResult.failure,
    };
  }

  const repositoryPath = rootResult.repositoryPath;
  const stashesResult = await readGitStashesResult(repositoryPath);
  if (!stashesResult.ok) return { ...stashesResult, value: null };
  const stashes = stashesResult.value;
  const stashBaseHashes = [...new Set(stashes.map((stash) => stash.baseHash))];
  const [headStatusResult, commitOutputResult, refsResult, commitCountResult] = await Promise.all([
    runGitAsyncResult(repositoryPath, ["status", "--short", "--branch"]),
    runGitAsyncResult(repositoryPath, [
      "log",
      "--topo-order",
      "--decorate=short",
      `--max-count=${limit + 1}`,
      `--skip=${skip}`,
      "--shortstat",
      `--pretty=format:${gitCommitRecordSeparator}%H${gitCommitFieldSeparator}%P${gitCommitFieldSeparator}%an${gitCommitFieldSeparator}%ad${gitCommitFieldSeparator}%D${gitCommitFieldSeparator}%s${gitCommitFieldSeparator}%B${gitCommitShortStatSeparator}`,
      "--date=iso-strict",
      "--branches",
      "--tags",
      "--remotes",
      "HEAD",
      ...stashBaseHashes,
      "--",
    ]),
    readGitCommitRefsResult(repositoryPath, stashes),
    runGitAsyncResult(repositoryPath, ["rev-list", "--count", "HEAD"]),
  ]);

  const isUnbornRepository =
    headStatusResult.ok && /^##\s+No commits yet(?:\s|$)/i.test(headStatusResult.stdout.split(/\r?\n/)[0] || "");
  const isExpectedEmptyHistoryFailure = (result) =>
    !result.ok &&
    /does not have any commits yet|ambiguous argument ['"]?HEAD|bad revision ['"]?HEAD|unknown revision/i.test(
      result.stderr || "",
    );
  const isExpectedEmptyHistoryOutput = (result, expectedOutput) =>
    result.ok ? result.stdout.trim() === expectedOutput : isExpectedEmptyHistoryFailure(result);
  if (!refsResult.ok) return { ...refsResult, value: null };
  if (
    isUnbornRepository &&
    isExpectedEmptyHistoryOutput(commitOutputResult, "") &&
    isExpectedEmptyHistoryOutput(commitCountResult, "0")
  ) {
    return { ok: true, value: createEmptyGitCommitPage(repositoryPath, now) };
  }

  if (!commitOutputResult.ok) {
    return {
      ok: false,
      value: null,
      failure: createGitReadFailure("history", commitOutputResult, "读取 Git 提交历史失败"),
    };
  }
  if (!commitCountResult.ok) {
    return {
      ok: false,
      value: null,
      failure: createGitReadFailure("history", commitCountResult, "读取 Git 提交数量失败"),
    };
  }
  const refsByCommit = refsResult.value;

  const commitCountText = commitCountResult.stdout.trim();
  if (!/^\d+$/.test(commitCountText)) {
    return {
      ok: false,
      value: null,
      failure: {
        code: "invalid-output",
        operation: "history",
        message: "Git 返回了无效的提交数量。",
      },
    };
  }
  const parsedCommitCount = Number(commitCountText);
  if (!Number.isSafeInteger(parsedCommitCount) || parsedCommitCount < 0) {
    return {
      ok: false,
      value: null,
      failure: {
        code: "invalid-output",
        operation: "history",
        message: "Git 返回的提交数量超出可处理范围。",
      },
    };
  }
  const commitCount = parsedCommitCount;

  const commits = [];
  const commitOutput = commitOutputResult.stdout;
  if (commitOutput.trim()) {
    commitOutput.split(gitCommitRecordSeparator).forEach((record) => {
      const normalizedRecord = record.trimEnd();
      const shortStatSeparatorIndex = normalizedRecord.indexOf(gitCommitShortStatSeparator);
      const commitRecord =
        shortStatSeparatorIndex < 0 ? normalizedRecord : normalizedRecord.slice(0, shortStatSeparatorIndex);
      const shortStatOutput =
        shortStatSeparatorIndex < 0
          ? ""
          : normalizedRecord.slice(shortStatSeparatorIndex + gitCommitShortStatSeparator.length);
      if (!commitRecord.trim()) {
        return;
      }

      const hashIndex = commitRecord.search(/[0-9a-f]{40,64}\x1f/);
      if (hashIndex < 0) {
        return;
      }

      const graph = commitRecord.slice(0, hashIndex).trimEnd();
      const [hash, parentText, author, date, refs, message, ...bodyParts] = commitRecord
        .slice(hashIndex)
        .split(gitCommitFieldSeparator);
      if (!hash) {
        return;
      }

      const body = bodyParts.join(gitCommitFieldSeparator).trim();
      const shortStatMatch = shortStatOutput.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
      );
      const shortStats = shortStatMatch
        ? {
            files: Number(shortStatMatch[1]),
            additions: Number(shortStatMatch[2]) || 0,
            deletions: Number(shortStatMatch[3]) || 0,
          }
        : shortStatSeparatorIndex >= 0 && !shortStatOutput.trim()
          ? { files: 0, additions: 0, deletions: 0 }
          : undefined;

      commits.push({
        hash,
        graph: graph || "*",
        parents: parentText ? parentText.split(" ").filter(Boolean) : [],
        author,
        date,
        refs,
        refNames: refsByCommit.get(hash) || [],
        message: message || body.split(/\r?\n/)[0] || "",
        body: body || message || "",
        shortStats,
      });
    });
  }

  if (commitCount > 0 && commits.length === 0) {
    return {
      ok: false,
      value: null,
      failure: {
        code: "invalid-output",
        operation: "history",
        message: "Git 提交历史输出无效，未找到可解析的提交。",
      },
    };
  }

  const hasMoreCommits = commits.length > limit;
  if (hasMoreCommits) {
    commits.length = limit;
  }
  const nextCommitSkip = skip + commits.length;

  return {
    ok: true,
    value: {
      commits: insertGitStashes(commits, stashes, refsByCommit),
      commitCount,
      hasMoreCommits,
      nextCommitSkip,
      repositoryPath,
      lastRefreshedAt: now,
    },
  };
}

async function readGitCommits(projectPath, options = {}) {
  const result = await readGitCommitsResult(projectPath, options);
  return result.value || createEmptyGitCommitPage("", new Date().toISOString());
}

async function readGitSnapshotResult(projectPath, options = {}) {
  const [statusResult, commitResult] = await Promise.all([
    readGitStatusSnapshotResult(projectPath),
    readGitCommitsResult(projectPath, options),
  ]);
  if (statusResult.ok && commitResult.ok) {
    return { ok: true, value: combineGitSnapshot(statusResult.value, commitResult.value) };
  }

  const failure = !statusResult.ok ? statusResult.failure : commitResult.failure;
  const emptyRepositoryValue =
    !statusResult.ok &&
    statusResult.value &&
    !statusResult.value.repositoryPath &&
    !commitResult.ok &&
    commitResult.value &&
    !commitResult.value.repositoryPath
      ? combineGitSnapshot(statusResult.value, commitResult.value)
      : null;
  return { ok: false, value: emptyRepositoryValue, failure };
}

async function readGitSnapshot(projectPath, options = {}) {
  const result = await readGitSnapshotResult(projectPath, options);
  return (
    result.value || {
      ...createEmptyGitStatusSnapshot("", new Date().toISOString(), result.failure.message),
      ...createEmptyGitCommitPage("", new Date().toISOString()),
    }
  );
}
