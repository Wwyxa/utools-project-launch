import { defineStore } from "pinia";
import type { Locale, IconPackColorMode, ProjectLaunchServicePreferences, ProjectLaunchServiceStatus, ProjectLaunchServiceLogRetentionStatus, EnvironmentToolDefinition, EnvironmentToolResult, AiModelInfo, ProjectFormValue, IconPackManifest, IconPackStatus, ProjectGitActivityReport, LogEntry, ProjectGitFileChange, ProjectGitSnapshot, ProjectGitWorkspaceSnapshot, TodoItem, Project, ProjectAutomationPlanEntry } from "../types";
import { bridge } from "./helpers/bridge";
import type { AiAnalysisState, AppStore } from "./appStoreShape";
import { supportsRealProjectBridge } from "../lib/projectBridge";
import { createBlankProjectForm, demoProjects, isProjectVisibleOnCurrentDevice } from "./helpers/projectHelpers";
import { defaultWorkActivityPreferences, workActivityActions } from "./actions/workActivity";
import type { GitReadFailureState } from "./helpers/gitHelpers";
import { resolveProjectRelatedProjectIds } from "../lib/projectRelations";
import { PROJECT_MAX_RELATED_PROJECTS } from "../types";
import { aiActions } from "./actions/ai";
import { automationRunActions } from "./actions/automationRun";
import { automationScheduleActions } from "./actions/automationSchedule";
import { bridgeEventsActions } from "./actions/bridgeEvents";
import { gitMutationsActions } from "./actions/gitMutations";
import { gitSnapshotActions } from "./actions/gitSnapshot";
import { iconPackActions } from "./actions/iconPack";
import { logsAndTodosActions } from "./actions/logsAndTodos";
import { projectCatalogActions } from "./actions/projectCatalog";
import { projectCrudActions } from "./actions/projectCrud";
import { projectFilesActions } from "./actions/projectFiles";
import { projectFormActions } from "./actions/projectForm";
import { projectLaunchServiceActions } from "./actions/projectLaunchService";
import { projectOpenersActions } from "./actions/projectOpeners";
import { scriptRuntimeActions } from "./actions/scriptRuntime";
import { settingsActions } from "./actions/settings";

