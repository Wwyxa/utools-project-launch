import type { AppStore } from "../appStoreShape";
import type { ProjectBridgeEvent, LogEntry } from "../../types";
import { showActionStatus } from "../../components/common/actionStatus";
import { projectLaunchServiceDownloadProgressMessage, iconPackDownloadProgressMessage } from "../helpers/projectHelpers";
import { hasObservedServiceEvent, automationScriptContexts, automationScriptContextKey, isPendingRuntimeTerminalEvent, pendingRuntimeTerminalEventKey, runtimeRunObservations, rememberRuntimeRun, pendingRuntimeTerminalEvents, pendingRuntimeTerminalEventLimit, createLogEntry, scheduleProcessStop, normalizeLogLines, classifyProcessOutputLine, isSuccessfulAutomationProcessResult } from "../helpers/automationHelpers";
import { deriveProjectStatus } from "../../lib/projectRuntimeState";

export const bridgeEventsActions = {
  handleBridgeEvent(this: AppStore, event: ProjectBridgeEvent) {
    if (event.type === "projects-changed") {
      void this.scheduleProjectCatalogReload();
      return;
    }
    if (event.type === "service-state") {
      this.projectLaunchServiceStatus = event.status;
      this.reconcileProjectLaunchServiceRuntime(event.status);
      return;
    }
    if (event.type === "service-download-progress") {
      if (Number.isFinite(event.percent)) {
        const percent = Math.max(0, Math.min(100, Math.floor(event.percent)));
        showActionStatus({
          state: "loading",
          message: projectLaunchServiceDownloadProgressMessage(this.locale, percent),
        });
      }
      return;
    }
    if (event.type === "icon-pack-download-progress") {
      if (Number.isFinite(event.percent)) {
        const percent = Math.max(0, Math.min(100, Math.floor(event.percent)));
        showActionStatus({
          state: "loading",
          message: iconPackDownloadProgressMessage(this.locale, percent),
        });
      }
      return;
    }
    if (hasObservedServiceEvent(event)) {
      return;
    }
    const automationContext = automationScriptContexts.get(
      automationScriptContextKey(event.projectId, event.scriptId),
    );
    if (automationContext && event.automationRunId !== automationContext.runId) {
      return;
    }
    const project = this.projects.find((item) => item.id === event.projectId);
    const script = project?.scripts.find((item) => item.id === event.scriptId);
    if (script && !script.runId && event.runId && isPendingRuntimeTerminalEvent(event)) {
      const key = pendingRuntimeTerminalEventKey(event.projectId, event.scriptId, event.runId);
      if (runtimeRunObservations.get(key) === "terminal") {
        return;
      }
      rememberRuntimeRun(key, "pending-terminal");
      pendingRuntimeTerminalEvents.set(key, event);
      while (pendingRuntimeTerminalEvents.size > pendingRuntimeTerminalEventLimit) {
        const oldestKey = pendingRuntimeTerminalEvents.keys().next().value;
        if (oldestKey === undefined) break;
        pendingRuntimeTerminalEvents.delete(oldestKey);
      }
      return;
    }
    if (
      script?.runId &&
      !event.runId &&
      (!script.pid || event.pid !== script.pid || (event.runtimeOwner && event.runtimeOwner !== script.runtimeOwner))
    ) {
      return;
    }
    if (
      script?.runId &&
      event.runId &&
      (event.runId !== script.runId || (event.runtimeOwner && event.runtimeOwner !== script.runtimeOwner))
    ) {
      return;
    }
    if (script && event.runId) {
      const key = pendingRuntimeTerminalEventKey(event.projectId, event.scriptId, event.runId);
      const observation = runtimeRunObservations.get(key);
      if (event.type === "started" && (observation === "terminal" || (observation === "active" && !script.runId))) {
        return;
      }
      if (event.type !== "started" && observation === "terminal") {
        return;
      }
    }
    const createBridgeLogEntry = (message: string, type: LogEntry["type"]) =>
      createLogEntry(message, type, event.timestamp);

    if (event.type === "started") {
      const stopRequestedBeforeStart = script?.status === "STOPPING";
      if (event.runId) {
        rememberRuntimeRun(pendingRuntimeTerminalEventKey(event.projectId, event.scriptId, event.runId), "active");
      }
      if (script) {
        script.status = stopRequestedBeforeStart ? "STOPPING" : "RUNNING";
        script.pid = event.pid;
        script.runId = event.runId ?? script.runId;
        script.runtimeOwner = event.runtimeOwner ?? script.runtimeOwner;
      }
      if (project) {
        project.status = deriveProjectStatus(project);
        project.lastUpdated = new Date().toLocaleString();
      }
      const launchContext = [
        `started (pid ${event.pid})`,
        event.message ? (event.runtimeOwner === "service" ? event.message : `command: ${event.message}`) : "",
        event.cwd ? `cwd: ${event.cwd}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      this.addLog(event.projectId, createBridgeLogEntry(launchContext, "SUCCESS"), event.scriptId);
      if (event.runId) {
        const pendingKey = pendingRuntimeTerminalEventKey(event.projectId, event.scriptId, event.runId);
        const pendingEvent = pendingRuntimeTerminalEvents.get(pendingKey);
        if (pendingEvent) {
          pendingRuntimeTerminalEvents.delete(pendingKey);
          this.handleBridgeEvent(pendingEvent);
        }
      }
      if (stopRequestedBeforeStart && script?.status === "STOPPING") {
        scheduleProcessStop(event.pid || 0, {
          ...(event.runId === undefined ? {} : { runId: event.runId }),
          ...(event.runtimeOwner === undefined ? {} : { runtimeOwner: event.runtimeOwner }),
        });
      }
    }

    if (event.type === "stdout" || event.type === "stderr") {
      const outputSource = event.type;
      normalizeLogLines(event.message || "").forEach((line) => {
        this.addLog(
          event.projectId,
          createBridgeLogEntry(line, classifyProcessOutputLine(line, outputSource)),
          event.scriptId,
        );
      });
    }

    if (event.type === "stdin") {
      this.addLog(event.projectId, createBridgeLogEntry(`> ${event.message || ""}`, "INFO"), event.scriptId);
    }

    if (event.type === "exit") {
      if (event.runId) {
        rememberRuntimeRun(pendingRuntimeTerminalEventKey(event.projectId, event.scriptId, event.runId), "terminal");
      }
      const isStopped = Boolean(event.stoppedByUser || script?.status === "STOPPING");
      const isSuccess = isSuccessfulAutomationProcessResult(event);
      if (script) {
        script.status = isStopped ? "STOPPED" : isSuccess ? "IDLE" : "ERROR";
        script.pid = undefined;
        script.runId = undefined;
        script.runtimeOwner = undefined;
      }
      if (project) {
        project.status = deriveProjectStatus(project);
        project.lastUpdated = new Date().toLocaleString();
      }
      this.addLog(
        event.projectId,
        createBridgeLogEntry(
          isStopped ? "stopped" : `exited with code ${event.code ?? "unknown"}`,
          isSuccess || isStopped ? "SUCCESS" : "ERROR",
        ),
        event.scriptId,
      );
    }

    if (event.type === "error") {
      if (event.runId) {
        rememberRuntimeRun(pendingRuntimeTerminalEventKey(event.projectId, event.scriptId, event.runId), "terminal");
      }
      if (script) {
        script.status = "ERROR";
        script.pid = undefined;
        script.runId = undefined;
        script.runtimeOwner = undefined;
      }
      if (project) {
        project.status = deriveProjectStatus(project);
        project.lastUpdated = new Date().toLocaleString();
      }
      this.addLog(
        event.projectId,
        createBridgeLogEntry(normalizeLogLines(event.message || "command failed")[0] || "command failed", "ERROR"),
        event.scriptId,
      );
    }
    this.handleAutomationBridgeEvent(event);
  }
};
