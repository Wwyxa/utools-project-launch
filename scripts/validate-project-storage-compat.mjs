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
const deviceIdStorageKey = "utools-project-launch.device-id.v1";
const projectDocPrefix = "utools-project-launch/project/";

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

function createBridge({
  docs = [],
  legacyProjects = [],
  localDeviceId = "device-current",
  deviceIdDir,
  rejectDbWrites = false,
  requireCurrentDbRevision = false,
  allDocsRevisionOverride = "",
  afterDbGet,
  afterDbPut,
  dbWriteResult,
  allDocsError = "",
} = {}) {
  const docsById = new Map(docs.map((doc) => [doc._id, clone(doc)]));
  const localStorageValues = new Map(localDeviceId ? [[deviceIdStorageKey, localDeviceId]] : []);
  const registeredTools = new Map();
  const bridgeEvents = [];
  const dbCalls = { allDocs: 0, get: 0, put: 0 };
  const legacyStorageCalls = { getItem: 0, setItem: 0 };
  const resolvedDeviceIdDir = deviceIdDir || fs.mkdtempSync(path.join(os.tmpdir(), "utools-project-launch-device-"));

  class CustomEventStub {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const sandbox = {
    CustomEvent: CustomEventStub,
    TextDecoder,
    clearTimeout,
    console: { warn() {}, error() {}, log() {} },
    crypto: { randomUUID: () => "device-current" },
    process: {
      env: { ...process.env, UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: resolvedDeviceIdDir },
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
      },
      utools: {
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
        },
        dbStorage: {
          getItem(key) {
            legacyStorageCalls.getItem += 1;
            return key === storageKey ? { projects: clone(legacyProjects) } : undefined;
          },
          setItem() {
            legacyStorageCalls.setItem += 1;
          },
        },
        registerTool(name, handler) {
          registeredTools.set(name, handler);
        },
        onPluginOut() {},
      },
    },
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(preloadSource, sandbox, { filename: "public/preload.js" });

  return { bridge: sandbox.window.projectBridge, docsById, registeredTools, bridgeEvents, dbCalls, legacyStorageCalls };
}

