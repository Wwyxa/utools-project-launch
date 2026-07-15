<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  FileImage,
  Folder,
  Replace,
  ReplaceAll,
  Save,
  Search,
  X,
} from "lucide-vue-next";
import type { Project, ProjectFileReadResult, ProjectFileTreeEntry } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { highlightCode, isMarkdownFile, renderMarkdown } from "../../lib/markdown";
import { useResizableSplit } from "../../composables/useResizableSplit";
import FileTreeNode, { type TreeNode } from "./FileTreeNode.vue";

type SearchMatch = { start: number; end: number };

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
const splitContainerRef = ref<HTMLElement | null>(null);
const treePaneRef = ref<HTMLElement | null>(null);
const statusMessage = ref("");
const codeScrollRef = ref<HTMLDivElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const findInputRef = ref<HTMLInputElement | null>(null);
const replaceInputRef = ref<HTMLInputElement | null>(null);
const isFindOpen = ref(false);
const isReplaceOpen = ref(false);
const findQuery = ref("");
const replaceValue = ref("");
const activeMatchIndex = ref(0);
let rootLoadPromise: Promise<void> | null = null;

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
const canSearchCurrentFile = computed(() => selectedFile.value?.previewKind === "text");
const canReplaceCurrentFile = computed(() => selectedFile.value?.previewKind === "text" && canEdit.value);
const {
  bounds: splitBounds,
  firstSize,
  gridTemplateStyle,
  handleSeparatorKeydown,
  isResizing,
  separatorOrientation,
  startResize,
} = useResizableSplit({
  containerRef: splitContainerRef,
  firstPaneRef: treePaneRef,
  layoutKey: "files-main",
  orientation: "horizontal",
  defaultFirstRatio: 0.24,
  minFirstSize: 180,
  minSecondSize: 320,
});
const lineNumbers = computed(() =>
  draftContent.value
    .split("\n")
    .map((_, index) => index + 1)
    .join("\n"),
);
const editorLineCount = computed(() => Math.max(1, draftContent.value.split("\n").length));
const editorContentStyle = computed(() => ({ "--file-code-line-count": `${editorLineCount.value}` }));
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
const searchMatches = computed<SearchMatch[]>(() => {
  const query = findQuery.value;
  if (!query || !canSearchCurrentFile.value) return [];

  const matches: SearchMatch[] = [];
  let fromIndex = 0;
  while (fromIndex <= draftContent.value.length) {
    const start = draftContent.value.indexOf(query, fromIndex);
    if (start === -1) break;
    const end = start + query.length;
    matches.push({ start, end });
    fromIndex = end > start ? end : start + 1;
  }

  return matches;
});
const hasMatches = computed(() => searchMatches.value.length > 0);
const activeMatch = computed(() => (hasMatches.value ? searchMatches.value[activeMatchIndex.value] : null));
const matchStatusLabel = computed(() => {
  if (!findQuery.value) return "";
  if (!hasMatches.value) return t.value.files.noResults;
  return `${activeMatchIndex.value + 1}/${searchMatches.value.length}`;
});

const highlightedCodeSegments = () => {
  const matches = searchMatches.value;
  if (matches.length === 0) return renderedCode.value;

  const highlightedHtml = renderedCode.value;
  let output = "";
  let htmlIndex = 0;
  let sourceOffset = 0;
  let matchIndex = 0;
  let markOpen = false;

  const closeMarkIfDone = () => {
    while (matchIndex < matches.length && sourceOffset >= matches[matchIndex].end) {
      if (markOpen) {
        output += "</mark>";
        markOpen = false;
      }
      matchIndex += 1;
    }
  };

  const openMarkIfNeeded = () => {
    const match = matches[matchIndex];
    if (!match || markOpen || sourceOffset < match.start || sourceOffset >= match.end) return;
    const markClass =
      matchIndex === activeMatchIndex.value ? "file-search-match file-search-match-active" : "file-search-match";
    output += `<mark class="${markClass}">`;
    markOpen = true;
  };

  while (htmlIndex < highlightedHtml.length) {
    closeMarkIfDone();

    if (highlightedHtml[htmlIndex] === "<") {
      if (markOpen) {
        output += "</mark>";
        markOpen = false;
      }
      const tagEndIndex = highlightedHtml.indexOf(">", htmlIndex);
      if (tagEndIndex === -1) break;
      output += highlightedHtml.slice(htmlIndex, tagEndIndex + 1);
      htmlIndex = tagEndIndex + 1;
      continue;
    }

    openMarkIfNeeded();

    if (highlightedHtml[htmlIndex] === "&") {
      const entityEndIndex = highlightedHtml.indexOf(";", htmlIndex + 1);
      if (entityEndIndex !== -1) {
        output += highlightedHtml.slice(htmlIndex, entityEndIndex + 1);
        htmlIndex = entityEndIndex + 1;
        sourceOffset += 1;
        continue;
      }
    }

    output += highlightedHtml[htmlIndex];
    htmlIndex += 1;
    sourceOffset += 1;
  }

  if (markOpen) {
    output += "</mark>";
  }

  return output;
};
const highlightedCodeWithMatches = computed(highlightedCodeSegments);

const formatSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const loadChildren = async (node?: TreeNode) => {
  if (!node && rootLoadPromise) {
    await rootLoadPromise;
    return;
  }

  const relativePath = node?.relativePath || "";
  if (node) {
    node.loading = true;
  } else {
    isLoadingTree.value = true;
  }

  const load = async () => {
    const result = await store.listProjectFiles(props.project.id, relativePath);
    const entries = (result?.entries || []).map((entry: ProjectFileTreeEntry) => ({ ...entry }));
    if (node) {
      node.children = entries;
      node.loaded = true;
      node.expanded = true;
    } else {
      rootNodes.value = entries;
    }
  };

  if (!node) {
    rootLoadPromise = load();
  }

  try {
    await (node ? load() : rootLoadPromise);
  } finally {
    if (node) {
      node.loading = false;
    } else {
      isLoadingTree.value = false;
      rootLoadPromise = null;
    }
  }
};

const pathParts = (relativePath: string) => relativePath.replace(/\\/g, "/").split("/").filter(Boolean);

const normalizedRelativePath = (relativePath: string) => relativePath.replace(/\\/g, "/");

const findNode = (nodes: TreeNode[], relativePath: string) =>
  nodes.find((node) => normalizedRelativePath(node.relativePath) === normalizedRelativePath(relativePath));

const expandPathToFile = async (relativePath: string) => {
  const parts = pathParts(relativePath);
  if (rootNodes.value.length === 0) {
    await loadChildren();
  }
  if (parts.length <= 1) return;

  let currentNodes = rootNodes.value;
  const directoryParts = parts.slice(0, -1);
  for (let index = 0; index < directoryParts.length; index += 1) {
    const directoryPath = directoryParts.slice(0, index + 1).join("/");
    const directoryNode = findNode(currentNodes, directoryPath);
    if (!directoryNode || directoryNode.kind !== "directory") return;

    if (!directoryNode.loaded) {
      await loadChildren(directoryNode);
    } else {
      directoryNode.expanded = true;
    }
    currentNodes = directoryNode.children || [];
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
    resetFindState(false);
    if (result?.relativePath) {
      emit("opened", result.relativePath);
    }
  } finally {
    isLoadingFile.value = false;
  }
};

const openRelativePath = async (relativePath: string) => {
  const normalizedPath = normalizedRelativePath(relativePath.trim());
  if (!normalizedPath) return;
  isLoadingFile.value = true;
  statusMessage.value = "";
  try {
    await expandPathToFile(normalizedPath);
    const result = await store.readProjectFile(props.project.id, normalizedPath);
    selectedFile.value = result;
    draftContent.value = result?.content || "";
    isEditing.value = false;
    resetFindState(false);
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
    statusMessage.value = result
      ? t.value.files.savedAt.replace("{time}", new Date(result.savedAt).toLocaleTimeString())
      : t.value.files.saved;
  } finally {
    isSaving.value = false;
  }
};

const enterEdit = () => {
  if (canEdit.value) {
    isEditing.value = true;
    void nextTick(syncTextareaScroll);
  }
};

const exitEdit = () => {
  isEditing.value = false;
};

const resetFindState = (keepOpen: boolean) => {
  findQuery.value = "";
  replaceValue.value = "";
  activeMatchIndex.value = 0;
  isReplaceOpen.value = false;
  if (!keepOpen) {
    isFindOpen.value = false;
  }
};

