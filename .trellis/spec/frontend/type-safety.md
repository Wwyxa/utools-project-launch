# Type Safety

> Type safety patterns in this project.

---

## Overview

The project uses TypeScript throughout the Vue app. `tsconfig.json` is configured for modern ESM bundling, `noEmit`, and Vue SFC support.

Shared domain types live in `src/types.ts`; Vue ambient types live in `src/env.d.ts`. Components import the shared types rather than redefining the same shapes locally.

---

## Type Organization

Current organization:

- `src/types.ts` owns the domain model for projects, scripts, logs, staged files, and todos
- `src/env.d.ts` declares the Vue SFC module shim
- `src/global.d.ts` declares `window.projectBridge` for the uTools preload boundary
- component-local literal unions are acceptable for very small UI-only states when they do not belong in the shared model

Example shared types already in use:

```ts
export interface Project {
  id: string;
  name: string;
  path: string;
  type: string;
  status: ProjectStatus;
  scripts: ProjectScript[];
  env: Record<string, string>;
}
```

---

## Validation

There is no runtime validation library configured today.

Validate external or user-entered data at the boundary before it enters the store. If a schema library is added later, document the exact validation path here instead of scattering ad hoc checks across components.

---

## Common Patterns

Common patterns already in the codebase:

- `defineProps<{ project: Project }>()` for typed component props
- `defineEmits<{ (e: 'select', id: string): void }>()` for event contracts
- `Record<string, T>` for project-scoped maps such as logs, todos, and memo content
- enums for stable status values such as `ProjectStatus`

Use inferred literals and shared interfaces first. Reach for type guards only when external data needs to be narrowed.

---

## Forbidden Patterns

- New `any` types in application code
- Broad `as any` casts when a narrower union would work
- Duplicating the same domain shape in multiple files
- Widening a status field to `string` when the project already has a closed enum or union
- Relying on runtime assumptions without a type or validation check
- Leaving global `window` APIs untyped when adding preload integrations
- Adding or changing persisted `Project` metadata without updating the store persistence path, browser bridge fallback, and uTools preload `toStoredProject` shape together

Preload bridge contracts should be represented in `src/types.ts` and consumed through `src/lib/projectBridge.ts`, not duplicated in components.

### Convention: Project Launch Service Bridge Contract

- `src/types.ts` owns the complete service bridge contract: `ProjectLaunchServicePreferences`, status/state unions, runs, events, automation configuration/executions, and `ProjectBridge` service methods. Components must not redefine a partial status or inspect raw HTTP payloads.
- `ProjectLaunchServiceStatus.state` remains the closed union `not-installed | installed | starting | healthy | unavailable | incompatible`. Use the status plus `running` flag for ownership decisions; do not infer health from an executable path or a PID alone.
- `ProjectLaunchServiceAutomationConfig` carries project environments only while the Store sends the complete normalized configuration to `syncProjectLaunchServiceAutomation`. `ProjectLaunchServiceAutomationState` is the outgoing snapshot shape used by `ProjectLaunchServiceStatus.automation`; it exposes only `revision` and optional `executions`, never the configuration or an environment map.
- `src/lib/projectBridge.ts` implements every service method in the browser fallback with a typed unavailable result. It must never report a healthy/running service, accepted synchronization, or service-owned process that does not exist.
- `public/preload.js` is the runtime validation boundary for disk discovery, install assets, service HTTP responses, protocol compatibility, and untrusted external values. It must project raw service automation state into the outgoing snapshot fields instead of assigning a raw response object to `ProjectLaunchServiceStatus`. Store and components consume only normalized shared types.
- Adding a field or method requires one coordinated change to `src/types.ts`, `src/lib/projectBridge.ts`, `public/preload.js`, and every Store consumer. Test default status, unavailable/incompatible status, manual recheck, and synchronization result shapes.

