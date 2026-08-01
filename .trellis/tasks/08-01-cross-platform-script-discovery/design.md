# Technical design

`public/preload.js` remains the source of truth for host capabilities. It will
expose a discovery operation returning typed script candidates. The renderer
will use that operation only after an explicit user action, then retain the
selected candidates in local form-modal state until import is confirmed.

Command execution will use a shared platform shell resolver. POSIX commands
use the configured user shell (with a safe system fallback) in login and
interactive mode so GUI-launched uTools receives shell-managed PATH values.
Windows commands use `ComSpec`/`cmd.exe` with `/d /s /c`. Project environment
values are applied last. Environment checks reuse the resolver so their result
matches launch-time resolution.

Discovery returns `ProjectBridgeScriptCandidate` records with `source`,
`name`, `command`, `cwd`, and `note`. Package candidates retain existing
common-directory behavior. Root Makefile parsing is static: parse explicit
rule headers, split multiple targets, and exclude dot/special, pattern,
variable, and malformed entries. It neither expands includes nor invokes make.

The store no longer writes candidates during path inspection. Import appends
the checked candidates whose `source + cwd + command` key is absent, preserving
all existing form entries. The persisted source union gains `makefile`; old or
unknown source values remain normalized to `manual`.
