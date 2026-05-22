const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { TextDecoder } = require("node:util");
const { shell } = require("electron");

const activeProcesses = new Map();
const launchedProcessIds = new Set();
const userStoppedProcesses = new Set();
const storageKey = "utools-project-launch.projects.v1";
const terminalPreferencesStorageKey = "utools-project-launch.settings.v1";
const editorPreferencesStorageKey = "utools-project-launch.editor-settings.v1";
const environmentPreferencesStorageKey = "utools-project-launch.environment-settings.v1";
const aiPreferencesStorageKey = "utools-project-launch.ai-settings.v1";
const projectDocPrefix = "utools-project-launch/project/";
const schemaVersion = 1;
const gitCommitFieldSeparator = "\x1f";
const gitCommitRecordSeparator = "\x1e";
const commonProjectDirs = [".", "frontend", "backend", "client", "server", "api", "src"];
const terminalKinds = new Set(["builtin", "windows-terminal", "powershell", "cmd", "custom"]);
const editorKinds = new Set(["vscode", "cursor", "custom"]);
const aiProviderKinds = new Set(["utools", "openai", "anthropic"]);
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
    kind: process.platform === "win32" ? "windows-terminal" : "builtin",
    customCommand: "",
  };
}

function normalizeTerminalPreferences(value) {
  const defaults = getDefaultTerminalPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  return {
    kind: terminalKinds.has(value.kind) ? value.kind : defaults.kind,
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

function getDefaultEnvironmentPreferences() {
  return { enabledToolKeys: ["node", "npm", "pnpm", "python", "go", "git"] };
}

function normalizeEnvironmentPreferences(value) {
  const defaults = getDefaultEnvironmentPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const enabledToolKeys = Array.isArray(value.enabledToolKeys)
    ? value.enabledToolKeys.filter((key) => Object.prototype.hasOwnProperty.call(environmentTools, key))
    : defaults.enabledToolKeys;
  return {
    enabledToolKeys: enabledToolKeys.length > 0 ? Array.from(new Set(enabledToolKeys)) : defaults.enabledToolKeys,
  };
}

function getDefaultAiPreferences() {
  return { provider: "utools", baseUrl: "", model: "", apiKey: "" };
}

function normalizeAiPreferences(value) {
  const defaults = getDefaultAiPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  return {
    provider: aiProviderKinds.has(value.provider) ? value.provider : defaults.provider,
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
    model: typeof value.model === "string" ? value.model : "",
    apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
  };
}

function readTerminalPreferences() {
  try {
    if (window.utools?.dbStorage) {
      return normalizeTerminalPreferences(window.utools.dbStorage.getItem(terminalPreferencesStorageKey));
    }

    const raw = window.localStorage?.getItem(terminalPreferencesStorageKey);
    if (!raw) {
      return getDefaultTerminalPreferences();
    }

    return normalizeTerminalPreferences(JSON.parse(raw));
  } catch (error) {
    return getDefaultTerminalPreferences();
  }
}

function saveTerminalPreferences(preferences) {
  const normalized = normalizeTerminalPreferences(preferences);

  try {
    if (window.utools?.dbStorage) {
      window.utools.dbStorage.setItem(terminalPreferencesStorageKey, normalized);
      return;
    }

    window.localStorage?.setItem(terminalPreferencesStorageKey, JSON.stringify(normalized));
  } catch (error) {
    // Keep settings updates non-blocking in browser preview and uTools fallback modes.
  }
}

function readEditorPreferences() {
  try {
    if (window.utools?.dbStorage) {
      return normalizeEditorPreferences(window.utools.dbStorage.getItem(editorPreferencesStorageKey));
    }
    const raw = window.localStorage?.getItem(editorPreferencesStorageKey);
    return raw ? normalizeEditorPreferences(JSON.parse(raw)) : getDefaultEditorPreferences();
  } catch (error) {
    return getDefaultEditorPreferences();
  }
}

function saveEditorPreferences(preferences) {
  const normalized = normalizeEditorPreferences(preferences);
  try {
    if (window.utools?.dbStorage) {
      window.utools.dbStorage.setItem(editorPreferencesStorageKey, normalized);
      return;
    }
    window.localStorage?.setItem(editorPreferencesStorageKey, JSON.stringify(normalized));
  } catch (error) {
    // Keep settings updates non-blocking in browser preview and uTools fallback modes.
  }
}

function readEnvironmentPreferences() {
  try {
    if (window.utools?.dbStorage) {
      return normalizeEnvironmentPreferences(window.utools.dbStorage.getItem(environmentPreferencesStorageKey));
    }
    const raw = window.localStorage?.getItem(environmentPreferencesStorageKey);
    return raw ? normalizeEnvironmentPreferences(JSON.parse(raw)) : getDefaultEnvironmentPreferences();
  } catch (error) {
    return getDefaultEnvironmentPreferences();
  }
}

function saveEnvironmentPreferences(preferences) {
  const normalized = normalizeEnvironmentPreferences(preferences);
  try {
    if (window.utools?.dbStorage) {
      window.utools.dbStorage.setItem(environmentPreferencesStorageKey, normalized);
      return;
    }
    window.localStorage?.setItem(environmentPreferencesStorageKey, JSON.stringify(normalized));
  } catch (error) {
    // Keep settings updates non-blocking in browser preview and uTools fallback modes.
  }
}

function readAiPreferences() {
  try {
    if (window.utools?.dbStorage) {
      return normalizeAiPreferences(window.utools.dbStorage.getItem(aiPreferencesStorageKey));
    }
    const raw = window.localStorage?.getItem(aiPreferencesStorageKey);
    return raw ? normalizeAiPreferences(JSON.parse(raw)) : getDefaultAiPreferences();
  } catch (error) {
    return getDefaultAiPreferences();
  }
}

function saveAiPreferences(preferences) {
  const normalized = normalizeAiPreferences(preferences);
  try {
    if (window.utools?.dbStorage) {
      window.utools.dbStorage.setItem(aiPreferencesStorageKey, normalized);
      return;
    }
    window.localStorage?.setItem(aiPreferencesStorageKey, JSON.stringify(normalized));
  } catch (error) {
    // Keep settings updates non-blocking in browser preview and uTools fallback modes.
  }
}

function runToolCommand(command, args) {
  try {
    return spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 5000 });
  } catch (error) {
    return { error };
  }
}

