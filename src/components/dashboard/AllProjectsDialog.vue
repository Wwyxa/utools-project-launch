<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ChevronDown, Eye, EyeOff, Search } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { getOverlayScrollbarScrollElements } from "../../lib/overlayScrollbar";
import { showActionStatus } from "../common/actionStatus";
import BaseModal from "../common/BaseModal.vue";
import UiSelect from "../common/UiSelect.vue";
import type { Project } from "../../types";

const props = defineProps<{ searchQuery: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useStore();
const t = useI18n();
const search = ref(props.searchQuery);
const projectType = ref("");
const hiddenStatus = ref("all");
const searchInput = ref<HTMLInputElement | null>(null);
const projectList = ref<HTMLElement | null>(null);
// 组件由父级 v-if 挂载；BaseModal 的 open watch 需要一次 false→true 变更才能启用焦点陷阱。
const visible = ref(false);
type FilterKey = "type" | "visibility";
const hiddenIds = computed(() => new Set(store.hiddenProjectIds));
const projectTypes = computed(() => [...new Set(store.projects.map((project) => project.type))].sort());
const visibilityOptions = computed(() => [
  { value: "all", label: t.value.common.all },
  { value: "visible", label: t.value.dashboard.visibleProjects },
  { value: "hidden", label: t.value.dashboard.hiddenProjects },
]);
// 未筛选时触发器只显示字段名（弱化色），筛选后显示具体值；避免"标签: 值"前缀把控件撑宽。
const filters = computed(() => [
  {
    key: "type" as const,
    label: t.value.dashboard.projectType,
    value: projectType.value,
    options: [{ value: "", label: t.value.common.all }, ...projectTypes.value.map((type) => ({ value: type, label: type }))],
    displayText: projectType.value || t.value.dashboard.projectType,
    active: Boolean(projectType.value),
  },
  {
    key: "visibility" as const,
    label: t.value.dashboard.hiddenStatus,
    value: hiddenStatus.value,
    options: visibilityOptions.value,
    displayText:
      hiddenStatus.value === "all"
        ? t.value.dashboard.hiddenStatus
        : (visibilityOptions.value.find((option) => option.value === hiddenStatus.value)?.label ?? t.value.dashboard.hiddenStatus),
    active: hiddenStatus.value !== "all",
  },
]);
const selectFilter = (key: FilterKey, value: string | string[] | null) => {
  if (typeof value !== "string") return;
  if (key === "type") projectType.value = value;
  else hiddenStatus.value = value;
};
const projects = computed(() => {
  const query = search.value.trim().toLowerCase();
  return store.projects.filter((project) => {
    const hidden = hiddenIds.value.has(project.id);
    return (
      (!query || project.name.toLowerCase().includes(query) || project.path.toLowerCase().includes(query)) &&
      (!projectType.value || project.type === projectType.value) &&
      (hiddenStatus.value === "all" || (hiddenStatus.value === "hidden" ? hidden : !hidden))
    );
  });
});

watch([search, projectType, hiddenStatus], () => {
  const scrollHost = projectList.value?.closest<HTMLElement>("[data-overlayscrollbars]") ?? null;
  const elements = getOverlayScrollbarScrollElements(scrollHost);
  if (elements) elements.scrollOffsetElement.scrollTop = 0;
}, { flush: "post" });

const openProject = (project: Project) => {
  emit("close");
  if (project.pathExists === false) store.openEditProjectForm(project.id);
  else store.setSelectedProject(project.id);
};

const toggleHidden = (projectId: string) => {
  const hidden = !hiddenIds.value.has(projectId);
  if (!store.setProjectHidden(projectId, hidden)) {
    showActionStatus({ state: "error", message: store.localStateWriteError || t.value.common.error });
  } else if (hiddenStatus.value !== "all") {
    void nextTick(() => searchInput.value?.focus());
  }
};

let previousActiveElement: HTMLElement | null = null;
onMounted(() => {
  previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  visible.value = true;
});
onUnmounted(() => {
  if (previousActiveElement?.isConnected) previousActiveElement.focus();
});
</script>

<template>
  <BaseModal :open="visible" :width="896" :title="t.dashboard.allProjects" body-class="p-0" @close="emit('close')">
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle p-3">
      <label class="relative min-w-40 flex-1">
        <Search :size="15" class="pointer-events-none absolute left-2.5 top-2.5 text-on-surface-variant" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="search"
          type="search"
          autofocus
          :placeholder="t.dashboard.searchProjects"
          :aria-label="t.dashboard.searchProjects"
          class="ui-field h-9 w-full min-w-0 pl-8 pr-2"
        />
      </label>
      <div v-for="filter in filters" :key="filter.key" class="max-w-44 shrink-0">
        <UiSelect
          :model-value="filter.value"
          :options="filter.options"
          :aria-label="filter.label"
          @update:model-value="(value) => selectFilter(filter.key, value)"
        >
          <template #trigger>
            <span
              class="min-w-0 flex-1 truncate text-left leading-normal"
              :class="filter.active ? '' : 'text-on-surface-variant'"
              :title="filter.displayText"
            >{{ filter.displayText }}</span>
            <ChevronDown :size="14" class="shrink-0 text-on-surface-variant" aria-hidden="true" />
          </template>
        </UiSelect>
      </div>
    </div>

    <div ref="projectList" class="min-w-0">
      <p v-if="!store.projectsLoaded" role="status" class="p-6 text-center text-sm text-on-surface-variant">{{ t.common.loading }}</p>
      <p v-else-if="projects.length === 0" class="p-6 text-center text-sm text-on-surface-variant">{{ t.dashboard.noProjectsFound }}</p>
      <ul v-else class="divide-y divide-border-subtle">
        <li v-for="project in projects" :key="project.id" class="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-surface-container-low">
          <button type="button" class="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-4 text-left" :title="t.dashboard.openProject" @click="openProject(project)">
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold" :title="project.name">{{ project.name }}</span>
              <span class="mt-0.5 block truncate text-[11px] text-on-surface-variant">
                {{ project.type }}<template v-if="project.group"> / {{ project.group }}</template>
                <template v-if="project.pathExists === false"> / {{ t.dashboard.unavailableProjects }}</template>
              </span>
            </span>
            <span class="min-w-0 truncate text-xs text-on-surface-variant" :title="project.path">{{ project.path }}</span>
          </button>
          <button
            type="button"
            class="toolbar-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            :class="hiddenIds.has(project.id) ? 'text-on-surface-variant' : 'text-primary'"
            :title="hiddenIds.has(project.id) ? t.dashboard.showProject : t.dashboard.hideProject"
            :aria-label="`${hiddenIds.has(project.id) ? t.dashboard.showProject : t.dashboard.hideProject}: ${project.name}`"
            :aria-pressed="hiddenIds.has(project.id)"
            @click="toggleHidden(project.id)"
          >
            <EyeOff v-if="hiddenIds.has(project.id)" :size="17" aria-hidden="true" />
            <Eye v-else :size="17" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>

    <template #footer-left>
      <p class="text-xs tabular-nums text-on-surface-variant" role="status">
        {{ t.dashboard.projectCount.replace('{count}', String(projects.length)).replace('{total}', String(store.projects.length)) }}
      </p>
    </template>
  </BaseModal>
</template>
