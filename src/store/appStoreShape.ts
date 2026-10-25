import type {
  BackupCreateOptions,
  BackupEntry,
  BackupPrepareOptions,
  BackupRestoreOptions,
  BackupSummary,
} from "../types";
import type { CustomEnvironmentToolInput } from "../lib/environmentTools";
import type {
  AiAnalyzeResult,
  AiModelInfo,
  AiModelTestResult,
  AiPreferences,
  GithubAuthPreferences,
  GithubAuthStatus,
  GithubAuthTokenVerification,
  AiPromptMode,
  AiStreamChunkPayload,
  BuiltinEnvironmentToolOverride,
  CleanupPlan,
  CleanupResult,
  CleanupResultItem,
  CustomEnvironmentTool,
  DefaultTerminalKind,
  EnvironmentPreferences,
  EnvironmentToolDefinition,
  EnvironmentToolKey,
  EnvironmentToolResult,
  ExternalApplicationPreferences,
  IconPackColorMode,
  IconPackLoadResult,
  IconPackManifest,
  IconPackRemoveResult,
  IconPackStatus,
  IconPackUpdateResult,
  LocalStateWriteResult,
  Locale,
  LogEntry,
  MigrationRunResult,
  MigrationSummary,
  Project,
  ProjectAutomationExitConfig,
  ProjectAutomationHistoryEntry,
  ProjectAutomationHistoryStatus,
  ProjectAutomationInputStep,
  ProjectAutomationPlanEntry,
  ProjectAutomationScriptResult,
  ProjectAutomationTask,
  ProjectBridgeEvent,
  ProjectBridgeRunResult,
  ProjectBridgeScriptCandidate,
  ProjectBridgeSendInputResult,
  ProjectBridgeStopProcessOptions,
  ProjectEnvironmentEntry,
  ProjectFileKind,
  ProjectFileApplication,
  ProjectFileListResult,
  ProjectFileMutationResult,
  ProjectFileReadResult,
  ProjectFileSearchResult,
  ProjectFileWriteResult,
  ProjectFormValue,
  ProjectGitActionResult,
  ProjectGitActivityChangesOptions,
  ProjectGitActivityChangesReport,
  ProjectGitActivityDayOptions,
  ProjectGitActivityDayReport,
  ProjectGitActivityOptions,
  ProjectGitActivityReport,
  ProjectGitCommitMessageDiffResult,
  ProjectGitFileChange,
  ProjectGitFileDiffOptions,
  ProjectGitFileDiffResult,
  ProjectGitMergeResult,
  ProjectGitPushOptions,
  ProjectGitReadFailure,
  ProjectGitReadOperation,
  ProjectGitRepositoryContext,
  ProjectGitRepositoryTarget,
  ProjectGitSnapshot,
  ProjectGitStash,
  ProjectGitStashOptions,
  ProjectGitTagInfo,
  ProjectGitWorkspaceSnapshot,
  ProjectLaunchServiceAutomationSyncResult,
  ProjectLaunchServiceLogClearResult,
  ProjectLaunchServiceLogClearScope,
  ProjectLaunchServiceLogRetentionPolicy,
  ProjectLaunchServiceLogRetentionStatus,
  ProjectLaunchServicePreferences,
  ProjectLaunchServiceStatus,
  ProjectScriptDiscoverySource,
  ProjectScriptFormValue,
  StorageOverview,
  TerminalPreferences,
  TinyCardActionTrigger,
  TodoItem,
  UiPreferences,
  WorkActivityPreferences,
  WorkspaceStatePatch,
} from "../types";
import type { AutomationScriptRuntimeContext } from "./helpers/automationHelpers";
import type { Store } from "pinia";

export type AiAnalysisState = "idle" | "loading" | "success" | "warning" | "error";

export interface AiStreamHandlers {
  onStart?: () => void;
  onChunk?: (chunk: AiStreamChunkPayload) => void;
  onDone?: (result: AiAnalyzeResult) => void;
}

