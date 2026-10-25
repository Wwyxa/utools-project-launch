<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  Check,
  ChevronDown,
  ChevronUp,
  X,
  Plus,
  Trash2,
  Save,
  WandSparkles,
  FolderOpen,
  GripVertical,
  CircleHelp,
  Network,
} from "lucide-vue-next";
import { isSensitiveEnvironmentKey, useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import type {
  ProjectBridgeScriptCandidate,
  ProjectIconKey,
  ProjectKind,
  Project,
  ProjectScriptDiscoverySource,
} from "../../types";
import {
  PROJECT_MAX_RELATED_PROJECTS,
  PROJECT_TINY_CARD_BUTTON_COUNT_MAX,
  PROJECT_TINY_CARD_BUTTON_COUNT_MIN,
} from "../../types";
import ProjectIcon from "./ProjectIcon.vue";
import BaseModal from "../common/BaseModal.vue";
import UiSelect, { type UiSelectOption } from "../common/UiSelect.vue";

const store = useStore();
const t = useI18n();

const form = computed(() => store.projectFormDraft);
const isPublicFormProject = computed(() => form.value.visibility !== "private");
const envScopeTouchedIds = ref(new Set<string>());

const handleEnvKeyInput = (entryId: string, value: string) => {
  store.updateEnvironmentEntry(entryId, { key: value });
  if (isPublicFormProject.value && !envScopeTouchedIds.value.has(entryId) && isSensitiveEnvironmentKey(value)) {
    // Credential-looking variables default to staying on this device.
    store.updateEnvironmentEntry(entryId, { localOnly: true });
  }
};

const setEnvEntryLocalOnly = (entryId: string, localOnly: boolean) => {
  envScopeTouchedIds.value.add(entryId);
  store.updateEnvironmentEntry(entryId, { localOnly });
};

const restoreSharedEnvValue = (entryId: string) => {
  const entry = store.projectFormDraft.envEntries.find((item) => item.id === entryId);
  if (!entry || entry.sharedValue === null || entry.sharedValue === undefined) return;
  envScopeTouchedIds.value.add(entryId);
  store.updateEnvironmentEntry(entryId, { localOnly: false, value: entry.sharedValue });
};

const title = computed(() => {
  if (store.projectFormMode === "edit") return t.value.modal.editTitle;
  if (store.projectFormMode === "duplicate") return t.value.modal.duplicateTitle;
  return t.value.modal.createTitle;
});
const existingGroups = computed(() => [
  ...new Set(store.projects.map((project) => (project.group ?? "").trim()).filter(Boolean)),
]);
const draggedScriptId = ref<string | null>(null);
const groupMenuOpen = ref(false);
const discoveryOpen = ref(false);
const discoveryCandidates = ref<ProjectBridgeScriptCandidate[]>([]);
const selectedDiscoveryKeys = ref<string[]>([]);
const selectedDiscoverySources = ref<ProjectScriptDiscoverySource[]>(["package-json", "makefile"]);
const discoveryScanned = ref(false);

const selectedRelatedProjectIds = computed(() =>
  form.value.relatedProjects.map((relation) => relation.projectId),
);

const relatedProjectSelectOptions = computed<UiSelectOption[]>(() =>
  store.visibleProjects
    .filter((project) => project.id !== form.value.id)
    .map((project) => ({
      value: project.id,
      label: project.name,
      hint: project.path,
      disabled:
        !isRelatedProjectSelected(project.id) && form.value.relatedProjects.length >= PROJECT_MAX_RELATED_PROJECTS,
    })),
);
const selectedRelatedProjects = computed<Project[]>(() => {
  const projectsById = new Map(store.projects.map((project) => [project.id, project]));
  return form.value.relatedProjects
    .map((relation) => projectsById.get(relation.projectId))
    .filter((project): project is Project => Boolean(project));
});
const incomingRelatedProjects = computed(() => {
  if (!form.value.id) {
    return [];
  }
  return store.visibleProjects.filter(
    (project) =>
      project.id !== form.value.id &&
      project.relatedProjects?.some((relation) => relation.projectId === form.value.id && relation.bidirectional),
  );
});

const discoveryKey = (candidate: ProjectBridgeScriptCandidate) =>
  `${candidate.source}\u0000${candidate.cwd || "."}\u0000${candidate.command}`;
const riskyMakeTargetPattern = /(?:^|[-_])(clean|reset|destroy|delete|remove|purge|drop|down|teardown)(?:[-_]|$)/i;
const requiresExplicitImport = (candidate: ProjectBridgeScriptCandidate) =>
  candidate.source === "makefile" && riskyMakeTargetPattern.test(candidate.name);

const closeMenus = () => {
  groupMenuOpen.value = false;
};

const openScriptDiscovery = () => {
  discoveryOpen.value = true;
  discoveryCandidates.value = [];
  selectedDiscoveryKeys.value = [];
  discoveryScanned.value = false;
};

const discoverScripts = async () => {
  const candidates = await store.discoverProjectFormScripts(selectedDiscoverySources.value);
  discoveryCandidates.value = candidates;
  selectedDiscoveryKeys.value = candidates.filter((candidate) => !requiresExplicitImport(candidate)).map(discoveryKey);
  discoveryScanned.value = true;
};

const importDiscoveredScripts = () => {
  const selected = discoveryCandidates.value.filter((candidate) =>
    selectedDiscoveryKeys.value.includes(discoveryKey(candidate)),
  );
  store.importProjectFormScripts(selected);
  discoveryOpen.value = false;
};

const selectGroup = (group: string) => {
  store.updateProjectForm({ group });
  groupMenuOpen.value = false;
};

const toggleGroupMenu = () => {
  groupMenuOpen.value = !groupMenuOpen.value;
};

const handleScriptCwdChange = (scriptId: string, value: string | string[] | null) => {
  if (typeof value === "string") {
    store.updateScriptEntry(scriptId, { cwd: value });
  }
};

const cwdOptionLabel = (suggestion: string) => {
  const normalized = suggestion.replace(/\\/g, "/").replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  const label = separator > 0 ? normalized.slice(separator + 1) : normalized;
  return label || suggestion;
};

const cwdOptionsFor = (cwd: string): UiSelectOption[] => {
  const options: UiSelectOption[] = store.projectFormCwdSuggestions.map((suggestion) => ({
    value: suggestion,
    label: cwdOptionLabel(suggestion),
    hint: suggestion,
  }));
  // 手动输入过的自定义 cwd 也要出现在选项里，否则触发器无法回显当前值。
  if (cwd && !options.some((option) => option.value === cwd)) {
    options.unshift({ value: cwd, label: cwdOptionLabel(cwd), hint: cwd });
  }
  return options;
};

const handleRelatedProjectsChange = (value: string | string[] | null) => {
  if (!Array.isArray(value)) return;
  const nextIds = value.filter((id): id is string => typeof id === "string");
  const previous = form.value.relatedProjects;
  const kept = previous.filter((relation) => nextIds.includes(relation.projectId));
  const keptIds = new Set(kept.map((relation) => relation.projectId));
  const added = nextIds
    .filter((id) => !keptIds.has(id))
    .map((projectId) => ({ projectId, bidirectional: form.value.relatedProjectsBidirectional }));
  store.updateProjectForm({ relatedProjects: [...kept, ...added] });
};

const isRelatedProjectSelected = (projectId: string) =>
  form.value.relatedProjects.some((relation) => relation.projectId === projectId);

const toggleRelatedProject = (projectId: string) => {
  const existingIndex = form.value.relatedProjects.findIndex((relation) => relation.projectId === projectId);
  if (existingIndex >= 0) {
    store.updateProjectForm({
      relatedProjects: form.value.relatedProjects.filter((relation) => relation.projectId !== projectId),
    });
    return;
  }

  if (form.value.relatedProjects.length >= PROJECT_MAX_RELATED_PROJECTS) {
    return;
  }

  store.updateProjectForm({
    relatedProjects: [
      ...form.value.relatedProjects,
      { projectId, bidirectional: form.value.relatedProjectsBidirectional },
    ],
  });
};

const setRelatedProjectsBidirectional = (bidirectional: boolean) => {
  store.updateProjectForm({
    relatedProjectsBidirectional: bidirectional,
    relatedProjects: form.value.relatedProjects.map((relation) => ({ ...relation, bidirectional })),
  });
};

watch(
  () => store.projectFormOpen,
  (open) => {
    if (!open) {
      closeMenus();
      discoveryOpen.value = false;
      discoveryCandidates.value = [];
      selectedDiscoveryKeys.value = [];
      selectedDiscoverySources.value = ["package-json", "makefile"];
      discoveryScanned.value = false;
    }
  },
);

// 分组下拉为 creatable 组合输入（保留手写面板），这里补齐与地基菜单一致的 Escape 语义。
const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!groupMenuOpen.value || event.detail.handled) return;
  groupMenuOpen.value = false;
  event.detail.handle();
};

