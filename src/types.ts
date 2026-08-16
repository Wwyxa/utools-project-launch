export enum ProjectStatus {
  RUNNING = "RUNNING",
  STOPPED = "STOPPED",
  WARNING = "WARNING",
  ERROR = "ERROR",
}

export type Locale = "zh-CN" | "en-US";

export type ProjectCardStyle = "default" | "tiny";
export const PROJECT_TINY_CARD_BUTTON_COUNT_MIN = 0;
export const PROJECT_TINY_CARD_BUTTON_COUNT_MAX = 3;
export const PROJECT_TINY_CARD_BUTTON_COUNT_DEFAULT = 1;

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

export type DefaultTerminalKind =
  | "builtin"
  | "terminal-app"
  | "iterm2"
  | "warp"
  | "linux-terminal"
  | "windows-terminal"
  | "powershell"
  | "cmd"
  | "custom";
export type ExternalApplicationKind = "vscode" | "cursor" | "custom";
export type HostPlatform = "darwin" | "linux" | "win32" | "unsupported";
export type ProjectLaunchResultCode =
  | "launched"
  | "preview-unsupported"
  | "invalid-preference"
  | "invalid-custom-command"
  | "path-not-found"
  | "path-not-directory"
  | "application-unavailable"
  | "launch-failed";
export type ProjectVisibility = "public" | "private";
export type EnvironmentToolKey = "node" | "npm" | "pnpm" | "yarn" | "python" | "pip" | "go" | "git" | "docker";
export type EnvironmentToolStatus = "available" | "missing" | "error";
export type AiProviderKind = "utools" | "openai-compatible" | "anthropic-compatible";
export type AiPromptModeKind = "git-analysis" | "commit-message";
export const PROJECT_DETAILS_TAB_IDS = ["info", "scripts", "automation", "files", "git", "memo"] as const;
export const PROJECT_DETAILS_TAB_REORDER_COACH_MARK_VERSION = 1;
export const PROJECT_MAX_RELATED_PROJECTS = 5;
export type ProjectDetailsTabId = (typeof PROJECT_DETAILS_TAB_IDS)[number];

export interface UiPreferences {
  schemaVersion: 1;
  projectDetails: {
    tabOrder: ProjectDetailsTabId[];
  };
  coachMarks: {
    projectDetailsTabReorder: number;
  };
}

export interface ProjectLaunchServicePreferences {
  schemaVersion: 1;
  enabled: boolean;
}

export type ProjectLaunchServiceRunStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "exited"
  | "failed"
  | "lost";

export interface ProjectLaunchServiceRun {
  id: string;
  projectId: string;
  scriptId: string;
  label: string;
  command: string;
  cwd: string;
  pid?: number;
  status: ProjectLaunchServiceRunStatus;
  startedAt: string;
  endedAt?: string;
  code?: number | null;
  signal?: string;
  error?: string;
  stoppedByUser?: boolean;
  automationExitMatched?: boolean;
  automationRunId?: string;
  processIdentity?: string;
  outputTruncated?: boolean;
}

export interface ProjectLaunchServiceEvent {
  cursor: number;
  timestamp: string;
  type: "started" | "stdout" | "stderr" | "stdin" | "exit" | "error";
  runId: string;
  projectId: string;
  scriptId: string;
  pid?: number;
  message?: string;
  cwd?: string;
  code?: number | null;
  signal?: string;
  stoppedByUser?: boolean;
  automationExitMatched?: boolean;
  automationRunId?: string;
}

export interface ProjectLaunchServiceRunLog {
  runId: string;
  events: ProjectLaunchServiceEvent[];
  truncated: boolean;
  sizeBytes: number;
}

export interface ProjectLaunchServiceScriptConfig {
  id: string;
  name: string;
  command: string;
  cwd: string;
}

export interface ProjectLaunchServicePlanEntryConfig {
  id: string;
  plannedAt: string;
  status: ProjectAutomationPlanEntryStatus;
  runEarly?: boolean;
}

export interface ProjectLaunchServiceDailyPlanConfig {
  date: string;
  entries: ProjectLaunchServicePlanEntryConfig[];
}