function detectEnvironmentTools(toolKeys) {
  const requestedKeys =
    Array.isArray(toolKeys) && toolKeys.length > 0 ? toolKeys : readEnvironmentPreferences().enabledToolKeys;
  return requestedKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(environmentTools, key))
    .map((key) => {
      const tool = environmentTools[key];
      const checkedAt = new Date().toISOString();
      const versionResult = runToolCommand(tool.command, tool.versionArgs);
      if (versionResult.error || versionResult.status !== 0) {
        return {
          key,
          name: tool.name,
          status: "missing",
          version: "",
          executablePath: "",
          checkedAt,
          error: versionResult.error?.message || String(versionResult.stderr || "Command not found").trim(),
        };
      }
      const [pathCommand, ...pathArgs] = tool.pathArgs;
      const pathResult = runToolCommand(pathCommand, pathArgs);
      return {
        key,
        name: tool.name,
        status: "available",
        version:
          String(versionResult.stdout || versionResult.stderr || "")
            .trim()
            .split(/\r?\n/)[0] || "OK",
        executablePath:
          pathResult.status === 0
            ? String(pathResult.stdout || "")
                .trim()
                .split(/\r?\n/)[0] || ""
            : "",
        checkedAt,
      };
    });
}

async function listAiModels() {
  if (!window.utools?.allAiModels) {
    return [];
  }
  const models = await window.utools.allAiModels();
  return Array.isArray(models)
    ? models
        .map((model) => ({
          id: String(model.id || model.model || model.name || ""),
          name: String(model.name || model.label || model.id || model.model || ""),
          provider: model.provider ? String(model.provider) : undefined,
        }))
        .filter((model) => model.id || model.name)
    : [];
}

function normalizeAiModelCollection(models, providerHint) {
  return Array.isArray(models)
    ? models
        .map((model) => ({
          id: String(model.id || model.model || model.name || model.label || "").trim(),
          name: String(model.name || model.label || model.model || model.id || "").trim(),
          provider: String(model.provider || providerHint || "").trim() || undefined,
        }))
        .filter((model) => Boolean(model.id || model.name))
    : [];
}

