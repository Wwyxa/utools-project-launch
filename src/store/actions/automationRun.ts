import type { AppStore } from "../appStoreShape";
import { serviceOwnershipState, notifyAutomationTaskCompletion, serviceAutomationSubmissions, beginServiceAutomationSubmission, updateServiceAutomationSubmission, releaseServiceAutomationSubmission } from "../helpers/serviceAutomationState";
import { createAutomationRunId } from "../helpers/projectHelpers";
import type { ProjectAutomationScriptResult, ProjectAutomationHistoryEntry, ProjectAutomationPlanEntry, ProjectAutomationInputStep, ProjectAutomationExitConfig, ProjectBridgeEvent } from "../../types";
import { AUTOMATION_HISTORY_LIMIT, AutomationScriptRuntimeContext, automationScriptContexts, automationScriptContextKey, settleAutomationScriptContext, clearAutomationStepTimers, shouldAutomationExitOnOutput, isSuccessfulAutomationProcessResult } from "../helpers/automationHelpers";
import { dateKey, generateAutomationDailyPlan } from "../../lib/automationScheduler";
import { bridge } from "../helpers/bridge";

export const automationRunActions = {
  async runAutomationTask(this: AppStore, projectId: string, taskId: string, entryId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    const task = project?.automationTasks?.find((item) => item.id === taskId);
    const entry = task?.dailyPlans.flatMap((plan) => plan.entries).find((item) => item.id === entryId);
    if (!project || !task || !entry || entry.status !== "pending") {
      return;
    }
    if (serviceOwnershipState.handoff) {
      return;
    }
    if (this.projectLaunchServicePreferences.enabled) {
      return;
    }
    const runId = createAutomationRunId();
    entry.status = "running";
    entry.runId = runId;
    this.automationActiveProjectRuns[projectId] = runId;
    const scriptResults: ProjectAutomationScriptResult[] = [];
    const continuousScriptIds = new Set(task.continuousScriptIds || []);
    let finalStatus: ProjectAutomationHistoryEntry["status"] = "completed";
    let finalReason = "";
    const startedAt = new Date().toISOString();

    try {
      for (const scriptId of task.scriptIds) {
        const script = project.scripts.find((item) => item.id === scriptId);
        const continueAfterInput = continuousScriptIds.has(scriptId);
        if (!script) {
          finalStatus = "failed";
          finalReason = `脚本不存在：${scriptId}`;
          scriptResults.push({ scriptId, scriptName: scriptId, status: "failed", reason: finalReason });
          break;
        }
        if (script.status === "RUNNING" && continueAfterInput) {
          scriptResults.push({
            scriptId,
            scriptName: script.name,
            status: "started",
            startedAt: new Date().toISOString(),
            reason: "脚本已在运行。",
          });
          continue;
        }
        if (
          project.pathExists === false ||
          !script.command.trim() ||
          script.status === "RUNNING" ||
          script.status === "STOPPING"
        ) {
          const scriptBusy = script.status === "RUNNING" || script.status === "STOPPING";
          finalStatus = scriptBusy ? "skipped" : "failed";
          finalReason =
            project.pathExists === false
              ? "项目路径不可用。"
              : !script.command.trim()
                ? "脚本命令为空。"
                : "脚本已在运行或停止中。";
          scriptResults.push({
            scriptId,
            scriptName: script.name,
            status: scriptBusy ? "skipped" : "failed",
            reason: finalReason,
          });
          break;
        }

        const inputConfig = task.inputConfigs.find((config) => config.scriptId === scriptId);
        const exitConfig = task.exitConfigs.find(
          (config) => config.scriptId === scriptId && config.enabled && config.matchText.trim(),
        );
        const result = await this.runAutomationScript(
          projectId,
          scriptId,
          runId,
          inputConfig?.steps || [],
          exitConfig,
          task.maxScriptRuntimeMinutes,
          continueAfterInput,
        );
        scriptResults.push(result);
        if (result.status !== "completed" && result.status !== "started") {
          finalStatus = "failed";
          finalReason = result.reason || `${script.name} 执行失败。`;
          break;
        }
      }
    } catch (error) {
      if (finalStatus === "completed") {
        finalStatus = "failed";
        finalReason = error instanceof Error ? error.message : "任务执行失败。";
      }
    }

    delete this.automationActiveProjectRuns[projectId];
    entry.status = finalStatus;
    const endedAt = new Date().toISOString();
    task.history = [
      {
        id: runId,
        taskId: task.id,
        taskName: task.name,
        projectId: project.id,
        projectName: project.name,
        plannedAt: entry.plannedAt,
        startedAt,
        endedAt,
        status: finalStatus,
        reason: finalReason || undefined,
        scriptResults,
      },
      ...task.history,
    ].slice(0, AUTOMATION_HISTORY_LIMIT);
    entry.reason = finalReason || undefined;
    notifyAutomationTaskCompletion(task, finalStatus, finalReason);
    this.scheduleAutomationTimer();
  },

  async runAutomationPlanEntryEarly(this: AppStore, projectId: string, taskId: string, entryId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    const task = project?.automationTasks?.find((item) => item.id === taskId);
    const serviceEnabled = this.projectLaunchServicePreferences.enabled;
    const localEntry = task?.dailyPlans
      .find((plan) => plan.date === dateKey())
      ?.entries.find((item) => item.id === entryId);
    const entry = serviceEnabled
      ? this.serviceAutomationTaskEntries(projectId, taskId)?.find((item) => item.id === entryId)
      : localEntry;
    const plannedAtTime = entry ? new Date(entry.plannedAt).getTime() : Number.NaN;
    if (
      !project ||
      !task ||
      !entry ||
      serviceOwnershipState.handoff ||
      entry.status !== "pending" ||
      !Number.isFinite(plannedAtTime) ||
      plannedAtTime <= Date.now() ||
      task.scriptIds.length === 0 ||
      this.automationActiveProjectRuns[projectId] ||
      (serviceEnabled && serviceAutomationSubmissions.has(projectId))
    ) {
      return false;
    }

    if (serviceEnabled) {
      if (!beginServiceAutomationSubmission(projectId, task.id)) {
        return false;
      }
      let accepted = false;
      try {
        const status = await bridge.reconcileProjectLaunchService();
        this.projectLaunchServiceStatus = status;
        if (status.state !== "healthy" || !status.running) {
          return false;
        }
        updateServiceAutomationSubmission(projectId, entry.id);
        if (!(await this.synchronizeProjectLaunchServiceAutomationForUserAction())) {
          return false;
        }
        accepted = true;
        return true;
      } finally {
        if (!accepted) {
          releaseServiceAutomationSubmission(projectId);
        }
      }
    }

    void this.runAutomationTask(projectId, taskId, entryId);
    return true;
  },

  async runAutomationTaskNow(this: AppStore, projectId: string, taskId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    const task = project?.automationTasks?.find((item) => item.id === taskId);
    const serviceEnabled = this.projectLaunchServicePreferences.enabled;
    if (
      serviceOwnershipState.handoff ||
      !project ||
      !task ||
      task.scriptIds.length === 0 ||
      this.automationActiveProjectRuns[projectId] ||
      (serviceEnabled && serviceAutomationSubmissions.has(projectId))
    ) {
      return false;
    }

    if (serviceEnabled && !beginServiceAutomationSubmission(projectId, task.id)) {
      return false;
    }
    let acceptedServiceSubmission = false;
    try {
      if (serviceEnabled) {
        const status = await bridge.reconcileProjectLaunchService();
        this.projectLaunchServiceStatus = status;
        if (status.state !== "healthy" || !status.running) {
          return false;
        }
        const plannedAt = new Date().toISOString();
        updateServiceAutomationSubmission(projectId, `${task.id}-${plannedAt}-manual`, plannedAt);
        if (!(await this.synchronizeProjectLaunchServiceAutomationForUserAction())) {
          return false;
        }
        acceptedServiceSubmission = true;
        return true;
      }

      const now = new Date();
      const today = dateKey(now);
      let todayPlan = task.dailyPlans.find((plan) => plan.date === today);
      const createdTodayPlan = !todayPlan;
      if (!todayPlan) {
        todayPlan = generateAutomationDailyPlan(task.id, task.schedule, today);
        task.dailyPlans = [todayPlan, ...task.dailyPlans].slice(0, 7);
      }

      const plannedAt = now.toISOString();
      const manualEntry: ProjectAutomationPlanEntry = {
        id: `${task.id}-${plannedAt}-manual`,
        plannedAt,
        status: "pending",
        reason: "手动立即执行。",
      };
      todayPlan.entries = [...todayPlan.entries, manualEntry].sort(
        (left, right) => new Date(left.plannedAt).getTime() - new Date(right.plannedAt).getTime(),
      );
      void this.runAutomationTask(projectId, taskId, manualEntry.id);
      return true;
    } finally {
      if (serviceEnabled && !acceptedServiceSubmission) {
        releaseServiceAutomationSubmission(projectId);
      }
    }
  },

  async ignoreMissedAutomationTask(this: AppStore, projectId: string, taskId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    const task = project?.automationTasks?.find((item) => item.id === taskId);
    const missedEntry = task?.history.find((entry) => entry.status === "missed");
    const serviceExecutions = this.projectLaunchServiceStatus?.automation?.executions;
    if (!project || !task || !missedEntry || !Array.isArray(serviceExecutions)) {
      return false;
    }

    try {
      const updatedExecution = await bridge.ignoreMissedProjectLaunchServiceAutomationExecution(missedEntry.id);
      this.projectLaunchServiceStatus = {
        ...this.projectLaunchServiceStatus!,
        automation: {
          ...this.projectLaunchServiceStatus!.automation!,
          executions: serviceExecutions.map((execution) =>
            execution.id === updatedExecution.id ? updatedExecution : execution,
          ),
        },
      };
      this.reconcileProjectLaunchServiceRuntime(this.projectLaunchServiceStatus);
      return true;
    } catch (error) {
      return false;
    }
  },

  runAutomationScript(this: AppStore,
    projectId: string,
    scriptId: string,
    automationRunId: string,
    steps: ProjectAutomationInputStep[],
    exitConfig: ProjectAutomationExitConfig | undefined,
    maxRuntimeMinutes: number,
    continueAfterInput: boolean,
  ): Promise<ProjectAutomationScriptResult> {
    const project = this.projects.find((item) => item.id === projectId);
    const script = project?.scripts.find((item) => item.id === scriptId);
    if (!project || !script) {
      return Promise.resolve({ scriptId, scriptName: scriptId, status: "failed", reason: "脚本不存在。" });
    }
    const startedAt = new Date().toISOString();
    return new Promise((resolve) => {
      const context: AutomationScriptRuntimeContext = {
        runId: automationRunId,
        projectId,
        scriptId,
        scriptName: script.name,
        startedAt,
        steps,
        exitConfig,
        continueAfterInput,
        output: "",
        stepIndex: 0,
        waitingStepIndex: null,
        inputCompleted: steps.length === 0,
        settled: false,
        stopRequestedByAutomationExit: false,
        timers: [],
        runtimeTimer: null,
        resolve,
      };
      automationScriptContexts.set(automationScriptContextKey(projectId, scriptId), context);
      context.runtimeTimer = window.setTimeout(
        () => {
          void this.stopScript(projectId, scriptId);
          settleAutomationScriptContext(context, {
            scriptId,
            scriptName: script.name,
            status: "timeout",
            startedAt,
            endedAt: new Date().toISOString(),
            reason: `脚本运行超过 ${maxRuntimeMinutes} 分钟。`,
          });
        },
        Math.max(1, maxRuntimeMinutes) * 60_000,
      );

      void this.launchScript(projectId, scriptId, automationRunId).then((result) => {
        if (!result) {
          settleAutomationScriptContext(context, {
            scriptId,
            scriptName: script.name,
            status: "failed",
            startedAt,
            endedAt: new Date().toISOString(),
            reason: "脚本启动失败。",
          });
          return;
        }
        this.advanceAutomationInputStep(context);
      });
    });
  },

  async sendAutomationInput(this: AppStore, context: AutomationScriptRuntimeContext, value: string) {
    let result: Awaited<ReturnType<typeof this.sendScriptInput>>;
    try {
      result = await this.sendScriptInput(context.projectId, context.scriptId, value);
    } catch (error) {
      result = { sent: false, message: error instanceof Error ? error.message : "自动输入发送失败。" };
    }
    if (!result.sent) {
      void this.stopScript(context.projectId, context.scriptId);
      settleAutomationScriptContext(context, {
        scriptId: context.scriptId,
        scriptName: context.scriptName,
        status: "failed",
        startedAt: context.startedAt,
        endedAt: new Date().toISOString(),
        reason: result.message || "自动输入发送失败。",
      });
      return false;
    }
    return true;
  },

  advanceAutomationInputStep(this: AppStore, context: AutomationScriptRuntimeContext) {
    if (context.settled) {
      return;
    }
    clearAutomationStepTimers(context);
    const step = context.steps[context.stepIndex];
    if (!step) {
      context.inputCompleted = true;
      if (context.continueAfterInput) {
        settleAutomationScriptContext(context, {
          scriptId: context.scriptId,
          scriptName: context.scriptName,
          status: "started",
          startedAt: context.startedAt,
          endedAt: new Date().toISOString(),
          reason: "持续运行脚本已启动。",
        });
        return;
      }
      if (shouldAutomationExitOnOutput(context)) {
        context.stopRequestedByAutomationExit = true;
        void this.stopScript(context.projectId, context.scriptId, {
          automationRunId: context.runId,
          automationExitMatched: true,
        });
      }
      return;
    }
    if (step.mode === "delay") {
      const timer = window.setTimeout(
        () => {
          void this.sendAutomationInput(context, step.value).then((sent) => {
            if (!sent || context.settled) {
              return;
            }
            context.stepIndex += 1;
            this.advanceAutomationInputStep(context);
          });
        },
        Math.max(0, step.delayMs),
      );
      context.timers.push(timer);
      return;
    }

    context.waitingStepIndex = context.stepIndex;
    const timeout = window.setTimeout(
      () => {
        void this.stopScript(context.projectId, context.scriptId);
        settleAutomationScriptContext(context, {
          scriptId: context.scriptId,
          scriptName: context.scriptName,
          status: "failed",
          startedAt: context.startedAt,
          endedAt: new Date().toISOString(),
          reason: `等待输出匹配“${step.matchText}”超时。`,
        });
      },
      Math.max(1000, step.timeoutMs),
    );
    context.timers.push(timeout);
    if (step.matchText.trim() && context.output.includes(step.matchText)) {
      void this.consumeAutomationOutputMatch(context);
    }
  },

  async consumeAutomationOutputMatch(this: AppStore, context: AutomationScriptRuntimeContext) {
    const step = context.steps[context.stepIndex];
    if (!step || step.mode !== "output-match" || context.waitingStepIndex !== context.stepIndex) {
      return;
    }
    clearAutomationStepTimers(context);
    const sent = await this.sendAutomationInput(context, step.value);
    if (!sent || context.settled) {
      return;
    }
    context.stepIndex += 1;
    this.advanceAutomationInputStep(context);
  },

  handleAutomationBridgeEvent(this: AppStore, event: ProjectBridgeEvent) {
    if (
      event.type === "service-state" ||
      event.type === "service-download-progress" ||
      event.type === "icon-pack-download-progress" ||
      event.type === "projects-changed"
    ) {
      return;
    }
    const context = automationScriptContexts.get(automationScriptContextKey(event.projectId, event.scriptId));
    if (!context || context.settled || event.automationRunId !== context.runId) {
      return;
    }
    if (event.type === "stdout" || event.type === "stderr") {
      context.output += event.message || "";
      const currentStep = context.steps[context.stepIndex];
      if (
        currentStep?.mode === "output-match" &&
        currentStep.matchText.trim() &&
        context.output.includes(currentStep.matchText)
      ) {
        void this.consumeAutomationOutputMatch(context);
      }
      if (!context.stopRequestedByAutomationExit && shouldAutomationExitOnOutput(context)) {
        context.stopRequestedByAutomationExit = true;
        void this.stopScript(event.projectId, event.scriptId, {
          automationRunId: context.runId,
          automationExitMatched: true,
        });
      }
    }
    if (event.type === "exit") {
      const success = isSuccessfulAutomationProcessResult(event);
      settleAutomationScriptContext(context, {
        scriptId: context.scriptId,
        scriptName: context.scriptName,
        status: success ? "completed" : event.stoppedByUser ? "stopped" : "failed",
        startedAt: context.startedAt,
        endedAt: new Date().toISOString(),
        reason: success
          ? undefined
          : event.stoppedByUser
            ? "脚本已被手动停止。"
            : `脚本退出码 ${event.code ?? "unknown"}。`,
      });
    }
    if (event.type === "error") {
      settleAutomationScriptContext(context, {
        scriptId: context.scriptId,
        scriptName: context.scriptName,
        status: "failed",
        startedAt: context.startedAt,
        endedAt: new Date().toISOString(),
        reason: event.message || "脚本执行错误。",
      });
    }
  }
};
