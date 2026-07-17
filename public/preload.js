const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync, execFile, execFileSync } = require("node:child_process");
const { TextDecoder } = require("node:util");
const { shell } = require("electron");

const activeProcesses = new Map();
const activeProcessMetadata = new Map();
const completedProcessResults = new Map();
const completedAutomationProcessResults = new Map();
const completedProcessResultLimit = 100;
const launchedProcessIds = new Set();
const userStoppedProcesses = new Set();
const automationExitMatchedProcesses = new Set();
const storageKey = "utools-project-launch.projects.v1";
const terminalPreferencesStorageKey = "utools-project-launch.settings.v1";
const localTerminalPreferencesStorageKey = "utools-project-launch.local-settings.v1";
const editorPreferencesStorageKey = "utools-project-launch.editor-settings.v1";
const localEditorPreferencesStorageKey = "utools-project-launch.local-editor-settings.v1";
const environmentPreferencesStorageKey = "utools-project-launch.environment-settings.v1";
const aiPreferencesStorageKey = "utools-project-launch.ai-settings.v1";
const deviceIdStorageKey = "utools-project-launch.device-id.v1";
const deviceIdFileName = "device-id.v1";
const projectDocPrefix = "utools-project-launch/project/";
const schemaVersion = 1;
const gitCommitFieldSeparator = "\x1f";
const gitCommitRecordSeparator = "\x1e";
const commonProjectDirs = [".", "frontend", "backend", "client", "server", "api", "src"];
const terminalKinds = new Set(["builtin", "windows-terminal", "powershell", "cmd", "custom"]);
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

function readTerminalPreferences() {
  try {
    const raw =
      window.localStorage?.getItem(localTerminalPreferencesStorageKey) ||
      window.localStorage?.getItem(terminalPreferencesStorageKey);
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
    window.localStorage?.setItem(localTerminalPreferencesStorageKey, JSON.stringify(normalized));
  } catch (error) {
    // Keep settings updates non-blocking in browser preview and uTools fallback modes.
  }
}

function readEditorPreferences() {
  try {
    const raw =
      window.localStorage?.getItem(localEditorPreferencesStorageKey) ||
      window.localStorage?.getItem(editorPreferencesStorageKey);
    return raw ? normalizeEditorPreferences(JSON.parse(raw)) : getDefaultEditorPreferences();
  } catch (error) {
    return getDefaultEditorPreferences();
  }
}

function saveEditorPreferences(preferences) {
  const normalized = normalizeEditorPreferences(preferences);
  try {
    window.localStorage?.setItem(localEditorPreferencesStorageKey, JSON.stringify(normalized));
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
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timeout = null;
    let timedOut = false;
    let settled = false;
    const decodeStdout = createProcessOutputDecoder();
    const decodeStderr = createProcessOutputDecoder();

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    try {
      const commandLine = [command, ...args].map(quoteShellToken).join(" ");
      const shellPath = process.env.SHELL || "/bin/sh";
      const shellName = path.basename(shellPath);
      const child =
        process.platform === "win32"
          ? spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: true })
          : spawn(shellPath, [shellName === "sh" ? "-lc" : "-ilc", commandLine], {
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
            });
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 5000);

      child.stdout?.on("data", (chunk) => {
        stdout += decodeStdout(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += decodeStderr(chunk);
      });
      child.on("error", (error) => {
        finish({ error, stdout, stderr });
      });
      child.on("close", (status) => {
        finish({
          status,
          stdout,
          stderr,
          error: timedOut ? new Error(`Command timed out after 5000ms: ${command}`) : undefined,
        });
      });
    } catch (error) {
      finish({ error, stdout, stderr });
    }
  });
}

async function detectEnvironmentTools(toolKeys) {
  const requestedKeys =
    Array.isArray(toolKeys) && toolKeys.length > 0 ? toolKeys : readEnvironmentPreferences().enabledToolKeys;
  return Promise.all(
    requestedKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(environmentTools, key))
      .map(async (key) => {
        const tool = environmentTools[key];
        const checkedAt = new Date().toISOString();
        const versionResult = await runToolCommand(tool.command, tool.versionArgs);
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
        const pathResult = await runToolCommand(pathCommand, pathArgs);
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
      }),
  );
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

