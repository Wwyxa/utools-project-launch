<script setup lang="ts">
import { computed } from "vue";
import VueMarkdown from "vue-markdown-render";
import { Bold, Italic, List, CheckSquare, Code, Save, Plus } from "lucide-vue-next";
import { Project } from "../../types";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const t = useI18n();
const content = computed(() => store.memoContent[props.project.id] || "");
const projectTodos = computed(() => store.todos[props.project.id] || []);

const handleAddTodo = () => {
  const text = prompt(t.value.memo.inputPrompt);
  if (text) {
    store.addTodo(props.project.id, text);
  }
};
</script>

<template>
  <div
    class="flex flex-col lg:flex-row border border-border-subtle rounded-xl bg-surface overflow-hidden shadow-sm h-[600px]"
  >
    <div class="flex-1 flex flex-col min-w-0">
      <div class="p-2 border-b border-border-subtle bg-bg-soft-gray flex items-center justify-between">
        <div class="flex items-center gap-1">
          <button
            v-for="Icon in [Bold, Italic, List, CheckSquare, Code]"
            :key="Icon.name"
            class="w-8 h-8 rounded hover:bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors"
          >
            <component :is="Icon" :size="16" />
          </button>
        </div>
        <div class="flex items-center gap-2 text-[10px] font-bold text-on-surface-variant pr-2">
          <Save :size="12" />
          {{ t.memo.saved }}
        </div>
      </div>

      <div class="flex-1 flex overflow-hidden">
        <textarea
          class="flex-1 p-6 font-sans text-sm resize-none outline-none border-r border-border-subtle bg-surface text-on-surface leading-relaxed scrollbar-hide"
          :value="content"
          @input="(event) => store.updateMemo(project.id, (event.target as HTMLTextAreaElement).value)"
          :placeholder="t.memo.placeholder"
        />
        <div class="flex-1 p-6 overflow-y-auto prose prose-sm prose-stone scrollbar-hide bg-surface-container-lowest">
          <VueMarkdown :source="content" />
        </div>
      </div>
    </div>

    <div class="w-full lg:w-[280px] bg-bg-soft-gray p-6 flex flex-col gap-6 overflow-y-auto">
      <h3 class="font-bold text-on-surface flex items-center gap-2">
        <CheckSquare :size="18" class="text-primary" />
        {{ t.memo.taskList }}
      </h3>

      <div class="space-y-3">
        <label v-for="todo in projectTodos" :key="todo.id" class="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            :checked="todo.completed"
            @change="store.toggleTodo(project.id, todo.id)"
            class="mt-1 rounded border-outline-variant text-primary focus:ring-primary h-4 w-4"
          />
          <span
            :class="
              cn(
                'text-sm font-medium transition-colors',
                todo.completed ? 'text-on-surface-variant line-through' : 'text-on-surface group-hover:text-primary',
              )
            "
          >
            {{ todo.text }}
          </span>
        </label>
        <div v-if="projectTodos.length === 0" class="text-sm text-on-surface-variant">{{ t.memo.empty }}</div>
      </div>

      <button
        @click="handleAddTodo"
        class="text-primary text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 hover:underline self-start"
      >
        <Plus :size="14" /> {{ t.memo.addTask }}
      </button>
    </div>
  </div>
</template>