export interface ProjectLaunchServiceAutomationTaskConfig {
  id: string;
  name: string;
  enabled: boolean;
  scriptIds: string[];
  missedPolicy: ProjectAutomationMissedPolicy;
  missedGraceMinutes: number;
  maxScriptRuntimeMinutes: number;
  inputConfigs: ProjectAutomationScriptInputConfig[];
  exitConfigs: ProjectAutomationExitConfig[];
  dailyPlans: ProjectLaunchServiceDailyPlanConfig[];
}

export interface ProjectLaunchServiceProjectConfig {
  id: string;
  name: string;
  path: string;
  env: Record<string, string>;
  scripts: ProjectLaunchServiceScriptConfig[];
  automationTasks: ProjectLaunchServiceAutomationTaskConfig[];
}

export interface ProjectLaunchServiceAutomationConfig {
  schemaVersion: 1;
  revision: number;
  projects: ProjectLaunchServiceProjectConfig[];
}

export type ProjectLaunchServiceAutomationExecutionStatus = "running" | "completed" | "failed" | "skipped" | "missed";

export interface ProjectLaunchServiceAutomationScriptResult {
  scriptId: string;
  status: "completed" | "failed" | "skipped" | "timeout" | "stopped";
  startedAt?: string;
  endedAt?: string;
  reason?: string;
}

export interface ProjectLaunchServiceAutomationExecution {
  id: string;
  projectId: string;
  taskId: string;
  planEntryId: string;
  status: ProjectLaunchServiceAutomationExecutionStatus;
  currentScriptIndex: number;
  activeRunId?: string;
  startedAt?: string;
  endedAt?: string;
  reason?: string;
  scriptResults: ProjectLaunchServiceAutomationScriptResult[];
}

export interface ProjectLaunchServiceAutomationState {
  revision: number;
  executions?: ProjectLaunchServiceAutomationExecution[];
}

export interface ProjectLaunchServiceAutomationSyncResult {
  accepted: boolean;
  revision: number;
  message?: string;
}

export type ProjectLaunchServiceState =
  | "not-installed"
  | "installed"
  | "starting"
  | "healthy"
  | "unavailable"
  | "incompatible";

export type ProjectLaunchServiceSchedulerState = "running" | "degraded";

export interface ProjectLaunchServiceSchedulerStatus {
  state: ProjectLaunchServiceSchedulerState;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
}

export interface ProjectLaunchServiceStatus {
  state: ProjectLaunchServiceState;
  installed: boolean;
  running: boolean;
  platform: string;
  architecture: string;
  expectedAssetName: string;
  directoryPath: string;
  executablePath: string;
  releaseUrl: string;
  protocolVersion?: number;
  serviceVersion?: string;
  activeRunCount?: number;
  runs?: ProjectLaunchServiceRun[];
  events?: ProjectLaunchServiceEvent[];
  latestCursor?: number;
  earliestCursor?: number;
  eventsTruncated?: boolean;
  automationRevision?: number;
  automation?: ProjectLaunchServiceAutomationState;
  scheduler?: ProjectLaunchServiceSchedulerStatus;
  latestServiceVersion?: string;
  updateAvailable?: boolean;
  message?: string;
}

export interface TerminalPreferences {
  kind: DefaultTerminalKind;
  customCommand: string;
}

export interface ExternalApplication {
  id: string;
  name: string;
  kind: ExternalApplicationKind;
  command: string;
  enabled: boolean;
}

export interface ExternalApplicationPreferences {
  schemaVersion: 1;
  defaultApplicationId: string;
  applications: ExternalApplication[];
}

export interface EnvironmentToolDefinition {
  key: EnvironmentToolKey;
  name: string;
  command: string;
  versionArgs: string[];
}

export interface BuiltinEnvironmentToolOverride {
  key: EnvironmentToolKey;
  command: string;
  versionArgs: string[];
}

export interface CustomEnvironmentTool {
  id: string;
  name: string;
  command: string;
  versionArgs: string[];
  enabled: boolean;
}

export interface EnvironmentPreferences {
  enabledToolKeys: EnvironmentToolKey[];
  customTools: CustomEnvironmentTool[];
  builtinOverrides: BuiltinEnvironmentToolOverride[];
}

