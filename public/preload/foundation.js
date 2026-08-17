const startupTimingEnabled =
  process.env?.UTOOLS_PROJECT_LAUNCH_STARTUP_TIMING === "1" && typeof process.hrtime === "function";
const startupTimingStartedAt = startupTimingEnabled ? process.hrtime() : null;
const startupTimingStartedAtEpochMs = startupTimingEnabled ? Date.now() : null;

function recordStartupTiming(phase) {
  if (!startupTimingEnabled || !startupTimingStartedAt) return;

  const [seconds, nanoseconds] = process.hrtime(startupTimingStartedAt);
  console.info(
    "[utools-project-launch:startup]",
    JSON.stringify({
      phase,
      epochMs: Date.now(),
      preloadElapsedMs: Math.round((seconds * 1000 + nanoseconds / 1000000) * 100) / 100,
    }),
  );
}

if (startupTimingEnabled) {
  window.__utoolsProjectLaunchStartupTiming = { preloadStartedAtEpochMs: startupTimingStartedAtEpochMs };
  recordStartupTiming("preload-evaluation-start");
}

// uTools loads this file with CommonJS require(). public/package.json is copied
// to dist/ to keep this `.js` preload in a local CommonJS package scope.
// Use legacy Node builtin names: older uTools Electron versions do not resolve
// the newer `node:` specifier and would skip the entire preload bridge.
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawn, spawnSync, execFile, execFileSync } = require("child_process");
const { TextDecoder } = require("util");
const unavailableElectronShell = {
  openExternal: async () => {
    throw new Error("Electron shell API is unavailable.");
  },
  openPath: async () => "Electron shell API is unavailable.",
  showItemInFolder() {},
};
let shell = unavailableElectronShell;
try {
  shell = require("electron")?.shell || unavailableElectronShell;
} catch (error) {
  console.warn("[utools-project-launch] Electron shell API is unavailable; continuing with the project bridge.");
}

const activeProcesses = new Map();
const activeProcessMetadata = new Map();
const processStopEscalationTimers = new Map();
const completedProcessResults = new Map();
const completedAutomationProcessResults = new Map();
const completedProcessResultLimit = 100;
const processStopGracePeriodMs = 3500;
const projectLaunchServiceProtocolVersion = 2;
const projectLaunchServiceStartupTimeoutMs = 7000;
const projectLaunchServiceRequestTimeoutMs = 3000;
const projectLaunchServiceEventPollIntervalMs = 750;
const projectLaunchServiceDownloadTimeoutMs = 30000;
const projectLaunchServiceMetadataLimitBytes = 1024 * 1024;
const projectLaunchServiceExecutableLimitBytes = 12 * 1024 * 1024;
const projectLaunchServiceRunLogResponseLimitBytes = 8 * 1024 * 1024;
const projectLaunchServiceDownloadRedirectLimit = 3;
const projectLaunchServiceReleaseApiUrl = "https://api.github.com/repos/Wwyxa/utools-project-launch/releases/latest";
const projectLaunchServiceAllowedDownloadHosts = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
let projectLaunchServiceProcess = null;
let projectLaunchServiceEventCursor = 0;
let projectLaunchServiceEventPollTimer = null;
let projectLaunchServiceEventPollInFlight = false;
let projectLaunchServiceLastBroadcastSignature = "";
const gitCommitAvatarResults = new Map();
const gitCommitAvatarResultLimit = 160;
const gitCommitAvatarRequestTimeoutMs = 3500;
const gitWorkspaceWorkerLimit = 4;
const gitWorkspaceEntryTimeoutMs = 30000;
const gitWorkspaceStderrLimit = 16 * 1024;
const gitEnvironmentBootstrapTimeoutMs = 2500;
const gitEnvironmentMarker = "__UTOOLS_PROJECT_LAUNCH_GIT_ENV_BEGIN__";
const launchedProcessIds = new Set();
const userStoppedProcesses = new Set();
const automationExitMatchedProcesses = new Set();
const storageKey = "utools-project-launch.projects.v1";
const terminalPreferencesStorageKey = "utools-project-launch.settings.v1";
const localTerminalPreferencesStorageKey = "utools-project-launch.local-settings.v1";
const editorPreferencesStorageKey = "utools-project-launch.editor-settings.v1";
const localEditorPreferencesStorageKey = "utools-project-launch.local-editor-settings.v1";
const externalApplicationPreferencesStorageKey = "utools-project-launch.local-external-applications.v1";
const environmentPreferencesStorageKey = "utools-project-launch.environment-settings.v1";
const aiPreferencesStorageKey = "utools-project-launch.ai-settings.v1";
const uiPreferencesStorageKey = "utools-project-launch.ui-preferences.v1";
const projectDetailsTabOrderStorageKey = "utools-project-launch.project-details-tab-order.v1";
const projectLaunchServicePreferencesStorageKey = "utools-project-launch.project-launch-service.v1";
const deviceIdStorageKey = "utools-project-launch.device-id.v1";
const deviceIdFileName = "device-id.v1";
const projectDocPrefix = "utools-project-launch/project/";
const schemaVersion = 1;
const gitCommitFieldSeparator = "\x1f";
const gitCommitRecordSeparator = "\x1e";
const gitCommitShortStatSeparator = "\x1d";
const commonProjectDirs = [".", "frontend", "backend", "client", "server", "api", "src"];
const terminalKinds = new Set([
  "builtin",
  "terminal-app",
  "iterm2",
  "warp",
  "linux-terminal",
  "windows-terminal",
  "powershell",
  "cmd",
  "custom",
]);
const editorKinds = new Set(["vscode", "cursor", "custom"]);
const aiProviderKinds = new Set(["utools", "openai-compatible", "anthropic-compatible"]);
const aiPromptModeKinds = new Set(["git-analysis", "commit-message"]);
const aiCommitMessageModeId = "commit-message";

