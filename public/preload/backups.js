const backupDocumentPrefix = "utools-project-launch/backup/";
const backupAttachmentPrefix = "utools-project-launch/backup-content/";
const backupMaximumBytes = 64 * 1024 * 1024;
const backupAttachmentMaximumBytes = 10_000_000;
let preparedBackup = null;
let backupOperationBusy = false;

function backupObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateBackupPayload(value) {
  if (
    !backupObject(value) ||
    value.format !== "project-launch-backup" ||
    value.version !== 1 ||
    !backupObject(value.source) ||
    typeof value.createdAt !== "string" ||
    ["hostname", "platform", "arch"].some((key) => typeof value.source[key] !== "string") ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new Error("备份格式或版本不受支持。");
  }
  if (!Array.isArray(value.projects) || !backupObject(value.localState)) {
    throw new Error("备份缺少项目或配置数据。");
  }
  if (value.runtimeRecordPolicy !== undefined) validateRuntimeRecordPolicy(value.runtimeRecordPolicy);
  const seen = new Set();
  value.projects.forEach((project) => {
    if (
      !backupObject(project) ||
      typeof project.id !== "string" ||
      !project.id.trim() ||
      project.id !== project.id.trim() ||
      seen.has(project.id) ||
      typeof project.name !== "string" ||
      !project.name.trim() ||
      typeof project.path !== "string" ||
      !project.path.trim() ||
      !["public", "private"].includes(project.visibility) ||
      !Array.isArray(project.scripts) ||
      project.scripts.some(
        (script) =>
          !backupObject(script) ||
          typeof script.id !== "string" ||
          typeof script.name !== "string" ||
          typeof script.command !== "string",
      ) ||
      !Array.isArray(project.automationTasks) ||
      project.automationTasks.some((task) => !backupObject(task)) ||
      !backupObject(project.env) ||
      Object.values(project.env).some((entry) => typeof entry !== "string") ||
      !Array.isArray(project.todos) ||
      project.todos.some((todo) => !backupObject(todo)) ||
      (project.relatedProjects !== undefined &&
        (!Array.isArray(project.relatedProjects) ||
          project.relatedProjects.some((relation) => !backupObject(relation))))
    ) {
      throw new Error("备份包含无效或重复的项目，未导入任何数据。");
    }
    seen.add(project.id);
  });
  if (
    value.localState.schemaVersion !== 1 ||
    !backupObject(value.localState.preferences) ||
    !backupObject(value.localState.workspace) ||
    !backupObject(value.localState.publicProjectOverrides)
  ) {
    throw new Error("备份配置数据不完整。");
  }
  for (const [section, preferences] of Object.entries(value.localState.preferences)) {
    if (!localStatePreferenceSections.has(section) || !backupObject(preferences)) {
      throw new Error("备份包含无效的配置分区。");
    }
  }
  for (const override of Object.values(value.localState.publicProjectOverrides)) {
    if (
      !backupObject(override) ||
      !backupObject(override.env) ||
      Object.values(override.env).some((entry) => typeof entry !== "string") ||
      !Array.isArray(override.localOnlyEnvKeys) ||
      override.localOnlyEnvKeys.some((key) => typeof key !== "string")
    ) {
      throw new Error("备份包含无效的本机环境变量。");
    }
  }
  return value;
}

function backupSummary(payload, bytes) {
  return {
    createdAt: payload.createdAt,
    source: {
      hostname: String(payload.source.hostname || ""),
      platform: String(payload.source.platform || ""),
      arch: String(payload.source.arch || ""),
    },
    projectCount: payload.projects.length,
    bytes,
  };
}

function collectBackupPayload() {
  const projects = readProjects().map((project, index) => {
    const stored = toStoredProject(project, index);
    stored.automationTasks = stored.automationTasks.map((task) => {
      const result = { ...task, dailyPlans: [], history: [] };
      delete result.observedServiceExecutionIds;
      return result;
    });
    return stored;
  });
  return validateBackupPayload({
    format: "project-launch-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    source: { hostname: os.hostname(), platform: process.platform, arch: process.arch },
    projects,
    localState: readLocalState(),
    runtimeRecordPolicy: readRuntimeRecordPolicy(),
  });
}

