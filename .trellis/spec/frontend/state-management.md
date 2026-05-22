# State Management

> How state is managed in this project.

---

## Overview

Pinia is the only global state layer in the app. `src/store/useStore.ts` owns the current project catalog, selected project id, terminal logs, staged file data, todos, and memo content.

Local UI state stays inside components when it only affects one panel or one interaction, such as the active tab in `ProjectDetails.vue` or the copied state in `Terminal.vue`.

---

## State Categories

Current categories:

- local UI state: tab selection, copied flags, scroll references, input text
- global app state: selected project, project list, logs, staged files, todo list, memo content
- derived state: `selectedProject` getter in the store
- server state: none today
- URL state: none today

---

## When to Use Global State

Promote state to the store when multiple views need the same data or one view must update another view immediately.

Good candidates in the current app include:

- selected project id
- project status changes
- log output visible in the terminal panel
- memo and todo content shared across tabs
- project form drafts, because create/edit flows update multiple panels and store-owned domain state
- preload bridge results such as Git snapshots and running process metadata

Do not move purely visual state into the store if a component can manage it locally.

---

## Server State

There is no server state cache today. All data is in-memory and seeded in the store.

If the app later talks to a real backend or file system adapter, keep the fetched data behind a store action or composable so the UI does not need to care where it came from.

The current uTools integration follows this rule: UI components call store actions, store actions call `src/lib/projectBridge.ts`, and the bridge delegates to `window.projectBridge` from `public/preload.js` when running inside uTools.

## Scenario: Project Metadata Persistence Boundary

### 1. Scope / Trigger

- Trigger: project metadata is edited in the Vue form, normalized in the Pinia store, persisted through browser fallback or uTools preload storage, then hydrated again after plugin restart.

### 2. Signatures

- `Project` includes display metadata such as `type`, `kind`, and optional `icon`.
- `ProjectFormValue` includes the same editable metadata fields.
- Store persistence path: `saveProjectForm()` -> `persistProjects()` -> `bridge.saveProjects(...)`.
- uTools preload persistence path: `writeStoredProjects(projects)` -> per-project docs containing `project: toStoredProject(project)`.

### 3. Contracts

- Every user-visible project metadata field that should survive restart must be written by both store-side persistence (`toPersistedProject` in `src/store/useStore.ts`) and preload-side persistence (`toStoredProject` in `public/preload.js`).
- Browser fallback and uTools preload storage must preserve the same logical project fields. A field working in browser/local state is not enough if preload drops it during doc writes.
- `type`, `kind`, and `icon` are linked metadata: icon selection may update type/kind, and all three must round-trip together.
- Path inspection may infer metadata for new/blank forms, but it must not overwrite an explicit user-selected icon when the draft already has one.
- Hydration may infer an icon only as a fallback when persisted data has no icon.

### 4. Validation & Error Matrix

- Missing persisted `icon` -> hydrate with `inferProjectIcon(kind, type, name)`.
- Missing persisted `type` or `kind` -> keep existing defaults or normalize to a safe custom project type.
- Preload `toStoredProject` omits a new metadata field -> field appears to work until plugin restart, then is lost.
- Path inspection after manual icon selection -> keep selected icon, only update other inferred metadata when appropriate.

### 5. Good/Base/Bad Cases

- Good: selecting a Vue/AI/Docker icon updates the form, saves `type/kind/icon`, and the same icon appears after plugin restart.
- Base: older stored projects without `icon` still load with an inferred icon.
- Bad: adding `Project.icon` and store persistence but forgetting `public/preload.js#toStoredProject`, causing uTools db docs to drop the field.

### 6. Tests Required

- `npm run build` after changing shared project metadata or persistence code.
- Manual smoke test in uTools: edit a project icon/type, restart the plugin, and confirm the icon/type are still present.
- Manual smoke test in browser preview: save and reload from fallback storage.
- Regression check: trigger path inspection after choosing an icon and verify the explicit icon is not reset unexpectedly.

### 7. Wrong vs Correct

#### Wrong

```js
function toStoredProject(project) {
  return { id: project.id, name: project.name, path: project.path };
}
```

This drops user-visible metadata at the preload persistence boundary.

#### Correct

```js
function toStoredProject(project) {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    type: project.type || "Custom",
    kind: project.kind || "custom",
    icon: project.icon || "custom",
  };
}
```

Keep persisted project docs aligned with the shared `Project` shape whenever the UI adds metadata that must survive restart.

## Scenario: Project File Browser Bridge

## Scenario: External Tool Preferences

### 1. Scope / Trigger

- Trigger: user-configured external tools such as terminals and editors are shared by settings UI, project detail actions, store persistence, and preload bridge launch behavior.

### 2. Signatures

