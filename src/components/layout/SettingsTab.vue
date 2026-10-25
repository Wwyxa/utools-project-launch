<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Archive,
  ArrowLeft,
  Brain,
  Code2,
  Database,
  Download,
  FileText,
  FolderOpen,
  Github,
  Info,
  LoaderCircle,
  Menu,
  Monitor,
  MonitorCog,
  Moon,
  MousePointer2,
  RefreshCw,
  Plus,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Settings2,
  SquareTerminal,
  Sun,
  Trash2,
  WandSparkles,
  ChevronDown,
} from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { waitForInitialPaint } from "../../store/helpers/automationHelpers";
import { waitForVisualFeedback } from "../../lib/visualFeedback";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { getOverlayScrollbarScrollElements } from "../../lib/overlayScrollbar";
import ActionDialog from "../common/ActionDialog.vue";
import BaseModal from "../common/BaseModal.vue";
import ToggleSwitch from "../common/ToggleSwitch.vue";
import UiSelect from "../common/UiSelect.vue";
import Terminal from "../terminal/Terminal.vue";
import BackupTools from "./BackupTools.vue";
import { showActionStatus } from "../common/actionStatus";
import { getProjectBridge } from "../../lib/projectBridge";
import { VSCODE_ICON_PACK_ID } from "../../lib/fileIconTheme";
import {
  formatEnvironmentArguments,
  parseEnvironmentArguments,
  type CustomEnvironmentToolErrors,
} from "../../lib/environmentTools";
import type {
  AiProviderKind,
  DefaultTerminalKind,
  EnvironmentToolKey,
  ExternalApplication,
  IconPackId,
  IconPackUpdateResult,
  ProjectLaunchServiceLogRetentionPolicy,
} from "../../types";

const store = useStore();
const t = useI18n();
const githubRepositoryUrl = "https://github.com/Wwyxa/utools-project-launch";

const settingsContent = ref<HTMLElement | null>(null);
const activeSection = ref("general");
const settingsSections = computed(() => [
  { id: "general", label: t.value.settings.general },
  { id: "environment", label: t.value.settings.environment },
  { id: "ai", label: t.value.settings.aiProvider },
  { id: "terminal", label: t.value.settings.defaultTerminal },
  { id: "applications", label: t.value.settings.externalApplications },
  { id: "service", label: t.value.settings.projectLaunchService },
  { id: "logs", label: t.value.settings.projectLaunchServiceLogPersistence },
  { id: "backup", label: t.value.settings.projectConfig },
  { id: "data", label: t.value.settings.dataTools },
  { id: "about", label: t.value.settings.about },
]);
let stopSettingsScrollListener = () => {};
let navigationScrollTop: number | null = null;

const updateActiveSection = () => {
  const viewport = getOverlayScrollbarScrollElements(settingsContent.value)?.scrollOffsetElement;
  if (!viewport) return;
  if (viewport.scrollTop === navigationScrollTop) return;
  navigationScrollTop = null;
  const sections = Array.from(settingsContent.value?.querySelectorAll<HTMLElement>("[data-settings-section]") || []);
  const viewportTop = viewport.getBoundingClientRect().top;
  const current = sections.filter((section) => section.getBoundingClientRect().top <= viewportTop + 32).at(-1);
  activeSection.value = current?.dataset.settingsSection || "general";
  if (viewport.scrollTop > 0 && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1) {
    activeSection.value = sections.at(-1)?.dataset.settingsSection || activeSection.value;
  }
};

const navigateToSection = (id: string) => {
  const viewport = getOverlayScrollbarScrollElements(settingsContent.value)?.scrollOffsetElement;
  const section = settingsContent.value?.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
  if (!viewport || !section) return;
  viewport.scrollTo({
    top: viewport.scrollTop + section.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 24,
    behavior: "instant",
  });
  navigationScrollTop = viewport.scrollTop;
  activeSection.value = id;
  section.focus({ preventScroll: true });
};

const hostPlatform = window.navigator.platform || window.navigator.userAgent || "";
type SelectableTerminalKind = Exclude<DefaultTerminalKind, "builtin">;

const fallbackTerminalOptions: SelectableTerminalKind[] = /win/i.test(hostPlatform)
  ? ["windows-terminal", "powershell", "cmd"]
  : /linux/i.test(hostPlatform)
    ? ["linux-terminal"]
    : ["terminal-app", "iterm2", "warp"];
const selectedAiModeId = ref("");
const environmentDialogOpen = ref(false);
const editingBuiltinEnvironmentKey = ref<EnvironmentToolKey | null>(null);
const editingCustomEnvironmentId = ref<string | null>(null);
const pendingDeleteCustomEnvironmentId = ref<string | null>(null);
const customEnvironmentDraft = ref({ name: "", command: "", versionArgs: "--version" });
const customEnvironmentErrors = ref<CustomEnvironmentToolErrors>({});
const externalApplicationDialogOpen = ref(false);
const editingExternalApplicationId = ref<string | null>(null);
const externalApplicationDraft = ref({ name: "", command: "" });
const externalApplicationErrors = ref({ name: "", command: "" });
const externalApplicationFeedback = ref("");
const projectLaunchServiceDisableWarningOpen = ref(false);
const projectLaunchServiceUpdateChecking = ref(false);
const projectLaunchServiceDownloading = ref(false);
const projectLaunchServiceRechecking = ref(false);
const projectLaunchServiceToggling = ref(false);
const projectLaunchServiceUpdateDialogOpen = ref(false);
const projectLaunchServiceSwitchOn = ref(store.projectLaunchServicePreferences.enabled);
const logRetentionDraft = ref<ProjectLaunchServiceLogRetentionPolicy | null>(null);
const logRetentionSaving = ref(false);
const logRetentionFeedback = ref("");
const logRetentionFeedbackTone = ref<"success" | "error">("success");
const logRetentionClearOpen = ref(false);
const logRetentionClearBusy = ref(false);
const iconPackAction = ref<"install" | "check" | "verify" | "remove" | null>(null);
const iconPackSelectingId = ref<IconPackId | null>(null);
const aiProviderOptions: AiProviderKind[] = ["utools", "openai-compatible", "anthropic-compatible"];
const cleanupDialogOpen = ref(false);
const cleanupScanning = ref(false);
const cleanupSubmitting = ref(false);
const cleanupConfirmOpen = ref(false);
const cleanupSelection = ref<Record<string, boolean>>({});
const formatDataSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 100 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
};

const migrationStatusLabel = computed(() => {
  const status = store.storageOverview?.migration?.status;
  if (status === "completed") return t.value.settings.migrationStatusCompleted;
  if (status === "in-progress") return t.value.settings.migrationStatusInProgress;
  if (status === "failed") return t.value.settings.migrationStatusFailed;
  return t.value.settings.migrationStatusNone;
});

const migrationRetryDisabled = computed(() => store.dataToolsBusy || store.storageOverview?.serviceRunning === true);

const openCleanupDialog = async () => {
  cleanupDialogOpen.value = true;
  if (cleanupScanning.value || store.cleanupRunning) return;
  cleanupScanning.value = true;
  cleanupSelection.value = {};
  store.cleanupSelectedIds = [];
  store.cleanupPlan = null;
  store.cleanupResults = [];
  store.cleanupMessage = "";
  try {
    await waitForInitialPaint();
    await store.loadCleanupPlan();
    const selection: Record<string, boolean> = {};
    cleanupItems.value.forEach((item) => {
      selection[item.id] = item.selectedByDefault && !item.disabledReason;
    });
    cleanupSelection.value = selection;
  } finally {
    cleanupScanning.value = false;
  }
};

const cleanupItems = computed(() => store.cleanupPlan?.items || []);
const cleanupSelectedIds = computed(() =>
  cleanupItems.value.filter((item) => cleanupSelection.value[item.id] && !item.disabledReason).map((item) => item.id),
);
const cleanupHasSyncSelection = computed(() =>
  cleanupItems.value.some(
    (item) => cleanupSelection.value[item.id] && !item.disabledReason && item.category === "sync",
  ),
);
const cleanupRunnable = computed(
  () => cleanupSelectedIds.value.length > 0 && !cleanupScanning.value && !cleanupSubmitting.value && !store.cleanupRunning,
);

const runSelectedCleanup = async () => {
  if (!cleanupRunnable.value) return;
  cleanupSubmitting.value = true;
  store.cleanupSelectedIds = cleanupSelectedIds.value;
  showActionStatus({ state: "loading", message: t.value.common.processing });
  try {
    await waitForVisualFeedback();
    const result = await store.runCleanup();
    showActionStatus({
      state: result?.ok ? "success" : result?.partial ? "warning" : "error",
      message: store.cleanupMessage || (result?.ok ? t.value.common.completed : t.value.common.error),
    });
  } catch (error) {
    showActionStatus({ state: "error", message: error instanceof Error ? error.message : t.value.common.error });
  } finally {
    cleanupSubmitting.value = false;
  }
};

const requestCleanupRun = () => {
  if (!cleanupRunnable.value) return;
  if (cleanupHasSyncSelection.value) {
    cleanupConfirmOpen.value = true;
    return;
  }
  runSelectedCleanup();
};

type EnvironmentSettingsCard = {
  kind: "builtin" | "custom";
  key: string;
  name: string;
  command: string;
  versionArgs: string[];
  enabled: boolean;
  modified: boolean;
};

const environmentCards = computed<EnvironmentSettingsCard[]>(() => [
  ...store.builtinEnvironmentTools.map((definition) => {
    const override = store.environmentPreferences.builtinOverrides.find((item) => item.key === definition.key);
    return {
      kind: "builtin" as const,
      key: definition.key,
      name: definition.name,
      command: override?.command || definition.command,
      versionArgs: override?.versionArgs || definition.versionArgs,
      enabled: store.environmentPreferences.enabledToolKeys.includes(definition.key),
      modified: Boolean(override),
    };
  }),
  ...store.environmentPreferences.customTools.map((tool) => ({
    kind: "custom" as const,
    key: tool.id,
    name: tool.name,
    command: tool.command,
    versionArgs: tool.versionArgs,
    enabled: tool.enabled,
    modified: false,
  })),
]);
const editingBuiltinHasOverride = computed(() =>
  store.environmentPreferences.builtinOverrides.some((item) => item.key === editingBuiltinEnvironmentKey.value),
);

