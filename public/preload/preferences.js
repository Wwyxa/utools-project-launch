function readStoredValue(key) {
  if (window.utools?.dbStorage) {
    return window.utools.dbStorage.getItem(key);
  }
  const raw = window.localStorage?.getItem(key);
  return raw === null || raw === undefined ? raw : JSON.parse(raw);
}

function writeStoredValue(key, value) {
  if (window.utools?.dbStorage) {
    window.utools.dbStorage.setItem(key, value);
    return;
  }
  window.localStorage?.setItem(key, JSON.stringify(value));
}

function removeStoredValue(key) {
  if (window.utools?.dbStorage) {
    window.utools.dbStorage.removeItem(key);
    return;
  }
  window.localStorage?.removeItem(key);
}

function readNormalizedStoredValue(key, normalize, getDefault) {
  try {
    return normalize(readStoredValue(key));
  } catch (error) {
    return getDefault();
  }
}

function writeNormalizedStoredValue(key, value, normalize) {
  const normalized = normalize(value);
  try {
    writeStoredValue(key, normalized);
  } catch (error) {
    // Keep settings updates non-blocking when host storage is unavailable.
  }
}

function readTerminalPreferences() {
  try {
    if (window.utools?.dbStorage) {
      const storedPreferences = window.utools.dbStorage.getItem(localTerminalPreferencesStorageKey);
      if (storedPreferences !== null && storedPreferences !== undefined) {
        const preferences = normalizeTerminalPreferences(storedPreferences);
        saveTerminalPreferences(preferences);
        return preferences;
      }
    }

    const current = window.localStorage?.getItem(localTerminalPreferencesStorageKey);
    if (current !== null && current !== undefined) {
      const preferences = normalizeTerminalPreferences(JSON.parse(current));
      saveTerminalPreferences(preferences);
      return preferences;
    }

    if (window.utools?.dbStorage) {
      const legacyPreferences = window.utools.dbStorage.getItem(terminalPreferencesStorageKey);
      if (legacyPreferences !== null && legacyPreferences !== undefined) {
        const preferences = normalizeTerminalPreferences(legacyPreferences);
        saveTerminalPreferences(preferences);
        return preferences;
      }
    }

    const raw = window.localStorage?.getItem(terminalPreferencesStorageKey);
    if (!raw) {
      return getDefaultTerminalPreferences();
    }
    const preferences = normalizeTerminalPreferences(JSON.parse(raw));
    saveTerminalPreferences(preferences);
    return preferences;
  } catch (error) {
    return getDefaultTerminalPreferences();
  }
}

function saveTerminalPreferences(preferences) {
  writeNormalizedStoredValue(localTerminalPreferencesStorageKey, preferences, normalizeTerminalPreferences);
}

function saveExternalApplicationPreferences(preferences) {
  writeNormalizedStoredValue(
    externalApplicationPreferencesStorageKey,
    preferences,
    normalizeExternalApplicationPreferences,
  );
}

function readExternalApplicationPreferences() {
  try {
    if (window.utools?.dbStorage) {
      const storedPreferences = window.utools.dbStorage.getItem(externalApplicationPreferencesStorageKey);
      if (storedPreferences !== null && storedPreferences !== undefined) {
        const preferences = normalizeExternalApplicationPreferences(storedPreferences);
        saveExternalApplicationPreferences(preferences);
        return preferences;
      }
    }

    const current = window.localStorage?.getItem(externalApplicationPreferencesStorageKey);
    const localLegacy = window.localStorage?.getItem(localEditorPreferencesStorageKey);
    const preferences =
      typeof current === "string"
        ? normalizeExternalApplicationPreferences(JSON.parse(current))
        : migrateEditorPreferences(
            JSON.parse(
              typeof localLegacy === "string"
                ? localLegacy
                : window.localStorage?.getItem(editorPreferencesStorageKey) || "null",
            ),
          );
    saveExternalApplicationPreferences(preferences);
    return preferences;
  } catch (error) {
    const preferences = getDefaultExternalApplicationPreferences();
    saveExternalApplicationPreferences(preferences);
    return preferences;
  }
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
    workActivity: {
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
    },
  };
}

function normalizeProjectDetailsTabOrder(value) {
  const knownIds = Array.isArray(value) ? value.filter((id) => projectDetailsTabIdSet.has(id)) : [];
  return [...new Set(knownIds), ...projectDetailsTabIds.filter((id) => !knownIds.includes(id))];
}

function normalizeProjectDetailsDefaultTab(value) {
  return projectDetailsTabIdSet.has(value) ? value : "scripts";
}

function normalizeWorkActivityDate(value) {
  const candidate = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : "";
}

