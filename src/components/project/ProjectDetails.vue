<script setup lang="ts">
import { computed, ref } from "vue";
import { ExternalLink, Folder, Pencil, Languages } from "lucide-vue-next";
import { Project, ProjectStatus } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import ScriptsTab from "./ScriptsTab.vue";
import GitTab from "./GitTab.vue";
import MemoTab from "./MemoTab.vue";
import Terminal from "../terminal/Terminal.vue";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();
const activeTab = ref<"info" | "scripts" | "git" | "memo">("scripts");

const tabs = computed(() => [
  { id: "info", label: t.value.projectDetails.overview },
  { id: "scripts", label: t.value.projectDetails.scripts },
  { id: "git", label: t.value.projectDetails.git },
  { id: "memo", label: t.value.projectDetails.memo },
]);

const statusLabel = computed(() => {
  if (props.project.status === ProjectStatus.RUNNING) {
    return t.value.common.running;
  }
  if (props.project.status === ProjectStatus.ERROR) {
    return t.value.common.error;
  }
  return t.value.common.stopped;
});

const handleOpenFolder = () => store.openProjectFolder(props.project.id);
const handleEdit = () => store.openEditProjectForm(props.project.id);
</script>

<template>
  <div class="p-8 flex-1 flex flex-col h-full overflow-hidden">
    <div class="mb-8 flex justify-between items-start gap-4">
      <div class="min-w-0">
        <div class="flex items-center gap-3 flex-wrap">
          <h2 class="text-2xl font-bold text-on-surface truncate">{{ project.name }}</h2>
          <span
            class="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-variant text-on-surface-variant"
          >
            {{ t.projectKinds[project.kind] }}
          </span>
        </div>
        <div class="flex items-center gap-3 text-xs font-medium text-on-surface-variant mt-2 flex-wrap">
          <span class="flex items-center gap-1.5"> <Folder :size="14" /> {{ project.path }} </span>
          <span class="w-1 h-1 rounded-full bg-border-subtle" />
          <span class="flex items-center gap-1.5 text-status-running bg-status-running/10 px-2 py-0.5 rounded-full">
            <span class="w-1.5 h-1.5 rounded-full bg-status-running" />
            {{ statusLabel }}
          </span>
          <span v-if="project.branch" class="px-2 py-0.5 rounded-full bg-surface-variant text-on-surface-variant">
            {{ project.branch }}
          </span>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <button
          @click="handleOpenFolder"
          class="bg-surface border border-border-subtle group text-on-surface hover:bg-surface-variant px-4 py-2 rounded-lg flex items-center gap-2 text-xs font-bold transition-all"
        >
          <ExternalLink :size="14" class="group-hover:text-primary" />
          {{ t.projectDetails.openProject }}
        </button>
        <button
          @click="handleEdit"
          class="bg-primary-container text-on-primary px-4 py-2 rounded-lg flex items-center gap-2 text-xs font-bold transition-all hover:bg-primary"
        >
          <Pencil :size="14" />
          {{ t.common.edit }}
        </button>
      </div>
    </div>

    <nav class="flex gap-8 border-b border-border-subtle mb-8 overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="activeTab = tab.id"
        :class="
          cn(
            'pb-4 text-sm font-bold transition-all relative whitespace-nowrap',
            activeTab === tab.id ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface',
          )
        "
      >
        {{ tab.label }}
        <div
          v-if="activeTab === tab.id"
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full shadow-[0_-2px_6px_rgba(46,175,125,0.4)]"
        />
      </button>
    </nav>

    <div class="flex-1 overflow-y-auto scrollbar-hide pr-1 space-y-6">
      <div v-if="activeTab === 'info'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 bg-surface border border-border-subtle rounded-xl p-6 space-y-4">
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              {{ t.projectDetails.currentStatus }}
            </div>
            <p class="mt-2 text-sm text-on-surface-variant">{{ project.description || t.projectDetails.noScripts }}</p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div class="bg-bg-soft-gray rounded-lg p-4">
              <div class="text-xs font-bold uppercase text-on-surface-variant">{{ t.git.branch }}</div>
              <div class="mt-1 font-mono text-on-surface">{{ project.branch || "main" }}</div>
            </div>
            <div class="bg-bg-soft-gray rounded-lg p-4">
              <div class="text-xs font-bold uppercase text-on-surface-variant">{{ t.git.statusText }}</div>
              <div class="mt-1 text-on-surface">{{ project.git?.statusText || t.git.noRepo }}</div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="script in project.scripts"
              :key="script.id"
              class="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-variant text-on-surface-variant"
            >
              {{ script.name }}
            </span>
          </div>
        </div>

        <div class="space-y-4">
          <div class="bg-surface border border-border-subtle rounded-xl p-4">
            <div class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              {{ t.common.language }}
            </div>
            <button
              @click="store.setLocale(store.locale === 'zh-CN' ? 'en-US' : 'zh-CN')"
              class="mt-3 w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border-subtle bg-bg-soft-gray text-sm font-semibold"
            >
              <span>{{ store.locale === "zh-CN" ? "中文" : "English" }}</span>
              <Languages :size="16" />
            </button>
          </div>
          <div class="bg-surface border border-border-subtle rounded-xl p-4">
            <div class="text-xs font-bold uppercase tracking-wider text-on-surface-variant">{{ t.git.readOnly }}</div>
            <div class="mt-3 text-sm text-on-surface-variant">{{ project.git?.statusText || t.git.noRepo }}</div>
          </div>
        </div>
      </div>

      <ScriptsTab v-if="activeTab === 'scripts'" :project="project" />
      <GitTab v-if="activeTab === 'git'" :project="project" />
      <MemoTab v-if="activeTab === 'memo'" :project="project" />

      <Terminal :projectId="project.id" />
    </div>
  </div>
</template>
