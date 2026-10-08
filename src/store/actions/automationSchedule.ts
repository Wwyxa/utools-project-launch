import type { AppStore } from "../appStoreShape";
import type { ProjectAutomationTask, ProjectAutomationPlanEntry, Project, ProjectAutomationHistoryEntry, ProjectAutomationScriptResult } from "../../types";
import { validateAutomationSchedule, dateKey, generateAutomationDailyPlan, getNextAutomationPlanEntry } from "../../lib/automationScheduler";
import { clearAutomationSchedulerTimer, normalizeAutomationTasks, automationSchedulerState, automationScriptContexts, automationScriptContextKey, isSuccessfulAutomationProcessResult, defaultAutomationSchedule, DEFAULT_AUTOMATION_MAX_RUNTIME_MINUTES, DEFAULT_AUTOMATION_MISSED_GRACE_MINUTES, AUTOMATION_HISTORY_LIMIT } from "../helpers/automationHelpers";
import { serviceOwnershipState, notifyAutomationTaskCompletion } from "../helpers/serviceAutomationState";
import { bridge } from "../helpers/bridge";
import { createAutomationTaskId, createAutomationRunId } from "../helpers/projectHelpers";

export const automationScheduleActions = {
  automationTaskValidation(this: AppStore, projectId: string, task: ProjectAutomationTask) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      return { valid: false, message: "项目不存在。" };
    }
    if (!task.name.trim()) {
      return { valid: false, message: "请填写任务名称。" };
    }
    if (task.scriptIds.length === 0) {
      return { valid: false, message: "请至少选择一个脚本。" };
    }
    const missingScriptId = task.scriptIds.find(
      (scriptId) => !project.scripts.some((script) => script.id === scriptId),
    );
    if (missingScriptId) {
      return { valid: false, message: `脚本不存在：${missingScriptId}` };
    }
    const scheduleValidation = validateAutomationSchedule(task.schedule);
    if (!scheduleValidation.valid) {
      return scheduleValidation;
    }
    if (task.missedPolicy === "grace-run" && task.missedGraceMinutes < 0) {
      return { valid: false, message: "错过宽限时间不能小于 0。" };
    }
    const invalidMatchStep = task.inputConfigs
      .flatMap((config) => config.steps)
      .find((step) => step.mode === "output-match" && (!step.matchText.trim() || step.timeoutMs < 1000));
    if (invalidMatchStep) {
      return { valid: false, message: "输出匹配输入需要匹配文本和超时时间。" };
    }
    const invalidExit = task.exitConfigs.find((config) => config.enabled && !config.matchText.trim());
    if (invalidExit) {
      return { valid: false, message: "关键词退出需要填写匹配文本。" };
    }
    const continuousExit = task.exitConfigs.find(
      (config) => config.enabled && task.continuousScriptIds?.includes(config.scriptId),
    );
    if (continuousExit) {
      return { valid: false, message: "持续运行脚本不能启用关键词退出。" };
    }
    return { valid: true, message: "" };
  },

  scheduleAutomationTimer(this: AppStore) {
    clearAutomationSchedulerTimer();
    if (serviceOwnershipState.handoff) {
      this.automationNextTimerAt = "";
      return;
    }
    if (this.projectLaunchServicePreferences.enabled) {
      this.automationNextTimerAt = "";
      return;
    }
    const now = new Date();
    const today = dateKey(now);
    const upcoming: Array<{ projectId: string; taskId: string; entry: ProjectAutomationPlanEntry }> = [];

    this.projects.forEach((project) => {
      project.automationTasks = normalizeAutomationTasks(project.id, project.automationTasks);
      project.automationTasks.forEach((task) => {
        if (!task.enabled) {
          return;
        }
        const existingPlan = task.dailyPlans.find((plan) => plan.date === today);
        if (!existingPlan) {
          task.dailyPlans = [generateAutomationDailyPlan(task.id, task.schedule, today), ...task.dailyPlans].slice(
            0,
            7,
          );
        }
        const nextEntry = getNextAutomationPlanEntry(task.dailyPlans, now);
        if (nextEntry) {
          upcoming.push({ projectId: project.id, taskId: task.id, entry: nextEntry });
        }
      });
    });

    upcoming.sort(
      (left, right) => new Date(left.entry.plannedAt).getTime() - new Date(right.entry.plannedAt).getTime(),
    );
    const next = upcoming[0];
    this.automationNextTimerAt = next?.entry.plannedAt || "";
    if (!next) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 5, 0);
      automationSchedulerState.timer = window.setTimeout(
        () => {
          this.recomputeAutomationPlans();
        },
        Math.max(1000, Math.min(tomorrow.getTime() - now.getTime(), 2_147_483_647)),
      );
      return;
    }
    const delay = Math.max(0, Math.min(new Date(next.entry.plannedAt).getTime() - now.getTime(), 2_147_483_647));
    automationSchedulerState.timer = window.setTimeout(() => {
      void this.runDueAutomationPlans();
    }, delay);
  },

  markMissedAutomationPlans(this: AppStore, notify = true) {
    const nowTime = Date.now();
    this.projects.forEach((project) => {
      project.automationTasks?.forEach((task) => {
        if (!task.enabled) {
          return;
        }
        task.dailyPlans.forEach((plan) => {
          plan.entries.forEach((entry) => {
            const plannedTime = new Date(entry.plannedAt).getTime();
            const graceMs = task.missedPolicy === "grace-run" ? task.missedGraceMinutes * 60_000 : 0;
            const shouldMiss =
              entry.status === "pending" &&
              plannedTime < nowTime &&
              (task.missedPolicy === "mark-missed" ||
                (task.missedPolicy === "grace-run" && nowTime - plannedTime > graceMs));
            if (shouldMiss) {
              this.finishAutomationPlanEntry(
                project,
                task,
                entry,
                "missed",
                "插件未运行或计划时间已错过。",
                [],
                undefined,
                notify,
              );
            }
          });
        });
      });
    });
  },

  async reconcileOrphanedAutomationRuns(this: AppStore) {
    let changed = false;
    for (const project of this.projects) {
      for (const task of project.automationTasks || []) {
        for (const plan of task.dailyPlans) {
          for (const entry of plan.entries) {
            if (entry.status !== "running") {
              continue;
            }

            const hasActiveRun = Boolean(entry.runId) && this.automationActiveProjectRuns[project.id] === entry.runId;
            const hasRunningScript = task.scriptIds.some((scriptId) => {
              const script = project.scripts.find((item) => item.id === scriptId);
              return script?.status === "RUNNING" || script?.status === "STOPPING";
            });
            const hasAutomationContext = task.scriptIds.some((scriptId) =>
              automationScriptContexts.has(automationScriptContextKey(project.id, scriptId)),
            );
            if (hasRunningScript || hasAutomationContext) {
              continue;
            }
            if (hasActiveRun) {
              delete this.automationActiveProjectRuns[project.id];
            }

            const matchingHistory = entry.runId
              ? task.history.find((historyEntry) => historyEntry.id === entry.runId)
              : undefined;
            if (matchingHistory) {
              entry.status = matchingHistory.status;
              entry.runId = matchingHistory.id;
              entry.reason = matchingHistory.reason;
              changed = true;
              continue;
            }

            const recentResults = await Promise.all(
              task.scriptIds.map(async (scriptId) => {
                try {
                  const result = entry.runId
                    ? await bridge.getAutomationProcessResult(project.id, scriptId, entry.runId)
                    : null;
                  return { scriptId, result };
                } catch (error) {
                  return { scriptId, result: null };
                }
              }),
            );
            const entryPlannedTime = new Date(entry.plannedAt).getTime();
            const relevantResults = recentResults.filter(({ result }) => {
              if (!entry.runId || result?.automationRunId !== entry.runId || !result.endedAt) {
                return false;
              }
              return new Date(result.endedAt).getTime() >= entryPlannedTime;
            });

            if (relevantResults.length === task.scriptIds.length && relevantResults.length > 0) {
              const failedResult = relevantResults.find(({ result }) => !isSuccessfulAutomationProcessResult(result));
              this.finishAutomationPlanEntry(
                project,
                task,
                entry,
                failedResult ? "failed" : "completed",
                failedResult
                  ? failedResult.result?.error || `脚本退出码 ${failedResult.result?.code ?? "unknown"}。`
                  : "",
                relevantResults.map(({ scriptId, result }) => {
                  const failed = !isSuccessfulAutomationProcessResult(result);
                  return {
                    scriptId,
                    scriptName: project.scripts.find((script) => script.id === scriptId)?.name || scriptId,
                    status: failed ? "failed" : "completed",
                    endedAt: result?.endedAt,
                    reason: failed ? result?.error || `脚本退出码 ${result?.code ?? "unknown"}。` : undefined,
                  };
                }),
                entry.runId,
                false,
              );
              changed = true;
              continue;
            }

            this.finishAutomationPlanEntry(
              project,
              task,
              entry,
              "skipped",
              "任务运行状态已失效，已在应用恢复时忽略。",
              [],
              entry.runId,
              false,
            );
            changed = true;
          }
        }
      }
    }
    return changed;
  },

  async runDueAutomationPlans(this: AppStore, notifyMissed = true) {
    if (serviceOwnershipState.handoff || this.projectLaunchServicePreferences.enabled) {
      clearAutomationSchedulerTimer();
      this.automationNextTimerAt = "";
      return;
    }
    this.markMissedAutomationPlans(notifyMissed);
    const nowTime = Date.now();
    const dueEntries: Array<{ project: Project; task: ProjectAutomationTask; entry: ProjectAutomationPlanEntry }> =
      [];
    this.projects.forEach((project) => {
      project.automationTasks?.forEach((task) => {
        if (!task.enabled) {
          return;
        }
        task.dailyPlans.forEach((plan) => {
          plan.entries.forEach((entry) => {
            if (entry.status === "pending" && new Date(entry.plannedAt).getTime() <= nowTime) {
              dueEntries.push({ project, task, entry });
            }
          });
        });
      });
    });

    for (const due of dueEntries) {
      if (this.automationActiveProjectRuns[due.project.id]) {
        this.finishAutomationPlanEntry(due.project, due.task, due.entry, "skipped", "同项目已有任务正在运行。", []);
        continue;
      }
      void this.runAutomationTask(due.project.id, due.task.id, due.entry.id);
    }

    this.scheduleAutomationTimer();
  },

  recomputeAutomationPlans(this: AppStore, projectId?: string, notifyMissed = true) {
    if (serviceOwnershipState.handoff || this.projectLaunchServicePreferences.enabled) {
      return;
    }
    const today = dateKey();
    this.projects
      .filter((project) => !projectId || project.id === projectId)
      .forEach((project) => {
        project.automationTasks = normalizeAutomationTasks(project.id, project.automationTasks).map((task) => {
          const todayPlan = task.dailyPlans.find((plan) => plan.date === today);
          return {
            ...task,
            dailyPlans: todayPlan
              ? [todayPlan, ...task.dailyPlans.filter((plan) => plan.date !== today)].slice(0, 7)
              : [generateAutomationDailyPlan(task.id, task.schedule, today), ...task.dailyPlans].slice(0, 7),
          };
        });
      });
    this.markMissedAutomationPlans(notifyMissed);
    void this.runDueAutomationPlans(notifyMissed);
  },

  createAutomationTask(this: AppStore, projectId: string, patch: Partial<ProjectAutomationTask>) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      return { ok: false, message: "项目不存在。" };
    }
    const now = new Date().toISOString();
    const firstScriptId = project.scripts[0]?.id;
    const task: ProjectAutomationTask = normalizeAutomationTasks(projectId, [
      {
        id: createAutomationTaskId(),
        name: patch.name || "任务",
        enabled: patch.enabled ?? true,
        scriptIds: patch.scriptIds?.length ? patch.scriptIds : firstScriptId ? [firstScriptId] : [],
        continuousScriptIds: patch.continuousScriptIds || [],
        schedule: patch.schedule || defaultAutomationSchedule(),
        notifyEnabled: patch.notifyEnabled ?? true,
        maxScriptRuntimeMinutes: patch.maxScriptRuntimeMinutes || DEFAULT_AUTOMATION_MAX_RUNTIME_MINUTES,
        inputConfigs: patch.inputConfigs || [],
        exitConfigs: patch.exitConfigs || [],
        dailyPlans: [],
        history: [],
        missedPolicy: patch.missedPolicy || "grace-run",
        missedGraceMinutes: patch.missedGraceMinutes ?? DEFAULT_AUTOMATION_MISSED_GRACE_MINUTES,
        createdAt: now,
        updatedAt: now,
      },
    ])[0];
    const validation = this.automationTaskValidation(projectId, task);
    if (!validation.valid) {
      return { ok: false, message: validation.message };
    }
    if (!this.projectLaunchServicePreferences.enabled) {
      task.dailyPlans = [generateAutomationDailyPlan(task.id, task.schedule, dateKey())];
    }
    project.automationTasks = [task, ...(project.automationTasks || [])];
    project.updatedAt = now;
    this.scheduleAutomationTimer();
    void this.persistProjects();
    return { ok: true, message: "", task };
  },

  duplicateAutomationTask(this: AppStore, projectId: string, taskId: string, name: string) {
    const project = this.projects.find((item) => item.id === projectId);
    const sourceTask = project?.automationTasks?.find((item) => item.id === taskId);
    if (!project || !sourceTask) {
      return { ok: false, message: "任务不存在。" };
    }

    const now = new Date().toISOString();
    const task: ProjectAutomationTask = normalizeAutomationTasks(projectId, [
      {
        ...sourceTask,
        id: createAutomationTaskId(),
        name,
        scriptIds: [...sourceTask.scriptIds],
        continuousScriptIds: [...(sourceTask.continuousScriptIds || [])],
        inputConfigs: sourceTask.inputConfigs.map((config) => ({
          scriptId: config.scriptId,
          steps: config.steps.map((step) => ({ ...step })),
        })),
        exitConfigs: sourceTask.exitConfigs.map((config) => ({ ...config })),
        dailyPlans: [],
        history: [],
        createdAt: now,
        updatedAt: now,
      },
    ])[0];
    const validation = this.automationTaskValidation(projectId, task);
    if (!validation.valid) {
      return { ok: false, message: validation.message };
    }

    if (!this.projectLaunchServicePreferences.enabled) {
      task.dailyPlans = [generateAutomationDailyPlan(task.id, task.schedule, dateKey())];
    }
    const sourceIndex = (project.automationTasks || []).findIndex((item) => item.id === taskId);
    project.automationTasks = [
      ...(project.automationTasks || []).slice(0, sourceIndex + 1),
      task,
      ...(project.automationTasks || []).slice(sourceIndex + 1),
    ];
    project.updatedAt = now;
    this.scheduleAutomationTimer();
    void this.persistProjects();
    return { ok: true, message: "", task };
  },

  updateAutomationTask(this: AppStore, projectId: string, taskId: string, patch: Partial<ProjectAutomationTask>) {
    const project = this.projects.find((item) => item.id === projectId);
    const task = project?.automationTasks?.find((item) => item.id === taskId);
    if (!project || !task) {
      return { ok: false, message: "任务不存在。" };
    }
    const nextTask: ProjectAutomationTask = normalizeAutomationTasks(projectId, [
      {
        ...task,
        ...patch,
        dailyPlans: patch.schedule ? [] : task.dailyPlans,
        updatedAt: new Date().toISOString(),
      },
    ])[0];
    const validation = this.automationTaskValidation(projectId, nextTask);
    if (!validation.valid) {
      return { ok: false, message: validation.message };
    }
    if (this.projectLaunchServicePreferences.enabled) {
      nextTask.dailyPlans = [];
    } else if (patch.schedule || !nextTask.dailyPlans.some((plan) => plan.date === dateKey())) {
      nextTask.dailyPlans = [generateAutomationDailyPlan(nextTask.id, nextTask.schedule, dateKey())];
    }
    Object.assign(task, nextTask);
    project.updatedAt = new Date().toISOString();
    this.scheduleAutomationTimer();
    void this.persistProjects();
    return { ok: true, message: "", task };
  },

  deleteAutomationTask(this: AppStore, projectId: string, taskId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      return false;
    }
    project.automationTasks = (project.automationTasks || []).filter((task) => task.id !== taskId);
    project.updatedAt = new Date().toISOString();
    this.scheduleAutomationTimer();
    void this.persistProjects();
    return true;
  },

  openProjectAutomation(this: AppStore, projectId: string) {
    this.selectedProjectId = projectId;
    this.activeTab = "projects";
    this.projectDetailsTabRequest = { projectId, tab: "automation", requestedAt: Date.now() };
  },

  openProjectMemo(this: AppStore, projectId: string) {
    this.selectedProjectId = projectId;
    this.activeTab = "projects";
    this.projectDetailsTabRequest = { projectId, tab: "memo", requestedAt: Date.now() };
  },

  openProjectGit(this: AppStore, projectId: string, commitHash?: string) {
    this.selectedProjectId = projectId;
    this.activeTab = "projects";
    this.projectDetailsTabRequest = { projectId, tab: "git", requestedAt: Date.now(), commitHash };
  },

  finishAutomationPlanEntry(this: AppStore,
    project: Project,
    task: ProjectAutomationTask,
    entry: ProjectAutomationPlanEntry,
    status: ProjectAutomationHistoryEntry["status"],
    reason: string,
    scriptResults: ProjectAutomationScriptResult[],
    runId = entry.runId || createAutomationRunId(),
    notify = true,
  ) {
    entry.status = status;
    entry.runId = runId;
    entry.reason = reason || undefined;
    const endedAt = new Date().toISOString();
    task.history = [
      {
        id: runId,
        taskId: task.id,
        taskName: task.name,
        projectId: project.id,
        projectName: project.name,
        plannedAt: entry.plannedAt,
        startedAt: status === "missed" || status === "skipped" ? undefined : endedAt,
        endedAt,
        status,
        reason: reason || undefined,
        scriptResults,
      },
      ...task.history,
    ].slice(0, AUTOMATION_HISTORY_LIMIT);
    if (notify) {
      notifyAutomationTaskCompletion(task, status, reason);
    }
  }
};
