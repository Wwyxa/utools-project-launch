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
| Service execution state, common runtime records, icon packs                | Separate `service/`, `runtime/`, and `icon-packs/` directories                      |
| Disposable files                                                          | `utools.getPluginTempPath()`                                                     |
| Live processes, live UI logs, Git snapshots                               | Runtime memory                                                                   |
| Direct automation plans and claims                                       | `runtime/scheduler/<sha256-project-id>.json`; not log-retention controlled          |

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
  full Git snapshots, generated plans, execution history, or notification receipts in project documents.
  Runtime records and direct scheduler claims belong to the separate local runtime adapter.
  Local-only environment values stay outside public project documents.

## Migration

`public/preload/migration.js` owns startup preflight and the resumable
`migration.v1.json` ledger. Migration is explicit: write and verify each target
before cleaning its source. Preserve other devices' legacy private data and
existing local targets; normal reads do not perform legacy fallback migration.
Local state replacements are atomic, and an unavailable local directory must
fail writes rather than use the process working directory.

Service-directory migration copies installation and execution state, and migrates
old run logs, diagnostics and policy directly from the source into shared runtime
storage before marking the item verified. It never creates a new `service/logs`
intermediate directory. Source files remain intact; conflicts and busy runtime
maintenance fail visibly and are retryable. Existing current policy is preserved.
Old-format conversion is confined to initial migration, never normal runtime
queries or cleanup. Shared records and policy survive service-directory deletion.

## Verification

- `tests/storageMigration.test.ts` covers v8 preflight and migration.
- `tests/projectBridge.uiPreferences.test.ts` covers local preferences and Store loading.
- `npm run validate:project-storage` covers catalog compatibility, concurrent
  mutations, explicit deletion, read-back, and fresh-preload persistence.

Platform reference: `.github/skills/utools-plugin-dev-skill/references/development/storage.md`.

## Git Author Image Cache

`readGitCommitAuthorAvatar(projectPath, commitHash, context?): Promise<string | null>`
returns a data URI from `public/preload/git-avatar-cache.js`. Fetch only on tooltip
demand. History includes `authorEmail` from the existing `git log`; Store passes
`{ authorEmail, remotes, upstream }` so cache hits require no Git queries. Missing
metadata uses the legacy lookup.

- Files: `<plugin-local-data>/cache/git-avatars/<sha256-author-key>.json` with
  `{ image, updatedAt }`, atomically replaced. Key by GitHub repository and author
  email, falling back to full commit hash. Keep at most 160 entries, 1 MiB per download.
- Fresh for 14 days across preload restarts. Expired images display immediately
  while refreshing; bypass HTTP cache even for unchanged URLs. Share author/URL
  requests. Failed refreshes retain old images and retry after five minutes.
- Accept HTTPS GitHub/avatar hosts, validate redirects, raster MIME/signature,
  streaming size and timeout. Missing/invalid files are cache misses. Failed disk
  writes may use memory only; never write relative to the working directory.
- `project-bridge-event` refresh payload: `{ type: 'git-avatar-updated',
  repositoryPath, commitHash, previousImage, image }`. Apply only to that identity.
  Cleanup emits `git-avatar-cache-cleared`; late downloads must not restore caches.
- Data tools expose `sizes.gitAvatarsBytes` and opt-in `cache-git-avatars` cleanup.
  Backups exclude images; restores preserve them.

Retain regression coverage for restart persistence, unchanged-URL refresh, failure
backoff, download validation, cleanup races, and the no-Git cache-hit path. Never
cache successful tooltip images forever: recheck on hover so expiry can take effect.
