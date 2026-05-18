export enum ProjectStatus {
  RUNNING = "RUNNING",
  STOPPED = "STOPPED",
  WARNING = "WARNING",
  ERROR = "ERROR",
}

export type Locale = "zh-CN" | "en-US";

export type ProjectKind = "node" | "python" | "go" | "executable" | "custom";

export type DefaultTerminalKind = "builtin" | "windows-terminal" | "powershell" | "cmd" | "custom";

export interface TerminalPreferences {
  kind: DefaultTerminalKind;
  customCommand: string;
}

export interface ProjectScript {
  id: string;
  name: string;
  command: string;
  status: "IDLE" | "RUNNING" | "ERROR" | "STOPPED";
  cwd?: string;
  pid?: number;
  note?: string;
  source?: "manual" | "package-json" | "preset";
}

export interface ProjectGitFileChange {
  path: string;
  additions: number;
  deletions: number;
  status: "MODIFIED" | "ADDED" | "DELETED" | "RENAMED" | "UNTRACKED";
}

export interface ProjectGitCommitSummary {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface ProjectGitSnapshot {
  branch: string;
  ahead: number;
  behind: number;
  files: ProjectGitFileChange[];
  commits: ProjectGitCommitSummary[];
  repositoryPath: string;
  lastRefreshedAt: string;
  statusText: string;
}

export interface ProjectScriptFormValue {
  id: string;
  name: string;
  command: string;
  cwd: string;
  note: string;
  source: "manual" | "package-json" | "preset";
}

export interface ProjectEnvironmentEntry {
  id: string;
  key: string;
  value: string;
}

export interface ProjectFormValue {
  id: string | null;
  name: string;
  path: string;
  type: string;
  kind: ProjectKind;
  description: string;
  branch: string;
  memo: string;
  envEntries: ProjectEnvironmentEntry[];
  scripts: ProjectScriptFormValue[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  type: string;
  kind: ProjectKind;
  status: ProjectStatus;
  description?: string;
  lastUpdated?: string;
  scripts: ProjectScript[];
  env: Record<string, string>;
  branch?: string;
  memo?: string;
  todos?: TodoItem[];
  git?: ProjectGitSnapshot | null;
  pathExists?: boolean;
  unavailableReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectConfigFile {
  schemaVersion: 1;
  exportedAt: string;
  projects: Project[];
}

export interface ProjectPathInspection {
  pathExists: boolean;
  name?: string;
  kind?: ProjectKind;
  type?: string;
  branch?: string;
  scripts: ProjectBridgePackageScript[];
  packagePath: string | null;
  git?: ProjectBridgeGitSnapshot | null;
  message?: string;
}

export interface ProjectImportResult {
  imported: number;
  skipped: number;
  projects: Project[];
  message?: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: "INFO" | "WARN" | "ERROR" | "SUCCESS";
}

export interface StagedFile {
  path: string;
  additions: number;
  deletions: number;
  status: "MODIFIED" | "ADDED" | "DELETED";
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface ProjectBridgeRunResult {
  pid: number;
  startedAt: string;
  command: string;
  cwd: string;
}

export interface ProjectBridgePackageScript {
  name: string;
  command: string;
  cwd?: string;
  note?: string;
  source?: "manual" | "package-json" | "preset";
}

export interface ProjectBridgeGitSnapshot extends ProjectGitSnapshot {}

export interface ProjectBridgeEvent {
  type: "started" | "stdout" | "stderr" | "exit" | "error";
  projectId: string;
  scriptId: string;
  pid: number;
  message?: string;
  code?: number | null;
  signal?: string | null;
  stoppedByUser?: boolean;
}

export interface ProjectBridge {
  loadProjects(): Promise<Project[]>;
  saveProjects(projects: Project[]): Promise<void>;
  inspectProjectPath(projectPath: string): Promise<ProjectPathInspection>;
  pickProjectPath(): Promise<{ canceled?: boolean; path?: string; message?: string }>;
  pathExists(projectPath: string): Promise<boolean>;
  exportProjects(config: ProjectConfigFile): Promise<{ canceled?: boolean; path?: string }>;
  importProjects(): Promise<{ canceled?: boolean; config?: ProjectConfigFile; message?: string }>;
  readPackageScripts(
    projectPath: string,
  ): Promise<{ scripts: ProjectBridgePackageScript[]; packagePath: string | null }>;
  readGitSnapshot(projectPath: string): Promise<ProjectBridgeGitSnapshot>;
  runCommand(payload: {
    projectId: string;
    scriptId: string;
    command: string;
    cwd: string;
    env: Record<string, string>;
    label: string;
  }): Promise<ProjectBridgeRunResult>;
  stopProcess(pid: number): Promise<void>;
  openPath(path: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
}