async function testAiConnection(preferences) {
  const normalized = normalizeAiPreferences(preferences || readAiPreferences());
  try {
    if (normalized.provider === "utools") {
      if (!window.utools?.allAiModels) {
        return { ok: false, message: "当前 uTools 版本不支持获取内置 AI 模型。" };
      }
      const models = normalizeAiModelCollection(await window.utools.allAiModels(), "utools");
      return models.length > 0
        ? { ok: true, message: `已连接 uTools 内置 AI，可用模型 ${models.length} 个。` }
        : { ok: false, message: "已连接 uTools，但没有获取到可用模型。" };
    }

    if (!normalized.baseUrl.trim() || !normalized.model.trim() || !normalized.apiKey.trim()) {
      return { ok: false, message: "第三方 AI 配置不完整，无法测试。" };
    }

    const response = await fetch(
      `${normalized.baseUrl.replace(/\/$/, "")}${normalized.provider === "anthropic" ? "/messages" : "/chat/completions"}`,
      {
        method: "POST",
        headers:
          normalized.provider === "anthropic"
            ? {
                "content-type": "application/json",
                authorization: `Bearer ${normalized.apiKey}`,
                "anthropic-version": "2023-06-01",
              }
            : {
                "content-type": "application/json",
                authorization: `Bearer ${normalized.apiKey}`,
              },
        body:
          normalized.provider === "anthropic"
            ? JSON.stringify({ model: normalized.model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] })
            : JSON.stringify({ model: normalized.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || response.statusText || "AI 连接测试失败。");
    }
    return { ok: true, message: "AI 连接测试成功。" };
  } catch (error) {
    return { ok: false, message: error?.message || "AI 连接测试失败。" };
  }
}

async function callThirdPartyAi(preferences, prompt) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${preferences.apiKey}` };
  if (preferences.provider === "anthropic") {
    const response = await fetch(`${preferences.baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: { ...headers, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: preferences.model,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || response.statusText);
    return Array.isArray(data.content)
      ? data.content
          .map((part) => part.text || "")
          .join("\n")
          .trim()
      : "";
  }
  const response = await fetch(`${preferences.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: preferences.model, messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || response.statusText);
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

async function analyzeWithAi(payload) {
  const preferences = normalizeAiPreferences(payload?.preferences || readAiPreferences());
  const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) return { ok: false, content: "", message: "AI 分析内容为空。" };
  try {
    if (preferences.provider === "utools") {
      if (!window.utools?.ai) return { ok: false, content: "", message: "当前 uTools 版本不支持内置 AI。" };
      const result = await window.utools.ai({
        model: preferences.model || undefined,
        messages: [{ role: "user", content: prompt }],
      });
      return { ok: true, content: String(result?.content || result?.text || result || "").trim() };
    }
    if (!preferences.baseUrl.trim() || !preferences.model.trim() || !preferences.apiKey.trim()) {
      return { ok: false, content: "", message: "第三方 AI 配置不完整。" };
    }
    return { ok: true, content: await callThirdPartyAi(preferences, prompt) };
  } catch (error) {
    return { ok: false, content: "", message: error?.message || "AI 分析失败。" };
  }
}

function getDirectoryStatus(targetPath) {
  if (!targetPath) {
    return { exists: false, isDirectory: false };
  }

  try {
    const stats = fs.statSync(targetPath);
    return { exists: true, isDirectory: stats.isDirectory() };
  } catch (error) {
    return { exists: false, isDirectory: false };
  }
}

function isSupportedTerminalKind(kind) {
  return terminalKinds.has(kind);
}

function splitCommandLine(commandLine) {
  const tokens = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];

    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }

      current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function formatCommandLine(executable, args) {
  return [executable, ...args].join(" ");
}

function launchDetachedProcess(executable, args, cwd) {
  return new Promise((resolve) => {
    let child;

    try {
      child = spawn(executable, args, {
        cwd,
        detached: true,
        stdio: "ignore",
      });
    } catch (error) {
      resolve({
        launched: false,
        command: formatCommandLine(executable, args),
        cwd,
        kind: "custom",
        message: error?.message || "无法启动终端。",
      });
      return;
    }

    let settled = false;

    child.once("spawn", () => {
      settled = true;
      child.unref();
      resolve({
        launched: true,
        command: formatCommandLine(executable, args),
        cwd,
      });
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }

      resolve({
        launched: false,
        command: formatCommandLine(executable, args),
        cwd,
        message: error?.message || "无法启动终端。",
      });
    });
  });
}

async function openTerminal(payload) {
  const resolvedPath = expandPath(typeof payload?.projectPath === "string" ? payload.projectPath : "");
  const rawTerminalKind = payload?.terminal?.kind || "builtin";
  const terminalKind = isSupportedTerminalKind(rawTerminalKind) ? rawTerminalKind : "builtin";
  const customCommand =
    typeof payload?.terminal?.customCommand === "string" ? payload.terminal.customCommand.trim() : "";
  const directoryStatus = getDirectoryStatus(resolvedPath);

  if (!isSupportedTerminalKind(rawTerminalKind)) {
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      kind: terminalKind,
      message: "未知终端偏好，无法打开终端。",
    };
  }

  if (!directoryStatus.exists) {
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      kind: terminalKind,
      message: "项目路径不存在，无法打开终端。",
    };
  }

  if (!directoryStatus.isDirectory) {
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      kind: terminalKind,
      message: "项目路径不是文件夹，无法打开终端。",
    };
  }

  if (terminalKind === "builtin") {
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      kind: terminalKind,
      message: "内置终端偏好暂不启动外部进程。",
    };
  }

  if (terminalKind === "windows-terminal") {
    return launchDetachedProcess("wt.exe", ["-d", resolvedPath], resolvedPath).then((result) => ({
      ...result,
      kind: terminalKind,
    }));
  }

  if (terminalKind === "powershell") {
    return launchDetachedProcess(
      "powershell.exe",
      ["-NoExit", "-Command", `Set-Location -LiteralPath '${resolvedPath.replace(/'/g, "''")}'`],
      resolvedPath,
    ).then((result) => ({
      ...result,
      kind: terminalKind,
    }));
  }

  if (terminalKind === "cmd") {
    return launchDetachedProcess("cmd.exe", ["/k", "pushd", resolvedPath], resolvedPath).then((result) => ({
      ...result,
      kind: terminalKind,
    }));
  }

  if (!customCommand) {
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      kind: terminalKind,
      message: "自定义终端命令为空。",
    };
  }

  const commandTokens = splitCommandLine(customCommand).map((token) =>
    token.replace(/\{path\}|\{projectPath\}/g, () => resolvedPath),
  );
  const [executable, ...args] = commandTokens;

  if (!executable) {
    return {
      launched: false,
      command: customCommand,
      cwd: resolvedPath,
      kind: terminalKind,
      message: "自定义终端命令无效。",
    };
  }

  return launchDetachedProcess(executable, args, resolvedPath).then((result) => ({
    ...result,
    kind: terminalKind,
  }));
}

function isSupportedEditorKind(kind) {
  return editorKinds.has(kind);
}

