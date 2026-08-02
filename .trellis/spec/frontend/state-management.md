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

### Convention: Repository-Scoped Renderer Sessions

**What**: Feature-local state that must survive a modal close or a temporary detail-tab unmount may live in a module-scoped `Map`, keyed by the existing repository `contextKey`.

**Why**: The state is useful only for the current renderer session, so it should not be promoted to Pinia or persistence. Component unmount alone is not a project-lifecycle boundary: a Git tab can be absent while its project is replaced.

**Rules**:

- Use the existing context key format and retain only successful, displayable feature state in the map. Keep streaming drafts, loading, and errors component-local.
- Clear the current repository session for an explicit user reset. Clear every map entry with the previous project's `${projectId}::` prefix when the project or repository context changes, including a parent detail component's unmount path.
- Increment a component-local request generation on repository/project changes and before unmount. Every async chunk and terminal callback must compare that generation and the active `contextKey` before updating visible state or the map.
- Do not use `localStorage`, project data, Pinia, preload storage, or bridge contracts for these renderer-only sessions.

**Example**:

```ts
const rememberedSessions = new Map<string, Session>();

export const clearSessionsForProject = (projectId: string) => {
  const prefix = `${projectId}::`;
  for (const key of rememberedSessions.keys()) {
    if (key.startsWith(prefix)) rememberedSessions.delete(key);
  }
};

if (requestGeneration !== originGeneration || activeContext.value?.contextKey !== originContextKey) return;
```

**Validation**: Close and reopen the modal, switch away from and back to the detail tab, then switch repository and project. Successful state should survive the first two transitions only; stale async responses must not create or update a session after the latter two.

**Related**: `src/components/project/GitTab.vue`, `src/components/project/ProjectDetails.vue`.

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

### Convention: Persisted Project Script Reordering

Script ordering is project configuration, so the Scripts tab keeps drag state locally and calls the Pinia `reorderProjectScripts` action when a drop succeeds. The store updates the project array before persisting it; drag state and drop highlighting must not be persisted.

### Convention: Safe Script Discovery Defaults

Script discovery may preselect ordinary candidates, but potentially destructive Makefile targets such as clean, reset, destroy, delete, purge, drop, down, and teardown require an explicit checkbox selection. The selection state remains local to the project form; only imported commands become project configuration.

Do not move purely visual state into the store if a component can manage it locally.

---

## Scenario: Persistent UI Preferences and Coach Marks

### 1. Scope / Trigger

- Trigger: an application-wide UI preference or feature-discovery hint must survive component replacement and plugin restart without becoming project metadata.
- Trigger: a legacy standalone preference key must migrate into the unified UI preference document.
- This requires code-spec depth because the contract crosses Vue components, Pinia, the browser ProjectBridge fallback, uTools preload, `localStorage`, and `dbStorage`.

### 2. Signatures

- `ProjectDetailsTabId = "info" | "scripts" | "automation" | "files" | "git" | "memo"`.
- `UiPreferences = { schemaVersion: 1; projectDetails: { tabOrder: ProjectDetailsTabId[] }; coachMarks: { projectDetailsTabReorder: number } }`.
- Bridge methods: `loadUiPreferences(): UiPreferences` and `saveUiPreferences(preferences: UiPreferences): void`.
- Store actions: `setProjectDetailsTabOrder(order: ProjectDetailsTabId[])` and `acknowledgeProjectDetailsTabReorderHint(version: number)`.
- Current storage key: `utools-project-launch.ui-preferences.v1`.
- Legacy migration key: `utools-project-launch.project-details-tab-order.v1`.

### 3. Contracts

- Load UI preferences once when the Pinia store is created. `loadProjects()` and detail-component mounts must not read persistent UI preferences again.
- Components read UI preferences from Pinia and call intent-specific Store actions. They must not access `localStorage`, `dbStorage`, or `window.projectBridge` directly.
- Normalize every stored value at the bridge boundary: filter unknown tab ids, remove duplicates, append missing ids in default order, and accept only non-negative integer Coach Mark versions.
- A Coach Mark version records acknowledgement of a specific interaction version. For Tab reordering, reaching the long-press threshold acknowledges the hint even when pointer release leaves the order unchanged.
- Short presses and pointer movement that cancels the long-press timer do not acknowledge the hint.
- Store actions update Pinia before persistence. Storage failure must not undo the current renderer's usable state.
- Saving an unchanged order or an already-acknowledged Coach Mark version is a no-op and must not issue another storage write.
- Browser preview stores the normalized document as JSON in `localStorage`; uTools preload stores the same logical document in `dbStorage`.
- When the new key is absent, migrate the legacy array. A normalized non-default legacy order acknowledges Coach Mark version `1`; the default order keeps version `0`.
- Keep the legacy order key synchronized for one compatibility period so rollback to the previous application version preserves the latest order.

### 4. Validation & Error Matrix

- No new or legacy value -> return and persist complete defaults with Coach Mark version `0`.
- New value exists -> prefer it over the legacy key and normalize all fields.
- New value has an unsupported schema or damaged JSON -> return complete defaults; do not trust or merge the legacy key into an explicitly present invalid new document.
- Legacy default order -> migrate order and keep Coach Mark version `0`.
- Legacy non-default order -> migrate order and set Coach Mark version `1`.
- Unknown, duplicate, or missing Tab ids -> filter, de-duplicate, and append missing defaults.
- Negative, fractional, non-numeric, or missing Coach Mark version -> normalize to `0`.
- Persistence throws -> retain normalized Pinia state and keep the UI interaction usable.

### 5. Good/Base/Bad Cases

- Good: a user reaches the 350ms drag threshold without moving a Tab; the hint hides, one UI preference write records version `1`, no order write occurs, and the hint stays hidden after plugin restart.
- Good: an older installation has a custom legacy order; startup migrates it once and does not show a discovery hint for an interaction the user has already used.
- Base: a new installation receives the default order and sees the subtle hint until the first valid long press.
- Bad: infer acknowledgement only from `tabOrder !== defaultOrder`; returning to the default order or attempting a drag without a reorder loses the user's acknowledgement.
- Bad: read `dbStorage` whenever `ProjectDetails` mounts; repeated component replacement couples rendering to host I/O and creates multiple persistence sources.
- Bad: keep a module-scoped `hasSeenHint` flag; it survives detail replacement but resets when the plugin reloads.

### 6. Tests Required

- `npx vitest run src/lib/projectBridge.uiPreferences.test.ts` must cover browser and real-preload defaults, new-key priority, legacy default/non-default migration, malformed values, normalization, round-trip writes, legacy-key synchronization, and Store write de-duplication.
- `npm run validate:process-results` after changing `ProjectBridge`, because hand-written bridge fixtures must implement the new UI preference methods before Store initialization.
- `npm run lint` and `npm run build` after changing types, Store actions, or project-detail hint rendering.
- `node --check public/preload.js` after changing preload UI preference normalization or storage.
- Browser regression: short press and threshold-cancel keep the hint; valid long press hides it without requiring a reorder; returning to another project and refreshing preserve acknowledgement.
- uTools regression: completely close and reopen the plugin, then assert the acknowledged hint stays hidden and a custom Tab order survives.

### 7. Wrong vs Correct

#### Wrong

```ts
const showHint = ref(true);

if (tabOrderChanged) {
  showHint.value = false;
  localStorage.setItem("tab-hint-seen", "true");
}
```

This couples acknowledgement to an order change, adds a component-owned storage key, and bypasses uTools persistence.

#### Correct

```ts
const showHint = computed(() => store.uiPreferences.coachMarks.projectDetailsTabReorder < CURRENT_HINT_VERSION);

// Called when the long-press threshold activates drag mode.
store.acknowledgeProjectDetailsTabReorderHint(CURRENT_HINT_VERSION);
```

Keep the component declarative, let Pinia own current state, and let ProjectBridge normalize, migrate, and persist the unified document.

---

## Server State

There is no server state cache today. All data is in-memory and seeded in the store.

If the app later talks to a real backend or file system adapter, keep the fetched data behind a store action or composable so the UI does not need to care where it came from.

The current uTools integration follows this rule: UI components call store actions, store actions call `src/lib/projectBridge.ts`, and the bridge delegates to `window.projectBridge` from `public/preload.js` when running inside uTools.

## Scenario: Project Script Runtime State Boundary

### 1. Scope / Trigger

- Trigger: project scripts are launched from the dashboard or project details, process events arrive from the uTools preload bridge, and the Pinia store updates script rows, terminal logs, and project-level status.
- Trigger: script arrays can also be rebuilt by project form saves or package script refreshes while one or more scripts are still running.
- This requires code-spec depth because runtime process state crosses `public/preload.js`, `ProjectBridgeEvent`, store actions, persisted project normalization, and multiple UI consumers.

### 2. Signatures

- `ProjectScript.status`: `"IDLE" | "RUNNING" | "STOPPING" | "ERROR" | "STOPPED"`.
- Active runtime statuses: `"RUNNING" | "STOPPING"`.
- Store helper: `deriveProjectStatus(project: Pick<Project, "pathExists" | "scripts">): ProjectStatus`.
- Store helper: `mergeScriptRuntimeState(nextScripts: ProjectScript[], previousScripts: ProjectScript[]): ProjectScript[]`.
- Store launch path: `launchScript(projectId: string, scriptId: string)` -> `bridge.runCommand(...)`.
- Bridge event shape: `ProjectBridgeEvent = { type: "started" | "stdout" | "stderr" | "stdin" | "exit" | "error"; projectId: string; scriptId: string; pid: number; message?: string; code?: number | null; signal?: string | null; stoppedByUser?: boolean }`.
- Preload command path: `runCommand(payload)` emits `started`, stream events, then exactly one terminal `exit` or `error` event for the script.

### 3. Contracts

- Project-level runtime status is derived from script statuses, not assigned independently by components or one-off action branches.
- `RUNNING` or `STOPPING` scripts take priority over `ERROR` scripts when deriving project status. A project with one failed script and one still-running script remains `ProjectStatus.RUNNING`.
- A script failure updates only the matching `scriptId`; it must not reset other scripts in the same project.
- Runtime log output is mirrored in both `logs[projectId]` and `scriptLogs[projectId][scriptId]`. Any per-script log mutation, such as clearing the current terminal, must keep both collections aligned so project-level readers do not show stale entries.
- Rebuilding a project's script array must call `mergeScriptRuntimeState(...)` when the project path still exists. This preserves `RUNNING` / `STOPPING` and `pid` for matching scripts by id or name.
- Persisted projects must still be written with stopped runtime state through `toPersistedProject(...)`; preserving active runtime state is an in-memory session concern, not a storage contract.
- `launchScript(...)` may optimistically mark the target script as `RUNNING`, but after `bridge.runCommand(...)` resolves it must not overwrite a newer `exit` or `error` event that already changed the script status.
- Preload `runCommand(...)` must clean `activeProcesses`, `activeProcessMetadata`, `launchedProcessIds`, and `userStoppedProcesses` for both `close` and `error` paths.
- Preload `runCommand(...)` must guard process settlement so a process emits only one terminal state event to the renderer.

