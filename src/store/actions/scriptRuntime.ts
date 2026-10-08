import type { AppStore } from "../appStoreShape";
import { bridge } from "../helpers/bridge";
import { serviceOwnershipState } from "../helpers/serviceAutomationState";
import { deriveProjectStatus } from "../../lib/projectRuntimeState";
import { resolveScriptCwd } from "../helpers/projectHelpers";
import { rememberRuntimeRun, pendingRuntimeTerminalEventKey, pendingRuntimeTerminalEvents, scheduleProcessStop, clearPendingRuntimeTerminalEvents, createLogEntry } from "../helpers/automationHelpers";
import type { ProjectBridgeStopProcessOptions } from "../../types";

export let runtimeReconciliationPromise: Promise<void> | null = null;

export const scriptRuntimeActions = {
  reconcileRuntimeProcessState(this: AppStore) {
    if (runtimeReconciliationPromise) {
      return runtimeReconciliationPromise;
    }

    const reconciliation = async () => {
      const runningScripts = this.projects.flatMap((project) =>
        project.scripts
          .filter(
            (script) =>
              (script.status === "RUNNING" || script.status === "STOPPING") &&
              (script.pid || (script.runtimeOwner === "service" && script.runId)),
          )
          .map((script) => ({ project, script, pid: script.pid || 0 })),
      );
      let changed = false;

      const statuses = await Promise.all(
        runningScripts.map(async ({ project, script, pid }) => {
          try {
            return {
              project,
              script,
              pid,
              status: await bridge.getProcessStatus(pid, {
                runId: script.runId,
                runtimeOwner: script.runtimeOwner,
              }),
            };
          } catch (error) {
            return { project, script, pid, status: { active: true } };
          }
        }),
      );

      statuses.forEach(({ project, script, pid, status }) => {
        if (status.active) {
          return;
        }

        if (
          status.serviceState &&
          status.serviceState !== "healthy" &&
          script.runtimeOwner === "service" &&
          script.runId
        ) {
          if (this.projectLaunchServiceStatus) {
            this.projectLaunchServiceStatus = {
              ...this.projectLaunchServiceStatus,
              state: status.serviceState,
              running: false,
              message: status.error || this.projectLaunchServiceStatus.message,
            };
          }
          return;
        }

        changed = true;
        if (status.error) {
          this.handleBridgeEvent({
            type: "error",
            projectId: project.id,
            scriptId: script.id,
            pid,
            runId: script.runId,
            runtimeOwner: script.runtimeOwner,
            automationRunId: status.automationRunId,
            automationExitMatched: status.automationExitMatched,
            message: status.error,
          });
          return;
        }

        this.handleBridgeEvent({
          type: "exit",
          projectId: project.id,
          scriptId: script.id,
          pid,
          runId: script.runId,
          runtimeOwner: script.runtimeOwner,
          code: status.code ?? 0,
          signal: status.signal ?? null,
          stoppedByUser: Boolean(status.stoppedByUser || script.status === "STOPPING"),
          automationRunId: status.automationRunId,
          automationExitMatched: status.automationExitMatched,
        });
      });

      await Promise.resolve();
      if (await this.reconcileOrphanedAutomationRuns()) {
        changed = true;
      }
      if (changed) {
        this.scheduleAutomationTimer();
      }
    };

    const sharedPromise = reconciliation().finally(() => {
      if (runtimeReconciliationPromise === sharedPromise) {
        runtimeReconciliationPromise = null;
      }
    });
    runtimeReconciliationPromise = sharedPromise;
    return sharedPromise;
  },

  async launchScript(this: AppStore, projectId: string, scriptId: string, automationRunId?: string) {
    const project = this.projects.find((item) => item.id === projectId);
    const script = project?.scripts.find((item) => item.id === scriptId);
    if (
      serviceOwnershipState.handoff ||
      !project ||
      !script ||
      project.pathExists === false ||
      script.status === "RUNNING" ||
      script.status === "STOPPING" ||
      !script.command.trim()
    ) {
      return null;
    }

    script.status = "RUNNING";
    script.pid = undefined;
    project.status = deriveProjectStatus(project);
    project.lastUpdated = new Date().toLocaleString();

    try {
      const result = await bridge.runCommand({
        projectId,
        scriptId,
        command: script.command,
        cwd: resolveScriptCwd(project.path, script.cwd),
        env: project.env,
        label: `${project.name} / ${script.name}`,
        automationRunId,
      });

      const activeProject = this.projects.find((item) => item.id === projectId);
      const activeScript = activeProject?.scripts.find((item) => item.id === scriptId);
      if (!activeProject || !activeScript) return result;

      const stopRequestedBeforeResult = activeScript.status === "STOPPING";
      const hadRuntimeIdentity = Boolean(activeScript.runId && activeScript.runtimeOwner);
      if (activeScript.status === "RUNNING" || stopRequestedBeforeResult) {
        activeScript.pid = Number.isInteger(result.pid) && result.pid > 0 ? result.pid : undefined;
        activeScript.runId = result.runId;
        activeScript.runtimeOwner = result.runtimeOwner;
        if (result.runId) {
          rememberRuntimeRun(pendingRuntimeTerminalEventKey(projectId, scriptId, result.runId), "active");
        }
        activeProject.status = deriveProjectStatus(activeProject);
        activeProject.lastUpdated = new Date().toLocaleString();
        if (result.runId) {
          const pendingKey = pendingRuntimeTerminalEventKey(projectId, scriptId, result.runId);
          const pendingEvent = pendingRuntimeTerminalEvents.get(pendingKey);
          if (pendingEvent) {
            pendingRuntimeTerminalEvents.delete(pendingKey);
            this.handleBridgeEvent(pendingEvent);
          }
        }
        if (stopRequestedBeforeResult && !hadRuntimeIdentity) {
          const currentScript = activeProject.scripts.find((item) => item.id === scriptId);
          if (currentScript?.status === "STOPPING") {
            const pid = currentScript.pid;
            const runId = currentScript.runId;
            const runtimeOwner = currentScript.runtimeOwner;
            if (pid || (runtimeOwner === "service" && runId)) {
              scheduleProcessStop(pid || 0, {
                ...(runId === undefined ? {} : { runId }),
                ...(runtimeOwner === undefined ? {} : { runtimeOwner }),
              });
            } else {
              currentScript.status = "STOPPED";
              activeProject.status = deriveProjectStatus(activeProject);
              activeProject.lastUpdated = new Date().toLocaleString();
            }
          }
        }
      }
      return result;
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (this.projectLaunchServicePreferences.enabled && errorCode === "active_run_conflict") {
        try {
          const status = await bridge.reconcileProjectLaunchService();
          this.projectLaunchServiceStatus = status;
          this.reconcileProjectLaunchServiceRuntime(status);
          const recoveredScript = this.projects
            .find((item) => item.id === projectId)
            ?.scripts.find((item) => item.id === scriptId);
          if (recoveredScript?.runtimeOwner === "service" && recoveredScript.runId) {
            return null;
          }
          this.projectLaunchServiceStatus = {
            ...status,
            state: "unavailable",
            message: "项目启动服务存在活动运行，但当前窗口未能恢复其身份。",
          };
          clearPendingRuntimeTerminalEvents(projectId, scriptId);
          script.status = "ERROR";
          script.pid = undefined;
          script.runId = undefined;
          script.runtimeOwner = undefined;
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
          this.addLog(
            projectId,
            createLogEntry("项目启动服务存在活动运行，但当前窗口未能恢复其身份。", "ERROR"),
            scriptId,
          );
          return null;
        } catch (reconcileError) {
          const message = reconcileError instanceof Error ? reconcileError.message : "项目启动服务重连失败。";
          try {
            const status = await bridge.getProjectLaunchServiceStatus();
            this.projectLaunchServiceStatus = { ...status, state: "unavailable", message };
          } catch (statusError) {
            if (this.projectLaunchServiceStatus) {
              this.projectLaunchServiceStatus = {
                ...this.projectLaunchServiceStatus,
                state: "unavailable",
                message,
              };
            }
          }
          clearPendingRuntimeTerminalEvents(projectId, scriptId);
          script.status = "ERROR";
          script.pid = undefined;
          script.runId = undefined;
          script.runtimeOwner = undefined;
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
          this.addLog(projectId, createLogEntry(message, "ERROR"), scriptId);
          return null;
        }
      }
      clearPendingRuntimeTerminalEvents(projectId, scriptId);
      script.status = "ERROR";
      script.pid = undefined;
      script.runId = undefined;
      script.runtimeOwner = undefined;
      project.status = deriveProjectStatus(project);
      project.lastUpdated = new Date().toLocaleString();
      this.addLog(
        projectId,
        createLogEntry(error instanceof Error ? error.message : "command failed", "ERROR"),
        scriptId,
      );
      return null;
    }
  },

  async launchAllScripts(this: AppStore, projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) {
      return [];
    }

    const launchableScripts = project.scripts.filter(
      (script) => script.status !== "RUNNING" && script.status !== "STOPPING" && script.command.trim(),
    );
    const results = [];
    for (const script of launchableScripts) {
      const result = await this.launchScript(projectId, script.id);
      if (result) {
        results.push(result);
      }
    }
    return results;
  },

  async stopScript(this: AppStore, projectId: string, scriptId: string, stopOptions?: ProjectBridgeStopProcessOptions) {
    const project = this.projects.find((item) => item.id === projectId);
    const script = project?.scripts.find((item) => item.id === scriptId);
    if (!project || !script || script.status !== "RUNNING") {
      return;
    }

    const pid = script.pid;
    const hasServiceRunIdentity = script.runtimeOwner === "service" && Boolean(script.runId);
    const isServiceLaunchPending =
      this.projectLaunchServicePreferences.enabled && !script.runtimeOwner && !script.runId;
    this.addLog(projectId, createLogEntry(`[${script.name}] stop requested`, "WARN"), scriptId);
    script.status = pid || hasServiceRunIdentity || isServiceLaunchPending ? "STOPPING" : "STOPPED";
    project.status = deriveProjectStatus(project);
    project.lastUpdated = new Date().toLocaleString();
    void this.persistProjects();

    const runId = stopOptions?.runId || script.runId;
    const runtimeOwner = stopOptions?.runtimeOwner || script.runtimeOwner;
    if (pid || (runtimeOwner === "service" && runId)) {
      if (stopOptions || runId !== undefined || runtimeOwner !== undefined) {
        scheduleProcessStop(pid || 0, {
          ...stopOptions,
          ...(runId === undefined ? {} : { runId }),
          ...(runtimeOwner === undefined ? {} : { runtimeOwner }),
        });
      } else {
        scheduleProcessStop(pid || 0);
      }
    } else {
      this.addLog(projectId, createLogEntry(`[${script.name}] stopped`, "SUCCESS"), scriptId);
    }
  },

  stopRunningScriptsForPluginExit(this: AppStore) {
    this.projects.forEach((project) => {
      let projectUpdated = false;
      project.scripts.forEach((script) => {
        if (script.status !== "RUNNING" && script.status !== "STOPPING") {
          return;
        }

        if (script.pid || (script.runtimeOwner === "service" && script.runId)) {
          const pid = script.pid;
          scheduleProcessStop(pid || 0, {
            ...(script.runId === undefined ? {} : { runId: script.runId }),
            ...(script.runtimeOwner === undefined ? {} : { runtimeOwner: script.runtimeOwner }),
          });
          script.status = "STOPPING";
        } else {
          script.status = "STOPPED";
        }
        this.addLog(project.id, createLogEntry(`[${script.name}] stop requested`, "WARN"), script.id);
        projectUpdated = true;
      });

      if (projectUpdated) {
        project.status = deriveProjectStatus(project);
        project.lastUpdated = new Date().toLocaleString();
      }
    });
    void this.persistProjects();
  },

  async sendScriptInput(this: AppStore, projectId: string, scriptId: string, input: string) {
    const line = input;
    const project = this.projects.find((item) => item.id === projectId);
    const script = project?.scripts.find((item) => item.id === scriptId);
    const serviceRunWithoutPid = script?.runtimeOwner === "service" && Boolean(script.runId);
    if (!project || !script || script.status !== "RUNNING" || (!script.pid && !serviceRunWithoutPid)) {
      return { sent: false, message: "当前选中的脚本不可输入。" };
    }

    const result = await bridge.sendProcessInput(script.pid || 0, line, {
      runId: script.runId,
      runtimeOwner: script.runtimeOwner,
    });
    if (!result.sent) {
      this.addLog(projectId, createLogEntry(result.message || "输入发送失败。", "WARN"), scriptId);
    }
    return result;
  }
};
