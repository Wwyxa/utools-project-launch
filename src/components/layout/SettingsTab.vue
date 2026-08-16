<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowLeft,
  Brain,
  Code2,
  Download,
  FolderCog,
  Github,
  Info,
  Monitor,
  MonitorCog,
  Moon,
  RefreshCw,
  Plus,
  RotateCcw,
  ServerCog,
  Settings2,
  SquareTerminal,
  Sun,
  Trash2,
  Upload,
  WandSparkles,
  ChevronDown,
  Check,
} from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import ActionDialog from "../ActionDialog.vue";
import { getProjectBridge } from "../../lib/projectBridge";
import {
  formatEnvironmentArguments,
  parseEnvironmentArguments,
  type CustomEnvironmentToolErrors,
} from "../../lib/environmentTools";
import type { AiProviderKind, DefaultTerminalKind, EnvironmentToolKey, ExternalApplication } from "../../types";

const store = useStore();
const t = useI18n();
const githubRepositoryUrl = "https://github.com/Wwyxa/utools-project-launch";

const hostPlatform = window.navigator.platform || window.navigator.userAgent || "";
const fallbackTerminalOptions: DefaultTerminalKind[] = /win/i.test(hostPlatform)
  ? ["windows-terminal", "powershell", "cmd"]
  : /linux/i.test(hostPlatform)
    ? ["linux-terminal"]
    : ["terminal-app", "iterm2", "warp"];