### 4. Validation & Error Matrix

- One script exits with non-zero code while another script is `RUNNING` -> failed script becomes `ERROR`; running script stays `RUNNING`; project stays `RUNNING`.
- One script is manually stopped while another script is `RUNNING` -> stopped script becomes `STOPPED`; running script stays `RUNNING`; project stays `RUNNING`.
- All scripts are `IDLE` / `STOPPED` and one script is `ERROR` -> project becomes `ERROR`.
- All scripts are `IDLE` / `STOPPED` with no errors -> project becomes `STOPPED`.
- Project path becomes unavailable -> project becomes `WARNING`, all script runtime state is cleared, and pids are removed.
- Clearing one script's terminal output -> empties `scriptLogs[projectId][scriptId]`, removes the same log entry objects from `logs[projectId]`, keeps the selected terminal tab/context visible, and does not touch other scripts.
- Project form save while script id or name still matches an active script -> keep active status and pid in memory.
- Package script refresh while script name still matches an active script -> keep active status and pid in memory.
- `bridge.runCommand(...)` throws -> only the launched script becomes `ERROR`; logs receive an error entry; project status is re-derived from all scripts.
- Preload spawn emits `error` before `close` -> renderer receives one `error` event and process maps are cleaned once.

### 5. Good/Base/Bad Cases

- Good: project has `dev` running and `api` fails with exit code 1; the `api` row shows error, the `dev` row still shows running, and the dashboard card remains running.
- Good: user edits project metadata while `dev` is running; after save, the `dev` script still has `RUNNING` status and its existing pid.
- Good: package scripts are refreshed while `dev` is running; the refreshed script command/note update, but active runtime status and pid survive.
- Base: browser fallback `runCommand(...)` returns a pid without real process events; the store keeps the script running until the user changes state or reloads.
- Bad: rebuilding `project.scripts` from form/package data with every `status: "IDLE"`, which makes a still-running process appear stopped.
- Bad: setting `project.status = ProjectStatus.ERROR` directly after one script failure, which hides other active scripts from project-level UI.
- Bad: assigning `script.status = "RUNNING"` after `bridge.runCommand(...)` without checking whether an `exit` event already marked the script as `ERROR`.

### 6. Tests Required

- `npm run lint` after changing `ProjectScript`, `ProjectBridgeEvent`, `launchScript`, `handleBridgeEvent`, or runtime-state helpers.
- `npm run build` after changing script runtime state because dashboard cards, project details, and terminal tabs consume the same store state.
- `node --check public/preload.js` after changing preload process launch, stream, stop, or cleanup behavior.
- Manual smoke test in uTools: start two scripts, make one fail, and assert the other script row and dashboard card remain running.
- Manual smoke test in uTools: save project metadata while a script is running and assert the script status and stop button remain correct.
- Manual smoke test in uTools: refresh/import package scripts while a script is running and assert the active runtime state survives for matching script names.
- Regression assertion point: a non-zero exit event changes only `event.scriptId` and derives `project.status` from the complete script list.

### 7. Wrong vs Correct

#### Wrong

```ts
project.scripts = result.scripts.map((script) => ({
  id: script.name,
  name: script.name,
  command: script.command,
  status: "IDLE",
}));
project.status = ProjectStatus.STOPPED;
```

This discards in-memory process state when the script list is rebuilt, even though the OS process may still be running.

#### Correct

```ts
const previousScripts = project.scripts;
const refreshedScripts: ProjectScript[] = result.scripts.map((script) => ({
  id: previousByName.get(script.name)?.id || script.name,
  name: script.name,
  command: script.command,
  status: "IDLE",
}));
project.scripts = mergeScriptRuntimeState(refreshedScripts, previousScripts);
project.status = deriveProjectStatus(project);
```

Keep script runtime state centralized so project-level UI reflects the whole script list, not only the last script event.

## Scenario: Project Metadata Persistence Boundary

### 1. Scope / Trigger

- Trigger: project metadata is edited in the Vue form, normalized in the Pinia store, persisted through browser fallback or uTools preload storage, then hydrated again after plugin restart.

### 2. Signatures

- `Project` includes display metadata such as `type`, `kind`, optional `icon`, optional `quickLink`, optional grouping metadata like `group`, and visibility metadata `visibility?: "public" | "private"` plus `ownerDeviceId?: string`.
- `ProjectFormValue` includes the same editable metadata fields, with optional persisted project fields normalized to form-safe strings.
- Store persistence path: `saveProjectForm()` -> `persistProjects()` -> `bridge.saveProjects(...)`.
- uTools preload persistence path: `writeStoredProjects(projects)` -> per-project docs containing `project: toStoredProject(project)`.
- Device id boundary: `ProjectBridge.loadDeviceId(): string`; uTools preload resolves it from stable machine-local storage, while browser fallback may use `localStorage`.
- Quick link launch path: dashboard/card action -> `openProjectQuickLink(projectId)` -> `bridge.openPath(quickLink)` -> browser fallback `window.open(...)` or uTools preload `shell.openExternal(...)` for URL-like targets.

### 3. Contracts

- Every user-visible project metadata field that should survive restart must be written by both store-side persistence (`toPersistedProject` in `src/store/useStore.ts`) and preload-side persistence (`toStoredProject` in `public/preload.js`).
- Browser fallback and uTools preload storage must preserve the same logical project fields. A field working in browser/local state is not enough if preload drops it during doc writes.
- `type`, `kind`, and `icon` are linked metadata: icon selection may update type/kind, and all three must round-trip together.
- `quickLink` is a project-level optional URL string. Trim it when moving between persisted projects, hydrated projects, form drafts, and saved projects; keep missing/legacy values as an empty string in form state and absent/empty in project state.
- `group` is project-level display metadata. Trim it at every boundary and treat missing or whitespace-only values as the ungrouped bucket in Dashboard UI while keeping form state as an empty string.
- `visibility` controls cross-device display only, not whether a project is stored. Missing legacy values normalize to `"public"`; new project forms default to `"private"` so they stay on the current device unless explicitly made public.
- `ownerDeviceId` is generated from a stable machine-local device id supplied by `ProjectBridge.loadDeviceId()`. In uTools, preload must persist that id outside volatile renderer `localStorage` so restarting the uTools app keeps the same id; browser preview may fall back to `localStorage`.
- Private projects render only when `ownerDeviceId` matches the current device id; hidden private projects must remain in the project array so saving current-device changes does not delete other devices' private projects from shared storage.
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
- uTools restart after creating private projects -> `ProjectBridge.loadDeviceId()` returns the same machine-local id, so matching `ownerDeviceId` projects remain visible.
- Mixed per-project docs plus legacy `utools-project-launch.projects.v1` list -> merge both sources by project id, prefer doc records on conflicts, and keep legacy-only projects visible as public projects.
- Missing persisted `scripts`, `env`, `type`, `kind`, or `status` -> hydrate safe defaults instead of aborting the whole project catalog load.
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
- Regression check: restart the uTools app after creating a private project and confirm the project remains visible because `ProjectBridge.loadDeviceId()` is stable.
- Regression check: run `npm run validate:project-storage` after changing project storage migration, visibility, or legacy hydration code.

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

## Scenario: Automation Task Missed-Run Policy

### 1. Scope / Trigger

- Trigger: automation task scheduling fields are edited in `AutomationTab.vue`, normalized in the Pinia store, persisted through browser fallback or uTools preload storage, then hydrated after plugin restart.
- Trigger: generated plan entries are exposed for explicit early execution from both `AutomationTab.vue` and the Dashboard task overview.
- This requires code-spec depth because task behavior depends on a persisted `ProjectAutomationTask` shape crossing `src/types.ts`, `src/store/useStore.ts`, `public/preload.js`, and storage compatibility checks.

### 2. Signatures

- `ProjectAutomationMissedPolicy = "grace-run" | "run-now" | "mark-missed"`.
- `ProjectAutomationTask.missedPolicy: ProjectAutomationMissedPolicy`.
- `ProjectAutomationTask.missedGraceMinutes: number`.
- Store action: `runAutomationTaskNow(projectId: string, taskId: string): boolean` creates a current-time pending entry and starts the existing automation execution flow.
- Store action: `runAutomationPlanEntryEarly(projectId: string, taskId: string, entryId: string): boolean` starts one already-generated future entry through the existing automation execution flow without creating a manual entry.
- Store normalization: `normalizeAutomationTasks(projectId, value)` must fill missing legacy values with `missedPolicy: "grace-run"` and `missedGraceMinutes: 5`.
- uTools preload persistence path: `toStoredProject(project).automationTasks[]` must preserve `missedPolicy`, `missedGraceMinutes`, `history`, `dailyPlans`, `inputConfigs`, and `exitConfigs`.

### 3. Contracts

- Random daily plans remain deterministic for a given task/date; missed-run policy must not reshuffle random entries when the app opens later in the day.
- `grace-run` runs overdue pending entries only while `now - plannedAt <= missedGraceMinutes * 60_000`; later entries become `missed`.
- `run-now` runs overdue pending entries whenever the app becomes available.
- `mark-missed` marks overdue pending entries missed without running them.
- `runDueAutomationPlans()` must apply missed policy before collecting due entries, so delayed timers or sleep/resume paths cannot run entries that should now be missed.
- UI components should pass task updates through store actions; components should not mutate `dailyPlans` or `history` directly.
- Dashboard and detail-page run-now controls must call `runAutomationTaskNow(...)`; they must not rewrite missed history entries or call `runAutomationTask(...)` with an old missed entry.
- `runAutomationTaskNow(...)` should reject missing, scriptless, or already-running project tasks and return `false` without mutating history.
- `runAutomationPlanEntryEarly(...)` must resolve `entryId` only from today's plan and accept it only while the entry is `pending`, has a finite `plannedAt`, and remains strictly in the future at the store boundary.
- Early execution must pass the original `entryId` to `runAutomationTask(...)`. It must preserve the entry's original `plannedAt`, consume that entry's status, and never append the `manual` entry used by task-level run-now.
- Entry-level early-run controls may pre-filter obvious unavailable states, but the store action remains the final race-safe validation boundary. The first accepted run synchronously changes the entry from `pending` to `running` before awaiting scripts, preventing a second click or due timer from starting it again.
- Task `enabled` controls scheduled execution only. Manual run-now controls should still run disabled tasks when their scripts are otherwise runnable.
- Task `enabled` also must not block explicit early execution of an already-generated future entry.
- Dashboard `upcomingAutomationTasks[].nextEntry` must select the earliest future `pending` entry regardless of `task.enabled`, then pass that exact entry id to `runAutomationPlanEntryEarly(...)`. Hiding disabled tasks here would make an allowed explicit action unreachable.
- Dashboard early-run controls must keep the task-overview row's mouse and Enter/Space detail navigation, stop action-button events from triggering that navigation, and report the action's boolean result through the overview feedback region.
- Dashboard missed-task ignore controls should call the store, preserve the original missed history row, and append a skipped/ignored history row so the task no longer appears as currently missed.
- UI task running state must be derived from that task's own `dailyPlans[].entries[].status === "running"`, not from `automationActiveProjectRuns[projectId]`. The project-level active run map only prevents concurrent automation within a project.
- Dashboard run-now buttons for sibling tasks should not silently disable because `automationActiveProjectRuns[projectId]` is set. Let the click reach `runAutomationTaskNow(...)`, then show the returned success/blocked feedback.

