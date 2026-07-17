<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  FileImage,
  Filter,
  FilePlus2,
  Folder,
  FolderPlus,
  ListCollapse,
  LocateFixed,
  Pencil,
  Copy,
  RefreshCw,
  Replace,
  ReplaceAll,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-vue-next";
import type { Project, ProjectFileReadResult, ProjectFileTreeEntry } from "../../types";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import {
  collectMarkdownImageSources,
  highlightCode,
  isMarkdownFile,
  renderMarkdown,
  type MarkdownImageResolution,
} from "../../lib/markdown";
import { classifyProjectMarkdownImageSource } from "../../lib/projectMarkdown";
import { useResizableSplit } from "../../composables/useResizableSplit";
import { addAppEscapeRequestListener, type AppEscapeRequestEvent } from "../../lib/escape";
import FileTreeNode, { type InlineTreeEdit, type TreeNode } from "./FileTreeNode.vue";
import ProjectActionDialog from "./ProjectActionDialog.vue";

type SearchMatch = { start: number; end: number };
type MarkdownAssetState = { status: "loading" | "failed" | "ready"; dataUrl?: string };

const props = defineProps<{
  project: Project;
  openRelativePath?: string;
}>();

const emit = defineEmits<{
  (e: "opened", relativePath: string): void;
  (e: "open-canceled", relativePath: string): void;
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
const treeRef = ref<HTMLElement | null>(null);
const filterInputRef = ref<HTMLInputElement | null>(null);
const rootInlineInputRef = ref<HTMLInputElement | null>(null);
const contextMenuRef = ref<HTMLElement | null>(null);
const isFindOpen = ref(false);
const isReplaceOpen = ref(false);
const findQuery = ref("");
const replaceValue = ref("");
const activeMatchIndex = ref(0);
const focusedRelativePath = ref("");
const selectedNodeRelativePath = ref("");
const isFilterOpen = ref(false);
const filterQuery = ref("");
const filterResults = ref<ProjectFileTreeEntry[]>([]);
const isFiltering = ref(false);
const filterTruncated = ref(false);
const inlineEdit = ref<InlineTreeEdit | null>(null);
const contextMenu = ref<{
  node: TreeNode;
  x: number;
  y: number;
  previousSelectedPath: string;
  previousFocusedPath: string;
} | null>(null);
const actionDialog = ref<"dirty" | "delete" | null>(null);
const deleteTarget = ref<TreeNode | null>(null);
const isActionRunning = ref(false);
const actionDialogError = ref("");
const markdownAssets = ref<Record<string, MarkdownAssetState>>({});
let rootLoadPromise: Promise<void> | null = null;
let markdownAssetGeneration = 0;
let filterRequestId = 0;
let filterTimer: number | undefined;
let pendingContinuation: (() => Promise<void> | void) | null = null;
let pendingCanceledPath = "";
let pendingCancelRestore: { selectedPath: string; focusedPath: string } | null = null;
let stopAppEscapeListener = () => undefined;

const selectedRelativePath = computed(() => selectedFile.value?.relativePath || "");
const visibleNodes = computed(() => {
  const entries: TreeNode[] = [];
  const appendVisible = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      entries.push(node);
      if (node.kind === "directory" && node.expanded) appendVisible(node.children || []);
    }
  };
  appendVisible(rootNodes.value);
  return entries;
});
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
const contextMenuStyle = computed(() => ({
  left: `${contextMenu.value?.x || 0}px`,
  top: `${contextMenu.value?.y || 0}px`,
}));
const actionDialogTitle = computed(() =>
  actionDialog.value === "dirty" ? t.value.files.unsavedTitle : t.value.files.deleteTitle,
);
const actionDialogMessage = computed(() => {
  if (actionDialogError.value) return actionDialogError.value;
  if (actionDialog.value === "dirty") return t.value.files.unsavedMessage;
  if (deleteTarget.value?.kind === "directory") {
    return t.value.files.deleteDirectoryMessage.replace("{name}", deleteTarget.value.name);
  }
  return t.value.files.deleteFileMessage.replace("{name}", deleteTarget.value?.name || "");
});
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
const resolveMarkdownImage = (source: string): MarkdownImageResolution | undefined => {
  const classification = classifyProjectMarkdownImageSource(source, selectedRelativePath.value);
  if (classification.kind === "external") return undefined;
  if (classification.kind === "blocked") {
    return { status: "blocked", message: t.value.files.localImageBlocked };
  }

  const asset = markdownAssets.value[classification.relativePath];
  if (!asset || asset.status === "loading") {
    return { status: "loading", message: t.value.files.localImageLoading };
  }
  if (asset.status === "ready" && asset.dataUrl) {
    return { status: "ready", src: asset.dataUrl };
  }
  return { status: "failed", message: t.value.files.localImageUnavailable };
};
const renderedMarkdown = computed(() =>
  renderMarkdown(draftContent.value, {
    resolveImage: resolveMarkdownImage,
    imageFallbackText: t.value.files.localImageUnavailable,
  }),
);
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

