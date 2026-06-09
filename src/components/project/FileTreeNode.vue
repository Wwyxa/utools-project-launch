<script setup lang="ts">
import { computed } from "vue";
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

const props = defineProps<{
  node: TreeNode;
  selectedRelativePath: string;
  depth?: number;
}>();

const emit = defineEmits<{
  (event: "toggle", node: TreeNode): void;
  (event: "open", node: TreeNode, edit?: boolean): void;
}>();

const normalizedRelativePath = (relativePath: string) => relativePath.replace(/\\/g, "/");

const isSelected = computed(
  () => normalizedRelativePath(props.selectedRelativePath) === normalizedRelativePath(props.node.relativePath),
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
</script>

<template>
  <div class="select-none">
    <button
      type="button"
      @click="handleClick"
      @dblclick="handleDoubleClick"
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
      <span v-if="node.loading" class="ml-auto shrink-0 text-[10px] text-on-surface-variant">...</span>
    </button>

    <div v-if="node.expanded" class="border-l border-border-subtle/70">
      <FileTreeNode
        v-for="child in node.children || []"
        :key="child.relativePath"
        :node="child"
        :selected-relative-path="selectedRelativePath"
        :depth="(depth || 0) + 1"
        @toggle="emit('toggle', $event)"
        @open="(childNode, edit) => emit('open', childNode, edit)"
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