function normalizeAiBaseUrl(preferences) {
  return String(preferences.baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
}

function getAiHeaders(preferences) {
  if (preferences.provider === "anthropic-compatible") {
    return {
      "content-type": "application/json",
      "x-api-key": preferences.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${preferences.apiKey}`,
  };
}

function extractAiErrorMessage(data, fallback) {
  return (
    data?.error?.message ||
    data?.error?.error?.message ||
    data?.message ||
    data?.detail ||
    data?.type ||
    fallback ||
    "AI 请求失败。"
  );
}

async function parseAiHttpError(response) {
  const data = await response.json().catch(() => ({}));
  return extractAiErrorMessage(data, response.statusText || `HTTP ${response.status}`);
}

async function listAiModels(preferences) {
  const normalized = normalizeAiPreferences(preferences || readAiPreferences());
  if (normalized.provider === "utools") {
    if (!window.utools?.allAiModels) {
      return [];
    }
    return normalizeAiModelCollection(await window.utools.allAiModels(), "utools");
  }

  const baseUrl = normalizeAiBaseUrl(normalized);
  if (!baseUrl || !normalized.apiKey.trim()) {
    return [];
  }

  const response = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: getAiHeaders(normalized),
  });
  if (!response.ok) {
    throw new Error(await parseAiHttpError(response));
  }
  const data = await response.json().catch(() => ({}));
  return normalizeAiModelCollection(data?.data || data?.models || data, normalized.provider);
}

async function testAiConnection(preferences) {
  const normalized = normalizeAiPreferences(preferences || readAiPreferences());
  try {
    if (normalized.provider === "utools") {
      if (!normalized.model.trim()) {
        return { ok: false, message: "请先选择一个 uTools 内置 AI 模型。" };
      }
      if (!window.utools?.ai) {
        return { ok: false, message: "当前 uTools 版本不支持内置 AI 请求。" };
      }
      const result = await window.utools.ai({
        model: normalized.model,
        messages: [{ role: "user", content: "ping" }],
      });
      const content = String(result?.content || result?.text || result || "").trim();
      return {
        ok: true,
        message: content
          ? "uTools 内置 AI 连接测试成功，模型已返回响应。"
          : "uTools 内置 AI 连接成功，但模型返回为空。",
      };
    }

    if (!normalized.baseUrl.trim() || !normalized.model.trim() || !normalized.apiKey.trim()) {
      return { ok: false, message: "第三方 AI 配置不完整，无法测试。" };
    }

    const baseUrl = normalizeAiBaseUrl(normalized);
    const response = await fetch(
      `${baseUrl}${normalized.provider === "anthropic-compatible" ? "/messages" : "/chat/completions"}`,
      {
        method: "POST",
        headers: getAiHeaders(normalized),
        body:
          normalized.provider === "anthropic-compatible"
            ? JSON.stringify({ model: normalized.model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] })
            : JSON.stringify({ model: normalized.model, messages: [{ role: "user", content: "ping" }], max_tokens: 8 }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractAiErrorMessage(data, response.statusText || "AI 连接测试失败。"));
    }
    const content =
      normalized.provider === "anthropic-compatible"
        ? Array.isArray(data.content)
          ? data.content.map((part) => part.text || "").join("")
          : ""
        : String(data?.choices?.[0]?.message?.content || "");
    return { ok: true, message: content ? "AI 连接测试成功，模型已返回响应。" : "AI 连接成功，但模型返回为空。" };
  } catch (error) {
    return { ok: false, message: error?.message || "AI 连接测试失败。" };
  }
}

async function callThirdPartyAi(preferences, prompt) {
  const baseUrl = normalizeAiBaseUrl(preferences);
  if (preferences.provider === "anthropic-compatible") {
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: getAiHeaders(preferences),
      body: JSON.stringify({
        model: preferences.model,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(extractAiErrorMessage(data, response.statusText));
    return Array.isArray(data.content)
      ? data.content
          .map((part) => part.text || "")
          .join("\n")
          .trim()
      : "";
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: getAiHeaders(preferences),
    body: JSON.stringify({ model: preferences.model, messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(extractAiErrorMessage(data, response.statusText));
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

function aiText(value) {
  return typeof value === "string" ? value : "";
}

function compactAiStreamChunk(chunk) {
  if (typeof chunk === "string") {
    return { content: chunk, reasoning: "", rawContent: chunk };
  }
  const content = aiText(chunk?.content);
  const reasoning = aiText(chunk?.reasoning);
  const rawContent = aiText(chunk?.rawContent) || `${reasoning}${content}`;
  return { content, reasoning, rawContent };
}

function extractOpenAiStreamDelta(data) {
  if (data?.error) {
    throw new Error(extractAiErrorMessage(data, "OpenAI 兼容流式响应失败。"));
  }
  const choice = data?.choices?.[0] || {};
  const delta = choice.delta || {};
  const content = aiText(delta.content) || aiText(choice.text);
  const reasoning = [delta.reasoning_content, delta.reasoning, delta.thinking].map(aiText).filter(Boolean).join("");
  return compactAiStreamChunk({ content, reasoning });
}

function extractAnthropicStreamDelta(data) {
  if (data?.type === "error" || data?.error) {
    throw new Error(extractAiErrorMessage(data, "Anthropic 兼容流式响应失败。"));
  }
  if (data?.type === "content_block_delta") {
    const delta = data?.delta || {};
    return compactAiStreamChunk({
      content: aiText(delta.text),
      reasoning: aiText(delta.thinking),
    });
  }
  if (data?.type === "content_block_start") {
    const contentBlock = data?.content_block || {};
    return compactAiStreamChunk({
      content: aiText(contentBlock.text),
      reasoning: aiText(contentBlock.thinking),
    });
  }
  return compactAiStreamChunk({});
}

async function readSseStream(response, extractDelta, onChunk) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error("当前运行环境不支持 AI 流式响应。");
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let reasoning = "";
  let rawContent = "";

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      return;
    }
    try {
      const streamChunk = compactAiStreamChunk(extractDelta(JSON.parse(payload)));
      if (streamChunk.content || streamChunk.reasoning || streamChunk.rawContent) {
        content += streamChunk.content;
        reasoning += streamChunk.reasoning;
        rawContent += streamChunk.rawContent;
        onChunk?.(streamChunk);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        return;
      }
      throw error;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    lines.forEach(consumeLine);
    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    consumeLine(buffer);
  }

  return { content: content.trim(), reasoning: reasoning.trim(), rawContent: rawContent.trim() };
}

async function callThirdPartyAiStream(preferences, prompt, onChunk) {
  const baseUrl = normalizeAiBaseUrl(preferences);
  if (preferences.provider === "anthropic-compatible") {
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: getAiHeaders(preferences),
      body: JSON.stringify({
        model: preferences.model,
        max_tokens: 1200,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      throw new Error(await parseAiHttpError(response));
    }
    return readSseStream(response, extractAnthropicStreamDelta, onChunk);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: getAiHeaders(preferences),
    body: JSON.stringify({
      model: preferences.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      stream: true,
    }),
  });
  if (!response.ok) {
    throw new Error(await parseAiHttpError(response));
  }
  return readSseStream(response, extractOpenAiStreamDelta, onChunk);
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

async function analyzeWithAiStream(payload, onChunk, onDone) {
  const preferences = normalizeAiPreferences(payload?.preferences || readAiPreferences());
  const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
  const done = typeof onDone === "function" ? onDone : () => undefined;
  const chunk = typeof onChunk === "function" ? onChunk : () => undefined;
  if (!prompt) {
    done({ ok: false, content: "", message: "AI 分析内容为空。" });
    return;
  }
  try {
    if (preferences.provider === "utools") {
      if (!window.utools?.ai) {
        done({ ok: false, content: "", message: "当前 uTools 版本不支持内置 AI。" });
        return;
      }
      let content = "";
      let reasoning = "";
      let rawContent = "";
      await window.utools.ai(
        {
          model: preferences.model || undefined,
          messages: [{ role: "user", content: prompt }],
        },
        (delta) => {
          const streamChunk =
            typeof delta === "string"
              ? compactAiStreamChunk({ content: delta })
              : compactAiStreamChunk({
                  content: aiText(delta?.content) || aiText(delta?.text),
                  reasoning: aiText(delta?.reasoning_content) || aiText(delta?.reasoning) || aiText(delta?.thinking),
                });
          if (streamChunk.content || streamChunk.reasoning || streamChunk.rawContent) {
            content += streamChunk.content;
            reasoning += streamChunk.reasoning;
            rawContent += streamChunk.rawContent;
            chunk(streamChunk);
          }
        },
      );
      done({ ok: true, content: content.trim(), reasoning: reasoning.trim(), rawContent: rawContent.trim() });
      return;
    }
    if (!preferences.baseUrl.trim() || !preferences.model.trim() || !preferences.apiKey.trim()) {
      done({ ok: false, content: "", message: "第三方 AI 配置不完整。" });
      return;
    }
    const result = await callThirdPartyAiStream(preferences, prompt, chunk);
    done({ ok: true, ...result });
  } catch (error) {
    done({ ok: false, content: "", message: error?.message || "AI 分析失败。" });
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

function quoteShellToken(token) {
  return `'${String(token).replace(/'/g, `'\\''`)}'`;
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

function findGitRootAsync(startPath) {
  const resolvedPath = expandPath(startPath);

  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", resolvedPath, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", windowsHide: true },
      (error, stdout) => {
        resolve(error ? null : String(stdout || "").trim());
      },
    );
  });
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

function runGitAsync(startPath, args) {
  const resolvedPath = expandPath(startPath);

  return new Promise((resolve) => {
    execFile("git", ["-C", resolvedPath, ...args], { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      resolve(error ? null : String(stdout || ""));
    });
  });
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

function runGitResult(startPath, args) {
  const resolvedPath = expandPath(startPath);
  const result = spawnSync("git", ["-C", resolvedPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: typeof result.status === "number" ? result.status : result.error ? 1 : 0,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || result.error?.message || ""),
  };
}

function runGitRemoteCommandResult(startPath, args) {
  const resolvedPath = expandPath(startPath);

  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", resolvedPath, ...args],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
        timeout: 120000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const status = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        const timeoutMessage = error?.killed ? "远程 Git 操作超时，请检查网络或认证配置。" : "";
        resolve({
          status,
          stdout: String(stdout || ""),
          stderr: String(stderr || timeoutMessage || error?.message || ""),
        });
      },
    );
  });
}

function firstGitError(result, fallback) {
  return String(result.stderr || result.stdout || fallback || "Git 操作失败。").trim();
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

async function collectNumstatAsync(startPath, args) {
  const output = await runGitAsync(startPath, args);
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

function parseGitStatusRecord(statusCode, filePath, originalPath = "") {
  if (!statusCode || !filePath) {
    return null;
  }

  const status =
    statusCode === "??"
      ? "UNTRACKED"
      : statusCode.includes("R")
        ? "RENAMED"
        : statusCode.includes("A")
          ? "ADDED"
          : statusCode.includes("D")
            ? "DELETED"
            : "MODIFIED";

  return {
    statusCode,
    path: filePath,
    status,
    staged: statusCode[0] !== " " && statusCode[0] !== "?",
    unstaged: statusCode[1] !== " " || statusCode === "??",
    originalPath: originalPath || undefined,
  };
}

function readGitStatusEntries(repositoryPath) {
  const statusOutput = runGit(repositoryPath, ["status", "--porcelain=v1", "-z"]);
  if (!statusOutput) {
    return [];
  }

  const records = statusOutput.split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const statusCode = record.slice(0, 2);
    const filePath = record.slice(3);
    const originalPath = statusCode.includes("R") ? records[++index] || "" : "";
    const entry = parseGitStatusRecord(statusCode, filePath, originalPath);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

async function readGitStatusEntriesAsync(repositoryPath) {
  const statusOutput = await runGitAsync(repositoryPath, ["status", "--porcelain=v1", "-z"]);
  if (!statusOutput) {
    return [];
  }

  const records = statusOutput.split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const statusCode = record.slice(0, 2);
    const filePath = record.slice(3);
    const originalPath = statusCode.includes("R") ? records[++index] || "" : "";
    const entry = parseGitStatusRecord(statusCode, filePath, originalPath);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

function readGitBranches(repositoryPath) {
  const output = runGit(repositoryPath, ["branch", "--format=%(refname:short)%09%(HEAD)"]);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => {
      const [name, marker] = line.split("\t");
      const branchName = String(name || "").trim();
      return branchName ? { name: branchName, current: String(marker || "").trim() === "*" } : null;
    })
    .filter(Boolean);
}

async function readGitBranchesAsync(repositoryPath) {
  const output = await runGitAsync(repositoryPath, ["branch", "--format=%(refname:short)%09%(HEAD)"]);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => {
      const [name, marker] = line.split("\t");
      const branchName = String(name || "").trim();
      return branchName ? { name: branchName, current: String(marker || "").trim() === "*" } : null;
    })
    .filter(Boolean);
}

async function readGitRemotesAsync(repositoryPath) {
  const output = await runGitAsync(repositoryPath, ["remote", "-v"]);
  if (!output) {
    return [];
  }

  const remotes = new Map();
  output.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^(\S+)\s+(.+)\s+\((fetch|push)\)$/);
    if (!match) {
      return;
    }
    const [, name, url, kind] = match;
    const current = remotes.get(name) || { name, fetchUrl: "", pushUrl: "" };
    if (kind === "fetch") {
      current.fetchUrl = url.trim();
    } else {
      current.pushUrl = url.trim();
    }
    remotes.set(name, current);
  });

  return Array.from(remotes.values()).map((remote) => ({
    ...remote,
    pushUrl: remote.pushUrl || remote.fetchUrl,
  }));
}

