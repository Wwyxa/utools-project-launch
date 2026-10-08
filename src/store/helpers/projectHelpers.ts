import { PROJECT_TINY_CARD_BUTTON_COUNT_MAX, PROJECT_TINY_CARD_BUTTON_COUNT_MIN, PROJECT_TINY_CARD_BUTTON_COUNT_DEFAULT, ProjectStatus } from "../../types";
import type { ProjectKind, ProjectScript, Project, Locale, ExternalApplication, ProjectVisibility, ProjectScriptFormValue, ProjectFormValue, ProjectEnvironmentEntry, ProjectIconKey } from "../../types";
import { bridge } from "./bridge";
import { normalizeProjectRelations } from "../../lib/projectRelations";
import { normalizeAutomationTasks } from "./automationHelpers";
import { normalizeGitSnapshot } from "./gitHelpers";

export const normalizeTinyCardButtonCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(PROJECT_TINY_CARD_BUTTON_COUNT_MAX, Math.max(PROJECT_TINY_CARD_BUTTON_COUNT_MIN, Math.floor(value)))
    : PROJECT_TINY_CARD_BUTTON_COUNT_DEFAULT;

export const createScriptId = (projectId: string, index: number) => `${projectId}-script-${index + 1}`;

export const createAiPromptModeId = () => `custom-${Date.now()}`;

export const createTodoId = () => `todo-${Date.now()}`;

export const createEnvId = () => `env-${Date.now()}`;

export const createCustomEnvironmentToolId = () =>
  `custom-environment-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;

export const createExternalApplicationId = () =>
  `custom-application-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;

export const createProjectId = () => `project-${Date.now()}`;

export const createAutomationTaskId = () => `automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const createAutomationRunId = () => `automation-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const projectKinds = new Set<ProjectKind>(["node", "python", "go", "executable", "custom"]);

export const projectScriptStatuses = new Set<ProjectScript["status"]>(["IDLE", "RUNNING", "STOPPING", "ERROR", "STOPPED"]);

export const projectScriptSources = new Set<NonNullable<ProjectScript["source"]>>([
  "manual",
  "package-json",
  "makefile",
  "preset",
]);

export let projectCatalogStorageSnapshot: Project[] = [];

export const launchMessage = (locale: Locale, code: string, target: string) => {
  const zh = locale === "zh-CN";
  const labels: Record<string, string> = {
    launched: zh ? `已打开 ${target}` : `Opened ${target}`,
    "path-not-found": zh ? "项目目录不存在" : "Project directory does not exist",
    "path-not-directory": zh ? "项目路径不是目录" : "Project path is not a directory",
    "application-unavailable": zh ? `${target} 未安装或不可用` : `${target} is not installed or unavailable`,
    "invalid-custom-command": zh ? "自定义启动命令无效" : "Custom launch command is invalid",
    "preview-unsupported": zh ? "浏览器预览不支持打开本地应用" : "Browser preview cannot open local applications",
    "launch-failed": zh ? `无法启动 ${target}` : `Could not launch ${target}`,
  };
  return labels[code] || (zh ? `无法打开 ${target}` : `Could not open ${target}`);
};

export const projectLaunchServiceDownloadProgressMessage = (locale: Locale, percent: number) =>
  locale === "zh-CN" ? `正在下载并安装（${percent}%）` : `Downloading and installing (${percent}%)`;

export const iconPackDownloadProgressMessage = (locale: Locale, percent: number) =>
  locale === "zh-CN" ? `正在下载图标包（${percent}%）` : `Downloading icon pack (${percent}%)`;

export const resolvedExternalApplicationName = (
  applications: readonly ExternalApplication[],
  applicationId: string | undefined,
  fallbackName: string,
) => applications.find((application) => application.id === applicationId)?.name || fallbackName;

export function resolveProjectSortOrder(project: Project, fallbackIndex = 0): number {
  return typeof project.sortOrder === "number" && Number.isFinite(project.sortOrder)
    ? project.sortOrder
    : fallbackIndex;
}

