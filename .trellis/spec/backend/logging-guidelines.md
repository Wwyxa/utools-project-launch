# Logging Guidelines

## Live UI Logs

`LogEntry` in `src/types.ts` is the user-visible log shape. Pinia owns the project
aggregate `logs` and per-script `scriptLogs`; `Terminal.vue` renders them.

- Process events use `project-bridge-event` with project, script, run, and owner
  identity. The Store strips ANSI/control sequences before rendering.
- Classify by meaning: routine stderr/readiness output is not automatically an
  error. Use INFO/SUCCESS for normal activity, WARN for recoverable issues, and
  ERROR for failures.
- Each `addLog` call stores a fresh object shared between its aggregate and script
  indexes. Eviction and clearing update both indexes. Keep the newest bounded
  aggregate entries; the current limit is `LIVE_PROJECT_LOG_ENTRY_LIMIT`.
- Never log tokens, API keys, full environment maps, or credential-bearing
  requests. Example masked data is not a general secret-redaction mechanism.
- Decode process bytes before display/persistence. Preserve UTF-8 and use the
  existing Windows GB18030/GBK fallback; retain incomplete chunks until they can
  be decoded or flushed on exit.

## Common Runtime Records

### 1. Scope / Trigger

Preload and Go use one versioned local record format. The optional service owns
process execution and scheduling; installing it is not required for persistence
or history reads. `public/preload/runtime-records.js` and
`service/internal/state/records.go` own the file contract.

### 2. Signatures

- `listRuntimeRecords(projectId)`; an empty project id selects global history.
- `readRuntimeRecordLogPage(runId, beforeOffset)` returns the newest page for zero.
- `getRuntimeRecordRetention()`, `updateRuntimeRecordRetention(policy)`.
- `clearRuntimeRecords(scope?: { runId: string } | { projectId: string })`
  returns `{ deletedCount, releasedBytes }` for completed records only.
- `saveRuntimeAutomationState(projectId, tasks)`, `loadRuntimeAutomationState(projectId)`.
- Go starts with `--state-dir <local>/service --runtime-dir <local>/runtime`.
  When `--runtime-dir` is omitted, it defaults to `runtime` beside the state
  directory; production service startup never falls back to service-local logs.
  Protocol 3 rejects old services that cannot write this contract. Renderer and
  preload expose only the runtime-record APIs, without service-log forwarding aliases.

### 3. Contracts

- `runtime/logs/<32-lowercase-hex-id>.json`: `schemaVersion:1`, `runId`,
  `source`, `projectId`, `scriptId`, `label`, `status`, ISO `startedAt`/`endedAt`,
  `writerPid`, `truncated`; optional command, durable-write error and execution.
- Source is `preload`, `service`, `operation`, `automation`, or `diagnostic`.
  Each record has one writer. Go publishes completion metadata after terminal
  output flush. A dead writer appears as `lost`; that never authorizes PID
  control.
- `.log` files contain complete JSONL process-shaped events: cursor, timestamp,
  type, run/project/script identities and optional message/result/level.
- `runtime/policy.v1.json` wraps the shared policy. Defaults: persistence on,
  200 completed records/project, 5 MiB/run, 100 MiB total. Counts exclude tombstones.
  Config backups include this policy as optional `runtimeRecordPolicy`; they
  exclude record files and scheduler claims. Older backups omit the policy.
- Writers buffer 64 KiB/200 ms; terminal events and selected-page reads flush
  the corresponding direct writer. List and usage queries use asynchronous
  filesystem reads with at most 16 concurrent metadata reads, never flush all
  writers or trigger global retention. Pages are bounded at 256 KiB and begin
  on complete JSONL boundaries.
- Output persistence failure stops further body writes but never skips terminal
  status handling: retain the write error and try to save actual exit state and
  end time before releasing the writer. Disabling persistence prevents new
  records/output but existing active automation records must still finish and
  become eligible for history and cleanup.
- `runtime/maintenance.lock/owner.json` serializes global retention, cleanup and
  claims. Preload removes a stale lock only when its PID is proven absent.
  Writers only truncate their own active output; completed records are evicted first.
- Normal runtime reads and policy use the shared runtime directory exclusively;
  history queries and cleanup never import old service files or fall back to old
  policy. No developer-only legacy-log cleanup option is exposed.
