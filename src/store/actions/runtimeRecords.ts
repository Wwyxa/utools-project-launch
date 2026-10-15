import type { ProjectAutomationHistoryEntry, ProjectLaunchServiceLogClearScope, ProjectLaunchServiceLogRetentionPolicy } from "../../types";
import type { AppStore } from "../appStoreShape";
import { bridge } from "../helpers/bridge";
import { normalizeAutomationHistory, retainedRunLogEntries } from "../helpers/automationHelpers";

export const runtimeRecordsActions = {
  async loadRuntimeAutomationHistory(this: AppStore, projectId?: string, taskId?: string) {
    const projects = this.projects.filter((project) => (!projectId || project.id === projectId) &&
      project.automationTasks?.some((task) => !taskId || task.id === taskId));
    if (!this.supportsBridge || projects.length === 0) return [];
    const records = await bridge.listRuntimeRecords(projectId || "");
    const history: ProjectAutomationHistoryEntry[] = [];
    for (const project of this.projects.filter((project) => !projectId || project.id === projectId)) {
      for (const task of (project.automationTasks || []).filter((task) => !taskId || task.id === taskId)) {
        const entries = records.flatMap((record): ProjectAutomationHistoryEntry[] => {
          const execution = record.execution;
          if (record.projectId !== project.id || !execution || execution.projectId !== project.id ||
              execution.taskId !== task.id || execution.status === "running") return [];
          return [{
            id: execution.id, taskId: task.id, taskName: task.name, projectId: project.id, projectName: project.name,
            plannedAt: execution.plannedAt || execution.startedAt || execution.endedAt || "",
            startedAt: execution.startedAt, endedAt: execution.endedAt,
            status: execution.status === "failed" || execution.status === "skipped" || execution.status === "missed"
              ? execution.status : "completed",
            reason: execution.reason || undefined,
            scriptResults: execution.scriptResults.map((result) => ({
              ...result, scriptName: project.scripts.find((script) => script.id === result.scriptId)?.name || result.scriptId,
            })),
          }];
        });
        const merged = new Map([...task.history, ...entries].map((entry) => [entry.id, entry]));
        task.history = normalizeAutomationHistory([...merged.values()]);
        history.push(...merged.values());
      }
    }
    return history.sort((left, right) =>
      Date.parse(right.endedAt || right.startedAt || right.plannedAt) - Date.parse(left.endedAt || left.startedAt || left.plannedAt));
  },
  async loadRuntimeRecordLogPage(this: AppStore, runId: string, beforeOffset: number) {
    const result = await bridge.readRuntimeRecordLogPage(runId, beforeOffset);
    return { ...result, logs: retainedRunLogEntries(result) };
  },
  async listRuntimeRecords(this: AppStore, projectId: string) {
    return bridge.listRuntimeRecords(projectId);
  },
  async refreshRuntimeRecordRetention(this: AppStore) {
    this.projectLaunchServiceLogRetentionStatus = await bridge.getRuntimeRecordRetention();
    return this.projectLaunchServiceLogRetentionStatus;
  },
  async updateRuntimeRecordRetention(this: AppStore, policy: ProjectLaunchServiceLogRetentionPolicy) {
    this.projectLaunchServiceLogRetentionStatus = await bridge.updateRuntimeRecordRetention(policy);
    return this.projectLaunchServiceLogRetentionStatus;
  },
  async clearRuntimeRecords(this: AppStore, scope?: ProjectLaunchServiceLogClearScope) {
    return bridge.clearRuntimeRecords(scope);
  },
};