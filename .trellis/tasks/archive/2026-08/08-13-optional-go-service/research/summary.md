# Project Launch Service Research Summary

## Final Decision

An independent local service is the correct architecture for surviving uTools lifecycle changes. A Go single executable is the best first implementation for this repository's combined requirements, although Rust could produce a smaller binary in some configurations and an OS-native service would be stronger for device-reboot persistence. Neither alternative justifies its additional delivery or maintenance cost for the current scope.

The decision is therefore `Project Launch Service` implemented as `project-launch-service`, downloaded on demand, stored with all service data below `~/.utools-project-launch/service/`, and disabled by default. Git remains outside the service. The first implementation must validate actual host-level survival, especially Windows job-object behavior, rather than treating an executable's detached flag as proof of independence.

## Repository Evidence

- `public/preload.js:48` stores active child-process handles in memory.
- `public/preload.js:6569` starts commands in the preload process and emits lifecycle events.
- `public/preload.js:6893` stops only process IDs known to the current preload instance.
- `src/store/useStore.ts:3951` owns automation scheduling through renderer `setTimeout`.
- `src/App.vue:191` invokes existing process cleanup only when uTools reports a full kill.
- `README.md:190` documents that scheduled tasks currently require the plugin to be running.
- There is no backend source tree, backend persistence layer, or GitHub Actions workflow.
- Existing bridge types in `src/types.ts:956` provide the correct frontend/preload boundary to extend.

## Official Documentation Evidence

- GitHub Actions matrix jobs can generate platform/architecture variations from one workflow definition:
  - https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations
  - Fetched copy: `research/github-actions-matrix.md`
- GitHub Release assets expose deterministic names, direct `browser_download_url` values, size, and a `digest` field using a `sha256:` value in the current REST response examples:
  - https://docs.github.com/en/rest/releases/assets
  - Fetched copy: `research/github-release-assets.md`
- The Go command supports target `GOOS` and `GOARCH`, `CGO_ENABLED`, `-trimpath`, and linker flags used by release builds:
  - https://pkg.go.dev/cmd/go
  - Fetched copy: `research/go-command.md`

## Binary Size Probe

A temporary pure-Go probe using `net`, `net/http`, and `encoding/json` was built with Go 1.26.5 using:

```text
CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w"
```

Measured executable sizes:

| Target        |     Size |
| ------------- | -------: |
| windows/amd64 | 5.80 MiB |
| windows/arm64 | 5.24 MiB |
| linux/amd64   | 5.68 MiB |
| linux/arm64   | 5.25 MiB |
| darwin/amd64  | 5.77 MiB |
| darwin/arm64  | 5.34 MiB |

The probe source and binaries were deleted after measurement. A 12 MiB per-executable release limit leaves roughly 2x baseline headroom while still preventing dependency or embedded-asset growth from going unnoticed.

## Decisions Supported by Evidence

- Keep Go service code in a separate top-level runtime boundary.
- Name the product `Project Launch Service` and the executable `project-launch-service`.
- Reuse the existing `~/.utools-project-launch` application root and leave `device-id.v1` unchanged.
- Keep every service-owned file below the single `~/.utools-project-launch/service/` directory; do not scatter service files beside `device-id.v1`.
- Use only the Go standard library for the first release.
- Use pure-Go builds with CGO disabled.
- Publish six assets: Windows, Linux, and macOS for `amd64` and `arm64`.
- Publish raw single executables rather than archives so each downloaded artifact is directly installable and size remains transparent.
- Use deterministic asset names and verify the GitHub-provided SHA-256 digest; also publish `checksums.txt` for manual verification and compatibility with older API responses.
- Use loopback TCP with a per-install random bearer token for the first protocol. This stays cross-platform in the standard library and avoids platform-specific named-pipe dependencies.
- Do not add boot-time installation or OS service-manager integration in the first release. The required survival boundary is plugin/uTools exit, not device reboot.
