import { ProjectStatus } from "../types";
import type { Project, ProjectScript } from "../types";

const activeScriptStatuses = new Set<ProjectScript["status"]>(["RUNNING", "STOPPING"]);

export function isActiveScriptStatus(status: ProjectScript["status"]) {
  return activeScriptStatuses.has(status);
}

export function mergeScriptRuntimeState(nextScripts: ProjectScript[], previousScripts: ProjectScript[]) {
  const previousById = new Map(previousScripts.map((script) => [script.id, script]));
  const previousByName = new Map(previousScripts.map((script) => [script.name, script]));

  return nextScripts.map((script) => {
    const previousScript = previousById.get(script.id) || previousByName.get(script.name);
    if (!previousScript || !isActiveScriptStatus(previousScript.status)) {
      return script;
    }

    return {
      ...script,
      status: previousScript.status,
      pid: previousScript.pid,
    };
  });
}

export function deriveProjectStatus(project: Pick<Project, "pathExists" | "scripts">): ProjectStatus {
  if (project.pathExists === false) {
    return ProjectStatus.WARNING;
  }
  if (project.scripts.some((script) => isActiveScriptStatus(script.status))) {
    return ProjectStatus.RUNNING;
  }
  if (project.scripts.some((script) => script.status === "ERROR")) {
    return ProjectStatus.ERROR;
  }
  return ProjectStatus.STOPPED;
}
