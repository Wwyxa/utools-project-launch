# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This project is a Vite + Vue 3 frontend. The app shell, project dashboard, project details, memo editor, embedded terminal, and all current mock project data live on the client side.

The frontend spec below captures the actual composition pattern used in `src/`, including the Pinia store, Tailwind-based styling, shared types, and feature folders.

---

## Guidelines Index

| Guide                                             | Description                             | Status     |
| ------------------------------------------------- | --------------------------------------- | ---------- |
| [Directory Structure](./directory-structure.md)   | Module organization and file layout     | Documented |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition  | Documented |
| [Hook Guidelines](./hook-guidelines.md)           | Custom hooks, data fetching patterns    | Documented |
| [State Management](./state-management.md)         | Local state, global state, server state | Documented |
| [Quality Guidelines](./quality-guidelines.md)     | Code standards, forbidden patterns      | Documented |
| [Type Safety](./type-safety.md)                   | Type patterns, validation               | Documented |

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
