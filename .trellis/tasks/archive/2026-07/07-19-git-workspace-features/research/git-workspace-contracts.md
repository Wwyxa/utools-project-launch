# Research: Git workspace contracts

> Revision note (2026-07-19): The Git machine-format, parser, concurrency, failure-isolation, object-ID, and fixture findings in this document remain authoritative. The original read-only related-repository scope and teleported-overlay product recommendation are superseded by `../prd.md` and `../design.md`, which define a selectable repository context in the existing Git Tab top bar and allow ordinary Git content actions against the selected authorized checkout.

- **Query**: Research the existing GitTab -> Pinia -> browser/preload bridge architecture and define robust read-only linked-worktree and direct-submodule contracts from official Git documentation.
- **Scope**: mixed (local repository inspection + official external documentation)
- **Date**: 2026-07-19

## Executive Summary

The feature fits the repository's existing four-layer boundary without adding a second bridge abstraction:

```text
GitTab.vue -> Pinia useStore -> typed ProjectBridge/fallback -> public/preload.js -> Git argv commands
```

Recommended planning contract:

1. Add one read-only bridge method, `readGitWorkspaceSnapshot(projectPath)`, returning two independently fallible sections: `worktrees` and `submodules`.
2. Keep this snapshot transient in dedicated Pinia maps. Do not persist it in `Project`, merge it into the existing commit-history snapshot, or refresh it as a side effect of every stage/unstage operation.
3. Enumerate worktrees with `git worktree list --porcelain -z --expire=now`; collect each available worktree's lightweight status with `git --no-optional-locks ... status --porcelain=v2 --branch --ahead-behind -z`.
4. Discover direct submodules by correlating `.gitmodules` config, superproject index stage records (`mode 160000`), local submodule config, and each available checkout's own `status --porcelain=v2`. Do not use `git submodule status` as the data contract and do not pass `--recursive`.
5. Preserve full object IDs as strings and return `objectFormat: "sha1" | "sha256"`; validate 40 or 64 hexadecimal characters according to the producing repository rather than truncating for transport.
6. Use an async argv-only Git runner with NUL-aware streaming parsers, a worker pool of 4, a 30-second per-entry status timeout, and per-entry failure capture. One slow or inaccessible related path must not reject its section.
7. Reuse the existing `openTerminal`, `openEditor`, and `showItemInFolder` bridge methods through new store wrappers that accept only paths present in the current workspace snapshot.

## Approved Product Decisions (Input, Not Reopened Here)

- First release is read-only except refresh and existing path navigation.
- A Git top-bar entry opens a teleported overlay grouped into Worktrees and Submodules.
- Worktrees include full lightweight status.
- Only direct submodules are shown.
- Related paths open in the configured editor, configured terminal, or system file manager.
- No in-app project switching and no automatic project registration.

## Local Facts

### Existing ownership and data flow

| Layer             | Current fact                                                                                                                                                                                                                          | Local evidence                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git UI            | `GitTab.vue` imports `useStore`, derives the current Git snapshot from `props.project.git`, derives changed files from store/project state, and reads `gitRefreshing` / `gitStatusRefreshing`. It does not import `getProjectBridge`. | `src/components/project/GitTab.vue:54`, `src/components/project/GitTab.vue:166`, `src/components/project/GitTab.vue:287`, `src/components/project/GitTab.vue:312`                              |
| Top-bar host      | Repository status and repository path already render in the Git top status row; this is the natural location for the workspace entry.                                                                                                 | `src/components/project/GitTab.vue:2787`, `src/components/project/GitTab.vue:2810`                                                                                                             |
| Parent refresh    | `ProjectDetails.vue` triggers the initial full Git refresh on mount and exposes a manual refresh button.                                                                                                                              | `src/components/project/ProjectDetails.vue:103`, `src/components/project/ProjectDetails.vue:184`                                                                                               |
| Pinia boundary    | `useStore.ts` creates one module-level `bridge = getProjectBridge()`, owns in-flight refresh maps/tokens, and translates project IDs to paths before bridge calls.                                                                    | `src/store/useStore.ts:66`, `src/store/useStore.ts:100`, `src/store/useStore.ts:1870`                                                                                                          |
| Shared types      | Git domain shapes and the complete `ProjectBridge` interface live in `src/types.ts`; `src/global.d.ts` types `window.projectBridge` through that shared interface.                                                                    | `src/types.ts:351`, `src/types.ts:642`, `src/global.d.ts:1`                                                                                                                                    |
| Browser fallback  | `src/lib/projectBridge.ts` implements a complete typed fallback. Git reads return explicit empty snapshots, Git writes return unavailable results, editor/terminal launches return `launched: false`, and folder reveal is a no-op.   | `src/lib/projectBridge.ts:316`, `src/lib/projectBridge.ts:381`, `src/lib/projectBridge.ts:502`, `src/lib/projectBridge.ts:641`, `src/lib/projectBridge.ts:674`, `src/lib/projectBridge.ts:706` |
| Preload ownership | `public/preload.js` owns Git process execution/parsing and exports the real API through one `window.projectBridge` object.                                                                                                            | `public/preload.js:1322`, `public/preload.js:3168`, `public/preload.js:3473`, `public/preload.js:3782`                                                                                         |

