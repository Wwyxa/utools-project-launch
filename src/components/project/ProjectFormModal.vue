<script setup lang="ts">
import { computed, ref } from "vue";
import { X, Plus, Trash2, Save, WandSparkles, FolderOpen, GripVertical } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { ProjectIconKey, ProjectKind } from "../../types";
import ProjectIcon from "./ProjectIcon.vue";

const store = useStore();
const t = useI18n();

const form = computed(() => store.projectFormDraft);
const title = computed(() => (store.projectFormMode === "edit" ? t.value.modal.editTitle : t.value.modal.createTitle));
const draggedScriptId = ref<string | null>(null);

const projectIcons: Array<{ key: ProjectIconKey; label: string; kind: ProjectKind; type: string }> = [
  { key: "node", label: "Node.js", kind: "node", type: "Node.js" },
  { key: "vue", label: "Vue", kind: "node", type: "Vue" },
  { key: "react", label: "React", kind: "node", type: "React" },
  { key: "python", label: "Python", kind: "python", type: "Python" },
  { key: "go", label: "Go", kind: "go", type: "Go" },
  { key: "rust", label: "Rust", kind: "custom", type: "Rust" },
  { key: "java", label: "Java", kind: "custom", type: "Java" },
  { key: "docker", label: "Docker", kind: "custom", type: "Docker" },
  { key: "database", label: "Database", kind: "custom", type: "Database" },
  { key: "browser", label: "Web", kind: "custom", type: "Web" },
  { key: "terminal", label: "CLI", kind: "custom", type: "CLI" },
  { key: "backend", label: "API", kind: "custom", type: "API" },
  { key: "package", label: "Package", kind: "custom", type: "Package" },
  { key: "ai", label: "AI", kind: "custom", type: "AI" },
  { key: "executable", label: "Executable", kind: "executable", type: "Executable" },
  { key: "custom", label: "Custom", kind: "custom", type: "Custom" },
];

const updateIcon = (icon: (typeof projectIcons)[number]) => {
  const command =
    icon.kind === "node"
      ? "npm run dev"
      : icon.kind === "python"
        ? "python main.py"
        : icon.kind === "go"
          ? "go run ."
          : icon.kind === "executable"
            ? "app.exe"
            : "";

  store.updateProjectForm({ icon: icon.key, kind: icon.kind, type: icon.type });
  if (form.value.scripts.length === 1 && !form.value.scripts[0].command.trim()) {
    store.updateScriptEntry(form.value.scripts[0].id, { command });
  }
};

const handlePathBlur = () => {
  void store.inspectCurrentProjectPath();
};

const handleSubmit = async () => {
  if (!form.value.name.trim() || !form.value.path.trim()) {
    return;
  }

  await store.saveProjectForm();
};

const handleScriptDragStart = (event: DragEvent, scriptId: string) => {
  draggedScriptId.value = scriptId;
  event.dataTransfer?.setData("text/plain", scriptId);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
};

const handleScriptDrop = (targetScriptId: string) => {
  if (draggedScriptId.value) {
    store.reorderScriptEntry(draggedScriptId.value, targetScriptId);
  }
  draggedScriptId.value = null;
};
</script>

