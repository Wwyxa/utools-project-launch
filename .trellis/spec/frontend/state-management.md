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

- `Project` includes display metadata such as `type`, `kind`, optional `icon`, optional `quickLink`, optional grouping metadata like `group`, and visibility metadata `visibility?: "public" | "private"` plus `ownerDeviceId?: string`.
- `ProjectFormValue` includes the same editable metadata fields, with optional persisted project fields normalized to form-safe strings.
- Store persistence path: `saveProjectForm()` -> `persistProjects()` -> `bridge.saveProjects(...)`.
- uTools preload persistence path: `writeStoredProjects(projects)` -> per-project docs containing `project: toStoredProject(project)`.
- Quick link launch path: dashboard/card action -> `openProjectQuickLink(projectId)` -> `bridge.openPath(quickLink)` -> browser fallback `window.open(...)` or uTools preload `shell.openExternal(...)` for URL-like targets.

### 3. Contracts

- Every user-visible project metadata field that should survive restart must be written by both store-side persistence (`toPersistedProject` in `src/store/useStore.ts`) and preload-side persistence (`toStoredProject` in `public/preload.js`).
- Browser fallback and uTools preload storage must preserve the same logical project fields. A field working in browser/local state is not enough if preload drops it during doc writes.
- `type`, `kind`, and `icon` are linked metadata: icon selection may update type/kind, and all three must round-trip together.
- `quickLink` is a project-level optional URL string. Trim it when moving between persisted projects, hydrated projects, form drafts, and saved projects; keep missing/legacy values as an empty string in form state and absent/empty in project state.
- `group` is project-level display metadata. Trim it at every boundary and treat missing or whitespace-only values as the ungrouped bucket in Dashboard UI while keeping form state as an empty string.
- `visibility` controls cross-device display only, not whether a project is stored. Missing legacy values normalize to `"public"`; new project forms default to `"private"` so they stay on the current device unless explicitly made public.
- `ownerDeviceId` is generated and stored in device-local browser storage. Private projects render only when `ownerDeviceId` matches the current device id; hidden private projects must remain in the project array so saving current-device changes does not delete other devices' private projects from shared storage.
- Components must call store actions for project quick links. Do not call `window.open`, `shell.openExternal`, or `bridge.openPath` directly from `ProjectCard.vue`.
- `bridge.openPath` may receive both file-system paths and quick-link URLs. The browser fallback and uTools preload must keep file paths opening through the existing path behavior while routing `http://`, `https://`, protocol-relative URLs, `mailto:`, and `utools:` URLs through external URL opening.
- Path inspection may infer metadata for new/blank forms, but it must not overwrite an explicit user-selected icon when the draft already has one.
- Hydration may infer an icon only as a fallback when persisted data has no icon.

### 4. Validation & Error Matrix

- Missing persisted `icon` -> hydrate with `inferProjectIcon(kind, type, name)`.
- Missing persisted `quickLink` -> hydrate/form value is `""`; dashboard renders no quick-link button and reserves no empty slot.
- Whitespace-only `quickLink` -> normalize to `""` before persisting or rendering.
- Missing persisted `group` -> hydrate/form value is `""`; dashboard displays the project under the localized ungrouped label.
- Whitespace-only `group` -> normalize to `""` before persisting, grouping, or rendering.
- Missing persisted `visibility` -> normalize to `"public"` for backward compatibility.
- Private project with a different `ownerDeviceId` -> keep it in state/persistence but exclude it from dashboard lists, search-open matching, path availability checks, refreshes, and sort operations.
- Configured URL-like `quickLink` -> open externally through the bridge and prevent card click bubbling in the component action.
- `bridge.openPath` receives a normal local folder/file path -> keep existing path opening behavior, not external URL handling.
- Missing persisted `type` or `kind` -> keep existing defaults or normalize to a safe custom project type.
- Preload `toStoredProject` omits a new metadata field -> field appears to work until plugin restart, then is lost.
- Path inspection after manual icon selection -> keep selected icon, only update other inferred metadata when appropriate.

### 5. Good/Base/Bad Cases