- Referenced deletion markers prevent the current service state writer from
  republishing cleared records; unreferenced markers are removed.
- Cleanup scopes are exclusive: `{ runId }` selects one run, `{ projectId }`
  selects one project's records, and omitted scope selects all projects.
  `Terminal.vue` shares project/settings confirmation and feedback; source
  filters never narrow cleanup. Active writers, live logs and processes remain
  untouched. Never use omitted scope for project-local cleanup.
- Initial service-directory migration reads old `service/logs` directly into
  `runtime/logs`, preserving JSONL bytes and verifying metadata and output before
  completion. Logs missing a state entry are recovered from their events. Old
  `service.log` text is converted into a completed diagnostic record in bounded
  Unicode-safe chunks. The old retention policy is migrated only if no current
  policy exists. Source files remain untouched; no intermediate logs are copied
  into the new service directory.
- Initial log migration holds the required runtime maintenance lock. A busy lock,
  malformed record or conflicting output fails the service migration item and
  retains source files for retry. Published deletion markers are respected, and
  deterministic record ids prevent duplicate imports after interruption. A stale
  discovery file using an old protocol does not block migration when its process
  is confirmed absent.
- Deleting the service directory preserves shared runtime records, policy and
  direct scheduler claims. Diagnostics are managed through completed
  runtime-record cleanup.
- Direct scheduler files retain seven daily plans and twenty results/task.
  Claims are read and merged under the maintenance lock; log cleanup never
  removes them. Generated plans/history never enter syncing project documents.
- `loadRuntimeAutomationHistory(projectId?, taskId?)` merges completed shared
  execution records into task history independently of the selected process
  owner. Startup loads records once after initial paint, and catalog reloads
  refresh them. Dashboard and project summaries use this same task history,
  without filtering by service enablement. Task caches retain twenty entries,
  while the history dialog receives all retained results, deduplicated by id.
- Bridge operation records capture category/result, not arguments, keys, env
  maps, file bodies or AI request/response content. Process output is not a
  general secret-redaction mechanism.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Missing host local directory | Writes fail visibly; no cwd or legacy fallback |
| Invalid id, offset, schema, policy, symlink | Reject the operation |
| Empty/whitespace project id, missing or mixed cleanup scope keys | Reject cleanup; never widen to all projects |
| Incomplete final JSONL record | Skip it and report truncation |
| Malformed interior record | Fail the historical read |
| Log write failure | Report `runtime-record-error`/durable-write error; keep live logs separate and attempt terminal metadata update |
| Busy global maintenance | Background maintenance defers; explicit mutation fails visibly |
| Already-claimed automation entry | Reject the new claim before launch |

### 5. Good / Base / Bad Cases

Good: a Go run completes, the service stops, and preload reads its JSONL history.
Base: direct execution and operation history work without installing any service.
Bad: renderer event replay writes service output again, or clearing logs resets
claims and repeats an already-started task.

### 6. Tests Required

`tests/runtimeRecords.test.ts` covers persisted output across reloads, UTF-8
pagination, cleanup isolation and active-writer protection, write-failure
recovery, input validation, sensitive argument omission, and automation claims.
`validate:project-storage` covers initial migration of running output, orphan logs,
Unicode diagnostic pagination, policy preservation, lock failure and conflict
retry without duplicate records or intermediate directories. It also covers
preserved logs, policy and scheduler state after service deletion, and absence
of a developer-only cleanup entry.
`tests/automationTask.test.ts` checks continuous-script execution without
relaunching an already running task script.
Go state tests cover the common schema/policy and completed metadata.
`npm run validate:runtime-records` builds/starts a real Go binary and verifies
the default runtime path without `--runtime-dir`, offline reads, direct output,
shared retention and clearing after shutdown.

### 7. Wrong vs Correct

Wrong: persist every Pinia array into `local-state.v1.json`, or use service HTTP
for history. Correct: persist at the event producer and read the common local
record files through the public runtime bridge; Pinia remains the live UI index.

## Verification

Go process tests cover output decoding. Go state/API tests cover retention and
historical reads.
Run `npm run validate:process-results` for process-result boundary changes and
`npm run validate:runtime-records` for cross-language persistence changes.
