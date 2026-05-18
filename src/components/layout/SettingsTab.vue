<script setup lang="ts">
import { Languages, Info, Github, Moon, Sun, Monitor } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";

const store = useStore();
const t = useI18n();
</script>

<template>
  <div class="p-8 max-w-2xl">
    <header class="mb-8">
      <h2 class="text-2xl font-bold text-on-surface tracking-tight">{{ t.sidebar.settings }}</h2>
    </header>

    <div class="space-y-6">
      <!-- Language Section -->
      <section class="bg-surface border border-border-subtle rounded-xl p-6 shadow-sm">
        <div class="flex items-center gap-3 mb-4 text-primary">
          <Languages :size="20" />
          <h3 class="text-lg font-semibold">{{ t.common.language }}</h3>
        </div>
        <p class="text-sm text-on-surface-variant mb-4">Choose your preferred language.</p>
        <div class="flex gap-2">
          <button
            @click="store.setLocale('zh-CN')"
            :class="[
              'px-4 py-2 rounded-lg text-sm font-medium transition-all',
              store.locale === 'zh-CN'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
            ]"
          >
            简体中文
          </button>
          <button
            @click="store.setLocale('en-US')"
            :class="[
              'px-4 py-2 rounded-lg text-sm font-medium transition-all',
              store.locale === 'en-US'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
            ]"
          >
            English
          </button>
        </div>
      </section>

      <!-- Theme Section -->
      <section class="bg-surface border border-border-subtle rounded-xl p-6 shadow-sm">
        <div class="flex items-center gap-3 mb-4 text-primary">
          <Monitor :size="20" />
          <h3 class="text-lg font-semibold">{{ t.common.theme }}</h3>
        </div>
        <p class="text-sm text-on-surface-variant mb-4">Select your interface theme.</p>
        <div class="flex gap-2">
          <button
            @click="store.setTheme('light')"
            :class="[
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              store.theme === 'light'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
            ]"
          >
            <Sun :size="16" />
            {{ t.common.themeLight }}
          </button>
          <button
            @click="store.setTheme('dark')"
            :class="[
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              store.theme === 'dark'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
            ]"
          >
            <Moon :size="16" />
            {{ t.common.themeDark }}
          </button>
          <button
            @click="store.setTheme('auto')"
            :class="[
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              store.theme === 'auto'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container',
            ]"
          >
            <Monitor :size="16" />
            {{ t.common.themeAuto }}
          </button>
        </div>
      </section>

      <!-- About Section -->
      <section class="bg-surface border border-border-subtle rounded-xl p-6 shadow-sm">
        <div class="flex items-center gap-3 mb-4 text-primary">
          <Info :size="20" />
          <h3 class="text-lg font-semibold">About</h3>
        </div>
        <div class="space-y-4">
          <div class="flex justify-between items-center py-2 border-b border-border-subtle">
            <span class="text-sm font-medium text-on-surface-variant">Version</span>
            <span class="text-sm font-mono bg-surface-variant px-2 py-0.5 rounded text-on-surface-variant">v0.1.0</span>
          </div>
          <div class="flex justify-between items-center py-2">
            <span class="text-sm font-medium text-on-surface-variant">Repository</span>
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