The project spec explicitly states the same boundary: UI components call store actions, store actions call `src/lib/projectBridge.ts`, and the bridge delegates to `public/preload.js` in uTools (`.trellis/spec/frontend/state-management.md`, "Server State" and "Project File Browser Bridge"). Shared preload contracts belong in `src/types.ts` and must not be duplicated in components (`.trellis/spec/frontend/type-safety.md`).

### Current Git implementation characteristics relevant to planning

- The existing general Git helpers use `execFileSync`, `execFile`, or `spawnSync` with argument arrays. This already avoids shell interpolation for Git paths (`public/preload.js:1292-1385`).
- The current status parser uses `git status --porcelain=v1 -z` and correctly treats the pathname as NUL-delimited (`public/preload.js:1447-1514`), but current `runGitAsync` buffers UTF-8 output and collapses every failure to `null` (`public/preload.js:1335`). The new contract needs structured exit/timeout errors and should not reuse that lossy result shape.
- `readGitStatusSnapshot` composes branch, HEAD, status entries, numstat, branches, remotes, and upstream in preload (`public/preload.js:3168`). `readGitSnapshot` composes status and paged commits (`public/preload.js:3473`). Workspace relationships are a separate read model and should not expand this history refresh path.
- The existing repository resolver uses `rev-parse --show-toplevel` (`public/preload.js:1292`, `public/preload.js:1307`), which intentionally fails for a bare repository. Bare support therefore needs a workspace-specific resolver using `--absolute-git-dir` / `--is-bare-repository` rather than blindly reusing `findGitRootAsync`.
- Current commit parsing already accepts full 40-64 character hashes (`public/preload.js:3432`), and the current Git commit validator accepts the same range (`scripts/validate-git-commits.mjs:58`). The new contract should make the object format explicit instead of merely accepting a length range.

### Existing editor, terminal, and folder wrappers

| User action          | Current store wrapper                                                                                                                            | Current bridge/preload boundary                                                                            | Reuse implication                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Reveal folder        | `openProjectFolder(projectId)` resolves the project and calls `bridge.showItemInFolder(project.path)`.                                           | `ProjectBridge.showItemInFolder(path)`; preload calls Electron `shell.showItemInFolder(expandPath(path))`. | Add a store-owned related-path wrapper; no new preload capability is needed.                 |
| Open terminal        | `openProjectInTerminal(projectId)` clones terminal preferences, calls `bridge.openTerminal({ projectPath, terminal })`, and logs launch/failure. | `openTerminal` validates that the supplied path exists and is a directory before launching.                | The payload already supports any directory path despite the `projectPath` name.              |
| Open editor          | `openProjectInEditor(projectId)` clones editor preferences, calls `bridge.openEditor({ projectPath, editor })`, and logs launch/failure.         | `openEditor` validates the supplied directory and launches VS Code, Cursor, or a custom command.           | The payload already supports a related repository directory.                                 |
| Reveal project entry | `showProjectEntryInFolder(projectId, relativePath)` delegates to a canonical child-path validator.                                               | `showProjectEntryInFolder(projectPath, relativePath)` is intentionally restricted under a project root.    | Do not use this child-path method for worktrees, which may be siblings or on another volume. |

Evidence: `src/store/useStore.ts:1997`, `src/store/useStore.ts:3308`, `src/store/useStore.ts:3316`, `src/store/useStore.ts:3360`, `src/types.ts:532-555`, `src/types.ts:731-742`, `public/preload.js:1109`, `public/preload.js:1217`, `public/preload.js:2791`, `public/preload.js:3847`.

### Current validation surface

`package.json:6-21` currently exposes:

- `npm run lint` and `npm run type-check`: `tsc --noEmit`.
- `npm run build`: Vite production build.
- `npm run test:git-diff`: focused Vitest tests for frontend unified-diff parsing.
- `npm run validate:git-commits`: creates a temporary real Git repository, VM-loads `public/preload.js`, and validates full parent/hash relationships.
- `npm run validate:git-diff`: creates a temporary real Git repository, VM-loads preload, and validates staged/unstaged/combined/untracked/path behavior.
- `npm run validate:project-files`: VM-loads preload and validates path boundaries, spaces through Node path APIs, ignored folders, mutations, reveal, and symlink/junction isolation.
- `npm run validate:ai-reasoning`, `validate:markdown-images`, `validate:project-storage`, and `validate:process-results`: focused checks for their existing contracts.

There is no current validator for worktree porcelain, submodule correlation, bounded Git concurrency, or workspace browser fallback. The nearest established pattern is a temporary real repository plus a VM-loaded preload bridge (`scripts/validate-git-commits.mjs:1-65`, `scripts/validate-git-diff.mjs:1-84`).