- `terminalPreferences` and `editorPreferences` live in the Pinia store.
- Store actions own updates: `setDefaultTerminal(...)`, `setDefaultEditor(...)`, and custom command setters.
- Project actions own launches: `openProjectInTerminal(projectId)` and `openProjectInEditor(projectId)`.

### 3. Contracts

- Settings components update preferences only through store actions.
- Project detail components launch external tools only through project-id store actions.
- Store actions must clone current preferences before passing them to the bridge to avoid accidental mutation during async work.
- Failed launches should append a project log entry instead of throwing into the component.

### 4. Validation & Error Matrix

- Project id missing -> no-op.
- Project path unavailable -> no-op and leave controls disabled in the component.
- Bridge returns `launched: false` -> append an `ERROR` log with the bridge message.
- Bridge throws -> catch in the store and append an `ERROR` log.

### 5. Good/Base/Bad Cases

- Good: settings selects Cursor, the store persists the preference, and the detail-page editor button uses it.
- Base: browser preview keeps the action safe and records unsupported behavior through fallback results.
- Bad: settings writes localStorage directly or a component spawns an editor command.

### 6. Tests Required

- `npm run lint` should verify store action and bridge types.
- Manual smoke test should cover changing editor settings, reloading, and launching from a project detail page.

### 7. Wrong vs Correct

#### Wrong

```ts
store.editorPreferences.kind = "cursor";
```

#### Correct

```ts
store.setDefaultEditor("cursor");
```

Let store actions persist preferences and keep bridge state synchronized.

## Scenario: Streaming AI Bridge Actions

### 1. Scope / Trigger

- Trigger: a component needs progressive AI output while the actual provider call crosses Vue component -> Pinia store -> project bridge -> uTools preload.
- Applies to Git AI analysis flows, including the Git tab batch "AI生成" dialog and commit detail AI analysis panel.

### 2. Signatures

- Type contract: `ProjectBridge.analyzeWithAiStream(payload, onChunk, onDone): Promise<void>`.
- Store action: `analyzeGitWithAiStream(projectId: string, prompt: string, handlers?: AiStreamHandlers): Promise<AiAnalyzeResult | undefined>`.
- Handler shape: `onStart?: () => void`, `onChunk?: (chunk: string) => void`, `onDone?: (result: AiAnalyzeResult) => void`.
- `AiPreferences.provider` is one of `"utools"`, `"openai-compatible"`, or `"anthropic-compatible"`; legacy stored values `"openai"`, `"anthropic"`, and `"openai-responses"` normalize to the nearest supported compatible provider.
- `AiPreferences.modes` stores configurable prompt modes with `{ id, name, prompt, builtIn }` and is shared by settings plus both Git AI entry points.

### 3. Contracts

- Components own view-specific streaming text when the result only belongs to one dialog or panel.
- Components may keep a local reveal buffer/timer when providers return one large chunk or fallback content, so the UI still visibly progresses without changing the bridge contract.
- Store actions own provider preferences and project lookup, then delegate to the bridge with cloned AI preferences.
- `onStart` fires before bridge delegation starts.
- `onChunk` may fire zero or more times and should append text in the component or caller-owned state.
- `onDone` must fire exactly once for every started analysis path, including validation failures and thrown bridge errors.
- OpenAI-compatible and Anthropic-compatible providers use real SSE / `ReadableStream` parsing in preload and emit chunks as provider deltas arrive.
- uTools built-in AI currently returns a single non-streaming result; preload must not fake stream it by sending the full content through `onChunk`. Return the full content in `onDone.content` and include a user-visible message that uTools is non-streaming.
- Browser preview fallback is also non-streaming; it should call `onDone` only and avoid pretending preview output is incremental.
- API keys stay inside `AiPreferences` storage and request headers. Do not include keys in user-visible messages, model refresh errors, logs, or AI result text.

### 4. Validation & Error Matrix

- Missing project id -> call `onDone({ ok: false, content: "", message: "项目不存在，无法进行 AI 分析。" })` and return that result.
- Empty prompt -> preload returns `ok: false` through `onDone` with an empty-content message.
- Incomplete third-party AI config -> preload returns `ok: false` through `onDone`; component leaves loading state.
- Third-party model list refresh without base URL or API key -> return an empty model list so the user can manually enter a model id.
- Third-party non-2xx response -> parse the provider error message when available and surface it through model test or AI result state without exposing headers or API keys.
- uTools provider selected without a model -> model test and generation return a warning/error asking the user to select a uTools model.
- Bridge throws before calling `onDone` -> store catches and calls `onDone` with an error result.
- Bridge calls `onDone` then throws -> store must not call `onDone` a second time.

### 5. Good/Base/Bad Cases