async function openEditor(payload) {
  const resolvedPath = expandPath(typeof payload?.projectPath === "string" ? payload.projectPath : "");
  const rawEditorKind = payload?.editor?.kind || "vscode";
  const editorKind = isSupportedEditorKind(rawEditorKind) ? rawEditorKind : "vscode";
  const customCommand = typeof payload?.editor?.customCommand === "string" ? payload.editor.customCommand.trim() : "";
  const directoryStatus = getDirectoryStatus(resolvedPath);

  if (!isSupportedEditorKind(rawEditorKind)) {
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      kind: editorKind,
      message: "未知编辑器偏好，无法打开编辑器。",
    };
  }
  if (!directoryStatus.exists) {
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      kind: editorKind,
      message: "项目路径不存在，无法打开编辑器。",
    };
  }
  if (!directoryStatus.isDirectory) {
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      kind: editorKind,
      message: "项目路径不是文件夹，无法打开编辑器。",
    };
  }

  if (editorKind === "vscode") {
    const executable = process.platform === "win32" ? "code.cmd" : "code";
    return launchDetachedProcess(executable, [resolvedPath], resolvedPath).then((result) => ({
      ...result,
      kind: editorKind,
    }));
  }
  if (editorKind === "cursor") {
    const executable = process.platform === "win32" ? "cursor.cmd" : "cursor";
    return launchDetachedProcess(executable, [resolvedPath], resolvedPath).then((result) => ({
      ...result,
      kind: editorKind,
    }));
  }
  if (!customCommand) {
    return { launched: false, command: "", cwd: resolvedPath, kind: editorKind, message: "自定义编辑器命令为空。" };
  }
  const commandTokens = splitCommandLine(customCommand).map((token) =>
    token.replace(/\{path\}|\{projectPath\}/g, () => resolvedPath),
  );
  const [executable, ...args] = commandTokens;
  if (!executable) {
    return {
      launched: false,
      command: customCommand,
      cwd: resolvedPath,
      kind: editorKind,
      message: "自定义编辑器命令无效。",
    };
  }
  return launchDetachedProcess(executable, args, resolvedPath).then((result) => ({ ...result, kind: editorKind }));
}

function emit(detail) {
  window.dispatchEvent(new CustomEvent("project-bridge-event", { detail }));
}

function logStorageError(action, error) {
  console.warn(`[utools-project-launch] ${action} failed`, error?.message || error);
}