### 4. Validation & Error Matrix

- Missing `missedPolicy` in legacy storage -> normalize to `"grace-run"`.
- Missing `missedGraceMinutes` in legacy storage -> normalize to `5`.
- Negative or non-finite grace value -> normalize or validate to a non-negative minute count before scheduling.
- App opens within grace after planned time -> pending entry remains runnable and `runDueAutomationPlans()` starts it.
- App opens after grace -> `markMissedAutomationPlans()` records a missed history entry and the due runner skips it.
- `run-now` overdue entry -> remains pending through missed marking and is picked up by the due runner.
- `mark-missed` overdue entry -> becomes missed before the due runner collects entries.
- Run-now on a missed task -> preserves the missed history row, appends a current-time plan entry, and records the new execution as a separate history row.
- Run-now while another task in the same project is active -> returns `false` and leaves the plan/history unchanged.
- Ignore on a missed task -> appends a skipped history row with the missed planned time and leaves the old missed row intact.
- Disabled task run-now -> allowed when scripts exist and no same-project automation is active.
- Disabled task early-run on a valid future entry -> allowed when scripts exist and no same-project automation is active.
- Disabled task with a generated future entry -> remains visible in Dashboard's next-run list and exposes the early-run control.
- Early-run target belongs to another date, is due/past, has an invalid date, or is no longer `pending` -> return `false` without changing the plan or history.
- Two early-run clicks race for the same entry -> the first accepted call synchronously marks it `running`; the second returns `false` or reaches no runnable entry, and only one history row is produced.
- Early-run completes before the original time -> the due scheduler ignores the completed/failed entry because it is no longer `pending`.
- One task running in a project -> only that task displays `running`; sibling tasks continue showing their own latest history or pending state.
- Same-project sibling run-now click while one task is active -> button remains clickable, `runAutomationTaskNow(...)` returns `false`, and the dashboard shows a blocked feedback message.

### 5. Good/Base/Bad Cases

- Good: a 09:00 task with default policy opens at 09:03 and runs immediately.
- Good: a 09:00 task with default policy opens at 10:00 and records `missed`.
- Good: a 09:00 task with `run-now` opens at 10:00 and runs immediately.
- Good: at 08:30 the user runs the already-generated 09:00 entry early; the 09:00 entry becomes running/completed, history keeps `plannedAt = 09:00`, and no second run occurs at 09:00.
- Base: older stored tasks without missed-run fields load with the default grace policy.
- Base: disabling scheduled execution still allows the user to explicitly run a generated future entry early.
- Base: Dashboard next-run row opens project automation details, while its nested early-run control consumes the listed entry without navigating.
- Bad: adding fields only to `ProjectAutomationTask` and the Vue form while omitting `public/preload.js#toStoredProject`, because the setting works until plugin restart and then disappears.
- Bad: checking only the timer path and forgetting app startup/recompute, because overdue pending entries can remain stuck or run outside policy after sleep/resume.
- Bad: implementing early execution by calling `runAutomationTaskNow(...)`, because that appends a separate current-time `manual` entry and leaves the selected future entry pending for a duplicate scheduled run.
- Bad: gating Dashboard `nextEntry` with `task.enabled`, because disabled tasks may still have generated future entries that are valid explicit early-run targets.

### 6. Tests Required

- `npm run type-check` after changing automation task types, store scheduling, or the Automation tab.
- `npm run build` after adding or changing entry-level scheduling controls in the Automation tab.
- `npm run validate:project-storage` after adding, removing, or renaming persisted automation task fields.
- `node --check public/preload.js` after changing preload storage normalization.
- `npm run build` after changing Vue templates or scheduling state consumed by the UI.
- Manual smoke test in browser/uTools: create tasks for each missed policy, reload/open after the planned time, and verify the pending/history status matches the policy.
- Manual smoke test in browser/uTools: run one of multiple future entries early, assert the selected entry is consumed with its original `plannedAt`, no `manual` entry is added, and the original due time does not trigger it again.
- Manual smoke test in the Dashboard task overview: verify enabled and disabled tasks with future entries appear in the next-run list, the action button remains visible at narrow widths, and action clicks do not open project details.

### 7. Wrong vs Correct

#### Wrong

```ts
interface ProjectAutomationTask {
  missedPolicy: ProjectAutomationMissedPolicy;
}
```

Adding the type alone does not preserve the field through uTools project-doc writes.

#### Correct

```ts
const automationTask: ProjectAutomationTask = {
  ...candidate,
  missedPolicy: normalizeAutomationMissedPolicy(candidate.missedPolicy),
  missedGraceMinutes: normalizeAutomationMissedGraceMinutes(candidate.missedGraceMinutes),
};
```

```js
automationTasks: project.automationTasks.map((task) => ({
  ...task,
  missedPolicy: task.missedPolicy || "grace-run",
  missedGraceMinutes: Number.isFinite(task.missedGraceMinutes) ? Math.max(0, Math.floor(task.missedGraceMinutes)) : 5,
}));
```

Keep store normalization and preload persistence aligned with the shared task type.

#### Wrong

```ts
runAutomationPlanEntryEarly(projectId: string, taskId: string) {
  return this.runAutomationTaskNow(projectId, taskId);
}
```

This creates a separate manual plan entry and leaves the user's selected generated entry eligible for its original timer.

#### Correct

```ts
runAutomationPlanEntryEarly(projectId: string, taskId: string, entryId: string) {
  const entry = todayPlan?.entries.find((item) => item.id === entryId);
  if (!entry || entry.status !== "pending" || new Date(entry.plannedAt).getTime() <= Date.now()) {
    return false;
  }
  void this.runAutomationTask(projectId, taskId, entry.id);
  return true;
}
```

Consume the original generated entry and revalidate time/status at the store boundary so UI staleness cannot create a duplicate run.

#### Wrong

```ts
nextEntry: task.enabled ? findNextPendingEntry(task.dailyPlans) : null;
```

This treats the scheduling toggle as an explicit-action permission and hides valid generated entries from the Dashboard.

#### Correct

```ts
nextEntry: findNextPendingEntry(task.dailyPlans);
```

Derive Dashboard visibility from the generated entry state; let the scheduler check `enabled`, and let the store action enforce early-run validity and project concurrency.

## Scenario: Automation Process Result Recovery Boundary

### 1. Scope / Trigger

- Trigger: an automation script finishes while the renderer is unavailable, then project loading, focus, or visibility recovery must settle the persisted running plan.
- This requires code-spec depth because one run identity crosses the automation scheduler, Pinia store, project bridge types, uTools preload process metadata, completed-result cache, and recovery history.

### 2. Signatures

- `ProjectBridgeRunCommandPayload.automationRunId?: string` identifies the owning automation run; manual launches omit it.
- `ProjectBridgeStopProcessOptions = { automationRunId?: string; automationExitMatched?: boolean }` carries an output-match stop reason without breaking `stopProcess(pid)` callers.
- `ProjectBridgeProcessStatusResult` preserves optional `automationRunId` and `automationExitMatched` fields on completed automation results.
- `ProjectBridgeEvent` preserves the same optional fields on process events.
- `ProjectBridge.getAutomationProcessResult(projectId, scriptId, automationRunId)` returns only the exact batch result or `null`.
- Store launch path: `runAutomationTask()` -> `runAutomationScript(..., automationRunId)` -> `launchScript(..., automationRunId)` -> `bridge.runCommand(...)`.

### 3. Contracts

- Completed automation results are indexed by `projectId + scriptId + automationRunId`. Do not restore a plan from the latest result for only a project and script.
- Manual launches do not carry `automationRunId` and must not write into or evict the automation batch index.
- Every script in one automation task receives the same outer plan `runId`; a later task run receives a different id.
- Project loading must await runtime and orphan reconciliation before recomputing plans or starting due work, so a new run cannot overwrite evidence needed by an older run.
- Focus, visibility, and initialization recovery share one in-flight reconciliation operation. The shared operation must clear after both success and failure so later recovery can retry.
- An orphan without exact results for every configured script becomes `skipped`. Time proximity or a script-only recent result is not evidence of ownership.
- Preload records `automationExitMatched: true` only when stop options contain the same `automationRunId` as the PID's active process metadata. A mismatched or missing run id must not create the marker.
- Output-match stop paths pass both the current context run id and `automationExitMatched: true`. Manual stops, input/runtime timeouts, and plugin cleanup do not pass the marker.
- Marker-bearing output-match stops must enter the bridge in the same event turn. Do not defer them through `setTimeout(0)`, because the process can close before preload records the marker.
- A completed process is successful only when it has no explicit `error` and either `code === 0` or `automationExitMatched === true`. An explicit `error` always wins over the marker.
- Windows `4294967295` remains failed without the marker. Do not normalize that code or any other non-zero code globally.
- Preload retains run identity and output-match semantics in PID results, batch results, and terminal events, then clears the per-PID marker on close/error cleanup.
- While an automation context is active, store event handling rejects missing or different `automationRunId` values before mutating script runtime state or settling the context.
- One recovery writes one plan status and one history row whose script results agree with the recovered terminal status.

### 4. Validation & Error Matrix

