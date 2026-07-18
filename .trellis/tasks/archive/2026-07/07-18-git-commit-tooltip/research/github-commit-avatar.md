# GitHub Commit Avatar Research

## Question

Can the Git commit tooltip display an author avatar without sending the author's email to a third-party avatar service?

## Verified External Evidence

- GitHub REST documentation, [Get a commit](https://docs.github.com/en/rest/commits/commits#get-a-commit), was fetched on 2026-07-18 through `smart-search fetch`.
- The documented response represents a repository commit and includes an associated `author` user object with an `avatar_url` field when GitHub can associate the commit with an account.
- The documentation states that public resources can be requested without authentication; private repositories require repository read access. A missing association or inaccessible repository can therefore be treated as an ordinary no-avatar result.

## Confirmed Local Facts

- `public/preload.js` already parses repository remote URLs with `readGitRemotesAsync` and has each commit hash from `readGitCommits`.
- `public/preload.js` reads per-commit file data through `readGitCommitFiles`; `src/store/useStore.ts` proxies that call through the existing project bridge.
- `ProjectGitCommitSummary` does not carry author email or avatar information. The selected GitHub API approach does not require either field.
- Browser preview intentionally uses a fallback bridge and cannot read local Git data, so it must return a no-avatar result without network work.

## Design Consequences

- Parse a `github.com` remote into owner and repository name in the preload layer.
- Resolve the avatar from the existing commit hash with GitHub's repository commit endpoint, then return only a sanitized HTTPS avatar URL or an empty result.
- Cache both successful and unsuccessful lookups by repository and commit hash. UI rendering must never wait for this request.
- Do not add Gravatar, author-email propagation, GitHub authentication, persistent caching, or avatar-provider settings in this task.

## VS Code Source Status

- VS Code's SCM history contract, [`ISCMHistoryItem`](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/scm/common/history.ts), exposes `author`, `authorEmail`, and `authorIcon` fields. `authorIcon` accepts a URI, themed URI pair, or theme icon.
- The built-in Git history provider, [`extensions/git/src/historyProvider.ts`](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/git/src/historyProvider.ts), creates an avatar query containing each commit's hash, author name, author email, and a 20px requested size. It delegates resolution to `provideSourceControlHistoryItemAvatar`, then maps a returned URL to `authorIcon`; when no URL is available it uses the `account` theme icon.
- Therefore, VS Code uses a provider-based avatar resolution boundary rather than having the history view parse a remote URL itself. This project will use a smaller equivalent: the preload bridge resolves GitHub avatar URLs from the GitHub remote and commit hash, while the Vue view owns the local initials fallback.