<template>
  <Teleport to="body">
    <Transition name="scale">
      <div v-if="store.projectFormOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6">
        <div
          class="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-xl bg-surface border border-border-subtle shadow-2xl flex flex-col"
        >
          <header
            class="px-5 py-3 border-b border-border-subtle flex items-center justify-between bg-surface-container-low"
          >
            <h2 class="text-lg font-bold text-on-surface">{{ title }}</h2>
            <button
              type="button"
              @click="store.closeProjectForm"
              class="p-2 rounded-lg text-on-surface-variant hover:bg-surface-variant hover:text-on-surface"
              :title="t.common.close"
              :aria-label="t.common.close"
            >
              <X :size="18" />
            </button>
          </header>

          <div class="themed-scrollbar bg-surface p-5 overflow-y-auto space-y-6 [color-scheme:inherit]">
            <section class="grid grid-cols-1 md:grid-cols-12 gap-x-4 gap-y-4">
              <label class="space-y-1.5 md:col-span-4">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.name }}</span>
                <input
                  :value="form.name"
                  @input="(event) => store.updateProjectForm({ name: (event.target as HTMLInputElement).value })"
                  class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </label>
              <label class="space-y-1.5 md:col-span-8">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.path }}</span>
                <div class="flex gap-2">
                  <input
                    :value="form.path"
                    @input="(event) => store.updateProjectForm({ path: (event.target as HTMLInputElement).value })"
                    @blur="handlePathBlur"
                    class="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    @click="store.pickProjectPath"
                    class="shrink-0 rounded-lg border border-border-subtle px-3 text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                    title="选择项目目录"
                    aria-label="选择项目目录"
                  >
                    <FolderOpen :size="16" />
                  </button>
                </div>
              </label>
              <div
                class="md:col-span-12 flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant"
              >
                <span>{{
                  store.projectFormInspectionMessage || "填写路径后可自动识别项目名称、脚本和 Git 分支。"
                }}</span>
                <button
                  type="button"
                  @click="store.inspectCurrentProjectPath"
                  class="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold text-primary hover:bg-surface"
                >
                  <WandSparkles :size="14" /> {{ store.projectFormInspecting ? "识别中" : "识别" }}
                </button>
              </div>
              <div class="space-y-1.5 md:col-span-12">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.icon }}</span>
                <div
                  class="grid grid-cols-8 gap-1.5 rounded-lg border border-border-subtle bg-surface-container-low p-1.5"
                >
                  <button
                    v-for="icon in projectIcons"
                    :key="icon.key"
                    type="button"
                    @click="updateIcon(icon)"
                    :title="icon.label"
                    :aria-label="icon.label"
                    :class="
                      cn(
                        'flex h-8 min-w-0 items-center justify-center rounded-md transition-colors hover:bg-surface-container-high',
                        form.icon === icon.key ? 'bg-surface ring-1 ring-primary/50' : 'opacity-75',
                      )
                    "
                  >
                    <ProjectIcon :icon="icon.key" />
                  </button>
                </div>
              </div>
              <label class="space-y-1.5 md:col-span-4">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.group }}</span>
                <input
                  :value="form.group"
                  type="text"
                  :placeholder="t.modal.groupPlaceholder"
                  @input="(event) => store.updateProjectForm({ group: (event.target as HTMLInputElement).value })"
                  class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </label>
              <label class="space-y-1.5 md:col-span-7">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.quickLink }}</span>
                <div class="flex gap-2">
                  <input
                    :value="form.quickLink"
                    type="text"
                    :placeholder="t.modal.quickLinkPlaceholder"
                    @input="(event) => store.updateProjectForm({ quickLink: (event.target as HTMLInputElement).value })"
                    class="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    @click="store.pickQuickLinkPath"
                    class="shrink-0 rounded-lg border border-border-subtle px-2.5 text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                    :title="t.modal.quickLinkPickPath"
                    :aria-label="t.modal.quickLinkPickPath"
                  >
                    <FolderOpen :size="16" />
                  </button>
                </div>
              </label>
              <div class="flex flex-wrap items-end gap-4 md:col-span-6">
                <div class="space-y-1.5">
                  <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.visibility }}</span>
                  <div class="flex w-fit rounded-lg border border-border-subtle bg-surface-container-low p-1">
                    <button
                      type="button"
                      @click="store.updateProjectForm({ visibility: 'private' })"
                      :class="
                        cn(
                          'rounded-md px-3 py-1 text-xs font-bold transition-colors',
                          form.visibility === 'private'
                            ? 'bg-surface text-primary shadow-sm ring-1 ring-primary/20'
                            : 'text-on-surface-variant hover:bg-surface-container',
                        )
                      "
                    >
                      {{ t.modal.visibilityPrivate }}
                    </button>
                    <button
                      type="button"
                      @click="store.updateProjectForm({ visibility: 'public' })"
                      :class="
                        cn(
                          'rounded-md px-3 py-1 text-xs font-bold transition-colors',
                          form.visibility === 'public'
                            ? 'bg-surface text-primary shadow-sm ring-1 ring-primary/20'
                            : 'text-on-surface-variant hover:bg-surface-container',
                        )
                      "
                    >
                      {{ t.modal.visibilityPublic }}
                    </button>
                  </div>
                </div>
                <div class="space-y-1.5">
                  <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.cardStyle }}</span>
                  <div class="flex w-fit rounded-lg border border-border-subtle bg-surface-container-low p-1">
                    <button
                      type="button"
                      @click="store.updateProjectForm({ cardStyle: 'default' })"
                      :class="
                        cn(
                          'rounded-md px-3 py-1 text-xs font-bold transition-colors',
                          form.cardStyle === 'default'
                            ? 'bg-surface text-primary shadow-sm ring-1 ring-primary/20'
                            : 'text-on-surface-variant hover:bg-surface-container',
                        )
                      "
                    >
                      {{ t.modal.cardStyleDefault }}
                    </button>
                    <button
                      type="button"
                      @click="store.updateProjectForm({ cardStyle: 'tiny' })"
                      :class="
                        cn(
                          'rounded-md px-3 py-1 text-xs font-bold transition-colors',
                          form.cardStyle === 'tiny'
                            ? 'bg-surface text-primary shadow-sm ring-1 ring-primary/20'
                            : 'text-on-surface-variant hover:bg-surface-container',
                        )
                      "
                    >
                      {{ t.modal.cardStyleTiny }}
                    </button>
                  </div>
                </div>
              </div>
              <label class="space-y-1.5 md:col-span-12">
                <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.description }}</span>
                <textarea
                  :value="form.description"
                  @input="
                    (event) => store.updateProjectForm({ description: (event.target as HTMLTextAreaElement).value })
                  "
                  rows="1"
                  class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
                />
              </label>
            </section>

            <section class="space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <h3 class="text-sm font-bold text-on-surface">{{ t.modal.scripts }}</h3>
                  <p class="text-xs text-on-surface-variant">{{ t.modal.packageHint }}</p>
                </div>
                <button
                  type="button"
                  @click="store.addScriptEntry"
                  class="text-primary text-xs font-bold flex items-center gap-1.5"
                >
                  <Plus :size="14" /> {{ t.modal.addScript }}
                </button>
              </div>
              <div class="space-y-2">
                <div
                  v-for="script in form.scripts"
                  :key="script.id"
                  @dragover.prevent
                  @drop="handleScriptDrop(script.id)"
                  @dragend="draggedScriptId = null"
                  :class="
                    cn(
                      'group/script grid grid-cols-1 items-center gap-2 rounded-lg border border-border-subtle bg-surface-container-low p-2 transition-all hover:border-primary/30 hover:bg-surface-container md:grid-cols-[auto_repeat(12,minmax(0,1fr))]',
                      draggedScriptId === script.id && 'opacity-55 ring-1 ring-primary/40',
                    )
                  "
                >
                  <button
                    type="button"
                    class="hidden h-8 w-6 items-center justify-center rounded text-on-surface-variant/55 opacity-70 cursor-grab transition-all hover:bg-surface-container-high hover:text-primary group-hover/script:opacity-100 active:cursor-grabbing md:flex"
                    draggable="true"
                    @dragstart="handleScriptDragStart($event, script.id)"
                    @dragend="draggedScriptId = null"
                    :aria-label="`拖拽排序 ${script.name || t.modal.scriptName}`"
                  >
                    <GripVertical :size="16" />
                  </button>
                  <input
                    :value="script.name"
                    @input="
                      (event) => store.updateScriptEntry(script.id, { name: (event.target as HTMLInputElement).value })
                    "
                    :placeholder="t.modal.scriptName"
                    class="md:col-span-2 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                  />
                  <input
                    :value="script.command"
                    @input="
                      (event) =>
                        store.updateScriptEntry(script.id, { command: (event.target as HTMLInputElement).value })
                    "
                    :placeholder="t.modal.scriptCommand"
                    class="md:col-span-4 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                  />
                  <input
                    :value="script.cwd"
                    @input="
                      (event) => store.updateScriptEntry(script.id, { cwd: (event.target as HTMLInputElement).value })
                    "
                    :placeholder="t.modal.scriptCwd"
                    list="project-cwd-suggestions"
                    class="md:col-span-2 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                  />
                  <datalist id="project-cwd-suggestions">
                    <option
                      v-for="suggestion in store.projectFormCwdSuggestions"
                      :key="suggestion"
                      :value="suggestion"
                    />
                  </datalist>
                  <input
                    :value="script.note"
                    @input="
                      (event) => store.updateScriptEntry(script.id, { note: (event.target as HTMLInputElement).value })
                    "
                    :placeholder="t.modal.scriptNote"
                    class="md:col-span-3 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                  />
                  <div class="md:col-span-1 flex min-h-8 items-center justify-end gap-1">
                    <button
                      type="button"
                      @click="store.removeScriptEntry(script.id)"
                      class="rounded-md border border-border-subtle bg-surface p-1.5 text-on-surface-variant opacity-80 transition-all hover:border-status-error/30 hover:bg-status-error/10 hover:text-status-error group-hover/script:opacity-100"
                      :title="t.modal.removeScript"
                      :aria-label="t.modal.removeScript"
                    >
                      <Trash2 :size="14" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section class="space-y-2">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-bold text-on-surface">{{ t.modal.env }}</h3>
                <button
                  type="button"
                  @click="store.addEnvironmentEntry"
                  class="text-primary text-xs font-bold flex items-center gap-1.5"
                >
                  <Plus :size="14" /> {{ t.common.add }}
                </button>
              </div>
              <div class="grid gap-2 lg:grid-cols-2">
                <div
                  v-for="entry in form.envEntries"
                  :key="entry.id"
                  class="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2"
                >
                  <input
                    :value="entry.key"
                    @input="
                      (event) =>
                        store.updateEnvironmentEntry(entry.id, { key: (event.target as HTMLInputElement).value })
                    "
                    class="rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                  />
                  <input
                    :value="entry.value"
                    @input="
                      (event) =>
                        store.updateEnvironmentEntry(entry.id, { value: (event.target as HTMLInputElement).value })
                    "
                    class="rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    @click="store.removeEnvironmentEntry(entry.id)"
                    class="rounded-lg border border-border-subtle px-3 text-on-surface-variant hover:text-status-error hover:bg-surface-container"
                    :title="t.common.delete"
                    :aria-label="t.common.delete"
                  >
                    <Trash2 :size="16" />
                  </button>
                </div>
              </div>
            </section>

            <section class="space-y-2">
              <h3 class="text-sm font-bold text-on-surface">{{ t.memo.title }}</h3>
              <textarea
                :value="form.memo"
                @input="(event) => store.updateProjectForm({ memo: (event.target as HTMLTextAreaElement).value })"
                rows="3"
                class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
              />
            </section>
          </div>

          <footer class="px-5 py-3 border-t border-border-subtle bg-surface-container-low flex justify-end gap-3">
            <button
              type="button"
              @click="store.closeProjectForm"
              class="px-4 py-2 rounded-lg border border-border-subtle bg-surface text-sm font-semibold text-on-surface hover:bg-surface-variant"
            >
              {{ t.common.cancel }}
            </button>
            <button
              type="button"
              @click="handleSubmit"
              class="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-sm font-bold hover:bg-primary hover:text-on-primary flex items-center gap-2"
            >
              <Save :size="16" /> {{ t.modal.saveProject }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