let stopAppEscapeListener = () => {};
stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);

onUnmounted(() => {
  stopAppEscapeListener();
});

const projectIcons: Array<{ key: ProjectIconKey; label: string; kind: ProjectKind; type: string }> = [
  { key: "node", label: "Node.js", kind: "node", type: "Node.js" },
  { key: "vue", label: "Vue", kind: "node", type: "Vue" },
  { key: "react", label: "React", kind: "node", type: "React" },
  { key: "python", label: "Python", kind: "python", type: "Python" },
  { key: "go", label: "Go", kind: "go", type: "Go" },
  { key: "rust", label: "Rust", kind: "custom", type: "Rust" },
  { key: "java", label: "Java", kind: "custom", type: "Java" },
  { key: "docker", label: "Docker", kind: "custom", type: "Docker" },
  { key: "database", label: "Database", kind: "custom", type: "Database" },
  { key: "browser", label: "Web", kind: "custom", type: "Web" },
  { key: "terminal", label: "CLI", kind: "custom", type: "CLI" },
  { key: "backend", label: "API", kind: "custom", type: "API" },
  { key: "package", label: "Package", kind: "custom", type: "Package" },
  { key: "ai", label: "AI", kind: "custom", type: "AI" },
  { key: "android", label: "Android", kind: "custom", type: "Android" },
  { key: "linux", label: "Linux", kind: "custom", type: "Linux" },
  { key: "macos", label: "macOS", kind: "custom", type: "macOS" },
  { key: "windows", label: "Windows", kind: "custom", type: "Windows" },
  { key: "executable", label: "Executable", kind: "executable", type: "Executable" },
  { key: "custom", label: "Custom", kind: "custom", type: "Custom" },
];

