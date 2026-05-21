<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Check, Edit3, FileImage, Folder, Save } from "lucide-vue-next";
import type { Project, ProjectFileReadResult, ProjectFileTreeEntry } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { highlightCode, isMarkdownFile, renderMarkdown } from "../../lib/markdown";
import FileTreeNode, { type TreeNode } from "./FileTreeNode.vue";

const props = defineProps<{
  project: Project;
  openRelativePath?: string;
}>();

const emit = defineEmits<{
  (e: "opened", relativePath: string): void;
}>();

const store = useStore();
const t = useI18n();
const rootNodes = ref<TreeNode[]>([]);
const selectedFile = ref<ProjectFileReadResult | null>(null);
const draftContent = ref("");
const isEditing = ref(false);
const isLoadingTree = ref(false);
const isLoadingFile = ref(false);
const isSaving = ref(false);
const treeWidth = ref(280);
const isResizing = ref(false);
const statusMessage = ref("");

const selectedRelativePath = computed(() => selectedFile.value?.relativePath || "");
const isMarkdownPreview = computed(() =>
  Boolean(
    selectedFile.value?.previewKind === "text" && isMarkdownFile(selectedFile.value.name, selectedFile.value.extension),
  ),
);
const isDirty = computed(
  () => selectedFile.value?.previewKind === "text" && draftContent.value !== (selectedFile.value.content || ""),
);
const canEdit = computed(() => Boolean(selectedFile.value?.editable));
const canSave = computed(() => canEdit.value && isDirty.value && !isSaving.value);
const treeStyle = computed(() => ({ width: `${treeWidth.value}px` }));
const lineNumbers = computed(() =>
  draftContent.value
    .split("\n")
    .map((_, index) => index + 1)
    .join("\n"),
);
const renderedMarkdown = computed(() => renderMarkdown(draftContent.value));
const previewLanguage = computed(() => {
  const extension = selectedFile.value?.extension.toLowerCase().replace(/^\./, "") || "";
  const name = selectedFile.value?.name.toLowerCase() || "";

  if (name === "dockerfile") return "dockerfile";

  switch (extension) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
    case "cts":
    case "mts":
      return "typescript";
    case "html":
    case "htm":
    case "vue":
    case "xml":
      return "xml";
    case "md":
    case "markdown":
      return "markdown";
    case "json":
      return "json";
    case "css":
      return "css";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
    case "bash":
      return "bash";
    case "sql":
      return "sql";
    case "ini":
      return "ini";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
      return "cpp";
    default:
      return "";
  }
});
const renderedCode = computed(() => highlightCode(draftContent.value, previewLanguage.value));

const formatSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const loadChildren = async (node?: TreeNode) => {
  const relativePath = node?.relativePath || "";
  if (node) {
    node.loading = true;
  } else {
    isLoadingTree.value = true;
  }

  try {
    const result = await store.listProjectFiles(props.project.id, relativePath);
    const entries = (result?.entries || []).map((entry: ProjectFileTreeEntry) => ({ ...entry }));
    if (node) {
      node.children = entries;
      node.loaded = true;
      node.expanded = true;
    } else {
      rootNodes.value = entries;
    }
  } finally {
    if (node) {
      node.loading = false;
    } else {
      isLoadingTree.value = false;
    }
  }
};

const toggleDirectory = async (node: TreeNode) => {
  if (node.kind !== "directory") return;
  if (node.loaded) {
    node.expanded = !node.expanded;
    return;
  }
  await loadChildren(node);
};

const openFile = async (node: TreeNode, edit = false) => {
  if (node.kind !== "file") {
    await toggleDirectory(node);
    return;
  }

  isLoadingFile.value = true;
  statusMessage.value = "";
  try {
    const result = await store.readProjectFile(props.project.id, node.relativePath);
    selectedFile.value = result;
    draftContent.value = result?.content || "";
    isEditing.value = Boolean(edit && result?.editable);
    if (result?.relativePath) {
      emit("opened", result.relativePath);
    }
  } finally {
    isLoadingFile.value = false;
  }
};

const openRelativePath = async (relativePath: string) => {
  const normalizedPath = relativePath.trim();
  if (!normalizedPath) return;
  isLoadingFile.value = true;
  statusMessage.value = "";
  try {
    const result = await store.readProjectFile(props.project.id, normalizedPath);
    selectedFile.value = result;
    draftContent.value = result?.content || "";
    isEditing.value = false;
    if (result?.relativePath) {
      emit("opened", result.relativePath);
    }
    await nextTick();
  } finally {
    isLoadingFile.value = false;
  }
};

const saveFile = async () => {
  if (!selectedFile.value || !canSave.value) return;
  isSaving.value = true;
  try {
    const result = await store.writeProjectFile(props.project.id, selectedFile.value.relativePath, draftContent.value);
    selectedFile.value = {
      ...selectedFile.value,
      content: draftContent.value,
      size: new Blob([draftContent.value]).size,
    };
    statusMessage.value = result ? `Saved ${new Date(result.savedAt).toLocaleTimeString()}` : "Saved";
  } finally {
    isSaving.value = false;
  }
};

const enterEdit = () => {
  if (canEdit.value) {
    isEditing.value = true;
  }
};

const exitEdit = () => {
  isEditing.value = false;
};

const handleKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveFile();
  }
};

const beginResize = (event: MouseEvent) => {
  isResizing.value = true;
  event.preventDefault();
};

const handleResize = (event: MouseEvent) => {
  if (!isResizing.value) return;
  treeWidth.value = Math.min(420, Math.max(220, event.clientX - 96));
};

const endResize = () => {
  isResizing.value = false;
};