- Batch A succeeds, then a manual run or batch B fails -> recovering A remains completed.
- Batch A fails, then batch B succeeds -> recovering A remains failed with A's exit code.
- One batch has multiple scripts -> recovery requires one exact result per script and preserves each script result.
- Missing run id or missing exact result -> mark the old running entry skipped without guessing.
- Concurrent recovery triggers -> one bridge query set and one history row.
- Reconciliation throws -> all current callers observe the failure, the shared operation clears, and the next request can retry.
- A due `run-now` plan exists during project load -> it starts only after old running entries are reconciled; missed-policy evaluation still runs before due collection.
- Output match stops a Windows process with code `4294967295` -> exact batch recovery completes the script and plan.
- The same code without `automationExitMatched` -> recovery fails and retains the exit code reason.
- Stop options contain a stale run id -> preload ignores the marker and recovery fails.
- Manual or timeout stop -> no output-match marker is cached.
- Process close before a deferred output-match stop -> prevented by issuing marker-bearing stops immediately; the completed result retains the marker.
- Result contains both `error` and `automationExitMatched: true` -> recovery fails with the explicit error.
- A stale or identity-less terminal event arrives during a newer run -> current script state and automation context remain unchanged.
- PID is reused after close/error -> the new process cannot inherit the previous marker.

### 5. Good/Base/Bad Cases

- Good: an automation output condition matches, preload validates the run id, and a renderer restart recovers the raw non-zero process result as completed from the structured marker.
- Base: a normal code `0` result completes with or without an automation marker.
- Bad: treating all `4294967295` results as successful, which hides real `exit -1` failures.
- Bad: trusting an `automationExitMatched` option without comparing its run id to active PID metadata.
- Bad: using renderer-only context state as the success source, because it disappears when the renderer closes.

### 6. Tests Required

- Run `npm run validate:process-results` after changing automation launch identity, preload process-result caches, recovery order, or reconciliation concurrency.
- Run `npm run type-check` after changing bridge payload/result signatures or store actions.
- Run `node --check public/preload.js` after changing process metadata, settlement, cache, or cleanup behavior.
- Run `npm run validate:project-storage` and `npm run build` after changing project loading or persisted automation plans.

### 7. Wrong vs Correct

#### Wrong

```ts
const success = code === 0 || code === 4294967295;
```

This converts a real Windows `exit -1` failure into success for every process.

#### Correct

```ts
const success = !result.error && (result.code === 0 || result.automationExitMatched === true);
```

Persist and validate the stop reason instead of inferring intent from a platform-specific exit code.

## Scenario: External Application Preferences

### 1. Scope / Trigger

- Trigger: one device-local external application collection is shared by settings, project cards, project details, and Git repository launch actions.
- This requires code-spec depth because defaults, legacy migration, mutation guards, and one-time launch selection cross local storage, the bridge, Pinia, and Vue menus.

### 2. Signatures

- `ExternalApplication = { id: string; name: string; kind: "vscode" | "cursor" | "custom"; command: string; enabled: boolean }`.
- `ExternalApplicationPreferences = { schemaVersion: 1; defaultApplicationId: string; applications: ExternalApplication[] }`.
- Device-local storage key: `utools-project-launch.local-external-applications.v1`.
- Store mutations: `addExternalApplication(...)`, `updateExternalApplication(...)`, `setExternalApplicationEnabled(...)`, `deleteExternalApplication(...)`, and `setDefaultExternalApplication(...)`.
- Launch actions: `openProjectInEditor(projectId, applicationId?)` and `openGitRepositoryInEditor(projectId, target, applicationId?)`.

### 3. Contracts

- Load the collection once when Pinia is created. Components never access local storage or preload persistence directly.
- VS Code and Cursor have fixed ids and kinds but editable, persisted names and command templates. They cannot be deleted; missing, empty, duplicate, or kind-mismatched stored metadata falls back to the built-in definition.
- Application names are unique and non-empty, and every command template is non-empty. Custom ids are also unique and non-empty. Exactly one default id resolves to an enabled application.
- Disabling or deleting the current default is rejected. Boundary normalization selects the first enabled application, or enables VS Code when none remain.
- When the new key is absent, migrate the legacy local editor key first, then the legacy shared editor key. A valid custom command becomes one enabled custom default; malformed legacy data becomes complete defaults.
- Future saves write only the new device-local key. Legacy keys remain unchanged, and external applications never enter project import/export data.
- No launch id means the current default. An explicit enabled id is one-time selection and must not mutate preferences.
- Settings and launch components call Store actions. Failed launches append project logs instead of throwing into components.

### 4. Validation & Error Matrix

- New key has unsupported schema or damaged JSON -> persist and return complete defaults; do not merge legacy data into an explicitly present invalid document.
- Stored built-in has matching id/kind plus a unique non-empty name and command -> preserve the edited metadata; otherwise restore the affected fields from the built-in definition while preserving a valid enabled flag.
- Duplicate ids/names or empty custom fields -> discard the invalid custom entry.
- Default id is missing or disabled -> choose the first enabled item; no enabled item -> enable and select VS Code.
- Disable/delete default or set disabled item as default -> return `false` without persistence.
- Explicit launch id is unknown or disabled -> append an error log and do not call the launch bridge.
- Project/repository path is unavailable -> no-op or warn through the existing project log path.

### 5. Good/Base/Bad Cases

- Good: settings makes a custom application default, left click uses it everywhere, and right-clicking VS Code launches VS Code once without changing the default.
- Good: settings changes VS Code to `code --reuse-window "{path}"`; the edited name/command survive persistence and the next launch receives the extra argument.
- Good: a device with legacy Cursor preference migrates to the complete collection with Cursor enabled and selected.
- Base: browser preview persists the collection but returns a typed unsupported launch result.
- Bad: a menu writes `defaultApplicationId` when the user chooses a one-time application.
- Bad: storing the collection in project documents or shared `dbStorage`, which leaks machine-specific commands across devices.

### 6. Tests Required

- `npx vitest run src/lib/projectBridge.externalApplications.test.ts` must cover browser/preload defaults, local/shared migration, malformed data, editable built-in round trips and launch arguments, duplicate filtering, default repair, Store default protection, and explicit/default launch selection.
- `npx vitest run src/lib/projectBridge.workspace.test.ts` must assert the resolved Git repository path and selected application payload.
- Run `npm run validate:process-results`, `npm run lint`, `node --check public/preload.js`, and `npm run build` after changing the collection or bridge contract.
- Browser smoke: add/edit/delete/toggle/default controls, both locales, narrow card layout, right-click and keyboard menus, Escape, and viewport clamping.
- uTools smoke: VS Code, Cursor, quoted custom executable, invalid command, restart persistence, and each legacy editor migration.

### 7. Wrong vs Correct

#### Wrong

```ts
store.externalApplicationPreferences.defaultApplicationId = applicationId;
```

#### Correct

```ts
await store.openProjectInEditor(project.id, applicationId);
```

One-time launch selection must flow through the Store without changing the persisted default.

## Scenario: Environment Tool Detection Bridge

### 1. Scope / Trigger

- Trigger: global environment preferences persist enabled built-in tools plus user-defined command-line tools, and the Environment tab publishes each detection result without waiting for the complete refresh batch.
- This requires code-spec depth because preferences, request validation, process execution, refresh concurrency, and stale-result handling cross Vue, Pinia, the browser fallback, and the uTools preload bridge.

### 2. Signatures

- `EnvironmentPreferences = { enabledToolKeys: EnvironmentToolKey[]; customTools: CustomEnvironmentTool[]; builtinOverrides: BuiltinEnvironmentToolOverride[] }`.
- `CustomEnvironmentTool = { id: string; name: string; command: string; versionArgs: string[]; enabled: boolean }`.
- `BuiltinEnvironmentToolOverride = { key: EnvironmentToolKey; command: string; versionArgs: string[] }`.
- `EnvironmentToolRequest = { kind: "builtin"; key: EnvironmentToolKey } | { kind: "builtin-override"; key: EnvironmentToolKey; command: string; versionArgs: string[] } | { kind: "custom"; id: string; name: string; command: string; versionArgs: string[] }`.
- `ProjectBridge.loadBuiltinEnvironmentTools(): EnvironmentToolDefinition[]` synchronously returns the current platform's fixed key/name/default command/default args definitions.
- `ProjectBridge.detectEnvironmentTool(request: EnvironmentToolRequest): Promise<EnvironmentToolResult>`.
- Store action: `refreshEnvironmentTools(targetKeys?: string[]): Promise<void>`.
- Preload helper: `runToolCommand(command, args, direct = false)`; `direct === true` uses native executable/argv spawning except for the validated Windows `.cmd` / `.bat` shim path described below.
- Preload helper: `resolveWindowsDirectCommand(command): Promise<string>` resolves extensionless Windows commands through `where.exe`, preferring `.com` / `.exe` over `.bat` / `.cmd`.

### 3. Contracts

- Components manage preferences and refreshes only through store actions. Settings and Environment read built-in display/command definitions from the store; preload is the real runtime's single source of platform-specific built-in defaults.
- Browser fallback and preload normalization must preserve an explicit empty `enabledToolKeys` list, default only a missing/invalid list, add `customTools: []` and `builtinOverrides: []` for legacy values, and drop malformed/unsafe custom entries or overrides.
- Custom ids are stable, non-empty, and cannot collide with built-in keys. Names and executable commands are non-empty. Commands and each argument token reject shell operators, substitutions, control characters, and empty tokens at both renderer and preload boundaries.
- Built-in tools keep shell-backed execution for terminal PATH compatibility: Windows uses `shell: true`; macOS/Linux uses the user's shell with `-lc` / `-ilc` and quotes each hard-coded token.
- Custom tools and built-in overrides never enter the general shell-backed trusted built-in path. Native commands use direct executable/argv spawning. On Windows, extensionless commands are resolved with `where.exe`; `.com` / `.exe` stay direct, while `.bat` / `.cmd` use explicit `cmd.exe /d /c <resolved-path> <args...>` only after rejecting `" & | < > ^ % ! ( )` from the resolved shim path and arguments. Path lookup uses `where` on Windows or `which` elsewhere and also runs directly.
- Vue event bindings must call `store.refreshEnvironmentTools()` explicitly. A bare `@click="store.refreshEnvironmentTools"` forwards `MouseEvent` as the optional `targetKeys` argument and fails before refresh state can be published.
- Every command keeps the 5-second timeout and shared output decoding. Detection checks version first, then path; the version is the first stdout line or, when stdout is empty, the first stderr line.
- Pinia runs at most four single-tool bridge promises concurrently. Each result is upserted immediately when it settles; one rejection becomes that tool's typed error result and does not stop sibling workers.
- Per-key request generations protect overlapping refreshes and configuration changes. A queued item must revalidate its generation and request snapshot before starting; a settled item must repeat both checks before writing. Editing, disabling, deleting, saving/restoring a built-in override, or re-enabling a tool invalidates its generation, clears its result, and prevents stale queued commands from executing.
- Manual refresh keeps previous values visible while `environmentRefreshingKeys[key]` is true. Initial detection shows a skeleton only for keys that have no previous result. Global `environmentRefreshing` remains true until every overlapping refresh batch has settled.

