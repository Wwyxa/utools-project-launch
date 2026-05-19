import { defineStore } from "pinia";
import { getProjectBridge, supportsRealProjectBridge } from "../lib/projectBridge";
import { ProjectStatus } from "../types";
import type {
  DefaultTerminalKind,
  Locale,
  LogEntry,
  Project,
  ProjectConfigFile,
  ProjectBridgeEvent,
  ProjectEnvironmentEntry,
  ProjectFormValue,
  ProjectGitFileChange,
  ProjectGitSnapshot,
  ProjectFileListResult,
  ProjectFileReadResult,
  ProjectFileWriteResult,
  ProjectKind,
  ProjectScript,
  ProjectScriptFormValue,
  TerminalPreferences,
  TodoItem,
} from "../types";

const bridge = getProjectBridge();

const createScriptId = (projectId: string, index: number) => `${projectId}-script-${index + 1}`;
const createTodoId = () => `todo-${Date.now()}`;
const createEnvId = () => `env-${Date.now()}`;
const createProjectId = () => `project-${Date.now()}`;
const ansiControlPattern =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function toPersistedProject(project: Project): Project {
  const persistedStatus = project.pathExists === false ? ProjectStatus.WARNING : ProjectStatus.STOPPED;

  return {
    id: project.id,
    name: project.name,
    path: project.path,
    type: project.type,
    kind: project.kind,
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
    ahead: snapshot.ahead || 0,
    behind: snapshot.behind || 0,
    files: snapshot.files || [],
    commits: snapshot.commits || [],
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

function hydrateProject(project: Project): Project {
  return {
    ...project,
    branch: project.branch || project.git?.branch || "main",
    description: project.description || "",
    memo: project.memo || "",
    todos: project.todos || [],
    git: normalizeGitSnapshot(project.git),
    pathExists: project.pathExists ?? true,
    unavailableReason: project.unavailableReason || "",
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
  if (project.scripts.some((script) => script.status === "RUNNING")) {
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

function normalizeLogLines(message: string): string[] {
  const normalized = message.replace(ansiControlPattern, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  return normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
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
    activeTab: "projects" as "projects" | "settings",
    theme: "auto" as "light" | "dark" | "auto",
    terminalPreferences: bridge.loadTerminalPreferences(),
    supportsBridge: supportsRealProjectBridge(),
    projectsLoaded: false,
    projectStorageMessage: "",
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
        await bridge.saveProjects(this.projects.map((project) => toPersistedProject(project)));
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
    setDefaultTerminal(kind: DefaultTerminalKind) {
      this.terminalPreferences.kind = kind;
      bridge.saveTerminalPreferences(this.terminalPreferences);
    },
    setDefaultTerminalCustomCommand(command: string) {
      this.terminalPreferences.customCommand = command;
      bridge.saveTerminalPreferences(this.terminalPreferences);
    },
    setActiveTab(tab: "projects" | "settings") {
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
      scripts.splice(targetIndex, 0, script);
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
        (script) => script.status !== "RUNNING" && script.command.trim(),
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

      if (script.pid) {
        await bridge.stopProcess(script.pid);
      }
      this.addLog(projectId, createLogEntry(`[${script.name}] stopped`, "WARN"), scriptId);
      script.status = "STOPPED";
      script.pid = undefined;
      project.status = deriveProjectStatus(project);
      project.lastUpdated = new Date().toLocaleString();
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
        projects: this.projects.map((project) => toPersistedProject(project)),
      };
      const result = await bridge.exportProjects(config);
      this.projectStorageMessage = result.canceled
        ? "已取消导出"
        : result.path
          ? `已导出到 ${result.path}`
          : "已导出项目配置";
    },
    async importProjectConfig() {
      const result = await bridge.importProjects();
      if (result.canceled || !result.config) {
        this.projectStorageMessage = result.message || "已取消导入";
        return;
      }

      const existingKeys = new Set(
        this.projects.map((project) => `${project.path.toLowerCase()}::${project.name.toLowerCase()}`),
      );
      if (result.config.schemaVersion !== 1 || !Array.isArray(result.config.projects)) {
        this.projectStorageMessage = "配置文件格式不受支持";
        return;
      }

      const incoming = result.config.projects
        .filter(isImportableProject)
        .map((project) => hydrateProject(toPersistedProject(project)));
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
      this.projectStorageMessage = `已导入 ${accepted.length} 个项目，跳过 ${skipped} 个重复项目`;
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
        normalizeLogLines(event.message || "").forEach((line) => {
          this.addLog(
            event.projectId,
            createLogEntry(line, event.type === "stderr" ? "ERROR" : "INFO"),
            event.scriptId,
          );
        });
      }

      if (event.type === "exit") {
        const isStopped = Boolean(event.stoppedByUser);
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
