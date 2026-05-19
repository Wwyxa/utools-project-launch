<script setup lang="ts">
import { ChevronRight, File, Folder } from "lucide-vue-next";
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
          selectedRelativePath === node.relativePath
            ? 'bg-white/[0.08] text-primary before:absolute before:left-0 before:top-1 before:h-5 before:w-0.5 before:rounded-full before:bg-primary'
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
      <Folder v-if="node.kind === 'directory'" :size="14" class="shrink-0 text-primary" />
      <File
        v-else
        :size="14"
        :class="cn('shrink-0', selectedRelativePath === node.relativePath ? 'text-primary' : 'text-on-surface-variant')"
      />
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
