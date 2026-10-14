// uTools v8 startup gate and one-time storage migration.
//
// Migration moves every device-scoped payload out of the syncing database and
// the legacy ~/.utools-project-launch directory into the plugin local data
// directory:
//   - dbStorage preference keys        -> local-state.v1.json
//   - private project documents        -> projects/<id>.json (this device only)
//   - service directory                -> <local-data>/service (allowlist)
//   - icon pack directory              -> <local-data>/icon-packs
//
// Rules enforced here:
//   - never delete a source before its target is written back and verified;
//   - the legacy aggregate key and private documents owned by other devices
//     are never migrated silently or resurrected by the normal read path;
//   - the ledger (migration.v1.json) makes every step resumable and auditable.

const migrationLedgerFileName = 'migration.v1.json';
const migrationLedgerSchemaVersion = 1;
const legacyDataDirectoryEnvOverride = 'UTOOLS_PROJECT_LAUNCH_LEGACY_DATA_DIR';
const legacyDataDirectoryName = '.utools-project-launch';
const legacyDeviceIdFileName = 'device-id.v1';
const legacyDeviceIdStorageKey = 'utools-project-launch.device-id.v1';

const legacyTerminalPreferencesKey = 'utools-project-launch.local-settings.v1';
const legacyTerminalFallbackPreferencesKey = 'utools-project-launch.settings.v1';
const legacyExternalApplicationPreferencesKey = 'utools-project-launch.local-external-applications.v1';
const legacyEditorPreferencesKey = 'utools-project-launch.local-editor-settings.v1';
const legacyEditorFallbackPreferencesKey = 'utools-project-launch.editor-settings.v1';
const legacyEnvironmentPreferencesKey = 'utools-project-launch.environment-settings.v1';
const legacyAiPreferencesKey = 'utools-project-launch.ai-settings.v1';
const legacyUiPreferencesKey = 'utools-project-launch.ui-preferences.v1';
const legacyProjectDetailsTabOrderKey = 'utools-project-launch.project-details-tab-order.v1';
const legacyProjectLaunchServicePreferencesKey = 'utools-project-launch.project-launch-service.v1';

const migrationPreferenceKeys = [
  legacyTerminalPreferencesKey,
  legacyTerminalFallbackPreferencesKey,
  legacyExternalApplicationPreferencesKey,
  legacyEditorPreferencesKey,
  legacyEditorFallbackPreferencesKey,
  legacyEnvironmentPreferencesKey,
  legacyAiPreferencesKey,
  legacyUiPreferencesKey,
  legacyProjectDetailsTabOrderKey,
  legacyProjectLaunchServicePreferencesKey,
];

function legacyPluginDataDirectory() {
  const override = normalizeConfiguredDirectory(process.env?.[legacyDataDirectoryEnvOverride]);
  return override || path.join(os.homedir(), legacyDataDirectoryName);
}

function migrationLedgerPath() {
  return path.join(pluginLocalDataDirectory(), migrationLedgerFileName);
}

function readMigrationLedger() {
  const stored = readJsonFile(migrationLedgerPath());
  if (!stored || typeof stored !== 'object' || stored.schemaVersion !== migrationLedgerSchemaVersion) {
    return null;
  }
  return {
    schemaVersion: migrationLedgerSchemaVersion,
    status: typeof stored.status === 'string' ? stored.status : 'in-progress',
    startedAt: typeof stored.startedAt === 'string' ? stored.startedAt : '',
    completedAt: typeof stored.completedAt === 'string' ? stored.completedAt : '',
    items: Array.isArray(stored.items) ? stored.items : [],
  };
}

function writeMigrationLedger(ledger) {
  writeJsonFileAtomic(migrationLedgerPath(), ledger);
}

