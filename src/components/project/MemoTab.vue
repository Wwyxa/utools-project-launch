<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "highlight.js/styles/github-dark.css";
import { Bold, Check, CheckSquare, Code, Edit3, Link, List, Plus, Save, Trash2 } from "lucide-vue-next";
import { Project } from "../../types";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

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
let saveTimer: number | undefined;

const content = computed(() => store.memoContent[props.project.id] || "");
const projectTodos = computed(() => store.todos[props.project.id] || []);
const hasMemo = computed(() => content.value.trim().length > 0);

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("go", go);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdownLanguage);
hljs.registerLanguage("md", markdownLanguage);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const markdown = new MarkdownIt({
  breaks: true,
  linkify: true,
  html: false,
  highlight: (source, language) => {
    const normalizedLanguage = language === "sh" ? "bash" : language;
    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return `<pre class="hljs"><code>${hljs.highlight(source, { language: normalizedLanguage }).value}</code></pre>`;
    }
    return `<pre class="hljs"><code>${markdown.utils.escapeHtml(source)}</code></pre>`;
  },
});

const renderedMemo = computed(() => markdown.render(content.value));

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
  <div
    class="flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-lg border border-border-subtle bg-surface p-3 shadow-sm"
  >
    <section
      class="flex min-h-[10rem] max-h-[18rem] flex-none flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-container-low shadow-sm"
    >
      <div class="flex h-11 items-center justify-between gap-3 border-b border-border-subtle px-4">
        <h3 class="flex items-center gap-2 text-sm font-bold text-on-surface">
          <CheckSquare :size="16" class="text-primary" />
          {{ t.memo.taskList }}
        </h3>
        <span class="text-[10px] font-bold text-on-surface-variant">{{ projectTodos.length }}</span>
      </div>

      <form class="flex gap-2 border-b border-border-subtle bg-surface px-4 py-3" @submit.prevent="addTodo">
        <input
          v-model="newTodoText"
          class="min-w-0 flex-1 rounded border border-outline-variant/70 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none placeholder:text-on-surface-variant focus:border-primary focus:bg-surface-container-lowest"
          :placeholder="t.memo.addTask"
        />
        <button
          type="submit"
          class="flex h-9 items-center gap-1.5 rounded bg-primary px-3 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!newTodoText.trim()"
          :aria-label="t.memo.addTask"
          :title="t.memo.addTask"
        >
          <Plus :size="14" />
          {{ t.common.add }}
        </button>
      </form>

      <div class="themed-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div class="space-y-1">
          <label
            v-for="todo in projectTodos"
            :key="todo.id"
            class="group flex min-h-7 items-start gap-2.5 rounded px-2 py-1 hover:bg-surface-variant"
          >
            <input
              type="checkbox"
              :checked="todo.completed"
              @change="store.toggleTodo(project.id, todo.id)"
              class="mt-0.5 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
            />
            <span
              :class="
                cn(
                  'min-w-0 flex-1 text-sm font-medium leading-5 transition-colors',
                  todo.completed ? 'text-on-surface-variant line-through' : 'text-on-surface group-hover:text-primary',
                )
              "
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
          </label>
          <div v-if="projectTodos.length === 0" class="px-2 py-3 text-sm text-on-surface-variant">
            {{ t.memo.empty }}
          </div>
        </div>
      </div>
    </section>

    <section
      class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-container-low shadow-sm"
      @dblclick.self="enterEdit"
    >
      <div class="flex h-11 items-center justify-between gap-3 border-b border-border-subtle px-4">
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
