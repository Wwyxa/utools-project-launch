<script setup lang="ts">
import { computed } from "vue";
import { ArrowLeft, Download, Github, Monitor, Moon, Sun, Upload } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { DefaultEditorKind, DefaultTerminalKind } from "../../types";

const store = useStore();
const t = useI18n();

const terminalOptions: DefaultTerminalKind[] = ["windows-terminal", "powershell", "cmd", "custom"];
const editorOptions: DefaultEditorKind[] = ["vscode", "cursor", "custom"];

const terminalUsesCustomCommand = computed(() => store.terminalPreferences.kind === "custom");
const editorUsesCustomCommand = computed(() => store.editorPreferences.kind === "custom");

const segmentButtonClass = (active: boolean) =>
  cn(
    "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all",
    active
      ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
      : "text-on-surface-variant hover:bg-surface-container",
  );
</script>

<template>
  <div class="themed-scrollbar h-full max-w-5xl overflow-y-auto p-2">
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
