// Data tools for the settings page: storage overview, cleanup plan and
// cleanup execution. Cleanup results are always per-item; a partial failure
// must never be presented as an overall success. No environment variable
// values, AI keys or service tokens are ever included in plan payloads.

const cleanupSyncDbStorageKeys = migrationPreferenceKeys.concat([storageKey]);

function directoryEntrySizeBytes(targetPath) {
  try {
    const stats = fs.lstatSync(targetPath);
    if (stats.isSymbolicLink()) return 0;
    if (stats.isFile()) return stats.size;
    if (!stats.isDirectory()) return 0;
    return fs.readdirSync(targetPath).reduce((total, entry) => {
      return total + directoryEntrySizeBytes(path.join(targetPath, entry));
    }, 0);
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
      localDataBytes: localDataDirectory ? directoryEntrySizeBytes(localDataDirectory) : 0,
      serviceBytes: localDataDirectory ? directoryEntrySizeBytes(localServiceDirectoryPath()) : 0,
      iconPacksBytes: localDataDirectory ? directoryEntrySizeBytes(path.join(localDataDirectory, "icon-packs")) : 0,
      privateProjectsBytes: localDataDirectory
        ? directoryEntrySizeBytes(privateProjectsDirectory())
        : 0,
      tempBytes: 0, // The temp directory is cleared by the host; measuring it races with that.
      legacyBytes: directoryEntrySizeBytes(legacyPluginDataDirectory()),
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
    kind: "directory",
    paths: [],
    disabledReason: "",
    selectedByDefault: false,
    estimatedBytes: 0,
    count: 0,
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
    cleanupItem("sync-public-projects", "sync", "公共项目（同步文档）", "删除后会传播到所有已同步设备", {
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
      kind: "dbstorage-keys",
      count: collectLegacyDbStorageKeySummaries().length,
      disabledReason: syncDisabledReason,
    }),
    cleanupItem("sync-orphan-documents", "sync", "孤立项目文档", "无法解析出有效项目内容的同步文档", {
      kind: "db-docs",
      count: orphanDocuments.length,
      estimatedBytes: orphanDocuments.reduce((total, document) => total + estimateProjectDocumentBytes(document), 0),
      disabledReason: syncDisabledReason,
    }),
    cleanupItem("local-private-projects", "local", "私有项目（本机文件）", `${privateProjectCount} 个私有项目文件`, {
      paths: privateProjectsDirectoryPath ? [privateProjectsDirectoryPath] : [],
      estimatedBytes: directoryEntrySizeBytes(privateProjectsDirectoryPath),
      count: privateProjectCount,
      disabledReason: privateProjectsDirectoryPath ? "" : "本地数据目录不可用。",
    }),
    cleanupItem("local-device-preferences", "local", "设备配置与本机环境变量覆盖", "终端、外部应用、环境工具、AI、界面与服务开关，以及公共项目本机环境变量", {
      kind: "local-state-sections",
    }),
    cleanupItem("local-workspace-state", "local", "工作记录与工作区状态", "工作记录偏好、项目分组与选择、Dashboard 分组选择", {
      kind: "local-state-sections",
    }),
    cleanupItem("local-service-directory", "local", "项目启动服务数据", "服务程序、token、运行状态与日志", {
      paths: serviceDirectory ? [serviceDirectory] : [],
      estimatedBytes: directoryEntrySizeBytes(serviceDirectory),
      disabledReason: serviceRunning ? "服务正在运行，请先停止服务。" : "",
    }),
    cleanupItem("local-icon-packs", "local", "外部图标包", "已安装的外部图标包文件", {
      paths: iconPackDirectory ? [iconPackDirectory] : [],
      estimatedBytes: directoryEntrySizeBytes(iconPackDirectory),
      disabledReason: iconPackDirectory ? "" : "本地数据目录不可用。",
    }),
    cleanupItem("local-legacy-directory", "local", "旧版本数据目录", "迁移前的 ~/.utools-project-launch 目录", {
      paths: legacyDirectoryExists ? [legacyDirectory] : [],
      estimatedBytes: directoryEntrySizeBytes(legacyDirectory),
      disabledReason: legacyDirectoryExists
        ? migrationCompleted
          ? ""
          : "迁移完成并通过校验后才能清理旧目录。"
        : "旧数据目录不存在。",
    }),
    cleanupItem("cache-temp-directory", "cache", "临时目录", "uTools 临时目录中的下载与更新残留", {
      paths: tempDirectory ? [tempDirectory] : [],
      disabledReason: tempDirectory ? "" : "临时目录不可用。",
    }),
    cleanupItem("cache-service-downloads", "cache", "服务下载残留", "服务目录中的 downloads、.partial 与 update.backup 文件", {
      kind: "service-downloads",
      paths: serviceDirectory ? [serviceDirectory] : [],
      disabledReason: serviceDirectory ? (serviceRunning ? "服务正在运行，请先停止服务。" : "") : "本地数据目录不可用。",
    }),
    cleanupItem("cache-diagnostics", "cache", "诊断与服务运行日志", "service.log 与服务运行日志目录", {
      kind: "service-diagnostics",
      paths: serviceDirectory ? [serviceDirectory] : [],
      disabledReason: serviceDirectory ? (serviceRunning ? "服务正在运行，请先停止服务。" : "") : "本地数据目录不可用。",
    }),
    cleanupItem("cache-git-activity", "cache", "Git 活动缓存", "内存中的 Git 报告与明细缓存（立即生效，无需确认）", {
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
