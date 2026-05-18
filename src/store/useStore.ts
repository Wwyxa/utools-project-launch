import { defineStore } from "pinia";
import { getProjectBridge, supportsRealProjectBridge } from "../lib/projectBridge";
import { ProjectStatus } from "../types";
import type {
  Locale,
  LogEntry,
  Project,
  ProjectBridgeEvent,
  ProjectEnvironmentEntry,
  ProjectFormValue,
  ProjectGitFileChange,
  ProjectGitSnapshot,
  ProjectKind,
  ProjectScript,
  ProjectScriptFormValue,
  TodoItem,
} from "../types";

const bridge = getProjectBridge();

const createScriptId = (projectId: string, index: number) => `${projectId}-script-${index + 1}`;
const createTodoId = () => `todo-${Date.now()}`;
const createEnvId = () => `env-${Date.now()}`;

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
    repositoryPath: snapshot.repositoryPath || "",
    lastRefreshedAt: snapshot.lastRefreshedAt || new Date().toISOString(),
    statusText: snapshot.statusText || "OK",
  };
}

function scriptFromForm(projectId: string, script: ProjectScriptFormValue, index: number): ProjectScript {
  return {
    id: script.id || createScriptId(projectId, index),
    name: script.name,
    command: script.command,
    status: "IDLE",
    group: script.group,
    kind: script.kind,
    cwd: script.cwd,
    note: script.note,
    source: script.source,
    stopCommand: script.stopCommand,
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
      group: script.group || "main",
      kind: script.kind || "command",
      cwd: script.cwd || ".",
      note: script.note || "",
      stopCommand: script.stopCommand || "",
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
    scripts: project.scripts.map((script, index) => ({
      ...script,
      id: script.id || createScriptId(project.id, index),
      group: script.group || "main",
      kind: script.kind || "command",
      cwd: script.cwd || ".",
      note: script.note || "",
      stopCommand: script.stopCommand || "",
      source: script.source || "manual",
    })),
  };
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
        group: "frontend",
        kind: "npm-script",
        cwd: ".",
        source: "package-json",
        note: "frontend dev server",
      },
      {
        id: "project-node-1-script-2",
        name: "server",
        command: "npm run server",
        status: "IDLE",
        group: "backend",
        kind: "npm-script",
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
        group: "main",
        kind: "command",
        cwd: ".",
        source: "manual",
      },
      {
        id: "project-python-1-script-2",
        name: "test",
        command: "pytest",
        status: "IDLE",
        group: "utility",
        kind: "command",
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
        group: "main",
        kind: "command",
        cwd: ".",
        source: "manual",
      },
      {
        id: "project-go-1-script-2",
        name: "build",
        command: "go build -o bin/finance-app",
        status: "IDLE",
        group: "utility",
        kind: "command",
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
        group: "main",
        kind: "npm-script",
        cwd: ".",
        note: "",
        stopCommand: "",
        source: "manual",
      },
    ],
  };
}

