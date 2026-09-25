import type { ProjectGitActivityCriteria, WorkActivityPreferences, WorkspaceState } from "../../types";
import { bridge } from "./bridge";

export const defaultWorkspaceState = (): WorkspaceState => ({
  dashboardProjectGroup: "all",
  workActivity: {
    selectionInitialized: false,
    preferences: null,
    selectedProjectIds: [],
  },
});


export function loadPersistedWorkspaceState(): WorkspaceState {
  try {
    const persisted = bridge.loadWorkspaceState();
    const workActivity = persisted?.workActivity;
    return {
      dashboardProjectGroup:
        typeof persisted?.dashboardProjectGroup === "string" && persisted.dashboardProjectGroup
          ? persisted.dashboardProjectGroup
          : "all",
      workActivity: {
        selectionInitialized: workActivity?.selectionInitialized === true,
        preferences:
          workActivity?.preferences && typeof workActivity.preferences === "object"
            ? workActivity.preferences
            : null,
        selectedProjectIds: Array.isArray(workActivity?.selectedProjectIds)
          ? workActivity.selectedProjectIds.filter((projectId): projectId is string => Boolean(projectId))
          : [],
      },
    };
  } catch (error) {
    return defaultWorkspaceState();
  }
}


export function mergeWorkActivityPreferences(persisted: Partial<WorkActivityPreferences> | null): WorkActivityPreferences {
  const defaults = defaultWorkActivityPreferences();
  if (!persisted || typeof persisted !== "object") return defaults;
  return { ...defaults, ...persisted };
}

// New public-project environment variables whose names look like credentials
// default to staying on this device; users can always change the choice.

export const defaultWorkActivityPreferences = (): WorkActivityPreferences => ({
  rangeMode: "rolling",
  selectedYear: new Date().getFullYear(),
  customStartDate: "",
  customEndDate: "",
  refScope: "all",
  timeZone: "local",
  hideMerges: false,
  excludeBots: false,
  botPatterns: ["\\[bot\\]$", "(^|[+._-])bot@"],
  identities: [],
  selectedAuthorId: "current",
  projectGroups: [],
});


export const workActivityGitCriteria = (preferences: WorkActivityPreferences): ProjectGitActivityCriteria => {
  const {
    rangeMode: _rangeMode,
    selectedYear: _selectedYear,
    customStartDate: _customStartDate,
    customEndDate: _customEndDate,
    selectedAuthorId: _selectedAuthorId,
    projectGroups: _projectGroups,
    ...criteria
  } = preferences;
  return criteria;
};