- Good: selecting a Vue/AI/Docker icon updates the form, saves `type/kind/icon`, and the same icon appears after plugin restart.
- Good: adding `http://localhost:3000` as a quick link saves, reloads, shows one compact dashboard card action, and opens without selecting the card.
- Base: older stored projects without `icon` still load with an inferred icon.
- Base: older stored projects without `quickLink` still open edit forms with an empty quick-link field.
- Base: older stored projects without `group` still open edit forms with an empty group field and appear under the ungrouped dashboard section.
- Base: older stored projects without `visibility` still appear on every device as public projects.
- Bad: filtering private projects out before persistence, which can remove another device's private projects the next time the current device saves.
- Bad: adding `Project.icon`, `Project.quickLink`, `Project.group`, or similar display metadata and store persistence but forgetting `public/preload.js#toStoredProject`, causing uTools db docs to drop the field.

### 6. Tests Required

- `npm run lint` and `npm run build` after changing shared project metadata or persistence code.
- Manual smoke test in uTools: edit a project icon/type, restart the plugin, and confirm the icon/type are still present.
- Manual smoke test in uTools: edit a project quick link, restart the plugin, and confirm the dashboard button is still present and opens the URL externally.
- Manual smoke test in browser preview: save and reload from fallback storage.
- Regression check: trigger path inspection after choosing an icon and verify the explicit icon is not reset unexpectedly.
- Regression check: projects without quick links should not gain an empty dashboard action slot.
- Regression check: create a private project, confirm it persists with the current `ownerDeviceId`, and confirm another device id would hide it without deleting it.

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
    quickLink: normalizeQuickLink(project.quickLink),
    group: normalizeProjectGroup(project.group),
    visibility: project.visibility === "private" ? "private" : "public",
    ownerDeviceId: project.ownerDeviceId || getCurrentDeviceId(),
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
- Terminal/editor preference storage keys are device-local (`utools-project-launch.local-settings.v1` and `utools-project-launch.local-editor-settings.v1`). Legacy shared keys may be read as a migration fallback, but writes must go only to device-local storage.
- Store actions own updates: `setDefaultTerminal(...)`, `setDefaultEditor(...)`, and custom command setters.
- Project actions own launches: `openProjectInTerminal(projectId)` and `openProjectInEditor(projectId)`.

### 3. Contracts

- Settings components update preferences only through store actions.
- Project detail components launch external tools only through project-id store actions.
- Store actions must clone current preferences before passing them to the bridge to avoid accidental mutation during async work.
- Default terminal and editor preferences are machine-specific. Do not write them to uTools shared `dbStorage`, because command names and install paths vary across synced devices.
- Failed launches should append a project log entry instead of throwing into the component.

### 4. Validation & Error Matrix

- Project id missing -> no-op.
- Project path unavailable -> no-op and leave controls disabled in the component.
- Missing device-local terminal/editor preference -> read the legacy shared key once as fallback, then persist future edits only under the local key.
- Bridge returns `launched: false` -> append an `ERROR` log with the bridge message.
- Bridge throws -> catch in the store and append an `ERROR` log.

### 5. Good/Base/Bad Cases

- Good: settings selects Cursor, the store persists the preference, and the detail-page editor button uses it.
- Good: device A selects Windows Terminal while device B selects PowerShell, and each device keeps its own preference after shared project data syncs.
- Base: browser preview keeps the action safe and records unsupported behavior through fallback results.
- Bad: settings writes localStorage directly or a component spawns an editor command.
- Bad: terminal/editor preferences are saved through uTools `dbStorage`, causing one device's external tool choice to overwrite another device's local setup.

### 6. Tests Required

