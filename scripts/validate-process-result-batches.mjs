import assert from "node:assert/strict";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createPinia, setActivePinia } from "pinia";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preloadSource = fs.readFileSync(path.join(repoRoot, "public", "preload.js"), "utf8");
const childProcess = require("node:child_process");
const spawnedChildren = [];
const dispatchedEvents = [];
let nextPid = 4100;

class MockChildProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = nextPid;
    nextPid += 1;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }

  kill() {
    return true;
  }
}

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
  process: {
    env: { ...process.env },
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
          showItemInFolder() {},
        },
      };
    }
    if (moduleName === "node:child_process") {
      return {
        ...childProcess,
        spawn() {
          const child = new MockChildProcess();
          spawnedChildren.push(child);
          return child;
        },
      };
    }
    return require(moduleName);
  },
  setTimeout,
  window: {
    dispatchEvent(event) {
      dispatchedEvents.push(event.detail);
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    utools: {
      onPluginOut() {},
    },
  },
};
sandbox.globalThis = sandbox;
vm.runInNewContext(preloadSource, sandbox, { filename: "public/preload.js" });

const bridge = sandbox.window.projectBridge;
const basePayload = {
  projectId: "project-1",
  scriptId: "shared-script",
  command: "mock command",
  cwd: repoRoot,
  env: {},
  label: "validation",
};

function launch(payload, terminalResult) {
  const runResult = bridge.runCommand(payload);
  const child = spawnedChildren.at(-1);
  assert.ok(child, "runCommand should spawn a child process");
  if (terminalResult.error) {
    child.emit("error", new Error(terminalResult.error));
  } else {
    child.emit("close", terminalResult.code, terminalResult.signal ?? null);
  }
  return runResult;
}

async function launchAndStop(payload, stopOptions, terminalResult) {
  const runResult = bridge.runCommand(payload);
  const child = spawnedChildren.at(-1);
  assert.ok(child, "runCommand should spawn a child process");
  const stopPromise = bridge.stopProcess(runResult.pid, stopOptions);
  const stopChild = spawnedChildren.at(-1);
  if (stopChild !== child) {
    stopChild.emit("close", 0, null);
  }
  if (terminalResult.error) {
    child.emit("error", new Error(terminalResult.error));
  } else {
    child.emit("close", terminalResult.code, terminalResult.signal ?? null);
  }
  await stopPromise;
  return runResult;
}

const batchASuccess = launch({ ...basePayload, automationRunId: "batch-a" }, { code: 0 });
const manualFailure = launch(basePayload, { code: 4294967295 });
launch({ ...basePayload, automationRunId: "batch-b" }, { code: 4294967295 });

const batchAResult = bridge.getAutomationProcessResult("project-1", "shared-script", "batch-a");
const batchBResult = bridge.getAutomationProcessResult("project-1", "shared-script", "batch-b");
assert.equal(batchAResult.code, 0, "manual runs and later batches must not overwrite batch A success");
assert.equal(batchAResult.automationRunId, "batch-a", "completed results should retain their automation run id");
assert.equal(batchBResult.code, 4294967295, "Windows exit -1 must remain a real batch failure code");
assert.equal(
  bridge.getProcessStatus(manualFailure.pid).code,
  4294967295,
  "manual non-zero process results must preserve existing PID failure semantics",
);
assert.equal(
  bridge.getAutomationProcessResult("project-1", "shared-script", "manual-run"),
  null,
  "manual runs must not enter the automation batch index",
);

launch({ ...basePayload, automationRunId: "batch-c" }, { code: 7 });
launch({ ...basePayload, automationRunId: "batch-d" }, { code: 0 });
assert.equal(
  bridge.getAutomationProcessResult("project-1", "shared-script", "batch-c").code,
  7,
  "a later successful batch must not overwrite an earlier failed batch",
);
assert.equal(bridge.getAutomationProcessResult("project-1", "shared-script", "batch-d").code, 0);

