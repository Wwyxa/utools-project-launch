import { AI_COMMIT_MESSAGE_MODE_ID, DEFAULT_AI_PROMPT_MODES, PROJECT_DETAILS_TAB_IDS } from "../types";
import {
  BUILTIN_ENVIRONMENT_TOOLS,
  normalizeBuiltinEnvironmentToolOverride,
  normalizeCustomEnvironmentTool,
} from "./environmentTools";
import type {
  DefaultTerminalKind,
  AiAnalyzePayload,
  AiPreferences,
  AiPromptMode,
  AiPromptModeKind,
  AiProviderKind,
  ExternalApplication,
  ExternalApplicationLaunchMode,
  ExternalApplicationPreferences,
  ExternalApplicationKind,
  EnvironmentPreferences,
  EnvironmentToolDefinition,
  EnvironmentToolRequest,
  EnvironmentToolKey,
  ProjectBridge,
  ProjectBridgeGitCommitPage,
  ProjectBridgeGitWorkspaceSnapshot,
  ProjectConfigFile,
  ProjectGitFileChange,
  ProjectGitFileDiffOptions,
  ProjectGitStash,
  ProjectGitActionResult,
  ProjectBridgeGitStatusSnapshot,
  ProjectBridgeGitSnapshot,
  ProjectGitCommitMessageDiffResult,
  ProjectBridgePackageScript,
  ProjectScriptDiscoveryResult,
  ProjectBridgeTerminalLaunchPayload,
  ProjectBridgeTerminalLaunchResult,
  ProjectBridgeExternalApplicationLaunchPayload,
  ProjectBridgeExternalApplicationLaunchResult,
  ProjectBridgeRunResult,
  ProjectBridgeStopProcessOptions,
  ProjectFileListResult,
  ProjectFileMutationKind,
  ProjectFileMutationResult,
  ProjectFileReadResult,
  ProjectFileSearchResult,
  ProjectFileWriteResult,
  ProjectPathInspection,
  ProjectDetailsTabId,
  HostLaunchCapabilities,
  LaunchSelectionMode,
  TerminalPreferences,
  UiPreferences,
} from "../types";

const fallbackStorageKey = "utools-project-launch.projects.v1";
const terminalPreferencesStorageKey = "utools-project-launch.settings.v1";
const localTerminalPreferencesStorageKey = "utools-project-launch.local-settings.v1";
const localTerminalPreferencesV2StorageKey = "utools-project-launch.local-settings.v2";
const editorPreferencesStorageKey = "utools-project-launch.editor-settings.v1";
const localEditorPreferencesStorageKey = "utools-project-launch.local-editor-settings.v1";
const externalApplicationPreferencesStorageKey = "utools-project-launch.local-external-applications.v1";
const externalApplicationPreferencesV2StorageKey = "utools-project-launch.local-external-applications.v2";
const environmentPreferencesStorageKey = "utools-project-launch.environment-settings.v1";
const aiPreferencesStorageKey = "utools-project-launch.ai-settings.v1";
const uiPreferencesStorageKey = "utools-project-launch.ui-preferences.v1";
const projectDetailsTabOrderStorageKey = "utools-project-launch.project-details-tab-order.v1";
const deviceIdStorageKey = "utools-project-launch.device-id.v1";
const legacyDefaultAiCommitMessagePrompt = `请根据以下 {diffScope} 生成一个简洁、可直接使用的 Git commit message。

要求：
- 只输出最终 commit message，不要解释推理过程。
- 输出 1 行标题，优先使用 conventional commit 风格，例如 feat:, fix:, chore:, docs:, refactor:。
- 如确实需要，可在标题后追加 2-4 条简短正文要点。
- 不要使用 Markdown 代码块。
{truncatedNote}

{diffScope}:
{diffContent}`;

const isWindowsPlatform = () => /win/i.test(window.navigator?.platform || window.navigator?.userAgent || "");
const isLinuxPlatform = () => /linux/i.test(window.navigator?.platform || window.navigator?.userAgent || "");

