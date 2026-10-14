# Type Safety

## Ownership

`src/types.ts` owns project, script, Git, automation, service, preference, and
ProjectBridge contracts. `src/global.d.ts` declares `window.projectBridge`.
Components import shared types; they do not recreate bridge or domain shapes.

Use closed unions/enums for statuses and modes, `Record<string, T>` for scoped
maps, and typed `defineProps`/`defineEmits` for component boundaries. Avoid new
`any` and broad casts when a narrower union or guard is possible.

## Host Boundaries

`src/lib/projectBridge.ts` implements every bridge method in browser preview
with the same signature. Preferences and project data use browser storage;
host-only operations report unsupported behavior through their existing result
or error contract. `public/preload/*.js`
validates untrusted filesystem, Git, process, storage, and service values before
returning shared shapes. Adding a bridge method or field requires coordinated
updates to `src/types.ts`, the fallback, preload, and Store consumers.

Components call Store actions. The Store resolves project/repository context,
owns request generations and persistence, and exposes normalized state to Vue.

## Persistence and Results

- Normalize external values at the preload/Store boundary. Unknown optional
  fields may be ignored; required fields must be rejected or receive an explicit
  safe default.
- Persisted project metadata must be updated in Store serialization,
  `public/preload/projects.js`, and the browser fallback together. Runtime
  status, PIDs, live logs, Git snapshots, and generated automation data stay out
  of project documents.
- Use `ProjectGitReadResult<T>` whenever empty data is valid. `ok: true` means a
  complete mergeable payload; a structured `ok: false` result must not be
  interpreted as an empty successful snapshot.
- Import/export JSON is narrowed before entering Pinia. Keep a top-level schema
  version and skip or report invalid project/script records.

## Async Identity

For Git, process, AI, and service results, preserve the identity needed to reject
stale work: project id, repository context, request generation, and where
applicable `(runId, runtimeOwner)`. A PID alone is diagnostic and must not
identify a service run.

## Git Metadata

Keep commit and parent ids full-length and in the same native object-id format.
Preserve multiline bodies separately from subjects with robust record/field
separators. Graph prefixes and tab-only parsing must not corrupt commit bodies.
Unknown or malformed short stats remain unavailable, not fabricated zero totals;
valid preloaded stats avoid tooltip file-detail reads.

Structured ref namespaces/kinds own actions and presentation. Do not split display
decorations as the real protocol: comma-containing refs and same-name branches/tags
are valid. Peel annotated tags to commits and keep nullable resolved base/upstream
metadata; components must not guess a remote/default branch.

References: [Storage Guidelines](../backend/database-guidelines.md),
[Project Launch Service](../backend/project-launch-service.md).
