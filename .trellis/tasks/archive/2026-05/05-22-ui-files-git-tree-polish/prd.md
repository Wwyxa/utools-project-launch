# UI Polish: File Preview and Git Tree

## Goal

Improve visual continuity in the project details UI. The Files tab should feel like a native code viewer instead of a dark screenshot embedded in a light card, and the Git tab commit graph should regain a compact, readable rhythm after author/time metadata moved beneath commit messages.

## What I Already Know

- User specifically called out light mode first, with dark mode kept consistent where similar issues exist.
- Files tab code preview currently uses a dark `hljs` palette globally and places the preview inside a light card, creating a picture-in-picture feel.
- Files tab implementation is in `src/components/project/FilesTab.vue`.
- Git graph implementation is in `src/components/project/GitTab.vue`.
- Syntax highlighting is powered by `highlight.js` through `src/lib/markdown.ts`, with global `.hljs` colors in `src/index.css`.
- The project is a Vue 3 + Vite frontend using Tailwind utility classes and CSS variables.

## Requirements

- Make the Files tab text preview surface fill the available preview card area cleanly.
- In light mode, use a light syntax highlighting palette close to GitHub Light so code preview matches the rest of the app.
- Preserve a dark code preview palette in dark mode.
- Keep markdown rendering and memo code blocks visually coherent with the new theme behavior.
- Tighten the Git graph row layout so author/time metadata does not make the graph feel overly tall.
- Keep commit message, refs, hash, graph lanes, and author/time metadata readable without overlap.

## Acceptance Criteria

- [ ] A selected code file in light mode no longer appears as a dark rounded rectangle floating on a white card.
- [ ] Code preview background, line-number gutter, and syntax colors use light-mode surfaces and readable contrast.
- [ ] Dark mode still uses a dark syntax palette and remains readable.
- [ ] Git commit rows are more compact than the current two-line 40px rows while retaining author/time metadata.
- [ ] `npm run lint` or equivalent type-check passes.
- [ ] `npm run build` passes.

## Definition of Done

- Implementation stays scoped to frontend UI files.
- Styling follows existing CSS variable and Tailwind utility patterns.
- No unrelated refactors or data-model changes.
- Trellis finish steps are followed, including quality verification and spec-update judgment.

## Out of Scope

- Replacing `highlight.js` or adding a new editor component.
- Changing Git data fetching or commit graph algorithms.
- Adding new user preferences for code themes.

## Technical Notes

- Relevant frontend spec index: `.trellis/spec/frontend/index.md`.
- Likely files to update: `src/components/project/FilesTab.vue`, `src/components/project/GitTab.vue`, `src/index.css`, possibly `src/lib/markdown.ts` if the imported highlight theme conflicts with custom theme CSS.
