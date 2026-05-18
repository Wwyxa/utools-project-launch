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

Preload bridge contracts should be represented in `src/types.ts` and consumed through `src/lib/projectBridge.ts`, not duplicated in components.

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