## Officially Sourced Facts

This section records Git behavior documented by Git. Design choices based on those facts are in the next section.

### Linked worktrees

Source: https://git-scm.com/docs/git-worktree

- A non-bare repository has one main worktree and zero or more linked worktrees. The main worktree is listed first by `git worktree list`; linked worktrees follow.
- `git worktree list` reports bare, checked-out revision, branch or detached HEAD, locked, and prunable states.
- `git worktree list --porcelain` is documented as stable across Git versions and user configuration. The documentation recommends combining it with `-z`.
- With `--porcelain -z`, attributes are NUL-terminated. The first attribute is always `worktree`; an empty field terminates a record. Boolean attributes such as `bare` and `detached` have no value. `locked` may have an optional reason; `prunable` may have a reason.
- `-z` permits paths and lock reasons containing newlines to be parsed without quote/unescape heuristics.
- `--expire=<time>` on `list` controls when missing worktrees are annotated as prunable. Using `--expire=now` makes current missing paths visible immediately without pruning anything.
- A locked worktree may exist on a removable device or network share that is not currently mounted. Lock and path availability are therefore separate facts.
- Git advises using Git commands such as `rev-parse` rather than assuming internal `$GIT_DIR` paths.
- The manual explicitly notes that support for submodules with multiple checkouts is incomplete. The workspace reader should report observed state and avoid lifecycle mutation.

### Per-worktree status and background locking

Source: https://git-scm.com/docs/git-status

- Default long status is human-oriented and subject to change. `--porcelain` is the stable scripting interface.
- Porcelain v2 provides optional `# branch.*` headers and structured entry kinds: `1` ordinary, `2` renamed/copied, `u` unmerged, `?` untracked, and `!` ignored.
- In ordinary/renamed records, `XY` means index state (`X`) and worktree state (`Y`), with `.` representing unchanged. One path may therefore count in both staged and unstaged totals.
- `# branch.oid`, `# branch.head`, `# branch.upstream`, and `# branch.ab +<ahead> -<behind>` provide current HEAD/branch/upstream divergence when requested with `--branch` and when available. `branch.oid` may be `(initial)`, `branch.head` may be `(detached)`, and `branch.ab` may be absent even when another branch header exists.
- With `-z`, pathnames are emitted verbatim without `core.quotePath` quoting and records are NUL-terminated. A type-2 rename/copy record has a second NUL-delimited pathname.
- `--untracked-files=normal` reports untracked files and directories as status entries; `all` reports individual files inside untracked directories and may be more expensive.
- `git status` normally refreshes and may write cached stat information to the index. The official background-refresh guidance says scripts running status in the background should consider `git --no-optional-locks status` to avoid lock conflicts with foreground Git operations.
- Untracked scanning can be slow in large worktrees. This supports bounded concurrency, per-entry timeouts, and an explicit count-granularity decision.

### Direct submodule configuration and state

Sources:

- https://git-scm.com/docs/git-submodule
- https://git-scm.com/docs/gitmodules
- https://git-scm.com/docs/git-config
- https://git-scm.com/docs/git-ls-files

Facts:

- `.gitmodules` is a top-level file using Git config syntax. It contains one subsection per submodule; the subsection value is the logical submodule name.
- `submodule.<name>.path` and `submodule.<name>.url` are required. Paths are relative to the superproject top level, must not end in `/`, and must be unique. A relative URL is interpreted relative to the superproject's default remote.
- `submodule.<name>.branch` is optional. The special value `.` means the submodule branch name should match the current superproject branch; absent means remote HEAD for `update --remote`. This configured branch is not proof of the checkout's current branch.
- `git submodule init` copies `submodule.<name>.url` into the superproject's `.git/config` without overwriting existing local information. A local URL is therefore an initialization/registration signal and may intentionally differ from `.gitmodules`.
- For `update --remote`, `.git/config` branch configuration takes precedence over `.gitmodules`. Declared, local, and effective values should be distinguishable rather than overwriting the declared value in the result.
- `git submodule status` is human presentation: it prefixes an object name with `-`, `+`, or `U`. The same states can be derived from structured sources: local registration, index gitlink stages, actual checkout HEAD, and status porcelain. The first release does not need to parse this presentation string.
- `git ls-files --stage` exposes index mode, object name, stage number, and path. An index submodule entry uses gitlink mode `160000` at stage 0.
- An unmerged index path may have stages 1, 2, and 3 instead of stage 0. `git ls-files --stage -z` makes unusual pathnames verbatim and NUL-terminated, allowing submodule merge conflicts to be represented without guessing a recorded OID.
- `git config --null` terminates values with NUL and uses newline between a shown key and its value. This safely preserves config values containing line breaks. Subsection names are case-sensitive and can contain any character except newline/NUL; dots in a submodule name must not be parsed by naively splitting the key on every dot.
- `git submodule --recursive` explicitly traverses nested submodules. Omitting recursive commands and running checkout status only for the direct configured/index entries enforces the first-release no-recursion boundary.