- `npm run lint` should verify store action and bridge types.
- Manual smoke test should cover changing editor settings, reloading, and launching from a project detail page.
- Manual smoke test should cover changing terminal/editor settings on one device without changing another synced device's settings.

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
- `AiAnalyzeResult = { ok: boolean; content: string; reasoning?: string; rawContent?: string; message?: string }`.
- `AiStreamChunk = { content?: string; reasoning?: string; rawContent?: string }`.
- `AiStreamChunkPayload = string | AiStreamChunk`; legacy string chunks remain valid for fallback and browser preview paths.
- Handler shape: `onStart?: () => void`, `onChunk?: (chunk: AiStreamChunkPayload) => void`, `onDone?: (result: AiAnalyzeResult) => void`.
- `AiPreferences.provider` is one of `"utools"`, `"openai-compatible"`, or `"anthropic-compatible"`; legacy stored values `"openai"`, `"anthropic"`, and `"openai-responses"` normalize to the nearest supported compatible provider.
- `AiPreferences.modes` stores configurable prompt modes with `{ id, name, prompt, builtIn, kind }` and is shared by settings plus Git AI entry points.
- The commit-message prompt is represented as a fixed built-in mode with `id: "commit-message"` and `kind: "commit-message"`. Normal Git history AI mode pickers must filter it out, while AI commit message generation reads that fixed mode prompt. Browser fallback storage and uTools preload storage must normalize older `commitMessagePrompt` preferences into this fixed mode.
- Git AI prompt text should stay general in Settings. Normal batch analysis and commit-detail analysis must automatically append repository/status/commit/file-list context at runtime instead of relying on users to insert placeholder tokens. Existing saved prompt placeholders remain supported as backward compatibility: normal batch Git AI prompts may still replace `{repositoryPath}`, `{branch}`, `{statusText}`, `{changedFiles}`, and `{commits}`; commit detail AI prompts may still replace `{repositoryPath}`, `{branch}`, `{statusText}`, `{changedFiles}`, `{commitHash}`, `{commitMessage}`, `{commitBody}`, `{commitAuthor}`, `{commitDate}`, `{commitRefs}`, and `{commitFiles}`. Commit-message generation keeps its separate diff placeholders `{diffScope}`, `{diffContent}`, and `{truncatedNote}` for older saved templates, but default prompts should be general and the component must append the staged/working-tree diff when the template omits `{diffContent}`.

### 3. Contracts

- Components own view-specific streaming text when the result only belongs to one dialog or panel.
- Components may keep a local reveal buffer/timer when providers return one large chunk or fallback content, so the UI still visibly progresses without changing the bridge contract.
- Store actions own provider preferences and project lookup, then delegate to the bridge with cloned AI preferences.
- `onStart` fires before bridge delegation starts.
- `onChunk` may fire zero or more times and should append structured chunks in the component or caller-owned state.
- `onDone` must fire exactly once for every started analysis path, including validation failures and thrown bridge errors.
- OpenAI-compatible and Anthropic-compatible providers use real SSE / `ReadableStream` parsing in preload and emit chunks as provider deltas arrive.
- uTools built-in AI supports real streaming through `utools.ai(option, streamCallback)`. The preload `provider === "utools"` branch should call the streaming signature, keep `delta.reasoning_content` in `chunk.reasoning`, keep `delta.content` in `chunk.content`, and keep `chunk.rawContent` as the provider-order concatenation for conservative parsing/debug preservation. User-facing copy actions should copy `content`, not `rawContent`.
- OpenAI-compatible streams should preserve provider reasoning fields such as `delta.reasoning_content`, `delta.reasoning`, `delta.thinking`, or `message.reasoning_content` separately from `delta.content` when present.
- Components should use the shared AI reasoning stream helpers to merge chunks, parse conservative inline tags, and render final content. Do not concatenate structured reasoning into the visible answer before the UI has a chance to collapse it.
- AI commit message generation should write only the final visible content into the Git commit textarea. It must not render a separate generated-result box in the changed-files sidebar and must not copy structured reasoning or raw preservation text into the textarea.
- Settings prompt editors must not show placeholder help buttons or tooltip/popover guidance. Prompt editing UX should encourage general instructions; runtime Git AI flows append the required context automatically.
- Inline reasoning-tag fallback is conservative: split only complete block-start tags (`<think>`, `<thinking>`, `<reasoning>`) outside Markdown fences and inline code. Incomplete tags or tags embedded in ordinary prose/code stay in the visible content.
- Browser preview fallback is also non-streaming; it should call `onDone` only and avoid pretending preview output is incremental.
- API keys stay inside `AiPreferences` storage and request headers. Do not include keys in user-visible messages, model refresh errors, logs, or AI result text.

