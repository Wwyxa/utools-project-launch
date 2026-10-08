import type { WorkActivityPreferences, ProjectGitActivityCriteria, ProjectGitActivityOptions, ProjectGitActivityChangesOptions, ProjectGitActivityDayOptions, ProjectGitActivityDayReport } from "../../types";
import type { AppStore } from "../appStoreShape";
import { isProjectVisibleOnCurrentDevice } from "../helpers/projectHelpers";
import { bridge } from "../helpers/bridge";

export const defaultWorkActivityPreferences = (): WorkActivityPreferences => ({
  rangeMode: "rolling",
  selectedYear: new Date().getFullYear(),
  customStartDate: "",
  customEndDate: "",
  refScope: "all",
  timeZone: "local",
  hideMerges: false,
  excludeBots: false,
  botPatterns: ["\\[bot\\]$", "(^|[+._-])bot@"],
  identities: [],
  selectedAuthorId: "current",
  projectGroups: [],
});

export const workActivityGitCriteria = (preferences: WorkActivityPreferences): ProjectGitActivityCriteria => {
  const {
    rangeMode: _rangeMode,
    selectedYear: _selectedYear,
    customStartDate: _customStartDate,
    customEndDate: _customEndDate,
    selectedAuthorId: _selectedAuthorId,
    projectGroups: _projectGroups,
    ...criteria
  } = preferences;
  return criteria;
};

