import type { AppStore } from "../appStoreShape";
import type { ProjectFormValue, Project, ProjectScript } from "../../types";
import { createProjectId, envFromEntries, scriptFromForm, hydrateProject, currentDeviceId, normalizeTinyCardButtonCount, normalizeProjectGroup, createBlankProjectForm, isProjectVisibleOnCurrentDevice } from "../helpers/projectHelpers";
import { bridge } from "../helpers/bridge";
import { mergeScriptRuntimeState, deriveProjectStatus } from "../../lib/projectRuntimeState";
import { normalizeProjectRelations } from "../../lib/projectRelations";
import { ProjectStatus } from "../../types";
import { clearGitRepositoryCoordination, clearGitRepositoryRecord, gitWorkspaceRefreshPromises, gitWorkspaceRefreshTokens } from "../helpers/gitHelpers";

export const projectCrudActions = {
  async saveProjectForm(this: AppStore) {
    const current = this.projectFormDraft;
    const payload: ProjectFormValue = {
      ...current,
      envEntries: current.envEntries.filter((entry) => entry.key.trim()),
    };
    const projectId = payload.id || createProjectId();
    const now = new Date().toISOString();
    const env = envFromEntries(payload.envEntries);
    const formScripts = payload.scripts
      .filter((script) => script.name.trim() && script.command.trim())
      .map((script, index) => scriptFromForm(projectId, script, index));
    if (formScripts.length === 0) {
      this.projectFormInspectionMessage = "请至少填写一个可运行脚本。";
      return null;
    }
    const existingProject = this.projects.find((item) => item.id === projectId);
    const projectPathChanged = Boolean(existingProject && existingProject.path !== payload.path.trim());
    const pathExists = await bridge.pathExists(payload.path);
    const scripts = pathExists ? mergeScriptRuntimeState(formScripts, existingProject?.scripts || []) : formScripts;
    const relatedProjects = normalizeProjectRelations(payload.relatedProjects).filter(
      (relation) =>
        relation.projectId !== projectId && this.projects.some((project) => project.id === relation.projectId),
    );
    const project: Project = hydrateProject({
      id: projectId,
      name: payload.name.trim(),
      path: payload.path.trim(),
      visibility: payload.visibility,
      ownerDeviceId:
        payload.visibility === "private" ? currentDeviceId : existingProject?.ownerDeviceId || currentDeviceId,
      type: payload.type,
      kind: payload.kind,
      icon: payload.icon,
      cardStyle: payload.cardStyle,
      tinyCardButtonCount: normalizeTinyCardButtonCount(payload.tinyCardButtonCount),
      quickLink: payload.quickLink.trim(),
      group: normalizeProjectGroup(payload.group),
      description: payload.description,
      relatedProjects,
      status:
        this.projectFormMode === "edit"
          ? pathExists
            ? existingProject?.status === ProjectStatus.RUNNING
              ? ProjectStatus.RUNNING
              : ProjectStatus.STOPPED
            : ProjectStatus.WARNING
          : pathExists
            ? ProjectStatus.STOPPED
            : ProjectStatus.WARNING,
      lastUpdated: new Date().toLocaleString(),
      scripts,
      automationTasks: existingProject?.automationTasks || [],
      env,
      memo: payload.memo,
      todos: this.todos[projectId] || existingProject?.todos || [],
      git: projectPathChanged ? null : existingProject?.git || null,
      gitLatestCommitAt: projectPathChanged ? "" : existingProject?.gitLatestCommitAt || "",
      pathExists,
      unavailableReason: pathExists ? "" : "当前设备无法访问该路径",
      createdAt: existingProject?.createdAt || now,
      updatedAt: now,
    });
    project.status = deriveProjectStatus(project);

    if (existingProject && existingProject.path !== project.path) {
      this.invalidateWorkActivity();
      this.workActivityUnavailableProjectIds = this.workActivityUnavailableProjectIds.filter(
        (unavailableProjectId) => unavailableProjectId !== projectId,
      );
      clearGitRepositoryCoordination(projectId);
      clearGitRepositoryRecord(this.gitRepositorySnapshots, projectId);
      clearGitRepositoryRecord(this.gitRepositoryRefreshing, projectId);
      clearGitRepositoryRecord(this.gitRepositoryStatusRefreshing, projectId);
      clearGitRepositoryRecord(this.gitRepositoryReadFailures, projectId);
      clearGitRepositoryRecord(this.gitRepositoryLoadingMore, projectId);
      delete this.gitRefreshing[projectId];
      delete this.gitStatusRefreshing[projectId];
      delete this.gitWritesInProgress[projectId];
      this.stagedFiles[projectId] = [];
      delete this.gitWorkspaces[projectId];
      delete this.gitWorkspaceRefreshing[projectId];
      gitWorkspaceRefreshPromises.delete(projectId);
      gitWorkspaceRefreshTokens.delete(projectId);
    }

    const existingIndex = this.projects.findIndex((item) => item.id === projectId);
    if (existingIndex >= 0) {
      this.projects.splice(existingIndex, 1, project);
    } else {
      this.projects.unshift(project);
      this.logs[projectId] = [];
      this.scriptLogs[projectId] = {};
      this.stagedFiles[projectId] = [];
      this.todos[projectId] = [];
    }

    this.memoContent[projectId] = payload.memo;
    this.selectedProjectId = projectId;
    this.projectFormOpen = false;
    this.projectFormDraft = createBlankProjectForm();
    await this.persistProjects();
    return projectId;
  },

  async deleteProject(this: AppStore, projectId: string) {
    const existingIndex = this.projects.findIndex((item) => item.id === projectId);
    if (existingIndex < 0) {
      return false;
    }

    this.projects.splice(existingIndex, 1);
    this.projects.forEach((project) => {
      if (project.relatedProjects?.some((relation) => relation.projectId === projectId)) {
        project.relatedProjects = project.relatedProjects.filter((relation) => relation.projectId !== projectId);
      }
    });
    delete this.logs[projectId];
    delete this.scriptLogs[projectId];
    delete this.stagedFiles[projectId];
    delete this.todos[projectId];
    delete this.memoContent[projectId];
    delete this.automationActiveProjectRuns[projectId];
    this.workActivitySelectedProjectIds = this.workActivitySelectedProjectIds.filter(
      (selectedProjectId) => selectedProjectId !== projectId,
    );
    this.workActivityPreferences.projectGroups = this.workActivityPreferences.projectGroups.map((group) => ({
      ...group,
      projectIds: group.projectIds.filter((groupProjectId) => groupProjectId !== projectId),
    }));
    this.invalidateWorkActivity();
    this.workActivityUnavailableProjectIds = this.workActivityUnavailableProjectIds.filter(
      (unavailableProjectId) => unavailableProjectId !== projectId,
    );
    delete this.gitWorkspaces[projectId];
    delete this.gitWorkspaceRefreshing[projectId];
    clearGitRepositoryCoordination(projectId);
    clearGitRepositoryRecord(this.gitRepositorySnapshots, projectId);
    clearGitRepositoryRecord(this.gitRepositoryRefreshing, projectId);
    clearGitRepositoryRecord(this.gitRepositoryStatusRefreshing, projectId);
    clearGitRepositoryRecord(this.gitRepositoryReadFailures, projectId);
    clearGitRepositoryRecord(this.gitRepositoryLoadingMore, projectId);
    delete this.gitRefreshing[projectId];
    delete this.gitStatusRefreshing[projectId];
    delete this.gitWritesInProgress[projectId];
    gitWorkspaceRefreshPromises.delete(projectId);
    gitWorkspaceRefreshTokens.delete(projectId);

    if (this.selectedProjectId === projectId) {
      this.selectedProjectId = null;
      this.activeTab = "projects";
    }

    if (this.projectFormDraft.id === projectId) {
      this.closeProjectForm();
    }

    this.scheduleAutomationTimer();
    await this.persistProjects(true, [projectId]);
    return true;
  },

  requestDeleteProject(this: AppStore, projectId: string) {
    if (this.projects.some((item) => item.id === projectId)) {
      this.pendingDeleteProjectId = projectId;
    }
  },

  cancelDeleteProject(this: AppStore) {
    this.pendingDeleteProjectId = null;
  },

  async confirmDeleteProject(this: AppStore) {
    const projectId = this.pendingDeleteProjectId;
    if (!projectId) {
      return false;
    }

    this.pendingDeleteProjectId = null;
    return this.deleteProject(projectId);
  },

  async refreshProjectScripts(this: AppStore, projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) {
      return;
    }

    const result = await bridge.readPackageScripts(project.path);
    if (result.scripts.length > 0) {
      const previousScripts = project.scripts;
      const previousScriptsByName = new Map<string, ProjectScript>(
        previousScripts.map((script) => [script.name, script]),
      );
      const refreshedScripts: ProjectScript[] = result.scripts.map((script, index) => ({
        id: previousScriptsByName.get(script.name)?.id || `${project.id}-package-${index + 1}`,
        name: script.name,
        command: script.command,
        status: "IDLE",
        cwd: script.cwd || ".",
        note: script.note || (result.packagePath ? `package.json: ${result.packagePath}` : ""),
        source: script.source || "package-json",
      }));
      project.scripts = mergeScriptRuntimeState(refreshedScripts, previousScripts);
      project.status = deriveProjectStatus(project);
      await this.persistProjects();
    }
  },

  async refreshDashboardGitChangeCounts(this: AppStore) {
    await Promise.all(
      this.projects
        .filter((project) => isProjectVisibleOnCurrentDevice(project) && project.pathExists !== false)
        .map((project) => this.refreshGitWorkingTreeSnapshot(project.id)),
    );
  }
};