launch({ ...basePayload, scriptId: "script-one", automationRunId: "multi-script-batch" }, { code: 0 });
launch({ ...basePayload, scriptId: "script-two", automationRunId: "multi-script-batch" }, { code: 3 });
assert.equal(bridge.getAutomationProcessResult("project-1", "script-one", "multi-script-batch").code, 0);
assert.equal(bridge.getAutomationProcessResult("project-1", "script-two", "multi-script-batch").code, 3);
assert.equal(
  bridge.getAutomationProcessResult("project-1", "script-one", "missing-batch"),
  null,
  "orphan recovery must receive no result when the exact batch is absent",
);

launch({ ...basePayload, automationRunId: "error-batch" }, { error: "spawn failed" });
assert.equal(
  bridge.getAutomationProcessResult("project-1", "shared-script", "error-batch").error,
  "spawn failed",
  "explicit process errors must remain failures",
);
assert.equal(bridge.getProcessStatus(batchASuccess.pid).code, 0, "PID result lookup should remain available");

const matchedStop = await launchAndStop(
  { ...basePayload, scriptId: "matched-recovery-script", automationRunId: "matched-stop-batch" },
  { automationRunId: "matched-stop-batch", automationExitMatched: true },
  { code: 4294967295 },
);
const matchedStopResult = bridge.getAutomationProcessResult(
  "project-1",
  "matched-recovery-script",
  "matched-stop-batch",
);
assert.equal(
  matchedStopResult.automationExitMatched,
  true,
  "an identity-matched output exit stop must persist its success marker",
);
const matchedStopExitEvent = dispatchedEvents.find((event) => event.type === "exit" && event.pid === matchedStop.pid);
assert.equal(
  matchedStopExitEvent.automationRunId,
  "matched-stop-batch",
  "exit events must retain automation run identity",
);
assert.equal(
  matchedStopExitEvent.automationExitMatched,
  true,
  "exit events must retain output-match success semantics",
);

nextPid = matchedStop.pid;
launch(
  { ...basePayload, scriptId: "reused-after-close", automationRunId: "reused-after-close-batch" },
  { code: 4294967295 },
);
assert.notEqual(
  bridge.getAutomationProcessResult("project-1", "reused-after-close", "reused-after-close-batch")
    .automationExitMatched,
  true,
  "close cleanup must not leak an output-match marker when a PID is reused",
);

const markedError = await launchAndStop(
  { ...basePayload, scriptId: "marked-error-script", automationRunId: "marked-error-batch" },
  { automationRunId: "marked-error-batch", automationExitMatched: true },
  { error: "failure after matched stop" },
);
const markedErrorResult = bridge.getAutomationProcessResult("project-1", "marked-error-script", "marked-error-batch");
assert.equal(markedErrorResult.automationExitMatched, true);
assert.equal(markedErrorResult.error, "failure after matched stop");
nextPid = markedError.pid;
launch(
  { ...basePayload, scriptId: "reused-after-error", automationRunId: "reused-after-error-batch" },
  { code: 4294967295 },
);
assert.notEqual(
  bridge.getAutomationProcessResult("project-1", "reused-after-error", "reused-after-error-batch")
    .automationExitMatched,
  true,
  "error cleanup must not leak an output-match marker when a PID is reused",
);

await launchAndStop(
  { ...basePayload, automationRunId: "wrong-stop-batch" },
  { automationRunId: "different-batch", automationExitMatched: true },
  { code: 4294967295 },
);
assert.notEqual(
  bridge.getAutomationProcessResult("project-1", "shared-script", "wrong-stop-batch").automationExitMatched,
  true,
  "a mismatched automation run id must not mark the process as an output-match success",
);

const manualStop = await launchAndStop(basePayload, undefined, { code: 4294967295 });
assert.notEqual(
  bridge.getProcessStatus(manualStop.pid).automationExitMatched,
  true,
  "a manual stop must not gain output-match success semantics",
);

await launchAndStop(
  { ...basePayload, automationRunId: "timeout-stop-batch" },
  { automationRunId: "timeout-stop-batch" },
  { code: 4294967295 },
);
assert.notEqual(
  bridge.getAutomationProcessResult("project-1", "shared-script", "timeout-stop-batch").automationExitMatched,
  true,
  "an automation stop without the explicit output-match flag must remain failed",
);

