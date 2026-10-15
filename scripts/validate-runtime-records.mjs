import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { runInNewContext } from "node:vm";

function waitForJson(filePath, accept) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return new Promise((resolve, reject) => {
    let watcher;
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${path.basename(filePath)}`)), 15000);
    const finish = (error, value) => {
      clearTimeout(timer);
      watcher?.close();
      if (error) reject(error); else resolve(value);
    };
    const check = () => {
      try {
        const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (accept(value)) finish(null, value);
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) finish(error);
      }
    };
    watcher = fs.watch(path.dirname(filePath), check);
    check();
  });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-contract-"));
const serviceDir = path.join(root, "service");
const runtimeDir = path.join(root, "runtime");
const binary = path.join(root, process.platform === "win32" ? "service.exe" : "service");
let child;
try {
  const build = spawnSync("go", ["-C", "service", "build", "-o", binary, "./cmd/project-launch-service"], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  fs.mkdirSync(serviceDir, { recursive: true });
  const discoveryReady = waitForJson(path.join(serviceDir, "discovery.json"), (value) => value.protocolVersion === 3);
  child = spawn(binary, ["--state-dir", serviceDir], { stdio: "ignore", windowsHide: true });
  const discovery = await discoveryReady;
  const token = fs.readFileSync(discovery.tokenPath, "utf8").trim();
  const request = async (endpoint, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${discovery.port}${endpoint}`, {
      method, headers: { Authorization: `Bearer ${token}`, "X-Protocol-Version": "3", "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
    assert.ok(response.ok, `HTTP ${response.status} at ${endpoint}`);
    return response.json();
  };
  const started = await request("/v1/runs", "POST", {
    projectId: "contract-project", scriptId: "go-script", command: "echo common-go-output", cwd: root, env: {}, label: "Go script",
  });
  await waitForJson(path.join(runtimeDir, "logs", `${started.run.id}.json`), (value) => value.status === "exited");
  const exit = once(child, "exit");
  await request("/v1/shutdown", "POST", {});
  const [exitCode] = await exit;
  assert.equal(exitCode, 0);
  child = null;

  const api = runInNewContext(fs.readFileSync("public/preload/runtime-records.js", "utf8") + `
    ({ listRuntimeRecords, readRuntimeRecordLogPage, beginRuntimeRecord, appendRuntimeRecordEvent,
       updateRuntimeRecordRetention, clearRuntimeRecords })`, {
    fs, path, crypto, process, Buffer, console, setTimeout, clearTimeout,
    pluginLocalDataDirectory: () => root,
    writeJsonFileAtomic: (file, value) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(value));
      fs.renameSync(file + ".tmp", file);
    },
    localStateWriteError: (error) => ({ ok: false, error: error.message }),
  });
  const goRecords = await api.listRuntimeRecords("contract-project");
  assert.equal(goRecords[0].source, "service");
  const output = await api.readRuntimeRecordLogPage(started.run.id);
  assert.ok(output.events.some((event) => event.message?.includes("common-go-output")));
  assert.ok(output.events.some((event) => event.type === "exit" && event.code === 0));
  const direct = api.beginRuntimeRecord({ projectId: "contract-project", scriptId: "preload-script", label: "Direct script" });
  api.appendRuntimeRecordEvent({ runId: direct, type: "stdout", message: "common-preload-output" });
  api.appendRuntimeRecordEvent({ runId: direct, type: "exit", code: 0 });
  assert.equal((await api.listRuntimeRecords("contract-project")).length, 2);
  assert.ok((await api.readRuntimeRecordLogPage(direct)).events.some((event) => event.message === "common-preload-output"));
  await api.updateRuntimeRecordRetention({ persist: true, maxCompletedRunsPerProject: 1, maxBytesPerRun: 1024 * 1024, maxBytesTotal: 10 * 1024 * 1024 });
  assert.equal((await api.listRuntimeRecords("contract-project")).length, 1);
  await api.clearRuntimeRecords();
  assert.equal((await api.listRuntimeRecords("contract-project")).length, 0);
  console.log("Common runtime contract verified: Go output, offline preload reads, direct output, shared retention, and clearing.");
} finally {
  if (child) {
    const exit = once(child, "exit");
    child.kill();
    await exit;
  }
  fs.rmSync(root, { recursive: true, force: true });
}