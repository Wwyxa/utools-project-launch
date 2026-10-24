<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-vue-next";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import { cn } from "../../lib/utils";

const props = defineProps<{
  /** ISO 日期（YYYY-MM-DD）；空字符串或 null 表示未选择。 */
  modelValue: string | null;
  /** 触发器的可访问名称。 */
  label: string;
  /** 未选择时展示的占位文案。 */
  placeholder: string;
  todayLabel: string;
  clearLabel: string;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
}>();

const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const pickerMonth = ref(new Date());
const position = ref({ left: 8, top: 8 });
let stopAppEscapeListener = () => {};
let positionFrame = 0;

const weekDayLabels = ["日", "一", "二", "三", "四", "五", "六"];

const parseDateValue = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const selectedValue = computed(() => props.modelValue || "");
const monthTitle = computed(() =>
  new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(pickerMonth.value),
);
const pickerDays = computed(() => {
  const year = pickerMonth.value.getFullYear();
  const month = pickerMonth.value.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(year, month, 1 - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    const value = formatDateValue(date);
    return {
      value,
      label: String(date.getDate()),
      isCurrentMonth: date.getMonth() === month,
      isToday: value === formatDateValue(new Date()),
      isSelected: value === selectedValue.value,
    };
  });
});

const positionPopover = () => {
  const trigger = triggerRef.value;
  const panel = popoverRef.value;
  if (!trigger || !panel) return;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const rect = trigger.getBoundingClientRect();
  const width = panel.offsetWidth || 216;
  const height = panel.offsetHeight || 292;
  const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
  const belowTop = rect.bottom + 6;
  const top = belowTop + height <= viewportHeight - 8 ? belowTop : Math.max(8, rect.top - height - 6);
  position.value = { left, top };
};

const schedulePosition = () => {
  void nextTick(() => {
    if (!isOpen.value) return;
    positionPopover();
    if (positionFrame) window.cancelAnimationFrame(positionFrame);
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = 0;
      if (isOpen.value) positionPopover();
    });
  });
};

const closePicker = () => {
  if (!isOpen.value) return;
  isOpen.value = false;
};

const togglePicker = () => {
  if (isOpen.value) {
    closePicker();
    return;
  }
  pickerMonth.value = parseDateValue(selectedValue.value) || new Date();
  isOpen.value = true;
  schedulePosition();
};

const shiftMonth = (offset: number) => {
  pickerMonth.value = new Date(pickerMonth.value.getFullYear(), pickerMonth.value.getMonth() + offset, 1);
};

const selectDay = (value: string) => {
  emit("update:modelValue", value);
  closePicker();
};

const selectToday = () => selectDay(formatDateValue(new Date()));
const clearValue = () => emit("update:modelValue", "");

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!isOpen.value) return;
  const target = event.target;
  if (target instanceof Node && (popoverRef.value?.contains(target) || triggerRef.value?.contains(target))) return;
  closePicker();
};

const handleDocumentScroll = (event: Event) => {
  if (!isOpen.value) return;
  const target = event.target;
  if (target instanceof Node && popoverRef.value?.contains(target)) return;
  positionPopover();
};

const handleWindowResize = () => {
  if (isOpen.value) positionPopover();
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (!isOpen.value || event.detail.handled) return;
  event.detail.handle();
  closePicker();
};

const detachListeners = () => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("scroll", handleDocumentScroll, true);
  window.removeEventListener("resize", handleWindowResize);
};

watch(isOpen, (open) => {
  if (open) {
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("scroll", handleDocumentScroll, true);
    window.addEventListener("resize", handleWindowResize);
    return;
  }
  detachListeners();
});

onBeforeUnmount(() => {
  if (positionFrame) window.cancelAnimationFrame(positionFrame);
  detachListeners();
  stopAppEscapeListener();
});

stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
</script>

<template>
  <button
    ref="triggerRef"
    type="button"
    class="ui-field ui-field-compact flex min-w-0 w-full items-center justify-between gap-0.5 px-1.5 text-left"
    :title="label"
    :aria-label="label"
    :aria-expanded="isOpen"
    @click.stop="togglePicker"
  >
    <span
      class="dark-readable-meta min-w-0 truncate whitespace-nowrap"
      :class="selectedValue ? 'text-on-surface' : 'text-on-surface-variant/70'"
      >{{ selectedValue || placeholder }}</span
    >
    <CalendarDays :size="13" class="text-on-surface-variant" />
  </button>
  <Teleport to="body">
    <div
      v-if="isOpen"
      ref="popoverRef"
      class="date-picker-popover flex max-h-[calc(100vh-1rem)] flex-col overflow-hidden"
      :style="{ left: `${position.left}px`, top: `${position.top}px`, maxHeight: 'calc(100vh - 1rem)' }"
      @click.stop
    >
      <div v-overlay-scrollbar class="themed-scrollbar min-h-0 overflow-y-auto">
        <div class="mb-2 flex items-center justify-between gap-2">
          <button type="button" class="popover-icon-button" title="上个月" aria-label="上个月" @click="shiftMonth(-1)">
            <ChevronLeft :size="14" />
          </button>
          <div class="text-xs font-bold text-on-surface">{{ monthTitle }}</div>
          <button type="button" class="popover-icon-button" title="下个月" aria-label="下个月" @click="shiftMonth(1)">
            <ChevronRight :size="14" />
          </button>
        </div>
        <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-on-surface-variant">
          <span v-for="label in weekDayLabels" :key="label">{{ label }}</span>
        </div>
        <div class="mt-1 grid grid-cols-7 gap-1">
          <button
            v-for="day in pickerDays"
            :key="day.value"
            type="button"
            :class="
              cn(
                'date-picker-day',
                !day.isCurrentMonth && 'text-on-surface-variant/35',
                day.isToday && !day.isSelected && 'border-primary/35 text-primary',
                day.isSelected && 'border-primary bg-primary text-on-primary',
              )
            "
            @click="selectDay(day.value)"
          >
            {{ day.label }}
          </button>
        </div>
        <div class="mt-2 flex items-center justify-between gap-2">
          <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" @click="selectToday">
            {{ todayLabel }}
          </button>
          <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" @click="clearValue">
            {{ clearLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
