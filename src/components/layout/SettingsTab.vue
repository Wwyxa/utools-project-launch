<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  ArrowLeft,
  Brain,
  Download,
  Github,
  Monitor,
  MonitorCog,
  Moon,
  RefreshCw,
  Sun,
  Upload,
  WandSparkles,
  ChevronDown,
  Check,
} from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { AiProviderKind, DefaultEditorKind, DefaultTerminalKind, EnvironmentToolKey } from "../../types";

const store = useStore();
const t = useI18n();

const terminalOptions: DefaultTerminalKind[] = ["windows-terminal", "powershell", "cmd", "custom"];
const editorOptions: DefaultEditorKind[] = ["vscode", "cursor", "custom"];
const isAiModelMenuOpen = ref(false);
const environmentOptions: Array<{ key: EnvironmentToolKey; label: string }> = [
  { key: "node", label: "Node.js" },
  { key: "npm", label: "npm" },
  { key: "pnpm", label: "pnpm" },
  { key: "yarn", label: "Yarn" },
  { key: "python", label: "Python" },
  { key: "pip", label: "pip" },
  { key: "go", label: "Go" },
  { key: "git", label: "Git" },
  { key: "docker", label: "Docker" },
];
const aiProviderOptions: AiProviderKind[] = ["utools", "openai", "anthropic"];

const terminalUsesCustomCommand = computed(() => store.terminalPreferences.kind === "custom");
const editorUsesCustomCommand = computed(() => store.editorPreferences.kind === "custom");
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

const handleTestAi = async () => {
  await store.testAiConfiguration();
};

const aiTestIconClass = computed(() => {
  if (store.aiModelTesting) return "text-primary animate-spin";
  if (!store.aiModelTestMessage) return "text-on-surface-variant";
  return store.aiModelTestMessage.includes("失败") ? "text-status-error" : "text-status-running";
});

const aiTestTitle = computed(() => {
  if (store.aiModelTesting) return "测试中";
  if (!store.aiModelTestMessage) return "测试 AI 连接";
  return store.aiModelTestMessage;
});

onMounted(() => {
  void loadAiModels();
});

watch(
  () => store.aiPreferences.provider,
  () => {
    void loadAiModels();
  },
);
</script>

