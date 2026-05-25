import { DEFAULT_AI_PROMPT_MODES } from "../types";
import type {
  DefaultTerminalKind,
  DefaultEditorKind,
  AiAnalyzePayload,
  AiPreferences,
  AiPromptMode,
  AiProviderKind,
  EditorPreferences,
  EnvironmentPreferences,
  EnvironmentToolKey,
  ProjectBridge,
  ProjectConfigFile,
  ProjectGitFileChange,
  ProjectBridgeGitSnapshot,
  ProjectBridgePackageScript,
  ProjectBridgeTerminalLaunchPayload,
  ProjectBridgeTerminalLaunchResult,
  ProjectBridgeEditorLaunchPayload,
  ProjectBridgeEditorLaunchResult,
  ProjectBridgeRunResult,
  ProjectFileListResult,
  ProjectFileReadResult,
  ProjectFileWriteResult,
  ProjectPathInspection,
  TerminalPreferences,
} from "../types";

const fallbackStorageKey = "utools-project-launch.projects.v1";
const terminalPreferencesStorageKey = "utools-project-launch.settings.v1";
const editorPreferencesStorageKey = "utools-project-launch.editor-settings.v1";
const environmentPreferencesStorageKey = "utools-project-launch.environment-settings.v1";
const aiPreferencesStorageKey = "utools-project-launch.ai-settings.v1";

const isWindowsPlatform = () => /win/i.test(window.navigator?.platform || window.navigator?.userAgent || "");

const defaultTerminalPreferences = (): TerminalPreferences => ({
  kind: isWindowsPlatform() ? "windows-terminal" : "builtin",
  customCommand: "",
});

const terminalKinds = new Set<DefaultTerminalKind>(["builtin", "windows-terminal", "powershell", "cmd", "custom"]);
const editorKinds = new Set<DefaultEditorKind>(["vscode", "cursor", "custom"]);
const aiProviderKinds = new Set<AiProviderKind>(["utools", "openai-compatible", "anthropic-compatible"]);
const environmentToolKeys = new Set<EnvironmentToolKey>([
  "node",
  "npm",
  "pnpm",
  "yarn",
  "python",
  "pip",
  "go",
  "git",
  "docker",
]);

const isTerminalKind = (kind: unknown): kind is DefaultTerminalKind =>
  typeof kind === "string" && terminalKinds.has(kind as DefaultTerminalKind);
const isEditorKind = (kind: unknown): kind is DefaultEditorKind =>
  typeof kind === "string" && editorKinds.has(kind as DefaultEditorKind);

const defaultEditorPreferences = (): EditorPreferences => ({
  kind: "vscode",
  customCommand: "",
});

const defaultEnvironmentPreferences = (): EnvironmentPreferences => ({
  enabledToolKeys: ["node", "npm", "pnpm", "python", "go", "git"],
});

const cloneDefaultAiModes = (): AiPromptMode[] => DEFAULT_AI_PROMPT_MODES.map((mode) => ({ ...mode }));

const normalizeAiProviderKind = (provider: unknown): AiProviderKind => {
  if (provider === "openai" || provider === "openai-responses") return "openai-compatible";
  if (provider === "anthropic") return "anthropic-compatible";
  return typeof provider === "string" && aiProviderKinds.has(provider as AiProviderKind)
    ? (provider as AiProviderKind)
    : "utools";
};

const normalizeAiModes = (value: unknown): AiPromptMode[] => {
  const defaults = cloneDefaultAiModes();
  const defaultIds = new Set(defaults.map((mode) => mode.id));
  if (!Array.isArray(value)) {
    return defaults;
  }

  const modes = new Map<string, AiPromptMode>();
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const candidate = item as Partial<AiPromptMode>;
    const fallbackId = candidate.builtIn ? defaults[index]?.id : `custom-${index + 1}`;
    const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : fallbackId;
    const name = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : id;
    const defaultPrompt = defaults.find((mode) => mode.id === id)?.prompt || "";
    const prompt = typeof candidate.prompt === "string" ? candidate.prompt : defaultPrompt;
    if (!id || modes.has(id)) return;
    modes.set(id, { id, name, prompt, builtIn: defaultIds.has(id) });
  });

  defaults.forEach((defaultMode) => {
    if (!modes.has(defaultMode.id)) {
      modes.set(defaultMode.id, defaultMode);
    }
  });

  return modes.size > 0 ? Array.from(modes.values()) : defaults;
};