function automationProcessKey(projectId, scriptId, automationRunId) {
  return `${projectId || ""}::${scriptId || ""}::${automationRunId || ""}`;
}
const legacyDefaultAiCommitMessagePrompt = `请根据以下 {diffScope} 生成一个简洁、可直接使用的 Git commit message。

要求：
- 只输出最终 commit message，不要解释推理过程。
- 输出 1 行标题，优先使用 conventional commit 风格，例如 feat:, fix:, chore:, docs:, refactor:。
- 如确实需要，可在标题后追加 2-4 条简短正文要点。
- 不要使用 Markdown 代码块。
{truncatedNote}

{diffScope}:
{diffContent}`;
const defaultAiCommitMessagePrompt = `请根据当前 Git diff 生成一个简洁、可直接使用的 Git commit message。

要求：
- 只输出最终 commit message，不要解释推理过程。
- 输出 1 行标题，优先使用 conventional commit 风格，例如 feat:, fix:, chore:, docs:, refactor:。
- 如确实需要，可在标题后追加 2-4 条简短正文要点。
- 不要使用 Markdown 代码块。`;
const defaultAiPromptModes = [
  {
    id: "summary",
    name: "总结",
    prompt: "请总结这些 Git 信息中的主要工作内容、功能变化和代码变更方向。",
    builtIn: true,
    kind: "git-analysis",
  },
  {
    id: "analysis",
    name: "分析",
    prompt: "请分析这些 Git 信息体现出的实现思路、代码变更逻辑和潜在影响。",
    builtIn: true,
    kind: "git-analysis",
  },
  {
    id: "evaluation",
    name: "评估",
    prompt: "请评估这些 Git 信息的质量、风险点、可维护性和后续需要注意的地方。",
    builtIn: true,
    kind: "git-analysis",
  },
  {
    id: aiCommitMessageModeId,
    name: "提交信息",
    prompt: defaultAiCommitMessagePrompt,
    builtIn: true,
    kind: "commit-message",
  },
];
const environmentTools = {
  node: {
    name: "Node.js",
    command: "node",
    versionArgs: ["--version"],
    pathArgs: process.platform === "win32" ? ["where", "node"] : ["which", "node"],
  },
  npm: {
    name: "npm",
    command: "npm",
    versionArgs: ["--version"],
    pathArgs: process.platform === "win32" ? ["where", "npm"] : ["which", "npm"],
  },
  pnpm: {
    name: "pnpm",
    command: "pnpm",
    versionArgs: ["--version"],
    pathArgs: process.platform === "win32" ? ["where", "pnpm"] : ["which", "pnpm"],
  },
  yarn: {
    name: "Yarn",
    command: "yarn",
    versionArgs: ["--version"],
    pathArgs: process.platform === "win32" ? ["where", "yarn"] : ["which", "yarn"],
  },
  python: {
    name: "Python",
    command: process.platform === "win32" ? "python" : "python3",
    versionArgs: ["--version"],
    pathArgs: process.platform === "win32" ? ["where", "python"] : ["which", "python3"],
  },
  pip: {
    name: "pip",
    command: process.platform === "win32" ? "pip" : "pip3",
    versionArgs: ["--version"],
    pathArgs: process.platform === "win32" ? ["where", "pip"] : ["which", "pip3"],
  },
  go: {
    name: "Go",
    command: "go",
    versionArgs: ["version"],
    pathArgs: process.platform === "win32" ? ["where", "go"] : ["which", "go"],
  },
  git: {
    name: "Git",
    command: "git",
    versionArgs: ["--version"],
    pathArgs: process.platform === "win32" ? ["where", "git"] : ["which", "git"],
  },
  docker: {
    name: "Docker",
    command: "docker",
    versionArgs: ["--version"],
    pathArgs: process.platform === "win32" ? ["where", "docker"] : ["which", "docker"],
  },
};
const ignoredFileTreeDirs = new Set([
  "node_modules",
  "__pycache__",
  ".git",
  ".venv",
  "venv",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  "coverage",
  "target",
  "vendor",
]);
const textFileExtensions = new Set([
  ".txt",
  ".md",
  ".json",
  ".js",
  ".ts",
  ".vue",
  ".css",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".env",
  ".sh",
  ".ps1",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".sql",
]);
const textFileNamePatterns = [/^\.env(?:\..+)?$/i, /^dockerfile$/i, /^makefile$/i, /^procfile$/i];
const imageFileExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);

