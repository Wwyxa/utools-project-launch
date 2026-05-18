# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

There is no database layer in the current project. Project data is stored in memory inside `src/store/useStore.ts` and resets when the page reloads.

The repository does include an `express` dependency in `package.json`, but there is no checked-in ORM, migration tool, schema file, or database adapter in the source tree.

If persistence is added later, it must be introduced explicitly and documented here before code starts depending on it.

---

## Query Patterns

No database queries exist today. Current state reads and writes are direct Pinia store mutations.

Example:

```ts
updateMemo(projectId: string, content: string) {
	this.memoContent[projectId] = content;
}
```

When a real persistence layer is introduced, prefer explicit repository methods over ad hoc component-side reads and writes.

---

## Migrations

No migrations are configured today.

If a database is added later, migrations should live in a dedicated folder and be runnable from the command line without opening the UI. Document the exact command and storage location here before shipping any schema change.

---

## Naming Conventions

No tables, columns, or indexes exist yet.

If persistence is added later, keep entity names aligned with the existing project concepts: `projects`, `logs`, `todos`, `memo_content`, and similar domain terms are clearer than generic storage names.

---

## Common Mistakes

- Treating the current in-memory store as persistent data
- Adding schema-dependent logic inside Vue components before the persistence layer exists
- Forgetting to mask secrets before writing them into any future storage layer
- Inventing migration steps before the project actually has a database