async function readGitUpstreamAsync(repositoryPath) {
  const ref = String(
    (await runGitAsync(repositoryPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])) || "",
  ).trim();
  if (!ref || !ref.includes("/")) {
    return null;
  }

  const [remote, ...branchParts] = ref.split("/");
  const branch = branchParts.join("/");
  if (!remote || !branch) {
    return null;
  }

  const counts = String(
    (await runGitAsync(repositoryPath, ["rev-list", "--left-right", "--count", "HEAD...@{u}"])) || "",
  )
    .trim()
    .split(/\s+/);
  const ahead = Number(counts[0]) || 0;
  const behind = Number(counts[1]) || 0;

  return { remote, branch, ref, ahead, behind };
}

function normalizeGitRemoteName(remoteName) {
  return typeof remoteName === "string" ? remoteName.trim() : "";
}

function normalizeGitRemoteUrl(remoteUrl) {
  return typeof remoteUrl === "string" ? remoteUrl.trim() : "";
}

function validateGitRemoteName(remoteName) {
  if (!remoteName) {
    return "请输入 remote 名称。";
  }
  if (remoteName.startsWith("-")) {
    return "remote 名称不能以 - 开头。";
  }
  if (!/^[A-Za-z0-9._-]+$/.test(remoteName)) {
    return "remote 名称只能包含字母、数字、点、下划线和短横线。";
  }
  return "";
}

function validateGitRemoteUrl(remoteUrl) {
  if (!remoteUrl) {
    return "请输入 remote URL。";
  }
  if (/[\u0000-\u001f\u007f]/.test(remoteUrl)) {
    return "remote URL 不能包含控制字符。";
  }
  return "";
}

async function resolveGitRemoteOperation(projectPath) {
  const repositoryPath = await findGitRootAsync(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  const upstream = await readGitUpstreamAsync(repositoryPath);
  if (!upstream) {
    return { ok: false, repositoryPath, message: "当前分支未设置 upstream，无法执行远程操作。" };
  }

  return { ok: true, repositoryPath, upstream };
}

async function runGitRemoteResult(projectPath, args, successMessage) {
  const remoteContext = await resolveGitRemoteOperation(projectPath);
  if (!remoteContext.ok) {
    return { ok: false, message: remoteContext.message };
  }

  const result = await runGitRemoteCommandResult(remoteContext.repositoryPath, args(remoteContext.upstream));
  return result.status === 0
    ? {
        ok: true,
        remote: remoteContext.upstream.remote,
        branch: remoteContext.upstream.branch,
        message: successMessage(remoteContext.upstream),
      }
    : {
        ok: false,
        remote: remoteContext.upstream.remote,
        branch: remoteContext.upstream.branch,
        message: firstGitError(result, "远程 Git 操作失败。"),
      };
}

function readGitLocalBranchTips(repositoryPath) {
  const output = runGit(repositoryPath, ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads"]);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => {
      const [name, hash] = line.split("\t");
      const branchName = String(name || "").trim();
      const branchHash = String(hash || "").trim();
      return branchName && branchHash ? { name: branchName, hash: branchHash } : null;
    })
    .filter(Boolean);
}

function chooseGitBranchTip(repositoryPath, commitHash, preferredBranch = "") {
  const fullHash = (runGit(repositoryPath, ["rev-parse", `${commitHash}^{commit}`]) || "").trim();
  if (!fullHash) {
    return null;
  }

  const matchingBranches = readGitLocalBranchTips(repositoryPath).filter((branch) => branch.hash === fullHash);
  if (matchingBranches.length === 0) {
    return null;
  }

  const symbolicBranch = (runGit(repositoryPath, ["symbolic-ref", "--short", "-q", "HEAD"]) || "").trim();
  const preferredNames = [preferredBranch, symbolicBranch, "main", "master", "develop"].filter(
    (name) => typeof name === "string" && name.trim() && name !== "HEAD",
  );
  for (const preferredName of preferredNames) {
    const match = matchingBranches.find((branch) => branch.name === preferredName);
    if (match) {
      return match;
    }
  }

  return matchingBranches[0];
}

function resolveGitFilePath(repositoryPath, relativePath) {
  const resolved = resolveProjectChild(repositoryPath, relativePath);
  if (!resolved.relativePath) {
    throw new Error("请选择一个仓库内文件。");
  }
  return resolved;
}

function getGitFileStatus(repositoryPath, relativePath) {
  const normalizedPath = String(relativePath || "").replace(/\\/g, "/");
  return readGitStatusEntries(repositoryPath).find((entry) => entry.path === normalizedPath) || null;
}

function gitFileActionPaths(repositoryPath, status, fallbackPath) {
  const paths = status?.originalPath ? [status.originalPath, status.path] : [fallbackPath];
  return paths.map((filePath) => resolveGitFilePath(repositoryPath, filePath).relativePath);
}

function uniqueGitActionPaths(repositoryPath, relativePaths, filterStatus) {
  const actionPaths = new Set();
  const displayPaths = [];
  const requestedPaths = Array.isArray(relativePaths) ? relativePaths : [];

  requestedPaths.forEach((relativePath) => {
    const resolved = resolveGitFilePath(repositoryPath, relativePath);
    const status = getGitFileStatus(repositoryPath, resolved.relativePath);
    if (!filterStatus(status, resolved.relativePath)) {
      return;
    }
    gitFileActionPaths(repositoryPath, status, resolved.relativePath).forEach((filePath) => actionPaths.add(filePath));
    displayPaths.push(resolved.relativePath);
  });

  return { actionPaths: Array.from(actionPaths), displayPaths: Array.from(new Set(displayPaths)) };
}

function allGitActionPaths(repositoryPath, filterStatus) {
  const actionPaths = new Set();
  const displayPaths = [];
  readGitStatusEntries(repositoryPath).forEach((status) => {
    if (!filterStatus(status, status.path)) {
      return;
    }
    gitFileActionPaths(repositoryPath, status, status.path).forEach((filePath) => actionPaths.add(filePath));
    displayPaths.push(status.path);
  });

  return { actionPaths: Array.from(actionPaths), displayPaths: Array.from(new Set(displayPaths)) };
}

function hasUncommittedGitChanges(repositoryPath) {
  const status = runGit(repositoryPath, ["status", "--porcelain"]);
  return Boolean(status && status.trim());
}

function fileExistsInHead(repositoryPath, relativePath) {
  const result = runGitResult(repositoryPath, ["cat-file", "-e", `HEAD:${relativePath}`]);
  return result.status === 0;
}

function removeGitWorktreePath(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  const stats = fs.statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error("暂不支持从 Git 面板丢弃未跟踪目录或非普通文件，请在文件系统中确认后手动处理。");
  }
  fs.rmSync(targetPath, { force: true });
}

function truncateGitDiff(diff, maxLength = 18000) {
  if (diff.length <= maxLength) {
    return { diff, truncated: false };
  }
  return {
    diff: `${diff.slice(0, maxLength)}\n\n[diff 已截断，仅保留前 ${maxLength} 个字符]`,
    truncated: true,
  };
}

function readUntrackedFileDiffs(repositoryPath) {
  return readGitStatusEntries(repositoryPath)
    .filter((entry) => entry.status === "UNTRACKED")
    .map((entry) => {
      const resolved = resolveProjectChild(repositoryPath, entry.path);
      if (!fs.existsSync(resolved.targetPath) || !fs.statSync(resolved.targetPath).isFile()) {
        return `diff --git a/${entry.path} b/${entry.path}\nnew file mode 000000\n--- /dev/null\n+++ b/${entry.path}\n@@\n[未跟踪目录或非普通文件，已跳过内容 diff]`;
      }
      return runGitDiff(repositoryPath, ["diff", "--no-index", "--", os.devNull, entry.path]) || "";
    })
    .filter(Boolean);
}

function readGitCommitMessageDiff(projectPath) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, scope: "working-tree", diff: "", message: "未检测到 Git 仓库。" };
  }

  const stagedDiff = runGitDiff(repositoryPath, ["diff", "--cached"]);
  if (stagedDiff && stagedDiff.trim()) {
    return { ok: true, scope: "staged", ...truncateGitDiff(stagedDiff) };
  }

  const workingDiff = [runGitDiff(repositoryPath, ["diff"]), ...readUntrackedFileDiffs(repositoryPath)]
    .filter(Boolean)
    .join("\n");
  if (!workingDiff.trim()) {
    return { ok: false, scope: "working-tree", diff: "", message: "当前没有可用于生成提交信息的 diff。" };
  }

  return { ok: true, scope: "working-tree", ...truncateGitDiff(workingDiff) };
}

