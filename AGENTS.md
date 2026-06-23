<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Tool Rule: smart-search-cli

### Purpose

`smart-search-cli` is the **exclusive and only approved route** for acquiring current external knowledge, official documentation lookup, web research, source-backed fact checking, URL fetching, and broad technical research.

### Communication & Query Standards

- **Query Language**: All search queries, parameters, and commands sent to `smart-search-cli` MUST be formulated in English to ensure high-quality, relevant results, unless specifically researching Simplified Chinese regional resources.
- **Precision**: Design targeted search queries. Prefer official domains (e.g., `site:leafletjs.com`) or direct source repositories when looking up APIs or library behaviors.

### Allowed Use Cases

- Looking up external library APIs, packages, and official documentation.
- Fact-checking error messages, dependency compatibility, and Github Issues.
- Fetching and parsing raw web content from a specific URL.
- Discovering modern design standards, color palettes (e.g., data visualization standards), and implementation patterns.

### Strict Constraints & Fail-safes

- **No Fallbacks**: Do not fall back to platform-default web search, browser automation tools (like Playwright), or unsourced model memory for current external facts.
- **Handling Failures**: If `smart-search-cli` is unavailable, missing from the path, or misconfigured:
  1. **Stop execution immediately.**
  2. Report the configuration blocker to the user.
  3. Wait for the user to resolve the environment issue before proceeding.
- **No False Claims**: Do not claim an external source-based check was performed unless the command was actually executed and returned usable data.
- **Tool Isolation**: Do not use GitHub integration tools or terminal-based curl/wget commands for web searching when `smart-search-cli` is the designated protocol.