function findGitRoot(startPath) {
  const resolvedPath = expandPath(startPath);

  try {
    const output = execFileSync("git", ["-C", resolvedPath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output.trim();
  } catch (error) {
    return null;
  }
}

function runGit(startPath, args) {
  const resolvedPath = expandPath(startPath);

  try {
    return execFileSync("git", ["-C", resolvedPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return null;
  }
}

function runGitDiff(startPath, args) {
  const resolvedPath = expandPath(startPath);

  try {
    return execFileSync("git", ["-C", resolvedPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return error?.stdout ? String(error.stdout) : null;
  }
}

function collectNumstat(startPath, args) {
  const output = runGit(startPath, args);
  if (!output) {
    return new Map();
  }

  const result = new Map();
  output.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) {
      return;
    }

    const [additions, deletions, ...rest] = line.split(/\t/);
    const filePath = rest.join("\t");
    result.set(filePath, {
      additions: additions === "-" ? 0 : Number(additions),
      deletions: deletions === "-" ? 0 : Number(deletions),
    });
  });

  return result;
}

function readPackageScripts(projectPath) {
  const resolvedPath = expandPath(projectPath);
  const packagePath = path.join(resolvedPath, "package.json");

  if (!fs.existsSync(packagePath)) {
    return { scripts: [], packagePath: null };
  }

  try {
    const raw = fs.readFileSync(packagePath, "utf8");
    const parsed = JSON.parse(raw);
    const scripts = Object.entries(parsed.scripts || {}).map(([name, command]) => ({
      name,
      command: `npm run ${name}`,
      note: String(command),
      source: "package-json",
    }));

    return { scripts, packagePath };
  } catch (error) {
    return { scripts: [], packagePath };
  }
}

function toRelativeCwd(rootPath, targetPath) {
  const relativePath = path.relative(expandPath(rootPath), expandPath(targetPath));
  return relativePath ? relativePath.replace(/\\/g, "/") : ".";
}

function toStoredProject(project) {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    type: project.type || "Custom",
    kind: project.kind || "custom",
    icon: project.icon || "custom",
    status: "STOPPED",
    description: project.description || "",
    lastUpdated: project.lastUpdated || "",
    scripts: Array.isArray(project.scripts)
      ? project.scripts.map((script) => ({
          id: script.id,
          name: script.name,
          command: script.command,
          cwd: script.cwd || ".",
          note: script.note || "",
          source: script.source || "manual",
          status: "IDLE",
        }))
      : [],
    env: project.env || {},
    branch: project.branch || "main",
    memo: project.memo || "",
    todos: Array.isArray(project.todos) ? project.todos : [],
    gitLatestCommitAt: project.gitLatestCommitAt || project.git?.commits?.[0]?.date || "",
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeLegacyStoredProjects(projects) {
  const payload = {
    schemaVersion,
    updatedAt: new Date().toISOString(),
    projects: projects.map(toStoredProject),
  };

  if (window.utools?.dbStorage) {
    window.utools.dbStorage.setItem(storageKey, payload);
    return;
  }
  window.localStorage?.setItem(storageKey, JSON.stringify(payload));
}

function detectNodeUnit(rootPath, targetPath) {
  const packageResult = readPackageScripts(targetPath);
  if (!packageResult.packagePath) {
    return [];
  }

  const cwd = toRelativeCwd(rootPath, targetPath);
  return packageResult.scripts.map((script) => ({
    name: cwd === "." ? script.name : `${cwd}:${script.name}`,
    command: script.command,
    cwd,
    note: `package.json: ${toRelativeCwd(rootPath, packageResult.packagePath)}`,
    source: "package-json",
  }));
}

function readLegacyStoredProjects() {
  try {
    if (window.utools?.dbStorage) {
      const stored = window.utools.dbStorage.getItem(storageKey);
      return Array.isArray(stored?.projects) ? stored.projects : Array.isArray(stored) ? stored : [];
    }

    const raw = window.localStorage?.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch (error) {
    return [];
  }
}

function readProjectDocs() {
  if (!window.utools?.db?.allDocs) {
    return [];
  }

  const result = window.utools.db.allDocs(projectDocPrefix);
  const rows = Array.isArray(result)
    ? result
    : Array.isArray(result?.rows)
      ? result.rows
      : Array.isArray(result?.docs)
        ? result.docs
        : result && typeof result === "object"
          ? Object.values(result)
          : [];
  return rows
    .map((row) => {
      const summary = row?.doc || row?.value || row;
      const docId = summary?._id || row?._id || row?.id;
      if (summary?.project) {
        return summary;
      }
      if (typeof docId === "string" && window.utools?.db?.get) {
        const doc = window.utools.db.get(docId);
        return doc?.error ? null : doc;
      }
      return summary;
    })
    .filter((doc) => doc && typeof doc._id === "string" && doc._id.startsWith(projectDocPrefix));
}

function readProjects() {
  try {
    const docs = readProjectDocs();
    if (docs.length > 0) {
      return docs.map((doc) => doc.project).filter(Boolean);
    }

    const legacyProjects = readLegacyStoredProjects();
    if (legacyProjects.length > 0 && window.utools?.db?.put) {
      writeStoredProjects(legacyProjects);
    }
    return legacyProjects;
  } catch (error) {
    logStorageError("read projects", error);
    return readLegacyStoredProjects();
  }
}

function writeStoredProjects(projects) {
  if (window.utools?.db?.put) {
    try {
      const existingDocs = readProjectDocs();
      const existingByProjectId = new Map(existingDocs.map((doc) => [doc._id.replace(projectDocPrefix, ""), doc]));
      const projectIds = new Set(projects.map((project) => project.id));

      projects.forEach((project) => {
        const existing = existingByProjectId.get(project.id);
        const doc = toPlainJson({
          _id: `${projectDocPrefix}${project.id}`,
          schemaVersion,
          updatedAt: new Date().toISOString(),
          project: toStoredProject(project),
        });
        if (existing?._rev) {
          doc._rev = existing._rev;
        }
        const result = window.utools.db.put(doc);
        if (result?.error) {
          throw new Error(result.message || String(result.error));
        }

        if (result?.ok && result.rev) {
          doc._rev = result.rev;
        }
      });

      existingDocs.forEach((doc) => {
        const projectId = doc._id.replace(projectDocPrefix, "");
        if (!projectIds.has(projectId) && window.utools?.db?.remove) {
          const result = window.utools.db.remove(doc);
          if (result?.error) {
            logStorageError(`remove project ${projectId}`, result.message || result.error);
          }
        }
      });
      return;
    } catch (error) {
      logStorageError("save projects to uTools db", error);
      writeLegacyStoredProjects(projects);
      return;
    }
  }

  writeLegacyStoredProjects(projects);
}

function pathExists(projectPath) {
  try {
    return Boolean(projectPath) && fs.existsSync(expandPath(projectPath));
  } catch (error) {
    return false;
  }
}

function resolveProjectChild(projectPath, relativePath) {
  const rootPath = expandPath(projectPath);
  const normalizedRelativePath = typeof relativePath === "string" ? relativePath : "";
  const targetPath = path.resolve(rootPath, normalizedRelativePath || ".");
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("目标路径不在项目目录内。");
  }
  return { rootPath, targetPath, relativePath: relative === "" ? "" : relative.replace(/\\/g, "/") };
}

function listProjectFiles(projectPath, relativePath = "") {
  const resolved = resolveProjectChild(projectPath, relativePath);
  const stats = fs.statSync(resolved.targetPath);
  if (!stats.isDirectory()) {
    throw new Error("目标路径不是目录。");
  }

  const entries = fs
    .readdirSync(resolved.targetPath, { withFileTypes: true })
    .filter((entry) => !ignoredFileTreeDirs.has(entry.name))
    .map((entry) => {
      const childPath = path.join(resolved.targetPath, entry.name);
      const childStats = fs.statSync(childPath);
      const childRelativePath = path.relative(resolved.rootPath, childPath).replace(/\\/g, "/");
      return {
        name: entry.name,
        path: childPath,
        relativePath: childRelativePath,
        kind: entry.isDirectory() ? "directory" : "file",
        size: childStats.size,
        extension: path.extname(entry.name).toLowerCase(),
        hidden: entry.name.startsWith("."),
      };
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  return { rootPath: resolved.rootPath, relativePath: resolved.relativePath, entries };
}

function getMime(extension) {
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";
  return textFileExtensions.has(extension) ? "text/plain" : "application/octet-stream";
}

function isKnownTextFileName(fileName) {
  return textFileNamePatterns.some((pattern) => pattern.test(fileName));
}

function isLikelyTextBuffer(buffer) {
  if (buffer.length === 0) return true;
  let replacementCount = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0) return false;
  }

  const decoded = buffer.toString("utf8");
  for (const char of decoded) {
    if (char === "\uFFFD") {
      replacementCount += 1;
    }
  }
  return replacementCount / decoded.length < 0.02;
}

function readProjectFile(projectPath, relativePath) {
  const resolved = resolveProjectChild(projectPath, relativePath);
  const stats = fs.statSync(resolved.targetPath);
  const name = path.basename(resolved.targetPath);
  const extension = path.extname(name).toLowerCase();
  const mime = getMime(extension);

  if (!stats.isFile()) {
    return {
      path: resolved.targetPath,
      relativePath: resolved.relativePath,
      name,
      size: stats.size,
      extension,
      mime,
      previewKind: "none",
      editable: false,
      message: "请选择文件预览。",
    };
  }

  if (imageFileExtensions.has(extension) && stats.size <= 1024 * 1024 * 2) {
    return {
      path: resolved.targetPath,
      relativePath: resolved.relativePath,
      name,
      size: stats.size,
      extension,
      mime,
      previewKind: "image",
      editable: false,
      dataUrl: `data:${mime};base64,${fs.readFileSync(resolved.targetPath).toString("base64")}`,
    };
  }

  const isKnownTextFile = textFileExtensions.has(extension) || isKnownTextFileName(name);
  const isSmallUnknownTextFile =
    !isKnownTextFile && stats.size <= 1024 * 64 && isLikelyTextBuffer(fs.readFileSync(resolved.targetPath));
  if (isKnownTextFile || isSmallUnknownTextFile) {
    if (stats.size > 1024 * 512) {
      return {
        path: resolved.targetPath,
        relativePath: resolved.relativePath,
        name,
        size: stats.size,
        extension,
        mime,
        previewKind: "none",
        editable: false,
        message: "文件过大，已跳过轻量预览。",
      };
    }
    return {
      path: resolved.targetPath,
      relativePath: resolved.relativePath,
      name,
      size: stats.size,
      extension,
      mime,
      previewKind: "text",
      editable: true,
      content: fs.readFileSync(resolved.targetPath, "utf8"),
    };
  }

  return {
    path: resolved.targetPath,
    relativePath: resolved.relativePath,
    name,
    size: stats.size,
    extension,
    mime,
    previewKind: "none",
    editable: false,
    message: "此文件类型暂不支持轻量预览。",
  };
}

function writeProjectFile(projectPath, relativePath, content) {
  const resolved = resolveProjectChild(projectPath, relativePath);
  const stats = fs.statSync(resolved.targetPath);
  if (!stats.isFile()) {
    throw new Error("只能保存文件。");
  }
  fs.writeFileSync(resolved.targetPath, String(content), "utf8");
  return { path: resolved.targetPath, relativePath: resolved.relativePath, savedAt: new Date().toISOString() };
}

function readGitFileDiff(projectPath, relativePath) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { path: relativePath || "", diff: "", message: "未检测到 Git 仓库" };
  }

  const resolved = resolveProjectChild(repositoryPath, relativePath);
  const diffPath = resolved.relativePath;
  if (!diffPath) {
    return { path: "", diff: "", message: "请选择文件查看 diff。" };
  }

  const headDiff = runGitDiff(repositoryPath, ["diff", "--", diffPath]);
  const cachedDiff = runGitDiff(repositoryPath, ["diff", "--cached", "--", diffPath]);
  const untrackedDiff = fs.existsSync(resolved.targetPath)
    ? runGitDiff(repositoryPath, ["diff", "--no-index", "--", os.devNull, diffPath])
    : "";
  const diff = [cachedDiff, headDiff || untrackedDiff].filter(Boolean).join("\n");

  return {
    path: diffPath,
    diff,
    message: diff ? "" : "该文件暂无可显示的 diff。",
  };
}

function listProjectSubdirectories(projectPath) {
  const resolvedPath = expandPath(projectPath);
  const preferred = new Set(commonProjectDirs);

  try {
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
      return ["."];
    }

    const childDirectories = fs
      .readdirSync(resolvedPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
    return Array.from(new Set([".", ...commonProjectDirs.slice(1), ...childDirectories])).sort((left, right) => {
      const leftPreferred = preferred.has(left);
      const rightPreferred = preferred.has(right);
      if (leftPreferred !== rightPreferred) {
        return leftPreferred ? -1 : 1;
      }
      return left.localeCompare(right);
    });
  } catch (error) {
    return ["."];
  }
}

function inspectProjectPath(projectPath) {
  const resolvedPath = expandPath(projectPath);
  const exists = pathExists(projectPath);
  const result = {
    pathExists: exists,
    name: path.basename(resolvedPath),
    branch: "main",
    scripts: [],
    packagePath: null,
    git: null,
    gitLatestCommitAt: "",
  };

  if (!exists) {
    return {
      ...result,
      message: "路径不存在或当前设备无法访问，可手动保存后稍后重新定位。",
    };
  }

  const detectedScripts = commonProjectDirs.flatMap((dirName) => {
    const targetPath = dirName === "." ? resolvedPath : path.join(resolvedPath, dirName);
    return detectNodeUnit(resolvedPath, targetPath);
  });

  const hasNode = detectedScripts.some((script) => script.source === "package-json");
  const packageResult = readPackageScripts(projectPath);
  if (hasNode) {
    result.packagePath = packageResult.packagePath;
  }

  result.scripts = detectedScripts;

  result.git = readGitSnapshot(projectPath);
  result.gitLatestCommitAt = result.git?.commits?.[0]?.date || "";
  result.branch = result.git?.branch || "main";
  return result;
}

async function pickProjectPath() {
  if (!window.utools?.showOpenDialog) {
    return { canceled: true, message: "当前环境不支持系统文件夹选择器，请手动填写路径。" };
  }

  const selected = await window.utools.showOpenDialog({
    title: "选择项目目录",
    properties: ["openDirectory"],
  });
  const filePath = Array.isArray(selected) ? selected[0] : selected?.filePaths?.[0];
  return filePath ? { path: filePath } : { canceled: true };
}

async function exportProjects(config) {
  const defaultPath = path.join(os.homedir(), `utools-projects-${new Date().toISOString().slice(0, 10)}.json`);
  const selected = window.utools?.showSaveDialog
    ? await window.utools.showSaveDialog({
        title: "导出项目配置",
        defaultPath,
        filters: [{ name: "JSON", extensions: ["json"] }],
      })
    : defaultPath;
  const targetPath = typeof selected === "string" ? selected : selected?.filePath;

  if (!targetPath) {
    return { canceled: true };
  }

  fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), "utf8");
  return { path: targetPath };
}

