<script setup lang="ts">
import { computed, type Component } from "vue";
import {
  Binary,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileTerminal,
  Braces,
  Folder,
  Package,
} from "lucide-vue-next";
import { resolveFileIcon, type FileIconFallbackKey } from "../../lib/fileIconTheme";
import { useStore } from "../../store/useStore";
import type { IconPackFallbackPolicy } from "../../types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    name: string;
    path: string;
    kind: "file" | "directory";
    expanded?: boolean;
    fallbackPolicy?: IconPackFallbackPolicy;
  }>(),
  { expanded: false, fallbackPolicy: "lucide" },
);

const store = useStore();
const fallbackComponents: Record<FileIconFallbackKey, Component> = {
  file: File,
  folder: Folder,
  package: Package,
  json: FileJson,
  text: FileText,
  image: FileImage,
  terminal: FileTerminal,
  binary: Binary,
  braces: Braces,
  code: FileCode,
};

const resolution = computed(() =>
  resolveFileIcon(store.activeIconPack, {
    name: props.name,
    path: props.path,
    kind: props.kind,
    expanded: props.expanded,
    colorMode: store.iconPackColorMode,
  }),
);
const shouldRender = computed(
  () => resolution.value.kind === "external" || props.fallbackPolicy === "lucide" || Boolean(store.activeIconPack),
);
</script>

<template>
  <span v-if="shouldRender" v-bind="$attrs" class="inline-flex h-4 w-4 shrink-0 items-center justify-center">
    <img
      v-if="resolution.kind === 'external'"
      :src="resolution.src"
      alt=""
      aria-hidden="true"
      class="h-4 w-4 object-contain"
      draggable="false"
    />
    <component :is="fallbackComponents[resolution.fallbackKey]" v-else :size="14" aria-hidden="true" class="shrink-0" />
  </span>
</template>
