import type { BackupCreateOptions, BackupPrepareOptions, BackupRestoreOptions } from "../../types";
import { mergeWorkActivityPreferences } from "../helpers/workspaceState";
import { deriveProjectStatus, mergeScriptRuntimeState } from "../../lib/projectRuntimeState";
import { ProjectStatus } from "../../types";
import type { IconPackColorMode, LocalStateWriteResult, Locale, Project, WorkspaceStatePatch } from "../../types";
import type { AppStore } from "../appStoreShape";
import { waitForInitialPaint } from "../helpers/automationHelpers";
import { bridge } from "../helpers/bridge";
import {
  cloneProjectCatalogSnapshot,
  hydrateProject,
  projectCatalogStorageSnapshot,
  setProjectCatalogStorageSnapshot,
  toPersistedProject,
} from "../helpers/projectHelpers";

let projectCatalogReloadPromise: Promise<void> | null = null;

let projectCatalogReloadQueued = false;

export const projectCatalogActions = {
  async listBackups(this: AppStore) {
    return bridge.listBackups();
  },

  async createBackup(this: AppStore, options: BackupCreateOptions) {
    return bridge.createBackup(options);
  },

  async prepareBackup(this: AppStore, options: BackupPrepareOptions) {
    return bridge.prepareBackup(options);
  },

  async deleteBackup(this: AppStore, id: string) {
    return bridge.deleteBackup(id);
  },

  async exportCloudBackup(this: AppStore, id: string) {
    return bridge.exportCloudBackup(id);
  },

  async restoreBackup(this: AppStore, options: BackupRestoreOptions) {
    let result;
    try {
      result = await bridge.restoreBackup(options);
    } finally {
      await this.reloadProjectsFromStorage();
      for (const project of this.projects) {
        this.memoContent[project.id] = project.memo || "";
        this.todos[project.id] = project.todos || [];
      }
      this.terminalPreferences = bridge.loadTerminalPreferences();
      this.externalApplicationPreferences = bridge.loadExternalApplicationPreferences();
      this.environmentPreferences = bridge.loadEnvironmentPreferences();
      this.aiPreferences = bridge.loadAiPreferences();
      this.projectLaunchServicePreferences = bridge.loadProjectLaunchServicePreferences();
      this.uiPreferences = bridge.loadUiPreferences();
      const workspace = bridge.loadWorkspaceState();
      this.dashboardProjectGroup = workspace.dashboardProjectGroup;
      this.workActivityPreferences = mergeWorkActivityPreferences(workspace.workActivity.preferences);
      this.workActivitySelectedProjectIds = workspace.workActivity.selectedProjectIds;
      this.workActivitySelectionInitialized = workspace.workActivity.selectionInitialized;
      await this.loadIconPack();
      this.recomputeAutomationPlans(undefined, false);
    }
    return result;
  },

  initializeProjectSessionState(this: AppStore) {
    this.projects.forEach((project) => {
      this.memoContent[project.id] = project.memo || this.memoContent[project.id] || "";
      this.todos[project.id] = project.todos || this.todos[project.id] || [];
      this.logs[project.id] = this.logs[project.id] || [];
      this.scriptLogs[project.id] = this.scriptLogs[project.id] || {};
      this.stagedFiles[project.id] = project.git?.files || this.stagedFiles[project.id] || [];
    });
  },

  persistRuntimeAutomationState(this: AppStore, projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || !this.supportsBridge || this.projectLaunchServicePreferences.enabled) return true;
    const result = bridge.saveRuntimeAutomationState(projectId, (project.automationTasks || []).map((task) => ({
      taskId: task.id, dailyPlans: task.dailyPlans, history: task.history,
    })));
    this.recordLocalStateWrite(result);
    return result.ok;
  },

  restoreRuntimeAutomationState(this: AppStore) {
    if (!this.supportsBridge) return;
    for (const project of this.projects) {
      try {
        const states = bridge.loadRuntimeAutomationState?.(project.id) || [];
        for (const task of project.automationTasks || []) {
          const stored = states.find((state) => state.taskId === task.id);
          if (!stored) continue;
          task.dailyPlans = stored.dailyPlans;
          task.history = stored.history;
        }
      } catch (error) {
        this.localStateWriteError = error instanceof Error ? error.message : "自动任务状态读取失败。";
        for (const task of project.automationTasks || []) task.enabled = false;
      }
    }
  },

  async reloadProjectsFromStorage(this: AppStore) {
    try {
      const storedProjects = await bridge.loadProjects();
      if (this.supportsBridge || storedProjects.length > 0) {
        const previousProjectsById = new Map<string, Project>(
          this.projects.map((project): [string, Project] => [project.id, project]),
        );
        this.projects = storedProjects.map((storedProject) => {
          const nextProject = hydrateProject(storedProject);
          const previousProject = previousProjectsById.get(nextProject.id);
          if (!previousProject || previousProject.path !== nextProject.path) {
            return nextProject;
          }

          const mergedProject = {
            ...nextProject,
            scripts: mergeScriptRuntimeState(nextProject.scripts, previousProject.scripts),
            automationTasks: (nextProject.automationTasks || []).map((task) => {
              const previous = previousProject.automationTasks?.find((candidate) => candidate.id === task.id);
              return previous ? { ...task, dailyPlans: previous.dailyPlans, history: previous.history } : task;
            }),
            git: previousProject.git || nextProject.git,
            gitLatestCommitAt: nextProject.gitLatestCommitAt || previousProject.gitLatestCommitAt,
            pathExists: previousProject.pathExists,
            unavailableReason: previousProject.unavailableReason,
          };
          return { ...mergedProject, status: deriveProjectStatus(mergedProject) };
        });
        this.selectedProjectId = this.projects.some((project) => project.id === this.selectedProjectId)
          ? this.selectedProjectId
          : null;
      }

      setProjectCatalogStorageSnapshot(storedProjects);
      this.projectsLoaded = true;
      this.initializeProjectSessionState();
      this.reconcileProjectLaunchServiceRuntime(this.projectLaunchServiceStatus);
      try {
        await this.loadRuntimeAutomationHistory();
      } catch (error) {
        this.localStateWriteError = error instanceof Error ? error.message : "自动任务执行历史读取失败。";
      }
      await this.refreshProjectAvailability();
      this.projectStorageMessage = "";
    } catch (error) {
      this.projectStorageMessage = "项目配置读取失败，已保留当前会话数据";
    }
  },

  scheduleProjectCatalogReload(this: AppStore) {
    if (projectCatalogReloadPromise) {
      projectCatalogReloadQueued = true;
      return projectCatalogReloadPromise;
    }

    const reload = async () => {
      do {
        projectCatalogReloadQueued = false;
        await this.reloadProjectsFromStorage();
        await this.reconcileRuntimeProcessState();
      } while (projectCatalogReloadQueued);
    };
    const sharedPromise = reload().finally(() => {
      if (projectCatalogReloadPromise === sharedPromise) {
        projectCatalogReloadPromise = null;
        projectCatalogReloadQueued = false;
      }
    });
    projectCatalogReloadPromise = sharedPromise;
    return sharedPromise;
  },

  async loadProjects(this: AppStore) {
    const markStartupPhase = window.__utoolsProjectLaunchStartupTiming?.mark;
    markStartupPhase?.("projects-load-preferences-start");
    this.terminalPreferences = bridge.loadTerminalPreferences();
    this.externalApplicationPreferences = bridge.loadExternalApplicationPreferences();
    this.environmentPreferences = bridge.loadEnvironmentPreferences();
    this.projectLaunchServicePreferences = bridge.loadProjectLaunchServicePreferences();
    this.aiPreferences = bridge.loadAiPreferences();
    const iconPackLoad = this.loadIconPack();
    markStartupPhase?.("projects-load-preferences-complete");

    markStartupPhase?.("projects-load-storage-hydration-start");
    try {
      const storedProjects = await bridge.loadProjects();
      if (this.supportsBridge || storedProjects.length > 0) {
        this.projects = storedProjects.map(hydrateProject);
        this.selectedProjectId = this.projects.some((project) => project.id === this.selectedProjectId)
          ? this.selectedProjectId
          : null;
      }
      setProjectCatalogStorageSnapshot(storedProjects);
    } catch (error) {
      this.projectStorageMessage = "项目配置读取失败，已保留当前会话数据";
    }
    markStartupPhase?.("projects-load-storage-hydration-complete");

    this.projectsLoaded = true;

    markStartupPhase?.("projects-load-state-setup-start");
    this.restoreRuntimeAutomationState();
    this.initializeProjectSessionState();
    markStartupPhase?.("projects-load-state-setup-complete");

    const projectLaunchServiceStatusLoad = this.projectLaunchServicePreferences.enabled
      ? bridge.reconcileProjectLaunchService()
      : bridge.getProjectLaunchServiceStatus();

    await waitForInitialPaint();
    const runtimeAutomationHistoryLoad = this.loadRuntimeAutomationHistory().catch((error) => {
      this.localStateWriteError = error instanceof Error ? error.message : "自动任务执行历史读取失败。";
    });
    this.projectLaunchServiceStatus = await projectLaunchServiceStatusLoad;
    this.reconcileProjectLaunchServiceRuntime(this.projectLaunchServiceStatus);

    markStartupPhase?.("projects-load-path-availability-start");
    await this.refreshProjectAvailability();
    markStartupPhase?.("projects-load-path-availability-complete");
    await iconPackLoad;
    void this.refreshDashboardGitChangeCounts();

    markStartupPhase?.("projects-load-runtime-reconciliation-start");
    await this.reconcileRuntimeProcessState();
    markStartupPhase?.("projects-load-runtime-reconciliation-complete");

    await runtimeAutomationHistoryLoad;
    markStartupPhase?.("projects-load-automation-plan-recomputation-start");
    this.recomputeAutomationPlans(undefined, false);
    markStartupPhase?.("projects-load-automation-plan-recomputation-complete");
  },

  async persistProjects(this: AppStore, synchronizeProjectLaunchService = true, removedProjectIds: string[] = []) {
    try {
      const persistedProjects = this.projects.map((project, index) => {
        const persistedProject = toPersistedProject(project, index);
        project.sortOrder = persistedProject.sortOrder;
        return persistedProject;
      });
      await bridge.saveProjects(persistedProjects, {
        baseProjects: cloneProjectCatalogSnapshot(projectCatalogStorageSnapshot),
        removedProjectIds,
      });
      setProjectCatalogStorageSnapshot(persistedProjects);
      this.projectStorageMessage = "";
    } catch (error) {
      this.projectStorageMessage = "项目配置保存失败，请稍后重试";
    }
    if (synchronizeProjectLaunchService && this.projectLaunchServicePreferences.enabled) {
      void this.queueProjectLaunchServiceAutomationSync();
    }
  },

  recordLocalStateWrite(this: AppStore, result?: LocalStateWriteResult | null) {
    // Bridge mocks and legacy callers may return void; only an explicit
    // failure result is surfaced to the settings page.
    if (!result) return result;
    this.localStateWriteError = result.ok ? "" : result.error || "本地状态写入失败，本次修改仅保留在内存中。";
    return result;
  },

  persistWorkspaceState(this: AppStore, patch: WorkspaceStatePatch = {}) {
    const result = bridge.saveWorkspaceState({
      dashboardProjectGroup: patch.dashboardProjectGroup ?? this.dashboardProjectGroup,
      workActivity: {
        selectionInitialized: patch.workActivity?.selectionInitialized ?? this.workActivitySelectionInitialized,
        preferences:
          patch.workActivity?.preferences !== undefined ? patch.workActivity.preferences : this.workActivityPreferences,
        selectedProjectIds: patch.workActivity?.selectedProjectIds ?? this.workActivitySelectedProjectIds,
      },
    });
    this.recordLocalStateWrite(result);
    return result;
  },

  setDashboardProjectGroup(this: AppStore, groupKey: string) {
    const nextGroup = groupKey.trim() || "all";
    if (this.dashboardProjectGroup === nextGroup) return;
    this.dashboardProjectGroup = nextGroup;
    this.persistWorkspaceState();
  },

  async refreshProjectAvailability(this: AppStore) {
    await Promise.all(
      this.projects.map(async (project) => {
        const exists = await bridge.pathExists(project.path);
        project.pathExists = exists;
        project.unavailableReason = exists ? "" : "当前设备无法访问该路径";
        if (exists && project.status === ProjectStatus.WARNING) {
          project.status = ProjectStatus.STOPPED;
        }
        if (!exists) {
          project.status = ProjectStatus.WARNING;
          project.scripts.forEach((script) => {
            script.status = "IDLE";
            script.pid = undefined;
            script.runId = undefined;
            script.runtimeOwner = undefined;
          });
        }
      }),
    );
  },

  setLocale(this: AppStore, locale: Locale) {
    this.locale = locale;
  },

  setTheme(this: AppStore, theme: "light" | "dark" | "auto") {
    this.theme = theme;
  },

  setIconPackColorMode(this: AppStore, colorMode: IconPackColorMode) {
    this.iconPackColorMode = colorMode;
  },

  setSelectedProject(this: AppStore, id: string | null) {
    this.selectedProjectId = id;
    if (id) {
      this.activeTab = "projects";
    }
  },

  openProjectByName(this: AppStore, query: string) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return false;
    }

    const matchedProject =
      this.projects.find((project) => project.name.toLowerCase() === normalizedQuery) ||
      this.projects.find((project) => project.name.toLowerCase().includes(normalizedQuery));
    if (!matchedProject) {
      return false;
    }

    this.activeTab = "projects";
    if (matchedProject.pathExists === false) {
      this.openEditProjectForm(matchedProject.id);
    } else {
      this.selectedProjectId = matchedProject.id;
    }
    return true;
  },

  async refreshProjects(this: AppStore) {
    await this.reloadProjectsFromStorage();
    await this.refreshDashboardGitChangeCounts();
  },

  async moveProject(this: AppStore, projectId: string, direction: "top" | "up" | "down", scopeProjectIds?: string[]) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      return false;
    }

    const isUnavailable = project.pathExists === false;
    const isSameSection = (item: Project) => (isUnavailable ? item.pathExists === false : item.pathExists !== false);
    const sectionProjects = this.projects.filter(isSameSection);
    const sectionProjectIds = new Set(sectionProjects.map((item) => item.id));
    const scopedSectionProjects = (scopeProjectIds || [])
      .filter((id) => sectionProjectIds.has(id))
      .map((id) => sectionProjects.find((item) => item.id === id))
      .filter((item): item is Project => Boolean(item));
    const activeSectionProjects = scopedSectionProjects.length > 0 ? scopedSectionProjects : sectionProjects;
    const currentSectionIndex = activeSectionProjects.findIndex((item) => item.id === projectId);
    const targetSectionIndex =
      direction === "top" ? 0 : direction === "up" ? currentSectionIndex - 1 : currentSectionIndex + 1;

    if (
      currentSectionIndex < 0 ||
      currentSectionIndex === targetSectionIndex ||
      targetSectionIndex < 0 ||
      targetSectionIndex >= activeSectionProjects.length
    ) {
      return false;
    }

    const anchorProject = activeSectionProjects[targetSectionIndex];
    const reorderedSectionProjects = [...sectionProjects];
    const movedProjectIndex = reorderedSectionProjects.findIndex((item) => item.id === projectId);
    if (movedProjectIndex < 0) {
      return false;
    }

    const [movedProject] = reorderedSectionProjects.splice(movedProjectIndex, 1);
    const anchorIndex = reorderedSectionProjects.findIndex((item) => item.id === anchorProject.id);
    if (anchorIndex < 0) {
      return false;
    }

    reorderedSectionProjects.splice(direction === "down" ? anchorIndex + 1 : anchorIndex, 0, movedProject);
    let sectionIndex = 0;
    this.projects = this.projects.map((item) => {
      if (!isSameSection(item)) {
        return item;
      }

      const nextProject = reorderedSectionProjects[sectionIndex];
      sectionIndex += 1;
      return nextProject;
    });
    await this.persistProjects();
    return true;
  },

  async reorderProject(
    this: AppStore,
    projectId: string,
    targetProjectId: string,
    scopeProjectIds?: string[],
    position: "before" | "after" = "before",
  ) {
    if (projectId === targetProjectId) {
      return false;
    }

    const project = this.projects.find((item) => item.id === projectId);
    const targetProject = this.projects.find((item) => item.id === targetProjectId);
    if (!project || !targetProject) {
      return false;
    }

    const isUnavailable = project.pathExists === false;
    const isSameSection = (item: Project) => (isUnavailable ? item.pathExists === false : item.pathExists !== false);
    if (!isSameSection(targetProject)) {
      return false;
    }

    const sectionProjects = this.projects.filter(isSameSection);
    const sectionProjectIds = new Set(sectionProjects.map((item) => item.id));
    const scopedSectionProjects = (scopeProjectIds || [])
      .filter((id) => sectionProjectIds.has(id))
      .map((id) => sectionProjects.find((item) => item.id === id))
      .filter((item): item is Project => Boolean(item));
    const activeSectionProjects = scopedSectionProjects.length > 0 ? scopedSectionProjects : sectionProjects;
    if (!activeSectionProjects.some((item) => item.id === projectId)) {
      return false;
    }
    if (!activeSectionProjects.some((item) => item.id === targetProjectId)) {
      return false;
    }

    if (scopedSectionProjects.length > 0) {
      const reorderedScopedProjects = [...scopedSectionProjects];
      const currentScopedIndex = reorderedScopedProjects.findIndex((item) => item.id === projectId);
      const targetScopedIndex = reorderedScopedProjects.findIndex((item) => item.id === targetProjectId);
      if (currentScopedIndex < 0 || targetScopedIndex < 0) {
        return false;
      }

      const [movedProject] = reorderedScopedProjects.splice(currentScopedIndex, 1);
      const nextTargetScopedIndex = reorderedScopedProjects.findIndex((item) => item.id === targetProjectId);
      reorderedScopedProjects.splice(nextTargetScopedIndex + (position === "after" ? 1 : 0), 0, movedProject);

      const scopedProjectIds = new Set(reorderedScopedProjects.map((item) => item.id));
      let scopedIndex = 0;
      this.projects = this.projects.map((item) => {
        if (!isSameSection(item) || !scopedProjectIds.has(item.id)) {
          return item;
        }

        const nextProject = reorderedScopedProjects[scopedIndex];
        scopedIndex += 1;
        return nextProject;
      });
      await this.persistProjects();
      return true;
    }

    const reorderedSectionProjects = [...sectionProjects];
    const movedProjectIndex = reorderedSectionProjects.findIndex((item) => item.id === projectId);
    const targetIndex = reorderedSectionProjects.findIndex((item) => item.id === targetProjectId);
    if (movedProjectIndex < 0 || targetIndex < 0) {
      return false;
    }

    const [movedProject] = reorderedSectionProjects.splice(movedProjectIndex, 1);
    const nextTargetIndex = reorderedSectionProjects.findIndex((item) => item.id === targetProjectId);
    reorderedSectionProjects.splice(nextTargetIndex + (position === "after" ? 1 : 0), 0, movedProject);

    let sectionIndex = 0;
    this.projects = this.projects.map((item) => {
      if (!isSameSection(item)) {
        return item;
      }

      const nextProject = reorderedSectionProjects[sectionIndex];
      sectionIndex += 1;
      return nextProject;
    });
    await this.persistProjects();
    return true;
  },

  async refreshStorageOverview(this: AppStore) {
    this.dataToolsBusy = true;
    try {
      this.storageOverview = await bridge.getStorageOverview();
    } catch (error) {
      this.cleanupMessage = error instanceof Error ? error.message : "无法读取存储概览。";
    } finally {
      this.dataToolsBusy = false;
    }
  },

  async loadCleanupPlan(this: AppStore) {
    try {
      this.cleanupPlan = await bridge.getCleanupPlan();
    } catch (error) {
      this.cleanupPlan = null;
      this.cleanupMessage = error instanceof Error ? error.message : "无法读取清理计划。";
    }
  },

  async runCleanup(this: AppStore) {
    if (this.cleanupRunning || this.cleanupSelectedIds.length === 0) return null;
    this.cleanupRunning = true;
    this.cleanupMessage = "";
    this.cleanupResults = [];
    try {
      const result = await bridge.executeCleanup(this.cleanupSelectedIds);
      this.cleanupResults = result.results;
      this.cleanupMessage = result.ok
        ? "清理完成。"
        : result.partial
          ? "部分项目清理失败，详见逐项结果。"
          : "清理未执行成功，详见逐项结果。";
      await Promise.all([this.refreshStorageOverview(), this.loadCleanupPlan()]);
      return result;
    } catch (error) {
      this.cleanupMessage = error instanceof Error ? error.message : "清理执行失败。";
      return null;
    } finally {
      this.cleanupRunning = false;
    }
  },

  async retryStorageMigration(this: AppStore) {
    if (this.dataToolsBusy) return null;
    this.dataToolsBusy = true;
    this.cleanupMessage = "";
    try {
      const result = await bridge.runMigration({
        onProgress: (summary) => {
          this.migrationProgress = summary;
        },
      });
      this.migrationProgress = result.ledger;
      this.cleanupMessage = result.ok ? "迁移完成。" : result.message || "迁移失败，请重试。";
      if (result.ok) {
        await this.reloadProjectsFromStorage();
      }
      await this.refreshStorageOverview();
      return result;
    } catch (error) {
      this.cleanupMessage = error instanceof Error ? error.message : "迁移执行失败。";
      return null;
    } finally {
      this.dataToolsBusy = false;
    }
  },

  async openLocalDataDirectory(this: AppStore) {
    try {
      await bridge.openPluginLocalDataDirectory();
    } catch (error) {
      this.cleanupMessage = error instanceof Error ? error.message : "无法打开本地数据目录。";
    }
  },

  async openLegacyDataDirectory(this: AppStore) {
    try {
      await bridge.openLegacyDataDirectory();
    } catch (error) {
      this.cleanupMessage = error instanceof Error ? error.message : "无法打开旧数据目录。";
    }
  },
};