const defaultAiPreferences = (): AiPreferences => ({
  provider: "utools",
  baseUrl: "",
  model: "",
  apiKey: "",
  modes: cloneDefaultAiModes(),
});

const normalizeTerminalPreferences = (value: unknown): TerminalPreferences => {
  const defaults = defaultTerminalPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const candidate = value as Partial<TerminalPreferences>;
  return {
    kind: isTerminalKind(candidate.kind) ? candidate.kind : defaults.kind,
    customCommand: typeof candidate.customCommand === "string" ? candidate.customCommand : "",
  };
};

const normalizeEditorPreferences = (value: unknown): EditorPreferences => {
  const defaults = defaultEditorPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const candidate = value as Partial<EditorPreferences>;
  return {
    kind: isEditorKind(candidate.kind) ? candidate.kind : defaults.kind,
    customCommand: typeof candidate.customCommand === "string" ? candidate.customCommand : "",
  };
};

const normalizeEnvironmentPreferences = (value: unknown): EnvironmentPreferences => {
  const defaults = defaultEnvironmentPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const candidate = value as Partial<EnvironmentPreferences>;
  const enabledToolKeys = Array.isArray(candidate.enabledToolKeys)
    ? candidate.enabledToolKeys.filter((key): key is EnvironmentToolKey =>
        environmentToolKeys.has(key as EnvironmentToolKey),
      )
    : defaults.enabledToolKeys;
  return {
    enabledToolKeys: enabledToolKeys.length > 0 ? Array.from(new Set(enabledToolKeys)) : defaults.enabledToolKeys,
  };
};

const normalizeAiPreferences = (value: unknown): AiPreferences => {
  const defaults = defaultAiPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const candidate = value as Partial<AiPreferences>;
  const provider = normalizeAiProviderKind(candidate.provider);
  return {
    provider,
    baseUrl: typeof candidate.baseUrl === "string" ? candidate.baseUrl : defaults.baseUrl,
    model: typeof candidate.model === "string" ? candidate.model : defaults.model,
    apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : defaults.apiKey,
    modes: normalizeAiModes(candidate.modes),
  };
};

const readStoredTerminalPreferences = (): TerminalPreferences => {
  try {
    if (window.utools?.dbStorage) {
      return normalizeTerminalPreferences(window.utools.dbStorage.getItem(terminalPreferencesStorageKey));
    }

    const raw = window.localStorage?.getItem(terminalPreferencesStorageKey);
    if (!raw) {
      return defaultTerminalPreferences();
    }

    return normalizeTerminalPreferences(JSON.parse(raw));
  } catch (error) {
    return defaultTerminalPreferences();
  }
};

const writeStoredTerminalPreferences = (preferences: TerminalPreferences) => {
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
};

const readStoredEditorPreferences = (): EditorPreferences => {
  try {
    if (window.utools?.dbStorage) {
      return normalizeEditorPreferences(window.utools.dbStorage.getItem(editorPreferencesStorageKey));
    }

    const raw = window.localStorage?.getItem(editorPreferencesStorageKey);
    return raw ? normalizeEditorPreferences(JSON.parse(raw)) : defaultEditorPreferences();
  } catch (error) {
    return defaultEditorPreferences();
  }
};

const writeStoredEditorPreferences = (preferences: EditorPreferences) => {
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
};

const readStoredEnvironmentPreferences = (): EnvironmentPreferences => {
  try {
    if (window.utools?.dbStorage) {
      return normalizeEnvironmentPreferences(window.utools.dbStorage.getItem(environmentPreferencesStorageKey));
    }
    const raw = window.localStorage?.getItem(environmentPreferencesStorageKey);
    return raw ? normalizeEnvironmentPreferences(JSON.parse(raw)) : defaultEnvironmentPreferences();
  } catch (error) {
    return defaultEnvironmentPreferences();
  }
};