export function normalizeQuickLink(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeProjectGroup(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeProjectVisibility(value: unknown): ProjectVisibility {
  return value === "private" ? "private" : "public";
}

export function normalizeProjectKind(value: unknown): ProjectKind {
  return typeof value === "string" && projectKinds.has(value as ProjectKind) ? (value as ProjectKind) : "custom";
}

export function normalizeProjectStatus(value: unknown): ProjectStatus {
  return Object.values(ProjectStatus).includes(value as ProjectStatus)
    ? (value as ProjectStatus)
    : ProjectStatus.STOPPED;
}

export function normalizeProjectEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((env, [key, entryValue]) => {
    env[key] = typeof entryValue === "string" ? entryValue : String(entryValue ?? "");
    return env;
  }, {});
}

export function normalizeProjectScripts(projectId: string, value: unknown): ProjectScript[] {
  const scripts = Array.isArray(value) ? value : [];
  const fallbackProjectId = projectId || "project";

  return scripts.reduce<ProjectScript[]>((normalizedScripts, script, index) => {
    if (!script || typeof script !== "object") {
      return normalizedScripts;
    }

    const candidate = script as Partial<ProjectScript>;
    const source = projectScriptSources.has(candidate.source as NonNullable<ProjectScript["source"]>)
      ? (candidate.source as NonNullable<ProjectScript["source"]>)
      : "manual";
    const status = projectScriptStatuses.has(candidate.status as ProjectScript["status"])
      ? (candidate.status as ProjectScript["status"])
      : "IDLE";

    normalizedScripts.push({
      id:
        typeof candidate.id === "string" && candidate.id.trim()
          ? candidate.id
          : createScriptId(fallbackProjectId, index),
      name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : "start",
      command: typeof candidate.command === "string" ? candidate.command : "",
      status,
      cwd: typeof candidate.cwd === "string" && candidate.cwd.trim() ? candidate.cwd : ".",
      pid: typeof candidate.pid === "number" ? candidate.pid : undefined,
      note: typeof candidate.note === "string" ? candidate.note : "",
      source,
      runId: typeof candidate.runId === "string" && candidate.runId.trim() ? candidate.runId : undefined,
      runtimeOwner:
        candidate.runtimeOwner === "service" ? "service" : candidate.runtimeOwner === "preload" ? "preload" : undefined,
    });

    return normalizedScripts;
  }, []);
}

export const currentDeviceId = bridge.loadDeviceId();

export function isProjectVisibleOnCurrentDevice(project: Project): boolean {
  return normalizeProjectVisibility(project.visibility) === "public" || project.ownerDeviceId === currentDeviceId;
}

export function toPersistedProject(project: Project, sortOrder?: number): Project {
  const projectKind = normalizeProjectKind(project.kind);
  const projectType = typeof project.type === "string" && project.type.trim() ? project.type : "Custom";
  const projectScripts = normalizeProjectScripts(project.id, project.scripts);
  const persistedStatus = project.pathExists === false ? ProjectStatus.WARNING : ProjectStatus.STOPPED;
  const persistedSortOrder =
    typeof sortOrder === "number" && Number.isFinite(sortOrder) ? sortOrder : resolveProjectSortOrder(project);

  return {
    id: project.id,
    name: project.name,
    path: project.path,
    visibility: normalizeProjectVisibility(project.visibility),
    ownerDeviceId: project.ownerDeviceId || currentDeviceId,
    type: projectType,
    kind: projectKind,
    icon: project.icon || inferProjectIcon(projectKind, projectType, project.name),
    cardStyle: project.cardStyle || "default",
    tinyCardButtonCount: normalizeTinyCardButtonCount(project.tinyCardButtonCount),
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    relatedProjects: normalizeProjectRelations(project.relatedProjects),
    description: project.description || "",
    status: persistedStatus,
    lastUpdated: project.lastUpdated || "",
    scripts: projectScripts.map((script) => ({
      id: script.id,
      name: script.name,
      command: script.command,
      cwd: script.cwd || ".",
      note: script.note || "",
      source: script.source || "manual",
      status: "IDLE",
    })),
    automationTasks: normalizeAutomationTasks(project.id, project.automationTasks).map((task) => {
      const persistedTask = { ...task, dailyPlans: [], history: [] };
      delete persistedTask.observedServiceExecutionIds;
      return persistedTask;
    }),
    env: normalizeProjectEnv(project.env),
    memo: project.memo || "",
    todos: project.todos || [],
    git: null,
    gitLatestCommitAt: project.gitLatestCommitAt || project.git?.commits?.[0]?.date || "",
    sortOrder: persistedSortOrder,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function cloneProjectCatalogSnapshot(projects: Project[]): Project[] {
  return JSON.parse(JSON.stringify(projects.map((project, index) => toPersistedProject(project, index)))) as Project[];
}

export function setProjectCatalogStorageSnapshot(projects: Project[]): void {
  projectCatalogStorageSnapshot = cloneProjectCatalogSnapshot(projects);
}

export function isImportableProject(project: Project): boolean {
  const scripts = Array.isArray(project.scripts) ? project.scripts : [];
  return Boolean(
    project &&
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    project.name.trim() &&
    typeof project.path === "string" &&
    project.path.trim() &&
    scripts.every((script) => typeof script.name === "string" && typeof script.command === "string"),
  );
}

export function resolveScriptCwd(projectPath: string, scriptCwd: string | undefined): string {
  const cwd = scriptCwd?.trim();
  if (!cwd || cwd === ".") {
    return projectPath;
  }

  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(cwd)) {
    return cwd;
  }

  return `${projectPath.replace(/[\\/]$/, "")}/${cwd}`;
}

export function scriptFromForm(projectId: string, script: ProjectScriptFormValue, index: number): ProjectScript {
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

export function scriptDiscoveryKey(script: Pick<ProjectScriptFormValue, "source" | "cwd" | "command">): string {
  return `${script.source}\u0000${script.cwd.trim() || "."}\u0000${script.command.trim()}`;
}

export function formFromProject(project: Project): ProjectFormValue {
  const projectKind = normalizeProjectKind(project.kind);
  const projectType = typeof project.type === "string" && project.type.trim() ? project.type : "Custom";
  const projectEnv = normalizeProjectEnv(project.env);
  const projectScripts = normalizeProjectScripts(project.id, project.scripts);
  const relatedProjects = normalizeProjectRelations(project.relatedProjects);

  return {
    id: project.id,
    name: project.name,
    path: project.path,
    visibility: normalizeProjectVisibility(project.visibility),
    type: projectType,
    kind: projectKind,
    icon: project.icon || inferProjectIcon(projectKind, projectType, project.name),
    cardStyle: project.cardStyle || "default",
    tinyCardButtonCount: normalizeTinyCardButtonCount(project.tinyCardButtonCount),
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    description: project.description || "",
    relatedProjects,
    relatedProjectsBidirectional:
      relatedProjects.length > 0 && relatedProjects.every((relation) => relation.bidirectional),
    memo: project.memo || "",
    envEntries: Object.entries(projectEnv).map(([key, value]) => ({
      id: `${project.id}-${key}`,
      key,
      value,
    })),
    scripts: projectScripts.map((script) => ({
      id: script.id,
      name: script.name,
      command: script.command,
      cwd: script.cwd || ".",
      note: script.note || "",
      source: script.source || "manual",
    })),
  };
}

export function envFromEntries(entries: ProjectEnvironmentEntry[]): Record<string, string> {
  return entries.reduce<Record<string, string>>((accumulator, entry) => {
    const key = entry.key.trim();
    if (key) {
      accumulator[key] = entry.value;
    }
    return accumulator;
  }, {});
}

export function inferProjectIcon(kind: ProjectKind, type = "", name = ""): ProjectIconKey {
  const source = `${kind} ${type} ${name}`.toLowerCase();
  if (/\b(vue|vite|nuxt)\b/.test(source)) return "vue";
  if (/\b(react|next)\b/.test(source)) return "react";
  if (/\bpython|py\b/.test(source)) return "python";
  if (/\bgo(lang)?\b/.test(source)) return "go";
  if (/\brust|cargo\b/.test(source)) return "rust";
  if (/\bjava|spring\b/.test(source)) return "java";
  if (/\bdocker|compose\b/.test(source)) return "docker";
  if (/\b(android|apk)\b/.test(source)) return "android";
  if (/\b(linux|ubuntu|debian|fedora|arch)\b/.test(source)) return "linux";
  if (/\b(macos|osx|darwin|swift|xcode)\b/.test(source)) return "macos";
  if (/\b(windows|win32|win64)\b/.test(source)) return "windows";
  if (/\b(db|sql|mysql|postgres|redis|mongo)\b/.test(source)) return "database";
  if (/\b(browser|web|frontend)\b/.test(source)) return "browser";
  if (/\b(ai|llm|gpt|claude)\b/.test(source)) return "ai";
  if (kind === "node") return "node";
  if (kind === "python") return "python";
  if (kind === "go") return "go";
  if (kind === "executable") return "executable";
  return "custom";
}

export function hydrateProject(project: Project): Project {
  const projectKind = normalizeProjectKind(project.kind);
  const projectType = typeof project.type === "string" && project.type.trim() ? project.type : "Custom";
  const automationTasks = normalizeAutomationTasks(project.id, project.automationTasks).map((task) => ({
    ...task,
    dailyPlans: [],
    history: [],
    observedServiceExecutionIds: [],
  }));

  return {
    ...project,
    type: projectType,
    kind: projectKind,
    visibility: normalizeProjectVisibility(project.visibility),
    ownerDeviceId: project.ownerDeviceId || currentDeviceId,
    icon: project.icon || inferProjectIcon(projectKind, projectType, project.name),
    cardStyle: project.cardStyle || "default",
    tinyCardButtonCount: normalizeTinyCardButtonCount(project.tinyCardButtonCount),
    status: normalizeProjectStatus(project.status),
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    relatedProjects: normalizeProjectRelations(project.relatedProjects),
    env: normalizeProjectEnv(project.env),
    description: project.description || "",
    memo: project.memo || "",
    todos: project.todos || [],
    git: normalizeGitSnapshot(project.git),
    pathExists: project.pathExists ?? true,
    unavailableReason: project.unavailableReason || "",
    sortOrder: resolveProjectSortOrder(project),
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString(),
    scripts: normalizeProjectScripts(project.id, project.scripts),
    automationTasks,
  };
}

export function demoProject(id: string, project: Project): Project {
  return hydrateProject({
    ...project,
    id,
  });
}

export const demoProjects: Project[] = [
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
      commitCount: 2,
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
      commitCount: 0,
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
      commitCount: 1,
      repositoryPath: "~/projects/finance-app",
      lastRefreshedAt: new Date().toISOString(),
      statusText: "1 file modified",
    },
  }),
];

export function createBlankProjectForm(): ProjectFormValue {
  return {
    id: null,
    name: "",
    path: "",
    visibility: "private",
    type: "Node.js",
    kind: "node",
    icon: "node",
    cardStyle: "default",
    tinyCardButtonCount: PROJECT_TINY_CARD_BUTTON_COUNT_DEFAULT,
    quickLink: "",
    group: "",
    description: "",
    relatedProjects: [],
    relatedProjectsBidirectional: false,
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