const stopAllRun = bridge.runCommand({ ...basePayload, automationRunId: "stop-all-batch" });
const stopAllChild = spawnedChildren.at(-1);
bridge.stopAllProcesses();
const stopAllKiller = spawnedChildren.at(-1);
if (stopAllKiller !== stopAllChild) {
  stopAllKiller.emit("close", 0, null);
}
stopAllChild.emit("close", 4294967295, null);
assert.notEqual(
  bridge.getAutomationProcessResult("project-1", "shared-script", "stop-all-batch").automationExitMatched,
  true,
  "stopAllProcesses must not create output-match success semantics",
);
assert.equal(bridge.getProcessStatus(stopAllRun.pid).stoppedByUser, true);

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createStoredProject(entries, scriptIds = ["shared-script"]) {
  const now = new Date().toISOString();
  return {
    id: "project-1",
    name: "Validation project",
    path: repoRoot,
    type: "Custom",
    kind: "custom",
    status: "STOPPED",
    scripts: scriptIds.map((scriptId) => ({
      id: scriptId,
      name: scriptId,
      command: "mock command",
      cwd: ".",
      status: "IDLE",
      source: "manual",
    })),
    automationTasks: [
      {
        id: "task-1",
        name: "Validation task",
        enabled: true,
        scriptIds,
        schedule: { type: "fixed", startTime: "00:00", dailyCount: 1, intervalMinutes: 60 },
        missedPolicy: "run-now",
        missedGraceMinutes: 5,
        notifyEnabled: false,
        maxScriptRuntimeMinutes: 30,
        inputConfigs: [],
        exitConfigs: [],
        dailyPlans: [{ date: localDateKey(), entries }],
        history: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    env: {},
  };
}

const runtimeSource = [
  path.join(repoRoot, "public", "preload.js"),
  ...fs
    .readdirSync(path.join(repoRoot, "src"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|vue)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name)),
]
  .map((filePath) => fs.readFileSync(filePath, "utf8"))
  .join("\n");
assert.doesNotMatch(
  runtimeSource,
  /getRecentProcessResult|completedProcessResultsByScript|processScriptKey/,
  "runtime sources must not retain script-only completed-result paths",
);

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const automationQueries = [];
const runPayloads = [];
const stopRequests = [];
const timerCallbacks = new Map();
let storedProjects = [];
let automationResultHandler = async () => null;
let nextStorePid = 8100;
let nextTimerId = 1;

globalThis.window = {
  projectBridge: {
    loadDeviceId: () => "validation-device",
    loadProjects: async () => structuredClone(storedProjects),
    saveProjects: async () => undefined,
    loadTerminalPreferences: () => ({ kind: "builtin", customCommand: "" }),
    loadEditorPreferences: () => ({ kind: "vscode", customCommand: "" }),
    loadEnvironmentPreferences: () => ({}),
    loadAiPreferences: () => ({}),
    pathExists: async () => true,
    getProcessStatus: async () => ({ active: true }),
    getAutomationProcessResult: async (projectId, scriptId, automationRunId) => {
      automationQueries.push({ projectId, scriptId, automationRunId });
      return automationResultHandler(projectId, scriptId, automationRunId);
    },
    runCommand: async (payload) => {
      runPayloads.push(payload);
      const pid = nextStorePid;
      nextStorePid += 1;
      return { pid, startedAt: new Date().toISOString(), command: payload.command, cwd: payload.cwd };
    },
    stopProcess: async (pid, options) => {
      stopRequests.push({ pid, options });
    },
    sendProcessInput: async () => ({ sent: true }),
  },
  localStorage: sandbox.window.localStorage,
  setTimeout: (callback) => {
    const timerId = nextTimerId;
    nextTimerId += 1;
    timerCallbacks.set(timerId, callback);
    return timerId;
  },
  clearTimeout(timerId) {
    timerCallbacks.delete(timerId);
  },
  utools: { showNotification() {} },
};
globalThis.document = { visibilityState: "visible" };

const vite = await createServer({
  root: repoRoot,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
try {
  const { useStore } = await vite.ssrLoadModule("/src/store/useStore.ts");
  setActivePinia(createPinia());
  const store = useStore();

  const oldPlannedAt = new Date(Date.now() - 120_000).toISOString();
  const duePlannedAt = new Date(Date.now() - 60_000).toISOString();
  const loadRecoveryResult = createDeferred();
  storedProjects = [
    createStoredProject([
      { id: "old-entry", plannedAt: oldPlannedAt, status: "running", runId: "old-run" },
      { id: "due-entry", plannedAt: duePlannedAt, status: "pending" },
    ]),
  ];
  automationResultHandler = async (_projectId, _scriptId, automationRunId) => {
    assert.equal(automationRunId, "old-run", "load recovery must query the persisted run id");
    return loadRecoveryResult.promise;
  };

  const loadPromise = store.loadProjects();
  await waitFor(() => automationQueries.length === 1, "loadProjects should begin old-run recovery");
  assert.equal(runPayloads.length, 0, "due plans must not launch before old-run recovery finishes");
  loadRecoveryResult.resolve(null);
  await loadPromise;
  await waitFor(() => runPayloads.length === 1, "run-now due policy should launch after recovery finishes");

  const loadedTask = store.projects[0].automationTasks[0];
  const oldEntry = loadedTask.dailyPlans[0].entries.find((entry) => entry.id === "old-entry");
  const dueEntry = loadedTask.dailyPlans[0].entries.find((entry) => entry.id === "due-entry");
  assert.equal(oldEntry.status, "skipped", "an old orphan without an exact result must only be skipped");
  assert.equal(
    loadedTask.history.filter((entry) => entry.id === "old-run").length,
    1,
    "old orphan recovery must create exactly one history row",
  );
  assert.equal(dueEntry.status, "running", "run-now missed policy should remain schedulable after recovery");
  assert.ok(runPayloads[0].automationRunId, "scheduled launches must carry a new automation run id");
  assert.notEqual(runPayloads[0].automationRunId, "old-run", "new due runs must not reuse the recovered run id");

  const matchedRecoveryEntry = {
    id: "matched-recovery-entry",
    plannedAt: new Date(Date.now() - 30_000).toISOString(),
    status: "running",
    runId: "matched-stop-batch",
  };
  setActivePinia(createPinia());
  const matchedRecoveryStore = useStore();
  matchedRecoveryStore.projects = [createStoredProject([matchedRecoveryEntry], ["matched-recovery-script"])];
  automationResultHandler = async () => matchedStopResult;
  await matchedRecoveryStore.reconcileRuntimeProcessState();
  const matchedRecoveryTask = matchedRecoveryStore.projects[0].automationTasks[0];
  assert.equal(
    matchedRecoveryTask.dailyPlans[0].entries[0].status,
    "completed",
    "a cached output-match stop must recover the automation plan as completed",
  );
  assert.equal(matchedRecoveryTask.history[0].scriptResults[0].status, "completed");

  const mismatchedRecoveryEntry = {
    id: "mismatched-recovery-entry",
    plannedAt: new Date(Date.now() - 30_000).toISOString(),
    status: "running",
    runId: "expected-recovery-batch",
  };
  setActivePinia(createPinia());
  const mismatchedRecoveryStore = useStore();
  mismatchedRecoveryStore.projects = [createStoredProject([mismatchedRecoveryEntry], ["mismatched-script"])];
  automationResultHandler = async () => ({
    active: false,
    code: 0,
    endedAt: new Date().toISOString(),
    automationRunId: "different-recovery-batch",
  });
  await mismatchedRecoveryStore.reconcileRuntimeProcessState();
  assert.equal(
    mismatchedRecoveryStore.projects[0].automationTasks[0].dailyPlans[0].entries[0].status,
    "skipped",
    "a bridge result carrying a different automation run id must not settle the orphan",
  );

  const markedErrorRecoveryEntry = {
    id: "marked-error-recovery-entry",
    plannedAt: new Date(Date.now() - 30_000).toISOString(),
    status: "running",
    runId: "marked-error-batch",
  };
  setActivePinia(createPinia());
  const markedErrorRecoveryStore = useStore();
  markedErrorRecoveryStore.projects = [createStoredProject([markedErrorRecoveryEntry], ["marked-error-script"])];
  automationResultHandler = async () => markedErrorResult;
  await markedErrorRecoveryStore.reconcileRuntimeProcessState();
  const markedErrorRecoveryTask = markedErrorRecoveryStore.projects[0].automationTasks[0];
  assert.equal(markedErrorRecoveryTask.dailyPlans[0].entries[0].status, "failed");
  assert.equal(
    markedErrorRecoveryTask.history[0].reason,
    "failure after matched stop",
    "an explicit process error must override the output-match success marker",
  );

  setActivePinia(createPinia());
  const outputMatchStore = useStore();
  outputMatchStore.projects = [createStoredProject([], ["output-match-script"])];
  const stopCountBeforeOutputMatch = stopRequests.length;
  const outputMatchRun = outputMatchStore.runAutomationScript(
    "project-1",
    "output-match-script",
    "current-output-run",
    [],
    { matchText: "automation finished" },
    30,
  );
  let outputMatchSettled = false;
  void outputMatchRun.then(() => {
    outputMatchSettled = true;
  });
  await waitFor(
    () => runPayloads.some((payload) => payload.automationRunId === "current-output-run"),
    "the output-match validation run should launch",
  );
  const outputMatchScript = outputMatchStore.projects[0].scripts[0];
  outputMatchStore.handleBridgeEvent({
    type: "exit",
    projectId: "project-1",
    scriptId: "output-match-script",
    pid: outputMatchScript.pid + 1,
    automationRunId: "stale-output-run",
    code: 1,
    stoppedByUser: false,
  });
  await Promise.resolve();
  assert.equal(outputMatchSettled, false, "a stale exit event must not settle the current automation context");
  assert.equal(
    outputMatchScript.status,
    "RUNNING",
    "a stale exit event must not change the current script runtime state",
  );
  outputMatchStore.handleBridgeEvent({
    type: "stdout",
    projectId: "project-1",
    scriptId: "output-match-script",
    pid: outputMatchScript.pid,
    automationRunId: "stale-output-run",
    message: "automation finished",
  });
  assert.equal(
    stopRequests.length,
    stopCountBeforeOutputMatch,
    "an event from a stale automation run must not trigger the current run's output exit",
  );
  outputMatchStore.handleBridgeEvent({
    type: "stdout",
    projectId: "project-1",
    scriptId: "output-match-script",
    pid: outputMatchScript.pid,
    message: "automation finished",
  });
  assert.equal(
    stopRequests.length,
    stopCountBeforeOutputMatch,
    "an event without automation run identity must not settle the current run",
  );

  outputMatchStore.handleBridgeEvent({
    type: "stdout",
    projectId: "project-1",
    scriptId: "output-match-script",
    pid: outputMatchScript.pid,
    automationRunId: "current-output-run",
    message: "automation finished",
  });
  assert.equal(
    stopRequests.length,
    stopCountBeforeOutputMatch + 1,
    "the output-match stop must reach preload before the process can close",
  );
  assert.deepEqual(
    stopRequests.at(-1).options,
    { automationRunId: "current-output-run", automationExitMatched: true },
    "only the output-match path should send structured automation success stop options",
  );
  outputMatchStore.handleBridgeEvent({
    type: "exit",
    projectId: "project-1",
    scriptId: "output-match-script",
    pid: outputMatchScript.pid,
    automationRunId: "current-output-run",
    automationExitMatched: true,
    code: 4294967295,
    stoppedByUser: true,
  });
  assert.equal((await outputMatchRun).status, "completed");

  setActivePinia(createPinia());
  const completedInputStore = useStore();
  completedInputStore.projects = [createStoredProject([], ["completed-input-script"])];
  const stopCountBeforeCompletedInput = stopRequests.length;
  const completedInputRun = completedInputStore.runAutomationScript(
    "project-1",
    "completed-input-script",
    "completed-input-run",
    [{ mode: "output-match", matchText: "input ready", value: "continue", timeoutMs: 5_000 }],
    { matchText: "input ready" },
    30,
  );
  await waitFor(
    () => runPayloads.some((payload) => payload.automationRunId === "completed-input-run"),
    "the completed-input validation run should launch",
  );
  const completedInputScript = completedInputStore.projects[0].scripts[0];
  completedInputStore.handleBridgeEvent({
    type: "stdout",
    projectId: "project-1",
    scriptId: "completed-input-script",
    pid: completedInputScript.pid,
    automationRunId: "completed-input-run",
    message: "input ready",
  });
  await waitFor(
    () => stopRequests.length > stopCountBeforeCompletedInput,
    "finishing the last input step should request an immediate output-match stop",
  );
  assert.deepEqual(stopRequests.at(-1).options, {
    automationRunId: "completed-input-run",
    automationExitMatched: true,
  });
  completedInputStore.handleBridgeEvent({
    type: "exit",
    projectId: "project-1",
    scriptId: "completed-input-script",
    pid: completedInputScript.pid,
    automationRunId: "completed-input-run",
    automationExitMatched: true,
    code: 4294967295,
    stoppedByUser: true,
  });
  assert.equal((await completedInputRun).status, "completed");

  setActivePinia(createPinia());
  const multiScriptStore = useStore();
  const multiScriptEntry = {
    id: "multi-script-entry",
    plannedAt: new Date().toISOString(),
    status: "pending",
  };
  const multiScriptProject = createStoredProject([multiScriptEntry], ["first-output-script", "second-script"]);
  multiScriptProject.automationTasks[0].exitConfigs = [
    { scriptId: "first-output-script", enabled: true, matchText: "first complete" },
  ];
  multiScriptStore.projects = [multiScriptProject];
  const payloadCountBeforeMultiScript = runPayloads.length;
  const stopCountBeforeMultiScript = stopRequests.length;
  const multiScriptRun = multiScriptStore.runAutomationTask("project-1", "task-1", "multi-script-entry");
  await waitFor(
    () => runPayloads.length === payloadCountBeforeMultiScript + 1,
    "the first script in a multi-script task should launch",
  );
  const firstMultiScriptPayload = runPayloads.at(-1);
  const firstMultiScript = multiScriptStore.projects[0].scripts[0];
  multiScriptStore.handleBridgeEvent({
    type: "stdout",
    projectId: "project-1",
    scriptId: "first-output-script",
    pid: firstMultiScript.pid,
    automationRunId: firstMultiScriptPayload.automationRunId,
    message: "first complete",
  });
  assert.equal(
    stopRequests.length,
    stopCountBeforeMultiScript + 1,
    "the first script output match should immediately request a marked stop",
  );
  multiScriptStore.handleBridgeEvent({
    type: "exit",
    projectId: "project-1",
    scriptId: "first-output-script",
    pid: firstMultiScript.pid,
    automationRunId: firstMultiScriptPayload.automationRunId,
    automationExitMatched: true,
    code: 4294967295,
    stoppedByUser: true,
  });
  await waitFor(
    () => runPayloads.length === payloadCountBeforeMultiScript + 2,
    "an output-match completion must allow the next script to launch",
  );
  const secondMultiScriptPayload = runPayloads.at(-1);
  assert.equal(
    secondMultiScriptPayload.automationRunId,
    firstMultiScriptPayload.automationRunId,
    "all scripts in one task must share the outer automation run id",
  );
  const secondMultiScript = multiScriptStore.projects[0].scripts[1];
  multiScriptStore.handleBridgeEvent({
    type: "exit",
    projectId: "project-1",
    scriptId: "second-script",
    pid: secondMultiScript.pid,
    automationRunId: secondMultiScriptPayload.automationRunId,
    code: 0,
    stoppedByUser: false,
  });
  await multiScriptRun;
  const completedMultiScriptTask = multiScriptStore.projects[0].automationTasks[0];
  assert.equal(completedMultiScriptTask.dailyPlans[0].entries[0].status, "completed");
  assert.deepEqual(
    completedMultiScriptTask.history[0].scriptResults.map((result) => result.status),
    ["completed", "completed"],
    "the task history must retain both completed script results",
  );

  setActivePinia(createPinia());
  const timeoutStore = useStore();
  timeoutStore.projects = [createStoredProject([], ["timeout-script"])];
  const stopCountBeforeTimeout = stopRequests.length;
  const timersBeforeTimeoutRun = new Set(timerCallbacks.keys());
  const timeoutRun = timeoutStore.runAutomationScript("project-1", "timeout-script", "timeout-run", [], undefined, 1);
  await waitFor(
    () => runPayloads.some((payload) => payload.automationRunId === "timeout-run"),
    "the timeout validation run should launch",
  );
  const runtimeTimer = [...timerCallbacks.entries()].find(([timerId]) => !timersBeforeTimeoutRun.has(timerId));
  assert.ok(runtimeTimer, "the automation runtime timeout should be scheduled");
  runtimeTimer[1]();
  const timeoutStopTimer = [...timerCallbacks.entries()].find(
    ([timerId]) => timerId !== runtimeTimer[0] && !timersBeforeTimeoutRun.has(timerId),
  );
  assert.ok(timeoutStopTimer, "the runtime timeout should schedule a process stop");
  timeoutStopTimer[1]();
  await waitFor(() => stopRequests.length > stopCountBeforeTimeout, "the runtime timeout should request a stop");
  assert.equal(stopRequests.at(-1).options, undefined, "runtime timeout stops must not carry output-match options");
  assert.equal((await timeoutRun).status, "timeout");

  const concurrentResult = createDeferred();
  const concurrentEntry = {
    id: "concurrent-entry",
    plannedAt: new Date(Date.now() - 30_000).toISOString(),
    status: "running",
    runId: "concurrent-run",
  };
  setActivePinia(createPinia());
  const concurrentStore = useStore();
  concurrentStore.projects = [createStoredProject([concurrentEntry], ["concurrent-script"])];
  automationQueries.length = 0;
  automationResultHandler = async () => concurrentResult.promise;
  const firstReconciliation = concurrentStore.reconcileRuntimeProcessState();
  const secondReconciliation = concurrentStore.reconcileRuntimeProcessState();
  await waitFor(() => automationQueries.length === 1, "concurrent recovery should issue one exact-result query");
  concurrentResult.resolve({
    active: false,
    code: 4294967295,
    endedAt: new Date().toISOString(),
    automationRunId: "concurrent-run",
  });
  await Promise.all([firstReconciliation, secondReconciliation]);
  const reconciledTask = concurrentStore.projects[0].automationTasks[0];
  assert.equal(reconciledTask.dailyPlans[0].entries[0].status, "failed");
  assert.equal(reconciledTask.history.length, 1, "shared recovery must not duplicate history");
  assert.equal(reconciledTask.history[0].scriptResults[0].status, "failed");
  assert.match(reconciledTask.history[0].reason, /4294967295/, "Windows exit -1 must remain failed in recovery");

  const originalReconcileOrphans = concurrentStore.reconcileOrphanedAutomationRuns;
  concurrentStore.reconcileOrphanedAutomationRuns = async () => {
    throw new Error("validation reconciliation failure");
  };
  await assert.rejects(concurrentStore.reconcileRuntimeProcessState(), /validation reconciliation failure/);
  let retryCount = 0;
  concurrentStore.reconcileOrphanedAutomationRuns = async () => {
    retryCount += 1;
    return false;
  };
  await concurrentStore.reconcileRuntimeProcessState();
  assert.equal(retryCount, 1, "a failed shared reconciliation must clear so the next request can retry");
  concurrentStore.reconcileOrphanedAutomationRuns = originalReconcileOrphans;
} finally {
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
}

console.log("process result batch validation passed");
