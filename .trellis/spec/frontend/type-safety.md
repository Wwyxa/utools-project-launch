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
- UI helper shape may be local and narrow: `(commit: { message: string; body?: string }) => string`.

### 3. Contracts

- `message` is the one-line subject used in dense Git history rows.
- `body` is optional and contains the full commit text used by markdown tooltips.
- The git log parser must preserve newlines in `body`; do not rely on `%s` alone when tooltip markdown needs lists or paragraphs.
- Use robust field/record separators for git output parsing when reading multiline bodies. Tab-separated parsing is not enough once `%B` is included.
- Avoid `git log --graph` in the backend/preload data fetch when parsing multiline bodies. ASCII graph prefixes can pollute markdown lines and break list rendering. The frontend already draws its own graph from `parents`.

### 4. Validation & Error Matrix

- Missing `body` -> tooltip falls back to `message`.
- Empty commit output -> return an empty `commits` array.
- Malformed commit record without a hash -> skip that record.
- Multiline body with markdown lists -> preserve newline structure and render via `renderMarkdown` in the UI.

### 5. Good/Base/Bad Cases

- Good: row displays `message`, tooltip renders `body` with markdown bullets preserved.
- Base: commit has only a subject; both row and tooltip use `message`.
- Bad: using `--pretty=format:%h\t...\t%s` and expecting tooltip markdown lists to exist.

### 6. Tests Required

- `npm run build` after changing commit metadata parsing or tooltip rendering.
- Manual smoke test with commits containing a subject plus markdown body list items (`- item`).
- Manual smoke test with subject-only commits to verify tooltip fallback remains readable.

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