const loadMarkdownAssets = async () => {
  const generation = ++markdownAssetGeneration;
  if (!isMarkdownPreview.value || isEditing.value || !selectedRelativePath.value) {
    markdownAssets.value = {};
    return;
  }

  const relativePaths = Array.from(
    new Set(
      collectMarkdownImageSources(draftContent.value)
        .map((source) => classifyProjectMarkdownImageSource(source, selectedRelativePath.value))
        .filter((result) => result.kind === "local")
        .map((result) => result.relativePath),
    ),
  );
  const previousAssets = markdownAssets.value;
  markdownAssets.value = Object.fromEntries(
    relativePaths.map((relativePath) => [
      relativePath,
      previousAssets[relativePath]?.status === "ready" ? previousAssets[relativePath] : { status: "loading" },
    ]),
  );

  const pendingPaths = relativePaths.filter((relativePath) => markdownAssets.value[relativePath]?.status !== "ready");
  let pendingIndex = 0;
  const worker = async () => {
    while (pendingIndex < pendingPaths.length) {
      const relativePath = pendingPaths[pendingIndex];
      pendingIndex += 1;
      let nextState: MarkdownAssetState = { status: "failed" };
      try {
        const result = await store.readProjectFile(props.project.id, relativePath);
        if (result?.previewKind === "image" && result.dataUrl) {
          nextState = { status: "ready", dataUrl: result.dataUrl };
        }
      } catch {
        nextState = { status: "failed" };
      }
      if (generation !== markdownAssetGeneration) return;
      markdownAssets.value = { ...markdownAssets.value, [relativePath]: nextState };
    }
  };

  await Promise.all(Array.from({ length: Math.min(4, pendingPaths.length) }, () => worker()));
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
      if (!focusedRelativePath.value && entries.length > 0) {
        focusedRelativePath.value = entries[0].relativePath;
      }
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

const findNodeRecursive = (nodes: TreeNode[], relativePath: string): TreeNode | undefined => {
  for (const node of nodes) {
    if (normalizedRelativePath(node.relativePath) === normalizedRelativePath(relativePath)) return node;
    const child = findNodeRecursive(node.children || [], relativePath);
    if (child) return child;
  }
  return undefined;
};

const focusTreeNode = (relativePath: string) => {
  focusedRelativePath.value = relativePath;
  void nextTick(() => {
    const button = Array.from(treeRef.value?.querySelectorAll<HTMLElement>("[data-tree-path]") || []).find(
      (element) => normalizedRelativePath(element.dataset.treePath || "") === normalizedRelativePath(relativePath),
    );
    button?.focus();
  });
};

const selectTreeNode = (node: TreeNode) => {
  selectedNodeRelativePath.value = node.relativePath;
  focusedRelativePath.value = node.relativePath;
};

const focusOnlyTreeNode = (node: TreeNode) => {
  focusedRelativePath.value = node.relativePath;
};

const pathIsSameOrChild = (relativePath: string, parentRelativePath: string) => {
  const pathValue = normalizedRelativePath(relativePath);
  const parentValue = normalizedRelativePath(parentRelativePath).replace(/\/$/, "");
  return pathValue === parentValue || pathValue.startsWith(`${parentValue}/`);
};

const closeContextMenu = (restoreFocus = false) => {
  const relativePath = contextMenu.value?.node.relativePath || "";
  contextMenu.value = null;
  if (restoreFocus && relativePath) focusTreeNode(relativePath);
};

const showNodeContextMenu = (
  node: TreeNode,
  anchor: { x: number; y: number; aboveY?: number },
  previousSelectedPath: string,
  previousFocusedPath: string,
) => {
  const viewportMargin = 8;
  contextMenu.value = {
    node,
    x: Math.max(viewportMargin, anchor.x),
    y: Math.max(viewportMargin, anchor.y),
    previousSelectedPath,
    previousFocusedPath,
  };
  void nextTick(() => {
    const menu = contextMenuRef.value;
    const current = contextMenu.value;
    if (!menu || !current || current.node !== node) return;

    const rect = menu.getBoundingClientRect();
    const maxX = Math.max(viewportMargin, window.innerWidth - rect.width - viewportMargin);
    const maxY = Math.max(viewportMargin, window.innerHeight - rect.height - viewportMargin);
    const preferredX = anchor.x + rect.width <= window.innerWidth - viewportMargin ? anchor.x : anchor.x - rect.width;
    const preferredY =
      anchor.y + rect.height <= window.innerHeight - viewportMargin
        ? anchor.y
        : (anchor.aboveY ?? anchor.y) - rect.height;
    current.x = Math.min(Math.max(viewportMargin, preferredX), maxX);
    current.y = Math.min(Math.max(viewportMargin, preferredY), maxY);
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  });
};

const openNodeContextMenu = (node: TreeNode, source: MouseEvent | KeyboardEvent) => {
  source.preventDefault();
  const previousSelectedPath = selectedNodeRelativePath.value;
  const previousFocusedPath = focusedRelativePath.value;
  selectTreeNode(node);
  const sourceElement = source.currentTarget instanceof HTMLElement ? source.currentTarget : null;
  const rect = sourceElement?.getBoundingClientRect();
  showNodeContextMenu(
    node,
    {
      x: source instanceof MouseEvent ? source.clientX : rect?.left || 8,
      y: source instanceof MouseEvent ? source.clientY : rect?.bottom || 8,
      aboveY: source instanceof MouseEvent ? source.clientY : rect?.top || 8,
    },
    previousSelectedPath,
    previousFocusedPath,
  );
};

const handleContextMenuKeydown = (event: KeyboardEvent) => {
  const items = Array.from(contextMenuRef.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
  if (items.length === 0) return;
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  let nextIndex: number | undefined;
  if (event.key === "ArrowDown") nextIndex = (Math.max(0, currentIndex) + 1) % items.length;
  else if (event.key === "ArrowUp") nextIndex = (currentIndex <= 0 ? items.length : currentIndex) - 1;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;
  else return;
  event.preventDefault();
  items[nextIndex].focus();
};

const cancelInlineEdit = () => {
  if (!inlineEdit.value?.busy) inlineEdit.value = null;
};

const handleAppEscape = (event: AppEscapeRequestEvent) => {
  if (event.detail.handled) return;
  if (actionDialog.value) return;
  if (contextMenu.value) {
    closeContextMenu(true);
    event.detail.handle();
    return;
  }
  if (inlineEdit.value) {
    cancelInlineEdit();
    event.detail.handle();
  }
};

const cancelActionDialog = () => {
  if (isActionRunning.value) return;
  const canceledPath = pendingCanceledPath;
  actionDialog.value = null;
  actionDialogError.value = "";
  deleteTarget.value = null;
  pendingContinuation = null;
  pendingCanceledPath = "";
  if (pendingCancelRestore) {
    selectedNodeRelativePath.value = pendingCancelRestore.selectedPath;
    focusTreeNode(pendingCancelRestore.focusedPath);
  }
  pendingCancelRestore = null;
  if (canceledPath) emit("open-canceled", canceledPath);
};

const runContinuation = async () => {
  const continuation = pendingContinuation;
  pendingContinuation = null;
  pendingCanceledPath = "";
  pendingCancelRestore = null;
  actionDialog.value = null;
  actionDialogError.value = "";
  if (continuation) await continuation();
};

const guardDirtyDraft = async (
  continuation: () => Promise<void> | void,
  affectsCurrent = true,
  canceledPath = "",
  cancelRestore: { selectedPath: string; focusedPath: string } | null = null,
) => {
  if (!isDirty.value || !affectsCurrent) {
    await continuation();
    return;
  }
  pendingContinuation = continuation;
  pendingCanceledPath = canceledPath;
  pendingCancelRestore = cancelRestore;
  actionDialogError.value = "";
  actionDialog.value = "dirty";
};

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
  selectTreeNode(node);
  if (node.loaded) {
    node.expanded = !node.expanded;
    return;
  }
  await loadChildren(node);
};

const performOpenFile = async (node: TreeNode, edit = false) => {
  if (node.kind !== "file") {
    await toggleDirectory(node);
    return;
  }

  selectTreeNode(node);

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

const openFile = async (node: TreeNode, edit = false) => {
  if (node.kind !== "file") {
    await toggleDirectory(node);
    return;
  }
  await guardDirtyDraft(
    () => performOpenFile(node, edit),
    Boolean(
      selectedRelativePath.value &&
      normalizedRelativePath(node.relativePath) !== normalizedRelativePath(selectedRelativePath.value),
    ),
    "",
    { selectedPath: selectedNodeRelativePath.value, focusedPath: selectedNodeRelativePath.value },
  );
};

const collapseAll = () => {
  const collapse = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      node.expanded = false;
      collapse(node.children || []);
    }
  };
  collapse(rootNodes.value);
  if (rootNodes.value.length > 0) focusTreeNode(rootNodes.value[0].relativePath);
};

