# Type Safety

> Type safety patterns in this project.

---

## Overview

The project uses TypeScript throughout the Vue app. `tsconfig.json` is configured for modern ESM bundling, `noEmit`, and Vue SFC support.

Shared domain types live in `src/types.ts`; Vue ambient types live in `src/env.d.ts`. Components import the shared types rather than redefining the same shapes locally.

---

## Type Organization

Current organization:

- `src/types.ts` owns the domain model for projects, scripts, logs, staged files, and todos
- `src/env.d.ts` declares the Vue SFC module shim
- `src/global.d.ts` declares `window.projectBridge` for the uTools preload boundary
- component-local literal unions are acceptable for very small UI-only states when they do not belong in the shared model

Example shared types already in use:

```ts
export interface Project {
  id: string;
  name: string;
  path: string;
  type: string;
  status: ProjectStatus;
  scripts: ProjectScript[];
  env: Record<string, string>;
}
```

---

## Validation

There is no runtime validation library configured today.

Validate external or user-entered data at the boundary before it enters the store. If a schema library is added later, document the exact validation path here instead of scattering ad hoc checks across components.

---

## Common Patterns

Common patterns already in the codebase:

- `defineProps<{ project: Project }>()` for typed component props
- `defineEmits<{ (e: 'select', id: string): void }>()` for event contracts
- `Record<string, T>` for project-scoped maps such as logs, todos, and memo content
- enums for stable status values such as `ProjectStatus`

Use inferred literals and shared interfaces first. Reach for type guards only when external data needs to be narrowed.

---

## Forbidden Patterns

- New `any` types in application code
- Broad `as any` casts when a narrower union would work
- Duplicating the same domain shape in multiple files
- Widening a status field to `string` when the project already has a closed enum or union
- Relying on runtime assumptions without a type or validation check
- Leaving global `window` APIs untyped when adding preload integrations
- Adding or changing persisted `Project` metadata without updating the store persistence path, browser bridge fallback, and uTools preload `toStoredProject` shape together

Preload bridge contracts should be represented in `src/types.ts` and consumed through `src/lib/projectBridge.ts`, not duplicated in components.

## Scenario: Import/Export JSON Boundary

## Scenario: Git Commit Tooltip Markdown Boundary

### 1. Scope / Trigger

- Trigger: Git commit metadata crosses the uTools preload boundary, Pinia/project state, and Vue rendering. Full commit bodies are needed for markdown tooltip rendering.

### 2. Signatures

- `ProjectGitCommitSummary = { hash: string; message: string; body?: string; author: string; date: string; graph?: string; parents?: string[]; refs?: string }`
- Preload git read path should populate `message` with the compact subject line and `body` with the full commit message body when available.
- Tooltip state should keep the whole commit object plus cursor coordinates, e.g. `{ commit: ProjectGitCommitSummary; x: number; y: number }`, because the tooltip header needs `author`, `date`, and `refs` while the body parser needs both `message` and `body`.
- UI parser helpers may stay local to `GitTab.vue`, but their output contract is structured: `title: string` for the header and `body: string` for markdown rendering.

### 3. Contracts

- `message` is the one-line subject used in dense Git history rows and as the default tooltip title.
- `body` is optional and contains the full commit text used by markdown tooltips after de-duplicating repeated subject/list content.
- The git log parser must preserve newlines in `body`; do not rely on `%s` alone when tooltip markdown needs lists or paragraphs.
- Use robust field/record separators for git output parsing when reading multiline bodies. Tab-separated parsing is not enough once `%B` is included.
- Avoid `git log --graph` in the backend/preload data fetch when parsing multiline bodies. ASCII graph prefixes can pollute markdown lines and break list rendering. The frontend already draws its own graph from `parents`.
- Tooltip rendering should normalize common Git message shapes before rendering:
  - if `body` is missing or equals `message`, render only the title and omit the body panel;
  - if the first `body` line equals, prefixes, or extends `message`, drop that first body line before rendering markdown;
  - if the first content line is an unordered markdown list item and `message` also starts as a list item, render the whole content as markdown without a separate title;
  - if `message` is `Title - item A - item B` and markdown body repeats `- item A` / `- item B`, title is `Title` and body is the list;
  - if `message` chains conventional commit segments (`fix: A fix: B change: C`) and body repeats trailing segments line-by-line, keep only the leading segment(s) in the title and render the repeated trailing segments in the body.

