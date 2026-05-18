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

export type ProjectScriptGroup = "main" | "frontend" | "backend" | "utility";

export type ProjectScriptKind = "npm-script" | "command" | "executable";

export interface ProjectScript {
  id: string;
  name: string;
  command: string;
  status: "IDLE" | "RUNNING" | "ERROR" | "STOPPED";
  group?: ProjectScriptGroup;
  kind?: ProjectScriptKind;
  cwd?: string;
  pid?: number;
  note?: string;
  source?: "manual" | "package-json" | "preset";
  stopCommand?: string;
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
  group: ProjectScriptGroup;
  kind: ProjectScriptKind;
  cwd: string;
  note: string;
  stopCommand: string;
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
}

export interface ProjectBridge {
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
