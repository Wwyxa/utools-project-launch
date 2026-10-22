const runtimeRecordWriters = new Map();
const runtimeRecordIdPattern = /^[0-9a-f]{32}$/;
const runtimeRecordFlushBytes = 64 * 1024;
const runtimeRecordFlushMs = 200;
const runtimeRecordPageBytes = 256 * 1024;
let runtimeRecordMaintenanceAt = 0;
let runtimeDiagnosticRecordId = "";
let runtimeRecordLastError = "";

function runtimeRecordsDirectory() {
  const root = pluginLocalDataDirectory();
  if (!root) throw new Error("插件本地数据目录不可用，无法保存运行记录。");
  const directory = path.join(root, "runtime");
  if (fs.existsSync(directory)) {
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("运行记录目录类型无效。");
  }
  return directory;
}

function runtimeRecordPath(runId, extension) {
  if (!runtimeRecordIdPattern.test(String(runId || ""))) throw new Error("运行记录标识无效。");
  const directory = path.join(runtimeRecordsDirectory(), "logs");
  if (fs.existsSync(directory)) {
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("运行日志目录类型无效。");
  }
  return path.join(directory, `${runId}.${extension}`);
}

function runtimeRecordReadJson(filePath) {
  try {
    if (!fs.lstatSync(filePath).isFile() || fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error("运行记录文件类型无效。");
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function runtimeRecordReadJsonAsync(filePath) {
  try {
    const info = await fs.promises.lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("运行记录文件类型无效。");
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function validateRuntimeRecordMetadata(record, name) {
  if (!record || record.schemaVersion !== 1 || !runtimeRecordIdPattern.test(record.runId) || `${record.runId}.json` !== name ||
      typeof record.projectId !== "string" || typeof record.scriptId !== "string" ||
      !["preload", "service", "operation", "automation", "diagnostic"].includes(record.source) ||
      !["starting", "running", "stopping", "stopped", "exited", "failed", "lost"].includes(record.status) ||
      !Number.isFinite(Date.parse(record.startedAt))) throw new Error(`运行记录元数据无效：${name}`);
  return record;
}

async function readRuntimeRecordsAsync(projectId) {
  const directory = path.join(runtimeRecordsDirectory(), "logs");
  let names;
  try {
    const info = await fs.promises.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("运行日志目录类型无效。");
    names = (await fs.promises.readdir(directory)).filter((name) => /^[0-9a-f]{32}\.json$/.test(name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (let offset = 0; offset < names.length; offset += 16) {
    const batch = await Promise.all(names.slice(offset, offset + 16).map(async (name) => {
      const stored = await runtimeRecordReadJsonAsync(path.join(directory, name));
      if (!stored) return null;
      const record = validateRuntimeRecordMetadata(stored, name);
      if (record.cleared || (projectId && record.projectId !== projectId)) return null;
      let sizeBytes = 0;
      let available = false;
      try {
        const info = await fs.promises.lstat(path.join(directory, `${record.runId}.log`));
        if (!info.isFile() || info.isSymbolicLink()) throw new Error("运行日志文件类型无效。");
        sizeBytes = info.size;
        available = true;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      const interrupted = runtimeRecordIsActive(record) && !runtimeRecordOwnerAlive(record);
      return { ...record, ...(interrupted ? { status: "lost" } : {}), sizeBytes, available };
    }));
    records.push(...batch.filter(Boolean));
  }
  return records;
}

function runtimeRecordDefaultPolicy() {
  return { persist: true, maxCompletedRunsPerProject: 200, maxBytesPerRun: 5 * 1024 * 1024, maxBytesTotal: 100 * 1024 * 1024 };
}

function validateRuntimeRecordPolicy(policy) {
  if (!policy || typeof policy.persist !== "boolean" ||
      !Number.isInteger(policy.maxCompletedRunsPerProject) || policy.maxCompletedRunsPerProject < 1 || policy.maxCompletedRunsPerProject > 200 ||
      ![policy.maxBytesPerRun, policy.maxBytesTotal].every((value) => Number.isSafeInteger(value) && value >= 1024 && value <= 1024 * 1024 * 1024)) {
    throw new Error("运行记录保留策略无效。");
  }
  return { persist: policy.persist, maxCompletedRunsPerProject: policy.maxCompletedRunsPerProject, maxBytesPerRun: policy.maxBytesPerRun, maxBytesTotal: policy.maxBytesTotal };
}

function readRuntimeRecordPolicy() {
  const stored = runtimeRecordReadJson(path.join(runtimeRecordsDirectory(), "policy.v1.json"));
  if (stored) {
    if (stored.schemaVersion !== 1) throw new Error("运行记录策略版本不受支持。");
    return validateRuntimeRecordPolicy(stored.policy);
  }
  return runtimeRecordDefaultPolicy();
}

function runtimeRecordIsActive(record) {
  return ["starting", "running", "stopping"].includes(record.status);
}

async function readRuntimeRecordPolicyAsync() {
  const stored = await runtimeRecordReadJsonAsync(path.join(runtimeRecordsDirectory(), "policy.v1.json"));
  if (stored) {
    if (stored.schemaVersion !== 1) throw new Error("运行记录策略版本不受支持。");
    return validateRuntimeRecordPolicy(stored.policy);
  }
  return runtimeRecordDefaultPolicy();
}

function runtimeRecordTombstone(record) {
  return {
    schemaVersion: 1, runId: record.runId, source: record.source, projectId: record.projectId,
    scriptId: record.scriptId, status: record.status, startedAt: record.startedAt,
    endedAt: record.endedAt, truncated: record.truncated === true, cleared: true,
  };
}

function runtimeRecordOwnerAlive(record) {
  if (!runtimeRecordIsActive(record)) return false;
  if (!Number.isInteger(record.writerPid) || record.writerPid <= 0) return true;
  try {
    process.kill(record.writerPid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function readRuntimeRecords() {
  const directory = path.join(runtimeRecordsDirectory(), "logs");
  let entries;
  try { entries = fs.readdirSync(directory); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((name) => /^[0-9a-f]{32}\.json$/.test(name)).map((name) => {
    const record = runtimeRecordReadJson(path.join(directory, name));
    validateRuntimeRecordMetadata(record, name);
    const logPath = runtimeRecordPath(record.runId, "log");
    let sizeBytes = 0;
    let available = false;
    try {
      const info = fs.lstatSync(logPath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("运行日志文件类型无效。");
      sizeBytes = info.size;
      available = true;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const interrupted = runtimeRecordIsActive(record) && !runtimeRecordOwnerAlive(record);
    return { ...record, ...(interrupted ? { status: "lost" } : {}), sizeBytes, available };
  });
}

function runtimeRecordFailure(writer, error) {
  writer.record.durableWriteError = String(error?.message || "运行记录保存失败。").slice(0, 1024);
  writer.record.truncated = true;
  writer.pending = [];
  writer.pendingBytes = 0;
  if (writer.timer) clearTimeout(writer.timer);
  writer.timer = null;
  try { writeJsonFileAtomic(runtimeRecordPath(writer.record.runId, "json"), writer.record); } catch {}
  if (writer.record.durableWriteError === runtimeRecordLastError) return { ok: false, error: writer.record.durableWriteError };
  runtimeRecordLastError = writer.record.durableWriteError;
  console.error("[utools-project-launch] Runtime record persistence failed.");
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("project-bridge-event", { detail: {
      type: "runtime-record-error", message: writer.record.durableWriteError,
    } }));
  }
  return { ok: false, error: writer.record.durableWriteError };
}

function beginRuntimeRecord(payload, source = "preload", runId = crypto.randomBytes(16).toString("hex")) {
  const record = {
    schemaVersion: 1, runId, source, projectId: String(payload.projectId || ""), scriptId: String(payload.scriptId || ""),
    label: String(payload.label || payload.scriptId || payload.projectId || ""), command: String(payload.command || ""),
    status: "running", startedAt: new Date().toISOString(), truncated: false, writerPid: process.pid,
    ...(payload.automationRunId ? { automationRunId: payload.automationRunId } : {}),
  };
  const writer = { record, pending: [], pendingBytes: 0, timer: null };
  runtimeRecordWriters.set(runId, writer);
  try {
    if (readRuntimeRecordPolicy().persist) writeJsonFileAtomic(runtimeRecordPath(runId, "json"), record);
  } catch (error) { runtimeRecordFailure(writer, error); }
  return runId;
}

function appendRuntimeRecordEvent(event) {
  const writer = runtimeRecordWriters.get(event.runId);
  if (!writer) return;
  const terminal = event.type === "exit" || event.type === "error";
  if (writer.record.durableWriteError && !terminal) return;
  if ((event.type === "stdout" || event.type === "stderr") && typeof event.message === "string" && event.message.length > 4096) {
    let remaining = event.message;
    while (remaining.length) {
      let length = Math.min(4096, remaining.length);
      const last = remaining.charCodeAt(length - 1);
      if (length < remaining.length && last >= 0xd800 && last <= 0xdbff) length--;
      appendRuntimeRecordEvent({ ...event, message: remaining.slice(0, length) });
      remaining = remaining.slice(length);
    }
    return;
  }
  const timestamp = event.timestamp || new Date().toISOString();
  try {
    const policy = readRuntimeRecordPolicy();
    if (policy.persist && !writer.record.durableWriteError) {
      const safeEvent = {
        cursor: (writer.cursor || 0) + 1, timestamp, type: event.type, runId: event.runId,
        projectId: writer.record.projectId, scriptId: writer.record.scriptId,
        ...(typeof event.pid === "number" ? { pid: event.pid } : {}),
        ...(typeof event.message === "string" ? { message: event.message } : {}),
        ...(typeof event.cwd === "string" ? { cwd: event.cwd } : {}),
        ...(event.code !== undefined ? { code: event.code } : {}),
        ...(event.signal ? { signal: event.signal } : {}),
        ...(event.level ? { level: event.level } : {}),
        ...(event.stoppedByUser ? { stoppedByUser: true } : {}),
        ...(event.automationExitMatched ? { automationExitMatched: true } : {}),
        ...(writer.record.automationRunId ? { automationRunId: writer.record.automationRunId } : {}),
      };
      writer.cursor = safeEvent.cursor;
      const line = JSON.stringify(safeEvent) + "\n";
      writer.pending.push(line);
      writer.pendingBytes += Buffer.byteLength(line);
      if (writer.pendingBytes >= runtimeRecordFlushBytes) flushRuntimeRecord(event.runId);
      else if (!writer.timer) {
        writer.timer = setTimeout(() => flushRuntimeRecord(event.runId), runtimeRecordFlushMs);
        writer.timer.unref?.();
      }
    }
    if (terminal) {
      flushRuntimeRecord(event.runId);
      writer.record.status = event.type === "error" || (event.code !== 0 && !event.stoppedByUser && !event.automationExitMatched) ? "failed" : event.stoppedByUser ? "stopped" : "exited";
      writer.record.endedAt = timestamp;
      if (policy.persist || fs.existsSync(runtimeRecordPath(event.runId, "json"))) {
        writeJsonFileAtomic(runtimeRecordPath(event.runId, "json"), writer.record);
      }
      runtimeRecordWriters.delete(event.runId);
      enforceRuntimeRecordRetention();
    }
  } catch (error) {
    if (terminal) {
      writer.record.status = event.type === "error" || (event.code !== 0 && !event.stoppedByUser && !event.automationExitMatched) ? "failed" : event.stoppedByUser ? "stopped" : "exited";
      writer.record.endedAt = timestamp;
    }
    runtimeRecordFailure(writer, error);
    if (terminal) runtimeRecordWriters.delete(event.runId);
  }
}

function flushRuntimeRecord(runId) {
  const writer = runtimeRecordWriters.get(runId);
  if (!writer) return;
  if (writer.timer) clearTimeout(writer.timer);
  writer.timer = null;
  if (!writer.pendingBytes) return;
  try {
    const filePath = runtimeRecordPath(runId, "log");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(runtimeRecordPath(runId, "json"))) writeJsonFileAtomic(runtimeRecordPath(runId, "json"), writer.record);
    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) throw new Error("运行日志不能是符号链接。");
    const descriptor = fs.openSync(filePath, "a", 0o600);
    try { fs.writeFileSync(descriptor, writer.pending.join(""), "utf8"); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    writer.pending = [];
    writer.pendingBytes = 0;
    trimRuntimeRecord(runId, readRuntimeRecordPolicy().maxBytesPerRun, writer.record);
    if (Date.now() - runtimeRecordMaintenanceAt > 1000) enforceRuntimeRecordRetention();
  } catch (error) { runtimeRecordFailure(writer, error); }
}

function flushRuntimeRecords() {
  for (const runId of runtimeRecordWriters.keys()) flushRuntimeRecord(runId);
}

function trimRuntimeRecord(runId, maximumBytes, record) {
  const filePath = runtimeRecordPath(runId, "log");
  const size = fs.statSync(filePath).size;
  if (size <= maximumBytes) return;
  const descriptor = fs.openSync(filePath, "r");
  const bytes = Buffer.alloc(Math.min(size, Math.max(0, maximumBytes)));
  try { fs.readSync(descriptor, bytes, 0, bytes.length, size - bytes.length); } finally { fs.closeSync(descriptor); }
  const newline = bytes.indexOf(10);
  const retained = newline < 0 ? Buffer.alloc(0) : bytes.subarray(newline + 1);
  const temporaryPath = filePath + `.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  fs.writeFileSync(temporaryPath, retained, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporaryPath, filePath);
  record.truncated = true;
  writeJsonFileAtomic(runtimeRecordPath(runId, "json"), record);
}

function withRuntimeRecordMaintenance(operation, required = false) {
  const directory = path.join(runtimeRecordsDirectory(), "maintenance.lock");
  const acquire = () => {
    try { fs.mkdirSync(directory, { recursive: false, mode: 0o700 }); return true; } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = runtimeRecordReadJson(path.join(directory, "owner.json"));
      if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return false;
      try { process.kill(owner.pid, 0); return false; } catch (error) {
        if (error.code !== "ESRCH") return false;
        fs.rmSync(directory, { recursive: true });
        try { fs.mkdirSync(directory, { mode: 0o700 }); return true; } catch (error) {
          if (error.code === "EEXIST") return false;
          throw error;
        }
      }
    }
  };
  fs.mkdirSync(runtimeRecordsDirectory(), { recursive: true, mode: 0o700 });
  if (!acquire()) {
    if (required) throw new Error("运行记录正在维护，请稍后重试。");
    return;
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  const release = () => {
    const owner = runtimeRecordReadJson(path.join(directory, "owner.json"));
    if (!owner || owner.nonce === nonce) fs.rmSync(directory, { recursive: true, force: true });
  };
  try {
    writeJsonFileAtomic(path.join(directory, "owner.json"), { pid: process.pid, nonce });
    const result = operation();
    if (result && typeof result.then === "function") return result.finally(release);
    release();
    return result;
  } catch (error) {
    release();
    throw error;
  }
}

function enforceRuntimeRecordRetention() {
  return withRuntimeRecordMaintenance(enforceRuntimeRecordRetentionUnlocked);
}

function enforceRuntimeRecordRetentionUnlocked() {
  runtimeRecordMaintenanceAt = Date.now();
  const policy = readRuntimeRecordPolicy();
  const records = readRuntimeRecords().sort((left, right) => Date.parse(left.endedAt || left.startedAt) - Date.parse(right.endedAt || right.startedAt));
  const legacy = runtimeRecordReadJson(path.join(pluginLocalDataDirectory(), "service", "state.json"));
  const referenced = new Set((legacy?.runs || []).map((run) => run.id));
  for (const execution of legacy?.automation?.executions || []) referenced.add(crypto.createHash("sha256").update(`automation:${execution.id}`).digest("hex").slice(0, 32));
  for (const record of records) {
    if (record.cleared && !referenced.has(record.runId)) fs.rmSync(runtimeRecordPath(record.runId, "json"), { force: true });
  }
  const completed = records.filter((record) => !record.cleared && !runtimeRecordIsActive(record));
  let total = records.reduce((size, record) => size + record.sizeBytes, 0);
  const counts = new Map();
  for (const record of completed) counts.set(record.projectId, (counts.get(record.projectId) || 0) + 1);
  for (const record of completed) {
    if (record.available && record.sizeBytes > policy.maxBytesPerRun) {
      trimRuntimeRecord(record.runId, policy.maxBytesPerRun, record);
      const nextSize = fs.statSync(runtimeRecordPath(record.runId, "log")).size;
      total -= record.sizeBytes - nextSize;
      record.sizeBytes = nextSize;
    }
    if (counts.get(record.projectId) > policy.maxCompletedRunsPerProject || total > policy.maxBytesTotal) {
      if (record.cleared) continue;
      if (referenced.has(record.runId)) writeJsonFileAtomic(runtimeRecordPath(record.runId, "json"), runtimeRecordTombstone(record));
      else fs.rmSync(runtimeRecordPath(record.runId, "json"), { force: true });
      fs.rmSync(runtimeRecordPath(record.runId, "log"), { force: true });
      total -= record.sizeBytes;
      counts.set(record.projectId, counts.get(record.projectId) - 1);
    }
  }
  for (const record of records) {
    const writer = runtimeRecordWriters.get(record.runId);
    if (total <= policy.maxBytesTotal || !writer || !record.available) continue;
    const target = Math.max(0, record.sizeBytes - (total - policy.maxBytesTotal));
    trimRuntimeRecord(record.runId, target, writer.record);
    total -= record.sizeBytes - fs.statSync(runtimeRecordPath(record.runId, "log")).size;
  }
}

async function listRuntimeRecords(projectId) {
  return (await readRuntimeRecordsAsync(projectId)).filter((record) =>
    (!runtimeRecordIsActive(record) || record.source === "diagnostic"))
    .sort((left, right) => Date.parse(right.endedAt || right.startedAt) - Date.parse(left.endedAt || left.startedAt));
}

async function readRuntimeRecordLogPage(runId, beforeOffset = 0) {
  if (!Number.isSafeInteger(beforeOffset) || beforeOffset < 0) throw new Error("运行记录分页位置无效。");
  flushRuntimeRecord(runId);
  const record = await runtimeRecordReadJsonAsync(runtimeRecordPath(runId, "json"));
  if (!record || record.cleared || record.schemaVersion !== 1 || record.runId !== runId) throw new Error("运行记录不可用。");
  const filePath = runtimeRecordPath(runId, "log");
  const info = await fs.promises.lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("运行日志文件类型无效。");
  if (beforeOffset > info.size) throw new Error("运行记录分页位置超出日志大小。");
  const end = beforeOffset || info.size;
  let start = Math.max(0, end - runtimeRecordPageBytes);
  const descriptor = await fs.promises.open(filePath, "r");
  let bytes = Buffer.alloc(end - start);
  try { await descriptor.read(bytes, 0, bytes.length, start); } finally { await descriptor.close(); }
  if (start > 0) {
    const newline = bytes.indexOf(10);
    if (newline < 0) throw new Error("运行记录超过分页大小。");
    start += newline + 1;
    bytes = bytes.subarray(newline + 1);
  }
  const lines = bytes.toString("utf8").split("\n");
  const final = lines.pop();
  const events = lines.filter(Boolean).map((line) => {
    const event = JSON.parse(line);
    if (event.runId !== runId || !["started", "stdout", "stderr", "stdin", "exit", "error"].includes(event.type) ||
        !Number.isFinite(Date.parse(event.timestamp))) throw new Error("运行日志事件无效。");
    return event;
  });
  return { runId, events, truncated: record.truncated === true || Boolean(final), sizeBytes: info.size, hasMore: start > 0, nextOffset: start };
}

async function getRuntimeRecordRetention() {
  const records = await readRuntimeRecordsAsync();
  return { policy: await readRuntimeRecordPolicyAsync(), usage: { fileCount: records.filter((record) => record.available).length, totalBytes: records.reduce((size, record) => size + record.sizeBytes, 0) } };
}

async function updateRuntimeRecordRetention(policy) {
  flushRuntimeRecords();
  withRuntimeRecordMaintenance(() => {
    writeJsonFileAtomic(path.join(runtimeRecordsDirectory(), "policy.v1.json"), { schemaVersion: 1, policy: validateRuntimeRecordPolicy(policy) });
    enforceRuntimeRecordRetentionUnlocked();
  }, true);
  return getRuntimeRecordRetention();
}

async function clearRuntimeRecords(scope) {
  if (scope !== undefined && !(
    (scope?.projectId === undefined && typeof scope?.runId === "string" && runtimeRecordIdPattern.test(scope.runId)) ||
    (scope?.runId === undefined && typeof scope?.projectId === "string" && scope.projectId.trim().length > 0)
  )) throw new Error("运行记录清理范围无效。");
  flushRuntimeRecords();
  return withRuntimeRecordMaintenance(() => clearRuntimeRecordsUnlocked(scope), true);
}

function clearRuntimeRecordsUnlocked(scope) {
  let deletedCount = 0;
  let releasedBytes = 0;
  for (const record of readRuntimeRecords()) {
    if (scope?.runId !== undefined && scope.runId !== record.runId) continue;
    if (scope?.projectId !== undefined && scope.projectId !== record.projectId) continue;
    if (runtimeRecordIsActive(record)) continue;
    const tombstone = runtimeRecordTombstone(record);
    writeJsonFileAtomic(runtimeRecordPath(record.runId, "json"), tombstone);
    fs.rmSync(runtimeRecordPath(record.runId, "log"), { force: true });
    deletedCount += record.available ? 1 : 0;
    releasedBytes += record.sizeBytes;
  }
  enforceRuntimeRecordRetentionUnlocked();
  return { deletedCount, releasedBytes };
}

function appendRuntimeOperationLog(projectId, log, scriptId = "") {
  try {
    const runId = beginRuntimeRecord({ projectId, scriptId, label: scriptId || "操作记录" }, "operation");
    appendRuntimeRecordEvent({ runId, type: "stdout", message: log.message, level: log.type });
    appendRuntimeRecordEvent({ runId, type: "exit", code: log.type === "ERROR" ? 1 : 0 });
    return { ok: true };
  } catch (error) { return localStateWriteError(error); }
}

function appendRuntimeDiagnostic(event) {
  try {
    if (!runtimeDiagnosticRecordId) runtimeDiagnosticRecordId = beginRuntimeRecord({ projectId: "__plugin__", scriptId: "", label: "插件诊断" }, "diagnostic");
    appendRuntimeRecordEvent({ runId: runtimeDiagnosticRecordId, type: "stdout", message: String(event), level: "INFO" });
  } catch { console.error("[utools-project-launch] Diagnostic persistence failed."); }
}

function wrapRuntimeOperation(label, operation) {
  return function (...args) {
    let projectId = "__plugin__";
    const context = args[0];
    try {
      if (typeof context?.projectId === "string") projectId = context.projectId;
      else if (typeof context === "string") {
        const project = readProjects().find((item) => item.id === context || expandPath(item.path) === expandPath(context));
        if (project) projectId = project.id;
      }
    } catch {}
    const runId = beginRuntimeRecord({ projectId, scriptId: "", label }, "operation");
    appendRuntimeRecordEvent({ runId, type: "stdout", message: label, level: "INFO" });
    const finish = (result, thrown = false) => {
      const failed = thrown || result?.ok === false || result?.launched === false || result?.accepted === false;
      appendRuntimeRecordEvent({ runId, type: "stdout", message: failed ? `${label}: 失败` : `${label}: 完成`, level: failed ? "ERROR" : "SUCCESS" });
      appendRuntimeRecordEvent({ runId, type: "exit", code: failed ? 1 : 0 });
      return result;
    };
    try {
      const result = operation.apply(this, args);
      if (result && typeof result.then === "function") return result.then((value) => finish(value), (error) => { finish(null, true); throw error; });
      return finish(result);
    } catch (error) { finish(null, true); throw error; }
  };
}

function runtimeAutomationStatePath(projectId) {
  if (typeof projectId !== "string" || !projectId.trim()) throw new Error("自动任务项目标识无效。");
  const digest = crypto.createHash("sha256").update(projectId).digest("hex");
  const directory = path.join(runtimeRecordsDirectory(), "scheduler");
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error("自动任务状态目录不能是符号链接。");
  return path.join(directory, `${digest}.json`);
}

function loadRuntimeAutomationState(projectId) {
  const stored = runtimeRecordReadJson(runtimeAutomationStatePath(projectId));
  if (!stored) return [];
  if (stored.schemaVersion !== 1 || stored.projectId !== projectId || !Array.isArray(stored.tasks) ||
      stored.tasks.some((task) => typeof task.taskId !== "string" || !Array.isArray(task.dailyPlans) || !Array.isArray(task.history) ||
        task.dailyPlans.some((plan) => typeof plan.date !== "string" || !Array.isArray(plan.entries) || plan.entries.some((entry) =>
          typeof entry.id !== "string" || !Number.isFinite(Date.parse(entry.plannedAt)) ||
          !["pending", "running", "completed", "failed", "skipped", "missed"].includes(entry.status))) ||
        task.history.some((entry) => entry.projectId !== projectId || entry.taskId !== task.taskId || !Array.isArray(entry.scriptResults)))) {
    throw new Error("自动任务本地状态无效。");
  }
  return stored.tasks;
}

function saveRuntimeAutomationState(projectId, tasks) {
  try {
    if (!Array.isArray(tasks) || tasks.some((task) => typeof task.taskId !== "string" || !Array.isArray(task.dailyPlans) || !Array.isArray(task.history))) {
      throw new Error("自动任务本地状态无效。");
    }
    return withRuntimeRecordMaintenance(() => {
      const previous = loadRuntimeAutomationState(projectId);
      const next = tasks.map((task) => {
        const stored = previous.find((item) => item.taskId === task.taskId);
        const previousEntries = new Map((stored?.dailyPlans || []).flatMap((plan) => plan.entries).map((entry) => [entry.id, entry]));
        const dailyPlans = task.dailyPlans.slice(0, 7).map((plan) => ({ ...plan, entries: plan.entries.map((entry) => {
          const current = previousEntries.get(entry.id);
          if (entry.status === "running" && current && current.status !== "pending" &&
              (current.status !== "running" || current.runId !== entry.runId)) throw new Error("自动任务计划已被其他运行认领。");
          if (entry.status === "pending" && current && current.status !== "pending") return current;
          return entry;
        }) }));
        const history = new Map((stored?.history || []).map((entry) => [entry.id, entry]));
        task.history.forEach((entry) => history.set(entry.id, entry));
        return { taskId: task.taskId, dailyPlans, history: [...history.values()]
          .sort((left, right) => Date.parse(right.endedAt || right.plannedAt) - Date.parse(left.endedAt || left.plannedAt)).slice(0, 20) };
      });
      writeJsonFileAtomic(runtimeAutomationStatePath(projectId), { schemaVersion: 1, projectId, tasks: next });
      return { ok: true };
    }, true);
  } catch (error) { return localStateWriteError(error); }
}

function saveRuntimeAutomationExecution(execution) {
  try {
    if (!execution || typeof execution.id !== "string" || typeof execution.projectId !== "string" || typeof execution.taskId !== "string" ||
        !["running", "completed", "failed", "skipped", "missed"].includes(execution.status) || !Array.isArray(execution.scriptResults)) {
      throw new Error("自动任务执行记录无效。");
    }
    const runId = crypto.createHash("sha256").update(`automation:${execution.id}`).digest("hex").slice(0, 32);
    const existing = runtimeRecordReadJson(runtimeRecordPath(runId, "json"));
    if (existing?.cleared || (!readRuntimeRecordPolicy().persist && (!existing || !runtimeRecordIsActive(existing)))) return { ok: true };
    if (existing?.execution && JSON.stringify(existing.execution) === JSON.stringify(execution)) return { ok: true };
    if (!runtimeRecordWriters.has(runId)) {
      beginRuntimeRecord({ projectId: execution.projectId, scriptId: "", label: execution.taskId }, "automation", runId);
      if (existing) runtimeRecordWriters.get(runId).record = existing;
    }
    const writer = runtimeRecordWriters.get(runId);
    writer.record.execution = {
      id: execution.id, projectId: execution.projectId, taskId: execution.taskId, planEntryId: execution.planEntryId,
      plannedAt: execution.plannedAt, startedAt: execution.startedAt, endedAt: execution.endedAt,
      status: execution.status, currentScriptIndex: execution.currentScriptIndex || 0, reason: execution.reason,
      scriptResults: execution.scriptResults.map((result) => ({ scriptId: result.scriptId, status: result.status,
        startedAt: result.startedAt, endedAt: result.endedAt, reason: result.reason })),
    };
    writer.record.startedAt = execution.startedAt || execution.plannedAt || new Date().toISOString();
    writeJsonFileAtomic(runtimeRecordPath(runId, "json"), writer.record);
    if (execution.status !== "running") {
      appendRuntimeRecordEvent({ runId, type: "stdout", message: execution.reason || execution.status });
      appendRuntimeRecordEvent({ runId, type: "exit", code: execution.status === "failed" || execution.status === "missed" ? 1 : 0,
        timestamp: execution.endedAt || new Date().toISOString() });
    }
    return writer.record.durableWriteError ? { ok: false, error: writer.record.durableWriteError } : { ok: true };
  } catch (error) { return localStateWriteError(error); }
}