### 4. Validation & Error Matrix

- Missing `body` -> tooltip falls back to `message`.
- Empty commit output -> return an empty `commits` array.
- Malformed commit record without a hash -> skip that record.
- Multiline body with markdown lists -> preserve newline structure and render via `renderMarkdown` in the UI.
- Body repeats the subject line -> remove the duplicate line so tooltip title/body do not show the same sentence twice.
- Message is itself a markdown list -> do not coerce the first list item into a plain bold title.
- Chained conventional commits with repeated body lines -> trim only exact repeated trailing segments; keep the body lines available for markdown rendering.

### 5. Good/Base/Bad Cases

- Good: row displays `message`, tooltip title/body split removes duplicated subject text and renders `body` with markdown bullets preserved.
- Base: commit has only a subject; both row and tooltip use `message`.
- Bad: using `--pretty=format:%h\t...\t%s` and expecting tooltip markdown lists to exist.
- Bad: always rendering `message` as a plain tooltip title when `message` starts with `- `; this breaks list-style commit messages.
- Bad: always rendering the full subject as title when the body repeats trailing `fix:` / `change:` segments; this creates a long duplicate title and repeated body.

### 6. Tests Required

- `npm run build` after changing commit metadata parsing or tooltip rendering.
- Manual smoke test with commits containing a subject plus markdown body list items (`- item`).
- Manual smoke test with subject-only commits to verify tooltip fallback remains readable.
- Manual smoke test with list-only commit messages where the first line starts with `- ` and should render as markdown.
- Manual smoke test with `Title - item A - item B` plus matching bullet body to verify title trimming.
- Manual smoke test with chained conventional commit subjects (`fix: A fix: B change: C`) plus repeated body lines to verify trailing segment trimming.
- Verify tooltip width fits short content and only caps long content; no fixed/minimum width should create empty right-side space.

### 7. Wrong vs Correct

#### Wrong

```js
"--pretty=format:%h\t%p\t%an\t%ad\t%D\t%s";
```

This loses the commit body and therefore loses markdown list line breaks.

#### Correct

```js
`--pretty=format:%h${fieldSep}%p${fieldSep}%an${fieldSep}%ad${fieldSep}%D${fieldSep}%s${fieldSep}%B${recordSep}`;
```

Keep the subject and full body as separate fields so dense rows and rich tooltips can each use the right content.

#### Wrong

```ts
const title = commit.message;
const body = commit.body || "";
```

This blindly duplicates commit text for bodies that include the subject, markdown-list-only commits, and chained conventional commit subjects.

#### Correct

```ts
const title = commitTooltipTitle(commit);
const body = commitTooltipBody(commit);
```

Keep tooltip parsing explicit and format-aware so the dense row can show the raw subject while the tooltip shows a readable title plus markdown body.

## Scenario: Git Bulk File Action Boundary

### 1. Scope / Trigger

- Trigger: Git file write actions cross `GitTab.vue`, Pinia store actions, `ProjectBridge`, and the uTools preload Git implementation.
- Trigger: bulk actions such as stage-all / unstage-all / discard-all must operate on the complete live Git status, not only the file paths currently rendered in the UI.
- This scenario requires code-spec depth because it changes a cross-layer bridge signature and user-visible write behavior.

### 2. Signatures

- `ProjectGitBulkFileActionOptions = { all?: boolean }`
- `ProjectBridge.stageGitFiles(projectPath: string, relativePaths: string[], options?: ProjectGitBulkFileActionOptions): Promise<ProjectGitActionResult>`
- `ProjectBridge.unstageGitFiles(projectPath: string, relativePaths: string[], options?: ProjectGitBulkFileActionOptions): Promise<ProjectGitActionResult>`
- `ProjectBridge.discardGitFiles(projectPath: string, relativePaths: string[], options?: ProjectGitBulkFileActionOptions): Promise<ProjectGitActionResult>`
- Store actions mirror the bridge signature with `projectId` instead of `projectPath`.
- Preload implementations accept the same third `options` argument and return `ProjectGitActionResult` with `ok`, `message`, optional `count`, and optional `paths`.