- Good: a commit detail panel keeps its own `streamingText`, appends chunks, and switches from loading to success/warning/error in `onDone`.
- Good: settings edits an AI mode prompt, and both the batch Git AI dialog and commit detail AI panel use that prompt on their next generation.
- Base: uTools built-in AI returns one full content string in `onDone.content`; the UI shows it after completion with a non-streaming fallback message.
- Base: a third-party provider sends small SSE deltas and the component appends them directly into its local result text.
- Bad: a component sets loading before calling the store action, the bridge throws, and no `onDone` handler clears loading.
- Bad: emitting the full uTools result via `onChunk` to create the appearance of streaming.

### 6. Tests Required

- `npm run lint` after changing `ProjectBridge`, `AiAnalyzeResult`, or store AI actions.
- `npm run build` after changing Vue templates that render streaming output.
- Manual smoke test with a third-party provider: verify text appears progressively and the final state changes from loading to success.
- Manual smoke test with invalid AI config: verify the panel shows an error and does not remain loading.
- Manual smoke test for uTools: verify the result appears only when the full response returns and the UI explains that uTools is non-streaming.
- Manual smoke test for settings: edit/add/delete/restore prompt modes, then generate from both Git AI entry points and confirm the selected mode is used.

### 7. Wrong vs Correct

#### Wrong

```ts
const result = await window.utools.ai(payload);
onChunk(String(result.content || result.text || result || ""));
onDone({ ok: true, content: String(result.content || result.text || result || "") });
```

This makes a complete uTools response look like streaming output and duplicates the result path.

#### Correct

```ts
let completed = false;
try {
  await bridge.analyzeWithAiStream(payload, onChunk, (result) => {
    completed = true;
    onDone(result);
  });
} catch (error) {
  if (!completed) {
    onDone({ ok: false, content: "", message: error instanceof Error ? error.message : "AI 分析失败。" });
  }
}
```

Every async path reports a terminal result exactly once, so UI panels can clear loading state reliably.

For uTools in preload, the provider branch should complete through `onDone` only:

```js
const result = await analyzeWithAi({ preferences, prompt });
done({
  ...result,
  message: result.message || "uTools 内置 AI 当前不支持真实流式，已按完整结果返回。",
});
```

## Scenario: Todo Drag Reordering

### 1. Scope / Trigger

- Trigger: the memo tab supports drag reordering of todo items and the new order must survive component re-renders.

### 2. Signatures

- `reorderTodo(projectId: string, todoId: string, targetTodoId: string): void`

### 3. Contracts

- Todo order is owned by the Pinia store, not the memo component.
- Components surface drag handles and call the store action with source/target todo ids.
- The store keeps completed and incomplete items in the same array and preserves the selected order after reordering.
- `syncProjectTodos(projectId)` remains the persistence boundary after any todo mutation.

### 4. Validation & Error Matrix

- Missing project, source todo, or target todo -> no-op.
- Source and target ids are equal -> no-op.
- Reorder after a drag drop -> update store order and persist through `syncProjectTodos`.
- Component-local arrays should not become the source of truth.

### 5. Good/Base/Bad Cases

- Good: dragging a todo above another item updates the list order and survives a refresh.
- Base: an empty todo list still renders the empty state and does not expose drag controls.
- Bad: the component mutates a local array and hopes the store will notice later.

### 6. Tests Required

- `npm run lint` should verify the store action and component event types.
- `npm run build` should verify the memo tab compiles with drag handles and the split layout.
- Manual smoke test: add todos, drag one item, toggle completion, and confirm the order stays stable.

### 7. Wrong vs Correct

#### Wrong

```ts
todoList.splice(targetIndex, 0, todoList.splice(currentIndex, 1)[0]);
```

#### Correct

```ts
store.reorderTodo(projectId, todoId, targetTodoId);
```

Let the store own reorder semantics so memo content, persistence, and project snapshots stay aligned.

## Scenario: Non-blocking Script Stop Flow

### 1. Scope / Trigger

- Trigger: stopping a running script from the dashboard or project detail view should feel immediate and should not wait on the bridge kill call before the UI updates.

### 2. Signatures

- `stopScript(projectId: string, scriptId: string): Promise<void>`
- `stopRunningScriptsForPluginExit(): void`

### 3. Contracts

- Store actions update local script and project status first so the UI reflects the stop request immediately.
- PID termination should be best-effort and fire asynchronously after the UI state is updated.
- `persistProjects()` should run in the background after the local state change so state survives reloads even if the bridge kill is still in flight.
- Bridge exit events still own the final reconciliation when the process reports back.

### 4. Validation & Error Matrix

- Missing project/script or non-running script -> no-op.
- PID missing -> still update local status and logs, skip bridge kill.
- Bridge stop fails -> swallow the failure for the stop action path and keep the UI responsive.
- Exit event arrives after optimistic stop -> leave the script/project in stopped state.