const expandDirectoryPath = async (relativePath: string) => {
  const parts = pathParts(relativePath);
  let currentNodes = rootNodes.value;
  for (let index = 0; index < parts.length; index += 1) {
    const directoryPath = parts.slice(0, index + 1).join("/");
    const directoryNode = findNode(currentNodes, directoryPath);
    if (!directoryNode || directoryNode.kind !== "directory") return;
    if (!directoryNode.loaded) await loadChildren(directoryNode);
    else directoryNode.expanded = true;
    currentNodes = directoryNode.children || [];
  }
};

const refreshTree = async () => {
  const expandedPaths = visibleNodes.value
    .filter((node) => node.kind === "directory" && node.expanded)
    .map((node) => node.relativePath)
    .sort((left, right) => pathParts(left).length - pathParts(right).length);
  await loadChildren();
  for (const relativePath of expandedPaths) await expandDirectoryPath(relativePath);
  const selectedNode = findNodeRecursive(rootNodes.value, selectedNodeRelativePath.value);
  if (!selectedNode) {
    const clearMissingSelection = () => {
      selectedNodeRelativePath.value = "";
      focusedRelativePath.value = rootNodes.value[0]?.relativePath || "";
      clearCurrentFile();
    };
    if (selectedFile.value) await guardDirtyDraft(clearMissingSelection);
    else clearMissingSelection();
  }
};