function readLegacyDbStorageValue(key) {
  try {
    const stored = window.utools?.dbStorage?.getItem(key);
    if (stored !== null && stored !== undefined) return stored;
  } catch (error) {
    // Fall through to the localStorage mirror below.
  }
  try {
    const raw = window.localStorage?.getItem(key);
    return raw === null || raw === undefined ? null : JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function readLegacyStoredProjects() {
  const stored = readLegacyDbStorageValue(storageKey);
  if (Array.isArray(stored?.projects)) return stored.projects;
  return Array.isArray(stored) ? stored : [];
}

// The legacy device id is read once, only to decide which private documents
// belong to this device during migration. It is not persisted anywhere in the
// new storage layout and the device identity design itself is gone.
// Legacy documents stamp a device-ownership field onto projects. The new
// storage model has no device identity at all; this single data-level read
// exists only so the one-time migration can tell which private documents
// belong to this device. It must never leak into the new storage layout.
const legacyOwnerDeviceIdField = 'ownerDeviceId';

function collectLegacyDeviceId() {
  try {
    const fromFile = fs.readFileSync(path.join(legacyPluginDataDirectory(), legacyDeviceIdFileName), 'utf8').trim();
    if (fromFile) return fromFile;
  } catch (error) {
    // Fall through to the browser mirror below.
  }
  try {
    const fromStorage = window.localStorage?.getItem(legacyDeviceIdStorageKey);
    if (typeof fromStorage === 'string' && fromStorage.trim()) return fromStorage.trim();
  } catch (error) {
    // No legacy identity available.
  }
  return '';
}

function legacyDirectoryHasData() {
  try {
    // The device-id file alone is identity data with nothing to migrate, so it
    // does not qualify the directory as carrying migratable payload.
    return fs
      .readdirSync(legacyPluginDataDirectory())
      .some((entry) => entry !== migrationLedgerFileName && entry !== 'migration' && entry !== legacyDeviceIdFileName);
  } catch (error) {
    return false;
  }
}

function collectLegacyDataSummary() {
  const summary = {
    legacyDirectoryHasData: false,
    legacyDbStorageKeys: [],
    legacyAggregateProjects: 0,
    legacyPrivateProjectDocs: 0,
  };
  try {
    summary.legacyDbStorageKeys = migrationPreferenceKeys
      .filter((key) => readLegacyDbStorageValue(key) !== null)
      .concat(readLegacyDbStorageValue(storageKey) !== null ? [storageKey] : []);
    summary.legacyAggregateProjects = readLegacyStoredProjects().length;
    summary.legacyPrivateProjectDocs = readProjectDocs().filter(
      (document) => document?.project?.visibility === 'private',
    ).length;
    summary.legacyDirectoryHasData = legacyDirectoryHasData();
  } catch (error) {
    // A failing legacy probe must never crash the preflight.
  }
  return summary;
}

function hasLegacyData(summary) {
  return Boolean(
    summary.legacyDbStorageKeys.length > 0 ||
    summary.legacyAggregateProjects > 0 ||
    summary.legacyPrivateProjectDocs > 0 ||
    summary.legacyDirectoryHasData,
  );
}

function parseHostMajorVersion(version) {
  const match = /^(\d+)\./.exec(String(version || '').trim());
  return match ? Number(match[1]) : null;
}

function requiredHostMajorVersion() {
  return 8;
}

function preflightStartup() {
  const capabilities = pluginV8Capabilities();
  const legacy = collectLegacyDataSummary();

  if (!capabilities.hasUtools) {
    // Browser development preview uses an explicit, non-migrating fallback.
    return {
      status: 'browser-preview',
      browserPreview: true,
      appVersion: '',
      capabilities,
      migration: null,
      legacy,
      message: '浏览器开发预览模式：使用本地 fallback 存储，不执行真实迁移。',
    };
  }

  let appVersion = '';
  try {
    appVersion = typeof window.utools.getAppVersion === 'function' ? String(window.utools.getAppVersion() || '') : '';
  } catch (error) {
    appVersion = '';
  }
  const majorVersion = parseHostMajorVersion(appVersion);

  if (
    !capabilities.getPluginLocalDataPath ||
    !capabilities.getPluginTempPath ||
    (majorVersion !== null && majorVersion < requiredHostMajorVersion())
  ) {
    return {
      status: 'upgrade-required',
      appVersion,
      capabilities,
      migration: null,
      legacy,
      message: '当前 uTools 版本过低或缺少 v8 本地数据能力，请先升级 uTools 至 v8 及以上。',
    };
  }

  const ledger = readMigrationLedger();
  const migration = ledger ? migrationProgressSnapshot({ ...ledger }) : null;
  if (ledger && ledger.status !== 'completed') {
    return {
      status: 'migration-incomplete',
      appVersion,
      capabilities,
      migration,
      legacy,
      message: '上一次数据迁移未完成，旧数据仍完整保留，请继续或重试迁移。',
    };
  }
  if (!ledger && hasLegacyData(legacy)) {
    return {
      status: 'migration-required',
      appVersion,
      capabilities,
      migration: null,
      legacy,
      message: '检测到旧版本数据，需要先完成迁移才能使用。',
    };
  }
  if (ledger && pendingMigrationPlanItems(ledger, collectLegacyDeviceId()).length > 0) {
    return {
      status: 'migration-required',
      appVersion,
      capabilities,
      migration,
      legacy,
      message: '检测到尚未迁移的旧版本数据，请补充迁移。现有本机数据会保留。',
    };
  }
  return {
    status: 'ready',
    appVersion,
    capabilities,
    migration,
    legacy,
    message: '',
  };
}

// ---------------------------------------------------------------------------
// Migration plan and ledger
// ---------------------------------------------------------------------------

function migrationProgressSnapshot(ledger) {
  const items = Array.isArray(ledger?.items) ? ledger.items : [];
  return {
    status: ledger?.status || 'in-progress',
    startedAt: ledger?.startedAt || '',
    completedAt: ledger?.completedAt || '',
    totalCount: items.length,
    verifiedCount: items.filter((item) => item.status === 'verified' || item.status === 'skipped').length,
    failedCount: items.filter((item) => item.status === 'failed').length,
    pendingCount: items.filter((item) => item.status === 'pending' || item.status === 'copied').length,
    failedItems: items
      .filter((item) => item.status === 'failed')
      .map((item) => ({ id: item.id, kind: item.kind, label: item.label, error: item.error || '' })),
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      status: item.status,
      error: item.error || '',
    })),
  };
}

