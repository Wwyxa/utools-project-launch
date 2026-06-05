<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Bold, Check, CheckSquare, Code, Edit3, GripVertical, Link, List, Plus, Save, Trash2 } from "lucide-vue-next";
import { Project } from "../../types";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { renderMarkdown } from "../../lib/markdown";

const props = defineProps<{
  project: Project;
  active?: boolean;
}>();

const store = useStore();
const t = useI18n();
const isEditing = ref(false);
const draftContent = ref(store.memoContent[props.project.id] || "");
const newTodoText = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const draggedTodoId = ref<string | null>(null);
let saveTimer: number | undefined;

const content = computed(() => store.memoContent[props.project.id] || "");
const projectTodos = computed(() => store.todos[props.project.id] || []);
const hasMemo = computed(() => content.value.trim().length > 0);

const renderedMemo = computed(() => renderMarkdown(content.value));

const flushMemo = () => {
  window.clearTimeout(saveTimer);
  if (draftContent.value !== content.value) {
    store.updateMemo(props.project.id, draftContent.value);
  }
};

const scheduleSave = () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushMemo, 500);
};

const enterEdit = () => {
  isEditing.value = true;
};

const exitEdit = () => {
  flushMemo();
  isEditing.value = false;
};

const addTodo = () => {
  const text = newTodoText.value.trim();
  if (!text) return;
  store.addTodo(props.project.id, text);
  newTodoText.value = "";
};

const deleteTodo = (todoId: string) => {
  store.deleteTodo(props.project.id, todoId);
};

const handleTodoDragStart = (event: DragEvent, todoId: string) => {
  draggedTodoId.value = todoId;
  event.dataTransfer?.setData("text/plain", todoId);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
};

const handleTodoDrop = (targetTodoId: string) => {
  const todoId = draggedTodoId.value;
  if (todoId) {
    store.reorderTodo(props.project.id, todoId, targetTodoId);
  }
  draggedTodoId.value = null;
};

const insertMarkdown = (before: string, after = "", fallback = "text") => {
  enterEdit();
  requestAnimationFrame(() => {
    const textarea = textareaRef.value;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = draftContent.value.slice(start, end) || fallback;
    draftContent.value = `${draftContent.value.slice(0, start)}${before}${selected}${after}${draftContent.value.slice(end)}`;
    scheduleSave();
    textarea.focus();
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
  });
};

const toolbarActions = [
  { icon: Bold, label: "Bold", run: () => insertMarkdown("**", "**", "bold") },
  { icon: Code, label: "Code", run: () => insertMarkdown("```\n", "\n```", "code") },
  { icon: List, label: "List", run: () => insertMarkdown("- ", "", "item") },
  { icon: Link, label: "Link", run: () => insertMarkdown("[", "](https://)", "link") },
];

watch(
  () => props.active,
  (active) => {
    if (!active && isEditing.value) {
      exitEdit();
    }
  },
);

watch(
  () => props.project.id,
  () => {
    flushMemo();
    draftContent.value = store.memoContent[props.project.id] || "";
    isEditing.value = false;
    newTodoText.value = "";
  },
);

onBeforeUnmount(flushMemo);
</script>