const parentRelativePath = (relativePath: string) => pathParts(relativePath).slice(0, -1).join("/");

const reloadParentDirectory = async (relativePath: string) => {
  if (!relativePath) {
    await loadChildren();
    return;
  }
  const parentNode = findNodeRecursive(rootNodes.value, relativePath);
  if (parentNode?.kind === "directory") await loadChildren(parentNode);
};

const derivedCreateParent = (explicitNode?: TreeNode) => {
  const node = explicitNode || findNodeRecursive(rootNodes.value, selectedNodeRelativePath.value);
  if (!node) return "";
  return node.kind === "directory" ? node.relativePath : parentRelativePath(node.relativePath);
};

const beginCreate = async (kind: "file" | "directory", explicitNode?: TreeNode) => {
  closeContextMenu();
  isFilterOpen.value = false;
  filterQuery.value = "";
  filterResults.value = [];
  const parentPath = derivedCreateParent(explicitNode);
  if (parentPath) {
    await expandDirectoryPath(parentPath);
    const parentNode = findNodeRecursive(rootNodes.value, parentPath);
    if (parentNode) parentNode.expanded = true;
  }
  inlineEdit.value = { mode: "create", kind, parentRelativePath: parentPath, value: "", error: "", busy: false };
  if (!parentPath) void nextTick(() => rootInlineInputRef.value?.focus());
};

const beginRename = (node: TreeNode) => {
  inlineEdit.value = {
    mode: "rename",
    kind: node.kind,
    parentRelativePath: parentRelativePath(node.relativePath),
    targetRelativePath: node.relativePath,
    value: node.name,
    error: "",
    busy: false,
  };
};

const requestRename = async (node: TreeNode) => {
  const cancelRestore = contextMenu.value
    ? { selectedPath: contextMenu.value.previousSelectedPath, focusedPath: contextMenu.value.previousFocusedPath }
    : null;
  closeContextMenu();
  await guardDirtyDraft(
    () => beginRename(node),
    Boolean(selectedRelativePath.value && pathIsSameOrChild(selectedRelativePath.value, node.relativePath)),
    "",
    cancelRestore,
  );
};

const updateInlineValue = (value: string) => {
  if (!inlineEdit.value) return;
  inlineEdit.value = { ...inlineEdit.value, value, error: "" };
};

const replacePathPrefix = (relativePath: string, previousPrefix: string, nextPrefix: string) => {
  const normalizedPath = normalizedRelativePath(relativePath);
  const previous = normalizedRelativePath(previousPrefix);
  if (normalizedPath === previous) return nextPrefix;
  if (normalizedPath.startsWith(`${previous}/`)) return `${nextPrefix}${normalizedPath.slice(previous.length)}`;
  return relativePath;
};

const rewriteTreePrefix = (
  nodes: TreeNode[],
  previousPrefix: string,
  nextPrefix: string,
  previousPath: string,
  nextPath: string,
) => {
  const absoluteSeparator = previousPath.includes("\\") ? "\\" : "/";
  for (const node of nodes) {
    node.relativePath = replacePathPrefix(node.relativePath, previousPrefix, nextPrefix);
    if (node.path === previousPath) node.path = nextPath;
    else if (node.path.startsWith(`${previousPath}${absoluteSeparator}`)) {
      node.path = `${nextPath}${node.path.slice(previousPath.length)}`;
    }
    rewriteTreePrefix(node.children || [], previousPrefix, nextPrefix, previousPath, nextPath);
  }
};