const defaultTerminalPreferences = (): TerminalPreferences => ({
  schemaVersion: 2,
  mode: "auto",
  kind: isWindowsPlatform() ? "windows-terminal" : isLinuxPlatform() ? "linux-terminal" : "terminal-app",
  customCommand: "",
});

const terminalKinds = new Set<DefaultTerminalKind>([
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
type LegacyEditorPreferences = { kind: ExternalApplicationKind; customCommand: string };
const editorKinds = new Set<ExternalApplicationKind>(["vscode", "cursor", "custom"]);
const aiProviderKinds = new Set<AiProviderKind>(["utools", "openai-compatible", "anthropic-compatible"]);
const aiPromptModeKinds = new Set<AiPromptModeKind>(["git-analysis", "commit-message"]);
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
const projectDetailsTabIds: ProjectDetailsTabId[] = [...PROJECT_DETAILS_TAB_IDS];
const projectDetailsTabIdSet = new Set<ProjectDetailsTabId>(projectDetailsTabIds);

const isTerminalKind = (kind: unknown): kind is DefaultTerminalKind =>
  typeof kind === "string" && terminalKinds.has(kind as DefaultTerminalKind);
const isEditorKind = (kind: unknown): kind is ExternalApplicationKind =>
  typeof kind === "string" && editorKinds.has(kind as ExternalApplicationKind);

const defaultEditorPreferences = (): LegacyEditorPreferences => ({
  kind: "vscode",
  customCommand: "",
});

const builtinExternalApplications: ExternalApplication[] = [
  { id: "vscode", name: "VS Code", kind: "vscode", command: "code {path}", enabled: true, launchMode: "native" },
  { id: "cursor", name: "Cursor", kind: "cursor", command: "cursor {path}", enabled: true, launchMode: "native" },
];

const defaultExternalApplicationPreferences = (): ExternalApplicationPreferences => ({
  schemaVersion: 2,
  mode: "auto",
  defaultApplicationId: "vscode",
  applications: builtinExternalApplications.map((application) => ({ ...application })),
});

const normalizeLaunchMode = (value: unknown, fallback: ExternalApplicationLaunchMode): ExternalApplicationLaunchMode =>
  value === "native" || value === "command" ? value : fallback;
const normalizeSelectionMode = (value: unknown, fallback: LaunchSelectionMode): LaunchSelectionMode =>
  value === "auto" || value === "manual" ? value : fallback;

export const normalizeExternalApplicationPreferences = (value: unknown): ExternalApplicationPreferences => {
  const defaults = defaultExternalApplicationPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const candidate = value as Partial<Omit<ExternalApplicationPreferences, "schemaVersion">> & { schemaVersion?: unknown };
  const isV2 = candidate.schemaVersion === 2;
  const isV1 = candidate.schemaVersion === 1;
  if (!isV2 && !isV1) return defaults;
  const storedApplications = Array.isArray(candidate.applications) ? candidate.applications : [];
  const builtinNames = new Set(builtinExternalApplications.map((application) => application.name.toLocaleLowerCase()));
  const usedNames = new Set<string>();
  const applications = builtinExternalApplications.map((builtin) => {
    const stored = storedApplications.find(
      (application) =>
        application && typeof application === "object" && (application as ExternalApplication).id === builtin.id,
    ) as Partial<ExternalApplication> | undefined;
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
    const launchMode = normalizeLaunchMode(
      stored?.launchMode,
      command === builtin.command ? "native" : "command",
    );
    usedNames.add(name.toLocaleLowerCase());
    return { ...builtin, name, command, enabled: stored?.enabled !== false, launchMode };
  });
  const usedIds = new Set(applications.map((application) => application.id));

  for (const stored of storedApplications) {
    if (!stored || typeof stored !== "object") continue;
    const application = stored as Partial<ExternalApplication>;
    const id = typeof application.id === "string" ? application.id.trim() : "";
    const name = typeof application.name === "string" ? application.name.trim() : "";
    const command = typeof application.command === "string" ? application.command.trim() : "";
    const normalizedName = name.toLocaleLowerCase();
    if (application.kind !== "custom" || !id || !name || !command || usedIds.has(id) || usedNames.has(normalizedName)) {
      continue;
    }
    usedIds.add(id);
    usedNames.add(normalizedName);
    applications.push({ id, name, kind: "custom", command, enabled: application.enabled !== false, launchMode: "command" });
  }

  let defaultApplicationId =
    typeof candidate.defaultApplicationId === "string" ? candidate.defaultApplicationId.trim() : "";
  if (!applications.some((application) => application.id === defaultApplicationId && application.enabled)) {
    defaultApplicationId = applications.find((application) => application.enabled)?.id || "vscode";
  }
  if (!applications.some((application) => application.enabled)) {
    applications[0]!.enabled = true;
    defaultApplicationId = applications[0]!.id;
  }
  const pristineV1 =
    isV1 &&
    candidate.defaultApplicationId === "vscode" &&
    storedApplications.length === builtinExternalApplications.length &&
    applications.every((application, index) => {
      const builtin = builtinExternalApplications[index];
      return builtin && application.name === builtin.name && application.command === builtin.command && application.enabled;
    });
  return {
    schemaVersion: 2,
    mode: normalizeSelectionMode(candidate.mode, pristineV1 ? "auto" : "manual"),
    defaultApplicationId,
    applications,
  };
};

const migrateEditorPreferences = (value: unknown): ExternalApplicationPreferences => {
  if (!value || typeof value !== "object") return defaultExternalApplicationPreferences();
  const editor = normalizeEditorPreferences(value);
  if (editor.kind === "vscode" || editor.kind === "cursor") {
    return { ...defaultExternalApplicationPreferences(), mode: "manual", defaultApplicationId: editor.kind };
  }
  const command = editor.customCommand.trim();
  if (!command) return defaultExternalApplicationPreferences();
  return {
    schemaVersion: 2,
    mode: "manual",
    defaultApplicationId: "legacy-custom-editor",
    applications: [
      ...builtinExternalApplications.map((application) => ({ ...application })),
      {
        id: "legacy-custom-editor",
        name: "Custom Editor",
        kind: "custom",
        command,
        enabled: true,
        launchMode: "command",
      },
    ],
  };
};

const defaultEnvironmentPreferences = (): EnvironmentPreferences => ({
  enabledToolKeys: ["node", "npm", "pnpm", "python", "go", "git"],
  customTools: [],
  builtinOverrides: [],
});

const cloneDefaultAiModes = (): AiPromptMode[] => DEFAULT_AI_PROMPT_MODES.map((mode) => ({ ...mode }));

const normalizeAiProviderKind = (provider: unknown): AiProviderKind => {
  if (provider === "openai" || provider === "openai-responses") return "openai-compatible";
  if (provider === "anthropic") return "anthropic-compatible";
  return typeof provider === "string" && aiProviderKinds.has(provider as AiProviderKind)
    ? (provider as AiProviderKind)
    : "utools";
};

const normalizeAiModeKind = (id: string, kind: unknown): AiPromptModeKind => {
  if (id === AI_COMMIT_MESSAGE_MODE_ID) {
    return "commit-message";
  }
  return typeof kind === "string" && aiPromptModeKinds.has(kind as AiPromptModeKind) && kind !== "commit-message"
    ? (kind as AiPromptModeKind)
    : "git-analysis";
};

const normalizeAiModes = (value: unknown, legacyCommitMessagePrompt?: unknown): AiPromptMode[] => {
  const defaults = cloneDefaultAiModes();
  const defaultById = new Map(defaults.map((mode) => [mode.id, mode]));
  const defaultIds = new Set(defaults.map((mode) => mode.id));
  const legacyPrompt = typeof legacyCommitMessagePrompt === "string" ? legacyCommitMessagePrompt : "";
  const defaultModeWithLegacyPrompt = (mode: AiPromptMode) =>
    mode.id === AI_COMMIT_MESSAGE_MODE_ID && legacyPrompt
      ? { ...mode, prompt: legacyPrompt === legacyDefaultAiCommitMessagePrompt ? mode.prompt : legacyPrompt }
      : mode;
  if (!Array.isArray(value)) {
    return defaults.map(defaultModeWithLegacyPrompt);
  }

  const modes = new Map<string, AiPromptMode>();
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const candidate = item as Partial<AiPromptMode>;
    const fallbackId = candidate.builtIn ? defaults[index]?.id : `custom-${index + 1}`;
    const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : fallbackId;
    const name = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : id;
    const defaultPrompt = defaultById.get(id)?.prompt || "";
    const prompt =
      typeof candidate.prompt === "string"
        ? id === AI_COMMIT_MESSAGE_MODE_ID && candidate.prompt === legacyDefaultAiCommitMessagePrompt
          ? defaultPrompt
          : candidate.prompt
        : defaultPrompt;
    if (!id || modes.has(id)) return;
    modes.set(id, { id, name, prompt, builtIn: defaultIds.has(id), kind: normalizeAiModeKind(id, candidate.kind) });
  });

  defaults.forEach((defaultMode) => {
    if (!modes.has(defaultMode.id)) {
      modes.set(defaultMode.id, defaultModeWithLegacyPrompt(defaultMode));
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

  const candidate = value as Partial<TerminalPreferences> & { schemaVersion?: unknown; mode?: unknown };
  const legacyKind = isTerminalKind(candidate.kind) ? candidate.kind : defaults.kind;
  return {
    schemaVersion: 2,
    mode: normalizeSelectionMode(candidate.mode, candidate.schemaVersion === 2 ? "auto" : legacyKind === "builtin" ? "auto" : "manual"),
    kind: legacyKind === "builtin" ? defaults.kind : legacyKind,
    customCommand: typeof candidate.customCommand === "string" ? candidate.customCommand : "",
  };
};

const normalizeEditorPreferences = (value: unknown): LegacyEditorPreferences => {
  const defaults = defaultEditorPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const candidate = value as Partial<LegacyEditorPreferences>;
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
  const customTools = Array.isArray(candidate.customTools)
    ? candidate.customTools
        .map(normalizeCustomEnvironmentTool)
        .filter((tool) => tool !== null)
        .filter((tool, index, tools) => tools.findIndex((item) => item.id === tool.id) === index)
    : [];
  const builtinOverrides = Array.isArray(candidate.builtinOverrides)
    ? candidate.builtinOverrides
        .map(normalizeBuiltinEnvironmentToolOverride)
        .filter((override) => override !== null)
        .filter((override, index, overrides) => overrides.findIndex((item) => item.key === override.key) === index)
    : [];
  return {
    enabledToolKeys: Array.from(new Set(enabledToolKeys)),
    customTools,
    builtinOverrides,
  };
};

const normalizeAiPreferences = (value: unknown): AiPreferences => {
  const defaults = defaultAiPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const candidate = value as Partial<AiPreferences> & { commitMessagePrompt?: unknown };
  const provider = normalizeAiProviderKind(candidate.provider);
  return {
    provider,
    baseUrl: typeof candidate.baseUrl === "string" ? candidate.baseUrl : defaults.baseUrl,
    model: typeof candidate.model === "string" ? candidate.model : defaults.model,
    apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : defaults.apiKey,
    modes: normalizeAiModes(candidate.modes, candidate.commitMessagePrompt),
  };
};

const readStoredTerminalPreferences = (): TerminalPreferences => {
  try {
    const v2 = window.localStorage?.getItem(localTerminalPreferencesV2StorageKey);
    const raw =
      v2 !== null && v2 !== undefined
        ? v2
        : window.localStorage?.getItem(localTerminalPreferencesStorageKey) ||
          window.localStorage?.getItem(terminalPreferencesStorageKey);
    if (!raw) {
      return defaultTerminalPreferences();
    }
    const preferences = normalizeTerminalPreferences(JSON.parse(raw));
    if (!v2) writeStoredTerminalPreferences(preferences);
    return preferences;
  } catch (error) {
    return defaultTerminalPreferences();
  }
};

const writeStoredTerminalPreferences = (preferences: TerminalPreferences) => {
  const normalized = normalizeTerminalPreferences(preferences);

  try {
    window.localStorage?.setItem(localTerminalPreferencesV2StorageKey, JSON.stringify(normalized));
  } catch (error) {
    // Keep settings updates non-blocking in browser preview and uTools fallback modes.
  }
};

const writeStoredExternalApplicationPreferences = (preferences: ExternalApplicationPreferences) => {
  const normalized = normalizeExternalApplicationPreferences(preferences);
  try {
    window.localStorage?.setItem(externalApplicationPreferencesV2StorageKey, JSON.stringify(normalized));
  } catch (error) {
    // Keep settings updates non-blocking in browser preview and uTools fallback modes.
  }
};

const readStoredExternalApplicationPreferences = (): ExternalApplicationPreferences => {
  try {
    const v2 = window.localStorage?.getItem(externalApplicationPreferencesV2StorageKey);
    const current = v2 !== null && v2 !== undefined
      ? v2
      : window.localStorage?.getItem(externalApplicationPreferencesStorageKey);
    const localLegacy = window.localStorage?.getItem(localEditorPreferencesStorageKey);
    const preferences =
      typeof current === "string"
        ? normalizeExternalApplicationPreferences(JSON.parse(current))
        : migrateEditorPreferences(
            JSON.parse(
              typeof localLegacy === "string"
                ? localLegacy
                : window.localStorage?.getItem(editorPreferencesStorageKey) || "null",
            ),
          );
    writeStoredExternalApplicationPreferences(preferences);
    return preferences;
  } catch (error) {
    const preferences = defaultExternalApplicationPreferences();
    writeStoredExternalApplicationPreferences(preferences);
    return preferences;
  }
};

const defaultUiPreferences = (): UiPreferences => ({
  schemaVersion: 1,
  projectDetails: { tabOrder: [...projectDetailsTabIds] },
  coachMarks: { projectDetailsTabReorder: 0 },
});

const normalizeProjectDetailsTabOrder = (value: unknown): ProjectDetailsTabId[] => {
  const knownIds = Array.isArray(value)
    ? value.filter((id): id is ProjectDetailsTabId => projectDetailsTabIdSet.has(id as ProjectDetailsTabId))
    : [];
  return [...new Set(knownIds), ...projectDetailsTabIds.filter((id) => !knownIds.includes(id))];
};

export const normalizeUiPreferences = (value: unknown): UiPreferences => {
  const defaults = defaultUiPreferences();
  if (!value || typeof value !== "object" || (value as Partial<UiPreferences>).schemaVersion !== 1) return defaults;
  const candidate = value as Partial<UiPreferences>;
  const coachMarkVersion = candidate.coachMarks?.projectDetailsTabReorder;
  return {
    schemaVersion: 1,
    projectDetails: { tabOrder: normalizeProjectDetailsTabOrder(candidate.projectDetails?.tabOrder) },
    coachMarks: {
      projectDetailsTabReorder:
        typeof coachMarkVersion === "number" && Number.isInteger(coachMarkVersion) && coachMarkVersion >= 0
          ? coachMarkVersion
          : 0,
    },
  };
};

const writeStoredUiPreferences = (preferences: UiPreferences) => {
  const normalized = normalizeUiPreferences(preferences);
  try {
    window.localStorage?.setItem(uiPreferencesStorageKey, JSON.stringify(normalized));
    window.localStorage?.setItem(projectDetailsTabOrderStorageKey, JSON.stringify(normalized.projectDetails.tabOrder));
  } catch {
    // Keep UI preference updates non-blocking when browser storage is unavailable.
  }
};

const readStoredUiPreferences = (): UiPreferences => {
  try {
    const raw = window.localStorage?.getItem(uiPreferencesStorageKey);
    if (raw !== null && raw !== undefined) return normalizeUiPreferences(JSON.parse(raw));

    const legacyRaw = window.localStorage?.getItem(projectDetailsTabOrderStorageKey);
    const legacyValue = legacyRaw ? JSON.parse(legacyRaw) : null;
    const tabOrder = normalizeProjectDetailsTabOrder(legacyValue);
    const preferences: UiPreferences = {
      schemaVersion: 1,
      projectDetails: { tabOrder },
      coachMarks: {
        projectDetailsTabReorder:
          Array.isArray(legacyValue) && tabOrder.some((id, index) => id !== projectDetailsTabIds[index]) ? 1 : 0,
      },
    };
    writeStoredUiPreferences(preferences);
    return preferences;
  } catch {
    return defaultUiPreferences();
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
  headHash: "",
  isDetachedHead: false,
  ahead: 0,
  behind: 0,
  files: [],
  commits: [],
  branches: [],
  remotes: [],
  upstream: null,
  base: null,
  hasMoreCommits: false,
  nextCommitSkip: 0,
  repositoryPath: "",
  lastRefreshedAt: new Date().toISOString(),
  statusText: "离线预览",
});

const emptyGitStatusSnapshot = (): ProjectBridgeGitStatusSnapshot => {
  const snapshot = emptyGitSnapshot();
  return {
    branch: snapshot.branch,
    headHash: snapshot.headHash,
    isDetachedHead: snapshot.isDetachedHead,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    files: snapshot.files,
    branches: snapshot.branches,
    remotes: snapshot.remotes,
    upstream: snapshot.upstream,
    base: snapshot.base,
    repositoryPath: snapshot.repositoryPath,
    lastRefreshedAt: snapshot.lastRefreshedAt,
    statusText: snapshot.statusText,
  };
};

const emptyGitWorkingTreeSnapshot = () => {
  const snapshot = emptyGitStatusSnapshot();
  return {
    files: snapshot.files,
    repositoryPath: snapshot.repositoryPath,
    lastRefreshedAt: snapshot.lastRefreshedAt,
    statusText: snapshot.statusText,
  };
};

const emptyGitCommitPage = (): ProjectBridgeGitCommitPage => {
  const snapshot = emptyGitSnapshot();
  return {
    commits: snapshot.commits,
    hasMoreCommits: snapshot.hasMoreCommits,
    nextCommitSkip: snapshot.nextCommitSkip,
    repositoryPath: snapshot.repositoryPath,
    lastRefreshedAt: snapshot.lastRefreshedAt,
  };
};

const unavailableGitWorkspaceSnapshot = (): ProjectBridgeGitWorkspaceSnapshot => {
  const failure = {
    code: "unsupported-output" as const,
    operation: "repository" as const,
    message: "浏览器预览无法读取本地 Git 工作区关系。",
  };

  return {
    repositoryPath: "",
    objectFormat: null,
    worktrees: { state: "unavailable", entries: [], failure },
    submodules: { state: "unavailable", entries: [], failure },
    lastRefreshedAt: new Date().toISOString(),
  };
};

const unavailableGitAction = (message = "浏览器预览无法执行 Git 写操作。"): ProjectGitActionResult => ({
  ok: false,
  message,
});

const loadFallbackDeviceId = (): string => {
  try {
    const stored = window.localStorage?.getItem(deviceIdStorageKey)?.trim();
    if (stored) {
      return stored;
    }

    const nextId = window.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage?.setItem(deviceIdStorageKey, nextId);
    return nextId;
  } catch (error) {
    return "device-fallback";
  }
};

const fallbackBridge: ProjectBridge = {
  loadDeviceId() {
    return loadFallbackDeviceId();
  },
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
  loadUiPreferences() {
    return readStoredUiPreferences();
  },
  saveUiPreferences(preferences) {
    writeStoredUiPreferences(preferences);
  },
  loadTerminalPreferences() {
    return readStoredTerminalPreferences();
  },
  saveTerminalPreferences(preferences) {
    writeStoredTerminalPreferences(preferences);
  },
  loadExternalApplicationPreferences() {
    return readStoredExternalApplicationPreferences();
  },
  saveExternalApplicationPreferences(preferences) {
    writeStoredExternalApplicationPreferences(preferences);
  },
  loadEnvironmentPreferences() {
    return readStoredEnvironmentPreferences();
  },
  saveEnvironmentPreferences(preferences) {
    writeStoredEnvironmentPreferences(preferences);
  },
  loadBuiltinEnvironmentTools() {
    return BUILTIN_ENVIRONMENT_TOOLS.map(
      (tool): EnvironmentToolDefinition => ({ ...tool, versionArgs: [...tool.versionArgs] }),
    );
  },
  async detectEnvironmentTool(request: EnvironmentToolRequest) {
    const key = request.kind === "custom" ? request.id : request.key;
    const name =
      request.kind === "custom"
        ? request.name
        : BUILTIN_ENVIRONMENT_TOOLS.find((tool) => tool.key === request.key)?.name || request.key;
    return {
      key,
      name,
      status: "error" as const,
      version: "",
      executablePath: "",
      checkedAt: new Date().toISOString(),
      error: "浏览器预览无法检测本机开发环境。",
    };
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
      scripts: [],
      packagePath: null,
      git: emptyGitSnapshot(),
      message: "浏览器预览无法读取本地目录，已保留手动填写。",
    };
  },
  async discoverProjectScripts(_projectPath, _options): Promise<ProjectScriptDiscoveryResult> {
    return { scripts: [], message: "uTools 本地桥接未加载，无法读取项目文件；请从 dist/plugin.json 重新加载插件。" };
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
    return ["."];
  },
  async readGitSnapshot(): Promise<ProjectBridgeGitSnapshot> {
    return emptyGitSnapshot();
  },
  async readGitWorkspaceSnapshot(): Promise<ProjectBridgeGitWorkspaceSnapshot> {
    return unavailableGitWorkspaceSnapshot();
  },
  async readGitStatusSnapshot(): Promise<ProjectBridgeGitStatusSnapshot> {
    return emptyGitStatusSnapshot();
  },
  async readGitWorkingTreeSnapshot() {
    return emptyGitWorkingTreeSnapshot();
  },
  async readGitCommits(): Promise<ProjectBridgeGitCommitPage> {
    return emptyGitCommitPage();
  },
  async readGitFileDiff(projectPath: string, relativePath: string, options?: ProjectGitFileDiffOptions) {
    const scope = options?.scope === "staged" || options?.scope === "unstaged" ? options.scope : "combined";
    return {
      path: relativePath,
      scope,
      diff: "",
      message: projectPath ? "浏览器预览无法读取 Git diff。" : "项目路径为空，无法读取 Git diff。",
    };
  },
  async readGitCommitFileDiff(
    projectPath: string,
    commitHash: string,
    relativePath: string,
    _stash?: ProjectGitStash,
    _options?: ProjectGitFileDiffOptions,
  ) {
    return {
      path: relativePath,
      diff: "",
      message: projectPath && commitHash ? "浏览器预览无法读取提交 diff。" : "提交信息为空，无法读取 diff。",
    };
  },
  async readGitCommitFiles(): Promise<ProjectGitFileChange[]> {
    return [];
  },
  async readGitCommitAuthorAvatar(): Promise<string | null> {
    return null;
  },
  async readGitCommitMessageDiff(): Promise<ProjectGitCommitMessageDiffResult> {
    return {
      ok: false,
      scope: "working-tree",
      diff: "",
      message: "浏览器预览无法读取 Git diff。",
    };
  },
  async stageGitFile(): Promise<ProjectGitActionResult> {
    return unavailableGitAction();
  },
  async unstageGitFile(): Promise<ProjectGitActionResult> {
    return unavailableGitAction();
  },
  async discardGitFile(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法丢弃本地文件变更。");
  },
  async stageGitFiles(): Promise<ProjectGitActionResult> {
    return unavailableGitAction();
  },
  async unstageGitFiles(): Promise<ProjectGitActionResult> {
    return unavailableGitAction();
  },
  async discardGitFiles(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法丢弃本地文件变更。");
  },
  async commitGitStaged(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法提交 staged 变更。");
  },
  async createGitStash(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法创建 Git stash。");
  },
  async applyGitStash(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法应用 Git stash。");
  },
  async popGitStash(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法弹出 Git stash。");
  },
  async dropGitStash(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法删除 Git stash。");
  },
  async switchGitBranch(
    _projectPath: string,
    _branchName: string,
    _options: { force?: boolean } = {},
  ): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法切换 Git 分支。");
  },
  async checkoutGitCommit(
    _projectPath: string,
    _commitHash: string,
    _options: { force?: boolean; preferredBranch?: string; detach?: boolean } = {},
  ): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法切换到 Git 提交。");
  },
  async createGitBranch(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法创建 Git 分支。");
  },
  async createGitTag(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法创建 Git 标签。");
  },
  async deleteGitTag(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法删除 Git 标签。");
  },
  async renameGitBranch(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法重命名 Git 分支。");
  },
  async deleteGitBranch(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法删除 Git 分支。");
  },
  async checkoutGitRemoteBranch(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法检出远程 Git 分支。");
  },
  async fetchGitRemote(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法执行 Git fetch。");
  },
  async pullGitRemote(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法执行 Git pull。");
  },
  async pushGitRemote(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法执行 Git push。");
  },
  async addGitRemote(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法添加 Git remote。");
  },
  async setGitRemoteUrl(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法修改 Git remote URL。");
  },
  async removeGitRemote(): Promise<ProjectGitActionResult> {
    return unavailableGitAction("浏览器预览无法删除 Git remote。");
  },
  async listProjectFiles(projectPath: string, relativePath = ""): Promise<ProjectFileListResult> {
    return { rootPath: projectPath, relativePath, entries: [] };
  },
  async searchProjectFiles(
    projectPath: string,
    query: string,
    _options?: { limit?: number },
  ): Promise<ProjectFileSearchResult> {
    return { rootPath: projectPath, query, entries: [], truncated: false };
  },
  async createProjectEntry(
    projectPath: string,
    parentRelativePath: string,
    name: string,
    kind: ProjectFileMutationKind,
  ): Promise<ProjectFileMutationResult> {
    return {
      ok: false,
      kind,
      path: `${projectPath}/${parentRelativePath}/${name}`,
      relativePath: [parentRelativePath, name].filter(Boolean).join("/"),
      message: "浏览器预览无法修改本地文件。",
    };
  },
  async renameProjectEntry(
    projectPath: string,
    relativePath: string,
    _name: string,
  ): Promise<ProjectFileMutationResult> {
    return {
      ok: false,
      kind: "file",
      path: `${projectPath}/${relativePath}`,
      relativePath,
      previousRelativePath: relativePath,
      message: "浏览器预览无法修改本地文件。",
    };
  },
  async deleteProjectEntry(projectPath: string, relativePath: string): Promise<ProjectFileMutationResult> {
    return {
      ok: false,
      kind: "file",
      path: `${projectPath}/${relativePath}`,
      relativePath,
      message: "浏览器预览无法删除本地文件。",
    };
  },
  async showProjectEntryInFolder(_projectPath: string, _relativePath: string): Promise<void> {},
  async detectHostLaunchCapabilities(): Promise<HostLaunchCapabilities> {
    return { platform: "unsupported", terminals: [], editors: [], checkedAt: new Date().toISOString() };
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
      code: "preview-unsupported",
      message: "浏览器预览暂不支持打开外部终端。",
    };
  },
  async openExternalApplication(
    payload: ProjectBridgeExternalApplicationLaunchPayload,
  ): Promise<ProjectBridgeExternalApplicationLaunchResult> {
    return {
      launched: false,
      command: "",
      cwd: payload.projectPath,
      applicationId: payload.application.id,
      kind: payload.application.kind,
      code: "preview-unsupported",
      message: "浏览器预览暂不支持打开外部应用。",
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
  async stopProcess(_pid: number, _options?: ProjectBridgeStopProcessOptions): Promise<void> {
    return undefined;
  },
  async getProcessStatus(): Promise<{ active: boolean }> {
    return { active: true };
  },
  async getAutomationProcessResult(): Promise<null> {
    return null;
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