const legacyProject = {
  id: "legacy-project",
  name: "Legacy Project",
  path: "C:/work/legacy-project",
};
const privateDocProject = {
  id: "private-project",
  name: "Private Project",
  path: "C:/work/private-project",
  group: "existing-group",
  visibility: "private",
  ownerDeviceId: "other-device",
  type: "Node.js",
  kind: "node",
  cardStyle: "tiny",
  tinyCardButtonCount: 0,
  scripts: [{ id: "private-script", name: "dev", command: "npm run dev", status: "IDLE" }],
  env: { API_TOKEN: "sensitive-value" },
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
      scriptIds: ["private-script"],
      schedule: { type: "fixed", startTime: "09:00", dailyCount: 1, intervalMinutes: 60 },
      missedPolicy: "grace-run",
      missedGraceMinutes: 5,
      notifyEnabled: true,
      maxScriptRuntimeMinutes: 30,
      inputConfigs: [
        {
          scriptId: "private-script",
          steps: [{ id: "step-1", mode: "delay", value: "yes", delayMs: 1000, matchText: "", timeoutMs: 30000 }],
        },
      ],
      exitConfigs: [{ scriptId: "private-script", enabled: true, matchText: "done" }],
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
        projectId: "private-project",
        projectName: "Private Project",
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

const { bridge, docsById, registeredTools, bridgeEvents, dbCalls, legacyStorageCalls } = createBridge({
  legacyProjects: [legacyProject],
  docs: [{ _id: `${projectDocPrefix}${privateDocProject.id}`, project: privateDocProject }],
});

const projects = bridge.loadProjects();
const loadedLegacyProject = projects.find((project) => project.id === legacyProject.id);
const loadedPrivateProject = projects.find((project) => project.id === privateDocProject.id);

assert.equal(projects.length, 2, "legacy list projects and per-project docs should be merged");
assert.ok(loadedLegacyProject, "legacy project should still load when project docs already exist");
assert.equal(loadedLegacyProject.visibility, "public", "legacy projects without visibility should become public");
assert.equal(loadedLegacyProject.ownerDeviceId, "device-current", "legacy projects should receive device metadata");
assert.deepEqual(
  clone(loadedLegacyProject.scripts),
  [],
  "legacy projects without scripts should normalize to an empty array",
);
assert.deepEqual(
  clone(loadedLegacyProject.automationTasks),
  [],
  "legacy projects without automation tasks should normalize to an empty array",
);
assert.deepEqual(clone(loadedLegacyProject.env), {}, "legacy projects without env should normalize to an empty object");
assert.equal(loadedLegacyProject.type, "Custom", "legacy projects without type should keep a safe custom type");
assert.equal(loadedLegacyProject.kind, "custom", "legacy projects without kind should keep a safe custom kind");
assert.equal(loadedLegacyProject.tinyCardButtonCount, 1, "legacy projects should keep one tiny card button by default");
assert.ok(loadedPrivateProject, "private docs from other devices should remain in shared storage results");
assert.equal(loadedPrivateProject.visibility, "private");
assert.equal(loadedPrivateProject.ownerDeviceId, "other-device");
assert.equal(loadedPrivateProject.tinyCardButtonCount, 0, "zero tiny card buttons should survive storage reads");
assert.deepEqual(
  clone(loadedPrivateProject.relatedProjects),
  [
    { projectId: "frontend", bidirectional: true },
    { projectId: "api", bidirectional: false },
    { projectId: "docs", bidirectional: true },
    { projectId: "overflow", bidirectional: false },
  ],
  "related projects should be normalized when reading project documents",
);
assert.equal(loadedPrivateProject.automationTasks.length, 1, "automation tasks should survive project doc loading");
assert.equal(
  loadedPrivateProject.automationTasks[0].history.length,
  20,
  "automation task history should be capped during storage normalization",
);
assert.equal(
  loadedPrivateProject.automationTasks[0].inputConfigs[0].steps[0].value,
  "yes",
  "automation input configs should remain plain text through storage",
);
assert.equal(
  loadedPrivateProject.automationTasks[0].missedPolicy,
  "grace-run",
  "automation missed policy should survive project doc loading",
);
assert.equal(
  loadedPrivateProject.automationTasks[0].missedGraceMinutes,
  5,
  "automation missed grace should survive project doc loading",
);
assert.ok(docsById.has(`${projectDocPrefix}${legacyProject.id}`), "legacy-only projects should be migrated to docs");

bridge.saveProjects([loadedPrivateProject]);
const savedPrivateDoc = docsById.get(`${projectDocPrefix}${privateDocProject.id}`);
assert.equal(savedPrivateDoc.project.tinyCardButtonCount, 0, "zero tiny card buttons should survive storage writes");
assert.equal(
  savedPrivateDoc.project.automationTasks[0].exitConfigs[0].matchText,
  "done",
  "automation exit configs should persist through project doc writes",
);
assert.equal(
  savedPrivateDoc.project.automationTasks[0].missedPolicy,
  "grace-run",
  "automation missed policy should persist through project doc writes",
);
assert.equal(
  savedPrivateDoc.project.automationTasks[0].missedGraceMinutes,
  5,
  "automation missed grace should persist through project doc writes",
);
assert.deepEqual(
  clone(savedPrivateDoc.project.relatedProjects),
  [
    { projectId: "frontend", bidirectional: true },
    { projectId: "api", bidirectional: false },
    { projectId: "docs", bidirectional: true },
    { projectId: "overflow", bidirectional: false },
  ],
  "related projects should persist through project document writes",
);

bridge.saveProjects([{ ...loadedPrivateProject, tinyCardButtonCount: 9 }]);
assert.equal(
  docsById.get(`${projectDocPrefix}${privateDocProject.id}`).project.tinyCardButtonCount,
  3,
  "tiny card button counts should be capped at three before storage",
);

const expectedAgentTools = [
  "project_manager_list_projects",
  "project_manager_get_project",
  "project_manager_upsert_project",
  "project_manager_upsert_script",
];
assert.deepEqual(
  [...registeredTools.keys()].sort(),
  [...expectedAgentTools].sort(),
  "all declared Agent tools should register during preload initialization",
);
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

const listProjects = registeredTools.get("project_manager_list_projects");
const getProject = registeredTools.get("project_manager_get_project");
const upsertProject = registeredTools.get("project_manager_upsert_project");
const upsertScript = registeredTools.get("project_manager_upsert_script");
const listedProjects = listProjects({});
const listedPrivateProject = listedProjects.projects.find((project) => project.id === privateDocProject.id);
assert.equal(listedProjects.count, 2, "Agent project listing should return the stored project count");
assert.ok(listedPrivateProject, "Agent project listing should include stored projects");
assert.equal(listedPrivateProject.scriptCount, 1, "Agent project listing should expose script counts");
assert.equal("scripts" in listedPrivateProject, false, "Agent project listing should remain a summary response");
assert.deepEqual(
  clone(listedProjects.groups),
  ["existing-group"],
  "Agent project listing should expose actual non-empty project groups",
);
assert.deepEqual(
  clone(listedProjects.projectTypes),
  pluginConfig.tools.project_manager_upsert_project.inputSchema.properties.type.enum,
  "Agent project listing should expose the same project types accepted by project upserts",
);
assert.deepEqual(
  pluginConfig.tools.project_manager_upsert_project.inputSchema.properties.type.enum,
  clone(listedProjects.projectTypes),
  "Agent project upserts should accept the constrained project type list",
);

const detailedProject = getProject({ projectId: privateDocProject.id });
assert.deepEqual(
  clone(detailedProject.project.environmentKeys),
  ["API_TOKEN"],
  "Agent project details should expose environment variable names without their values",
);
assert.equal(
  "env" in detailedProject.project,
  false,
  "Agent project details should not expose environment variable values",
);
assert.equal(detailedProject.project.scripts[0].command, "npm run dev", "Agent project details should include scripts");

const dbCallsBeforeAgentWrites = { ...dbCalls };
const legacyStorageCallsBeforeAgentWrites = { ...legacyStorageCalls };
const createdProject = upsertProject({
  name: "Agent Project",
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
assert.equal(createdProject.project.name, "Agent Project", "Agent project creation should return the new project");
assert.equal(
  createdProject.project.visibility,
  "private",
  "Agent project creation should persist requested visibility",
);
assert.equal(createdProject.project.kind, "node", "Agent project creation should derive kind from the selected type");
assert.deepEqual(
  clone(createdProject.project.environmentKeys),
  ["API_TOKEN", "PORT"],
  "Agent project creation should return environment variable names without their values",
);
assert.ok(
  docsById.has(`${projectDocPrefix}${createdProject.project.id}`),
  "Agent project creation should use the existing uTools project document storage",
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

const createdScript = upsertScript({
  projectId: createdProject.project.id,
  name: "dev",
  command: "npm run dev",
  cwd: "frontend",
  note: "Development server",
});
assert.equal(createdScript.script.source, "manual", "Agent-created scripts should use the manual source");
assert.equal(createdScript.script.cwd, "frontend", "Agent-created scripts should retain their working directory");
const storedAgentProject = docsById.get(`${projectDocPrefix}${createdProject.project.id}`).project;
assert.equal(
  storedAgentProject.scripts.length,
  1,
  "Agent-created scripts should persist through the shared project writer",
);
assert.equal(
  storedAgentProject.scripts[0].command,
  "npm run dev",
  "persisted Agent scripts should retain their command",
);
assert.deepEqual(
  clone(storedAgentProject.env),
  { API_TOKEN: "agent-secret", PORT: "3000" },
  "Agent project creation should persist environment variable values through the shared project writer",
);
const updatedProject = upsertProject({
  projectId: createdProject.project.id,
  name: "Updated Agent Project",
  type: "Go",
  group: "existing-group",
  description: "Updated through the Agent tool",
  quickLink: "C:/work/agent-project/docs",
  visibility: "public",
  env: { PORT: "4000", APP_MODE: "development" },
  removeEnvKeys: ["API_TOKEN"],
});
assert.deepEqual(
  clone(updatedProject.updatedFields),
  ["name", "type", "description", "group", "quickLink", "visibility", "env"],
  "Agent project updates should report the requested metadata and environment fields",
);
assert.equal(updatedProject.project.type, "Go", "Agent project updates should persist the selected project type");
assert.equal(updatedProject.project.kind, "go", "Agent project updates should derive kind from the selected type");
const updatedStoredAgentProject = docsById.get(`${projectDocPrefix}${createdProject.project.id}`).project;
assert.equal(updatedStoredAgentProject.icon, "go", "Agent project updates should derive the matching project icon");
assert.equal(updatedStoredAgentProject.group, "existing-group", "Agent project updates should persist selected groups");
assert.equal(
  updatedStoredAgentProject.scripts.length,
  1,
  "Agent project updates should preserve project scripts outside their editable metadata scope",
);
assert.deepEqual(
  clone(updatedStoredAgentProject.env),
  { PORT: "4000", APP_MODE: "development" },
  "Agent project updates should merge and explicitly remove only requested environment keys",
);
const updatedScript = upsertScript({
  projectId: createdProject.project.id,
  scriptId: createdScript.script.id,
  name: "serve",
  command: "npm run dev -- --host",
  cwd: "",
  note: "Updated development server",
});
assert.deepEqual(
  clone(updatedScript.updatedFields),
  ["name", "command", "cwd", "note"],
  "Agent script updates should report only the requested fields",
);
assert.deepEqual(
  clone(updatedScript.script),
  {
    id: createdScript.script.id,
    name: "serve",
    command: "npm run dev -- --host",
    cwd: ".",
    note: "Updated development server",
    source: "manual",
    status: "IDLE",
  },
  "Agent script updates should preserve the script source and status while applying editable fields",
);
assert.equal(
  dbCalls.allDocs - dbCallsBeforeAgentWrites.allDocs,
  0,
  "Agent project writes should avoid full catalog database reads when project documents are available",
);
assert.equal(
  dbCalls.put - dbCallsBeforeAgentWrites.put,
  4,
  "Agent project and script upserts should each write only their target document",
);
assert.ok(
  dbCalls.get - dbCallsBeforeAgentWrites.get >= 8,
  "Agent project writes should read current revisions and re-read their target documents",
);
assert.deepEqual(
  {
    getItem: legacyStorageCalls.getItem - legacyStorageCallsBeforeAgentWrites.getItem,
    setItem: legacyStorageCalls.setItem - legacyStorageCallsBeforeAgentWrites.setItem,
  },
  { getItem: 0, setItem: 0 },
  "Agent project writes should not read or rewrite the legacy project catalog when document storage is available",
);
assert.deepEqual(
  clone(
    bridgeEvents
      .filter((event) => event.type === "projects-changed")
      .map(({ type, projectId, source }) => ({ type, projectId, source })),
  ),
  [
    { type: "projects-changed", projectId: createdProject.project.id, source: "agent" },
    { type: "projects-changed", projectId: createdProject.project.id, source: "agent" },
    { type: "projects-changed", projectId: createdProject.project.id, source: "agent" },
    { type: "projects-changed", projectId: createdProject.project.id, source: "agent" },
  ],
  "Agent project writes should notify an open plugin to reload its project catalog",
);
assert.throws(
  () => upsertProject({ projectId: createdProject.project.id }),
  /请至少提供一个可编辑字段/,
  "Agent project updates should reject an empty metadata patch",
);
assert.throws(
  () => upsertScript({ projectId: createdProject.project.id, scriptId: createdScript.script.id }),
  /请至少提供一个可编辑字段/,
  "Agent script updates should reject an empty patch",
);
assert.throws(
  () => getProject({ projectId: "missing-project" }),
  /未找到指定项目/,
  "Agent project details should fail clearly for unknown IDs",
);

const migrationFailureProjects = createBridge({
  docs: [{ _id: `${projectDocPrefix}${privateDocProject.id}`, project: privateDocProject }],
  legacyProjects: [legacyProject],
  rejectDbWrites: true,
}).bridge.loadProjects();
assert.deepEqual(
  clone(migrationFailureProjects.map((project) => project.id)),
  [legacyProject.id, privateDocProject.id],
  "A failed legacy migration should retain already-read project documents instead of falling back to the legacy catalog alone",
);

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

const unreadableCatalogBridge = createBridge({
  docs: [catalogBaseDocument],
  allDocsError: "catalog temporarily unavailable",
});
assert.throws(
  () => unreadableCatalogBridge.bridge.loadProjects(),
  /catalog temporarily unavailable/,
  "A canonical catalog read error must surface instead of looking like an empty or legacy-only catalog",
);
assert.throws(
  () => unreadableCatalogBridge.bridge.saveProjects([catalogBaseProject], { baseProjects: [catalogBaseProject] }),
  /catalog temporarily unavailable/,
  "A canonical catalog read error must block full catalog saves before any project document can be removed",
);

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

const { registeredTools: rejectedWriteTools } = createBridge({
  docs: [{ _id: `${projectDocPrefix}${privateDocProject.id}`, project: privateDocProject }],
  rejectDbWrites: true,
});
assert.throws(
  () =>
    rejectedWriteTools.get("project_manager_upsert_script")({
      projectId: privateDocProject.id,
      name: "should-not-report-success",
      command: "echo conflict",
    }),
  /保存项目配置失败/,
  "Agent script creation must not report success when uTools database persistence fails",
);
assert.throws(
  () =>
    rejectedWriteTools.get("project_manager_upsert_project")({
      projectId: privateDocProject.id,
      group: "should-not-report-success",
    }),
  /保存项目配置失败/,
  "Agent project updates must not report success when uTools database persistence fails",
);

const { registeredTools: nonBooleanWriteTools } = createBridge({
  docs: [{ _id: `${projectDocPrefix}${privateDocProject.id}`, project: privateDocProject }],
  dbWriteResult: () => ({ ok: "true", message: "invalid success result" }),
});
assert.throws(
  () =>
    nonBooleanWriteTools.get("project_manager_upsert_script")({
      projectId: privateDocProject.id,
      name: "must-not-report-success",
      command: "echo invalid-result",
    }),
  /保存项目配置失败/,
  "Only a boolean { ok: true } may report a successful project document write",
);

const { registeredTools: canonicalReadbackTools } = createBridge({
  docs: [{ _id: `${projectDocPrefix}${privateDocProject.id}`, project: privateDocProject }],
  legacyProjects: [{ ...privateDocProject, group: "legacy-stale-group" }],
  afterDbPut({ id, docsById }) {
    docsById.delete(id);
  },
});
assert.throws(
  () =>
    canonicalReadbackTools.get("project_manager_upsert_project")({
      projectId: privateDocProject.id,
      group: "must-not-report-success",
    }),
  /项目配置保存后无法重新读取/,
  "A missing canonical document after write must not fall back to a stale legacy project",
);

const strictRevisionDoc = {
  _id: `${projectDocPrefix}${privateDocProject.id}`,
  _rev: "current-revision",
  project: privateDocProject,
};
const { docsById: strictRevisionDocs, registeredTools: strictRevisionTools } = createBridge({
  docs: [strictRevisionDoc],
  requireCurrentDbRevision: true,
  allDocsRevisionOverride: "stale-revision",
});
const strictRevisionScript = strictRevisionTools.get("project_manager_upsert_script")({
  projectId: privateDocProject.id,
  name: "saved-with-current-revision",
  command: "echo saved",
});
assert.equal(
  strictRevisionDocs
    .get(strictRevisionDoc._id)
    .project.scripts.some((script) => script.id === strictRevisionScript.script.id),
  true,
  "Agent script creation should fetch the current document revision before writing",
);
const strictRevisionProject = strictRevisionTools.get("project_manager_upsert_project")({
  projectId: privateDocProject.id,
  group: "strict-revision-group",
});
assert.equal(
  strictRevisionDocs.get(strictRevisionDoc._id).project.group,
  strictRevisionProject.project.group,
  "Agent project updates should fetch the current document revision before writing",
);

let concurrentMetadataChangeApplied = false;
const concurrentMetadataDoc = {
  _id: `${projectDocPrefix}${privateDocProject.id}`,
  _rev: "metadata-initial-revision",
  project: privateDocProject,
};
const {
  docsById: concurrentMetadataDocs,
  registeredTools: concurrentMetadataTools,
  dbCalls: concurrentMetadataDbCalls,
} = createBridge({
  docs: [concurrentMetadataDoc],
  requireCurrentDbRevision: true,
  afterDbGet({ id, docsById }) {
    if (concurrentMetadataChangeApplied || id !== concurrentMetadataDoc._id) {
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
const concurrentMetadataProject = concurrentMetadataTools.get("project_manager_upsert_project")({
  projectId: privateDocProject.id,
  group: "metadata-after-conflict",
  env: { LOCAL_TOKEN: "keep-this-change" },
  removeEnvKeys: ["API_TOKEN"],
});
assert.equal(
  concurrentMetadataDocs.get(concurrentMetadataDoc._id).project.env.REMOTE_TOKEN,
  "preserve-this-change",
  "Agent environment updates should preserve a remote key after a revision conflict",
);
assert.equal(
  concurrentMetadataDocs.get(concurrentMetadataDoc._id).project.env.LOCAL_TOKEN,
  "keep-this-change",
  "Agent environment updates should reapply their local key after a revision conflict",
);
assert.equal(
  "API_TOKEN" in concurrentMetadataDocs.get(concurrentMetadataDoc._id).project.env,
  false,
  "Agent environment updates should remove only their explicitly requested key after a revision conflict",
);
assert.equal(
  concurrentMetadataProject.project.group,
  "metadata-after-conflict",
  "Agent metadata updates should still apply their requested field after a revision conflict",
);
assert.equal(
  concurrentMetadataDbCalls.put,
  2,
  "Agent metadata updates should retry once with the latest document after a revision conflict",
);

let concurrentScriptChangeApplied = false;
const concurrentScriptDoc = {
  _id: `${projectDocPrefix}${privateDocProject.id}`,
  _rev: "script-initial-revision",
  project: privateDocProject,
};
const { docsById: concurrentScriptDocs, registeredTools: concurrentScriptTools } = createBridge({
  docs: [concurrentScriptDoc],
  requireCurrentDbRevision: true,
  afterDbGet({ id, docsById }) {
    if (concurrentScriptChangeApplied || id !== concurrentScriptDoc._id) {
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
const concurrentScript = concurrentScriptTools.get("project_manager_upsert_script")({
  projectId: privateDocProject.id,
  name: "local-after-conflict",
  command: "echo local",
});
const concurrentStoredScripts = concurrentScriptDocs.get(concurrentScriptDoc._id).project.scripts;
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
const restartedAgentBridge = createBridge({
  docs: Array.from(strictRevisionDocs.values()),
  legacyProjects: [legacyProject],
});
const restartedProject = restartedAgentBridge.registeredTools.get("project_manager_get_project")({
  projectId: privateDocProject.id,
}).project;
assert.equal(
  restartedProject.scripts.some((script) => script.id === strictRevisionScript.script.id),
  true,
  "Agent-created scripts should remain available after a fresh preload instance reads persisted documents",
);
assert.equal(
  restartedProject.group,
  "strict-revision-group",
  "Agent project updates should remain available after a fresh preload instance reads persisted documents",
);

const persistedDeviceDir = fs.mkdtempSync(path.join(os.tmpdir(), "utools-project-launch-device-"));
try {
  const firstBridge = createBridge({ localDeviceId: "legacy-local-device", deviceIdDir: persistedDeviceDir }).bridge;
  const firstDeviceId = firstBridge.loadDeviceId();
  const restartedBridge = createBridge({ localDeviceId: "", deviceIdDir: persistedDeviceDir }).bridge;
  assert.equal(firstDeviceId, "legacy-local-device", "first run should preserve the existing browser device id");
  assert.equal(
    restartedBridge.loadDeviceId(),
    firstDeviceId,
    "uTools restarts without localStorage should reuse the persisted machine device id",
  );
} finally {
  fs.rmSync(persistedDeviceDir, { recursive: true, force: true });
}

console.log("project storage compatibility validation passed");
