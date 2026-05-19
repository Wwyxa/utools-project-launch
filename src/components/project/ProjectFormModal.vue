<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDown, X, Plus, Trash2, Save, WandSparkles, FolderOpen, GripVertical } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import type { ProjectKind } from "../../types";

const store = useStore();
const t = useI18n();

const form = computed(() => store.projectFormDraft);
const title = computed(() => (store.projectFormMode === "edit" ? t.value.modal.editTitle : t.value.modal.createTitle));
const draggedScriptId = ref<string | null>(null);

const projectKinds: ProjectKind[] = ["node", "python", "go", "executable", "custom"];

const updateKind = (kind: ProjectKind) => {
  const type = t.value.kinds[kind];
  const command =
    kind === "node"
      ? "npm run dev"
      : kind === "python"
        ? "python main.py"
        : kind === "go"
          ? "go run ."
          : kind === "executable"
            ? "app.exe"
            : "";

  store.updateProjectForm({ kind, type });
  if (form.value.scripts.length === 1 && !form.value.scripts[0].command.trim()) {
    store.updateScriptEntry(form.value.scripts[0].id, { command });
  }
};

const closeDropdown = (event: MouseEvent) => {
  (event.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
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
              <span>{{ store.projectFormInspectionMessage || "填写路径后可自动识别项目名称、脚本和 Git 分支。" }}</span>
              <button
                type="button"
                @click="store.inspectCurrentProjectPath"
                class="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold text-primary hover:bg-surface"
              >
                <WandSparkles :size="14" /> {{ store.projectFormInspecting ? "识别中" : "识别" }}
              </button>
            </div>
            <label class="space-y-1.5 md:col-span-3">
              <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.type }}</span>
              <details class="relative group/dropdown">
                <summary
                  class="flex w-full cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm transition-colors hover:bg-surface-container-low focus:outline-none focus:border-primary [&::-webkit-details-marker]:hidden"
                >
                  <span class="truncate">{{ t.kinds[form.kind] }}</span>
                  <ChevronDown
                    :size="16"
                    class="shrink-0 text-on-surface-variant transition-transform group-open/dropdown:rotate-180"
                  />
                </summary>
                <div
                  class="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-50 overflow-hidden rounded-lg border border-border-subtle bg-surface-container-lowest p-1 shadow-xl"
                >
                  <button
                    v-for="kind in projectKinds"
                    :key="kind"
                    type="button"
                    @click="
                      (event) => {
                        updateKind(kind);
                        closeDropdown(event);
                      }
                    "
                    :class="[
                      'block w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-container-high hover:text-on-surface',
                      form.kind === kind ? 'bg-primary text-on-primary' : 'text-on-surface',
                    ]"
                  >
                    {{ t.kinds[kind] }}
                  </button>
                </div>
              </details>
            </label>
            <label class="space-y-1.5 md:col-span-3">
              <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.branch }}</span>
              <input
                :value="form.branch"
                @input="(event) => store.updateProjectForm({ branch: (event.target as HTMLInputElement).value })"
                class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </label>
            <label class="space-y-1.5 md:col-span-6">
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
                :class="[
                  'grid grid-cols-1 md:grid-cols-[auto_repeat(12,minmax(0,1fr))] gap-2 rounded-lg border border-border-subtle bg-surface-container-low p-2 transition-all',
                  draggedScriptId === script.id ? 'opacity-55 ring-1 ring-primary/40' : '',
                ]"
              >
                <div
                  class="hidden md:flex items-center justify-center text-on-surface-variant cursor-grab active:cursor-grabbing"
                  draggable="true"
                  @dragstart="handleScriptDragStart($event, script.id)"
                  @dragend="draggedScriptId = null"
                  role="button"
                  tabindex="0"
                  :aria-label="`拖拽排序 ${script.name || t.modal.scriptName}`"
                >
                  <GripVertical :size="16" />
                </div>
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
                    (event) => store.updateScriptEntry(script.id, { command: (event.target as HTMLInputElement).value })
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
                  <option v-for="suggestion in store.projectFormCwdSuggestions" :key="suggestion" :value="suggestion" />
                </datalist>
                <input
                  :value="script.note"
                  @input="
                    (event) => store.updateScriptEntry(script.id, { note: (event.target as HTMLInputElement).value })
                  "
                  placeholder="note"
                  class="md:col-span-3 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                />
                <div class="md:col-span-1 flex min-h-8 items-center justify-end gap-1">
                  <button
                    type="button"
                    @click="store.removeScriptEntry(script.id)"
                    class="rounded-md border border-border-subtle p-1.5 text-on-surface-variant hover:text-status-error hover:bg-surface"
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
                    (event) => store.updateEnvironmentEntry(entry.id, { key: (event.target as HTMLInputElement).value })
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
            class="px-4 py-2 rounded-lg bg-primary-container text-on-primary text-sm font-bold hover:bg-primary flex items-center gap-2"
          >
            <Save :size="16" /> {{ t.modal.saveProject }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
