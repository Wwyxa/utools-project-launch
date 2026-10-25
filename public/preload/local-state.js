// local-state.v1.json adapter.
//
// Everything that must stay on the current device (device configuration,
// workspace state, per-project environment overrides and private project
// documents) lives in the uTools v8 plugin local data directory and never
// enters the syncing utools database. All writes are atomic replacements of
// the whole file; readers normalize through the shared preload normalizers.

const localStateFileName = "local-state.v1.json";
const localStateSchemaVersion = 1;
const privateProjectsDirectoryName = "projects";
const localStatePreferenceSections = new Set([
  "terminal",
  "externalApplications",
  "environment",
  "ai",
  "ui",
  "projectLaunchService",
  "githubAuth",
]);

function localStateFilePath() {
  return path.join(pluginLocalDataDirectory(), localStateFileName);
}

// Without a configured local data directory (non-v8 host, unconfigured test)
// reads return defaults and writes fail instead of touching the process cwd.
function hasLocalDataDirectory() {
  return Boolean(pluginLocalDataDirectory());
}

function localDataDirectoryUnavailableError() {
  return localStateWriteError(new Error("插件本地数据目录不可用，无法写入本地状态。"));
}

function defaultLocalState() {
  return {
    schemaVersion: localStateSchemaVersion,
    preferences: {},
    workspace: {
      dashboardProjectGroup: "all",
      hiddenProjectIds: [],
      workActivity: {
        selectionInitialized: false,
        preferences: null,
        selectedProjectIds: [],
      },
    },
    publicProjectOverrides: {},
  };
}

function normalizeLocalState(value) {
  const state = value && typeof value === "object" ? value : {};
  const preferences = {};
  Object.keys(state.preferences || {}).forEach((key) => {
    if (localStatePreferenceSections.has(key)) {
      preferences[key] = state.preferences[key];
    }
  });
  const workspace = state.workspace && typeof state.workspace === "object" ? state.workspace : {};
  const workActivity =
    workspace.workActivity && typeof workspace.workActivity === "object" ? workspace.workActivity : {};
  const publicProjectOverrides = {};
  Object.entries(state.publicProjectOverrides || {}).forEach(([projectId, override]) => {
    if (typeof projectId !== "string" || !projectId || !override || typeof override !== "object") return;
    const env = override.env && typeof override.env === "object" ? override.env : {};
    const localOnlyEnvKeys = Array.isArray(override.localOnlyEnvKeys)
      ? override.localOnlyEnvKeys.filter((key) => typeof key === "string" && key)
      : [];
    publicProjectOverrides[projectId] = { env, localOnlyEnvKeys };
  });
  return {
    schemaVersion: localStateSchemaVersion,
    preferences,
    workspace: {
      dashboardProjectGroup:
        typeof workspace.dashboardProjectGroup === "string" && workspace.dashboardProjectGroup
          ? workspace.dashboardProjectGroup
          : "all",
      hiddenProjectIds: Array.isArray(workspace.hiddenProjectIds)
        ? [...new Set(workspace.hiddenProjectIds.filter((projectId) => typeof projectId === "string" && projectId))]
        : [],
      workActivity: {
        selectionInitialized: workActivity.selectionInitialized === true,
        preferences: workActivity.preferences && typeof workActivity.preferences === "object" ? workActivity.preferences : null,
        selectedProjectIds: Array.isArray(workActivity.selectedProjectIds)
          ? workActivity.selectedProjectIds.filter((projectId) => typeof projectId === "string" && projectId)
          : [],
      },
    },
    publicProjectOverrides,
  };
}

function readLocalState() {
  const stored = readJsonFile(localStateFilePath());
  if (!stored || typeof stored !== "object") {
    return defaultLocalState();
  }
  return normalizeLocalState(stored);
}

function localStateWriteError(error) {
  return {
    ok: false,
    error: error instanceof Error && error.message ? error.message : String(error),
  };
}

function writeLocalState(state) {
  if (!hasLocalDataDirectory()) {
    return localDataDirectoryUnavailableError();
  }
  try {
    writeJsonFileAtomic(localStateFilePath(), normalizeLocalState(state));
    return { ok: true };
  } catch (error) {
    return localStateWriteError(error);
  }
}

// Read-modify-write of the whole local state file. `mutate` receives a plain
// JSON copy and returns the next state; failures leave the file untouched.
function updateLocalState(mutate) {
  try {
    const nextState = mutate(toPlainJson(readLocalState()));
    if (!nextState || typeof nextState !== "object") {
      return { ok: false, error: "本地状态更新函数无效。" };
    }
    return writeLocalState(nextState);
  } catch (error) {
    return localStateWriteError(error);
  }
}

function readLocalStatePreference(section, normalize, getDefault) {
  const state = readLocalState();
  const stored = state.preferences[section];
  if (stored === null || stored === undefined) {
    return getDefault();
  }
  try {
    return normalize(stored);
  } catch (error) {
    return getDefault();
  }
}

function saveLocalStatePreference(section, value, normalize) {
  if (!localStatePreferenceSections.has(section)) {
    return { ok: false, error: `未知的本地偏好分区：${section}` };
  }
  return updateLocalState((state) => {
    state.preferences[section] = normalize(value);
    return state;
  });
}

function readLocalWorkspaceState() {
  return readLocalState().workspace;
}

