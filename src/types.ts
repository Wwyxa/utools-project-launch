export enum ProjectStatus {
  RUNNING = "RUNNING",
  STOPPED = "STOPPED",
  WARNING = "WARNING",
  ERROR = "ERROR",
}

export type Locale = "zh-CN" | "en-US";

export type ProjectCardStyle = "default" | "tiny";

export type ProjectKind = "node" | "python" | "go" | "executable" | "custom";

export type ProjectIconKey =
  | "node"
  | "vue"
  | "react"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "docker"
  | "database"
  | "browser"
  | "terminal"
  | "backend"
  | "package"
  | "ai"
  | "executable"
  | "custom";

export type DefaultTerminalKind = "builtin" | "windows-terminal" | "powershell" | "cmd" | "custom";
export type DefaultEditorKind = "vscode" | "cursor" | "custom";
export type ProjectVisibility = "public" | "private";
export type EnvironmentToolKey = "node" | "npm" | "pnpm" | "yarn" | "python" | "pip" | "go" | "git" | "docker";
export type EnvironmentToolStatus = "available" | "missing" | "error";
export type AiProviderKind = "utools" | "openai-compatible" | "anthropic-compatible";
export type AiPromptModeKind = "git-analysis" | "commit-message";

export interface TerminalPreferences {
  kind: DefaultTerminalKind;
  customCommand: string;
}

export interface EditorPreferences {
  kind: DefaultEditorKind;
  customCommand: string;
}

export interface EnvironmentToolDefinition {
  key: EnvironmentToolKey;
  name: string;
}

export interface EnvironmentPreferences {
  enabledToolKeys: EnvironmentToolKey[];
}

export interface EnvironmentToolResult {
  key: EnvironmentToolKey;
  name: string;
  status: EnvironmentToolStatus;
  version: string;
  executablePath: string;
  checkedAt: string;
  error?: string;
}

export interface AiPreferences {
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  modes: AiPromptMode[];
}

export interface AiPromptMode {
  id: string;
  name: string;
  prompt: string;
  builtIn: boolean;
  kind: AiPromptModeKind;
}

export const AI_COMMIT_MESSAGE_MODE_ID = "commit-message";

export const DEFAULT_AI_COMMIT_MESSAGE_PROMPT = `请根据当前 Git diff 生成一个简洁、可直接使用的 Git commit message。

要求：
- 只输出最终 commit message，不要解释推理过程。
- 输出 1 行标题，优先使用 conventional commit 风格，例如 feat:, fix:, chore:, docs:, refactor:。
- 如确实需要，可在标题后追加 2-4 条简短正文要点。
- 不要使用 Markdown 代码块。`;

export const DEFAULT_AI_PROMPT_MODES: AiPromptMode[] = [
  {
    id: "summary",
    name: "总结",
    prompt: "请总结这些 Git 信息中的主要工作内容、功能变化和代码变更方向。",
    builtIn: true,
    kind: "git-analysis",
  },
  {
    id: "analysis",
    name: "分析",
    prompt: "请分析这些 Git 信息体现出的实现思路、代码变更逻辑和潜在影响。",
    builtIn: true,
    kind: "git-analysis",
  },
  {
    id: "evaluation",
    name: "评估",
    prompt: "请评估这些 Git 信息的质量、风险点、可维护性和后续需要注意的地方。",
    builtIn: true,
    kind: "git-analysis",
  },
  {
    id: AI_COMMIT_MESSAGE_MODE_ID,
    name: "提交信息",
    prompt: DEFAULT_AI_COMMIT_MESSAGE_PROMPT,
    builtIn: true,
    kind: "commit-message",
  },
];

export interface AiModelInfo {
  id: string;
  name: string;
  provider?: string;
}

export interface AiModelTestResult {
  ok: boolean;
  message: string;
}

export interface AiAnalysisFeedback {
  state: "idle" | "loading" | "success" | "warning" | "error";
  message: string;
  content: string;
}

export interface AiAnalyzePayload {
  preferences: AiPreferences;
  prompt: string;
}

export interface AiAnalyzeResult {
  ok: boolean;
  content: string;
  reasoning?: string;
  rawContent?: string;
  message?: string;
}

