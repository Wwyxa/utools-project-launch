# Git Remote Operations Implementation Plan

## Checklist

1. Extend shared Git types and `ProjectBridge` with remote summary fields and remote operation methods.
2. Add preload helpers for reading remotes/upstream and executing fetch/pull/push/add/set-url/remove.
3. Normalize and merge remote fields in the Pinia store snapshots.
4. Add store actions for remote operations that reuse the existing Git mutation/refresh pattern.
5. Add Git Tab remote status UI, operation buttons, remote management dialog, validation, and remove confirmation.
6. Update browser fallback bridge methods to return safe unsupported responses where needed.
7. Run build/type validation and inspect changed UI for obvious layout regressions.

## Validation

- `npm run build`
- Manual smoke in Git Tab:
  - repository with remote/upstream: fetch, pull, push states are visible and guarded by active action state
  - repository without upstream: remote actions are disabled or return clear warning
  - add/set-url/remove remote update the remote list after refresh

## Risk Areas

- `public/preload.js` command quoting and Git error messages on Windows.
- Snapshot merging in `src/store/useStore.ts`; missing remote fields must default to empty safe values.
- `GitTab.vue` is large; keep the new UI localized and avoid broad refactors.

## Review Gate

- Confirm PRD/design/implementation plan before `task.py start`.
