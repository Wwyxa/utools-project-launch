import type { ProjectAutomationTask, ProjectAutomationHistoryEntry, Project, ProjectLaunchServiceAutomationConfig } from "../../types";
import { resolveScriptCwd } from "./projectHelpers";
import { normalizeAutomationTasks } from "./automationHelpers";

export const serviceOwnershipState = { handoff: false };

export type ServiceAutomationSubmission = { taskId: string; entryId: string; manualPlannedAt?: string };

export const serviceAutomationSubmissions = new Map<string, ServiceAutomationSubmission>();

export function beginServiceAutomationSubmission(projectId: string, taskId: string) {
  if (serviceAutomationSubmissions.has(projectId)) {
    return false;
  }
  serviceAutomationSubmissions.set(projectId, { taskId, entryId: "" });
  return true;
}

export function updateServiceAutomationSubmission(projectId: string, entryId: string, manualPlannedAt?: string) {
  const submission = serviceAutomationSubmissions.get(projectId);
  if (submission) {
    serviceAutomationSubmissions.set(projectId, {
      taskId: submission.taskId,
      entryId,
      ...(manualPlannedAt ? { manualPlannedAt } : {}),
    });
  }
}

export function releaseServiceAutomationSubmission(projectId: string) {
  serviceAutomationSubmissions.delete(projectId);
}

export function notifyAutomationTaskCompletion(
  task: Pick<ProjectAutomationTask, "name" | "notifyEnabled">,
  status: ProjectAutomationHistoryEntry["status"],
  reason: string,
) {
  if (!task.notifyEnabled) {
    return;
  }

  const outcome =
    status === "completed" ? "已完成" : status === "missed" ? "已错过" : status === "skipped" ? "已跳过" : "失败";
  try {
    window.utools?.showNotification?.(`任务“${task.name}”${outcome}${reason ? `：${reason}` : ""}`);
  } catch { }
}

export function buildProjectLaunchServiceAutomationConfig(
  projects: Project[],
  revision: number,
): ProjectLaunchServiceAutomationConfig {
  const projectConfigs = projects.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
    env: { ...project.env },
    scripts: project.scripts.map((script) => ({
      id: script.id,
      name: script.name,
      command: script.command,
      cwd: resolveScriptCwd(project.path, script.cwd),
    })),
    tasks: normalizeAutomationTasks(project.id, project.automationTasks),
  }));

  return {
    schemaVersion: 1,
    revision,
    projects: projectConfigs.map(({ tasks, ...project }) => ({
      ...project,
      automationTasks: tasks.map((task) => {
        const submission = serviceAutomationSubmissions.get(project.id);
        const taskSubmission = submission?.taskId === task.id ? submission : undefined;
        return {
          id: task.id,
          name: task.name,
          enabled: task.enabled,
          scriptIds: [...task.scriptIds],
          continuousScriptIds: [...(task.continuousScriptIds || [])],
          schedule: { ...task.schedule },
          scheduleAlgorithmVersion: 1,
          ...(taskSubmission?.entryId && taskSubmission.manualPlannedAt
            ? {
              manualRun: {
                id: taskSubmission.entryId,
                plannedAt: taskSubmission.manualPlannedAt,
              },
            }
            : taskSubmission?.entryId
              ? { runEarlyEntryId: taskSubmission.entryId }
              : {}),
          missedPolicy: task.missedPolicy,
          missedGraceMinutes: task.missedGraceMinutes,
          maxScriptRuntimeMinutes: task.maxScriptRuntimeMinutes,
          inputConfigs: task.inputConfigs.map((config) => ({
            scriptId: config.scriptId,
            steps: config.steps.map((step) => ({ ...step })),
          })),
          exitConfigs: task.exitConfigs.map((config) => ({ ...config })),
        };
      }),
    })),
  };
}
