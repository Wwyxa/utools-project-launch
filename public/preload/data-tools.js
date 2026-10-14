// Data tools for the settings page: storage overview, cleanup plan and
// cleanup execution. Cleanup results are always per-item; a partial failure
// must never be presented as an overall success. No environment variable
// values, AI keys or service tokens are ever included in plan payloads.

const cleanupSyncDbStorageKeys = migrationPreferenceKeys.concat([storageKey]);

async function directoryEntrySizeBytes(targetPath) {
  if (!targetPath) return 0;
  try {
    const stats = await fs.promises.lstat(targetPath);
    if (stats.isSymbolicLink()) return 0;
    if (stats.isFile()) return stats.size;
    if (!stats.isDirectory()) return 0;
    let total = 0;
    const entries = await fs.promises.readdir(targetPath);
    for (const entry of entries) {
      total += await directoryEntrySizeBytes(path.join(targetPath, entry));
    }
    return total;
  } catch (error) {
    return 0;
  }
}

function safeDirectoryNameExists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch (error) {
    return false;
  }
}

function localServiceDirectoryPath() {
  return path.join(pluginLocalDataDirectory(), "service");
}

function projectDocumentProjectId(document) {
  const id = typeof document?._id === "string" ? document._id : "";
  return id.startsWith(projectDocPrefix) ? id.slice(projectDocPrefix.length) : "";
}

function isOrphanProjectDocument(document) {
  const project = document?.project;
  if (!project || typeof project !== "object") return true;
  const expectedId = projectDocumentProjectId(document);
  return !expectedId || project.id !== expectedId;
}

async function projectLaunchServiceIsRunning() {
  try {
    const status = await readProjectLaunchServiceStatus();
    return status?.running === true;
  } catch (error) {
    return false;
  }
}

function collectProjectDocumentsByKind() {
  let documents = [];
  try {
    documents = readProjectDocs();
  } catch (error) {
    documents = [];
  }
  const publicProjects = [];
  const legacyPrivateProjects = [];
  const orphanDocuments = [];
  documents.forEach((document) => {
    if (isOrphanProjectDocument(document)) {
      orphanDocuments.push(document);
      return;
    }
    if (document.project.visibility === "private") {
      legacyPrivateProjects.push(document);
      return;
    }
    publicProjects.push(document);
  });
  return { publicProjects, legacyPrivateProjects, orphanDocuments };
}

function estimateProjectDocumentBytes(document) {
  try {
    return JSON.stringify(document).length;
  } catch (error) {
    return 0;
  }
}

function collectLegacyDbStorageKeySummaries() {
  return cleanupSyncDbStorageKeys
    .map((key) => ({ key, present: readLegacyDbStorageValue(key) !== null }))
    .filter((entry) => entry.present);
}

async function collectStorageOverview() {
  const capabilities = pluginV8Capabilities();
  const localDataDirectory = pluginLocalDataDirectory();
  const { publicProjects, legacyPrivateProjects, orphanDocuments } = collectProjectDocumentsByKind();
  const serviceRunning = await projectLaunchServiceIsRunning();
  const ledger = readMigrationLedger();

  return {
    hostVersion: capabilities.getAppVersion ? String(window.utools?.getAppVersion?.() || "") : "",
    capabilities,
    localDataPath: localDataDirectory,
    tempPath: pluginTempDirectory(),
    legacyPath: legacyPluginDataDirectory(),
    migration: ledger ? migrationProgressSnapshot(ledger) : null,
    serviceRunning,
    projects: {
      publicCount: publicProjects.length,
      privateLocalCount: readLocalPrivateProjects().length,
      legacyPrivateDocCount: legacyPrivateProjects.length,
      orphanDocumentCount: orphanDocuments.length,
    },
    legacyDbStorageKeys: collectLegacyDbStorageKeySummaries().map((entry) => entry.key),
    sizes: {
      localDataBytes: localDataDirectory ? await directoryEntrySizeBytes(localDataDirectory) : 0,
      serviceBytes: localDataDirectory ? await directoryEntrySizeBytes(localServiceDirectoryPath()) : 0,
      iconPacksBytes: localDataDirectory ? await directoryEntrySizeBytes(path.join(localDataDirectory, "icon-packs")) : 0,
      privateProjectsBytes: localDataDirectory
        ? await directoryEntrySizeBytes(privateProjectsDirectory())
        : 0,
      tempBytes: 0, // The temp directory is cleared by the host; measuring it races with that.
      legacyBytes: await directoryEntrySizeBytes(legacyPluginDataDirectory()),
      syncDocumentBytes: [...publicProjects, ...legacyPrivateProjects, ...orphanDocuments].reduce(
        (total, document) => total + estimateProjectDocumentBytes(document),
        0,
      ),
    },
  };
}

