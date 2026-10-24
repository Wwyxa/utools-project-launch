<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Check, ChevronRight } from "lucide-vue-next";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import type {
  UiContextMenuAnchor,
  UiContextMenuItem,
  UiContextMenuItemEntry,
  UiContextMenuCloseReason,
  UiContextMenuClosePayload,
  UiContextMenuSubmenuSpec,
} from "./uiContextMenu";

const props = withDefaults(
  defineProps<{
    /** 为 null 时关闭；对象内容变化时重新定位。 */
    anchor: UiContextMenuAnchor | null;
    items: UiContextMenuItem[];
    ariaLabel?: string;
    minWidth?: number;
    maxWidth?: number;
    /** 主菜单滚动区高度上限（px）。 */
    maxHeight?: number;
    /** 打开后优先聚焦的条目 key（如默认应用），不存在则聚焦首个可用条目。 */
    initialFocusKey?: string;
    viewportInset?: number;
    /** 返回 false 时跳过该次外部 pointerdown 关闭（如点击触发器本身）。 */
    shouldCloseOnOutsidePointerDown?: (target: EventTarget | null) => boolean;
  }>(),
  {
    ariaLabel: "",
    minWidth: 0,
    maxWidth: 208,
    maxHeight: 240,
    initialFocusKey: "",
    viewportInset: 8,
    shouldCloseOnOutsidePointerDown: undefined,
  },
);

const emit = defineEmits<{
  (event: "close", payload: UiContextMenuClosePayload): void;
  (event: "panelPointerEnter"): void;
  (event: "panelPointerLeave"): void;
}>();

const mainRef = ref<HTMLElement | null>(null);
const submenuRef = ref<HTMLElement | null>(null);
const mainLayout = ref({ left: 0, top: 0, transformOrigin: "top left", maxHeight: 480 });
const submenuState = ref<{ key: string; parentEl: HTMLElement } | null>(null);
const submenuFocusPending = ref(false);
const submenuLayout = ref({ left: 0, top: 0, maxHeight: 480 });
const loadedSubmenuItems = ref<UiContextMenuItem[]>([]);
const submenuLoad = ref<{ status: "loading" | "error"; message?: string } | null>(null);
let positionFrame = 0;
let submenuRequestToken = 0;
let submenuCloseTimer: number | undefined;
const submenuLoadCache = new WeakMap<UiContextMenuSubmenuSpec, Promise<UiContextMenuItem[]>>();

const viewportSize = () => ({
  width: document.documentElement.clientWidth || window.innerWidth,
  height: document.documentElement.clientHeight || window.innerHeight,
});

const findItemByKey = (items: UiContextMenuItem[], key: string): UiContextMenuItemEntry | null => {
  for (const item of items) {
    if (item.type !== "item") continue;
    if (item.key === key) return item;
  }
  return null;
};

const activeSubmenuSpec = computed<UiContextMenuSubmenuSpec | null>(() => {
  if (!submenuState.value) return null;
  return findItemByKey(props.items, submenuState.value.key)?.submenu ?? null;
});

const submenuDisplayItems = computed<UiContextMenuItem[]>(() => {
  const staticItems = activeSubmenuSpec.value?.items;
  return staticItems && staticItems.length ? staticItems : loadedSubmenuItems.value;
});

const submenuPlaceholder = computed(() => {
  if (!submenuState.value) return "";
  if (submenuLoad.value?.status === "loading") return activeSubmenuSpec.value?.loadingLabel || "";
  if (submenuLoad.value?.status === "error") return activeSubmenuSpec.value?.errorLabel || "";
  if (!submenuDisplayItems.value.length) return activeSubmenuSpec.value?.emptyLabel || "";
  return "";
});

const submenuPlaceholderTitle = computed(() =>
  submenuLoad.value?.status === "error" ? submenuLoad.value.message : undefined,
);

const focusableItems = (panel: HTMLElement | null) =>
  panel
    ? Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
        (element) =>
          !((element instanceof HTMLButtonElement && element.disabled) || element.getAttribute("aria-disabled") === "true"),
      )
    : [];

const focusMainItem = () => {
  const items = focusableItems(mainRef.value);
  const target =
    (props.initialFocusKey
      ? items.find((element) => element.dataset.itemKey === props.initialFocusKey)
      : undefined) || items[0];
  target?.focus();
};

