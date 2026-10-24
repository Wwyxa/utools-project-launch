<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Archive, CircleAlert, LoaderCircle, Trash2, Undo } from "lucide-vue-next";
import BaseModal from "./BaseModal.vue";
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
    /** 面板宽度（px），默认 24rem。 */
    width?: number;
  }>(),
  {
    tone: "danger",
    icon: "alert",
    detail: "",
    secondaryLabel: "",
    cancelLabel: "",
    busy: false,
    busyLabel: "",
    width: 384,
  },
);

const emit = defineEmits<{
  (event: "primary"): void;
  (event: "secondary"): void;
  (event: "cancel"): void;
}>();

const t = useI18n();
const showCancel = computed(() => props.tone === "danger" || Boolean(props.cancelLabel));
const skipLeaveTransition = ref(false);
let submitting = false;

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

const handleShellClose = () => cancel();

watch(
  () => props.open,
  (open) => {
    if (open) skipLeaveTransition.value = false;
  },
);
</script>

<template>
  <BaseModal
    :open="open"
    as="form"
    :width="width"
    :show-close="false"
    :can-close="!busy"
    :transition-css="!skipLeaveTransition"
    labelledby="action-dialog-title"
    @submit="submit('primary')"
    @close="handleShellClose"
  >
    <template #header>
      <div class="flex min-w-0 items-center gap-3">
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
    </template>
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
    <template #footer>
      <button
        v-if="showCancel"
        type="button"
        class="ui-btn ui-btn--ghost"
        :disabled="busy"
        @click="cancel"
      >
        {{ cancelLabel || t.common.cancel }}
      </button>
      <button
        v-if="secondaryLabel"
        type="button"
        class="ui-btn ui-btn--secondary"
        :disabled="busy"
        @click="submit('secondary')"
      >
        {{ secondaryLabel }}
      </button>
      <button
        type="submit"
        autofocus
        :class="
          cn(
            'ui-btn',
            tone === 'warning' ? 'ui-btn--primary' : 'ui-btn--danger',
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
    </template>
  </BaseModal>
</template>
