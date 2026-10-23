<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Check, ChevronDown, Eye, EyeOff, Search, X } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { addAppEscapeRequestListener } from "../../lib/escape";
import { getOverlayScrollbarScrollElements } from "../../lib/overlayScrollbar";
import { showActionStatus } from "../common/actionStatus";
import type { Project } from "../../types";

const props = defineProps<{ searchQuery: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useStore();
const t = useI18n();
const search = ref(props.searchQuery);
const projectType = ref("");
const hiddenStatus = ref("all");
const dialog = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const projectList = ref<HTMLElement | null>(null);
type FilterKey = "type" | "visibility";
const activeFilter = ref<FilterKey | null>(null);
const filterMenu = ref<HTMLElement | null>(null);
const filterMenuStyle = ref<Record<string, string>>({});
const hiddenIds = computed(() => new Set(store.hiddenProjectIds));
const projectTypes = computed(() => [...new Set(store.projects.map((project) => project.type))].sort());
const filters = computed(() => [
  {
    key: "type" as const,
    label: t.value.dashboard.projectType,
    value: projectType.value,
    options: [{ value: "", label: t.value.common.all }, ...projectTypes.value.map((type) => ({ value: type, label: type }))],
  },
  {
    key: "visibility" as const,
    label: t.value.dashboard.hiddenStatus,
    value: hiddenStatus.value,
    options: [
      { value: "all", label: t.value.common.all },
      { value: "visible", label: t.value.dashboard.visibleProjects },
      { value: "hidden", label: t.value.dashboard.hiddenProjects },
    ],
  },
]);
const currentFilter = computed(() => filters.value.find((filter) => filter.key === activeFilter.value));
const filterTrigger = () => dialog.value?.querySelector<HTMLButtonElement>(`[data-filter="${activeFilter.value}"]`);

const closeFilter = (restoreFocus = false) => {
  if (restoreFocus) filterTrigger()?.focus();
  activeFilter.value = null;
};
const positionFilterMenu = () => {
  const trigger = filterTrigger()?.getBoundingClientRect();
  if (!trigger) return;
  const width = Math.min(Math.max(trigger.width, 176), window.innerWidth - 16);
  const below = window.innerHeight - trigger.bottom - 12;
  const above = trigger.top - 12;
  const upward = below < 160 && above > below;
  filterMenuStyle.value = {
    left: `${Math.max(8, Math.min(trigger.right - width, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(0, Math.min(288, upward ? above : below))}px`,
    ...(upward ? { bottom: `${window.innerHeight - trigger.top + 4}px` } : { top: `${trigger.bottom + 4}px` }),
  };
};
const openFilter = async (key: FilterKey) => {
  activeFilter.value = key;
  positionFilterMenu();
  await nextTick();
  filterMenu.value?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
};
const selectFilter = (value: string) => {
  if (activeFilter.value === "type") projectType.value = value;
  else hiddenStatus.value = value;
  closeFilter(true);
};
const handleFilterKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeFilter(true);
  } else if (event.key === "Tab") {
    event.preventDefault();
    const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>("button, input") || []);
    const current = controls.indexOf(filterTrigger()!);
    closeFilter(true);
    controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const options = Array.from(filterMenu.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (current + (event.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
    options[next]?.focus();
  }
};
const handleOutsidePointerDown = (event: PointerEvent) => {
  if (!activeFilter.value) return;
  const target = event.target as Node;
  if (!filterMenu.value?.contains(target) && !filterTrigger()?.contains(target)) closeFilter();
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
  const elements = getOverlayScrollbarScrollElements(projectList.value);
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

const handleTabKey = (event: KeyboardEvent) => {
  if (event.key !== "Tab") return;
  const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>("button, input, select") || []);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
};

let stopEscapeListener = () => {};
let previousActiveElement: HTMLElement | null = null;
onMounted(() => {
  previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  searchInput.value?.focus();
  document.addEventListener("pointerdown", handleOutsidePointerDown);
  window.addEventListener("resize", positionFilterMenu);
  stopEscapeListener = addAppEscapeRequestListener((event) => {
    if (event.detail.handled) return;
    if (activeFilter.value) closeFilter(true);
    else emit("close");
    event.detail.handle();
  });
});
onUnmounted(() => {
  stopEscapeListener();
  document.removeEventListener("pointerdown", handleOutsidePointerDown);
  window.removeEventListener("resize", positionFilterMenu);
  if (previousActiveElement?.isConnected) previousActiveElement.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-scrim/40 p-3 sm:p-5" @click.self="emit('close')">
      <section
        ref="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="all-projects-title"
        class="flex max-h-[calc(100dvh-2.5rem)] w-full max-w-4xl min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface text-on-surface shadow-2xl"
        @keydown="handleTabKey"
      >
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 id="all-projects-title" class="text-sm font-bold">{{ t.dashboard.allProjects }}</h2>
          <button
            type="button"
            class="toolbar-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            :title="t.common.close"
            :aria-label="t.common.close"
            @click="emit('close')"
          ><X :size="18" /></button>
        </header>

        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle p-3">
          <label class="relative min-w-40 flex-1">
            <Search :size="15" class="pointer-events-none absolute left-2.5 top-2.5 text-on-surface-variant" aria-hidden="true" />
            <input
              ref="searchInput"
              v-model="search"
              type="search"
              :placeholder="t.dashboard.searchProjects"
              :aria-label="t.dashboard.searchProjects"
              class="h-9 w-full min-w-0 rounded-md border border-border-subtle bg-surface-container-low pl-8 pr-2 text-xs outline-none focus:border-primary"
            />
          </label>
          <button
            v-for="filter in filters"
            :key="filter.key"
            type="button"
            :data-filter="filter.key"
            :aria-label="filter.label"
            :aria-expanded="activeFilter === filter.key"
            aria-haspopup="listbox"
            class="toolbar-icon-button grid h-9 min-w-0 max-w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
            @click="activeFilter === filter.key ? closeFilter() : openFilter(filter.key)"
            @keydown.down.prevent="openFilter(filter.key)"
            @keydown.up.prevent="openFilter(filter.key)"
          >
            <span class="min-w-0 truncate text-left leading-normal">{{ filter.label }}: {{ filter.options.find((option) => option.value === filter.value)?.label }}</span>
            <ChevronDown :size="14" class="shrink-0 text-on-surface-variant" aria-hidden="true" />
          </button>
        </div>

        <div ref="projectList" class="min-h-0 overflow-y-auto">
          <div class="min-w-0">
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
                class="toolbar-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
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
        </div>
        <footer class="shrink-0 border-t border-border-subtle px-4 py-2 text-xs tabular-nums text-on-surface-variant" role="status">
          {{ t.dashboard.projectCount.replace('{count}', String(projects.length)).replace('{total}', String(store.projects.length)) }}
        </footer>
      </section>
    </div>
    <div
      v-if="currentFilter"
      ref="filterMenu"
      :style="filterMenuStyle"
      role="listbox"
      :aria-label="currentFilter.label"
      class="menu-pop fixed z-[70] flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface text-on-surface shadow-xl"
      @keydown="handleFilterKeydown"
    >
      <div class="min-h-0 overflow-y-auto">
        <div class="p-1">
        <button
          v-for="option in currentFilter.options"
          :key="option.value"
          type="button"
          role="option"
          :aria-selected="currentFilter.value === option.value"
          class="flex min-h-8 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs outline-none hover:bg-surface-variant focus-visible:bg-surface-variant"
          :class="currentFilter.value === option.value ? 'bg-primary/10 text-primary' : 'text-on-surface'"
          @click="selectFilter(option.value)"
        >
          <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
          <Check v-if="currentFilter.value === option.value" :size="14" class="shrink-0" aria-hidden="true" />
        </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>