const positionMain = () => {
  const anchor = props.anchor;
  const panel = mainRef.value;
  if (!anchor || !panel) return;
  const { width: viewportWidth, height: viewportHeight } = viewportSize();
  const inset = props.viewportInset;
  const rect = panel.getBoundingClientRect();
  const width = rect.width || props.maxWidth;
  const height = rect.height;
  let left = anchor.alignRight ? anchor.x - width : anchor.x;
  if (left + width > viewportWidth - inset) left = anchor.x - width;
  left = Math.max(inset, Math.min(left, viewportWidth - width - inset));
  const flipY = anchor.aboveY ?? anchor.y;
  const fitsBelow = anchor.y + height <= viewportHeight - inset;
  const fitsAbove = flipY - height >= inset;
  const opensUpward = !fitsBelow && fitsAbove;
  const top = opensUpward
    ? flipY - height
    : Math.max(inset, Math.min(anchor.y, Math.max(inset, viewportHeight - height - inset)));
  const available = opensUpward ? top - inset : viewportHeight - top - inset;
  mainLayout.value = {
    left,
    top,
    transformOrigin: opensUpward ? "bottom left" : "top left",
    maxHeight: Math.max(48, Math.min(props.maxHeight + 8, available)),
  };
};

const positionSubmenu = () => {
  const state = submenuState.value;
  const panel = submenuRef.value;
  if (!state || !panel) return;
  const { width: viewportWidth, height: viewportHeight } = viewportSize();
  const inset = props.viewportInset;
  const parentRect = state.parentEl.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  const preferredLeft =
    parentRect.right + 4 + rect.width <= viewportWidth - inset ? parentRect.right + 4 : parentRect.left - rect.width - 4;
  const left = Math.max(inset, Math.min(preferredLeft, viewportWidth - rect.width - inset));
  const top = Math.max(inset, Math.min(parentRect.top, viewportHeight - rect.height - inset));
  submenuLayout.value = { left, top, maxHeight: Math.max(48, viewportHeight - top - inset) };
};

const scheduleReposition = (focus: boolean) => {
  void nextTick(() => {
    if (!props.anchor) return;
    positionMain();
    if (focus) focusMainItem();
    if (positionFrame) window.cancelAnimationFrame(positionFrame);
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = 0;
      if (props.anchor) positionMain();
    });
  });
};

watch(
  () => props.anchor,
  (anchor) => {
    if (anchor) {
      clearSubmenuCloseTimer();
      submenuState.value = null;
      loadedSubmenuItems.value = [];
      submenuLoad.value = null;
      scheduleReposition(anchor.focus !== false);
    } else {
      clearSubmenuCloseTimer();
      submenuState.value = null;
    }
  },
);

watch(
  () => props.items,
  () => {
    if (!props.anchor) return;
    scheduleReposition(false);
  },
);

const clearSubmenuCloseTimer = () => {
  if (submenuCloseTimer === undefined) return;
  window.clearTimeout(submenuCloseTimer);
  submenuCloseTimer = undefined;
};

const closeSubmenu = (refocusParent = false) => {
  clearSubmenuCloseTimer();
  const parent = submenuState.value?.parentEl;
  submenuState.value = null;
  submenuFocusPending.value = false;
  if (refocusParent) void nextTick(() => parent?.focus());
};

const scheduleSubmenuClose = () => {
  clearSubmenuCloseTimer();
  submenuCloseTimer = window.setTimeout(() => {
    submenuCloseTimer = undefined;
    closeSubmenu();
  }, 120);
};

