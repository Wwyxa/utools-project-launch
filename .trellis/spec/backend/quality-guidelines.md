# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

There is no backend implementation today, so the current quality baseline is mostly about not inventing one accidentally.

The repository currently validates the frontend with `npm run lint` (`tsc --noEmit`) and `npm run build`. If a backend is added later, it must come with its own checks and not rely on the UI build to catch server bugs.

---

## Forbidden Patterns

- Mixing backend concerns into Vue components
- Adding persistence or process control code without a dedicated boundary
- Logging secrets or masked values incorrectly
- Returning backend-style payloads before there is a backend contract
- Adding a server just because the feature sounds system-like; the current plugin works as a frontend app

---

## Required Patterns

- Keep UI state in the Pinia store or local component state
- Keep shared domain types in `src/types.ts`
- Keep semantic colors and spacing tokens in `src/index.css`
- Keep component composition clear and domain-driven
- Keep any future backend isolated from the Vue presentation layer

---

## Testing Requirements

Today the project has no automated backend test suite.

Minimum validation for this repo is:

- `npm run lint`
- `npm run build`

If backend code is introduced later, add focused tests around command execution, process lifecycle handling, and any persistence or Git integration before depending on the new layer.

---

## Code Review Checklist

- No backend code was added by accident
- Status fields still reflect the real UI state
- Secrets remain masked
- No hard dependency on a server exists unless the task explicitly introduces one
- New files follow the current directory and naming conventions
