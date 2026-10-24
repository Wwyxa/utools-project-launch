<script setup lang="ts" generic="Value extends string | string[]">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Check, ChevronDown, Search } from "lucide-vue-next";
import type { Component } from "vue";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { isTopUiLayer, pushUiLayer, removeUiLayer, type UiLayer } from "../../lib/uiLayers";
import { useI18n } from "../../lib/i18n";

export interface UiSelectOption {
  value: string;
  label: string;
  /** 行尾弱化说明文本。 */
  hint?: string;
  iconUrl?: string;
  icon?: Component;
  iconSize?: number;
  iconClass?: string;
  disabled?: boolean;
  danger?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: Value | null;
    options: UiSelectOption[];
    /** 多选：点击切换选中且不关闭面板。 */
    multiple?: boolean;
    /** 面板顶部显示过滤输入框。 */
    searchable?: boolean;
    disabled?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    /** 面板与触发器的水平对齐。 */
    align?: "start" | "end";
    /** "auto" 时放不下才向上翻转。 */
    direction?: "auto" | "above" | "below";
    /** 触发器使用 .ui-field-compact 规格（默认 .ui-field）。 */
    compact?: boolean;
    /** 完全替换触发器类（如 Git 分支 chip 触发器）；内容仍可走 #trigger 插槽。 */
    triggerClass?: string;
    /** 面板最小宽度（px）；缺省取触发器宽度。 */
    panelMinWidth?: number;
    panelMaxWidth?: number;
    panelMaxHeight?: number;
  }>(),
  {
    multiple: false,
    searchable: false,
    disabled: false,
    placeholder: "",
    ariaLabel: "",
    align: "start",
    direction: "auto",
    compact: false,
    triggerClass: "",
    panelMinWidth: 0,
    panelMaxWidth: 320,
    panelMaxHeight: 288,
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: Value | null): void;
}>();

const t = useI18n();
const open = ref(false);
const query = ref("");
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const layout = ref({ left: 0, top: 0, minWidth: 0, maxWidth: 320, maxHeight: 288, transformOrigin: "top left" });
let positionFrame = 0;

const isMultiple = computed(() => Array.isArray(props.modelValue));

const filteredOptions = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  if (!keyword) return props.options;
  return props.options.filter(
    (option) => option.label.toLowerCase().includes(keyword) || (option.hint ?? "").toLowerCase().includes(keyword),
  );
});

const selectedValues = computed<string[]>(() => {
  const value: unknown = props.modelValue;
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return [String(value)];
});

const isSelected = (value: string) => selectedValues.value.includes(value);

const selectedLabel = computed(() => {
  const labels = props.options.filter((option) => isSelected(option.value)).map((option) => option.label);
  return labels.join(", ");
});

const defaultTriggerClass = computed(() =>
  props.compact
    ? "ui-field ui-field-compact flex w-full cursor-pointer items-center justify-between gap-2 text-left"
    : "ui-field flex w-full cursor-pointer items-center justify-between gap-2 text-left",
);

const triggerClasses = computed(() => props.triggerClass || defaultTriggerClass.value);

const enabledOptions = () =>
  panelRef.value
    ? Array.from(panelRef.value.querySelectorAll<HTMLButtonElement>('[role="option"]')).filter(
        (element) => !(element instanceof HTMLButtonElement && element.disabled),
      )
    : [];

const focusOption = (element: HTMLButtonElement | undefined) => {
  if (!element) return;
  element.focus();
  element.scrollIntoView({ block: "nearest" });
};

const focusInitialOption = () => {
  if (props.searchable && searchInputRef.value) {
    searchInputRef.value.focus();
    return;
  }
  const options = enabledOptions();
  const current = options.find((element) => element.dataset.optionValue === String(selectedValues.value[0] ?? ""));
  focusOption(current ?? options[0]);
};

const positionPanel = () => {
  const trigger = triggerRef.value;
  const panel = panelRef.value;
  if (!trigger || !panel) return;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const inset = 8;
  const rect = trigger.getBoundingClientRect();
  const panelWidth = panel.offsetWidth || props.panelMaxWidth;
  const panelHeight = panel.offsetHeight;
  let left = props.align === "end" ? rect.right - panelWidth : rect.left;
  left = Math.max(inset, Math.min(left, viewportWidth - panelWidth - inset));
  const fitsBelow = rect.bottom + 4 + panelHeight <= viewportHeight - inset;
  const fitsAbove = rect.top - 4 - panelHeight >= inset;
  const opensUpward = props.direction === "above" || (props.direction === "auto" && !fitsBelow && fitsAbove);
  const top = opensUpward ? Math.max(inset, rect.top - 4 - panelHeight) : rect.bottom + 4;
  const available = opensUpward ? top - inset : viewportHeight - top - inset;
  layout.value = {
    left,
    top,
    minWidth: Math.max(props.panelMinWidth, Math.round(rect.width)),
    maxWidth: Math.min(props.panelMaxWidth, viewportWidth - inset * 2),
    maxHeight: Math.max(48, Math.min(props.panelMaxHeight, available)),
    transformOrigin: opensUpward ? "bottom left" : "top left",
  };
};

const schedulePosition = (focus: boolean) => {
  void nextTick(() => {
    if (!open.value) return;
    positionPanel();
    if (focus) focusInitialOption();
    if (positionFrame) window.cancelAnimationFrame(positionFrame);
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = 0;
      if (open.value) positionPanel();
    });
  });
};

const toggle = () => {
  if (props.disabled) return;
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  schedulePosition(true);
};

const close = () => {
  if (!open.value) return;
  open.value = false;
  void nextTick(() => triggerRef.value?.focus());
};

