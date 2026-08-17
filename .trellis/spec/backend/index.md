# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This project has a Vue/Pinia application plus one optional local Go runtime: Project Launch Service. The service is a separately built executable under `service/`; it owns delegated script processes and automation only when the user explicitly enables service mode. It is not a general backend for project, Git, file, AI, or preference operations.

Keep the current boundaries explicit: most product behavior remains in Vue, Pinia, and the uTools preload bridge, while service-owned process supervision, scheduling, and persisted runtime state stay inside the Go runtime.

---

## Guidelines Index

| Guide                                           | Description                                         | Status     |
| ----------------------------------------------- | --------------------------------------------------- | ---------- |
| [Directory Structure](./directory-structure.md) | Service runtime and preload boundaries              | Documented |
| [Database Guidelines](./database-guidelines.md) | No database today; future persistence notes         | Documented |
| [Error Handling](./error-handling.md)           | UI-state error conventions and future backend rules | Documented |
| [Project Launch Service](./project-launch-service.md) | Optional service protocol, ownership, and lifecycle contract | Implemented |
| [Quality Guidelines](./quality-guidelines.md)   | Service validation and default-off baseline         | Documented |
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
