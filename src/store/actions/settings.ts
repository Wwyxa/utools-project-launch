import type { AppStore } from "../appStoreShape";
import type { ProjectDetailsTabId, TinyCardActionTrigger, DefaultTerminalKind, ExternalApplicationPreferences, EnvironmentToolKey, EnvironmentPreferences, CustomEnvironmentTool, BuiltinEnvironmentToolOverride, EnvironmentToolResult } from "../../types";
import { normalizeUiPreferences, normalizeExternalApplicationPreferences } from "../../lib/projectBridge";
import { bridge } from "../helpers/bridge";
import { createExternalApplicationId, createCustomEnvironmentToolId } from "../helpers/projectHelpers";
import type { CustomEnvironmentToolInput } from "../../lib/environmentTools";
import { validateCustomEnvironmentToolInput, environmentToolRequest } from "../../lib/environmentTools";

export const PROJECT_CONFIG_MESSAGE_CLEAR_DELAY_MS = 4000;

export let projectConfigMessageClearTimer: number | null = null;

export function cancelProjectConfigMessageClear() {
  if (projectConfigMessageClearTimer) {
    window.clearTimeout(projectConfigMessageClearTimer);
    projectConfigMessageClearTimer = null;
  }
}

export const settingsActions = {
  setProjectDetailsTabOrder(this: AppStore, order: ProjectDetailsTabId[]) {
    const nextPreferences = normalizeUiPreferences({
      ...this.uiPreferences,
      projectDetails: { ...this.uiPreferences.projectDetails, tabOrder: order },
    });
    const unchanged = nextPreferences.projectDetails.tabOrder.every(
      (id, index) => id === this.uiPreferences.projectDetails.tabOrder[index],
    );
    if (unchanged) {
      return;
    }
    this.uiPreferences = nextPreferences;
    bridge.saveUiPreferences(this.uiPreferences);
  },

  setProjectDetailsDefaultTab(this: AppStore, tab: ProjectDetailsTabId) {
    const nextPreferences = normalizeUiPreferences({
      ...this.uiPreferences,
      projectDetails: { ...this.uiPreferences.projectDetails, defaultTab: tab },
    });
    if (nextPreferences.projectDetails.defaultTab === this.uiPreferences.projectDetails.defaultTab) {
      return;
    }
    this.uiPreferences = nextPreferences;
    bridge.saveUiPreferences(this.uiPreferences);
  },

  setTinyCardActionTrigger(this: AppStore, trigger: TinyCardActionTrigger) {
    if (this.uiPreferences.dashboard.tinyCardActionTrigger === trigger) {
      return;
    }
    this.uiPreferences = normalizeUiPreferences({
      ...this.uiPreferences,
      dashboard: { tinyCardActionTrigger: trigger },
    });
    bridge.saveUiPreferences(this.uiPreferences);
  },

  acknowledgeProjectDetailsTabReorderHint(this: AppStore, version: number) {
    if (
      !Number.isInteger(version) ||
      version < 0 ||
      this.uiPreferences.coachMarks.projectDetailsTabReorder >= version
    ) {
      return;
    }
    this.uiPreferences = normalizeUiPreferences({
      ...this.uiPreferences,
      coachMarks: { ...this.uiPreferences.coachMarks, projectDetailsTabReorder: version },
    });
    bridge.saveUiPreferences(this.uiPreferences);
  },

  acknowledgeProjectDetailsTabDefaultHint(this: AppStore, version: number) {
    if (
      !Number.isInteger(version) ||
      version < 0 ||
      this.uiPreferences.coachMarks.projectDetailsTabDefault >= version
    ) {
      return;
    }
    this.uiPreferences = normalizeUiPreferences({
      ...this.uiPreferences,
      coachMarks: { ...this.uiPreferences.coachMarks, projectDetailsTabDefault: version },
    });
    bridge.saveUiPreferences(this.uiPreferences);
  },

  setProjectConfigMessage(this: AppStore, message: string) {
    cancelProjectConfigMessageClear();
    this.projectConfigMessage = message;
    if (!message) {
      return;
    }

    projectConfigMessageClearTimer = window.setTimeout(() => {
      if (this.projectConfigMessage === message) {
        this.projectConfigMessage = "";
      }
      projectConfigMessageClearTimer = null;
    }, PROJECT_CONFIG_MESSAGE_CLEAR_DELAY_MS);
  },

  setDefaultTerminal(this: AppStore, kind: DefaultTerminalKind) {
    this.terminalPreferences = { ...this.terminalPreferences, kind };
    bridge.saveTerminalPreferences(this.terminalPreferences);
  },

  setDefaultTerminalCustomCommand(this: AppStore, command: string) {
    this.terminalPreferences = { ...this.terminalPreferences, kind: "custom", customCommand: command };
    bridge.saveTerminalPreferences(this.terminalPreferences);
  },

  persistExternalApplicationPreferences(this: AppStore, preferences: ExternalApplicationPreferences) {
    this.externalApplicationPreferences = normalizeExternalApplicationPreferences(preferences);
    bridge.saveExternalApplicationPreferences({
      ...this.externalApplicationPreferences,
      applications: this.externalApplicationPreferences.applications.map((application) => ({ ...application })),
    });
  },

  addExternalApplication(this: AppStore, name: string, command: string) {
    const normalizedName = name.trim();
    const normalizedCommand = command.trim();
    if (
      !normalizedName ||
      !normalizedCommand ||
      this.externalApplicationPreferences.applications.some(
        (application) => application.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
      )
    ) {
      return false;
    }
    this.persistExternalApplicationPreferences({
      ...this.externalApplicationPreferences,
      applications: [
        ...this.externalApplicationPreferences.applications,
        {
          id: createExternalApplicationId(),
          name: normalizedName,
          kind: "custom",
          command: normalizedCommand,
          enabled: true,
        },
      ],
    });
    return true;
  },

  updateExternalApplication(this: AppStore, id: string, name: string, command: string) {
    const application = this.externalApplicationPreferences.applications.find((item) => item.id === id);
    const normalizedName = name.trim();
    const normalizedCommand = command.trim();
    if (
      !application ||
      !normalizedName ||
      !normalizedCommand ||
      this.externalApplicationPreferences.applications.some(
        (item) => item.id !== id && item.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
      )
    ) {
      return false;
    }
    this.persistExternalApplicationPreferences({
      ...this.externalApplicationPreferences,
      applications: this.externalApplicationPreferences.applications.map((item) =>
        item.id === id ? { ...item, name: normalizedName, command: normalizedCommand } : item,
      ),
    });
    return true;
  },

  setExternalApplicationEnabled(this: AppStore, id: string, enabled: boolean) {
    const application = this.externalApplicationPreferences.applications.find((item) => item.id === id);
    if (
      !application ||
      application.enabled === enabled ||
      (!enabled && id === this.externalApplicationPreferences.defaultApplicationId)
    ) {
      return false;
    }
    this.persistExternalApplicationPreferences({
      ...this.externalApplicationPreferences,
      applications: this.externalApplicationPreferences.applications.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      ),
    });
    return true;
  },

  deleteExternalApplication(this: AppStore, id: string) {
    const application = this.externalApplicationPreferences.applications.find((item) => item.id === id);
    if (application?.kind !== "custom" || id === this.externalApplicationPreferences.defaultApplicationId) {
      return false;
    }
    this.persistExternalApplicationPreferences({
      ...this.externalApplicationPreferences,
      applications: this.externalApplicationPreferences.applications.filter((item) => item.id !== id),
    });
    return true;
  },

  setDefaultExternalApplication(this: AppStore, id: string) {
    if (
      id === this.externalApplicationPreferences.defaultApplicationId ||
      !this.externalApplicationPreferences.applications.some(
        (application) => application.id === id && application.enabled,
      )
    ) {
      return false;
    }
    this.persistExternalApplicationPreferences({
      ...this.externalApplicationPreferences,
      defaultApplicationId: id,
    });
    return true;
  },

  restoreExternalApplicationNativeLaunch(this: AppStore, id: string) {
    const application = this.externalApplicationPreferences.applications.find((item) => item.id === id);
    if (!application || application.kind === "custom") return false;
    const builtin = application.kind === "vscode" ? "code {path}" : "cursor {path}";
    this.persistExternalApplicationPreferences({
      ...this.externalApplicationPreferences,
      applications: this.externalApplicationPreferences.applications.map((item) =>
        item.id === id ? { ...item, command: builtin } : item,
      ),
    });
    return true;
  },

  setEnvironmentToolEnabled(this: AppStore, key: EnvironmentToolKey, enabled: boolean) {
    const keys = new Set<EnvironmentToolKey>(this.environmentPreferences.enabledToolKeys);
    if (keys.has(key) === enabled) return;
    if (enabled) {
      keys.add(key);
    } else {
      keys.delete(key);
    }
    const nextPreferences: EnvironmentPreferences = {
      ...this.environmentPreferences,
      enabledToolKeys: Array.from(keys),
    };
    this.environmentPreferences = nextPreferences;
    bridge.saveEnvironmentPreferences(nextPreferences);
    this.invalidateEnvironmentTool(key);
  },

  invalidateEnvironmentTool(this: AppStore, key: string) {
    this.environmentRequestGenerations[key] = (this.environmentRequestGenerations[key] || 0) + 1;
    this.environmentRefreshingKeys[key] = false;
    this.environmentResults = this.environmentResults.filter((result) => result.key !== key);
  },

  addCustomEnvironmentTool(this: AppStore, input: CustomEnvironmentToolInput) {
    const validation = validateCustomEnvironmentToolInput(input);
    if (!validation.value) return { ok: false as const, errors: validation.errors };
    const tool: CustomEnvironmentTool = {
      id: createCustomEnvironmentToolId(),
      ...validation.value,
      enabled: true,
    };
    this.environmentPreferences = {
      ...this.environmentPreferences,
      customTools: [...this.environmentPreferences.customTools, tool],
    };
    bridge.saveEnvironmentPreferences(this.environmentPreferences);
    return { ok: true as const, tool };
  },

  updateCustomEnvironmentTool(this: AppStore, id: string, input: CustomEnvironmentToolInput) {
    const existing = this.environmentPreferences.customTools.find((tool) => tool.id === id);
    const validation = validateCustomEnvironmentToolInput(input);
    if (!existing || !validation.value) return { ok: false as const, errors: validation.errors };
    const tool = { ...existing, ...validation.value };
    this.environmentPreferences = {
      ...this.environmentPreferences,
      customTools: this.environmentPreferences.customTools.map((item) => (item.id === id ? tool : item)),
    };
    bridge.saveEnvironmentPreferences(this.environmentPreferences);
    this.invalidateEnvironmentTool(id);
    return { ok: true as const, tool };
  },

  setCustomEnvironmentToolEnabled(this: AppStore, id: string, enabled: boolean) {
    const existing = this.environmentPreferences.customTools.find((tool) => tool.id === id);
    if (!existing || existing.enabled === enabled) return;
    this.environmentPreferences = {
      ...this.environmentPreferences,
      customTools: this.environmentPreferences.customTools.map((tool) =>
        tool.id === id ? { ...tool, enabled } : tool,
      ),
    };
    bridge.saveEnvironmentPreferences(this.environmentPreferences);
    this.invalidateEnvironmentTool(id);
  },

  deleteCustomEnvironmentTool(this: AppStore, id: string) {
    if (!this.environmentPreferences.customTools.some((tool) => tool.id === id)) return;
    this.environmentPreferences = {
      ...this.environmentPreferences,
      customTools: this.environmentPreferences.customTools.filter((tool) => tool.id !== id),
    };
    bridge.saveEnvironmentPreferences(this.environmentPreferences);
    this.invalidateEnvironmentTool(id);
  },

  saveBuiltinEnvironmentToolOverride(this: AppStore,
    key: EnvironmentToolKey,
    input: Pick<CustomEnvironmentToolInput, "command" | "versionArgs">,
  ) {
    const definition = this.builtinEnvironmentTools.find((tool) => tool.key === key);
    const validation = validateCustomEnvironmentToolInput({ name: definition?.name || "", ...input });
    if (!definition || !validation.value) return { ok: false as const, errors: validation.errors };
    const matchesDefault =
      validation.value.command === definition.command &&
      JSON.stringify(validation.value.versionArgs) === JSON.stringify(definition.versionArgs);
    const override: BuiltinEnvironmentToolOverride | null = matchesDefault
      ? null
      : { key, command: validation.value.command, versionArgs: validation.value.versionArgs };
    this.environmentPreferences = {
      ...this.environmentPreferences,
      builtinOverrides: [
        ...this.environmentPreferences.builtinOverrides.filter((item) => item.key !== key),
        ...(override ? [override] : []),
      ],
    };
    bridge.saveEnvironmentPreferences(this.environmentPreferences);
    this.invalidateEnvironmentTool(key);
    return { ok: true as const, override };
  },

  restoreBuiltinEnvironmentTool(this: AppStore, key: EnvironmentToolKey) {
    if (!this.environmentPreferences.builtinOverrides.some((item) => item.key === key)) return;
    this.environmentPreferences = {
      ...this.environmentPreferences,
      builtinOverrides: this.environmentPreferences.builtinOverrides.filter((item) => item.key !== key),
    };
    bridge.saveEnvironmentPreferences(this.environmentPreferences);
    this.invalidateEnvironmentTool(key);
  },

  async refreshEnvironmentTools(this: AppStore, targetKeys?: string[]) {
    const enabledKeys = [
      ...this.environmentPreferences.enabledToolKeys,
      ...this.environmentPreferences.customTools.filter((tool) => tool.enabled).map((tool) => tool.id),
    ];
    const requestedKeys = Array.from(new Set(targetKeys || enabledKeys)).filter((key) => enabledKeys.includes(key));
    const requests = requestedKeys
      .map((key) => ({
        key,
        request: environmentToolRequest(
          key,
          this.environmentPreferences.customTools,
          this.environmentPreferences.builtinOverrides,
          this.builtinEnvironmentTools,
        ),
      }))
      .filter((item): item is { key: string; request: NonNullable<typeof item.request> } => item.request !== null);
    if (requests.length === 0) {
      this.environmentChecked = true;
      return;
    }
    this.environmentActiveRefreshes += 1;
    this.environmentRefreshing = true;
    const generations = new Map<string, number>();
    requests.forEach(({ key }) => {
      const generation = (this.environmentRequestGenerations[key] || 0) + 1;
      this.environmentRequestGenerations[key] = generation;
      this.environmentRefreshingKeys[key] = true;
      generations.set(key, generation);
    });
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < requests.length) {
        const { key, request } = requests[nextIndex++]!;
        const generation = generations.get(key)!;
        const currentRequest = environmentToolRequest(
          key,
          this.environmentPreferences.customTools,
          this.environmentPreferences.builtinOverrides,
          this.builtinEnvironmentTools,
        );
        if (
          this.environmentRequestGenerations[key] !== generation ||
          !currentRequest ||
          JSON.stringify(currentRequest) !== JSON.stringify(request)
        ) {
          continue;
        }
        let result: EnvironmentToolResult;
        try {
          result = await bridge.detectEnvironmentTool(request);
        } catch (error) {
          result = {
            key,
            name:
              request.kind === "custom"
                ? request.name
                : this.builtinEnvironmentTools.find((tool) => tool.key === request.key)?.name || request.key,
            status: "error",
            version: "",
            executablePath: "",
            checkedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : "环境检测失败。",
          };
        }
        if (this.environmentRequestGenerations[key] !== generation) continue;
        const latestRequest = environmentToolRequest(
          key,
          this.environmentPreferences.customTools,
          this.environmentPreferences.builtinOverrides,
          this.builtinEnvironmentTools,
        );
        if (!latestRequest || JSON.stringify(latestRequest) !== JSON.stringify(request)) continue;
        const resultIndex = this.environmentResults.findIndex((item) => item.key === key);
        if (resultIndex === -1) this.environmentResults.push(result);
        else this.environmentResults.splice(resultIndex, 1, result);
        this.environmentRefreshingKeys[key] = false;
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, requests.length) }, worker));
    } finally {
      this.environmentChecked = true;
      this.environmentActiveRefreshes = Math.max(0, this.environmentActiveRefreshes - 1);
      this.environmentRefreshing = this.environmentActiveRefreshes > 0;
    }
  }
};