### 3. Contracts

- `relativePaths` is the exact set selected by the UI when `options.all` is missing or false.
- `options.all === true` means preload must ignore UI pagination/stale rendered file limits and collect the complete current Git status directly from `git status --porcelain=v1 -z`.
- Stage-all filters live status entries to files with unstaged work, including untracked files.
- Unstage-all filters live status entries to files with staged work.
- Discard-all filters live status entries to all changed paths, then applies the existing discard behavior per path.
- Components should still pass the visible paths for context/count fallback, but preload owns all-mode completeness.
- Git write actions must show a loading toast before the bridge call and keep success/warning/error feedback visible after the status refresh starts.

### 4. Validation & Error Matrix

- Missing Git repository -> return `{ ok: false, message: "未检测到 Git 仓库。" }`.
- `options.all !== true` and `relativePaths` is empty -> return a zero-count failure message for that operation.
- `options.all === true` and no matching live status entries -> return a zero-count failure message for that operation.
- Git command failure -> return `{ ok: false, count, paths, message }` using the first Git error text.
- Discard failure after partial success -> return the underlying failure with `count`/`paths` for completed paths and a message noting the partial count.
- Status refresh after a successful write -> bump the project Git mutation version and refresh status so UI rows reflect the new staged/unstaged state.

### 5. Good/Base/Bad Cases

- Good: 110 unstaged files are rendered with only 80 visible from stale UI state, stage-all passes `{ all: true }`, preload stages all 110 live status entries, and toast reports `已暂存 110 个文件。`.
- Good: stage-selected passes explicit selected paths without `{ all: true }`, so only selected paths are touched.
- Base: 3 modified files are visible; stage-all stages those 3 and refreshes the Git status snapshot.
- Bad: deriving stage-all exclusively from `props.project.git.files` or another rendered list; stale or limited UI state can silently skip files.
- Bad: clearing the Git toast immediately after stage/unstage success; the following status refresh can hide the user-visible operation result.

### 6. Tests Required

- `npm run lint` to verify `src/types.ts`, store actions, fallback bridge, and component calls agree on the bulk action options signature.
- `npm run build` to verify Vue templates and bridge consumers compile.
- `node --check public/preload.js` after changing preload Git action code.
- Manual smoke test with more than 80 changed files: click stage-all and assert the toast count equals the full live Git status count.
- Manual smoke test for unstage-all after stage-all: assert all staged files return to unstaged and the toast count is complete.
- Manual smoke test for selected/single-file operations: assert they do not unexpectedly expand to all files.

### 7. Wrong vs Correct

#### Wrong

```ts
const paths = stageableFiles.value.map((file) => file.path);
await store.stageGitFiles(projectId, paths);
setGitActionResult("idle", "");
```

This treats the rendered file list as complete and hides the operation result before the user can see it.

#### Correct

```ts
const paths = stageableFiles.value.map((file) => file.path);
const result = await store.stageGitFiles(projectId, paths, { all: true });
setGitActionResult(result.ok ? "success" : "error", result.message);
```

Keep the UI-triggered all action explicit, let preload collect live Git status, and preserve the operation result toast through the follow-up refresh.

## Scenario: Git Remote Operations Boundary

### 1. Scope / Trigger

- Trigger: Git remote status and write operations cross `GitTab.vue`, Pinia store actions, `ProjectBridge`, and `public/preload.js` Git execution.
- Trigger: remote commands may hit network and credentials, so they have stricter process-execution requirements than local-only Git actions.

### 2. Signatures

