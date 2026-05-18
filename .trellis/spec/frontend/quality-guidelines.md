# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Frontend quality is enforced mostly through TypeScript checks and the current component conventions.

The repo currently exposes:

- `npm run lint` -> `tsc --noEmit`
- `npm run build` -> Vite production build

There is no dedicated test runner configured yet, so the quality baseline is type safety, build success, and layout sanity checks in the browser.

---

## Forbidden Patterns

- Hard-coded colors when a semantic token already exists in `src/index.css`
- Adding backend assumptions to a UI-only flow
- Leaving icon-only buttons without an accessible label
- Copying class strings by hand when the same pattern already exists in nearby components
- Replacing shared state with duplicated local state across tabs or panels

---

## Required Patterns

- Use the shared type model from `src/types.ts`
- Use `cn` for conditional class composition when it improves readability
- Keep feature folders aligned with the current domain split
- Use `lucide-vue-next` icons already available in the repo
- Keep text, spacing, and color aligned with the design tokens in `src/index.css`

---

## Testing Requirements

Minimum checks for frontend changes today:

- run `npm run lint`
- run `npm run build`
- manually inspect the dashboard and project detail flows for layout overflow, broken tab switching, and clipped terminal output

If a test runner is added later, prefer focused component or store tests around the project shell and store mutations first.

---

## Code Review Checklist

- Props and events are typed
- New state lives in the right layer
- Icons, spacing, and colors follow the current design tokens
- The new UI still works without a backend
- No accidental use of `any` or duplicated domain models
