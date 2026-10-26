<script setup lang="ts">
import { nextTick, onUnmounted, ref, useId, watch } from "vue";
import { X } from "lucide-vue-next";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { isTopModalLayer, isTopUiLayer, pushUiLayer, removeUiLayer, type UiLayer } from "../../lib/uiLayers";
import { useI18n } from "../../lib/i18n";

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** 默认头部标题；传 #header 插槽时可留空。 */
    title?: string;
    ariaLabel?: string;
    /** 面板宽度（px，按 16px=1rem 还原为 rem 渲染以跟随系统字号缩放），实际渲染 min(width/16rem, maxViewport)。 */
    width?: number;
    /** 面板宽度视口上限（vw）。 */
    maxViewport?: number;
    /** 面板高度（CSS 值，如 "min(46rem,90vh)"）；缺省随内容 + max-height。 */
    height?: string;
    /** 正文滚动区类；缺省 px-4 py-3。 */
    bodyClass?: string;
    /** 正文滚动宿主的 aria-busy（长任务反馈透传）。 */
    bodyAriaBusy?: boolean;
    /** 点击遮罩是否触发 close。 */
    closeOnScrim?: boolean;
    /** 头部右侧关闭按钮。 */
    showClose?: boolean;
    /** 为 false 时屏蔽遮罩点击与 Escape 关闭（如提交中的确认弹窗）。 */
    canClose?: boolean;
    /** 是否启用 scale 过渡动画。 */
    transitionCss?: boolean;
    /** 指向自定义标题元素的 id（role=dialog 的 aria-labelledby）。 */
    labelledby?: string;
    /** 面板根元素标签；"form" 时 Enter 在表单控件内触发 submit 事件。 */
    as?: "div" | "form";
  }>(),
  {
    title: "",
    ariaLabel: "",
    width: 640,
    maxViewport: 92,
    height: "",
    bodyClass: "",
    bodyAriaBusy: false,
    closeOnScrim: true,
    showClose: true,
    canClose: true,
    transitionCss: true,
    labelledby: "",
    as: "div",
  },
);

const emit = defineEmits<{
  (event: "close"): void;
  (event: "submit"): void;
}>();

const t = useI18n();
const titleId = useId();
const scrimRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
let previousActiveElement: HTMLElement | null = null;

const layer: UiLayer = {
  kind: "modal",
  close: () => {
    if (!props.canClose) return false;
    emit("close");
    return true;
  },
};
let removeLayer: (() => void) | null = null;

const getPanelFocusableElements = () => {
  const panel = panelRef.value;
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
};

const handlePanelTabKey = (event: KeyboardEvent) => {
  if (!props.open || event.key !== "Tab") return;
  // 叠加弹窗时只有最上层 modal 拦截 Tab，避免焦点跳回底层弹窗
  if (!isTopModalLayer(layer)) return;
  const focusable = getPanelFocusableElements();
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeElement = document.activeElement;
  const isInside = activeElement instanceof Node && panelRef.value?.contains(activeElement);
  if (!isInside) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!props.open || event.detail.handled) return;
  // 上层浮层（如弹窗内打开的下拉）先响应 Escape
  if (!isTopUiLayer(layer)) return;
  if (!props.canClose) return;
  event.detail.handle();
  emit("close");
};

const handleScrimClick = () => {
  if (props.closeOnScrim && props.canClose) emit("close");
};

const requestClose = () => emit("close");

let stopAppEscapeListener: () => void = () => {};
const detachDocumentListener = () => {
  document.removeEventListener("keydown", handlePanelTabKey, true);
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      removeLayer = pushUiLayer(layer);
      document.addEventListener("keydown", handlePanelTabKey, true);
      void nextTick(() => {
        if (!props.open) return;
        const scrim = scrimRef.value;
        if (scrim) scrim.parentNode?.appendChild(scrim);
        const target = panelRef.value?.querySelector<HTMLElement>("[autofocus]:not([disabled])");
        (target || getPanelFocusableElements()[0])?.focus();
      });
      return;
    }
    detachDocumentListener();
    removeLayer?.();
    removeLayer = null;
    if (previousActiveElement?.isConnected) previousActiveElement.focus();
    previousActiveElement = null;
  },
  { immediate: true },
);

onUnmounted(() => {
  stopAppEscapeListener();
  detachDocumentListener();
  removeLayer?.();
  removeLayer = null;
});

stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
</script>

<template>
  <Teleport to="body">
    <Transition name="scale" :css="transitionCss">
      <div
        v-if="open"
        ref="scrimRef"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-scrim/40 p-5"
        @click.self="handleScrimClick"
      >
        <component
          :is="as"
          ref="panelRef"
          class="flex flex-col overflow-hidden rounded-lg border border-outline-variant/70 bg-surface text-on-surface shadow-2xl"
          :style="{
            width: `min(${width / 16}rem, ${maxViewport}vw)`,
            maxHeight: 'calc(100vh - 2.5rem)',
            ...(height ? { height } : {}),
          }"
          role="dialog"
          aria-modal="true"
          :aria-label="ariaLabel || title || undefined"
          :aria-labelledby="labelledby || (title && !ariaLabel ? titleId : undefined)"
          @submit.prevent="emit('submit')"
          @click.stop
        >
          <div
            v-if="title || $slots.header || showClose"
            class="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-4 py-3"
          >
            <slot name="header">
              <h3 :id="titleId" class="min-w-0 truncate text-sm font-bold text-on-surface">{{ title }}</h3>
            </slot>
            <button
              v-if="showClose"
              type="button"
              class="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
              :aria-label="t.common.close"
              @click="requestClose"
            >
              <X :size="14" />
            </button>
          </div>
          <div
            v-overlay-scrollbar
            class="themed-scrollbar min-h-0 flex-1 overflow-y-auto"
            :class="bodyClass || 'px-4 py-3'"
            :aria-busy="bodyAriaBusy || undefined"
          >
            <slot />
          </div>
          <div
            v-if="$slots.footer || $slots.footerLeft"
            class="flex shrink-0 items-center gap-2 border-t border-border-subtle px-4 py-3"
            :class="$slots.footerLeft ? 'justify-between' : 'justify-end'"
          >
            <slot name="footerLeft" />
            <div class="flex items-center justify-end gap-2">
              <slot name="footer" />
            </div>
          </div>
        </component>
      </div>
    </Transition>
  </Teleport>
</template>