export interface AiStreamChunk {
  content?: string;
  reasoning?: string;
  rawContent?: string;
}

export type AiStreamChunkPayload = string | AiStreamChunk;
export type AiStreamChunkHandler = (chunk: AiStreamChunkPayload) => void;
export type AiStreamDoneHandler = (result: AiAnalyzeResult) => void;

export interface ProjectScript {
  id: string;
  name: string;
  command: string;
  status: "IDLE" | "RUNNING" | "STOPPING" | "ERROR" | "STOPPED";
  cwd?: string;
  pid?: number;
  note?: string;
  source?: "manual" | "package-json" | "preset";
}

export type ProjectAutomationSchedule =
  | {
      type: "fixed";
      startTime: string;
      dailyCount: number;
      intervalMinutes: number;
    }
  | {
      type: "random";
      windowStart: string;
      windowEnd: string;
      dailyCount: number;
      minIntervalMinutes: number;
      maxIntervalMinutes: number;
    };

export interface ProjectAutomationInputStep {
  id: string;
  mode: "delay" | "output-match";
  value: string;
  delayMs: number;
  matchText: string;
  timeoutMs: number;
}

export interface ProjectAutomationScriptInputConfig {
  scriptId: string;
  steps: ProjectAutomationInputStep[];
}

export interface ProjectAutomationExitConfig {
  scriptId: string;
  enabled: boolean;
  matchText: string;
}

export type ProjectAutomationMissedPolicy = "grace-run" | "run-now" | "mark-missed";

export type ProjectAutomationPlanEntryStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "missed";

export interface ProjectAutomationPlanEntry {
  id: string;
  plannedAt: string;
  status: ProjectAutomationPlanEntryStatus;
  runId?: string;
  reason?: string;
}

export interface ProjectAutomationDailyPlan {
  date: string;
  entries: ProjectAutomationPlanEntry[];
}

export type ProjectAutomationHistoryStatus = "completed" | "failed" | "skipped" | "missed";

export interface ProjectAutomationScriptResult {
  scriptId: string;
  scriptName: string;
  status: "completed" | "failed" | "skipped" | "timeout" | "stopped";
  startedAt?: string;
  endedAt?: string;
  reason?: string;
}

export interface ProjectAutomationHistoryEntry {
  id: string;
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  plannedAt: string;
  startedAt?: string;
  endedAt?: string;
  status: ProjectAutomationHistoryStatus;
  reason?: string;
  scriptResults: ProjectAutomationScriptResult[];
}