export interface AppState {
  locale: Locale;
  activeTab: "projects" | "settings" | "environment" | "activity";
  theme: "auto" | "light" | "dark";
  iconPackColorMode: IconPackColorMode;
  terminalPreferences: TerminalPreferences;
  externalApplicationPreferences: ExternalApplicationPreferences;
  environmentPreferences: EnvironmentPreferences;
  projectLaunchServicePreferences: ProjectLaunchServicePreferences;
  projectLaunchServiceStatus: ProjectLaunchServiceStatus | null;
  projectLaunchServiceLogRetentionStatus: ProjectLaunchServiceLogRetentionStatus | null;
  builtinEnvironmentTools: EnvironmentToolDefinition[];
  environmentResults: EnvironmentToolResult[];
  environmentChecked: boolean;
  environmentRefreshing: boolean;
  environmentRefreshingKeys: Record<string, boolean>;
  environmentRequestGenerations: Record<string, number>;
  environmentActiveRefreshes: number;
  aiPreferences: AiPreferences;
  aiModels: AiModelInfo[];
  aiModelRefreshing: boolean;
  aiModelRefreshMessage: string;
  aiModelTesting: boolean;
  aiModelTestMessage: string;
  aiModelTestOk: boolean | null;
  aiAnalyzing: boolean;
  aiAnalysisResult: string;
  aiAnalysisMessage: string;
  githubAuthPreferences: GithubAuthPreferences;
  githubAuthStatus: GithubAuthStatus | null;
  githubAuthStatusLoading: boolean;
  aiAnalysisState: AiAnalysisState;
  supportsBridge: boolean;
  projectsLoaded: boolean;
  projectStorageMessage: string;
  projectFormInspectionMessage: string;
  projectFormInspecting: boolean;
  projectFormCwdSuggestions: string[];
  projectFormOpen: boolean;
  projectFormMode: "create" | "edit" | "duplicate";
  projectFormDraft: ProjectFormValue;
  pendingDeleteProjectId: string | null;
  uiPreferences: UiPreferences;
  activeIconPack: IconPackManifest | null;
  iconPackStatus: IconPackStatus | null;
  iconPackMessage: string;
  projects: Project[];
  selectedProjectId: string | null;
  dashboardProjectGroup: string;
  hiddenProjectIds: string[];
  localStateWriteError: string;
  storageOverview: StorageOverview | null;
  cleanupPlan: CleanupPlan | null;
  cleanupSelectedIds: string[];
  cleanupRunning: boolean;
  cleanupResults: CleanupResultItem[];
  cleanupMessage: string;
  dataToolsBusy: boolean;
  migrationProgress: MigrationSummary | null;
  workActivityPreferences: WorkActivityPreferences;
  workActivitySelectedProjectIds: string[];
  workActivitySelectionInitialized: boolean;
  workActivityUnavailableProjectIds: string[];
  workActivityReport: ProjectGitActivityReport | null;
  workActivityLoading: boolean;
  workActivityReportKey: string;
  workActivityReportExpiresAt: number;
  workActivityPendingKey: string;
  workActivityMessage: string;
  workActivityLoadState: "idle" | "loading" | "error" | "refreshing" | "ready" | "cached" | "partial" | "stale";
  workActivityRetryingRepositoryPaths: string[];
  workActivityRequestGeneration: number;
  workActivityDayRequestGeneration: number;
  workActivityReturnProjectId: string | null;
  workActivityFocusProjectId: string | null;
  automationActiveProjectRuns: Record<string, string>;
  automationNextTimerAt: string;
  projectDetailsTabRequest: {
    projectId: string;
    tab: "automation" | "git" | "memo";
    requestedAt: number;
    commitHash?: string;
  } | null;
  logs: Record<string, LogEntry[]>;
  scriptLogs: Record<string, Record<string, LogEntry[]>>;
  stagedFiles: Record<string, ProjectGitFileChange[]>;
  gitRefreshing: Record<string, boolean>;
  gitStatusRefreshing: Record<string, boolean>;
  gitRepositorySnapshots: Record<string, ProjectGitSnapshot | undefined>;
  gitRepositoryRefreshing: Record<string, boolean>;
  gitRepositoryStatusRefreshing: Record<string, boolean>;
  gitRepositoryReadFailures: Record<
    string,
    Partial<Record<ProjectGitReadOperation, ProjectGitReadFailure>> | undefined
  >;
  gitRepositoryLoadingMore: Record<string, boolean>;
  gitWritesInProgress: Record<string, number>;
  gitWorkspaces: Record<string, ProjectGitWorkspaceSnapshot | undefined>;
  gitWorkspaceRefreshing: Record<string, boolean>;
  todos: Record<string, TodoItem[]>;
  memoContent: Record<string, string>;
}