- `ProjectGitRemoteSummary = { name: string; fetchUrl: string; pushUrl: string }`.
- `ProjectGitUpstreamSummary = { remote: string; branch: string; ref: string; ahead: number; behind: number }`.
- `ProjectGitSnapshot` and `ProjectGitStatusSnapshot` include `remotes: ProjectGitRemoteSummary[]` and `upstream: ProjectGitUpstreamSummary | null`.
- Bridge methods: `fetchGitRemote(projectPath)`, `pullGitRemote(projectPath)`, `pushGitRemote(projectPath)`, `addGitRemote(projectPath, remoteName, remoteUrl)`, `setGitRemoteUrl(projectPath, remoteName, remoteUrl)`, `removeGitRemote(projectPath, remoteName)`.
- Store actions mirror the bridge methods with `projectId` replacing `projectPath`.

### 3. Contracts

- Remote status belongs in the existing Git snapshot contract, not in duplicated component-local remote state.
- Browser fallback snapshots must explicitly return `remotes: []` and `upstream: null` so consumers can distinguish "no remote" from a missing field.
- Fetch, pull, and push operate only on the current branch upstream. Do not add force push, rebase pull, or `push -u` without a new requirement and updated spec.
- Preload validates remote names and URLs before invoking Git. Remote names are non-empty, cannot start with `-`, and only contain letters, digits, `.`, `_`, and `-`. Remote URLs are non-empty and cannot contain control characters.
- Remote network commands must use async process execution with a timeout and `GIT_TERMINAL_PROMPT=0` / `GCM_INTERACTIVE=Never`; do not run them through blocking `spawnSync` or commands that can wait forever for credentials.
- Store remote mutations refresh the full Git snapshot after every result, including failures, because `pull` can fetch before merge failure and remote refs may still change.
- GitTab keeps remote controls in the existing top Git status panel; use a compact popover for remote list management instead of adding a separate full-width remote panel.

### 4. Validation & Error Matrix

- Missing Git repository -> return `{ ok: false, message: "未检测到 Git 仓库。" }`.
- Missing upstream for fetch/pull/push -> return a clear failure and keep buttons disabled in the UI.
- Empty or invalid remote name -> return the validation message before running Git.
- Empty or control-character remote URL -> return the validation message before running Git.
- Remote command timeout -> return a timeout message and refresh the Git snapshot afterward.
- Git authentication failure with prompts disabled -> return the Git error text to the UI without blocking the plugin.
- Successful add/set-url/remove -> refresh the full Git snapshot so `remotes` and `upstream` are current.

### 5. Good/Base/Bad Cases

- Good: a repository with `origin/main` upstream shows one compact upstream chip, enables fetch/pull/push, and refreshes ahead/behind after each operation.
- Good: a repository with remotes but no current upstream shows the remote list but disables fetch/pull/push with a clear tooltip.
- Base: browser preview has no real Git bridge; snapshots still include empty remote fields and remote actions return unsupported messages.
- Bad: adding a separate component-local remote list that can drift from `ProjectGitSnapshot.remotes`.
- Bad: running `git pull` with `spawnSync`; a credential prompt can freeze the uTools preload process.
- Bad: refreshing only on successful remote operations; failed `pull` may still update fetched refs and leave UI stale.

### 6. Tests Required

- `node --check public/preload.js` after changing preload remote command helpers.
- `npm run lint` after changing shared Git remote types, bridge methods, store actions, or GitTab calls.
- `npm run build` after changing GitTab remote UI or shared snapshot fields.
- Manual smoke test in browser preview: GitTab top panel shows no-remote state, disabled fetch/pull/push, and the add remote dialog opens.
- Manual smoke test in uTools with a real repository: fetch/pull/push update status feedback and refresh ahead/behind.
- Manual smoke test in uTools with no upstream: remote operations remain disabled or return a clear warning.

### 7. Wrong vs Correct

#### Wrong

```js
const result = spawnSync("git", ["-C", repositoryPath, "pull"], { encoding: "utf8" });
```

This can block the preload process indefinitely when Git asks for credentials or waits on the network.

#### Correct

```js
execFile(
  "git",
  ["-C", repositoryPath, "pull", "--ff", "--no-rebase", upstream.remote, upstream.branch],
  { env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" }, timeout: 120000 },
  callback,
);
```