const focusFindInput = () => {
  void nextTick(() => {
    findInputRef.value?.focus();
    findInputRef.value?.select();
  });
};

const focusReplaceControls = () => {
  void nextTick(() => {
    const input = findQuery.value ? replaceInputRef.value : findInputRef.value;
    input?.focus();
    input?.select();
  });
};

const openFind = () => {
  if (!canSearchCurrentFile.value) return;
  isFindOpen.value = true;
  focusFindInput();
};

const openReplace = () => {
  if (!canReplaceCurrentFile.value) return;
  if (!isEditing.value) {
    isEditing.value = true;
    void nextTick(syncTextareaScroll);
  }
  isFindOpen.value = true;
  isReplaceOpen.value = true;
  focusReplaceControls();
};

const closeFind = () => {
  resetFindState(false);
  textareaRef.value?.focus();
};

const setActiveMatchIndex = (index: number) => {
  const count = searchMatches.value.length;
  if (count === 0) {
    activeMatchIndex.value = 0;
    return;
  }
  activeMatchIndex.value = ((index % count) + count) % count;
};

const selectActiveMatchInTextarea = () => {
  const match = activeMatch.value;
  if (!match || !isEditing.value) return;
  void nextTick(() => {
    textareaRef.value?.setSelectionRange(match.start, match.end);
  });
};

const scrollActiveMatchIntoView = () => {
  const match = activeMatch.value;
  const scrollElement = codeScrollRef.value;
  if (!match || !scrollElement) return;

  const beforeMatch = draftContent.value.slice(0, match.start);
  const lineIndex = beforeMatch.split("\n").length - 1;
  const lineStart = beforeMatch.lastIndexOf("\n") + 1;
  const columnIndex = beforeMatch.slice(lineStart).replace(/\t/g, "  ").length;
  const computedStyle = window.getComputedStyle(scrollElement);
  const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 20;
  const characterWidth = (Number.parseFloat(computedStyle.fontSize) || 12) * 0.62;
  const targetTop = Math.max(0, lineIndex * lineHeight - scrollElement.clientHeight / 2 + lineHeight);
  const targetLeft = Math.max(0, columnIndex * characterWidth - scrollElement.clientWidth / 3);
  scrollElement.scrollTop = targetTop;
  scrollElement.scrollLeft = targetLeft;
  syncTextareaScroll();
};

const goToMatch = (direction: 1 | -1) => {
  if (!hasMatches.value) return;
  setActiveMatchIndex(activeMatchIndex.value + direction);
  void nextTick(() => {
    scrollActiveMatchIntoView();
    selectActiveMatchInTextarea();
    replaceInputRef.value?.focus();
  });
};

const replaceActiveMatch = () => {
  if (!canReplaceCurrentFile.value || !findQuery.value || !activeMatch.value) return;
  if (!isEditing.value) {
    isEditing.value = true;
  }

  const match = activeMatch.value;
  const nextSearchOffset = match.start + replaceValue.value.length;
  const nextContent = `${draftContent.value.slice(0, match.start)}${replaceValue.value}${draftContent.value.slice(
    match.end,
  )}`;
  draftContent.value = nextContent;
  const nextIndex = searchMatches.value.findIndex((nextMatch) => nextMatch.start >= nextSearchOffset);
  activeMatchIndex.value = searchMatches.value.length === 0 ? 0 : nextIndex === -1 ? 0 : nextIndex;
  void nextTick(() => {
    scrollActiveMatchIntoView();
    selectActiveMatchInTextarea();
  });
};

const replaceAllMatches = () => {
  if (!canReplaceCurrentFile.value || !findQuery.value || !hasMatches.value) return;
  if (!isEditing.value) {
    isEditing.value = true;
  }
  draftContent.value = draftContent.value.split(findQuery.value).join(replaceValue.value);
  activeMatchIndex.value = 0;
  void nextTick(syncTextareaScroll);
};

const handleFindKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter") {
    event.preventDefault();
    goToMatch(event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeFind();
  }
};

const handleReplaceKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter") {
    event.preventDefault();
    replaceActiveMatch();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeFind();
  }
};

const syncTextareaScroll = () => {
  const scrollElement = codeScrollRef.value;
  const textarea = textareaRef.value;
  if (!scrollElement || !textarea) return;
  textarea.scrollTop = scrollElement.scrollTop;
  textarea.scrollLeft = scrollElement.scrollLeft;
};

