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

## Retained Service Logs

`service/internal/state/` owns per-run JSONL logs. Keep live Pinia logs and
historical reads separate; opening retained output must not append it to the
current terminal stream.

- Validate run ids before using them in paths. Unknown or evicted logs return
  `run_log_unavailable`.
- Use the existing retention policy and buffered writer. Evict completed logs
  before trimming active output; preserve complete JSONL records and report
  truncation. An incomplete final record can be skipped, while malformed interior
  records remain errors.
- Apply the larger bounded response limit only to retained-log reads, not every
  service endpoint. Retention settings and limits belong to the service code,
  not duplicate constants in UI code.

## Verification

`tests/projectBridge.uiPreferences.test.ts` covers aligned live-log eviction.
`tests/projectBridge.scriptDiscovery.test.ts` and the Go process tests cover
output decoding. Go state/API tests cover retention and historical reads.
Run `npm run validate:process-results` for process-result boundary changes.