export interface EnvironmentToolResult {
  key: string;
  name: string;
  status: EnvironmentToolStatus;
  version: string;
  executablePath: string;
  checkedAt: string;
  error?: string;
}

export type EnvironmentToolRequest =
  | { kind: "builtin"; key: EnvironmentToolKey }
  | {
      kind: "builtin-override";
      key: EnvironmentToolKey;
      command: string;
      versionArgs: string[];
    }
  | {
      kind: "custom";
      id: string;
      name: string;
      command: string;
      versionArgs: string[];
    };

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
  runId?: string;
  runtimeOwner?: "preload" | "service";
  note?: string;
  source?: ProjectScriptSource;
}

export type ProjectScriptSource = "manual" | "package-json" | "makefile" | "preset";

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

export type ProjectGitDiffScope = "combined" | "staged" | "unstaged";

export interface ProjectGitFileDiffOptions {
  scope?: ProjectGitDiffScope;
  fullFile?: boolean;
  ignoreWhitespace?: boolean;
}

export interface ProjectGitFileDiffResult {
  path: string;
  scope?: ProjectGitDiffScope;
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

export interface ProjectGitRemoteBranchSummary {
  remote: string;
  branch: string;
  ref: string;
}

export interface ProjectGitUpstreamSummary {
  remote: string;
  branch: string;
  ref: string;
  ahead: number;
  behind: number;
}

export interface ProjectGitBaseSummary {
  remote: string;
  branch: string;
  ref: string;
}

export type ProjectGitActionBlockReason = "dirty-worktree" | "unmerged-branch" | "merge-commit";

export interface ProjectGitActionResult {
  ok: boolean;
  message: string;
  blockReason?: ProjectGitActionBlockReason;
  path?: string;
  paths?: string[];
  count?: number;
  branch?: string;
  remote?: string;
  commitHash?: string;
  commitMessage?: string;
  isDetachedHead?: boolean;
}

export interface ProjectGitBulkFileActionOptions {
  all?: boolean;
}

export interface ProjectGitStashOptions {
  includeUntracked?: boolean;
}

export interface ProjectGitCommitMessageDiffResult {
  ok: boolean;
  scope: "staged" | "working-tree";
  diff: string;
  truncated?: boolean;
  message?: string;
}

export type ProjectGitCommitRefKind = "head" | "local" | "remote" | "tag" | "stash";

export interface ProjectGitCommitRef {
  kind: ProjectGitCommitRefKind;
  name: string;
  head?: boolean;
}

export interface ProjectGitStash {
  selector: string;
  baseHash: string;
  untrackedFilesHash: string | null;
}

export interface ProjectGitCommitShortStats {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
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
  refNames?: ProjectGitCommitRef[];
  stash?: ProjectGitStash;
  files?: ProjectGitFileChange[];
  readonly shortStats?: ProjectGitCommitShortStats;
}

export type ProjectGitReadFailureCode = "git-unavailable" | "not-a-repository" | "command-failed" | "invalid-output";

export type ProjectGitReadOperation = "repository" | "status" | "history";

export interface ProjectGitReadFailure {
  code: ProjectGitReadFailureCode;
  operation: ProjectGitReadOperation;
  message: string;
  exitCode?: number;
}

export type ProjectGitReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; value: T | null; failure: ProjectGitReadFailure };

export interface ProjectGitSnapshot {
  branch: string;
  headHash?: string;
  isDetachedHead?: boolean;
  ahead: number;
  behind: number;
  files: ProjectGitFileChange[];
  commits: ProjectGitCommitSummary[];
  commitCount: number;
  branches?: ProjectGitBranchSummary[];
  remotes?: ProjectGitRemoteSummary[];
  remoteBranches?: ProjectGitRemoteBranchSummary[];
  upstream?: ProjectGitUpstreamSummary | null;
  base?: ProjectGitBaseSummary | null;
  hasMoreCommits?: boolean;
  nextCommitSkip?: number;
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
  remoteBranches?: ProjectGitRemoteBranchSummary[];
  upstream?: ProjectGitUpstreamSummary | null;
  base?: ProjectGitBaseSummary | null;
  repositoryPath: string;
  lastRefreshedAt: string;
  statusText: string;
}