export const workActivityActions = {
  setActiveTab(this: AppStore, tab: "projects" | "settings" | "environment" | "activity") {
    this.activeTab = tab;
    this.selectedProjectId = null;
  },

  openWorkActivity(this: AppStore, projectId?: string) {
    const selectableProjectIds = this.workActivitySelectableProjects.map((project) => project.id);
    const selectableIds = new Set(selectableProjectIds);
    const visibleIds = new Set(this.availableProjects.map((project) => project.id));
    const selectedProjectIds = (
      this.workActivitySelectionInitialized ? this.workActivitySelectedProjectIds : selectableProjectIds
    ).filter((selectedProjectId) => selectableIds.has(selectedProjectId));
    const projectGroups = this.workActivityPreferences.projectGroups.map((group) => ({
      ...group,
      projectIds: group.projectIds.filter((groupProjectId) => visibleIds.has(groupProjectId)),
    }));
    this.workActivityPreferences.projectGroups = projectGroups;
    if (this.activeTab !== "activity") {
      this.workActivityReturnProjectId = this.selectedProjectId;
    }
    const focusProjectId = projectId && selectableIds.has(projectId) ? projectId : null;
    if (this.workActivityFocusProjectId !== focusProjectId) this.invalidateWorkActivity();
    this.workActivityFocusProjectId = focusProjectId;
    this.setWorkActivityProjectIds(selectedProjectIds);
    this.workActivityDayRequestGeneration += 1;
    this.activeTab = "activity";
    this.selectedProjectId = null;
  },

  returnFromWorkActivity(this: AppStore) {
    const returnProjectId = this.workActivityReturnProjectId;
    this.workActivityReturnProjectId = null;
    this.workActivityDayRequestGeneration += 1;
    this.activeTab = "projects";
    this.selectedProjectId = this.projects.some(
      (project) => project.id === returnProjectId && isProjectVisibleOnCurrentDevice(project),
    )
      ? returnProjectId
      : null;
  },

  setWorkActivityProjectIds(this: AppStore, projectIds: string[]) {
    const selectableIds = new Set(this.workActivitySelectableProjects.map((project) => project.id));
    const selectedIds = [...new Set(projectIds)].filter((projectId) => selectableIds.has(projectId));
    const selectionChanged =
      JSON.stringify([...selectedIds].sort()) !== JSON.stringify([...this.workActivitySelectedProjectIds].sort());
    this.workActivitySelectedProjectIds = selectedIds;
    this.workActivitySelectionInitialized = true;
    if (selectionChanged) this.invalidateWorkActivity();
  },

  saveWorkActivityProjectGroup(this: AppStore, name: string) {
    const normalizedName = name.trim().slice(0, 80);
    if (!normalizedName || this.workActivitySelectedProjectIds.length === 0) return false;
    const projectGroups = this.workActivityPreferences.projectGroups;
    const existing = projectGroups.find(
      (group) => group.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
    );
    const nextGroup = {
      id: existing?.id || `group-${Date.now()}`,
      name: normalizedName,
      projectIds: [...this.workActivitySelectedProjectIds],
    };
    this.setWorkActivityPreferences({
      projectGroups: existing
        ? projectGroups.map((group) => (group.id === existing.id ? nextGroup : group))
        : [...projectGroups, nextGroup],
    });
    return true;
  },

  applyWorkActivityProjectGroup(this: AppStore, groupId: string) {
    const group = this.workActivityPreferences.projectGroups.find((item) => item.id === groupId);
    if (!group) return false;
    this.workActivityFocusProjectId = null;
    this.setWorkActivityProjectIds(group.projectIds);
    return true;
  },

  clearWorkActivityProjectFocus(this: AppStore) {
    if (!this.workActivityFocusProjectId) return false;
    this.workActivityFocusProjectId = null;
    this.invalidateWorkActivity();
    return true;
  },

  renameWorkActivityProjectGroup(this: AppStore, groupId: string, name: string) {
    const normalizedName = name.trim().slice(0, 80);
    if (!normalizedName) return false;
    const projectGroups = this.workActivityPreferences.projectGroups;
    if (!projectGroups.some((group) => group.id === groupId)) return false;
    this.setWorkActivityPreferences({
      projectGroups: projectGroups.map((group) =>
        group.id === groupId ? { ...group, name: normalizedName } : group,
      ),
    });
    return true;
  },

  deleteWorkActivityProjectGroup(this: AppStore, groupId: string) {
    const projectGroups = this.workActivityPreferences.projectGroups;
    const nextGroups = projectGroups.filter((group) => group.id !== groupId);
    if (nextGroups.length === projectGroups.length) return false;
    this.setWorkActivityPreferences({ projectGroups: nextGroups });
    return true;
  },

  invalidateWorkActivity(this: AppStore) {
    this.workActivityReport = null;
    this.workActivityReportKey = "";
    this.workActivityReportExpiresAt = 0;
    this.workActivityPendingKey = "";
    this.workActivityLoading = false;
    this.workActivityMessage = "";
    this.workActivityLoadState = "idle";
    this.workActivityRequestGeneration += 1;
    this.workActivityDayRequestGeneration += 1;
  },

  setWorkActivityPreferences(this: AppStore, preferences: Partial<WorkActivityPreferences>) {
    const reportPreferenceKeys: (keyof WorkActivityPreferences)[] = [
      "rangeMode",
      "selectedYear",
      "customStartDate",
      "customEndDate",
      "refScope",
      "timeZone",
      "hideMerges",
      "excludeBots",
      "botPatterns",
      "identities",
    ];
    const nextPreferences = { ...this.workActivityPreferences, ...preferences };
    if (JSON.stringify(nextPreferences) === JSON.stringify(this.workActivityPreferences)) return;
    this.workActivityPreferences = nextPreferences;
    if (reportPreferenceKeys.some((key) => key in preferences)) this.invalidateWorkActivity();
  },

  async loadGitActivity(this: AppStore, options: ProjectGitActivityOptions) {
    const selectedProjects = this.workActivitySelectedProjects;
    const criteria = workActivityGitCriteria(this.workActivityPreferences);
    const requestOptions = { ...criteria, ...options };
    const { force: _force, ...cacheOptions } = requestOptions;
    const requestKey = JSON.stringify([selectedProjects.map((project) => project.path).sort(), cacheOptions]);
    if (!options.force) {
      if (this.workActivityLoading && this.workActivityPendingKey === requestKey) return;
      if (this.workActivityReportKey === requestKey && Date.now() < this.workActivityReportExpiresAt) {
        this.workActivityLoadState = "cached";
        return;
      }
    }
    const requestGeneration = ++this.workActivityRequestGeneration;
    if (this.workActivityReportKey !== requestKey) {
      this.workActivityReport = null;
      this.workActivityReportKey = "";
    }
    this.workActivityPendingKey = requestKey;
    this.workActivityLoading = true;
    this.workActivityMessage = "";
    this.workActivityLoadState = this.workActivityReport ? "refreshing" : "loading";
    if (selectedProjects.length === 0) {
      this.workActivityReport = {
        startDate: options.startDate,
        endDate: options.endDate,
        criteria: {
          refScope: requestOptions.refScope,
          timeZone: requestOptions.timeZone,
          hideMerges: requestOptions.hideMerges,
          excludeBots: requestOptions.excludeBots,
          botPatterns: requestOptions.botPatterns,
          identities: requestOptions.identities,
        },
        repositories: [],
        lastRefreshedAt: "",
      };
      this.workActivityLoading = false;
      this.workActivityPendingKey = "";
      this.workActivityLoadState = "idle";
      return;
    }

    try {
      const report = await bridge.readGitActivity(
        selectedProjects.map((project) => project.path),
        requestOptions,
      );
      if (requestGeneration !== this.workActivityRequestGeneration) return;

      this.workActivityReport = report;
      const unavailablePaths = new Set(
        report.repositories
          .filter((repository) => repository.state === "not-a-repository")
          .flatMap((repository) => repository.projectPaths),
      );
      const unavailableIds = new Set(this.workActivityUnavailableProjectIds);
      this.availableProjects.forEach((project) => {
        if (unavailablePaths.has(project.path)) unavailableIds.add(project.id);
      });
      this.workActivityUnavailableProjectIds = [...unavailableIds];
      const selectableIds = new Set(this.workActivitySelectableProjects.map((project) => project.id));
      this.workActivitySelectedProjectIds = this.workActivitySelectedProjectIds.filter((projectId) =>
        selectableIds.has(projectId),
      );
      this.workActivityReportKey = JSON.stringify([
        this.workActivitySelectedProjects.map((project) => project.path).sort(),
        cacheOptions,
      ]);
      const failedCount = report.repositories.filter((repository) => repository.state === "failed").length;
      this.workActivityReportExpiresAt = failedCount > 0 ? 0 : Date.now() + 5 * 60 * 1000;
      if (failedCount > 0) {
        this.workActivityMessage = `有 ${failedCount} 个 Git 仓库未能完成活动统计。`;
      }
      this.workActivityLoadState = failedCount > 0 ? "partial" : "ready";
    } catch (error) {
      if (requestGeneration !== this.workActivityRequestGeneration) return;
      this.workActivityReportExpiresAt = 0;
      this.workActivityMessage = error instanceof Error ? error.message : "读取 Git 活动记录失败。";
      this.workActivityLoadState = this.workActivityReport ? "stale" : "error";
    } finally {
      if (requestGeneration === this.workActivityRequestGeneration) {
        this.workActivityLoading = false;
        this.workActivityPendingKey = "";
      }
    }
  },

  async retryWorkActivityRepository(this: AppStore, repositoryPath: string, options: ProjectGitActivityOptions) {
    const failedRepository = this.workActivityReport?.repositories.find(
      (repository) =>
        repository.state === "failed" &&
        (repository.repositoryPath === repositoryPath ||
          (!repository.repositoryPath && repository.projectPaths.includes(repositoryPath))),
    );
    if (!failedRepository || this.workActivityRetryingRepositoryPaths.includes(repositoryPath)) return false;
    const requestGeneration = this.workActivityRequestGeneration;
    this.workActivityRetryingRepositoryPaths.push(repositoryPath);
    try {
      const criteria = workActivityGitCriteria(this.workActivityPreferences);
      const report = await bridge.readGitActivity(failedRepository.projectPaths, {
        ...criteria,
        ...options,
        force: true,
      });
      if (requestGeneration !== this.workActivityRequestGeneration || !this.workActivityReport) return false;
      const replacements = report.repositories;
      const replacement = replacements.find(
        (repository) =>
          repository.repositoryPath === repositoryPath ||
          repository.projectPaths.some((path) => failedRepository.projectPaths.includes(path)),
      );
      if (!replacement) return false;
      this.workActivityReport = {
        ...this.workActivityReport,
        repositories: this.workActivityReport.repositories.map((repository) =>
          repository === failedRepository ? replacement : repository,
        ),
        lastRefreshedAt:
          replacement.state === "failed" ? this.workActivityReport.lastRefreshedAt : report.lastRefreshedAt,
      };
      const failedCount = this.workActivityReport.repositories.filter(
        (repository) => repository.state === "failed",
      ).length;
      this.workActivityMessage = failedCount ? `有 ${failedCount} 个 Git 仓库未能完成活动统计。` : "";
      this.workActivityLoadState = failedCount ? "partial" : "ready";
      if (!failedCount) this.workActivityReportExpiresAt = Date.now() + 5 * 60 * 1000;
      return replacement.state !== "failed";
    } catch (error) {
      if (requestGeneration === this.workActivityRequestGeneration) {
        this.workActivityMessage = error instanceof Error ? error.message : "读取 Git 活动记录失败。";
        this.workActivityLoadState = "partial";
      }
      return false;
    } finally {
      this.workActivityRetryingRepositoryPaths = this.workActivityRetryingRepositoryPaths.filter(
        (path) => path !== repositoryPath,
      );
    }
  },

  async readGitActivityChanges(this: AppStore, options: ProjectGitActivityChangesOptions, projectPaths?: string[]) {
    const selectedPaths = projectPaths || this.workActivitySelectedProjects.map((project) => project.path);
    if (selectedPaths.length === 0) return null;
    const criteria = workActivityGitCriteria(this.workActivityPreferences);
    return bridge.readGitActivityChanges(selectedPaths, { ...criteria, ...options });
  },

  async readGitActivityDay(this: AppStore,
    options: ProjectGitActivityDayOptions,
    projectPaths?: string[],
  ): Promise<ProjectGitActivityDayReport | null> {
    const requestGeneration = ++this.workActivityDayRequestGeneration;
    const selectedPaths = projectPaths || this.workActivitySelectedProjects.map((project) => project.path);
    if (selectedPaths.length === 0) return null;

    const report = await bridge.readGitActivityDay(selectedPaths, {
      ...workActivityGitCriteria(this.workActivityPreferences),
      ...options,
    });
    return requestGeneration === this.workActivityDayRequestGeneration ? report : null;
  }
};