const isAiModelMenuOpen = ref(false);
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
const aiProviderOptions: AiProviderKind[] = ["utools", "openai-compatible", "anthropic-compatible"];
let stopAppEscapeListener = () => {};

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
const terminalOptions: DefaultTerminalKind[] = [...fallbackTerminalOptions, "custom"];
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
const aiModelLabel = computed(
  () =>
    aiModelOptions.value.find((option) => option.value === store.aiPreferences.model)?.label ||
    t.value.settings.aiModelPlaceholder,
);
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
const projectLaunchServiceBusy = computed(() => projectLaunchServiceStatus.value?.state === "starting");
const projectLaunchServiceStatusLabel = computed(() => {
  const state = projectLaunchServiceStatus.value?.state;
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
const projectLaunchServiceStatusClass = computed(() => {
  const state = projectLaunchServiceStatus.value?.state;
  if (state === "healthy") return "border-status-running/30 bg-status-running/10 text-status-running";
  if (state === "incompatible" || state === "unavailable")
    return "border-status-error/30 bg-status-error/10 text-status-error";
  if (state === "starting") return "border-primary/30 bg-primary/10 text-primary";
  return "border-status-warning/30 bg-status-warning/10 text-status-warning";
});
const projectLaunchServiceHasNotice = computed(() => {
  const status = projectLaunchServiceStatus.value;
  return Boolean(status?.message || status?.eventsTruncated || status?.scheduler?.lastError);
});
const projectLaunchServiceNoticeClass = computed(() => {
  const status = projectLaunchServiceStatus.value;
  if (status?.scheduler?.lastError || status?.state === "incompatible" || status?.state === "unavailable") {
    return "border-status-error/30 bg-status-error/10 text-status-error";
  }
  if (status?.eventsTruncated || status?.state === "installed") {
    return "border-status-warning/30 bg-status-warning/10 text-status-warning";
  }
  return status?.state === "healthy"
    ? "border-status-running/30 bg-status-running/10 text-status-running"
    : "border-primary/30 bg-primary/10 text-primary";
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
  cn(
    "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all",
    active
      ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
      : "text-on-surface-variant hover:bg-surface-container",
  );

const loadAiModels = async () => {
  await store.refreshAiModels();
  if (store.aiPreferences.provider === "utools" && !store.aiPreferences.model && store.aiModels[0]) {
    store.setAiPreferences({ model: store.aiModels[0].id });
  }
};

const selectAiModel = (model: string) => {
  store.setAiPreferences({ model });
  isAiModelMenuOpen.value = false;
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (externalApplicationDialogOpen.value) {
    externalApplicationDialogOpen.value = false;
    event.detail.handle();
    return;
  }
  if (environmentDialogOpen.value) {
    environmentDialogOpen.value = false;
    event.detail.handle();
    return;
  }
  if (!isAiModelMenuOpen.value) return;
  isAiModelMenuOpen.value = false;
  event.detail.handle();
};

const handleTestAi = async () => {
  await store.testAiConfiguration();
};

const handleOpenGithubRepository = async () => {
  await getProjectBridge().openPath(githubRepositoryUrl);
};

const handleDownloadProjectLaunchService = async () => {
  await store.downloadProjectLaunchService();
};

const handleRecheckProjectLaunchService = async () => {
  await store.refreshProjectLaunchServiceStatus(true);
};

const handleToggleProjectLaunchService = async (event: Event) => {
  const enabled = (event.target as HTMLInputElement).checked;
  await store.setProjectLaunchServiceEnabled(enabled);
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

const confirmDeleteCustomEnvironment = () => {
  if (!pendingDeleteCustomEnvironmentId.value) return;
  store.deleteCustomEnvironmentTool(pendingDeleteCustomEnvironmentId.value);
  pendingDeleteCustomEnvironmentId.value = null;
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

onMounted(() => {
  void loadAiModels();
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});

onUnmounted(() => {
  stopAppEscapeListener();
});

watch(
  () => store.aiPreferences.provider,
  () => {
    isAiModelMenuOpen.value = false;
    void loadAiModels();
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
  <div
    v-overlay-scrollbar
    class="themed-scrollbar h-full w-full overflow-y-auto p-2"
    @click="isAiModelMenuOpen = false"
  >
    <header class="mb-3 flex items-center gap-3">
      <button
        type="button"
        @click="store.setActiveTab('projects')"
        class="rounded-lg border border-border-subtle bg-surface p-2 text-on-surface-variant shadow-sm transition-all active:scale-90 hover:bg-surface-variant"
        :title="t.common.back"
        :aria-label="t.common.back"
      >
        <ArrowLeft :size="20" />
      </button>
      <h2 class="text-xl font-bold tracking-tight text-on-surface">{{ t.sidebar.settings }}</h2>
    </header>

    <div class="grid gap-2.5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex items-center gap-2">
          <Settings2 :size="15" class="shrink-0 text-primary" />
          <h3 class="text-sm font-semibold text-on-surface-variant">{{ t.settings.general }}</h3>
        </div>
        <div class="space-y-2.5">
          <div class="grid items-center gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
            <div class="min-w-0 text-sm font-medium text-on-surface">{{ t.settings.interfaceLanguage }}</div>
            <div
              class="inline-flex max-w-full rounded-full border border-border-subtle bg-surface-container-low p-0.5 shadow-inner"
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
              class="inline-flex max-w-full rounded-full border border-border-subtle bg-surface-container-low p-0.5 shadow-inner"
            >
              <button
                type="button"
                @click="store.setTheme('light')"
                :class="segmentButtonClass(store.theme === 'light')"
              >
                <Sun :size="16" />
                {{ t.common.themeLight }}
              </button>
              <button type="button" @click="store.setTheme('dark')" :class="segmentButtonClass(store.theme === 'dark')">
                <Moon :size="16" />
                {{ t.common.themeDark }}
              </button>
              <button type="button" @click="store.setTheme('auto')" :class="segmentButtonClass(store.theme === 'auto')">
                <Monitor :size="16" />
                {{ t.common.themeAuto }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <MonitorCog :size="15" class="text-primary" />
            <h3 class="text-sm font-semibold text-on-surface-variant">{{ t.settings.environment }}</h3>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              class="inline-flex h-7 items-center gap-1 rounded border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
              @click="openEnvironmentDialog()"
            >
              <Plus :size="12" />
              {{ t.settings.addEnvironment }}
            </button>
            <button
              type="button"
              @click="store.setActiveTab('environment')"
              class="inline-flex h-7 items-center gap-1 rounded border border-border-subtle bg-transparent px-2 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
            >
              <MonitorCog :size="12" />
              {{ t.environment.title }}
            </button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <article
            v-for="card in environmentCards"
            :key="card.key"
            class="relative grid min-w-0 flex-grow basis-[calc((100%_-_0.5rem)/2)] grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border border-border-subtle bg-surface-container-low px-2.5 py-2 text-on-surface transition-colors hover:bg-surface-variant sm:basis-[calc((100%_-_2rem)/5)]"
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
                <span class="truncate text-xs font-bold" :title="card.name">{{ card.name }}</span>
                <span
                  v-if="card.kind === 'custom' || card.modified"
                  class="shrink-0 rounded border border-border-subtle bg-surface px-1 py-px text-[8px] font-bold leading-3 text-on-surface-variant"
                >
                  {{ card.kind === "custom" ? t.settings.customEnvironmentBadge : t.settings.modifiedEnvironmentBadge }}
                </span>
              </div>
              <p
                class="mt-0.5 truncate font-mono text-[9px] text-on-surface-variant"
                :title="environmentCommandSummary(card)"
              >
                {{ environmentCommandSummary(card) }}
              </p>
            </div>
          </article>
        </div>
      </section>

      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <Brain :size="15" class="shrink-0 text-primary" />
            <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.aiProvider }}</h3>
            <span class="truncate text-[11px] font-medium text-on-surface-variant">{{ aiProviderDescription }}</span>
          </div>
          <span
            :class="
              cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold',
                aiConfigReady
                  ? 'border-status-running/30 bg-status-running/10 text-status-running'
                  : 'border-status-warning/30 bg-status-warning/10 text-status-warning',
              )
            "
          >
            {{ aiConfigReady ? "已配置" : "待配置" }}
          </span>
        </div>
        <div class="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.95fr)]">
          <div class="space-y-2.5 rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2.5">
            <div
              class="grid grid-cols-3 gap-1 rounded-lg border border-border-subtle bg-surface-container-lowest p-1 shadow-inner"
            >
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
                  class="mt-1 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm normal-case text-on-surface transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label v-if="aiUsesThirdParty" class="block text-xs font-semibold uppercase text-on-surface-variant">
                {{ t.settings.aiApiKey }}
                <input
                  :value="store.aiPreferences.apiKey"
                  @input="store.setAiPreferences({ apiKey: ($event.target as HTMLInputElement).value })"
                  type="password"
                  :placeholder="t.settings.aiApiKeyPlaceholder"
                  class="mt-1 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm normal-case text-on-surface transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
            </div>

            <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <label class="block text-xs font-semibold uppercase text-on-surface-variant">
                {{ t.settings.aiModel }}
                <div class="relative mt-1">
                  <button
                    type="button"
                    class="ui-field flex w-full items-center justify-between gap-2 text-left normal-case"
                    @click.stop="isAiModelMenuOpen = !isAiModelMenuOpen"
                  >
                    <span
                      class="truncate"
                      :class="store.aiPreferences.model ? 'text-on-surface' : 'text-on-surface-variant/70'"
                    >
                      {{ aiModelLabel }}
                    </span>
                    <ChevronDown :size="14" class="shrink-0 text-on-surface-variant" />
                  </button>
                  <div
                    v-if="isAiModelMenuOpen"
                    v-overlay-scrollbar
                    class="mode-menu-popover popover-above max-h-56 overflow-auto"
                    @click.stop
                  >
                    <button
                      type="button"
                      :class="cn('mode-menu-item', !store.aiPreferences.model && 'bg-primary/10 text-primary')"
                      @click="selectAiModel('')"
                    >
                      <span class="truncate">{{ t.settings.aiModelPlaceholder }}</span>
                      <Check v-if="!store.aiPreferences.model" :size="13" />
                    </button>
                    <button
                      v-for="option in aiModelOptions"
                      :key="option.value"
                      type="button"
                      :class="
                        cn('mode-menu-item', store.aiPreferences.model === option.value && 'bg-primary/10 text-primary')
                      "
                      @click="selectAiModel(option.value)"
                    >
                      <span class="truncate">{{ option.label }}</span>
                      <Check v-if="store.aiPreferences.model === option.value" :size="13" />
                    </button>
                  </div>
                </div>
              </label>
              <label class="block text-xs font-semibold uppercase text-on-surface-variant">
                手动模型 ID
                <input
                  :value="store.aiPreferences.model"
                  @input="store.setAiPreferences({ model: ($event.target as HTMLInputElement).value })"
                  type="text"
                  :placeholder="t.settings.aiModelPlaceholder"
                  class="mt-1 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm normal-case text-on-surface transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <div class="flex gap-1.5">
                <button
                  type="button"
                  @click="loadAiModels"
                  class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
                  :title="t.common.refresh"
                  :aria-label="t.common.refresh"
                >
                  <RefreshCw :size="14" :class="store.aiModelRefreshing ? 'animate-spin' : ''" />
                </button>
                <button
                  type="button"
                  @click="handleTestAi"
                  class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-subtle bg-primary px-3 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
                  :disabled="store.aiModelTesting || !aiConfigReady"
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
            class="grid min-h-0 gap-2 rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2.5 md:grid-cols-[9rem_minmax(0,1fr)]"
          >
            <div class="min-h-0 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-xs font-bold text-on-surface">模式</h4>
                <div class="flex gap-1">
                  <button
                    type="button"
                    class="flex h-7 w-7 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
                    title="新增模式"
                    aria-label="新增模式"
                    @click="handleAddAiMode"
                  >
                    <Plus :size="13" />
                  </button>
                  <button
                    type="button"
                    class="flex h-7 w-7 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
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
                  <span v-if="mode.builtIn" class="dark-readable-meta shrink-0 text-[9px] text-on-surface-variant/70">
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
                      store.updateAiPromptMode(selectedAiMode.id, { name: ($event.target as HTMLInputElement).value })
                    "
                    type="text"
                    class="mt-1 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm normal-case text-on-surface transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
                <button
                  type="button"
                  class="mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 text-xs font-bold text-on-surface-variant transition-colors hover:bg-status-error/10 hover:text-status-error disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="selectedAiMode.builtIn"
                  @click="handleDeleteAiMode"
                >
                  <Trash2 :size="13" />
                  删除
                </button>
              </div>
              <div>
                <label for="ai-mode-prompt" class="mb-1 block text-xs font-semibold uppercase text-on-surface-variant">
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
                  class="themed-scrollbar mt-1 w-full resize-none rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm normal-case leading-5 text-on-surface transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex flex-wrap items-center gap-3">
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <SquareTerminal :size="15" class="shrink-0 text-primary" />
            <h3 class="text-sm font-semibold text-on-surface-variant">{{ t.settings.defaultTerminal }}</h3>
          </div>
        </div>
        <div class="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div
            class="inline-flex h-fit max-w-full rounded-full border border-border-subtle bg-surface-container-low p-0.5 shadow-inner"
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
              enter-active-class="transition-all duration-200 ease-out"
              enter-from-class="max-h-0 opacity-0 -translate-y-1"
              enter-to-class="max-h-28 opacity-100 translate-y-0"
              leave-active-class="transition-all duration-150 ease-in"
              leave-from-class="max-h-28 opacity-100 translate-y-0"
              leave-to-class="max-h-0 opacity-0 -translate-y-1"
            >
              <div
                v-if="terminalUsesCustomCommand"
                class="overflow-hidden rounded-lg border border-border-subtle bg-surface px-3 py-2.5"
              >
                <label class="mb-2 block text-xs font-semibold uppercase text-on-surface-variant">
                  {{ t.settings.customCommand }}
                </label>
                <input
                  :value="store.terminalPreferences.customCommand"
                  @input="store.setDefaultTerminalCustomCommand(($event.target as HTMLInputElement).value)"
                  type="text"
                  :placeholder="t.settings.customCommandPlaceholder"
                  class="w-full rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p class="mt-2 text-xs leading-5 text-on-surface-variant">{{ t.settings.defaultTerminalHint }}</p>
              </div>
            </Transition>
            <p v-if="store.terminalPreferences.kind === 'builtin'" class="text-xs leading-5 text-on-surface-variant">
              {{ t.settings.builtinTerminalHint }}
            </p>
          </div>
        </div>
      </section>

      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex flex-wrap items-center gap-2">
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
            <Code2 :size="15" class="shrink-0 text-primary" />
            <h3 class="text-sm font-semibold text-on-surface-variant">{{ t.settings.externalApplications }}</h3>
            <span class="text-[10px] leading-4 text-on-surface-variant">
              {{ t.settings.externalApplicationsUsageHint }}
            </span>
            <span v-if="externalApplicationFeedback" class="truncate text-[10px] text-status-warning">
              {{ externalApplicationFeedback }}
            </span>
          </div>
          <button
            type="button"
            class="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
            @click="openExternalApplicationDialog()"
          >
            <Plus :size="12" />
            {{ t.settings.addExternalApplication }}
          </button>
        </div>
        <div class="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <article
            v-for="application in externalApplications"
            :key="application.id"
            role="button"
            tabindex="0"
            class="min-w-0 cursor-pointer rounded-lg border border-border-subtle bg-surface-container-low px-2.5 py-2 transition-colors hover:bg-surface-variant"
            @click="openExternalApplicationDialog(application)"
            @keydown.enter.self.prevent="openExternalApplicationDialog(application)"
            @keydown.space.self.prevent="openExternalApplicationDialog(application)"
          >
            <div class="flex min-w-0 items-start gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-1">
                  <span class="truncate text-xs font-bold" :title="application.name">{{ application.name }}</span>
                  <span
                    class="shrink-0 rounded border border-border-subtle bg-surface px-1 text-[8px] font-bold leading-3 text-on-surface-variant"
                  >
                    {{
                      application.kind === "custom"
                        ? t.settings.customApplicationBadge
                        : t.settings.presetApplicationBadge
                    }}
                  </span>
                  <span
                    v-if="application.id === store.externalApplicationPreferences.defaultApplicationId"
                    class="shrink-0 rounded border border-primary/30 bg-primary/10 px-1 text-[8px] font-bold leading-3 text-primary"
                  >
                    {{ t.settings.defaultApplicationBadge }}
                  </span>
                </div>
                <p class="mt-0.5 truncate font-mono text-[9px] text-on-surface-variant" :title="application.command">
                  {{ application.command }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5" @click.stop>
                <label :title="t.settings.setDefaultApplication" class="flex cursor-pointer items-center">
                  <input
                    type="radio"
                    name="default-external-application"
                    class="h-3.5 w-3.5 accent-primary"
                    :checked="application.id === store.externalApplicationPreferences.defaultApplicationId"
                    :disabled="!application.enabled"
                    :aria-label="`${t.settings.setDefaultApplication}: ${application.name}`"
                    @change="setDefaultExternalApplication(application)"
                  />
                </label>
                <label :title="t.settings.applicationEnabled" class="flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    class="h-3.5 w-3.5 accent-primary"
                    :checked="application.enabled"
                    :disabled="application.id === store.externalApplicationPreferences.defaultApplicationId"
                    :aria-label="`${t.settings.applicationEnabled}: ${application.name}`"
                    @change="setExternalApplicationEnabled(application, ($event.target as HTMLInputElement).checked)"
                  />
                </label>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex flex-wrap items-center gap-2">
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
            <ServerCog :size="15" class="shrink-0 text-primary" />
            <h3 class="text-sm font-semibold text-on-surface-variant">{{ t.settings.projectLaunchService }}</h3>
            <span class="text-[10px] leading-4 text-on-surface-variant">{{ t.settings.projectLaunchServiceHint }}</span>
          </div>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <span :class="cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', projectLaunchServiceStatusClass)">
              {{ projectLaunchServiceStatusLabel }}
            </span>
            <label class="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-on-surface">
              <span>{{
                store.projectLaunchServicePreferences.enabled
                  ? t.settings.projectLaunchServiceDisable
                  : t.settings.projectLaunchServiceEnable
              }}</span>
              <input
                type="checkbox"
                role="switch"
                class="h-4 w-4 accent-primary"
                :checked="store.projectLaunchServicePreferences.enabled"
                :disabled="projectLaunchServiceBusy"
                :aria-label="t.settings.projectLaunchServiceEnable"
                @change="handleToggleProjectLaunchService"
              />
            </label>
          </div>
        </div>

        <div class="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]">
          <dl class="grid gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt class="font-semibold text-on-surface-variant">{{ t.settings.projectLaunchServicePlatform }}</dt>
            <dd class="min-w-0 break-words font-mono text-on-surface">
              {{ projectLaunchServiceStatus?.platform || "-" }} / {{ projectLaunchServiceStatus?.architecture || "-" }}
            </dd>
            <dt class="font-semibold text-on-surface-variant">{{ t.settings.projectLaunchServiceVersion }}</dt>
            <dd class="min-w-0 break-all font-mono text-on-surface-variant">
              {{ projectLaunchServiceStatus?.serviceVersion || "-" }}
            </dd>
            <dt class="font-semibold text-on-surface-variant">{{ t.settings.projectLaunchServiceProtocol }}</dt>
            <dd class="min-w-0 break-words font-mono text-on-surface-variant">
              {{ projectLaunchServiceStatus?.protocolVersion ? `v${projectLaunchServiceStatus.protocolVersion}` : "-" }}
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
              {{ t.terminal.historyRetention }}
            </dd>
          </dl>

          <div class="flex flex-wrap content-start gap-1.5">
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded border border-border-subtle bg-primary px-2.5 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
              :disabled="projectLaunchServiceBusy || !projectLaunchServiceStatus?.expectedAssetName"
              @click="handleDownloadProjectLaunchService"
            >
              <Download :size="13" :class="projectLaunchServiceBusy ? 'animate-spin' : ''" />
              {{
                projectLaunchServiceBusy
                  ? t.settings.projectLaunchServiceDownloading
                  : t.settings.projectLaunchServiceDownload
              }}
            </button>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded border border-border-subtle bg-surface px-2.5 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-55"
              :disabled="projectLaunchServiceBusy"
              @click="handleRecheckProjectLaunchService"
            >
              <RefreshCw :size="13" />
              {{ t.settings.projectLaunchServiceRecheck }}
            </button>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded border border-border-subtle bg-surface px-2.5 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
              @click="store.openProjectLaunchServiceDirectory"
            >
              <FolderCog :size="13" />
              {{ t.settings.projectLaunchServiceOpenDirectory }}
            </button>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded border border-border-subtle bg-surface px-2.5 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
              @click="store.openProjectLaunchServiceReleases"
            >
              <Github :size="13" />
              {{ t.settings.projectLaunchServiceOpenReleases }}
            </button>
          </div>
        </div>

        <div
          v-if="projectLaunchServiceHasNotice"
          :class="cn('mt-3 rounded-md border px-3 py-2 text-xs leading-5', projectLaunchServiceNoticeClass)"
          role="status"
          aria-live="polite"
        >
          <div class="flex items-start gap-2">
            <Info :size="14" class="mt-0.5 shrink-0" />
            <div class="min-w-0">
              <p class="font-semibold">{{ projectLaunchServiceStatusLabel }}</p>
              <p v-if="projectLaunchServiceStatus?.message" class="mt-0.5 break-words text-on-surface-variant">
                {{ projectLaunchServiceStatus.message }}
              </p>
              <p v-if="projectLaunchServiceStatus?.eventsTruncated" class="mt-1 text-status-warning">
                {{ t.settings.projectLaunchServiceLogsTruncated }}
              </p>
              <p v-if="projectLaunchServiceStatus?.scheduler?.lastError" class="mt-1 break-words text-status-error">
                <span class="font-semibold">{{ t.settings.projectLaunchServiceSchedulerLastError }}:</span>
                {{ projectLaunchServiceStatus.scheduler.lastError }}
              </p>
            </div>
          </div>
        </div>
        <div
          v-if="store.projectLaunchServicePreferences.enabled"
          class="mt-2 flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-5 text-status-warning"
        >
          <ServerCog :size="14" class="mt-0.5 shrink-0" />
          <p>{{ t.settings.projectLaunchServiceEnabledHint }}</p>
        </div>
        <details class="group mt-3 border-t border-border-subtle pt-2.5">
          <summary
            class="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-on-surface-variant transition-colors hover:text-on-surface [&::-webkit-details-marker]:hidden"
          >
            <span class="flex items-center gap-1.5">
              <Info :size="13" class="shrink-0" />
              {{ t.settings.projectLaunchServiceNotes }}
            </span>
            <ChevronDown :size="14" class="shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div class="mt-2 grid gap-2 border-t border-border-subtle pt-2 sm:grid-cols-2">
            <div class="rounded-md bg-surface-container-low px-3 py-2">
              <p class="text-xs font-semibold text-on-surface">{{ t.settings.projectLaunchServiceLogRetention }}</p>
              <p class="mt-0.5 text-[11px] leading-4 text-on-surface-variant">
                {{ t.settings.projectLaunchServiceLogHint }}
              </p>
            </div>
            <div class="rounded-md bg-surface-container-low px-3 py-2">
              <p class="text-xs font-semibold text-on-surface">{{ t.settings.projectLaunchServiceInstallNote }}</p>
              <p class="mt-0.5 text-[11px] leading-4 text-on-surface-variant">
                {{ t.settings.projectLaunchServiceManualHint }}
              </p>
            </div>
          </div>
        </details>
      </section>

      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <FolderCog :size="15" class="shrink-0 text-primary" />
            <h3 class="text-sm font-semibold text-on-surface-variant">{{ t.settings.projectConfig }}</h3>
          </div>
          <p
            v-if="store.projectConfigMessage || store.projectStorageMessage"
            class="truncate text-xs text-on-surface-variant"
          >
            {{ store.projectConfigMessage || store.projectStorageMessage }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            @click="store.importProjectConfig"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-transparent px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-variant"
          >
            <Download :size="14" />
            {{ t.settings.importProjectConfig }}
          </button>
          <button
            type="button"
            @click="store.exportProjectConfig"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-transparent px-3 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-variant"
          >
            <Upload :size="14" />
            {{ t.settings.exportProjectConfig }}
          </button>
        </div>
      </section>

      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex items-center gap-2">
          <Info :size="15" class="shrink-0 text-primary" />
          <h3 class="text-sm font-semibold text-on-surface-variant">{{ t.settings.about }}</h3>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3 py-2">
          <div class="flex items-center gap-2 text-sm text-on-surface-variant">
            <span class="font-medium">{{ t.settings.version }}</span>
            <span class="rounded-full bg-surface-variant px-2 py-0.5 font-mono text-xs text-on-surface-variant"
              >v1.7.6</span
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

    <Teleport to="body">
      <Transition name="scale">
        <div
          v-if="externalApplicationDialogOpen"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3"
          role="dialog"
          aria-modal="true"
          :aria-label="
            editingExternalApplicationId ? t.settings.editExternalApplication : t.settings.addExternalApplication
          "
          @click.self="externalApplicationDialogOpen = false"
        >
          <form
            class="w-full max-w-md rounded-lg border border-border-subtle bg-surface p-3 shadow-xl"
            @submit.prevent="saveExternalApplication"
          >
            <h3 class="text-sm font-bold text-on-surface">
              {{
                editingExternalApplicationId ? t.settings.editExternalApplication : t.settings.addExternalApplication
              }}
            </h3>
            <div class="mt-3 grid gap-3">
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
            </div>
            <p class="mt-2 text-[10px] leading-4 text-on-surface-variant">
              {{ t.settings.externalApplicationCommandHint }}
            </p>
            <p v-if="externalApplicationFeedback" class="mt-2 text-[10px] leading-4 text-status-warning">
              {{ externalApplicationFeedback }}
            </p>
            <div class="mt-3 flex items-center justify-between gap-2">
              <div>
                <button
                  v-if="editingExternalApplication?.kind === 'custom'"
                  type="button"
                  class="inline-flex h-8 items-center gap-1 rounded border border-status-error/30 px-2.5 text-xs font-bold text-status-error hover:bg-status-error/10"
                  @click="deleteExternalApplication"
                >
                  <Trash2 :size="12" />
                  {{ t.common.delete }}
                </button>
                <button
                  v-else-if="
                    editingExternalApplication &&
                    editingExternalApplication.kind !== 'custom' &&
                    editingExternalApplication.command !==
                      (editingExternalApplication.kind === 'vscode' ? 'code {path}' : 'cursor {path}')
                  "
                  type="button"
                  class="inline-flex h-8 items-center gap-1 rounded border border-border-subtle px-2.5 text-xs font-bold text-primary hover:bg-primary/10"
                  @click="
                    store.restoreExternalApplicationNativeLaunch(editingExternalApplication.id);
                    externalApplicationDialogOpen = false;
                  "
                >
                  {{ t.settings.restoreNativeLauncher }}
                </button>
              </div>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="h-8 rounded border border-border-subtle px-3 text-xs font-bold text-on-surface"
                  @click="externalApplicationDialogOpen = false"
                >
                  {{ t.common.cancel }}
                </button>
                <button type="submit" class="h-8 rounded bg-primary px-3 text-xs font-bold text-on-primary">
                  {{ t.common.save }}
                </button>
              </div>
            </div>
          </form>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="scale">
        <div
          v-if="environmentDialogOpen"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3"
          role="dialog"
          aria-modal="true"
          :aria-label="
            editingBuiltinEnvironmentKey || editingCustomEnvironmentId
              ? t.settings.editEnvironment
              : t.settings.addEnvironment
          "
          @click.self="environmentDialogOpen = false"
        >
          <form
            class="w-full max-w-md rounded-lg border border-border-subtle bg-surface p-3 shadow-xl"
            @submit.prevent="saveEnvironment"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <h3 class="text-sm font-bold text-on-surface">
                {{
                  editingBuiltinEnvironmentKey || editingCustomEnvironmentId
                    ? t.settings.editEnvironment
                    : t.settings.addEnvironment
                }}
              </h3>
              <span class="font-mono text-[10px] text-on-surface-variant">
                {{ editingBuiltinEnvironmentKey || t.settings.environmentGlobalHint }}
              </span>
            </div>
            <div class="grid gap-2 sm:grid-cols-2">
              <label class="min-w-0 text-xs font-semibold text-on-surface-variant">
                {{ t.settings.environmentName }}
                <span
                  v-if="editingBuiltinEnvironmentKey"
                  class="mt-1 flex h-9 w-full items-center rounded border border-border-subtle bg-surface-container-low px-3 text-sm font-normal text-on-surface-variant"
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
            <label class="mt-2 block text-xs font-semibold text-on-surface-variant">
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
            <div class="mt-3 flex items-center justify-between gap-2">
              <div>
                <button
                  v-if="editingBuiltinEnvironmentKey && editingBuiltinHasOverride"
                  type="button"
                  class="inline-flex h-8 items-center gap-1 rounded border border-border-subtle px-2.5 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
                  @click="restoreBuiltinEnvironment"
                >
                  <RotateCcw :size="12" />
                  {{ t.settings.restoreEnvironmentDefault }}
                </button>
                <button
                  v-else-if="editingCustomEnvironmentId"
                  type="button"
                  class="inline-flex h-8 items-center gap-1 rounded border border-status-error/30 px-2.5 text-xs font-bold text-status-error transition-colors hover:bg-status-error/10"
                  @click="requestDeleteCustomEnvironment"
                >
                  <Trash2 :size="12" />
                  {{ t.common.delete }}
                </button>
              </div>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="h-8 rounded border border-border-subtle px-3 text-xs font-bold text-on-surface"
                  @click="environmentDialogOpen = false"
                >
                  {{ t.common.cancel }}
                </button>
                <button type="submit" class="h-8 rounded bg-primary px-3 text-xs font-bold text-on-primary">
                  {{ t.common.save }}
                </button>
              </div>
            </div>
          </form>
        </div>
      </Transition>
    </Teleport>

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
</template>
