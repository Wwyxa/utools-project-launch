# Settings Page Refinement

## Goal

Refine the settings page so the general settings area is cleaner, custom command help text only appears when relevant, card paddings feel tighter, and the selected-state treatment matches the rest of the UI better.

## What I already know

- The general settings card currently shows a title and then a second smaller subtitle line for language/theme.
- The default editor section still shows hint text even when the custom command input is hidden.
- The terminal/editor selection controls use segmented buttons inside rounded trays.
- The user wants the general settings area to feel vertically centered and less noisy.
- The app is a Vue/Tailwind frontend with shared tokens and icon buttons.

## Assumptions (temporary)

- The lower subtitle lines in General should be removed entirely.
- The default editor hint should only render together with the custom command input.
- The selected segment should use a subtler but clearer treatment than pure white.

## Open Questions

- None blocking.

## Requirements (evolving)

- Remove the small secondary language/theme labels under the General labels.
- Keep language and theme on the same visual row structure, vertically centered.
- Show the default editor hint only when the custom editor command input is visible.
- Tighten the vertical padding of the terminal and editor cards slightly.
- Improve selected-state styling for segmented controls so it matches the rest of the UI.

## Acceptance Criteria (evolving)

- [ ] General settings no longer shows duplicate subtitle labels.
- [ ] Default editor hint is hidden in preset mode and appears only with the custom field.
- [ ] Terminal and editor cards feel slightly tighter vertically.
- [ ] Segmented selected states are readable and consistent with the design system.

## Definition of Done

- Settings page behavior matches the requested refinements.
- Lint/build stay green.
- No unrelated layout regressions introduced.

## Out of Scope (explicit)

- No backend changes.
- No changes to other tabs.
- No feature additions beyond settings-page polish.

## Technical Notes

- Relevant file: `src/components/layout/SettingsTab.vue`.
- Shared strings live in `src/lib/i18n.ts`.
- Global visual tokens live in `src/index.css`.
