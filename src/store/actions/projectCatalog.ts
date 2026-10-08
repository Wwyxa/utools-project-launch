import type { AppStore } from "../appStoreShape";
import { bridge } from "../helpers/bridge";
import type { Project, Locale, IconPackColorMode, ProjectConfigFile } from "../../types";
import { hydrateProject, isProjectVisibleOnCurrentDevice, setProjectCatalogStorageSnapshot, toPersistedProject, cloneProjectCatalogSnapshot, projectCatalogStorageSnapshot, isImportableProject, createProjectId } from "../helpers/projectHelpers";
import { mergeScriptRuntimeState, deriveProjectStatus } from "../../lib/projectRuntimeState";
import { waitForInitialPaint } from "../helpers/automationHelpers";
import { ProjectStatus } from "../../types";

export let projectCatalogReloadPromise: Promise<void> | null = null;

export let projectCatalogReloadQueued = false;

export const projectCatalogActions = {
  initializeProjectSessionState(this: AppStore) {
    this.projects.forEach((project) => {
      this.memoContent[project.id] = project.memo || this.memoContent[project.id] || "";
      this.todos[project.id] = project.todos || this.todos[project.id] || [];
      this.logs[project.id] = this.logs[project.id] || [];
      this.scriptLogs[project.id] = this.scriptLogs[project.id] || {};
      this.stagedFiles[project.id] = project.git?.files || this.stagedFiles[project.id] || [];
    });
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
            git: previousProject.git || nextProject.git,
            gitLatestCommitAt: nextProject.gitLatestCommitAt || previousProject.gitLatestCommitAt,
            pathExists: previousProject.pathExists,
            unavailableReason: previousProject.unavailableReason,
          };
          return { ...mergedProject, status: deriveProjectStatus(mergedProject) };
        });
        this.selectedProjectId = this.projects.some(
          (project) => project.id === this.selectedProjectId && isProjectVisibleOnCurrentDevice(project),
        )
          ? this.selectedProjectId
          : null;
      }

      setProjectCatalogStorageSnapshot(storedProjects);
      this.projectsLoaded = true;
      this.initializeProjectSessionState();
      this.reconcileProjectLaunchServiceRuntime(this.projectLaunchServiceStatus);
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
        this.selectedProjectId = this.projects.some(
          (project) => project.id === this.selectedProjectId && isProjectVisibleOnCurrentDevice(project),
        )
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
    this.initializeProjectSessionState();
    markStartupPhase?.("projects-load-state-setup-complete");

    const projectLaunchServiceStatusLoad = this.projectLaunchServicePreferences.enabled
      ? bridge.reconcileProjectLaunchService()
      : bridge.getProjectLaunchServiceStatus();

    await waitForInitialPaint();
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

  async refreshProjectAvailability(this: AppStore) {
    await Promise.all(
      this.projects.map(async (project) => {
        if (!isProjectVisibleOnCurrentDevice(project)) {
          return;
        }
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
      this.projects.find(
        (project) => isProjectVisibleOnCurrentDevice(project) && project.name.toLowerCase() === normalizedQuery,
      ) ||
      this.projects.find(
        (project) => isProjectVisibleOnCurrentDevice(project) && project.name.toLowerCase().includes(normalizedQuery),
      );
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
    const isSameSection = (item: Project) =>
      isProjectVisibleOnCurrentDevice(item) &&
      (isUnavailable ? item.pathExists === false : item.pathExists !== false);
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

  async reorderProject(this: AppStore,
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
    if (!project || !targetProject || !isProjectVisibleOnCurrentDevice(project)) {
      return false;
    }

    const isUnavailable = project.pathExists === false;
    const isSameSection = (item: Project) =>
      isProjectVisibleOnCurrentDevice(item) &&
      (isUnavailable ? item.pathExists === false : item.pathExists !== false);
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

  async exportProjectConfig(this: AppStore) {
    const config: ProjectConfigFile = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      projects: this.projects.map((project, index) => toPersistedProject(project, index)),
    };
    const result = await bridge.exportProjects(config);
    this.setProjectConfigMessage(
      result.canceled ? "已取消导出" : result.path ? `已导出到 ${result.path}` : "已导出项目配置",
    );
  },

  async importProjectConfig(this: AppStore) {
    const result = await bridge.importProjects();
    if (result.canceled || !result.config) {
      this.setProjectConfigMessage(result.message || "已取消导入");
      return;
    }

    const existingKeys = new Set(
      this.projects.map((project) => `${project.path.toLowerCase()}::${project.name.toLowerCase()}`),
    );
    if (result.config.schemaVersion !== 1 || !Array.isArray(result.config.projects)) {
      this.setProjectConfigMessage("配置文件格式不受支持");
      return;
    }

    const incoming = result.config.projects
      .filter(isImportableProject)
      .map((project, index) => hydrateProject(toPersistedProject(project, index)));
    const accepted: Project[] = [];
    let skipped = result.config.projects.length - incoming.length;

    incoming.forEach((project) => {
      const key = `${project.path.toLowerCase()}::${project.name.toLowerCase()}`;
      if (this.projects.some((item) => item.id === project.id) || existingKeys.has(key)) {
        skipped += 1;
        return;
      }
      existingKeys.add(key);
      accepted.push({ ...project, id: project.id || createProjectId() });
    });

    this.projects = [...accepted, ...this.projects];
    await this.refreshProjectAvailability();
    this.recomputeAutomationPlans();
    await this.persistProjects();
    this.setProjectConfigMessage(`已导入 ${accepted.length} 个项目，跳过 ${skipped} 个重复项目`);
  }
};
