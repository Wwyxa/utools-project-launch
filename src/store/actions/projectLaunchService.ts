import type { ProjectLaunchServiceAutomationExecutionStatus, ProjectLaunchServiceAutomationExecution, ProjectAutomationHistoryEntry, ProjectLaunchServiceStatus, ProjectBridgeEvent, ProjectBridgeProcessEvent, ProjectLaunchServiceLogRetentionPolicy, ProjectLaunchServiceLogDescriptor, ProjectLaunchServiceLogClearScope, ProjectLaunchServiceLogClearResult } from "../../types";
import type { AppStore } from "../appStoreShape";
import { bridge } from "../helpers/bridge";
import { deriveProjectStatus } from "../../lib/projectRuntimeState";
import { rememberRuntimeRun, pendingRuntimeTerminalEventKey, normalizeAutomationHistory, hasObservedServiceEvent, retainedRunLogEntries, clearAutomationSchedulerTimer } from "../helpers/automationHelpers";
import { serviceAutomationSubmissions, releaseServiceAutomationSubmission, notifyAutomationTaskCompletion, buildProjectLaunchServiceAutomationConfig, serviceOwnershipState } from "../helpers/serviceAutomationState";

export let projectLaunchServiceAutomationRevision = 0;

export let projectLaunchServiceAutomationSyncPromise: Promise<void> | null = null;

export let serviceAutomationExecutionStatuses: Map<string, ProjectLaunchServiceAutomationExecutionStatus> | null = null;

