# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This project is currently frontend-only. There is no checked-in backend runtime, API layer, database schema, or migration system yet.

Use these docs to capture the rules we want to keep if a backend is added later, but document the current state honestly: project management, memo editing, terminal output, and Git actions are all modeled in the Vue app and Pinia store today.

---

## Guidelines Index

| Guide                                           | Description                                         | Status     |
| ----------------------------------------------- | --------------------------------------------------- | ---------- |
| [Directory Structure](./directory-structure.md) | Current layout and future backend boundaries        | Documented |
| [Database Guidelines](./database-guidelines.md) | No database today; future persistence notes         | Documented |
| [Error Handling](./error-handling.md)           | UI-state error conventions and future backend rules | Documented |
| [Quality Guidelines](./quality-guidelines.md)   | Backend-specific guardrails and no-backend baseline | Documented |
| [Logging Guidelines](./logging-guidelines.md)   | Current UI log shape and secret handling            | Documented |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