function stageGitFile(projectPath, relativePath) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  try {
    const resolved = resolveGitFilePath(repositoryPath, relativePath);
    const status = getGitFileStatus(repositoryPath, resolved.relativePath);
    const actionPaths = gitFileActionPaths(repositoryPath, status, resolved.relativePath);
    const result = runGitResult(repositoryPath, ["add", "--", ...actionPaths]);
    return result.status === 0
      ? { ok: true, path: resolved.relativePath, message: "已暂存文件变更。" }
      : { ok: false, path: resolved.relativePath, message: firstGitError(result, "暂存文件失败。") };
  } catch (error) {
    return { ok: false, message: error?.message || "暂存文件失败。" };
  }
}

function unstageGitFile(projectPath, relativePath) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  try {
    const resolved = resolveGitFilePath(repositoryPath, relativePath);
    const status = getGitFileStatus(repositoryPath, resolved.relativePath);
    const actionPaths = gitFileActionPaths(repositoryPath, status, resolved.relativePath);
    const result = runGitResult(repositoryPath, ["reset", "-q", "HEAD", "--", ...actionPaths]);
    return result.status === 0
      ? { ok: true, path: resolved.relativePath, message: "已取消暂存文件。" }
      : { ok: false, path: resolved.relativePath, message: firstGitError(result, "取消暂存失败。") };
  } catch (error) {
    return { ok: false, message: error?.message || "取消暂存失败。" };
  }
}

function discardGitFile(projectPath, relativePath) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  try {
    const resolved = resolveGitFilePath(repositoryPath, relativePath);
    const status = getGitFileStatus(repositoryPath, resolved.relativePath);
    if (!status) {
      return { ok: true, path: resolved.relativePath, message: "该文件没有可丢弃的变更。" };
    }

    if (
      status.status === "UNTRACKED" ||
      (status.statusCode[0] === "A" && !fileExistsInHead(repositoryPath, resolved.relativePath))
    ) {
      if (status.staged) {
        runGitResult(repositoryPath, ["reset", "-q", "HEAD", "--", resolved.relativePath]);
      }
      removeGitWorktreePath(resolved.targetPath);
      return { ok: true, path: resolved.relativePath, message: "已丢弃该文件变更。" };
    }

    const actionPaths = gitFileActionPaths(repositoryPath, status, resolved.relativePath);
    const result = runGitResult(repositoryPath, ["restore", "--staged", "--worktree", "--", ...actionPaths]);
    return result.status === 0
      ? { ok: true, path: resolved.relativePath, message: "已丢弃该文件变更。" }
      : { ok: false, path: resolved.relativePath, message: firstGitError(result, "丢弃文件变更失败。") };
  } catch (error) {
    return { ok: false, message: error?.message || "丢弃文件变更失败。" };
  }
}

function stageGitFiles(projectPath, relativePaths, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  try {
    const filterStatus = (status) =>
      Boolean(status && (status.unstaged || (!status.staged && status.unstaged !== false)));
    const { actionPaths, displayPaths } = options?.all
      ? allGitActionPaths(repositoryPath, filterStatus)
      : uniqueGitActionPaths(repositoryPath, relativePaths, filterStatus);
    if (actionPaths.length === 0) {
      return { ok: false, count: 0, paths: [], message: "没有可暂存的文件变更。" };
    }
    const result = runGitResult(repositoryPath, ["add", "--", ...actionPaths]);
    return result.status === 0
      ? { ok: true, count: displayPaths.length, paths: displayPaths, message: `已暂存 ${displayPaths.length} 个文件。` }
      : {
          ok: false,
          count: displayPaths.length,
          paths: displayPaths,
          message: firstGitError(result, "批量暂存失败。"),
        };
  } catch (error) {
    return { ok: false, message: error?.message || "批量暂存失败。" };
  }
}

function unstageGitFiles(projectPath, relativePaths, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }

  try {
    const filterStatus = (status) => Boolean(status?.staged);
    const { actionPaths, displayPaths } = options?.all
      ? allGitActionPaths(repositoryPath, filterStatus)
      : uniqueGitActionPaths(repositoryPath, relativePaths, filterStatus);
    if (actionPaths.length === 0) {
      return { ok: false, count: 0, paths: [], message: "没有可取消暂存的文件。" };
    }
    const result = runGitResult(repositoryPath, ["reset", "-q", "HEAD", "--", ...actionPaths]);
    return result.status === 0
      ? {
          ok: true,
          count: displayPaths.length,
          paths: displayPaths,
          message: `已取消暂存 ${displayPaths.length} 个文件。`,
        }
      : {
          ok: false,
          count: displayPaths.length,
          paths: displayPaths,
          message: firstGitError(result, "批量取消暂存失败。"),
        };
  } catch (error) {
    return { ok: false, message: error?.message || "批量取消暂存失败。" };
  }
}

function discardGitFiles(projectPath, relativePaths, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const requestedPaths =
    options?.all && repositoryPath
      ? allGitActionPaths(repositoryPath, (status) => Boolean(status)).displayPaths
      : Array.isArray(relativePaths)
        ? Array.from(new Set(relativePaths))
        : [];
  if (requestedPaths.length === 0) {
    return { ok: false, count: 0, paths: [], message: "没有可丢弃的文件变更。" };
  }

  const succeededPaths = [];
  for (const relativePath of requestedPaths) {
    const result = discardGitFile(projectPath, relativePath);
    if (!result.ok) {
      return {
        ...result,
        count: succeededPaths.length,
        paths: succeededPaths,
        message:
          succeededPaths.length > 0 ? `${result.message}（已先丢弃 ${succeededPaths.length} 个文件）` : result.message,
      };
    }
    if (result.path) {
      succeededPaths.push(result.path);
    }
  }

  return {
    ok: true,
    count: succeededPaths.length,
    paths: succeededPaths,
    message: succeededPaths.length > 0 ? `已丢弃 ${succeededPaths.length} 个文件变更。` : "没有可丢弃的文件变更。",
  };
}

function commitGitStaged(projectPath, message) {
  const repositoryPath = findGitRoot(projectPath);
  const commitMessage = typeof message === "string" ? message.trim() : "";
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (!commitMessage) {
    return { ok: false, message: "请先填写 commit message。" };
  }

  const stagedDiff = runGitDiff(repositoryPath, ["diff", "--cached"]);
  if (!stagedDiff || !stagedDiff.trim()) {
    return { ok: false, message: "没有 staged 变更可提交。" };
  }

  const result = runGitResult(repositoryPath, ["commit", "-m", commitMessage]);
  if (result.status !== 0) {
    return { ok: false, message: firstGitError(result, "提交失败。") };
  }

  const commitHash = (runGit(repositoryPath, ["rev-parse", "--short", "HEAD"]) || "").trim();
  return { ok: true, commitHash, message: commitHash ? `提交成功：${commitHash}` : "提交成功。" };
}

function switchGitBranch(projectPath, branchName, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const targetBranch = typeof branchName === "string" ? branchName.trim() : "";
  const force = Boolean(options && options.force);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (!targetBranch) {
    return { ok: false, message: "请选择要切换的本地分支。" };
  }
  if (!force && hasUncommittedGitChanges(repositoryPath)) {
    return { ok: false, message: "当前工作区存在未提交变更，请先提交、暂存或丢弃后再切换分支。" };
  }

  const branches = readGitBranches(repositoryPath);
  const branch = branches.find((item) => item.name === targetBranch);
  if (!branch) {
    return { ok: false, message: "只能切换到已有本地分支。" };
  }
  if (branch.current) {
    return { ok: true, branch: targetBranch, message: "已经位于该分支。" };
  }

  const result = runGitResult(
    repositoryPath,
    force ? ["switch", "--discard-changes", "--", targetBranch] : ["switch", "--", targetBranch],
  );
  return result.status === 0
    ? {
        ok: true,
        branch: targetBranch,
        message: force ? `已强制切换到 ${targetBranch}。` : `已切换到 ${targetBranch}。`,
      }
    : { ok: false, branch: targetBranch, message: firstGitError(result, "切换分支失败。") };
}

