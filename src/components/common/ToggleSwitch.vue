<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    /** sm 为密集表格用的迷你胶囊档。 */
    size?: "md" | "sm";
  }>(),
  {
    disabled: false,
    ariaLabel: "",
    size: "md",
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
}>();

const handleChange = (event: Event) => {
  emit("update:modelValue", (event.target as HTMLInputElement).checked);
};
</script>

<template>
  <span class="relative inline-flex shrink-0 items-center" :class="size === 'sm' ? 'h-3.5 w-6' : 'h-5 w-9'">
    <input
      type="checkbox"
      role="switch"
      class="peer sr-only"
      :checked="modelValue"
      :disabled="disabled"
      :aria-label="ariaLabel || undefined"
      @change="handleChange"
    />
    <span
      class="pointer-events-none absolute inset-0 rounded-full border transition-colors peer-checked:bg-primary/20 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50 peer-disabled:cursor-wait peer-disabled:opacity-50"
      :class="[
        size === 'sm' ? 'px-0.5' : '',
        modelValue ? 'border-primary' : 'peer-hover:border-outline-variant border-border-subtle bg-surface-container-high',
      ]"
    />
    <span
      class="pointer-events-none absolute rounded-full transition-[transform,background-color] peer-checked:bg-primary"
      :class="
        size === 'sm'
          ? ['left-0.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2', modelValue ? 'translate-x-3' : 'bg-on-surface-variant']
          : ['left-0.5 top-0.5 h-4 w-4', modelValue ? 'translate-x-4' : 'bg-surface-container-lowest shadow-sm']
      "
    />
  </span>
</template>