export interface ProjectGitCommitPage {
  commits: ProjectGitCommitSummary[];
  commitCount: number;
  hasMoreCommits?: boolean;
  nextCommitSkip?: number;
  repositoryPath: string;
  lastRefreshedAt: string;
}

export type ProjectGitObjectFormat = "sha1" | "sha256";
export type ProjectGitObjectId = string;

export type ProjectGitWorkspaceOperation =
  | "repository"
  | "worktree-list"
  | "worktree-status"
  | "submodule-config"
  | "submodule-index"
  | "submodule-registration"
  | "submodule-status";

export interface ProjectGitWorkspaceFailure {
  code:
    | "git-unavailable"
    | "not-a-repository"
    | "unsupported-output"
    | "invalid-output"
    | "path-unavailable"
    | "permission-denied"
    | "timeout"
    | "command-failed";
  operation: ProjectGitWorkspaceOperation;
  message: string;
  exitCode?: number;
}

export interface ProjectGitWorkspaceSection<T> {
  state: "ready" | "partial" | "unavailable";
  entries: T[];
  failure: ProjectGitWorkspaceFailure | null;
}

export interface ProjectGitHeadState {
  kind: "branch" | "detached" | "unborn" | "bare" | "unknown";
  ref: string | null;
  name: string | null;
  oid: ProjectGitObjectId | null;
}

export interface ProjectGitChangeCounts {
  stagedEntries: number;
  unstagedEntries: number;
  untrackedEntries: number;
  conflictedEntries: number;
}

export interface ProjectGitUpstreamState {
  ref: string;
  ahead: number;
  behind: number;
}

export interface ProjectGitWorktreeStatus extends ProjectGitChangeCounts {
  upstream: ProjectGitUpstreamState | null;
}

export interface ProjectGitWorktreeSummary {
  kind: "main" | "linked" | "bare";
  path: string;
  pathAvailable: boolean;
  objectFormat: ProjectGitObjectFormat;
  head: ProjectGitHeadState;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  prunableReason: string | null;
  status: ProjectGitWorktreeStatus | null;
  failure: ProjectGitWorkspaceFailure | null;
}

export interface ProjectGitSubmoduleIndexStage {
  stage: 1 | 2 | 3;
  mode: string;
  oid: ProjectGitObjectId;
}

export type ProjectGitSubmoduleIndexState =
  | { kind: "recorded"; recordedOid: ProjectGitObjectId; conflictStages: [] }
  | { kind: "conflicted"; recordedOid: null; conflictStages: ProjectGitSubmoduleIndexStage[] }
  | { kind: "missing" | "not-gitlink"; recordedOid: null; conflictStages: [] };

export interface ProjectGitSubmoduleConfigValue {
  declared: string | null;
  local: string | null;
  effective: string | null;
}

export interface ProjectGitSubmoduleSummary {
  name: string | null;
  path: string;
  pathAvailable: boolean;
  configuration: "configured" | "index-only" | "invalid";
  url: ProjectGitSubmoduleConfigValue;
  branch: ProjectGitSubmoduleConfigValue;
  index: ProjectGitSubmoduleIndexState;
  registration: "initialized" | "uninitialized" | "unknown";
  checkout: "available" | "missing" | "not-repository" | "unreadable";
  objectFormat: ProjectGitObjectFormat | null;
  head: ProjectGitHeadState;
  commitMismatch: boolean | null;
  status: ProjectGitChangeCounts | null;
  failure: ProjectGitWorkspaceFailure | null;
}

export interface ProjectGitWorkspaceSnapshot {
  repositoryPath: string;
  objectFormat: ProjectGitObjectFormat | null;
  worktrees: ProjectGitWorkspaceSection<ProjectGitWorktreeSummary>;
  submodules: ProjectGitWorkspaceSection<ProjectGitSubmoduleSummary>;
  lastRefreshedAt: string;
}

export type ProjectGitRepositoryTarget =
  | { kind: "main" }
  | { kind: "worktree"; path: string }
  | { kind: "submodule"; path: string };

export interface ProjectGitRepositoryContext {
  target: ProjectGitRepositoryTarget;
  repositoryPath: string;
  contextKey: string;
}

export interface ProjectScriptFormValue {
  id: string;
  name: string;
  command: string;
  cwd: string;
  note: string;
  source: ProjectScriptSource;
}