function encodeBackup(payload) {
  const raw = Buffer.from(JSON.stringify(validateBackupPayload(payload)), "utf8");
  if (raw.length > backupMaximumBytes) throw new Error("备份原始数据超过 64 MB，请先精简数据。");
  return require("node:zlib").gzipSync(raw);
}

function decodeBackup(bytes) {
  if (bytes.length > backupMaximumBytes * 2) throw new Error("备份文件过大。");
  let raw;
  try {
    raw = require("node:zlib").gunzipSync(bytes, { maxOutputLength: backupMaximumBytes });
  } catch (error) {
    throw new Error("备份文件格式不受支持或文件已损坏。");
  }
  return validateBackupPayload(JSON.parse(raw.toString("utf8"), backupJsonReviver));
}

function backupJsonReviver(key, value) {
  if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("备份包含不安全的字段。");
  return value;
}

async function withBackupOperation(operation) {
  if (backupOperationBusy) throw new Error("另一项备份操作正在进行，请稍后重试。");
  backupOperationBusy = true;
  try {
    return await operation();
  } finally {
    backupOperationBusy = false;
  }
}

function backupDb() {
  const db = window.utools?.db;
  if (!db?.put || !db?.get || !db?.allDocs || !db?.postAttachment || !db?.getAttachment || !db?.remove) {
    throw new Error("当前环境不支持 uTools 数据库备份。");
  }
  return db;
}

function validateBackupDocument(document) {
  if (
    !backupObject(document) ||
    typeof document._id !== "string" ||
    !document._id.startsWith(backupDocumentPrefix) ||
    document.version !== 1 ||
    !backupObject(document.summary) ||
    typeof document.name !== "string" ||
    typeof document.complete !== "boolean" ||
    typeof document.summary.createdAt !== "string" ||
    !Number.isFinite(Date.parse(document.summary.createdAt)) ||
    !backupObject(document.summary.source) ||
    ["hostname", "platform", "arch"].some((key) => typeof document.summary.source[key] !== "string") ||
    !Number.isSafeInteger(document.summary.projectCount) ||
    document.summary.projectCount < 0 ||
    document.attachmentId !== `${backupAttachmentPrefix}${document._id.slice(backupDocumentPrefix.length)}` ||
    !Number.isSafeInteger(document.summary.bytes) ||
    document.summary.bytes < 1 ||
    document.summary.bytes > backupAttachmentMaximumBytes ||
    !/^[a-f0-9]{64}$/.test(document.sha256)
  ) {
    throw new Error("备份记录无效。");
  }
  return document;
}

function readBackupDocument(id) {
  if (typeof id !== "string" || !id.startsWith(backupDocumentPrefix)) throw new Error("备份记录无效。");
  const document = backupDb().get(id);
  if (!document) throw new Error("备份不存在或尚未同步到本机，请刷新后重试。");
  return validateBackupDocument(document);
}

function readBackupBytes(document) {
  const attachment = backupDb().getAttachment(document.attachmentId);
  if (!attachment) throw new Error("备份内容尚未同步完整，请等待 uTools 同步完成后重试。");
  if (attachment.length > backupAttachmentMaximumBytes) throw new Error("备份内容超出大小限制。");
  const bytes = Buffer.from(attachment);
  if (
    bytes.length !== document.summary.bytes ||
    crypto.createHash("sha256").update(bytes).digest("hex") !== document.sha256
  ) {
    throw new Error("备份内容校验失败，请等待同步完成后重试。");
  }
  return bytes;
}