const updateIcon = (icon: (typeof projectIcons)[number]) => {
  const command =
    icon.kind === "node"
      ? "npm run dev"
      : icon.kind === "python"
        ? "python main.py"
        : icon.kind === "go"
          ? "go run ."
          : icon.kind === "executable"
            ? "app.exe"
            : "";

  store.updateProjectForm({ icon: icon.key, kind: icon.kind, type: icon.type });
  if (form.value.scripts.length === 1 && !form.value.scripts[0].command.trim()) {
    store.updateScriptEntry(form.value.scripts[0].id, { command });
  }
};

const handlePathBlur = () => {
  void store.inspectCurrentProjectPath();
};

const setTinyCardButtonCount = (value: number) => {
  store.updateProjectForm({
    tinyCardButtonCount: Math.min(
      PROJECT_TINY_CARD_BUTTON_COUNT_MAX,
      Math.max(PROJECT_TINY_CARD_BUTTON_COUNT_MIN, Math.floor(value)),
    ),
  });
};

const updateTinyCardButtonCount = (event: Event) => {
  const value = (event.target as HTMLInputElement).valueAsNumber;
  if (Number.isFinite(value)) setTinyCardButtonCount(value);
};

const adjustTinyCardButtonCount = (offset: number) => {
  setTinyCardButtonCount(form.value.tinyCardButtonCount + offset);
};

const handleSubmit = async () => {
  if (!form.value.name.trim() || !form.value.path.trim()) {
    return;
  }

  await store.saveProjectForm();
};

const handleScriptDragStart = (event: DragEvent, scriptId: string) => {
  draggedScriptId.value = scriptId;
  event.dataTransfer?.setData("text/plain", scriptId);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
};

const handleScriptDrop = (targetScriptId: string) => {
  if (draggedScriptId.value) {
    store.reorderScriptEntry(draggedScriptId.value, targetScriptId);
  }
  draggedScriptId.value = null;
};
</script>