const executeInlineEdit = async () => {
  const edit = inlineEdit.value;
  if (!edit || edit.busy) return;
  inlineEdit.value = { ...edit, busy: true, error: "" };
  try {
    if (edit.mode === "create") {
      const result = await store.createProjectEntry(props.project.id, edit.parentRelativePath, edit.value, edit.kind);
      if (!result?.ok) {
        inlineEdit.value = { ...edit, busy: false, error: result?.message || t.value.files.operationFailed };
        return;
      }
      inlineEdit.value = null;
      await reloadParentDirectory(edit.parentRelativePath);
      const createdNode = findNodeRecursive(rootNodes.value, result.relativePath);
      if (!createdNode) return;
      selectTreeNode(createdNode);
      if (createdNode.kind === "file") await performOpenFile(createdNode, true);
      else {
        createdNode.expanded = true;
        focusTreeNode(createdNode.relativePath);
      }
      return;
    }

    const targetPath = edit.targetRelativePath || "";
    const sourceNode = findNodeRecursive(rootNodes.value, targetPath);
    const result = await store.renameProjectEntry(props.project.id, targetPath, edit.value);
    if (!result?.ok || !sourceNode) {
      inlineEdit.value = { ...edit, busy: false, error: result?.message || t.value.files.operationFailed };
      return;
    }
    rewriteTreePrefix(rootNodes.value, targetPath, result.relativePath, sourceNode.path, result.path);
    selectedNodeRelativePath.value = replacePathPrefix(selectedNodeRelativePath.value, targetPath, result.relativePath);
    focusedRelativePath.value = replacePathPrefix(focusedRelativePath.value, targetPath, result.relativePath);
    const selectedWasAffected = Boolean(
      selectedFile.value && pathIsSameOrChild(selectedFile.value.relativePath, targetPath),
    );
    if (selectedWasAffected && selectedFile.value) {
      const nextSelectedPath = replacePathPrefix(selectedFile.value.relativePath, targetPath, result.relativePath);
      const refreshed = await store.readProjectFile(props.project.id, nextSelectedPath);
      selectedFile.value = refreshed;
      draftContent.value = refreshed?.content || "";
      isEditing.value = false;
      if (refreshed?.relativePath) emit("opened", refreshed.relativePath);
    }
    inlineEdit.value = null;
    focusTreeNode(result.relativePath);
  } catch (error) {
    inlineEdit.value = {
      ...edit,
      busy: false,
      error: error instanceof Error ? error.message : t.value.files.operationFailed,
    };
  }
};

const submitInlineEdit = async () => {
  const edit = inlineEdit.value;
  if (!edit) return;
  const affectsCurrent =
    edit.mode === "create" ||
    Boolean(
      selectedRelativePath.value &&
      edit.targetRelativePath &&
      pathIsSameOrChild(selectedRelativePath.value, edit.targetRelativePath),
    );
  await guardDirtyDraft(executeInlineEdit, affectsCurrent);
};

const removeTreeNode = (nodes: TreeNode[], relativePath: string): boolean => {
  const index = nodes.findIndex(
    (node) => normalizedRelativePath(node.relativePath) === normalizedRelativePath(relativePath),
  );
  if (index >= 0) {
    nodes.splice(index, 1);
    return true;
  }
  return nodes.some((node) => removeTreeNode(node.children || [], relativePath));
};

const clearCurrentFile = () => {
  selectedFile.value = null;
  draftContent.value = "";
  isEditing.value = false;
  statusMessage.value = "";
  resetFindState(false);
};

const openDeleteDialog = (node: TreeNode) => {
  deleteTarget.value = node;
  actionDialogError.value = "";
  actionDialog.value = "delete";
};

const requestDelete = async (node: TreeNode) => {
  const cancelRestore = contextMenu.value
    ? { selectedPath: contextMenu.value.previousSelectedPath, focusedPath: contextMenu.value.previousFocusedPath }
    : null;
  closeContextMenu();
  await guardDirtyDraft(
    () => openDeleteDialog(node),
    Boolean(selectedRelativePath.value && pathIsSameOrChild(selectedRelativePath.value, node.relativePath)),
    "",
    cancelRestore,
  );
};

const confirmDelete = async () => {
  const target = deleteTarget.value;
  if (!target || isActionRunning.value) return;
  isActionRunning.value = true;
  try {
    const result = await store.deleteProjectEntry(props.project.id, target.relativePath);
    if (!result?.ok) {
      actionDialogError.value = result?.message || t.value.files.operationFailed;
      statusMessage.value = actionDialogError.value;
      return;
    }
    removeTreeNode(rootNodes.value, target.relativePath);
    if (selectedFile.value && pathIsSameOrChild(selectedFile.value.relativePath, target.relativePath))
      clearCurrentFile();
    if (pathIsSameOrChild(selectedNodeRelativePath.value, target.relativePath)) {
      selectedNodeRelativePath.value = parentRelativePath(target.relativePath);
    }
    actionDialog.value = null;
    deleteTarget.value = null;
    const nextFocus = findNodeRecursive(rootNodes.value, selectedNodeRelativePath.value) || visibleNodes.value[0];
    if (nextFocus) focusTreeNode(nextFocus.relativePath);
  } catch (error) {
    actionDialogError.value = error instanceof Error ? error.message : t.value.files.operationFailed;
    statusMessage.value = actionDialogError.value;
  } finally {
    isActionRunning.value = false;
  }
};

const handleDialogPrimary = () => {
  if (actionDialog.value === "dirty") void saveAndContinue();
  else if (actionDialog.value === "delete") void confirmDelete();
};

const copyNodePath = async (node: TreeNode, absolute: boolean) => {
  closeContextMenu(true);
  try {
    await navigator.clipboard.writeText(absolute ? node.path : node.relativePath);
    statusMessage.value = absolute ? t.value.files.absolutePathCopied : t.value.files.relativePathCopied;
  } catch {
    statusMessage.value = t.value.files.copyFailed;
  }
};

