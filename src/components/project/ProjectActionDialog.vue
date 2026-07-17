<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { CircleAlert, Undo } from "lucide-vue-next";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";

const props = withDefaults(
  defineProps<{
    open: boolean;
    tone?: "danger" | "warning";
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
let previousActiveElement: HTMLElement | null = null;

const cancel = () => {
  if (!props.busy) emit("cancel");
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!props.open || props.busy || event.detail.handled) return;
  cancel();
  event.detail.handle();
};

let stopAppEscapeListener = () => undefined;
onMounted(() => {
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
});
onUnmounted(() => {
  stopAppEscapeListener();
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void nextTick(() => primaryButtonRef.value?.focus());
      return;
    }
    if (previousActiveElement?.isConnected) previousActiveElement.focus();
    previousActiveElement = null;
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="scale">
      <div
        v-if="open"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-scrim/35 p-5 backdrop-blur-sm"
        @click.self="cancel"
      >
        <div
          class="w-[min(24rem,92vw)] overflow-hidden rounded-lg border border-outline-variant/70 bg-surface text-on-surface shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-action-dialog-title"
          @click.stop
        >
          <div class="border-b border-border-subtle bg-surface-container-low px-4 py-3">
            <div class="flex items-start gap-3">
              <div
                :class="
                  cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                    tone === 'warning'
                      ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                      : 'border-status-error/30 bg-status-error/10 text-status-error',
                  )
                "
              >
                <CircleAlert v-if="tone === 'warning'" :size="16" />
                <Undo v-else :size="16" />
              </div>
              <div class="min-w-0">
                <h3 id="project-action-dialog-title" class="text-sm font-bold text-on-surface">{{ title }}</h3>
                <p class="mt-1 text-xs leading-5 text-on-surface-variant">{{ message }}</p>
              </div>
            </div>
          </div>
          <div class="px-4 py-3">
            <p
              v-if="detail"
              class="break-all rounded border border-border-subtle bg-surface-container-low px-2 py-2 font-mono text-[11px] font-bold text-on-surface-variant"
            >
              {{ detail }}
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button
                v-if="showCancel"
                type="button"
                class="inline-flex h-8 items-center rounded-lg border border-border-subtle bg-transparent px-3 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-wait disabled:opacity-60"
                :disabled="busy"
                @click="cancel"
              >
                {{ cancelLabel || t.common.cancel }}
              </button>
              <button
                v-if="secondaryLabel"
                type="button"
                class="inline-flex h-8 items-center rounded-lg border border-border-subtle bg-surface px-3 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-wait disabled:opacity-60"
                :disabled="busy"
                @click="emit('secondary')"
              >
                {{ secondaryLabel }}
              </button>
              <button
                ref="primaryButtonRef"
                type="button"
                :class="
                  cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors disabled:cursor-wait disabled:opacity-70',
                    tone === 'warning'
                      ? 'border-primary/30 bg-primary text-on-primary hover:bg-primary/90'
                      : 'border-status-error/30 bg-status-error text-on-error hover:bg-status-error/90',
                  )
                "
                :disabled="busy"
                @click="emit('primary')"
              >
                <Undo v-if="tone === 'danger'" :size="13" />
                {{ busy ? busyLabel || primaryLabel : primaryLabel }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