let gitExecutionEnvironment = null;

function createLegacyWindowsDecoder() {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    return new TextDecoder("gb18030");
  } catch (error) {
    return null;
  }
}

function createProcessOutputDecoder() {
  const utf8Decoder = new TextDecoder("utf-8");
  const legacyWindowsDecoder = createLegacyWindowsDecoder();

  return (chunk) => {
    const utf8Text = utf8Decoder.decode(chunk, { stream: true });
    if (!legacyWindowsDecoder || !utf8Text.includes("�")) {
      return utf8Text;
    }

    return legacyWindowsDecoder.decode(chunk, { stream: true });
  };
}

function commandOutputText(output) {
  if (Buffer.isBuffer(output)) {
    const decode = createProcessOutputDecoder();
    return decode(output) + decode();
  }
  return String(output || "");
}

function environmentValue(environment, name) {
  const normalizedName = String(name || "").toLocaleLowerCase();
  const key = Object.keys(environment || {}).find((candidate) => candidate.toLocaleLowerCase() === normalizedName);
  return key ? String(environment[key] || "") : "";
}

function setEnvironmentValue(environment, name, value) {
  const normalizedName = String(name || "").toLocaleLowerCase();
  Object.keys(environment).forEach((candidate) => {
    if (candidate.toLocaleLowerCase() === normalizedName && candidate !== name) {
      delete environment[candidate];
    }
  });
  environment[name] = String(value || "");
}

function mergePathEntries(values, delimiter, caseInsensitive = false) {
  const entries = [];
  const seen = new Set();
  values.forEach((value) => {
    String(value || "")
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const key = caseInsensitive ? entry.toLocaleLowerCase() : entry;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push(entry);
      });
  });
  return entries.join(delimiter);
}

