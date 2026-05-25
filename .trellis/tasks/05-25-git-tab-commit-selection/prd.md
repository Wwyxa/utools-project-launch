# Git tab commit selection interaction

## Goal

Improve the Git tab AI generation flow so the user can choose an arbitrary set of commit records for AI analysis, instead of being limited to time range, author, or keyword filters. The interaction should stay compact and visually consistent with the current project details page.

## What I already know

- The request targets the project details page, Git tab, commit filtering, and AI generation.
- The current Git tab lives in `src/components/project/GitTab.vue`.
- Existing commit filtering supports keyword, author, since date, and until date.
- The current top-level AI generation prompt uses the filtered `commits` computed result as the commit scope.
- The commit list already supports opening a single commit detail dialog, and the detail dialog has its own single-commit AI generation.
- The UI is Vue 3 + Tailwind-style utility classes + lucide icons.
- Repository memory notes say Git history rows should stay compact even when author/time metadata is shown beneath the commit message.

## Assumptions (temporary)

- The desired interaction is multi-select commit selection from the visible commit list, not a backend Git query change.
- Existing filters should remain useful for narrowing the list before manual selection.
- AI generation should use manually selected commits when any are selected; otherwise it should keep the current behavior of using the filtered commit list.
- Selection state does not need to persist after leaving the project page or refreshing the Git snapshot.

## Decisions

- Manual commit selection is the primary AI scope when any commits are checked; filters remain a way to narrow what is visible and are used as the AI scope only when nothing is checked.

## Requirements (evolving)

- Add a polished multi-select interaction for Git commit records in the Git graph/list.
- Allow selecting any combination of visible commits, not just contiguous ranges or filter-derived groups.
- Show clear selected-count feedback near the filter/AI action area.
- Keep click-to-open commit details available without making selection awkward.
- Make the top-level AI generation prompt use the selected commit set when the selection is non-empty.
- Preserve existing filter behavior as a way to search/narrow commits.
- Provide a clear action to select all currently visible commits and clear selected commits.
- Keep rows compact and visually aligned with the existing Git graph layout.
- Avoid introducing new global dependencies unless clearly justified.

## Acceptance Criteria (evolving)

- [ ] A user can select and deselect individual commits from the Git list.
- [ ] A user can select all currently visible commits after filtering.
- [ ] A user can clear the current commit selection.
- [ ] The AI generation dialog indicates whether it will analyze selected commits or the filtered commit list.
- [ ] When one or more commits are selected, generated AI prompt content includes exactly the selected commits as the commit scope.
- [ ] When no commits are selected, generated AI prompt content keeps using the filtered commit list.
- [ ] Existing single-commit detail dialog and single-commit AI generation still work.
- [ ] The UI remains compact, readable, and consistent with existing surfaces in light/dark themes.
- [ ] `npm run lint` passes.

## Definition of Done (team quality bar)

- Tests added/updated where appropriate for changed behavior.
- Lint/typecheck passes.
- Docs/notes updated if behavior changes or a reusable convention is discovered.
- Rollout/rollback considered if risky.

## Out of Scope (explicit)

- Persisting selected commits across app restarts.
- Loading arbitrary commits outside the already loaded Git history pages.
- Changing the preload Git command implementation unless implementation reveals it is required.
- Replacing the existing keyword/author/date filters.
- Adding a new AI provider or changing AI settings behavior.

## Technical Notes

- `commitScopeContext` currently maps over `commits.value`, so the implementation likely needs a derived `aiScopedCommits` computed collection.
- `filterStatusSummary` should distinguish selected scope versus filtered scope.
- The row click currently opens commit details; selection should probably be via a dedicated checkbox/icon button on each row plus bulk controls near the filter/AI action area.
- Current graph row columns are `graphRowColumns = graphColumnWidth + hash + message`; selection may require adding a narrow fixed selection column without making rows visually noisy.
