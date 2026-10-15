# Backend Quality Guidelines

Preload and Go are separate validation surfaces. A Vite build does not validate
native process, persistence, protocol, or scheduler behavior.

## Checks

- Preload changes: syntax-check the touched module and `public/preload.js`, then
  run the matching `validate:*` script or bridge test from `package.json`.
- Cross-layer contracts: run `npm run type-check` and `npm run build`; cover the
  real preload and browser fallback behavior where they differ.
- Go changes: `gofmt -l service`, `go -C service vet ./...`, and
  `go -C service test ./...`. Use `npm run go:build` for a host build; release CI
  checks platform assets, checksums, and raw binary size.
- Ownership changes must preserve disabled service mode and enabled-unavailable
  behavior from [Project Launch Service](./project-launch-service.md).

Keep Go dependencies in the standard library unless a measured need justifies
the dependency and release-size cost. Never make ordinary plugin use depend on
an installed service or Go toolchain.

## Performance Claims

Use `benchmark:git-interactions` or `benchmark:service-resources` for comparable
before/after measurements when making performance claims. The Windows resource
benchmark must include uTools, the service, and managed processes for any claim
about total resource usage; service RSS alone is insufficient. Keep CLI argument
and report-schema details in the benchmark scripts.
