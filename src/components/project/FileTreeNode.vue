<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  Binary,
  Braces,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileTerminal,
  Folder,
  Package,
} from "lucide-vue-next";
import { cn } from "../../lib/utils";
import type { ProjectFileTreeEntry } from "../../types";

export interface TreeNode extends ProjectFileTreeEntry {
  children?: TreeNode[];
  loaded?: boolean;
  expanded?: boolean;
  loading?: boolean;
}

export interface InlineTreeEdit {
  mode: "create" | "rename";
  kind: "file" | "directory";
  parentRelativePath: string;
  targetRelativePath?: string;
  value: string;
  error: string;
  busy: boolean;
}

const props = defineProps<{
  node: TreeNode;
  selectedRelativePath: string;
  focusedRelativePath: string;
  inlineEdit?: InlineTreeEdit | null;
  depth?: number;
}>();

const emit = defineEmits<{
  (event: "toggle", node: TreeNode): void;
  (event: "open", node: TreeNode, edit?: boolean): void;
  (event: "focus-node", node: TreeNode): void;
  (event: "context-menu", node: TreeNode, source: MouseEvent | KeyboardEvent): void;
  (event: "inline-input", value: string): void;
  (event: "inline-submit"): void;
  (event: "inline-cancel"): void;
}>();

const inlineInputRef = ref<HTMLInputElement | null>(null);

const normalizedRelativePath = (relativePath: string) => relativePath.replace(/\\/g, "/");

const isSelected = computed(
  () => normalizedRelativePath(props.selectedRelativePath) === normalizedRelativePath(props.node.relativePath),
);
const isFocused = computed(
  () => normalizedRelativePath(props.focusedRelativePath) === normalizedRelativePath(props.node.relativePath),
);
const isRenaming = computed(
  () =>
    props.inlineEdit?.mode === "rename" &&
    normalizedRelativePath(props.inlineEdit.targetRelativePath || "") ===
      normalizedRelativePath(props.node.relativePath),
);
const isCreatingInside = computed(
  () =>
    props.inlineEdit?.mode === "create" &&
    props.node.kind === "directory" &&
    normalizedRelativePath(props.inlineEdit.parentRelativePath) === normalizedRelativePath(props.node.relativePath),
);

const fileIcon = computed(() => {
  if (props.node.kind === "directory") {
    return Folder;
  }

  const extension = props.node.extension.toLowerCase().replace(/^\./, "");
  const name = props.node.name.toLowerCase();
  if (["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"].includes(name)) return Package;
  if (["json", "jsonc"].includes(extension)) return FileJson;
  if (["md", "markdown", "txt", "log"].includes(extension)) return FileText;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(extension)) return FileImage;
  if (["sh", "bash", "ps1", "bat", "cmd"].includes(extension)) return FileTerminal;
  if (["lock", "bin", "exe", "dll"].includes(extension)) return Binary;
  if (["css", "scss", "less", "html", "xml", "vue"].includes(extension)) return Braces;
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "go", "rs", "java", "c", "cpp", "h", "hpp"].includes(extension))
    return FileCode;
  return File;
});

const fileIconClass = computed(() => {
  if (props.node.kind === "directory") return "text-primary";
  const extension = props.node.extension.toLowerCase().replace(/^\./, "");
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(extension)) return "text-status-warning";
  if (["json", "jsonc", "css", "scss", "less"].includes(extension)) return "text-status-info";
  if (["js", "jsx", "ts", "tsx", "vue", "py", "go", "rs"].includes(extension)) return "text-primary";
  return "text-on-surface-variant";
});

const handleClick = () => {
  emit("focus-node", props.node);
  if (props.node.kind === "directory") {
    emit("toggle", props.node);
    return;
  }
  emit("open", props.node, false);
};

const handleDoubleClick = () => {
  if (props.node.kind === "directory") {
    emit("toggle", props.node);
    return;
  }
  emit("open", props.node, true);
};

const handleInlineKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter") {
    event.preventDefault();
    emit("inline-submit");
  } else if (event.key === "Escape") {
    event.preventDefault();
    emit("inline-cancel");
  }
};

