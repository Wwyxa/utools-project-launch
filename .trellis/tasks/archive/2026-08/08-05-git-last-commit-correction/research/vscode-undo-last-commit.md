# VS Code Undo Last Commit Semantics

## Question

What does VS Code's `Git: Undo Last Commit` command do, and how does it differ from Git revert?

## Local Evidence

- `references/vscode/extensions/git/src/commands.ts:2779` registers `git.undoCommit`.
- For a normal commit with at least one parent, the command calls `repository.reset("HEAD~")`.
- `references/vscode/extensions/git/src/git.ts:2317` implements reset with `--soft` unless the caller explicitly requests hard reset.
- The command reads the old commit first and restores its complete message to the source-control input box.
- A merge commit requires an additional modal confirmation before reset.
- A root commit has no parent, so VS Code deletes `HEAD`, unstages all files, and restores the old message.

## Confirmed Product Contract

- “撤销上次提交” removes the current HEAD commit instead of creating a new inverse commit.
- A normal commit becomes staged changes through `git reset --soft HEAD~`.
- A root commit returns to an unborn branch while preserving files as unstaged/untracked work.
- The removed commit message becomes the active repository's commit draft.
- Revert remains a separate history action that creates a new inverse commit.
- General reset modes and arbitrary historical commit editing are outside the task.