export interface ProjectEnvironmentEntry {
  id: string;
  key: string;
  value: string;
}

export interface ProjectRelation {
  projectId: string;
  bidirectional: boolean;
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
  tinyCardButtonCount: number;
  quickLink: string;
  group: string;
  description: string;
  relatedProjects: ProjectRelation[];
  relatedProjectsBidirectional: boolean;
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
  tinyCardButtonCount?: number;
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
  relatedProjects?: ProjectRelation[];
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

export interface ProjectScriptDiscoveryResult {
  scripts: ProjectBridgeScriptCandidate[];
  message?: string;
}

export type ProjectScriptDiscoverySource = Extract<ProjectScriptSource, "package-json" | "makefile">;

export interface ProjectScriptDiscoveryOptions {
  sources: ProjectScriptDiscoverySource[];
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
  runId?: string;
  runtimeOwner?: "preload" | "service";
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
  runId?: string;
  runtimeOwner?: "preload" | "service";
  automationRunId?: string;
  automationExitMatched?: boolean;
}

export interface ProjectBridgeSendInputResult {
  sent: boolean;
  message?: string;
}

export interface ProjectBridgeProcessStatusResult {
  active: boolean;
  serviceState?: ProjectLaunchServiceState;
  runId?: string;
  runtimeOwner?: "preload" | "service";
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
  code: ProjectLaunchResultCode;
  message?: string;
}

export interface ProjectBridgeExternalApplicationLaunchPayload {
  projectPath: string;
  application: ExternalApplication;
}

export interface ProjectBridgeExternalApplicationLaunchResult {
  launched: boolean;
  command: string;
  cwd: string;
  applicationId: string;
  kind: ExternalApplicationKind;
  code: ProjectLaunchResultCode;
  requestedApplicationId?: string;
  resolvedApplicationId?: string;
  attempts?: string[];
  message?: string;
}

export interface ProjectBridgePackageScript {
  name: string;
  command: string;
  cwd?: string;
  note?: string;
  source?: ProjectScriptSource;
}

export interface ProjectBridgeScriptCandidate extends ProjectBridgePackageScript {
  source: Extract<ProjectScriptSource, "package-json" | "makefile">;
}

export interface ProjectBridgeGitSnapshot extends ProjectGitSnapshot {}

export interface ProjectBridgeGitStatusSnapshot extends ProjectGitStatusSnapshot {}

export interface ProjectBridgeGitWorkingTreeSnapshot {
  files: ProjectGitFileChange[];
  repositoryPath: string;
  lastRefreshedAt: string;
  statusText: string;
}

export interface ProjectBridgeGitCommitPage extends ProjectGitCommitPage {}

export interface ProjectBridgeGitWorkspaceSnapshot extends ProjectGitWorkspaceSnapshot {}

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

export interface ProjectBridgeProcessEvent {
  type: "started" | "stdout" | "stderr" | "stdin" | "exit" | "error";
  projectId: string;
  scriptId: string;
  pid: number;
  cursor?: number;
  runId?: string;
  runtimeOwner?: "preload" | "service";
  timestamp?: string;
  message?: string;
  cwd?: string;
  code?: number | null;
  signal?: string | null;
  stoppedByUser?: boolean;
  automationRunId?: string;
  automationExitMatched?: boolean;
}

export interface ProjectBridgeServiceStateEvent {
  type: "service-state";
  status: ProjectLaunchServiceStatus;
  timestamp?: string;
}

export type ProjectBridgeEvent = ProjectBridgeProcessEvent | ProjectBridgeServiceStateEvent;

export interface ProjectBridge {
  loadDeviceId(): string;
  loadProjects(): Promise<Project[]>;
  saveProjects(projects: Project[]): Promise<void>;
  loadUiPreferences(): UiPreferences;
  saveUiPreferences(preferences: UiPreferences): void;
  loadTerminalPreferences(): TerminalPreferences;
  saveTerminalPreferences(preferences: TerminalPreferences): void;
  loadExternalApplicationPreferences(): ExternalApplicationPreferences;
  saveExternalApplicationPreferences(preferences: ExternalApplicationPreferences): void;
  loadEnvironmentPreferences(): EnvironmentPreferences;
  saveEnvironmentPreferences(preferences: EnvironmentPreferences): void;
  loadBuiltinEnvironmentTools(): EnvironmentToolDefinition[];
  detectEnvironmentTool(request: EnvironmentToolRequest): Promise<EnvironmentToolResult>;
  loadAiPreferences(): AiPreferences;
  saveAiPreferences(preferences: AiPreferences): void;
  loadProjectLaunchServicePreferences(): ProjectLaunchServicePreferences;
  saveProjectLaunchServicePreferences(preferences: ProjectLaunchServicePreferences): void;
  getProjectLaunchServiceStatus(): Promise<ProjectLaunchServiceStatus>;
  checkProjectLaunchServiceUpdate(): Promise<ProjectLaunchServiceStatus>;
  downloadProjectLaunchService(): Promise<ProjectLaunchServiceStatus>;
  verifyProjectLaunchServiceInstall(): Promise<ProjectLaunchServiceStatus>;
  startProjectLaunchService(options?: { requireVerifiedInstall?: boolean }): Promise<ProjectLaunchServiceStatus>;
  stopProjectLaunchService(): Promise<ProjectLaunchServiceStatus>;
  reconcileProjectLaunchService(): Promise<ProjectLaunchServiceStatus>;
  getProjectLaunchServiceRunLog(runId: string): Promise<ProjectLaunchServiceRunLog>;
  syncProjectLaunchServiceAutomation(
    config: ProjectLaunchServiceAutomationConfig,
  ): Promise<ProjectLaunchServiceAutomationSyncResult>;
  openProjectLaunchServiceDirectory(): Promise<void>;
  openProjectLaunchServiceReleases(): Promise<void>;
  listAiModels(preferences?: AiPreferences): Promise<AiModelInfo[]>;
  testAiConnection(preferences: AiPreferences): Promise<AiModelTestResult>;
  analyzeWithAi(payload: AiAnalyzePayload): Promise<AiAnalyzeResult>;
  analyzeWithAiStream(
    payload: AiAnalyzePayload,
    onChunk: AiStreamChunkHandler,
    onDone: AiStreamDoneHandler,
  ): Promise<void>;
  inspectProjectPath(projectPath: string): Promise<ProjectPathInspection>;
  discoverProjectScripts(
    projectPath: string,
    options: ProjectScriptDiscoveryOptions,
  ): Promise<ProjectScriptDiscoveryResult>;
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
  readGitSnapshotResult(
    projectPath: string,
    options?: { limit?: number; skip?: number },
  ): Promise<ProjectGitReadResult<ProjectBridgeGitSnapshot>>;
  readGitWorkspaceSnapshot(projectPath: string): Promise<ProjectBridgeGitWorkspaceSnapshot>;
  readGitStatusSnapshot(projectPath: string): Promise<ProjectBridgeGitStatusSnapshot>;
  readGitStatusSnapshotResult(projectPath: string): Promise<ProjectGitReadResult<ProjectBridgeGitStatusSnapshot>>;
  readGitWorkingTreeSnapshot(projectPath: string): Promise<ProjectBridgeGitWorkingTreeSnapshot>;
  readGitWorkingTreeSnapshotResult(
    projectPath: string,
  ): Promise<ProjectGitReadResult<ProjectBridgeGitWorkingTreeSnapshot>>;
  readGitCommits(projectPath: string, options?: { limit?: number; skip?: number }): Promise<ProjectBridgeGitCommitPage>;
  readGitCommitsResult(
    projectPath: string,
    options?: { limit?: number; skip?: number },
  ): Promise<ProjectGitReadResult<ProjectBridgeGitCommitPage>>;
  readGitFileDiff(
    projectPath: string,
    relativePath: string,
    options?: ProjectGitFileDiffOptions,
  ): Promise<ProjectGitFileDiffResult>;
  readGitCommitFileDiff(
    projectPath: string,
    commitHash: string,
    relativePath: string,
    stash?: ProjectGitStash,
    options?: ProjectGitFileDiffOptions,
  ): Promise<ProjectGitFileDiffResult>;
  readGitCommitFiles(projectPath: string, commitHash: string, stash?: ProjectGitStash): Promise<ProjectGitFileChange[]>;
  readGitCommitAuthorAvatar(projectPath: string, commitHash: string): Promise<string | null>;
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
  amendGitCommit(projectPath: string, message: string): Promise<ProjectGitActionResult>;
  undoLastGitCommit(projectPath: string, options?: { allowMerge?: boolean }): Promise<ProjectGitActionResult>;
  cherryPickGitCommit(projectPath: string, commitHash: string): Promise<ProjectGitActionResult>;
  revertGitCommit(projectPath: string, commitHash: string): Promise<ProjectGitActionResult>;
  createGitStash(
    projectPath: string,
    message?: string,
    options?: ProjectGitStashOptions,
  ): Promise<ProjectGitActionResult>;
  applyGitStash(projectPath: string, stashRef: string): Promise<ProjectGitActionResult>;
  popGitStash(projectPath: string, stashRef: string): Promise<ProjectGitActionResult>;
  dropGitStash(projectPath: string, stashRef: string): Promise<ProjectGitActionResult>;
  switchGitBranch(
    projectPath: string,
    branchName: string,
    options?: { force?: boolean },
  ): Promise<ProjectGitActionResult>;
  checkoutGitCommit(
    projectPath: string,
    commitHash: string,
    options?: { force?: boolean; preferredBranch?: string; detach?: boolean },
  ): Promise<ProjectGitActionResult>;
  createGitBranch(
    projectPath: string,
    branchName: string,
    commitHash: string,
    options?: { checkout?: boolean; force?: boolean },
  ): Promise<ProjectGitActionResult>;
  createGitTag(
    projectPath: string,
    tagName: string,
    commitHash: string,
    options?: { annotated?: boolean; message?: string },
  ): Promise<ProjectGitActionResult>;
  deleteGitTag(projectPath: string, tagName: string): Promise<ProjectGitActionResult>;
  renameGitBranch(projectPath: string, branchName: string, nextBranchName: string): Promise<ProjectGitActionResult>;
  deleteGitBranch(
    projectPath: string,
    branchName: string,
    options?: { force?: boolean },
  ): Promise<ProjectGitActionResult>;
  checkoutGitRemoteBranch(
    projectPath: string,
    remoteRef: string,
    options?: { force?: boolean },
  ): Promise<ProjectGitActionResult>;
  fetchGitRemote(projectPath: string): Promise<ProjectGitActionResult>;
  fetchGitRemoteByName(projectPath: string, remoteName: string): Promise<ProjectGitActionResult>;
  pullGitRemote(projectPath: string): Promise<ProjectGitActionResult>;
  pushGitRemote(projectPath: string): Promise<ProjectGitActionResult>;
  initializeGitRepository(projectPath: string): Promise<ProjectGitActionResult>;
  publishGitBranch(projectPath: string, remoteName: string): Promise<ProjectGitActionResult>;
  addGitRemote(projectPath: string, remoteName: string, remoteUrl: string): Promise<ProjectGitActionResult>;
  setGitRemoteUrl(projectPath: string, remoteName: string, remoteUrl: string): Promise<ProjectGitActionResult>;
  removeGitRemote(projectPath: string, remoteName: string): Promise<ProjectGitActionResult>;
  deleteGitRemoteBranch(projectPath: string, remoteName: string, branchName: string): Promise<ProjectGitActionResult>;
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
  openExternalApplication(
    payload: ProjectBridgeExternalApplicationLaunchPayload,
  ): Promise<ProjectBridgeExternalApplicationLaunchResult>;
  runCommand(payload: ProjectBridgeRunCommandPayload): Promise<ProjectBridgeRunResult>;
  stopProcess(pid: number, options?: ProjectBridgeStopProcessOptions): Promise<void>;
  getProcessStatus(pid: number, options?: ProjectBridgeStopProcessOptions): Promise<ProjectBridgeProcessStatusResult>;
  getAutomationProcessResult(
    projectId: string,
    scriptId: string,
    automationRunId: string,
  ): Promise<ProjectBridgeProcessStatusResult | null>;
  sendProcessInput(
    pid: number,
    input: string,
    options?: ProjectBridgeStopProcessOptions,
  ): Promise<ProjectBridgeSendInputResult>;
  stopAllProcesses(): Promise<void>;
  openPath(path: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
}