function cleanupItem(id, category, label, description, extra = {}) {
  return {
    id,
    category,
    label,
    description,
    recommendation: category === "cache" ? "recommended" : "keep",
    safetyHint: "",
    keys: [],
    kind: "directory",
    paths: [],
    disabledReason: "",
    selectedByDefault: category === "cache",
    estimatedBytes: 0,
    count: null,
    ...extra,
  };
}

async function buildCleanupPlan() {
  const localDataDirectory = pluginLocalDataDirectory();
  const { publicProjects, legacyPrivateProjects, orphanDocuments } = collectProjectDocumentsByKind();
  const serviceRunning = await projectLaunchServiceIsRunning();
  const ledger = readMigrationLedger();
  const migrationCompleted = ledger?.status === "completed";
  const legacyDirectory = legacyPluginDataDirectory();
  const legacyDirectoryExists = safeDirectoryNameExists(legacyDirectory);
  const tempDirectory = pluginTempDirectory();
  const serviceDirectory = localDataDirectory ? localServiceDirectoryPath() : "";
  const iconPackDirectory = localDataDirectory ? path.join(localDataDirectory, "icon-packs") : "";
  const privateProjectsDirectoryPath = localDataDirectory ? privateProjectsDirectory() : "";

  const syncReplicating = (() => {
    try {
      return window.utools?.db?.replicateStateFromCloud?.() === 1;
    } catch (error) {
      return false;
    }
  })();
  const syncDisabledReason = syncReplicating ? "正在从云端拉取同步数据，暂不能清理同步数据。" : "";

  const privateProjectCount = readLocalPrivateProjects().length;
  const legacyPrivateProjectCount = readLegacyStoredProjects().filter(
    (project) => project && project.visibility === "private",
  ).length;

  const items = [
    cleanupItem("sync-public-projects", "sync", "公共项目（同步文档）", "公共项目的配置、脚本命令、共享环境变量、备忘录、待办与自动化任务等数据", {
      safetyHint: "建议保留。这些数据仍由 uTools 云同步，删除会传播到其他设备，本插件无法恢复；不删除项目目录、源文件或 Git 仓库。",
      kind: "db-docs",
      count: publicProjects.length,
      estimatedBytes: publicProjects.reduce((total, document) => total + estimateProjectDocumentBytes(document), 0),
      disabledReason: syncDisabledReason,
    }),
    cleanupItem(
      "sync-legacy-private-projects",
      "sync",
      "遗留私有项目（同步文档）",
      "迁移前的私有项目文档（含其他设备拥有的项目），删除后会同步传播",
      {
        recommendation: "review",
        safetyHint: "确认所有设备均已完成迁移，并核对各自的私有项目在本机可正常读取后可清理。建议先备份；删除旧文档会同步到其他设备，不删除已迁移的本机私有项目文件。",
        kind: "db-docs",
        count: legacyPrivateProjects.length,
        estimatedBytes: legacyPrivateProjects.reduce(
          (total, document) => total + estimateProjectDocumentBytes(document),
          0,
        ),
        disabledReason: syncDisabledReason,
      },
    ),
    cleanupItem("sync-legacy-dbstorage", "sync", "遗留 dbStorage 配置", "旧版本存放在同步数据库中的设备配置键", {
      recommendation: "review",
      safetyHint: "新版设备配置存于本机 local-state.v1.json，不再写入这些旧键。确认配置与旧项目列表已迁移、所有设备不再使用旧版后可清理，不会重置新版本机配置；删除会同步到其他设备，但不会停止公共项目的云同步。",
      keys: collectLegacyDbStorageKeySummaries().map((entry) => entry.key),
      kind: "dbstorage-keys",
      count: collectLegacyDbStorageKeySummaries().length,
      disabledReason: syncDisabledReason,
    }),
    cleanupItem("sync-orphan-documents", "sync", "孤立项目文档", "项目内容缺失，或文档 ID 与项目 ID 不一致的同步文档", {
      recommendation: "review",
      safetyHint: "结构异常不代表没有个人数据。可能仍含可恢复的配置、备忘录等内容；先备份并确认无需恢复，删除会同步到其他设备。",
      kind: "db-docs",
      count: orphanDocuments.length,
      estimatedBytes: orphanDocuments.reduce((total, document) => total + estimateProjectDocumentBytes(document), 0),
      disabledReason: syncDisabledReason,
    }),
    cleanupItem("local-private-projects", "local", "私有项目（本机文件）", `${privateProjectCount} 个私有项目，包含其配置、脚本、环境变量、备忘录、待办与自动化任务等数据`, {
      safetyHint: "建议保留。新版私有项目只保存在本机，不自动备份到云端；清理会删除整个私有项目数据目录，请先备份，不删除项目源文件或 Git 仓库。",
      paths: privateProjectsDirectoryPath ? [privateProjectsDirectoryPath] : [],
      estimatedBytes: await directoryEntrySizeBytes(privateProjectsDirectoryPath),
      count: privateProjectCount,
      disabledReason: privateProjectsDirectoryPath ? "" : "本地数据目录不可用。",
    }),
    cleanupItem("local-device-preferences", "local", "设备配置与本机环境变量覆盖", "终端、外部应用、环境工具、AI、界面与服务开关，以及公共项目本机环境变量", {
      safetyHint: "建议保留。清理会重置本机设置并删除已保存的 AI 配置、密钥和环境变量覆盖，需要重新配置。",
      kind: "local-state-sections",
    }),
    cleanupItem("local-workspace-state", "local", "工作记录偏好与工作区状态", "本机工作记录筛选偏好、保存的项目分组与选择、Dashboard 分组选择", {
      safetyHint: "建议保留。清理会重置本机筛选和选择状态，不删除 Git 提交记录、项目配置或项目中的分组字段。",
      kind: "local-state-sections",
    }),
    cleanupItem("local-service-directory", "local", "项目启动服务数据", "整个 service 目录，包括服务程序、认证文件、运行状态、日志与下载残留", {
      safetyHint: "建议保留。这不是仅清理缓存，会删除目录内全部文件，需要重新安装或初始化服务；仅清理下载残留或日志时请选择对应项目。",
      paths: serviceDirectory ? [serviceDirectory] : [],
      estimatedBytes: await directoryEntrySizeBytes(serviceDirectory),
      disabledReason: serviceRunning ? "服务正在运行，请先停止服务。" : "",
    }),
    cleanupItem("local-icon-packs", "local", "外部图标包", "已安装的外部图标包文件", {
      safetyHint: "仍在使用时建议保留。删除后外部图标包不可用，需要重新安装。",
      paths: iconPackDirectory ? [iconPackDirectory] : [],
      estimatedBytes: await directoryEntrySizeBytes(iconPackDirectory),
      disabledReason: iconPackDirectory ? "" : "本地数据目录不可用。",
    }),
    cleanupItem("local-legacy-directory", "local", "旧版本数据目录", "迁移前使用的旧数据目录及其中全部文件，具体位置见目录路径", {
      recommendation: "review",
      safetyHint: "迁移完成后仍应先检查并备份旧目录。迁移只复制支持的内容，旧目录可能包含未迁移文件或需保留的日志。",
      paths: legacyDirectoryExists ? [legacyDirectory] : [],
      estimatedBytes: await directoryEntrySizeBytes(legacyDirectory),
      disabledReason: legacyDirectoryExists
        ? migrationCompleted
          ? ""
          : "迁移完成并通过校验后才能清理旧目录。"
        : "旧数据目录不存在。",
    }),
    cleanupItem("cache-temp-directory", "cache", "临时目录", "插件专属临时目录及其中全部文件，不参与云同步", {
      safetyHint: "没有正在使用的临时文件时可清理。请先结束下载、更新等操作；会删除整个临时目录，不只是下载残留，不影响长期保存的本机配置。",
      paths: tempDirectory ? [tempDirectory] : [],
      disabledReason: tempDirectory ? "" : "临时目录不可用。",
    }),
    cleanupItem("cache-service-downloads", "cache", "服务下载残留", "服务目录中的 downloads、.partial 与 update.backup 文件", {
      safetyHint: "服务更新已确认正常、无需回退时可清理。下载文件可重新获取；清理 update.backup 后将失去该更新备份，不删除当前服务程序或本机配置。",
      kind: "service-downloads",
      paths: serviceDirectory ? [serviceDirectory] : [],
      disabledReason: serviceDirectory ? (serviceRunning ? "服务正在运行，请先停止服务。" : "") : "本地数据目录不可用。",
    }),
    cleanupItem("cache-diagnostics", "cache", "诊断与服务运行日志", "service.log 与服务运行日志目录", {
      safetyHint: "无需保留排障或脚本输出记录时可清理。日志只保存在本机，历史内容无法重新生成；不删除项目配置、自动化任务或项目源文件。",
      kind: "service-diagnostics",
      paths: serviceDirectory ? [serviceDirectory] : [],
      disabledReason: serviceDirectory ? (serviceRunning ? "服务正在运行，请先停止服务。" : "") : "本地数据目录不可用。",
    }),
    cleanupItem("cache-git-activity", "cache", "Git 活动缓存", "内存中的 Git 报告、明细与头像缓存，不占用磁盘空间", {
      recommendation: "keep",
      selectedByDefault: false,
      safetyHint: "通常无需清理。下次查看会重新计算或获取，可能变慢；仅在结果异常或需要释放内存时清理。退出到后台不保证释放缓存，插件运行上下文销毁后才会消失。不会删除 Git 提交记录或项目源文件。",
      kind: "memory-caches",
    }),
  ];
  return { items, serviceRunning, syncReplicating };
}

