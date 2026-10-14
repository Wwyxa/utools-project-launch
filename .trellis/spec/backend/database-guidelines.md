# Storage Guidelines

## Storage Ownership

The real plugin requires uTools v8 local-data and temporary-directory APIs.
`public/preload/foundation.js` resolves these directories; browser preview uses
the explicit fallback in `src/lib/projectBridge.ts`.

| Data                                                                      | Current owner                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Public project configuration                                              | One `utools.db` document per project, under `utools-project-launch/project/<id>` |
| Private project configuration                                             | `<plugin-local-data>/projects/*.json`                                            |
| Device preferences, workspace state, public-project environment overrides | `<plugin-local-data>/local-state.v1.json`                                        |
| Service state, retained logs, icon packs                                  | Subdirectories of the plugin local data directory                                |
| Disposable files                                                          | `utools.getPluginTempPath()`                                                     |
| Live processes, logs, Git snapshots, generated automation plans           | Runtime memory; retained service state belongs to the service                    |

`dbStorage`, renderer storage, the old home-directory root, and device ownership
ids are legacy migration inputs, not the normal uTools persistence path. Browser
preview storage does not prove persistence across a uTools restart.

## Project Writes

- `public/preload/projects.js` owns project serialization and catalog writes;
  `public/preload/local-state.js` owns local files. Keep metadata aligned with
  `src/store/helpers/projectHelpers.ts` and the browser fallback.
- Public document updates use the current `db.get` revision and accept only
  `db.put` results with `ok === true`. On a revision conflict, re-read and reapply
  the intended mutation with a bounded retry. A fresh revision must not be
  attached to a stale full-project object.
- Store saves supply `baseProjects` and `removedProjectIds`. Merge only changes
  relative to that baseline into the latest document; omitted projects are not
  deletions. Preserve concurrent script and environment changes.
- Changing visibility writes and verifies the destination before removing the
  old copy. Normal reads combine public database documents and local private
  files; they do not resurrect private sync documents or legacy catalog entries.
- Agent tools report success only after persisted read-back, then emit
  `projects-changed`. A failed canonical write cannot fall back to legacy data.
- Persist configuration and manual ordering, not PID/run identity, live logs,
  full Git snapshots, generated plans, execution history, or notification receipts.
  Local-only environment values stay outside public project documents.

## Migration

`public/preload/migration.js` owns startup preflight and the resumable
`migration.v1.json` ledger. Migration is explicit: write and verify each target
before cleaning its source. Preserve other devices' legacy private data and
existing local targets; normal reads do not perform legacy fallback migration.
Local state replacements are atomic, and an unavailable local directory must
fail writes rather than use the process working directory.

## Verification

- `tests/storageMigration.test.ts` covers v8 preflight and migration.
- `tests/projectBridge.uiPreferences.test.ts` covers local preferences and Store loading.
- `npm run validate:project-storage` covers catalog compatibility, concurrent
  mutations, explicit deletion, read-back, and fresh-preload persistence.

Platform reference: `.github/skills/utools-plugin-dev-skill/references/development/storage.md`.