### 4. Validation & Error Matrix

- Missing project id -> call `onDone({ ok: false, content: "", message: "项目不存在，无法进行 AI 分析。" })` and return that result.
- Empty prompt -> preload returns `ok: false` through `onDone` with an empty-content message.
- Incomplete third-party AI config -> preload returns `ok: false` through `onDone`; component leaves loading state.
- Third-party model list refresh without base URL or API key -> return an empty model list so the user can manually enter a model id.
- Third-party non-2xx response -> parse the provider error message when available and surface it through model test or AI result state without exposing headers or API keys.
- uTools provider selected without a model -> generation may omit `model` and let uTools use its documented default model; model test UI may still ask the user to select an explicit model when validating a specific choice.
- Structured reasoning delta present -> append it to reasoning state and raw preservation state, not to visible content or user-facing copy state.
- Complete block-start `<think>...</think>` text outside code -> collapse tag content into reasoning and render surrounding text as final content.
- Incomplete or inline/code-fenced reasoning tag -> leave the entire text visible; do not hide content.
- Bridge throws before calling `onDone` -> store catches and calls `onDone` with an error result.
- Bridge calls `onDone` then throws -> store must not call `onDone` a second time.

### 5. Good/Base/Bad Cases

- Good: a commit detail panel keeps its own `streamingText`, appends chunks, and switches from loading to success/warning/error in `onDone`.
- Good: a Git AI panel keeps `content`, `reasoning`, and `rawContent` in one local AI reasoning stream state, rendering reasoning through a default-collapsed block while final content continues streaming.
- Good: settings edits an AI mode prompt, and both the batch Git AI dialog and commit detail AI panel use that prompt on their next generation.
- Good: uTools built-in AI streams deltas via `onChunk` and returns the aggregated content in `onDone.content` when the streaming promise resolves.
- Base: a third-party provider sends small SSE deltas and the component appends them directly into its local result text.
- Base: a provider sends no reasoning fields; content renders exactly like the old path and no empty reasoning block appears.
- Bad: a component sets loading before calling the store action, the bridge throws, and no `onDone` handler clears loading.
- Bad: emitting the full uTools result via `onChunk` to create the appearance of streaming.
- Bad: joining `reasoning_content` and `content` into one string before calling `onChunk`, because the UI can no longer collapse reasoning reliably.

### 6. Tests Required

- `npm run lint` after changing `ProjectBridge`, `AiAnalyzeResult`, or store AI actions.
- `npm run validate:ai-reasoning` after changing inline tag parsing, stream merging, or AI reasoning display behavior.
- `npm run build` after changing Vue templates that render streaming output.
- Manual smoke test with a third-party provider: verify text appears progressively and the final state changes from loading to success.
- Manual smoke test with invalid AI config: verify the panel shows an error and does not remain loading.
- Manual smoke test for uTools: verify text appears progressively through `utools.ai(option, streamCallback)` and the final state uses the aggregated content.
- Manual smoke test for settings: edit/add/delete/restore prompt modes, then generate from both Git AI entry points and confirm the selected mode is used.

### 7. Wrong vs Correct

#### Wrong

```ts
const result = await window.utools.ai(payload);
onChunk(String(result.content || result.text || result || ""));
onDone({ ok: true, content: String(result.content || result.text || result || "") });
```

This makes a complete non-streaming response look like streaming output and duplicates the result path.

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

For uTools in preload, use the documented streaming callback and aggregate both content fields:

