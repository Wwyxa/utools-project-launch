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
const storageKey = "utools-project-launch.projects.v1";
const deviceIdStorageKey = "utools-project-launch.device-id.v1";
const projectDocPrefix = "utools-project-launch/project/";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBridge({ docs = [], legacyProjects = [], localDeviceId = "device-current", deviceIdDir } = {}) {
  const docsById = new Map(docs.map((doc) => [doc._id, clone(doc)]));
  const localStorageValues = new Map(localDeviceId ? [[deviceIdStorageKey, localDeviceId]] : []);
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
      dispatchEvent() {},
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
            return Array.from(docsById.values()).filter((doc) => doc._id.startsWith(prefix)).map(clone);
          },
          get(id) {
            return docsById.has(id) ? clone(docsById.get(id)) : { error: true, message: "not found" };
          },
          put(doc) {
            const nextDoc = clone(doc);
            nextDoc._rev = nextDoc._rev || `rev-${docsById.size + 1}`;
            docsById.set(nextDoc._id, nextDoc);
            return { ok: true, rev: nextDoc._rev };
          },
          remove(doc) {
            docsById.delete(doc._id);
            return { ok: true };
          },
        },
        dbStorage: {
          getItem(key) {
            return key === storageKey ? { projects: clone(legacyProjects) } : undefined;
          },
          setItem() {},
        },
        onPluginOut() {},
      },
    },
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(preloadSource, sandbox, { filename: "public/preload.js" });

  return { bridge: sandbox.window.projectBridge, docsById };
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
  visibility: "private",
  ownerDeviceId: "other-device",
  type: "Node.js",
  kind: "node",
  scripts: [{ id: "private-script", name: "dev", command: "npm run dev", status: "IDLE" }],
  env: {},
};

const { bridge, docsById } = createBridge({
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
assert.deepEqual(clone(loadedLegacyProject.env), {}, "legacy projects without env should normalize to an empty object");
assert.equal(loadedLegacyProject.type, "Custom", "legacy projects without type should keep a safe custom type");
assert.equal(loadedLegacyProject.kind, "custom", "legacy projects without kind should keep a safe custom kind");
assert.ok(loadedPrivateProject, "private docs from other devices should remain in shared storage results");
assert.equal(loadedPrivateProject.visibility, "private");
assert.equal(loadedPrivateProject.ownerDeviceId, "other-device");
assert.ok(docsById.has(`${projectDocPrefix}${legacyProject.id}`), "legacy-only projects should be migrated to docs");

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