const syncCodeScrollFromTextarea = () => {
  const scrollElement = codeScrollRef.value;
  const textarea = textareaRef.value;
  if (!scrollElement || !textarea) return;
  scrollElement.scrollTop = textarea.scrollTop;
  scrollElement.scrollLeft = textarea.scrollLeft;
};

const handleCodeScroll = () => {
  syncTextareaScroll();
};

const handleKeydown = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "s") {
    if (isEditing.value || canSave.value) {
      event.preventDefault();
      void saveFile();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "f") {
    if (canSearchCurrentFile.value) {
      event.preventDefault();
      openFind();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "h") {
    if (canReplaceCurrentFile.value) {
      event.preventDefault();
      openReplace();
    }
  }
};

onMounted(() => {
  if (props.openRelativePath) {
    void openRelativePath(props.openRelativePath);
  } else {
    void loadChildren();
  }
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});

watch(
  () => props.openRelativePath,
  (relativePath) => {
    if (!relativePath) return;
    if (normalizedRelativePath(relativePath) === normalizedRelativePath(selectedRelativePath.value)) {
      emit("opened", selectedRelativePath.value);
      return;
    }
    void openRelativePath(relativePath);
  },
);

watch(searchMatches, (matches) => {
  if (matches.length === 0) {
    activeMatchIndex.value = 0;
    return;
  }
  if (activeMatchIndex.value >= matches.length) {
    activeMatchIndex.value = matches.length - 1;
  }
  void nextTick(scrollActiveMatchIntoView);
});
</script>

<template>
  <div
    ref="splitContainerRef"
    class="grid h-full min-h-0 overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm"
    :style="gridTemplateStyle"
  >
    <aside ref="treePaneRef" class="min-w-0 bg-surface-container-low">
      <div class="ui-panel-header">
        <div class="ui-panel-title">
          <Folder :size="14" class="text-primary" />
          <span class="truncate">{{ project.name }}</span>
        </div>
      </div>
      <div class="themed-scrollbar h-[calc(100%-2.25rem)] overflow-auto p-2 text-xs">
        <div v-if="isLoadingTree" class="space-y-1.5 p-1" aria-busy="true">
          <div
            v-for="row in 8"
            :key="row"
            :class="['flex items-center gap-1.5', row % 3 === 0 ? 'pl-6' : row % 3 === 1 ? 'pl-9' : 'pl-3']"
          >
            <span class="skeleton h-3.5 w-3.5" />
            <span
              :class="[
                'skeleton h-3',
                row % 4 === 0 ? 'w-28' : row % 4 === 1 ? 'w-20' : row % 4 === 2 ? 'w-32' : 'w-24',
              ]"
            />
          </div>
        </div>
        <FileTreeNode
          v-for="node in rootNodes"
          :key="node.relativePath"
          :node="node"
          :selected-relative-path="selectedRelativePath"
          @toggle="toggleDirectory"
          @open="openFile"
        />
        <div v-if="!isLoadingTree && rootNodes.length === 0" class="p-2 text-on-surface-variant">
          {{ t.files.noFiles }}
        </div>
      </div>
    </aside>

    <div
      role="separator"
      :aria-orientation="separatorOrientation"
      :aria-label="t.files.resizePanels"
      :aria-valuemin="Math.round(splitBounds.min)"
      :aria-valuemax="Math.round(splitBounds.max)"
      :aria-valuenow="Math.round(firstSize ?? 0)"
      tabindex="0"
      :class="
        cn(
          'group/split relative z-20 cursor-col-resize touch-none border-x border-border-subtle bg-surface outline-none',
          isResizing && 'bg-primary/10',
        )
      "
      @pointerdown="startResize"
      @keydown="handleSeparatorKeydown"
    >
      <span
        :class="
          cn(
            'absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-border-subtle transition-colors group-hover/split:bg-primary group-focus/split:bg-primary',
            isResizing && 'bg-primary',
          )
        "
      />
    </div>

    <section class="flex min-w-0 flex-1 flex-col">
      <div class="ui-panel-header">
        <div class="min-w-0 text-xs">
          <span class="truncate font-mono font-bold text-on-surface">{{
            selectedFile?.relativePath || t.files.noFileSelected
          }}</span>
          <span v-if="selectedFile" class="ml-2 text-on-surface-variant">{{ formatSize(selectedFile.size) }}</span>
          <span v-if="isDirty" class="ml-2 font-bold text-status-error">{{ t.files.unsaved }}</span>
          <span v-else-if="selectedFile" class="ml-2 text-on-surface-variant">{{
            statusMessage || (isEditing ? t.files.editing : t.files.readOnly)
          }}</span>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            @click="openFind"
            :disabled="!canSearchCurrentFile"
            class="flex h-7 w-7 items-center justify-center rounded border border-border-subtle bg-transparent text-on-surface-variant transition-colors hover:bg-surface hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            :aria-label="t.files.findInFile"
            :title="t.files.findInFile"
          >
            <Search :size="13" />
          </button>
          <button
            type="button"
            v-if="!isEditing"
            @click="enterEdit"
            :disabled="!canEdit"
            :class="
              cn(
                'flex h-7 w-16 items-center justify-center rounded border border-border-subtle bg-transparent px-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                'gap-1.5 text-on-surface-variant hover:bg-surface hover:text-primary',
              )
            "
            :aria-label="t.files.editFile"
            :title="t.files.editFile"
          >
            <Edit3 :size="13" />
            <span>{{ t.files.edit }}</span>
          </button>
          <button
            v-if="isEditing"
            type="button"
            @click="saveFile"
            :disabled="!canSave"
            :class="
              cn(
                'flex h-7 w-7 items-center justify-center rounded border border-border-subtle text-xs font-bold transition-colors disabled:cursor-not-allowed',
                canSave
                  ? 'bg-primary text-on-primary hover:bg-primary/90'
                  : 'bg-surface-container-low text-on-surface-variant opacity-60',
              )
            "
            :aria-label="t.files.saveFile"
            :title="t.files.saveFile"
          >
            <Save :size="13" />
          </button>
          <button
            v-if="isEditing"
            type="button"
            @click="exitEdit"
            class="flex h-7 w-16 items-center justify-center gap-1.5 rounded border border-border-subtle bg-surface px-2 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
            :aria-label="t.files.doneEditing"
            :title="t.files.doneEditing"
          >
            <Check :size="13" />
            {{ t.files.done }}
          </button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-container-lowest">
        <div
          v-if="isFindOpen && canSearchCurrentFile"
          class="file-find-widget"
          role="search"
          :aria-label="t.files.findReplaceAria"
        >
          <div class="flex min-w-0 items-center gap-1">
            <button
              v-if="canReplaceCurrentFile"
              type="button"
              class="file-find-icon-button h-7 w-6"
              :aria-label="t.files.toggleReplace"
              :title="t.files.toggleReplace"
              @click="isReplaceOpen ? (isReplaceOpen = false) : openReplace()"
            >
              <ChevronDown :size="14" :class="cn('transition-transform', !isReplaceOpen && '-rotate-90')" />
            </button>
            <span v-else class="w-6 shrink-0" />
            <div class="file-find-input-wrap">
              <Search :size="12" class="mr-1.5 shrink-0 text-on-surface-variant" />
              <input
                ref="findInputRef"
                v-model="findQuery"
                type="text"
                class="min-w-0 flex-1 bg-transparent text-xs text-on-surface outline-none placeholder:text-on-surface-variant"
                :placeholder="t.files.findPlaceholder"
                :aria-label="t.files.findInCurrentFile"
                @keydown="handleFindKeydown"
              />
              <span
                v-if="matchStatusLabel"
                class="ml-2 shrink-0 whitespace-nowrap font-mono text-[10px] text-on-surface-variant"
              >
                {{ matchStatusLabel }}
              </span>
            </div>
            <button
              type="button"
              class="file-find-icon-button h-7 w-7 disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!hasMatches"
              :aria-label="t.files.previousMatch"
              :title="t.files.previousMatch"
              @click="goToMatch(-1)"
            >
              <ChevronUp :size="14" />
            </button>
            <button
              type="button"
              class="file-find-icon-button h-7 w-7 disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!hasMatches"
              :aria-label="t.files.nextMatch"
              :title="t.files.nextMatch"
              @click="goToMatch(1)"
            >
              <ChevronDown :size="14" />
            </button>
            <button
              type="button"
              class="file-find-icon-button h-7 w-7 hover:text-on-surface"
              :aria-label="t.files.closeFind"
              :title="t.files.closeFind"
              @click="closeFind"
            >
              <X :size="14" />
            </button>
          </div>
          <div v-if="isReplaceOpen && canReplaceCurrentFile" class="flex min-w-0 items-center gap-1 pl-7">
            <input
              ref="replaceInputRef"
              v-model="replaceValue"
              type="text"
              class="h-7 min-w-0 flex-1 rounded border border-border-subtle bg-surface-container-low px-2 text-xs text-on-surface outline-none placeholder:text-on-surface-variant focus:border-primary focus:bg-surface-container-lowest"
              :placeholder="t.files.replacePlaceholder"
              :aria-label="t.files.replaceWith"
              @keydown="handleReplaceKeydown"
            />
            <button
              type="button"
              class="file-find-icon-button h-7 w-7 border border-border-subtle disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!hasMatches"
              :aria-label="t.files.replaceCurrentMatch"
              :title="t.files.replaceCurrentMatch"
              @click="replaceActiveMatch"
            >
              <Replace :size="13" />
            </button>
            <button
              type="button"
              class="file-find-icon-button h-7 w-7 border border-border-subtle disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!hasMatches"
              :aria-label="t.files.replaceAllMatches"
              :title="t.files.replaceAllMatches"
              @click="replaceAllMatches"
            >
              <ReplaceAll :size="13" />
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden">
          <div
            v-if="isLoadingFile"
            class="themed-scrollbar h-full overflow-auto bg-[var(--code-preview-bg)] px-2 py-3 font-mono text-xs leading-5"
            aria-busy="true"
          >
            <div v-for="row in 12" :key="row" class="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 px-2 py-0.5">
              <span class="skeleton h-2.5 w-6" />
              <span
                :class="[
                  'skeleton h-2.5',
                  row % 4 === 0 ? 'w-full' : row % 4 === 1 ? 'w-3/4' : row % 4 === 2 ? 'w-5/6' : 'w-2/3',
                ]"
              />
            </div>
          </div>
          <div
            v-else-if="!selectedFile"
            class="flex h-full items-center justify-center text-sm text-on-surface-variant"
          >
            {{ t.files.selectToPreview }}
          </div>
          <div
            v-else-if="selectedFile.previewKind === 'text' && isMarkdownPreview && !isEditing && !isFindOpen"
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
                'file-code-surface h-full overflow-hidden bg-[var(--code-preview-bg)] font-mono text-xs leading-5 [font-family:Consolas,\'JetBrains_Mono\',\'Fira_Code\',ui-monospace,SFMono-Regular,Menlo,Monaco,monospace]',
              )
            "
          >
            <div
              ref="codeScrollRef"
              class="themed-scrollbar file-code-scroll"
              :style="editorContentStyle"
              @scroll="handleCodeScroll"
            >
              <pre
                class="file-code-gutter select-none border-r border-[var(--code-preview-border)] bg-[var(--code-preview-gutter-bg)] px-2 py-4 text-right text-on-surface-variant/70"
                >{{ lineNumbers }}</pre
              >
              <div class="file-code-main">
                <pre
                  class="file-code-layer bg-[var(--code-preview-bg)] p-4 text-on-surface"
                ><code class="hljs" v-html="highlightedCodeWithMatches" /></pre>
                <textarea
                  v-if="isEditing"
                  ref="textareaRef"
                  v-model="draftContent"
                  class="file-code-textarea themed-scrollbar p-4 text-on-surface outline-none"
                  spellcheck="false"
                  wrap="off"
                  :aria-label="t.files.editFileContent"
                  @scroll="syncCodeScrollFromTextarea"
                  @dblclick="enterEdit"
                />
              </div>
            </div>
          </div>
          <div v-else-if="selectedFile.previewKind === 'image'" class="flex h-full items-center justify-center p-6">
            <img :src="selectedFile.dataUrl" :alt="selectedFile.name" class="max-h-full max-w-full object-contain" />
          </div>
          <div
            v-else
            class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-on-surface-variant"
          >
            <FileImage :size="28" />
            <span>{{ selectedFile.message || t.files.previewUnavailable }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
