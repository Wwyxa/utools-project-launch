<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { Check, Code2 } from "lucide-vue-next";
import type { ExternalApplication } from "../../types";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { useI18n } from "../../lib/i18n";

const props = withDefaults(
  defineProps<{
    applications: ExternalApplication[];
    defaultApplicationId: string;
    disabled?: boolean;
    buttonClass?: string;
    iconClass?: string;
    iconSize?: number;
  }>(),
  { disabled: false, buttonClass: "", iconClass: "", iconSize: 18 },
);

const emit = defineEmits<{ (event: "launch", applicationId?: string): void }>();
const t = useI18n();
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const menuOpen = ref(false);
const menuPosition = ref({ left: 8, top: 8 });
let stopAppEscapeListener = () => {};

const enabledApplications = computed(() => props.applications.filter((application) => application.enabled));
const defaultApplication = computed(
  () =>
    enabledApplications.value.find((application) => application.id === props.defaultApplicationId) ||
    enabledApplications.value[0],
);
const buttonLabel = computed(() =>
  t.value.projectActions.openWithApplicationMenu.replace("{name}", defaultApplication.value?.name || ""),
);
const menuStyle = computed(() => ({ left: `${menuPosition.value.left}px`, top: `${menuPosition.value.top}px` }));

const menuItems = () => Array.from(menuRef.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);

const closeMenu = (restoreFocus = false) => {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  if (restoreFocus) void nextTick(() => triggerRef.value?.focus());
};

const setClampedMenuPosition = (left: number, top: number) => {
  const rect = menuRef.value?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  menuPosition.value = {
    left: Math.max(8, Math.min(left, viewportWidth - (rect?.width || 192) - 8)),
    top: Math.max(8, Math.min(top, viewportHeight - (rect?.height || 48) - 8)),
  };
};

const clampMenu = async (left: number, top: number) => {
  menuOpen.value = true;
  menuPosition.value = { left, top };
  await nextTick();
  setClampedMenuPosition(left, top);
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  setClampedMenuPosition(left, top);
  await nextTick();
  const items = menuItems();
  (items.find((item) => item.dataset.applicationId === props.defaultApplicationId) || items[0])?.focus();
};

const openAtPointer = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  if (props.disabled || enabledApplications.value.length === 0) return;
  const rect = triggerRef.value?.getBoundingClientRect();
  const left = event.clientX || rect?.left || 8;
  const top = event.clientY || rect?.bottom || 8;
  void clampMenu(left, top);
};

const handleTriggerKeydown = (event: KeyboardEvent) => {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = triggerRef.value?.getBoundingClientRect();
  if (rect) void clampMenu(rect.left, rect.bottom + 4);
};

const launchDefault = () => {
  if (props.disabled || !defaultApplication.value) return;
  emit("launch");
};

const launchApplication = (applicationId: string) => {
  closeMenu(true);
  emit("launch", applicationId);
};

const handleMenuKeydown = (event: KeyboardEvent) => {
  const items = menuItems();
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  let nextIndex = currentIndex;
  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + items.length) % items.length;
  else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;
  else if (event.key === "Escape") {
    event.preventDefault();
    closeMenu(true);
    return;
  } else return;
  event.preventDefault();
  items[nextIndex]?.focus();
};

const handleMenuFocusOut = () => {
  window.setTimeout(() => {
    const activeElement = document.activeElement;
    if (!menuRef.value?.contains(activeElement) && activeElement !== triggerRef.value) closeMenu();
  }, 0);
};

const handleWindowPointerDown = (event: PointerEvent) => {
  const target = event.target as Node | null;
  if (menuRef.value?.contains(target) || triggerRef.value?.contains(target)) return;
  closeMenu();
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!menuOpen.value) return;
  closeMenu(true);
  event.detail.handle();
};

onMounted(() => {
  window.addEventListener("pointerdown", handleWindowPointerDown);
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", handleWindowPointerDown);
  stopAppEscapeListener();
});
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
    :aria-expanded="menuOpen"
    @click.stop="launchDefault"
    @contextmenu="openAtPointer"
    @keydown="handleTriggerKeydown"
  >
    <Code2 :size="iconSize" :class="iconClass" />
  </button>

  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="menuOpen"
        ref="menuRef"
        data-external-application-menu
        role="menu"
        :aria-label="t.projectActions.chooseApplication"
        class="fixed z-[90] w-max min-w-32 max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-border-subtle bg-surface p-1 text-xs shadow-2xl"
        :style="menuStyle"
        @click.stop
        @keydown="handleMenuKeydown"
        @focusout="handleMenuFocusOut"
      >
        <div v-overlay-scrollbar class="themed-scrollbar max-h-[calc(100vh-1.5rem)] overflow-y-auto">
          <button
            v-for="application in enabledApplications"
            :key="application.id"
            type="button"
            role="menuitem"
            class="mode-menu-item"
            :data-application-id="application.id"
            @click="launchApplication(application.id)"
          >
            <span class="truncate">{{ application.name }}</span>
            <Check v-if="application.id === defaultApplicationId" :size="13" class="shrink-0 text-primary" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