export interface ProjectAutomationTask {
  id: string;
  name: string;
  enabled: boolean;
  scriptIds: string[];
  schedule: ProjectAutomationSchedule;
  missedPolicy: ProjectAutomationMissedPolicy;
  missedGraceMinutes: number;
  notifyEnabled: boolean;
  maxScriptRuntimeMinutes: number;
  inputConfigs: ProjectAutomationScriptInputConfig[];
  exitConfigs: ProjectAutomationExitConfig[];
  dailyPlans: ProjectAutomationDailyPlan[];
  history: ProjectAutomationHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectGitFileChange {
  path: string;
  originalPath?: string;
  additions: number;
  deletions: number;
  status: "MODIFIED" | "ADDED" | "DELETED" | "RENAMED" | "UNTRACKED";
  staged?: boolean;
  unstaged?: boolean;
}

export interface ProjectGitFileDiffResult {
  path: string;
  diff: string;
  message?: string;
}

export interface ProjectGitBranchSummary {
  name: string;
  current: boolean;
}

export interface ProjectGitRemoteSummary {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface ProjectGitUpstreamSummary {
  remote: string;
  branch: string;
  ref: string;
  ahead: number;
  behind: number;
}

export interface ProjectGitActionResult {
  ok: boolean;
  message: string;
  path?: string;
  paths?: string[];
  count?: number;
  branch?: string;
  remote?: string;
  commitHash?: string;
  isDetachedHead?: boolean;
}

export interface ProjectGitBulkFileActionOptions {
  all?: boolean;
}

export interface ProjectGitCommitMessageDiffResult {
  ok: boolean;
  scope: "staged" | "working-tree";
  diff: string;
  truncated?: boolean;
  message?: string;
}

export interface ProjectGitCommitSummary {
  hash: string;
  message: string;
  body?: string;
  author: string;
  date: string;
  graph?: string;
  parents?: string[];
  refs?: string;
  files?: ProjectGitFileChange[];
}

export interface ProjectGitSnapshot {
  branch: string;
  headHash?: string;
  isDetachedHead?: boolean;
  ahead: number;
  behind: number;
  files: ProjectGitFileChange[];
  commits: ProjectGitCommitSummary[];
  branches?: ProjectGitBranchSummary[];
  remotes?: ProjectGitRemoteSummary[];
  upstream?: ProjectGitUpstreamSummary | null;
  hasMoreCommits?: boolean;
  repositoryPath: string;
  lastRefreshedAt: string;
  statusText: string;
}

export interface ProjectGitStatusSnapshot {
  branch: string;
  headHash?: string;
  isDetachedHead?: boolean;
  ahead: number;
  behind: number;
  files: ProjectGitFileChange[];
  branches?: ProjectGitBranchSummary[];
  remotes?: ProjectGitRemoteSummary[];
  upstream?: ProjectGitUpstreamSummary | null;
  repositoryPath: string;
  lastRefreshedAt: string;
  statusText: string;
}

export interface ProjectGitCommitPage {
  commits: ProjectGitCommitSummary[];
  hasMoreCommits?: boolean;
  repositoryPath: string;
  lastRefreshedAt: string;
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
  visibility: ProjectVisibility;
  type: string;
  kind: ProjectKind;
  icon: ProjectIconKey;
  cardStyle: ProjectCardStyle;
  quickLink: string;
  group: string;
  description: string;
  memo: string;
  envEntries: ProjectEnvironmentEntry[];
  scripts: ProjectScriptFormValue[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  visibility?: ProjectVisibility;
  ownerDeviceId?: string;
  type: string;
  kind: ProjectKind;
  icon?: ProjectIconKey;
  cardStyle?: ProjectCardStyle;
  quickLink?: string;
  group?: string;
  status: ProjectStatus;
  description?: string;
  lastUpdated?: string;
  scripts: ProjectScript[];
  automationTasks?: ProjectAutomationTask[];
  env: Record<string, string>;
  memo?: string;
  todos?: TodoItem[];
  git?: ProjectGitSnapshot | null;
  pathExists?: boolean;
  unavailableReason?: string;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
  gitLatestCommitAt?: string;
}

export interface ProjectConfigFile {
  schemaVersion: 1;
  exportedAt: string;
  projects: Project[];
}

export interface ProjectPathInspection {
  pathExists: boolean;
  name?: string;
  type?: string;
  kind?: ProjectKind;
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

export interface ProjectBridgeRunCommandPayload {
  projectId: string;
  scriptId: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  label: string;
  automationRunId?: string;
}

export interface ProjectBridgeStopProcessOptions {
  automationRunId?: string;
  automationExitMatched?: boolean;
}

export interface ProjectBridgeSendInputResult {
  sent: boolean;
  message?: string;
}

export interface ProjectBridgeProcessStatusResult {
  active: boolean;
  code?: number | null;
  signal?: string | null;
  stoppedByUser?: boolean;
  error?: string;
  endedAt?: string;
  automationRunId?: string;
  automationExitMatched?: boolean;
}

export interface ProjectBridgeTerminalLaunchPayload {
  projectPath: string;
  terminal: TerminalPreferences;
}

export interface ProjectBridgeTerminalLaunchResult {
  launched: boolean;
  command: string;
  cwd: string;
  kind: DefaultTerminalKind;
  message?: string;
}

export interface ProjectBridgeEditorLaunchPayload {
  projectPath: string;
  editor: EditorPreferences;
}

export interface ProjectBridgeEditorLaunchResult {
  launched: boolean;
  command: string;
  cwd: string;
  kind: DefaultEditorKind;
  message?: string;
}

export interface ProjectBridgePackageScript {
  name: string;
  command: string;
  cwd?: string;
  note?: string;
  source?: "manual" | "package-json" | "preset";
}

export interface ProjectBridgeGitSnapshot extends ProjectGitSnapshot {}

export interface ProjectBridgeGitStatusSnapshot extends ProjectGitStatusSnapshot {}

export interface ProjectBridgeGitCommitPage extends ProjectGitCommitPage {}

export type ProjectFileKind = "file" | "directory";

export interface ProjectFileTreeEntry {
  name: string;
  path: string;
  relativePath: string;
  kind: ProjectFileKind;
  size: number;
  extension: string;
  hidden?: boolean;
  ignored?: boolean;
}

export interface ProjectFileListResult {
  rootPath: string;
  relativePath: string;
  entries: ProjectFileTreeEntry[];
}

export type ProjectFileMutationKind = ProjectFileKind;

export interface ProjectFileSearchResult {
  rootPath: string;
  query: string;
  entries: ProjectFileTreeEntry[];
  truncated: boolean;
}

export interface ProjectFileMutationResult {
  ok: boolean;
  kind: ProjectFileMutationKind;
  path: string;
  relativePath: string;
  previousRelativePath?: string;
  message?: string;
}

export interface ProjectFileReadResult {
  path: string;
  relativePath: string;
  name: string;
  size: number;
  extension: string;
  mime: string;
  previewKind: "text" | "image" | "none";
  editable: boolean;
  content?: string;
  dataUrl?: string;
  message?: string;
}

export interface ProjectFileWriteResult {
  path: string;
  relativePath: string;
  savedAt: string;
}

export interface ProjectBridgeEvent {
  type: "started" | "stdout" | "stderr" | "stdin" | "exit" | "error";
  projectId: string;
  scriptId: string;
  pid: number;
  message?: string;
  code?: number | null;
  signal?: string | null;
  stoppedByUser?: boolean;
  automationRunId?: string;
  automationExitMatched?: boolean;
}

export interface ProjectBridge {
  loadDeviceId(): string;
  loadProjects(): Promise<Project[]>;
  saveProjects(projects: Project[]): Promise<void>;
  loadTerminalPreferences(): TerminalPreferences;
  saveTerminalPreferences(preferences: TerminalPreferences): void;
  loadEditorPreferences(): EditorPreferences;
  saveEditorPreferences(preferences: EditorPreferences): void;
  loadEnvironmentPreferences(): EnvironmentPreferences;
  saveEnvironmentPreferences(preferences: EnvironmentPreferences): void;
  detectEnvironmentTools(toolKeys: EnvironmentToolKey[]): Promise<EnvironmentToolResult[]>;
  loadAiPreferences(): AiPreferences;
  saveAiPreferences(preferences: AiPreferences): void;
  listAiModels(preferences?: AiPreferences): Promise<AiModelInfo[]>;
  testAiConnection(preferences: AiPreferences): Promise<AiModelTestResult>;
  analyzeWithAi(payload: AiAnalyzePayload): Promise<AiAnalyzeResult>;
  analyzeWithAiStream(
    payload: AiAnalyzePayload,
    onChunk: AiStreamChunkHandler,
    onDone: AiStreamDoneHandler,
  ): Promise<void>;
  inspectProjectPath(projectPath: string): Promise<ProjectPathInspection>;
  pickProjectPath(): Promise<{ canceled?: boolean; path?: string; message?: string }>;
  pickQuickLinkPath(): Promise<{ canceled?: boolean; path?: string; message?: string }>;
  pathExists(projectPath: string): Promise<boolean>;
  exportProjects(config: ProjectConfigFile): Promise<{ canceled?: boolean; path?: string }>;
  importProjects(): Promise<{ canceled?: boolean; config?: ProjectConfigFile; message?: string }>;
  readPackageScripts(
    projectPath: string,
  ): Promise<{ scripts: ProjectBridgePackageScript[]; packagePath: string | null }>;
  listProjectSubdirectories(projectPath: string): Promise<string[]>;
  readGitSnapshot(projectPath: string, options?: { limit?: number; skip?: number }): Promise<ProjectBridgeGitSnapshot>;
  readGitStatusSnapshot(projectPath: string): Promise<ProjectBridgeGitStatusSnapshot>;
  readGitCommits(projectPath: string, options?: { limit?: number; skip?: number }): Promise<ProjectBridgeGitCommitPage>;
  readGitFileDiff(projectPath: string, relativePath: string): Promise<ProjectGitFileDiffResult>;
  readGitCommitFileDiff(
    projectPath: string,
    commitHash: string,
    relativePath: string,
  ): Promise<ProjectGitFileDiffResult>;
  readGitCommitFiles(projectPath: string, commitHash: string): Promise<ProjectGitFileChange[]>;
  readGitCommitMessageDiff(projectPath: string): Promise<ProjectGitCommitMessageDiffResult>;
  stageGitFile(projectPath: string, relativePath: string): Promise<ProjectGitActionResult>;
  unstageGitFile(projectPath: string, relativePath: string): Promise<ProjectGitActionResult>;
  discardGitFile(projectPath: string, relativePath: string): Promise<ProjectGitActionResult>;
  stageGitFiles(
    projectPath: string,
    relativePaths: string[],
    options?: ProjectGitBulkFileActionOptions,
  ): Promise<ProjectGitActionResult>;
  unstageGitFiles(
    projectPath: string,
    relativePaths: string[],
    options?: ProjectGitBulkFileActionOptions,
  ): Promise<ProjectGitActionResult>;
  discardGitFiles(
    projectPath: string,
    relativePaths: string[],
    options?: ProjectGitBulkFileActionOptions,
  ): Promise<ProjectGitActionResult>;
  commitGitStaged(projectPath: string, message: string): Promise<ProjectGitActionResult>;
  switchGitBranch(
    projectPath: string,
    branchName: string,
    options?: { force?: boolean },
  ): Promise<ProjectGitActionResult>;
  checkoutGitCommit(
    projectPath: string,
    commitHash: string,
    options?: { force?: boolean; preferredBranch?: string },
  ): Promise<ProjectGitActionResult>;
  fetchGitRemote(projectPath: string): Promise<ProjectGitActionResult>;
  pullGitRemote(projectPath: string): Promise<ProjectGitActionResult>;
  pushGitRemote(projectPath: string): Promise<ProjectGitActionResult>;
  addGitRemote(projectPath: string, remoteName: string, remoteUrl: string): Promise<ProjectGitActionResult>;
  setGitRemoteUrl(projectPath: string, remoteName: string, remoteUrl: string): Promise<ProjectGitActionResult>;
  removeGitRemote(projectPath: string, remoteName: string): Promise<ProjectGitActionResult>;
  listProjectFiles(projectPath: string, relativePath?: string): Promise<ProjectFileListResult>;
  searchProjectFiles(
    projectPath: string,
    query: string,
    options?: { limit?: number },
  ): Promise<ProjectFileSearchResult>;
  createProjectEntry(
    projectPath: string,
    parentRelativePath: string,
    name: string,
    kind: ProjectFileMutationKind,
  ): Promise<ProjectFileMutationResult>;
  renameProjectEntry(projectPath: string, relativePath: string, name: string): Promise<ProjectFileMutationResult>;
  deleteProjectEntry(projectPath: string, relativePath: string): Promise<ProjectFileMutationResult>;
  showProjectEntryInFolder(projectPath: string, relativePath: string): Promise<void>;
  readProjectFile(projectPath: string, relativePath: string): Promise<ProjectFileReadResult>;
  writeProjectFile(projectPath: string, relativePath: string, content: string): Promise<ProjectFileWriteResult>;
  openTerminal(payload: ProjectBridgeTerminalLaunchPayload): Promise<ProjectBridgeTerminalLaunchResult>;
  openEditor(payload: ProjectBridgeEditorLaunchPayload): Promise<ProjectBridgeEditorLaunchResult>;
  runCommand(payload: ProjectBridgeRunCommandPayload): Promise<ProjectBridgeRunResult>;
  stopProcess(pid: number, options?: ProjectBridgeStopProcessOptions): Promise<void>;
  getProcessStatus(pid: number): Promise<ProjectBridgeProcessStatusResult>;
  getAutomationProcessResult(
    projectId: string,
    scriptId: string,
    automationRunId: string,
  ): Promise<ProjectBridgeProcessStatusResult | null>;
  sendProcessInput(pid: number, input: string): Promise<ProjectBridgeSendInputResult>;
  stopAllProcesses(): Promise<void>;
  openPath(path: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
}
