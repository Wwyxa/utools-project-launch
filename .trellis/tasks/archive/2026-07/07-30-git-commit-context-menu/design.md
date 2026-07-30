# Git Commit Context Menu Design

## Scope And Boundaries

- `src/components/project/GitTab.vue` owns the main menu, branch submenus, local form state, clipboard feedback, focus behavior, and confirmation orchestration.
- `src/types.ts` owns structured commit-ref and Git action contracts.
- `src/store/useStore.ts` owns authorized repository routing, write serialization, ref mutation versions, and post-write refreshes.
- `src/lib/projectBridge.ts` mirrors the host API and returns explicit unsupported results in browser preview.
- `public/preload.js` owns Git validation and command execution. UI validation is advisory; Git is authoritative.
- Existing `ProjectActionDialog` remains a confirmation-only component. Create/rename/tag inputs use one mode-driven form dialog inside GitTab instead of widening the shared confirmation API.

## Structured Commit References

Add a shared commit decoration contract:

```ts
type ProjectGitCommitRefKind = "head" | "local" | "remote" | "tag";

interface ProjectGitCommitRef {
  kind: ProjectGitCommitRefKind;
  name: string;
  head?: boolean;
}
```

`ProjectGitCommitSummary` gains `refNames?: ProjectGitCommitRef[]`; legacy `refs?: string` remains temporarily for browser fixtures and rollback compatibility. GitTab prefers `refNames` and falls back to the existing parser only when structured data is absent.

Preload builds one ref-to-object map with `git for-each-ref`, using full ref namespaces to classify local branches, remote-tracking refs, and tags. Annotated tags use their peeled object id. The current symbolic branch or detached HEAD marks the matching commit with `head: true`. This avoids parsing `%D` by comma and keeps Git-valid comma names intact without per-commit Git calls.

## Action Contracts

Extend `ProjectGitActionResult` with an optional structured blocker:

```ts
type ProjectGitActionBlockReason = "dirty-worktree" | "unmerged-branch";
```

UI risk flows branch on `blockReason`, not localized message text.

Add or extend bridge/store methods:

```ts
createGitBranch(path, name, commitHash, options?: { checkout?: boolean; force?: boolean })
createGitTag(path, name, commitHash, options?: { annotated?: boolean; message?: string })
renameGitBranch(path, name, nextName)
deleteGitBranch(path, name, options?: { force?: boolean })
checkoutGitRemoteBranch(path, remoteRef, options?: { force?: boolean })
checkoutGitCommit(path, commitHash, options?: { force?: boolean; preferredBranch?: string; detach?: boolean })
```

Store mirrors these methods with `projectId` and repository target. Every ref-changing action uses `runAuthorizedGitWrite(..., { refresh: "full", refs: true })`.

## Preload Validation And Commands

- Validate branch and tag names with `git check-ref-format`; do not duplicate Git name rules in Vue.
- Validate target commits with `<hash>^{commit}` and check same-namespace conflicts against full refs.
- Create-only branch: `git branch <name> <commit>`.
- Create-and-switch branch: `git switch -c <name> <commit>`; dirty worktree returns `dirty-worktree` before mutation. Confirmed force uses `--discard-changes` in the same atomic command.
- Lightweight tag: `git tag <name> <commit>`.
- Annotated tag: `git tag -a <name> -m <message> <commit>`; non-empty message is required.
- Rename local branch: `git branch -m <old> <new>`. Current local branch is allowed; conflicts are not overwritten.
- Safe delete: reject the current branch, determine merge safety against its upstream when available or HEAD otherwise, and return `unmerged-branch` before deletion when unsafe; otherwise run `git branch -d <name>`.
- Confirmed force delete: `git branch -D <name>`. Git remains authoritative for linked-worktree restrictions.
- Remote checkout: validate a `refs/remotes/<remote>/<branch>` ref, then use `git switch --track <remote>/<branch>`; a local-name conflict returns a normal Git error. Confirmed force may discard worktree changes but never overwrites an existing local branch.
- Explicit detached checkout: `detach: true` bypasses local branch-tip selection and always runs `git switch --detach <commit>` (plus `--discard-changes` only after confirmation).
- Commands pass user data as argv and never use a shell.