<template>
  <div class="grid h-full min-h-0 grid-cols-[minmax(12rem,0.64fr)_minmax(0,1.36fr)] gap-2 overflow-hidden">
    <section class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm">
      <div class="flex h-10 items-center justify-between gap-3 border-b border-border-subtle px-4">
        <h3 class="flex items-center gap-2 text-sm font-bold text-on-surface">
          <CheckSquare :size="16" class="text-primary" />
          {{ t.memo.taskList }}
        </h3>
        <span class="text-[10px] font-bold text-on-surface-variant">{{ projectTodos.length }}</span>
      </div>

      <form class="flex gap-1.5 border-b border-border-subtle px-2.5 py-2" @submit.prevent="addTodo">
        <input
          v-model="newTodoText"
          class="min-w-0 flex-1 rounded border border-transparent bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-none placeholder:text-on-surface-variant transition-colors hover:bg-surface-container-low focus:border-primary/70 focus:bg-surface-container-lowest dark:bg-surface-container-low dark:hover:bg-surface-container dark:focus:bg-surface-container-lowest"
          :placeholder="t.memo.addTask"
        />
        <button
          type="submit"
          class="flex h-8 w-8 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-35"
          :disabled="!newTodoText.trim()"
          :aria-label="t.memo.addTask"
          :title="t.memo.addTask"
        >
          <Plus :size="14" />
        </button>
      </form>

      <div class="themed-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        <div class="space-y-1">
          <div
            v-for="todo in projectTodos"
            :key="todo.id"
            @dragover.prevent
            @drop="handleTodoDrop(todo.id)"
            @dragend="draggedTodoId = null"
            :class="
              cn(
                'group flex min-h-7 items-start gap-1.5 rounded px-1 py-1 transition-colors hover:bg-surface-variant',
                draggedTodoId === todo.id && 'opacity-55 ring-1 ring-primary/30',
              )
            "
            :title="todo.text"
          >
            <button
              type="button"
              draggable="true"
              class="mt-0.5 hidden h-4 w-4 shrink-0 items-center justify-center rounded text-on-surface-variant/60 opacity-0 transition-opacity hover:bg-surface-container-high hover:text-primary group-hover:opacity-100 focus:opacity-100 sm:flex"
              :aria-label="t.memo.moveTask"
              :title="t.memo.moveTask"
              @dragstart="handleTodoDragStart($event, todo.id)"
              @dragend="draggedTodoId = null"
            >
              <GripVertical :size="13" />
            </button>
            <input
              type="checkbox"
              :checked="todo.completed"
              @change="store.toggleTodo(project.id, todo.id)"
              class="mt-0.5 h-3.5 w-3.5 rounded border-outline-variant text-primary focus:ring-primary"
            />
            <span
              :class="
                cn(
                  'line-clamp-2 min-w-0 flex-1 break-words text-xs font-medium leading-5 transition-colors',
                  todo.completed ? 'text-on-surface-variant line-through' : 'text-on-surface group-hover:text-primary',
                )
              "
              :title="todo.text"
            >
              {{ todo.text }}
            </span>
            <button
              type="button"
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-on-surface-variant opacity-0 transition-opacity hover:bg-status-error/10 hover:text-status-error group-hover:opacity-100 focus:opacity-100"
              :aria-label="t.common.delete"
              :title="t.common.delete"
              @click.prevent="deleteTodo(todo.id)"
            >
              <Trash2 :size="12" />
            </button>
          </div>
          <div
            v-if="projectTodos.length === 0"
            class="rounded border border-dashed border-border-subtle px-2 py-2 text-xs text-on-surface-variant"
          >
            {{ t.memo.empty }}
          </div>
        </div>
      </div>
    </section>

    <section
      class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm"
      @dblclick.self="enterEdit"
    >
      <div class="flex h-10 items-center justify-between gap-3 border-b border-border-subtle px-4">
        <div v-if="isEditing" class="flex items-center gap-1">
          <button
            v-for="action in toolbarActions"
            :key="action.label"
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
            :aria-label="action.label"
            :title="action.label"
            @click="action.run"
          >
            <component :is="action.icon" :size="15" />
          </button>
        </div>
        <div v-else class="text-sm font-bold text-on-surface">{{ t.memo.title }}</div>

        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1.5 text-[10px] font-bold text-on-surface-variant">
            <Save :size="12" />
            {{ t.memo.saved }}
          </div>
          <button
            v-if="isEditing"
            type="button"
            class="flex h-7 items-center gap-1.5 rounded border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface-variant hover:bg-surface-variant hover:text-primary"
            :aria-label="t.dashboard.doneSorting"
            :title="t.dashboard.doneSorting"
            @click="exitEdit"
          >
            <Check :size="14" />
            {{ t.dashboard.doneSorting }}
          </button>
          <button
            v-else
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded border border-border-subtle bg-surface text-on-surface-variant hover:bg-surface-variant hover:text-primary"
            :aria-label="t.common.edit"
            :title="t.common.edit"
            @click="enterEdit"
          >
            <Edit3 :size="14" />
          </button>
        </div>
      </div>

      <textarea
        v-if="isEditing"
        ref="textareaRef"
        v-model="draftContent"
        class="themed-scrollbar min-h-0 flex-1 resize-none bg-surface-container-lowest px-5 py-6 text-sm leading-relaxed text-on-surface outline-none"
        :placeholder="t.memo.placeholder"
        @input="scheduleSave"
      />
      <div
        v-else
        class="themed-scrollbar min-h-0 flex-1 overflow-y-auto bg-surface-container-lowest px-5 py-6 text-on-surface"
        @dblclick="enterEdit"
      >
        <div v-if="hasMemo" class="memo-rendered" v-html="renderedMemo" />
        <div v-else class="flex h-full items-center justify-center text-sm text-on-surface-variant">
          {{ t.memo.placeholder }}
        </div>
      </div>
    </section>
  </div>
</template>