const terminalUsesCustomCommand = computed(() => store.terminalPreferences.kind === "custom");
const terminalOptions: SelectableTerminalKind[] = [...fallbackTerminalOptions, "custom"];
const externalApplications = computed(() => store.externalApplicationPreferences.applications);
const editingExternalApplication = computed(() =>
  externalApplications.value.find((application) => application.id === editingExternalApplicationId.value),
);
const aiUsesThirdParty = computed(() => store.aiPreferences.provider !== "utools");
const aiModelOptions = computed(() => {
  const collected = new Map<string, string>();
  store.aiModels.forEach((model) => {
    const key = model.id || model.name;
    if (key) {
      collected.set(key, model.name || model.id);
    }
  });
  if (store.aiPreferences.model && !collected.has(store.aiPreferences.model)) {
    collected.set(store.aiPreferences.model, store.aiPreferences.model);
  }
  return Array.from(collected.entries()).map(([value, label]) => ({ value, label }));
});
const setAiModelValue = (model: string | null) => {
  store.setAiPreferences({ model: model ?? "" });
};
const aiModelSelectOptions = computed(() => [
  { value: "", label: t.value.settings.aiModelPlaceholder },
  ...aiModelOptions.value,
]);
const selectedAiMode = computed(
  () =>
    store.aiPreferences.modes.find((mode) => mode.id === selectedAiModeId.value) ||
    store.aiPreferences.modes[0] ||
    null,
);
const aiProviderDescription = computed(() => {
  if (store.aiPreferences.provider === "utools") return "使用 uTools 内置模型列表。";
  if (store.aiPreferences.provider === "anthropic-compatible") return "兼容 /messages 接口。";
  return "兼容 /chat/completions 接口。";
});
const aiConfigReady = computed(() => {
  if (store.aiPreferences.provider === "utools") return Boolean(store.aiPreferences.model.trim());
  return Boolean(
    store.aiPreferences.baseUrl.trim() && store.aiPreferences.model.trim() && store.aiPreferences.apiKey.trim(),
  );
});
const projectLaunchServiceStatus = computed(() => store.projectLaunchServiceStatus);
const iconPackStatus = computed(() => store.iconPackStatus);
const iconPackBusy = computed(() => Boolean(iconPackAction.value || iconPackSelectingId.value));
const iconPackInstallLabel = computed(() =>
  iconPackStatus.value?.installedPackId ? t.value.settings.iconPackUpdate : t.value.settings.iconPackInstall,
);
const iconPackStatusLabel = computed(() => {
  const status = iconPackStatus.value;
  if (status?.updateAvailable) return t.value.settings.iconPackUpdateAvailable;
  if (status?.state === "installed" && status.active) return t.value.settings.iconPackActive;
  if (status?.state === "installed") return t.value.settings.iconPackInstalled;
  if (status?.state === "invalid") return t.value.settings.iconPackInvalid;
  return t.value.settings.iconPackUnavailable;
});
const iconPackStatusClass = computed(() => {
  const status = iconPackStatus.value;
  if (status?.updateAvailable) return "border-status-warning/30 bg-status-warning/10 text-status-warning";
  if (status?.state === "installed" && status.active)
    return "border-status-running/30 bg-status-running/10 text-status-running";
  if (status?.state === "invalid") return "border-status-error/30 bg-status-error/10 text-status-error";
  return "border-status-warning/30 bg-status-warning/10 text-status-warning";
});
const projectLaunchServiceBusy = computed(
  () =>
    projectLaunchServiceStatus.value?.state === "starting" ||
    projectLaunchServiceUpdateChecking.value ||
    projectLaunchServiceDownloading.value ||
    projectLaunchServiceRechecking.value ||
    projectLaunchServiceToggling.value,
);
const projectLaunchServiceStatusLabel = computed(() => {
  const state = projectLaunchServiceStatus.value?.state;
  if (projectLaunchServiceStatus.value?.updateAvailable) return t.value.settings.projectLaunchServiceUpdateAvailable;
  if (state === "installed") return t.value.settings.projectLaunchServiceInstalled;
  if (state === "starting") return t.value.settings.projectLaunchServiceStarting;
  if (state === "healthy") return t.value.settings.projectLaunchServiceHealthy;
  if (state === "incompatible") return t.value.settings.projectLaunchServiceIncompatible;
  if (state === "unavailable" && !projectLaunchServiceStatus.value?.expectedAssetName) {
    return t.value.settings.projectLaunchServiceUnsupported;
  }
  if (state === "unavailable") return t.value.settings.projectLaunchServiceUnavailable;
  return t.value.settings.projectLaunchServiceNotInstalled;
});
const projectLaunchServiceUpdateDownloadAllowed = computed(() =>
  Boolean(projectLaunchServiceStatus.value?.updateAvailable && !projectLaunchServiceStatus.value?.running),
);
const projectLaunchServiceUpdateDialogMessage = computed(() =>
  projectLaunchServiceStatus.value?.running
    ? t.value.settings.projectLaunchServiceUpdateRunningMessage
    : t.value.settings.projectLaunchServiceUpdateMessage,
);
const projectLaunchServiceUpdateDialogDetail = computed(() => {
  const version = projectLaunchServiceStatus.value?.latestServiceVersion;
  return version ? `${t.value.settings.projectLaunchServiceUpdateVersion}: ${version}` : "";
});
const projectLaunchServiceStatusClass = computed(() => {
  const state = projectLaunchServiceStatus.value?.state;
  if (projectLaunchServiceStatus.value?.updateAvailable)
    return "border-status-warning/30 bg-status-warning/10 text-status-warning";
  if (state === "healthy") return "border-status-running/30 bg-status-running/10 text-status-running";
  if (state === "incompatible" || state === "unavailable")
    return "border-status-error/30 bg-status-error/10 text-status-error";
  if (state === "starting") return "border-primary/30 bg-primary/10 text-primary";
  return "border-status-warning/30 bg-status-warning/10 text-status-warning";
});
const projectLaunchServiceLogRetentionStatus = computed(() => store.projectLaunchServiceLogRetentionStatus);
const logRetentionReady = computed(() => store.supportsBridge);
const formatLogBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
};
const formatLogMiB = (bytes: number) => (Number.isFinite(bytes) ? Number((bytes / (1024 * 1024)).toFixed(3)) : 0);
const projectLaunchServiceLogRetentionSummary = computed(() => {
  const policy = projectLaunchServiceLogRetentionStatus.value?.policy;
  if (!policy) return t.value.settings.projectLaunchServiceLogUnavailable;
  return [
    policy.persist
      ? t.value.settings.projectLaunchServiceLogPersistOn
      : t.value.settings.projectLaunchServiceLogPersistOff,
    `${policy.maxCompletedRunsPerProject} ${t.value.settings.projectLaunchServiceLogRunsUnit}`,
    `${formatLogBytes(policy.maxBytesPerRun)} / ${formatLogBytes(policy.maxBytesTotal)}`,
  ].join(" / ");
});
const projectLaunchServiceHasNotice = computed(() => {
  const status = projectLaunchServiceStatus.value;
  return Boolean(status?.message || status?.eventsTruncated || status?.scheduler?.lastError);
});
const projectLaunchServiceNoticeClass = computed(() => {
  const status = projectLaunchServiceStatus.value;
  if (status?.scheduler?.lastError || status?.state === "incompatible" || status?.state === "unavailable") {
    return "ui-banner--error";
  }
  if (status?.eventsTruncated || status?.state === "installed") {
    return "ui-banner--warning";
  }
  return status?.state === "healthy" ? "ui-banner--positive" : "ui-banner--primary";
});
const projectLaunchServiceSchedulerLabel = computed(() => {
  const state = projectLaunchServiceStatus.value?.scheduler?.state;
  if (state === "degraded") return t.value.settings.projectLaunchServiceSchedulerDegraded;
  if (state === "running") return t.value.settings.projectLaunchServiceSchedulerRunning;
  return "-";
});
const projectLaunchServiceSchedulerClass = computed(() => {
  const state = projectLaunchServiceStatus.value?.scheduler?.state;
  if (state === "degraded") return "text-status-error";
  if (state === "running") return "text-status-running";
  return "text-on-surface-variant";
});
const segmentButtonClass = (active: boolean) =>
  cn("ui-segment-item flex-none gap-1.5 whitespace-nowrap", active && "is-active");

type ServiceActionTone = "primary" | "secondary" | "danger";
type ServiceActionSize = "sm" | "md" | "field";
const serviceActionButtonClass = (tone: ServiceActionTone = "secondary", size: ServiceActionSize = "md") =>
  cn(
    tone === "primary"
      ? "ui-btn ui-btn--primary"
      : tone === "danger"
        ? "ui-btn ui-btn--danger"
        : "ui-btn ui-btn--secondary",
    size === "sm" && "ui-btn--sm",
  );

const loadAiModels = async () => {
  await store.refreshAiModels();
  if (store.aiPreferences.provider === "utools" && !store.aiPreferences.model && store.aiModels[0]) {
    store.setAiPreferences({ model: store.aiModels[0].id });
  }
};

const handleTestAi = async () => {
  await store.testAiConfiguration();
};

const handleOpenGithubRepository = async () => {
  await getProjectBridge().openPath(githubRepositoryUrl);
};

const handleInstallIconPack = async () => {
  if (iconPackBusy.value) return;
  const isUpdate = Boolean(iconPackStatus.value?.installedPackId);
  if (isUpdate) {
    iconPackAction.value = "check";
    showActionStatus({ state: "loading", message: t.value.settings.iconPackChecking });
    let check: IconPackUpdateResult;
    try {
      check = await store.checkIconPackUpdate();
      if (!check.ok) {
        showActionStatus({ state: "error", message: check.message || t.value.settings.iconPackUpdateCheckError });
        return;
      }
      if (!check.updateAvailable) {
        showActionStatus({ state: "success", message: t.value.settings.iconPackUpToDate });
        return;
      }
    } catch (error) {
      showActionStatus({
        state: "error",
        message: error instanceof Error ? error.message : t.value.settings.iconPackUpdateCheckError,
      });
      return;
    } finally {
      iconPackAction.value = null;
    }
  }
  iconPackAction.value = "install";
  showActionStatus({ state: "loading", message: t.value.settings.iconPackInstalling });
  try {
    const result = await store.installIconPack();
    showActionStatus({
      state: result.ok ? "success" : "error",
      message: result.ok
        ? isUpdate
          ? t.value.settings.iconPackUpdateSuccess
          : t.value.settings.iconPackInstallSuccess
        : result.message || t.value.settings.iconPackInstallError,
    });
  } catch (error) {
    showActionStatus({
      state: "error",
      message: error instanceof Error ? error.message : t.value.settings.iconPackInstallError,
    });
  } finally {
    iconPackAction.value = null;
  }
};

const handleVerifyIconPackInstall = async () => {
  if (iconPackBusy.value) return;
  iconPackAction.value = "verify";
  showActionStatus({ state: "loading", message: t.value.settings.iconPackVerifying });
  try {
    const result = await store.verifyIconPackInstall();
    showActionStatus({
      state: result.ok ? "success" : "error",
      message: result.ok
        ? t.value.settings.iconPackVerifySuccess
        : result.message || t.value.settings.iconPackVerifyError,
    });
  } catch (error) {
    showActionStatus({
      state: "error",
      message: error instanceof Error ? error.message : t.value.settings.iconPackVerifyError,
    });
  } finally {
    iconPackAction.value = null;
  }
};

const handleSelectIconPack = async (packId: IconPackId) => {
  if (iconPackBusy.value || (packId === VSCODE_ICON_PACK_ID && iconPackStatus.value?.installedPackId !== packId))
    return;
  iconPackSelectingId.value = packId;
  try {
    const result = await store.setIconPack(packId);
    if (packId !== "builtin" && !result.ok) {
      showActionStatus({ state: "error", message: result.message || t.value.settings.iconPackUnavailable });
    }
  } catch (error) {
    showActionStatus({
      state: "error",
      message: error instanceof Error ? error.message : t.value.settings.iconPackUnavailable,
    });
  } finally {
    iconPackSelectingId.value = null;
  }
};

const handleRemoveIconPack = async () => {
  if (iconPackBusy.value || !iconPackStatus.value?.installedPackId) return;
  iconPackAction.value = "remove";
  try {
    const result = await store.removeIconPack();
    showActionStatus({
      state: result.ok ? "success" : "error",
      message: result.ok
        ? t.value.settings.iconPackRemoveSuccess
        : result.message || t.value.settings.iconPackRemoveError,
    });
  } catch (error) {
    showActionStatus({
      state: "error",
      message: error instanceof Error ? error.message : t.value.settings.iconPackRemoveError,
    });
  } finally {
    iconPackAction.value = null;
  }
};

const handleDownloadProjectLaunchService = async () => {
  if (projectLaunchServiceBusy.value) return;
  projectLaunchServiceDownloading.value = true;
  showActionStatus({ state: "loading", message: t.value.settings.projectLaunchServiceDownloading });
  try {
    await waitForVisualFeedback();
    const status = await store.downloadProjectLaunchService();
    await refreshLogRetention();
    showActionStatus({
      state: status.installed && status.state === "installed" ? "success" : "error",
      message:
        status.installed && status.state === "installed"
          ? t.value.settings.projectLaunchServiceDownloadSuccess
          : status.message || t.value.settings.projectLaunchServiceDownloadError,
    });
  } catch (error) {
    showActionStatus({
      state: "error",
      message: error instanceof Error ? error.message : t.value.settings.projectLaunchServiceDownloadError,
    });
  } finally {
    projectLaunchServiceDownloading.value = false;
  }
};

const confirmProjectLaunchServiceUpdate = async () => {
  if (!projectLaunchServiceUpdateDownloadAllowed.value) {
    projectLaunchServiceUpdateDialogOpen.value = false;
    return;
  }
  projectLaunchServiceUpdateDialogOpen.value = false;
  await handleDownloadProjectLaunchService();
};

