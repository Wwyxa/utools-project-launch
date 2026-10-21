<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Archive, CircleAlert, LoaderCircle, Trash2, Undo } from "lucide-vue-next";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";

const props = withDefaults(
  defineProps<{
    open: boolean;
    tone?: "danger" | "warning";
    icon?: "alert" | "trash" | "undo" | "archive";
    title: string;
    message: string;
    detail?: string;
    primaryLabel: string;
    secondaryLabel?: string;
    cancelLabel?: string;
    busy?: boolean;
    busyLabel?: string;
  }>(),
  {
    tone: "danger",
    icon: "alert",
    detail: "",
    secondaryLabel: "",
    cancelLabel: "",
    busy: false,
    busyLabel: "",
  },
);

const emit = defineEmits<{
  (event: "primary"): void;
  (event: "secondary"): void;
  (event: "cancel"): void;
}>();

const t = useI18n();
const showCancel = computed(() => props.tone === "danger" || Boolean(props.cancelLabel));
const primaryButtonRef = ref<HTMLButtonElement | null>(null);
const dialogRef = ref<HTMLFormElement | null>(null);
const skipLeaveTransition = ref(false);
let submitting = false;
let previousActiveElement: HTMLElement | null = null;

const submit = (action: "primary" | "secondary") => {
  if (props.busy || submitting) return;
  submitting = true;
  skipLeaveTransition.value = true;
  if (action === "primary") emit("primary");
  else emit("secondary");
  void nextTick(() => { submitting = false; });
};

const cancel = () => {
  if (!props.busy) emit("cancel");
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!props.open || props.busy || event.detail.handled) return;
  cancel();
  event.detail.handle();
};

const getDialogFocusableElements = () => {
  const dialog = dialogRef.value;
  if (!dialog) return [];
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
};

const handleDialogTabKey = (event: KeyboardEvent) => {
  if (!props.open || event.key !== "Tab") return;
  const focusable = getDialogFocusableElements();
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeElement = document.activeElement;
  const isInside = activeElement instanceof Node && dialogRef.value?.contains(activeElement);
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

let stopAppEscapeListener: () => void = () => {};
onMounted(() => {
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});
onUnmounted(() => {
  stopAppEscapeListener();
  document.removeEventListener("keydown", handleDialogTabKey, true);
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      skipLeaveTransition.value = false;
      previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.addEventListener("keydown", handleDialogTabKey, true);
      void nextTick(() => {
        const target = dialogRef.value?.querySelector<HTMLElement>("[autofocus]:not([disabled])");
        (target || primaryButtonRef.value)?.focus();
      });
      return;
    }
    document.removeEventListener("keydown", handleDialogTabKey, true);
    if (previousActiveElement?.isConnected) previousActiveElement.focus();
    previousActiveElement = null;
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="scale" :css="!skipLeaveTransition">
      <div
        v-if="open"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-scrim/40 p-5"
        @click.self="cancel"
      >
        <form
          ref="dialogRef"
          class="flex max-h-[calc(100vh-2.5rem)] w-[min(24rem,92vw)] flex-col overflow-hidden rounded-lg border border-outline-variant/70 bg-surface text-on-surface shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="action-dialog-title"
          @submit.prevent="submit('primary')"
          @click.stop
        >
          <div class="shrink-0 border-b border-border-subtle bg-surface-container-low px-4 py-3">
            <div class="flex items-center gap-3">
              <div
                :class="
                  cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                    tone === 'warning'
                      ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                      : 'border-status-error/30 bg-status-error/10 text-status-error',
                  )
                "
              >
                <CircleAlert v-if="icon === 'alert'" :size="16" />
                <Trash2 v-else-if="icon === 'trash'" :size="16" />
                <Archive v-else-if="icon === 'archive'" :size="16" />
                <Undo v-else :size="16" />
              </div>
              <h3 id="action-dialog-title" class="min-w-0 text-sm font-bold text-on-surface">{{ title }}</h3>
            </div>
          </div>
          <div v-overlay-scrollbar class="themed-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p class="text-xs leading-5 text-on-surface-variant">{{ message }}</p>
            <p
              v-if="detail"
              class="mt-3 whitespace-pre-wrap break-words rounded border border-border-subtle bg-surface-container-low px-2 py-2 font-mono text-[11px] font-bold text-on-surface-variant"
            >
              {{ detail }}
            </p>
            <div v-if="$slots.default" class="mt-3 space-y-3">
              <slot />
            </div>
          </div>
          <div class="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-4 py-3">
            <button
              v-if="showCancel"
              type="button"
              class="inline-flex h-8 items-center rounded-lg border border-border-subtle bg-transparent px-3 text-xs font-bold text-on-surface-variant ui-press hover:bg-surface-variant hover:text-on-surface disabled:cursor-wait disabled:opacity-60"
              :disabled="busy"
              @click="cancel"
            >
              {{ cancelLabel || t.common.cancel }}
            </button>
            <button
              v-if="secondaryLabel"
              type="button"
              class="inline-flex h-8 items-center rounded-lg border border-border-subtle bg-surface px-3 text-xs font-bold text-on-surface-variant ui-press hover:bg-surface-variant hover:text-on-surface disabled:cursor-wait disabled:opacity-60"
              :disabled="busy"
              @click="submit('secondary')"
            >
              {{ secondaryLabel }}
            </button>
            <button
              ref="primaryButtonRef"
              type="submit"
              :class="
                cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold ui-press disabled:cursor-wait disabled:opacity-70',
                  tone === 'warning'
                    ? 'border-primary/30 bg-primary text-on-primary hover:bg-primary/90'
                    : 'border-status-error/30 bg-status-error text-on-error hover:bg-status-error/90',
                )
              "
              :disabled="busy"
              :aria-busy="busy"
            >
              <LoaderCircle v-if="busy" :size="13" class="animate-spin" />
              <Trash2 v-else-if="icon === 'trash'" :size="13" />
              <Undo v-else-if="icon === 'undo'" :size="13" />
              <Archive v-else-if="icon === 'archive'" :size="13" />
              {{ busy ? busyLabel || primaryLabel : primaryLabel }}
            </button>
          </div>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>