<template>
  <BaseModal
    as="form"
    :open="store.projectFormOpen"
    :width="1152"
    :title="title"
    :close-on-scrim="false"
    body-class="p-5"
    @submit="handleSubmit"
    @close="store.closeProjectForm"
  >
    <div class="space-y-6 [color-scheme:inherit]" @click="closeMenus">
            <p
              v-if="store.projectFormMode === 'duplicate'"
              class="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-on-surface-variant"
            >
              {{ t.modal.duplicateScopeHint }}
            </p>
            <section class="grid grid-cols-1 md:grid-cols-12 gap-x-4 gap-y-4">
              <label class="space-y-1.5 md:col-span-4">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.name }}</span>
                <input
                  :value="form.name"
                  @input="(event) => store.updateProjectForm({ name: (event.target as HTMLInputElement).value })"
                  class="ui-field w-full"
                />
              </label>
              <label class="space-y-1.5 md:col-span-8">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.path }}</span>
                <div class="flex gap-2">
                  <input
                    :value="form.path"
                    @input="(event) => store.updateProjectForm({ path: (event.target as HTMLInputElement).value })"
                    @blur="handlePathBlur"
                    class="ui-field min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    @click="store.pickProjectPath"
                    class="ui-btn ui-btn--secondary shrink-0"
                    title="选择项目目录"
                    aria-label="选择项目目录"
                  >
                    <FolderOpen :size="16" />
                  </button>
                </div>
              </label>
              <div
                class="md:col-span-12 flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant"
              >
                <span>{{
                  store.projectFormInspectionMessage || "填写路径后可自动识别项目名称、脚本和 Git 分支。"
                }}</span>
                <button
                  type="button"
                  @click="openScriptDiscovery"
                  class="ui-btn ui-btn--primary-ghost ui-btn--sm shrink-0"
                >
                  <WandSparkles :size="14" />
                  {{ store.projectFormInspecting ? t.modal.discoveringScripts : t.modal.discoverScripts }}
                </button>
              </div>
              <div class="space-y-1.5 md:col-span-12">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.icon }}</span>
                <div
                  class="grid grid-cols-10 gap-1.5 rounded-lg border border-border-subtle bg-surface-container-low p-1.5"
                >
                  <button
                    v-for="icon in projectIcons"
                    :key="icon.key"
                    type="button"
                    @click="updateIcon(icon)"
                    :title="icon.label"
                    :aria-label="icon.label"
                    :class="
                      cn(
                        'flex h-8 min-w-0 items-center justify-center rounded-md transition-colors hover:bg-surface-container-high',
                        form.icon === icon.key ? 'bg-surface ring-1 ring-primary/50' : 'opacity-75',
                      )
                    "
                  >
                    <ProjectIcon :icon="icon.key" />
                  </button>
                </div>
              </div>
              <div class="space-y-1.5 md:col-span-4">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.group }}</span>
                <div class="relative" @click.stop>
                  <input
                    :value="form.group"
                    type="text"
                    :placeholder="t.modal.groupPlaceholder"
                    @input="(event) => store.updateProjectForm({ group: (event.target as HTMLInputElement).value })"
                    class="ui-field w-full pr-9"
                  />
                  <button
                    v-if="existingGroups.length > 0"
                    type="button"
                    class="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-on-surface-variant hover:text-on-surface"
                    title="选择已有分组"
                    aria-label="选择已有分组"
                    :aria-expanded="groupMenuOpen"
                    @click="toggleGroupMenu"
                  >
                    <ChevronDown :size="14" />
                  </button>
                  <div v-if="groupMenuOpen" v-overlay-scrollbar class="mode-menu-popover max-h-48 overflow-auto">
                    <button
                      v-for="group in existingGroups"
                      :key="group"
                      type="button"
                      :class="cn('mode-menu-item', form.group.trim() === group && 'bg-primary/10 text-primary')"
                      @click="selectGroup(group)"
                    >
                      <span class="truncate">{{ group }}</span>
                      <Check v-if="form.group.trim() === group" :size="13" class="shrink-0" />
                    </button>
                  </div>
                </div>
              </div>
              <label class="space-y-1.5 md:col-span-7">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.quickLink }}</span>
                <div class="flex gap-2">
                  <input
                    :value="form.quickLink"
                    type="text"
                    :placeholder="t.modal.quickLinkPlaceholder"
                    @input="(event) => store.updateProjectForm({ quickLink: (event.target as HTMLInputElement).value })"
                    class="ui-field min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    @click="store.pickQuickLinkPath"
                    class="ui-btn ui-btn--secondary shrink-0"
                    :title="t.modal.quickLinkPickPath"
                    :aria-label="t.modal.quickLinkPickPath"
                  >
                    <FolderOpen :size="16" />
                  </button>
                </div>
              </label>
              <div class="flex flex-wrap items-end gap-4 md:col-span-6">
                <div class="space-y-1.5">
                  <span class="flex items-center text-xs font-bold uppercase text-on-surface-variant">
                    {{ t.modal.visibility }}
                    <span
                      class="ml-1 inline-flex text-on-surface-variant transition-colors hover:text-primary focus:text-primary focus:outline-none"
                      role="img"
                      tabindex="0"
                      :title="t.modal.visibilityHint"
                      :aria-label="t.modal.visibilityHint"
                    >
                      <CircleHelp :size="13" :stroke-width="1.8" aria-hidden="true" />
                    </span>
                  </span>
                  <div class="ui-segment w-fit">
                    <button
                      type="button"
                      @click="store.updateProjectForm({ visibility: 'private' })"
                      :class="
                        cn(
                          'ui-segment-item',
                          form.visibility === 'private'
                            ? 'is-active'
                            : '',
                        )
                      "
                    >
                      {{ t.modal.visibilityPrivate }}
                    </button>
                    <button
                      type="button"
                      @click="store.updateProjectForm({ visibility: 'public' })"
                      :class="
                        cn(
                          'ui-segment-item',
                          form.visibility === 'public'
                            ? 'is-active'
                            : '',
                        )
                      "
                    >
                      {{ t.modal.visibilityPublic }}
                    </button>
                  </div>
                </div>
                <div class="space-y-1.5">
                  <span class="flex items-center text-xs font-bold uppercase text-on-surface-variant">
                    {{ t.modal.cardStyle }}
                    <span
                      class="ml-1 inline-flex text-on-surface-variant transition-colors hover:text-primary focus:text-primary focus:outline-none"
                      role="img"
                      tabindex="0"
                      :title="t.modal.cardStyleHint"
                      :aria-label="t.modal.cardStyleHint"
                    >
                      <CircleHelp :size="13" :stroke-width="1.8" aria-hidden="true" />
                    </span>
                  </span>
                  <div class="flex items-center gap-2">
                    <div
                      class="ui-segment w-fit"
                    >
                      <button
                        type="button"
                        @click="store.updateProjectForm({ cardStyle: 'default' })"
                        :class="
                          cn(
                            'ui-segment-item',
                            form.cardStyle === 'default'
                              ? 'is-active'
                              : '',
                          )
                        "
                      >
                        {{ t.modal.cardStyleDefault }}
                      </button>
                      <button
                        type="button"
                        @click="store.updateProjectForm({ cardStyle: 'tiny' })"
                        :class="
                          cn(
                            'ui-segment-item',
                            form.cardStyle === 'tiny'
                              ? 'is-active'
                              : '',
                          )
                        "
                      >
                        {{ t.modal.cardStyleTiny }}
                      </button>
                    </div>
                    <div
                      :class="
                        cn(
                          'flex h-8.5 w-16 overflow-hidden rounded-lg border border-border-subtle bg-surface-container-low transition-colors hover:bg-surface-container focus-within:border-primary focus-within:ring-1 focus-within:ring-primary',
                          form.cardStyle !== 'tiny' && 'invisible pointer-events-none',
                        )
                      "
                    >
                      <input
                        type="number"
                        :value="form.tinyCardButtonCount"
                        :min="PROJECT_TINY_CARD_BUTTON_COUNT_MIN"
                        :max="PROJECT_TINY_CARD_BUTTON_COUNT_MAX"
                        :disabled="form.cardStyle !== 'tiny'"
                        :aria-hidden="form.cardStyle !== 'tiny'"
                        :tabindex="form.cardStyle === 'tiny' ? 0 : -1"
                        step="1"
                        inputmode="numeric"
                        class="min-w-0 flex-1 appearance-none bg-transparent px-1 text-center text-xs font-bold text-on-surface outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
                        :title="t.modal.tinyCardButtonCount"
                        :aria-label="t.modal.tinyCardButtonCount"
                        @input="updateTinyCardButtonCount"
                      />
                      <div class="flex w-5 shrink-0 flex-col border-l border-border-subtle bg-surface">
                        <button
                          type="button"
                          class="flex min-h-0 flex-1 items-center justify-center border-b border-border-subtle text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary disabled:cursor-default disabled:opacity-30"
                          :disabled="
                            form.cardStyle !== 'tiny' || form.tinyCardButtonCount >= PROJECT_TINY_CARD_BUTTON_COUNT_MAX
                          "
                          :title="`${t.modal.tinyCardButtonCount}: +1`"
                          :aria-label="`${t.modal.tinyCardButtonCount}: +1`"
                          @click="adjustTinyCardButtonCount(1)"
                        >
                          <ChevronUp :size="9" :stroke-width="2.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          class="flex min-h-0 flex-1 items-center justify-center text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary disabled:cursor-default disabled:opacity-30"
                          :disabled="
                            form.cardStyle !== 'tiny' || form.tinyCardButtonCount <= PROJECT_TINY_CARD_BUTTON_COUNT_MIN
                          "
                          :title="`${t.modal.tinyCardButtonCount}: -1`"
                          :aria-label="`${t.modal.tinyCardButtonCount}: -1`"
                          @click="adjustTinyCardButtonCount(-1)"
                        >
                          <ChevronDown :size="9" :stroke-width="2.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <label class="space-y-1.5 md:col-span-12">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.description }}</span>
                <textarea
                  :value="form.description"
                  @input="
                    (event) => store.updateProjectForm({ description: (event.target as HTMLTextAreaElement).value })
                  "
                  rows="1"
                  class="ui-field w-full resize-none"
                />
              </label>
            </section>

            <section class="space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-3">
                  <h3 class="text-sm font-bold text-on-surface">{{ t.modal.relatedProjects }}</h3>
                  <p class="truncate text-xs text-on-surface-variant">{{ t.modal.relatedProjectsHint }}</p>
                </div>
                <span class="shrink-0 text-xs font-semibold text-on-surface-variant">
                  {{ form.relatedProjects.length }}/{{ PROJECT_MAX_RELATED_PROJECTS }}
                </span>
              </div>
              <UiSelect
                :model-value="selectedRelatedProjectIds"
                :options="relatedProjectSelectOptions"
                :multiple="true"
                :searchable="true"
                :panel-max-width="448"
                :aria-label="t.modal.relatedProjects"
                :placeholder="t.modal.relatedProjectsPlaceholder"
                @update:model-value="handleRelatedProjectsChange"
              >
                <template #trigger="{ selectedLabel }">
                  <Network :size="16" class="shrink-0 text-primary" />
                  <span class="min-w-0 flex-1 truncate" :class="selectedLabel ? '' : 'text-on-surface-variant'">
                    {{ selectedLabel || t.modal.relatedProjectsPlaceholder }}
                  </span>
                  <ChevronDown :size="16" class="shrink-0 text-on-surface-variant" />
                </template>
              </UiSelect>
              <div v-if="selectedRelatedProjects.length > 0" class="flex flex-wrap gap-1.5">
                <span
                  v-for="project in selectedRelatedProjects"
                  :key="project.id"
                  class="inline-flex max-w-full items-center gap-1 rounded-md border border-border-subtle bg-surface-container-low px-2 py-1 text-xs text-on-surface"
                >
                  <span class="truncate">{{ project.name }}</span>
                  <button
                    type="button"
                    class="shrink-0 rounded-sm p-0.5 text-on-surface-variant hover:bg-status-error/10 hover:text-status-error"
                    :title="`${t.modal.removeRelatedProject}: ${project.name}`"
                    :aria-label="`${t.modal.removeRelatedProject}: ${project.name}`"
                    @click="toggleRelatedProject(project.id)"
                  >
                    <X :size="12" />
                  </button>
                </span>
              </div>
              <label class="inline-flex cursor-pointer items-center gap-2 text-xs text-on-surface">
                <input
                  type="checkbox"
                  :checked="form.relatedProjectsBidirectional"
                  class="h-4 w-4 accent-primary"
                  @change="setRelatedProjectsBidirectional(($event.target as HTMLInputElement).checked)"
                />
                <span>{{ t.modal.relatedProjectsBidirectional }}</span>
              </label>
              <p v-if="incomingRelatedProjects.length > 0" class="text-xs text-on-surface-variant">
                {{ t.modal.relatedProjectsIncomingHint }}：{{
                  incomingRelatedProjects.map((project) => project.name).join("、")
                }}
              </p>
            </section>

            <section class="space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <h3 class="text-sm font-bold text-on-surface">{{ t.modal.scripts }}</h3>
                  <p class="text-xs text-on-surface-variant">{{ t.modal.packageHint }}</p>
                </div>
                <button
                  type="button"
                  @click="store.addScriptEntry"
                  class="ui-btn ui-btn--primary-ghost ui-btn--sm"
                >
                  <Plus :size="14" /> {{ t.modal.addScript }}
                </button>
              </div>
              <div
                v-if="discoveryOpen"
                class="space-y-3 rounded-lg border border-border-subtle bg-surface-container-low p-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <p class="text-xs font-semibold text-on-surface">{{ t.modal.selectDiscoverySources }}</p>
                  <button
                    type="button"
                    class="ui-btn ui-btn--ghost ui-btn--sm"
                    @click="discoveryOpen = false"
                  >
                    {{ t.common.cancel }}
                  </button>
                </div>
                <div class="flex flex-wrap gap-4 text-xs text-on-surface">
                  <label class="inline-flex cursor-pointer items-center gap-2">
                    <input
                      v-model="selectedDiscoverySources"
                      type="checkbox"
                      value="package-json"
                      class="h-4 w-4 accent-primary"
                    />
                    package.json
                  </label>
                  <label class="inline-flex cursor-pointer items-center gap-2">
                    <input v-model="selectedDiscoverySources" type="checkbox" value="makefile" class="h-4 w-4 accent-primary" />
                    Makefile
                  </label>
                  <button
                    type="button"
                    class="ui-btn ui-btn--primary-ghost"
                    :disabled="selectedDiscoverySources.length === 0 || store.projectFormInspecting"
                    @click="discoverScripts"
                  >
                    {{ store.projectFormInspecting ? t.modal.discoveringScripts : t.modal.scanSelectedSources }}
                  </button>
                </div>
                <p v-if="discoveryScanned && discoveryCandidates.length === 0" class="text-xs text-on-surface-variant">
                  {{ t.modal.noDiscoveredScripts }}
                </p>
                <p v-else-if="discoveryCandidates.some(requiresExplicitImport)" class="text-xs text-status-warning">
                  {{ t.modal.riskyScriptsNotSelected }}
                </p>
                <label
                  v-for="candidate in discoveryCandidates"
                  :key="discoveryKey(candidate)"
                  class="flex cursor-pointer items-center gap-3 rounded-md border border-border-subtle bg-surface px-3 py-2 text-xs hover:border-primary/30"
                >
                  <input
                    v-model="selectedDiscoveryKeys"
                    type="checkbox"
                    :value="discoveryKey(candidate)"
                    class="h-4 w-4 accent-primary"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-mono font-semibold text-on-surface">{{ candidate.command }}</span>
                    <span class="block truncate text-on-surface-variant"
                      >{{ candidate.name }} · {{ candidate.note || candidate.source }}</span
                    >
                  </span>
                  <span
                    :class="
                      cn(
                        'rounded border px-1.5 py-0.5 font-mono text-[10px]',
                        requiresExplicitImport(candidate)
                          ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                          : 'border-border-subtle text-on-surface-variant',
                      )
                    "
                  >
                    {{ requiresExplicitImport(candidate) ? t.modal.requiresExplicitImport : candidate.source }}
                  </span>
                </label>
                <div v-if="discoveryCandidates.length > 0" class="flex justify-end">
                  <button
                    type="button"
                    :disabled="selectedDiscoveryKeys.length === 0"
                    class="ui-btn ui-btn--primary"
                    @click="importDiscoveredScripts"
                  >
                    {{ t.modal.importSelectedScripts }}
                  </button>
                </div>
              </div>
              <div class="space-y-2">
                <div
                  v-for="script in form.scripts"
                  :key="script.id"
                  @dragover.prevent
                  @drop="handleScriptDrop(script.id)"
                  @dragend="draggedScriptId = null"
                  :class="
                    cn(
                      'group/script grid grid-cols-1 items-center gap-2 rounded-lg border border-border-subtle bg-surface-container-low p-2 transition-all hover:border-primary/30 hover:bg-surface-container md:grid-cols-[auto_repeat(12,minmax(0,1fr))]',
                      draggedScriptId === script.id && 'opacity-55 ring-1 ring-primary/40',
                    )
                  "
                >
                  <button
                    type="button"
                    class="hidden h-8 w-6 items-center justify-center rounded text-on-surface-variant/55 opacity-70 cursor-grab transition-all hover:bg-surface-container-high hover:text-primary group-hover/script:opacity-100 active:cursor-grabbing md:flex"
                    draggable="true"
                    @dragstart="handleScriptDragStart($event, script.id)"
                    @dragend="draggedScriptId = null"
                    :title="t.scripts.dragToReorder"
                    :aria-label="`${t.scripts.dragToReorder}: ${script.name || t.modal.scriptName}`"
                  >
                    <GripVertical :size="16" />
                  </button>
                  <input
                    :value="script.name"
                    @input="
                      (event) => store.updateScriptEntry(script.id, { name: (event.target as HTMLInputElement).value })
                    "
                    :placeholder="t.modal.scriptName"
                    class="ui-field ui-field-compact w-full md:col-span-2"
                  />
                  <input
                    :value="script.command"
                    @input="
                      (event) =>
                        store.updateScriptEntry(script.id, { command: (event.target as HTMLInputElement).value })
                    "
                    :placeholder="t.modal.scriptCommand"
                    class="ui-field ui-field-compact w-full md:col-span-4"
                  />
                  <div class="md:col-span-2">
                    <UiSelect
                      :model-value="script.cwd || null"
                      :options="cwdOptionsFor(script.cwd)"
                      :aria-label="t.modal.scriptCwd"
                      :placeholder="t.modal.scriptCwd"
                      compact
                      @update:model-value="(value) => handleScriptCwdChange(script.id, value)"
                    />
                  </div>
                  <input
                    :value="script.note"
                    @input="
                      (event) => store.updateScriptEntry(script.id, { note: (event.target as HTMLInputElement).value })
                    "
                    :placeholder="t.modal.scriptNote"
                    class="ui-field ui-field-compact w-full md:col-span-3"
                  />
                  <div class="md:col-span-1 flex min-h-8 items-center justify-end gap-1">
                    <button
                      type="button"
                      @click="store.removeScriptEntry(script.id)"
                      class="ui-btn ui-btn--danger-ghost ui-btn--icon ui-btn--sm opacity-80 group-hover/script:opacity-100"
                      :title="t.modal.removeScript"
                      :aria-label="t.modal.removeScript"
                    >
                      <Trash2 :size="14" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section class="space-y-2">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-bold text-on-surface">{{ t.modal.env }}</h3>
                <button
                  type="button"
                  @click="store.addEnvironmentEntry"
                  class="ui-btn ui-btn--primary-ghost ui-btn--sm"
                >
                  <Plus :size="14" /> {{ t.common.add }}
                </button>
              </div>
              <div class="grid gap-2 lg:grid-cols-2">
                <div
                  v-for="entry in form.envEntries"
                  :key="entry.id"
                  class="space-y-1.5 rounded-lg border border-border-subtle p-2"
                >
                  <div class="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2">
                    <input
                      :value="entry.key"
                      @input="
                        (event) =>
                          handleEnvKeyInput(entry.id, (event.target as HTMLInputElement).value)
                      "
                      class="ui-field ui-field-compact w-full"
                    />
                    <input
                      :value="entry.value"
                      @input="
                        (event) =>
                          store.updateEnvironmentEntry(entry.id, { value: (event.target as HTMLInputElement).value })
                      "
                      class="ui-field ui-field-compact w-full"
                    />
                    <button
                      type="button"
                      @click="store.removeEnvironmentEntry(entry.id)"
                      class="ui-btn ui-btn--danger-ghost ui-btn--sm"
                      :title="t.common.delete"
                      :aria-label="t.common.delete"
                    >
                      <Trash2 :size="16" />
                    </button>
                  </div>
                  <div v-if="isPublicFormProject" class="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span
                      v-if="entry.localOnly && entry.sharedValue !== null"
                      class="rounded border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 font-medium text-status-warning"
                    >
                      {{ t.modal.envScopeOverrideBadge }}
                    </span>
                    <span
                      v-else-if="entry.localOnly"
                      class="rounded bg-surface-container-high px-1.5 py-0.5 text-on-surface-variant"
                    >
                      {{ t.modal.envScopeLocalBadge }}
                    </span>
                    <span v-else />
                    <div class="flex items-center gap-2">
                      <button
                        v-if="entry.localOnly && entry.sharedValue !== null"
                        type="button"
                        class="text-primary hover:underline"
                        @click="restoreSharedEnvValue(entry.id)"
                      >
                        {{ t.modal.envScopeRestoreShared }}
                      </button>
                      <div class="ui-segment w-fit">
                        <button
                          type="button"
                          class="px-2 py-0.5"
                          :class="!entry.localOnly ? 'is-active' : ''"
                          @click="setEnvEntryLocalOnly(entry.id, false)"
                        >
                          {{ t.modal.envScopeSync }}
                        </button>
                        <button
                          type="button"
                          class="px-2 py-0.5"
                          :class="entry.localOnly ? 'is-active' : ''"
                          @click="setEnvEntryLocalOnly(entry.id, true)"
                        >
                          {{ t.modal.envScopeLocal }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="space-y-2">
              <h3 class="text-sm font-bold text-on-surface">{{ t.memo.title }}</h3>
              <textarea
                :value="form.memo"
                @input="(event) => store.updateProjectForm({ memo: (event.target as HTMLTextAreaElement).value })"
                rows="3"
                class="ui-field w-full resize-none"
              />
            </section>
    </div>

    <template #footer>
      <button type="button" class="ui-btn ui-btn--ghost" @click="store.closeProjectForm">
        {{ t.common.cancel }}
      </button>
      <button type="submit" class="ui-btn ui-btn--primary">
        <Save :size="16" /> {{ t.modal.saveProject }}
      </button>
    </template>
  </BaseModal>
</template>