## Menu And Interaction Model

Main menu order:

1. New branch.
2. New tag.
3. Separator.
4. If no branch refs: one `切换（分离 HEAD）` item.
5. If branch refs exist: one compact row per local or remote ref, preserving all refs that point to the commit.

Each branch row opens a submenu and contains a visually distinct branch-name badge. Clicking the badge stops submenu activation, copies the full name, and changes its tooltip/feedback to `已复制`; the row/chevron still communicates submenu availability without adding a copy button.

Local submenu:

1. Switch to branch (current branch is disabled/labeled current).
2. View target commit in detached HEAD.
3. Separator.
4. Rename branch.
5. Delete branch (disabled for current branch).

Remote submenu:

1. Check out as a local tracking branch.
2. View target commit in detached HEAD.

Main and child menus use actual rendered dimensions for viewport clamping. Child menus prefer the right side and flip left when needed. Window scroll/resize, project/repository replacement, outside pointerdown, and component unmount close both levels. Escape closes the child first; a second Escape closes the main menu. ArrowUp/Down/Home/End use roving focus, ArrowRight enters a submenu, ArrowLeft returns to its parent, and final close restores the opening control.

## Dialog And Risk Flows

One GitTab-local ref dialog uses modes `create-branch`, `rename-branch`, and `create-tag`:

- Create branch: branch name plus a small unchecked `创建后切换` checkbox.
- Rename branch: prefilled branch name selected on open.
- Create tag: tag name plus an unchecked `附注标签` checkbox; checked state reveals a required message textarea.
- The dialog uses a teleported form, autofocus, Enter submission where appropriate, inline field errors, busy locking, Escape handling, and focus restoration.

Delete flow:

1. Open the existing danger `ProjectActionDialog` and confirm safe deletion.
2. If preload returns `unmerged-branch`, close/replace it with a second danger confirmation that explicitly warns about unique commits.
3. Only the second confirmation calls force delete. Cancellation leaves the branch unchanged.

Dirty checkout flow reuses the existing force-switch confirmation and files detail. Atomic create-and-switch and remote tracking checkout return `dirty-worktree` before creating/changing refs, so cancellation does not leave an unexpected branch.

## Compatibility And Rollback

- Existing snapshots without structured refs continue through the legacy `refs` fallback.
- Browser preview exposes every new method with a typed unsupported result.
- No persisted data or migration is introduced.
- Rollback can remove the new actions and menu UI while retaining structured refs; the legacy `refs` field keeps older UI behavior available.
- No runtime dependency is added.

## Risks And Mitigations

- Ref ambiguity: structured refs remove comma parsing from the real preload path.
- Local/remote confusion: behavior is selected from explicit `kind`, never label heuristics.
- Stale repository state: preload revalidates refs and commits; store ref versions invalidate stale snapshots.
- Worktree branch occupancy: Git command errors remain authoritative when snapshot data cannot pre-disable an action.
- Accidental data loss: dirty checkout and force delete require explicit, typed blocker flows and unified confirmations.
- Floating menu drift: close on scroll/resize and clamp after rendering both menu levels.

## Verification Strategy

- Real temporary-repository validation covers structured refs, comma names, branch/tag creation, annotated tag metadata, rename, safe/force delete, tracking checkout, and explicit detached checkout.
- Store tests cover exact repository routing, `refs: true` invalidation, stale targets, and full refreshes.
- Type/build checks cover bridge symmetry and Vue templates.
- Browser smoke uses injected commit/ref state to verify menu geometry, single-line overflow, keyboard behavior, copy feedback, dialogs, and confirmation layering.
