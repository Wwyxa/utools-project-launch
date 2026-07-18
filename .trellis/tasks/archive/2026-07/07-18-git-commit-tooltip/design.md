# Technical Design: Git Commit Tooltip

## Scope

The change spans the uTools preload bridge, the shared TypeScript bridge contract, the Pinia store proxy, and `GitTab.vue`. It keeps the existing Git commit data model intact: the avatar is a separately resolved enhancement keyed by repository and commit hash.

## Data Flow

```text
GitTab hover (after existing delay)
  |- readGitCommitFiles(projectId, hash) -> local file counts -> tooltip summary
  `- readGitCommitAuthorAvatar(projectId, hash)
       -> preload resolves GitHub remote + commit hash
       -> GitHub Get a commit API
       -> author.avatar_url or null
       -> GitTab image or initials fallback
```

## Preload Boundary

`public/preload.js` owns all remote parsing and GitHub HTTP work.

- Select the upstream remote when it is GitHub; otherwise prefer `origin`, then another GitHub remote.
- Recognize HTTPS, SCP-like SSH, and `ssh://` URLs targeting `github.com`; safely derive owner and repository segments.
- Call GitHub's documented repository-commit endpoint with the existing commit hash. Accept only an HTTPS `author.avatar_url`.
- Cache in-flight and completed results, including null results, per repository and full commit hash. Use a bounded in-memory cache so a long session cannot grow without limit.
- Apply a short request timeout and treat malformed remote URLs, network failures, HTTP errors, rate limits, private repositories, or missing GitHub author links as `null`.
- Do not send author email, use Gravatar, store credentials, or persist results.

The bridge adds `readGitCommitAuthorAvatar(projectPath, commitHash): Promise<string | null>`. The browser fallback returns `null`, so preview remains network-free.

## Renderer State

`GitTab.vue` keeps a small per-commit tooltip-details cache containing the local file list, summary loading/error state, avatar loading state, and resolved avatar URL.

- Start detail work only when the existing 450ms hover delay opens the tooltip.
- Retain results while the current project is loaded; clear them when the Git/project context changes and ignore stale async completions.
- Reuse `readGitCommitFiles` for counts. The summary displays a neutral loading state, then file count, additions, and deletions; unavailable data has a neutral explanatory state rather than zero counts.
- Display an image only after the avatar URL resolves. A deterministic initials badge based on author text is always available and remains visible on loading, no-avatar, and image-error paths.
- Keep existing hover leave grace period, Escape handling, viewport placement, copy action, Markdown rendering, refs, and file-expansion behavior unchanged.

## Layout

The tooltip becomes a vertically ordered information surface:

1. compact metadata row: avatar, author, relative/absolute time, copy action;
2. content block: commit title followed immediately by optional Markdown body and refs;
3. footer: file count, additions, and deletions.

The content block has no separator between title and body so the commit message reads continuously. Separators distinguish metadata and summary, not pieces of the same message. The panel keeps its current content-fitting width with a viewport-aware maximum, rather than adding a fixed or minimum width; wrapping and truncation prevent long author names, timestamps, titles, or bodies from overlapping.

## Failure and Compatibility

- GitHub public commits may return a photo without authentication. Private repositories and non-GitHub remotes intentionally fall back to initials.
- The GitHub request is advisory: no Git operation, tooltip opening, or existing file preview depends on its success.
- The user-facing UI never exposes raw HTTP errors or remote URLs.
- Rollback consists of removing the new bridge method and tooltip detail rendering; stored project data has no schema change.

## Verification

- `node --check public/preload.js`
- `npm run type-check`
- `npm run validate:project-storage`
- `npm run build`
- Run the app and inspect the tooltip with a representative GitHub-backed commit plus a no-avatar fallback scenario.