const handleTriggerKeydown = (event: KeyboardEvent) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!open.value) {
      open.value = true;
      schedulePosition(true);
    } else if (!props.searchable) {
      focusOption(enabledOptions()[0]);
    }
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggle();
  }
};

const handlePanelKeydown = (event: KeyboardEvent) => {
  if (event.key === "Tab") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const options = enabledOptions();
  if (!options.length) return;
  const current = event.target instanceof Element ? (event.target.closest<HTMLElement>('[role="option"]') as HTMLButtonElement | null) : null;
  const index = current ? options.indexOf(current) : -1;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (Math.max(0, index) + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
  focusOption(options[nextIndex]);
};

const handleSearchKeydown = (event: KeyboardEvent) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const options = enabledOptions();
    focusOption(event.key === "ArrowDown" ? options[0] : options[options.length - 1]);
  }
};

const selectValue = (option: UiSelectOption) => {
  if (option.disabled) return;
  if (isMultiple.value) {
    const current = (Array.isArray(props.modelValue) ? props.modelValue : []) as string[];
    const next = current.includes(option.value) ? current.filter((value) => value !== option.value) : [...current, option.value];
    emit("update:modelValue", next as Value);
    return;
  }
  emit("update:modelValue", option.value as Value);
  close();
};

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!open.value) return;
  const target = event.target;
  if (target instanceof Node && (panelRef.value?.contains(target) || triggerRef.value?.contains(target))) return;
  close();
};

const handleDocumentScroll = (event: Event) => {
  if (!open.value) return;
  const target = event.target;
  if (target instanceof Node && panelRef.value?.contains(target)) return;
  close();
};

const handleWindowResize = () => close();

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!open.value || event.detail.handled) return;
  // 与 BaseModal 共用层栈：弹窗内打开的下拉优先于弹窗响应 Escape
  if (!isTopUiLayer(layer)) return;
  event.detail.handle();
  close();
};

const layer: UiLayer = {
  kind: "floating",
  close: () => {
    if (!open.value) return false;
    close();
    return true;
  },
};
let removeLayer: (() => void) | null = null;

let stopAppEscapeListener = () => {};
const detachDocumentListeners = () => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("scroll", handleDocumentScroll, true);
  window.removeEventListener("resize", handleWindowResize);
  removeLayer?.();
  removeLayer = null;
};

watch(open, (isOpen) => {
  if (isOpen) {
    query.value = "";
    removeLayer = pushUiLayer(layer);
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("scroll", handleDocumentScroll, true);
    window.addEventListener("resize", handleWindowResize);
  } else {
    detachDocumentListeners();
  }
});

onBeforeUnmount(() => {
  if (positionFrame) window.cancelAnimationFrame(positionFrame);
  detachDocumentListeners();
  removeLayer?.();
  removeLayer = null;
  stopAppEscapeListener();
});

stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);

const panelStyle = computed(() => ({
  left: `${layout.value.left}px`,
  top: `${layout.value.top}px`,
  minWidth: `${layout.value.minWidth}px`,
  maxWidth: `min(${layout.value.maxWidth}px, calc(100vw - 1rem))`,
  maxHeight: `${layout.value.maxHeight}px`,
  transformOrigin: layout.value.transformOrigin,
}));
</script>

<template>
  <button
    ref="triggerRef"
    type="button"
    :class="triggerClasses"
    :disabled="disabled"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-label="ariaLabel || undefined"
    @click="toggle"
    @keydown="handleTriggerKeydown"
  >
    <slot name="trigger" :open="open" :selected-label="selectedLabel">
      <span v-if="selectedLabel" class="min-w-0 flex-1 truncate">{{ selectedLabel }}</span>
      <span v-else class="min-w-0 flex-1 truncate text-on-surface-variant">{{ placeholder }}</span>
      <ChevronDown :size="14" class="shrink-0 text-on-surface-variant" />
    </slot>
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      ref="panelRef"
      class="menu-pop fixed z-[85] flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-container-lowest shadow-popover"
      :style="panelStyle"
      role="listbox"
      :aria-label="ariaLabel || undefined"
      @click.stop
      @keydown="handlePanelKeydown"
    >
      <div v-if="searchable" class="shrink-0 border-b border-border-subtle p-1">
        <div class="relative">
          <Search :size="13" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            ref="searchInputRef"
            v-model="query"
            type="text"
            class="ui-field ui-field-compact w-full pl-7"
            :placeholder="t.common.selectSearch"
            @keydown="handleSearchKeydown"
          />
        </div>
      </div>
      <div v-overlay-scrollbar class="themed-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div v-if="!filteredOptions.length" class="px-3 py-2 text-xs text-on-surface-variant" role="status">
          {{ t.common.selectNoResults }}
        </div>
        <template v-for="option in filteredOptions" :key="option.value">
          <button
            type="button"
            role="option"
            :aria-selected="isSelected(option.value)"
            :data-option-value="option.value"
            class="mode-menu-item mode-menu-item--leading"
            :class="[isSelected(option.value) ? 'bg-primary/10 text-primary' : '', option.danger ? 'text-status-error' : '']"
            :disabled="option.disabled"
            :title="option.hint || undefined"
            @click="selectValue(option)"
          >
            <img v-if="option.iconUrl" :src="option.iconUrl" alt="" class="h-4 w-4 shrink-0 object-contain" />
            <component :is="option.icon" v-else-if="option.icon" :size="option.iconSize ?? 14" class="shrink-0" :class="option.iconClass" />
            <span class="min-w-0 truncate">{{ option.label }}</span>
            <span v-if="option.hint" class="ml-auto shrink-0 truncate pl-2 text-[10px] font-semibold text-on-surface-variant">
              {{ option.hint }}
            </span>
            <Check v-if="isSelected(option.value)" :size="13" class="shrink-0 text-primary" :class="option.hint ? '' : 'ml-auto'" />
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>