function checkoutGitCommit(projectPath, commitHash, options = {}) {
  const repositoryPath = findGitRoot(projectPath);
  const targetHash = typeof commitHash === "string" ? commitHash.trim() : "";
  const force = Boolean(options && options.force);
  const preferredBranch = typeof options?.preferredBranch === "string" ? options.preferredBranch.trim() : "";
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (!/^[0-9a-fA-F]{7,40}$/.test(targetHash)) {
    return { ok: false, message: "请选择一个有效的提交 hash。" };
  }
  if (!force && hasUncommittedGitChanges(repositoryPath)) {
    return {
      ok: false,
      commitHash: targetHash,
      message: "当前工作区存在未提交变更，请先提交、暂存或丢弃后再切换提交。",
    };
  }

  const existsResult = runGitResult(repositoryPath, ["cat-file", "-e", `${targetHash}^{commit}`]);
  if (existsResult.status !== 0) {
    return { ok: false, commitHash: targetHash, message: "该提交不存在或不是有效 commit。" };
  }

  const branchTip = chooseGitBranchTip(repositoryPath, targetHash, preferredBranch);
  if (branchTip) {
    const branchResult = runGitResult(
      repositoryPath,
      force ? ["switch", "--discard-changes", "--", branchTip.name] : ["switch", "--", branchTip.name],
    );
    if (branchResult.status !== 0) {
      return {
        ok: false,
        branch: branchTip.name,
        commitHash: targetHash,
        message: firstGitError(branchResult, "切换分支失败。"),
      };
    }

    const headHash = (runGit(repositoryPath, ["rev-parse", "--short", "HEAD"]) || targetHash).trim();
    return {
      ok: true,
      branch: branchTip.name,
      commitHash: headHash,
      isDetachedHead: false,
      message: headHash
        ? `已切换到本地分支 ${branchTip.name}（${headHash}）。`
        : `已切换到本地分支 ${branchTip.name}。`,
    };
  }

  const result = runGitResult(
    repositoryPath,
    force ? ["switch", "--discard-changes", "--detach", targetHash] : ["switch", "--detach", targetHash],
  );
  if (result.status !== 0) {
    return { ok: false, commitHash: targetHash, message: firstGitError(result, "切换到提交失败。") };
  }

  const headHash = (runGit(repositoryPath, ["rev-parse", "--short", "HEAD"]) || targetHash).trim();
  return {
    ok: true,
    commitHash: headHash,
    isDetachedHead: true,
    message: headHash ? `已切换到提交 ${headHash}，当前为 detached HEAD。` : "已切换到该提交，当前为 detached HEAD。",
  };
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

function resolveProjectSortOrder(project, fallbackIndex = 0) {
  const sortOrder = Number(project?.sortOrder);
  return Number.isFinite(sortOrder) ? sortOrder : fallbackIndex;
}

function sortProjectsByStoredOrder(projects) {
  return projects
    .map((project, index) => ({ project, index }))
    .sort((left, right) => {
      const sortDelta =
        resolveProjectSortOrder(left.project, left.index) - resolveProjectSortOrder(right.project, right.index);
      return sortDelta || left.index - right.index;
    })
    .map((entry) => entry.project);
}

function normalizeQuickLink(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProjectGroup(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isExternalUrl(value) {
  return /^(?:https?:)?\/\//i.test(value) || /^(?:mailto|utools):/i.test(value);
}

function openPath(targetPath) {
  const normalizedPath = String(targetPath || "").trim();
  if (!normalizedPath) {
    return Promise.resolve();
  }

  if (isExternalUrl(normalizedPath)) {
    return shell.openExternal(normalizedPath.startsWith("//") ? `https:${normalizedPath}` : normalizedPath);
  }

  return shell.openPath(expandPath(normalizedPath));
}

function toStoredProject(project, index = 0) {
  const visibility = project.visibility === "private" ? "private" : "public";
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    visibility,
    ownerDeviceId: project.ownerDeviceId || getCurrentDeviceId(),
    type: project.type || "Custom",
    kind: project.kind || "custom",
    icon: project.icon || "custom",
    cardStyle: project.cardStyle || "default",
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
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
    automationTasks: Array.isArray(project.automationTasks)
      ? project.automationTasks.map((task) => ({
          ...task,
          missedPolicy: task.missedPolicy || "grace-run",
          missedGraceMinutes: Number.isFinite(task.missedGraceMinutes)
            ? Math.max(0, Math.floor(task.missedGraceMinutes))
            : 5,
          history: Array.isArray(task.history) ? task.history.slice(0, 20) : [],
          dailyPlans: Array.isArray(task.dailyPlans) ? task.dailyPlans : [],
          inputConfigs: Array.isArray(task.inputConfigs) ? task.inputConfigs : [],
          exitConfigs: Array.isArray(task.exitConfigs) ? task.exitConfigs : [],
        }))
      : [],
    env: project.env || {},
    memo: project.memo || "",
    todos: Array.isArray(project.todos) ? project.todos : [],
    gitLatestCommitAt: project.gitLatestCommitAt || project.git?.commits?.[0]?.date || "",
    sortOrder: resolveProjectSortOrder(project, index),
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

function normalizeStoredProjects(projects, fallbackIndexOffset = 0) {
  return Array.isArray(projects)
    ? projects.map((project, index) => toStoredProject(project, fallbackIndexOffset + index))
    : [];
}

function mergeStoredProjects(legacyProjects, docProjects) {
  const mergedByProjectId = new Map();

  normalizeStoredProjects(legacyProjects).forEach((project) => {
    if (typeof project.id === "string" && project.id) {
      mergedByProjectId.set(project.id, project);
    }
  });

  normalizeStoredProjects(docProjects, Array.isArray(legacyProjects) ? legacyProjects.length : 0).forEach((project) => {
    if (typeof project.id === "string" && project.id) {
      mergedByProjectId.set(project.id, project);
    }
  });

  return sortProjectsByStoredOrder(Array.from(mergedByProjectId.values()));
}

function hasLegacyProjectsMissingFromDocs(legacyProjects, docProjects) {
  const docProjectIds = new Set(
    docProjects.map((project) => project?.id).filter((projectId) => typeof projectId === "string" && projectId),
  );
  return legacyProjects.some(
    (project) => typeof project?.id === "string" && project.id && !docProjectIds.has(project.id),
  );
}

function readProjects() {
  try {
    const docs = readProjectDocs();
    const docProjects = docs.map((doc) => doc.project).filter(Boolean);
    const legacyProjects = readLegacyStoredProjects();
    const mergedProjects = mergeStoredProjects(legacyProjects, docProjects);

    if (
      legacyProjects.length > 0 &&
      window.utools?.db?.put &&
      hasLegacyProjectsMissingFromDocs(legacyProjects, docProjects)
    ) {
      writeStoredProjects(mergedProjects);
    }
    return mergedProjects;
  } catch (error) {
    logStorageError("read projects", error);
    return sortProjectsByStoredOrder(normalizeStoredProjects(readLegacyStoredProjects()));
  }
}

function writeStoredProjects(projects) {
  if (window.utools?.db?.put) {
    try {
      const existingDocs = readProjectDocs();
      const existingByProjectId = new Map(existingDocs.map((doc) => [doc._id.replace(projectDocPrefix, ""), doc]));
      const projectIds = new Set(projects.map((project) => project.id));

      projects.forEach((project, index) => {
        const existing = existingByProjectId.get(project.id);
        const doc = toPlainJson({
          _id: `${projectDocPrefix}${project.id}`,
          schemaVersion,
          updatedAt: new Date().toISOString(),
          project: toStoredProject(project, index),
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

function isPathWithinRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveCanonicalProjectRoot(projectPath) {
  const rootPath = fs.realpathSync(expandPath(projectPath));
  if (!fs.statSync(rootPath).isDirectory()) {
    throw new Error("项目路径不是目录。");
  }
  return rootPath;
}

function resolveCanonicalProjectEntry(projectPath, relativePath, allowRoot = false) {
  const rootPath = resolveCanonicalProjectRoot(projectPath);
  const lexicalTarget = path.resolve(rootPath, typeof relativePath === "string" ? relativePath : "");
  if (!isPathWithinRoot(rootPath, lexicalTarget)) {
    throw new Error("目标路径不在项目目录内。");
  }
  if (!allowRoot && lexicalTarget === rootPath) {
    throw new Error("不能修改项目根目录。");
  }
  if (lexicalTarget !== rootPath && fs.lstatSync(lexicalTarget).isSymbolicLink()) {
    throw new Error("不支持操作符号链接。");
  }
  const targetPath = fs.realpathSync(lexicalTarget);
  if (!isPathWithinRoot(rootPath, targetPath)) {
    throw new Error("目标路径通过符号链接指向项目目录外。");
  }
  return { rootPath, targetPath, relativePath: path.relative(rootPath, lexicalTarget).replace(/\\/g, "/") };
}

function resolveCanonicalProjectParent(projectPath, parentRelativePath) {
  const rootPath = resolveCanonicalProjectRoot(projectPath);
  const lexicalParent = path.resolve(rootPath, typeof parentRelativePath === "string" ? parentRelativePath : "");
  if (!isPathWithinRoot(rootPath, lexicalParent)) {
    throw new Error("目标路径不在项目目录内。");
  }
  const parentPath = fs.realpathSync(lexicalParent);
  if (!isPathWithinRoot(rootPath, parentPath) || !fs.statSync(parentPath).isDirectory()) {
    throw new Error("目标目录无效或位于项目目录外。");
  }
  return { rootPath, parentPath, parentRelativePath: path.relative(rootPath, lexicalParent).replace(/\\/g, "/") };
}

function validateProjectEntryName(name) {
  const normalizedName = typeof name === "string" ? name : "";
  if (!normalizedName || normalizedName === "." || normalizedName === "..") {
    throw new Error("名称不能为空或使用保留目录名。");
  }
  if (/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(normalizedName) || /[. ]$/.test(normalizedName)) {
    throw new Error("名称包含无效字符或以点、空格结尾。");
  }
  const basename = normalizedName.split(".")[0].toUpperCase();
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(basename)) {
    throw new Error("名称是系统保留名称。");
  }
  return normalizedName;
}

function projectFileTreeEntry(rootPath, targetPath, stats) {
  const name = path.basename(targetPath);
  return {
    name,
    path: targetPath,
    relativePath: path.relative(rootPath, targetPath).replace(/\\/g, "/"),
    kind: stats.isDirectory() ? "directory" : "file",
    size: stats.size,
    extension: path.extname(name).toLowerCase(),
    hidden: name.startsWith("."),
  };
}

function listProjectFiles(projectPath, relativePath = "") {
  const resolved = resolveCanonicalProjectEntry(projectPath, relativePath, true);
  const stats = fs.statSync(resolved.targetPath);
  if (!stats.isDirectory()) {
    throw new Error("目标路径不是目录。");
  }

  const entries = fs
    .readdirSync(resolved.targetPath, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink() && !ignoredFileTreeDirs.has(entry.name))
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

async function searchProjectFiles(projectPath, query, options = {}) {
  const rootPath = resolveCanonicalProjectRoot(projectPath);
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  const limit = Math.max(1, Math.min(500, Number.isFinite(options.limit) ? Math.floor(options.limit) : 200));
  if (!normalizedQuery) return { rootPath, query: normalizedQuery, entries: [], truncated: false };

  const needle = normalizedQuery.toLocaleLowerCase();
  const entries = [];
  const pendingDirectories = [rootPath];
  let truncated = false;
  while (pendingDirectories.length > 0 && !truncated) {
    const directoryPath = pendingDirectories.shift();
    let directoryEntries;
    try {
      directoryEntries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of directoryEntries) {
      if (entry.isSymbolicLink() || (entry.isDirectory() && ignoredFileTreeDirs.has(entry.name))) continue;
      const targetPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) pendingDirectories.push(targetPath);
      if (!entry.name.toLocaleLowerCase().includes(needle)) continue;
      try {
        const stats = await fs.promises.lstat(targetPath);
        entries.push(projectFileTreeEntry(rootPath, targetPath, stats));
      } catch {
        continue;
      }
      if (entries.length >= limit) {
        truncated = true;
        break;
      }
    }
  }
  return { rootPath, query: normalizedQuery, entries, truncated };
}

function createProjectEntry(projectPath, parentRelativePath, name, kind) {
  const normalizedKind = kind === "directory" ? "directory" : "file";
  try {
    const parent = resolveCanonicalProjectParent(projectPath, parentRelativePath);
    const normalizedName = validateProjectEntryName(name);
    const targetPath = path.join(parent.parentPath, normalizedName);
    if (normalizedKind === "directory") {
      fs.mkdirSync(targetPath, { recursive: false });
    } else {
      fs.writeFileSync(targetPath, "", { flag: "wx" });
    }
    return {
      ok: true,
      kind: normalizedKind,
      path: targetPath,
      relativePath: path.relative(parent.rootPath, targetPath).replace(/\\/g, "/"),
    };
  } catch (error) {
    return { ok: false, kind: normalizedKind, path: "", relativePath: "", message: error?.message || String(error) };
  }
}

function renameProjectEntry(projectPath, relativePath, name) {
  let kind = "file";
  try {
    const source = resolveCanonicalProjectEntry(projectPath, relativePath);
    const sourceStats = fs.statSync(source.targetPath);
    kind = sourceStats.isDirectory() ? "directory" : "file";
    const normalizedName = validateProjectEntryName(name);
    const targetPath = path.join(path.dirname(source.targetPath), normalizedName);
    if (fs.existsSync(targetPath)) throw new Error("同名文件或目录已存在。");
    fs.renameSync(source.targetPath, targetPath);
    return {
      ok: true,
      kind,
      path: targetPath,
      relativePath: path.relative(source.rootPath, targetPath).replace(/\\/g, "/"),
      previousRelativePath: source.relativePath,
    };
  } catch (error) {
    return {
      ok: false,
      kind,
      path: "",
      relativePath,
      previousRelativePath: relativePath,
      message: error?.message || String(error),
    };
  }
}

function deleteProjectEntry(projectPath, relativePath) {
  let kind = "file";
  try {
    const resolved = resolveCanonicalProjectEntry(projectPath, relativePath);
    const stats = fs.statSync(resolved.targetPath);
    kind = stats.isDirectory() ? "directory" : "file";
    fs.rmSync(resolved.targetPath, { recursive: kind === "directory", force: false });
    return { ok: true, kind, path: resolved.targetPath, relativePath: resolved.relativePath };
  } catch (error) {
    return { ok: false, kind, path: "", relativePath, message: error?.message || String(error) };
  }
}

function showProjectEntryInFolder(projectPath, relativePath) {
  const resolved = resolveCanonicalProjectEntry(projectPath, relativePath, true);
  shell.showItemInFolder(resolved.targetPath);
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
  const resolved = resolveCanonicalProjectEntry(projectPath, relativePath);
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
  const resolved = resolveCanonicalProjectEntry(projectPath, relativePath);
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

  const status = getGitFileStatus(repositoryPath, diffPath);
  const headDiff = runGitDiff(repositoryPath, ["diff", "--", diffPath]);
  const cachedDiff = runGitDiff(repositoryPath, ["diff", "--cached", "--", diffPath]);

  const isFileUntracked =
    status?.status === "UNTRACKED" ||
    (fs.existsSync(resolved.targetPath) &&
      fs.statSync(resolved.targetPath).isFile() &&
      runGitResult(repositoryPath, ["ls-files", "--error-unmatch", "--", diffPath]).status !== 0);

  let untrackedDiff = "";
  if (isFileUntracked) {
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    untrackedDiff = runGitDiff(repositoryPath, ["diff", "--no-index", "--", nullDevice, diffPath]) || "";
    if (!untrackedDiff) {
      try {
        const content = fs.readFileSync(resolved.targetPath, "utf-8");
        const lines = content.split(/\r?\n/);
        untrackedDiff = `diff --git a/${diffPath} b/${diffPath}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/${diffPath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`;
      } catch (readErr) {
        untrackedDiff = "";
      }
    }
  }

  const diff = [cachedDiff, headDiff, untrackedDiff].filter(Boolean).join("\n");

  return {
    path: diffPath,
    diff,
    message: diff ? "" : "该文件暂无可显示的 diff。",
  };
}

function readGitCommitFiles(projectPath, commitHash) {
  const repositoryPath = findGitRoot(projectPath);
  const hash = String(commitHash || "").trim();
  if (!repositoryPath || !hash) {
    return [];
  }

  const numstatLines = (runGit(repositoryPath, ["show", "--format=", "--numstat", hash]) || "").split(/\r?\n/);
  const statusLines = (runGit(repositoryPath, ["show", "--format=", "--name-status", hash]) || "").split(/\r?\n/);
  const statusByPath = new Map();

  statusLines.forEach((line) => {
    const parts = line.split(/\t+/).filter(Boolean);
    if (parts.length < 2) return;
    const code = parts[0];
    const filePath = parts[parts.length - 1];
    statusByPath.set(
      filePath,
      code.startsWith("A") ? "ADDED" : code.startsWith("D") ? "DELETED" : code.startsWith("R") ? "RENAMED" : "MODIFIED",
    );
  });

  return numstatLines
    .map((line) => line.split(/\t+/).filter(Boolean))
    .filter((parts) => parts.length >= 3)
    .map((parts) => {
      const filePath = parts[parts.length - 1];
      return {
        path: filePath,
        additions: parts[0] === "-" ? 0 : Number(parts[0]) || 0,
        deletions: parts[1] === "-" ? 0 : Number(parts[1]) || 0,
        status: statusByPath.get(filePath) || "MODIFIED",
      };
    });
}

function readGitCommitFileDiff(projectPath, commitHash, relativePath) {
  const repositoryPath = findGitRoot(projectPath);
  const hash = String(commitHash || "").trim();
  const filePath = String(relativePath || "").trim();
  if (!repositoryPath || !hash || !filePath) {
    return { path: filePath, diff: "", message: "提交或文件信息为空，无法读取 diff。" };
  }

  const resolved = resolveProjectChild(repositoryPath, filePath);
  const diff = runGitDiff(repositoryPath, ["show", "--format=", hash, "--", resolved.relativePath]);
  return {
    path: resolved.relativePath,
    diff,
    message: diff ? "" : "该提交中此文件暂无可显示的 diff。",
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

async function inspectProjectPath(projectPath) {
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

  result.git = await readGitSnapshot(projectPath);
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

async function pickQuickLinkPath() {
  if (!window.utools?.showOpenDialog) {
    return { canceled: true, message: "当前环境不支持系统路径选择器，请手动填写路径。" };
  }

  const selected = await window.utools.showOpenDialog({
    title: "选择快捷访问路径",
    properties: ["openFile", "openDirectory"],
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

async function readGitStatusSnapshot(projectPath) {
  const repositoryPath = await findGitRootAsync(projectPath);
  const now = new Date().toISOString();

  if (!repositoryPath) {
    return {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [],
      branches: [],
      remotes: [],
      upstream: null,
      repositoryPath: "",
      lastRefreshedAt: now,
      statusText: "未检测到 Git 仓库",
    };
  }

  const [
    branchOutput,
    symbolicBranchOutput,
    headHashOutput,
    statusEntries,
    numstatOutput,
    cachedNumstatOutput,
    branches,
    remotes,
    upstream,
  ] = await Promise.all([
    runGitAsync(repositoryPath, ["status", "--short", "--branch"]),
    runGitAsync(repositoryPath, ["symbolic-ref", "--short", "-q", "HEAD"]),
    runGitAsync(repositoryPath, ["rev-parse", "--short", "HEAD"]),
    readGitStatusEntriesAsync(repositoryPath),
    collectNumstatAsync(repositoryPath, ["diff", "--numstat"]),
    collectNumstatAsync(repositoryPath, ["diff", "--cached", "--numstat"]),
    readGitBranchesAsync(repositoryPath),
    readGitRemotesAsync(repositoryPath),
    readGitUpstreamAsync(repositoryPath),
  ]);
  const symbolicBranch = String(symbolicBranchOutput || "").trim();
  const headHash = String(headHashOutput || "").trim();
  const isDetachedHead = !symbolicBranch && Boolean(headHash);
  const fileMap = new Map();

  statusEntries.forEach((entry) => {
    const pathStats = numstatOutput.get(entry.path) ?? cachedNumstatOutput.get(entry.path);
    const originalPathStats = entry.originalPath
      ? (numstatOutput.get(entry.originalPath) ?? cachedNumstatOutput.get(entry.originalPath))
      : null;
    const additions = pathStats?.additions ?? originalPathStats?.additions ?? 0;
    const deletions = pathStats?.deletions ?? originalPathStats?.deletions ?? 0;

    // 如果路径以 / 结尾，说明是未跟踪的文件夹，需要展开
    if (entry.path.endsWith("/") || entry.path.endsWith("\\")) {
      const folderPath = path.join(repositoryPath, entry.path);
      try {
        // 递归读取文件夹下的所有文件
        const expandedFiles = [];
        function walkDir(dirPath, basePath) {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const ent of entries) {
            const fullPath = path.join(dirPath, ent.name);
            const relativePath = path.relative(repositoryPath, fullPath).replace(/\\/g, "/");
            if (ent.isDirectory()) {
              walkDir(fullPath, basePath);
            } else if (ent.isFile()) {
              // 计算新文件的行数作为 additions
              let lineCount = 0;
              try {
                const content = fs.readFileSync(fullPath, "utf-8");
                lineCount = content.split(/\r?\n/).length;
              } catch (err) {
                lineCount = 0;
              }
              expandedFiles.push({
                path: relativePath,
                originalPath: undefined,
                additions: lineCount,
                deletions: 0,
                status: "UNTRACKED",
                staged: false,
                unstaged: true,
              });
            }
          }
        }
        walkDir(folderPath, entry.path);
        // 将展开的文件添加到 fileMap
        expandedFiles.forEach((file) => {
          fileMap.set(file.path, file);
        });
      } catch (err) {
        // 如果读取失败，保留原始文件夹条目（稍后过滤）
        fileMap.set(entry.path, {
          path: entry.path,
          originalPath: entry.originalPath,
          additions,
          deletions,
          status: entry.status,
          staged: entry.staged,
          unstaged: entry.unstaged,
        });
      }
    } else {
      fileMap.set(entry.path, {
        path: entry.path,
        originalPath: entry.originalPath,
        additions,
        deletions,
        status: entry.status,
        staged: entry.staged,
        unstaged: entry.unstaged,
      });
    }
  });

  const branchLine = branchOutput ? String(branchOutput).split(/\r?\n/)[0] : "";
  const branchMatch = branchLine.match(/^##\s+([^\.\s]+)(?:\.\.\.(?:[^\s]+))?(?:\s+\[(.+)\])?/);
  const branch = symbolicBranch || (isDetachedHead ? "HEAD" : branchMatch?.[1] || "main");
  const upstreamInfo = branchMatch?.[2] || "";
  const aheadMatch = upstreamInfo.match(/ahead\s+(\d+)/);
  const behindMatch = upstreamInfo.match(/behind\s+(\d+)/);
  const ahead = upstream?.ahead ?? (aheadMatch ? Number(aheadMatch[1]) : 0);
  const behind = upstream?.behind ?? (behindMatch ? Number(behindMatch[1]) : 0);

  return {
    branch,
    headHash,
    isDetachedHead,
    ahead,
    behind,
    files: Array.from(fileMap.values()).filter((file) => {
      // 过滤掉文件夹条目（路径以 / 或 \ 结尾）
      return !file.path.endsWith("/") && !file.path.endsWith("\\");
    }),
    branches,
    remotes,
    upstream,
    repositoryPath,
    lastRefreshedAt: now,
    statusText: `${isDetachedHead && headHash ? `detached HEAD @ ${headHash} · ` : ""}${fileMap.size === 0 ? "工作区干净" : `${fileMap.size} 个文件变更`}`,
  };
}

function fetchGitRemote(projectPath) {
  return runGitRemoteResult(
    projectPath,
    (upstream) => ["fetch", "--prune", upstream.remote],
    (upstream) => `已从 ${upstream.remote} 获取远程更新。`,
  );
}

function pullGitRemote(projectPath) {
  return runGitRemoteResult(
    projectPath,
    (upstream) => ["pull", "--ff", "--no-rebase", upstream.remote, upstream.branch],
    (upstream) => `已从 ${upstream.ref} 拉取更新。`,
  );
}

function pushGitRemote(projectPath) {
  return runGitRemoteResult(
    projectPath,
    (upstream) => ["push", upstream.remote, `HEAD:${upstream.branch}`],
    (upstream) => `已推送到 ${upstream.ref}。`,
  );
}

async function addGitRemote(projectPath, remoteName, remoteUrl) {
  const repositoryPath = await findGitRootAsync(projectPath);
  const name = normalizeGitRemoteName(remoteName);
  const url = normalizeGitRemoteUrl(remoteUrl);
  const nameError = validateGitRemoteName(name);
  const urlError = validateGitRemoteUrl(url);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (nameError) {
    return { ok: false, message: nameError };
  }
  if (urlError) {
    return { ok: false, remote: name, message: urlError };
  }

  const result = runGitResult(repositoryPath, ["remote", "add", name, url]);
  return result.status === 0
    ? { ok: true, remote: name, message: `已添加 remote：${name}。` }
    : { ok: false, remote: name, message: firstGitError(result, "添加 remote 失败。") };
}

async function setGitRemoteUrl(projectPath, remoteName, remoteUrl) {
  const repositoryPath = await findGitRootAsync(projectPath);
  const name = normalizeGitRemoteName(remoteName);
  const url = normalizeGitRemoteUrl(remoteUrl);
  const nameError = validateGitRemoteName(name);
  const urlError = validateGitRemoteUrl(url);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (nameError) {
    return { ok: false, message: nameError };
  }
  if (urlError) {
    return { ok: false, remote: name, message: urlError };
  }

  const result = runGitResult(repositoryPath, ["remote", "set-url", name, url]);
  return result.status === 0
    ? { ok: true, remote: name, message: `已更新 ${name} 的 URL。` }
    : { ok: false, remote: name, message: firstGitError(result, "更新 remote URL 失败。") };
}

async function removeGitRemote(projectPath, remoteName) {
  const repositoryPath = await findGitRootAsync(projectPath);
  const name = normalizeGitRemoteName(remoteName);
  const nameError = validateGitRemoteName(name);
  if (!repositoryPath) {
    return { ok: false, message: "未检测到 Git 仓库。" };
  }
  if (nameError) {
    return { ok: false, message: nameError };
  }

  const result = runGitResult(repositoryPath, ["remote", "remove", name]);
  return result.status === 0
    ? { ok: true, remote: name, message: `已删除 remote：${name}。` }
    : { ok: false, remote: name, message: firstGitError(result, "删除 remote 失败。") };
}

async function readGitCommits(projectPath, options = {}) {
  const repositoryPath = await findGitRootAsync(projectPath);
  const now = new Date().toISOString();
  const limit = Math.min(100, Math.max(20, Number(options.limit) || 80));
  const skip = Math.max(0, Number(options.skip) || 0);

  if (!repositoryPath) {
    return {
      commits: [],
      hasMoreCommits: false,
      repositoryPath: "",
      lastRefreshedAt: now,
    };
  }

  const commitOutput = await runGitAsync(repositoryPath, [
    "log",
    "--all",
    "--topo-order",
    "--decorate=short",
    `--max-count=${limit + 1}`,
    `--skip=${skip}`,
    `--pretty=format:%h${gitCommitFieldSeparator}%p${gitCommitFieldSeparator}%an${gitCommitFieldSeparator}%ad${gitCommitFieldSeparator}%D${gitCommitFieldSeparator}%s${gitCommitFieldSeparator}%B${gitCommitRecordSeparator}`,
    "--date=iso-strict",
  ]);

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

  return {
    commits,
    hasMoreCommits,
    repositoryPath,
    lastRefreshedAt: now,
  };
}

async function readGitSnapshot(projectPath, options = {}) {
  const [statusSnapshot, commitPage] = await Promise.all([
    readGitStatusSnapshot(projectPath),
    readGitCommits(projectPath, options),
  ]);
  return {
    ...statusSnapshot,
    commits: commitPage.commits,
    hasMoreCommits: commitPage.hasMoreCommits,
    repositoryPath: statusSnapshot.repositoryPath || commitPage.repositoryPath,
    lastRefreshedAt: statusSnapshot.lastRefreshedAt,
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
  const childPid = typeof child.pid === "number" ? child.pid : -1;
  let processSettled = false;

  if (childPid > 0) {
    activeProcesses.set(childPid, child);
    activeProcessMetadata.set(childPid, {
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      automationRunId: payload.automationRunId,
    });
    launchedProcessIds.add(childPid);
  }

  const cleanupProcess = () => {
    if (childPid > 0) {
      activeProcesses.delete(childPid);
      activeProcessMetadata.delete(childPid);
      launchedProcessIds.delete(childPid);
      automationExitMatchedProcesses.delete(childPid);
    }
  };

  const rememberCompletedProcessResult = (result) => {
    if (childPid <= 0) {
      return;
    }
    const resultWithEndedAt = {
      ...result,
      endedAt: new Date().toISOString(),
      automationRunId: payload.automationRunId,
    };
    completedProcessResults.set(childPid, resultWithEndedAt);
    if (payload.automationRunId) {
      completedAutomationProcessResults.set(
        automationProcessKey(payload.projectId, payload.scriptId, payload.automationRunId),
        resultWithEndedAt,
      );
    }
    while (completedProcessResults.size > completedProcessResultLimit) {
      const oldestPid = completedProcessResults.keys().next().value;
      completedProcessResults.delete(oldestPid);
    }
    while (completedAutomationProcessResults.size > completedProcessResultLimit) {
      const oldestKey = completedAutomationProcessResults.keys().next().value;
      completedAutomationProcessResults.delete(oldestKey);
    }
  };

  emit({
    type: "started",
    projectId: payload.projectId,
    scriptId: payload.scriptId,
    pid: childPid,
    automationRunId: payload.automationRunId,
    message: payload.command,
  });

  child.stdout?.on("data", (chunk) => {
    emit({
      type: "stdout",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: childPid,
      automationRunId: payload.automationRunId,
      message: decodeStdout(chunk),
    });
  });

  child.stderr?.on("data", (chunk) => {
    emit({
      type: "stderr",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: childPid,
      automationRunId: payload.automationRunId,
      message: decodeStderr(chunk),
    });
  });

  child.on("error", (error) => {
    if (processSettled) {
      return;
    }

    processSettled = true;
    const automationExitMatched = childPid > 0 && automationExitMatchedProcesses.has(childPid);
    rememberCompletedProcessResult({
      error: error?.message || "command failed",
      ...(automationExitMatched ? { automationExitMatched: true } : {}),
    });
    cleanupProcess();
    if (childPid > 0) {
      userStoppedProcesses.delete(childPid);
    }
    emit({
      type: "error",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: childPid,
      automationRunId: payload.automationRunId,
      ...(automationExitMatched ? { automationExitMatched: true } : {}),
      message: error?.message || "command failed",
    });
  });

  child.on("close", (code, signal) => {
    if (processSettled) {
      return;
    }

    processSettled = true;
    const stoppedByUser = childPid > 0 ? userStoppedProcesses.delete(childPid) : false;
    const automationExitMatched = childPid > 0 && automationExitMatchedProcesses.has(childPid);
    rememberCompletedProcessResult({
      code,
      signal,
      stoppedByUser,
      ...(automationExitMatched ? { automationExitMatched: true } : {}),
    });
    cleanupProcess();
    emit({
      type: "exit",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: childPid,
      automationRunId: payload.automationRunId,
      ...(automationExitMatched ? { automationExitMatched: true } : {}),
      code,
      signal,
      stoppedByUser,
    });
  });

  return {
    pid: childPid,
    startedAt: new Date().toISOString(),
    command: payload.command,
    cwd: resolvedCwd,
  };
}

function getProcessStatus(pid) {
  if (activeProcesses.has(pid)) {
    return { active: true };
  }

  const result = completedProcessResults.get(pid);
  if (result) {
    return { active: false, ...result };
  }

  return { active: false };
}

function getAutomationProcessResult(projectId, scriptId, automationRunId) {
  const result = completedAutomationProcessResults.get(automationProcessKey(projectId, scriptId, automationRunId));
  return result ? { active: false, ...result } : null;
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

  return new Promise((resolve) => {
    let killer;
    try {
      killer = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        env: { ...process.env, UTOOLS_STOP_PID: String(pid) },
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      resolve();
      return;
    }

    killer.once("error", () => resolve());
    killer.once("close", () => resolve());
  });
}

async function stopProcess(pid, options) {
  const child = activeProcesses.get(pid);
  const metadata = activeProcessMetadata.get(pid);

  if (
    child &&
    options?.automationExitMatched === true &&
    typeof options.automationRunId === "string" &&
    options.automationRunId === metadata?.automationRunId
  ) {
    automationExitMatchedProcesses.add(pid);
  }

  if (child) {
    userStoppedProcesses.add(pid);
    if (process.platform === "win32") {
      await stopWindowsProcessTree(pid);
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
      await stopWindowsProcessTree(pid);
    }
  }
}

async function sendProcessInput(pid, input) {
  const child = activeProcesses.get(pid);
  const metadata = activeProcessMetadata.get(pid);
  if (!child || !child.stdin || child.stdin.destroyed || child.stdin.writableEnded) {
    return { sent: false, message: "当前进程不可输入。" };
  }
  if (!metadata) {
    return { sent: false, message: "当前进程缺少日志上下文。" };
  }

  const line = `${String(input ?? "")}\n`;
  return new Promise((resolve) => {
    child.stdin.write(line, (error) => {
      if (error) {
        resolve({ sent: false, message: error.message || "输入发送失败。" });
        return;
      }

      emit({
        type: "stdin",
        projectId: metadata.projectId,
        scriptId: metadata.scriptId,
        pid,
        automationRunId: metadata.automationRunId,
        message: String(input ?? ""),
      });
      resolve({ sent: true });
    });
  });
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
  loadDeviceId: getCurrentDeviceId,
  loadProjects: readProjects,
  saveProjects: writeStoredProjects,
  inspectProjectPath,
  pickProjectPath,
  pickQuickLinkPath,
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
  analyzeWithAiStream,
  exportProjects,
  importProjects,
  readPackageScripts,
  listProjectSubdirectories,
  readGitSnapshot,
  readGitStatusSnapshot,
  readGitCommits,
  readGitFileDiff,
  readGitCommitFileDiff,
  readGitCommitFiles,
  readGitCommitMessageDiff,
  stageGitFile,
  unstageGitFile,
  discardGitFile,
  stageGitFiles,
  unstageGitFiles,
  discardGitFiles,
  commitGitStaged,
  switchGitBranch,
  checkoutGitCommit,
  fetchGitRemote,
  pullGitRemote,
  pushGitRemote,
  addGitRemote,
  setGitRemoteUrl,
  removeGitRemote,
  listProjectFiles,
  searchProjectFiles,
  createProjectEntry,
  renameProjectEntry,
  deleteProjectEntry,
  showProjectEntryInFolder,
  readProjectFile,
  writeProjectFile,
  openTerminal,
  openEditor,
  runCommand,
  stopProcess,
  getProcessStatus,
  getAutomationProcessResult,
  sendProcessInput,
  stopAllProcesses,
  openPath,
  showItemInFolder: (targetPath) => shell.showItemInFolder(expandPath(targetPath)),
};