### 5. Good/Base/Bad Cases

- Good: clicking stop flips the script badge to stopped immediately and the bridge kill finishes later.
- Base: plugin-exit cleanup marks all running scripts stopped and persists the new state without blocking the UI thread.
- Bad: awaiting `bridge.stopProcess(pid)` before clearing local status, which makes the card feel frozen.

### 6. Tests Required

- `npm run lint` should verify the store action still types cleanly.
- `npm run build` should verify the dashboard and detail views still compile.
- Manual smoke test should cover stopping a running script from both the card and the project detail view.

### 7. Wrong vs Correct

#### Wrong

```ts
if (script.pid) {
  await bridge.stopProcess(script.pid);
}
script.status = "STOPPED";
```

#### Correct

```ts
const pid = script.pid;
script.status = "STOPPED";
script.pid = undefined;
void bridge.stopProcess(pid).catch(() => undefined);
```

Update local state first, then let the bridge stop the process in the background.

---

## Scenario: Project File Browser Bridge

### 1. Scope / Trigger

- Trigger: project file browsing and lightweight editing cross the Vue component, Pinia store, browser fallback bridge, and uTools preload filesystem boundary.

### 2. Signatures

- `ProjectBridge.listProjectFiles(projectPath: string, relativePath?: string): Promise<ProjectFileTreeEntry[]>`
- `ProjectBridge.readProjectFile(projectPath: string, relativePath: string): Promise<ProjectFileReadResult>`
- `ProjectBridge.writeProjectFile(projectPath: string, relativePath: string, content: string): Promise<ProjectFileWriteResult>`

### 3. Contracts

- UI components must call store actions for file operations; they must not call `window.projectBridge` directly.
- `listProjectFiles` loads only one directory level per call. Directory expansion in the UI should request the next level on demand instead of recursively scanning a whole project.
- The preload layer must resolve file paths under the project root and reject path traversal attempts that escape the root.
- The file tree must hide heavyweight or generated directories by default, including `node_modules`, `.git`, `.venv`, build output, and cache directories.
- Text files may be read and written as UTF-8. Lightweight binary previews such as small images may return a preview payload; unknown binary files should return an unsupported result rather than being exposed as editable text.
- Browser fallback must return safe empty/unsupported results and keep the same async API shape so the UI can render in preview mode.

### 4. Validation & Error Matrix

- Empty or missing `projectPath` -> return an empty tree or unsupported read result.
- Missing path on disk -> return an empty tree or a file read/write failure result; do not crash the UI.
- Relative path escapes the project root -> reject the operation.
- Directory is ignored -> omit it from tree results.
- File is too large or binary/unsupported -> return a non-editable preview/error state instead of decoding as text.

### 5. Good/Base/Bad Cases

- Good: opening the file tab loads only root-level entries, then expanding `src` loads just `src` children.
- Good: double-clicking a text file enters edit mode and saving goes through the store action, bridge, and preload boundary.
- Base: browser preview shows an empty or unavailable file browser without throwing.
- Bad: recursively scanning the whole project tree on tab mount.
- Bad: reading an unknown binary file as UTF-8 and enabling save.

### 6. Tests Required

- `npm run lint` should verify shared bridge types across `src/types.ts`, `src/lib/projectBridge.ts`, store actions, and components.
- `npm run build` should verify the Vue file-browser components compile.
- Manual smoke test: open file tab, expand a nested directory, preview a text file, edit/save it, and confirm ignored directories do not appear.

### 7. Wrong vs Correct

#### Wrong

```ts
const entries = await window.projectBridge.listProjectFiles(project.path, "src");
```

This bypasses the store boundary and makes fallback/error behavior inconsistent.

#### Correct

```ts
const entries = await store.listProjectFiles(project.id, "src");
```

Let the store own bridge calls and normalize errors before the component renders them.

## Scenario: Git History Pagination

### 1. Scope / Trigger

- Trigger: Git history crosses the Vue component, Pinia store, browser fallback bridge, and uTools preload Git command boundary.

### 2. Signatures

- `ProjectBridge.readGitSnapshot(projectPath: string, options?: { limit?: number; skip?: number }): Promise<ProjectBridgeGitSnapshot>`
- `loadMoreGitCommits(projectId: string): Promise<void>`

### 3. Contracts

- Initial Git refresh should request a bounded page of commits, currently `limit: 80` and `skip: 0`.
- Loading more commits must request the next page using `skip: project.git.commits.length`, then append the returned commits in the store.
- The preload bridge should request `limit + 1` commits from `git log` to derive `hasMoreCommits`, then trim the returned page to `limit`.
- UI components should use `hasMoreCommits` to show an explicit load-more affordance instead of rendering the full repository history.