watch([isRenaming, isCreatingInside], ([renaming, creating]) => {
  if (!renaming && !creating) return;
  void nextTick(() => {
    inlineInputRef.value?.focus();
    inlineInputRef.value?.select();
  });
});
</script>

<template>
  <div role="none" class="select-none">
    <button
      v-if="!isRenaming"
      type="button"
      role="treeitem"
      :aria-level="(depth || 0) + 1"
      :aria-expanded="node.kind === 'directory' ? Boolean(node.expanded) : undefined"
      :aria-selected="isSelected"
      :tabindex="isFocused ? 0 : -1"
      :data-tree-path="node.relativePath"
      @click="handleClick"
      @dblclick="handleDoubleClick"
      @focus="emit('focus-node', node)"
      @contextmenu.prevent="emit('context-menu', node, $event)"
      :class="
        cn(
          'relative flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left hover:bg-surface-variant',
          isSelected
            ? 'bg-primary/10 text-primary before:absolute before:left-0 before:top-1 before:h-5 before:w-0.5 before:rounded-full before:bg-primary'
            : 'text-on-surface',
        )
      "
      :style="{ paddingLeft: `${6 + (depth || 0) * 14}px` }"
    >
      <ChevronRight
        v-if="node.kind === 'directory'"
        :size="13"
        :class="cn('shrink-0 transition-transform', node.expanded ? 'rotate-90' : '')"
      />
      <span v-else class="w-[13px] shrink-0" />
      <component :is="fileIcon" :size="14" :class="cn('shrink-0', isSelected ? 'text-primary' : fileIconClass)" />
      <span class="truncate font-medium">{{ node.name }}</span>
      <span v-if="node.loading" class="ml-auto shrink-0 skeleton h-2.5 w-10" />
    </button>

    <div v-else class="px-1 py-0.5" :style="{ paddingLeft: `${6 + (depth || 0) * 14}px` }">
      <input
        ref="inlineInputRef"
        :value="inlineEdit?.value || ''"
        type="text"
        class="h-7 w-full rounded border border-primary bg-surface-container-lowest px-2 text-xs text-on-surface outline-none"
        :disabled="inlineEdit?.busy"
        :aria-label="node.name"
        @input="emit('inline-input', ($event.target as HTMLInputElement).value)"
        @keydown="handleInlineKeydown"
      />
      <p v-if="inlineEdit?.error" class="mt-1 break-words text-[10px] text-status-error">{{ inlineEdit.error }}</p>
    </div>

    <div v-if="node.expanded" role="group" class="border-l border-border-subtle/70">
      <div v-if="isCreatingInside" class="px-1 py-0.5" :style="{ paddingLeft: `${6 + ((depth || 0) + 1) * 14}px` }">
        <input
          ref="inlineInputRef"
          :value="inlineEdit?.value || ''"
          type="text"
          class="h-7 w-full rounded border border-primary bg-surface-container-lowest px-2 text-xs text-on-surface outline-none"
          :disabled="inlineEdit?.busy"
          :aria-label="inlineEdit?.kind === 'directory' ? 'New directory' : 'New file'"
          @input="emit('inline-input', ($event.target as HTMLInputElement).value)"
          @keydown="handleInlineKeydown"
        />
        <p v-if="inlineEdit?.error" class="mt-1 break-words text-[10px] text-status-error">{{ inlineEdit.error }}</p>
      </div>
      <FileTreeNode
        v-for="child in node.children || []"
        :key="child.relativePath"
        :node="child"
        :selected-relative-path="selectedRelativePath"
        :focused-relative-path="focusedRelativePath"
        :inline-edit="inlineEdit"
        :depth="(depth || 0) + 1"
        @toggle="emit('toggle', $event)"
        @open="(childNode, edit) => emit('open', childNode, edit)"
        @focus-node="emit('focus-node', $event)"
        @context-menu="(childNode, source) => emit('context-menu', childNode, source)"
        @inline-input="emit('inline-input', $event)"
        @inline-submit="emit('inline-submit')"
        @inline-cancel="emit('inline-cancel')"
      />
      <div
        v-if="node.loaded && (node.children || []).length === 0"
        class="px-3 py-1 text-[11px] text-on-surface-variant"
      >
        Empty
      </div>
    </div>
  </div>
</template>