const openSubmenu = async (
  item: UiContextMenuItemEntry,
  parentEl: HTMLElement,
  focusFirst: boolean,
) => {
  clearSubmenuCloseTimer();
  if (submenuState.value?.key === item.key) {
    if (focusFirst) {
      submenuFocusPending.value = true;
      void nextTick(() => {
        if (!submenuLoad.value) focusableItems(submenuRef.value)[0]?.focus();
      });
    }
    return;
  }
  submenuState.value = { key: item.key, parentEl };
  loadedSubmenuItems.value = [];
  submenuLoad.value = null;
  submenuFocusPending.value = focusFirst;
  const spec = item.submenu;
  if (spec?.load) {
    const token = ++submenuRequestToken;
    const key = item.key;
    let pending = submenuLoadCache.get(spec);
    if (!pending) {
      pending = spec.load();
      submenuLoadCache.set(spec, pending);
    }
    submenuLoad.value = { status: "loading" };
    void pending
      .then((entries) => {
        if (token !== submenuRequestToken || submenuState.value?.key !== key) return;
        loadedSubmenuItems.value = entries;
        submenuLoad.value = null;
        void nextTick(() => {
          positionSubmenu();
          if (submenuFocusPending.value && submenuState.value?.key === key) {
            submenuFocusPending.value = false;
            focusableItems(submenuRef.value)[0]?.focus();
          }
        });
      })
      .catch((error: unknown) => {
        if (token !== submenuRequestToken || submenuState.value?.key !== key) return;
        submenuLoad.value = {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
        void nextTick(() => {
          positionSubmenu();
          if (submenuFocusPending.value && submenuState.value?.key === key) {
            submenuFocusPending.value = false;
            focusableItems(submenuRef.value)[0]?.focus();
          }
        });
      });
  }
  await nextTick();
  positionSubmenu();
  if (focusFirst && !submenuLoad.value) focusableItems(submenuRef.value)[0]?.focus();
};

const activateItem = (item: UiContextMenuItemEntry, element: HTMLElement | null) => {
  if (item.submenu && !item.onSelect) {
    if (element) void openSubmenu(item, element, true);
    return;
  }
  item.onSelect?.();
  closeAll("select");
};

const handleItemClick = (item: UiContextMenuItemEntry, event: MouseEvent) => {
  activateItem(item, event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
};

const handleItemKeyActivate = (item: UiContextMenuItemEntry, event: KeyboardEvent) => {
  activateItem(item, event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
};

const handleItemMetaActivate = (item: UiContextMenuItemEntry) => {
  item.meta?.onActivate?.();
};

const handleMainKeydown = (event: KeyboardEvent) => {
  if (event.key === "Tab") {
    event.preventDefault();
    closeAll("escape");
    return;
  }
  const current = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
  if (event.key === "ArrowRight") {
    const key = current?.dataset.itemKey;
    const item = key ? findItemByKey(props.items, key) : null;
    if (item?.submenu && current) {
      event.preventDefault();
      event.stopPropagation();
      void openSubmenu(item, current, true);
    }
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  event.stopPropagation();
  if (submenuState.value) closeSubmenu();
  const items = focusableItems(mainRef.value);
  if (!items.length) return;
  const index = current ? items.indexOf(current) : -1;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (Math.max(0, index) + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[nextIndex]?.focus();
};

const handleSubmenuKeydown = (event: KeyboardEvent) => {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    event.stopPropagation();
    closeSubmenu(true);
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    closeAll("escape");
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  event.stopPropagation();
  const current = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
  const items = focusableItems(submenuRef.value);
  if (!items.length) return;
  const index = current ? items.indexOf(current) : -1;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (Math.max(0, index) + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[nextIndex]?.focus();
};

const handleMainPointerMove = (event: PointerEvent) => {
  const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
  if (!item) return;
  const key = item.dataset.itemKey;
  if (!submenuState.value || key === submenuState.value.key) return;
  const target = key ? findItemByKey(props.items, key) : null;
  if (target?.submenu) void openSubmenu(target, item, false);
  else scheduleSubmenuClose();
};

const handleMainFocusIn = (event: FocusEvent) => {
  if (!submenuState.value) return;
  const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
  if (!item || item.dataset.itemKey !== submenuState.value.key) scheduleSubmenuClose();
};

const closeAll = (reason: UiContextMenuCloseReason, event?: Event) => {
  clearSubmenuCloseTimer();
  submenuState.value = null;
  emit("close", { reason, event });
};

const handleDocumentPointerDown = (event: PointerEvent) => {
  const target = event.target;
  if (target instanceof Node && (mainRef.value?.contains(target) || submenuRef.value?.contains(target))) return;
  if (props.shouldCloseOnOutsidePointerDown && !props.shouldCloseOnOutsidePointerDown(event.target)) return;
  closeAll("outside", event);
};

const handleDocumentClick = (event: MouseEvent) => {
  const target = event.target;
  if (target instanceof Node && (mainRef.value?.contains(target) || submenuRef.value?.contains(target))) return;
  if (props.shouldCloseOnOutsidePointerDown && !props.shouldCloseOnOutsidePointerDown(event.target)) return;
  closeAll("outside", event);
};

const handleDocumentScroll = (event: Event) => {
  const target = event.target;
  if (target instanceof Node && (mainRef.value?.contains(target) || submenuRef.value?.contains(target))) {
    // 面板内部滚动不关闭自身，仅收起已打开的二级菜单
    if (submenuState.value) closeSubmenu();
    return;
  }
  closeAll("scroll");
};

const handleWindowResize = () => closeAll("resize");

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!props.anchor || event.detail.handled) return;
  if (submenuState.value) {
    closeSubmenu(true);
    event.detail.handle();
    return;
  }
  event.detail.handle();
  closeAll("escape");
};

let stopAppEscapeListener = () => {};
const detachDocumentListeners = () => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("click", handleDocumentClick);
  document.removeEventListener("scroll", handleDocumentScroll, true);
  window.removeEventListener("resize", handleWindowResize);
};

watch(
  () => Boolean(props.anchor),
  (open) => {
    if (open) {
      document.addEventListener("pointerdown", handleDocumentPointerDown);
      document.addEventListener("click", handleDocumentClick);
      document.addEventListener("scroll", handleDocumentScroll, true);
      window.addEventListener("resize", handleWindowResize);
    } else {
      detachDocumentListeners();
    }
  },
);

onBeforeUnmount(() => {
  if (positionFrame) window.cancelAnimationFrame(positionFrame);
  clearSubmenuCloseTimer();
  detachDocumentListeners();
  stopAppEscapeListener();
});

stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);

const mainStyle = computed(() => ({
  left: `${mainLayout.value.left}px`,
  top: `${mainLayout.value.top}px`,
  minWidth: `${props.minWidth}px`,
  maxWidth: `min(${props.maxWidth}px, calc(100vw - 1rem))`,
  maxHeight: `${mainLayout.value.maxHeight}px`,
  transformOrigin: mainLayout.value.transformOrigin,
}));

const submenuStyle = computed(() => ({
  left: `${submenuLayout.value.left}px`,
  top: `${submenuLayout.value.top}px`,
  maxWidth: `min(${props.maxWidth}px, calc(100vw - 1rem))`,
  maxHeight: `${submenuLayout.value.maxHeight}px`,
}));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="anchor"
      ref="mainRef"
      class="menu-pop fixed z-[75] flex w-max flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-container-lowest p-1 shadow-popover"
      :style="mainStyle"
      role="menu"
      :aria-label="ariaLabel || undefined"
      @click.stop
      @contextmenu.prevent
      @keydown="handleMainKeydown"
      @pointermove="handleMainPointerMove"
      @focusin="handleMainFocusIn"
      @pointerenter="$emit('panelPointerEnter')"
      @pointerleave="$emit('panelPointerLeave')"
    >
      <div v-overlay-scrollbar class="themed-scrollbar min-h-0 flex-1 overflow-y-auto">
        <template v-for="(item, index) in items" :key="item.type === 'item' ? item.key : `separator-${index}`">
          <div v-if="item.type === 'separator'" class="mx-1 my-1 border-t border-border-subtle" role="separator" />
          <button
            v-else-if="!item.submenu"
            type="button"
            role="menuitem"
            class="ui-menu-item"
            :class="item.danger ? 'text-status-error' : ''"
            :data-item-key="item.key"
            :disabled="item.disabled"
            :title="item.title || undefined"
            @click="handleItemClick(item, $event)"
          >
            <img
              v-if="item.iconUrl"
              :src="item.iconUrl"
              alt=""
              class="h-4 w-4 shrink-0 object-contain"
            />
            <component
              :is="item.icon"
              v-else-if="item.icon"
              :size="item.iconSize ?? 12"
              class="shrink-0"
              :class="item.iconClass"
            />
            <span class="min-w-0 truncate">{{ item.label }}</span>
            <span
              v-if="item.trailing"
              class="ml-auto shrink-0 text-[11px] font-semibold tabular-nums text-on-surface-variant"
              :title="item.trailing.title || undefined"
            >
              {{ item.trailing.text }}
            </span>
            <Check v-if="item.checked" :size="12" class="shrink-0 text-primary" />
          </button>
          <div
            v-else
            role="menuitem"
            tabindex="0"
            class="ui-menu-item cursor-default"
            :data-item-key="item.key"
            aria-haspopup="menu"
            :aria-expanded="submenuState?.key === item.key"
            @pointerenter="openSubmenu(item, $event.currentTarget as HTMLElement, false)"
            @mouseenter="openSubmenu(item, $event.currentTarget as HTMLElement, false)"
            @click="handleItemClick(item, $event)"
            @keydown.enter.prevent.stop="handleItemKeyActivate(item, $event)"
            @keydown.space.prevent.stop="handleItemKeyActivate(item, $event)"
          >
            <component
              :is="item.icon"
              v-if="item.icon"
              :size="item.iconSize ?? 12"
              class="shrink-0"
              :class="item.iconClass"
            />
            <button
              v-if="item.meta"
              type="button"
              tabindex="-1"
              class="min-w-0 flex-1 truncate text-left font-mono"
              :title="item.meta.title || undefined"
              @click.stop="handleItemMetaActivate(item)"
            >
              {{ item.meta.text }}
            </button>
            <span v-else class="min-w-0 truncate">{{ item.label }}</span>
            <Check v-if="item.checked" :size="12" class="shrink-0 text-primary" />
            <ChevronRight v-else :size="12" class="ml-auto shrink-0 text-on-surface-variant" />
          </div>
        </template>
      </div>
    </div>
    <div
      v-if="submenuState"
      ref="submenuRef"
      class="menu-pop fixed z-[76] flex w-max flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-container-lowest p-1 shadow-popover"
      :style="submenuStyle"
      role="menu"
      :aria-label="activeSubmenuSpec?.label || undefined"
      @click.stop
      @contextmenu.prevent
      @keydown="handleSubmenuKeydown"
      @pointerenter="clearSubmenuCloseTimer"
    >
      <div v-overlay-scrollbar class="themed-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div
          v-if="submenuPlaceholder"
          class="px-3 py-2 text-xs text-on-surface-variant"
          role="status"
          :title="submenuPlaceholderTitle"
        >
          {{ submenuPlaceholder }}
        </div>
        <template v-else>
          <template v-for="(item, index) in submenuDisplayItems" :key="item.type === 'item' ? item.key : `submenu-separator-${index}`">
            <div v-if="item.type === 'separator'" class="mx-1 my-1 border-t border-border-subtle" role="separator" />
            <button
              v-else
              type="button"
              role="menuitem"
              class="ui-menu-item"
              :class="item.danger ? 'text-status-error' : ''"
              :data-item-key="item.key"
              :disabled="item.disabled"
              :title="item.title || undefined"
              @click="handleItemClick(item, $event)"
            >
              <img
                v-if="item.iconUrl"
                :src="item.iconUrl"
                alt=""
                class="h-4 w-4 shrink-0 object-contain"
              />
              <component
                :is="item.icon"
                v-else-if="item.icon"
                :size="item.iconSize ?? 12"
                class="shrink-0"
                :class="item.iconClass"
              />
              <span class="min-w-0 truncate">{{ item.label }}</span>
              <Check v-if="item.checked" :size="12" class="shrink-0 text-primary" />
            </button>
          </template>
        </template>
      </div>
      <template v-if="activeSubmenuSpec?.footer">
        <div class="mx-1 my-1 shrink-0 border-t border-border-subtle" role="separator" />
        <button
          v-if="activeSubmenuSpec.footer.type === 'item'"
          type="button"
          role="menuitem"
          class="ui-menu-item shrink-0"
          :data-item-key="activeSubmenuSpec.footer.key"
          :disabled="activeSubmenuSpec.footer.disabled"
          :title="activeSubmenuSpec.footer.title || undefined"
          @click="handleItemClick(activeSubmenuSpec.footer, $event)"
        >
          <component
            :is="activeSubmenuSpec.footer.icon"
            v-if="activeSubmenuSpec.footer.icon"
            :size="activeSubmenuSpec.footer.iconSize ?? 12"
            class="shrink-0"
            :class="activeSubmenuSpec.footer.iconClass"
          />
          <span class="min-w-0 truncate">{{ activeSubmenuSpec.footer.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