const handleRecheckProjectLaunchService = async () => {
  if (projectLaunchServiceBusy.value) return;
  projectLaunchServiceRechecking.value = true;
  showActionStatus({ state: "loading", message: t.value.settings.projectLaunchServiceRechecking });
  try {
    await waitForVisualFeedback();
    const status = await store.refreshProjectLaunchServiceStatus(true);
    await refreshLogRetention();
    const verified = status.installed && (status.state === "installed" || status.state === "healthy");
    showActionStatus({
      state: verified ? "success" : "error",
      message: `${t.value.settings.projectLaunchServiceRecheck}: ${status.message || projectLaunchServiceStatusLabel.value}`,
    });
  } catch (error) {
    showActionStatus({
      state: "error",
      message: error instanceof Error ? error.message : t.value.common.error,
    });
  } finally {
    projectLaunchServiceRechecking.value = false;
  }
};

const handleCheckProjectLaunchServiceUpdate = async () => {
  if (projectLaunchServiceBusy.value) return;
  projectLaunchServiceUpdateChecking.value = true;
  showActionStatus({ state: "loading", message: t.value.settings.projectLaunchServiceCheckingUpdate });
  try {
    const status = await store.checkProjectLaunchServiceUpdate();
    if (status.updateCheckError) {
      showActionStatus({
        state: "error",
        message: status.message || t.value.settings.projectLaunchServiceUpdateCheckError,
      });
      return;
    }
    if (status.updateAvailable) {
      projectLaunchServiceUpdateDialogOpen.value = true;
      showActionStatus({ state: "warning", message: t.value.settings.projectLaunchServiceUpdateAvailable });
      return;
    }
    if (!status.installed || status.state === "unavailable" || status.state === "incompatible") {
      showActionStatus({
        state: "warning",
        message: status.message || t.value.settings.projectLaunchServiceUpdateCheckError,
      });
      return;
    }
    showActionStatus({ state: "success", message: t.value.settings.projectLaunchServiceUpToDate });
  } catch (error) {
    showActionStatus({
      state: "error",
      message: error instanceof Error ? error.message : t.value.settings.projectLaunchServiceUpdateCheckError,
    });
  } finally {
    projectLaunchServiceUpdateChecking.value = false;
  }
};

const handleToggleProjectLaunchService = (enabled: boolean) => {
  if (projectLaunchServiceBusy.value) {
    projectLaunchServiceSwitchOn.value = store.projectLaunchServicePreferences.enabled;
    return;
  }
  if (!enabled && store.hasActiveProjectLaunchServiceRuns) {
    projectLaunchServiceSwitchOn.value = true;
    projectLaunchServiceDisableWarningOpen.value = true;
    return;
  }
  void toggleProjectLaunchService(enabled);
};

const toggleProjectLaunchService = async (enabled: boolean) => {
  projectLaunchServiceToggling.value = true;
  showActionStatus({
    state: "loading",
    message: `${t.value.settings.projectLaunchService}: ${enabled ? t.value.settings.projectLaunchServiceStarting : t.value.common.stopping}`,
  });
  try {
    await waitForVisualFeedback();
    const status = await store.setProjectLaunchServiceEnabled(enabled);
    await refreshLogRetention();
    const succeeded = store.projectLaunchServicePreferences.enabled === enabled;
    showActionStatus({
      state: succeeded ? "success" : "error",
      message: succeeded
        ? `${t.value.settings.projectLaunchService}: ${enabled ? t.value.settings.projectLaunchServiceModeOn : t.value.settings.projectLaunchServiceModeOff}`
        : status?.message || t.value.common.error,
    });
  } catch (error) {
    showActionStatus({
      state: "error",
      message: error instanceof Error ? error.message : t.value.common.error,
    });
  } finally {
    projectLaunchServiceSwitchOn.value = store.projectLaunchServicePreferences.enabled;
    projectLaunchServiceToggling.value = false;
  }
};

const refreshLogRetention = async () => {
  try {
    const retention = await store.refreshRuntimeRecordRetention();
    logRetentionDraft.value = { ...retention.policy };
    logRetentionFeedback.value = "";
  } catch (error) {
    logRetentionDraft.value = null;
    logRetentionFeedbackTone.value = "error";
    logRetentionFeedback.value =
      error instanceof Error ? error.message : t.value.settings.projectLaunchServiceLogLoadError;
  }
};

const updateLogRetentionSize = (field: "maxBytesPerRun" | "maxBytesTotal", event: Event) => {
  if (!logRetentionDraft.value) return;
  const value = (event.target as HTMLInputElement).valueAsNumber;
  logRetentionDraft.value = {
    ...logRetentionDraft.value,
    [field]: Math.round(value * 1024 * 1024),
  };
  void persistLogRetention();
};

const updateLogRetentionRuns = (event: Event) => {
  if (!logRetentionDraft.value) return;
  const value = (event.target as HTMLInputElement).valueAsNumber;
  logRetentionDraft.value = {
    ...logRetentionDraft.value,
    maxCompletedRunsPerProject: value,
  };
  void persistLogRetention();
};

const updateLogRetentionPersistence = (persist: boolean) => {
  if (!logRetentionDraft.value) return;
  logRetentionDraft.value = {
    ...logRetentionDraft.value,
    persist,
  };
  void persistLogRetention();
};

const persistLogRetention = async () => {
  const draft = logRetentionDraft.value;
  if (!draft) return;
  if (
    !Number.isSafeInteger(draft.maxCompletedRunsPerProject) ||
    draft.maxCompletedRunsPerProject < 1 ||
    !Number.isSafeInteger(draft.maxBytesPerRun) ||
    draft.maxBytesPerRun < 1024 ||
    !Number.isSafeInteger(draft.maxBytesTotal) ||
    draft.maxBytesTotal < 1024
  ) {
    logRetentionFeedbackTone.value = "error";
    logRetentionFeedback.value = t.value.settings.projectLaunchServiceLogInvalid;
    return;
  }
  logRetentionSaving.value = true;
  logRetentionFeedback.value = "";
  try {
    const retention = await store.updateRuntimeRecordRetention({ ...draft });
    logRetentionDraft.value = { ...retention.policy };
  } catch (error) {
    logRetentionFeedbackTone.value = "error";
    logRetentionFeedback.value =
      error instanceof Error ? error.message : t.value.settings.projectLaunchServiceLogSaveError;
  } finally {
    logRetentionSaving.value = false;
  }
};

const confirmClearLogRetention = async () => {
  if (logRetentionClearBusy.value) return;
  logRetentionClearBusy.value = true;
  logRetentionClearOpen.value = false;
  logRetentionFeedback.value = "";
  showActionStatus({ state: "loading", message: t.value.settings.projectLaunchServiceLogClearBusy });
  try {
    await waitForVisualFeedback();
    const result = await store.clearRuntimeRecords();
    try {
      await refreshLogRetention();
    } catch (error) {
      // Keep the successful clear result visible even if the follow-up usage read fails.
    }
    logRetentionFeedbackTone.value = "success";
    logRetentionFeedback.value = t.value.settings.projectLaunchServiceLogClearResult
      .replace("{count}", String(result.deletedCount))
      .replace("{size}", formatLogBytes(result.releasedBytes));
    showActionStatus({ state: "success", message: logRetentionFeedback.value });
  } catch (error) {
    logRetentionFeedbackTone.value = "error";
    logRetentionFeedback.value =
      error instanceof Error ? error.message : t.value.settings.projectLaunchServiceLogClearError;
    showActionStatus({ state: "error", message: logRetentionFeedback.value });
  } finally {
    logRetentionClearBusy.value = false;
  }
};

const handleAddAiMode = () => {
  selectedAiModeId.value = store.addAiPromptMode();
};

const handleDeleteAiMode = () => {
  const mode = selectedAiMode.value;
  if (!mode || mode.builtIn) return;
  store.deleteAiPromptMode(mode.id);
  selectedAiModeId.value = store.aiPreferences.modes[0]?.id || "";
};

const handleResetAiModes = () => {
  store.resetAiPromptModes();
  selectedAiModeId.value = store.aiPreferences.modes[0]?.id || "";
};

const openEnvironmentDialog = (tool?: EnvironmentSettingsCard) => {
  editingBuiltinEnvironmentKey.value = tool?.kind === "builtin" ? (tool.key as EnvironmentToolKey) : null;
  editingCustomEnvironmentId.value = tool?.kind === "custom" ? tool.key : null;
  customEnvironmentDraft.value = {
    name: tool?.name || "",
    command: tool?.command || "",
    versionArgs: tool ? formatEnvironmentArguments(tool.versionArgs) : "--version",
  };
  customEnvironmentErrors.value = {};
  environmentDialogOpen.value = true;
};

const saveEnvironment = () => {
  const versionArgs = parseEnvironmentArguments(customEnvironmentDraft.value.versionArgs);
  if (!versionArgs) {
    customEnvironmentErrors.value = { versionArgs: "unsafe" };
    return;
  }
  const input = { ...customEnvironmentDraft.value, versionArgs };
  const result = editingBuiltinEnvironmentKey.value
    ? store.saveBuiltinEnvironmentToolOverride(editingBuiltinEnvironmentKey.value, input)
    : editingCustomEnvironmentId.value
      ? store.updateCustomEnvironmentTool(editingCustomEnvironmentId.value, input)
      : store.addCustomEnvironmentTool(input);
  if (!result.ok) {
    customEnvironmentErrors.value = result.errors;
    return;
  }
  environmentDialogOpen.value = false;
};

const restoreBuiltinEnvironment = () => {
  if (!editingBuiltinEnvironmentKey.value) return;
  store.restoreBuiltinEnvironmentTool(editingBuiltinEnvironmentKey.value);
  environmentDialogOpen.value = false;
};

const requestDeleteCustomEnvironment = () => {
  if (!editingCustomEnvironmentId.value) return;
  pendingDeleteCustomEnvironmentId.value = editingCustomEnvironmentId.value;
  environmentDialogOpen.value = false;
};

const confirmDeleteCustomEnvironment = async () => {
  const id = pendingDeleteCustomEnvironmentId.value;
  if (!id) return;
  pendingDeleteCustomEnvironmentId.value = null;
  showActionStatus({ state: "loading", message: t.value.common.processing });
  try {
    await waitForVisualFeedback();
    store.deleteCustomEnvironmentTool(id);
    showActionStatus({
      state: store.localStateWriteError ? "error" : "success",
      message: store.localStateWriteError || t.value.common.completed,
    });
  } catch (error) {
    showActionStatus({ state: "error", message: error instanceof Error ? error.message : t.value.common.error });
  }
};

const setEnvironmentCardEnabled = (card: EnvironmentSettingsCard, enabled: boolean) => {
  if (card.kind === "builtin") store.setEnvironmentToolEnabled(card.key as EnvironmentToolKey, enabled);
  else store.setCustomEnvironmentToolEnabled(card.key, enabled);
};

const environmentCommandSummary = (card: EnvironmentSettingsCard) =>
  [card.command, formatEnvironmentArguments(card.versionArgs)].filter(Boolean).join(" ");

const customEnvironmentErrorText = (field: keyof CustomEnvironmentToolErrors) => {
  const code = customEnvironmentErrors.value[field];
  if (!code) return "";
  return code === "required" ? t.value.settings.environmentRequired : t.value.settings.environmentUnsafe;
};

const openExternalApplicationDialog = (application?: ExternalApplication) => {
  editingExternalApplicationId.value = application?.id || null;
  externalApplicationDraft.value = { name: application?.name || "", command: application?.command || "" };
  externalApplicationErrors.value = { name: "", command: "" };
  externalApplicationFeedback.value = "";
  externalApplicationDialogOpen.value = true;
};