const revealNode = async (node: TreeNode) => {
  closeContextMenu(true);
  try {
    await store.showProjectEntryInFolder(props.project.id, node.relativePath);
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : t.value.files.operationFailed;
  }
};

const toggleFilter = () => {
  isFilterOpen.value = !isFilterOpen.value;
  if (!isFilterOpen.value) {
    filterQuery.value = "";
    filterResults.value = [];
    return;
  }
  void nextTick(() => filterInputRef.value?.focus());
};

const runProjectFilter = async (query: string) => {
  const requestId = ++filterRequestId;
  if (!query.trim()) {
    filterResults.value = [];
    filterTruncated.value = false;
    isFiltering.value = false;
    return;
  }
  isFiltering.value = true;
  try {
    const result = await store.searchProjectFiles(props.project.id, query, { limit: 200 });
    if (requestId !== filterRequestId) return;
    filterResults.value = result?.entries || [];
    filterTruncated.value = Boolean(result?.truncated);
  } catch (error) {
    if (requestId !== filterRequestId) return;
    filterResults.value = [];
    filterTruncated.value = false;
    statusMessage.value = error instanceof Error ? error.message : t.value.files.operationFailed;
  } finally {
    if (requestId === filterRequestId) isFiltering.value = false;
  }
};

const activateFilterResult = async (entry: ProjectFileTreeEntry) => {
  filterQuery.value = "";
  filterResults.value = [];
  isFilterOpen.value = false;
  await expandPathToFile(entry.relativePath);
  const node = findNodeRecursive(rootNodes.value, entry.relativePath) || ({ ...entry } as TreeNode);
  selectTreeNode(node);
  if (node.kind === "directory") {
    await expandDirectoryPath(node.relativePath);
  } else {
    await openFile(node);
  }
  focusTreeNode(node.relativePath);
};

const handleTreeKeydown = (event: KeyboardEvent) => {
  if (event.target instanceof HTMLInputElement) return;
  const nodes = visibleNodes.value;
  const index = nodes.findIndex(
    (node) => normalizedRelativePath(node.relativePath) === normalizedRelativePath(focusedRelativePath.value),
  );
  const current = nodes[Math.max(0, index)];
  if (!current) return;

  let target: TreeNode | undefined;
  if (event.key === "ArrowDown") target = nodes[Math.min(nodes.length - 1, Math.max(0, index) + 1)];
  else if (event.key === "ArrowUp") target = nodes[Math.max(0, index - 1)];
  else if (event.key === "Home") target = nodes[0];
  else if (event.key === "End") target = nodes.at(-1);
  else if (event.key === "ArrowRight" && current.kind === "directory") {
    event.preventDefault();
    if (!current.expanded) void toggleDirectory(current);
    else target = nodes[index + 1];
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (current.kind === "directory" && current.expanded) current.expanded = false;
    else {
      const parentPath = pathParts(current.relativePath).slice(0, -1).join("/");
      target = nodes.find((node) => normalizedRelativePath(node.relativePath) === parentPath);
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (current.kind === "directory") void toggleDirectory(current);
    else void openFile(current);
  } else if (event.key === "F2") {
    event.preventDefault();
    void requestRename(current);
  } else if (event.key === "Delete") {
    event.preventDefault();
    void requestDelete(current);
  } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
    const element = Array.from(treeRef.value?.querySelectorAll<HTMLElement>("[data-tree-path]") || []).find(
      (candidate) =>
        normalizedRelativePath(candidate.dataset.treePath || "") === normalizedRelativePath(current.relativePath),
    );
    const rect = element?.getBoundingClientRect();
    showNodeContextMenu(
      current,
      { x: rect?.left || 8, y: rect?.bottom || 8, aboveY: rect?.top || 8 },
      selectedNodeRelativePath.value,
      focusedRelativePath.value,
    );
  } else {
    return;
  }
  if (target) {
    event.preventDefault();
    focusOnlyTreeNode(target);
    focusTreeNode(target.relativePath);
  }
};