### Object format and complete OIDs

Sources:

- https://git-scm.com/docs/git-rev-parse
- https://git-scm.com/docs/git-config

Facts:

- `git rev-parse --show-object-format=storage` reports the repository's storage hash algorithm.
- Git documents storage/output object formats `sha1` and `sha256`.
- Full SHA-1 object IDs are 40 hexadecimal characters; full SHA-256 object IDs are 64 hexadecimal characters.
- `--short` and `--abbrev` deliberately shorten OIDs and are inappropriate for equality, graph, recorded-vs-actual, or bridge identity fields.

## Design Recommendations

This section is planning guidance, not a claim that the code already behaves this way.

### Command and parser contract

#### Repository capability probe

Run with argv arrays and no shell:

```text
git -C <input-path> rev-parse --is-bare-repository
git -C <input-path> rev-parse --absolute-git-dir
git -C <input-path> rev-parse --show-object-format=storage
git -C <input-path> rev-parse --show-toplevel        # non-bare only
```

- For a non-bare checkout, `repositoryPath` is the absolute top level.
- For a bare repository, `repositoryPath` is the absolute Git directory.
- If Git is missing or the path is not a repository, return both sections as `unavailable`; do not synthesize a successful empty repository.
- Feature-probe the required machine formats by executing them. If an older Git rejects `worktree list ... -z` or porcelain v2, return `unsupported-output`; do not fall back to parsing localized column/human output.

#### Worktree enumeration

```text
git -C <repository> worktree list --porcelain -z --expire=now
```

Parser rules:

- Split on NUL only; preserve tabs, spaces, Unicode, CR, and LF inside values.
- Start a record on `worktree <path>` and finish on the empty NUL field.
- Split each attribute at the first ASCII space only.
- Preserve the full `branch refs/heads/...` value and derive a display name separately.
- Ignore unknown attributes for forward compatibility.
- The first non-bare record is `main`; later records are `linked`. A record carrying `bare` is `bare`.
- A locked entry may also be available; a prunable entry will commonly have an unavailable path. Do not derive one field from the other.

For each non-bare entry whose path exists as a directory:

```text
git --no-optional-locks -C <worktree-path> status \
  --porcelain=v2 --branch --ahead-behind \
  --untracked-files=<normal-or-all> -z
```

Status parser rules:

- Ignore unknown `#` headers.
- Parse `branch.oid`, `branch.head`, `branch.upstream`, and `branch.ab` independently; absence means unknown/not configured, not zero.
- Entry kind `1` or `2`: increment staged when `X !== "."`; increment unstaged when `Y !== "."`. A mixed entry increments both.
- Entry kind `u`: increment `conflictedEntries` once and do not double-count it as an ordinary staged/unstaged entry.
- Entry kind `?`: increment `untrackedEntries` once.
- Entry kind `!`: ignore because ignored entries are not requested.
- Type `2` consumes the second NUL pathname but still counts as one status entry.
- Counts are status-entry counts. With `normal`, one untracked directory is one entry; with `all`, its files are individual entries.

#### Direct submodule correlation

Run section-level commands independently so `.gitmodules`, local config, and index failures can produce a partial section:

```text
git -C <superproject> config --null --file .gitmodules \
  --get-regexp '^submodule\..*\.(path|url|branch)$'

git -C <superproject> config --local --null \
  --get-regexp '^submodule\..*\.(url|branch)$'

git -C <superproject> ls-files --stage --full-name -z
```

Compatibility note: `--get-regexp` is the long-standing form and remains supported although current Git documentation recommends the newer `git config get --all --show-names --regexp` command form. If implementation chooses the new form, feature-probe it or state a minimum Git version.

Correlation rules:

1. Parse config records as `key + LF + value + NUL`. Strip the exact `submodule.` prefix and one known final suffix (`.path`, `.url`, `.branch`) so logical names containing dots remain intact.
2. Parse every stage record as `mode SP oid SP stage TAB path NUL`. Retain mode `160000` and retain any configured path even when its mode is not `160000`.
3. Build the union of valid `.gitmodules` paths and index gitlink paths. This keeps index-only, config-only, wrong-mode, and conflicted entries visible rather than silently omitting them.
4. A single stage-0 `160000` entry yields `index.kind = "recorded"` and `recordedOid`.
5. Stages 1/2/3 yield `index.kind = "conflicted"`, `recordedOid = null`, and explicit stage records. A mismatch cannot be computed during the conflict.
6. A configured path with no index entry is `missing`; a stage-0 non-160000 entry is `not-gitlink`.
7. Local `submodule.<name>.url` presence yields `registration = "initialized"`; absence yields `"uninitialized"`. This is separate from whether a checkout directory exists or is a readable Git repository.
8. Resolve the path lexically under the superproject root and reject escapes. Pass the resulting absolute path as one argv item; never compose `git submodule foreach` shell text.
9. For an available direct checkout, run `rev-parse --show-object-format=storage` and the same porcelain-v2 status command. Use `--ignore-submodules=dirty` for this inner status so nested checkout dirtiness is not recursively scanned, while direct repository staged/unstaged changes remain visible. Do not enumerate nested submodules.
10. `commitMismatch` is `null` unless both stage-0 `recordedOid` and actual `head.oid` are available; otherwise it is strict full-string inequality.
11. Keep declared URL/branch, local override, and effective value separately. Display can default to the declared value while surfacing a local override without losing provenance.