function normalizeWorkActivityPreferences(value) {
  const defaults = getDefaultUiPreferences().workActivity;
  if (!value || typeof value !== "object") return defaults;
  const timeZone = String(value.timeZone || "").trim();
  let validTimeZone = timeZone === "local";
  if (!validTimeZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format();
      validTimeZone = true;
    } catch (error) {
      validTimeZone = false;
    }
  }
  const identities = Array.isArray(value.identities)
    ? value.identities
        .filter((identity) => identity && typeof identity === "object")
        .map((identity) => ({
          id: String(identity.id || "").trim(),
          name: String(identity.name || "").trim(),
          emails: [
            ...new Set(
              (Array.isArray(identity.emails) ? identity.emails : [])
                .map((email) => String(email).trim().toLocaleLowerCase())
                .filter((email) => email && !/\s/.test(email)),
            ),
          ],
          names: [
            ...new Set(
              (Array.isArray(identity.names) ? identity.names : []).map((name) => String(name).trim()).filter(Boolean),
            ),
          ],
        }))
        .filter((identity) => identity.id && identity.name)
        .filter((identity, index, values) => values.findIndex((item) => item.id === identity.id) === index)
    : [];
  const selectedYear = Number.isInteger(value.selectedYear)
    ? Math.min(9999, Math.max(1970, value.selectedYear))
    : new Date().getFullYear();
  const legacyCalendarYear = value.rangeMode === "year";
  return {
    rangeMode: ["days7", "days30", "days90", "currentYear", "custom"].includes(value.rangeMode)
      ? value.rangeMode
      : legacyCalendarYear
        ? "custom"
        : "rolling",
    selectedYear,
    customStartDate: legacyCalendarYear
      ? `${String(selectedYear).padStart(4, "0")}-01-01`
      : normalizeWorkActivityDate(value.customStartDate),
    customEndDate: legacyCalendarYear
      ? `${String(selectedYear).padStart(4, "0")}-12-31`
      : normalizeWorkActivityDate(value.customEndDate),
    refScope: value.refScope === "current" || value.refScope === "default" ? value.refScope : "all",
    timeZone: validTimeZone ? timeZone : "local",
    hideMerges: value.hideMerges === true,
    excludeBots: value.excludeBots === true,
    botPatterns: Array.isArray(value.botPatterns)
      ? [...new Set(value.botPatterns.map((pattern) => String(pattern).trim()).filter(Boolean))].slice(0, 20)
      : defaults.botPatterns,
    identities,
  };
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
    workActivity: normalizeWorkActivityPreferences(value.workActivity),
  };
}

function saveUiPreferences(preferences) {
  const normalized = normalizeUiPreferences(preferences);
  try {
    writeStoredValue(uiPreferencesStorageKey, normalized);
    removeStoredValue(projectDetailsTabOrderStorageKey);
  } catch (error) {
    // Keep UI preference updates non-blocking when host storage is temporarily unavailable.
  }
}

function readUiPreferences() {
  try {
    if (window.utools?.dbStorage) {
      const storedPreferences = window.utools.dbStorage.getItem(uiPreferencesStorageKey);
      if (storedPreferences !== null && storedPreferences !== undefined) {
        const preferences = normalizeUiPreferences(storedPreferences);
        try {
          removeStoredValue(projectDetailsTabOrderStorageKey);
        } catch (error) {
          // Legacy cleanup must not invalidate readable current preferences.
        }
        return preferences;
      }
      const legacyValue = window.utools.dbStorage.getItem(projectDetailsTabOrderStorageKey);
      const tabOrder = normalizeProjectDetailsTabOrder(legacyValue);
      const preferences = normalizeUiPreferences({
        schemaVersion: 1,
        projectDetails: { tabOrder },
        coachMarks: {
          projectDetailsTabReorder:
            Array.isArray(legacyValue) && tabOrder.some((id, index) => id !== projectDetailsTabIds[index]) ? 1 : 0,
        },
      });
      saveUiPreferences(preferences);
      return preferences;
    }

    const raw = window.localStorage?.getItem(uiPreferencesStorageKey);
    if (raw !== null && raw !== undefined) {
      const preferences = normalizeUiPreferences(JSON.parse(raw));
      try {
        removeStoredValue(projectDetailsTabOrderStorageKey);
      } catch (error) {
        // Legacy cleanup must not invalidate readable current preferences.
      }
      return preferences;
    }
    const legacyRaw = window.localStorage?.getItem(projectDetailsTabOrderStorageKey);
    const legacyValue = legacyRaw ? JSON.parse(legacyRaw) : null;
    const tabOrder = normalizeProjectDetailsTabOrder(legacyValue);
    const preferences = normalizeUiPreferences({
      schemaVersion: 1,
      projectDetails: { tabOrder },
      coachMarks: {
        projectDetailsTabReorder:
          Array.isArray(legacyValue) && tabOrder.some((id, index) => id !== projectDetailsTabIds[index]) ? 1 : 0,
      },
    });
    saveUiPreferences(preferences);
    return preferences;
  } catch (error) {
    return getDefaultUiPreferences();
  }
}

function readEnvironmentPreferences() {
  return readNormalizedStoredValue(
    environmentPreferencesStorageKey,
    normalizeEnvironmentPreferences,
    getDefaultEnvironmentPreferences,
  );
}

function saveEnvironmentPreferences(preferences) {
  writeNormalizedStoredValue(environmentPreferencesStorageKey, preferences, normalizeEnvironmentPreferences);
}

function readAiPreferences() {
  return readNormalizedStoredValue(aiPreferencesStorageKey, normalizeAiPreferences, getDefaultAiPreferences);
}

function saveAiPreferences(preferences) {
  writeNormalizedStoredValue(aiPreferencesStorageKey, preferences, normalizeAiPreferences);
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
  return readNormalizedStoredValue(
    projectLaunchServicePreferencesStorageKey,
    normalizeProjectLaunchServicePreferences,
    getDefaultProjectLaunchServicePreferences,
  );
}

function saveProjectLaunchServicePreferences(preferences) {
  const normalized = normalizeProjectLaunchServicePreferences(preferences);
  try {
    writeStoredValue(projectLaunchServicePreferencesStorageKey, normalized);
  } catch (error) {
    // Keep service preference updates non-blocking when host storage is unavailable.
  }
  if (!normalized.enabled) {
    projectLaunchServiceLastBroadcastSignature = "";
  }
  if (normalized.enabled && fs.existsSync(projectLaunchServiceDiscoveryPath())) {
    scheduleProjectLaunchServiceEventPoll(0);
  } else if (projectLaunchServiceEventPollTimer) {
    clearTimeout(projectLaunchServiceEventPollTimer);
    projectLaunchServiceEventPollTimer = null;
  }
}
