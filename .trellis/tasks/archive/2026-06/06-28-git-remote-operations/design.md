# Git Remote Operations Design

## Boundaries

- Frontend state remains in `src/store/useStore.ts`.
- Shared contracts live in `src/types.ts`.
- Native Git execution stays in `public/preload.js`, exposed through the existing `ProjectBridge` surface.
- `src/components/project/GitTab.vue` owns the user workflow and confirmation UI.

## Data Model

Add remote-aware types:

- `ProjectGitRemoteSummary`: `name`, `fetchUrl`, `pushUrl`.
- `ProjectGitUpstreamSummary`: `remote`, `branch`, `ref`, `ahead`, `behind`.
- `ProjectGitSnapshot` and `ProjectGitStatusSnapshot` include `remotes` and optional `upstream`.

The existing top-level `ahead` / `behind` fields remain for compatibility and mirror the current branch upstream when available.

## Preload Git Commands

Read commands:

- `git remote -v` to build unique remote summaries.
- `git rev-parse --abbrev-ref --symbolic-full-name @{u}` for the current upstream.
- `git rev-list --left-right --count HEAD...@{u}` for ahead/behind counts.

Write commands:

- Fetch: `git fetch --prune <upstream remote>` when upstream exists, otherwise fail with a clear message.
- Pull: `git pull --ff --no-rebase` against the current upstream.
- Push: `git push` against the current upstream only.
- Add remote: `git remote add <name> <url>`.
- Set remote url: `git remote set-url <name> <url>`.
- Remove remote: `git remote remove <name>`.

Remote write APIs return the existing `ProjectGitActionResult` shape with optional `remote` / `branch` fields added if useful.

## Store Flow

- Add bridge wrappers for fetch, pull, push, add/set/remove remote.
- Remote operations bump the Git mutation version, call the bridge, then refresh the full Git snapshot.
- Keep the existing status-refresh and snapshot-refresh de-duplication behavior.

## UI Flow

- Add a compact Remote panel in Git Tab near the current branch/status controls.
- Show current upstream, remote list, and fetch/pull/push icon buttons.
- Disable fetch/pull/push while another Git write is running or when no upstream exists.
- Add a remote management dialog with mode-based form: add, edit url, remove.
- Use existing confirmation dialog for remove remote.

## Compatibility And Rollback

- Repositories without remotes continue to load with empty `remotes` and no `upstream`.
- Existing local Git operations do not depend on remote fields.
- Rollback is limited to removing the new bridge methods, type fields, store actions, and Git Tab panel.