function createMigrationItem(id, kind, label) {
  return { id, kind, label, source: '', target: '', status: 'pending', error: '', verifiedAt: '' };
}

function buildMigrationPlanItems(legacyDeviceId) {
  const items = [];

  const preferenceFamilies = [
    { id: 'terminal', label: '终端偏好', keys: [legacyTerminalPreferencesKey, legacyTerminalFallbackPreferencesKey] },
    {
      id: 'externalApplications',
      label: '外部应用配置',
      keys: [legacyExternalApplicationPreferencesKey, legacyEditorPreferencesKey, legacyEditorFallbackPreferencesKey],
    },
    { id: 'environment', label: '环境工具配置', keys: [legacyEnvironmentPreferencesKey] },
    { id: 'ai', label: 'AI 配置', keys: [legacyAiPreferencesKey] },
    { id: 'ui', label: '界面偏好', keys: [legacyUiPreferencesKey, legacyProjectDetailsTabOrderKey] },
    { id: 'projectLaunchService', label: '项目启动服务开关', keys: [legacyProjectLaunchServicePreferencesKey] },
  ];
  preferenceFamilies.forEach((family) => {
    if (family.keys.some((key) => readLegacyDbStorageValue(key) !== null)) {
      const item = createMigrationItem(`dbstorage:${family.id}`, 'preferences', family.label);
      item.source = family.keys.join(', ');
      item.target = 'local-state.v1.json#/preferences';
      items.push(item);
    }
  });

  const documentProjectIds = new Set(
    readProjectDocs()
      .map((document) => document?.project?.id)
      .filter((projectId) => typeof projectId === 'string' && projectId),
  );

  readProjectDocs().forEach((document) => {
    const project = document?.project;
    if (!project || typeof project.id !== 'string' || !project.id) return;
    if (project.visibility !== 'private') {
      return; // Public projects stay in the sync database; nothing to move.
    }
    const item = createMigrationItem(`project-doc:${document._id}`, 'private-project', project.name || project.id);
    item.source = document._id;
    item.target = `projects/${project.id}.json`;
    item.owningDeviceId =
      typeof project[legacyOwnerDeviceIdField] === 'string' ? project[legacyOwnerDeviceIdField] : '';
    items.push(item);
  });

  readLegacyStoredProjects().forEach((project) => {
    if (!project || typeof project.id !== 'string' || !project.id || documentProjectIds.has(project.id)) {
      return;
    }
    if (project.visibility === 'private') {
      const item = createMigrationItem(`legacy-aggregate:${project.id}`, 'private-project', project.name || project.id);
      item.source = `${storageKey}#${project.id}`;
      item.target = `projects/${project.id}.json`;
      item.owningDeviceId =
        typeof project[legacyOwnerDeviceIdField] === 'string' ? project[legacyOwnerDeviceIdField] : '';
      items.push(item);
      return;
    }
    const item = createMigrationItem(
      `legacy-aggregate:${project.id}`,
      'public-project-document',
      project.name || project.id,
    );
    item.source = `${storageKey}#${project.id}`;
    item.target = `${projectDocPrefix}${project.id}`;
    items.push(item);
  });

  const legacyServiceDirectory = path.join(legacyPluginDataDirectory(), 'service');
  if (legacyDirectoryHasEntry(legacyServiceDirectory)) {
    const item = createMigrationItem('service-directory', 'service-directory', '项目启动服务数据');
    item.source = legacyServiceDirectory;
    item.target = path.join(pluginLocalDataDirectory(), 'service');
    items.push(item);
  }
  const legacyIconPackDirectory = path.join(legacyPluginDataDirectory(), 'icon-packs');
  if (legacyDirectoryHasEntry(legacyIconPackDirectory)) {
    const item = createMigrationItem('icon-pack-directory', 'icon-pack-directory', '外部图标包');
    item.source = legacyIconPackDirectory;
    item.target = path.join(pluginLocalDataDirectory(), 'icon-packs');
    items.push(item);
  }

  return items;
}