async function trashFileSystemPath(targetPath) {
  try {
    if (typeof window.utools?.shellTrashItem === "function") {
      await window.utools.shellTrashItem(targetPath);
      return { ok: true, mode: "trash" };
    }
  } catch (error) {
    // Fall back to a permanent delete below.
  }
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return { ok: true, mode: "permanent" };
  } catch (error) {
    return { ok: false, mode: "none", message: error instanceof Error ? error.message : String(error) };
  }
}

function resetLocalStateSections(sections) {
  return updateLocalState((state) => {
    if (sections.has("preferences")) {
      state.preferences = {};
      state.publicProjectOverrides = {};
    }
    if (sections.has("workspace")) {
      state.workspace = defaultLocalState().workspace;
    }
    return state;
  });
}

async function executeCleanupItem(item) {
  if (item.kind === "db-docs") {
    const { publicProjects, legacyPrivateProjects, orphanDocuments } = collectProjectDocumentsByKind();
    const documents =
      item.id === "sync-public-projects"
        ? publicProjects
        : item.id === "sync-legacy-private-projects"
          ? legacyPrivateProjects
          : orphanDocuments;
    if (documents.length === 0) {
      return { ok: true, message: "没有可清理的文档。" };
    }
    let removed = 0;
    for (const document of documents) {
      const result = window.utools?.db?.remove?.(document);
      if (result?.ok === true) {
        removed += 1;
      } else {
        return {
          ok: false,
          message: `删除文档失败（${document?._id || "未知"}）：${result?.message || "未知错误"}。已删除 ${removed}/${documents.length} 项。`,
        };
      }
    }
    return { ok: true, message: `已删除 ${removed} 个同步文档（会传播到其他设备）。` };
  }

  if (item.kind === "dbstorage-keys") {
    const keys = collectLegacyDbStorageKeySummaries().map((entry) => entry.key);
    if (keys.length === 0) {
      return { ok: true, message: "没有可清理的遗留配置键。" };
    }
    keys.forEach((key) => {
      try {
        window.utools?.dbStorage?.removeItem?.(key);
      } catch (error) {
        throw new Error(`删除遗留配置键失败：${key}`);
      }
      try {
        window.localStorage?.removeItem?.(key);
      } catch (error) {
        // The localStorage mirror is best-effort.
      }
    });
    return { ok: true, message: `已删除 ${keys.length} 个遗留配置键。` };
  }

  if (item.kind === "local-state-sections") {
    const sections = item.id === "local-device-preferences" ? new Set(["preferences"]) : new Set(["workspace"]);
    const result = resetLocalStateSections(sections);
    if (!result.ok) {
      return { ok: false, message: result.error || "清理本地状态失败。" };
    }
    return { ok: true, message: "已清理本机配置。" };
  }

  if (item.kind === "service-downloads") {
    const serviceDirectory = localServiceDirectoryPath();
    const targets = ["downloads", "update.backup"]
      .map((entry) => path.join(serviceDirectory, entry))
      .filter((entry) => fs.existsSync(entry));
    fs.readdirSync(serviceDirectory)
      .filter((entry) => entry.endsWith(".partial"))
      .forEach((entry) => targets.push(path.join(serviceDirectory, entry)));
    if (targets.length === 0) {
      return { ok: true, message: "没有可清理的下载残留。" };
    }
    for (const targetPath of targets) {
      const trashed = await trashFileSystemPath(targetPath);
      if (!trashed.ok) {
        return { ok: false, message: trashed.message || "清理下载残留失败。" };
      }
    }
    return { ok: true, message: `已清理 ${targets.length} 个下载残留文件。` };
  }

  if (item.kind === "service-diagnostics") {
    const serviceDirectory = localServiceDirectoryPath();
    const targets = ["service.log", "logs"]
      .map((entry) => path.join(serviceDirectory, entry))
      .filter((entry) => fs.existsSync(entry));
    if (targets.length === 0) {
      return { ok: true, message: "没有可清理的诊断日志。" };
    }
    for (const targetPath of targets) {
      const trashed = await trashFileSystemPath(targetPath);
      if (!trashed.ok) {
        return { ok: false, message: trashed.message || "清理诊断日志失败。" };
      }
    }
    return { ok: true, message: "已清理诊断与服务运行日志。" };
  }

  if (item.kind === "memory-caches") {
    clearGitActivityCaches();
    return { ok: true, message: "已清理内存中的 Git 活动缓存。" };
  }

  // Default: file/directory paths moved to the system trash (preferred).
  if (Array.isArray(item.paths) && item.paths.length > 0) {
    let trashedCount = 0;
    let usedTrash = false;
    for (const targetPath of item.paths) {
      if (!fs.existsSync(targetPath)) {
        continue;
      }
      const trashed = await trashFileSystemPath(targetPath);
      if (!trashed.ok) {
        return { ok: false, message: trashed.message || "移入回收站失败。" };
      }
      usedTrash = trashed.mode === "trash";
      trashedCount += 1;
    }
    if (trashedCount === 0) {
      return { ok: true, message: "没有可清理的文件。" };
    }
    return { ok: true, message: usedTrash ? "已移入系统回收站。" : "已删除（回收站不可用）。" };
  }

  return { ok: false, message: "该清理项没有可执行的操作。" };
}

async function executeCleanup(selectedItemIds) {
  const plan = await buildCleanupPlan();
  const selectedIds = new Set(Array.isArray(selectedItemIds) ? selectedItemIds : []);
  const results = [];
  for (const item of plan.items) {
    if (!selectedIds.has(item.id)) continue;
    if (item.disabledReason) {
      results.push({ id: item.id, label: item.label, ok: false, message: item.disabledReason });
      continue;
    }
    try {
      const result = await executeCleanupItem(item);
      results.push({ id: item.id, label: item.label, ok: result.ok === true, message: result.message || "" });
    } catch (error) {
      results.push({
        id: item.id,
        label: item.label,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const allOk = results.length > 0 && results.every((result) => result.ok);
  return {
    ok: allOk,
    partial: results.length > 0 && results.some((result) => result.ok) && !allOk,
    results,
  };
}

function openPluginLocalDataDirectory() {
  const localDataDirectory = pluginLocalDataDirectory();
  if (!localDataDirectory) {
    throw new Error("本地数据目录不可用。");
  }
  fs.mkdirSync(localDataDirectory, { recursive: true });
  return shell.openPath(localDataDirectory);
}

function openLegacyDataDirectory() {
  return shell.openPath(legacyPluginDataDirectory());
}
