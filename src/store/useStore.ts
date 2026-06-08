import { defineStore } from "pinia";
import { aiStreamChunkRawText } from "../lib/aiReasoning";
import { getProjectBridge, supportsRealProjectBridge } from "../lib/projectBridge";
import { DEFAULT_AI_PROMPT_MODES, ProjectStatus } from "../types";
import type {
  AiPreferences,
  AiAnalyzeResult,
  AiStreamChunkPayload,
  AiModelInfo,
  AiPromptMode,
  DefaultTerminalKind,
  DefaultEditorKind,
  EnvironmentPreferences,
  EnvironmentToolKey,
  EnvironmentToolResult,
  Locale,
  LogEntry,
  Project,
  ProjectGitActionResult,
  ProjectGitCommitMessageDiffResult,
  ProjectConfigFile,
  ProjectBridgeEvent,
  ProjectEnvironmentEntry,
  ProjectFormValue,
  ProjectGitFileChange,
  ProjectGitFileDiffResult,
  ProjectGitSnapshot,
  ProjectFileListResult,
  ProjectFileReadResult,
  ProjectFileWriteResult,
  ProjectIconKey,
  ProjectKind,
  ProjectScript,
  ProjectScriptFormValue,
  TerminalPreferences,
  EditorPreferences,
  TodoItem,
} from "../types";

const bridge = getProjectBridge();

type AiAnalysisState = "idle" | "loading" | "success" | "warning" | "error";

interface AiStreamHandlers {
  onStart?: () => void;
  onChunk?: (chunk: AiStreamChunkPayload) => void;
  onDone?: (result: AiAnalyzeResult) => void;
}

const createScriptId = (projectId: string, index: number) => `${projectId}-script-${index + 1}`;
const createAiPromptModeId = () => `custom-${Date.now()}`;
const createTodoId = () => `todo-${Date.now()}`;
const createEnvId = () => `env-${Date.now()}`;
const createProjectId = () => `project-${Date.now()}`;
const PROJECT_CONFIG_MESSAGE_CLEAR_DELAY_MS = 4000;
let projectConfigMessageClearTimer: number | null = null;
const ansiControlPattern =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function cancelProjectConfigMessageClear() {
  if (projectConfigMessageClearTimer) {
    window.clearTimeout(projectConfigMessageClearTimer);
    projectConfigMessageClearTimer = null;
  }
}

function resolveProjectSortOrder(project: Project, fallbackIndex = 0): number {
  return typeof project.sortOrder === "number" && Number.isFinite(project.sortOrder)
    ? project.sortOrder
    : fallbackIndex;
}

function normalizeQuickLink(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProjectGroup(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toPersistedProject(project: Project, sortOrder?: number): Project {
  const persistedStatus = project.pathExists === false ? ProjectStatus.WARNING : ProjectStatus.STOPPED;
  const persistedSortOrder =
    typeof sortOrder === "number" && Number.isFinite(sortOrder) ? sortOrder : resolveProjectSortOrder(project);

  return {
    id: project.id,
    name: project.name,
    path: project.path,
    type: project.type,
    kind: project.kind,
    icon: project.icon || inferProjectIcon(project.kind, project.type, project.name),
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    description: project.description || "",
    status: persistedStatus,
    lastUpdated: project.lastUpdated || "",
    scripts: project.scripts.map((script) => ({
      id: script.id,
      name: script.name,
      command: script.command,
      cwd: script.cwd || ".",
      note: script.note || "",
      source: script.source || "manual",
      status: "IDLE",
    })),
    env: project.env || {},
    branch: project.branch || "main",
    memo: project.memo || "",
    todos: project.todos || [],
    git: null,
    gitLatestCommitAt: project.gitLatestCommitAt || project.git?.commits?.[0]?.date || "",
    sortOrder: persistedSortOrder,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function isImportableProject(project: Project): boolean {
  return Boolean(
    project &&
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    project.name.trim() &&
    typeof project.path === "string" &&
    project.path.trim() &&
    Array.isArray(project.scripts) &&
    project.scripts.every((script) => typeof script.name === "string" && typeof script.command === "string"),
  );
}

function resolveScriptCwd(projectPath: string, scriptCwd: string | undefined): string {
  const cwd = scriptCwd?.trim();
  if (!cwd || cwd === ".") {
    return projectPath;
  }

  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(cwd)) {
    return cwd;
  }

  return `${projectPath.replace(/[\\/]$/, "")}/${cwd}`;
}

function normalizeGitSnapshot(snapshot: ProjectGitSnapshot | null | undefined): ProjectGitSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    branch: snapshot.branch || "main",
    headHash: snapshot.headHash || "",
    isDetachedHead: Boolean(snapshot.isDetachedHead),
    ahead: snapshot.ahead || 0,
    behind: snapshot.behind || 0,
    files: snapshot.files || [],
    commits: snapshot.commits || [],
    branches: snapshot.branches || [],
    hasMoreCommits: snapshot.hasMoreCommits || false,
    repositoryPath: snapshot.repositoryPath || "",
    lastRefreshedAt: snapshot.lastRefreshedAt || new Date().toISOString(),
    statusText: snapshot.statusText || "OK",
  };
}

function scriptFromForm(projectId: string, script: ProjectScriptFormValue, index: number): ProjectScript {
  return {
    id: script.id || createScriptId(projectId, index),
    name: script.name.trim(),
    command: script.command.trim(),
    status: "IDLE",
    cwd: script.cwd.trim() || ".",
    note: script.note.trim(),
    source: script.source,
  };
}

function formFromProject(project: Project): ProjectFormValue {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    type: project.type,
    kind: project.kind,
    icon: project.icon || inferProjectIcon(project.kind, project.type, project.name),
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    description: project.description || "",
    branch: project.branch || "main",
    memo: project.memo || "",
    envEntries: Object.entries(project.env).map(([key, value]) => ({
      id: `${project.id}-${key}`,
      key,
      value,
    })),
    scripts: project.scripts.map((script) => ({
      id: script.id,
      name: script.name,
      command: script.command,
      cwd: script.cwd || ".",
      note: script.note || "",
      source: script.source || "manual",
    })),
  };
}

function envFromEntries(entries: ProjectEnvironmentEntry[]): Record<string, string> {
  return entries.reduce<Record<string, string>>((accumulator, entry) => {
    const key = entry.key.trim();
    if (key) {
      accumulator[key] = entry.value;
    }
    return accumulator;
  }, {});
}

function inferProjectIcon(kind: ProjectKind, type = "", name = ""): ProjectIconKey {
  const source = `${kind} ${type} ${name}`.toLowerCase();
  if (/\b(vue|vite|nuxt)\b/.test(source)) return "vue";
  if (/\b(react|next)\b/.test(source)) return "react";
  if (/\bpython|py\b/.test(source)) return "python";
  if (/\bgo(lang)?\b/.test(source)) return "go";
  if (/\brust|cargo\b/.test(source)) return "rust";
  if (/\bjava|spring\b/.test(source)) return "java";
  if (/\bdocker|compose\b/.test(source)) return "docker";
  if (/\b(db|sql|mysql|postgres|redis|mongo)\b/.test(source)) return "database";
  if (/\b(browser|web|frontend)\b/.test(source)) return "browser";
  if (/\b(ai|llm|gpt|claude)\b/.test(source)) return "ai";
  if (kind === "node") return "node";
  if (kind === "python") return "python";
  if (kind === "go") return "go";
  if (kind === "executable") return "executable";
  return "custom";
}

function hydrateProject(project: Project): Project {
  return {
    ...project,
    icon: project.icon || inferProjectIcon(project.kind, project.type, project.name),
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    branch: project.branch || project.git?.branch || "main",
    description: project.description || "",
    memo: project.memo || "",
    todos: project.todos || [],
    git: normalizeGitSnapshot(project.git),
    pathExists: project.pathExists ?? true,
    unavailableReason: project.unavailableReason || "",
    sortOrder: resolveProjectSortOrder(project),
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString(),
    scripts: project.scripts.map((script, index) => ({
      id: script.id || createScriptId(project.id, index),
      name: script.name || "start",
      command: script.command || "",
      status: script.status || "IDLE",
      cwd: script.cwd || ".",
      note: script.note || "",
      source: script.source || "manual",
    })),
  };
}