export interface AppGetters {
  visibleProjects(state: AppState): Project[];
  availableProjects(state: AppState): Project[];
  unavailableProjects(state: AppState): Project[];
  workActivitySelectableProjects(state: AppState): Project[];
  workActivitySelectedProjects(): Project[];
  selectedProject(state: AppState): Project | undefined;
  relatedProjectsFor(state: AppState): (projectId: string) => Project[];
  pendingDeleteProject(state: AppState): Project | undefined;
  hasActiveProjectLaunchServiceRuns(state: AppState): boolean;
  serviceAutomationTaskEntries(
    state: AppState,
  ): (projectId: string, taskId: string) => ProjectAutomationPlanEntry[] | null;
  currentMessages(state: AppState): "zh-CN" | "en-US";
}

export interface AppActions {
  initializeProjectSessionState(): void;
  loadRuntimeAutomationHistory(projectId?: string, taskId?: string): Promise<ProjectAutomationHistoryEntry[]>;
  reloadProjectsFromStorage(): Promise<void>;
  scheduleProjectCatalogReload(): Promise<void>;
  loadProjects(): Promise<void>;
  listBackups(): Promise<{ entries: BackupEntry[]; syncState: null | 0 | 1 }>;
  createBackup(options: BackupCreateOptions): Promise<{ canceled?: boolean; path?: string; id?: string }>;
  prepareBackup(options: BackupPrepareOptions): Promise<{ canceled?: boolean; summary?: BackupSummary }>;
  restoreBackup(options: BackupRestoreOptions): Promise<{ ok: boolean; recoveryPath: string }>;
  deleteBackup(id: string): Promise<{ ok: boolean }>;
  exportCloudBackup(id: string): Promise<{ canceled?: boolean; path?: string }>;
  reconcileProjectLaunchServiceRuntime(status: ProjectLaunchServiceStatus | null): void;
  persistProjects(synchronizeProjectLaunchService?: boolean, removedProjectIds?: string[]): Promise<void>;
  recordLocalStateWrite(result?: LocalStateWriteResult | null): LocalStateWriteResult | null | undefined;
  persistWorkspaceState(patch?: WorkspaceStatePatch): LocalStateWriteResult;
  setDashboardProjectGroup(groupKey: string): void;
  setProjectHidden(projectId: string, hidden: boolean): boolean;
  refreshStorageOverview(): Promise<void>;
  loadCleanupPlan(): Promise<void>;
  runCleanup(): Promise<CleanupResult | null>;
  retryStorageMigration(): Promise<MigrationRunResult | null>;
  openLocalDataDirectory(): Promise<void>;
  openLegacyDataDirectory(): Promise<void>;
  refreshProjectAvailability(): Promise<void>;
  setLocale(locale: Locale): void;
  setTheme(theme: "auto" | "light" | "dark"): void;
  setIconPackColorMode(colorMode: IconPackColorMode): void;
  loadIconPack(): Promise<IconPackLoadResult>;
  setIconPack(packId: string): Promise<IconPackLoadResult>;
  checkIconPackUpdate(): Promise<IconPackUpdateResult>;
  installIconPack(): Promise<IconPackLoadResult>;
  verifyIconPackInstall(): Promise<IconPackLoadResult>;
  removeIconPack(): Promise<IconPackRemoveResult>;
  refreshProjectLaunchServiceStatus(verifyManualInstall?: boolean): Promise<any>;
  checkProjectLaunchServiceUpdate(): Promise<any>;
  downloadProjectLaunchService(): Promise<any>;
  openProjectLaunchServiceDirectory(): Promise<void>;
  openProjectLaunchServiceReleases(): Promise<void>;
  openIconPackDirectory(): Promise<void>;
  openIconPackReleases(): Promise<void>;
  synchronizeProjectLaunchServiceAutomation(): Promise<ProjectLaunchServiceAutomationSyncResult>;
  queueProjectLaunchServiceAutomationSync(): Promise<void>;
  synchronizeProjectLaunchServiceAutomationForUserAction(): Promise<boolean>;
  setProjectLaunchServiceEnabled(enabled: boolean): Promise<any>;
  setProjectDetailsTabOrder(order: ("automation" | "git" | "memo" | "info" | "scripts" | "files")[]): void;
  setProjectDetailsDefaultTab(tab: "automation" | "git" | "memo" | "info" | "scripts" | "files"): void;
  setTinyCardActionTrigger(trigger: TinyCardActionTrigger): void;
  acknowledgeProjectDetailsTabReorderHint(version: number): void;
  acknowledgeProjectDetailsTabDefaultHint(version: number): void;
  setDefaultTerminal(kind: DefaultTerminalKind): void;
  setDefaultTerminalCustomCommand(command: string): void;
  persistExternalApplicationPreferences(preferences: ExternalApplicationPreferences): void;
  addExternalApplication(name: string, command: string): boolean;
  updateExternalApplication(id: string, name: string, command: string): boolean;
  setExternalApplicationEnabled(id: string, enabled: boolean): boolean;
  deleteExternalApplication(id: string): boolean;
  setDefaultExternalApplication(id: string): boolean;
  restoreExternalApplicationNativeLaunch(id: string): boolean;
  setEnvironmentToolEnabled(key: EnvironmentToolKey, enabled: boolean): void;
  invalidateEnvironmentTool(key: string): void;
  addCustomEnvironmentTool(
    input: CustomEnvironmentToolInput,
  ):
    | { ok: false; errors: Partial<Record<keyof CustomEnvironmentToolInput, string>>; tool?: undefined }
    | { ok: true; tool: CustomEnvironmentTool; errors?: undefined };
  updateCustomEnvironmentTool(
    id: string,
    input: CustomEnvironmentToolInput,
  ):
    | { ok: false; errors: Partial<Record<keyof CustomEnvironmentToolInput, string>>; tool?: undefined }
    | { ok: true; tool: any; errors?: undefined };
  setCustomEnvironmentToolEnabled(id: string, enabled: boolean): void;
  deleteCustomEnvironmentTool(id: string): void;
  saveBuiltinEnvironmentToolOverride(
    key: EnvironmentToolKey,
    input: Pick<CustomEnvironmentToolInput, "command" | "versionArgs">,
  ):
    | { ok: false; errors: Partial<Record<keyof CustomEnvironmentToolInput, string>>; override?: undefined }
    | { ok: true; override: BuiltinEnvironmentToolOverride | null; errors?: undefined };
  restoreBuiltinEnvironmentTool(key: EnvironmentToolKey): void;
  refreshEnvironmentTools(targetKeys?: string[]): Promise<void>;
  setAiPreferences(patch: Partial<AiPreferences>): void;
  addAiPromptMode(): string;
  updateAiPromptMode(modeId: string, patch: Partial<Pick<AiPromptMode, "name" | "prompt">>): void;
  deleteAiPromptMode(modeId: string): void;
  resetAiPromptModes(): void;
  refreshAiModels(): Promise<void>;
  testAiConfiguration(): Promise<AiModelTestResult>;
  analyzeGitWithAiStream(projectId: string, prompt: string, handlers?: AiStreamHandlers): Promise<AiAnalyzeResult>;
  analyzeGitWithAi(projectId: string, prompt: string): Promise<void>;
  setGithubAuthPreferences(patch: Partial<GithubAuthPreferences>): void;
  refreshGithubAuthStatus(): Promise<void>;
  verifyGithubAuthToken(token: string): Promise<GithubAuthTokenVerification>;
  setActiveTab(tab: "projects" | "settings" | "environment" | "activity"): void;
  openWorkActivity(projectId?: string): void;
  returnFromWorkActivity(): void;
  setWorkActivityProjectIds(projectIds: string[]): void;
  saveWorkActivityProjectGroup(name: string): boolean;
  applyWorkActivityProjectGroup(groupId: string): boolean;
  clearWorkActivityProjectFocus(): boolean;
  renameWorkActivityProjectGroup(groupId: string, name: string): boolean;
  deleteWorkActivityProjectGroup(groupId: string): boolean;
  invalidateWorkActivity(): void;
  setWorkActivityPreferences(preferences: Partial<WorkActivityPreferences>): void;
  loadGitActivity(options: ProjectGitActivityOptions): Promise<void>;
  retryWorkActivityRepository(repositoryPath: string, options: ProjectGitActivityOptions): Promise<boolean>;
  readGitActivityChanges(
    options: ProjectGitActivityChangesOptions,
    projectPaths?: string[],
  ): Promise<ProjectGitActivityChangesReport | null>;
  readGitActivityDay(
    options: ProjectGitActivityDayOptions,
    projectPaths?: string[],
  ): Promise<ProjectGitActivityDayReport | null>;
  setSelectedProject(id: string): void;
  openProjectByName(query: string): boolean;
  openCreateProjectForm(): void;
  openEditProjectForm(projectId: string): void;
  openDuplicateProjectForm(projectId: string): void;
  closeProjectForm(): void;
  updateProjectForm(patch: Partial<ProjectFormValue>): void;
  inspectCurrentProjectPath(): Promise<void>;
  discoverProjectFormScripts(sources: ProjectScriptDiscoverySource[]): Promise<ProjectBridgeScriptCandidate[]>;
  importProjectFormScripts(candidates: ProjectBridgeScriptCandidate[]): number;
  refreshProjectFormCwdSuggestions(projectPath?: string): Promise<void>;
  pickProjectPath(): Promise<void>;
  pickQuickLinkPath(): Promise<void>;
  addEnvironmentEntry(): void;
  updateEnvironmentEntry(entryId: string, patch: Partial<ProjectEnvironmentEntry>): void;
  removeEnvironmentEntry(entryId: string): void;
  addScriptEntry(): void;
  updateScriptEntry(scriptId: string, patch: Partial<ProjectScriptFormValue>): void;
  removeScriptEntry(scriptId: string): void;
  moveScriptEntry(scriptId: string, direction: "up" | "down"): void;
  reorderScriptEntry(scriptId: string, targetScriptId: string): void;
  reorderProjectScripts(projectId: string, scriptId: string, targetScriptId: string): boolean;
  saveProjectForm(): Promise<string | null>;
  deleteProject(projectId: string): Promise<boolean>;
  requestDeleteProject(projectId: string): void;
  cancelDeleteProject(): void;
  confirmDeleteProject(): Promise<any>;
  refreshProjectScripts(projectId: string): Promise<void>;
  refreshProjects(): Promise<void>;
  refreshDashboardGitChangeCounts(): Promise<void>;
  moveProject(projectId: string, direction: "up" | "down" | "top", scopeProjectIds?: string[]): Promise<boolean>;
  reorderProject(
    projectId: string,
    targetProjectId: string,
    scopeProjectIds?: string[],
    position?: "before" | "after",
  ): Promise<boolean>;
  resolveGitRepositoryContext(
    projectId: string,
    target?: ProjectGitRepositoryTarget,
  ): ProjectGitRepositoryContext | null;
  gitSnapshotForRepository(projectId: string, target?: ProjectGitRepositoryTarget): ProjectGitSnapshot | null;
  refreshGitSnapshot(
    projectId: string,
    options?: { force?: boolean; maxAgeMs?: number; limit?: number },
    target?: ProjectGitRepositoryTarget,
  ): Promise<void>;
  refreshGitWorkspace(projectId: string, options?: { force?: boolean }): Promise<void>;
  refreshGitWorkingTreeSnapshot(projectId: string, target?: ProjectGitRepositoryTarget): Promise<void>;
  refreshGitStatusSnapshot(projectId: string, target?: ProjectGitRepositoryTarget): Promise<void>;
  refreshGitSnapshotForInteraction(
    projectId: string,
    target?: ProjectGitRepositoryTarget,
    options?: { maxAgeMs?: number; limit?: number },
  ): Promise<void>;
  loadMoreGitCommits(projectId: string, target?: ProjectGitRepositoryTarget): Promise<void>;
  listProjectFiles(projectId: string, relativePath?: string): Promise<ProjectFileListResult | null>;
  searchProjectFiles(
    projectId: string,
    query: string,
    options?: { limit?: number },
  ): Promise<ProjectFileSearchResult | null>;
  createProjectEntry(
    projectId: string,
    parentRelativePath: string,
    name: string,
    kind: ProjectFileKind,
  ): Promise<ProjectFileMutationResult | null>;
  renameProjectEntry(projectId: string, relativePath: string, name: string): Promise<ProjectFileMutationResult | null>;
  deleteProjectEntry(projectId: string, relativePath: string): Promise<ProjectFileMutationResult | null>;
  showProjectEntryInFolder(projectId: string, relativePath: string): Promise<void>;
  listProjectFileApplications(projectId: string, relativePath: string): Promise<ProjectFileApplication[]>;
  openProjectFileWith(projectId: string, relativePath: string, applicationId?: string): Promise<void>;
  readProjectFile(projectId: string, relativePath: string): Promise<ProjectFileReadResult | null>;
  readGitFileDiff(
    projectId: string,
    relativePath: string,
    options?: ProjectGitFileDiffOptions,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitFileDiffResult | null>;
  readGitCommitFileDiff(
    projectId: string,
    commitHash: string,
    relativePath: string,
    target?: ProjectGitRepositoryTarget,
    stash?: ProjectGitStash,
    options?: ProjectGitFileDiffOptions,
  ): Promise<ProjectGitFileDiffResult | null>;
  readGitCommitFiles(
    projectId: string,
    commitHash: string,
    target?: ProjectGitRepositoryTarget,
    stash?: ProjectGitStash,
  ): Promise<ProjectGitFileChange[]>;
  readGitTagInfo(
    projectId: string,
    tagName: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitTagInfo | null>;
  readGitCommitAuthorAvatar(
    projectId: string,
    commitHash: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<string | null>;
  readGitCommitMessageDiff(
    projectId: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitCommitMessageDiffResult | null>;
  initializeGitRepository(projectId: string): Promise<ProjectGitActionResult | null>;
  runAuthorizedGitWrite<TResult extends ProjectGitActionResult>(
    projectId: string,
    target: ProjectGitRepositoryTarget,
    action: (context: ProjectGitRepositoryContext) => Promise<TResult>,
    options: { refresh: "status" | "working-tree" | "full"; refs?: boolean; refreshOnFailure?: boolean },
  ): Promise<TResult | null>;
  stageGitFile(
    projectId: string,
    relativePath: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  unstageGitFile(
    projectId: string,
    relativePath: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  discardGitFile(
    projectId: string,
    relativePath: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  stageGitFiles(
    projectId: string,
    relativePaths: string[],
    options?: { all?: boolean },
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  unstageGitFiles(
    projectId: string,
    relativePaths: string[],
    options?: { all?: boolean },
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  discardGitFiles(
    projectId: string,
    relativePaths: string[],
    options?: { all?: boolean },
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  commitGitStaged(
    projectId: string,
    message: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  amendGitCommit(
    projectId: string,
    message: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  undoLastGitCommit(
    projectId: string,
    options?: { allowMerge?: boolean },
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  cherryPickGitCommit(
    projectId: string,
    commitHash: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  revertGitCommit(
    projectId: string,
    commitHash: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  createGitStash(
    projectId: string,
    message?: string,
    options?: ProjectGitStashOptions,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  applyGitStash(
    projectId: string,
    stashRef: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  popGitStash(
    projectId: string,
    stashRef: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  dropGitStash(
    projectId: string,
    stashRef: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  switchGitBranch(
    projectId: string,
    branchName: string,
    options?: { force?: boolean },
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  checkoutGitCommit(
    projectId: string,
    commitHash: string,
    options?: { force?: boolean; detach?: boolean },
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  createGitBranch(
    projectId: string,
    branchName: string,
    commitHash: string,
    options?: { checkout?: boolean; force?: boolean },
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  createGitTag(
    projectId: string,
    tagName: string,
    commitHash: string,
    options?: { annotated?: boolean; message?: string },
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  deleteGitTag(
    projectId: string,
    tagName: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  pushGitTag(
    projectId: string,
    tagName: string,
    remoteName?: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  renameGitBranch(
    projectId: string,
    branchName: string,
    nextBranchName: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  deleteGitBranch(
    projectId: string,
    branchName: string,
    options?: { force?: boolean },
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  checkoutGitRemoteBranch(
    projectId: string,
    remoteRef: string,
    options?: { force?: boolean },
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  fetchGitRemote(projectId: string, target?: ProjectGitRepositoryTarget): Promise<ProjectGitActionResult | null>;
  fetchGitRemoteByName(
    projectId: string,
    remoteName: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  pullGitRemote(projectId: string, target?: ProjectGitRepositoryTarget): Promise<ProjectGitActionResult | null>;
  pushGitRemote(
    projectId: string,
    target?: ProjectGitRepositoryTarget,
    options?: ProjectGitPushOptions,
  ): Promise<ProjectGitActionResult | null>;
  mergeGitBaseBranch(projectId: string, target?: ProjectGitRepositoryTarget): Promise<ProjectGitMergeResult | null>;
  abortGitMerge(projectId: string, target?: ProjectGitRepositoryTarget): Promise<ProjectGitActionResult | null>;
  publishGitBranch(
    projectId: string,
    remoteName: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  addGitRemote(
    projectId: string,
    remoteName: string,
    remoteUrl: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  setGitRemoteUrl(
    projectId: string,
    remoteName: string,
    remoteUrl: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  removeGitRemote(
    projectId: string,
    remoteName: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  deleteGitRemoteBranch(
    projectId: string,
    remoteName: string,
    branchName: string,
    target?: ProjectGitRepositoryTarget,
  ): Promise<ProjectGitActionResult | null>;
  writeProjectFile(projectId: string, relativePath: string, content: string): Promise<ProjectFileWriteResult | null>;
  automationTaskValidation(projectId: string, task: ProjectAutomationTask): { valid: boolean; message: string };
  scheduleAutomationTimer(): void;
  markMissedAutomationPlans(notify?: boolean): void;
  reconcileOrphanedAutomationRuns(): Promise<boolean>;
  reconcileRuntimeProcessState(): Promise<void>;
  runDueAutomationPlans(notifyMissed?: boolean): Promise<void>;
  recomputeAutomationPlans(projectId?: string, notifyMissed?: boolean): void;
  createAutomationTask(
    projectId: string,
    patch: Partial<ProjectAutomationTask>,
  ): { ok: boolean; message: any; task?: undefined } | { ok: boolean; message: string; task: ProjectAutomationTask };
  duplicateAutomationTask(
    projectId: string,
    taskId: string,
    name: string,
  ): { ok: boolean; message: any; task?: undefined } | { ok: boolean; message: string; task: ProjectAutomationTask };
  updateAutomationTask(
    projectId: string,
    taskId: string,
    patch: Partial<ProjectAutomationTask>,
  ): { ok: boolean; message: any; task?: undefined } | { ok: boolean; message: string; task: any };
  deleteAutomationTask(projectId: string, taskId: string): boolean;
  openProjectAutomation(projectId: string): void;
  openProjectMemo(projectId: string): void;
  openProjectGit(projectId: string, commitHash?: string): void;
  finishAutomationPlanEntry(
    project: Project,
    task: ProjectAutomationTask,
    entry: ProjectAutomationPlanEntry,
    status: ProjectAutomationHistoryStatus,
    reason: string,
    scriptResults: ProjectAutomationScriptResult[],
    runId?: string,
    notify?: boolean,
  ): void;
  runAutomationTask(projectId: string, taskId: string, entryId: string): Promise<void>;
  runAutomationPlanEntryEarly(projectId: string, taskId: string, entryId: string): Promise<boolean>;
  runAutomationTaskNow(projectId: string, taskId: string): Promise<boolean>;
  ignoreMissedAutomationTask(projectId: string, taskId: string, executionId?: string): Promise<boolean>;
  runAutomationScript(
    projectId: string,
    scriptId: string,
    automationRunId: string,
    steps: ProjectAutomationInputStep[],
    exitConfig: ProjectAutomationExitConfig | undefined,
    maxRuntimeMinutes: number,
    continueAfterInput: boolean,
  ): Promise<ProjectAutomationScriptResult>;
  sendAutomationInput(context: AutomationScriptRuntimeContext, value: string): Promise<boolean>;
  advanceAutomationInputStep(context: AutomationScriptRuntimeContext): void;
  consumeAutomationOutputMatch(context: AutomationScriptRuntimeContext): Promise<void>;
  handleAutomationBridgeEvent(event: ProjectBridgeEvent): void;
  launchScript(projectId: string, scriptId: string, automationRunId?: string): Promise<ProjectBridgeRunResult | null>;
  launchAllScripts(projectId: string): Promise<ProjectBridgeRunResult[]>;
  stopScript(projectId: string, scriptId: string, stopOptions?: ProjectBridgeStopProcessOptions): Promise<void>;
  stopRunningScriptsForPluginExit(): void;
  sendScriptInput(projectId: string, scriptId: string, input: string): Promise<ProjectBridgeSendInputResult>;
  openProjectFolder(projectId: string): Promise<void>;
  showGitRepositoryInFolder(projectId: string, target: ProjectGitRepositoryTarget): Promise<void>;
  openGitRepositoryInTerminal(projectId: string, target: ProjectGitRepositoryTarget): Promise<void>;
  openGitRepositoryInEditor(
    projectId: string,
    target: ProjectGitRepositoryTarget,
    applicationId?: string,
  ): Promise<void>;
  openProjectInTerminal(projectId: string): Promise<void>;
  openProjectInEditor(projectId: string, applicationId?: string): Promise<void>;
  openProjectQuickLink(projectId: string): Promise<void>;
  persistRuntimeAutomationState(projectId: string): boolean;
  loadRuntimeRecordLogPage(
    runId: string,
    beforeOffset: number,
  ): Promise<import("../types").RuntimeRecordLog & { logs: LogEntry[] }>;
  listRuntimeRecords(projectId: string): Promise<import("../types").RuntimeRecord[]>;
  refreshRuntimeRecordRetention(): Promise<ProjectLaunchServiceLogRetentionStatus>;
  updateRuntimeRecordRetention(
    policy: ProjectLaunchServiceLogRetentionPolicy,
  ): Promise<ProjectLaunchServiceLogRetentionStatus>;
  clearRuntimeRecords(scope?: ProjectLaunchServiceLogClearScope): Promise<ProjectLaunchServiceLogClearResult>;
  restoreRuntimeAutomationState(): void;
  addLog(projectId: string, log: LogEntry, scriptId?: string, persist?: boolean): void;
  clearLogs(projectId: string): void;
  clearScriptLogs(projectId: string, scriptId: string): void;
  addTodo(projectId: string, text: string): void;
  toggleTodo(projectId: string, todoId: string): void;
  updateTodo(projectId: string, todoId: string, text: string): void;
  deleteTodo(projectId: string, todoId: string): void;
  reorderTodo(projectId: string, todoId: string, targetTodoId: string): void;
  syncProjectTodos(projectId: string): void;
  updateMemo(projectId: string, content: string): void;
  handleBridgeEvent(event: ProjectBridgeEvent): void;
}

export type AppStore = Store<"app", AppState, AppGetters, AppActions>;