<template>
  <div class="themed-scrollbar h-full max-w-5xl overflow-y-auto p-2" @click="isAiModelMenuOpen = false">
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
      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-3 shadow-sm">
        <div class="mb-2.5 flex items-center gap-2">
          <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.general }}</h3>
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
        <div class="mb-2.5 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <MonitorCog :size="15" class="text-primary" />
            <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.environment }}</h3>
          </div>
          <button
            type="button"
            @click="store.setActiveTab('environment')"
            class="rounded-lg border border-border-subtle bg-transparent px-3 py-1.5 text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
          >
            {{ t.environment.title }}
          </button>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
          <label
            v-for="option in environmentOptions"
            :key="option.key"
            class="flex cursor-pointer items-center gap-2 rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-sm text-on-surface transition-colors hover:bg-surface-variant"
          >
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary"
              :checked="store.environmentPreferences.enabledToolKeys.includes(option.key)"
              @change="store.setEnvironmentToolEnabled(option.key, ($event.target as HTMLInputElement).checked)"
            />
            <span class="truncate font-medium">{{ option.label }}</span>
          </label>
        </div>
      </section>

      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex items-center gap-2">
          <Brain :size="15" class="text-primary" />
          <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.aiProvider }}</h3>
        </div>
        <div class="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div
            class="inline-flex h-fit max-w-full rounded-full border border-border-subtle bg-surface-container-low p-0.5 shadow-inner"
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
          <div class="space-y-2">
            <div class="grid gap-2 md:grid-cols-2">
              <label class="block text-xs font-semibold uppercase text-on-surface-variant">
                {{ t.settings.aiModel }}
                <div class="mt-1 flex items-center gap-2">
                  <div class="relative min-w-0 flex-1">
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
                          cn(
                            'mode-menu-item',
                            store.aiPreferences.model === option.value && 'bg-primary/10 text-primary',
                          )
                        "
                        @click="selectAiModel(option.value)"
                      >
                        <span class="truncate">{{ option.label }}</span>
                        <Check v-if="store.aiPreferences.model === option.value" :size="13" />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    @click="loadAiModels"
                    class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-transparent text-xs font-bold text-on-surface transition-colors hover:bg-surface-variant"
                    :title="t.common.refresh"
                    :aria-label="t.common.refresh"
                  >
                    <RefreshCw :size="14" :class="store.aiAnalyzing ? 'animate-spin' : ''" />
                  </button>
                </div>
              </label>
              <label v-if="aiUsesThirdParty" class="block text-xs font-semibold uppercase text-on-surface-variant">
                {{ t.settings.aiBaseUrl }}
                <input
                  :value="store.aiPreferences.baseUrl"
                  @input="store.setAiPreferences({ baseUrl: ($event.target as HTMLInputElement).value })"
                  type="text"
                  placeholder="https://api.example.com/v1"
                  class="mt-1 w-full rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-sm normal-case text-on-surface transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
            </div>
            <label v-if="aiUsesThirdParty" class="block text-xs font-semibold uppercase text-on-surface-variant">
              {{ t.settings.aiApiKey }}
              <input
                :value="store.aiPreferences.apiKey"
                @input="store.setAiPreferences({ apiKey: ($event.target as HTMLInputElement).value })"
                type="password"
                :placeholder="t.settings.aiApiKeyPlaceholder"
                class="mt-1 w-full rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-sm normal-case text-on-surface transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                @click="handleTestAi"
                class="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-primary px-2.5 py-1.5 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
                :disabled="store.aiModelTesting"
              >
                <WandSparkles :size="13" />
                测试
              </button>
              <span
                class="inline-flex h-8 items-center gap-1 rounded-full border border-border-subtle bg-surface-container-low px-2 text-[11px] text-on-surface-variant"
                :title="aiTestTitle"
              >
                <span :class="aiTestIconClass">
                  <WandSparkles :size="12" />
                </span>
                <span v-if="store.aiModelTesting">测试中</span>
                <span v-else-if="store.aiModelTestMessage">{{
                  store.aiModelTestMessage.includes("失败") ? "失败" : "成功"
                }}</span>
                <span v-else>就绪</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex items-center gap-2">
          <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.defaultTerminal }}</h3>
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
        <div class="mb-2.5 flex items-center gap-2">
          <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.defaultEditor }}</h3>
        </div>
        <div class="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div
            class="inline-flex h-fit max-w-full rounded-full border border-border-subtle bg-surface-container-low p-0.5 shadow-inner"
          >
            <button
              v-for="option in editorOptions"
              :key="option"
              type="button"
              @click="store.setDefaultEditor(option)"
              :class="segmentButtonClass(store.editorPreferences.kind === option)"
            >
              {{ t.settings.editors[option] }}
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
                v-if="editorUsesCustomCommand"
                class="overflow-hidden rounded-lg border border-border-subtle bg-surface px-3 py-2.5"
              >
                <label class="mb-2 block text-xs font-semibold uppercase text-on-surface-variant">
                  {{ t.settings.customEditorCommand }}
                </label>
                <input
                  :value="store.editorPreferences.customCommand"
                  @input="store.setDefaultEditorCustomCommand(($event.target as HTMLInputElement).value)"
                  type="text"
                  :placeholder="t.settings.customEditorCommandPlaceholder"
                  class="w-full rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p class="mt-2 text-xs leading-5 text-on-surface-variant">{{ t.settings.defaultEditorHint }}</p>
              </div>
            </Transition>
          </div>
        </div>
      </section>

      <section class="lg:col-span-2 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5 shadow-sm">
        <div class="mb-2.5 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.projectConfig }}</h3>
          </div>
          <p v-if="store.projectStorageMessage" class="truncate text-xs text-on-surface-variant">
            {{ store.projectStorageMessage }}
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
          <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.about }}</h3>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3 py-2">
          <div class="flex items-center gap-2 text-sm text-on-surface-variant">
            <span class="font-medium">{{ t.settings.version }}</span>
            <span class="rounded-full bg-surface-variant px-2 py-0.5 font-mono text-xs text-on-surface-variant"
              >v0.1.0</span
            >
          </div>
          <a
            href="https://github.com/wyxa/utools-project-launch"
            target="_blank"
            class="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:underline"
          >
            <Github :size="14" />
            GitHub
          </a>
        </div>
      </section>
    </div>
  </div>
</template>