const writeStoredEnvironmentPreferences = (preferences: EnvironmentPreferences) => {
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
};

const readStoredAiPreferences = (): AiPreferences => {
  try {
    if (window.utools?.dbStorage) {
      return normalizeAiPreferences(window.utools.dbStorage.getItem(aiPreferencesStorageKey));
    }
    const raw = window.localStorage?.getItem(aiPreferencesStorageKey);
    return raw ? normalizeAiPreferences(JSON.parse(raw)) : defaultAiPreferences();
  } catch (error) {
    return defaultAiPreferences();
  }
};

const writeStoredAiPreferences = (preferences: AiPreferences) => {
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
};

const emptyGitSnapshot = (): ProjectBridgeGitSnapshot => ({
  branch: "main",
  ahead: 0,
  behind: 0,
  files: [],
  commits: [],
  hasMoreCommits: false,
  repositoryPath: "",
  lastRefreshedAt: new Date().toISOString(),
  statusText: "离线预览",
});

const fallbackBridge: ProjectBridge = {
  async loadProjects() {
    try {
      const raw = window.localStorage?.getItem(fallbackStorageKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as ProjectConfigFile;
      return Array.isArray(parsed.projects) ? parsed.projects : [];
    } catch (error) {
      return [];
    }
  },
  async saveProjects(projects) {
    try {
      const config: ProjectConfigFile = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        projects,
      };
      window.localStorage?.setItem(fallbackStorageKey, JSON.stringify(config));
    } catch (error) {
      // Browser preview can continue with in-memory Pinia state if storage is unavailable.
    }
  },
  loadTerminalPreferences() {
    return readStoredTerminalPreferences();
  },
  saveTerminalPreferences(preferences) {
    writeStoredTerminalPreferences(preferences);
  },
  loadEditorPreferences() {
    return readStoredEditorPreferences();
  },
  saveEditorPreferences(preferences) {
    writeStoredEditorPreferences(preferences);
  },
  loadEnvironmentPreferences() {
    return readStoredEnvironmentPreferences();
  },
  saveEnvironmentPreferences(preferences) {
    writeStoredEnvironmentPreferences(preferences);
  },
  async detectEnvironmentTools(toolKeys: EnvironmentToolKey[]) {
    return toolKeys.map((key) => ({
      key,
      name: key === "node" ? "Node.js" : key,
      status: "error" as const,
      version: "",
      executablePath: "",
      checkedAt: new Date().toISOString(),
      error: "浏览器预览无法检测本机开发环境。",
    }));
  },
  loadAiPreferences() {
    return readStoredAiPreferences();
  },
  saveAiPreferences(preferences) {
    writeStoredAiPreferences(preferences);
  },
  async listAiModels() {
    return [];
  },
  async testAiConnection() {
    return { ok: false, message: "浏览器预览无法测试 AI 连接。" };
  },
  async analyzeWithAi(payload: AiAnalyzePayload) {
    return {
      ok: false,
      content: "",
      message:
        payload.preferences.provider === "utools" ? "浏览器预览无法调用 uTools AI。" : "浏览器预览未连接第三方 AI。",
    };
  },
  async analyzeWithAiStream(payload: AiAnalyzePayload, onChunk, onDone) {
    const result = await this.analyzeWithAi(payload);
    void onChunk;
    onDone(result);
  },
  async inspectProjectPath(projectPath: string): Promise<ProjectPathInspection> {
    const name = projectPath.split(/[\\/]/).filter(Boolean).pop() || "";
    return {
      pathExists: Boolean(projectPath.trim()),
      name,
      branch: "main",
      scripts: [],
      packagePath: null,
      git: emptyGitSnapshot(),
      message: "浏览器预览无法读取本地目录，已保留手动填写。",
    };
  },
  async pickProjectPath() {
    return { canceled: true, message: "浏览器预览无法打开系统文件夹选择器，请手动填写路径。" };
  },
  async pickQuickLinkPath() {
    return { canceled: true, message: "浏览器预览无法打开系统路径选择器，请手动填写路径。" };
  },
  async pathExists(projectPath: string): Promise<boolean> {
    return Boolean(projectPath.trim());
  },
  async exportProjects(config) {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `utools-projects-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    return {};
  },
  async importProjects() {
    return { canceled: true, message: "浏览器预览暂不支持文件导入，请在 uTools 环境中使用。" };
  },
  async readPackageScripts(): Promise<{ scripts: ProjectBridgePackageScript[]; packagePath: string | null }> {
    return { scripts: [], packagePath: null };
  },
  async listProjectSubdirectories(): Promise<string[]> {
    return [".", "frontend", "backend", "client", "server", "api", "src"];
  },
  async readGitSnapshot(): Promise<ProjectBridgeGitSnapshot> {
    return emptyGitSnapshot();
  },
  async readGitFileDiff(projectPath: string, relativePath: string) {
    return {
      path: relativePath,
      diff: "",
      message: projectPath ? "浏览器预览无法读取 Git diff。" : "项目路径为空，无法读取 Git diff。",
    };
  },
  async readGitCommitFileDiff(projectPath: string, commitHash: string, relativePath: string) {
    return {
      path: relativePath,
      diff: "",
      message: projectPath && commitHash ? "浏览器预览无法读取提交 diff。" : "提交信息为空，无法读取 diff。",
    };
  },
  async readGitCommitFiles(): Promise<ProjectGitFileChange[]> {
    return [];
  },
  async listProjectFiles(projectPath: string, relativePath = ""): Promise<ProjectFileListResult> {
    return { rootPath: projectPath, relativePath, entries: [] };
  },
  async readProjectFile(projectPath: string, relativePath: string): Promise<ProjectFileReadResult> {
    const name = relativePath.split(/[\\/]/).filter(Boolean).pop() || projectPath;
    return {
      path: `${projectPath}/${relativePath}`,
      relativePath,
      name,
      size: 0,
      extension: "",
      mime: "application/octet-stream",
      previewKind: "none",
      editable: false,
      message: "浏览器预览无法读取本地文件。",
    };
  },
  async writeProjectFile(projectPath: string, relativePath: string): Promise<ProjectFileWriteResult> {
    return { path: `${projectPath}/${relativePath}`, relativePath, savedAt: new Date().toISOString() };
  },
  async openTerminal(payload: ProjectBridgeTerminalLaunchPayload): Promise<ProjectBridgeTerminalLaunchResult> {
    return {
      launched: false,
      command: "",
      cwd: payload.projectPath,
      kind: payload.terminal.kind,
      message: "浏览器预览暂不支持打开外部终端。",
    };
  },
  async openEditor(payload: ProjectBridgeEditorLaunchPayload): Promise<ProjectBridgeEditorLaunchResult> {
    return {
      launched: false,
      command: "",
      cwd: payload.projectPath,
      kind: payload.editor.kind,
      message: "浏览器预览暂不支持打开外部编辑器。",
    };
  },
  async runCommand(payload): Promise<ProjectBridgeRunResult> {
    return {
      pid: Date.now(),
      startedAt: new Date().toISOString(),
      command: payload.command,
      cwd: payload.cwd,
    };
  },
  async stopProcess(): Promise<void> {
    return undefined;
  },
  async sendProcessInput(): Promise<{ sent: boolean; message?: string }> {
    return { sent: false, message: "浏览器预览无法向运行进程发送输入。" };
  },
  async stopAllProcesses(): Promise<void> {
    return undefined;
  },
  async openPath(targetPath: string): Promise<void> {
    const normalizedPath = targetPath.trim();
    if (/^(?:https?:)?\/\//i.test(normalizedPath) || /^(?:mailto|utools):/i.test(normalizedPath)) {
      window.open(normalizedPath.startsWith("//") ? `https:${normalizedPath}` : normalizedPath, "_blank", "noopener");
    }
  },
  async showItemInFolder(): Promise<void> {
    return undefined;
  },
};

export function getProjectBridge(): ProjectBridge {
  return window.projectBridge ?? fallbackBridge;
}

export function supportsRealProjectBridge() {
  return Boolean(window.projectBridge);
}