```js
let content = "";
let reasoning = "";
let rawContent = "";
await window.utools.ai(
  { model: preferences.model || undefined, messages: [{ role: "user", content: prompt }] },
  (delta) => {
    const chunk = {
      reasoning: typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "",
      content: typeof delta?.content === "string" ? delta.content : "",
    };
    const text = `${chunk.reasoning}${chunk.content}`;
    if (text) {
      reasoning += chunk.reasoning;
      content += chunk.content;
      rawContent += text;
      onChunk({ ...chunk, rawContent: text });
    }
  },
);
onDone({
  ok: true,
  content: content.trim(),
  reasoning: reasoning.trim(),
  rawContent: rawContent.trim(),
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
- PID missing -> still update local status/logs to stopped and skip bridge kill because no exit event will arrive.
- Bridge stop fails -> swallow the failure for the stop action path and keep the UI responsive.
- Exit event arrives after optimistic stop -> leave the script/project in stopped state.

### 5. Good/Base/Bad Cases

- Good: clicking stop flips the script badge to stopping immediately, keeps the dashboard button stable while the bridge kill finishes, then the exit event reconciles it to stopped.
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
script.status = pid ? "STOPPING" : "STOPPED";
if (pid) {
  void bridge.stopProcess(pid).catch(() => undefined);
}
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
- `ProjectBridge.readGitStatusSnapshot(projectPath: string): Promise<ProjectBridgeGitStatusSnapshot>`
- `ProjectBridge.readGitCommits(projectPath: string, options?: { limit?: number; skip?: number }): Promise<ProjectBridgeGitCommitPage>`
- `loadMoreGitCommits(projectId: string): Promise<void>`

### 3. Contracts

- Initial Git refresh should request a bounded page of commits, currently `limit: 80` and `skip: 0`, through `readGitSnapshot`.
- `readGitSnapshot` is the full refresh path and may compose `readGitStatusSnapshot` plus `readGitCommits` internally. It should refresh status/files/branches/HEAD and the first commit page together.
- Loading more commits must call `readGitCommits(project.path, { limit: 80, skip: project.git.commits.length })`, then append only the returned commits in the store.
- Loading more commits must not overwrite the current `files`, `branches`, `branch`, `headHash`, or `isDetachedHead` fields. Those fields belong to status refresh.
- Git write actions that only affect the index or worktree, such as stage and unstage, should refresh through `readGitStatusSnapshot` instead of rereading commit history.
- The preload bridge should request `limit + 1` commits from `git log` to derive `hasMoreCommits`, then trim the returned page to `limit`.
- UI components should use `hasMoreCommits` to show an explicit load-more affordance instead of rendering the full repository history.

### 4. Validation & Error Matrix

- Missing Git repository -> return an empty snapshot with `hasMoreCommits: false`.
- Invalid `limit` or `skip` -> clamp to a safe bounded page in preload.
- Loading more with no existing snapshot -> no-op.
- Stage/unstage while a full refresh is in flight -> keep the latest status/files from the lightweight refresh, but still accept the full refresh's first commit page when HEAD/reference state has not changed.
- Commit, branch switch, or checkout while a full refresh is in flight -> reject or ignore the stale full refresh commit page unless it was started after the ref-changing mutation.

### 5. Good/Base/Bad Cases

- Good: the Git tab shows the first page quickly and appends another page only when the user asks for more.
- Good: staging one file updates W/S counts and row state without paying for another `git log` page.
- Base: a small repository returns fewer than `limit` commits and hides the load-more control.
- Bad: running `git log --all` without a max count and rendering every commit.
- Bad: implementing load-more by calling `readGitSnapshot` and replacing the entire Git snapshot, which makes status refresh slow and can overwrite current worktree state.

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
const page = await bridge.readGitCommits(project.path, { limit: 80, skip: project.git?.commits.length || 0 });
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

## Scenario: Git Lightweight Write Actions

### 1. Scope / Trigger

- Trigger: Git write actions cross the Git tab, Pinia store, browser fallback bridge, and uTools preload Git command boundary.

### 2. Signatures

- `ProjectGitFileChange = { path: string; originalPath?: string; additions: number; deletions: number; status: ...; staged?: boolean; unstaged?: boolean }`
- `ProjectGitBranchSummary = { name: string; current: boolean }`
- `ProjectGitActionResult = { ok: boolean; message: string; path?: string; paths?: string[]; count?: number; branch?: string; commitHash?: string; isDetachedHead?: boolean }`
- `ProjectGitCommitMessageDiffResult = { ok: boolean; scope: "staged" | "working-tree"; diff: string; truncated?: boolean; message?: string }`
- `ProjectGitStatusSnapshot = { branch: string; headHash?: string; isDetachedHead?: boolean; ahead: number; behind: number; files: ProjectGitFileChange[]; branches?: ProjectGitBranchSummary[]; repositoryPath: string; lastRefreshedAt: string; statusText: string }`
- `ProjectGitCommitPage = { commits: ProjectGitCommitSummary[]; hasMoreCommits?: boolean; repositoryPath: string; lastRefreshedAt: string }`
- `ProjectGitSnapshot = { branch: string; headHash?: string; isDetachedHead?: boolean; ahead: number; behind: number; files: ProjectGitFileChange[]; commits: ProjectGitCommitSummary[]; branches?: ProjectGitBranchSummary[]; ... }`
- `ProjectBridge.readGitStatusSnapshot(projectPath: string): Promise<ProjectBridgeGitStatusSnapshot>`
- `ProjectBridge.readGitCommits(projectPath: string, options?: { limit?: number; skip?: number }): Promise<ProjectBridgeGitCommitPage>`
- `ProjectBridge.stageGitFile(projectPath: string, relativePath: string): Promise<ProjectGitActionResult>`
- `ProjectBridge.unstageGitFile(projectPath: string, relativePath: string): Promise<ProjectGitActionResult>`
- `ProjectBridge.discardGitFile(projectPath: string, relativePath: string): Promise<ProjectGitActionResult>`
- `ProjectBridge.stageGitFiles(projectPath: string, relativePaths: string[]): Promise<ProjectGitActionResult>`
- `ProjectBridge.unstageGitFiles(projectPath: string, relativePaths: string[]): Promise<ProjectGitActionResult>`
- `ProjectBridge.discardGitFiles(projectPath: string, relativePaths: string[]): Promise<ProjectGitActionResult>`
- `ProjectBridge.commitGitStaged(projectPath: string, message: string): Promise<ProjectGitActionResult>`
- `ProjectBridge.switchGitBranch(projectPath: string, branchName: string, options?: { force?: boolean }): Promise<ProjectGitActionResult>`
- `ProjectBridge.checkoutGitCommit(projectPath: string, commitHash: string, options?: { force?: boolean; preferredBranch?: string }): Promise<ProjectGitActionResult>`
- `ProjectBridge.readGitCommitMessageDiff(projectPath: string): Promise<ProjectGitCommitMessageDiffResult>`

### 3. Contracts

- Components call store actions such as `store.stageGitFile(project.id, file.path)`, never `window.projectBridge` directly.
- Store actions resolve the project id to the project path, call the bridge, and choose the lightest post-write refresh that preserves correctness.
- Stage/unstage single-file and batch actions should bump the Git mutation version and refresh `readGitStatusSnapshot(project.path)` after successful writes. They must not reread commit history on the success path.
- Commit, branch switch, checkout, and discard actions can change HEAD, refs, or file contents beyond index-only state; refresh `readGitSnapshot(project.path, { limit: 80, skip: 0 })` after successful results.
- Full refresh and lightweight status refresh may overlap. The store must track mutation/ref versions so a stale full refresh does not overwrite newer status/files, and so full refresh commit pages are only merged when no ref-changing mutation happened after the full refresh started.
- Browser fallback must implement the same methods and return user-facing unavailable messages instead of throwing.
- Preload Git write commands must use argument arrays with `spawnSync` or `execFileSync`, e.g. `git -C <repo> add -- <path>`. Do not build shell command strings for Git writes.
- Preload resolves `relativePath` under the Git repository root before running Git, rejecting path traversal through the existing child-path resolver.
- Preload reads Git file status with a NUL-delimited porcelain format and preserves `originalPath` for renamed files, so file actions do not break paths with spaces or staged renames.
- `discardGitFile` is a risky action and the UI must show an app-rendered confirmation before calling the store. Do not use `window.confirm`, uTools native confirmation, or Electron native confirmation for this Git panel action. Preload may discard tracked single-file changes and untracked files, but must not recursively delete untracked directories from the Git panel.
- `switchGitBranch` must block when `git status --porcelain` has any output unless `options.force === true`. Branch switching is only for existing local branches returned by the snapshot branch list. The UI must show an app-rendered danger confirmation before calling `switchGitBranch(..., { force: true })`; forced switching may run `git switch --discard-changes -- <branch>` and discard local uncommitted changes.
- `checkoutGitCommit` must block when `git status --porcelain` has any output unless `options.force === true`, validate the target as an existing commit, then choose the checkout mode:
  - if the target commit equals a local branch tip, switch to that branch instead of detached HEAD;
  - prefer `options.preferredBranch`, then the symbolic current branch, then `main`, `master`, `develop`, then the first matching local branch;
  - if no local branch tip matches, use `git switch --detach <hash>`.
    The UI must show an app-rendered danger confirmation before calling `checkoutGitCommit(..., { force: true })`; forced checkout may use `--discard-changes` and discard local uncommitted changes.
- `readGitSnapshot` must expose `headHash` and `isDetachedHead` so the Git tab can render `HEAD @ <hash>`, detached HEAD badges, and current-commit markers after checkout.
- `readGitCommitMessageDiff` prefers `git diff --cached`; when no staged diff exists, it falls back to the working-tree diff and bounded untracked-file summaries for AI commit message generation.
- The Git tab left sidebar follows a VS Code Source Control-style compact panel convention: commit textarea first, adjacent icon-only commit/AI actions, one dense changed-files toolbar row with W/S counts and bulk actions, compact file rows, subtle dividers, and no stacked card sections or explanatory helper paragraphs inside the sidebar. Do not render action/status messages directly under the commit textarea; use refreshed state, button loading/disabled states, app dialogs, or the top Git status area instead. The changed-files toolbar label should stay short (currently `变更`) and should not spend space on total changed-file count or scroll-to-top/bottom controls.
- The changed-files header action band operates on all eligible files: stage all unstaged/eligible files, unstage all staged files, and discard all changed files after app-rendered confirmation. Row actions use one contextual stage/unstage slot and appear on row hover/focus, while row click remains reserved for opening the diff.
- Git file actions should set a local per-file loading state before awaiting the bridge action and snapshot refresh. Avoid making the whole Git panel feel frozen for one file action; disable only the relevant file/action where practical, while still preventing conflicting write operations such as commit or checkout. Stage/unstage success should not render a textual status message in the compact sidebar; the refreshed W/S counts and row state are the success feedback.
- AI commit message generation uses the fixed `commit-message` AI mode prompt, supports `{diffScope}`, `{diffContent}`, and `{truncatedNote}` only for older saved templates, falls back by appending diff content if the template omits `{diffContent}`, and writes only final content to the commit message textarea. Settings should not show placeholder help next to AI prompt titles and should avoid separate explanatory blocks inside individual mode editors. Batch Git AI and commit-detail AI each expose a compact include-diff control; when disabled, they must preserve repository, commit, status, and file-list context while omitting full code diff content.

### 4. Validation & Error Matrix

- Missing project or unavailable path -> store returns `null`; component shows a user-facing warning.
- Missing Git repository -> bridge returns `{ ok: false, message: "未检测到 Git 仓库。" }` or an empty snapshot.
- Empty commit message -> bridge returns `{ ok: false, message: "请先填写 commit message。" }`.
- Commit with no staged diff -> bridge returns `{ ok: false, message: "没有 staged 变更可提交。" }`.
- Discard untracked directory or non-file path -> bridge returns a failure message asking the user to handle it in the file system.
- Branch switch with uncommitted changes and no force option -> bridge returns `{ ok: false, message: "当前工作区存在未提交变更..." }` and does not run `git switch`.
- Branch switch with uncommitted changes after app confirmation -> UI calls `switchGitBranch(..., { force: true })`; preload runs `git switch --discard-changes -- <branch>`, returns `{ ok: true, branch }` on success, and the store refreshes the snapshot.
- Unknown local branch -> bridge returns `{ ok: false, message: "只能切换到已有本地分支。" }`.
- Commit checkout with uncommitted changes and no force option -> bridge returns `{ ok: false, commitHash, message: "当前工作区存在未提交变更..." }` and does not run `git switch --detach`.
- Commit checkout with uncommitted changes after app confirmation -> UI calls `checkoutGitCommit(..., { force: true })`; preload runs either `git switch --discard-changes -- <branch>` for a matching local branch tip or `git switch --discard-changes --detach <hash>` otherwise, and the store refreshes the snapshot.
- Commit checkout with an invalid or missing hash -> bridge returns `{ ok: false, message: "请选择一个有效的提交 hash。" }` or a not-found commit message.
- Commit checkout target equals a local branch tip -> bridge returns `{ ok: true, branch, commitHash, isDetachedHead: false }`, and the refreshed snapshot should show the branch name rather than detached HEAD.
- Commit checkout target is not any local branch tip -> bridge returns `{ ok: true, commitHash, isDetachedHead: true }`, and the refreshed snapshot should show detached HEAD.
- Detached HEAD snapshot -> `branch` may be `"HEAD"`, `isDetachedHead` is `true`, and `headHash` carries the current short commit hash for UI labels.

### 5. Good/Base/Bad Cases

- Good: clicking a file stage button calls the store, preload runs `git add -- <file>`, then the store refreshes only the Git status snapshot and the row shows staged state without reloading the commit graph.
- Good: AI commit message generation includes actual diff text from staged changes, and falls back to working-tree diff only when nothing is staged.
- Good: editing the commit-message prompt in Settings persists through browser fallback and preload storage, then the next Git tab generation uses that stored template.
- Good: the changed-files panel keeps stage/unstage/discard controls in the header and shows immediate per-file loading feedback before the refreshed snapshot arrives.
- Good: switching to a clean local branch refreshes branch, graph, files, and command-running views naturally see the new working tree.
- Good: checking out a selected commit from the commit detail dialog switches back to a matching local branch tip when one exists; otherwise it enters detached HEAD, refreshes files/branch/graph, and highlights the current commit through `headHash`.
- Base: browser preview shows safe unavailable messages for write actions but still renders the Git tab.
- Bad: a component directly calls `window.projectBridge.commitGitStaged(...)` and then forgets to refresh `project.git`.
- Bad: running `spawn("git add " + filePath, { shell: true })`, which creates shell injection risk.
- Bad: using recursive filesystem deletion for a Git discard action from a compact UI.
- Bad: showing a native confirmation dialog for discard, because it can hide or detach the compact uTools plugin UI.

### 6. Tests Required

- `npm run type-check` should verify bridge contracts across `src/types.ts`, fallback bridge, store actions, and components.
- `npm run build` should verify the Git tab template compiles.
- Manual uTools smoke test: stage, unstage, discard a single file after confirmation, commit staged changes, and confirm each successful action refreshes the snapshot.
- Manual uTools smoke test: attempt branch switching with uncommitted changes and verify the danger confirmation appears; cancel keeps the worktree unchanged, confirm force-switches and refreshes branch/files/graph. Then switch on a clean worktree and verify the branch and graph refresh.
- Manual uTools smoke test: attempt commit checkout with uncommitted changes and verify the danger confirmation appears; cancel keeps the worktree unchanged, confirm force-checks out the selected commit and refreshes detached HEAD/current commit state. Then checkout a clean selected commit and verify detached HEAD/current commit state is visible.
- Manual uTools smoke test: from detached HEAD, select the tip commit of `main` or another local branch and verify the Git panel returns to that branch instead of staying detached.
- Manual AI smoke test: generate a commit message with staged changes, then with only unstaged changes, and verify the prompt source uses diff content.

### 7. Wrong vs Correct

#### Wrong

```ts
await window.projectBridge.commitGitStaged(project.path, message);
```

This bypasses store fallback behavior and leaves the Git snapshot stale.

#### Correct

```ts
const result = await store.commitGitStaged(project.id, message);
```

Let the store own project lookup, bridge fallback, and post-success snapshot refresh.

#### Wrong

```js
spawn(`git -C ${repo} add ${filePath}`, { shell: true });
```

This mixes user-controlled paths into a shell command.

#### Correct

```js
spawnSync("git", ["-C", repo, "add", "--", relativePath], { windowsHide: true });
```

Use Git argument arrays and the `--` path separator at the preload boundary.

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
