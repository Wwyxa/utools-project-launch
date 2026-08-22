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

function getDefaultUiPreferences() {
  return {
    schemaVersion: 1,
    projectDetails: { tabOrder: [...projectDetailsTabIds] },
    dashboard: { tinyCardActionTrigger: "hover" },
    coachMarks: { projectDetailsTabReorder: 0 },
  };
}

function normalizeProjectDetailsTabOrder(value) {
  const knownIds = Array.isArray(value) ? value.filter((id) => projectDetailsTabIdSet.has(id)) : [];
  return [...new Set(knownIds), ...projectDetailsTabIds.filter((id) => !knownIds.includes(id))];
}

function normalizeUiPreferences(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) return getDefaultUiPreferences();
  const coachMarkVersion = value.coachMarks?.projectDetailsTabReorder;
  const tinyCardActionTrigger = value.dashboard?.tinyCardActionTrigger;
  return {
    schemaVersion: 1,
    projectDetails: { tabOrder: normalizeProjectDetailsTabOrder(value.projectDetails?.tabOrder) },
    dashboard: { tinyCardActionTrigger: tinyCardActionTrigger === "contextmenu" ? "contextmenu" : "hover" },
    coachMarks: {
      projectDetailsTabReorder: Number.isInteger(coachMarkVersion) && coachMarkVersion >= 0 ? coachMarkVersion : 0,
    },
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