function parseNullDelimitedEnvironment(output) {
  const values = {};
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(String(output || ""));
  const entries = buffer.toString("utf8").split("\0");
  const markerIndex = entries.lastIndexOf(gitEnvironmentMarker);
  if (markerIndex < 0) return values;
  entries.slice(markerIndex + 1).forEach((entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0) return;
    const name = entry.slice(0, separator);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    values[name] = entry.slice(separator + 1);
  });
  return values;
}

function expandWindowsEnvironmentVariables(value, environment) {
  let expanded = String(value || "");
  for (let index = 0; index < 4; index += 1) {
    const next = expanded.replace(/%([^%]+)%/g, (match, name) => environmentValue(environment, name) || match);
    if (next === expanded) break;
    expanded = next;
  }
  return expanded;
}

function readWindowsRegistryEnvironment(registryPath) {
  try {
    const output = execFileSync("reg.exe", ["query", registryPath], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: gitEnvironmentBootstrapTimeoutMs,
      windowsHide: true,
    });
    const values = {};
    commandOutputText(output)
      .split(/\r?\n/)
      .forEach((line) => {
        const match = /^\s*(.*?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/i.exec(line);
        if (!match) return;
        const name = match[1].trim();
        if (!name) return;
        values[name] = match[2].trim();
      });
    return values;
  } catch (error) {
    return {};
  }
}

