<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { Code2 } from "lucide-vue-next";
import type { ExternalApplication } from "../../types";
import UiContextMenu from "../common/UiContextMenu.vue";
import type {
  UiContextMenuAnchor,
  UiContextMenuItem,
  UiContextMenuCloseReason,
} from "../common/uiContextMenu";
import { useI18n } from "../../lib/i18n";

const props = withDefaults(
  defineProps<{
    applications: ExternalApplication[];
    defaultApplicationId: string;
    disabled?: boolean;
    buttonClass?: string;
    iconClass?: string;
    iconSize?: number;
    label?: string;
  }>(),
  { disabled: false, buttonClass: "", iconClass: "", iconSize: 18, label: "" },
);

const emit = defineEmits<{ (event: "launch", applicationId?: string): void }>();
const t = useI18n();
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuAnchor = ref<UiContextMenuAnchor | null>(null);

const enabledApplications = computed(() => props.applications.filter((application) => application.enabled));
const defaultApplication = computed(
  () =>
    enabledApplications.value.find((application) => application.id === props.defaultApplicationId) ||
    enabledApplications.value[0],
);
const buttonLabel = computed(() =>
  t.value.projectActions.openWithApplicationMenu.replace("{name}", defaultApplication.value?.name || ""),
);

const menuItems = computed<UiContextMenuItem[]>(() =>
  enabledApplications.value.map((application) => ({
    type: "item" as const,
    key: application.id,
    label: application.name,
    title: application.name,
    checked: application.id === props.defaultApplicationId,
    onSelect: () => emit("launch", application.id),
  })),
);

const closeMenu = () => {
  menuAnchor.value = null;
};

const handleMenuClosed = ({ reason }: { reason: UiContextMenuCloseReason }) => {
  menuAnchor.value = null;
  if (reason === "select" || reason === "escape") void nextTick(() => triggerRef.value?.focus());
};

const openAtPointer = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  if (props.disabled || enabledApplications.value.length === 0) return;
  const rect = triggerRef.value?.getBoundingClientRect();
  menuAnchor.value = {
    x: event.clientX || rect?.left || 8,
    y: event.clientY || rect?.bottom || 8,
  };
};

const handleTriggerKeydown = (event: KeyboardEvent) => {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  event.stopPropagation();
  if (props.disabled || enabledApplications.value.length === 0) return;
  const rect = triggerRef.value?.getBoundingClientRect();
  if (rect) menuAnchor.value = { x: rect.left, y: rect.bottom + 4 };
};

const launchDefault = () => {
  if (props.disabled || !defaultApplication.value) return;
  emit("launch");
};
</script>

<template>
  <button
    ref="triggerRef"
    type="button"
    :disabled="disabled"
    :class="buttonClass"
    :title="buttonLabel"
    :aria-label="buttonLabel"
    aria-haspopup="menu"
    :aria-expanded="Boolean(menuAnchor)"
    @click.stop="launchDefault"
    @contextmenu="openAtPointer"
    @keydown="handleTriggerKeydown"
  >
    <span v-if="label" class="truncate">{{ label }}</span>
    <Code2 :size="iconSize" :class="iconClass" />
  </button>

  <UiContextMenu
    :anchor="menuAnchor"
    :items="menuItems"
    :aria-label="t.projectActions.chooseApplication"
    :initial-focus-key="defaultApplication?.id || ''"
    :max-width="320"
    @close="handleMenuClosed"
  />
</template>