export const useStore = defineStore("app", {
  state: () => ({
    locale: "zh-CN" as Locale,
    supportsBridge: supportsRealProjectBridge(),
    projectFormOpen: false,
    projectFormMode: "create" as "create" | "edit",
    projectFormDraft: createBlankProjectForm() as ProjectFormValue,
    projects: demoProjects,
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
    selectedProject: (state): Project | undefined =>
      state.projects.find((project) => project.id === state.selectedProjectId),
    currentMessages: (state) => (state.locale === "zh-CN" ? "zh-CN" : "en-US"),
  },

  actions: {
    setLocale(locale: Locale) {
      this.locale = locale;
    },
    setSelectedProject(id: string | null) {
      this.selectedProjectId = id;
    },
    openCreateProjectForm() {
      this.projectFormMode = "create";
      this.projectFormDraft = createBlankProjectForm();
      this.projectFormOpen = true;
    },
    openEditProjectForm(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return;
      }

      this.projectFormMode = "edit";
      this.projectFormDraft = formFromProject(project);
      this.projectFormOpen = true;
    },
    closeProjectForm() {
      this.projectFormOpen = false;
      this.projectFormDraft = createBlankProjectForm();
    },
    updateProjectForm(patch: Partial<ProjectFormValue>) {
      this.projectFormDraft = {
        ...this.projectFormDraft,
        ...patch,
      };
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
        group: "main",
        kind: "command",
        cwd: ".",
        note: "",
        stopCommand: "",
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
    saveProjectForm() {
      const current = this.projectFormDraft;
      const payload: ProjectFormValue = {
        ...current,
        envEntries: current.envEntries.filter((entry) => entry.key.trim()),
      };
      const projectId = payload.id || `project-${Date.now()}`;
      const env = envFromEntries(payload.envEntries);
      const scripts = payload.scripts.map((script, index) => scriptFromForm(projectId, script, index));
      const project: Project = hydrateProject({
        id: projectId,
        name: payload.name,
        path: payload.path,
        type: payload.type,
        kind: payload.kind,
        description: payload.description,
        status:
          this.projectFormMode === "edit"
            ? this.projects.find((item) => item.id === projectId)?.status || ProjectStatus.STOPPED
            : ProjectStatus.STOPPED,
        lastUpdated: new Date().toLocaleString(),
        scripts,
        env,
        branch: payload.branch,
        memo: payload.memo,
        todos: this.todos[projectId] || [],
        git: this.projects.find((item) => item.id === projectId)?.git || null,
      });

      const existingIndex = this.projects.findIndex((item) => item.id === projectId);
      if (existingIndex >= 0) {
        this.projects.splice(existingIndex, 1, project);
      } else {
        this.projects.unshift(project);
        this.logs[projectId] = [];
        this.stagedFiles[projectId] = [];
        this.todos[projectId] = [];
      }

      this.memoContent[projectId] = payload.memo;
      this.projectForms[projectId] = payload;
      this.selectedProjectId = projectId;
      this.projectFormOpen = false;
      this.projectFormDraft = createBlankProjectForm();
      return projectId;
    },
    async refreshProjectScripts(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return;
      }

      const result = await bridge.readPackageScripts(project.path);
      if (result.scripts.length > 0) {
        project.scripts = result.scripts.map((script, index) => ({
          id: `${project.id}-package-${index + 1}`,
          name: script.name,
          command: script.command,
          status: "IDLE",
          group: "main",
          kind: "npm-script",
          cwd: ".",
          note: result.packagePath ? `package.json: ${result.packagePath}` : "",
          source: "package-json",
        }));
      }
    },
    async refreshGitSnapshot(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return;
      }

      const snapshot = await bridge.readGitSnapshot(project.path);
      project.git = normalizeGitSnapshot(snapshot);
      if (project.git) {
        project.branch = project.git.branch;
        this.stagedFiles[projectId] = project.git.files;
      }
    },
    async launchScript(projectId: string, scriptId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      if (!project || !script) {
        return null;
      }

      const result = await bridge.runCommand({
        projectId,
        scriptId,
        command: script.command,
        cwd: script.cwd || project.path,
        env: project.env,
        label: `${project.name} / ${script.name}`,
      });

      script.status = "RUNNING";
      script.pid = result.pid;
      project.status = ProjectStatus.RUNNING;
      project.lastUpdated = new Date().toLocaleString();
      return result;
    },
    async stopScript(projectId: string, scriptId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      if (!project || !script || !script.pid) {
        return;
      }

      await bridge.stopProcess(script.pid);
      script.status = "STOPPED";
      project.status = ProjectStatus.STOPPED;
      project.lastUpdated = new Date().toLocaleString();
    },
    async openProjectFolder(projectId: string) {
      const project = this.projects.find((item) => item.id === projectId);
      if (!project) {
        return;
      }

      await bridge.showItemInFolder(project.path);
    },
    addLog(projectId: string, log: LogEntry) {
      if (!this.logs[projectId]) {
        this.logs[projectId] = [];
      }
      this.logs[projectId].push(log);
    },
    clearLogs(projectId: string) {
      this.logs[projectId] = [];
    },
    addTodo(projectId: string, text: string) {
      if (!this.todos[projectId]) {
        this.todos[projectId] = [];
      }
      this.todos[projectId].push({ id: createTodoId(), text, completed: false });
    },
    toggleTodo(projectId: string, todoId: string) {
      const todo = this.todos[projectId]?.find((item) => item.id === todoId);
      if (todo) {
        todo.completed = !todo.completed;
      }
    },
    updateMemo(projectId: string, content: string) {
      this.memoContent[projectId] = content;
      const project = this.projects.find((item) => item.id === projectId);
      if (project) {
        project.memo = content;
      }
    },
    handleBridgeEvent(event: ProjectBridgeEvent) {
      if (event.type === "stdout" || event.type === "stderr") {
        this.addLog(event.projectId, {
          timestamp: new Date().toLocaleTimeString(),
          message: event.message || "",
          type: event.type === "stderr" ? "ERROR" : "INFO",
        });
      }

      if (event.type === "exit") {
        const project = this.projects.find((item) => item.id === event.projectId);
        const script = project?.scripts.find((item) => item.id === event.scriptId);
        if (script) {
          script.status = event.code === 0 ? "IDLE" : "ERROR";
          script.pid = undefined;
        }
        if (project) {
          project.status = event.code === 0 ? ProjectStatus.STOPPED : ProjectStatus.ERROR;
          project.lastUpdated = new Date().toLocaleString();
        }
      }
    },
  },
});
