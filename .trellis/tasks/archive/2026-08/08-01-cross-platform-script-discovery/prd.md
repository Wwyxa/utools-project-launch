# Cross-platform command execution and script discovery

## Goal

Make project command execution use the same practical tool environment as the
user's platform shell, and let users explicitly choose discovered package and
Makefile commands before adding them to a project.

## Requirements

- Execute project commands through a platform-appropriate command interpreter:
  a login/interactive user shell on macOS and `cmd.exe` on Windows.
- Preserve inherited environment values and allow project environment entries
  to override them.
- Use the same command environment for environment-tool checks and project
  command execution.
- Keep package.json discovery in the existing root/common-directory scope.
- Add static discovery of ordinary explicit targets from only the root
  Makefile; never execute Make while discovering targets.
- Replace automatic script replacement with a selectable discovery flow that
  appends selected, non-duplicate candidates and keeps manual scripts.

## Acceptance Criteria

- [ ] macOS execution can resolve commands made available by the user's shell
      initialization, while Windows continues to use native cmd semantics.
- [ ] A path inspection does not overwrite form scripts.
- [ ] The form presents package.json and Makefile candidates for selection and
      imports only confirmed candidates.
- [ ] Makefile parsing excludes special, variable, and pattern rules and
      produces `make <target>` commands for normal targets.
- [ ] Existing saved projects continue loading; `makefile` script provenance is
      persisted and restored.
- [ ] Focused discovery and runtime tests plus type checking pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
