import type {
  ProjectBridge,
  ProjectBridgeGitSnapshot,
  ProjectBridgePackageScript,
  ProjectBridgeRunResult,
} from "../types";

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
