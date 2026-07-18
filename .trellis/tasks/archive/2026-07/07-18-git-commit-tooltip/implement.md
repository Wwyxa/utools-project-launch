# Implementation Plan: Git Commit Tooltip

## Ordered Work

1. Add the preload helpers for GitHub remote parsing, bounded avatar-result caching, timeout-safe JSON retrieval, and `readGitCommitAuthorAvatar`.
2. Add the bridge signature, browser fallback implementation, and Pinia store proxy for the nullable avatar URL.
3. Add tooltip detail state in `GitTab.vue`, loading local per-commit file data and the avatar only after the existing hover delay completes.
4. Add pure display helpers for initials, deterministic fallback color, and aggregated file/addition/deletion counts.
5. Rebuild the tooltip markup into metadata, continuous message content, refs, and a summary footer; add image-error handling and accessible text.
6. Run the focused syntax/type/storage checks before moving to browser validation.
7. Start the Vite app, inspect desktop and narrow viewport tooltips, and verify no-avatar and data-loading states.
8. Run the full project build, review the focused diff, then complete the Trellis quality and spec-update phases.

## Validation Commands

```powershell
node --check public/preload.js
npm run type-check
npm run validate:project-storage
npm run build
```

## Risk Controls

- A GitHub response can be unavailable, rate-limited, or too large. Return `null`, cache that outcome, and retain initials.
- A delayed hover response can arrive after project or commit context changes. Guard UI updates with the same generation/context approach already used for commit files.
- Avoid using remote API file statistics: local Git remains the sole source for the summary, preserving offline and non-GitHub behavior.
- No persistent storage or project schema migration is involved, so rollback is source-only.