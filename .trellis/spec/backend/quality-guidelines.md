# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

The repository includes one optional backend implementation: Project Launch Service under `service/`. It is a Go executable that is independently tested and released, while the main plugin remains a Vue/uTools application.

The frontend and service have separate validation surfaces. A successful Vite build does not validate Go process, persistence, protocol, or scheduler behavior; a successful Go test does not validate bridge types or the default-off plugin path.

---

## Forbidden Patterns

- Mixing backend concerns into Vue components
- Adding persistence or process control code without a dedicated boundary
- Logging secrets or masked values incorrectly
- Returning service payloads outside the typed ProjectBridge contract
- Starting, downloading, or silently falling back to the service without an explicit user action and a healthy compatible status
- Adding a second backend runtime or moving unrelated Git/file/AI work into Project Launch Service

---

## Required Patterns

- Keep UI state in the Pinia store or local component state
- Keep shared domain types in `src/types.ts`
- Keep semantic colors and spacing tokens in `src/index.css`
- Keep component composition clear and domain-driven
- Keep Project Launch Service isolated from the Vue presentation layer and expose it through preload plus `ProjectBridge`
- Keep service dependencies in the standard library unless a measured requirement and binary-size review justify an addition
- Preserve the disabled/no-install path without requiring a Go toolchain or service process

---

## Testing Requirements

Minimum plugin validation is:

- `npm run lint`
- `npm run build`

Minimum service validation is:

- `gofmt -l service`
- `go -C service vet ./...`
- `go -C service test ./...`
- one host build through `npm run go:build`
- CI cross-builds for Windows, Linux, and macOS on `amd64` and `arm64`, each at or below 12 MiB

Service changes that affect ownership, persistence, protocol, or scheduler behavior also require focused bridge/store validation and a check that disabled service mode retains the existing preload/renderer behavior. See [Project Launch Service](./project-launch-service.md) for exact contract-level assertions.

---

## Code Review Checklist

- Service code stays under `service/` and only delegated runtime ownership crosses the service boundary
- Status fields still reflect the real UI state
- Secrets remain masked
- Disabled, absent, incompatible, or unreachable service states keep unrelated plugin features usable
- Enabled but unhealthy service mode blocks new delegated launches rather than falling back to preload
- Service CI checks release asset names, checksums, and raw binary size before publishing
- New files follow the current directory and naming conventions