Use async execution with disabled interactive prompts and a timeout so remote Git failures return to the UI safely.

## Scenario: Editor Launch Bridge Boundary

### 1. Scope / Trigger

- Trigger: opening a project in an external editor crosses Vue components, Pinia state, browser fallback, and uTools preload process spawning.

### 2. Signatures

- `EditorPreferences = { kind: "vscode" | "cursor" | "custom"; customCommand: string }`
- `ProjectBridge.loadEditorPreferences(): EditorPreferences`
- `ProjectBridge.saveEditorPreferences(preferences: EditorPreferences): void`
- `ProjectBridge.openEditor(payload: { projectPath: string; editor: EditorPreferences }): Promise<{ launched: boolean; command: string; cwd: string; kind: EditorKind; message?: string }>`

### 3. Contracts

- Editor preference contracts belong in `src/types.ts`; components must not define local copies.
- `vscode` and `cursor` are built-in editor kinds. `custom` requires a command template.
- Custom command templates may use `{path}` or `{projectPath}` placeholders, both resolved to the project path by the bridge.
- Browser fallback must keep the same method names and return safe failure results.

### 4. Validation & Error Matrix

- Unknown editor kind -> normalize to the default editor before saving or launching.
- Missing project path -> return `launched: false` with a message.
- Empty custom command -> return `launched: false` with a message.
- Spawn failure -> return `launched: false` with the bridge error message.

### 5. Good/Base/Bad Cases

- Good: a detail-page button calls a store action, which passes stored editor preferences to the bridge.
- Base: VS Code is the default editor preference and works without user configuration.
- Bad: hard-coding `code` in a component or bypassing `ProjectBridge.openEditor`.

### 6. Tests Required

- `npm run lint` should verify type consistency across `src/types.ts`, `src/lib/projectBridge.ts`, store actions, and components.
- `npm run build` should verify the settings and project detail UI compile with the shared bridge contract.
- Manual smoke test: open a valid project with VS Code, Cursor, and an invalid custom command.

### 7. Wrong vs Correct

#### Wrong

```ts
await window.projectBridge.openEditor({ projectPath: project.path, editor: { kind: "vscode", customCommand: "" } });
```

#### Correct

```ts
await store.openProjectInEditor(project.id);
```

Keep editor launch behavior behind store actions so fallback and error logging stay consistent.

---

## Scenario: Import/Export JSON Boundary

### 1. Scope / Trigger

- Trigger: project configuration enters the app from an external JSON file and leaves the app as a portable backup file.

### 2. Signatures

- `ProjectExportPayload` is the top-level export shape.
- `ProjectImportPayload` is the parsed import shape accepted by the store.
- `ProjectPathInspection` is the preload/fallback response for project path detection.

### 3. Contracts

- Export payloads must include a top-level `schemaVersion` and a project list.
- Imported data must be narrowed at the bridge/store boundary before it is merged into state.
- Bridge API additions must be declared in `src/types.ts` and reflected in `src/global.d.ts` through the shared `ProjectBridge` interface.

### 4. Validation & Error Matrix

- Missing or non-numeric `schemaVersion` -> reject import.
- Missing project array -> reject import.
- Project missing required strings such as `id`, `name`, or `path` -> skip that project.
- Script missing required `name` or `command` -> skip or normalize that script before storing.

### 5. Good/Base/Bad Cases

- Good: import validates the top-level payload, filters invalid project records, and reports imported/skipped counts.
- Base: unknown optional fields are ignored unless a schema migration explicitly handles them.
- Bad: casting parsed JSON directly to `Project[]` and pushing it into the store.

### 6. Tests Required

- Type-check the bridge contract and store import path.
- Manual import smoke test with valid JSON, duplicate projects, and malformed JSON.

### 7. Wrong vs Correct

#### Wrong

```ts
const projects = parsed as Project[];
```

#### Correct

```ts
const payload = normalizeProjectImportPayload(parsed);
```

External JSON must pass through runtime validation before store merge.
