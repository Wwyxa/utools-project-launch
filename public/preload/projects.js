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

    return { scripts, packagePath, error: "" };
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "未知错误";
    return { scripts: [], packagePath, error: `无法解析 ${packagePath}：${reason}` };
  }
}

function readMakefileScripts(projectPath) {
  const resolvedPath = expandPath(projectPath);
  const makefilePath = ["Makefile", "makefile", "GNUmakefile"]
    .map((name) => path.join(resolvedPath, name))
    .find((candidate) => fs.existsSync(candidate));

  if (!makefilePath) {
    return { scripts: [], makefilePath: null };
  }

  try {
    const targets = new Set();
    fs.readFileSync(makefilePath, "utf8")
      .split(/\r?\n/)
      .forEach((line) => {
        const phonyMatch = /^\s*\.PHONY\s*:\s*(.*)$/.exec(line);
        if (phonyMatch) {
          phonyMatch[1].split(/\s+/).forEach((target) => {
            if (makeTargetPattern.test(target)) targets.add(target);
          });
          return;
        }
        if (
          !line ||
          /^\s/.test(line) ||
          /^\s*(?:#|include\b|-include\b|define\b|endef\b|ifeq\b|ifneq\b|ifdef\b|ifndef\b|else\b|endif\b)/.test(line)
        ) {
          return;
        }
        const separator = line.indexOf(":");
        if (separator <= 0 || line[separator + 1] === "=") {
          return;
        }
        const targetList = line.slice(0, separator).trim();
        if (!targetList || /[=$%]/.test(targetList)) {
          return;
        }
        targetList.split(/\s+/).forEach((target) => {
          if (!target || target.startsWith(".") || !makeTargetPattern.test(target)) {
            return;
          }
          targets.add(target);
        });
      });

    return {
      scripts: [...targets].map((target) => ({
        name: target,
        command: `make ${target}`,
        cwd: ".",
        note: `Makefile: ${path.basename(makefilePath)}`,
        source: "makefile",
      })),
      makefilePath,
      error: "",
    };
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "未知错误";
    return { scripts: [], makefilePath, error: `无法读取 ${makefilePath}：${reason}` };
  }
}

function toRelativeCwd(rootPath, targetPath) {
  const relativePath = path.relative(expandPath(rootPath), expandPath(targetPath));
  return relativePath ? relativePath.replace(/\\/g, "/") : ".";
}

function resolveProjectSortOrder(project, fallbackIndex = 0) {
  const sortOrder = Number(project?.sortOrder);
  return Number.isFinite(sortOrder) ? sortOrder : fallbackIndex;
}

function sortProjectsByStoredOrder(projects) {
  return projects
    .map((project, index) => ({ project, index }))
    .sort((left, right) => {
      const sortDelta =
        resolveProjectSortOrder(left.project, left.index) - resolveProjectSortOrder(right.project, right.index);
      return sortDelta || left.index - right.index;
    })
    .map((entry) => entry.project);
}

function normalizeQuickLink(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProjectGroup(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProjectRelations(value) {
  const relations = Array.isArray(value) ? value : [];
  const seenProjectIds = new Set();
  return relations.reduce((normalizedRelations, relation) => {
    if (!relation || typeof relation !== "object") return normalizedRelations;
    const projectId = typeof relation.projectId === "string" ? relation.projectId.trim() : "";
    if (!projectId || seenProjectIds.has(projectId) || normalizedRelations.length >= 5) {
      return normalizedRelations;
    }
    seenProjectIds.add(projectId);
    normalizedRelations.push({ projectId, bidirectional: relation.bidirectional === true });
    return normalizedRelations;
  }, []);
}

function isExternalUrl(value) {
  return /^(?:https?:)?\/\//i.test(value) || /^(?:mailto|utools):/i.test(value);
}

function openPath(targetPath) {
  const normalizedPath = String(targetPath || "").trim();
  if (!normalizedPath) {
    return Promise.resolve();
  }

  if (isExternalUrl(normalizedPath)) {
    return shell.openExternal(normalizedPath.startsWith("//") ? `https:${normalizedPath}` : normalizedPath);
  }

  return shell.openPath(expandPath(normalizedPath));
}

function toStoredProject(project, index = 0) {
  const visibility = project.visibility === "private" ? "private" : "public";
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    visibility,
    ownerDeviceId: project.ownerDeviceId || getCurrentDeviceId(),
    type: project.type || "Custom",
    kind: project.kind || "custom",
    icon: project.icon || "custom",
    cardStyle: project.cardStyle || "default",
    tinyCardButtonCount: Number.isFinite(project.tinyCardButtonCount)
      ? Math.min(3, Math.max(0, Math.floor(project.tinyCardButtonCount)))
      : 1,
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    relatedProjects: normalizeProjectRelations(project.relatedProjects),
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
    automationTasks: Array.isArray(project.automationTasks)
      ? project.automationTasks.map((task) => ({
          ...task,
          missedPolicy: task.missedPolicy || "grace-run",
          missedGraceMinutes: Number.isFinite(task.missedGraceMinutes)
            ? Math.max(0, Math.floor(task.missedGraceMinutes))
            : 5,
          history: Array.isArray(task.history) ? task.history.slice(0, 20) : [],
          observedServiceExecutionIds: Array.isArray(task.observedServiceExecutionIds)
            ? Array.from(
                new Set(task.observedServiceExecutionIds.filter((id) => typeof id === "string" && id.trim())),
              ).slice(-20)
            : [],
          dailyPlans: Array.isArray(task.dailyPlans) ? task.dailyPlans : [],
          inputConfigs: Array.isArray(task.inputConfigs) ? task.inputConfigs : [],
          exitConfigs: Array.isArray(task.exitConfigs) ? task.exitConfigs : [],
        }))
      : [],
    env: project.env || {},
    memo: project.memo || "",
    todos: Array.isArray(project.todos) ? project.todos : [],
    gitLatestCommitAt: project.gitLatestCommitAt || project.git?.commits?.[0]?.date || "",
    sortOrder: resolveProjectSortOrder(project, index),
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
    return { scripts: [], error: "" };
  }

  const cwd = toRelativeCwd(rootPath, targetPath);
  return {
    scripts: packageResult.scripts.map((script) => ({
      name: cwd === "." ? script.name : `${cwd}:${script.name}`,
      command: script.command,
      cwd,
      note: `package.json: ${toRelativeCwd(rootPath, packageResult.packagePath)}`,
      source: "package-json",
    })),
    error: packageResult.error,
  };
}

function discoverProjectScripts(projectPath, options = {}) {
  const resolvedPath = expandPath(projectPath);
  if (!pathExists(projectPath)) {
    return { scripts: [], message: "路径不存在或当前设备无法访问。" };
  }

  const requestedSources = Array.isArray(options.sources) ? options.sources : ["package-json", "makefile"];
  const sources = new Set(requestedSources.filter((source) => source === "package-json" || source === "makefile"));
  if (sources.size === 0) {
    return { scripts: [], message: "请至少选择一种识别来源。" };
  }

  const packageResults = sources.has("package-json")
    ? commonProjectDirs.map((dirName) => {
        const targetPath = dirName === "." ? resolvedPath : path.join(resolvedPath, dirName);
        return detectNodeUnit(resolvedPath, targetPath);
      })
    : [];
  const makefileResult = sources.has("makefile")
    ? readMakefileScripts(resolvedPath)
    : { scripts: [], makefilePath: null, error: "" };
  const errors = [...packageResults.map((result) => result.error), makefileResult.error].filter(Boolean);
  return {
    scripts: [...packageResults.flatMap((result) => result.scripts), ...makefileResult.scripts],
    ...(errors.length > 0 ? { message: errors.join("；") } : {}),
  };
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

function normalizeStoredProjects(projects, fallbackIndexOffset = 0) {
  return Array.isArray(projects)
    ? projects.map((project, index) => toStoredProject(project, fallbackIndexOffset + index))
    : [];
}

function mergeStoredProjects(legacyProjects, docProjects) {
  const mergedByProjectId = new Map();

  normalizeStoredProjects(legacyProjects).forEach((project) => {
    if (typeof project.id === "string" && project.id) {
      mergedByProjectId.set(project.id, project);
    }
  });

  normalizeStoredProjects(docProjects, Array.isArray(legacyProjects) ? legacyProjects.length : 0).forEach((project) => {
    if (typeof project.id === "string" && project.id) {
      mergedByProjectId.set(project.id, project);
    }
  });

  return sortProjectsByStoredOrder(Array.from(mergedByProjectId.values()));
}

function hasLegacyProjectsMissingFromDocs(legacyProjects, docProjects) {
  const docProjectIds = new Set(
    docProjects.map((project) => project?.id).filter((projectId) => typeof projectId === "string" && projectId),
  );
  return legacyProjects.some(
    (project) => typeof project?.id === "string" && project.id && !docProjectIds.has(project.id),
  );
}

function readProjects() {
  try {
    const docs = readProjectDocs();
    const docProjects = docs.map((doc) => doc.project).filter(Boolean);
    const legacyProjects = readLegacyStoredProjects();
    const mergedProjects = mergeStoredProjects(legacyProjects, docProjects);

    if (
      legacyProjects.length > 0 &&
      window.utools?.db?.put &&
      hasLegacyProjectsMissingFromDocs(legacyProjects, docProjects)
    ) {
      writeStoredProjects(mergedProjects);
    }
    return mergedProjects;
  } catch (error) {
    logStorageError("read projects", error);
    return sortProjectsByStoredOrder(normalizeStoredProjects(readLegacyStoredProjects()));
  }
}

function writeStoredProjects(projects) {
  if (window.utools?.db?.put) {
    try {
      const existingDocs = readProjectDocs();
      const existingByProjectId = new Map(existingDocs.map((doc) => [doc._id.replace(projectDocPrefix, ""), doc]));
      const projectIds = new Set(projects.map((project) => project.id));

      projects.forEach((project, index) => {
        const existing = existingByProjectId.get(project.id);
        const doc = toPlainJson({
          _id: `${projectDocPrefix}${project.id}`,
          schemaVersion,
          updatedAt: new Date().toISOString(),
          project: toStoredProject(project, index),
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

function resolveProjectChild(projectPath, relativePath) {
  const rootPath = expandPath(projectPath);
  const normalizedRelativePath = typeof relativePath === "string" ? relativePath : "";
  const targetPath = path.resolve(rootPath, normalizedRelativePath || ".");
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("目标路径不在项目目录内。");
  }
  return { rootPath, targetPath, relativePath: relative === "" ? "" : relative.replace(/\\/g, "/") };
}

function isPathWithinRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveCanonicalProjectRoot(projectPath) {
  const rootPath = fs.realpathSync(expandPath(projectPath));
  if (!fs.statSync(rootPath).isDirectory()) {
    throw new Error("项目路径不是目录。");
  }
  return rootPath;
}

function resolveCanonicalProjectEntry(projectPath, relativePath, allowRoot = false) {
  const rootPath = resolveCanonicalProjectRoot(projectPath);
  const lexicalTarget = path.resolve(rootPath, typeof relativePath === "string" ? relativePath : "");
  if (!isPathWithinRoot(rootPath, lexicalTarget)) {
    throw new Error("目标路径不在项目目录内。");
  }
  if (!allowRoot && lexicalTarget === rootPath) {
    throw new Error("不能修改项目根目录。");
  }
  if (lexicalTarget !== rootPath && fs.lstatSync(lexicalTarget).isSymbolicLink()) {
    throw new Error("不支持操作符号链接。");
  }
  const targetPath = fs.realpathSync(lexicalTarget);
  if (!isPathWithinRoot(rootPath, targetPath)) {
    throw new Error("目标路径通过符号链接指向项目目录外。");
  }
  return { rootPath, targetPath, relativePath: path.relative(rootPath, lexicalTarget).replace(/\\/g, "/") };
}

function resolveCanonicalProjectParent(projectPath, parentRelativePath) {
  const rootPath = resolveCanonicalProjectRoot(projectPath);
  const lexicalParent = path.resolve(rootPath, typeof parentRelativePath === "string" ? parentRelativePath : "");
  if (!isPathWithinRoot(rootPath, lexicalParent)) {
    throw new Error("目标路径不在项目目录内。");
  }
  const parentPath = fs.realpathSync(lexicalParent);
  if (!isPathWithinRoot(rootPath, parentPath) || !fs.statSync(parentPath).isDirectory()) {
    throw new Error("目标目录无效或位于项目目录外。");
  }
  return { rootPath, parentPath, parentRelativePath: path.relative(rootPath, lexicalParent).replace(/\\/g, "/") };
}

function validateProjectEntryName(name) {
  const normalizedName = typeof name === "string" ? name : "";
  if (!normalizedName || normalizedName === "." || normalizedName === "..") {
    throw new Error("名称不能为空或使用保留目录名。");
  }
  if (/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(normalizedName) || /[. ]$/.test(normalizedName)) {
    throw new Error("名称包含无效字符或以点、空格结尾。");
  }
  const basename = normalizedName.split(".")[0].toUpperCase();
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(basename)) {
    throw new Error("名称是系统保留名称。");
  }
  return normalizedName;
}

function projectFileTreeEntry(rootPath, targetPath, stats) {
  const name = path.basename(targetPath);
  return {
    name,
    path: targetPath,
    relativePath: path.relative(rootPath, targetPath).replace(/\\/g, "/"),
    kind: stats.isDirectory() ? "directory" : "file",
    size: stats.size,
    extension: path.extname(name).toLowerCase(),
    hidden: name.startsWith("."),
  };
}

function listProjectFiles(projectPath, relativePath = "") {
  const resolved = resolveCanonicalProjectEntry(projectPath, relativePath, true);
  const stats = fs.statSync(resolved.targetPath);
  if (!stats.isDirectory()) {
    throw new Error("目标路径不是目录。");
  }

  const entries = fs
    .readdirSync(resolved.targetPath, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink() && !ignoredFileTreeDirs.has(entry.name))
    .map((entry) => {
      const childPath = path.join(resolved.targetPath, entry.name);
      const childStats = fs.statSync(childPath);
      const childRelativePath = path.relative(resolved.rootPath, childPath).replace(/\\/g, "/");
      return {
        name: entry.name,
        path: childPath,
        relativePath: childRelativePath,
        kind: entry.isDirectory() ? "directory" : "file",
        size: childStats.size,
        extension: path.extname(entry.name).toLowerCase(),
        hidden: entry.name.startsWith("."),
      };
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  return { rootPath: resolved.rootPath, relativePath: resolved.relativePath, entries };
}

async function searchProjectFiles(projectPath, query, options = {}) {
  const rootPath = resolveCanonicalProjectRoot(projectPath);
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  const limit = Math.max(1, Math.min(500, Number.isFinite(options.limit) ? Math.floor(options.limit) : 200));
  if (!normalizedQuery) return { rootPath, query: normalizedQuery, entries: [], truncated: false };

  const needle = normalizedQuery.toLocaleLowerCase();
  const entries = [];
  const pendingDirectories = [rootPath];
  let truncated = false;
  while (pendingDirectories.length > 0 && !truncated) {
    const directoryPath = pendingDirectories.shift();
    let directoryEntries;
    try {
      directoryEntries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of directoryEntries) {
      if (entry.isSymbolicLink() || (entry.isDirectory() && ignoredFileTreeDirs.has(entry.name))) continue;
      const targetPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) pendingDirectories.push(targetPath);
      if (!entry.name.toLocaleLowerCase().includes(needle)) continue;
      try {
        const stats = await fs.promises.lstat(targetPath);
        entries.push(projectFileTreeEntry(rootPath, targetPath, stats));
      } catch {
        continue;
      }
      if (entries.length >= limit) {
        truncated = true;
        break;
      }
    }
  }
  return { rootPath, query: normalizedQuery, entries, truncated };
}

function createProjectEntry(projectPath, parentRelativePath, name, kind) {
  const normalizedKind = kind === "directory" ? "directory" : "file";
  try {
    const parent = resolveCanonicalProjectParent(projectPath, parentRelativePath);
    const normalizedName = validateProjectEntryName(name);
    const targetPath = path.join(parent.parentPath, normalizedName);
    if (normalizedKind === "directory") {
      fs.mkdirSync(targetPath, { recursive: false });
    } else {
      fs.writeFileSync(targetPath, "", { flag: "wx" });
    }
    return {
      ok: true,
      kind: normalizedKind,
      path: targetPath,
      relativePath: path.relative(parent.rootPath, targetPath).replace(/\\/g, "/"),
    };
  } catch (error) {
    return { ok: false, kind: normalizedKind, path: "", relativePath: "", message: error?.message || String(error) };
  }
}

function renameProjectEntry(projectPath, relativePath, name) {
  let kind = "file";
  try {
    const source = resolveCanonicalProjectEntry(projectPath, relativePath);
    const sourceStats = fs.statSync(source.targetPath);
    kind = sourceStats.isDirectory() ? "directory" : "file";
    const normalizedName = validateProjectEntryName(name);
    const targetPath = path.join(path.dirname(source.targetPath), normalizedName);
    if (fs.existsSync(targetPath)) throw new Error("同名文件或目录已存在。");
    fs.renameSync(source.targetPath, targetPath);
    return {
      ok: true,
      kind,
      path: targetPath,
      relativePath: path.relative(source.rootPath, targetPath).replace(/\\/g, "/"),
      previousRelativePath: source.relativePath,
    };
  } catch (error) {
    return {
      ok: false,
      kind,
      path: "",
      relativePath,
      previousRelativePath: relativePath,
      message: error?.message || String(error),
    };
  }
}

function deleteProjectEntry(projectPath, relativePath) {
  let kind = "file";
  try {
    const resolved = resolveCanonicalProjectEntry(projectPath, relativePath);
    const stats = fs.statSync(resolved.targetPath);
    kind = stats.isDirectory() ? "directory" : "file";
    fs.rmSync(resolved.targetPath, { recursive: kind === "directory", force: false });
    return { ok: true, kind, path: resolved.targetPath, relativePath: resolved.relativePath };
  } catch (error) {
    return { ok: false, kind, path: "", relativePath, message: error?.message || String(error) };
  }
}

function showProjectEntryInFolder(projectPath, relativePath) {
  const resolved = resolveCanonicalProjectEntry(projectPath, relativePath, true);
  shell.showItemInFolder(resolved.targetPath);
}

function getMime(extension) {
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";
  return textFileExtensions.has(extension) ? "text/plain" : "application/octet-stream";
}

function isKnownTextFileName(fileName) {
  return textFileNamePatterns.some((pattern) => pattern.test(fileName));
}

function isLikelyTextBuffer(buffer) {
  if (buffer.length === 0) return true;
  let replacementCount = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0) return false;
  }

  const decoded = buffer.toString("utf8");
  for (const char of decoded) {
    if (char === "\uFFFD") {
      replacementCount += 1;
    }
  }
  return replacementCount / decoded.length < 0.02;
}

function readProjectFile(projectPath, relativePath) {
  const resolved = resolveCanonicalProjectEntry(projectPath, relativePath);
  const stats = fs.statSync(resolved.targetPath);
  const name = path.basename(resolved.targetPath);
  const extension = path.extname(name).toLowerCase();
  const mime = getMime(extension);

  if (!stats.isFile()) {
    return {
      path: resolved.targetPath,
      relativePath: resolved.relativePath,
      name,
      size: stats.size,
      extension,
      mime,
      previewKind: "none",
      editable: false,
      message: "请选择文件预览。",
    };
  }

  if (imageFileExtensions.has(extension) && stats.size <= 1024 * 1024 * 2) {
    return {
      path: resolved.targetPath,
      relativePath: resolved.relativePath,
      name,
      size: stats.size,
      extension,
      mime,
      previewKind: "image",
      editable: false,
      dataUrl: `data:${mime};base64,${fs.readFileSync(resolved.targetPath).toString("base64")}`,
    };
  }

  const isKnownTextFile = textFileExtensions.has(extension) || isKnownTextFileName(name);
  const isSmallUnknownTextFile =
    !isKnownTextFile && stats.size <= 1024 * 64 && isLikelyTextBuffer(fs.readFileSync(resolved.targetPath));
  if (isKnownTextFile || isSmallUnknownTextFile) {
    if (stats.size > 1024 * 512) {
      return {
        path: resolved.targetPath,
        relativePath: resolved.relativePath,
        name,
        size: stats.size,
        extension,
        mime,
        previewKind: "none",
        editable: false,
        message: "文件过大，已跳过轻量预览。",
      };
    }
    return {
      path: resolved.targetPath,
      relativePath: resolved.relativePath,
      name,
      size: stats.size,
      extension,
      mime,
      previewKind: "text",
      editable: true,
      content: fs.readFileSync(resolved.targetPath, "utf8"),
    };
  }

  return {
    path: resolved.targetPath,
    relativePath: resolved.relativePath,
    name,
    size: stats.size,
    extension,
    mime,
    previewKind: "none",
    editable: false,
    message: "此文件类型暂不支持轻量预览。",
  };
}

function writeProjectFile(projectPath, relativePath, content) {
  const resolved = resolveCanonicalProjectEntry(projectPath, relativePath);
  const stats = fs.statSync(resolved.targetPath);
  if (!stats.isFile()) {
    throw new Error("只能保存文件。");
  }
  fs.writeFileSync(resolved.targetPath, String(content), "utf8");
  return { path: resolved.targetPath, relativePath: resolved.relativePath, savedAt: new Date().toISOString() };
}