export const useStore = defineStore("app", {
  state: () => ({
    locale: "zh-CN" as Locale,
    activeTab: "projects" as "projects" | "settings" | "environment" | "activity",
    theme: "auto" as "light" | "dark" | "auto",
    iconPackColorMode: "light" as IconPackColorMode,
    terminalPreferences: bridge.loadTerminalPreferences(),
    externalApplicationPreferences: bridge.loadExternalApplicationPreferences(),
    environmentPreferences: bridge.loadEnvironmentPreferences(),
    projectLaunchServicePreferences: bridge.loadProjectLaunchServicePreferences() as ProjectLaunchServicePreferences,
    projectLaunchServiceStatus: null as ProjectLaunchServiceStatus | null,
    projectLaunchServiceLogRetentionStatus: null as ProjectLaunchServiceLogRetentionStatus | null,
    builtinEnvironmentTools: bridge.loadBuiltinEnvironmentTools() as EnvironmentToolDefinition[],
    environmentResults: [] as EnvironmentToolResult[],
    environmentChecked: false,
    environmentRefreshing: false,
    environmentRefreshingKeys: {} as Record<string, boolean>,
    environmentRequestGenerations: {} as Record<string, number>,
    environmentActiveRefreshes: 0,
    aiPreferences: bridge.loadAiPreferences(),
    aiModels: [] as AiModelInfo[],
    aiModelRefreshing: false,
    aiModelRefreshMessage: "",
    aiModelTesting: false,
    aiModelTestMessage: "",
    aiModelTestOk: null as boolean | null,
    aiAnalyzing: false,
    aiAnalysisResult: "",
    aiAnalysisMessage: "",
    aiAnalysisState: "idle" as AiAnalysisState,
    supportsBridge: supportsRealProjectBridge(),
    projectsLoaded: false,
    projectStorageMessage: "",
    projectConfigMessage: "",
    projectFormInspectionMessage: "",
    projectFormInspecting: false,
    projectFormCwdSuggestions: ["."] as string[],
    projectFormOpen: false,
    projectFormMode: "create" as "create" | "edit" | "duplicate",
    projectFormDraft: createBlankProjectForm() as ProjectFormValue,
    pendingDeleteProjectId: null as string | null,
    uiPreferences: bridge.loadUiPreferences(),
    activeIconPack: null as IconPackManifest | null,
    iconPackStatus: null as IconPackStatus | null,
    iconPackMessage: "",
    projects: supportsRealProjectBridge() ? [] : demoProjects,
    selectedProjectId: null as string | null,
    workActivityPreferences: defaultWorkActivityPreferences(),
    workActivitySelectedProjectIds: [] as string[],
    workActivitySelectionInitialized: false,
    workActivityUnavailableProjectIds: [] as string[],
    workActivityReport: null as ProjectGitActivityReport | null,
    workActivityLoading: false,
    workActivityReportKey: "",
    workActivityReportExpiresAt: 0,
    workActivityPendingKey: "",
    workActivityMessage: "",
    workActivityLoadState: "idle" as
      | "idle"
      | "loading"
      | "refreshing"
      | "ready"
      | "cached"
      | "partial"
      | "stale"
      | "error",
    workActivityRetryingRepositoryPaths: [] as string[],
    workActivityRequestGeneration: 0,
    workActivityDayRequestGeneration: 0,
    workActivityReturnProjectId: null as string | null,
    workActivityFocusProjectId: null as string | null,
    automationActiveProjectRuns: {} as Record<string, string>,
    automationNextTimerAt: "",
    projectDetailsTabRequest: null as {
      projectId: string;
      tab: "automation" | "git" | "memo";
      requestedAt: number;
      commitHash?: string;
    } | null,
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
    gitRefreshing: {} as Record<string, boolean>,
    gitStatusRefreshing: {} as Record<string, boolean>,
    gitRepositorySnapshots: {} as Record<string, ProjectGitSnapshot | undefined>,
    gitRepositoryRefreshing: {} as Record<string, boolean>,
    gitRepositoryStatusRefreshing: {} as Record<string, boolean>,
    gitRepositoryReadFailures: {} as Record<string, GitReadFailureState | undefined>,
    gitRepositoryLoadingMore: {} as Record<string, boolean>,
    gitWritesInProgress: {} as Record<string, number>,
    gitWorkspaces: {} as Record<string, ProjectGitWorkspaceSnapshot | undefined>,
    gitWorkspaceRefreshing: {} as Record<string, boolean>,
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
    visibleProjects: (state): Project[] => state.projects.filter(isProjectVisibleOnCurrentDevice),
    availableProjects: (state): Project[] =>
      state.projects.filter((project) => isProjectVisibleOnCurrentDevice(project) && project.pathExists !== false),
    unavailableProjects: (state): Project[] =>
      state.projects.filter((project) => isProjectVisibleOnCurrentDevice(project) && project.pathExists === false),
    workActivitySelectableProjects: (state): Project[] => {
      const unavailableIds = new Set(state.workActivityUnavailableProjectIds);
      return state.projects.filter(
        (project) =>
          isProjectVisibleOnCurrentDevice(project) && project.pathExists !== false && !unavailableIds.has(project.id),
      );
    },
    workActivitySelectedProjects(): Project[] {
      const selectedIds = new Set(this.workActivitySelectedProjectIds);
      if (this.workActivityFocusProjectId) selectedIds.add(this.workActivityFocusProjectId);
      return this.workActivitySelectableProjects.filter((project) => selectedIds.has(project.id));
    },
    selectedProject: (state): Project | undefined =>
      state.projects.find((project) => project.id === state.selectedProjectId),
    relatedProjectsFor:
      (state) =>
        (projectId: string): Project[] => {
          const projectsById = new Map(state.projects.map((project) => [project.id, project]));
          return resolveProjectRelatedProjectIds(projectId, state.projects)
            .map((relatedProjectId) => projectsById.get(relatedProjectId))
            .filter((project): project is Project => Boolean(project && isProjectVisibleOnCurrentDevice(project)))
            .slice(0, PROJECT_MAX_RELATED_PROJECTS);
        },
    pendingDeleteProject: (state): Project | undefined =>
      state.projects.find((project) => project.id === state.pendingDeleteProjectId),
    hasActiveProjectLaunchServiceRuns: (state): boolean =>
      state.projects.some((project) =>
        project.scripts.some(
          (script) =>
            script.runtimeOwner === "service" && (script.status === "RUNNING" || script.status === "STOPPING"),
        ),
      ),
    serviceAutomationTaskEntries:
      (state) =>
        (projectId: string, taskId: string): ProjectAutomationPlanEntry[] | null => {
          if (!state.projectLaunchServicePreferences.enabled) {
            return null;
          }
          const automation = state.projectLaunchServiceStatus?.automation;
          if (
            state.projectLaunchServiceStatus?.state !== "healthy" ||
            !state.projectLaunchServiceStatus.running ||
            !automation
          ) {
            return [];
          }

          const entries = new Map<string, ProjectAutomationPlanEntry>();
          for (const entry of automation.upcoming || []) {
            if (entry.projectId === projectId && entry.taskId === taskId) {
              entries.set(entry.planEntryId, {
                id: entry.planEntryId,
                plannedAt: entry.plannedAt,
                status: "pending",
              });
            }
          }
          for (const execution of automation.executions || []) {
            if (execution.projectId !== projectId || execution.taskId !== taskId || !execution.plannedAt) {
              continue;
            }
            entries.set(execution.planEntryId, {
              id: execution.planEntryId,
              plannedAt: execution.plannedAt,
              status: execution.status,
              runId: execution.id,
              reason: execution.reason,
            });
          }
          return [...entries.values()].sort(
            (left, right) => new Date(left.plannedAt).getTime() - new Date(right.plannedAt).getTime(),
          );
        },
    currentMessages: (state) => (state.locale === "zh-CN" ? "zh-CN" : "en-US"),
  },
  actions: {
    ...aiActions,
    ...automationRunActions,
    ...automationScheduleActions,
    ...bridgeEventsActions,
    ...gitMutationsActions,
    ...gitSnapshotActions,
    ...iconPackActions,
    ...logsAndTodosActions,
    ...projectCatalogActions,
    ...projectCrudActions,
    ...projectFilesActions,
    ...projectFormActions,
    ...projectLaunchServiceActions,
    ...projectOpenersActions,
    ...scriptRuntimeActions,
    ...settingsActions,
    ...workActivityActions,
  },
});

type _StoreShapeGuard = [AppStore] extends [ReturnType<typeof useStore>]
  ? [ReturnType<typeof useStore>] extends [AppStore]
  ? true
  : never
  : never;
const _storeShapeGuard: _StoreShapeGuard = true;
