<script setup lang="ts">
import { computed } from "vue";
import { X, Plus, Trash2, Save } from "lucide-vue-next";
import { useStore } from "../../store/useStore";
import { useI18n } from "../../lib/i18n";
import type { ProjectKind, ProjectScriptGroup, ProjectScriptKind } from "../../types";

const store = useStore();
const t = useI18n();

const form = computed(() => store.projectFormDraft);
const title = computed(() => (store.projectFormMode === "edit" ? t.value.modal.editTitle : t.value.modal.createTitle));

const projectKinds: ProjectKind[] = ["node", "python", "go", "executable", "custom"];
const scriptGroups: ProjectScriptGroup[] = ["main", "frontend", "backend", "utility"];
const scriptKinds: ProjectScriptKind[] = ["npm-script", "command", "executable"];

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
    store.updateScriptEntry(form.value.scripts[0].id, {
      command,
      kind: kind === "node" ? "npm-script" : kind === "executable" ? "executable" : "command",
    });
  }
};

const handleSubmit = () => {
  if (!form.value.name.trim() || !form.value.path.trim()) {
    return;
  }

  store.saveProjectForm();
};
</script>

<template>
  <Teleport to="body">
    <div v-if="store.projectFormOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6">
      <div
        class="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-xl bg-surface border border-border-subtle shadow-2xl flex flex-col"
      >
        <header class="px-6 py-4 border-b border-border-subtle flex items-center justify-between bg-bg-soft-gray">
          <h2 class="text-lg font-bold text-on-surface">{{ title }}</h2>
          <button
            @click="store.closeProjectForm"
            class="p-2 rounded-lg text-on-surface-variant hover:bg-surface-variant hover:text-on-surface"
          >
            <X :size="18" />
          </button>
        </header>

        <div class="p-6 overflow-y-auto space-y-6">
          <section class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label class="space-y-2">
              <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.name }}</span>
              <input
                :value="form.name"
                @input="(event) => store.updateProjectForm({ name: (event.target as HTMLInputElement).value })"
                class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </label>
            <label class="space-y-2">
              <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.path }}</span>
              <input
                :value="form.path"
                @input="(event) => store.updateProjectForm({ path: (event.target as HTMLInputElement).value })"
                class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </label>
            <label class="space-y-2">
              <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.type }}</span>
              <select
                :value="form.kind"
                @change="(event) => updateKind((event.target as HTMLSelectElement).value as ProjectKind)"
                class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
              >
                <option v-for="kind in projectKinds" :key="kind" :value="kind">{{ t.kinds[kind] }}</option>
              </select>
            </label>
            <label class="space-y-2">
              <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.branch }}</span>
              <input
                :value="form.branch"
                @input="(event) => store.updateProjectForm({ branch: (event.target as HTMLInputElement).value })"
                class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </label>
            <label class="md:col-span-2 space-y-2">
              <span class="text-xs font-bold uppercase text-on-surface-variant">{{ t.modal.description }}</span>
              <textarea
                :value="form.description"
                @input="
                  (event) => store.updateProjectForm({ description: (event.target as HTMLTextAreaElement).value })
                "
                rows="2"
                class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
              />
            </label>
          </section>

          <section class="space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="font-bold text-on-surface">{{ t.modal.scripts }}</h3>
              <button @click="store.addScriptEntry" class="text-primary text-xs font-bold flex items-center gap-1.5">
                <Plus :size="14" /> {{ t.modal.addScript }}
              </button>
            </div>
            <p class="text-xs text-on-surface-variant">{{ t.modal.packageHint }}</p>
            <div class="space-y-3">
              <div
                v-for="script in form.scripts"
                :key="script.id"
                class="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 rounded-xl border border-border-subtle bg-bg-soft-gray/60"
              >
                <input
                  :value="script.name"
                  @input="
                    (event) => store.updateScriptEntry(script.id, { name: (event.target as HTMLInputElement).value })
                  "
                  :placeholder="t.modal.scriptName"
                  class="md:col-span-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
                <input
                  :value="script.command"
                  @input="
                    (event) => store.updateScriptEntry(script.id, { command: (event.target as HTMLInputElement).value })
                  "
                  :placeholder="t.modal.scriptCommand"
                  class="md:col-span-4 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
                <select
                  :value="script.group"
                  @change="
                    (event) =>
                      store.updateScriptEntry(script.id, {
                        group: (event.target as HTMLSelectElement).value as ProjectScriptGroup,
                      })
                  "
                  class="md:col-span-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                >
                  <option v-for="group in scriptGroups" :key="group" :value="group">{{ t.groups[group] }}</option>
                </select>
                <select
                  :value="script.kind"
                  @change="
                    (event) =>
                      store.updateScriptEntry(script.id, {
                        kind: (event.target as HTMLSelectElement).value as ProjectScriptKind,
                      })
                  "
                  class="md:col-span-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                >
                  <option v-for="kind in scriptKinds" :key="kind" :value="kind">{{ kind }}</option>
                </select>
                <input
                  :value="script.cwd"
                  @input="
                    (event) => store.updateScriptEntry(script.id, { cwd: (event.target as HTMLInputElement).value })
                  "
                  :placeholder="t.modal.scriptCwd"
                  class="md:col-span-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
                <button
                  @click="store.removeScriptEntry(script.id)"
                  class="md:col-span-1 rounded-lg border border-border-subtle text-on-surface-variant hover:text-status-error hover:bg-surface flex items-center justify-center"
                >
                  <Trash2 :size="16" />
                </button>
                <input
                  :value="script.stopCommand"
                  @input="
                    (event) =>
                      store.updateScriptEntry(script.id, { stopCommand: (event.target as HTMLInputElement).value })
                  "
                  :placeholder="t.modal.scriptStop"
                  class="md:col-span-12 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="font-bold text-on-surface">{{ t.modal.env }}</h3>
              <button
                @click="store.addEnvironmentEntry"
                class="text-primary text-xs font-bold flex items-center gap-1.5"
              >
                <Plus :size="14" /> {{ t.common.add }}
              </button>
            </div>
            <div class="space-y-2">
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
                  class="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
                <input
                  :value="entry.value"
                  @input="
                    (event) =>
                      store.updateEnvironmentEntry(entry.id, { value: (event.target as HTMLInputElement).value })
                  "
                  class="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
                <button
                  @click="store.removeEnvironmentEntry(entry.id)"
                  class="rounded-lg border border-border-subtle px-3 text-on-surface-variant hover:text-status-error hover:bg-bg-soft-gray"
                >
                  <Trash2 :size="16" />
                </button>
              </div>
            </div>
          </section>

          <section class="space-y-2">
            <h3 class="font-bold text-on-surface">{{ t.memo.title }}</h3>
            <textarea
              :value="form.memo"
              @input="(event) => store.updateProjectForm({ memo: (event.target as HTMLTextAreaElement).value })"
              rows="4"
              class="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
            />
          </section>
        </div>

        <footer class="px-6 py-4 border-t border-border-subtle bg-bg-soft-gray flex justify-end gap-3">
          <button
            @click="store.closeProjectForm"
            class="px-4 py-2 rounded-lg border border-border-subtle bg-surface text-sm font-semibold text-on-surface hover:bg-surface-variant"
          >
            {{ t.common.cancel }}
          </button>
          <button
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