### 4. Validation & Error Matrix

- Legacy `{ enabledToolKeys }` -> preserve valid keys and normalize `customTools` plus `builtinOverrides` to `[]`.
- Explicit `enabledToolKeys: []` -> preserve the empty list so a custom-only configuration survives reload.
- Empty/unsafe custom name, command, id, or argument -> reject at save/normalization; an invalid bridge request returns a typed `error` result without spawning.
- Unknown or unsafe built-in override -> drop it during persistence normalization; reject it again at renderer request construction and preload execution without spawning.
- Built-in npm/pnpm shim available only through the user's terminal shell -> shell-backed built-in detection resolves it.
- Custom command missing from PATH -> return `missing` for that key; sibling tools continue and publish independently.
- Windows `code` resolves to `code.cmd` -> launch the resolved shim through restricted `cmd.exe`, return the first version line, and report `code.cmd` as the executable path.
- Windows shim argument contains `%PATH%`, `!value!`, `^`, parentheses, quotes, or command operators -> return a typed failure before starting `cmd.exe`.
- Refresh button click -> invoke the Store action with no argument; never treat the framework event object as a key collection.
- Command hangs -> kill after 5 seconds and return a timeout failure result for that key.
- Custom item edited, disabled, or deleted, or built-in override saved/restored while running -> ignore the late result and keep the item invalidated.
- Custom item invalidated while waiting behind four active workers -> skip it before bridge invocation; do not execute the old command merely to discard its result later.
- Older refresh settles after a newer refresh for the same key -> keep the newer result and keep global refreshing true until both batches settle.

### 5. Good/Base/Bad Cases

- Good: npm resolves through the user's shell while a custom Java request uses direct `spawn("java", ["-version"])`; Java finishes first and its card updates while npm remains checking.
- Good: custom VS Code resolves `code` to `code.cmd`, runs `code -v` through the restricted shim path, and publishes the version plus resolved path.
- Good: five tools refresh, only four bridge calls start, and disabling the queued fifth custom tool prevents its old executable from starting.
- Base: browser preview persists custom configuration and returns one unsupported typed result per requested tool without local process access.
- Bad: returning one `Promise.all` result array to Pinia, which forces the UI to wait for the slowest tool before showing any result.
- Bad: checking request generations only after `detectEnvironmentTool` resolves; queued stale custom commands still execute even though their results are discarded.
- Bad: passing custom executable text through `shell: true`, which turns a restricted executable/args model back into an arbitrary shell surface.
- Bad: binding the refresh action as a bare click handler, which forwards `MouseEvent` into `targetKeys` and makes `new Set(targetKeys)` throw.

### 6. Tests Required

- `npx vitest run src/lib/environmentTools.test.ts` must assert quoted argument round-trips, shell-operator rejection, legacy/explicit-empty preference normalization, a four-request concurrency ceiling, out-of-order immediate publication, failure isolation, edit/disable/delete late-result rejection, queued invalidation before bridge invocation, and newer-refresh precedence.
- Run `npm run lint`, `npm run type-check`, `node --check public/preload.js`, and `npm run build` after changing this boundary.
- Browser smoke: add/edit/toggle/delete a custom tool, reload to verify persistence, and confirm preview results settle per card without horizontal overflow.
- Browser smoke: click refresh and assert at least one card's `checkedAt` changes; this catches accidental event forwarding into `targetKeys`.
- Windows preload VM probe: detect `{ kind: "custom", command: "code", versionArgs: ["-v"] }`, assert `available`, the terminal-visible version, and a `.cmd` executable path; repeat with `%PATH%` and assert rejection before execution.
- Manual uTools smoke on Windows: detect shell-visible npm/pnpm plus a custom Java-style tool, verify the real executable path, one missing command, one near-timeout command, and quick-before-slow publication.
- Manual uTools smoke on macOS/Linux: verify shell-initialized built-ins and direct custom tool detection both resolve through their intended execution paths.

### 7. Wrong vs Correct

#### Wrong

```ts
const results = await bridge.detectEnvironmentTools(enabledKeys);
this.environmentResults = results;
```

This waits for the slowest tool and cannot publish per-key progress.

#### Correct

```ts
await Promise.all(
  Array.from({ length: Math.min(4, requests.length) }, async () => {
    while (nextIndex < requests.length) {
      const { key, request } = requests[nextIndex++]!;
      if (!requestIsCurrent(key, request)) continue;
      const result = await bridge.detectEnvironmentTool(request);
      if (requestIsCurrent(key, request)) upsertEnvironmentResult(result);
    }
  }),
);
```

Use bounded single-item promises and validate both before execution and before publication.

#### Wrong

```js
spawn(custom.command, custom.versionArgs, { shell: true });
```

This reintroduces shell parsing for user-defined input.

#### Correct

```js
spawn(custom.command, custom.versionArgs, {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
```

Keep custom executable and argument tokens separate. General shell-backed execution remains limited to trusted built-ins; only validated Windows `.cmd` / `.bat` shims use the restricted interpreter path.

#### Wrong

```vue
<button @click="store.refreshEnvironmentTools">刷新</button>
```

Vue forwards the click event as the action's first argument, but that argument is reserved for an optional key array.

#### Correct

```vue
<button @click="store.refreshEnvironmentTools()">刷新</button>
```

Keep framework event payloads out of domain-action parameters.

## Scenario: Streaming AI Bridge Actions

### 1. Scope / Trigger

- Trigger: a component needs progressive AI output while the actual provider call crosses Vue component -> Pinia store -> project bridge -> uTools preload.
- Applies to Git AI analysis flows, including the Git tab batch "AI生成" dialog and commit detail AI analysis panel.

### 2. Signatures

- Type contract: `ProjectBridge.analyzeWithAiStream(payload, onChunk, onDone): Promise<void>`.
- Store action: `analyzeGitWithAiStream(projectId: string, prompt: string, handlers?: AiStreamHandlers): Promise<AiAnalyzeResult>`.
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
- `onDone` must fire exactly once for every started analysis path, including validation failures, thrown bridge errors, and a bridge promise that resolves without invoking its completion callback.
- OpenAI-compatible and Anthropic-compatible providers use real SSE / `ReadableStream` parsing in preload and emit chunks as provider deltas arrive.
- uTools built-in AI supports real streaming through `utools.ai(option, streamCallback)`. The preload `provider === "utools"` branch should call the streaming signature, keep `delta.reasoning_content` in `chunk.reasoning`, keep `delta.content` in `chunk.content`, and keep `chunk.rawContent` as the provider-order concatenation for conservative parsing/debug preservation. User-facing copy actions should copy `content`, not `rawContent`.
- OpenAI-compatible streams should preserve provider reasoning fields such as `delta.reasoning_content`, `delta.reasoning`, `delta.thinking`, or `message.reasoning_content` separately from `delta.content` when present.
- Components should use the shared AI reasoning stream helpers to merge chunks, parse conservative inline tags, and render final content. Do not concatenate structured reasoning into the visible answer before the UI has a chance to collapse it.
- AI commit message generation should mirror each non-empty visible content delta into the Git commit textarea so real provider streaming remains visible. It must not render a separate generated-result box in the changed-files sidebar or copy structured reasoning or raw preservation text into the textarea.
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
- Bridge resolves without calling `onDone` -> store calls `onDone({ ok: false, content: "", message: "AI 流式响应未返回完成结果。" })` so the component leaves loading.
- Bridge calls `onDone` then throws -> store must not call `onDone` a second time.

### 5. Good/Base/Bad Cases

- Good: a commit detail panel keeps its own `streamingText`, appends chunks, and switches from loading to success/warning/error in `onDone`.
- Good: a Git AI panel keeps `content`, `reasoning`, and `rawContent` in one local AI reasoning stream state, rendering reasoning through a default-collapsed block while final content continues streaming.
- Good: commit-message generation mirrors only non-empty visible `content` chunks into its controlled textarea and reports success after `onDone`, replacing the parent loading feedback.
- Good: settings edits an AI mode prompt, and both the batch Git AI dialog and commit detail AI panel use that prompt on their next generation.
- Good: uTools built-in AI streams deltas via `onChunk` and returns the aggregated content in `onDone.content` when the streaming promise resolves.
- Base: a third-party provider sends small SSE deltas and the component appends them directly into its local result text.
- Base: a provider sends no reasoning fields; content renders exactly like the old path and no empty reasoning block appears.
- Bad: a component sets loading before calling the store action, the bridge throws, and no `onDone` handler clears loading.
- Bad: updating only an invisible local commit-message result in `onChunk` and waiting until `onDone` to update the textarea; this hides real streaming from the user.
- Bad: emitting the full uTools result via `onChunk` to create the appearance of streaming.
- Bad: joining `reasoning_content` and `content` into one string before calling `onChunk`, because the UI can no longer collapse reasoning reliably.

### 6. Tests Required