### 4. Validation & Error Matrix

- Missing Git repository -> return an empty snapshot with `hasMoreCommits: false`.
- Invalid `limit` or `skip` -> clamp to a safe bounded page in preload.
- Loading more with no existing snapshot -> no-op.

### 5. Good/Base/Bad Cases

- Good: the Git tab shows the first page quickly and appends another page only when the user asks for more.
- Base: a small repository returns fewer than `limit` commits and hides the load-more control.
- Bad: running `git log --all` without a max count and rendering every commit.

### 6. Tests Required

- `npm run lint` should verify the bridge option signature across types, fallback bridge, store, and components.
- `npm run build` should verify the Git tab compiles with the pagination UI.

### 7. Wrong vs Correct

#### Wrong

```ts
const snapshot = await bridge.readGitSnapshot(project.path);
```

This depends on bridge defaults and can drift toward unbounded history reads.

#### Correct

```ts
const snapshot = await bridge.readGitSnapshot(project.path, { limit: 80, skip: project.git?.commits.length || 0 });
```

Always make the intended page size and offset explicit at the store boundary.

## Scenario: Git File Diff Preview

### 1. Scope / Trigger

- Trigger: a Git changed-file diff crosses the Git tab, Pinia store, browser fallback bridge, and uTools preload Git command boundary.

### 2. Signatures

- `ProjectBridge.readGitFileDiff(projectPath: string, relativePath: string): Promise<ProjectGitFileDiffResult>`
- `ProjectGitFileDiffResult = { path: string; diff: string; message?: string }`
- `readGitFileDiff(projectId: string, relativePath: string): Promise<ProjectGitFileDiffResult | null>`

### 3. Contracts

- UI components must call the store action, not `window.projectBridge` or Git directly.
- `relativePath` is project-relative and must be resolved under the Git repository root in preload before running Git.
- The bridge should combine staged and unstaged diff output for the selected file when both exist.
- Untracked files may use `git diff --no-index` against `os.devNull`; this command returns exit code `1` when differences exist, so diff-specific command handling must preserve stdout instead of treating all non-zero exits as empty output.
- Browser fallback must return an empty diff with a user-facing message.

### 4. Validation & Error Matrix

- Missing Git repository -> return `{ path, diff: "", message: "未检测到 Git 仓库" }`.
- Empty path -> return an empty diff with a choose-file message.
- Path traversal outside repository -> reject through the existing child-path resolver.
- No staged/unstaged/untracked diff -> return an empty diff with a user-facing unavailable message.

### 5. Good/Base/Bad Cases

- Good: Git tab asks `store.readGitFileDiff(project.id, file.path)` and renders the returned diff or message.
- Base: deleted files can show a diff even though they cannot be opened in the Files tab.
- Bad: using the generic `runGit` helper for `git diff --no-index`, which drops valid diff stdout because the command exits with code `1`.

### 6. Tests Required

- `npm run lint` should verify the bridge contract across `src/types.ts`, fallback bridge, store, and components.
- `npm run build` should verify the Git diff UI compiles.
- Manual smoke test: modified, staged, deleted, and untracked files each show either diff text or an explicit unavailable message.

### 7. Wrong vs Correct

#### Wrong

```ts
const diff = await window.projectBridge.readGitFileDiff(project.path, file.path);
```

This bypasses store fallback behavior and makes the component depend on the preload boundary.

#### Correct

```ts
const diff = await store.readGitFileDiff(project.id, file.path);
```

Keep Git diff reads behind the store action so fallback, unavailable projects, and UI state stay consistent.

## Scenario: Project Catalog Persistence

### 1. Scope / Trigger

- Trigger: project catalog data crosses the Vue store, browser fallback, and uTools preload storage boundary.

### 2. Signatures

- `ProjectBridge.loadProjects(): Promise<Project[]>`
- `ProjectBridge.saveProjects(projects: Project[]): Promise<void>`
- `ProjectBridge.inspectProjectPath(projectPath: string): Promise<ProjectPathInspection>`
- `ProjectBridge.exportProjects(payload: ProjectExportPayload): Promise<void>`
- `ProjectBridge.importProjects(): Promise<ProjectImportPayload | null>`

### 3. Contracts

