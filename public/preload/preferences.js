// Device-scoped preferences. Every section is stored inside the plugin local
// data directory (local-state.v1.json) and never enters the syncing utools
// database. Legacy dbStorage/localStorage cascades were removed on purpose:
// the v8 migration is the only component that reads the old locations, and the
// startup gate blocks the app until it has completed.

function readNormalizedLocalPreference(section, normalize, getDefault) {
  return readLocalStatePreference(section, normalize, getDefault);
}

function saveNormalizedLocalPreference(section, value, normalize) {
  return saveLocalStatePreference(section, value, normalize);
}

function readTerminalPreferences() {
  return readNormalizedLocalPreference("terminal", normalizeTerminalPreferences, getDefaultTerminalPreferences);
}

function saveTerminalPreferences(preferences) {
  return saveNormalizedLocalPreference("terminal", preferences, normalizeTerminalPreferences);
}

function saveExternalApplicationPreferences(preferences) {
  return saveNormalizedLocalPreference(
    "externalApplications",
    preferences,
    normalizeExternalApplicationPreferences,
  );
}

function readExternalApplicationPreferences() {
  return readNormalizedLocalPreference(
    "externalApplications",
    normalizeExternalApplicationPreferences,
    getDefaultExternalApplicationPreferences,
  );
}

const projectDetailsTabIds = ["info", "scripts", "automation", "files", "git", "memo"];
const projectDetailsTabIdSet = new Set(projectDetailsTabIds);
function normalizeStoredIconPackId(value) {
  return value === "vscode-icons-derived" ? value : "builtin";
}

function getDefaultUiPreferences() {
  return {
    schemaVersion: 1,
    iconPackId: "builtin",
    projectDetails: { tabOrder: [...projectDetailsTabIds], defaultTab: "scripts" },
    dashboard: { tinyCardActionTrigger: "hover" },
    coachMarks: { projectDetailsTabReorder: 0, projectDetailsTabDefault: 0 },
  };
}

function normalizeProjectDetailsTabOrder(value) {
  const knownIds = Array.isArray(value) ? value.filter((id) => projectDetailsTabIdSet.has(id)) : [];
  return [...new Set(knownIds), ...projectDetailsTabIds.filter((id) => !knownIds.includes(id))];
}

function normalizeProjectDetailsDefaultTab(value) {
  return projectDetailsTabIdSet.has(value) ? value : "scripts";
}

function normalizeUiPreferences(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) return getDefaultUiPreferences();
  const coachMarkVersion = value.coachMarks?.projectDetailsTabReorder;
  const defaultCoachMarkVersion = value.coachMarks?.projectDetailsTabDefault;
  const tinyCardActionTrigger = value.dashboard?.tinyCardActionTrigger;
  return {
    schemaVersion: 1,
    iconPackId: normalizeStoredIconPackId(value.iconPackId),
    projectDetails: {
      tabOrder: normalizeProjectDetailsTabOrder(value.projectDetails?.tabOrder),
      defaultTab: normalizeProjectDetailsDefaultTab(value.projectDetails?.defaultTab),
    },
    dashboard: { tinyCardActionTrigger: tinyCardActionTrigger === "contextmenu" ? "contextmenu" : "hover" },
    coachMarks: {
      projectDetailsTabReorder: Number.isInteger(coachMarkVersion) && coachMarkVersion >= 0 ? coachMarkVersion : 0,
      projectDetailsTabDefault:
        Number.isInteger(defaultCoachMarkVersion) && defaultCoachMarkVersion >= 0 ? defaultCoachMarkVersion : 0,
    },
  };
}

function saveUiPreferences(preferences) {
  return saveNormalizedLocalPreference("ui", preferences, normalizeUiPreferences);
}

function readUiPreferences() {
  return readNormalizedLocalPreference("ui", normalizeUiPreferences, getDefaultUiPreferences);
}

function readEnvironmentPreferences() {
  return readNormalizedLocalPreference("environment", normalizeEnvironmentPreferences, getDefaultEnvironmentPreferences);
}

function saveEnvironmentPreferences(preferences) {
  return saveNormalizedLocalPreference("environment", preferences, normalizeEnvironmentPreferences);
}

function readAiPreferences() {
  return readNormalizedLocalPreference("ai", normalizeAiPreferences, getDefaultAiPreferences);
}

function saveAiPreferences(preferences) {
  return saveNormalizedLocalPreference("ai", preferences, normalizeAiPreferences);
}

function getDefaultProjectLaunchServicePreferences() {
  return { schemaVersion: 1, enabled: false };
}

function normalizeProjectLaunchServicePreferences(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) {
    return getDefaultProjectLaunchServicePreferences();
  }
  return { schemaVersion: 1, enabled: value.enabled === true };
}

function readProjectLaunchServicePreferences() {
  return readNormalizedLocalPreference(
    "projectLaunchService",
    normalizeProjectLaunchServicePreferences,
    getDefaultProjectLaunchServicePreferences,
  );
}

function saveProjectLaunchServicePreferences(preferences) {
  const normalized = normalizeProjectLaunchServicePreferences(preferences);
  const result = saveNormalizedLocalPreference("projectLaunchService", normalized, normalizeProjectLaunchServicePreferences);
  if (!normalized.enabled) {
    projectLaunchServiceLastBroadcastSignature = "";
    projectLaunchServiceCancelSync?.();
    projectLaunchServiceSyncRevision = '';
    projectLaunchServiceRetryDelayMs = 0;
  }
  if (normalized.enabled && pluginLocalDataDirectory() && fs.existsSync(projectLaunchServiceDiscoveryPath())) {
    scheduleProjectLaunchServiceEventPoll(0);
  } else if (projectLaunchServiceEventPollTimer) {
    clearTimeout(projectLaunchServiceEventPollTimer);
    projectLaunchServiceEventPollTimer = null;
  }
  return result;
}