### Concurrency and failure isolation

- Use one async Git runner based on `spawn`/`execFile` argument arrays with `windowsHide: true`, stdin ignored, and no shell.
- Apply `GIT_OPTIONAL_LOCKS=0` or the documented global `--no-optional-locks` to every background `status` process.
- Use a fixed worker pool of 4 across per-worktree and per-submodule status reads. Do not create one process per entry with unbounded `Promise.all`.
- Give each per-entry status command a 30-second timeout. A timeout returns an entry failure and leaves `status: null`; it does not reject sibling entries.
- Parse NUL records incrementally from buffers/StringDecoder rather than relying on Node's default `execFile` `maxBuffer`. Retain only counters/required metadata, not every pathname.
- Bound captured stderr (for example, 16 KiB) and expose a normalized message plus operation/exit code. Do not expose command lines containing arbitrary paths as user-facing text.
- Section-level enumeration uses all-settled semantics. Worktree failure must not erase submodules; malformed `.gitmodules` must not erase healthy worktree results.
- Preserve discovery order: main/bare first, linked worktrees in Git's order, and submodules in `.gitmodules` order followed by index-only anomalies.

## Proposed Exact Shared TypeScript Shapes

These shapes follow current naming conventions in `src/types.ts` and preserve impossible/unknown states explicitly.

```ts
export type ProjectGitObjectFormat = "sha1" | "sha256";
export type ProjectGitObjectId = string;

export type ProjectGitWorkspaceOperation =
  | "repository"
  | "worktree-list"
  | "worktree-status"
  | "submodule-config"
  | "submodule-index"
  | "submodule-registration"
  | "submodule-status";

export interface ProjectGitWorkspaceFailure {
  code:
    | "git-unavailable"
    | "not-a-repository"
    | "unsupported-output"
    | "invalid-output"
    | "path-unavailable"
    | "permission-denied"
    | "timeout"
    | "command-failed";
  operation: ProjectGitWorkspaceOperation;
  message: string;
  exitCode?: number;
}

export interface ProjectGitWorkspaceSection<T> {
  state: "ready" | "partial" | "unavailable";
  entries: T[];
  failure: ProjectGitWorkspaceFailure | null;
}

export interface ProjectGitHeadState {
  kind: "branch" | "detached" | "unborn" | "bare" | "unknown";
  ref: string | null;
  name: string | null;
  oid: ProjectGitObjectId | null;
}

export interface ProjectGitChangeCounts {
  stagedEntries: number;
  unstagedEntries: number;
  untrackedEntries: number;
  conflictedEntries: number;
}

export interface ProjectGitUpstreamState {
  ref: string;
  ahead: number;
  behind: number;
}

export interface ProjectGitWorktreeStatus extends ProjectGitChangeCounts {
  upstream: ProjectGitUpstreamState | null;
}

export interface ProjectGitWorktreeSummary {
  kind: "main" | "linked" | "bare";
  path: string;
  pathAvailable: boolean;
  objectFormat: ProjectGitObjectFormat;
  head: ProjectGitHeadState;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  prunableReason: string | null;
  status: ProjectGitWorktreeStatus | null;
  failure: ProjectGitWorkspaceFailure | null;
}

export interface ProjectGitSubmoduleIndexStage {
  stage: 1 | 2 | 3;
  mode: string;
  oid: ProjectGitObjectId;
}

export type ProjectGitSubmoduleIndexState =
  | { kind: "recorded"; recordedOid: ProjectGitObjectId; conflictStages: [] }
  | { kind: "conflicted"; recordedOid: null; conflictStages: ProjectGitSubmoduleIndexStage[] }
  | { kind: "missing" | "not-gitlink"; recordedOid: null; conflictStages: [] };

export interface ProjectGitSubmoduleConfigValue {
  declared: string | null;
  local: string | null;
  effective: string | null;
}

export interface ProjectGitSubmoduleSummary {
  name: string | null;
  path: string;
  pathAvailable: boolean;
  configuration: "configured" | "index-only" | "invalid";
  url: ProjectGitSubmoduleConfigValue;
  branch: ProjectGitSubmoduleConfigValue;
  index: ProjectGitSubmoduleIndexState;
  registration: "initialized" | "uninitialized" | "unknown";
  checkout: "available" | "missing" | "not-repository" | "unreadable";
  objectFormat: ProjectGitObjectFormat | null;
  head: ProjectGitHeadState;
  commitMismatch: boolean | null;
  status: ProjectGitChangeCounts | null;
  failure: ProjectGitWorkspaceFailure | null;
}

export interface ProjectGitWorkspaceSnapshot {
  repositoryPath: string;
  objectFormat: ProjectGitObjectFormat | null;
  worktrees: ProjectGitWorkspaceSection<ProjectGitWorktreeSummary>;
  submodules: ProjectGitWorkspaceSection<ProjectGitSubmoduleSummary>;
  lastRefreshedAt: string;
}

export interface ProjectBridgeGitWorkspaceSnapshot extends ProjectGitWorkspaceSnapshot {}
```