async function listBackups() {
  const db = backupDb();
  const documents = db.allDocs(backupDocumentPrefix);
  if (!Array.isArray(documents)) throw new Error("无法读取 uTools 备份列表。");
  const entries = documents
    .map((document) => {
      validateBackupDocument(document);
      return {
        id: document._id,
        name: document.name || "备份",
        ...document.summary,
        complete: document.complete === true,
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { entries, syncState: db.replicateStateFromCloud?.() ?? null };
}

async function saveBackupFile(bytes, name) {
  if (!window.utools?.showSaveDialog) throw new Error("当前环境不支持备份文件保存。");
  const selected = await window.utools.showSaveDialog({
    title: "导出备份",
    defaultPath: path.join(os.homedir(), `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100)}.plbackup`),
    filters: [{ name: "Project Launch 备份", extensions: ["plbackup"] }],
  });
  const targetPath = typeof selected === "string" ? selected : selected?.filePath;
  if (!targetPath) return { canceled: true };
  const temporaryPath = `${targetPath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return { path: targetPath };
}

async function createBackup(options) {
  return withBackupOperation(async () => {
    if (!backupObject(options) || !["local", "utools"].includes(options.destination)) throw new Error("备份参数无效。");
    const payload = collectBackupPayload();
    const bytes = encodeBackup(payload);
    const name = `备份-${payload.createdAt.slice(0, 10)}`;
    if (options.destination === "local") return saveBackupFile(bytes, name);
    if (bytes.length > backupAttachmentMaximumBytes)
      throw new Error("备份文件超过 uTools 单附件 10 MB 限制，请改用本地导出。");
    const db = backupDb();
    const key = crypto.randomBytes(12).toString("hex");
    const document = {
      _id: `${backupDocumentPrefix}${key}`,
      version: 1,
      name,
      summary: backupSummary(payload, bytes.length),
      attachmentId: `${backupAttachmentPrefix}${key}`,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      complete: false,
    };
    const initial = db.put(document);
    if (initial?.ok !== true) throw new Error("备份记录创建失败，未保存备份内容。");
    document._rev = initial.rev;
    const result = db.postAttachment(document.attachmentId, bytes, "application/octet-stream");
    if (result?.ok !== true) throw new Error("备份内容保存失败，可在备份列表中删除未完成的备份。");
    readBackupBytes(document);
    document.complete = true;
    if (db.put(document)?.ok !== true) throw new Error("备份未完成，可在备份列表中删除后重试。");
    const verified = readBackupDocument(document._id);
    if (!verified.complete || verified.sha256 !== document.sha256) throw new Error("备份记录保存后的回读校验失败。");
    return { id: document._id };
  });
}

async function prepareBackup(options) {
  return withBackupOperation(async () => {
    preparedBackup = null;
    let bytes;
    if (options?.source === "utools") {
      const document = readBackupDocument(options.id);
      if (!document.complete) throw new Error("备份尚未完成或仍在同步，请稍后重试。");
      bytes = readBackupBytes(document);
    } else if (options?.source === "local") {
      const selected = await window.utools?.showOpenDialog?.({
        title: "导入备份",
        properties: ["openFile"],
        filters: [{ name: "Project Launch 备份", extensions: ["plbackup"] }],
      });
      const filePath = Array.isArray(selected) ? selected[0] : selected?.filePaths?.[0];
      if (!filePath) return { canceled: true };
      if (fs.statSync(filePath).size > backupMaximumBytes * 2) throw new Error("备份文件过大。");
      bytes = fs.readFileSync(filePath);
    } else {
      throw new Error("备份来源无效。");
    }
    const payload = decodeBackup(bytes);
    preparedBackup = payload;
    return { summary: backupSummary(payload, bytes.length) };
  });
}

async function exportCloudBackup(id) {
  return withBackupOperation(async () => {
    const document = readBackupDocument(id);
    if (!document.complete) throw new Error("备份尚未完成，无法导出。");
    return saveBackupFile(readBackupBytes(document), document.name || "备份");
  });
}

async function deleteBackup(id) {
  return withBackupOperation(async () => {
    const db = backupDb();
    if (db.replicateStateFromCloud?.() === 1) throw new Error("正在拉取同步数据，请稍后删除备份。");
    const document = readBackupDocument(id);
    document.complete = false;
    const marked = db.put(document);
    if (marked?.ok !== true) throw new Error("无法标记待删除备份，请刷新后重试。");
    document._rev = marked.rev;
    if (db.get(document.attachmentId) && db.remove(document.attachmentId)?.ok !== true) {
      throw new Error("备份内容删除失败，已保留列表记录，请重试删除。");
    }
    if (db.remove(document)?.ok !== true) throw new Error("备份内容已删除，列表记录删除失败，请重试删除。");
    return { ok: true };
  });
}

async function restoreBackup(options) {
  return withBackupOperation(async () => {
    if (!preparedBackup) throw new Error("请先选择并预览备份。");
    if (
      !backupObject(options) ||
      typeof options.projects !== "boolean" ||
      typeof options.configuration !== "boolean" ||
      (!options.projects && !options.configuration) ||
      !["merge", "replace"].includes(options.projectMode) ||
      typeof options.pathFrom !== "string" ||
      typeof options.pathTo !== "string" ||
      (options.projects && Boolean(options.pathFrom) !== Boolean(options.pathTo))
    )
      throw new Error("请选择有效的导入选项。");
    if (!hasLocalDataDirectory()) throw new Error("插件本地数据目录不可用。");
    if (activeProcesses.size > 0 || (await projectLaunchServiceIsRunning()))
      throw new Error("请先停止运行中的脚本和项目启动服务，再导入备份。");
    if (window.utools?.db?.replicateStateFromCloud?.() === 1) throw new Error("正在拉取同步数据，请等待完成后再导入。");
    const payload = validateBackupPayload(preparedBackup);
    const before = collectBackupPayload();
    const recoveryDirectory = path.join(pluginLocalDataDirectory(), "backups");
    fs.mkdirSync(recoveryDirectory, { recursive: true });
    const recoveryPath = path.join(
      recoveryDirectory,
      `before-restore-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.plbackup`,
    );
    fs.writeFileSync(recoveryPath, encodeBackup(before), { flag: "wx", mode: 0o600 });
    const nextState = toPlainJson(before.localState);
    if (options.configuration) {
      nextState.preferences = toPlainJson(payload.localState.preferences);
      nextState.workspace = toPlainJson(payload.localState.workspace);
      nextState.preferences.projectLaunchService = { enabled: false };
    }
    let nextProjects = before.projects;
    if (options.projects) {
      const incoming = payload.projects.map((project) => {
        const restored = toStoredProject(project);
        const from = options.pathFrom.replace(/[\\/]+$/, "");
        const to = options.pathTo.replace(/[\\/]+$/, "");
        if (from && to) {
          const comparablePath = project.path.replace(/\\/g, "/");
          const comparableFrom = from.replace(/\\/g, "/");
          const matches =
            payload.source.platform === "win32"
              ? comparablePath.toLowerCase().startsWith(`${comparableFrom.toLowerCase()}/`) ||
                comparablePath.toLowerCase() === comparableFrom.toLowerCase()
              : comparablePath.startsWith(`${comparableFrom}/`) || comparablePath === comparableFrom;
          if (matches)
            restored.path =
              to + comparablePath.slice(comparableFrom.length).replace(/\//g, to.includes("\\") ? "\\" : "/");
        }
        restored.automationTasks = restored.automationTasks.map((task) => ({
          ...task,
          enabled: false,
          dailyPlans: [],
          history: [],
          observedServiceExecutionIds: [],
        }));
        return restored;
      });
      const incomingIds = new Set(incoming.map((project) => project.id));
      nextProjects =
        options.projectMode === "replace"
          ? incoming
          : [...incoming, ...before.projects.filter((project) => !incomingIds.has(project.id))];
      if (options.projectMode === "replace") nextState.publicProjectOverrides = {};
      for (const project of incoming) {
        delete nextState.publicProjectOverrides[project.id];
        const override = payload.localState.publicProjectOverrides[project.id];
        if (override && project.visibility === "public") nextState.publicProjectOverrides[project.id] = override;
      }
    }
    try {
      if (options.projects)
        writeStoredProjects(nextProjects, {
          baseProjects: before.projects,
          removedProjectIds:
            options.projectMode === "replace"
              ? before.projects
                  .filter((project) => !nextProjects.some((entry) => entry.id === project.id))
                  .map((project) => project.id)
              : [],
        });
      const result = writeLocalState(nextState);
      if (!result.ok) throw new Error(result.error || "本机配置保存失败。");
      if (JSON.stringify(readLocalState()) !== JSON.stringify(normalizeLocalState(nextState)))
        throw new Error("恢复后的本机配置回读校验失败。");
      if (options.configuration && payload.runtimeRecordPolicy !== undefined) {
        await updateRuntimeRecordRetention(payload.runtimeRecordPolicy);
        if (!storedValueEquals(readRuntimeRecordPolicy(), payload.runtimeRecordPolicy)) throw new Error("恢复后的日志策略回读校验失败。");
      }
    } catch (error) {
      throw new Error(`导入未完成，部分数据可能已写入。恢复前备份：${recoveryPath}。${error.message || error}`);
    }
    preparedBackup = null;
    return { ok: true, recoveryPath };
  });
}
