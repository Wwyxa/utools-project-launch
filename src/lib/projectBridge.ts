import type {
  ProjectBridge,
  ProjectConfigFile,
  ProjectBridgeGitSnapshot,
  ProjectBridgePackageScript,
  ProjectBridgeRunResult,
  ProjectPathInspection,
} from "../types";

const fallbackStorageKey = "utools-project-launch.projects.v1";

const emptyGitSnapshot = (): ProjectBridgeGitSnapshot => ({
  branch: "main",
  ahead: 0,
  behind: 0,
  files: [],
  commits: [],
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
  async inspectProjectPath(projectPath: string): Promise<ProjectPathInspection> {
    const name = projectPath.split(/[\\/]/).filter(Boolean).pop() || "";
    return {
      pathExists: Boolean(projectPath.trim()),
      name,
      kind: "node",
      type: "Node.js",
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
  async readGitSnapshot(): Promise<ProjectBridgeGitSnapshot> {
    return emptyGitSnapshot();
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
  async openPath(): Promise<void> {
    return undefined;
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