async function importProjects() {
  const selected = window.utools?.showOpenDialog
    ? await window.utools.showOpenDialog({
        title: "导入项目配置",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      })
    : null;
  const filePath = Array.isArray(selected) ? selected[0] : selected?.filePaths?.[0];

  if (!filePath) {
    return { canceled: true };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed.schemaVersion !== schemaVersion || !Array.isArray(parsed.projects)) {
      return { canceled: true, message: "配置文件格式不受支持。" };
    }

    return { config: parsed };
  } catch (error) {
    return { canceled: true, message: "无法读取配置文件。" };
  }
}

function readGitSnapshot(projectPath, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const now = new Date().toISOString();
  const limit = Math.min(100, Math.max(20, Number(options.limit) || 80));
  const skip = Math.max(0, Number(options.skip) || 0);

  if (!repositoryPath) {
    return {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [],
      commits: [],
      hasMoreCommits: false,
      repositoryPath: "",
      lastRefreshedAt: now,
      statusText: "未检测到 Git 仓库",
    };
  }

  const branchOutput = runGit(repositoryPath, ["status", "--short", "--branch"]);
  const statusOutput = runGit(repositoryPath, ["status", "--short"]);
  const commitOutput = runGit(repositoryPath, [
    "log",
    "--all",
    "--decorate=short",
    `--max-count=${limit + 1}`,
    `--skip=${skip}`,
    `--pretty=format:%h${gitCommitFieldSeparator}%p${gitCommitFieldSeparator}%an${gitCommitFieldSeparator}%ad${gitCommitFieldSeparator}%D${gitCommitFieldSeparator}%s${gitCommitFieldSeparator}%B${gitCommitRecordSeparator}`,
    "--date=iso-strict",
  ]);
  const numstatOutput = collectNumstat(repositoryPath, ["diff", "--numstat"]);
  const cachedNumstatOutput = collectNumstat(repositoryPath, ["diff", "--cached", "--numstat"]);
  const fileMap = new Map();

  if (statusOutput) {
    statusOutput.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) {
        return;
      }

      const statusCode = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const filePath = rawPath.includes("->") ? rawPath.split("->").pop().trim() : rawPath;
      const status =
        statusCode === "??"
          ? "UNTRACKED"
          : rawPath.includes("->")
            ? "RENAMED"
            : statusCode.includes("A")
              ? "ADDED"
              : statusCode.includes("D")
                ? "DELETED"
                : "MODIFIED";

      const additions = numstatOutput.get(filePath)?.additions ?? cachedNumstatOutput.get(filePath)?.additions ?? 0;
      const deletions = numstatOutput.get(filePath)?.deletions ?? cachedNumstatOutput.get(filePath)?.deletions ?? 0;

      fileMap.set(filePath, {
        path: filePath,
        additions,
        deletions,
        status,
      });
    });
  }

  const commits = [];
  if (commitOutput) {
    commitOutput.split(gitCommitRecordSeparator).forEach((record) => {
      const normalizedRecord = record.trimEnd();
      if (!normalizedRecord.trim()) {
        return;
      }

      const hashIndex = normalizedRecord.search(/[0-9a-f]{7,40}\x1f/);
      if (hashIndex < 0) {
        return;
      }

      const graph = normalizedRecord.slice(0, hashIndex).trimEnd();
      const [hash, parentText, author, date, refs, message, ...bodyParts] = normalizedRecord
        .slice(hashIndex)
        .split(gitCommitFieldSeparator);
      if (!hash) {
        return;
      }

      const body = bodyParts.join(gitCommitFieldSeparator).trim();

      commits.push({
        hash,
        graph: graph || "*",
        parents: parentText ? parentText.split(" ").filter(Boolean) : [],
        author,
        date,
        refs,
        message: message || body.split(/\r?\n/)[0] || "",
        body: body || message || "",
      });
    });
  }

  const hasMoreCommits = commits.length > limit;
  if (hasMoreCommits) {
    commits.length = limit;
  }

  const branchLine = branchOutput ? branchOutput.split(/\r?\n/)[0] : "";
  const branchMatch = branchLine.match(/^##\s+([^\.\s]+)(?:\.\.\.(?:[^\s]+))?(?:\s+\[(.+)\])?/);
  const branch = branchMatch?.[1] || "main";
  const upstreamInfo = branchMatch?.[2] || "";
  const aheadMatch = upstreamInfo.match(/ahead\s+(\d+)/);
  const behindMatch = upstreamInfo.match(/behind\s+(\d+)/);

  return {
    branch,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    files: Array.from(fileMap.values()),
    commits,
    hasMoreCommits,
    repositoryPath,
    lastRefreshedAt: now,
    statusText: fileMap.size === 0 ? "工作区干净" : `${fileMap.size} 个文件变更`,
  };
}