- In uTools, persist the project catalog as one `utools.db` document per project, not as one whole-catalog `dbStorage` key. Use a stable prefix such as `utools-project-launch/project/<projectId>` so cloud sync conflicts stay localized to individual projects.
- When updating existing uTools db documents, read/preserve `_rev` before `put`; when deleting projects, remove only documents under the project prefix that are absent from the current catalog.
- In a real uTools bridge environment, do not seed `demoProjects` before persistence loading in a way that can mask empty or failed storage reads. Demo data is only for browser/no-bridge preview.
- Persist only sync-safe project metadata: ids, names, paths, kind/type, descriptions, scripts, environment values, memo, timestamps, and schema version.
- If a dashboard needs Git recency before the Git tab is opened, persist only a lightweight summary field such as `gitLatestCommitAt`; keep full Git snapshots transient and refresh them through `readGitSnapshot` when the user requests Git details.
- Do not persist local runtime state such as running script status, process ids, transient logs, or stale Git snapshots.
- The preload bridge export must point `window.projectBridge.loadProjects` at the same reader that performs the current migration path. If the helper is renamed, update the bridge export in the same change.
- Treat path availability as device-derived state. A project whose path is missing on the current device remains in the catalog but is classified as unavailable until edited to a valid path.

### 4. Validation & Error Matrix

- Storage unavailable -> return an empty project list or no-op save in fallback mode; do not crash UI startup.
- Old single-key `dbStorage` data exists but no project db docs exist -> load the legacy payload once and migrate it into per-project db documents when uTools db is available.
- `window.projectBridge.loadProjects` points to a missing or stale helper -> new plugin instances fail to load saved projects; fix the export before debugging store hydration.
- uTools `allDocs` returns rows, docs, ids, or wrapper objects -> normalize to project doc ids and read full docs with `db.get` when needed; skip error-shaped results.
- Path inspection fails -> preserve manual form editing and show feedback; do not block save only because inspection failed.
- Imported JSON has unsupported shape -> reject/skip invalid records and report the import result.
- Duplicate import candidate -> skip or merge explicitly; never silently overwrite an existing project.

### 5. Good/Base/Bad Cases

- Good: synced project lands on another device with a missing path, appears in the unavailable section, and can be restored by editing the path.
- Base: browser preview uses local fallback storage and keeps the same store actions as uTools.
- Bad: saving the entire synced catalog into one `dbStorage` key, making cloud conflicts overwrite unrelated projects.
- Bad: saving `RUNNING` script state or `pid` to uTools storage, then restoring it as if the process still existed.
- Bad: persisting the full `ProjectGitSnapshot` only to drive dashboard timestamps; this bloats startup storage and can make plugin launch feel slow.

### 6. Tests Required

- Build/type-check should prove the bridge contract stays in sync across `src/types.ts`, `src/lib/projectBridge.ts`, and store actions.
- Manual uTools smoke test should cover create, reload, import/export, missing-path display, and path restoration.
- Manual smoke test after Git-related persistence changes: refresh Git once, reload the plugin, and confirm dashboard cards can show the persisted `gitLatestCommitAt` without forcing a full Git refresh on startup.

### 7. Wrong vs Correct

#### Wrong

```ts
await bridge.saveProjects(this.projects);
```

This can leak local runtime details into synchronized storage.

#### Correct

```ts
await bridge.saveProjects(this.projects.map((project) => toPersistedProject(project)));
```

Normalize projects before crossing the persistence boundary.

#### Wrong

```js
window.projectBridge = {
  loadProjects: readStoredProjects,
};
```

This silently breaks new plugin loads when `readStoredProjects` is stale or missing.

#### Correct

```js
window.projectBridge = {
  loadProjects: readProjects,
};
```

Keep the bridge export aligned with the actual reader that handles current storage and legacy migration.

---

## Common Mistakes

- Duplicating the same project data in multiple components
- Storing view-only toggles in the global store
- Assuming store data persists across reloads
- Mutating nested records in ad hoc ways outside the store actions
- Letting derived state drift instead of reading from a getter
- Calling `window.projectBridge` directly from feature components instead of going through store actions
- Persisting device-local runtime state, such as script `pid` or `RUNNING` status, into synced project catalog storage
- Sorting `projects` ad hoc in components. The project array order is user-controlled metadata and must be changed through store actions that persist the catalog.

## Scenario: Manual Project Ordering

### 1. Scope / Trigger

- Trigger: dashboard project ordering is user-visible state and crosses the store plus project catalog persistence boundary.

### 2. Signatures

- `moveProject(projectId: string, direction: "top" | "up" | "down", scopeProjectIds?: string[]): Promise<boolean>`
- `reorderProject(projectId: string, targetProjectId: string, scopeProjectIds?: string[]): Promise<boolean>`
- `ProjectBridge.saveProjects(projects: Project[]): Promise<void>`

### 3. Contracts

- The `projects` array order is the persisted manual dashboard order.
- Reorder projects only through store actions, then call `persistProjects()` so reloads preserve the order.
- Drag-and-drop dashboard ordering should call `reorderProject()` with the dragged project id and drop-target project id.
- Keep available and unavailable project sections separated when moving cards; moving an unavailable project must not insert it into the available section.
- When a filtered dashboard list provides `scopeProjectIds`, move only relative to visible projects in the same section while preserving non-visible projects in their original relative order.
- Do not introduce a separate order field unless the storage contract changes deliberately.

