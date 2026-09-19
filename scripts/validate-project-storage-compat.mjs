import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preloadSource = fs.readFileSync(path.join(repoRoot, "public", "preload.js"), "utf8");
const pluginConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "public", "plugin.json"), "utf8"));
const storageKey = "utools-project-launch.projects.v1";
const projectDocPrefix = "utools-project-launch/project/";
const legacyUiPreferencesKey = "utools-project-launch.ui-preferences.v1";
const legacyTerminalPreferencesKey = "utools-project-launch.local-settings.v1";
const legacyProjectLaunchServiceKey = "utools-project-launch.project-launch-service.v1";
const legacyEnvironmentPreferencesKey = "utools-project-launch.environment-settings.v1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function schemaContainsKeyword(value, keywords) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(([key, nested]) => keywords.has(key) || schemaContainsKeyword(nested, keywords));
}

function objectSchemaPathsWithoutProperties(value, currentPath) {
  if (!value || typeof value !== "object") {
    return [];
  }

  const paths =
    value.type === "object" && !Object.prototype.hasOwnProperty.call(value, "properties") ? [currentPath] : [];
  return Object.entries(value).reduce(
    (result, [key, nested]) => [...result, ...objectSchemaPathsWithoutProperties(nested, `${currentPath}.${key}`)],
    paths,
  );
}

function createTempDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Harness: runs the real preload against a fake uTools host. The plugin local
// data directory and the legacy data directory are real temp directories, so
// local state files, private project files and migration copies land on disk.
// ---------------------------------------------------------------------------
function createBridge({
  docs = [],
  legacyProjects = [],
  legacyDbStorage = {},
  localDeviceId = "device-current",
  hostMode = "v8", // "v8" | "legacy" | "none"
  localDataDir,
  legacyDataDir,
  tempDataDir,
  rejectDbWrites = false,
  requireCurrentDbRevision = false,
  allDocsRevisionOverride = "",
  afterDbGet,
  afterDbPut,
  dbWriteResult,
  allDocsError = "",
  replicateState = null,
} = {}) {
  const docsById = new Map(docs.map((doc) => [doc._id, clone(doc)]));
  const localStorageValues = new Map();
  const dbStorageValues = new Map(Object.entries(clone(legacyDbStorage)));
  if (legacyProjects.length > 0) {
    dbStorageValues.set(storageKey, { projects: clone(legacyProjects) });
  }
  const registeredTools = new Map();
  const bridgeEvents = [];
  const dbCalls = { allDocs: 0, get: 0, put: 0 };
  const legacyStorageCalls = { getItem: 0, setItem: 0, removeItem: 0 };
  const resolvedLocalDataDir = localDataDir || createTempDirectory("utools-project-launch-local-");
  const resolvedLegacyDataDir = legacyDataDir || createTempDirectory("utools-project-launch-legacy-");
  const resolvedTempDataDir = tempDataDir || createTempDirectory("utools-project-launch-temp-");
  const trackedTempDirectories = [resolvedLocalDataDir, resolvedLegacyDataDir, resolvedTempDataDir];
  if (localDeviceId) {
    // The legacy device-id file is how the migration decides which private
    // documents belong to this device; the new model has no device identity.
    fs.writeFileSync(path.join(resolvedLegacyDataDir, "device-id.v1"), `${localDeviceId}\n`, "utf8");
  }

  class CustomEventStub {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const utoolsHost =
    hostMode === "none"
      ? undefined
      : {
          ...(hostMode === "v8"
            ? {
                getAppVersion: () => "8.0.0",
                getPluginLocalDataPath: () => resolvedLocalDataDir,
                getPluginTempPath: () => resolvedTempDataDir,
              }
            : {}),
          db: {
            allDocs(prefix) {
              dbCalls.allDocs += 1;
              if (allDocsError) {
                return { error: true, message: allDocsError };
              }
              return Array.from(docsById.values())
                .filter((doc) => doc._id.startsWith(prefix))
                .map((doc) => {
                  const storedDoc = clone(doc);
                  if (allDocsRevisionOverride && storedDoc._rev) {
                    storedDoc._rev = allDocsRevisionOverride;
                  }
                  return storedDoc;
                });
            },
            get(id) {
              dbCalls.get += 1;
              const result = docsById.has(id) ? clone(docsById.get(id)) : { error: true, message: "not found" };
              afterDbGet?.({ id, docsById, dbCalls });
              return result;
            },
            put(doc) {
              dbCalls.put += 1;
              const configuredResult = dbWriteResult?.({ doc: clone(doc), docsById, dbCalls });
              if (configuredResult) {
                return clone(configuredResult);
              }
              if (rejectDbWrites) {
                return { ok: false, error: true, message: "conflict" };
              }
              const existing = docsById.get(doc._id);
              if (requireCurrentDbRevision && existing && doc._rev !== existing._rev) {
                return { ok: false, error: true, message: "conflict" };
              }
              const nextDoc = clone(doc);
              nextDoc._rev = `rev-${docsById.size + 1}`;
              docsById.set(nextDoc._id, nextDoc);
              afterDbPut?.({ id: nextDoc._id, doc: clone(nextDoc), docsById, dbCalls });
              return { ok: true, rev: nextDoc._rev };
            },
            remove(doc) {
              docsById.delete(doc._id);
              return { ok: true };
            },
            ...(replicateState === null ? {} : { replicateStateFromCloud: () => replicateState }),
          },
          dbStorage: {
            getItem(key) {
              legacyStorageCalls.getItem += 1;
              return dbStorageValues.has(key) ? dbStorageValues.get(key) : undefined;
            },
            setItem(key, value) {
              legacyStorageCalls.setItem += 1;
              dbStorageValues.set(key, value);
            },
            removeItem(key) {
              legacyStorageCalls.removeItem += 1;
              dbStorageValues.delete(key);
            },
          },
          registerTool(name, handler) {
            registeredTools.set(name, handler);
          },
          onPluginOut() {},
        };

  const sandbox = {
    CustomEvent: CustomEventStub,
    TextDecoder,
    clearTimeout,
    console: { warn() {}, error() {}, log() {} },
    crypto: { randomUUID: () => "device-current" },
    process: {
      env: {
        ...process.env,
        UTOOLS_PROJECT_LAUNCH_LOCAL_DATA_DIR: resolvedLocalDataDir,
        UTOOLS_PROJECT_LAUNCH_LEGACY_DATA_DIR: resolvedLegacyDataDir,
      },
      platform: process.platform,
      once() {},
      exit() {},
    },
    require(moduleName) {
      if (moduleName === "electron") {
        return {
          shell: {
            openExternal: () => Promise.resolve(),
            openPath: () => Promise.resolve(),
            showItemInFolder: () => undefined,
          },
        };
      }
      return require(moduleName);
    },
    setTimeout,
    window: {
      dispatchEvent(event) {
        if (event?.type === "project-bridge-event") {
          bridgeEvents.push(clone(event.detail));
        }
      },
      localStorage: {
        getItem(key) {
          return localStorageValues.get(key) || null;
        },
        setItem(key, value) {
          localStorageValues.set(key, String(value));
        },
        removeItem(key) {
          localStorageValues.delete(key);
        },
      },
      utools: utoolsHost,
    },
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(preloadSource, sandbox, { filename: "public/preload.js" });

  return {
    bridge: sandbox.window.projectBridge,
    docsById,
    registeredTools,
    bridgeEvents,
    dbCalls,
    legacyStorageCalls,
    dbStorageValues,
    localStorageValues,
    localDataDir: resolvedLocalDataDir,
    legacyDataDir: resolvedLegacyDataDir,
    tempDataDir: resolvedTempDataDir,
    trackedTempDirectories,
  };
}

function cleanupBridge(bridge) {
  for (const directory of bridge.trackedTempDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function readLocalStateFile(localDataDir) {
  return JSON.parse(fs.readFileSync(path.join(localDataDir, "local-state.v1.json"), "utf8"));
}

function privateProjectFileExists(localDataDir, projectId) {
  const projectsDir = path.join(localDataDir, "projects");
  if (!fs.existsSync(projectsDir)) return false;
  return fs
    .readdirSync(projectsDir)
    .some((entry) => {
      if (!entry.endsWith(".json")) return false;
      const envelope = JSON.parse(fs.readFileSync(path.join(projectsDir, entry), "utf8"));
      return envelope?.project?.id === projectId;
    });
}

function listLocalPrivateProjectIds(localDataDir) {
  const projectsDir = path.join(localDataDir, "projects");
  if (!fs.existsSync(projectsDir)) return [];
  return fs
    .readdirSync(projectsDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => JSON.parse(fs.readFileSync(path.join(projectsDir, entry), "utf8"))?.project?.id)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Storage model: public docs from utools.db plus private projects from local
// files. Legacy aggregate keys and foreign private documents never resurrect.
// ---------------------------------------------------------------------------

const publicDocProject = {
  id: "public-project",
  name: "Public Project",
  path: "C:/work/public-project",
  visibility: "public",
  type: "Node.js",
  kind: "node",
  cardStyle: "tiny",
  tinyCardButtonCount: 0,
  group: "existing-group",
  scripts: [{ id: "public-script", name: "dev", command: "npm run dev", status: "IDLE" }],
  env: { PORT: "3000" },
  relatedProjects: [
    { projectId: "frontend", bidirectional: true },
    { projectId: "frontend", bidirectional: false },
    { projectId: "api", bidirectional: false },
    { projectId: "docs", bidirectional: true },
    { projectId: "overflow", bidirectional: false },
  ],
  automationTasks: [
    {
      id: "automation-1",
      name: "Daily Check",
      enabled: true,
      scriptIds: ["public-script"],
      schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
      missedPolicy: "grace-run",
      missedGraceMinutes: 5,
      notifyEnabled: true,
      maxScriptRuntimeMinutes: 30,
      inputConfigs: [
        {
          scriptId: "public-script",
          steps: [{ id: "step-1", mode: "delay", value: "yes", delayMs: 1000, matchText: "", timeoutMs: 30000 }],
        },
      ],
      exitConfigs: [{ scriptId: "public-script", enabled: true, matchText: "done" }],
      dailyPlans: [
        {
          date: "2026-07-07",
          entries: [{ id: "entry-1", plannedAt: "2026-07-07T09:00:00", status: "pending" }],
        },
      ],
      history: Array.from({ length: 22 }, (_, index) => ({
        id: `history-${index}`,
        taskId: "automation-1",
        taskName: "Daily Check",
        projectId: "public-project",
        projectName: "Public Project",
        plannedAt: "2026-07-07T09:00:00",
        endedAt: "2026-07-07T09:01:00",
        status: "completed",
        scriptResults: [],
      })),
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    },
  ],
};

const foreignPrivateDocProject = {
  id: "foreign-private-project",
  name: "Foreign Private Project",
  path: "C:/work/foreign-private",
  visibility: "private",
  ownerDeviceId: "other-device",
  scripts: [],
  env: {},
};

const aggregateOnlyProject = {
  id: "deleted-aggregate-project",
  name: "Deleted Aggregate Project",
  path: "C:/work/deleted-aggregate",
};

const readBridge = createBridge({
  docs: [
    { _id: `${projectDocPrefix}${publicDocProject.id}`, project: publicDocProject },
    { _id: `${projectDocPrefix}${foreignPrivateDocProject.id}`, project: foreignPrivateDocProject },
  ],
  legacyProjects: [aggregateOnlyProject],
});

const loadedProjects = readBridge.bridge.loadProjects();
const loadedPublicProject = loadedProjects.find((project) => project.id === publicDocProject.id);

assert.deepEqual(
  clone(loadedProjects.map((project) => project.id)),
  [publicDocProject.id],
  "the catalog must contain public documents plus local private projects only",
);
assert.ok(loadedPublicProject, "public documents should load normally");
assert.equal(loadedPublicProject.ownerDeviceId, undefined, "the device identity design must be gone from reads");
assert.equal(loadedPublicProject.tinyCardButtonCount, 0, "zero tiny card buttons should survive storage reads");
assert.deepEqual(
  clone(loadedPublicProject.relatedProjects),
  [
    { projectId: "frontend", bidirectional: true },
    { projectId: "api", bidirectional: false },
    { projectId: "docs", bidirectional: true },
    { projectId: "overflow", bidirectional: false },
  ],
  "related projects should be normalized when reading project documents",
);
assert.equal(loadedPublicProject.automationTasks.length, 1, "automation tasks should survive project doc loading");
assert.equal(
  loadedPublicProject.automationTasks[0].history.length,
  20,
  "automation task history should be capped during storage normalization",
);
assert.equal(
  loadedPublicProject.automationTasks[0].inputConfigs[0].steps[0].value,
  "yes",
  "automation input configs should remain plain text through storage",
);
assert.equal(
  loadedPublicProject.automationTasks[0].missedPolicy,
  "grace-run",
  "automation missed policy should survive project doc loading",
);
assert.equal(
  loadedPublicProject.automationTasks[0].missedGraceMinutes,
  5,
  "automation missed grace should survive project doc loading",
);
assert.equal(
  loadedProjects.some((project) => project.id === foreignPrivateDocProject.id),
  false,
  "private documents still inside the sync database must be ignored on reads",
);
assert.equal(
  loadedProjects.some((project) => project.id === aggregateOnlyProject.id),
  false,
  "the legacy aggregate key must never resurrect deleted projects",
);
cleanupBridge(readBridge);

// ---------------------------------------------------------------------------
// Visibility routing on writes: private → local file, public → sync document.
// ---------------------------------------------------------------------------

const routingBridge = createBridge({
  docs: [{ _id: `${projectDocPrefix}${publicDocProject.id}`, project: publicDocProject }],
});
const routingBaseProjects = routingBridge.bridge.loadProjects();

const newPrivateProject = {
  id: "routing-private",
  name: "Routing Private",
  path: "C:/work/routing-private",
  visibility: "private",
  type: "Custom",
  kind: "custom",
  status: "STOPPED",
  scripts: [],
  env: { API_TOKEN: "local-secret" },
};

routingBridge.bridge.saveProjects([...routingBaseProjects, newPrivateProject], {
  baseProjects: routingBaseProjects,
});
assert.equal(
  privateProjectFileExists(routingBridge.localDataDir, newPrivateProject.id),
  true,
  "a private project must be written to the plugin local data directory",
);
assert.equal(
  routingBridge.docsById.has(`${projectDocPrefix}${newPrivateProject.id}`),
  false,
  "a private project must never enter the syncing database",
);
assert.equal(
  routingBridge.dbStorageValues.has(storageKey),
  false,
  "private project writes must not recreate the legacy aggregate key",
);

// Public → private: local file first, then the syncing document is removed.
routingBridge.bridge.saveProjects(
  [{ ...clone(loadedPublicProject), visibility: "private" }],
  { baseProjects: routingBaseProjects },
);
assert.equal(
  privateProjectFileExists(routingBridge.localDataDir, publicDocProject.id),
  true,
  "privatizing a public project must write the local file",
);
assert.equal(
  routingBridge.docsById.has(`${projectDocPrefix}${publicDocProject.id}`),
  false,
  "privatizing a public project must remove its syncing document",
);

// Private → public: syncing document first, then the local file is removed.
routingBridge.bridge.saveProjects([{ ...clone(loadedPublicProject), visibility: "public" }], {
  baseProjects: [],
});
assert.equal(
  routingBridge.docsById.has(`${projectDocPrefix}${publicDocProject.id}`),
  true,
  "publishing a private project must create its syncing document",
);
assert.equal(
  privateProjectFileExists(routingBridge.localDataDir, publicDocProject.id),
  false,
  "publishing a private project must remove its local-only copy",
);

// Deletion clears both potential locations.
routingBridge.bridge.saveProjects([], { baseProjects: [], removedProjectIds: [publicDocProject.id] });
assert.equal(
  routingBridge.docsById.has(`${projectDocPrefix}${publicDocProject.id}`),
  false,
  "deleting a project must remove its syncing document",
);
assert.equal(
  privateProjectFileExists(routingBridge.localDataDir, publicDocProject.id),
  false,
  "deleting a project must remove its local private file",
);
cleanupBridge(routingBridge);

// ---------------------------------------------------------------------------
// Agent tools: schema surface and private-aware project persistence.
// ---------------------------------------------------------------------------

const expectedAgentTools = [
  "project_manager_list_projects",
  "project_manager_get_project",
  "project_manager_upsert_project",
  "project_manager_upsert_script",
];
assert.deepEqual(
  Object.keys(pluginConfig.tools || {}).sort(),
  [...expectedAgentTools].sort(),
  "plugin.json should declare the same Agent tools registered by preload",
);
const unsupportedAgentSchemaKeywords = new Set([
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "minProperties",
]);
assert.equal(
  schemaContainsKeyword(pluginConfig.tools.project_manager_upsert_project.inputSchema, unsupportedAgentSchemaKeywords),
  false,
  "Project upsert inputSchema should avoid conditional composition that uTools packaging cannot parse",
);
assert.equal(
  schemaContainsKeyword(pluginConfig.tools.project_manager_upsert_script.inputSchema, unsupportedAgentSchemaKeywords),
  false,
  "Script upsert inputSchema should avoid conditional composition that uTools packaging cannot parse",
);
assert.deepEqual(
  Object.entries(pluginConfig.tools).flatMap(([toolName, tool]) =>
    objectSchemaPathsWithoutProperties(tool.inputSchema, `${toolName}.inputSchema`),
  ),
  [],
  "Every object input schema should declare properties to avoid uTools generating a Zod 4-incompatible record",
);
const environmentInputSchema = pluginConfig.tools.project_manager_upsert_project.inputSchema.properties.env;
assert.equal(
  environmentInputSchema.type,
  "array",
  "Project environment input should use entries instead of a Zod 4-incompatible record schema",
);
assert.deepEqual(
  clone(environmentInputSchema.items.required),
  ["key", "value"],
  "Each project environment entry should require both key and value",
);

const agentBridge = createBridge({
  docs: [{ _id: `${projectDocPrefix}${publicDocProject.id}`, project: publicDocProject }],
});
const agentTools = agentBridge.registeredTools;
assert.deepEqual(
  [...agentTools.keys()].sort(),
  [...expectedAgentTools].sort(),
  "all declared Agent tools should register during preload initialization",
);
const listProjects = agentTools.get("project_manager_list_projects");
const getProject = agentTools.get("project_manager_get_project");
const upsertProject = agentTools.get("project_manager_upsert_project");
const upsertScript = agentTools.get("project_manager_upsert_script");

const createdAgentProject = upsertProject({
  name: "Agent Private Project",
  path: "C:/work/agent-project",
  type: "Node.js",
  description: "Created through the Agent tool",
  visibility: "private",
  group: "tools",
  env: [
    { key: "API_TOKEN", value: "agent-secret" },
    { key: "PORT", value: "3000" },
  ],
});
assert.equal(createdAgentProject.project.name, "Agent Private Project", "Agent project creation should return the new project");
assert.equal(
  createdAgentProject.project.visibility,
  "private",
  "Agent project creation should persist requested visibility",
);
assert.equal(createdAgentProject.project.kind, "node", "Agent project creation should derive kind from the selected type");
assert.deepEqual(
  clone(createdAgentProject.project.environmentKeys),
  ["API_TOKEN", "PORT"],
  "Agent project creation should return environment variable names without their values",
);
assert.equal(
  agentBridge.docsById.has(`${projectDocPrefix}${createdAgentProject.project.id}`),
  false,
  "Agent-created private projects must stay out of the syncing database",
);
assert.equal(
  privateProjectFileExists(agentBridge.localDataDir, createdAgentProject.project.id),
  true,
  "Agent-created private projects must persist into the plugin local data directory",
);
assert.throws(
  () =>
    upsertProject({
      name: "Invalid Agent Project",
      path: "C:/work/invalid-agent-project",
      type: "Unrestricted Type",
    }),
  /项目类型必须是以下之一/,
  "Agent project creation should reject types outside the supported project type list",
);
assert.throws(
  () =>
    upsertProject({
      name: "Duplicate Environment Project",
      path: "C:/work/duplicate-environment-project",
      type: "Node.js",
      env: [
        { key: "PORT", value: "3000" },
        { key: " PORT ", value: "4000" },
      ],
    }),
  /环境变量名不能重复/,
  "Agent project creation should reject environment keys duplicated after normalization",
);

const createdAgentScript = upsertScript({
  projectId: createdAgentProject.project.id,
  name: "dev",
  command: "npm run dev",
  cwd: "frontend",
  note: "Development server",
});
assert.equal(createdAgentScript.script.source, "manual", "Agent-created scripts should use the manual source");
assert.equal(createdAgentScript.script.cwd, "frontend", "Agent-created scripts should retain their working directory");
const storedAgentEnvelope = (() => {
  const projectsDir = path.join(agentBridge.localDataDir, "projects");
  const entry = fs
    .readdirSync(projectsDir)
    .find((candidate) => {
      const envelope = JSON.parse(fs.readFileSync(path.join(projectsDir, candidate), "utf8"));
      return envelope?.project?.id === createdAgentProject.project.id;
    });
  return JSON.parse(fs.readFileSync(path.join(projectsDir, entry), "utf8"));
})();
assert.equal(
  storedAgentEnvelope.project.scripts.length,
  1,
  "Agent-created scripts should persist through the shared project writer",
);
assert.deepEqual(
  clone(storedAgentEnvelope.project.env),
  { API_TOKEN: "agent-secret", PORT: "3000" },
  "Agent project creation should persist environment variable values through the shared project writer",
);

// Publishing the private project through the Agent tool moves it to the sync database.
const publishedAgentProject = upsertProject({
  projectId: createdAgentProject.project.id,
  visibility: "public",
  group: "published-group",
});
assert.equal(publishedAgentProject.project.visibility, "public", "Agent project updates should persist visibility");
assert.equal(
  agentBridge.docsById.has(`${projectDocPrefix}${createdAgentProject.project.id}`),
  true,
  "Publishing an Agent project must create its syncing document",
);
assert.equal(
  privateProjectFileExists(agentBridge.localDataDir, createdAgentProject.project.id),
  false,
  "Publishing an Agent project must remove its local-only copy",
);

const updatedAgentProject = upsertProject({
  projectId: createdAgentProject.project.id,
  name: "Updated Agent Project",
  type: "Go",
  description: "Updated through the Agent tool",
  quickLink: "C:/work/agent-project/docs",
  env: { PORT: "4000", APP_MODE: "development" },
  removeEnvKeys: ["API_TOKEN"],
});
assert.deepEqual(
  clone(updatedAgentProject.updatedFields),
  ["name", "type", "description", "quickLink", "env"],
  "Agent project updates should report the requested metadata and environment fields",
);
assert.equal(updatedAgentProject.project.type, "Go", "Agent project updates should persist the selected project type");
const updatedStoredAgentDoc = agentBridge.docsById.get(`${projectDocPrefix}${createdAgentProject.project.id}`).project;
assert.equal(updatedStoredAgentDoc.icon, "go", "Agent project updates should derive the matching project icon");
assert.equal(updatedStoredAgentDoc.group, "published-group", "Agent project updates should preserve untouched groups");
assert.equal(
  updatedStoredAgentDoc.scripts.length,
  1,
  "Agent project updates should preserve project scripts outside their editable metadata scope",
);
assert.deepEqual(
  clone(updatedStoredAgentDoc.env),
  { PORT: "4000", APP_MODE: "development" },
  "Agent project updates should merge and explicitly remove only requested environment keys",
);

const listedAgentProjects = listProjects({});
assert.equal(
  listedAgentProjects.count,
  2,
  "Agent project listing should return public documents plus local private projects",
);
assert.equal("scripts" in listedAgentProjects.projects.find((project) => project.id === publicDocProject.id), false, "Agent project listing should remain a summary response");
assert.deepEqual(
  clone([...listedAgentProjects.groups].sort()),
  ["existing-group", "published-group"].sort(),
  "Agent project listing should expose actual non-empty project groups",
);
assert.deepEqual(
  clone(listedAgentProjects.projectTypes),
  pluginConfig.tools.project_manager_upsert_project.inputSchema.properties.type.enum,
  "Agent project listing should expose the same project types accepted by project upserts",
);
const detailedAgentProject = getProject({ projectId: createdAgentProject.project.id });
assert.equal(
  "env" in detailedAgentProject.project,
  false,
  "Agent project details should not expose environment variable values",
);
assert.throws(
  () => upsertProject({ projectId: createdAgentProject.project.id }),
  /请至少提供一个可编辑字段/,
  "Agent project updates should reject an empty metadata patch",
);
assert.throws(
  () => upsertScript({ projectId: createdAgentProject.project.id, scriptId: createdAgentScript.script.id }),
  /请至少提供一个可编辑字段/,
  "Agent script updates should reject an empty patch",
);
assert.throws(
  () => getProject({ projectId: "missing-project" }),
  /未找到指定项目/,
  "Agent project details should fail clearly for unknown IDs",
);
cleanupBridge(agentBridge);

// ---------------------------------------------------------------------------
// Preflight: version gating, migration detection and completion.
// ---------------------------------------------------------------------------

const browserPreviewBridge = createBridge({ hostMode: "none" });
assert.equal(
  browserPreviewBridge.bridge.preflightStartup().status,
  "browser-preview",
  "browser development previews must report an explicit browser-preview status",
);
cleanupBridge(browserPreviewBridge);

const legacyHostBridge = createBridge({ hostMode: "legacy" });
assert.equal(
  legacyHostBridge.bridge.preflightStartup().status,
  "upgrade-required",
  "hosts without v8 local-data APIs must be blocked with an upgrade requirement",
);
cleanupBridge(legacyHostBridge);

const legacyDataFixture = {
  legacyDbStorage: {
    [legacyTerminalPreferencesKey]: { kind: "powershell", customCommand: "" },
    [legacyUiPreferencesKey]: { schemaVersion: 1 },
    [legacyProjectLaunchServiceKey]: { schemaVersion: 1, enabled: true },
    [legacyEnvironmentPreferencesKey]: { enabledToolKeys: ["node"], customTools: [], builtinOverrides: [] },
  },
  legacyProjects: [aggregateOnlyProject],
};

const migrationRequiredBridge = createBridge({
  docs: [{ _id: `${projectDocPrefix}${foreignPrivateDocProject.id}`, project: foreignPrivateDocProject }],
  ...legacyDataFixture,
  localDeviceId: "device-current",
});
assert.equal(
  migrationRequiredBridge.bridge.preflightStartup().status,
  "migration-required",
  "v8 hosts with unmigrated legacy data must block startup until migration completes",
);
cleanupBridge(migrationRequiredBridge);

// ---------------------------------------------------------------------------
// Migration: ledger-driven, resumable, verify-before-delete.
// ---------------------------------------------------------------------------

const migrationBridge = createBridge({
  docs: [
    { _id: `${projectDocPrefix}${publicDocProject.id}`, project: publicDocProject },
    {
      _id: `${projectDocPrefix}owned-private`,
      project: {
        id: "owned-private",
        name: "Owned Private",
        path: "C:/work/owned-private",
        visibility: "private",
        ownerDeviceId: "device-current",
        scripts: [{ id: "owned-script", name: "dev", command: "npm run dev", status: "IDLE" }],
        env: { API_TOKEN: "secret" },
      },
    },
    { _id: `${projectDocPrefix}${foreignPrivateDocProject.id}`, project: foreignPrivateDocProject },
  ],
  ...legacyDataFixture,
  localDeviceId: "device-current",
});

// Legacy aggregate: one public project (missing from docs) and one private owned by this device.
migrationBridge.dbStorageValues.set(storageKey, {
  projects: [
    { id: "legacy-public", name: "Legacy Public", path: "C:/work/legacy-public" },
    {
      id: "legacy-private",
      name: "Legacy Private",
      path: "C:/work/legacy-private",
      visibility: "private",
      ownerDeviceId: "device-current",
      scripts: [],
      env: {},
    },
    {
      id: "legacy-foreign-private",
      name: "Legacy Foreign Private",
      path: "C:/work/legacy-foreign",
      visibility: "private",
      ownerDeviceId: "other-device",
      scripts: [],
      env: {},
    },
  ],
});

// Legacy service directory: token/state must be copied; runtime files must not.
const legacyServiceDir = path.join(migrationBridge.legacyDataDir, "service");
fs.mkdirSync(legacyServiceDir, { recursive: true });
fs.writeFileSync(path.join(legacyServiceDir, "token"), `${"a".repeat(64)}\n`);
fs.writeFileSync(path.join(legacyServiceDir, "state.json"), JSON.stringify({ schemaVersion: 1, nextCursor: 7 }));
fs.writeFileSync(path.join(legacyServiceDir, "discovery.json"), JSON.stringify({ runtime: true }));
fs.writeFileSync(path.join(legacyServiceDir, "service.lock"), "locked");
fs.mkdirSync(path.join(legacyServiceDir, "downloads"), { recursive: true });
fs.writeFileSync(path.join(legacyServiceDir, "downloads", "partial.download"), "partial");
const legacyIconPackDir = path.join(migrationBridge.legacyDataDir, "icon-packs", "vscode-icons-derived");
fs.mkdirSync(legacyIconPackDir, { recursive: true });
fs.writeFileSync(path.join(legacyIconPackDir, "pack.json.gz"), Buffer.from("icon-pack-bytes"));
fs.writeFileSync(path.join(legacyIconPackDir, "install.json"), JSON.stringify({ assetName: "pack.iconpack.json.gz" }));

const migrationResult = await migrationBridge.bridge.runMigration();
assert.equal(migrationResult.ok, true, "the full migration must complete successfully");
assert.equal(migrationResult.ledger.status, "completed", "the migration ledger must record completion");

const migratedLocalState = readLocalStateFile(migrationBridge.localDataDir);
assert.deepEqual(
  clone(migratedLocalState.preferences.terminal),
  { kind: "powershell", customCommand: "" },
  "terminal preferences must migrate into the local state file",
);
assert.deepEqual(
  clone(migratedLocalState.preferences.projectLaunchService),
  { schemaVersion: 1, enabled: true },
  "service switches must migrate into the local state file",
);
assert.deepEqual(
  clone(migratedLocalState.preferences.environment.enabledToolKeys),
  ["node"],
  "environment tool preferences must migrate into the local state file",
);

assert.deepEqual(
  listLocalPrivateProjectIds(migrationBridge.localDataDir).sort(),
  ["legacy-private", "owned-private"].sort(),
  "private projects owned by this device must migrate into local project files",
);
assert.equal(
  migrationBridge.docsById.has(`${projectDocPrefix}owned-private`),
  false,
  "verified private project documents must be removed from the sync database",
);
assert.equal(
  migrationBridge.docsById.has(`${projectDocPrefix}foreign-private-project`),
  true,
  "private documents owned by other devices must not be migrated or deleted",
);
assert.equal(
  migrationBridge.docsById.has(`${projectDocPrefix}legacy-public`),
  true,
  "legacy public projects missing documents must be materialized as documents",
);
assert.equal(
  privateProjectFileExists(migrationBridge.localDataDir, "legacy-foreign-private"),
  false,
  "aggregate private projects owned by other devices must be skipped",
);
assert.equal(
  migrationBridge.dbStorageValues.has(storageKey),
  true,
  "the legacy aggregate key must be retained for data cleanup",
);

const newServiceDir = path.join(migrationBridge.localDataDir, "service");
assert.equal(
  fs.readFileSync(path.join(newServiceDir, "token"), "utf8"),
  `${"a".repeat(64)}\n`,
  "the service token must be copied and preserved byte-for-byte",
);
assert.equal(
  fs.existsSync(path.join(newServiceDir, "state.json")),
  true,
  "the service runtime state must be copied",
);
assert.equal(
  fs.existsSync(path.join(newServiceDir, "discovery.json")),
  false,
  "runtime discovery files must not be copied",
);
assert.equal(
  fs.existsSync(path.join(newServiceDir, "service.lock")),
  false,
  "service lock files must not be copied",
);
assert.equal(
  fs.existsSync(path.join(newServiceDir, "downloads")),
  false,
  "partial service downloads must not be copied",
);
assert.equal(
  fs.existsSync(path.join(migrationBridge.localDataDir, "icon-packs", "vscode-icons-derived", "pack.json.gz")),
  true,
  "icon pack packages must migrate into the plugin local data directory",
);
assert.equal(
  fs.existsSync(path.join(migrationBridge.legacyDataDir, "service", "token")),
  true,
  "the legacy data directory must be retained after migration until cleanup",
);

assert.equal(
  migrationBridge.bridge.preflightStartup().status,
  "ready",
  "startup must be allowed once the migration ledger records completion",
);
assert.equal(
  migrationBridge.bridge.loadTerminalPreferences().kind,
  "powershell",
  "migrated preferences must be served from the local state file",
);

const rerunResult = await migrationBridge.bridge.runMigration();
assert.equal(rerunResult.ok, true, "rerunning a completed migration must succeed without changes");

// An interrupted ledger forces the blocking migration-incomplete status.
const interruptedBridge = createBridge({ ...legacyDataFixture });
fs.writeFileSync(
  path.join(interruptedBridge.localDataDir, "migration.v1.json"),
  JSON.stringify({ schemaVersion: 1, status: "failed", startedAt: "", completedAt: "", items: [] }),
  "utf8",
);
assert.equal(
  interruptedBridge.bridge.preflightStartup().status,
  "migration-incomplete",
  "an unfinished migration ledger must keep blocking startup",
);
cleanupBridge(interruptedBridge);

// A fresh v8 install without legacy data must not require migration.
const freshBridge = createBridge({});
assert.equal(
  freshBridge.bridge.preflightStartup().status,
  "ready",
  "fresh v8 installs must start without migration",
);
assert.equal(
  fs.existsSync(path.join(freshBridge.localDataDir, "migration.v1.json")),
  false,
  "a fresh install must not write a migration ledger",
);
cleanupBridge(freshBridge);
cleanupBridge(migrationBridge);

// ---------------------------------------------------------------------------
// Workspace state and environment overrides.
// ---------------------------------------------------------------------------

const workspaceBridge = createBridge({});
const workspaceState = {
  dashboardProjectGroup: "group:frontend",
  workActivity: {
    selectionInitialized: true,
    preferences: { rangeMode: "days30", timeZone: "local" },
    selectedProjectIds: ["project-1", "project-2"],
  },
};
assert.equal(
  workspaceBridge.bridge.saveWorkspaceState(workspaceState).ok,
  true,
  "workspace state saves must succeed with a valid local data directory",
);
const restartedWorkspaceBridge = createBridge({ localDataDir: workspaceBridge.localDataDir, legacyDataDir: workspaceBridge.legacyDataDir, tempDataDir: workspaceBridge.tempDataDir });
// Keep the temp directories alive for the restarted bridge.
workspaceBridge.trackedTempDirectories = [];
const reloadedWorkspace = restartedWorkspaceBridge.bridge.loadWorkspaceState();
assert.equal(reloadedWorkspace.dashboardProjectGroup, "group:frontend", "dashboard group selection must persist");
assert.equal(reloadedWorkspace.workActivity.selectionInitialized, true, "work activity selection state must persist");
assert.deepEqual(
  clone(reloadedWorkspace.workActivity.selectedProjectIds),
  ["project-1", "project-2"],
  "work activity project selections must persist",
);
assert.deepEqual(
  clone(reloadedWorkspace.workActivity.preferences.rangeMode),
  "days30",
  "work activity preferences must persist",
);

assert.equal(
  workspaceBridge.bridge.saveProjectEnvironmentOverrides("public-project", {
    env: { PORT: "4000", API_TOKEN: "device-secret" },
    localOnlyEnvKeys: ["API_TOKEN"],
  }).ok,
  true,
  "public project environment overrides must persist",
);
const reloadedOverrides = restartedWorkspaceBridge.bridge.loadProjectEnvironmentOverrides("public-project");
assert.deepEqual(clone(reloadedOverrides.env), { PORT: "4000", API_TOKEN: "device-secret" });
assert.deepEqual(clone(reloadedOverrides.localOnlyEnvKeys), ["API_TOKEN"]);
workspaceBridge.bridge.saveProjectEnvironmentOverrides("public-project", { env: {}, localOnlyEnvKeys: [] });
assert.deepEqual(
  clone(restartedWorkspaceBridge.bridge.loadProjectEnvironmentOverrides("public-project")),
  { env: {}, localOnlyEnvKeys: [] },
  "clearing an override map must remove the stored entry",
);
cleanupBridge(restartedWorkspaceBridge);
cleanupBridge(workspaceBridge);

// ---------------------------------------------------------------------------
// Data tools: overview, cleanup plan constraints and execution.
// ---------------------------------------------------------------------------

const cleanupBridgeFixture = createBridge({
  docs: [
    { _id: `${projectDocPrefix}${publicDocProject.id}`, project: publicDocProject },
    { _id: `${projectDocPrefix}${foreignPrivateDocProject.id}`, project: foreignPrivateDocProject },
  ],
  legacyDbStorage: { [legacyTerminalPreferencesKey]: { kind: "cmd", customCommand: "" } },
});
fs.writeFileSync(path.join(cleanupBridgeFixture.tempDataDir, "leftover.tmp"), "temp");

const cleanupOverview = await cleanupBridgeFixture.bridge.getStorageOverview();
assert.equal(cleanupOverview.projects.publicCount, 1, "storage overview must count public projects");
assert.equal(cleanupOverview.projects.legacyPrivateDocCount, 1, "storage overview must count legacy private documents");
assert.ok(
  cleanupOverview.legacyDbStorageKeys.includes(legacyTerminalPreferencesKey),
  "storage overview must list present legacy dbStorage keys",
);

const cleanupPlan = await cleanupBridgeFixture.bridge.getCleanupPlan();
const planItemIds = new Set(cleanupPlan.items.map((item) => item.id));
for (const expectedItem of [
  "sync-public-projects",
  "sync-legacy-private-projects",
  "sync-legacy-dbstorage",
  "local-private-projects",
  "local-device-preferences",
  "local-workspace-state",
  "local-service-directory",
  "local-icon-packs",
  "local-legacy-directory",
  "cache-temp-directory",
  "cache-service-downloads",
  "cache-diagnostics",
  "cache-git-activity",
]) {
  assert.ok(planItemIds.has(expectedItem), `cleanup plan must offer ${expectedItem}`);
}
const tempCleanupItem = cleanupPlan.items.find((item) => item.id === "cache-temp-directory");
assert.equal(
  tempCleanupItem.disabledReason,
  "",
  "the temp directory cleanup must be available",
);

const legacyKeyCleanup = await cleanupBridgeFixture.bridge.executeCleanup(["sync-legacy-dbstorage", "cache-temp-directory"]);
assert.equal(legacyKeyCleanup.ok, true, "legacy key and temp cleanup must succeed");
assert.equal(
  cleanupBridgeFixture.dbStorageValues.has(legacyTerminalPreferencesKey),
  false,
  "legacy dbStorage keys must be removed by cleanup",
);
assert.equal(
  fs.existsSync(path.join(cleanupBridgeFixture.tempDataDir, "leftover.tmp")),
  false,
  "temp directory contents must be removed by cleanup",
);
cleanupBridge(cleanupBridgeFixture);

// Sync cleanup is blocked while the cloud replication is in progress.
const replicatingBridge = createBridge({
  docs: [{ _id: `${projectDocPrefix}${publicDocProject.id}`, project: publicDocProject }],
  legacyDbStorage: { [legacyTerminalPreferencesKey]: { kind: "cmd", customCommand: "" } },
  replicateState: 1,
});
const replicatingPlan = await replicatingBridge.bridge.getCleanupPlan();
assert.equal(
  replicatingPlan.syncReplicating,
  true,
  "cleanup planning must expose the cloud replication state",
);
const replicatingCleanup = await replicatingBridge.bridge.executeCleanup(["sync-legacy-dbstorage"]);
assert.equal(
  replicatingCleanup.ok,
  false,
  "sync data cleanup must refuse to run while cloud data is still replicating",
);
assert.equal(
  replicatingBridge.dbStorageValues.has(legacyTerminalPreferencesKey),
  true,
  "the blocked cleanup must not have deleted the legacy key",
);
cleanupBridge(replicatingBridge);

// ---------------------------------------------------------------------------
// Catalog merge semantics for public documents (optimistic concurrency).
// ---------------------------------------------------------------------------

const catalogBaseProject = {
  id: "catalog-base-project",
  name: "Catalog Base Project",
  path: "C:/work/catalog-base-project",
  type: "Custom",
  kind: "custom",
  status: "STOPPED",
  scripts: [],
  env: {},
  memo: "base memo",
  automationTasks: [
    {
      id: "catalog-automation-task",
      name: "Catalog automation task",
      enabled: true,
      notifyEnabled: true,
      dailyPlans: [],
      history: [],
    },
  ],
  sortOrder: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const catalogRemoteProject = {
  id: "catalog-remote-project",
  name: "Catalog Remote Project",
  path: "C:/work/catalog-remote-project",
  type: "Custom",
  kind: "custom",
  status: "STOPPED",
  scripts: [],
  env: {},
  sortOrder: 1,
};
const catalogBaseDocument = {
  _id: `${projectDocPrefix}${catalogBaseProject.id}`,
  _rev: "catalog-base-revision",
  project: catalogBaseProject,
};
const catalogRemoteDocument = {
  _id: `${projectDocPrefix}${catalogRemoteProject.id}`,
  _rev: "catalog-remote-revision",
  project: catalogRemoteProject,
};
const catalogBridge = createBridge({
  docs: [catalogBaseDocument, catalogRemoteDocument],
  requireCurrentDbRevision: true,
});
const remoteBaseDocument = catalogBridge.docsById.get(catalogBaseDocument._id);
catalogBridge.docsById.set(catalogBaseDocument._id, {
  ...remoteBaseDocument,
  _rev: "catalog-agent-revision",
  project: {
    ...remoteBaseDocument.project,
    group: "agent-group",
    scripts: [{ id: "agent-script", name: "agent", command: "echo agent", status: "IDLE" }],
    automationTasks: remoteBaseDocument.project.automationTasks.map((task) => ({
      ...task,
      dailyPlans: [{ date: "2026-01-01", entries: [] }],
      history: [{ id: "legacy-execution", status: "completed" }],
      observedServiceExecutionIds: ["legacy-execution"],
    })),
  },
});
catalogBridge.bridge.saveProjects(
  [{ ...catalogBaseProject, memo: "local memo", updatedAt: "2026-01-02T00:00:00.000Z" }],
  { baseProjects: [catalogBaseProject] },
);
const safelyMergedCatalogProject = catalogBridge.docsById.get(catalogBaseDocument._id).project;
assert.equal(
  safelyMergedCatalogProject.memo,
  "local memo",
  "Catalog saves should apply local metadata changes after an Agent mutation",
);
assert.equal(
  safelyMergedCatalogProject.group,
  "agent-group",
  "Catalog saves should retain remote Agent metadata that was absent from the Store baseline",
);
assert.equal(
  safelyMergedCatalogProject.scripts.some((script) => script.id === "agent-script"),
  true,
  "Catalog saves should retain a script added by an Agent after the Store baseline",
);
assert.equal(
  safelyMergedCatalogProject.automationTasks[0].history.length,
  1,
  "Unrelated project saves should retain legacy automation runtime data until task configuration changes",
);
catalogBridge.bridge.saveProjects(
  [
    {
      ...catalogBaseProject,
      memo: "local memo",
      automationTasks: catalogBaseProject.automationTasks.map((task) => ({
        ...task,
        notifyEnabled: false,
        dailyPlans: [],
        history: [],
      })),
      updatedAt: "2026-01-03T00:00:00.000Z",
    },
  ],
  { baseProjects: [{ ...catalogBaseProject, memo: "local memo" }] },
);
const automationUpdatedCatalogProject = catalogBridge.docsById.get(catalogBaseDocument._id).project;
assert.equal(
  automationUpdatedCatalogProject.automationTasks[0].notifyEnabled,
  false,
  "Automation task configuration changes should be applied",
);
assert.deepEqual(
  clone(automationUpdatedCatalogProject.automationTasks[0].history),
  [],
  "Automation task configuration changes should clear legacy execution history",
);
assert.equal(
  "observedServiceExecutionIds" in automationUpdatedCatalogProject.automationTasks[0],
  false,
  "Automation task configuration changes should clear legacy notification receipts",
);
assert.equal(
  catalogBridge.docsById.has(catalogRemoteDocument._id),
  true,
  "Catalog saves should retain remote projects absent from a stale Store catalog unless deletion is explicit",
);
catalogBridge.bridge.saveProjects(
  [{ ...catalogBaseProject, memo: "local memo", updatedAt: "2026-01-02T00:00:00.000Z" }],
  { baseProjects: [catalogBaseProject, catalogRemoteProject], removedProjectIds: [catalogRemoteProject.id] },
);
assert.equal(
  catalogBridge.docsById.has(catalogRemoteDocument._id),
  false,
  "Catalog saves should remove a project only when the caller explicitly identifies it as deleted",
);
cleanupBridge(catalogBridge);

const unreadableCatalogBridge = createBridge({
  docs: [catalogBaseDocument],
  allDocsError: "catalog temporarily unavailable",
});
assert.throws(
  () => unreadableCatalogBridge.bridge.loadProjects(),
  /catalog temporarily unavailable/,
  "A canonical catalog read error must surface instead of looking like an empty catalog",
);
assert.throws(
  () => unreadableCatalogBridge.bridge.saveProjects([catalogBaseProject], { baseProjects: [catalogBaseProject] }),
  /catalog temporarily unavailable/,
  "A canonical catalog read error must block full catalog saves before any project document can be removed",
);
cleanupBridge(unreadableCatalogBridge);

const legacySortedProjectA = { ...catalogBaseProject, id: "legacy-sort-a", sortOrder: 1 };
const legacySortedProjectB = { ...catalogBaseProject, id: "legacy-sort-b" };
delete legacySortedProjectB.sortOrder;
const legacySortedProjectC = { ...catalogBaseProject, id: "legacy-sort-c", sortOrder: 2 };
const legacySortBridge = createBridge({
  docs: [
    { _id: `${projectDocPrefix}${legacySortedProjectA.id}`, _rev: "sort-a", project: legacySortedProjectA },
    { _id: `${projectDocPrefix}${legacySortedProjectB.id}`, _rev: "sort-b", project: legacySortedProjectB },
    { _id: `${projectDocPrefix}${legacySortedProjectC.id}`, _rev: "sort-c", project: legacySortedProjectC },
  ],
});
const legacySortUpdate = legacySortBridge.registeredTools.get("project_manager_upsert_project")({
  projectId: legacySortedProjectB.id,
  group: "updated-without-reordering",
});
assert.equal(legacySortUpdate.project.group, "updated-without-reordering");
assert.equal(
  Object.prototype.hasOwnProperty.call(
    legacySortBridge.docsById.get(`${projectDocPrefix}${legacySortedProjectB.id}`).project,
    "sortOrder",
  ),
  false,
  "Agent updates should preserve a legacy project document's missing sortOrder instead of assigning zero",
);
assert.deepEqual(
  clone(legacySortBridge.bridge.loadProjects().map((project) => project.id)),
  [legacySortedProjectA.id, legacySortedProjectB.id, legacySortedProjectC.id],
  "Agent updates should retain legacy fallback ordering when sortOrder was absent",
);
cleanupBridge(legacySortBridge);

const rejectedWriteBridge = createBridge({
  docs: [{ _id: `${projectDocPrefix}${publicDocProject.id}`, project: publicDocProject }],
  rejectDbWrites: true,
});
assert.throws(
  () =>
    rejectedWriteBridge.registeredTools.get("project_manager_upsert_script")({
      projectId: publicDocProject.id,
      name: "should-not-report-success",
      command: "echo conflict",
    }),
  /保存项目配置失败/,
  "Agent script creation must not report success when uTools database persistence fails",
);
assert.throws(
  () =>
    rejectedWriteBridge.registeredTools.get("project_manager_upsert_project")({
      projectId: publicDocProject.id,
      group: "should-not-report-success",
    }),
  /保存项目配置失败/,
  "Agent project updates must not report success when uTools database persistence fails",
);
cleanupBridge(rejectedWriteBridge);

const nonBooleanWriteBridge = createBridge({
  docs: [{ _id: `${projectDocPrefix}${publicDocProject.id}`, project: publicDocProject }],
  dbWriteResult: () => ({ ok: "true", message: "invalid success result" }),
});
assert.throws(
  () =>
    nonBooleanWriteBridge.registeredTools.get("project_manager_upsert_script")({
      projectId: publicDocProject.id,
      name: "must-not-report-success",
      command: "echo invalid-result",
    }),
  /保存项目配置失败/,
  "Only a boolean { ok: true } may report a successful project document write",
);
cleanupBridge(nonBooleanWriteBridge);

const canonicalReadbackBridge = createBridge({
  docs: [{ _id: `${projectDocPrefix}${publicDocProject.id}`, project: publicDocProject }],
  afterDbPut({ id, docsById: currentDocs }) {
    currentDocs.delete(id);
  },
});
assert.throws(
  () =>
    canonicalReadbackBridge.registeredTools.get("project_manager_upsert_project")({
      projectId: publicDocProject.id,
      group: "must-not-report-success",
    }),
  /项目配置保存后无法重新读取/,
  "A missing canonical document after write must not report success",
);
cleanupBridge(canonicalReadbackBridge);

const strictRevisionDoc = {
  _id: `${projectDocPrefix}${publicDocProject.id}`,
  _rev: "current-revision",
  project: publicDocProject,
};
const strictRevisionBridge = createBridge({
  docs: [strictRevisionDoc],
  requireCurrentDbRevision: true,
  allDocsRevisionOverride: "stale-revision",
});
const strictRevisionScript = strictRevisionBridge.registeredTools.get("project_manager_upsert_script")({
  projectId: publicDocProject.id,
  name: "saved-with-current-revision",
  command: "echo saved",
});
assert.equal(
  strictRevisionBridge.docsById
    .get(strictRevisionDoc._id)
    .project.scripts.some((script) => script.id === strictRevisionScript.script.id),
  true,
  "Agent script creation should fetch the current document revision before writing",
);
const strictRevisionProject = strictRevisionBridge.registeredTools.get("project_manager_upsert_project")({
  projectId: publicDocProject.id,
  group: "strict-revision-group",
});
assert.equal(
  strictRevisionBridge.docsById.get(strictRevisionDoc._id).project.group,
  strictRevisionProject.project.group,
  "Agent project updates should fetch the current document revision before writing",
);

const restartedAgentBridge = createBridge({
  docs: Array.from(strictRevisionBridge.docsById.values()),
});
const restartedAgentRead = restartedAgentBridge.registeredTools.get("project_manager_get_project")({
  projectId: publicDocProject.id,
}).project;
assert.equal(
  restartedAgentRead.scripts.some((script) => script.id === strictRevisionScript.script.id),
  true,
  "Agent-created scripts should remain available after a fresh preload instance reads persisted documents",
);
assert.equal(
  restartedAgentRead.group,
  "strict-revision-group",
  "Agent project updates should remain available after a fresh preload instance reads persisted documents",
);
cleanupBridge(restartedAgentBridge);
cleanupBridge(strictRevisionBridge);

let concurrentMetadataChangeApplied = false;
const concurrentMetadataBridge = createBridge({
  docs: [{ _id: `${projectDocPrefix}${publicDocProject.id}`, _rev: "metadata-initial-revision", project: publicDocProject }],
  requireCurrentDbRevision: true,
  afterDbGet({ id, docsById }) {
    if (concurrentMetadataChangeApplied || id !== `${projectDocPrefix}${publicDocProject.id}`) {
      return;
    }
    concurrentMetadataChangeApplied = true;
    const current = docsById.get(id);
    docsById.set(id, {
      ...current,
      _rev: "metadata-remote-revision",
      project: {
        ...current.project,
        env: { ...current.project.env, REMOTE_TOKEN: "preserve-this-change" },
      },
    });
  },
});
const concurrentMetadataProject = concurrentMetadataBridge.registeredTools.get("project_manager_upsert_project")({
  projectId: publicDocProject.id,
  group: "metadata-after-conflict",
  env: { LOCAL_TOKEN: "keep-this-change" },
  removeEnvKeys: ["PORT"],
});
assert.equal(
  concurrentMetadataBridge.docsById.get(`${projectDocPrefix}${publicDocProject.id}`).project.env.REMOTE_TOKEN,
  "preserve-this-change",
  "Agent environment updates should preserve a remote key after a revision conflict",
);
assert.equal(
  concurrentMetadataBridge.docsById.get(`${projectDocPrefix}${publicDocProject.id}`).project.env.LOCAL_TOKEN,
  "keep-this-change",
  "Agent environment updates should reapply their local key after a revision conflict",
);
assert.equal(
  "PORT" in concurrentMetadataBridge.docsById.get(`${projectDocPrefix}${publicDocProject.id}`).project.env,
  false,
  "Agent environment updates should remove only their explicitly requested key after a revision conflict",
);
assert.equal(
  concurrentMetadataProject.project.group,
  "metadata-after-conflict",
  "Agent metadata updates should still apply their requested field after a revision conflict",
);
assert.equal(
  concurrentMetadataBridge.dbCalls.put,
  2,
  "Agent metadata updates should retry once with the latest document after a revision conflict",
);
cleanupBridge(concurrentMetadataBridge);

let concurrentScriptChangeApplied = false;
const concurrentScriptBridge = createBridge({
  docs: [{ _id: `${projectDocPrefix}${publicDocProject.id}`, _rev: "script-initial-revision", project: publicDocProject }],
  requireCurrentDbRevision: true,
  afterDbGet({ id, docsById }) {
    if (concurrentScriptChangeApplied || id !== `${projectDocPrefix}${publicDocProject.id}`) {
      return;
    }
    concurrentScriptChangeApplied = true;
    const current = docsById.get(id);
    docsById.set(id, {
      ...current,
      _rev: "script-remote-revision",
      project: {
        ...current.project,
        scripts: [
          ...current.project.scripts,
          { id: "remote-script", name: "remote", command: "echo remote", status: "IDLE" },
        ],
      },
    });
  },
});
const concurrentScript = concurrentScriptBridge.registeredTools.get("project_manager_upsert_script")({
  projectId: publicDocProject.id,
  name: "local-after-conflict",
  command: "echo local",
});
const concurrentStoredScripts = concurrentScriptBridge.docsById.get(`${projectDocPrefix}${publicDocProject.id}`).project.scripts;
assert.equal(
  concurrentStoredScripts.some((script) => script.id === "remote-script"),
  true,
  "Agent script creation should preserve a script added by another writer before retry",
);
assert.equal(
  concurrentStoredScripts.some((script) => script.id === concurrentScript.script.id),
  true,
  "Agent script creation should append its script to the latest document after a revision conflict",
);
cleanupBridge(concurrentScriptBridge);

// ---------------------------------------------------------------------------
// Repository hygiene: the device identity design must be fully removed.
// ---------------------------------------------------------------------------

const sourceFiles = [];
const collectSourceFiles = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(entryPath);
    } else if (/\.(mjs|ts|js|vue)$/.test(entry.name)) {
      sourceFiles.push(entryPath);
    }
  }
};
collectSourceFiles(path.join(repoRoot, "public", "preload"));
collectSourceFiles(path.join(repoRoot, "scripts"));
collectSourceFiles(path.join(repoRoot, "src"));
collectSourceFiles(path.join(repoRoot, "tests"));
const bannedIdentityTokens = [
  "ownerDeviceId",
  "getCurrentDeviceId",
  "isProjectVisibleOnCurrentDevice",
  "loadDeviceId",
  "deviceIdStorageKey",
  "UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR",
  "getDeviceIdFilePath",
];
const migrationModuleFile = path.join(repoRoot, "public", "preload", "migration.js");
// The checker itself enumerates the banned tokens and builds legacy fixtures,
// so it is excluded from its own scan.
const scanSelfFile = path.join(repoRoot, "scripts", "validate-project-storage-compat.mjs");
for (const sourceFile of sourceFiles) {
  if (sourceFile === scanSelfFile) {
    continue;
  }
  const contents = fs.readFileSync(sourceFile, "utf8");
  for (const token of bannedIdentityTokens) {
    if (!contents.includes(token)) {
      continue;
    }
    const offendingLines = contents
      .split(/\r?\n/)
      .filter((line) => line.includes(token))
      // migration.js reads the legacy ownership field from old documents once,
      // during migration only; every other occurrence must be gone.
      .filter((line) => !(sourceFile === migrationModuleFile && line.includes("legacyOwnerDeviceIdField")));
    if (offendingLines.length > 0) {
      assert.fail(`${path.relative(repoRoot, sourceFile)} must not reference the removed device identity API ${token}`);
    }
  }
}

console.log("project storage compatibility validation passed");