function runCommand(payload) {
  const resolvedCwd = expandPath(payload.cwd);
  const decodeStdout = createProcessOutputDecoder();
  const decodeStderr = createProcessOutputDecoder();
  const child = spawn(payload.command, {
    cwd: resolvedCwd,
    env: { ...process.env, ...payload.env },
    shell: true,
    windowsHide: true,
  });

  activeProcesses.set(child.pid, child);
  launchedProcessIds.add(child.pid);

  emit({
    type: "started",
    projectId: payload.projectId,
    scriptId: payload.scriptId,
    pid: child.pid,
    message: payload.command,
  });

  child.stdout?.on("data", (chunk) => {
    emit({
      type: "stdout",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: child.pid,
      message: decodeStdout(chunk),
    });
  });

  child.stderr?.on("data", (chunk) => {
    emit({
      type: "stderr",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: child.pid,
      message: decodeStderr(chunk),
    });
  });

  child.on("close", (code, signal) => {
    activeProcesses.delete(child.pid);
    const stoppedByUser = userStoppedProcesses.delete(child.pid);
    emit({
      type: "exit",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: child.pid,
      code,
      signal,
      stoppedByUser,
    });
  });

  return {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    command: payload.command,
    cwd: resolvedCwd,
  };
}

function stopWindowsProcessTree(pid) {
  const script = [
    "$root = [int]$env:UTOOLS_STOP_PID",
    "$seen = New-Object 'System.Collections.Generic.HashSet[int]'",
    "$queue = New-Object 'System.Collections.Generic.Queue[int]'",
    "$queue.Enqueue($root) | Out-Null",
    "while ($queue.Count -gt 0) {",
    "  $current = $queue.Dequeue()",
    '  Get-CimInstance Win32_Process -Filter "ParentProcessId = $current" | ForEach-Object {',
    "    $processId = [int]$_.ProcessId",
    "    if ($seen.Add($processId)) {",
    "      $queue.Enqueue($processId) | Out-Null",
    "    }",
    "  }",
    "}",
    "$seen | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
    "Stop-Process -Id $root -Force -ErrorAction SilentlyContinue",
  ].join("\n");

  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, UTOOLS_STOP_PID: String(pid) },
    stdio: "ignore",
  });
}