function resolvePosixGitExecutionEnvironment(baseEnvironment) {
  const configuredShell = String(process.env.SHELL || "").trim();
  const fallbackShell = process.platform === "darwin" ? "/bin/zsh" : "/bin/sh";
  const shellPath = configuredShell.startsWith("/") ? configuredShell : fallbackShell;
  const shellName = path.basename(shellPath);
  try {
    const output = execFileSync(
      shellPath,
      [shellName === "sh" ? "-lc" : "-ilc", `printf '\\000${gitEnvironmentMarker}\\000'; env -0`],
      {
        encoding: "buffer",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: gitEnvironmentBootstrapTimeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    const shellEnvironment = parseNullDelimitedEnvironment(output);
    const environment = { ...baseEnvironment, ...shellEnvironment };
    const mergedPath = mergePathEntries([shellEnvironment.PATH, environmentValue(baseEnvironment, "PATH")], ":");
    if (mergedPath) setEnvironmentValue(environment, "PATH", mergedPath);
    return environment;
  } catch (error) {
    return baseEnvironment;
  }
}

function resolveWindowsGitExecutionEnvironment(baseEnvironment) {
  const machineEnvironment = readWindowsRegistryEnvironment(
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
  );
  const userEnvironment = readWindowsRegistryEnvironment("HKCU\\Environment");
  const environment = { ...baseEnvironment };
  [machineEnvironment, userEnvironment].forEach((source) => {
    Object.entries(source).forEach(([name, value]) => {
      if (name.toLocaleLowerCase() === "path") return;
      setEnvironmentValue(environment, name, expandWindowsEnvironmentVariables(value, environment));
    });
  });
  const mergedPath = mergePathEntries(
    [
      expandWindowsEnvironmentVariables(environmentValue(userEnvironment, "Path"), environment),
      environmentValue(baseEnvironment, "Path"),
      expandWindowsEnvironmentVariables(environmentValue(machineEnvironment, "Path"), environment),
    ],
    ";",
    true,
  );
  if (mergedPath) setEnvironmentValue(environment, "PATH", mergedPath);
  return environment;
}

function resolveGitExecutionEnvironment() {
  if (gitExecutionEnvironment) return gitExecutionEnvironment;
  // GUI hosts do not reliably inherit the developer shell's PATH. Resolve once
  // and keep Git itself as a direct child process so its arguments stay isolated.
  const baseEnvironment = { ...process.env };
  gitExecutionEnvironment =
    process.platform === "win32"
      ? resolveWindowsGitExecutionEnvironment(baseEnvironment)
      : resolvePosixGitExecutionEnvironment(baseEnvironment);
  return gitExecutionEnvironment;
}

function expandPath(inputPath) {
  if (!inputPath) {
    return "";
  }

  if (inputPath.startsWith("~")) {
    return path.join(os.homedir(), inputPath.slice(1));
  }

  return path.resolve(inputPath);
}

function getDefaultTerminalPreferences() {
  return {
    kind:
      process.platform === "win32"
        ? "windows-terminal"
        : process.platform === "linux"
          ? "linux-terminal"
          : "terminal-app",
    customCommand: "",
  };
}

function normalizeTerminalPreferences(value) {
  const defaults = getDefaultTerminalPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const kind = terminalKinds.has(value.kind) ? value.kind : defaults.kind;
  return {
    kind: kind === "builtin" ? defaults.kind : kind,
    customCommand: typeof value.customCommand === "string" ? value.customCommand : "",
  };
}

function getDefaultEditorPreferences() {
  return { kind: "vscode", customCommand: "" };
}

function normalizeEditorPreferences(value) {
  const defaults = getDefaultEditorPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  return {
    kind: editorKinds.has(value.kind) ? value.kind : defaults.kind,
    customCommand: typeof value.customCommand === "string" ? value.customCommand : "",
  };
}

const builtinExternalApplications = [
  { id: "vscode", name: "VS Code", kind: "vscode", command: "code {path}", enabled: true },
  { id: "cursor", name: "Cursor", kind: "cursor", command: "cursor {path}", enabled: true },
];

function getDefaultExternalApplicationPreferences() {
  return {
    schemaVersion: 1,
    defaultApplicationId: "vscode",
    applications: builtinExternalApplications.map((application) => ({ ...application })),
  };
}

function normalizeExternalApplicationPreferences(value) {
  const defaults = getDefaultExternalApplicationPreferences();
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) return defaults;

  const storedApplications = Array.isArray(value.applications) ? value.applications : [];
  const builtinNames = new Set(builtinExternalApplications.map((application) => application.name.toLocaleLowerCase()));
  const usedNames = new Set();
  const applications = builtinExternalApplications.map((builtin) => {
    const stored = storedApplications.find(
      (application) => application && typeof application === "object" && application.id === builtin.id,
    );
    const storedName = stored?.kind === builtin.kind && typeof stored.name === "string" ? stored.name.trim() : "";
    const normalizedStoredName = storedName.toLocaleLowerCase();
    const defaultName = builtin.name.toLocaleLowerCase();
    const name =
      storedName &&
      (normalizedStoredName === defaultName ||
        (!builtinNames.has(normalizedStoredName) && !usedNames.has(normalizedStoredName)))
        ? storedName
        : builtin.name;
    const command =
      stored?.kind === builtin.kind && typeof stored.command === "string" && stored.command.trim()
        ? stored.command.trim()
        : builtin.command;
    usedNames.add(name.toLocaleLowerCase());
    return { ...builtin, name, command, enabled: stored?.enabled !== false };
  });
  const usedIds = new Set(applications.map((application) => application.id));

  for (const stored of storedApplications) {
    if (!stored || typeof stored !== "object") continue;
    const id = typeof stored.id === "string" ? stored.id.trim() : "";
    const name = typeof stored.name === "string" ? stored.name.trim() : "";
    const command = typeof stored.command === "string" ? stored.command.trim() : "";
    const normalizedName = name.toLocaleLowerCase();
    if (stored.kind !== "custom" || !id || !name || !command || usedIds.has(id) || usedNames.has(normalizedName)) {
      continue;
    }
    usedIds.add(id);
    usedNames.add(normalizedName);
    applications.push({ id, name, kind: "custom", command, enabled: stored.enabled !== false });
  }

  let defaultApplicationId = typeof value.defaultApplicationId === "string" ? value.defaultApplicationId.trim() : "";
  if (!applications.some((application) => application.id === defaultApplicationId && application.enabled)) {
    defaultApplicationId = applications.find((application) => application.enabled)?.id || "vscode";
  }
  if (!applications.some((application) => application.enabled)) {
    applications[0].enabled = true;
    defaultApplicationId = applications[0].id;
  }
  return {
    schemaVersion: 1,
    defaultApplicationId,
    applications,
  };
}

function migrateEditorPreferences(value) {
  if (!value || typeof value !== "object") return getDefaultExternalApplicationPreferences();
  const editor = normalizeEditorPreferences(value);
  if (editor.kind === "vscode" || editor.kind === "cursor") {
    return { ...getDefaultExternalApplicationPreferences(), defaultApplicationId: editor.kind };
  }
  const command = editor.customCommand.trim();
  if (!command) return getDefaultExternalApplicationPreferences();
  return {
    schemaVersion: 1,
    defaultApplicationId: "legacy-custom-editor",
    applications: [
      ...builtinExternalApplications.map((application) => ({ ...application })),
      { id: "legacy-custom-editor", name: "Custom Editor", kind: "custom", command, enabled: true },
    ],
  };
}

function normalizeDeviceId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getDeviceIdFilePath() {
  const overrideDir = normalizeDeviceId(process.env.UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR);
  const baseDir = overrideDir || path.join(os.homedir(), ".utools-project-launch");
  return path.join(baseDir, deviceIdFileName);
}

function readDeviceIdFile() {
  try {
    return normalizeDeviceId(fs.readFileSync(getDeviceIdFilePath(), "utf8"));
  } catch (error) {
    return "";
  }
}

function writeDeviceIdFile(deviceId) {
  try {
    const filePath = getDeviceIdFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${deviceId}\n`, "utf8");
  } catch (error) {
    // The renderer localStorage fallback still keeps browser preview usable if the file cannot be written.
  }
}

function readBrowserDeviceId() {
  try {
    return normalizeDeviceId(window.localStorage?.getItem(deviceIdStorageKey));
  } catch (error) {
    return "";
  }
}

function writeBrowserDeviceId(deviceId) {
  try {
    window.localStorage?.setItem(deviceIdStorageKey, deviceId);
  } catch (error) {
    // Keep device id persistence best-effort for browser preview and restricted webviews.
  }
}

function createDeviceId() {
  return globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getCurrentDeviceId() {
  const fileDeviceId = readDeviceIdFile();
  if (fileDeviceId) {
    writeBrowserDeviceId(fileDeviceId);
    return fileDeviceId;
  }

  const browserDeviceId = readBrowserDeviceId();
  if (browserDeviceId) {
    writeDeviceIdFile(browserDeviceId);
    return browserDeviceId;
  }

  const nextId = createDeviceId();
  writeDeviceIdFile(nextId);
  writeBrowserDeviceId(nextId);
  return nextId;
}

function getDefaultEnvironmentPreferences() {
  return {
    enabledToolKeys: ["node", "npm", "pnpm", "python", "go", "git"],
    customTools: [],
    builtinOverrides: [],
  };
}

function getBuiltinEnvironmentTools() {
  return Object.entries(environmentTools).map(([key, tool]) => ({
    key,
    name: tool.name,
    command: tool.command,
    versionArgs: [...tool.versionArgs],
  }));
}

function normalizeCustomEnvironmentTool(value) {
  if (!value || typeof value !== "object") return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const command = typeof value.command === "string" ? value.command.trim() : "";
  const versionArgs = Array.isArray(value.versionArgs)
    ? value.versionArgs.map((argument) => (typeof argument === "string" ? argument.trim() : null))
    : null;
  const unsafe = /[|&;<>`\r\n\u0000-\u001f\u007f]|\$\(|\$\{/;
  if (
    !id ||
    Object.prototype.hasOwnProperty.call(environmentTools, id) ||
    !name ||
    !command ||
    !versionArgs ||
    unsafe.test(command) ||
    versionArgs.some((argument) => !argument || unsafe.test(argument))
  ) {
    return null;
  }
  return { id, name, command, versionArgs, enabled: value.enabled !== false };
}

function normalizeBuiltinEnvironmentToolOverride(value) {
  if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(environmentTools, value.key)) {
    return null;
  }
  const command = typeof value.command === "string" ? value.command.trim() : "";
  const versionArgs = Array.isArray(value.versionArgs)
    ? value.versionArgs.map((argument) => (typeof argument === "string" ? argument.trim() : null))
    : null;
  const unsafe = /[|&;<>`\r\n\u0000-\u001f\u007f]|\$\(|\$\{/;
  if (
    !command ||
    !versionArgs ||
    unsafe.test(command) ||
    versionArgs.some((argument) => !argument || unsafe.test(argument))
  ) {
    return null;
  }
  return { key: value.key, command, versionArgs };
}

function normalizeEnvironmentPreferences(value) {
  const defaults = getDefaultEnvironmentPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const enabledToolKeys = Array.isArray(value.enabledToolKeys)
    ? value.enabledToolKeys.filter((key) => Object.prototype.hasOwnProperty.call(environmentTools, key))
    : defaults.enabledToolKeys;
  const customTools = Array.isArray(value.customTools)
    ? value.customTools
        .map(normalizeCustomEnvironmentTool)
        .filter(Boolean)
        .filter((tool, index, tools) => tools.findIndex((item) => item.id === tool.id) === index)
    : [];
  const builtinOverrides = Array.isArray(value.builtinOverrides)
    ? value.builtinOverrides
        .map(normalizeBuiltinEnvironmentToolOverride)
        .filter(Boolean)
        .filter((override, index, overrides) => overrides.findIndex((item) => item.key === override.key) === index)
    : [];
  return {
    enabledToolKeys: Array.from(new Set(enabledToolKeys)),
    customTools,
    builtinOverrides,
  };
}

function cloneDefaultAiPromptModes() {
  return defaultAiPromptModes.map((mode) => ({ ...mode }));
}

function normalizeAiProviderKind(provider) {
  if (provider === "openai" || provider === "openai-responses") return "openai-compatible";
  if (provider === "anthropic") return "anthropic-compatible";
  return aiProviderKinds.has(provider) ? provider : "utools";
}

function normalizeAiPromptModeKind(id, kind) {
  if (id === aiCommitMessageModeId) {
    return "commit-message";
  }
  return typeof kind === "string" && aiPromptModeKinds.has(kind) && kind !== "commit-message" ? kind : "git-analysis";
}

function normalizeAiPromptModes(value, legacyCommitMessagePrompt) {
  const defaults = cloneDefaultAiPromptModes();
  const defaultById = new Map(defaults.map((mode) => [mode.id, mode]));
  const defaultIds = new Set(defaults.map((mode) => mode.id));
  const legacyPrompt = typeof legacyCommitMessagePrompt === "string" ? legacyCommitMessagePrompt : "";
  const defaultModeWithLegacyPrompt = (mode) =>
    mode.id === aiCommitMessageModeId && legacyPrompt
      ? { ...mode, prompt: legacyPrompt === legacyDefaultAiCommitMessagePrompt ? mode.prompt : legacyPrompt }
      : mode;
  if (!Array.isArray(value)) {
    return defaults.map(defaultModeWithLegacyPrompt);
  }

  const modes = new Map();
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const fallbackId = item.builtIn ? defaults[index]?.id : `custom-${index + 1}`;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : fallbackId;
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : id;
    const defaultPrompt = defaultById.get(id)?.prompt || "";
    const prompt =
      typeof item.prompt === "string"
        ? id === aiCommitMessageModeId && item.prompt === legacyDefaultAiCommitMessagePrompt
          ? defaultPrompt
          : item.prompt
        : defaultPrompt;
    if (!id || modes.has(id)) return;
    modes.set(id, { id, name, prompt, builtIn: defaultIds.has(id), kind: normalizeAiPromptModeKind(id, item.kind) });
  });

  defaults.forEach((mode) => {
    if (!modes.has(mode.id)) {
      modes.set(mode.id, defaultModeWithLegacyPrompt(mode));
    }
  });

  return modes.size > 0 ? Array.from(modes.values()) : defaults;
}

function getDefaultAiPreferences() {
  return {
    provider: "utools",
    baseUrl: "",
    model: "",
    apiKey: "",
    modes: cloneDefaultAiPromptModes(),
  };
}

function normalizeAiPreferences(value) {
  const defaults = getDefaultAiPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  return {
    provider: normalizeAiProviderKind(value.provider),
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
    model: typeof value.model === "string" ? value.model : "",
    apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
    modes: normalizeAiPromptModes(value.modes, value.commitMessagePrompt),
  };
}