### 4. Validation & Error Matrix

- Unknown `projectId` -> return `false` and leave `projects` unchanged.
- Move beyond the section boundary -> return `false` and leave `projects` unchanged.
- Empty or invalid `scopeProjectIds` -> fall back to the full available/unavailable section order.
- Dragging onto the same project -> return `false` and leave `projects` unchanged.
- Dragging between available and unavailable sections -> return `false` and leave `projects` unchanged.
- Persistence failure -> surface the existing project storage message through `persistProjects()`.

### 5. Good/Base/Bad Cases

- Good: moving the second visible available project up swaps it with the previous visible available project and persists the new array order.
- Good: dragging one visible project onto another visible project moves the dragged project before the drop target and persists the new array order.
- Base: newly created projects still enter the front of the catalog through the existing create flow.
- Bad: sorting `store.availableProjects` alphabetically in the component, which hides the user's manual order and is not persisted.

### 6. Tests Required

- `npm run lint` should verify store action signatures and component event types.
- Manual smoke test: move a project to top, reload the plugin, and confirm the same order appears.
- Manual smoke test: enter dashboard sort mode, drag a card before another card, reload the plugin, and confirm the same order appears.
- Manual smoke test: search/filter projects, move a visible item, clear search, and confirm hidden items kept their relative order.

### 7. Wrong vs Correct

#### Wrong

```ts
const projects = computed(() => store.availableProjects.sort((a, b) => a.name.localeCompare(b.name)));
```

This mutates or masks the persisted manual order.

#### Correct

```ts
await store.moveProject(
  projectId,
  "up",
  visibleProjects.map((project) => project.id),
);
```

Let the store own project order changes and persistence.

For drag-and-drop sorting, use the drop target rather than mutating the array in the component:

```ts
await store.reorderProject(
  draggedProjectId,
  targetProjectId,
  visibleProjects.map((project) => project.id),
);
```

## Scenario: Script Runtime Status

### 1. Scope / Trigger

- Trigger: command execution crosses the store and preload process boundary.

### 2. Signatures

- `ProjectBridge.runCommand(...)` starts a process and returns a runtime `pid`.
- `ProjectBridge.stopProcess(pid)` stops that runtime process.
- `ProjectBridgeEvent` with `type: "exit"` may include `stoppedByUser`.

### 3. Contracts

- User-initiated stop must set the script to `STOPPED`, even if the operating system reports a non-zero exit code after killing the process tree.
- Full plugin termination (`onPluginOut(true)`) must reuse the same per-script `pid` stop path as manual stop, then converge running scripts to `STOPPED` before the renderer exits.
- The renderer's `onPluginOut(true)` handler must call `window.projectBridge.stopAllProcesses()` synchronously in the same turn after store convergence; do not rely on an async bridge call or a later lifecycle hook to finish backend cleanup.
- Do not add extra process-exit or unload-based cleanup hooks for plugin kill unless uTools behavior is revalidated; the current contract stays on `onPluginOut(true)` only.
- Only non-user-stopped exits with non-zero codes should become `ERROR`.
- Project card status should be derived from all scripts: any running script -> `RUNNING`; otherwise any error script -> `ERROR`; otherwise stopped/idle scripts -> `STOPPED`.
- Script order is user-controlled metadata and must be preserved by create/edit forms, persistence, import/export, and details display.

### 4. Validation & Error Matrix

- Stop requested with missing pid -> converge UI to stopped if the script is not running at the preload layer.
- Duplicate start request for a running script -> ignore it.
- Empty command -> do not start.

### 5. Good/Base/Bad Cases

- Good: user clicks stop, the process exits with a kill code, and UI shows stopped.
- Good: plugin kill calls the store shutdown action, each running script pid is passed to `stopProcess`, and Flask/Next-style reloader processes stop like they do on manual stop.
- Good: plugin kill can also clean up a detached shell/reloader child that is no longer in the active-process map, because the preload registry remembers every launched PID for the session.
- Good: plugin kill synchronously invokes preload cleanup after the store marks scripts stopped, so both Go and Flask backends are terminated even if the UI is exiting.
- Base: one script stops while another keeps running, and the project card remains running.
- Bad: treating every non-zero exit after `taskkill` as an application error.
- Bad: plugin kill relies only on a preload-level active process registry and skips the store's current running script pids.
- Bad: plugin kill only kills the shell wrapper and leaves Flask or similar reloader children bound to the port.

### 6. Tests Required

- Type-check event payload changes across `src/types.ts`, store handlers, and preload events.

## Scenario: Project Subdirectory Suggestions

