<script setup lang="ts">
import VueMarkdown from 'vue-markdown-render';
import { Bold, Italic, List, CheckSquare, Code, Save, Plus, Trash2 } from 'lucide-vue-next';
import { Project } from '../../types';
import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';

const props = defineProps<{
  project: Project;
}>();

const store = useStore();
const content = store.memoContent[props.project.id] || '';
const projectTodos = store.todos[props.project.id] || [];

const handleAddTodo = () => {
  const text = prompt('Enter task:');
  if (text) store.addTodo(props.project.id, text);
};
</script>

<template>
  <div class="flex flex-col lg:flex-row border border-border-subtle rounded-xl bg-surface overflow-hidden shadow-sm h-[600px]">
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Toolbar -->
      <div class="p-2 border-b border-border-subtle bg-bg-soft-gray flex items-center justify-between">
        <div class="flex items-center gap-1">
          <button v-for="Icon in [Bold, Italic, List, CheckSquare, Code]" :key="Icon.name" class="w-8 h-8 rounded hover:bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors">
            <component :is="Icon" :size="16" />
          </button>
        </div>
        <div class="flex items-center gap-2 text-[10px] font-bold text-on-surface-variant pr-2">
          <span class="w-1.5 h-1.5 rounded-full bg-status-running animate-pulse" />
          Saved just now
        </div>
      </div>

      <!-- Editor -->
      <div class="flex-1 flex overflow-hidden">
        <textarea
          class="flex-1 p-6 font-sans text-sm resize-none outline-none border-r border-border-subtle bg-surface text-on-surface leading-relaxed scrollbar-hide"
          :value="content"
          @input="e => store.updateMemo(project.id, (e.target as HTMLTextAreaElement).value)"
          placeholder="Write release notes, feature specs, or meeting minutes..."
        />
        <div class="flex-1 p-6 overflow-y-auto prose prose-sm prose-stone scrollbar-hide bg-surface-container-lowest">
          <VueMarkdown :source="content" />
        </div>
      </div>
    </div>

    <!-- Task List Sidebar -->
    <div class="w-full lg:w-[260px] bg-bg-soft-gray p-6 flex flex-col gap-6 overflow-y-auto">
      <h3 class="font-bold text-on-surface flex items-center gap-2">
        <CheckSquare :size="18" class="text-primary" />
        Task List
      </h3>

      <div class="space-y-3">
        <label v-for="todo in projectTodos" :key="todo.id" class="flex items-start gap-3 cursor-pointer group">
          <input 
            type="checkbox" 
            :checked="todo.completed" 
            @change="store.toggleTodo(project.id, todo.id)"
            class="mt-1 rounded border-outline-variant text-primary focus:ring-primary h-4 w-4"
          />
          <span :class="cn(
            'text-sm font-medium transition-colors',
            todo.completed ? 'text-on-surface-variant line-through' : 'text-on-surface group-hover:text-primary'
          )">
            {{ todo.text }}
          </span>
        </label>
      </div>

      <button 
        @click="handleAddTodo"
        class="text-primary text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 hover:underline self-start"
      >
        <Plus :size="14" /> Add Task
      </button>
    </div>
  </div>
</template>
