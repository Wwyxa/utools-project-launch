<script setup lang="ts">
import {
  Languages,
  Info,
  Github,
  Moon,
  Sun,
  Monitor,
  TerminalSquare,
  ArrowLeft,
  Upload,
  Download,
} from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import type { DefaultTerminalKind } from "../../types";

const store = useStore();
const t = useI18n();

const terminalOptions: DefaultTerminalKind[] = ["windows-terminal", "powershell", "cmd", "custom"];
</script>

<template>
  <div class="p-6 max-w-5xl">
    <header class="mb-5 flex items-center gap-3">
      <button
        @click="store.setActiveTab('projects')"
        class="p-2 hover:bg-surface-variant rounded-lg text-on-surface-variant transition-all active:scale-90 border border-border-subtle bg-surface shadow-sm"
        :title="t.common.back"
        :aria-label="t.common.back"
      >
        <ArrowLeft :size="20" />
      </button>
      <h2 class="text-xl font-bold text-on-surface tracking-tight">{{ t.sidebar.settings }}</h2>
    </header>

    <div class="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
      <section class="bg-surface border border-border-subtle rounded-lg p-4 shadow-sm">
        <div class="flex items-center gap-2 mb-3 text-primary">
          <Languages :size="18" />
          <h3 class="text-sm font-semibold text-on-surface">{{ t.common.language }}</h3>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button
            @click="store.setLocale('zh-CN')"
            :class="[
              'px-3 py-2 rounded-lg text-sm font-medium transition-all',
              store.locale === 'zh-CN'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
            ]"
          >
            简体中文
          </button>
          <button
            @click="store.setLocale('en-US')"
            :class="[
              'px-3 py-2 rounded-lg text-sm font-medium transition-all',
              store.locale === 'en-US'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
            ]"
          >
            English
          </button>
        </div>
      </section>

      <section class="bg-surface border border-border-subtle rounded-lg p-4 shadow-sm">
        <div class="flex items-center gap-2 mb-3 text-primary">
          <Monitor :size="18" />
          <h3 class="text-sm font-semibold text-on-surface">{{ t.common.theme }}</h3>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <button
            @click="store.setTheme('light')"
            :class="[
              'flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
              store.theme === 'light'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
            ]"
          >
            <Sun :size="16" />
            {{ t.common.themeLight }}
          </button>
          <button
            @click="store.setTheme('dark')"
            :class="[
              'flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
              store.theme === 'dark'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
            ]"
          >
            <Moon :size="16" />
            {{ t.common.themeDark }}
          </button>
          <button
            @click="store.setTheme('auto')"
            :class="[
              'flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
              store.theme === 'auto'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
            ]"
          >
            <Monitor :size="16" />
            {{ t.common.themeAuto }}
          </button>
        </div>
      </section>

      <section class="bg-surface border border-border-subtle rounded-lg p-4 shadow-sm lg:col-span-2">
        <div class="flex items-center gap-2 mb-3 text-primary">
          <TerminalSquare :size="18" />
          <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.defaultTerminal }}</h3>
        </div>
        <div class="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <button
              v-for="option in terminalOptions"
              :key="option"
              @click="store.setDefaultTerminal(option)"
              :class="[
                'px-3 py-2 rounded-lg text-left text-sm font-medium transition-all',
                store.terminalPreferences.kind === option
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
              ]"
            >
              {{ t.settings.terminals[option] }}
            </button>
          </div>
          <div class="rounded-lg border border-border-subtle bg-surface-container-low p-3">
            <label class="block text-xs font-semibold uppercase text-on-surface-variant mb-2">
              {{ t.settings.customCommand }}
            </label>
            <input
              :value="store.terminalPreferences.customCommand"
              @input="store.setDefaultTerminalCustomCommand(($event.target as HTMLInputElement).value)"
              type="text"
              :disabled="store.terminalPreferences.kind !== 'custom'"
              :placeholder="t.settings.customCommandPlaceholder"
              :title="
                store.terminalPreferences.kind === 'custom'
                  ? t.settings.customCommand
                  : t.settings.customCommandDisabled
              "
              class="w-full rounded-lg border border-border-subtle bg-surface-container-lowest px-3 py-2 text-sm transition-colors focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant disabled:opacity-70 disabled:placeholder:text-on-surface-variant/60"
            />
            <p class="mt-2 text-xs text-on-surface-variant">{{ t.settings.defaultTerminalHint }}</p>
            <p v-if="store.terminalPreferences.kind === 'builtin'" class="mt-1 text-xs text-on-surface-variant">
              {{ t.settings.builtinTerminalHint }}
            </p>
          </div>
        </div>
      </section>

      <section class="bg-surface border border-border-subtle rounded-lg p-4 shadow-sm lg:col-span-2">
        <div class="flex items-center justify-between gap-3 mb-3">
          <div class="flex items-center gap-2 text-primary">
            <Download :size="18" />
            <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.projectConfig }}</h3>
          </div>
          <p v-if="store.projectStorageMessage" class="text-xs text-on-surface-variant truncate">
            {{ store.projectStorageMessage }}
          </p>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            @click="store.importProjectConfig"
            class="flex items-center justify-center gap-2 rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface hover:bg-surface-container"
          >
            <Download :size="16" />
            {{ t.settings.importProjectConfig }}
          </button>
          <button
            @click="store.exportProjectConfig"
            class="flex items-center justify-center gap-2 rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface hover:bg-surface-container"
          >
            <Upload :size="16" />
            {{ t.settings.exportProjectConfig }}
          </button>
        </div>
      </section>

      <section class="bg-surface border border-border-subtle rounded-lg p-4 shadow-sm lg:col-span-2">
        <div class="flex items-center gap-2 mb-3 text-primary">
          <Info :size="18" />
          <h3 class="text-sm font-semibold text-on-surface">{{ t.settings.about }}</h3>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div class="flex justify-between items-center rounded-lg bg-surface-container-low px-3 py-2">
            <span class="text-sm font-medium text-on-surface-variant">{{ t.settings.version }}</span>
            <span class="text-sm font-mono bg-surface-variant px-2 py-0.5 rounded text-on-surface-variant">v0.1.0</span>
          </div>
          <div class="flex justify-between items-center rounded-lg bg-surface-container-low px-3 py-2">
            <span class="text-sm font-medium text-on-surface-variant">{{ t.settings.repository }}</span>
            <a
              href="https://github.com/wyxa/utools-project-launch"
              target="_blank"
              class="text-primary hover:underline flex items-center gap-1 text-sm"
            >
              <Github :size="14" />
              GitHub
            </a>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