const performOpenRelativePath = async (relativePath: string) => {
  const normalizedPath = normalizedRelativePath(relativePath.trim());
  if (!normalizedPath) return;
  isLoadingFile.value = true;
  statusMessage.value = "";
  try {
    await expandPathToFile(normalizedPath);
    const result = await store.readProjectFile(props.project.id, normalizedPath);
    const openedNode = findNodeRecursive(rootNodes.value, normalizedPath);
    if (openedNode) selectTreeNode(openedNode);
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

const openRelativePath = async (relativePath: string) => {
  const normalizedPath = normalizedRelativePath(relativePath.trim());
  if (!normalizedPath) return;
  await guardDirtyDraft(
    () => performOpenRelativePath(normalizedPath),
    Boolean(selectedRelativePath.value && normalizedPath !== normalizedRelativePath(selectedRelativePath.value)),
    normalizedPath,
  );
};

const saveFile = async () => {
  if (!selectedFile.value || !canSave.value) return !isDirty.value;
  isSaving.value = true;
  try {
    const result = await store.writeProjectFile(props.project.id, selectedFile.value.relativePath, draftContent.value);
    if (!result) {
      statusMessage.value = t.value.files.operationFailed;
      return false;
    }
    selectedFile.value = {
      ...selectedFile.value,
      content: draftContent.value,
      size: new Blob([draftContent.value]).size,
    };
    statusMessage.value = result
      ? t.value.files.savedAt.replace("{time}", new Date(result.savedAt).toLocaleTimeString())
      : t.value.files.saved;
    return true;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : t.value.files.operationFailed;
    return false;
  } finally {
    isSaving.value = false;
  }
};

const saveAndContinue = async () => {
  if (isActionRunning.value) return;
  isActionRunning.value = true;
  try {
    if (await saveFile()) await runContinuation();
    else actionDialogError.value = statusMessage.value || t.value.files.operationFailed;
  } finally {
    isActionRunning.value = false;
  }
};

const discardAndContinue = async () => {
  if (isActionRunning.value) return;
  draftContent.value = selectedFile.value?.content || "";
  isEditing.value = false;
  await runContinuation();
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
  stopAppEscapeListener = addAppEscapeRequestListener(handleAppEscape);
  window.addEventListener("click", closeContextMenu);
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  markdownAssetGeneration += 1;
  filterRequestId += 1;
  window.clearTimeout(filterTimer);
  stopAppEscapeListener();
  window.removeEventListener("click", closeContextMenu);
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

watch([isMarkdownPreview, selectedRelativePath, draftContent, isEditing], () => {
  void loadMarkdownAssets();
});

watch(filterQuery, (query) => {
  window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => void runProjectFilter(query), 240);
});
</script>

<template>
  <div
    ref="splitContainerRef"
    class="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm"
    :style="gridTemplateStyle"
  >
    <aside ref="treePaneRef" class="file-tree-pane min-w-0 overflow-hidden bg-surface-container-low">
      <div class="file-tree-header ui-panel-header">
        <div class="ui-panel-title min-w-0 flex-1">
          <Folder :size="14" class="text-primary" />
          <span class="file-tree-project-name truncate">{{ project.name }}</span>
        </div>
        <div class="file-tree-header-actions flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="file-tree-toolbar-button"
            :title="t.files.newFile"
            :aria-label="t.files.newFile"
            @click="beginCreate('file')"
          >
            <FilePlus2 :size="13" />
          </button>
          <button
            type="button"
            class="file-tree-toolbar-button"
            :title="t.files.newDirectory"
            :aria-label="t.files.newDirectory"
            @click="beginCreate('directory')"
          >
            <FolderPlus :size="13" />
          </button>
          <button
            type="button"
            class="file-tree-toolbar-button"
            :title="t.files.refreshTree"
            :aria-label="t.files.refreshTree"
            @click="refreshTree"
          >
            <RefreshCw :size="13" :class="isLoadingTree && 'animate-spin'" />
          </button>
          <button
            type="button"
            class="file-tree-toolbar-button"
            :title="t.files.collapseAll"
            :aria-label="t.files.collapseAll"
            @click="collapseAll"
          >
            <ListCollapse :size="13" />
          </button>
          <button
            type="button"
            :class="cn('file-tree-toolbar-button', isFilterOpen && 'bg-primary/10 text-primary')"
            :title="t.files.filterFiles"
            :aria-label="t.files.filterFiles"
            @click="toggleFilter"
          >
            <Filter :size="13" />
          </button>
        </div>
      </div>
      <div v-if="isFilterOpen" class="flex h-9 items-center gap-1 border-b border-border-subtle px-2">
        <Search :size="12" class="shrink-0 text-on-surface-variant" />
        <input
          ref="filterInputRef"
          v-model="filterQuery"
          type="text"
          class="min-w-0 flex-1 bg-transparent text-xs text-on-surface outline-none"
          :placeholder="t.files.filterPlaceholder"
        />
        <button type="button" class="file-tree-toolbar-button" :aria-label="t.common.close" @click="toggleFilter">
          <X :size="12" />
        </button>
      </div>
      <div
        ref="treeRef"
        role="tree"
        :aria-label="t.files.fileTree"
        :class="
          cn(
            'themed-scrollbar overflow-auto p-2 text-xs',
            isFilterOpen ? 'h-[calc(100%-4.5rem)]' : 'h-[calc(100%-2.25rem)]',
          )
        "
        @keydown="handleTreeKeydown"
      >
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
        <div v-if="filterQuery.trim()" class="space-y-0.5">
          <div v-if="isFiltering" class="space-y-1.5 p-1" aria-busy="true">
            <div v-for="row in 5" :key="row" class="skeleton h-6 w-full" />
          </div>
          <button
            v-for="entry in filterResults"
            v-else
            :key="entry.relativePath"
            type="button"
            class="flex h-9 w-full min-w-0 flex-col justify-center rounded px-2 text-left hover:bg-surface-variant"
            @click="activateFilterResult(entry)"
          >
            <span class="truncate font-medium text-on-surface">{{ entry.name }}</span>
            <span class="truncate font-mono text-[9px] text-on-surface-variant">{{ entry.relativePath }}</span>
          </button>
          <div v-if="!isFiltering && filterResults.length === 0" class="p-2 text-on-surface-variant">
            {{ t.files.noResults }}
          </div>
          <div v-if="filterTruncated" class="p-2 text-[10px] text-status-warning">{{ t.files.filterTruncated }}</div>
        </div>
        <template v-else>
          <div v-if="inlineEdit?.mode === 'create' && !inlineEdit.parentRelativePath" class="px-1 py-0.5">
            <input
              ref="rootInlineInputRef"
              :value="inlineEdit.value"
              type="text"
              class="h-7 w-full rounded border border-primary bg-surface-container-lowest px-2 text-xs text-on-surface outline-none"
              :disabled="inlineEdit.busy"
              :aria-label="inlineEdit.kind === 'directory' ? t.files.newDirectory : t.files.newFile"
              @input="updateInlineValue(($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="submitInlineEdit"
              @keydown.esc.prevent="cancelInlineEdit"
            />
            <p v-if="inlineEdit.error" class="mt-1 break-words text-[10px] text-status-error">{{ inlineEdit.error }}</p>
          </div>
          <FileTreeNode
            v-for="node in rootNodes"
            :key="node.relativePath"
            :node="node"
            :selected-relative-path="selectedNodeRelativePath"
            :focused-relative-path="focusedRelativePath"
            :inline-edit="inlineEdit"
            @toggle="toggleDirectory"
            @open="openFile"
            @focus-node="focusOnlyTreeNode"
            @context-menu="openNodeContextMenu"
            @inline-input="updateInlineValue"
            @inline-submit="submitInlineEdit"
            @inline-cancel="cancelInlineEdit"
          />
        </template>
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

    <section class="flex min-h-0 min-w-0 flex-1 flex-col">
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

  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="contextMenu"
        ref="contextMenuRef"
        class="file-tree-context-menu fixed z-[75] overflow-hidden rounded border border-border-subtle bg-surface-container-lowest py-1 text-xs text-on-surface shadow-xl"
        :style="contextMenuStyle"
        role="menu"
        @click.stop
        @contextmenu.prevent
        @keydown="handleContextMenuKeydown"
      >
        <button
          v-if="contextMenu.node.kind === 'directory'"
          type="button"
          class="file-tree-menu-item"
          role="menuitem"
          @click="beginCreate('file', contextMenu.node)"
        >
          <FilePlus2 :size="13" />{{ t.files.newFile }}
        </button>
        <button
          v-if="contextMenu.node.kind === 'directory'"
          type="button"
          class="file-tree-menu-item"
          role="menuitem"
          @click="beginCreate('directory', contextMenu.node)"
        >
          <FolderPlus :size="13" />{{ t.files.newDirectory }}
        </button>
        <button type="button" class="file-tree-menu-item" role="menuitem" @click="requestRename(contextMenu.node)">
          <Pencil :size="13" />{{ t.files.rename }}
        </button>
        <div class="my-1 border-t border-border-subtle" />
        <button
          type="button"
          class="file-tree-menu-item"
          role="menuitem"
          @click="copyNodePath(contextMenu.node, false)"
        >
          <Copy :size="13" />{{ t.files.copyRelativePath }}
        </button>
        <button type="button" class="file-tree-menu-item" role="menuitem" @click="copyNodePath(contextMenu.node, true)">
          <Copy :size="13" />{{ t.files.copyAbsolutePath }}
        </button>
        <button type="button" class="file-tree-menu-item" role="menuitem" @click="revealNode(contextMenu.node)">
          <LocateFixed :size="13" />{{ t.files.revealInFolder }}
        </button>
        <div class="my-1 border-t border-border-subtle" />
        <button
          type="button"
          class="file-tree-menu-item text-status-error hover:bg-status-error/10"
          role="menuitem"
          @click="requestDelete(contextMenu.node)"
        >
          <Trash2 :size="13" />{{ t.common.delete }}
        </button>
      </div>
    </Transition>
  </Teleport>

  <ProjectActionDialog
    :open="Boolean(actionDialog)"
    :tone="actionDialog === 'delete' ? 'danger' : 'warning'"
    :title="actionDialogTitle"
    :message="actionDialogMessage"
    :detail="actionDialog === 'delete' ? deleteTarget?.relativePath : selectedRelativePath"
    :primary-label="actionDialog === 'dirty' ? t.common.save : t.common.delete"
    :secondary-label="actionDialog === 'dirty' ? t.files.discard : ''"
    :cancel-label="t.common.cancel"
    :busy="isActionRunning"
    :busy-label="t.files.processing"
    @primary="handleDialogPrimary"
    @secondary="discardAndContinue"
    @cancel="cancelActionDialog"
  />
</template>