function deriveProjectStatus(project: Project): ProjectStatus {
  if (project.pathExists === false) {
    return ProjectStatus.WARNING;
  }
  if (project.scripts.some((script) => script.status === "RUNNING" || script.status === "STOPPING")) {
    return ProjectStatus.RUNNING;
  }
  if (project.scripts.some((script) => script.status === "ERROR")) {
    return ProjectStatus.ERROR;
  }
  return ProjectStatus.STOPPED;
}

function createLogEntry(message: string, type: LogEntry["type"]): LogEntry {
  return {
    timestamp: new Date().toLocaleTimeString(),
    message,
    type,
  };
}

function scheduleProcessStop(pid: number) {
  window.setTimeout(() => {
    void bridge.stopProcess(pid).catch(() => undefined);
  }, 0);
}

function normalizeLogLines(message: string): string[] {
  const normalized = message.replace(ansiControlPattern, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  return normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function classifyProcessOutputLine(line: string, source: "stdout" | "stderr"): LogEntry["type"] {
  const normalized = line.toLowerCase();
  const benignErrorPattern = /\b(no errors?|0 errors?|without errors?)\b/;
  const errorPattern =
    /\b(error|failed|failure|exception|fatal|panic|traceback|uncaught|denied|not found|eaddrinuse|enoent)\b|exit code [1-9]/;
  const warningPattern = /\b(warn|warning|deprecated)\b/;
  const readyPattern =
    /\b(ready|listening|started|compiled|served|local:|network:|vite|webpack|next|nuxt|dev server|watching|hmr)\b/;

  if (!benignErrorPattern.test(normalized) && errorPattern.test(normalized)) {
    return "ERROR";
  }
  if (warningPattern.test(normalized)) {
    return "WARN";
  }
  if (readyPattern.test(normalized)) {
    return "SUCCESS";
  }

  return source === "stderr" ? "INFO" : "INFO";
}

function demoProject(id: string, project: Project): Project {
  return hydrateProject({
    ...project,
    id,
  });
}

const demoProjects: Project[] = [
  demoProject("project-node-1", {
    id: "project-node-1",
    name: "AI Portfolio",
    path: "~/projects/ai-portfolio",
    type: "Node.js",
    kind: "node",
    icon: "node",
    description: "Frontend plus backend app with package scripts.",
    status: ProjectStatus.RUNNING,
    lastUpdated: "2h ago",
    branch: "feature/memo-integration",
    scripts: [
      {
        id: "project-node-1-script-1",
        name: "dev",
        command: "npm run dev",
        status: "RUNNING",
        cwd: ".",
        source: "package-json",
        note: "frontend dev server",
      },
      {
        id: "project-node-1-script-2",
        name: "server",
        command: "npm run server",
        status: "IDLE",
        cwd: ".",
        source: "package-json",
        note: "backend api",
      },
    ],
    env: { PORT: "3000", DB_HOST: "localhost", API_KEY: "••••••••••••••••" },
    memo: "# Launch notes\n\nRun frontend first, then backend.",
    todos: [
      { id: "t1", text: "Check package scripts", completed: true },
      { id: "t2", text: "Verify Git snapshot", completed: false },
    ],
    git: {
      branch: "feature/memo-integration",
      ahead: 1,
      behind: 0,
      files: [
        { path: "src/components/MemoTab.vue", additions: 18, deletions: 5, status: "MODIFIED" },
        { path: "src/lib/projectBridge.ts", additions: 120, deletions: 0, status: "ADDED" },
      ],
      commits: [
        { hash: "c2561e6", author: "wyxa", date: "2026-05-18", message: "docs: init" },
        {
          hash: "adcd228",
          author: "wyxa",
          date: "2026-05-17",
          message: "chore(task): archive 00-bootstrap-guidelines",
        },
      ],
      repositoryPath: "~/projects/ai-portfolio",
      lastRefreshedAt: new Date().toISOString(),
      statusText: "2 files modified",
    },
  }),
  demoProject("project-python-1", {
    id: "project-python-1",
    name: "Data Scraper",
    path: "~/projects/data-scraper",
    type: "Python",
    kind: "python",
    description: "A Python automation project with custom launch commands.",
    status: ProjectStatus.STOPPED,
    scripts: [
      {
        id: "project-python-1-script-1",
        name: "run",
        command: "python main.py",
        status: "IDLE",
        cwd: ".",
        source: "manual",
      },
      {
        id: "project-python-1-script-2",
        name: "test",
        command: "pytest",
        status: "IDLE",
        cwd: ".",
        source: "manual",
      },
    ],
    env: { DB_URL: "postgresql://localhost:5432" },
    memo: "Remember to activate the virtual environment before launch.",
    todos: [{ id: "t3", text: "Add virtual env bootstrap", completed: false }],
    git: {
      branch: "main",
      ahead: 0,
      behind: 0,
      files: [],
      commits: [],
      repositoryPath: "~/projects/data-scraper",
      lastRefreshedAt: new Date().toISOString(),
      statusText: "工作区干净",
    },
  }),
  demoProject("project-go-1", {
    id: "project-go-1",
    name: "Finance App",
    path: "~/projects/finance-app",
    type: "Go",
    kind: "go",
    description: "Go service with a compiled binary target.",
    status: ProjectStatus.ERROR,
    scripts: [
      {
        id: "project-go-1-script-1",
        name: "run",
        command: "go run main.go",
        status: "ERROR",
        cwd: ".",
        source: "manual",
      },
      {
        id: "project-go-1-script-2",
        name: "build",
        command: "go build -o bin/finance-app",
        status: "IDLE",
        cwd: ".",
        source: "manual",
      },
    ],
    env: { PORT: "8080" },
    memo: "Binary launch is supported through executable scripts.",
    todos: [],
    git: {
      branch: "main",
      ahead: 0,
      behind: 2,
      files: [{ path: "cmd/server/main.go", additions: 6, deletions: 3, status: "MODIFIED" }],
      commits: [{ hash: "f7f4ce7", author: "wyxa", date: "2026-05-16", message: "init" }],
      repositoryPath: "~/projects/finance-app",
      lastRefreshedAt: new Date().toISOString(),
      statusText: "1 file modified",
    },
  }),
];

function createBlankProjectForm(): ProjectFormValue {
  return {
    id: null,
    name: "",
    path: "",
    type: "Node.js",
    kind: "node",
    icon: "node",
    quickLink: "",
    group: "",
    description: "",
    branch: "main",
    memo: "",
    envEntries: [],
    scripts: [
      {
        id: `script-${Date.now()}`,
        name: "dev",
        command: "npm run dev",
        cwd: ".",
        note: "",
        source: "manual",
      },
    ],
  };
}

export const useStore = defineStore("app", {
  state: () => ({
    locale: "zh-CN" as Locale,
    activeTab: "projects" as "projects" | "settings" | "environment",
    theme: "auto" as "light" | "dark" | "auto",
    terminalPreferences: bridge.loadTerminalPreferences(),
    editorPreferences: bridge.loadEditorPreferences(),
    environmentPreferences: bridge.loadEnvironmentPreferences(),
    environmentResults: [] as EnvironmentToolResult[],
    environmentChecked: false,
    environmentRefreshing: false,
    aiPreferences: bridge.loadAiPreferences(),
    aiModels: [] as AiModelInfo[],
    aiModelRefreshing: false,
    aiModelRefreshMessage: "",
    aiModelTesting: false,
    aiModelTestMessage: "",
    aiModelTestOk: null as boolean | null,
    aiAnalyzing: false,
    aiAnalysisResult: "",
    aiAnalysisMessage: "",
    aiAnalysisState: "idle" as AiAnalysisState,
    supportsBridge: supportsRealProjectBridge(),
    projectsLoaded: false,
    projectStorageMessage: "",
    projectConfigMessage: "",
    projectFormInspectionMessage: "",
    projectFormInspecting: false,
    projectFormCwdSuggestions: ["."] as string[],
    projectFormOpen: false,
    projectFormMode: "create" as "create" | "edit",
    projectFormDraft: createBlankProjectForm() as ProjectFormValue,
    pendingDeleteProjectId: null as string | null,
    projects: supportsRealProjectBridge() ? [] : demoProjects,
    selectedProjectId: null as string | null,
    logs: {
      "project-node-1": [
        { timestamp: "10:42:01", message: "> npm run dev", type: "INFO" },
        { timestamp: "10:42:02", message: "VITE v6 ready in 320 ms", type: "SUCCESS" },
        { timestamp: "10:45:12", message: "[hmr] src/components/project/MemoTab.vue updated.", type: "SUCCESS" },
      ],
      "project-go-1": [
        { timestamp: "09:12:11", message: "> go run main.go", type: "ERROR" },
        { timestamp: "09:12:12", message: "build failed: exit status 1", type: "ERROR" },
      ],
    } as Record<string, LogEntry[]>,
    scriptLogs: {
      "project-node-1": {
        "project-node-1-script-1": [
          { timestamp: "10:42:01", message: "> npm run dev", type: "INFO" },
          { timestamp: "10:42:02", message: "VITE v6 ready in 320 ms", type: "SUCCESS" },
          { timestamp: "10:45:12", message: "[hmr] src/components/project/MemoTab.vue updated.", type: "SUCCESS" },
        ],
      },
      "project-go-1": {
        "project-go-1-script-1": [
          { timestamp: "09:12:11", message: "> go run main.go", type: "ERROR" },
          { timestamp: "09:12:12", message: "build failed: exit status 1", type: "ERROR" },
        ],
      },
    } as Record<string, Record<string, LogEntry[]>>,
    stagedFiles: {
      "project-node-1": [
        { path: "src/components/MemoTab.vue", additions: 12, deletions: 4, status: "MODIFIED" },
        { path: "src/utils/markdownParser.ts", additions: 85, deletions: 0, status: "ADDED" },
      ],
      "project-go-1": [{ path: "cmd/server/main.go", additions: 6, deletions: 3, status: "MODIFIED" }],
    } as Record<string, ProjectGitFileChange[]>,
    todos: {
      "project-node-1": [
        { id: "t1", text: "Review launch commands", completed: true },
        { id: "t2", text: "Check Git snapshot", completed: false },
      ],
      "project-python-1": [{ id: "t3", text: "Add environment bootstrap", completed: false }],
    } as Record<string, TodoItem[]>,
    memoContent: {
      "project-node-1": "# Launch notes\n\nRun frontend first, then backend.",
      "project-python-1": "Remember to activate the virtual environment before launch.",
      "project-go-1": "Binary launch is supported through executable scripts.",
    } as Record<string, string>,
  }),

  getters: {
    availableProjects: (state): Project[] => state.projects.filter((project) => project.pathExists !== false),
    unavailableProjects: (state): Project[] => state.projects.filter((project) => project.pathExists === false),
    selectedProject: (state): Project | undefined =>
      state.projects.find((project) => project.id === state.selectedProjectId),
    pendingDeleteProject: (state): Project | undefined =>
      state.projects.find((project) => project.id === state.pendingDeleteProjectId),
    currentMessages: (state) => (state.locale === "zh-CN" ? "zh-CN" : "en-US"),
  },

  actions: {
    async loadProjects() {
      this.terminalPreferences = bridge.loadTerminalPreferences();
      this.editorPreferences = bridge.loadEditorPreferences();
      this.environmentPreferences = bridge.loadEnvironmentPreferences();
      this.aiPreferences = bridge.loadAiPreferences();
      try {
        const storedProjects = await bridge.loadProjects();
        if (this.supportsBridge || storedProjects.length > 0) {
          this.projects = storedProjects.map(hydrateProject);
          this.selectedProjectId = storedProjects.some((project) => project.id === this.selectedProjectId)
            ? this.selectedProjectId
            : null;
        }
      } catch (error) {
        this.projectStorageMessage = "项目配置读取失败，已保留当前会话数据";
      }

      this.projectsLoaded = true;
      await this.refreshProjectAvailability();
      this.projects.forEach((project) => {
        this.memoContent[project.id] = project.memo || this.memoContent[project.id] || "";
        this.todos[project.id] = project.todos || this.todos[project.id] || [];
        this.logs[project.id] = this.logs[project.id] || [];
        this.scriptLogs[project.id] = this.scriptLogs[project.id] || {};
        this.stagedFiles[project.id] = project.git?.files || this.stagedFiles[project.id] || [];
      });
    },
    async persistProjects() {
      try {
        const persistedProjects = this.projects.map((project, index) => {
          const persistedProject = toPersistedProject(project, index);
          project.sortOrder = persistedProject.sortOrder;
          return persistedProject;
        });
        await bridge.saveProjects(persistedProjects);
        this.projectStorageMessage = "";
      } catch (error) {
        this.projectStorageMessage = "项目配置保存失败，请稍后重试";
      }
    },
    async refreshProjectAvailability() {
      await Promise.all(
        this.projects.map(async (project) => {
          const exists = await bridge.pathExists(project.path);
          project.pathExists = exists;
          project.unavailableReason = exists ? "" : "当前设备无法访问该路径";
          if (exists && project.status === ProjectStatus.WARNING) {
            project.status = ProjectStatus.STOPPED;
          }
          if (!exists) {
            project.status = ProjectStatus.WARNING;
            project.scripts.forEach((script) => {
              script.status = "IDLE";
              script.pid = undefined;
            });
          }
        }),
      );
    },
    setLocale(locale: Locale) {
      this.locale = locale;
    },
    setTheme(theme: "light" | "dark" | "auto") {
      this.theme = theme;
    },
    setProjectConfigMessage(message: string) {
      cancelProjectConfigMessageClear();
      this.projectConfigMessage = message;
      if (!message) {
        return;
      }

      projectConfigMessageClearTimer = window.setTimeout(() => {
        if (this.projectConfigMessage === message) {
          this.projectConfigMessage = "";
        }
        projectConfigMessageClearTimer = null;
      }, PROJECT_CONFIG_MESSAGE_CLEAR_DELAY_MS);
    },
    setDefaultTerminal(kind: DefaultTerminalKind) {
      this.terminalPreferences.kind = kind;
      bridge.saveTerminalPreferences(this.terminalPreferences);
    },
    setDefaultTerminalCustomCommand(command: string) {
      this.terminalPreferences.customCommand = command;
      bridge.saveTerminalPreferences(this.terminalPreferences);
    },
    setDefaultEditor(kind: DefaultEditorKind) {
      this.editorPreferences.kind = kind;
      bridge.saveEditorPreferences(this.editorPreferences);
    },
    setDefaultEditorCustomCommand(command: string) {
      this.editorPreferences.customCommand = command;
      bridge.saveEditorPreferences(this.editorPreferences);
    },
    setEnvironmentToolEnabled(key: EnvironmentToolKey, enabled: boolean) {
      const keys = new Set<EnvironmentToolKey>(this.environmentPreferences.enabledToolKeys);
      if (enabled) {
        keys.add(key);
      } else {
        keys.delete(key);
      }
      const nextPreferences: EnvironmentPreferences = { enabledToolKeys: Array.from(keys) };
      this.environmentPreferences = nextPreferences;
      bridge.saveEnvironmentPreferences(nextPreferences);
      if (!enabled) {
        this.environmentResults = this.environmentResults.filter((result) => result.key !== key);
      }
    },
    async refreshEnvironmentTools() {
      if (this.environmentRefreshing) {
        return;
      }
      this.environmentRefreshing = true;
      const requestedKeys = [...this.environmentPreferences.enabledToolKeys];
      try {
        this.environmentResults = await bridge.detectEnvironmentTools(requestedKeys);
      } catch (error) {
        const checkedAt = new Date().toISOString();
        this.environmentResults = requestedKeys.map((key) => ({
          key,
          name: key,
          status: "error",
          version: "",
          executablePath: "",
          checkedAt,
          error: error instanceof Error ? error.message : "环境检测失败。",
        }));
      } finally {
        this.environmentChecked = true;
        this.environmentRefreshing = false;
      }
    },
    setAiPreferences(patch: Partial<AiPreferences>) {
      this.aiPreferences = { ...this.aiPreferences, ...patch };
      bridge.saveAiPreferences(this.aiPreferences);
    },
    addAiPromptMode() {
      const id = createAiPromptModeId();
      const nextMode: AiPromptMode = {
        id,
        name: "自定义模式",
        prompt: "请基于以下 Git 信息输出面向开发者的结构化内容。",
        builtIn: false,
        kind: "git-analysis",
      };
      this.aiPreferences = { ...this.aiPreferences, modes: [...this.aiPreferences.modes, nextMode] };
      bridge.saveAiPreferences(this.aiPreferences);
      return id;
    },
    updateAiPromptMode(modeId: string, patch: Partial<Pick<AiPromptMode, "name" | "prompt">>) {
      const modes = this.aiPreferences.modes.map((mode) =>
        mode.id === modeId
          ? {
              ...mode,
              name: typeof patch.name === "string" ? patch.name : mode.name,
              prompt: typeof patch.prompt === "string" ? patch.prompt : mode.prompt,
            }
          : mode,
      );
      this.aiPreferences = { ...this.aiPreferences, modes };
      bridge.saveAiPreferences(this.aiPreferences);
    },
    deleteAiPromptMode(modeId: string) {
      const modes = this.aiPreferences.modes.filter((mode) => mode.builtIn || mode.id !== modeId);
      this.aiPreferences = {
        ...this.aiPreferences,
        modes: modes.length > 0 ? modes : DEFAULT_AI_PROMPT_MODES.map((mode) => ({ ...mode })),
      };
      bridge.saveAiPreferences(this.aiPreferences);
    },
    resetAiPromptModes() {
      this.aiPreferences = {
        ...this.aiPreferences,
        modes: DEFAULT_AI_PROMPT_MODES.map((mode) => ({ ...mode })),
      };
      bridge.saveAiPreferences(this.aiPreferences);
    },
    async refreshAiModels() {
      this.aiModelRefreshing = true;
      this.aiModelRefreshMessage = "";
      try {
        this.aiModels = await bridge.listAiModels({ ...this.aiPreferences });
        if (
          this.aiPreferences.provider === "utools" &&
          this.aiPreferences.model &&
          !this.aiModels.some(
            (model) => model.id === this.aiPreferences.model || model.name === this.aiPreferences.model,
          )
        ) {
          this.aiModelRefreshMessage = "当前配置的 uTools 模型未在可用列表中找到，建议重新选择。";
        }
        if (this.aiPreferences.provider !== "utools" && this.aiModels.length === 0) {
          this.aiModelRefreshMessage = "未从当前供应商获取到模型，可手动填写模型 ID。";
        }
      } catch (error) {
        this.aiModels = [];
        this.aiModelRefreshMessage = error instanceof Error ? error.message : "获取模型列表失败。";
      } finally {
        this.aiModelRefreshing = false;
      }
    },
    async testAiConfiguration() {
      this.aiModelTesting = true;
      this.aiModelTestMessage = "";
      this.aiModelTestOk = null;
      try {
        const result = await bridge.testAiConnection({ ...this.aiPreferences });
        this.aiModelTestOk = result.ok;
        this.aiModelTestMessage = result.ok
          ? result.message || "AI 连接测试成功。"
          : result.message || "AI 连接测试失败。";
        return result;
      } catch (error) {
        const result = { ok: false, message: error instanceof Error ? error.message : "AI 连接测试失败。" };
        this.aiModelTestOk = false;
        this.aiModelTestMessage = result.message;
        return result;
      } finally {
        this.aiModelTesting = false;
      }
    },
    async analyzeGitWithAiStream(projectId: string, prompt: string, handlers: AiStreamHandlers = {}) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        const result: AiAnalyzeResult = { ok: false, content: "", message: "项目不存在，无法进行 AI 分析。" };
        handlers.onDone?.(result);
        return result;
      }
      let finalResult: AiAnalyzeResult | undefined;
      let completed = false;
      handlers.onStart?.();
      try {
        await bridge.analyzeWithAiStream(
          { preferences: { ...this.aiPreferences }, prompt },
          (chunk) => {
            handlers.onChunk?.(chunk);
          },
          (result) => {
            completed = true;
            finalResult = result;
            handlers.onDone?.(result);
          },
        );
      } catch (error) {
        if (!completed) {
          finalResult = {
            ok: false,
            content: "",
            message: error instanceof Error ? error.message : "AI 分析失败。",
          };
          handlers.onDone?.(finalResult);
        }
      }
      return finalResult;
    },
    async analyzeGitWithAi(projectId: string, prompt: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return;
      }
      this.aiAnalyzing = true;
      this.aiAnalysisMessage = "";
      this.aiAnalysisResult = "";
      this.aiAnalysisState = "loading";
      try {
        await this.analyzeGitWithAiStream(projectId, prompt, {
          onChunk: (chunk) => {
            this.aiAnalysisResult += aiStreamChunkRawText(chunk);
          },
          onDone: (result) => {
            if (!this.aiAnalysisResult && result.content) {
              this.aiAnalysisResult = result.content;
            }
            this.aiAnalysisMessage = result.ok ? result.message || "" : result.message || "AI analysis failed";
            this.aiAnalysisState = result.ok ? (this.aiAnalysisResult ? "success" : "warning") : "error";
            if (!result.ok && !this.aiAnalysisMessage) {
              this.aiAnalysisMessage = "AI 分析失败。";
            }
            if (result.ok && !this.aiAnalysisResult) {
              this.aiAnalysisMessage = "AI 已返回成功，但没有生成内容。";
            }
          },
        });
      } finally {
        this.aiAnalyzing = false;
      }
    },
    setActiveTab(tab: "projects" | "settings" | "environment") {
      this.activeTab = tab;
      this.selectedProjectId = null;
    },
    setSelectedProject(id: string | null) {
      this.selectedProjectId = id;
      if (id) {
        this.activeTab = "projects";
      }
    },
    openProjectByName(query: string) {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) {
        return false;
      }

      const matchedProject =
        this.projects.find((project) => project.name.toLowerCase() === normalizedQuery) ||
        this.projects.find((project) => project.name.toLowerCase().includes(normalizedQuery));
      if (!matchedProject) {
        return false;
      }

      this.activeTab = "projects";
      if (matchedProject.pathExists === false) {
        this.openEditProjectForm(matchedProject.id);
      } else {
        this.selectedProjectId = matchedProject.id;
      }
      return true;
    },
    openCreateProjectForm() {
      this.projectFormMode = "create";
      this.projectFormDraft = createBlankProjectForm();
      this.projectFormInspectionMessage = "";
      this.projectFormCwdSuggestions = ["."];
      this.projectFormOpen = true;
    },
    openEditProjectForm(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return;
      }

      this.projectFormMode = "edit";
      this.projectFormDraft = formFromProject(project);
      this.projectFormInspectionMessage =
        project.pathExists === false ? project.unavailableReason || "当前路径不可用" : "";
      void this.refreshProjectFormCwdSuggestions(project.path);
      this.projectFormOpen = true;
    },
    closeProjectForm() {
      this.projectFormOpen = false;
      this.projectFormDraft = createBlankProjectForm();
      this.projectFormInspectionMessage = "";
      this.projectFormCwdSuggestions = ["."];
    },
    updateProjectForm(patch: Partial<ProjectFormValue>) {
      this.projectFormDraft = {
        ...this.projectFormDraft,
        ...patch,
      };
    },
    async inspectCurrentProjectPath() {
      const projectPath = this.projectFormDraft.path.trim();
      if (!projectPath) {
        this.projectFormInspectionMessage = "";
        return;
      }

      this.projectFormInspecting = true;
      const currentName = this.projectFormDraft.name.trim();
      try {
        const result = await bridge.inspectProjectPath(projectPath);
        const scripts = result.scripts.map((script, index) => ({
          id: `script-${Date.now()}-${index}`,
          name: script.name,
          command: script.command,
          cwd: script.cwd || ".",
          note: script.note || (result.packagePath ? `package.json: ${result.packagePath}` : ""),
          source: script.source || "package-json",
        })) satisfies ProjectScriptFormValue[];

        this.projectFormDraft = {
          ...this.projectFormDraft,
          name: currentName || result.name || this.projectFormDraft.name,
          kind: result.kind || this.projectFormDraft.kind,
          type: result.type || this.projectFormDraft.type,
          icon:
            this.projectFormDraft.icon ||
            inferProjectIcon(
              result.kind || this.projectFormDraft.kind,
              result.type || this.projectFormDraft.type,
              result.name || currentName,
            ),
          branch: result.branch || this.projectFormDraft.branch,
          scripts: scripts.length > 0 ? scripts : this.projectFormDraft.scripts,
        };
        await this.refreshProjectFormCwdSuggestions(projectPath);
        this.projectFormInspectionMessage =
          result.message || (result.pathExists ? "已识别路径信息" : "当前路径不可用，可保存后重新定位");
      } finally {
        this.projectFormInspecting = false;
      }
    },
    async refreshProjectFormCwdSuggestions(projectPath = this.projectFormDraft.path) {
      const normalizedPath = projectPath.trim();
      if (!normalizedPath) {
        this.projectFormCwdSuggestions = ["."];
        return;
      }

      try {
        const suggestions = await bridge.listProjectSubdirectories(normalizedPath);
        this.projectFormCwdSuggestions = Array.from(new Set([".", ...suggestions.filter(Boolean)]));
      } catch (error) {
        this.projectFormCwdSuggestions = ["."];
      }
    },
    async pickProjectPath() {
      const result = await bridge.pickProjectPath();
      if (result.path) {
        this.updateProjectForm({ path: result.path });
        await this.inspectCurrentProjectPath();
        return;
      }

      if (result.message) {
        this.projectFormInspectionMessage = result.message;
      }
    },
    async pickQuickLinkPath() {
      const result = await bridge.pickQuickLinkPath();
      if (result.path) {
        this.updateProjectForm({ quickLink: result.path });
        return;
      }

      if (result.message) {
        this.projectFormInspectionMessage = result.message;
      }
    },
    addEnvironmentEntry() {
      this.projectFormDraft.envEntries.push({
        id: createEnvId(),
        key: "",
        value: "",
      });
    },
    updateEnvironmentEntry(entryId: string, patch: Partial<ProjectEnvironmentEntry>) {
      const entry = this.projectFormDraft.envEntries.find((item) => item.id === entryId);
      if (entry) {
        Object.assign(entry, patch);
      }
    },
    removeEnvironmentEntry(entryId: string) {
      this.projectFormDraft.envEntries = this.projectFormDraft.envEntries.filter((item) => item.id !== entryId);
    },
    addScriptEntry() {
      this.projectFormDraft.scripts.push({
        id: `script-${Date.now()}`,
        name: "start",
        command: "",
        cwd: ".",
        note: "",
        source: "manual",
      });
    },
    updateScriptEntry(scriptId: string, patch: Partial<ProjectScriptFormValue>) {
      const script = this.projectFormDraft.scripts.find((item) => item.id === scriptId);
      if (script) {
        Object.assign(script, patch);
      }
    },
    removeScriptEntry(scriptId: string) {
      this.projectFormDraft.scripts = this.projectFormDraft.scripts.filter((item) => item.id !== scriptId);
    },
    moveScriptEntry(scriptId: string, direction: "up" | "down") {
      const currentIndex = this.projectFormDraft.scripts.findIndex((item) => item.id === scriptId);
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= this.projectFormDraft.scripts.length) {
        return;
      }

      const scripts = [...this.projectFormDraft.scripts];
      const [script] = scripts.splice(currentIndex, 1);
      scripts.splice(targetIndex, 0, script);
      this.projectFormDraft.scripts = scripts;
    },
    reorderScriptEntry(scriptId: string, targetScriptId: string) {
      if (scriptId === targetScriptId) {
        return;
      }

      const scripts = [...this.projectFormDraft.scripts];
      const currentIndex = scripts.findIndex((item) => item.id === scriptId);
      const targetIndex = scripts.findIndex((item) => item.id === targetScriptId);
      if (currentIndex < 0 || targetIndex < 0) {
        return;
      }

      const [script] = scripts.splice(currentIndex, 1);
      const insertIndex = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
      scripts.splice(insertIndex, 0, script);
      this.projectFormDraft.scripts = scripts;
    },
    async saveProjectForm() {
      const current = this.projectFormDraft;
      const payload: ProjectFormValue = {
        ...current,
        envEntries: current.envEntries.filter((entry) => entry.key.trim()),
      };
      const projectId = payload.id || createProjectId();
      const now = new Date().toISOString();
      const env = envFromEntries(payload.envEntries);
      const scripts = payload.scripts
        .filter((script) => script.name.trim() && script.command.trim())
        .map((script, index) => scriptFromForm(projectId, script, index));
      if (scripts.length === 0) {
        this.projectFormInspectionMessage = "请至少填写一个可运行脚本。";
        return null;
      }
      const pathExists = await bridge.pathExists(payload.path);
      const existingProject = this.projects.find((item) => item.id === projectId);
      const project: Project = hydrateProject({
        id: projectId,
        name: payload.name.trim(),
        path: payload.path.trim(),
        type: payload.type,
        kind: payload.kind,
        icon: payload.icon,
        quickLink: payload.quickLink.trim(),
        group: normalizeProjectGroup(payload.group),
        description: payload.description,
        status:
          this.projectFormMode === "edit"
            ? pathExists
              ? existingProject?.status === ProjectStatus.RUNNING
                ? ProjectStatus.RUNNING
                : ProjectStatus.STOPPED
              : ProjectStatus.WARNING
            : pathExists
              ? ProjectStatus.STOPPED
              : ProjectStatus.WARNING,
        lastUpdated: new Date().toLocaleString(),
        scripts,
        env,
        branch: payload.branch,
        memo: payload.memo,
        todos: this.todos[projectId] || existingProject?.todos || [],
        git: existingProject?.git || null,
        pathExists,
        unavailableReason: pathExists ? "" : "当前设备无法访问该路径",
        createdAt: existingProject?.createdAt || now,
        updatedAt: now,
      });

      const existingIndex = this.projects.findIndex((item) => item.id === projectId);
      if (existingIndex >= 0) {
        this.projects.splice(existingIndex, 1, project);
      } else {
        this.projects.unshift(project);
        this.logs[projectId] = [];
        this.scriptLogs[projectId] = {};
        this.stagedFiles[projectId] = [];
        this.todos[projectId] = [];
      }

      this.memoContent[projectId] = payload.memo;
      this.selectedProjectId = projectId;
      this.projectFormOpen = false;
      this.projectFormDraft = createBlankProjectForm();
      await this.persistProjects();
      return projectId;
    },
    async deleteProject(projectId: string) {
      const existingIndex = this.projects.findIndex((item) => item.id === projectId);
      if (existingIndex < 0) {
        return false;
      }

      this.projects.splice(existingIndex, 1);
      delete this.logs[projectId];
      delete this.scriptLogs[projectId];
      delete this.stagedFiles[projectId];
      delete this.todos[projectId];
      delete this.memoContent[projectId];

      if (this.selectedProjectId === projectId) {
        this.selectedProjectId = null;
        this.activeTab = "projects";
      }

      if (this.projectFormDraft.id === projectId) {
        this.closeProjectForm();
      }

      await this.persistProjects();
      return true;
    },
    requestDeleteProject(projectId: string) {
      if (this.projects.some((item) => item.id === projectId)) {
        this.pendingDeleteProjectId = projectId;
      }
    },
    cancelDeleteProject() {
      this.pendingDeleteProjectId = null;
    },
    async confirmDeleteProject() {
      const projectId = this.pendingDeleteProjectId;
      if (!projectId) {
        return false;
      }

      this.pendingDeleteProjectId = null;
      return this.deleteProject(projectId);
    },
    async refreshProjectScripts(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }

      const result = await bridge.readPackageScripts(project.path);
      if (result.scripts.length > 0) {
        const previousScripts = new Map<string, ProjectScript>(project.scripts.map((script) => [script.name, script]));
        project.scripts = result.scripts.map((script, index) => ({
          id: previousScripts.get(script.name)?.id || `${project.id}-package-${index + 1}`,
          name: script.name,
          command: script.command,
          status: "IDLE",
          cwd: script.cwd || ".",
          note: script.note || (result.packagePath ? `package.json: ${result.packagePath}` : ""),
          source: script.source || "package-json",
        }));
        await this.persistProjects();
      }
    },
    async refreshProjects() {
      await this.refreshProjectAvailability();
      await Promise.all(
        this.projects
          .filter((project) => project.pathExists !== false)
          .map((project) => this.refreshGitSnapshot(project.id)),
      );
    },
    async moveProject(projectId: string, direction: "top" | "up" | "down", scopeProjectIds?: string[]) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return false;
      }

      const isUnavailable = project.pathExists === false;
      const isSameSection = (item: Project) => (isUnavailable ? item.pathExists === false : item.pathExists !== false);
      const sectionProjects = this.projects.filter(isSameSection);
      const sectionProjectIds = new Set(sectionProjects.map((item) => item.id));
      const scopedSectionProjects = (scopeProjectIds || [])
        .filter((id) => sectionProjectIds.has(id))
        .map((id) => sectionProjects.find((item) => item.id === id))
        .filter((item): item is Project => Boolean(item));
      const activeSectionProjects = scopedSectionProjects.length > 0 ? scopedSectionProjects : sectionProjects;
      const currentSectionIndex = activeSectionProjects.findIndex((item) => item.id === projectId);
      const targetSectionIndex =
        direction === "top" ? 0 : direction === "up" ? currentSectionIndex - 1 : currentSectionIndex + 1;

      if (
        currentSectionIndex < 0 ||
        currentSectionIndex === targetSectionIndex ||
        targetSectionIndex < 0 ||
        targetSectionIndex >= activeSectionProjects.length
      ) {
        return false;
      }

      const anchorProject = activeSectionProjects[targetSectionIndex];
      const reorderedSectionProjects = [...sectionProjects];
      const movedProjectIndex = reorderedSectionProjects.findIndex((item) => item.id === projectId);
      if (movedProjectIndex < 0) {
        return false;
      }

      const [movedProject] = reorderedSectionProjects.splice(movedProjectIndex, 1);
      const anchorIndex = reorderedSectionProjects.findIndex((item) => item.id === anchorProject.id);
      if (anchorIndex < 0) {
        return false;
      }

      reorderedSectionProjects.splice(direction === "down" ? anchorIndex + 1 : anchorIndex, 0, movedProject);
      let sectionIndex = 0;
      this.projects = this.projects.map((item) => {
        if (!isSameSection(item)) {
          return item;
        }

        const nextProject = reorderedSectionProjects[sectionIndex];
        sectionIndex += 1;
        return nextProject;
      });
      await this.persistProjects();
      return true;
    },
    async reorderProject(projectId: string, targetProjectId: string, scopeProjectIds?: string[]) {
      if (projectId === targetProjectId) {
        return false;
      }

      const project = this.projects.find((item) => item.id === projectId);
      const targetProject = this.projects.find((item) => item.id === targetProjectId);
      if (!project || !targetProject) {
        return false;
      }

      const isUnavailable = project.pathExists === false;
      const isSameSection = (item: Project) => (isUnavailable ? item.pathExists === false : item.pathExists !== false);
      if (!isSameSection(targetProject)) {
        return false;
      }

      const sectionProjects = this.projects.filter(isSameSection);
      const sectionProjectIds = new Set(sectionProjects.map((item) => item.id));
      const scopedSectionProjects = (scopeProjectIds || [])
        .filter((id) => sectionProjectIds.has(id))
        .map((id) => sectionProjects.find((item) => item.id === id))
        .filter((item): item is Project => Boolean(item));
      const activeSectionProjects = scopedSectionProjects.length > 0 ? scopedSectionProjects : sectionProjects;
      if (!activeSectionProjects.some((item) => item.id === projectId)) {
        return false;
      }
      if (!activeSectionProjects.some((item) => item.id === targetProjectId)) {
        return false;
      }

      if (scopedSectionProjects.length > 0) {
        const reorderedScopedProjects = [...scopedSectionProjects];
        const currentScopedIndex = reorderedScopedProjects.findIndex((item) => item.id === projectId);
        const targetScopedIndex = reorderedScopedProjects.findIndex((item) => item.id === targetProjectId);
        if (currentScopedIndex < 0 || targetScopedIndex < 0) {
          return false;
        }

        const [movedProject] = reorderedScopedProjects.splice(currentScopedIndex, 1);
        const nextTargetScopedIndex = reorderedScopedProjects.findIndex((item) => item.id === targetProjectId);
        reorderedScopedProjects.splice(nextTargetScopedIndex, 0, movedProject);

        const scopedProjectIds = new Set(reorderedScopedProjects.map((item) => item.id));
        let scopedIndex = 0;
        this.projects = this.projects.map((item) => {
          if (!isSameSection(item) || !scopedProjectIds.has(item.id)) {
            return item;
          }

          const nextProject = reorderedScopedProjects[scopedIndex];
          scopedIndex += 1;
          return nextProject;
        });
        await this.persistProjects();
        return true;
      }

      const reorderedSectionProjects = [...sectionProjects];
      const movedProjectIndex = reorderedSectionProjects.findIndex((item) => item.id === projectId);
      const targetIndex = reorderedSectionProjects.findIndex((item) => item.id === targetProjectId);
      if (movedProjectIndex < 0 || targetIndex < 0) {
        return false;
      }

      const [movedProject] = reorderedSectionProjects.splice(movedProjectIndex, 1);
      const nextTargetIndex = reorderedSectionProjects.findIndex((item) => item.id === targetProjectId);
      reorderedSectionProjects.splice(nextTargetIndex, 0, movedProject);

      let sectionIndex = 0;
      this.projects = this.projects.map((item) => {
        if (!isSameSection(item)) {
          return item;
        }

        const nextProject = reorderedSectionProjects[sectionIndex];
        sectionIndex += 1;
        return nextProject;
      });
      await this.persistProjects();
      return true;
    },
    async refreshGitSnapshot(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }

      const snapshot = await bridge.readGitSnapshot(project.path, { limit: 80, skip: 0 });
      project.git = normalizeGitSnapshot(snapshot);
      if (project.git) {
        project.branch = project.git.branch;
        project.gitLatestCommitAt = project.git.commits[0]?.date || project.gitLatestCommitAt || "";
        this.stagedFiles[projectId] = project.git.files;
      }
      await this.persistProjects();
    },
    async loadMoreGitCommits(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false || !project.git) {
        return;
      }

      const snapshot = await bridge.readGitSnapshot(project.path, { limit: 80, skip: project.git.commits.length });
      project.git = normalizeGitSnapshot({
        ...snapshot,
        commits: [...project.git.commits, ...(snapshot.commits || [])],
      });
      if (project.git) {
        project.branch = project.git.branch;
        project.gitLatestCommitAt = project.git.commits[0]?.date || project.gitLatestCommitAt || "";
        this.stagedFiles[projectId] = project.git.files;
      }
      await this.persistProjects();
    },
    async listProjectFiles(projectId: string, relativePath = ""): Promise<ProjectFileListResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.listProjectFiles(project.path, relativePath);
    },
    async readProjectFile(projectId: string, relativePath: string): Promise<ProjectFileReadResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.readProjectFile(project.path, relativePath);
    },
    async readGitFileDiff(projectId: string, relativePath: string): Promise<ProjectGitFileDiffResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.readGitFileDiff(project.path, relativePath);
    },
    async readGitCommitFileDiff(
      projectId: string,
      commitHash: string,
      relativePath: string,
    ): Promise<ProjectGitFileDiffResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.readGitCommitFileDiff(project.path, commitHash, relativePath);
    },
    async readGitCommitFiles(projectId: string, commitHash: string): Promise<ProjectGitFileChange[]> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return [];
      }

      return bridge.readGitCommitFiles(project.path, commitHash);
    },
    async readGitCommitMessageDiff(projectId: string): Promise<ProjectGitCommitMessageDiffResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.readGitCommitMessageDiff(project.path);
    },
    async stageGitFile(projectId: string, relativePath: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.stageGitFile(project.path, relativePath);
      if (result.ok || (result.count || 0) > 0) {
        await this.refreshGitSnapshot(projectId);
      }
      return result;
    },
    async unstageGitFile(projectId: string, relativePath: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.unstageGitFile(project.path, relativePath);
      if (result.ok || (result.count || 0) > 0) {
        await this.refreshGitSnapshot(projectId);
      }
      return result;
    },
    async discardGitFile(projectId: string, relativePath: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.discardGitFile(project.path, relativePath);
      if (result.ok || (result.count || 0) > 0) {
        await this.refreshGitSnapshot(projectId);
      }
      return result;
    },
    async stageGitFiles(projectId: string, relativePaths: string[]): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.stageGitFiles(project.path, relativePaths);
      if (result.ok) {
        await this.refreshGitSnapshot(projectId);
      }
      return result;
    },
    async unstageGitFiles(projectId: string, relativePaths: string[]): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.unstageGitFiles(project.path, relativePaths);
      if (result.ok) {
        await this.refreshGitSnapshot(projectId);
      }
      return result;
    },
    async discardGitFiles(projectId: string, relativePaths: string[]): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.discardGitFiles(project.path, relativePaths);
      if (result.ok) {
        await this.refreshGitSnapshot(projectId);
      }
      return result;
    },
    async commitGitStaged(projectId: string, message: string): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.commitGitStaged(project.path, message);
      if (result.ok) {
        await this.refreshGitSnapshot(projectId);
      }
      return result;
    },
    async switchGitBranch(
      projectId: string,
      branchName: string,
      options: { force?: boolean } = {},
    ): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.switchGitBranch(project.path, branchName, options);
      if (result.ok) {
        await this.refreshGitSnapshot(projectId);
      }
      return result;
    },
    async checkoutGitCommit(
      projectId: string,
      commitHash: string,
      options: { force?: boolean } = {},
    ): Promise<ProjectGitActionResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      const result = await bridge.checkoutGitCommit(project.path, commitHash, options);
      if (result.ok) {
        await this.refreshGitSnapshot(projectId);
      }
      return result;
    },
    async writeProjectFile(
      projectId: string,
      relativePath: string,
      content: string,
    ): Promise<ProjectFileWriteResult | null> {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return null;
      }

      return bridge.writeProjectFile(project.path, relativePath, content);
    },
    async launchScript(projectId: string, scriptId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      if (
        !project ||
        !script ||
        project.pathExists === false ||
        script.status === "RUNNING" ||
        script.status === "STOPPING" ||
        !script.command.trim()
      ) {
        return null;
      }

      const result = await bridge.runCommand({
        projectId,
        scriptId,
        command: script.command,
        cwd: resolveScriptCwd(project.path, script.cwd),
        env: project.env,
        label: `${project.name} / ${script.name}`,
      });

      script.status = "RUNNING";
      script.pid = result.pid;
      project.status = ProjectStatus.RUNNING;
      project.lastUpdated = new Date().toLocaleString();
      return result;
    },
    async launchAllScripts(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return [];
      }

      const launchableScripts = project.scripts.filter(
        (script) => script.status !== "RUNNING" && script.status !== "STOPPING" && script.command.trim(),
      );
      const results = [];
      for (const script of launchableScripts) {
        const result = await this.launchScript(projectId, script.id);
        if (result) {
          results.push(result);
        }
      }
      return results;
    },
    async stopScript(projectId: string, scriptId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      if (!project || !script || script.status !== "RUNNING") {
        return;
      }

      const pid = script.pid;
      this.addLog(projectId, createLogEntry(`[${script.name}] stop requested`, "WARN"), scriptId);
      script.status = pid ? "STOPPING" : "STOPPED";
      project.status = deriveProjectStatus(project);
      project.lastUpdated = new Date().toLocaleString();
      void this.persistProjects();

      if (pid) {
        scheduleProcessStop(pid);
      } else {
        this.addLog(projectId, createLogEntry(`[${script.name}] stopped`, "SUCCESS"), scriptId);
      }
    },
    stopRunningScriptsForPluginExit() {
      this.projects.forEach((project) => {
        let projectUpdated = false;
        project.scripts.forEach((script) => {
          if (script.status !== "RUNNING" && script.status !== "STOPPING") {
            return;
          }

          if (script.pid) {
            const pid = script.pid;
            scheduleProcessStop(pid);
            script.status = "STOPPING";
          } else {
            script.status = "STOPPED";
          }
          this.addLog(project.id, createLogEntry(`[${script.name}] stop requested`, "WARN"), script.id);
          projectUpdated = true;
        });

        if (projectUpdated) {
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
        }
      });
      void this.persistProjects();
    },
    async sendScriptInput(projectId: string, scriptId: string, input: string) {
      const line = input;
      const project = this.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      if (!project || !script || script.status !== "RUNNING" || !script.pid) {
        return { sent: false, message: "当前选中的脚本不可输入。" };
      }

      const result = await bridge.sendProcessInput(script.pid, line);
      if (!result.sent) {
        this.addLog(projectId, createLogEntry(result.message || "输入发送失败。", "WARN"), scriptId);
      }
      return result;
    },
    async openProjectFolder(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }

      await bridge.showItemInFolder(project.path);
    },
    async openProjectInTerminal(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }
      const terminalPreferences = { ...this.terminalPreferences };

      if (terminalPreferences.kind === "builtin") {
        this.addLog(
          projectId,
          createLogEntry(`No external terminal selected; external launch skipped for ${project.path}.`, "INFO"),
        );
        project.lastUpdated = new Date().toLocaleString();
        return;
      }

      try {
        const result = await bridge.openTerminal({
          projectPath: project.path,
          terminal: terminalPreferences,
        });

        project.lastUpdated = new Date().toLocaleString();

        if (result.launched) {
          this.addLog(projectId, createLogEntry(`Open terminal (${result.kind}): ${result.command}`, "INFO"));
          return;
        }

        this.addLog(
          projectId,
          createLogEntry(`Failed to open terminal (${result.kind}): ${result.message || "unknown error"}`, "ERROR"),
        );
      } catch (error) {
        project.lastUpdated = new Date().toLocaleString();
        this.addLog(
          projectId,
          createLogEntry(
            `Failed to open terminal (${terminalPreferences.kind}): ${error instanceof Error ? error.message : String(error)}`,
            "ERROR",
          ),
        );
      }
    },
    async openProjectInEditor(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project || project.pathExists === false) {
        return;
      }
      const editorPreferences = { ...this.editorPreferences } satisfies EditorPreferences;
      try {
        const result = await bridge.openEditor({ projectPath: project.path, editor: editorPreferences });
        project.lastUpdated = new Date().toLocaleString();
        if (result.launched) {
          this.addLog(projectId, createLogEntry(`Open editor (${result.kind}): ${result.command}`, "INFO"));
          return;
        }
        this.addLog(
          projectId,
          createLogEntry(`Failed to open editor (${result.kind}): ${result.message || "unknown error"}`, "ERROR"),
        );
      } catch (error) {
        project.lastUpdated = new Date().toLocaleString();
        this.addLog(
          projectId,
          createLogEntry(
            `Failed to open editor (${editorPreferences.kind}): ${error instanceof Error ? error.message : String(error)}`,
            "ERROR",
          ),
        );
      }
    },
    async openProjectQuickLink(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const quickLink = project?.quickLink?.trim();
      if (!project || !quickLink) {
        return;
      }

      try {
        await bridge.openPath(quickLink);
      } catch (error) {
        this.addLog(
          projectId,
          createLogEntry(
            `Failed to open quick link: ${error instanceof Error ? error.message : String(error)}`,
            "WARN",
          ),
        );
      }
    },
    addLog(projectId: string, log: LogEntry, scriptId?: string) {
      if (!this.logs[projectId]) {
        this.logs[projectId] = [];
      }
      this.logs[projectId].push(log);
      if (scriptId) {
        if (!this.scriptLogs[projectId]) {
          this.scriptLogs[projectId] = {};
        }
        if (!this.scriptLogs[projectId][scriptId]) {
          this.scriptLogs[projectId][scriptId] = [];
        }
        this.scriptLogs[projectId][scriptId].push(log);
      }
    },
    clearLogs(projectId: string) {
      this.logs[projectId] = [];
      this.scriptLogs[projectId] = {};
    },
    addTodo(projectId: string, text: string) {
      if (!this.todos[projectId]) {
        this.todos[projectId] = [];
      }
      this.todos[projectId].push({ id: createTodoId(), text, completed: false });
      this.todos[projectId] = [...this.todos[projectId]].sort(
        (left, right) => Number(left.completed) - Number(right.completed),
      );
      this.syncProjectTodos(projectId);
    },
    toggleTodo(projectId: string, todoId: string) {
      const todo = this.todos[projectId]?.find((item) => item.id === todoId);
      if (todo) {
        todo.completed = !todo.completed;
        this.todos[projectId] = [...this.todos[projectId]].sort(
          (left, right) => Number(left.completed) - Number(right.completed),
        );
        this.syncProjectTodos(projectId);
      }
    },
    deleteTodo(projectId: string, todoId: string) {
      this.todos[projectId] = (this.todos[projectId] || []).filter((item) => item.id !== todoId);
      this.syncProjectTodos(projectId);
    },
    reorderTodo(projectId: string, todoId: string, targetTodoId: string) {
      if (todoId === targetTodoId) {
        return;
      }

      const todos = [...(this.todos[projectId] || [])];
      const currentIndex = todos.findIndex((item) => item.id === todoId);
      const targetIndex = todos.findIndex((item) => item.id === targetTodoId);
      if (currentIndex < 0 || targetIndex < 0) {
        return;
      }

      const [todo] = todos.splice(currentIndex, 1);
      const insertIndex = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
      todos.splice(insertIndex, 0, todo);
      this.todos[projectId] = todos;
      this.syncProjectTodos(projectId);
    },
    syncProjectTodos(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (project) {
        project.todos = this.todos[projectId] || [];
        project.updatedAt = new Date().toISOString();
        void this.persistProjects();
      }
    },
    updateMemo(projectId: string, content: string) {
      this.memoContent[projectId] = content;
      const project = this.projects.find((item) => item.id === projectId);
      if (project) {
        project.memo = content;
        project.updatedAt = new Date().toISOString();
        void this.persistProjects();
      }
    },
    async exportProjectConfig() {
      const config: ProjectConfigFile = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        projects: this.projects.map((project, index) => toPersistedProject(project, index)),
      };
      const result = await bridge.exportProjects(config);
      this.setProjectConfigMessage(
        result.canceled ? "已取消导出" : result.path ? `已导出到 ${result.path}` : "已导出项目配置",
      );
    },
    async importProjectConfig() {
      const result = await bridge.importProjects();
      if (result.canceled || !result.config) {
        this.setProjectConfigMessage(result.message || "已取消导入");
        return;
      }

      const existingKeys = new Set(
        this.projects.map((project) => `${project.path.toLowerCase()}::${project.name.toLowerCase()}`),
      );
      if (result.config.schemaVersion !== 1 || !Array.isArray(result.config.projects)) {
        this.setProjectConfigMessage("配置文件格式不受支持");
        return;
      }

      const incoming = result.config.projects
        .filter(isImportableProject)
        .map((project, index) => hydrateProject(toPersistedProject(project, index)));
      const accepted: Project[] = [];
      let skipped = result.config.projects.length - incoming.length;

      incoming.forEach((project) => {
        const key = `${project.path.toLowerCase()}::${project.name.toLowerCase()}`;
        if (this.projects.some((item) => item.id === project.id) || existingKeys.has(key)) {
          skipped += 1;
          return;
        }
        existingKeys.add(key);
        accepted.push({ ...project, id: project.id || createProjectId() });
      });

      this.projects = [...accepted, ...this.projects];
      await this.refreshProjectAvailability();
      await this.persistProjects();
      this.setProjectConfigMessage(`已导入 ${accepted.length} 个项目，跳过 ${skipped} 个重复项目`);
    },
    handleBridgeEvent(event: ProjectBridgeEvent) {
      const project = this.projects.find((item) => item.id === event.projectId);
      const script = project?.scripts.find((item) => item.id === event.scriptId);

      if (event.type === "started") {
        if (script) {
          script.status = "RUNNING";
          script.pid = event.pid;
        }
        if (project) {
          project.status = ProjectStatus.RUNNING;
          project.lastUpdated = new Date().toLocaleString();
        }
        this.addLog(event.projectId, createLogEntry(`started (pid ${event.pid})`, "SUCCESS"), event.scriptId);
      }

      if (event.type === "stdout" || event.type === "stderr") {
        const outputSource = event.type;
        normalizeLogLines(event.message || "").forEach((line) => {
          this.addLog(
            event.projectId,
            createLogEntry(line, classifyProcessOutputLine(line, outputSource)),
            event.scriptId,
          );
        });
      }

      if (event.type === "stdin") {
        this.addLog(event.projectId, createLogEntry(`> ${event.message || ""}`, "INFO"), event.scriptId);
      }

      if (event.type === "exit") {
        const isStopped = Boolean(event.stoppedByUser || script?.status === "STOPPING");
        const isSuccess = event.code === 0;
        if (script) {
          script.status = isStopped ? "STOPPED" : isSuccess ? "IDLE" : "ERROR";
          script.pid = undefined;
        }
        if (project) {
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
        }
        this.addLog(
          event.projectId,
          createLogEntry(
            isStopped ? "stopped" : `exited with code ${event.code ?? "unknown"}`,
            isSuccess || isStopped ? "SUCCESS" : "ERROR",
          ),
          event.scriptId,
        );
      }

      if (event.type === "error") {
        if (script) {
          script.status = "ERROR";
          script.pid = undefined;
        }
        if (project) {
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
        }
        this.addLog(
          event.projectId,
          createLogEntry(normalizeLogLines(event.message || "command failed")[0] || "command failed", "ERROR"),
          event.scriptId,
        );
      }
    },
  },
});