const saveExternalApplication = () => {
  const name = externalApplicationDraft.value.name.trim();
  const command = externalApplicationDraft.value.command.trim();
  const duplicateName = externalApplications.value.some(
    (application) =>
      application.id !== editingExternalApplicationId.value &&
      application.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  externalApplicationErrors.value = {
    name: !name
      ? t.value.settings.externalApplicationRequired
      : duplicateName
        ? t.value.settings.externalApplicationDuplicate
        : "",
    command: command ? "" : t.value.settings.externalApplicationRequired,
  };
  if (externalApplicationErrors.value.name || externalApplicationErrors.value.command) return;
  const saved = editingExternalApplicationId.value
    ? store.updateExternalApplication(editingExternalApplicationId.value, name, command)
    : store.addExternalApplication(name, command);
  if (!saved) {
    externalApplicationFeedback.value = t.value.settings.externalApplicationInvalid;
    return;
  }
  externalApplicationDialogOpen.value = false;
};

const setExternalApplicationEnabled = (application: ExternalApplication, enabled: boolean) => {
  if (!store.setExternalApplicationEnabled(application.id, enabled) && application.enabled !== enabled) {
    externalApplicationFeedback.value = t.value.settings.selectAnotherDefaultApplication;
    return;
  }
  externalApplicationFeedback.value = "";
};

const setDefaultExternalApplication = (application: ExternalApplication) => {
  if (!store.setDefaultExternalApplication(application.id) && !application.enabled) {
    externalApplicationFeedback.value = t.value.settings.enableApplicationBeforeDefault;
    return;
  }
  externalApplicationFeedback.value = "";
};

const deleteExternalApplication = () => {
  if (!editingExternalApplicationId.value) return;
  if (!store.deleteExternalApplication(editingExternalApplicationId.value)) {
    externalApplicationFeedback.value = t.value.settings.selectAnotherDefaultApplication;
    return;
  }
  externalApplicationDialogOpen.value = false;
};

const aiTestIconClass = computed(() => {
  if (store.aiModelTesting) return "text-primary animate-spin";
  if (store.aiModelTestOk === true) return "text-status-running";
  if (store.aiModelTestOk === false) return "text-status-error";
  return "text-on-surface-variant";
});

const aiTestTitle = computed(() => {
  if (store.aiModelTesting) return "测试中";
  if (!store.aiModelTestMessage) return "测试 AI 连接";
  return store.aiModelTestMessage;
});

let initializationFrame = 0;
onMounted(() => {
  const scrollElement = getOverlayScrollbarScrollElements(settingsContent.value)?.scrollEventElement;
  scrollElement?.addEventListener("scroll", updateActiveSection, { passive: true });
  stopSettingsScrollListener = () => scrollElement?.removeEventListener("scroll", updateActiveSection);
  initializationFrame = window.requestAnimationFrame(() => {
    initializationFrame = window.requestAnimationFrame(() => {
      void loadAiModels();
      void refreshLogRetention();
      void store.refreshStorageOverview();
    });
  });
});

onUnmounted(() => {
  window.cancelAnimationFrame(initializationFrame);
  stopSettingsScrollListener();
});

watch(
  () => store.aiPreferences.provider,
  () => {
    void loadAiModels();
  },
);

watch(
  () => store.projectLaunchServicePreferences.enabled,
  (enabled) => {
    projectLaunchServiceSwitchOn.value = enabled;
  },
);

watch(
  () => store.aiPreferences.modes.map((mode) => mode.id).join("|"),
  () => {
    if (!store.aiPreferences.modes.some((mode) => mode.id === selectedAiModeId.value)) {
      selectedAiModeId.value = store.aiPreferences.modes[0]?.id || "";
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex h-full min-h-0 w-full flex-col bg-background">
    <header class="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
      <button
        type="button"
        @click="store.setActiveTab('projects')"
        class="ui-btn ui-btn--ghost ui-btn--icon"
        :title="t.common.back"
        :aria-label="t.common.back"
      >
        <ArrowLeft :size="18" />
      </button>
      <h2 class="text-base font-bold leading-tight text-on-surface">{{ t.sidebar.settings }}</h2>
    </header>

    <div class="flex min-h-0 min-w-0 flex-1">
      <nav
        v-overlay-scrollbar
        :aria-label="t.sidebar.settings"
        class="themed-scrollbar w-28 shrink-0 overflow-y-auto border-r border-border-subtle bg-background p-2 sm:w-36"
      >
        <div class="space-y-1">
          <button
            v-for="section in settingsSections"
            :key="section.id"
            type="button"
            :aria-controls="`settings-${section.id}`"
            :aria-current="activeSection === section.id ? 'location' : undefined"
            :class="
              cn(
                'block w-full rounded-md px-3 py-2 text-left text-sm leading-5 break-words transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                activeSection === section.id
                  ? 'bg-surface-variant font-medium text-on-surface'
                  : 'text-on-surface-variant hover:bg-surface-variant/60 hover:text-on-surface',
              )
            "
            @click="navigateToSection(section.id)"
          >
            {{ section.label }}
          </button>
        </div>
      </nav>
      <div ref="settingsContent" v-overlay-scrollbar class="themed-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div class="settings-sections mx-auto max-w-5xl divide-y divide-border-subtle px-4 sm:px-7">
          <section
            id="settings-general"
            data-settings-section="general"
            tabindex="-1"
            class="min-w-0 py-6 outline-none"
          >
            <div class="mb-4 flex items-center gap-2">
              <Settings2 :size="15" class="shrink-0 text-primary" />
              <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.general }}</h3>
            </div>
            <div class="space-y-5">
              <div class="grid items-center gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
                <div class="min-w-0 text-sm font-medium text-on-surface">{{ t.settings.interfaceLanguage }}</div>
                <div
                  class="ui-segment w-fit"
                >
                  <button
                    type="button"
                    @click="store.setLocale('zh-CN')"
                    :class="segmentButtonClass(store.locale === 'zh-CN')"
                  >
                    简体中文
                  </button>
                  <button
                    type="button"
                    @click="store.setLocale('en-US')"
                    :class="segmentButtonClass(store.locale === 'en-US')"
                  >
                    English
                  </button>
                </div>
              </div>
              <div class="grid items-center gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
                <div class="min-w-0 text-sm font-medium text-on-surface">{{ t.settings.appearanceTheme }}</div>
                <div
                  class="ui-segment w-fit"
                >
                  <button
                    type="button"
                    @click="store.setTheme('light')"
                    :class="segmentButtonClass(store.theme === 'light')"
                  >
                    <Sun :size="16" />
                    {{ t.common.themeLight }}
                  </button>
                  <button
                    type="button"
                    @click="store.setTheme('dark')"
                    :class="segmentButtonClass(store.theme === 'dark')"
                  >
                    <Moon :size="16" />
                    {{ t.common.themeDark }}
                  </button>
                  <button
                    type="button"
                    @click="store.setTheme('auto')"
                    :class="segmentButtonClass(store.theme === 'auto')"
                  >
                    <Monitor :size="16" />
                    {{ t.common.themeAuto }}
                  </button>
                </div>
              </div>
              <div class="grid items-center gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
                <div class="min-w-0 text-sm font-medium text-on-surface">{{ t.settings.tinyCardActionTrigger }}</div>
                <div
                  class="ui-segment w-fit"
                  role="group"
                  :aria-label="t.settings.tinyCardActionTrigger"
                >
                  <button
                    type="button"
                    @click="store.setTinyCardActionTrigger('hover')"
                    :class="segmentButtonClass(store.uiPreferences.dashboard.tinyCardActionTrigger === 'hover')"
                  >
                    <MousePointer2 :size="16" />
                    {{ t.settings.tinyCardActionTriggerHover }}
                  </button>
                  <button
                    type="button"
                    @click="store.setTinyCardActionTrigger('contextmenu')"
                    :class="segmentButtonClass(store.uiPreferences.dashboard.tinyCardActionTrigger === 'contextmenu')"
                  >
                    <Menu :size="16" />
                    {{ t.settings.tinyCardActionTriggerContextMenu }}
                  </button>
                </div>
              </div>
              <div class="grid items-start gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
                <div class="min-w-0 text-sm font-medium text-on-surface">{{ t.settings.iconPack }}</div>
                <div class="min-w-0 space-y-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <span :class="cn('ui-status-pill', iconPackStatusClass)">
                      {{ iconPackStatusLabel }}
                    </span>
                    <span class="min-w-0 flex-1 text-[11px] leading-4 text-on-surface-variant">{{
                      t.settings.iconPackHint
                    }}</span>
                    <span
                      v-if="iconPackStatus?.installedVersion"
                      class="shrink-0 rounded border border-border-subtle bg-surface-container-low px-1.5 py-0.5 text-[10px] font-semibold text-on-surface-variant"
                    >
                      {{ t.settings.iconPackVersion }} {{ iconPackStatus.installedVersion }}
                    </span>
                  </div>
                  <div class="flex min-w-0 flex-wrap items-start gap-2.5">
                    <div
                      class="ui-segment h-fit w-fit"
                      role="group"
                      :aria-label="t.settings.iconPack"
                    >
                      <button
                        type="button"
                        :class="segmentButtonClass(store.uiPreferences.iconPackId === 'builtin')"
                        :disabled="iconPackBusy"
                        @click="handleSelectIconPack('builtin')"
                      >
                        <RotateCcw :size="14" />
                        {{ t.settings.iconPackUseBuiltin }}
                      </button>
                      <button
                        type="button"
                        :class="segmentButtonClass(store.uiPreferences.iconPackId === VSCODE_ICON_PACK_ID)"
                        :disabled="iconPackBusy || iconPackStatus?.installedPackId !== VSCODE_ICON_PACK_ID"
                        @click="handleSelectIconPack(VSCODE_ICON_PACK_ID)"
                      >
                        <ShieldCheck :size="14" />
                        {{ t.settings.iconPackActivate }}
                      </button>
                    </div>
                    <div class="flex min-w-0 flex-wrap content-start gap-1.5">
                      <button
                        type="button"
                        :class="serviceActionButtonClass('primary')"
                        :disabled="iconPackBusy"
                        :aria-busy="iconPackAction === 'install' || iconPackAction === 'check'"
                        @click="handleInstallIconPack"
                      >
                        <RefreshCw
                          v-if="iconPackAction === 'install' || iconPackAction === 'check'"
                          :size="13"
                          class="animate-spin"
                        />
                        <Download v-else :size="13" />
                        {{
                          iconPackAction === "install"
                            ? t.settings.iconPackInstalling
                            : iconPackAction === "check"
                              ? t.settings.iconPackChecking
                              : iconPackInstallLabel
                        }}
                      </button>
                      <button
                        type="button"
                        :class="serviceActionButtonClass()"
                        :disabled="iconPackBusy"
                        :aria-busy="iconPackAction === 'verify'"
                        @click="handleVerifyIconPackInstall"
                      >
                        <RefreshCw v-if="iconPackAction === 'verify'" :size="13" class="animate-spin" />
                        <ShieldCheck v-else :size="13" />
                        {{ iconPackAction === "verify" ? t.settings.iconPackVerifying : t.settings.iconPackVerify }}
                      </button>
                      <button
                        type="button"
                        :class="serviceActionButtonClass()"
                        :disabled="iconPackBusy"
                        @click="store.openIconPackDirectory()"
                      >
                        <FolderOpen :size="13" />
                        {{ t.settings.iconPackOpenDirectory }}
                      </button>
                      <button
                        type="button"
                        :class="serviceActionButtonClass()"
                        :disabled="iconPackBusy"
                        @click="store.openIconPackReleases()"
                      >
                        <Github :size="13" />
                        {{ t.settings.iconPackOpenReleases }}
                      </button>
                      <button
                        v-if="iconPackStatus?.installedPackId === VSCODE_ICON_PACK_ID"
                        type="button"
                        :class="serviceActionButtonClass('danger')"
                        :disabled="iconPackBusy"
                        :aria-busy="iconPackAction === 'remove'"
                        @click="handleRemoveIconPack"
                      >
                        <Trash2 :size="13" />
                        {{ iconPackAction === "remove" ? t.settings.iconPackRemoving : t.settings.iconPackRemove }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section
            id="settings-environment"
            data-settings-section="environment"
            tabindex="-1"
            class="min-w-0 py-6 outline-none"
          >
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <MonitorCog :size="15" class="text-primary" />
                <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.environment }}</h3>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  :class="serviceActionButtonClass('secondary', 'sm')"
                  @click="openEnvironmentDialog()"
                >
                  <Plus :size="12" />
                  {{ t.settings.addEnvironment }}
                </button>
                <button
                  type="button"
                  :class="serviceActionButtonClass('secondary', 'sm')"
                  @click="store.setActiveTab('environment')"
                >
                  <MonitorCog :size="12" />
                  {{ t.environment.title }}
                </button>
              </div>
            </div>
            <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
              <article
                v-for="card in environmentCards"
                :key="card.key"
                class="relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-md border border-border-subtle bg-surface px-3 py-2.5 text-on-surface transition-colors hover:bg-surface-variant"
              >
                <button
                  type="button"
                  class="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  :aria-label="`${t.common.edit}: ${card.name}`"
                  @click="openEnvironmentDialog(card)"
                />
                <input
                  type="checkbox"
                  class="relative z-10 mt-0.5 h-4 w-4 accent-primary"
                  :checked="card.enabled"
                  :aria-label="card.name"
                  @change="setEnvironmentCardEnabled(card, ($event.target as HTMLInputElement).checked)"
                />
                <div class="pointer-events-none relative min-w-0">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-xs font-semibold" :title="card.name">{{ card.name }}</span>
                    <span
                      v-if="card.kind === 'custom' || card.modified"
                      class="shrink-0 rounded bg-surface-container px-1 py-0.5 text-[10px] font-medium leading-3 text-on-surface-variant"
                    >
                      {{
                        card.kind === "custom" ? t.settings.customEnvironmentBadge : t.settings.modifiedEnvironmentBadge
                      }}
                    </span>
                  </div>
                  <p
                    class="mt-1 truncate font-mono text-[11px] leading-4 text-on-surface-variant"
                    :title="environmentCommandSummary(card)"
                  >
                    {{ environmentCommandSummary(card) }}
                  </p>
                </div>
              </article>
            </div>
          </section>

          <section id="settings-ai" data-settings-section="ai" tabindex="-1" class="min-w-0 py-6 outline-none">
            <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div class="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
                <Brain :size="15" class="shrink-0 text-primary" />
                <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.aiProvider }}</h3>
                <span class="col-span-2 text-xs leading-5 text-on-surface-variant">{{
                  aiProviderDescription
                }}</span>
              </div>
              <span
                :class="
                  cn(
                    'ui-status-pill shrink-0',
                    aiConfigReady
                      ? 'border-status-running/30 bg-status-running/10 text-status-running'
                      : 'border-status-warning/30 bg-status-warning/10 text-status-warning',
                  )
                "
              >
                {{ aiConfigReady ? "已配置" : "待配置" }}
              </span>
            </div>
            <div class="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.95fr)]">
              <div class="min-w-0 space-y-4">
                <div class="ui-segment w-fit gap-1">
                  <button
                    v-for="option in aiProviderOptions"
                    :key="option"
                    type="button"
                    @click="store.setAiPreferences({ provider: option })"
                    :class="segmentButtonClass(store.aiPreferences.provider === option)"
                  >
                    {{ t.settings.aiProviders[option] }}
                  </button>
                </div>

                <div class="grid gap-2 md:grid-cols-2">
                  <label v-if="aiUsesThirdParty" class="block text-xs font-semibold uppercase text-on-surface-variant">
                    {{ t.settings.aiBaseUrl }}
                    <input
                      :value="store.aiPreferences.baseUrl"
                      @input="store.setAiPreferences({ baseUrl: ($event.target as HTMLInputElement).value })"
                      type="text"
                      placeholder="https://api.example.com/v1"
                      class="ui-field mt-1 w-full normal-case"
                    />
                  </label>
                  <label v-if="aiUsesThirdParty" class="block text-xs font-semibold uppercase text-on-surface-variant">
                    {{ t.settings.aiApiKey }}
                    <input
                      :value="store.aiPreferences.apiKey"
                      @input="store.setAiPreferences({ apiKey: ($event.target as HTMLInputElement).value })"
                      type="password"
                      :placeholder="t.settings.aiApiKeyPlaceholder"
                      class="ui-field mt-1 w-full normal-case"
                    />
                  </label>
                </div>

                <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                  <label class="block text-xs font-semibold uppercase text-on-surface-variant">
                    {{ t.settings.aiModel }}
                    <div class="mt-1">
                      <UiSelect
                        :model-value="store.aiPreferences.model"
                        :options="aiModelSelectOptions"
                        direction="auto"
                        align="start"
                        :panel-max-height="224"
                        trigger-class="ui-field flex w-full cursor-pointer items-center justify-between gap-2 text-left normal-case"
                        @update:model-value="setAiModelValue"
                      />
                    </div>
                  </label>
                  <label class="block text-xs font-semibold uppercase text-on-surface-variant">
                    手动模型 ID
                    <input
                      :value="store.aiPreferences.model"
                      @input="store.setAiPreferences({ model: ($event.target as HTMLInputElement).value })"
                      type="text"
                      :placeholder="t.settings.aiModelPlaceholder"
                      class="ui-field mt-1 w-full normal-case"
                    />
                  </label>
                  <div class="flex gap-1.5">
                    <button
                      type="button"
                      @click="loadAiModels"
                      class="ui-btn ui-btn--ghost ui-btn--icon"
                      :title="t.common.refresh"
                      :aria-label="t.common.refresh"
                    >
                      <RefreshCw :size="14" :class="store.aiModelRefreshing ? 'animate-spin' : ''" />
                    </button>
                    <button
                      type="button"
                      @click="handleTestAi"
                      :class="serviceActionButtonClass('primary', 'field')"
                      :disabled="store.aiModelTesting || !aiConfigReady"
                      :aria-busy="store.aiModelTesting"
                    >
                      <WandSparkles :size="13" />
                      {{ store.aiModelTesting ? "测试中" : "测试" }}
                    </button>
                  </div>
                </div>

                <div
                  class="min-h-8 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-xs leading-5 text-on-surface-variant"
                  :title="aiTestTitle"
                >
                  <div class="flex items-start gap-1.5">
                    <span :class="cn('mt-0.5 shrink-0', aiTestIconClass)"><WandSparkles :size="12" /></span>
                    <span class="min-w-0 flex-1 break-words">
                      {{
                        store.aiModelTestMessage ||
                        store.aiModelRefreshMessage ||
                        (aiConfigReady ? "配置完整，可进行连接测试。" : "请补全模型和凭证。")
                      }}
                    </span>
                  </div>
                </div>
              </div>

              <div
                class="grid min-h-0 min-w-0 gap-4 border-t border-border-subtle pt-4 md:grid-cols-[9rem_minmax(0,1fr)] xl:border-t-0 xl:border-l xl:pt-0 xl:pl-5"
              >
                <div class="min-h-0 space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <h4 class="text-xs font-bold text-on-surface">模式</h4>
                    <div class="flex gap-1">
                      <button
                        type="button"
                        class="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
                        title="新增模式"
                        aria-label="新增模式"
                        @click="handleAddAiMode"
                      >
                        <Plus :size="13" />
                      </button>
                      <button
                        type="button"
                        class="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
                        title="恢复默认模式"
                        aria-label="恢复默认模式"
                        @click="handleResetAiModes"
                      >
                        <RotateCcw :size="13" />
                      </button>
                    </div>
                  </div>
                  <div class="themed-scrollbar max-h-56 space-y-1 overflow-y-auto pr-1">
                    <button
                      v-for="mode in store.aiPreferences.modes"
                      :key="mode.id"
                      type="button"
                      :class="
                        cn(
                          'flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs font-bold transition-colors',
                          selectedAiMode?.id === mode.id
                            ? 'border-primary/35 bg-primary/10 text-primary'
                            : 'border-border-subtle bg-surface text-on-surface-variant hover:bg-surface-variant hover:text-on-surface',
                        )
                      "
                      @click="selectedAiModeId = mode.id"
                    >
                      <span class="truncate">{{ mode.name }}</span>
                      <span
                        v-if="mode.builtIn"
                        class="dark-readable-meta shrink-0 text-[9px] text-on-surface-variant/70"
                      >
                        默认
                      </span>
                    </button>
                  </div>
                </div>

                <div v-if="selectedAiMode" class="min-w-0 space-y-2">
                  <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <label class="block text-xs font-semibold uppercase text-on-surface-variant">
                      模式名称
                      <input
                        :value="selectedAiMode.name"
                        @input="
                          store.updateAiPromptMode(selectedAiMode.id, {
                            name: ($event.target as HTMLInputElement).value,
                          })
                        "
                        type="text"
                        class="ui-field mt-1 w-full normal-case"
                      />
                    </label>
                    <button
                      type="button"
                      :class="cn('mt-5', serviceActionButtonClass('danger', 'field'))"
                      :disabled="selectedAiMode.builtIn"
                      @click="handleDeleteAiMode"
                    >
                      <Trash2 :size="13" />
                      删除
                    </button>
                  </div>
                  <div>
                    <label
                      for="ai-mode-prompt"
                      class="mb-1 block text-xs font-semibold uppercase text-on-surface-variant"
                    >
                      {{ t.settings.aiPromptLabel }}
                    </label>
                    <textarea
                      id="ai-mode-prompt"
                      :value="selectedAiMode.prompt"
                      @input="
                        store.updateAiPromptMode(selectedAiMode.id, {
                          prompt: ($event.target as HTMLTextAreaElement).value,
                        })
                      "
                      rows="7"
                      class="ui-field themed-scrollbar mt-1 min-h-20 w-full resize-y normal-case"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section
            id="settings-terminal"
            data-settings-section="terminal"
            tabindex="-1"
            class="min-w-0 py-6 outline-none"
          >
            <div class="mb-4 flex flex-wrap items-center gap-3">
              <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <SquareTerminal :size="15" class="shrink-0 text-primary" />
                <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.defaultTerminal }}</h3>
              </div>
            </div>
            <div class="grid min-w-0 gap-4">
              <div
                class="ui-segment h-fit w-fit"
              >
                <button
                  v-for="option in terminalOptions"
                  :key="option"
                  type="button"
                  @click="store.setDefaultTerminal(option)"
                  :class="segmentButtonClass(store.terminalPreferences.kind === option)"
                >
                  {{ t.settings.terminals[option] }}
                </button>
              </div>
              <div class="space-y-1.5">
                <Transition
                  enter-active-class="transition-[max-height,opacity,transform] duration-200 ease-out"
                  enter-from-class="max-h-0 opacity-0 -translate-y-1"
                  enter-to-class="max-h-28 opacity-100 translate-y-0"
                  leave-active-class="transition-[max-height,opacity,transform] duration-150 ease-in"
                  leave-from-class="max-h-28 opacity-100 translate-y-0"
                  leave-to-class="max-h-0 opacity-0 -translate-y-1"
                >
                  <div
                    v-if="terminalUsesCustomCommand"
                    class="min-w-0 overflow-hidden"
                  >
                    <label class="mb-2 block text-xs font-semibold uppercase text-on-surface-variant">
                      {{ t.settings.customCommand }}
                    </label>
                    <input
                      :value="store.terminalPreferences.customCommand"
                      @input="store.setDefaultTerminalCustomCommand(($event.target as HTMLInputElement).value)"
                      type="text"
                      :placeholder="t.settings.customCommandPlaceholder"
                      class="ui-field w-full font-mono"
                    />
                    <p class="mt-2 text-xs leading-5 text-on-surface-variant">{{ t.settings.defaultTerminalHint }}</p>
                  </div>
                </Transition>
                <p
                  v-if="store.terminalPreferences.kind === 'builtin'"
                  class="text-xs leading-5 text-on-surface-variant"
                >
                  {{ t.settings.builtinTerminalHint }}
                </p>
              </div>
            </div>
          </section>

          <section
            id="settings-applications"
            data-settings-section="applications"
            tabindex="-1"
            class="min-w-0 py-6 outline-none"
          >
            <div class="mb-4 flex flex-wrap items-start gap-3">
              <div class="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
                <Code2 :size="15" class="shrink-0 text-primary" />
                <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.externalApplications }}</h3>
                <span class="col-span-2 text-xs leading-5 text-on-surface-variant">
                  {{ t.settings.externalApplicationsUsageHint }}
                </span>
                <span v-if="externalApplicationFeedback" class="col-span-2 break-words text-xs text-status-warning">
                  {{ externalApplicationFeedback }}
                </span>
              </div>
              <button
                type="button"
                :class="cn('ml-auto shrink-0', serviceActionButtonClass('secondary', 'sm'))"
                @click="openExternalApplicationDialog()"
              >
                <Plus :size="12" />
                {{ t.settings.addExternalApplication }}
              </button>
            </div>
            <div class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-2">
              <article
                v-for="application in externalApplications"
                :key="application.id"
                role="button"
                tabindex="0"
                class="min-w-0 cursor-pointer rounded-md border border-border-subtle bg-surface px-3 py-2.5 transition-colors hover:bg-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                @click="openExternalApplicationDialog(application)"
                @keydown.enter.self.prevent="openExternalApplicationDialog(application)"
                @keydown.space.self.prevent="openExternalApplicationDialog(application)"
              >
                <div class="flex min-w-0 items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-1">
                      <span class="truncate text-xs font-semibold" :title="application.name">{{ application.name }}</span>
                      <span
                        class="shrink-0 rounded bg-surface-container px-1 py-0.5 text-[10px] font-medium leading-3 text-on-surface-variant"
                      >
                        {{
                          application.kind === "custom"
                            ? t.settings.customApplicationBadge
                            : t.settings.presetApplicationBadge
                        }}
                      </span>
                      <span
                        v-if="application.id === store.externalApplicationPreferences.defaultApplicationId"
                        class="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium leading-3 text-primary"
                      >
                        {{ t.settings.defaultApplicationBadge }}
                      </span>
                    </div>
                    <p
                      class="mt-1 truncate font-mono text-[11px] leading-4 text-on-surface-variant"
                      :title="application.command"
                    >
                      {{ application.command }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5" @click.stop>
                    <label :title="t.settings.setDefaultApplication" class="flex cursor-pointer items-center">
                      <input
                        type="radio"
                        name="default-external-application"
                        class="h-4 w-4 accent-primary"
                        :checked="application.id === store.externalApplicationPreferences.defaultApplicationId"
                        :disabled="!application.enabled"
                        :aria-label="`${t.settings.setDefaultApplication}: ${application.name}`"
                        @change="setDefaultExternalApplication(application)"
                      />
                    </label>
                    <label :title="t.settings.applicationEnabled" class="flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        class="h-4 w-4 accent-primary"
                        :checked="application.enabled"
                        :disabled="application.id === store.externalApplicationPreferences.defaultApplicationId"
                        :aria-label="`${t.settings.applicationEnabled}: ${application.name}`"
                        @change="
                          setExternalApplicationEnabled(application, ($event.target as HTMLInputElement).checked)
                        "
                      />
                    </label>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section
            id="settings-service"
            data-settings-section="service"
            tabindex="-1"
            class="min-w-0 py-6 outline-none"
          >
            <div class="mb-4 flex flex-wrap items-start gap-3">
              <div class="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
                <ServerCog :size="15" class="shrink-0 text-primary" />
                <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.projectLaunchService }}</h3>
                <span class="col-span-2 text-xs leading-5 text-on-surface-variant">{{
                  t.settings.projectLaunchServiceHint
                }}</span>
              </div>
              <div class="ml-auto flex shrink-0 items-center gap-2">
                <span
                  :class="cn('ui-status-pill', projectLaunchServiceStatusClass)"
                >
                  {{ projectLaunchServiceStatusLabel }}
                </span>
                <label class="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-on-surface">
                  <span>{{ t.settings.projectLaunchServiceMode }}</span>
                  <span class="text-[10px] font-medium text-on-surface-variant">
                    {{
                      store.projectLaunchServicePreferences.enabled
                        ? t.settings.projectLaunchServiceModeOn
                        : t.settings.projectLaunchServiceModeOff
                    }}
                  </span>
                  <ToggleSwitch
                    v-model="projectLaunchServiceSwitchOn"
                    :disabled="projectLaunchServiceBusy"
                    :aria-label="
                      store.projectLaunchServicePreferences.enabled
                        ? t.settings.projectLaunchServiceDisable
                        : t.settings.projectLaunchServiceEnable
                    "
                    @update:model-value="handleToggleProjectLaunchService"
                  />
                </label>
              </div>
            </div>

            <div class="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]">
              <dl class="grid gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[8rem_minmax(0,1fr)]">
                <dt class="font-semibold text-on-surface-variant">{{ t.settings.projectLaunchServicePlatform }}</dt>
                <dd class="min-w-0 break-words font-mono text-on-surface">
                  {{ projectLaunchServiceStatus?.platform || "-" }} /
                  {{ projectLaunchServiceStatus?.architecture || "-" }}
                </dd>
                <dt class="font-semibold text-on-surface-variant">{{ t.settings.projectLaunchServiceVersion }}</dt>
                <dd class="min-w-0 break-all font-mono text-on-surface-variant">
                  {{ projectLaunchServiceStatus?.serviceVersion || "-" }}
                </dd>
                <dt class="font-semibold text-on-surface-variant">{{ t.settings.projectLaunchServiceProtocol }}</dt>
                <dd class="min-w-0 break-words font-mono text-on-surface-variant">
                  {{
                    projectLaunchServiceStatus?.protocolVersion ? `v${projectLaunchServiceStatus.protocolVersion}` : "-"
                  }}
                </dd>
                <dt class="font-semibold text-on-surface-variant">{{ t.settings.projectLaunchServiceScheduler }}</dt>
                <dd :class="cn('min-w-0 break-words font-semibold', projectLaunchServiceSchedulerClass)">
                  {{ projectLaunchServiceSchedulerLabel }}
                </dd>
                <dt class="font-semibold text-on-surface-variant">{{ t.settings.projectLaunchServiceAsset }}</dt>
                <dd class="min-w-0 break-all font-mono text-on-surface-variant">
                  {{ projectLaunchServiceStatus?.expectedAssetName || "-" }}
                </dd>
                <dt class="font-semibold text-on-surface-variant">{{ t.settings.projectLaunchServiceExecutable }}</dt>
                <dd class="min-w-0 break-all font-mono text-on-surface-variant">
                  {{ projectLaunchServiceStatus?.executablePath || "-" }}
                </dd>
                <dt class="font-semibold text-on-surface-variant">{{ t.settings.projectLaunchServiceLogRetention }}</dt>
                <dd class="min-w-0 break-words text-on-surface-variant">
                  {{ projectLaunchServiceLogRetentionSummary }}
                </dd>
              </dl>

              <div class="flex min-w-0 flex-wrap content-start gap-1.5">
                <button
                  v-if="
                    projectLaunchServiceStatus &&
                    !projectLaunchServiceStatus.installed &&
                    projectLaunchServiceStatus.expectedAssetName
                  "
                  type="button"
                  :class="serviceActionButtonClass('primary')"
                  :disabled="projectLaunchServiceBusy"
                  :aria-busy="projectLaunchServiceDownloading"
                  @click="handleDownloadProjectLaunchService"
                >
                  <RefreshCw v-if="projectLaunchServiceDownloading" :size="13" class="animate-spin" />
                  <Download v-else :size="13" />
                  {{
                    projectLaunchServiceDownloading
                      ? t.settings.projectLaunchServiceDownloading
                      : t.settings.projectLaunchServiceDownload
                  }}
                </button>
                <button
                  type="button"
                  :class="serviceActionButtonClass('primary')"
                  :disabled="projectLaunchServiceBusy || !projectLaunchServiceStatus?.installed"
                  :aria-busy="projectLaunchServiceUpdateChecking"
                  @click="handleCheckProjectLaunchServiceUpdate"
                >
                  <RefreshCw :size="13" :class="projectLaunchServiceUpdateChecking ? 'animate-spin' : ''" />
                  {{
                    projectLaunchServiceUpdateChecking
                      ? t.settings.projectLaunchServiceCheckingUpdate
                      : t.settings.projectLaunchServiceCheckUpdate
                  }}
                </button>
                <button
                  type="button"
                  :class="serviceActionButtonClass()"
                  :disabled="projectLaunchServiceBusy"
                  :aria-busy="projectLaunchServiceRechecking"
                  @click="handleRecheckProjectLaunchService"
                >
                  <RefreshCw v-if="projectLaunchServiceRechecking" :size="13" class="animate-spin" />
                  <ShieldCheck v-else :size="13" />
                  {{
                    projectLaunchServiceRechecking
                      ? t.settings.projectLaunchServiceRechecking
                      : t.settings.projectLaunchServiceRecheck
                  }}
                </button>
                <button
                  type="button"
                  :class="serviceActionButtonClass()"
                  :disabled="projectLaunchServiceBusy"
                  @click="store.openProjectLaunchServiceDirectory"
                >
                  <FolderOpen :size="13" />
                  {{ t.settings.projectLaunchServiceOpenDirectory }}
                </button>
                <button
                  type="button"
                  :class="serviceActionButtonClass()"
                  :disabled="projectLaunchServiceBusy"
                  @click="store.openProjectLaunchServiceReleases"
                >
                  <Github :size="13" />
                  {{ t.settings.projectLaunchServiceOpenReleases }}
                </button>
              </div>
            </div>

            <div
              v-if="projectLaunchServiceHasNotice"
              :class="cn('ui-banner mt-3 px-3 py-2 text-xs leading-5', projectLaunchServiceNoticeClass)"
              role="status"
              aria-live="polite"
            >
              <p class="font-semibold">{{ projectLaunchServiceStatusLabel }}</p>
              <p v-if="projectLaunchServiceStatus?.message" class="mt-0.5 break-words text-on-surface-variant">
                {{ projectLaunchServiceStatus.message }}
              </p>
              <p v-if="projectLaunchServiceStatus?.eventsTruncated" class="mt-1 text-status-warning">
                {{ t.settings.projectLaunchServiceLogsTruncated }}
              </p>
              <p v-if="projectLaunchServiceStatus?.scheduler?.lastError" class="mt-1 break-words text-status-error">
                {{ t.settings.projectLaunchServiceSchedulerLastError }}:
                {{ projectLaunchServiceStatus.scheduler.lastError }}
              </p>
            </div>
            <div
              v-if="store.projectLaunchServicePreferences.enabled"
              class="mt-2 text-xs leading-5 text-status-warning"
            >
              {{ t.settings.projectLaunchServiceEnabledHint }}
            </div>
            <details class="group mt-3 border-t border-border-subtle pt-2.5">
              <summary class="cursor-pointer text-xs font-semibold text-on-surface-variant">
                {{ t.settings.projectLaunchServiceNotes }}
              </summary>
              <p class="mt-2 text-[11px] leading-4 text-on-surface-variant">
                {{ t.settings.projectLaunchServiceManualHint }}
              </p>
            </details>
          </section>

          <section id="settings-logs" data-settings-section="logs" tabindex="-1" class="min-w-0 py-6 outline-none">
            <div>
              <div class="space-y-4">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <FileText :size="15" class="shrink-0 text-primary" />
                    <h3 class="text-sm font-semibold text-on-surface">
                      {{ t.settings.projectLaunchServiceLogPersistence }}
                    </h3>
                  </div>
                  <p class="mt-1 text-xs leading-5 text-on-surface-variant">
                    {{ t.settings.projectLaunchServiceLogPersistenceHint }}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                  <label
                    class="inline-flex min-h-9 items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-on-surface"
                  >
                    <span class="min-w-0">{{ t.settings.projectLaunchServiceLogPersistLabel }}</span>
                    <ToggleSwitch
                      :model-value="Boolean(logRetentionDraft?.persist)"
                      :disabled="!logRetentionReady || !logRetentionDraft || logRetentionSaving || logRetentionClearBusy"
                      :aria-label="t.settings.projectLaunchServiceLogPersistLabel"
                      @update:model-value="updateLogRetentionPersistence"
                    />
                  </label>
                  <button
                    type="button"
                    :class="serviceActionButtonClass('danger')"
                    :disabled="!logRetentionReady || logRetentionSaving || logRetentionClearBusy"
                    :aria-busy="logRetentionClearBusy"
                    @click="logRetentionClearOpen = true"
                  >
                    <Trash2 :size="13" />
                    {{ t.settings.projectLaunchServiceLogClear }}
                  </button>
                  <Terminal v-if="store.supportsBridge" project-id="" history-only />
                </div>
              </div>

              <div
                v-if="logRetentionDraft && projectLaunchServiceLogRetentionStatus"
                class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3"
              >
                <label class="min-w-0 text-xs font-semibold text-on-surface-variant">
                  {{ t.settings.projectLaunchServiceLogCompletedRuns }}
                  <input
                    type="number"
                    min="1"
                    step="1"
                    :value="logRetentionDraft.maxCompletedRunsPerProject"
                    :disabled="!logRetentionReady || logRetentionSaving || logRetentionClearBusy"
                    class="ui-field mt-1 h-9 w-full text-sm font-normal text-on-surface"
                    @change="updateLogRetentionRuns"
                  />
                </label>
                <label class="min-w-0 text-xs font-semibold text-on-surface-variant">
                  {{ t.settings.projectLaunchServiceLogPerRunSize }}
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    :value="formatLogMiB(logRetentionDraft.maxBytesPerRun)"
                    :disabled="!logRetentionReady || logRetentionSaving || logRetentionClearBusy"
                    class="ui-field mt-1 h-9 w-full text-sm font-normal text-on-surface"
                    @change="updateLogRetentionSize('maxBytesPerRun', $event)"
                  />
                </label>
                <label class="min-w-0 text-xs font-semibold text-on-surface-variant">
                  {{ t.settings.projectLaunchServiceLogTotalSize }}
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    :value="formatLogMiB(logRetentionDraft.maxBytesTotal)"
                    :disabled="!logRetentionReady || logRetentionSaving || logRetentionClearBusy"
                    class="ui-field mt-1 h-9 w-full text-sm font-normal text-on-surface"
                    @change="updateLogRetentionSize('maxBytesTotal', $event)"
                  />
                </label>
              </div>
              <div
                v-if="logRetentionDraft && projectLaunchServiceLogRetentionStatus"
                class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-on-surface-variant"
              >
                <span>
                  {{ t.settings.projectLaunchServiceLogUsage }}:
                  <strong class="font-semibold text-on-surface">
                    {{ formatLogBytes(projectLaunchServiceLogRetentionStatus.usage.totalBytes) }} /
                    {{ formatLogBytes(projectLaunchServiceLogRetentionStatus.policy.maxBytesTotal) }}
                  </strong>
                </span>
                <span>
                  {{ projectLaunchServiceLogRetentionStatus.usage.fileCount }}
                  {{ t.settings.projectLaunchServiceLogFiles }}
                </span>
              </div>
              <p v-else class="mt-2 text-[11px] leading-4 text-on-surface-variant">
                {{ t.settings.projectLaunchServiceLogUnavailable }}
              </p>
              <p
                v-if="logRetentionDraft && !logRetentionDraft.persist"
                class="mt-2 text-[11px] leading-4 text-status-warning"
              >
                {{ t.settings.projectLaunchServiceLogPersistenceOff }}
              </p>
              <p
                v-if="logRetentionFeedback"
                :class="
                  cn(
                    'mt-2 text-[11px] leading-4',
                    logRetentionFeedbackTone === 'error' ? 'text-status-error' : 'text-status-running',
                  )
                "
                role="status"
                aria-live="polite"
              >
                {{ logRetentionFeedback }}
              </p>
            </div>
          </section>

          <section id="settings-backup" data-settings-section="backup" tabindex="-1" class="min-w-0 py-6 outline-none">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div class="flex shrink-0 items-center gap-2">
                <Archive :size="15" class="shrink-0 text-primary" />
                <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.projectConfig }}</h3>
              </div>
              <p v-if="store.projectStorageMessage" class="break-words text-xs leading-5 text-on-surface-variant">
                {{ store.projectStorageMessage }}
              </p>
            </div>
            <BackupTools />
          </section>

          <section id="settings-data" data-settings-section="data" tabindex="-1" class="min-w-0 py-6 outline-none">
            <div class="mb-4 space-y-1">
              <div class="flex shrink-0 items-center gap-2">
                <Database :size="15" class="shrink-0 text-primary" />
                <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.dataTools }}</h3>
              </div>
              <p class="text-xs leading-5 text-on-surface-variant">{{ t.settings.dataToolsDescription }}</p>
            </div>
            <p
              v-if="store.localStateWriteError"
              class="ui-banner ui-banner--warning mb-3 px-3 py-2 text-xs leading-5"
            >
              {{ store.localStateWriteError }}
            </p>

            <div class="space-y-3">
              <div class="ui-card px-3 py-3">
                <div class="mb-1.5 text-xs font-semibold text-on-surface-variant">{{ t.settings.storageOverview }}</div>
                <dl class="settings-storage-grid grid grid-cols-1 gap-x-6 gap-y-2 text-xs leading-5 text-on-surface-variant md:grid-cols-2 xl:grid-cols-3">
                  <div class="flex justify-between gap-2">
                    <dt>{{ t.settings.storageHostVersion }}</dt>
                    <dd class="font-mono">{{ store.storageOverview?.hostVersion || "—" }}</dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt>{{ t.settings.storagePublicProjects }}</dt>
                    <dd>{{ store.storageOverview?.projects.publicCount ?? "—" }}</dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt>{{ t.settings.storagePrivateProjects }}</dt>
                    <dd>{{ store.storageOverview?.projects.privateLocalCount ?? "—" }}</dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt>{{ t.settings.storageLegacyPrivateDocs }}</dt>
                    <dd>{{ store.storageOverview?.projects.legacyPrivateDocCount ?? "—" }}</dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt>{{ t.settings.storageOrphanDocs }}</dt>
                    <dd>{{ store.storageOverview?.projects.orphanDocumentCount ?? "—" }}</dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt>{{ t.settings.storageLegacyKeys }}</dt>
                    <dd>{{ store.storageOverview?.legacyDbStorageKeys.length ?? "—" }}</dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt>{{ t.settings.storageLocalDataSize }}</dt>
                    <dd>
                      {{ store.storageOverview ? formatDataSize(store.storageOverview.sizes.localDataBytes) : "—" }}
                    </dd>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <dt>{{ t.settings.projectLaunchServiceLogPersistence }}</dt>
                    <dd>
                      {{ store.storageOverview ? formatDataSize(store.storageOverview.sizes.runtimeBytes || 0) : "—" }}
                    </dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt>{{ t.settings.storageLegacySize }}</dt>
                    <dd>{{ store.storageOverview ? formatDataSize(store.storageOverview.sizes.legacyBytes) : "—" }}</dd>
                  </div>
                  <div class="flex justify-between gap-2">
                    <dt>{{ t.settings.storageSyncEstimate }}</dt>
                    <dd>
                      {{ store.storageOverview ? formatDataSize(store.storageOverview.sizes.syncDocumentBytes) : "—" }}
                    </dd>
                  </div>
                </dl>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  :disabled="store.dataToolsBusy || migrationRetryDisabled"
                  @click="store.retryStorageMigration"
                  :class="serviceActionButtonClass()"
                >
                  <RotateCcw :size="14" />
                  {{ store.dataToolsBusy ? t.settings.cleanupRunning : t.settings.migrationRetry }}
                </button>
                <span class="text-xs text-on-surface-variant">
                  {{ t.settings.dataMigration }}: {{ migrationStatusLabel }}
                  <template v-if="store.migrationProgress && store.migrationProgress.totalCount > 0">
                    ({{ store.migrationProgress.verifiedCount }}/{{ store.migrationProgress.totalCount }})
                  </template>
                </span>
              </div>

              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  @click="openCleanupDialog"
                  :class="serviceActionButtonClass()"
                >
                  <Trash2 :size="14" />
                  {{ t.settings.dataCleanup }}
                </button>
                <button
                  type="button"
                  @click="store.openLocalDataDirectory"
                  :class="serviceActionButtonClass()"
                >
                  <FolderOpen :size="14" />
                  {{ t.settings.openLocalDataDirectory }}
                </button>
                <button
                  type="button"
                  @click="store.openLegacyDataDirectory"
                  :class="serviceActionButtonClass()"
                >
                  <FolderOpen :size="14" />
                  {{ t.settings.openLegacyDataDirectory }}
                </button>
              </div>
              <p v-if="store.cleanupMessage" class="text-xs text-on-surface-variant">{{ store.cleanupMessage }}</p>
            </div>
          </section>

          <section id="settings-about" data-settings-section="about" tabindex="-1" class="min-w-0 py-6 outline-none">
            <div class="mb-4 flex items-center gap-2">
              <Info :size="15" class="shrink-0 text-primary" />
              <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.about }}</h3>
            </div>
            <div
              class="flex flex-wrap items-center justify-between gap-3 text-sm"
            >
              <div class="flex items-center gap-2 text-sm text-on-surface-variant">
                <span class="font-medium">{{ t.settings.version }}</span>
                <span class="rounded-full bg-surface-variant px-2 py-0.5 font-mono text-xs text-on-surface-variant"
                  >v1.11.0</span
                >
              </div>
              <a
                :href="githubRepositoryUrl"
                target="_blank"
                rel="noopener noreferrer"
                @click.prevent="handleOpenGithubRepository"
                class="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:underline"
              >
                <Github :size="14" />
                GitHub
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>

    <BaseModal
      :open="externalApplicationDialogOpen"
      as="form"
      :width="448"
      :title="editingExternalApplicationId ? t.settings.editExternalApplication : t.settings.addExternalApplication"
      body-class="p-3 space-y-3"
      @submit="saveExternalApplication"
      @close="externalApplicationDialogOpen = false"
    >
      <label class="min-w-0 text-xs font-semibold text-on-surface-variant">
        {{ t.settings.externalApplicationName }}
        <input
          v-model="externalApplicationDraft.name"
          autofocus
          autocomplete="off"
          class="ui-field mt-1 w-full text-sm font-normal text-on-surface"
          :class="externalApplicationErrors.name && 'border-status-error'"
        />
        <span v-if="externalApplicationErrors.name" class="mt-0.5 block text-[10px] text-status-error">
          {{ externalApplicationErrors.name }}
        </span>
      </label>
      <label class="min-w-0 text-xs font-semibold text-on-surface-variant">
        {{ t.settings.externalApplicationCommand }}
        <textarea
          v-model="externalApplicationDraft.command"
          autocomplete="off"
          rows="3"
          class="ui-field themed-scrollbar mt-1 min-h-20 w-full resize-y font-mono text-sm font-normal leading-5 text-on-surface"
          :class="externalApplicationErrors.command && 'border-status-error'"
          :placeholder="t.settings.externalApplicationCommandPlaceholder"
        />
        <span v-if="externalApplicationErrors.command" class="mt-0.5 block text-[10px] text-status-error">
          {{ externalApplicationErrors.command }}
        </span>
      </label>
      <p class="text-[10px] leading-4 text-on-surface-variant">
        {{ t.settings.externalApplicationCommandHint }}
      </p>
      <p v-if="externalApplicationFeedback" class="text-[10px] leading-4 text-status-warning">
        {{ externalApplicationFeedback }}
      </p>
      <template #footer-left>
        <button
          v-if="editingExternalApplication?.kind === 'custom'"
          type="button"
          :class="serviceActionButtonClass('danger')"
          @click="deleteExternalApplication"
        >
          <Trash2 :size="13" />
          {{ t.common.delete }}
        </button>
        <button
          v-else-if="
            editingExternalApplication &&
            editingExternalApplication.command !==
              (editingExternalApplication.kind === 'vscode' ? 'code {path}' : 'cursor {path}')
          "
          type="button"
          :class="serviceActionButtonClass()"
          @click="
            store.restoreExternalApplicationNativeLaunch(editingExternalApplication.id);
            externalApplicationDialogOpen = false;
          "
        >
          {{ t.settings.restoreNativeLauncher }}
        </button>
      </template>
      <template #footer>
        <button type="button" class="ui-btn ui-btn--ghost" @click="externalApplicationDialogOpen = false">
          {{ t.common.cancel }}
        </button>
        <button type="submit" class="ui-btn ui-btn--primary">
          {{ t.common.save }}
        </button>
      </template>
    </BaseModal>

    <BaseModal
      :open="environmentDialogOpen"
      as="form"
      :width="448"
      body-class="p-3 space-y-3"
      :aria-label="
        editingBuiltinEnvironmentKey || editingCustomEnvironmentId ? t.settings.editEnvironment : t.settings.addEnvironment
      "
      @submit="saveEnvironment"
      @close="environmentDialogOpen = false"
    >
      <template #header>
        <div class="flex min-w-0 items-center justify-between gap-2">
          <h3 class="min-w-0 truncate text-sm font-bold text-on-surface">
            {{
              editingBuiltinEnvironmentKey || editingCustomEnvironmentId
                ? t.settings.editEnvironment
                : t.settings.addEnvironment
            }}
          </h3>
          <span class="shrink-0 font-mono text-[10px] text-on-surface-variant">
            {{ editingBuiltinEnvironmentKey || t.settings.environmentGlobalHint }}
          </span>
        </div>
      </template>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="min-w-0 text-xs font-semibold text-on-surface-variant">
          {{ t.settings.environmentName }}
          <span
            v-if="editingBuiltinEnvironmentKey"
            class="ui-field mt-1 flex w-full items-center text-on-surface-variant"
          >
            {{ customEnvironmentDraft.name }}
          </span>
          <input
            v-else
            v-model="customEnvironmentDraft.name"
            autofocus
            class="ui-field mt-1 w-full text-sm font-normal text-on-surface"
            :class="customEnvironmentErrors.name && 'border-status-error'"
            autocomplete="off"
          />
          <span v-if="customEnvironmentErrors.name" class="mt-0.5 block text-[10px] text-status-error">
            {{ customEnvironmentErrorText("name") }}
          </span>
        </label>
        <label class="min-w-0 text-xs font-semibold text-on-surface-variant">
          {{ t.settings.environmentCommand }}
          <input
            v-model="customEnvironmentDraft.command"
            :autofocus="Boolean(editingBuiltinEnvironmentKey)"
            class="ui-field mt-1 w-full font-mono text-sm font-normal text-on-surface"
            :class="customEnvironmentErrors.command && 'border-status-error'"
            autocomplete="off"
            :placeholder="t.settings.environmentCommandPlaceholder"
          />
          <span v-if="customEnvironmentErrors.command" class="mt-0.5 block text-[10px] text-status-error">
            {{ customEnvironmentErrorText("command") }}
          </span>
        </label>
      </div>
      <label class="block text-xs font-semibold text-on-surface-variant">
        {{ t.settings.environmentVersionArgs }}
        <input
          v-model="customEnvironmentDraft.versionArgs"
          class="ui-field mt-1 w-full font-mono text-sm font-normal text-on-surface"
          :class="customEnvironmentErrors.versionArgs && 'border-status-error'"
          autocomplete="off"
          :placeholder="t.settings.environmentVersionArgsPlaceholder"
        />
        <span v-if="customEnvironmentErrors.versionArgs" class="mt-0.5 block text-[10px] text-status-error">
          {{ customEnvironmentErrorText("versionArgs") }}
        </span>
      </label>
      <template #footer-left>
        <button
          v-if="editingBuiltinEnvironmentKey && editingBuiltinHasOverride"
          type="button"
          :class="serviceActionButtonClass()"
          @click="restoreBuiltinEnvironment"
        >
          <RotateCcw :size="13" />
          {{ t.settings.restoreEnvironmentDefault }}
        </button>
        <button
          v-else-if="editingCustomEnvironmentId"
          type="button"
          :class="serviceActionButtonClass('danger')"
          @click="requestDeleteCustomEnvironment"
        >
          <Trash2 :size="13" />
          {{ t.common.delete }}
        </button>
      </template>
      <template #footer>
        <button type="button" class="ui-btn ui-btn--ghost" @click="environmentDialogOpen = false">
          {{ t.common.cancel }}
        </button>
        <button type="submit" class="ui-btn ui-btn--primary">
          {{ t.common.save }}
        </button>
      </template>
    </BaseModal>

    <ActionDialog
      :open="logRetentionClearOpen"
      tone="danger"
      icon="trash"
      :title="t.settings.projectLaunchServiceLogClearTitle"
      :message="t.settings.projectLaunchServiceLogClearMessage"
      :primary-label="t.settings.projectLaunchServiceLogClear"
      :busy="logRetentionClearBusy"
      :busy-label="t.settings.projectLaunchServiceLogClearBusy"
      :cancel-label="t.common.cancel"
      @cancel="logRetentionClearOpen = false"
      @primary="confirmClearLogRetention"
    />

    <ActionDialog
      :open="projectLaunchServiceDisableWarningOpen"
      tone="warning"
      icon="alert"
      :title="t.settings.projectLaunchServiceDisableBlockedTitle"
      :message="t.settings.projectLaunchServiceDisableBlockedMessage"
      :primary-label="t.common.close"
      @cancel="projectLaunchServiceDisableWarningOpen = false"
      @primary="projectLaunchServiceDisableWarningOpen = false"
    />

    <ActionDialog
      :open="projectLaunchServiceUpdateDialogOpen"
      tone="warning"
      icon="alert"
      :title="t.settings.projectLaunchServiceUpdateTitle"
      :message="projectLaunchServiceUpdateDialogMessage"
      :detail="projectLaunchServiceUpdateDialogDetail"
      :primary-label="
        projectLaunchServiceUpdateDownloadAllowed ? t.settings.projectLaunchServiceDownload : t.common.close
      "
      :cancel-label="projectLaunchServiceUpdateDownloadAllowed ? t.common.cancel : ''"
      @cancel="projectLaunchServiceUpdateDialogOpen = false"
      @primary="confirmProjectLaunchServiceUpdate"
    />

    <ActionDialog
      :open="Boolean(pendingDeleteCustomEnvironmentId)"
      tone="danger"
      icon="trash"
      :title="t.settings.deleteCustomEnvironment"
      :message="t.settings.deleteCustomEnvironmentConfirm"
      :primary-label="t.common.delete"
      :cancel-label="t.common.cancel"
      @cancel="pendingDeleteCustomEnvironmentId = null"
      @primary="confirmDeleteCustomEnvironment"
    />
  </div>
  <BaseModal
    :open="cleanupDialogOpen"
    :width="672"
    labelledby="cleanup-dialog-title"
    :body-aria-busy="cleanupScanning"
    @close="cleanupDialogOpen = false"
  >
    <template #header>
      <h3 id="cleanup-dialog-title" class="min-w-0 truncate text-sm font-bold text-on-surface">{{ t.settings.dataCleanup }}</h3>
    </template>
    <div class="space-y-4">
      <div
        v-if="cleanupScanning"
        role="status"
        aria-live="polite"
        class="flex min-h-32 items-center justify-center gap-2 text-sm text-on-surface-variant"
      >
        <LoaderCircle :size="18" class="animate-spin" aria-hidden="true" />
        <span>{{ t.settings.cleanupScanning }}</span>
      </div>
      <template v-else-if="store.cleanupPlan">
        <p class="flex items-start gap-2 text-xs leading-5 text-on-surface-variant">
          <Info :size="15" class="mt-0.5 shrink-0" aria-hidden="true" />
          {{ t.settings.cleanupSafetyHint }}
        </p>
        <section
          v-for="category in ['sync', 'local', 'cache'] as const"
          :key="category"
          :aria-labelledby="`cleanup-category-${category}`"
          class="min-w-0 border-t border-border-subtle pt-5"
        >
          <h4 :id="`cleanup-category-${category}`" class="mb-2.5 text-xs font-bold text-on-surface-variant">
            {{
              category === "sync"
                ? t.settings.cleanupCategorySync
                : category === "local"
                  ? t.settings.cleanupCategoryLocal
                  : t.settings.cleanupCategoryCache
            }}
          </h4>
          <div class="space-y-2">
            <div
              v-for="item in cleanupItems.filter((candidate) => candidate.category === category)"
              :key="item.id"
              class="ui-card px-3 py-2.5"
            >
              <label class="flex items-start gap-2.5" :class="{ 'opacity-50': item.disabledReason }">
                <input
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 accent-primary"
                  :aria-label="item.label"
                  :checked="cleanupSelection[item.id]"
                  :disabled="Boolean(item.disabledReason) || store.cleanupRunning || cleanupScanning"
                  @change="cleanupSelection[item.id] = ($event.target as HTMLInputElement).checked"
                />
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                    <span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span class="text-sm font-medium text-on-surface">{{ item.label }}</span>
                      <span
                        class="text-[10px] font-medium"
                        :class="
                          item.recommendation === 'recommended'
                            ? 'text-primary'
                            : item.recommendation === 'review'
                              ? 'text-status-warning'
                              : 'text-on-surface-variant'
                        "
                      >
                        {{
                          item.recommendation === "recommended"
                            ? t.settings.cleanupRecommended
                            : item.recommendation === "review"
                              ? t.settings.cleanupReview
                              : t.settings.cleanupKeep
                        }}
                      </span>
                      <button
                        type="button"
                        class="group relative inline-flex h-5 w-5 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-variant hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        :aria-label="`${item.label}：${item.safetyHint}`"
                        @click.prevent.stop
                      >
                        <Info :size="13" aria-hidden="true" />
                        <span
                          class="pointer-events-none absolute left-1/2 top-full z-[70] mt-1.5 hidden w-64 -translate-x-1/2 rounded-md border border-border-subtle bg-surface-container-high px-2.5 py-2 text-left text-[11px] font-normal leading-4 text-on-surface shadow-popover group-hover:block group-focus-visible:block"
                        >
                          {{ item.safetyHint }}
                        </span>
                      </button>
                    </span>
                    <span class="text-xs text-on-surface-variant">
                      <template v-if="item.count !== null"
                        >{{ t.settings.cleanupCount }}: {{ item.count }}</template
                      >
                      <template v-if="item.estimatedBytes > 0">
                        {{ item.count !== null ? " · " : "" }}~{{ formatDataSize(item.estimatedBytes) }}
                      </template>
                    </span>
                  </span>
                  <span class="mt-0.5 block text-xs leading-5 text-on-surface-variant">{{
                    item.description
                  }}</span>
                  <span v-if="item.disabledReason" class="mt-1 block text-xs text-status-error">
                    {{ item.disabledReason }}
                  </span>
                </span>
              </label>
              <details
                v-if="item.keys.length || item.paths.length"
                class="group ml-6 mt-2 border-t border-border-subtle pt-2 text-xs text-on-surface-variant"
              >
                <summary
                  class="flex cursor-pointer list-none items-center gap-1 font-medium text-primary [&::-webkit-details-marker]:hidden"
                >
                  <ChevronDown
                    :size="13"
                    class="shrink-0 transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                  {{ item.keys.length ? t.settings.cleanupViewKeys : t.settings.cleanupViewPaths }}
                </summary>
                <p v-if="item.keys.length" class="mt-2">{{ t.settings.cleanupKeyNamesOnly }}</p>
                <ul class="mt-2 space-y-1 font-mono">
                  <li v-for="entry in item.keys.length ? item.keys : item.paths" :key="entry" class="break-all">
                    {{ entry }}
                  </li>
                </ul>
              </details>
            </div>
          </div>
        </section>
      </template>
      <p v-else role="alert" class="text-sm text-status-error">{{ t.settings.cleanupScanFailed }}</p>

      <div v-if="store.cleanupResults.length" class="space-y-1 rounded-lg bg-surface-container-low px-3 py-2">
        <div
          v-for="result in store.cleanupResults"
          :key="result.id"
          class="flex items-start justify-between gap-2 text-xs"
          :class="result.ok ? 'text-on-surface-variant' : 'text-status-error'"
        >
          <span class="font-medium">{{ result.label }}</span>
          <span class="text-right">{{ result.ok ? "✓" : "✗" }} {{ result.message }}</span>
        </div>
      </div>
      <p v-if="store.cleanupMessage" class="text-xs text-on-surface-variant">{{ store.cleanupMessage }}</p>
    </div>
    <template #footer>
      <button type="button" class="ui-btn ui-btn--ghost" @click="cleanupDialogOpen = false">
        {{ t.common.close }}
      </button>
      <button
        type="button"
        class="ui-btn ui-btn--danger"
        :disabled="!cleanupRunnable"
        @click="requestCleanupRun"
      >
        {{ store.cleanupRunning ? t.settings.cleanupRunning : t.settings.cleanupRun }}
      </button>
    </template>
  </BaseModal>

  <Teleport to="body">
    <ActionDialog
      :open="cleanupConfirmOpen"
      tone="danger"
      icon="trash"
      :title="t.settings.cleanupConfirm"
      :message="t.settings.cleanupSyncWarning"
      :primary-label="t.settings.cleanupConfirm"
      :cancel-label="t.common.cancel"
      @cancel="cleanupConfirmOpen = false"
      @primary="
        () => {
          cleanupConfirmOpen = false;
          runSelectedCleanup();
        }
      "
    />
  </Teleport>
</template>

<style scoped>
.settings-sections :is(input[type="text"], input[type="password"], input[type="number"], textarea, .ui-field) {
  min-width: 0;
}

.settings-sections button > svg {
  flex-shrink: 0;
}

.settings-storage-grid > div {
  min-width: 0;
  align-items: baseline;
}

.settings-storage-grid dd {
  flex-shrink: 0;
  color: var(--color-on-surface);
  font-variant-numeric: tabular-nums;
}
</style>