function saveLocalWorkspaceState(patch) {
  const normalizedPatch = patch && typeof patch === "object" ? patch : {};
  return updateLocalState((state) => {
    if ("dashboardProjectGroup" in normalizedPatch) {
      state.workspace.dashboardProjectGroup =
        typeof normalizedPatch.dashboardProjectGroup === "string" && normalizedPatch.dashboardProjectGroup
          ? normalizedPatch.dashboardProjectGroup
          : "all";
    }
    if ("hiddenProjectIds" in normalizedPatch) {
      state.workspace.hiddenProjectIds = Array.isArray(normalizedPatch.hiddenProjectIds)
        ? normalizedPatch.hiddenProjectIds
        : [];
    }
    if (normalizedPatch.workActivity && typeof normalizedPatch.workActivity === "object") {
      const workActivity = normalizedPatch.workActivity;
      if ("selectionInitialized" in workActivity) {
        state.workspace.workActivity.selectionInitialized = workActivity.selectionInitialized === true;
      }
      if ("preferences" in workActivity) {
        state.workspace.workActivity.preferences =
          workActivity.preferences && typeof workActivity.preferences === "object" ? workActivity.preferences : null;
      }
      if ("selectedProjectIds" in workActivity) {
        state.workspace.workActivity.selectedProjectIds = Array.isArray(workActivity.selectedProjectIds)
          ? workActivity.selectedProjectIds.filter((projectId) => typeof projectId === "string" && projectId)
          : [];
      }
    }
    return state;
  });
}

function normalizeProjectEnvironmentOverride(value) {
  const override = value && typeof value === "object" ? value : {};
  const env = {};
  if (override.env && typeof override.env === "object") {
    Object.entries(override.env).forEach(([key, entryValue]) => {
      if (typeof key === "string" && key && typeof entryValue === "string") {
        env[key] = entryValue;
      }
    });
  }
  const localOnlyEnvKeys = Array.isArray(override.localOnlyEnvKeys)
    ? Array.from(new Set(override.localOnlyEnvKeys.filter((key) => typeof key === "string" && key)))
    : Object.keys(env);
  return { env, localOnlyEnvKeys };
}

function readProjectEnvironmentOverride(projectId) {
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (!normalizedProjectId) {
    return { env: {}, localOnlyEnvKeys: [] };
  }
  const stored = readLocalState().publicProjectOverrides[normalizedProjectId];
  return normalizeProjectEnvironmentOverride(stored);
}

function saveProjectEnvironmentOverride(projectId, override) {
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (!normalizedProjectId) {
    return { ok: false, error: "项目 ID 不能为空。" };
  }
  const normalizedOverride = normalizeProjectEnvironmentOverride(override);
  return updateLocalState((state) => {
    const hasLocalValues =
      Object.keys(normalizedOverride.env).length > 0 || normalizedOverride.localOnlyEnvKeys.length > 0;
    if (hasLocalValues) {
      state.publicProjectOverrides[normalizedProjectId] = normalizedOverride;
    } else {
      delete state.publicProjectOverrides[normalizedProjectId];
    }
    return state;
  });
}

// ---------------------------------------------------------------------------
// Private project files: one JSON document per private project under
// <plugin-local-data>/projects/<safe-name>.json. The real project id is stored
// inside the file; the file name is only a deterministic container name.
// ---------------------------------------------------------------------------

function privateProjectsDirectory() {
  return path.join(pluginLocalDataDirectory(), privateProjectsDirectoryName);
}

function privateProjectFileName(projectId) {
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  const safeName = normalizedProjectId.replace(/[^A-Za-z0-9._-]/g, "_");
  if (safeName === normalizedProjectId && safeName) {
    return `${safeName}.json`;
  }
  const digest = crypto
    .createHash("sha256")
    .update(normalizedProjectId)
    .digest("hex")
    .slice(0, 12);
  return `${safeName || "project"}-${digest}.json`;
}

function privateProjectFilePath(projectId) {
  return path.join(privateProjectsDirectory(), privateProjectFileName(projectId));
}

function privateProjectFileEnvelope(project) {
  return {
    schemaVersion: localStateSchemaVersion,
    updatedAt: new Date().toISOString(),
    project,
  };
}

function readLocalPrivateProjects() {
  const directory = privateProjectsDirectory();
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    return [];
  }
  const projects = [];
  entries.forEach((entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json")) return;
    const envelope = readJsonFile(path.join(directory, entry.name));
    const project = envelope?.project;
    if (project && typeof project === "object" && typeof project.id === "string" && project.id) {
      projects.push(project);
    }
  });
  return projects;
}

function readLocalPrivateProject(projectId) {
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (!normalizedProjectId) {
    return null;
  }
  const envelope = readJsonFile(privateProjectFilePath(normalizedProjectId));
  const project = envelope?.project;
  return project && typeof project === "object" && project.id === normalizedProjectId ? project : null;
}

function writeLocalPrivateProject(project) {
  if (!hasLocalDataDirectory()) {
    return localDataDirectoryUnavailableError();
  }
  const filePath = privateProjectFilePath(project?.id);
  if (!project || !project.id || !path.basename(filePath).endsWith(".json")) {
    return { ok: false, error: "私有项目数据无效，无法写入本地项目文件。" };
  }
  try {
    writeJsonFileAtomic(filePath, privateProjectFileEnvelope(toPlainJson(project)));
  } catch (error) {
    return localStateWriteError(error);
  }
  const verified = readLocalPrivateProject(project.id);
  if (!verified || !storedValueEquals(verified, toPlainJson(project))) {
    return { ok: false, error: `私有项目 ${project.id} 写入后校验失败。` };
  }
  return { ok: true, path: filePath };
}

function removeLocalPrivateProject(projectId) {
  if (!hasLocalDataDirectory()) {
    return { ok: true };
  }
  const filePath = privateProjectFilePath(projectId);
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
    return { ok: true };
  } catch (error) {
    return localStateWriteError(error);
  }
}