function legacyDirectoryHasEntry(directoryPath) {
  try {
    return fs.existsSync(directoryPath) && fs.readdirSync(directoryPath).length > 0;
  } catch (error) {
    return false;
  }
}

function migrationItemProjectId(item) {
  if (item.projectId) return item.projectId;
  if (item.id.startsWith(`project-doc:${projectDocPrefix}`)) {
    return item.id.slice(`project-doc:${projectDocPrefix}`.length);
  }
  if (item.id.startsWith('legacy-aggregate:')) {
    return item.id.slice('legacy-aggregate:'.length);
  }
  return '';
}

function pendingMigrationPlanItems(ledger, legacyDeviceId) {
  const plan = buildMigrationPlanItems(legacyDeviceId);
  const items = ledger?.items || [];
  const knownIds = new Set(items.map((item) => item.id));
  const knownProjectIds = new Set(items.map(migrationItemProjectId).filter(Boolean));
  const localState = readLocalState();
  return plan.filter((item) => {
    if (knownIds.has(item.id)) return false;
    const projectId = migrationItemProjectId(item);
    if (projectId) {
      if (knownProjectIds.has(projectId) || readPersistedProject(projectId)) return false;
      return !ledger || item.kind !== 'private-project' || Boolean(legacyDeviceId && item.owningDeviceId === legacyDeviceId);
    }
    if (item.kind === 'preferences') {
      return !Object.prototype.hasOwnProperty.call(localState.preferences, item.id.slice('dbstorage:'.length));
    }
    return !ledger || !legacyDirectoryHasEntry(item.target);
  });
}

function ensureLedgerItems(ledger, planItems) {
  const knownItemIds = new Set(ledger.items.map((item) => item.id));
  planItems.forEach((planItem) => {
    if (!knownItemIds.has(planItem.id)) {
      ledger.items.push(planItem);
    }
  });
  if (!ledger.startedAt) {
    ledger.startedAt = new Date().toISOString();
  }
  return ledger;
}

// ---------------------------------------------------------------------------
// Migration execution
// ---------------------------------------------------------------------------

