# Conflict Recovery And External Tool Guidance

## Question

How should single-commit cherry-pick and revert failures remain safe while only guiding users toward external tools?

## Existing Project Evidence

- `src/types.ts` already carries structured Git blocker reasons across preload, bridge, store, and UI.
- `src/store/useStore.ts#runAuthorizedGitWrite` centralizes write locking, mutation versions, snapshot invalidation, and post-write refresh.
- `src/components/project/GitCommitHistory.vue` already uses app-rendered confirmation dialogs for commit-level write actions.
- `src/components/project/GitTab.vue` and `src/components/project/ExternalApplicationLaunchButton.vue` already let users open the selected repository with a configured external application from the repository menu.
- `.trellis/spec/frontend/type-safety.md` forbids selecting behavior by matching localized error text; the UI can show fixed guidance based on the action it just executed.

## Selected Product Contract

- The first release supports one ordinary non-merge commit per action.
- Both actions require a clean index/worktree and a valid current HEAD.
- On conflict, run the matching `git cherry-pick --abort` or `git revert --abort` immediately.
- Both abort success and abort failure return an ordinary failed action result; no recovery-specific block reason is added.
- Abort success explains that the repository was restored. Abort failure preserves both the original operation error and abort error, does not claim the repository is clean, and performs a full refresh.
- Failed cherry-pick/revert actions explain that the user can configure an external application in Settings and then open the repository from the existing repository menu.
- The warning does not launch an application or add a direct Settings action.
- The plugin does not implement continue, skip, conflict editing, or a generic operation-state dashboard.