Runtime invariants for those types:

- `ProjectGitObjectId` is always a complete lowercase hexadecimal storage-format OID: 40 characters for `sha1`, 64 for `sha256`. UI shortening is presentation-only.
- `section.state === "ready"` means section enumeration succeeded and every entry has `failure === null`; `partial` means entries were preserved but at least one section source or entry failed; `unavailable` means the section could not be enumerated.
- `failure` on a section is only for section-wide work. Per-path status/read failures live on the entry.
- `pathAvailable` is an observed directory check at refresh time, not a guarantee that a later navigation launch succeeds.
- `upstream: null` means no usable upstream/ahead-behind result. It must not be normalized into `{ ahead: 0, behind: 0 }`.
- `commitMismatch: null` means comparison is impossible; it is not equivalent to `false`.

### Bridge and store method boundaries

Add exactly one read bridge method:

```ts
interface ProjectBridge {
  readGitWorkspaceSnapshot(projectPath: string): Promise<ProjectBridgeGitWorkspaceSnapshot>;
}
```

Responsibilities:

| Boundary         | Recommendation                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GitTab.vue`     | Keep `isGitWorkspaceOverlayOpen` and focus/teleport state locally. Read snapshot/refresh flags from store. Opening with no cached snapshot triggers a store refresh. Closing changes only overlay state, preserving history filters, selection, expanded commits, diff review, and scroll state. |
| Pinia            | Add `gitWorkspaces: Record<string, ProjectGitWorkspaceSnapshot                                                                                                                                                                                                                                   | undefined>`and`gitWorkspaceRefreshing: Record<string, boolean>`, plus module-level per-project promise/token maps matching the established Git refresh pattern. Resolve project ID to path and ignore stale results after project/path changes. Do not persist this map. |
| Browser fallback | Implement the method with `repositoryPath: ""`, `objectFormat: null`, and both sections `state: "unavailable"`, `entries: []`, with a browser-preview failure. This reports unavailable local capability rather than simulating an empty real repository.                                        |
| Preload          | Own repository probing, all Git commands, parsing, bounded concurrency, timeouts, and failure normalization. Export the method from `window.projectBridge`.                                                                                                                                      |

Recommended store navigation wrappers, implemented by reusing current bridge methods:

```ts
openGitWorkspacePathInEditor(projectId: string, targetPath: string): Promise<void>;
openGitWorkspacePathInTerminal(projectId: string, targetPath: string): Promise<void>;
showGitWorkspacePathInFolder(projectId: string, targetPath: string): Promise<void>;
```

The store should accept only an exact path currently present in that project's worktree/submodule entries with `pathAvailable === true`, clone the current device-local preferences, re-check `bridge.pathExists(targetPath)` immediately before launch, and report bridge failures through the existing project log/toast pattern. These wrappers must not select another project or mutate the project catalog.

## Compatibility and Failure Matrix

| Case                                                | Expected result                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git executable missing                              | Both sections `unavailable`; root object format `null`; explicit `git-unavailable`.                                                                |
| Input is not a repository                           | Both sections `unavailable`; explicit `not-a-repository`; no successful empty-state claim.                                                         |
| Older Git rejects required `-z`/porcelain v2 format | Affected section `unavailable` with `unsupported-output`; never parse localized human output.                                                      |
| Repository has only main worktree                   | One `kind: "main"` entry; Worktrees is not an empty section.                                                                                       |
| Bare repository only                                | One `kind: "bare"`, `head.kind: "bare"`, `status: null`; Submodules unavailable because there is no working-tree index/config checkout to inspect. |
| Bare repository with linked worktrees               | Preserve bare record first; read status only for available linked records.                                                                         |
| Detached worktree                                   | `head.kind: "detached"`, full `head.oid`, no branch ref/name; upstream `null`.                                                                     |
| Unborn worktree                                     | `head.kind: "unborn"`, `oid: null`; preserve branch ref/name when available; no attempt to parse `(initial)` as an OID.                            |
| Locked and available                                | `locked: true`, status still read, navigation enabled; lock is lifecycle health, not path failure.                                                 |
| Locked and unmounted                                | Preserve lock/reason, `pathAvailable: false`, entry failure; do not hide it.                                                                       |
| Prunable path                                       | Preserve prunable/reason and entry; status `null`; no prune command is exposed.                                                                    |
| Path contains spaces, tabs, Unicode, CR, or LF      | Preserve exact string from NUL output; pass as one argv value; no shell or quote/unquote logic.                                                    |
| Worktree status has staged+unstaged same path       | Increment both counters once.                                                                                                                      |
| Worktree status has conflict                        | Increment `conflictedEntries`; retain other healthy counters and entries.                                                                          |
| No upstream                                         | `upstream: null`; do not show zero-ahead/zero-behind as confirmed.                                                                                 |
| Upstream exists and branch.ab is present            | Parse signed counts into non-negative `ahead`/`behind`.                                                                                            |
| One worktree status times out/fails                 | That entry has `status: null` and failure; siblings and Submodules remain visible.                                                                 |
| `.gitmodules` absent and no gitlinks                | Submodules `ready` with an empty entry array.                                                                                                      |
| `.gitmodules` malformed                             | Submodules `partial`/`unavailable` with config failure; retain index-only gitlinks if index enumeration succeeded.                                 |
| Configured submodule missing index entry            | Visible with `index.kind: "missing"`; checkout may still be inspected if present.                                                                  |
| Index gitlink missing `.gitmodules` entry           | Visible as `configuration: "index-only"`, with null declared config.                                                                               |
| Submodule path is ordinary file/tree mode           | Visible with `index.kind: "not-gitlink"`.                                                                                                          |
| Parent index has gitlink conflict                   | `index.kind: "conflicted"`, stages 1/2/3 retained, recorded OID and mismatch null.                                                                 |
| Uninitialized submodule                             | `registration: "uninitialized"`; checkout usually `missing`; recorded OID remains visible.                                                         |
| Registered but checkout missing                     | `registration: "initialized"`, `checkout: "missing"`; do not collapse to one boolean.                                                              |
| Checkout path exists but is not a Git repository    | `checkout: "not-repository"`; retain configuration/index facts.                                                                                    |
| Checkout unreadable                                 | `checkout: "unreadable"` plus per-entry failure; siblings remain visible.                                                                          |
| Checkout on branch                                  | `head.kind: "branch"` with actual branch, independent of configured update branch.                                                                 |
| Checkout detached                                   | `head.kind: "detached"`; this is normal after default submodule checkout.                                                                          |
| Recorded OID differs from actual HEAD               | `commitMismatch: true`, even if checkout itself is clean.                                                                                          |
| Direct submodule dirty/untracked                    | Status counters from that checkout; no child submodule records are added.                                                                          |
| Nested submodule exists                             | It may contribute only to direct checkout aggregate according to the chosen ignore mode; it never appears as another result entry.                 |
| SHA-1 repository                                    | Full OIDs validate at 40 hex characters.                                                                                                           |
| SHA-256 repository                                  | Full OIDs validate at 64 hex characters; no parser slice, regex, or UI key assumes 40.                                                             |
| Renderer refresh races project/path change          | Store token rejects stale result; current overlay context remains unchanged.                                                                       |
| Browser preview                                     | Both groups render unavailable/empty fallback and navigation reports unsupported; no fake local success.                                           |

## Focused Validation Fixture Recommendations

Add a focused `scripts/validate-git-workspace.mjs` following the existing VM-preload pattern and a package script `validate:git-workspace`. The validator should use temporary repositories only and invoke Git through `execFileSync`/`spawn` argv arrays.

### Parser-oriented synthetic cases

- Worktree porcelain buffer with main, linked, bare, detached, locked-without-reason, locked reason containing LF, prunable reason, unknown future attribute, and double-NUL record boundaries.
- Status porcelain-v2 buffer containing kinds `1`, `2`, `u`, `?`, mixed staged/unstaged XY, unknown header, detached branch, initial branch, missing branch.ab, and a rename whose two names include spaces/tab/LF.
- Config `key LF value NUL` records with a logical name containing dots and values containing spaces/LF.
- `ls-files --stage -z` records for stage-0 `160000`, stages 1/2/3, non-gitlink mode, and paths with spaces/tab/LF.
- OID validation table: 40-char SHA-1, 64-char SHA-256, abbreviated, non-hex, all-zero initial marker, and format/length mismatch.

### Real Git fixture cases

- Place the fixture root under a directory containing spaces and non-ASCII characters; on Windows include drive-letter paths and verify every spawned path is one argv element.
- Create main + linked branch + detached worktrees. Lock one with a reason. Remove one linked directory and enumerate with `--expire=now` to produce a prunable entry.
- In one linked worktree create one staged path, one unstaged path, one mixed path, one untracked path/directory, and an unmerged path.
- Configure a local bare remote/upstream so ahead/behind can be tested without network access.
- Create a separate bare repository fixture and, where supported, attach a linked worktree.
- Add two direct local submodules with file protocol enabled only for fixture setup: one initialized/clean and one uninitialized. Use logical names and paths containing spaces.
- Advance one submodule checkout without updating the superproject gitlink to assert mismatch; add tracked and untracked changes to assert dirty counts; detach one checkout and leave another on a branch.
- Produce a superproject gitlink merge conflict and assert all available index stages, null recorded OID, and null mismatch.
- Add a nested submodule inside one direct submodule and assert result length still contains only direct entries.
- Create config-only and index-only inconsistency fixtures and assert they remain visible.
- Initialize with `git init --object-format=sha256` when supported. Assert repository format is `sha256`, OIDs are 64 characters, and equality/mismatch uses complete strings. If unsupported, report a clearly skipped compatibility case rather than silently passing SHA-1.
- Simulate one per-entry failure (deleted path is deterministic; permission denial may be platform-dependent) and assert healthy siblings remain returned.
- Stub a hanging status child in one VM test to assert the timeout, process termination, bounded pool, and sibling completion without waiting 30 real seconds; make timeout configurable/injectable for the validator.

### Cross-layer checks

- Browser fallback returns the exact unavailable shape and does not throw.
- Store deduplicates same-project refreshes, force refresh uses a new token, and a stale response cannot overwrite a newer project/path result.
- Navigation wrappers reject stale/arbitrary paths not in the current snapshot and reuse device-local preferences.
- Opening/closing the teleported overlay does not change commit filters, selected hashes, worktree diff selection, expanded commit files, right-side context, or scroll state.
- Empty groups, partial groups, per-entry failures, long Windows paths, and long lock reasons remain scannable in the compact overlay.

### Minimum executable verification after implementation

```text
node --check public/preload.js
npm run type-check
npm run validate:git-workspace
npm run validate:git-commits
npm run validate:git-diff
npm run build
```

## Official References and Retrieval Record

Official pages fetched through the approved `smart-search-cli` route:

- https://git-scm.com/docs/git-worktree — stable porcelain worktree records, `-z`, main/linked/bare/detached/locked/prunable states.
- https://git-scm.com/docs/git-status — porcelain v2, branch headers, XY/submodule fields, pathname `-z`, optional-lock background guidance, untracked performance.
- https://git-scm.com/docs/git-submodule — init/registration behavior, actual-vs-recorded status semantics, recursive boundary.
- https://git-scm.com/docs/gitmodules — required path/URL, optional branch, relative URL and `.` branch semantics.
- https://git-scm.com/docs/git-config — config scopes/precedence, `--null` key/value delimiters, subsection-name syntax, object-format configuration.
- https://git-scm.com/docs/git-ls-files — index mode/OID/stage data, unmerged stages, `--stage -z`, full-name behavior.
- https://git-scm.com/docs/git-rev-parse — repository/object-format probes and full/storage-format OIDs.

Key reproducible commands:

```text
smart-search doctor --format json
smart-search deep "Research robust read-only Git linked-worktree and direct-submodule machine-readable contracts using official git-scm.com documentation, including unusual paths, worktree states, porcelain status, submodule gitlinks/config/runtime state, concurrency, optional locks, and SHA-256 object IDs" --budget deep --format json
smart-search fetch "https://git-scm.com/docs/git-worktree" --format markdown --output <evidence>/git-worktree.md
smart-search fetch "https://git-scm.com/docs/git-status" --format markdown --output <evidence>/git-status.md
smart-search fetch "https://git-scm.com/docs/git-submodule" --format markdown --output <evidence>/git-submodule.md
smart-search fetch "https://git-scm.com/docs/gitmodules" --format markdown --output <evidence>/gitmodules.md
smart-search fetch "https://git-scm.com/docs/git-config" --format markdown --output <evidence>/git-config.md
smart-search fetch "https://git-scm.com/docs/git-ls-files" --format markdown --output <evidence>/git-ls-files.md
smart-search fetch "https://git-scm.com/docs/git-rev-parse" --format markdown --output <evidence>/git-rev-parse.md
```

## Related Specs

- `.trellis/spec/frontend/state-management.md` — Pinia owns bridge results; components call store actions; browser fallback and preload boundaries stay aligned.
- `.trellis/spec/frontend/type-safety.md` — shared preload/domain types live in `src/types.ts`; full Git OIDs already matter for identity and graph relationships.
- `.trellis/spec/frontend/quality-guidelines.md` — type-check/build baseline and compact floating UI expectations.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — exact formats and error ownership must be defined at every boundary.

## Caveats / Planning Intent Still Required

1. **Untracked-count granularity requires product intent.** Recommended default is `--untracked-files=normal`, because the approved wording says "lightweight" and Git documents the cost of enumerating all untracked files. This means an untracked directory counts as one status entry. If the UI must promise a physical-file count matching fully expanded source control, use `--untracked-files=all` and accept higher latency/timeout frequency. The UI label and fixture expectations must state which semantic is chosen.
2. Trellis task resolution currently reports no active task even though this request supplied `.trellis/tasks/07-19-git-workspace-features` explicitly. The requested directory exists and was used; no task metadata was modified.
3. `design.md` and `implement.md` do not currently exist in the task directory. This research is intended to feed those later planning artifacts; neither was created or changed here.
