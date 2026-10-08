import type { AppStore } from "../appStoreShape";
import { bridge } from "../helpers/bridge";
import type { ProjectGitRepositoryTarget, ExternalApplication } from "../../types";
import { createLogEntry } from "../helpers/automationHelpers";
import { showActionStatus } from "../../components/common/actionStatus";
import { launchMessage, resolvedExternalApplicationName } from "../helpers/projectHelpers";

export const projectOpenersActions = {
  async openProjectFolder(this: AppStore, projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) {
      return;
    }

    await bridge.showItemInFolder(project.path);
  },

  async showGitRepositoryInFolder(this: AppStore, projectId: string, target: ProjectGitRepositoryTarget) {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (
      !context ||
      !(await bridge.pathExists(context.repositoryPath)) ||
      this.resolveGitRepositoryContext(projectId, context.target)?.contextKey !== context.contextKey
    ) {
      this.addLog(projectId, createLogEntry("Git repository path is unavailable.", "WARN"));
      return;
    }
    await bridge.showItemInFolder(context.repositoryPath);
  },

  async openGitRepositoryInTerminal(this: AppStore, projectId: string, target: ProjectGitRepositoryTarget) {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (
      !context ||
      !(await bridge.pathExists(context.repositoryPath)) ||
      this.resolveGitRepositoryContext(projectId, context.target)?.contextKey !== context.contextKey
    ) {
      this.addLog(projectId, createLogEntry("Git repository path is unavailable.", "WARN"));
      return;
    }
    const terminalPreferences = { ...this.terminalPreferences };
    try {
      const result = await bridge.openTerminal({
        projectPath: context.repositoryPath,
        terminal: terminalPreferences,
      });
      this.addLog(
        projectId,
        createLogEntry(
          result.launched
            ? `Open Git terminal (${result.kind}): ${result.command}`
            : `Failed to open Git terminal (${result.kind}): ${result.message || "unknown error"}`,
          result.launched ? "INFO" : "ERROR",
        ),
      );
      showActionStatus({
        state: result.launched ? "success" : "error",
        message: launchMessage(this.locale, result.code, result.kind),
      });
    } catch (error) {
      this.addLog(
        projectId,
        createLogEntry(
          `Failed to open Git terminal (${terminalPreferences.kind}): ${error instanceof Error ? error.message : String(error)}`,
          "ERROR",
        ),
      );
    }
  },

  async openGitRepositoryInEditor(this: AppStore, projectId: string, target: ProjectGitRepositoryTarget, applicationId?: string) {
    const context = this.resolveGitRepositoryContext(projectId, target);
    if (
      !context ||
      !(await bridge.pathExists(context.repositoryPath)) ||
      this.resolveGitRepositoryContext(projectId, context.target)?.contextKey !== context.contextKey
    ) {
      this.addLog(projectId, createLogEntry("Git repository path is unavailable.", "WARN"));
      return;
    }
    const selectedApplicationId = applicationId || this.externalApplicationPreferences.defaultApplicationId;
    const selectedApplication = this.externalApplicationPreferences.applications.find(
      (application) => application.id === selectedApplicationId && application.enabled,
    );
    if (!selectedApplication) {
      this.addLog(projectId, createLogEntry("External application is unavailable.", "ERROR"));
      showActionStatus({
        state: "error",
        message: launchMessage(this.locale, "application-unavailable", "editor"),
      });
      return;
    }
    const application = { ...selectedApplication } satisfies ExternalApplication;
    try {
      const result = await bridge.openExternalApplication({
        projectPath: context.repositoryPath,
        application,
      });
      this.addLog(
        projectId,
        createLogEntry(
          result.launched
            ? `Open Git repository with ${application.name}: ${result.command}`
            : `Failed to open Git repository with ${application.name}: ${result.message || "unknown error"}`,
          result.launched ? "INFO" : "ERROR",
        ),
      );
      showActionStatus({
        state: result.launched ? "success" : "error",
        message: launchMessage(
          this.locale,
          result.code,
          resolvedExternalApplicationName(
            this.externalApplicationPreferences.applications,
            result.resolvedApplicationId,
            application.name,
          ),
        ),
      });
    } catch (error) {
      this.addLog(
        projectId,
        createLogEntry(
          `Failed to open Git repository with ${application.name}: ${error instanceof Error ? error.message : String(error)}`,
          "ERROR",
        ),
      );
    }
  },

  async openProjectInTerminal(this: AppStore, projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) {
      return;
    }
    const terminalPreferences = { ...this.terminalPreferences };
    showActionStatus({
      state: "loading",
      message: this.locale === "zh-CN" ? "正在打开终端..." : "Opening terminal...",
    });

    try {
      const result = await bridge.openTerminal({
        projectPath: project.path,
        terminal: terminalPreferences,
      });

      project.lastUpdated = new Date().toLocaleString();

      if (result.launched) {
        this.addLog(projectId, createLogEntry(`Open terminal (${result.kind}): ${result.command}`, "INFO"));
        showActionStatus({ state: "success", message: launchMessage(this.locale, result.code, result.kind) });
        return;
      }

      this.addLog(
        projectId,
        createLogEntry(`Failed to open terminal (${result.kind}): ${result.message || "unknown error"}`, "ERROR"),
      );
      showActionStatus({ state: "error", message: launchMessage(this.locale, result.code, result.kind) });
    } catch (error) {
      project.lastUpdated = new Date().toLocaleString();
      this.addLog(
        projectId,
        createLogEntry(
          `Failed to open terminal (${terminalPreferences.kind}): ${error instanceof Error ? error.message : String(error)}`,
          "ERROR",
        ),
      );
    }
  },

  async openProjectInEditor(this: AppStore, projectId: string, applicationId?: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) {
      return;
    }
    const selectedApplicationId = applicationId || this.externalApplicationPreferences.defaultApplicationId;
    const selectedApplication = this.externalApplicationPreferences.applications.find(
      (application) => application.id === selectedApplicationId && application.enabled,
    );
    if (!selectedApplication) {
      this.addLog(projectId, createLogEntry("External application is unavailable.", "ERROR"));
      showActionStatus({
        state: "error",
        message: launchMessage(this.locale, "application-unavailable", "editor"),
      });
      return;
    }
    const application = { ...selectedApplication } satisfies ExternalApplication;
    try {
      showActionStatus({
        state: "loading",
        message: this.locale === "zh-CN" ? "正在打开编辑器..." : "Opening editor...",
      });
      const result = await bridge.openExternalApplication({
        projectPath: project.path,
        application,
      });
      project.lastUpdated = new Date().toLocaleString();
      if (result.launched) {
        this.addLog(projectId, createLogEntry(`Open with ${application.name}: ${result.command}`, "INFO"));
        showActionStatus({
          state: "success",
          message: launchMessage(
            this.locale,
            result.code,
            resolvedExternalApplicationName(
              this.externalApplicationPreferences.applications,
              result.resolvedApplicationId,
              application.name,
            ),
          ),
        });
        return;
      }
      this.addLog(
        projectId,
        createLogEntry(`Failed to open with ${application.name}: ${result.message || "unknown error"}`, "ERROR"),
      );
      showActionStatus({
        state: "error",
        message: launchMessage(this.locale, result.code, application.name),
      });
    } catch (error) {
      project.lastUpdated = new Date().toLocaleString();
      this.addLog(
        projectId,
        createLogEntry(
          `Failed to open with ${application.name}: ${error instanceof Error ? error.message : String(error)}`,
          "ERROR",
        ),
      );
    }
  },

  async openProjectQuickLink(this: AppStore, projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    const quickLink = project?.quickLink?.trim();
    if (!project || !quickLink) {
      return;
    }

    try {
      await bridge.openPath(quickLink);
    } catch (error) {
      this.addLog(
        projectId,
        createLogEntry(
          `Failed to open quick link: ${error instanceof Error ? error.message : String(error)}`,
          "WARN",
        ),
      );
    }
  }
};
