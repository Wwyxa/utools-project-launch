# Memo Tab Frame Unification

## Goal

Remove the extra outer frame from the memo tab so its layout matches the other project tabs more closely while preserving the todo list and memo editor behavior.

## What I already know

- The memo tab currently has an outer bordered wrapper plus two bordered inner sections.
- The user wants the outermost extra frame removed because it does not match the surrounding tab design.
- The current memo tab still keeps the todo list section and memo editor section as separate panels.
- The app is a Vue/Tailwind frontend with shared design tokens in `src/index.css`.

## Assumptions (temporary)

- The memo tab should keep the two inner content areas, but the outer wrapper should be visually flattened.
- No interaction changes are needed beyond layout/frame cleanup.

## Open Questions

- None blocking.

## Requirements (evolving)

- Remove the extra outer border/shadow wrapper around the memo tab contents.
- Keep the todo list and memo editor functional and visually separated.
- Preserve the current memo editing workflow.

## Acceptance Criteria (evolving)

- [ ] Memo tab no longer reads as a boxed panel inside another boxed panel.
- [ ] Todo list and memo editor remain distinct sections.
- [ ] Existing memo behavior still works.

## Definition of Done

- UI matches the requested frame simplification.
- Lint/build stay green.
- No unrelated settings/files changes are introduced.

## Out of Scope (explicit)

- No memo feature changes.
- No settings page changes.
- No file tab changes.

## Technical Notes

- Relevant file: `src/components/project/MemoTab.vue`.
- Related shell styling lives in `src/components/project/ProjectDetails.vue` and `src/index.css`.