### 1. Scope / Trigger

- Trigger: project form working-directory suggestions cross the Vue component, Pinia store, browser fallback bridge, and uTools preload filesystem boundary.

### 2. Signatures

- `ProjectBridge.listProjectSubdirectories(projectPath: string): Promise<string[]>`
- Store actions that refresh form directory suggestions should call the bridge, then expose only normalized relative directory names to the form UI.

### 3. Contracts

- The bridge returns one-level child directories relative to the project root.
- Include `.` as the root working directory option at the UI/store layer when useful for script cwd selection.
- Prefer common project directories such as `frontend`, `backend`, `client`, `server`, `api`, and `src` before other alphabetically sorted entries.
- Browser fallback must return a small safe suggestion set and never require local filesystem access.
- Preload must expand `~`, validate that the path exists and is a directory, and return an empty list on unavailable paths instead of throwing into the UI.

### 4. Validation & Error Matrix

- Empty `projectPath` -> return an empty suggestion list.
- Path does not exist -> return an empty suggestion list.
- Path exists but is not a directory -> return an empty suggestion list.
- Filesystem read fails -> return an empty suggestion list and keep manual cwd entry usable.

### 5. Good/Base/Bad Cases

- Good: a project with `frontend`, `backend`, and `docs` suggests `.`, `frontend`, `backend`, then `docs`.
- Base: browser preview shows generic suggestions but does not imply filesystem inspection succeeded.
- Bad: recursively scanning large project trees for cwd suggestions, which makes a simple form interaction slow and noisy.

### 6. Tests Required

- `npm run lint` should verify the bridge contract stays in sync across `src/types.ts`, `src/lib/projectBridge.ts`, store actions, and components.
- `npm run build` should verify preload-facing type changes do not break the frontend bundle.
- Manual uTools smoke test should cover selecting a real project folder and seeing one-level cwd suggestions in the script editor.

### 7. Wrong vs Correct

#### Wrong

```ts
const suggestions = await window.projectBridge.listProjectSubdirectories(path);
```

Components should not call the preload bridge directly.

#### Correct

```ts
await store.refreshProjectDirectorySuggestions();
```

Keep bridge access behind store actions so fallback behavior, sorting, and error handling remain centralized.

## Scenario: uTools Project Quick Open

### 1. Scope / Trigger

- Trigger: project quick-open behavior crosses `public/plugin.json`, the uTools `onPluginEnter` payload, `src/App.vue`, and the Pinia project store.

### 2. Signatures

- `window.utools.onPluginEnter(callback: (action: UToolsPluginEnterAction) => void): void`
- `openProjectByName(query: string): boolean`

### 3. Contracts

- `plugin.json` may expose a dynamic search entry for non-empty main-input text so users can open projects from the uTools launcher.
- `App.vue` owns the uTools enter callback because it coordinates app-level routing after projects load.
- Project matching belongs in the store. Components should call a store action instead of duplicating project lookup rules.
- Match project names by exact case-insensitive match first, then by case-insensitive substring match.
- When the matched project path is unavailable, open the edit form for that project instead of navigating to a broken detail view.
- The payload parser should tolerate uTools version differences by checking likely text fields such as `payload`, `text`, `keyword`, `cmd`, and `option`.

### 4. Validation & Error Matrix

- Empty query -> return `false` and leave the current view unchanged.
- No matching project -> return `false` and leave the current view unchanged.
- Matched unavailable project -> open edit form and return `true`.
- Matched available project -> select the project, switch to the projects tab, and return `true`.

### 5. Good/Base/Bad Cases

- Good: typing `color` in the uTools launcher opens the matching project detail/launch area.
- Base: typing a full project name opens the exact project even when another project only contains the same words.
- Bad: parsing only one payload field and silently failing on a different uTools version.

### 6. Tests Required

- `npm run lint` should verify `src/global.d.ts`, `App.vue`, and store action types remain aligned.
- `npm run build` should verify the plugin entry integration does not break the frontend bundle.
- Manual uTools smoke test should cover typing a project name into the main input and pressing Enter.

### 7. Wrong vs Correct

#### Wrong

```ts
const project = store.projects.find((item) => item.name === query);
store.selectedProjectId = project?.id || null;
```

This duplicates lookup rules and bypasses unavailable-project handling.

#### Correct

```ts
store.openProjectByName(query);
```

Keep quick-open matching and fallback behavior centralized in the store.

- Manual smoke test: start a long-running command, stop it, confirm script and card show stopped.

### 7. Wrong vs Correct

#### Wrong

```ts
script.status = event.code === 0 ? "STOPPED" : "ERROR";
```

#### Correct

```ts
script.status = event.stoppedByUser || event.code === 0 ? "STOPPED" : "ERROR";
```