async function guardProjectLaunchServiceForMigration(stopActiveRuns = false, onProgress = null) {
  const directoryPath = path.join(legacyPluginDataDirectory(), 'service');
  const reportProgress = (stage, activeRunCount = 0) => onProgress?.({ stage, activeRunCount });
  try {
    reportProgress('checking-service');
    let discovery;
    try {
      discovery = readProjectLaunchServiceDiscovery(directoryPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        reportProgress('stopped');
        return { ok: true };
      }
      throw error;
    }
    const matches = await projectLaunchServiceProcessMatchesAsync(discovery);
    if (matches === false) {
      reportProgress('stopped');
      return { ok: true };
    }
    if (matches !== true) throw new Error('无法确认旧项目启动服务的进程身份。请停止旧服务后重试迁移。');
    const connection = { discovery, token: readProjectLaunchServiceToken(directoryPath) };
    await requestProjectLaunchServiceHealth(connection);
    const stateResponse = await requestProjectLaunchService(discovery, connection.token, 'GET', '/v1/state');
    if (stateResponse.statusCode !== 200)
      throw projectLaunchServiceResponseError(stateResponse, '旧项目启动服务状态读取失败。');
    let state = stateResponse.payload;
    if (!Array.isArray(state?.runs)) throw new Error('旧项目启动服务返回了无效的任务状态。');
    if (serviceRunCount(state.runs) > 0 && !stopActiveRuns) {
      return {
        ok: false,
        blocked: 'active-runs',
        message: '项目启动服务仍有运行中的任务，请先结束任务，再执行数据迁移。',
      };
    }
    if (stopActiveRuns) {
      const stopDeadline = Date.now() + projectLaunchServiceStartupTimeoutMs;
      const requestedRunIds = new Set();
      while (serviceRunCount(state.runs) > 0) {
        reportProgress('stopping-scripts', serviceRunCount(state.runs));
        for (const run of state.runs) {
          if (serviceRunCount([run]) === 0 || requestedRunIds.has(run.id)) continue;
          if (typeof run.id !== 'string' || !/^[a-f0-9]{32}$/.test(run.id)) {
            throw new Error('旧项目启动服务返回了无效的脚本运行 ID。');
          }
          const stopped = await requestProjectLaunchService(
            discovery, connection.token, 'POST', `/v1/runs/${run.id}/stop`, {},
          );
          if (stopped.statusCode !== 200 && stopped.statusCode !== 202) {
            throw projectLaunchServiceResponseError(stopped, '旧项目启动服务停止脚本失败。');
          }
          requestedRunIds.add(run.id);
        }
        if (Date.now() >= stopDeadline) {
          throw new Error('停止脚本超时，服务尚未停止，请重试。');
        }
        reportProgress('waiting-scripts', serviceRunCount(state.runs));
        await new Promise((resolve) => setTimeout(resolve, 100));
        const updated = await requestProjectLaunchService(discovery, connection.token, 'GET', '/v1/state');
        if (updated.statusCode !== 200) {
          throw projectLaunchServiceResponseError(updated, '旧项目启动服务状态读取失败。');
        }
        state = updated.payload;
        if (!Array.isArray(state?.runs)) throw new Error('旧项目启动服务返回了无效的任务状态。');
      }
    }
    reportProgress('stopping-service');
    const response = await requestProjectLaunchService(discovery, connection.token, 'POST', '/v1/shutdown', {});
    if (response.statusCode !== 200 && response.statusCode !== 202) {
      throw projectLaunchServiceResponseError(response, '旧项目启动服务停止失败。');
    }
    reportProgress('waiting-service');
    const deadline = Date.now() + projectLaunchServiceStartupTimeoutMs;
    while (Date.now() < deadline) {
      const remaining = await projectLaunchServiceProcessMatchesAsync(discovery);
      if (remaining === false) {
        reportProgress('stopped');
        return { ok: true };
      }
      if (remaining !== true) throw new Error('无法确认旧项目启动服务已停止，请停止旧服务后重试迁移。');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('旧项目启动服务停止超时，请停止旧服务后重试迁移。');
  } catch (error) {
    return {
      ok: false,
      blocked: 'service-unavailable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function stopMigrationService(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const result = await guardProjectLaunchServiceForMigration(true, onProgress);
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}

function migratePreferenceFamilyItem(item) {
  const family = item.id.startsWith('dbstorage:') ? item.id.slice('dbstorage:'.length) : item.id;
  let normalizedValue = null;
  const targetSection = family;
  if (family === 'terminal') {
    const stored =
      readLegacyDbStorageValue(legacyTerminalPreferencesKey) ??
      readLegacyDbStorageValue(legacyTerminalFallbackPreferencesKey);
    normalizedValue = normalizeTerminalPreferences(stored);
  } else if (family === 'externalApplications') {
    const stored = readLegacyDbStorageValue(legacyExternalApplicationPreferencesKey);
    normalizedValue =
      stored !== null && stored !== undefined
        ? normalizeExternalApplicationPreferences(stored)
        : migrateEditorPreferences(
            readLegacyDbStorageValue(legacyEditorPreferencesKey) ??
              readLegacyDbStorageValue(legacyEditorFallbackPreferencesKey),
          );
  } else if (family === 'environment') {
    normalizedValue = normalizeEnvironmentPreferences(readLegacyDbStorageValue(legacyEnvironmentPreferencesKey));
  } else if (family === 'ai') {
    normalizedValue = normalizeAiPreferences(readLegacyDbStorageValue(legacyAiPreferencesKey));
  } else if (family === 'ui') {
    const stored = readLegacyDbStorageValue(legacyUiPreferencesKey);
    if (stored !== null && stored !== undefined) {
      normalizedValue = normalizeUiPreferences(stored);
    } else {
      // Reproduce the legacy tab-order fallback used by the previous reader.
      const legacyTabOrder = readLegacyDbStorageValue(legacyProjectDetailsTabOrderKey);
      const tabOrder = normalizeProjectDetailsTabOrder(legacyTabOrder);
      normalizedValue = normalizeUiPreferences({
        schemaVersion: 1,
        projectDetails: { tabOrder },
        coachMarks: {
          projectDetailsTabReorder:
            Array.isArray(legacyTabOrder) && tabOrder.some((id, index) => id !== projectDetailsTabIds[index]) ? 1 : 0,
        },
      });
    }
  } else if (family === 'projectLaunchService') {
    normalizedValue = normalizeProjectLaunchServicePreferences(
      readLegacyDbStorageValue(legacyProjectLaunchServicePreferencesKey),
    );
  } else {
    throw new Error(`未知的偏好迁移分组：${item.id}`);
  }

  const writeResult = saveLocalStatePreference(targetSection, normalizedValue, (value) => value);
  if (!writeResult.ok) {
    throw new Error(writeResult.error || '写入本地状态文件失败。');
  }
  const verified = readLocalStatePreference(
    targetSection,
    (value) => value,
    () => null,
  );
  if (!storedValueEquals(verified, normalizedValue)) {
    throw new Error('本地状态写入后回读校验失败。');
  }
}

function migratePrivateProjectItem(item, ledger) {
  const sourceProject = readMigrationSourceProject(item);
  const projectId = migrationItemProjectId(item);
  const project = sourceProject || readLocalPrivateProject(projectId);
  if (!project) {
    throw new Error(`无法读取私有项目 ${item.id}。`);
  }
  const storedProject = toStoredProject(project);
  const projectHash = crypto.createHash('sha256').update(JSON.stringify(storedProject)).digest('hex');
  if (
    !sourceProject &&
    (storedProject.visibility !== 'private' ||
      !storedValueEquals(toPlainJson(storedProject), project) ||
      (item.projectHash && item.projectHash !== projectHash))
  ) {
    throw new Error(`私有项目 ${storedProject.id} 的本地迁移副本校验失败。`);
  }
  if (sourceProject) {
    const writeResult = writeLocalPrivateProject(storedProject);
    if (!writeResult.ok) {
      throw new Error(writeResult.error || '私有项目写入本地数据目录失败。');
    }
  }
  item.projectId = storedProject.id;
  item.projectHash = projectHash;
  item.status = 'copied';
  item.error = '';
  writeMigrationLedger(ledger);
  if (item.kind === 'private-project' && readCurrentProjectDocument(storedProject.id)) {
    removeStoredProjectDocument(storedProject.id);
  }
  if (readCurrentProjectDocument(storedProject.id)) {
    throw new Error(`私有项目 ${storedProject.id} 的同步文档删除失败。`);
  }
}

function readMigrationSourceProject(item) {
  if (item.id.startsWith('project-doc:')) {
    const documentId = item.id.slice('project-doc:'.length);
    const document = readProjectDocs().find((candidate) => candidate?._id === documentId);
    return document?.project || null;
  }
  if (item.id.startsWith('legacy-aggregate:')) {
    const projectId = item.id.slice('legacy-aggregate:'.length);
    return readLegacyStoredProjects().find((project) => project?.id === projectId) || null;
  }
  return null;
}

function migratePublicProjectDocumentItem(item) {
  const project = readMigrationSourceProject(item);
  if (!project) {
    throw new Error(`无法读取旧项目 ${item.id}。`);
  }
  const storedProject = toStoredProject(project);
  if (readCurrentProjectDocument(storedProject.id)) {
    return; // Already materialized by an earlier attempt.
  }
  const document = createStoredProjectDocument(storedProject);
  putProjectDocument(document, storedProject.id);
  const verified = readCanonicalStoredProject(storedProject.id);
  if (!verified || !storedValueEquals(verified, storedProject)) {
    throw new Error(`公共项目 ${storedProject.id} 迁移后回读校验失败。`);
  }
}

const migrationServiceCopyFileNames = ['token', 'state.json', 'install.json', 'service.log'];

function migrationServiceExecutableFileName() {
  return `project-launch-service${process.platform === 'win32' ? '.exe' : ''}`;
}

function copyMigrationFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function migrateServiceDirectoryItem(item) {
  const sourceDirectory = item.source;
  const targetDirectory = item.target;
  const entries = [
    ...migrationServiceCopyFileNames,
    migrationServiceExecutableFileName(),
    projectLaunchServiceTarget().assetName,
    'logs',
  ].filter((entryName) => entryName && fs.existsSync(path.join(sourceDirectory, entryName)));

  if (entries.includes('state.json') && !entries.includes('token')) {
    throw new Error('旧服务状态缺少 token，无法安全迁移。');
  }

  fs.mkdirSync(targetDirectory, { recursive: true });
  entries.forEach((entryName) => {
    const sourcePath = path.join(sourceDirectory, entryName);
    const targetPath = path.join(targetDirectory, entryName);
    if (fs.statSync(sourcePath).isDirectory()) {
      fs.cpSync(sourcePath, targetPath, { recursive: true });
    } else {
      copyMigrationFile(sourcePath, targetPath);
    }
  });

  // discovery.json, service.lock, downloads and partial/backup files are
  // intentionally not copied; the service regenerates runtime discovery.
  entries.forEach((entryName) => {
    const sourcePath = path.join(sourceDirectory, entryName);
    const targetPath = path.join(targetDirectory, entryName);
    if (fs.statSync(sourcePath).isDirectory()) {
      if (!fs.existsSync(targetPath)) {
        throw new Error(`服务目录 ${entryName} 复制校验失败。`);
      }
      return;
    }
    if (!fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath))) {
      throw new Error(`服务文件 ${entryName} 复制校验失败。`);
    }
  });
}

function migrateIconPackDirectoryItem(item) {
  fs.cpSync(item.source, item.target, { recursive: true });
  const packagePath = path.join(item.target, 'vscode-icons-derived', 'pack.json.gz');
  const metadataPath = path.join(item.target, 'vscode-icons-derived', 'install.json');
  if (!fs.existsSync(packagePath) || !fs.existsSync(metadataPath)) {
    throw new Error('图标包复制后校验失败。');
  }
}

async function migrateLedgerItem(item, legacyDeviceId, ledger) {
  if (item.kind === 'private-project') {
    if (item.owningDeviceId && item.owningDeviceId !== legacyDeviceId) {
      item.status = 'skipped';
      item.error = '该项目属于其他设备，保留在同步数据库中。';
      return;
    }
    if (!item.owningDeviceId) {
      item.status = 'skipped';
      item.error = '无法确认该项目属于当前设备，保留在同步数据库中。';
      return;
    }
    migratePrivateProjectItem(item, ledger);
    item.status = 'verified';
    return;
  }
  if (item.kind === 'public-project-document') {
    migratePublicProjectDocumentItem(item);
    item.status = 'verified';
    return;
  }
  if (item.kind === 'preferences') {
    migratePreferenceFamilyItem(item);
    item.status = 'verified';
    return;
  }
  if (item.kind === 'service-directory') {
    migrateServiceDirectoryItem(item);
    item.status = 'verified';
    return;
  }
  if (item.kind === 'icon-pack-directory') {
    migrateIconPackDirectoryItem(item);
    item.status = 'verified';
    return;
  }
  throw new Error(`未知的迁移项类型：${item.kind}`);
}

async function runMigration(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const capabilities = pluginV8Capabilities();
  // An explicit local data directory override (tests, dev previews) also
  // provides a viable migration target.
  const hasLocalDataTarget =
    capabilities.getPluginLocalDataPath ||
    Boolean(normalizeConfiguredDirectory(process.env?.[localDataDirectoryEnvOverride]));
  if (!hasLocalDataTarget) {
    return {
      ok: false,
      blocked: 'unsupported-host',
      message: '当前 uTools 缺少 v8 本地数据目录能力，无法执行迁移。',
      ledger: null,
    };
  }

  const legacyDeviceId = collectLegacyDeviceId();
  const existingLedger = readMigrationLedger();
  let ledger = existingLedger || {
    schemaVersion: migrationLedgerSchemaVersion,
    status: 'in-progress',
    startedAt: new Date().toISOString(),
    completedAt: '',
    items: [],
  };
  ledger = ensureLedgerItems(ledger, pendingMigrationPlanItems(existingLedger, legacyDeviceId));
  ledger.status = 'in-progress';
  ledger.completedAt = '';
  writeMigrationLedger(ledger);
  onProgress?.(migrationProgressSnapshot(ledger));

  const serviceGuard = await guardProjectLaunchServiceForMigration();
  if (!serviceGuard.ok) {
    writeMigrationLedger(ledger);
    return {
      ok: false,
      blocked: serviceGuard.blocked,
      message: serviceGuard.message,
      ledger: migrationProgressSnapshot(ledger),
    };
  }

  for (const item of ledger.items) {
    if (item.status === 'verified' || item.status === 'skipped') {
      continue;
    }
    try {
      await migrateLedgerItem(item, legacyDeviceId, ledger);
      if (item.status === 'verified') {
        item.error = '';
        item.verifiedAt = new Date().toISOString();
      }
    } catch (error) {
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : String(error);
    }
    writeMigrationLedger(ledger);
    onProgress?.(migrationProgressSnapshot(ledger));
    // Yield so the blocking UI can paint progress between synchronous fs steps.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const failedItems = ledger.items.filter((item) => item.status === 'failed');
  if (failedItems.length === 0) {
    ledger.status = 'completed';
    ledger.completedAt = new Date().toISOString();
    writeMigrationLedger(ledger);
    onProgress?.(migrationProgressSnapshot(ledger));
    return { ok: true, ledger: migrationProgressSnapshot(ledger) };
  }

  ledger.status = 'failed';
  writeMigrationLedger(ledger);
  onProgress?.(migrationProgressSnapshot(ledger));
  return {
    ok: false,
    blocked: 'items-failed',
    message: `${failedItems.length} 项迁移失败，旧数据保持完整，可重试迁移。`,
    ledger: migrationProgressSnapshot(ledger),
  };
}

function readMigrationSummary() {
  const ledger = readMigrationLedger();
  return ledger ? migrationProgressSnapshot(ledger) : null;
}