onMounted(() => {
  void loadChildren();
  if (props.openRelativePath) {
    void openRelativePath(props.openRelativePath);
  }
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("mousemove", handleResize);
  window.addEventListener("mouseup", endResize);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("mousemove", handleResize);
  window.removeEventListener("mouseup", endResize);
});

watch(
  () => props.openRelativePath,
  (relativePath) => {
    if (relativePath && relativePath !== selectedRelativePath.value) {
      void openRelativePath(relativePath);
    }
  },
);
</script>

<template>
  <div class="h-full min-h-0 overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm">
    <div class="flex h-full min-w-0">
      <aside :style="treeStyle" class="min-w-[220px] shrink-0 border-r border-border-subtle bg-surface-container-low">
        <div class="flex h-9 items-center gap-2 border-b border-border-subtle px-3 text-xs font-bold text-on-surface">
          <Folder :size="14" class="text-primary" />
          <span class="truncate">{{ project.name }}</span>
        </div>
        <div class="themed-scrollbar h-[calc(100%-2.25rem)] overflow-auto p-2 text-xs">
          <div v-if="isLoadingTree" class="p-2 text-on-surface-variant">Loading...</div>
          <FileTreeNode
            v-for="node in rootNodes"
            :key="node.relativePath"
            :node="node"
            :selected-relative-path="selectedRelativePath"
            @toggle="toggleDirectory"
            @open="openFile"
          />
          <div v-if="!isLoadingTree && rootNodes.length === 0" class="p-2 text-on-surface-variant">No files.</div>
        </div>
      </aside>

      <div class="w-1 cursor-col-resize bg-border-subtle hover:bg-primary" @mousedown="beginResize" />

      <section class="flex min-w-0 flex-1 flex-col">
        <div
          class="flex h-9 items-center justify-between gap-3 border-b border-border-subtle bg-surface-container-low px-3"
        >
          <div class="min-w-0 text-xs">
            <span class="truncate font-mono font-bold text-on-surface">{{
              selectedFile?.relativePath || "No file selected"
            }}</span>
            <span v-if="selectedFile" class="ml-2 text-on-surface-variant">{{ formatSize(selectedFile.size) }}</span>
            <span v-if="isDirty" class="ml-2 font-bold text-status-error">Unsaved</span>
            <span v-else-if="selectedFile" class="ml-2 text-on-surface-variant">{{
              statusMessage || (isEditing ? "Editing" : "Read only")
            }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              v-if="!isEditing"
              @click="enterEdit"
              :disabled="!canEdit"
              :class="
                cn(
                  'flex h-7 items-center justify-center rounded border border-border-subtle bg-transparent px-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  'gap-1.5 text-on-surface-variant hover:bg-surface hover:text-primary',
                )
              "
              aria-label="Edit file"
              title="Edit file"
            >
              <Edit3 :size="13" />
              <span>Edit</span>
            </button>
            <button
              v-if="isEditing"
              type="button"
              @click="saveFile"
              :disabled="!canSave"
              :class="
                cn(
                  'flex h-7 items-center gap-1.5 rounded border border-border-subtle px-2 text-xs font-bold transition-colors disabled:cursor-not-allowed',
                  canSave
                    ? 'bg-primary text-on-primary hover:bg-primary/90'
                    : 'bg-surface-container-low text-on-surface-variant opacity-60',
                )
              "
              aria-label="Save file"
              title="Save file"
            >
              <Save :size="13" />
              Save
            </button>
            <button
              v-if="isEditing"
              type="button"
              @click="exitEdit"
              class="flex h-7 items-center gap-1.5 rounded border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
              aria-label="Done editing"
              title="Done editing"
            >
              <Check :size="13" />
              Done
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden bg-surface-container-lowest">
          <div v-if="isLoadingFile" class="p-6 text-sm text-on-surface-variant">Loading...</div>
          <div
            v-else-if="!selectedFile"
            class="flex h-full items-center justify-center text-sm text-on-surface-variant"
          >
            Select a file to preview.
          </div>
          <div
            v-else-if="selectedFile.previewKind === 'text' && isMarkdownPreview && !isEditing"
            class="h-full bg-surface-container-lowest"
          >
            <div
              class="memo-rendered themed-scrollbar h-full overflow-auto px-6 py-5 text-on-surface"
              v-html="renderedMarkdown"
            />
          </div>
          <div
            v-else-if="selectedFile.previewKind === 'text'"
            :class="
              cn(
                'grid h-full grid-cols-[3rem_minmax(0,1fr)] overflow-hidden bg-[var(--code-preview-bg)] font-mono text-xs leading-5 [font-family:Consolas,\'JetBrains_Mono\',\'Fira_Code\',ui-monospace,SFMono-Regular,Menlo,Monaco,monospace]',
              )
            "
          >
            <pre
              class="themed-scrollbar select-none overflow-hidden border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)] px-2 py-4 text-right text-on-surface-variant/70"
              >{{ lineNumbers }}</pre
            >
            <textarea
              v-if="isEditing"
              v-model="draftContent"
              class="themed-scrollbar h-full w-full resize-none bg-transparent p-4 text-on-surface outline-none"
              @dblclick="enterEdit"
            />
            <pre v-else class="themed-scrollbar min-w-0 overflow-auto bg-[var(--code-preview-bg)] p-4 text-on-surface">
              <code class="hljs" v-html="renderedCode" />
            </pre>
          </div>
          <div v-else-if="selectedFile.previewKind === 'image'" class="flex h-full items-center justify-center p-6">
            <img :src="selectedFile.dataUrl" :alt="selectedFile.name" class="max-h-full max-w-full object-contain" />
          </div>
          <div
            v-else
            class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-on-surface-variant"
          >
            <FileImage :size="28" />
            <span>{{ selectedFile.message || "Preview unavailable." }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