- `npm run lint` after changing `ProjectBridge`, `AiAnalyzeResult`, or store AI actions.
- `npm run validate:ai-reasoning` after changing inline tag parsing, stream merging, or AI reasoning display behavior.
- `npm run build` after changing Vue templates that render streaming output.
- `npx vitest run src/store/useStore.aiStream.test.ts` must prove a missing completion callback produces one error result and duplicate callbacks preserve the first terminal result.
- Manual smoke test with a third-party provider: verify text appears progressively and the final state changes from loading to success.
- Manual smoke test for commit-message generation: verify visible content progressively replaces the textarea value, structured reasoning never enters it, and the top-right loading feedback becomes success after completion.
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
const complete = (result) => {
  if (completed) return;
  completed = true;
  onDone(result);
};
try {
  await bridge.analyzeWithAiStream(payload, onChunk, (result) => {
    complete(result);
  });
  if (!completed) {
    complete({ ok: false, content: "", message: "AI 流式响应未返回完成结果。" });
  }
} catch (error) {
  if (!completed) {
    complete({ ok: false, content: "", message: error instanceof Error ? error.message : "AI 分析失败。" });
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

- Trigger: project file browsing, Markdown local assets, project-wide name search, and file mutations cross the Vue component, Pinia store, browser fallback bridge, and uTools preload filesystem boundary.

### 2. Signatures

- `ProjectBridge.listProjectFiles(projectPath: string, relativePath?: string): Promise<ProjectFileTreeEntry[]>`
- `ProjectBridge.readProjectFile(projectPath: string, relativePath: string): Promise<ProjectFileReadResult>`
- `ProjectBridge.writeProjectFile(projectPath: string, relativePath: string, content: string): Promise<ProjectFileWriteResult>`
- `ProjectBridge.searchProjectFiles(projectPath: string, query: string, options?: { limit?: number }): Promise<ProjectFileSearchResult>`
- `ProjectBridge.createProjectEntry(projectPath: string, parentRelativePath: string, name: string, kind: "file" | "directory"): Promise<ProjectFileMutationResult>`
- `ProjectBridge.renameProjectEntry(projectPath: string, relativePath: string, name: string): Promise<ProjectFileMutationResult>`
- `ProjectBridge.deleteProjectEntry(projectPath: string, relativePath: string): Promise<ProjectFileMutationResult>`
- `ProjectBridge.showProjectEntryInFolder(projectPath: string, relativePath: string): Promise<void>`

### 3. Contracts

- UI components must call store actions for file operations; they must not call `window.projectBridge` directly.
- `listProjectFiles` loads only one directory level per call. Directory expansion in the UI should request the next level on demand instead of recursively scanning a whole project.
- The preload layer must canonicalize the project root with `realpath`, check the lexical target is under that root, then check the existing target or creation parent resolves under the same canonical root. A lexical `path.resolve` / `path.relative` check alone does not stop a project-local symlink from reaching outside the project.
- Listing and recursive search must skip symbolic links. Direct read, write, rename, or delete of a symbolic link is unsupported even when the link points inside the project; mutation code must never operate on the link target accidentally.
- Creation may resolve an existing parent path, but the canonical parent must remain inside the canonical project root and be a directory. Create files exclusively and reject collisions instead of overwriting.
- The file tree must hide heavyweight or generated directories by default, including `node_modules`, `.git`, `.venv`, build output, and cache directories.
- Project-wide name search is asynchronous, bounded, case-insensitive, and isolated per directory: one unreadable/disappearing directory does not fail the whole scan. The UI uses a request generation so stale responses cannot replace a newer query.
- Create and rename accept one basename only. Reject separators, control characters, Windows reserved names, trailing dot/space, collisions, and project-root mutation.
- Expected mutation failures return the typed `ok: false` result and a user-facing message; browser fallback keeps every async signature and returns unsupported results without changing mock state.
- Text files may be read and written as UTF-8. Lightweight binary previews such as small images may return a preview payload; unknown binary files should return an unsupported result rather than being exposed as editable text.
- Files Tab Markdown local images reuse `readProjectFile`; frontend path classification is only an early filter, while preload canonical checks and existing image type/size limits remain authoritative.
- Browser fallback must return safe empty/unsupported results and keep the same async API shape so the UI can render in preview mode.

### 4. Validation & Error Matrix

- Empty or missing `projectPath` -> return an empty tree or unsupported read result.
- Missing path on disk -> return an empty tree or a file read/write failure result; do not crash the UI.
- Relative path escapes the project root -> reject the operation.
- Lexical path stays inside the root but an intermediate symlink resolves outside -> reject before reading, writing, creating, revealing, renaming, or deleting.
- Target itself is a symbolic link -> omit it from list/search and reject direct read/write/mutation.
- One nested search directory is unreadable or disappears -> skip that branch and return other matches.
- Empty/invalid/reserved basename, collision, or root mutation -> return `ok: false` without changing disk or optimistic UI state.
- Directory is ignored -> omit it from tree results.
- File is too large or binary/unsupported -> return a non-editable preview/error state instead of decoding as text.

### 5. Good/Base/Bad Cases

- Good: opening the file tab loads only root-level entries, then expanding `src` loads just `src` children.
- Good: double-clicking a text file enters edit mode and saving goes through the store action, bridge, and preload boundary.
- Good: a project-local link points outside the root; list/search omit it and read/write/delete calls reject it without touching the target.
- Base: browser preview shows an empty or unavailable file browser without throwing.
- Bad: recursively scanning the whole project tree on tab mount.
- Bad: reading an unknown binary file as UTF-8 and enabling save.
- Bad: validating only `path.relative(projectRoot, path.resolve(projectRoot, input))`, then using `fs.realpathSync` or recursive removal on the unchecked target.

### 6. Tests Required

- `npm run validate:project-files` must assert ignored directories, bounded search, invalid names, collisions, create/rename/delete behavior, root/traversal rejection, and both internal/external symbolic-link cases where the platform permits fixtures.
- `npm run validate:markdown-images` must assert local/external/blocked image classification and isolated render failures.
- `npm run type-check` should verify shared bridge types across `src/types.ts`, `src/lib/projectBridge.ts`, store actions, and components.
- `node --check public/preload.js` must pass after filesystem boundary changes.
- `npm run build` should verify the Vue file-browser components compile.
- Manual smoke test: open file tab, expand/filter, preview and save a text file, create/rename/delete entries, reveal one in the system file manager, and confirm ignored/link entries do not appear.

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

#### Wrong

```js
const targetPath = path.resolve(projectRoot, relativePath);
if (!path.relative(projectRoot, targetPath).startsWith("..")) {
  fs.rmSync(targetPath, { recursive: true });
}
```

This checks only path spelling. An entry below `projectRoot` can still be a symbolic link whose real target is outside the project.

#### Correct

```js
const rootPath = fs.realpathSync(projectRoot);
const lexicalTarget = path.resolve(rootPath, relativePath);
assertPathWithinRoot(rootPath, lexicalTarget);
if (fs.lstatSync(lexicalTarget).isSymbolicLink()) throw new Error("不支持操作符号链接。");
const targetPath = fs.realpathSync(lexicalTarget);
assertPathWithinRoot(rootPath, targetPath);
```

Validate both lexical and canonical boundaries, and reject direct link mutation before using the resolved target.

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
- The Git history viewport uses a fixed-height bottom sentinel observed with `IntersectionObserver` (`root` is the graph scrollport; bottom `rootMargin` is about `120px`) instead of a manual load-more button. One false-to-true intersection may request one page only; an already intersecting sentinel must not recursively chase filtered history to the repository end.
- The sentinel stays mounted at a stable height and shows only an in-place spinner while loading. Commit rows retain stable hash keys and append below the existing list so scroll position and graph coordinates do not jump.
- Disconnect the observer when its scrollport/sentinel changes, the commit tree closes, the repository context changes, or the component unmounts.

### 4. Validation & Error Matrix

- Missing Git repository -> return an empty snapshot with `hasMoreCommits: false`.
- Invalid `limit` or `skip` -> clamp to a safe bounded page in preload.
- Loading more with no existing snapshot -> no-op.
- Sentinel remains intersecting after a filtered append -> do not immediately request another page; wait for a new false-to-true intersection.
- Commit tree closes, repository context changes, or the component unmounts -> disconnect the old observer so it cannot request against stale data.
- Stage/unstage while a full refresh is in flight -> keep the latest status/files from the lightweight refresh, but still accept the full refresh's first commit page when HEAD/reference state has not changed.
- Commit, branch switch, or checkout while a full refresh is in flight -> reject or ignore the stale full refresh commit page unless it was started after the ref-changing mutation.

### 5. Good/Base/Bad Cases

- Good: the Git tab shows the first page quickly and appends one additional page as its bottom sentinel enters the graph viewport prefetch margin.
- Good: staging one file updates W/S counts and row state without paying for another `git log` page.
- Base: a small repository returns fewer than `limit` commits and renders no actionable sentinel content.
- Bad: running `git log --all` without a max count and rendering every commit.
- Bad: implementing load-more by calling `readGitSnapshot` and replacing the entire Git snapshot, which makes status refresh slow and can overwrite current worktree state.
- Bad: observing the sentinel without an intersection-edge guard, which can recursively load every history page when filtering leaves it visible.

### 6. Tests Required

- `npm run lint` should verify the bridge option signature across types, fallback bridge, store, and components.
- `npm run build` should verify the Git tab compiles with the pagination UI.
- Browser smoke should verify one page per new sentinel intersection, stable scroll position/spinner height, and observer cleanup after collapsing or switching repositories.

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
- Trigger: worktree review must distinguish the index (`staged`) from the working tree (`unstaged`) while existing AI callers still need a combined file diff.

### 2. Signatures

- `ProjectGitDiffScope = "combined" | "staged" | "unstaged"`
- `ProjectGitFileDiffOptions = { scope?: ProjectGitDiffScope }`
- `ProjectGitFileDiffResult = { path: string; scope?: ProjectGitDiffScope; diff: string; message?: string }`
- `ProjectBridge.readGitFileDiff(projectPath: string, relativePath: string, options?: ProjectGitFileDiffOptions): Promise<ProjectGitFileDiffResult>`
- `readGitFileDiff(projectId: string, relativePath: string, options?: ProjectGitFileDiffOptions): Promise<ProjectGitFileDiffResult | null>`

### 3. Contracts

- UI components must call the store action, not `window.projectBridge` or Git directly.
- `relativePath` is project-relative and must be resolved under the Git repository root in preload before running Git.
- Missing or invalid `options.scope` normalizes to `combined`. This preserves existing batch-AI callers that intentionally collect the complete file diff without passing an option.
- Visible worktree review must pass `staged` or `unstaged` explicitly. It must not present a `combined` diff as the content of either source-control group.
- `staged` returns only `git diff --cached -- <path>` output.
- `unstaged` returns only `git diff -- <path>` output plus the existing untracked-file fallback when the path is not tracked.
- `combined` preserves the legacy cached + worktree + untracked concatenation.
- The result echoes the normalized scope so consumers can reject mismatched responses.
- Untracked files may use `git diff --no-index` against `os.devNull`; this command returns exit code `1` when differences exist, so diff-specific command handling must preserve stdout instead of treating all non-zero exits as empty output.
- Browser fallback must return an empty diff with a user-facing message.
- GitTab must key worktree selection by `{ path, scope }`, because one path can have both staged and unstaged changes. Rapid selection changes use a request generation (or equivalent identity check) so an older async response cannot overwrite the currently selected diff.
- Search and group collapse are presentation-only. They must not narrow stage-all, unstage-all, or discard-all inputs, which remain owned by the complete live Git status contract.

### 4. Validation & Error Matrix

- Missing Git repository -> return `{ path, diff: "", message: "未检测到 Git 仓库" }`.
- Empty path -> return an empty diff with a choose-file message.
- Path traversal outside repository -> reject through the existing child-path resolver.
- Missing or unknown scope -> normalize to `combined`, return `scope: "combined"`, and do not pass the unknown value into command selection.
- `staged` requested with only unstaged changes -> return an empty staged result and a scope-specific user-facing message.
- `unstaged` requested with only staged changes -> return an empty unstaged result and a scope-specific user-facing message.
- Untracked regular file requested as `unstaged` -> preserve valid `--no-index` stdout even though Git exits with code `1`.
- Response completes after the selected path, scope, project, or commit changes -> ignore it and keep the newer selection state.

### 5. Good/Base/Bad Cases

- Good: selecting the staged instance of a mixed-scope file calls `store.readGitFileDiff(project.id, file.path, { scope: "staged" })` and shows only the exact content included by the next commit.
- Good: batch AI calls `store.readGitFileDiff(project.id, file.path)` without a scope and keeps the complete combined context.
- Base: deleted files can show a diff even though they cannot be opened in the Files tab.
- Base: browser preview echoes the normalized scope with an unavailable message and keeps the same async API shape.
- Bad: using the generic `runGit` helper for `git diff --no-index`, which drops valid diff stdout because the command exits with code `1`.
- Bad: changing the default scope to `unstaged`, which silently removes cached changes from existing AI context.
- Bad: selecting rows by path only, which collapses staged and unstaged instances of the same file and makes action migration ambiguous.

### 6. Tests Required

- `npm run validate:git-diff` must assert staged-only, unstaged-only, combined, untracked, empty-path, traversal-rejection, and invalid-scope normalization against a temporary repository.
- `npm run test:git-diff` must assert unified-diff line-number parsing, multiple hunks, omitted counts, metadata, no-newline markers, binary text, empty input, and malformed headers.
- `npm run type-check` must verify the options/result contract across `src/types.ts`, fallback bridge, store, and components.
- `node --check public/preload.js` must pass after changing scope normalization or Git command selection.
- `npm run build` must verify the Git diff UI compiles.
- Manual uTools smoke test: staged-only, unstaged-only, same-file mixed scope, deleted, renamed, untracked, and binary files each show the expected scope or an explicit unavailable message.

### 7. Wrong vs Correct

#### Wrong

```ts
const diff = await store.readGitFileDiff(project.id, file.path);
```

This uses the compatible combined default and cannot prove which source-control group the visible review represents.

#### Correct

```ts
const diff = await store.readGitFileDiff(project.id, file.path, { scope: selectedFile.scope });
```

Keep Git diff reads behind the store action and make visible worktree scope explicit; reserve the combined default for callers such as batch AI that deliberately need both sources.

## Scenario: Git Lightweight Write Actions

### 1. Scope / Trigger

- Trigger: Git write actions cross the Git tab, Pinia store, browser fallback bridge, and uTools preload Git command boundary.

### 2. Signatures

- `ProjectGitFileChange = { path: string; originalPath?: string; additions: number; deletions: number; status: ...; staged?: boolean; unstaged?: boolean }`
- `ProjectGitBranchSummary = { name: string; current: boolean }`
- `ProjectGitActionResult = { ok: boolean; message: string; blockReason?: "dirty-worktree" | "unmerged-branch"; path?: string; paths?: string[]; count?: number; branch?: string; commitHash?: string; isDetachedHead?: boolean }`
- `ProjectGitCommitMessageDiffResult = { ok: boolean; scope: "staged" | "working-tree"; diff: string; truncated?: boolean; message?: string }`
- `ProjectGitStatusSnapshot = { branch: string; headHash?: string; isDetachedHead?: boolean; ahead: number; behind: number; files: ProjectGitFileChange[]; branches?: ProjectGitBranchSummary[]; repositoryPath: string; lastRefreshedAt: string; statusText: string }`
- `ProjectBridgeGitWorkingTreeSnapshot = { files: ProjectGitFileChange[]; repositoryPath: string; lastRefreshedAt: string; statusText: string }`
- `ProjectGitCommitPage = { commits: ProjectGitCommitSummary[]; hasMoreCommits?: boolean; repositoryPath: string; lastRefreshedAt: string }`
- `ProjectGitSnapshot = { branch: string; headHash?: string; isDetachedHead?: boolean; ahead: number; behind: number; files: ProjectGitFileChange[]; commits: ProjectGitCommitSummary[]; branches?: ProjectGitBranchSummary[]; ... }`
- `ProjectBridge.readGitStatusSnapshot(projectPath: string): Promise<ProjectBridgeGitStatusSnapshot>`
- `ProjectBridge.readGitWorkingTreeSnapshot(projectPath: string): Promise<ProjectBridgeGitWorkingTreeSnapshot>`
- `ProjectBridge.readGitCommits(projectPath: string, options?: { limit?: number; skip?: number }): Promise<ProjectBridgeGitCommitPage>`
- `ProjectBridge.stageGitFile(projectPath: string, relativePath: string): Promise<ProjectGitActionResult>`
- `ProjectBridge.unstageGitFile(projectPath: string, relativePath: string): Promise<ProjectGitActionResult>`
- `ProjectBridge.discardGitFile(projectPath: string, relativePath: string): Promise<ProjectGitActionResult>`
- `ProjectBridge.stageGitFiles(projectPath: string, relativePaths: string[]): Promise<ProjectGitActionResult>`
- `ProjectBridge.unstageGitFiles(projectPath: string, relativePaths: string[]): Promise<ProjectGitActionResult>`
- `ProjectBridge.discardGitFiles(projectPath: string, relativePaths: string[]): Promise<ProjectGitActionResult>`
- `ProjectBridge.commitGitStaged(projectPath: string, message: string): Promise<ProjectGitActionResult>`
- `ProjectBridge.switchGitBranch(projectPath: string, branchName: string, options?: { force?: boolean }): Promise<ProjectGitActionResult>`
- `ProjectBridge.checkoutGitCommit(projectPath: string, commitHash: string, options?: { force?: boolean; preferredBranch?: string; detach?: boolean }): Promise<ProjectGitActionResult>`
- `ProjectBridge.createGitBranch(projectPath: string, branchName: string, commitHash: string, options?: { checkout?: boolean; force?: boolean }): Promise<ProjectGitActionResult>`
- `ProjectBridge.createGitTag(projectPath: string, tagName: string, commitHash: string, options?: { annotated?: boolean; message?: string }): Promise<ProjectGitActionResult>`
- `ProjectBridge.renameGitBranch(projectPath: string, branchName: string, nextBranchName: string): Promise<ProjectGitActionResult>`
- `ProjectBridge.deleteGitBranch(projectPath: string, branchName: string, options?: { force?: boolean }): Promise<ProjectGitActionResult>`
- `ProjectBridge.checkoutGitRemoteBranch(projectPath: string, remoteRef: string, options?: { force?: boolean }): Promise<ProjectGitActionResult>`
- `ProjectBridge.readGitCommitMessageDiff(projectPath: string): Promise<ProjectGitCommitMessageDiffResult>`

### 3. Contracts

- Components call store actions such as `store.stageGitFile(project.id, file.path)`, never `window.projectBridge` directly.
- Store actions resolve the project id to the project path, call the bridge, and choose the lightest post-write refresh that preserves correctness.
- Stage/unstage single-file and batch actions should bump the Git mutation version and await `readGitWorkingTreeSnapshot(project.path)` after successful writes. Fresh porcelain and staged/unstaged numstat output remain authoritative for rename, untracked, partial-stage, batch, and concurrent working-tree changes; the Store replaces only files and status metadata while retaining the current branch, HEAD, refs, remotes, upstream, and commits. A detached snapshot keeps its `detached HEAD @ <hash> ·` status prefix.
- The working-tree reader may do root discovery, NUL-delimited porcelain, and unstaged/staged numstat reads, but must not issue commit, ref, branch, remote, or upstream reads on the stage/unstage foreground path.
- Start forced workspace inventory after an index-only write without awaiting it. `refreshGitWorkspace` catches its own bridge failures and accepts results only while its force token and project path remain current, so background inventory cannot create an unhandled rejection or replace newer data.
- Commit, branch switch, checkout, and discard actions can change HEAD, refs, or file contents beyond index-only state; refresh `readGitSnapshot(project.path, { limit: 80, skip: 0 })` after successful results.
- Create/rename/delete branch, create tag, tracking checkout, branch switch, and commit checkout are ref mutations. Route them through `runAuthorizedGitWrite` with `{ refresh: "full", refs: true }` so every related repository snapshot and stale ref request is invalidated.
- Full, status, and working-tree refreshes may overlap. The store must track mutation/ref versions so a stale full refresh does not overwrite newer status/files, and the working-tree coordinator must check its own token after the bridge await. Clearing coordination on project replacement must reject an A -> B -> A old response even when the context key later matches again.
- Every automatic GitTab missing-snapshot path, including its workspace inventory watcher, calls `refreshGitSnapshot` without `force` so it joins the Store's context-scoped initial request. `refreshActiveRepository` is the manual path and remains forced.
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
  - `checkoutGitCommit(..., { detach: true })` bypasses branch-tip preference and always enters detached HEAD. Branch-aware and explicit-detached actions must not share an ambiguous UI label.
  - Create-and-switch and remote tracking checkout must return `blockReason: "dirty-worktree"` before creating or switching refs when confirmation is required. Do not infer this state from localized messages.
  - Local branch deletion first uses safe semantics. An unmerged branch returns `blockReason: "unmerged-branch"`; only a second app-rendered danger confirmation may call `deleteGitBranch(..., { force: true })`. Current branch deletion remains rejected at both UI and preload boundaries.
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
- Dirty ref-changing checkout without force -> bridge also returns `blockReason: "dirty-worktree"`; no branch/tag mutation occurs before confirmation.
- Branch switch with uncommitted changes after app confirmation -> UI calls `switchGitBranch(..., { force: true })`; preload runs `git switch --discard-changes -- <branch>`, returns `{ ok: true, branch }` on success, and the store refreshes the snapshot.
- Unknown local branch -> bridge returns `{ ok: false, message: "只能切换到已有本地分支。" }`.
- Commit checkout with uncommitted changes and no force option -> bridge returns `{ ok: false, commitHash, message: "当前工作区存在未提交变更..." }` and does not run `git switch --detach`.
- Commit checkout with uncommitted changes after app confirmation -> UI calls `checkoutGitCommit(..., { force: true })`; preload runs either `git switch --discard-changes -- <branch>` for a matching local branch tip or `git switch --discard-changes --detach <hash>` otherwise, and the store refreshes the snapshot.
- Commit checkout with an invalid or missing hash -> bridge returns `{ ok: false, message: "请选择一个有效的提交 hash。" }` or a not-found commit message.
- Commit checkout target equals a local branch tip -> bridge returns `{ ok: true, branch, commitHash, isDetachedHead: false }`, and the refreshed snapshot should show the branch name rather than detached HEAD.
- Commit checkout target is not any local branch tip -> bridge returns `{ ok: true, commitHash, isDetachedHead: true }`, and the refreshed snapshot should show detached HEAD.
- Detached HEAD snapshot -> `branch` may be `"HEAD"`, `isDetachedHead` is `true`, and `headHash` carries the current short commit hash for UI labels.
- Safe delete of an unmerged branch -> bridge returns `blockReason: "unmerged-branch"` and leaves the branch intact; force delete is attempted only after the second danger confirmation.
- Stage/unstage after a detached snapshot -> fresh files/status update while the displayed status retains `detached HEAD @ <hash> ·`.
- Workspace inventory rejects after a successful stage/unstage -> foreground action resolves from the working-tree snapshot; inventory logs a warning and does not reject into the caller.
- Project path changes A -> B -> A while a working-tree read is pending -> the pre-reset token cannot merge its old files after the new A request settles.
- Parent initial refresh, GitTab restore, and its workspace watcher overlap -> one `readGitSnapshot` bridge call; an explicit manual refresh remains a forced replacement.

### 5. Good/Base/Bad Cases

- Good: clicking a file stage button calls the store, preload runs `git add -- <file>`, then the Store awaits the fresh working-tree snapshot while workspace inventory continues in the background; the row shows Git-derived staged state without reloading the commit graph.
- Good: AI commit message generation includes actual diff text from staged changes, and falls back to working-tree diff only when nothing is staged.
- Good: editing the commit-message prompt in Settings persists through browser fallback and preload storage, then the next Git tab generation uses that stored template.
- Good: the changed-files panel keeps stage/unstage/discard controls in the header and shows immediate per-file loading feedback before the refreshed snapshot arrives.
- Good: switching to a clean local branch refreshes branch, graph, files, and command-running views naturally see the new working tree.
- Good: checking out a selected commit from the commit detail dialog switches back to a matching local branch tip when one exists; otherwise it enters detached HEAD, refreshes files/branch/graph, and highlights the current commit through `headHash`.
- Good: creating a branch without checkout changes only refs; checking the opt-in box performs one atomic create-and-switch operation after any required dirty-worktree confirmation.
- Good: local and remote ref actions share authorized repository routing but expose different UI capabilities and preload commands.
- Base: browser preview shows safe unavailable messages for write actions but still renders the Git tab.
- Base: browser preview returns the typed empty working-tree snapshot and retains the existing full snapshot metadata.
- Bad: a component directly calls `window.projectBridge.commitGitStaged(...)` and then forgets to refresh `project.git`.
- Bad: awaiting workspace inventory alongside the working-tree snapshot after every stage/unstage, or merging a pre-reset working-tree result after a newer same-context request settles.
- Bad: running `spawn("git add " + filePath, { shell: true })`, which creates shell injection risk.
- Bad: using recursive filesystem deletion for a Git discard action from a compact UI.
- Bad: showing a native confirmation dialog for discard, because it can hide or detach the compact uTools plugin UI.

### 6. Tests Required

- `npm run type-check` should verify bridge contracts across `src/types.ts`, fallback bridge, store actions, and components.
- `npm run build` should verify the Git tab template compiles.
- `npm run validate:git-commits` should verify structured refs and every branch/tag mutation against a real temporary repository.
- `npx vitest run src/lib/projectBridge.workspace.test.ts` should verify exact repository routing, one shared parent/GitTab/workspace initial snapshot with a forced manual refresh, foreground working-tree-only stage/unstage calls, background inventory completion, stale-target/mutation/project-reset rejection, detached status preservation, and ref invalidation for the new store actions.
- `npm run validate:git-commits` must also assert that working-tree snapshots preserve staged renames, nested untracked files, and partial staging.
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

```ts
await Promise.all([
  this.refreshGitStatusSnapshot(projectId, target),
  this.refreshGitWorkspace(projectId, { force: true }),
]);
```

This makes unrelated branch/ref/workspace work gate an index-only action.

#### Correct

```ts
void this.refreshGitWorkspace(projectId, { force: true });
await this.refreshGitWorkingTreeSnapshot(projectId, target);
```

The foreground merges only fresh Git-derived file state; the workspace action owns error handling and token-guarded background publication.

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

## Scenario: Git Repository Inventory And Selected Context Boundary

### 1. Scope / Trigger

- Trigger: linked-worktree or direct-submodule inventory crosses `GitTab.vue`, Pinia, the typed browser fallback, and the uTools preload Git reader, then a selected healthy repository drives ordinary Git reads and writes.
- This requires code-spec depth because machine-format parsing, process limits, transient repository identity, write authorization, and stale-result handling must agree across every layer.

### 2. Signatures

- `ProjectGitRepositoryTarget = { kind: "main" } | { kind: "worktree"; path: string } | { kind: "submodule"; path: string }`.
- `resolveGitRepositoryContext(projectId, target): ProjectGitRepositoryContext | null`.
- `ProjectBridge.readGitWorkspaceSnapshot(projectPath: string): Promise<ProjectBridgeGitWorkspaceSnapshot>`.
- `refreshGitWorkspace(projectId: string, options?: { force?: boolean }): Promise<void> | undefined`.
- Git store reads/writes keep a main-target default for compatibility but accept an explicit repository target; `GitTab.vue` always passes its active target.
- Transient state includes `gitWorkspaces[projectId]`, workspace refresh flags, and full related snapshots/refresh flags keyed by authorized repository context.

### 3. Contracts

- Inventory reads use stable machine formats with argv-only Git processes: worktree porcelain `-z`, status porcelain v2 `-z`, null-delimited config, and `ls-files --stage -z`. Do not add worktree/submodule lifecycle commands or recursive submodule traversal.
- Split worktree fields at the first ASCII space, tolerate unknown attributes/headers, consume the second pathname after porcelain-v2 type `2`, and preserve full SHA-1/SHA-256 object IDs.
- Stream status and index NUL records instead of retaining every pathname. Keep at most four entry workers active, execute one Git child at a time inside each worker, and apply one 30-second deadline to each entry.
- A timeout is a failure even when process close reports code `0`; bound captured stderr and preserve healthy sibling entries and the other section.
- Correlate direct submodules from `.gitmodules`, local config, parent index gitlinks, and `--show-superproject-working-tree`. A submodule target is selectable only when the current snapshot marks its direct checkout `available`.
- Components never pass a bare repository path to Git store actions. Pinia resolves `{ kind: "main" }` from the current project and re-authorizes worktree/submodule paths against the latest workspace snapshot before every bridge read or write.
- Related full snapshots, refresh generations, pagination, and status mutation versions are keyed by repository context, not only project id. Linked-worktree ref-changing actions also bump one project-wide shared-ref epoch.
- `Project.git` remains the main snapshot for dashboard compatibility. Related snapshots, selected targets, expand/collapse state, absolute related paths, and per-context commit drafts remain renderer-session/transient data and never enter project persistence/export.
- Ordinary Git content actions may target the selected healthy worktree/submodule. Successful writes refresh that context plus the root workspace inventory. Worktree/submodule create/remove/prune/lock/init/update/sync/deinit remain forbidden.
- Repository switching saves/restores the per-context commit draft, clears or context-keys review/detail state, and rejects late async results through project id + context key + generation. Switching is disabled while a Git write is active.

### 4. Validation & Error Matrix

- Git missing or input not a repository -> both inventory sections `unavailable`; browser fallback must not report a successful empty repository.
- One worktree/submodule status timeout -> affected entry has `status: null` plus `timeout`; healthy siblings remain present.
- Malformed `.gitmodules` with healthy index gitlinks -> submodules `partial`; preserve correlatable entries.
- Missing `branch.oid` -> do not infer unborn; only explicit `(initial)` yields `head.kind === "unborn"`.
- Abbreviated, non-hex, all-zero, or format-mismatched OID -> reject at the preload boundary.
- Arbitrary, stale, bare, prunable, missing, uninitialized, unreadable, or unrelated target -> return `null`/failure before any bridge Git call.
- Forced context request B resolves before A -> B remains stored after A resolves.
- Project path or selected context changes during a request -> ignore the old response.
- Same full commit hash exists in two contexts -> detail/diff/selection state remains isolated by context key.
- AI commit-message result returns after switching -> update only the originating context draft or ignore; never overwrite the visible new-context draft.
- Ref mutation in one linked worktree -> stale history from another checkout cannot overwrite data after the shared-ref epoch changes.

### 5. Good/Base/Bad Cases

- Good: one linked worktree times out while another worktree and an initialized direct submodule remain visible and selectable.
- Good: selecting a direct submodule makes changes/history/stage/commit all resolve the same authorized checkout; the parent launcher project identity stays unchanged.
- Good: a direct checkout differs from the parent gitlink; both full OIDs cross the bridge and `commitMismatch` is `true`.
- Base: no linked worktrees/submodules yields ready empty groups and main-only Git behavior; a bare repository remains visible but unselectable.
- Bad: `Promise.all` starts four metadata commands inside each of four workers, creating up to sixteen Git children.
- Bad: GitTab displays a submodule snapshot while a stage/commit action still resolves `project.path`.
- Bad: navigation or Git writes trust any existing directory from a component instead of the latest correlated snapshot.

### 6. Tests Required

- Run `npm run validate:git-workspace` for synthetic parser cases, real Git worktrees/submodules, bare/partial/conflict states, worker/timeout isolation, browser fallback, target authorization, context-keyed generations, exact write paths, and stale-target rejection.
- Assert representative stage/commit/checkout/remote actions against a related target call the bridge with that exact repository path and do not mutate the main checkout.
- Assert main/worktree/submodule full snapshots and equal commit hashes remain isolated, and ref-changing actions invalidate stale histories through the shared-ref epoch.
- Run `node --check public/preload.js`, `npm run lint`, `npm run type-check`, and `npm run build` after changing this boundary.
- Keep `npm run validate:git-commits`, `npm run validate:git-diff`, and `npm run test:git-diff` green to catch adjacent Git regressions.
- Manual uTools smoke remains required for the inline repository section, narrow layout, per-context drafts, switching lock, More menu, and configured external launches; automated checks must not claim host smoke was executed.

### 7. Wrong vs Correct

#### Wrong

```ts
await bridge.commitGitStaged(project.path, message);
```

The visible repository may be a linked worktree or submodule, so resolving only `project.path` can commit the wrong checkout.

#### Correct

```ts
const context = resolveGitRepositoryContext(projectId, target);
if (!context) return null;
await bridge.commitGitStaged(context.repositoryPath, message);
```

Resolve and re-authorize the typed target at the store boundary immediately before every Git operation.