**Related**: [Project Launch Service](../backend/project-launch-service.md) and [Encrypted Automation State](../backend/error-handling.md#scenario-project-launch-service-encrypted-automation-state).

### Convention: Typed Git read results

- Use `ProjectGitReadResult<T>` at the preload-to-Store boundary whenever an empty value is valid domain data.
- `ok: true` means the payload is complete enough to merge. `ok: false` carries a structured failure code and
  operation; its optional compatibility value must not be treated as a successful snapshot.
- Runtime snapshot guards must require a real `commits` array and a non-negative safe-integer `commitCount` before a
  value can become the Store's complete history snapshot.
- `git-unavailable`, `command-failed`, and `invalid-output` preserve the previous complete snapshot. The authoritative
  `not-a-repository` state clears that repository's snapshot and latest-commit metadata.
- Components read failures from Store state. They do not inspect Git stderr text or infer failure kinds from empty
  arrays.

## Scenario: Import/Export JSON Boundary

## Scenario: Git Commit Metadata and Tooltip Boundary

### 1. Scope / Trigger

- Trigger: Git commit metadata crosses the uTools preload boundary, Pinia/project state, and Vue rendering. Full parent hashes are needed for graph edges, and full commit bodies are needed for markdown tooltip rendering.

### 2. Signatures

- `ProjectGitCommitSummary = { hash: string; message: string; body?: string; author: string; date: string; graph?: string; parents?: string[]; refs?: string }`, where `hash` and every `parents` entry use the repository's full object-id format.
- `ProjectGitCommitShortStats = { readonly files: number; readonly additions: number; readonly deletions: number }`; `ProjectGitCommitSummary.shortStats?` carries this immutable summary with the history page.
- `ProjectGitBaseSummary = { remote: string; branch: string; ref: string }`; `ProjectGitSnapshot.base?` and `ProjectGitStatusSnapshot.base?` carry a resolved comparison/base remote or `null`.
- Preload git read path should populate `message` with the compact subject line and `body` with the full commit message body when available.
- Preload history reads use one `git log --shortstat` invocation per page. A dedicated separator after `%B` isolates the multiline body from the following short-stat text before parsing it.
- Tooltip state should keep the whole commit object plus cursor coordinates, e.g. `{ commit: ProjectGitCommitSummary; x: number; y: number }`, because the tooltip header needs `author`, `date`, and `refs` while the body parser needs both `message` and `body`.
- UI parser helpers may stay local to `GitTab.vue`, but their output contract is structured: `title: string` for the header and `body: string` for markdown rendering.

### 3. Contracts

- `message` is the one-line subject used in dense Git history rows and as the default tooltip title.
- `body` is optional and contains the full commit text used by markdown tooltips after de-duplicating repeated subject/list content.
- The preload boundary must keep `hash` as the full `%H` value and every `parents` entry as the full `%P` value. Git graph edges compare these values directly, while dense rows render a shortened hash without truncating the copied or bridged value.
- The git log parser must preserve newlines in `body`; do not rely on `%s` alone when tooltip markdown needs lists or paragraphs.
- Use robust field/record separators for git output parsing when reading multiline bodies. Tab-separated parsing is not enough once `%B` is included.
- A non-empty short-stat section that cannot be parsed is `undefined`, not a zero summary. Only an actually empty section represents `{ files: 0, additions: 0, deletions: 0 }`.
- Avoid `git log --graph` in the backend/preload data fetch when parsing multiline bodies. ASCII graph prefixes can pollute markdown lines and break list rendering. The frontend already draws its own graph from `parents`.
- A tooltip with usable `shortStats` renders its file count and line totals immediately and must not call `readGitCommitFiles` for that summary. Legacy, missing, or invalid stats use the existing file-detail fallback. Expanding a commit's file list remains an independent full-detail read.
- The status snapshot resolves `base` once at the preload boundary. It prefers `branch.<branch>.vscode-merge-base`, then a single branch-creation reflog source or that source branch's upstream, then configured remotes' symbolic `HEAD` refs. Each candidate must resolve to a known remote-tracking commit; the current upstream is not duplicated as a base.
- Bridge empty snapshots, store normalization, and status-only snapshot merges preserve `base: null` rather than leaving consumers to infer a hard-coded `master` or `main` branch.
- Tooltip rendering should normalize common Git message shapes before rendering:
  - if `body` is missing or equals `message`, render only the title and omit the body panel;
  - if the first `body` line equals, prefixes, or extends `message`, drop that first body line before rendering markdown;
  - if the first content line is an unordered markdown list item and `message` also starts as a list item, render the whole content as markdown without a separate title;
  - if `message` is `Title - item A - item B` and markdown body repeats `- item A` / `- item B`, title is `Title` and body is the list;
  - if `message` chains conventional commit segments (`fix: A fix: B change: C`) and body repeats trailing segments line-by-line, keep only the leading segment(s) in the title and render the repeated trailing segments in the body.

### 4. Validation & Error Matrix

- Missing `body` -> tooltip falls back to `message`.
- Empty commit output -> return an empty `commits` array.
- Malformed commit record without a hash -> skip that record.
- Full child hash paired with abbreviated parent hashes -> invalid graph input; use `%H` with `%P` so every visible parent can match a commit `hash` exactly.
- Multiline body with markdown lists -> preserve newline structure and render via `renderMarkdown` in the UI.
- Valid short-stat output -> expose non-negative safe-integer counts that equal the full file-detail totals for the same commit.
- Non-empty unparsable short-stat output or invalid numeric counts -> leave `shortStats` absent and use the legacy tooltip detail path; never display fabricated zero totals.
- Empty short-stat section -> expose a zero summary without a tooltip file-detail request.
- Detached HEAD, missing branch, an unresolved candidate, or a candidate equal to the upstream -> expose `base: null`.
- A configured `vscode-merge-base` pointing at an unavailable remote ref -> ignore it and continue through the documented fallback order.
- Body repeats the subject line -> remove the duplicate line so tooltip title/body do not show the same sentence twice.
- Message is itself a markdown list -> do not coerce the first list item into a plain bold title.
- Chained conventional commits with repeated body lines -> trim only exact repeated trailing segments; keep the body lines available for markdown rendering.

### 5. Good/Base/Bad Cases

- Good: row displays `message`, tooltip title/body split removes duplicated subject text and renders `body` with markdown bullets preserved.
- Good: each non-root commit's visible parent entry exactly equals the corresponding full commit `hash`, so the graph can draw the edge.
- Good: a loaded commit has valid `shortStats`; after the normal hover delay its tooltip immediately renders totals while only the optional avatar enhancement may still load.
- Good: a feature branch created from `remote/master` resolves `base.ref === "remote/master"`, so the renderer can assign the comparison lane without guessing a default branch.
- Base: commit has only a subject; both row and tooltip use `message`.
- Base: a repository with only an upstream or no resolvable remote base carries `base: null` and keeps ordinary lane coloring.
- Base: an older bridge result lacks `shortStats`; the tooltip keeps its existing delayed full-detail fallback.
- Base: a root commit has an empty `parents` array.
- Bad: combining full `%H` child hashes with abbreviated `%p` parent hashes; records parse, but graph edges silently disappear.
- Bad: using `--pretty=format:%h\t...\t%s` and expecting tooltip markdown lists to exist.
- Bad: treating an unknown short-stat parse as zero or running `readGitCommitFiles` for every visible tooltip despite a valid preloaded summary.
- Bad: deriving a base ref in a component from a literal `origin/main`, which breaks non-origin repositories and makes graph/ref colors drift from the snapshot.
- Bad: always rendering `message` as a plain tooltip title when `message` starts with `- `; this breaks list-style commit messages.
- Bad: always rendering the full subject as title when the body repeats trailing `fix:` / `change:` segments; this creates a long duplicate title and repeated body.

### 6. Tests Required

- `npm run build` after changing commit metadata parsing or tooltip rendering.
- `npm run validate:git-commits` must create two commits through a real temporary repository, assert `latestCommit.parents[0] === rootCommit.hash`, an empty root `parents` array, and that `latestCommit.shortStats` equals `readGitCommitFiles(latestCommit.hash)` totals.
- `npx vitest run src/lib/gitCommitTooltipSession.test.ts` must prove valid preloaded stats skip the file-detail loader while the avatar loader remains optional and cacheable.
- `npm run benchmark:git-interactions -- --report after` must assert cold/A-B-A/remount tooltip models issue no `readGitCommitFiles` bridge call when commits carry usable short stats.
- `node --check public/preload.js`, `npx vitest run src/lib/gitCommitGraph.test.ts src/lib/gitCommitRefs.test.ts`, and `npx vitest run src/lib/projectBridge.workspace.test.ts` must cover base propagation, invalid-base fallback, and graph/ref color selection.
- Manual smoke test with commits containing a subject plus markdown body list items (`- item`).
- Manual smoke test with subject-only commits to verify tooltip fallback remains readable.
- Manual smoke test with list-only commit messages where the first line starts with `- ` and should render as markdown.
- Manual smoke test with `Title - item A - item B` plus matching bullet body to verify title trimming.
- Manual smoke test with chained conventional commit subjects (`fix: A fix: B change: C`) plus repeated body lines to verify trailing segment trimming.
- Verify tooltip width fits short content and only caps long content; no fixed/minimum width should create empty right-side space.

### 7. Wrong vs Correct

#### Wrong

```js
`--pretty=format:%H${fieldSep}%p${fieldSep}%an${fieldSep}%ad${fieldSep}%D${fieldSep}%s${fieldSep}%B${recordSep}`;
```

This mixes full child hashes with abbreviated parent hashes, so parsed records cannot be connected into graph edges.

#### Correct

```js
`--pretty=format:%H${fieldSep}%P${fieldSep}%an${fieldSep}%ad${fieldSep}%D${fieldSep}%s${fieldSep}%B${recordSep}`;
```

Keep child and parent hashes in the same full-hash format, and keep the subject and full body as separate fields so the graph and rich tooltips each receive the right data.

#### Wrong

```ts
const title = commit.message;
const body = commit.body || "";
```

This blindly duplicates commit text for bodies that include the subject, markdown-list-only commits, and chained conventional commit subjects.

#### Correct

```ts
const title = commitTooltipTitle(commit);
const body = commitTooltipBody(commit);
```

Keep tooltip parsing explicit and format-aware so the dense row can show the raw subject while the tooltip shows a readable title plus markdown body.

#### Wrong

```ts
const files = await store.readGitCommitFiles(projectId, commit.hash, target);
return summarizeFiles(files);
```

This repeats Git work for every cold tooltip even though the history page already has an immutable summary.

#### Correct

```ts
if (hasUsableGitCommitShortStats(commit.shortStats)) {
  return commit.shortStats;
}

const files = await store.readGitCommitFiles(projectId, commit.hash, target);
return summarizeFiles(files);
```

Use the preloaded summary first and retain the detail reader only as a compatibility fallback.

#### Wrong

```ts
const base = { remote: "origin", branch: "main", ref: "origin/main" };
```

This guesses repository topology in the renderer and cannot distinguish an upstream from an independent comparison base.

#### Correct

```ts
const base = await readGitBranchBaseAsync(repositoryPath, symbolicBranch, remotes, upstream);
return { ...statusSnapshot, base };
```

Resolve and validate the base where Git configuration and refs are available, then carry the typed nullable value through the existing snapshot contract.

## Scenario: Git Commit Ref And Mutation Boundary

### 1. Scope / Trigger

- Trigger: commit decorations and branch/tag mutations cross `public/preload.js`, `ProjectBridge`, Pinia, and `GitTab.vue`.
- Trigger: local branches, remote-tracking refs, tags, HEAD state, dirty-worktree blockers, and unmerged-delete blockers change UI capabilities and data-loss confirmations.

### 2. Signatures

- `ProjectGitCommitRefKind = "head" | "local" | "remote" | "tag"`.
- `ProjectGitCommitRef = { kind: ProjectGitCommitRefKind; name: string; head?: boolean }`.
- `ProjectGitCommitSummary.refNames?: ProjectGitCommitRef[]`; legacy `refs?: string` remains a compatibility fallback.
- `ProjectGitActionBlockReason = "dirty-worktree" | "unmerged-branch"`.
- `ProjectGitActionResult.blockReason?: ProjectGitActionBlockReason`.
- Bridge/store actions: `createGitBranch(..., { checkout?, force? })`, `createGitTag(..., { annotated?, message? })`, `renameGitBranch(...)`, `deleteGitBranch(..., { force? })`, `checkoutGitRemoteBranch(..., { force? })`, and `checkoutGitCommit(..., { detach?, force?, preferredBranch? })`.
- Tag-only bridge/store actions: `readGitTagInfo(projectPath, tagName): Promise<ProjectGitTagInfo | null>` and `pushGitTag(projectPath, tagName, remoteName?): Promise<ProjectGitActionResult>`. `pushGitRemote(..., { tagNames })` remains the separate HEAD-plus-selected-tags operation.

### 3. Contracts

- Real preload commit reads must populate structured refs from full ref namespaces. GitTab prefers `refNames`; only legacy/browser fixtures may fall back to parsing `refs`.
- Build one ref map with `git for-each-ref`; do not split `%D` by comma as the authoritative protocol. Peel annotated tags to their target commit and preserve Git-valid comma names.
- `kind` decides UI capabilities. Never infer local/remote/tag behavior from color, display text, or a hard-coded remote prefix when structured data exists.
- Preload validates names with `git check-ref-format`, validates `<hash>^{commit}`, and treats same names in `refs/heads` and `refs/tags` as valid independent refs.
- `readGitTagInfo` returns `null` for unavailable, missing, invalid, or non-commit tags. Lightweight tags have an empty message; annotated commit tags expose a peeled target, tag object hash, normalized annotation, and optional tagger. `pushGitTag` sends only `refs/tags/<name>` to the resolved remote, never a broad tag push; the browser fallback returns `null`/unavailable and the Store refreshes refs around the write.
- Dirty atomic create-and-switch, tracking checkout, branch switch, and detached checkout return `blockReason: "dirty-worktree"` before mutation. UI may pass `force: true` only after the app-rendered destructive confirmation.
- Safe delete returns `blockReason: "unmerged-branch"` without deleting. Force delete is a separate confirmed call; current branch deletion is rejected in UI and preload.
- `detach: true` must bypass matching local branch tips and always enter detached HEAD.
- Every ref mutation routes through the store with full refresh and `refs: true`, so stale repository snapshots cannot overwrite the result.

### 4. Validation & Error Matrix

- Git-valid local/tag name containing comma -> one structured ref with the complete name.
- Annotated tag -> tag decoration maps to the peeled commit, not the tag object id.
- Invalid or same-namespace duplicate name -> failed action with a user-facing Git validation message; no ref changes.
- Branch and tag share the same short name -> both succeed and remain distinguishable by `kind`.
- Dirty create-and-switch without force -> `dirty-worktree`; branch is not created. Confirmed force -> one atomic create-and-switch action.
- Safe delete of an unmerged branch -> `unmerged-branch`; branch remains. Confirmed force -> delete attempt uses `-D`.
- Delete current or linked-worktree branch -> Git rejection remains authoritative; no hidden retry.
- Remote-tracking ref -> tracking checkout or detached checkout only; local rename/delete APIs are not called.
- Browser fallback -> same method signatures return typed unavailable results instead of throwing.

### 5. Good/Base/Bad Cases

- Good: `feature/a,b` arrives as one local ref, opens a local submenu, copies intact, and survives a full ref refresh.
- Good: an unmerged delete attempt opens a second danger confirmation only after the typed blocker result.
- Base: an older browser fixture has only `refs`; GitTab uses the compatibility parser and existing local branch snapshot.
- Bad: `commit.refs.split(",")` controls real local/remote actions; a valid comma name becomes two fake refs.
- Bad: `result.message.includes("未提交变更")` selects a destructive flow; localization or changed wording silently bypasses the intended blocker.
- Bad: a remote label is passed to local `git branch -m` or `git branch -d`.

### 6. Tests Required

- `npm run validate:git-commits` must use a real temporary repository and assert comma refs, peeled annotated tags, namespace coexistence, atomic create/switch, typed dirty and unmerged blockers, safe/force delete, tracking checkout, current-branch restrictions, explicit detached checkout, tag-info null fallback, and standalone lightweight/annotated tag publication that preserves the annotated tag object and message.
- `npx vitest run src/lib/projectBridge.workspace.test.ts` must assert exact repository target routing, stale-target rejection, and full ref refresh for the new store actions.
- Run `node --check public/preload.js`, `npm run type-check`, and `npm run build` after changing these contracts.
- Browser/uTools smoke must check local/remote submenu differences, confirmations, copied-name feedback, viewport clamping, and snapshot refresh.

### 7. Wrong vs Correct

#### Wrong

```ts
const refs = commit.refs?.split(",") || [];
if (!result.ok && result.message.includes("未提交变更")) requestForce();
```

This treats ambiguous presentation text and localized error text as domain protocols.

#### Correct

```ts
const refs = commit.refNames ?? legacyRefPresentations(commit.refs);
if (!result.ok && result.blockReason === "dirty-worktree") requestForce();
```

Keep ref kind and risk reasons structured across every layer; use text only for display.

## Scenario: Git Commit Tooltip Detail Enrichment Boundary

### 1. Scope / Trigger

- Trigger: a delayed Git history tooltip needs local changed-file totals and an optional GitHub author avatar without exposing author email or making the tooltip depend on remote availability.
- The path crosses `GitTab.vue`, the Pinia store, `ProjectBridge`, and `public/preload.js`.

### 2. Signatures

- `ProjectBridge.readGitCommitAuthorAvatar(projectPath: string, commitHash: string): Promise<string | null>`.
- Store proxy: `readGitCommitAuthorAvatar(projectId: string, commitHash: string): Promise<string | null>`.
- `GitCommitTooltipSessionDetails` is keyed by repository context plus full commit hash and contains local files, file-summary loading/unavailable state, avatar loading state, and nullable avatar URL.
- The component-owned visible state is one `CommitTooltipDetailsState | null` with its active `hash`, request/context generations, and display values; it is not a growing record of every hovered hash.

### 3. Contracts

- Start both detail reads only after the existing tooltip hover delay has made the tooltip visible. File totals use `readGitCommitFiles`; avatar loading must never delay metadata, title, markdown body, or summary loading UI.
- Preload selects a GitHub remote in this order: GitHub upstream, GitHub `origin`, then another GitHub remote. It supports HTTPS, SCP-style SSH, and `ssh://` GitHub URLs.
- The GitHub commit endpoint receives only remote owner, repository, and the full commit hash. Return only an HTTPS `author.avatar_url` or `null`.
- Cache in-flight and settled avatar results, including `null`, by normalized repository and full commit hash in a bounded in-memory preload cache.
- Keep the renderer tooltip session bounded by `GIT_COMMIT_TOOLTIP_SESSION_MAX_HASHES`. Switching from A to B replaces the active reactive detail state; returning to A consumes its session promise without retaining B's UI state in the component.
- Do not use Gravatar, author email, GitHub tokens, persistent cache storage, provider settings, raw remote URLs, or raw HTTP error messages in renderer state.
- The renderer always has a deterministic initials badge. It replaces a missing, loading, rejected, or image-error avatar; stale async detail results must be ignored after project/repository context changes.

### 4. Validation & Error Matrix

- Non-GitHub or malformed remote -> return `null` without an HTTP request.
- Public commit with a GitHub author -> return a sanitized HTTPS avatar URL.
- Missing GitHub association, private repository, rate limit, HTTP failure, timeout, or invalid avatar URL -> return and cache `null`; tooltip remains usable.
- Browser fallback -> return `null` without network work.
- Local file read pending -> show a neutral loading summary; rejected/unavailable data -> show a neutral unavailable summary, never synthetic zero totals.
- Avatar image load failure -> remove the URL from local tooltip state and show initials.
- An A request resolving after a visible switch to B, a repository replacement, or an unmount -> ignore the stale result by active hash, request generation, and context generation.

### 5. Good/Base/Bad Cases

- Good: a GitHub-backed public commit opens after the normal delay, immediately shows initials and metadata, then replaces initials with a cached avatar while local additions/deletions load independently.
- Good: scanning 240 history rows replaces one visible tooltip state at a time while the bounded renderer session reuses eligible detail promises.
- Base: an offline, private, or non-GitHub repository shows initials and an available local summary without a visible network error.
- Bad: dispatching avatar or file reads on `mouseenter` before the delay, which creates unnecessary work while scanning dense rows.
- Bad: copying a growing reactive hash-to-details record on every hover result, which makes a tooltip update reconcile an increasingly large history view.
- Bad: sending `authorEmail` to Gravatar or exposing a GitHub URL/error in tooltip copy.

### 6. Tests Required

- `node --check public/preload.js` after changing GitHub remote parsing, cache behavior, or request timeout handling.
- `npm run lint`, `npm run type-check`, and `npm run build` after changing the bridge, store proxy, or tooltip template.
- `npx vitest run src/lib/gitCommitTooltipSession.test.ts` must cover capacity, A-B-A session reuse, and stale-result isolation; manual smoke should include repeated tooltip switching after loading 160 and 240 commits.
- Manual uTools smoke test: hover a GitHub public commit, a non-GitHub/offline commit, and leave before the hover delay; verify delayed loading, initials fallback, summary counts, Escape cleanup, and no stale result after switching projects.

### 7. Wrong vs Correct

#### Wrong

```ts
void store.readGitCommitAuthorAvatar(projectId, commit.hash);
```

Starting this on every row entry bypasses the tooltip's scan-friendly delay and can create unnecessary requests.

#### Correct

```ts
commitTooltipOpenTimer = window.setTimeout(() => {
  commitTooltip.value = pendingCommitTooltip.value;
  if (commitTooltip.value) loadCommitTooltipDetails(commitTooltip.value.commit);
}, 450);
```

Keep detail loading behind the visible-tooltip transition so cacheable enhancements remain advisory.

#### Wrong

```ts
const commitTooltipDetails = ref<Record<string, CommitTooltipDetailsState>>({});
```

This retains and copies reactive UI state for every hovered commit even though the renderer session already owns reusable promise caching.

#### Correct

```ts
const commitTooltipDetails = ref<CommitTooltipDetailsState | null>(null);
```

Keep only the visible tooltip reactive and use the bounded session for cross-hover reuse.

## Scenario: Git Bulk File Action Boundary

### 1. Scope / Trigger

- Trigger: Git file write actions cross `GitTab.vue`, Pinia store actions, `ProjectBridge`, and the uTools preload Git implementation.
- Trigger: bulk actions such as stage-all / unstage-all / discard-all must operate on the complete live Git status, not only the file paths currently rendered in the UI.
- This scenario requires code-spec depth because it changes a cross-layer bridge signature and user-visible write behavior.

### 2. Signatures

- `ProjectGitBulkFileActionOptions = { all?: boolean }`
- `ProjectBridge.stageGitFiles(projectPath: string, relativePaths: string[], options?: ProjectGitBulkFileActionOptions): Promise<ProjectGitActionResult>`
- `ProjectBridge.unstageGitFiles(projectPath: string, relativePaths: string[], options?: ProjectGitBulkFileActionOptions): Promise<ProjectGitActionResult>`
- `ProjectBridge.discardGitFiles(projectPath: string, relativePaths: string[], options?: ProjectGitBulkFileActionOptions): Promise<ProjectGitActionResult>`
- Store actions mirror the bridge signature with `projectId` instead of `projectPath`.
- Preload implementations accept the same third `options` argument and return `ProjectGitActionResult` with `ok`, `message`, optional `count`, and optional `paths`.

### 3. Contracts

- `relativePaths` is the exact set selected by the UI when `options.all` is missing or false.
- `options.all === true` means preload must ignore UI pagination/stale rendered file limits and collect the complete current Git status directly from `git status --porcelain=v1 -z`.
- Stage-all filters live status entries to files with unstaged work, including untracked files.
- Unstage-all filters live status entries to files with staged work.
- Discard-all filters live status entries to all changed paths, then applies the existing discard behavior per path.
- Components should still pass the visible paths for context/count fallback, but preload owns all-mode completeness.
- Git write actions must show a loading toast before the bridge call and keep success/warning/error feedback visible after the status refresh starts.

### 4. Validation & Error Matrix

- Missing Git repository -> return `{ ok: false, message: "未检测到 Git 仓库。" }`.
- `options.all !== true` and `relativePaths` is empty -> return a zero-count failure message for that operation.
- `options.all === true` and no matching live status entries -> return a zero-count failure message for that operation.
- Git command failure -> return `{ ok: false, count, paths, message }` using the first Git error text.
- Discard failure after partial success -> return the underlying failure with `count`/`paths` for completed paths and a message noting the partial count.
- Status refresh after a successful write -> bump the project Git mutation version and refresh status so UI rows reflect the new staged/unstaged state.

### 5. Good/Base/Bad Cases

- Good: 110 unstaged files are rendered with only 80 visible from stale UI state, stage-all passes `{ all: true }`, preload stages all 110 live status entries, and toast reports `已暂存 110 个文件。`.
- Good: stage-selected passes explicit selected paths without `{ all: true }`, so only selected paths are touched.
- Base: 3 modified files are visible; stage-all stages those 3 and refreshes the Git status snapshot.
- Bad: deriving stage-all exclusively from `props.project.git.files` or another rendered list; stale or limited UI state can silently skip files.
- Bad: clearing the Git toast immediately after stage/unstage success; the following status refresh can hide the user-visible operation result.

### 6. Tests Required

- `npm run lint` to verify `src/types.ts`, store actions, fallback bridge, and component calls agree on the bulk action options signature.
- `npm run build` to verify Vue templates and bridge consumers compile.
- `node --check public/preload.js` after changing preload Git action code.
- Manual smoke test with more than 80 changed files: click stage-all and assert the toast count equals the full live Git status count.
- Manual smoke test for unstage-all after stage-all: assert all staged files return to unstaged and the toast count is complete.
- Manual smoke test for selected/single-file operations: assert they do not unexpectedly expand to all files.

### 7. Wrong vs Correct

#### Wrong

```ts
const paths = stageableFiles.value.map((file) => file.path);
await store.stageGitFiles(projectId, paths);
setGitActionResult("idle", "");
```

This treats the rendered file list as complete and hides the operation result before the user can see it.

#### Correct

```ts
const paths = stageableFiles.value.map((file) => file.path);
const result = await store.stageGitFiles(projectId, paths, { all: true });
setGitActionResult(result.ok ? "success" : "error", result.message);
```

Keep the UI-triggered all action explicit, let preload collect live Git status, and preserve the operation result toast through the follow-up refresh.

## Scenario: Git Remote Operations Boundary

### 1. Scope / Trigger

- Trigger: Git remote status and write operations cross `GitTab.vue`, Pinia store actions, `ProjectBridge`, and `public/preload.js` Git execution.
- Trigger: remote commands may hit network and credentials, so they have stricter process-execution requirements than local-only Git actions.

### 2. Signatures

- `ProjectGitRemoteSummary = { name: string; fetchUrl: string; pushUrl: string }`.
- `ProjectGitRemoteBranchSummary = { remote: string; branch: string; ref: string }`; `ref` is the local remote-tracking ref presentation such as `origin/feature/login`.
- `ProjectGitUpstreamSummary = { remote: string; branch: string; ref: string; ahead: number; behind: number }`.
- `ProjectGitSnapshot` and `ProjectGitStatusSnapshot` include `remotes: ProjectGitRemoteSummary[]`, `remoteBranches: ProjectGitRemoteBranchSummary[]`, and `upstream: ProjectGitUpstreamSummary | null`.
- Bridge methods: `fetchGitRemote(projectPath)`, `fetchGitRemoteByName(projectPath, remoteName)`, `pullGitRemote(projectPath)`, `pushGitRemote(projectPath, { tagNames? })`, `addGitRemote(projectPath, remoteName, remoteUrl)`, `setGitRemoteUrl(projectPath, remoteName, remoteUrl)`, `removeGitRemote(projectPath, remoteName)`, and `deleteGitRemoteBranch(projectPath, remoteName, branchName)`.
- Store actions mirror the bridge methods with `projectId` replacing `projectPath` and preserve repository-target authorization.
- `ProjectGitRemoteProgressEvent = { type: "git-remote-progress"; repositoryPath: string; message: string; phase: "start" | "output" | "complete" }` is the preload-to-renderer progress payload.
- `runGitRemoteCommandResult(startPath, args)` returns `{ status: number; stdout: string; stderr: string }` while emitting `ProjectGitRemoteProgressEvent` values for its process lifecycle.
- Presentation API: `showActionProgress({ operationId, state, message, entries })` and `completeActionProgress(state, message, operationId)`; `useGlobalActionStatus(store)` returns their generic display state to the application shell.

### 3. Contracts

- Remote status belongs in the existing Git snapshot contract, not in duplicated component-local remote state.
- `remoteBranches` is read from locally fetched `refs/remotes/<remote>/<branch>` refs. It is an explicitly labeled local snapshot of fetched tracking refs, not a live server-side branch listing; symbolic `<remote>/HEAD` is excluded.
- Browser fallback snapshots must explicitly return `remotes: []`, `remoteBranches: []`, and `upstream: null` so consumers can distinguish "no remote" from a missing field.
- Fetch, pull, and push operate only on the current branch upstream. Do not add force push, rebase pull, or `push -u` without a new requirement and updated spec.
- A normal push keeps its current branch-only refspec. When the current `HEAD` has structured tag refs, GitTab asks whether to include them; users can explicitly push the tags, push only the commit, or cancel. A confirmed tag push appends one exact `refs/tags/<name>:refs/tags/<name>` refspec per selected HEAD tag, so annotated and lightweight tags both work. Do not use `--tags`, which pushes unrelated local tags, or `--follow-tags`, which omits lightweight tags.
- Named remote refresh is a separate operation: validate the configured remote, run async `git fetch --prune <remote>`, and refresh the full snapshot even when Git reports failure because refs may have changed before a network or authentication error.
- Server-side branch deletion is separate from removing a remote configuration or deleting a local tracking ref: validate the branch as a `refs/heads` name, run async `git push --delete <remote> refs/heads/<branch>`, and preserve the local branch. The UI confirmation must state that local branches are not deleted; when the deleted ref is the current upstream, warn that a later push may recreate it.
- Fetch, pull, push, first publication, and remote branch deletion pass `--progress` so Git produces displayable progress even without an interactive terminal. Remote configuration writes keep their existing fixed argv forms.
- Preload validates remote names and URLs before invoking Git. Remote names are non-empty, cannot start with `-`, and only contain letters, digits, `.`, `_`, and `-`. Remote URLs are non-empty and cannot contain control characters.
- Named remote operations validate remote existence before invoking Git and reject the symbolic `HEAD` branch instead of treating it as a server branch.
- Remote network commands must use async process execution with a timeout and `GIT_TERMINAL_PROMPT=0` / `GCM_INTERACTIVE=Never`; do not run them through blocking `spawnSync` or commands that can wait forever for credentials. Long-running commands with progress use `spawn` in `runGitRemoteCommandResult`, not `execFile`, because progress must reach the renderer before process exit.
- A remote command emits exactly one `start` event before spawning, zero or more `output` events, and exactly one empty-message `complete` event after either `error` or `close`. The settlement guard prevents `error` followed by `close` from producing a duplicate completion.
- Progress parsing keeps independent stdout/stderr remainders, splits on both `\r` and `\n`, strips ANSI control sequences, ignores blank output, and flushes an unfinished remainder only when the command settles. This preserves partial chunks while treating carriage-return updates as replacement-style progress.
- `useGlobalActionStatus(store)` prioritizes explicit action feedback over Store-derived Git loading, owns remote listener cleanup, and supplies `App.vue` with generic state only. `ActionStatusPopover` does not inspect Git events or operation ids.
- A `complete` event retains matching progress history until GitTab settles the final result with `completeActionProgress(...)` and the same operation id.
- Store remote mutations refresh the full Git snapshot after every result, including failures, because `pull` can fetch before merge failure and remote refs may still change.
- GitTab keeps remote controls in the existing top Git status panel; use a compact popover for remote list management instead of adding a separate full-width remote panel.

### 4. Validation & Error Matrix

- Missing Git repository -> return `{ ok: false, message: "未检测到 Git 仓库。" }`.
- Missing upstream for fetch/pull/push -> return a clear failure and keep buttons disabled in the UI.
- Current `HEAD` has no tag or the user selects commit-only -> retain the branch-only push behavior.
- Current `HEAD` has a tag and the user confirms -> the remote branch and each selected remote tag resolve to the current HEAD commit.
- Missing or unknown named remote -> return a clear failure before fetch or delete.
- Empty or invalid remote name -> return the validation message before running Git.
- Empty, invalid, or `HEAD` branch name -> return a validation message before push deletion.
- Empty or control-character remote URL -> return the validation message before running Git.
- Remote command timeout -> return a timeout message and refresh the Git snapshot afterward.
- Git authentication failure with prompts disabled -> return the Git error text to the UI without blocking the plugin.
- A stdout/stderr chunk split mid-line -> retain it until a `\r`/`\n` delimiter or terminal flush; do not emit a truncated progress entry.
- ANSI control sequences or blank chunks -> remove or ignore them before dispatching an `output` event.
- `error` followed by `close` -> resolve once and dispatch one `complete` event only.
- A `start` event -> replace the previous remote history and expand the shared progress popover. A `complete` event -> retain matching remote history with a confirmation message until the final action result settles it.
- A remote completion for a no-longer-active operation id -> do not replace the current global action status.
- Successful add/set-url/remove -> refresh the full Git snapshot so `remotes` and `upstream` are current.

### 5. Good/Base/Bad Cases

- Good: a repository with `origin/main` upstream shows one compact upstream chip, enables fetch/pull/push, and refreshes ahead/behind after each operation.
- Good: a repository with remotes but no current upstream shows the remote list but disables fetch/pull/push with a clear tooltip.
- Good: the popover groups fetched tracking refs by configured remote, offers per-remote prune refresh, and distinguishes checkout from server-side deletion.
- Good: a chunked fetch stream emits `Receiving objects: 50%` without ANSI bytes, replaces repeated transfer-stage entries, and leaves at most 20 historical stages visible.
- Good: confirming a remote operation starts the shared progress popover without requiring a second click; its final success, warning, or error remains visible after the process closes.
- Base: browser preview has no real Git bridge; snapshots still include empty remote fields and remote actions return unsupported messages.
- Bad: adding a separate component-local remote list that can drift from `ProjectGitSnapshot.remotes`.
- Bad: presenting `refs/remotes/*` as the server's complete live branch list, or using `git remote remove` when the user requested deletion of one server branch.
- Bad: buffering `git pull` through `execFile` and then attempting to reconstruct live progress after exit; the user sees no progress during a slow network operation.
- Bad: dispatching remote progress through `project-bridge-event` or keeping an additional GitTab-local status chip; consumers either miss the event or duplicate the global display.
- Bad: moving Git read flags or remote event parsing into `ActionStatusPopover` or `actionStatus.ts`; this makes a generic surface depend on one operation source.
- Bad: refreshing only on successful remote operations; failed `pull` may still update fetched refs and leave UI stale.

### 6. Tests Required

- `node --check public/preload.js` after changing preload remote command helpers.
- `npm run lint` after changing shared Git remote types, bridge methods, store actions, or GitTab calls.
- `npm run build` after changing GitTab remote UI or shared snapshot fields.
- `npm run validate:git-commits` must assert named remote fetch, `remoteBranches` population, `<remote>/HEAD` exclusion, server-side branch deletion, protected `HEAD` rejection, post-delete refresh, branch-only push omission of a local tag, and confirmed HEAD-tag push to a bare remote.
- `npx vitest run tests/projectBridge.workspace.test.ts` must assert target routing and stale-target rejection for named remote refresh and deletion.
- `npx vitest run tests/projectBridge.launchers.test.ts` must fake chunked stdout/stderr, assert `spawn` receives `--progress`, assert the exact `git-remote-progress` channel and start/output/complete phases, and cover ANSI plus `\r` normalization.
- `npx vitest run tests/globalActionStatus.test.ts` must cover loading persistence, matching progress completion with retained entries, and rejection of stale operation completions.
- Manual smoke test in browser preview: GitTab top panel shows no-remote state, disabled fetch/pull/push, and the add remote dialog opens.
- Manual smoke test in uTools with a real repository: fetch/pull/push open the shared progress popover immediately, update its current line progressively, retain the final result after completion, and refresh ahead/behind afterward.
- Manual smoke test in uTools with no upstream: remote operations remain disabled or return a clear warning.

### 7. Wrong vs Correct

#### Wrong

```js
execFile("git", ["-C", repositoryPath, "pull"], callback);
```

This buffers output until the remote command exits, so a slow fetch or pull cannot display live progress.

#### Correct

```js
const child = spawn("git", ["-C", repositoryPath, "fetch", "--progress", "--prune", remoteName], {
  env: { ...resolveGitExecutionEnvironment(), GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
child.stderr.on("data", (chunk) => consumeProgress("stderr", chunk));
child.on("close", () =>
  emitGitRemoteProgress({ type: "git-remote-progress", repositoryPath, message: "", phase: "complete" }),
);
```

Stream output with disabled interactive prompts and a timeout so remote Git failures return safely while the renderer receives progress before completion.

#### Wrong

```js
window.dispatchEvent(new CustomEvent("project-bridge-event", { detail: progress }));
```

This reuses the process-event channel, while the application listens for a dedicated remote-progress event.

#### Correct

```js
window.dispatchEvent(new CustomEvent("git-remote-progress", { detail: progress }));
```

Keep the event name and the `ProjectGitRemoteProgressEvent.type` value aligned so the application-level status owner receives every phase.

#### Wrong

```ts
const remoteBranches = remotes.map((remote) => remote.name);
```

This exposes only remote configuration names and cannot represent fetched branches or server-side branch actions.

#### Correct

```ts
const remoteBranches = snapshot.remoteBranches.filter((branch) => branch.remote === remote.name);
```

Keep remote configuration, fetched remote-tracking refs, and the current branch's upstream as separate typed concepts.

## Scenario: Git Repository Initialization And First Publish Boundary

### 1. Scope / Trigger

- Trigger: a project directory without a Git repository needs native initialization, or the selected repository's current local branch needs its first upstream publication.
- The path crosses `GitTab.vue`, Pinia, `ProjectBridge`, the browser fallback, and `public/preload.js`; initialization and publication have different authorization boundaries.

### 2. Signatures

- `ProjectBridge.initializeGitRepository(projectPath: string): Promise<ProjectGitActionResult>`.
- `ProjectBridge.publishGitBranch(projectPath: string, remoteName: string): Promise<ProjectGitActionResult>`.
- Store actions: `initializeGitRepository(projectId)` and `publishGitBranch(projectId, remoteName, target)`.
- A successful publish result includes the selected `remote` and current `branch`.

### 3. Contracts

- `GitTab.vue` owns the compact initialization command, remote selection, confirmation, and feedback. It never calls the bridge directly.
- Initialization is limited to the main project directory. The Store verifies the project path and rechecks it after the bridge call, reuses the project write lock, clears Git coordination/workspace/snapshot state only on success, then forces main workspace and snapshot reads. It does not call `runAuthorizedGitWrite`, because a missing Git workspace cannot authorize a repository target.
- Preload validates that the initialization path is a directory and runs `git -C <projectPath> init` without passing a branch name, so native Git configuration such as `init.defaultBranch` remains authoritative.
- Publish still uses `runAuthorizedGitWrite` with `{ refresh: "full", refs: true, refreshOnFailure: true }`. Preload validates a Git root, the normalized selected remote name, remote existence, a symbolic local `HEAD`, a commit at `HEAD`, and missing upstream before executing `git push --set-upstream <remote> HEAD:<branch>`.
- Publication uses the existing asynchronous remote helper with `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=Never`, and its timeout. No arbitrary refspec, alternate remote branch name, force flag, or generic Git command API is exposed.
- Browser fallback implements both methods with typed unavailable results.

### 4. Validation & Error Matrix

- Missing or non-directory project path -> initialization returns a clear failure without invoking Git.
- `git init` failure -> return the first Git error and retain current Git state.
- Missing Git root, invalid/missing remote, detached `HEAD`, no symbolic local branch, no commit at `HEAD`, or existing upstream -> publication returns a clear failure before push.
- Authentication failure or remote timeout -> return the existing remote error/timeout result and refresh the authorized snapshot.
- A project path changed while initialization is in flight -> discard the stale result rather than refreshing or reporting success for the replacement project.

### 5. Good/Base/Bad Cases

- Good: a non-Git main project initializes, clears stale no-repository state, and refreshes into a live Git snapshot.
- Good: a branch without upstream publishes to the selected `mirror` remote, tracks `mirror/<branch>`, and never writes to an unselected `origin` remote.
- Base: one configured remote opens one confirmation; multiple remotes require a selection from the existing compact remote menu.
- Bad: calling upstream-only `runGitRemoteResult` for first publication, because it rejects before `push --set-upstream` can run.
- Bad: exposing a free-form refspec or running remote Git through a blocking process call.

### 6. Tests Required

- `node --check public/preload.js` after changing initialization or publication execution.
- `npm run validate:git-commits` must initialize a real temporary directory, publish to a selected local bare remote, assert the upstream, assert the unselected remote has no branch, reject repeat publication, and reject a zero-commit local branch before adding upstream.
- `npx vitest run tests/projectBridge.workspace.test.ts` must assert main-path initialization, target-aware publication, refreshes, and stale-target rejection.
- Run `npm run type-check` and `npm run build` after changing bridge, Store, or GitTab contracts.
- Manual uTools smoke: one remote confirmation, multi-remote selection, detached/no-remote states, authentication failure, and a narrow top panel.

### 7. Wrong vs Correct

#### Wrong

```js
return runGitRemoteResult(projectPath, (upstream) => ["push", "--set-upstream", upstream.remote]);
```

This requires an upstream before the first publication and leaves the remote branch uncontrolled.

#### Correct

```js
const branch = await runGitAsync(repositoryPath, ["symbolic-ref", "--short", "-q", "HEAD"]);
const headCommit = String((await runGitAsync(repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"])) || "").trim();
if (!headCommit) return { ok: false, message: "当前分支尚无提交，无法发布。" };
return runGitRemoteCommandResult(repositoryPath, ["push", "--set-upstream", remoteName, `HEAD:${branch.trim()}`]);
```

Validate the repository state in preload, use the selected remote as an argv token, and keep the fixed refspec scoped to the current local branch.

## Scenario: External Application Launch Bridge Boundary

### 1. Scope / Trigger

- Trigger: opening a project or resolved Git worktree/subrepository with a selected external application crosses Vue components, Pinia, browser fallback, and uTools preload process spawning.
- Trigger: external application configuration must survive both plugin close/reopen and a complete uTools process restart without becoming project metadata.

### 2. Signatures

- `ProjectBridgeExternalApplicationLaunchPayload = { projectPath: string; application: ExternalApplication }`.
- `ProjectBridgeExternalApplicationLaunchResult = { launched: boolean; command: string; cwd: string; applicationId: string; kind: ExternalApplicationKind; message?: string }`.
- `ProjectBridge.openExternalApplication(payload): Promise<ProjectBridgeExternalApplicationLaunchResult>`.
- `ProjectBridge.loadExternalApplicationPreferences(): ExternalApplicationPreferences`.
- `ProjectBridge.saveExternalApplicationPreferences(preferences: ExternalApplicationPreferences): void`.
- Current storage key: `utools-project-launch.local-external-applications.v1`.

### 3. Contracts

- Shared application, preference, payload, and result contracts belong in `src/types.ts`; components must not define local copies.
- Store actions resolve an enabled default or explicit one-time application and pass a cloned application snapshot to the bridge.
- The uTools preload stores the normalized preference document in `window.utools.dbStorage`. Renderer `localStorage` does not reliably survive a complete uTools process restart and is only the browser fallback and a migration source for versions that previously stored this key there.
- uTools load priority is the current `dbStorage` key, the current renderer-local key, the legacy device-local editor key, then the legacy shared editor key. Loading from any renderer-local key persists the normalized result into `dbStorage` before returning it.
- An explicitly present current `dbStorage` value wins even when malformed; normalize it to complete defaults instead of falling through to stale renderer-local or legacy settings.
- Browser preview continues to read and write the same logical document as JSON in `localStorage` because `dbStorage` is unavailable there.
- `projectPath` is the full directory path of the current launch target. For Git worktrees and subrepositories it is the resolved repository path, not necessarily the main project root.
- Every application command template replaces both `{path}` and `{projectPath}` with the same resolved target directory.
- All applications use the existing tokenizer and detached executable/argv spawn without `shell: true`. On Windows, a VS Code/Cursor template whose executable token is exactly `code`/`cursor` maps that token to the existing `code.cmd`/`cursor.cmd` compatibility path; an explicitly configured executable or full path is preserved.
- Browser fallback keeps the same method and typed result shape while returning `launched: false`.

### 4. Validation & Error Matrix

- Missing id/name, disabled application, unknown kind, or mismatched built-in id/kind -> return `launched: false` before spawning.
- Missing target path or target is not a directory -> return `launched: false` with the resolved cwd and message.
- Empty or untokenizable application command -> return `launched: false` without shell fallback.
- Spawn failure -> return `launched: false` with the bridge error message.
- Current key exists only in renderer `localStorage` after upgrading -> normalize it, write the result to uTools `dbStorage`, and keep the selected default/custom applications.
- uTools restarts with empty renderer `localStorage` and retained `dbStorage` -> return the complete saved collection.
- Current `dbStorage` value is malformed -> return complete defaults without resurrecting legacy values.
- Host storage read/write throws -> keep normalized in-memory Store state usable and do not throw into components.

### 5. Good/Base/Bad Cases

- Good: a linked worktree menu resolves its repository directory, clones the selected custom application, and replaces both path aliases with that directory.
- Good: an edited VS Code template `code --reuse-window "{path}"` launches `code.cmd` with the extra argument on Windows and survives a preference round trip.
- Good: a custom application saved by an older localStorage-only build migrates into `dbStorage`, then remains configured after localStorage is cleared and the preload is recreated.
- Base: VS Code is the default and uses the existing built-in launch branch without user configuration.
- Base: browser preview persists the same normalized collection in `localStorage` without a uTools API.
- Bad: a component calls preload directly or describes `{path}` as always being the main project root.
- Bad: passing a custom command through a shell or adding product-specific custom adapters.
- Bad: writing uTools external application preferences only to `window.localStorage`; closing the plugin can appear to work while a complete uTools restart loses the configuration.

### 6. Tests Required

- Run `npx vitest run src/lib/projectBridge.externalApplications.test.ts` for selected/default application payloads, editable built-in round trips and spawn arguments, and migration.
- The real-preload test must save or migrate a custom collection into a shared `dbStorage` map, recreate the preload with empty renderer `localStorage`, and assert that the same collection loads afterward.
- Run `npx vitest run src/lib/projectBridge.workspace.test.ts` for resolved repository paths.
- Run `npm run lint`, `node --check public/preload.js`, and `npm run build` after changing launch types or implementations.
- Manual uTools smoke: VS Code, Cursor, a quoted executable path with arguments, both placeholders, an invalid command, plugin close/reopen, and a complete uTools process restart.

### 7. Wrong vs Correct

#### Wrong

```ts
await window.projectBridge.openExternalApplication({ projectPath: project.path, application });
```

#### Correct

```ts
await store.openProjectInEditor(project.id, application.id);
```

Keep launch resolution and error logging behind Store actions; components emit only the selected application id.

#### Wrong

```js
window.localStorage.setItem(externalApplicationPreferencesStorageKey, JSON.stringify(preferences));
```

#### Correct

```js
if (window.utools?.dbStorage) {
  window.utools.dbStorage.setItem(externalApplicationPreferencesStorageKey, preferences);
} else {
  window.localStorage.setItem(externalApplicationPreferencesStorageKey, JSON.stringify(preferences));
}
```

Use host-owned storage for uTools process persistence and reserve renderer storage for browser fallback and one-time migration.

---

## Scenario: Import/Export JSON Boundary

### 1. Scope / Trigger

- Trigger: project configuration enters the app from an external JSON file and leaves the app as a portable backup file.

### 2. Signatures

- `ProjectExportPayload` is the top-level export shape.
- `ProjectImportPayload` is the parsed import shape accepted by the store.
- `ProjectPathInspection` is the preload/fallback response for project path detection.

### 3. Contracts

- Export payloads must include a top-level `schemaVersion` and a project list.
- Imported data must be narrowed at the bridge/store boundary before it is merged into state.
- Bridge API additions must be declared in `src/types.ts` and reflected in `src/global.d.ts` through the shared `ProjectBridge` interface.

### 4. Validation & Error Matrix

- Missing or non-numeric `schemaVersion` -> reject import.
- Missing project array -> reject import.
- Project missing required strings such as `id`, `name`, or `path` -> skip that project.
- Script missing required `name` or `command` -> skip or normalize that script before storing.

### 5. Good/Base/Bad Cases

- Good: import validates the top-level payload, filters invalid project records, and reports imported/skipped counts.
- Base: unknown optional fields are ignored unless a schema migration explicitly handles them.
- Bad: casting parsed JSON directly to `Project[]` and pushing it into the store.

### 6. Tests Required

- Type-check the bridge contract and store import path.
- Manual import smoke test with valid JSON, duplicate projects, and malformed JSON.

### 7. Wrong vs Correct

#### Wrong

```ts
const projects = parsed as Project[];
```

#### Correct

```ts
const payload = normalizeProjectImportPayload(parsed);
```

External JSON must pass through runtime validation before store merge.

## Scenario: Git Stash History And Graph Boundary

### 1. Scope / Trigger

- Trigger: stash history crosses `public/preload.js`, `ProjectBridge`, Pinia snapshots, `GitCommitHistory.vue`, and the pure commit graph layout.
- Trigger: Git stores only the newest stash at `refs/stash`; older entries must be read from its reflog and remain actionable in the rendered history.

### 2. Signatures

- `ProjectGitStash = { selector: string; baseHash: string; untrackedFilesHash: string | null }`.
- `ProjectGitCommitSummary.stash?: ProjectGitStash`; `refNames` retains a `{ kind: "stash", name: selector }` presentation ref.
- Store and bridge actions use `createGitStash(...)`, `applyGitStash(projectPath, selector)`, `popGitStash(projectPath, selector)`, and `dropGitStash(projectPath, selector)`.
- Detail readers accept the same optional metadata: `readGitCommitFiles(projectPath, commitHash, stash?: ProjectGitStash)` and `readGitCommitFileDiff(projectPath, commitHash, relativePath, stash?: ProjectGitStash)`.

### 3. Contracts

- Preload reads `refs/stash` through `git reflog` in newest-first order and derives the canonical action selector as `stash@{<entry index>}`. Do not use `%gD` as the numeric selector source while `--date=iso-strict` is active: Git emits a timestamp selector instead.
- Every reflog entry becomes one synthetic history commit immediately before its visible `baseHash`, with `parents: [baseHash]`. The index and optional untracked-file helper commits stay out of the visible history while `untrackedFilesHash` remains available in metadata.
- A stash at the top of a filtered history must preseed a visible base lane when no lane for that base exists. Its node therefore occupies a side lane; the base/mainline must not be replaced by the first stash node.
- A synthetic stash can occupy `commits[0]` when its base is the current HEAD. Actions that operate on HEAD must select the structured `{ kind: "head", head: true }` ref, with an exact legacy `HEAD` fallback, rather than assuming the first history row is HEAD.
- Components select Apply, Pop, and Drop targets from `commit.stash.selector` first. Structured and legacy stash refs are presentation fallbacks only.
- History expansion, tooltip fallback, right-side file preview, and AI diff context pass `commit.stash` to the detail readers. Ordinary commits omit it and retain the generic commit reader path.
- For a stash detail reader, compare `baseHash` to the stash hash for tracked files. When `untrackedFilesHash` is non-null, append that root tree's `diff-tree --root` files and patches, and label its added files `UNTRACKED`.
- Stash writes always refresh the full Git snapshot; Pop and Drop also refresh refs because selector indices can change.

### 4. Validation & Error Matrix

- No `refs/stash` reflog -> no synthetic stash commits.
- Two stashes sharing one base -> expose `stash@{0}` and `stash@{1}` in stack order, each with the same `baseHash`.
- A stash created with `--include-untracked` -> preserve a non-null `untrackedFilesHash` but display no `index on ...` or `untracked files on ...` helper rows.
- A stash containing staged, tracked working-tree, and untracked changes -> file details include all three categories; the untracked entry has `status: "UNTRACKED"` and its single-file patch is non-empty.
- A stash whose base is HEAD -> history may begin with `stash@{0}`, but the structured HEAD ref remains attached to the real HEAD commit.
- A stash detail reader invoked without metadata -> do not infer a stash from generic merge parents; keep the normal commit reader path so unrelated merge commits retain their established behavior.
- A filtered-out stash base -> do not synthesize a dangling base lane outside the visible graph window.
- An invalid or stale selector -> preload returns the existing typed failure without invoking a stash mutation.

### 5. Good/Base/Bad Cases

- Good: a stack at the current branch tip displays every stash as a distinct side-lane node beside the base commit.
- Good: opening a historical stash lists staged, tracked, and untracked files, and selecting each file displays the corresponding patch.
- Base: a stash behind a newer regular commit reuses that commit's existing base lane and still fans into the correct base.
- Bad: treating `refs/stash` as the only stash ref, which silently drops every older stack entry.
- Bad: feeding a leading stash into the ordinary layout with no base lane, which renders it as the blue mainline node.
- Bad: calling `git show <stash-hash>` for a stash merge commit; Git's combined merge diff can omit staged and untracked files.

### 6. Tests Required

- `npm run validate:git-commits` must create two stashes, assert both selectors/base hashes, assert the untracked parent is metadata rather than a visible helper commit, and verify staged/untracked file rows plus their individual patches for a historical stash.
- `npx vitest run src/lib/gitCommitGraph.test.ts` must cover a leading multi-stash stack whose first stash has `nodeLane > 0`.
- Run `node --check public/preload.js`, `npm run lint`, and `npm run build` after changing the stash bridge, types, or renderer.

### 7. Wrong vs Correct

#### Wrong

```js
const selector = reflogRecord.fullSelector; // `%gD` with --date=iso-strict
```

This can produce `refs/stash@{<timestamp>}` rather than the numeric stack selector used by the UI actions.

#### Correct

```js
reflogLines.forEach((line, index) => {
  stashes.push({ selector: `stash@{${index}}`, baseHash, untrackedFilesHash });
});
```

Keep selector generation tied to reflog stack order, then carry it as structured metadata through the graph and context menu.

#### Wrong

```js
runGit(repositoryPath, ["show", "--format=", "--name-status", stashHash]);
```

This asks Git for a combined merge diff, which can hide file changes stored in the stash index or untracked parent.

#### Correct

```js
readGitFileChanges(
  repositoryPath,
  ["diff", "--numstat", stash.baseHash, stashHash],
  ["diff", "--name-status", stash.baseHash, stashHash],
);
readGitFileChanges(
  repositoryPath,
  ["diff-tree", "--no-commit-id", "--root", "-r", "--numstat", stash.untrackedFilesHash],
  ["diff-tree", "--no-commit-id", "--root", "-r", "--name-status", stash.untrackedFilesHash],
);
```

Use the first-parent range for tracked changes and the root-tree range for the optional untracked payload.

## Scenario: Git HEAD Correction And Undo Boundary

### 1. Scope / Trigger

- Trigger: a user amends the attached branch's current commit or removes that commit with VS Code-style Undo Last Commit.
- The flow crosses `GitChangesPane.vue`, `GitTab.vue`'s repository-scoped draft, Pinia, `ProjectBridge`, browser fallback, and `public/preload.js`.

### 2. Signatures

- `ProjectBridge.amendGitCommit(projectPath: string, message: string): Promise<ProjectGitActionResult>`.
- `ProjectBridge.undoLastGitCommit(projectPath: string, options?: { allowMerge?: boolean }): Promise<ProjectGitActionResult>`.
- `ProjectGitActionBlockReason` includes `"merge-commit"`; `ProjectGitActionResult.commitMessage?` returns the full removed commit message after a successful undo.
- Store actions mirror the bridge with `projectId` and `ProjectGitRepositoryTarget` arguments.

### 3. Contracts

- Preload validates that `HEAD` is attached to `refs/heads/<branch>` before either mutation. A detached or non-local symbolic ref is rejected before Git writes.
- Amend reads the complete HEAD message and staged diff. It runs `git commit --amend -m <message>` only when the normalized message changed or staged content exists; otherwise it returns a regular no-op failure.
- Undo is not revert: a normal commit uses `git reset --soft HEAD~`, retaining the removed commit's changes in the index and returning its complete message.
- A merge commit returns `blockReason: "merge-commit"` unless `options.allowMerge === true`. Renderer must obtain this blocker first, then request a separate first-parent confirmation; truthy runtime values must not bypass it.
- For a root commit, preload deletes the captured `HEAD`, only runs `git rm --cached -r -f -- .` when the index contains entries, and attempts to restore the captured HEAD/index on a partial failure. It never removes working-tree files.
- Store routes both writes through `runAuthorizedGitWrite` with full refresh and ref invalidation; undo also refreshes after failure because root recovery or reset failure can leave observable state changed.
- `GitChangesPane` keeps amend's temporary message and pre-amend draft locally. `GitTab` remains the only owner of the context-keyed commit draft; successful undo emits `commitMessage`, while cancel, failure, repository replacement, panel close, and unmount preserve or restore the correct draft.
- Synthetic stash commits can precede the actual HEAD row. Any HEAD operation selects the structured `{ kind: "head", head: true }` ref, with an exact legacy `HEAD` fallback, rather than using `commits[0]`.

### 4. Validation & Error Matrix

- Detached HEAD, missing HEAD, or a non-local symbolic ref -> return a clear failure and do not mutate history.
- Unchanged message with no staged diff -> amend returns a no-op failure.
- Ordinary commit -> undo moves HEAD to its parent and leaves the removed patch staged.
- Merge commit without literal `allowMerge === true` -> return `merge-commit`; second confirmation may retry with `true`.
- Empty root index -> delete HEAD without running an unnecessary index removal that would fail.
- Root unstage failure -> restore the captured HEAD/index where possible and return the original plus recovery error truthfully.
- Stash shown before HEAD -> amend prefill still uses the real HEAD message.
- Target becomes stale before Store dispatch -> bridge is not called; late results do not overwrite the new repository context.

### 5. Good/Base/Bad Cases

- Good: changing only the message of HEAD creates one replacement commit and leaves no staged files.
- Good: undoing a regular HEAD restores the complete multi-line message to the active repository draft while retaining the patch staged.
- Good: undoing a root commit retains every file as unstaged or untracked work on an unborn branch.
- Base: an amend mode is cancelled, restoring the draft that existed before the mode opened.
- Bad: treating Undo Last Commit as `git revert`, which creates an inverse commit instead of reopening the staged change.
- Bad: assuming the first rendered history item is HEAD, because a synthetic stash can precede it.

### 6. Tests Required

- `npm run validate:git-commits` must cover multi-line/message-only amend, staged-content amend, no-op rejection, normal/merge/root undo, empty-root undo, strict merge confirmation, root recovery, detached rejection, and a leading stash before HEAD.
- `npx vitest run tests/projectBridge.workspace.test.ts` must cover exact target routing, stale-target rejection, full/ref refresh, and returned undo draft message.
- Run `node --check public/preload.js`, `npm run type-check`, and `npm run build` after changing the bridge, Store, or composer.
- Manual uTools smoke: compact More-menu keyboard navigation, cancel/failure/success amend flows, merge second confirmation, root feedback, and repository-switch draft isolation.

### 7. Wrong vs Correct

#### Wrong

```ts
const headMessage = snapshot.value?.commits[0]?.message || "";
if (options.allowMerge) runUndo();
```

This can amend a synthetic stash message and allows untyped truthy values to skip the merge safeguard.

#### Correct

```ts
const head = commits.find((commit) => commit.refNames?.some((ref) => ref.kind === "head" && ref.head));
const allowMerge = options.allowMerge === true;
```

Select HEAD from structured refs and require an explicit boolean confirmation before rewriting a merge commit.

## Scenario: Git History Cherry-Pick And Revert Boundary

### 1. Scope / Trigger

- Trigger: a user applies or reverts one history commit through `GitCommitHistory.vue`.
- The path crosses the context menu, Pinia, `ProjectBridge`, browser fallback, and `public/preload.js`; it is a fixed single-commit action, not a conflict resolver.

### 2. Signatures

- `ProjectBridge.cherryPickGitCommit(projectPath: string, commitHash: string): Promise<ProjectGitActionResult>`.
- `ProjectBridge.revertGitCommit(projectPath: string, commitHash: string): Promise<ProjectGitActionResult>`.
- Store actions mirror the bridge with `projectId` and `ProjectGitRepositoryTarget` arguments.
- Conflict and abort outcomes remain ordinary `ProjectGitActionResult` failures; do not add a recovery-specific blocker state.

### 3. Contracts

- Preload accepts only a full native object id (40 or 64 hexadecimal characters) that resolves exactly to an ordinary commit. It checks the current stash list before parent-count classification because a stash is a synthetic multi-parent commit, not a merge target.
- Both actions require `HEAD` attached to `refs/heads/<branch>` and an empty successful `git status --porcelain`; a status-command failure is an ordinary no-write failure, never evidence of a clean worktree. Cherry-pick also rejects the current `HEAD` target. Pre-existing cherry-pick, revert, merge, rebase, sequencer, bisect, or index-lock state blocks the action before any mutation.
- The history menu treats a snapshot as locally attached only when `branches` contains a `current` local branch. `isDetachedHead === false` alone is insufficient because `HEAD` can symbolically point at `refs/remotes/...`.
- After a failed command, resolve only the matching operation ref (`CHERRY_PICK_HEAD` or `REVERT_HEAD`). Run the matching `--abort` only when that ref resolves to the requested full target hash. Never abort a pre-existing or different-target operation, and never run reset, clean, continue, or skip.
- Abort success and failure return normal failed results. Success reports restoration plus the original Git error; abort failure retains both the original and abort errors without claiming the repository is clean.
- Store routes both writes through `runAuthorizedGitWrite` with `{ refresh: "full", refs: true, refreshOnFailure: true }`. Its lock is keyed by repository `contextKey`, holds through refresh, and reauthorizes queued targets before invoking the bridge.
- The history menu acts on its context-menu commit only, not the AI multi-selection. It uses a semantic confirmation with short hash and title. Its fixed warning tells users to configure an external application in Settings and open the repository from the existing menu; it does not launch an application or open Settings.

### 4. Validation & Error Matrix

- Abbreviated, missing, non-commit, stash, merge, detached, non-local-branch, dirty-index, or dirty-worktree targets -> ordinary failure before the write command.
- `git status --porcelain` fails -> return its status error and do not invoke `cherry-pick` or `revert`.
- Current `HEAD` cherry-pick -> ordinary failure without a new commit.
- Existing operation -> ordinary failure without aborting or changing that operation.
- Matching conflict -> matching abort only, followed by an ordinary failure that reports restoration and the original error.
- Missing or mismatched post-command operation ref -> return the original command failure without aborting.
- Abort failure -> return the original and abort errors, then fully refresh the repository and refs.

### 5. Good/Base/Bad Cases

- Good: a full ordinary commit cherry-picks or reverts on a clean attached branch, then history, refs, and worktree refresh.
- Good: a real conflict restores `HEAD`, index, and worktree after a matching abort.
- Base: browser preview returns its typed unavailable result.
- Bad: classifying a stash as a merge before checking `refs/stash`, or aborting solely because a same-named operation ref exists.

### 6. Tests Required

- `npm run validate:git-commits` must use real temporary repositories for successful cherry-pick/revert, full-hash/current-HEAD/stash/merge/detached/non-local-symbolic-HEAD/dirty rejection, a simulated status-probe failure that starts neither history write, conflict restoration of `HEAD`/index/worktree, preserved original and abort errors, and a mismatched operation ref that does not abort.
- `npx vitest run tests/projectBridge.workspace.test.ts` must assert target routing, stale-target rejection, full/ref refresh after failures, and same-target write serialization through refresh with queued-target reauthorization.
- Run `node --check public/preload.js`, `npm run type-check`, and `npm run build` after changing this boundary.
- Manual uTools smoke must cover menu keyboard navigation, confirmation cancellation, warning-only external-tool guidance, and narrow-window focus/Escape cleanup.

### 7. Wrong vs Correct

#### Wrong

```js
if (parents.length > 1) return mergeCommitFailure;
if (gitHistoryActionRefExists(repositoryPath, actionHead)) runGitResult(repositoryPath, [action, "--abort"]);
```

This misclassifies synthetic stashes and can abort a same-named operation that was not started by this request.

#### Correct

```js
if (stashHashes.has(targetHash)) return stashFailure;
const actionHeadResult = runGitResult(repositoryPath, ["rev-parse", "--verify", "--quiet", actionHead]);
if (actionHeadResult.stdout.trim() === targetHash) runGitResult(repositoryPath, [action, "--abort"]);
```

Classify a current stash first and require the matching operation ref to name the requested commit before automatic recovery.