export const projectLaunchServiceActions = {
  async loadProjectLaunchServiceAutomationHistory(this: AppStore, projectId: string, taskId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || !this.projectLaunchServicePreferences.enabled) {
      return [];
    }
    const executions = await bridge.listProjectLaunchServiceAutomationExecutions(projectId, taskId);
    return executions
      .filter((execution) => execution.status !== "running")
      .map(
        (execution: ProjectLaunchServiceAutomationExecution): ProjectAutomationHistoryEntry => ({
          id: execution.id,
          taskId,
          taskName: project.automationTasks?.find((task) => task.id === taskId)?.name || taskId,
          projectId,
          projectName: project.name,
          plannedAt: execution.plannedAt || execution.startedAt || execution.endedAt || "",
          startedAt: execution.startedAt,
          endedAt: execution.endedAt,
          status:
            execution.status === "failed" || execution.status === "skipped" || execution.status === "missed"
              ? execution.status
              : "completed",
          reason: execution.reason || undefined,
          scriptResults: execution.scriptResults.map((result) => ({
            ...result,
            scriptName: project.scripts.find((script) => script.id === result.scriptId)?.name || result.scriptId,
          })),
        }),
      );
  },

  reconcileProjectLaunchServiceRuntime(this: AppStore, status: ProjectLaunchServiceStatus | null) {
    if (!this.projectLaunchServicePreferences.enabled) {
      serviceAutomationExecutionStatuses = null;
      for (const project of this.projects) {
        let clearedServiceRuntime = false;
        for (const script of project.scripts) {
          if (script.runtimeOwner !== "service") {
            continue;
          }
          script.status = "ERROR";
          script.pid = undefined;
          script.runId = undefined;
          script.runtimeOwner = undefined;
          clearedServiceRuntime = true;
        }
        if (clearedServiceRuntime) {
          project.status = deriveProjectStatus(project);
          project.lastUpdated = new Date().toLocaleString();
        }
      }
      return;
    }
    if (status?.state !== "healthy" || !status.running) {
      return;
    }

    const latestRuns = new Map<string, NonNullable<ProjectLaunchServiceStatus["runs"]>[number]>();
    const activeServiceRunIds = new Map<string, string>();
    const serviceScriptsAwaitingStart = new Set<string>();
    const lostServiceRunIds = new Set<string>();
    const currentServiceRunIds = new Map<string, string>();
    const replayableServiceEventRunIds = new Set(
      (status.events || [])
        .filter((event) => event.type !== "started" && Boolean(event.runId))
        .map((event) => event.runId),
    );
    for (const project of this.projects) {
      for (const script of project.scripts) {
        if (script.runtimeOwner === "service" && script.runId) {
          currentServiceRunIds.set(`${project.id}\u0000${script.id}`, script.runId);
        }
      }
    }
    for (const run of status.runs || []) {
      if (!run.projectId || !run.scriptId || !run.id) {
        continue;
      }
      const key = `${run.projectId}\u0000${run.scriptId}`;
      const previous = latestRuns.get(key);
      if (!previous || new Date(run.startedAt).getTime() >= new Date(previous.startedAt).getTime()) {
        latestRuns.set(key, run);
      }
      if (run.status === "lost") {
        lostServiceRunIds.add(run.id);
      }
    }

    for (const run of latestRuns.values()) {
      const project = this.projects.find((item) => item.id === run.projectId);
      const script = project?.scripts.find((item) => item.id === run.scriptId);
      if (!project || !script) {
        continue;
      }

      const scriptKey = `${run.projectId}\u0000${run.scriptId}`;
      const isActiveServiceRun = run.status === "starting" || run.status === "running" || run.status === "stopping";
      const replayingTerminalRun =
        !isActiveServiceRun &&
        run.status !== "lost" &&
        currentServiceRunIds.get(scriptKey) === run.id &&
        (replayableServiceEventRunIds.has(run.id) || status.eventsHasMore === true);
      rememberRuntimeRun(
        pendingRuntimeTerminalEventKey(run.projectId, run.scriptId, run.id),
        isActiveServiceRun || replayingTerminalRun ? "active" : "terminal",
      );
      if (isActiveServiceRun || replayingTerminalRun) {
        activeServiceRunIds.set(scriptKey, run.id);
        if (isActiveServiceRun) {
          const pid = run.pid;
          script.status = run.status === "stopping" ? "STOPPING" : "RUNNING";
          script.pid = typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined;
          script.runId = run.id;
          script.runtimeOwner = "service";
        }
      } else {
        script.status =
          run.status === "failed" ? "ERROR" : run.status === "stopped" || run.status === "lost" ? "STOPPED" : "IDLE";
        script.pid = undefined;
        script.runId = undefined;
        script.runtimeOwner = undefined;
      }
      project.status = deriveProjectStatus(project);
      project.lastUpdated = new Date().toLocaleString();
    }

    const serviceActiveAutomationRuns: Record<string, string> = {};
    const serviceExecutions = status.automation?.executions;
    const nextServiceAutomationExecutionStatuses = new Map<string, ProjectLaunchServiceAutomationExecutionStatus>();
    for (const execution of serviceExecutions || []) {
      if (!execution.id || !execution.projectId || !execution.taskId || !execution.planEntryId) {
        continue;
      }
      const submission = serviceAutomationSubmissions.get(execution.projectId);
      if (submission?.taskId === execution.taskId && submission.entryId === execution.planEntryId) {
        releaseServiceAutomationSubmission(execution.projectId);
      }
      const previousExecutionStatus = serviceAutomationExecutionStatuses?.get(execution.id);
      nextServiceAutomationExecutionStatuses.set(execution.id, execution.status);
      if (execution.status === "running") {
        serviceActiveAutomationRuns[execution.projectId] = execution.id;
      }
      const project = this.projects.find((item) => item.id === execution.projectId);
      const task = project?.automationTasks?.find((item) => item.id === execution.taskId);
      const entry = task?.dailyPlans
        .flatMap((plan) => plan.entries)
        .find((item) => item.id === execution.planEntryId);
      if (!project || !task) {
        continue;
      }

      if (entry) {
        entry.status = execution.status;
        entry.runId = execution.id;
        entry.reason = execution.reason || undefined;
      }
      if (execution.status === "running") {
        this.automationActiveProjectRuns[project.id] = execution.id;
        continue;
      }

      if (this.automationActiveProjectRuns[project.id] === execution.id) {
        delete this.automationActiveProjectRuns[project.id];
      }
      const plannedAt = execution.plannedAt || entry?.plannedAt;
      if (!plannedAt) {
        continue;
      }
      const historyEntry: ProjectAutomationHistoryEntry = {
        id: execution.id,
        taskId: task.id,
        taskName: task.name,
        projectId: project.id,
        projectName: project.name,
        plannedAt,
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
        status: execution.status,
        reason: execution.reason || undefined,
        scriptResults: execution.scriptResults.map((result) => ({
          ...result,
          scriptName: project.scripts.find((script) => script.id === result.scriptId)?.name || result.scriptId,
        })),
      };
      const existingHistoryIndex = task.history.findIndex((item) => item.id === historyEntry.id);
      task.history = normalizeAutomationHistory(
        existingHistoryIndex === -1
          ? [historyEntry, ...task.history]
          : task.history.map((item, index) => (index === existingHistoryIndex ? historyEntry : item)),
      );
      if (
        serviceAutomationExecutionStatuses &&
        existingHistoryIndex === -1 &&
        (previousExecutionStatus === undefined || previousExecutionStatus === "running")
      ) {
        notifyAutomationTaskCompletion(task, execution.status, execution.reason || "");
      }
    }

    if (Array.isArray(serviceExecutions)) {
      serviceAutomationExecutionStatuses = nextServiceAutomationExecutionStatuses;
    }

    if (Array.isArray(serviceExecutions)) {
      Object.entries(this.automationActiveProjectRuns).forEach(([projectId, runId]) => {
        const currentServiceRunId = serviceActiveAutomationRuns[projectId];
        if (currentServiceRunId) {
          this.automationActiveProjectRuns[projectId] = currentServiceRunId;
        } else if (runId) {
          delete this.automationActiveProjectRuns[projectId];
        }
      });
    }

    const eventTypes = new Set<ProjectBridgeEvent["type"]>(["started", "stdout", "stderr", "stdin", "exit", "error"]);
    for (const event of status.events || []) {
      if (!eventTypes.has(event.type)) {
        continue;
      }
      const pid = event.pid;
      const bridgeEvent: ProjectBridgeProcessEvent = {
        ...event,
        pid: typeof pid === "number" && Number.isInteger(pid) ? pid : 0,
        runtimeOwner: "service",
      };
      const serviceScriptKey = `${bridgeEvent.projectId}\u0000${bridgeEvent.scriptId}`;
      const activeRunId = activeServiceRunIds.get(serviceScriptKey);
      const isCurrentServiceEvent =
        Boolean(bridgeEvent.runId) &&
        (bridgeEvent.runId === activeRunId ||
          (bridgeEvent.type === "started" &&
            activeRunId === undefined &&
            serviceScriptsAwaitingStart.has(serviceScriptKey)));
      if (!isCurrentServiceEvent) {
        hasObservedServiceEvent(bridgeEvent);
        continue;
      }
      if (bridgeEvent.type === "error" && bridgeEvent.runId && lostServiceRunIds.has(bridgeEvent.runId)) {
        hasObservedServiceEvent(bridgeEvent);
        continue;
      }
      if (bridgeEvent.type === "started" && bridgeEvent.runId) {
        activeServiceRunIds.set(serviceScriptKey, bridgeEvent.runId);
        serviceScriptsAwaitingStart.delete(serviceScriptKey);
      }
      this.handleBridgeEvent(bridgeEvent);
      if (bridgeEvent.type === "exit" || bridgeEvent.type === "error") {
        activeServiceRunIds.delete(serviceScriptKey);
        serviceScriptsAwaitingStart.add(serviceScriptKey);
      }
    }
  },

  async refreshProjectLaunchServiceStatus(this: AppStore, verifyManualInstall = false) {
    const serviceEnabled = this.projectLaunchServicePreferences.enabled;
    const status = serviceEnabled
      ? await bridge.reconcileProjectLaunchService()
      : await bridge.getProjectLaunchServiceStatus();
    this.projectLaunchServiceStatus =
      verifyManualInstall && !serviceEnabled && !status.running
        ? await bridge.verifyProjectLaunchServiceInstall()
        : status;
    if (this.projectLaunchServicePreferences.enabled) {
      this.reconcileProjectLaunchServiceRuntime(this.projectLaunchServiceStatus);
      await this.reconcileRuntimeProcessState();
    }
    return this.projectLaunchServiceStatus;
  },

  async checkProjectLaunchServiceUpdate(this: AppStore) {
    this.projectLaunchServiceStatus = await bridge.checkProjectLaunchServiceUpdate();
    return this.projectLaunchServiceStatus;
  },

  async loadProjectLaunchServiceRunLog(this: AppStore, runId: string) {
    const runLog = await bridge.getProjectLaunchServiceRunLog(runId);
    return {
      ...runLog,
      logs: retainedRunLogEntries(runLog),
    };
  },

  async loadProjectLaunchServiceRunLogPage(this: AppStore, runId: string, beforeOffset: number) {
    const runLog = await bridge.getProjectLaunchServiceRunLogPage(runId, beforeOffset);
    return {
      ...runLog,
      logs: retainedRunLogEntries(runLog),
    };
  },

  async refreshProjectLaunchServiceLogRetention(this: AppStore) {
    this.projectLaunchServiceLogRetentionStatus = await bridge.getProjectLaunchServiceLogRetention();
    return this.projectLaunchServiceLogRetentionStatus;
  },

  async updateProjectLaunchServiceLogRetention(this: AppStore, policy: ProjectLaunchServiceLogRetentionPolicy) {
    this.projectLaunchServiceLogRetentionStatus = await bridge.updateProjectLaunchServiceLogRetention(policy);
    return this.projectLaunchServiceLogRetentionStatus;
  },

  async listProjectLaunchServiceLogs(this: AppStore, projectId: string): Promise<ProjectLaunchServiceLogDescriptor[]> {
    return bridge.listProjectLaunchServiceLogs(projectId);
  },

  async clearProjectLaunchServiceLogs(this: AppStore,
    scope?: ProjectLaunchServiceLogClearScope,
  ): Promise<ProjectLaunchServiceLogClearResult> {
    return bridge.clearProjectLaunchServiceLogs(scope);
  },

  async downloadProjectLaunchService(this: AppStore) {
    this.projectLaunchServiceStatus = {
      ...(this.projectLaunchServiceStatus || (await bridge.getProjectLaunchServiceStatus())),
      state: "starting",
      message: "正在下载项目启动服务。",
    };
    try {
      this.projectLaunchServiceStatus = await bridge.downloadProjectLaunchService();
    } catch (error) {
      this.projectLaunchServiceStatus = {
        ...this.projectLaunchServiceStatus,
        state: "unavailable",
        message: error instanceof Error ? error.message : "项目启动服务下载失败。",
      };
    }
    return this.projectLaunchServiceStatus;
  },

  async openProjectLaunchServiceDirectory(this: AppStore) {
    await bridge.openProjectLaunchServiceDirectory();
  },

  async openProjectLaunchServiceReleases(this: AppStore) {
    await bridge.openProjectLaunchServiceReleases();
  },

  async synchronizeProjectLaunchServiceAutomation(this: AppStore) {
    const status = await bridge.reconcileProjectLaunchService();
    this.projectLaunchServiceStatus = status;
    if (status.state !== "healthy" || !status.running) {
      throw new Error(status.message || "项目启动服务不可用，无法同步自动化配置。");
    }

    const revision = Math.max(projectLaunchServiceAutomationRevision, status.automationRevision || 0) + 1;
    const result = await bridge.syncProjectLaunchServiceAutomation(
      buildProjectLaunchServiceAutomationConfig(this.projects, revision),
    );
    if (!result.accepted || result.revision !== revision) {
      throw new Error(result.message || "项目启动服务没有确认自动化配置。");
    }

    projectLaunchServiceAutomationRevision = result.revision;
    this.projectLaunchServiceStatus = {
      ...status,
      automationRevision: result.revision,
    };
    return result;
  },

  queueProjectLaunchServiceAutomationSync(this: AppStore) {
    if (!this.projectLaunchServicePreferences.enabled) {
      return Promise.resolve();
    }

    const previous = projectLaunchServiceAutomationSyncPromise || Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(async () => {
        if (!this.projectLaunchServicePreferences.enabled) {
          return;
        }
        try {
          await this.synchronizeProjectLaunchServiceAutomation();
        } catch (error) {
          this.projectLaunchServiceStatus = {
            ...(this.projectLaunchServiceStatus || (await bridge.getProjectLaunchServiceStatus())),
            state: "unavailable",
            message: error instanceof Error ? error.message : "项目启动服务自动化配置同步失败。",
          };
        }
      });
    projectLaunchServiceAutomationSyncPromise = queued;
    void queued.finally(() => {
      if (projectLaunchServiceAutomationSyncPromise === queued) {
        projectLaunchServiceAutomationSyncPromise = null;
      }
    });
    return queued;
  },

  async synchronizeProjectLaunchServiceAutomationForUserAction(this: AppStore) {
    await (projectLaunchServiceAutomationSyncPromise || Promise.resolve());
    try {
      await this.synchronizeProjectLaunchServiceAutomation();
      return true;
    } catch (error) {
      this.projectLaunchServiceStatus = {
        ...(this.projectLaunchServiceStatus || (await bridge.getProjectLaunchServiceStatus())),
        state: "unavailable",
        message: error instanceof Error ? error.message : "项目启动服务自动化配置同步失败。",
      };
      return false;
    }
  },

  async setProjectLaunchServiceEnabled(this: AppStore, enabled: boolean) {
    if (enabled && serviceOwnershipState.handoff) {
      return this.projectLaunchServiceStatus;
    }
    if (enabled === this.projectLaunchServicePreferences.enabled) {
      if (enabled) {
        try {
          await this.synchronizeProjectLaunchServiceAutomation();
        } catch (error) {
          this.projectLaunchServiceStatus = {
            ...(this.projectLaunchServiceStatus || (await bridge.getProjectLaunchServiceStatus())),
            state: "unavailable",
            message: error instanceof Error ? error.message : "项目启动服务自动化配置同步失败。",
          };
        }
      }
      return this.projectLaunchServiceStatus;
    }

    if (enabled) {
      const activeScripts = this.projects.flatMap((project) =>
        project.scripts.filter((script) => script.status === "RUNNING" || script.status === "STOPPING"),
      );
      if (activeScripts.length > 0) {
        this.projectLaunchServiceStatus = {
          ...(this.projectLaunchServiceStatus || (await bridge.getProjectLaunchServiceStatus())),
          state: "unavailable",
          message: "请先停止当前脚本，再启用项目启动服务。",
        };
        return this.projectLaunchServiceStatus;
      }
    } else if (this.hasActiveProjectLaunchServiceRuns) {
      return this.projectLaunchServiceStatus;
    }

    if (enabled) {
      serviceOwnershipState.handoff = true;
      clearAutomationSchedulerTimer();
      this.automationNextTimerAt = "";
      let serviceStartedForHandoff = false;
      try {
        const currentStatus = this.projectLaunchServiceStatus || (await bridge.getProjectLaunchServiceStatus());
        this.projectLaunchServiceStatus = {
          ...currentStatus,
          state: "starting",
          message: "正在启动项目启动服务。",
        };
        let installAlreadyVerified = false;
        if (currentStatus.state === "installed" && currentStatus.installed && !currentStatus.running) {
          const verified = await bridge.verifyProjectLaunchServiceInstall();
          this.projectLaunchServiceStatus = verified;
          if (verified.state !== "installed" || !verified.installed || verified.running) {
            throw new Error(verified.message || "项目启动服务校验失败，无法启用服务模式。");
          }
          this.projectLaunchServiceStatus = {
            ...verified,
            state: "starting",
            message: "正在启动项目启动服务。",
          };
          installAlreadyVerified = true;
        }
        const started = installAlreadyVerified
          ? await bridge.startProjectLaunchService({ requireVerifiedInstall: false })
          : await bridge.startProjectLaunchService();
        this.projectLaunchServiceStatus = started;
        if (started.state !== "healthy" || !started.running) {
          throw new Error(started.message || "项目启动服务不可用，无法启用服务模式。");
        }
        serviceStartedForHandoff = true;
        await this.synchronizeProjectLaunchServiceAutomation();
        this.projectLaunchServicePreferences = { schemaVersion: 1, enabled: true };
        bridge.saveProjectLaunchServicePreferences(this.projectLaunchServicePreferences);
      } catch (error) {
        if (serviceStartedForHandoff) {
          try {
            await bridge.stopProjectLaunchService();
          } catch (stopError) {
            // Keep the failed handoff as the user-visible state.
          }
        }
        this.projectLaunchServicePreferences = { schemaVersion: 1, enabled: false };
        this.projectLaunchServiceStatus = {
          ...(this.projectLaunchServiceStatus || (await bridge.getProjectLaunchServiceStatus())),
          state: "unavailable",
          message: error instanceof Error ? error.message : "项目启动服务自动化配置同步失败。",
        };
      } finally {
        serviceOwnershipState.handoff = false;
        this.scheduleAutomationTimer();
      }
      return this.projectLaunchServiceStatus;
    }

    const stopped = await bridge.stopProjectLaunchService();
    if (stopped.running) {
      this.projectLaunchServiceStatus = {
        ...stopped,
        state: "unavailable",
        message: stopped.message || "项目启动服务仍有活动进程，无法关闭。",
      };
      return this.projectLaunchServiceStatus;
    }
    this.projectLaunchServicePreferences = { schemaVersion: 1, enabled: false };
    serviceAutomationExecutionStatuses = null;
    bridge.saveProjectLaunchServicePreferences(this.projectLaunchServicePreferences);
    this.projectLaunchServiceStatus = await bridge.getProjectLaunchServiceStatus();
    this.scheduleAutomationTimer();
    return this.projectLaunchServiceStatus;
  }
};