function stopProcess(pid) {
  const child = activeProcesses.get(pid);

  if (child) {
    userStoppedProcesses.add(pid);
    if (process.platform === "win32") {
      stopWindowsProcessTree(pid);
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        // ignore
      }
    }
  }

  if (!child) {
    userStoppedProcesses.delete(pid);
    if (process.platform === "win32" && launchedProcessIds.has(pid)) {
      stopWindowsProcessTree(pid);
    }
  }
}

function stopAllProcesses() {
  Array.from(launchedProcessIds.values()).forEach((pid) => stopProcess(pid));
}

function handlePluginOut(isKill) {
  if (isKill === true) {
    stopAllProcesses();
  }
}

function registerProcessCleanupHooks() {
  window.utools?.onPluginOut?.(handlePluginOut);
  process.once?.("SIGINT", () => {
    stopAllProcesses();
    process.exit(130);
  });
  process.once?.("SIGTERM", () => {
    stopAllProcesses();
    process.exit(143);
  });
}

registerProcessCleanupHooks();

window.projectBridge = {
  loadProjects: readProjects,
  saveProjects: writeStoredProjects,
  inspectProjectPath,
  pickProjectPath,
  pathExists,
  loadTerminalPreferences: readTerminalPreferences,
  saveTerminalPreferences: saveTerminalPreferences,
  loadEditorPreferences: readEditorPreferences,
  saveEditorPreferences: saveEditorPreferences,
  loadEnvironmentPreferences: readEnvironmentPreferences,
  saveEnvironmentPreferences: saveEnvironmentPreferences,
  detectEnvironmentTools,
  loadAiPreferences: readAiPreferences,
  saveAiPreferences: saveAiPreferences,
  listAiModels,
  testAiConnection,
  analyzeWithAi,
  exportProjects,
  importProjects,
  readPackageScripts,
  listProjectSubdirectories,
  readGitSnapshot,
  readGitFileDiff,
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
  openTerminal,
  openEditor,
  runCommand,
  stopProcess,
  stopAllProcesses,
  openPath: (targetPath) => shell.openPath(expandPath(targetPath)),
  showItemInFolder: (targetPath) => shell.showItemInFolder(expandPath(targetPath)),
};
