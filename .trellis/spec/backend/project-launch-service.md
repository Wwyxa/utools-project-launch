# Project Launch Service

## Ownership

The optional Go runtime owns delegated processes and automation, not Git, files,
AI, launchers, project catalog, or general preferences. Service types live in
`src/types.ts`; `public/preload/project-launch-service.js` owns installation,
discovery, validation, and HTTP. Vue never reads discovery or sends raw requests.

- Service mode defaults off. Passive startup/status reads do not install or
  enable it. A previously enabled verified installation may restart on reconnect.
- Enable handoff blocks renderer scheduling before starting/reconciling/syncing.
  Persist enabled ownership only after complete configuration acknowledgement.
  Initial failure restores renderer ownership; failure after persisted enable
  retains service ownership and blocks delegated work without fallback.
- Disable only after service-owned active work has stopped and shutdown succeeds.
  Unrelated plugin features remain usable when the service is unavailable.
- `RuntimeDir` defaults to `runtime` beside `StateDir` when omitted, including
  manual CLI startup. Explicit overrides remain supported. Run output and service
  diagnostics always use the shared record format; there is no production
  `service/logs` or `service.log` fallback.

## Installation and Trust

All managed files live under `<plugin-local-data>/service/`. Legacy home-directory
files are migration inputs, not the current service root.

- Download into partial files, verify assets/checksums, replace atomically, and
  retain restricted local install metadata. Failed replacement restores backup.
  Automatic restart verifies installed executable trust without a network request.
- Explicit local verification may accept the canonical executable or matching
  platform release asset, rejecting symlinks before normalization. Passive status
  reads do not create trust metadata. Update checks do not replace running binaries.
- Listen only on `127.0.0.1` with an assigned port. Validate discovery, token path,
  process identity, health identity, and protocol before use. Remove discovery only
  when its recorded owner is proven absent or the service shuts down cleanly.
- On protocol upgrade, validate the old discovery shape separately from protocol
  compatibility. For a structurally valid old record, prove the process absent or
  its identity different, re-read its identity fields, and remove only that stale
  discovery file. A live matching owner or unknown identity remains incompatible;
  never delete tokens, execution state, logs, or installation metadata to upgrade.
- Local builds use `git describe --tags --match service-v* --always --dirty`.
  Untagged builds are `local-<hash>[-dirty]`; unrelated icon-pack tags must never
  appear as service versions. `PROJECT_LAUNCH_SERVICE_VERSION` overrides this.

## Protocol and Synchronization

- Authenticate every endpoint with the restricted bearer token and transport
  `X-Protocol-Version: 3`. JSON mutations validate media type, size, complete body,
  and known fields. Invalid protocol/input produces typed errors.
- Full synchronization uses `/v1/sync?after=<cursor>` with validated health,
  state, and event page. A failed or malformed sync is unavailable/incompatible;
  do not retry through an older three-request compatibility sequence.
- Read the run snapshot/event page atomically. Deliver ordered process events;
  defer the live state broadcast until all event pages drain, then suppress empty
  unchanged broadcasts. Preserve cursor/truncation information.
- `runId` and owner identify runtime state. Validate OS process identity before
  controlling recovered PIDs. A lost or reused PID cannot authorize process control.
- Launch idempotency returns the original run for the same key/input and conflicts
  on changed input. A separate launch for an already-active project/script returns
  `active_run_conflict`; reconcile that identity before deciding recovery failed.
- On Windows, isolate spawned console processes and stop their tree through native
  APIs. Direct and service owners expose the same renderer runtime identity model.

## Automation and Durable State

- Accept one schedule-driven configuration schema (`schemaVersion: 1`), with
  matching monotonic wrapper/config revision. Manual/early submissions use
  `manualRun`/`runEarlyEntryId`, not renderer-generated daily plans.
- The service claims entries once, preserves an early entry's original
  `plannedAt`, and atomically persists ignore-missed transitions. Overview state
  exposes latest task executions; full terminal history is loaded separately.
- The scheduler wakes on configuration changes and due deadlines, rechecks future
  work after sleep, and retries iteration failures with bounded backoff while
  publishing degraded health. Keep timing constants in scheduler code/tests.
- Keep usable automation configuration in memory; persist it as AES-GCM ciphertext
  with a fresh nonce and per-service key derived from the restricted token.
  Migrate plaintext schema-1 state atomically to encrypted schema 2. Corrupt state,
  plaintext in schema 2, or a missing/replaced token fails startup closed.
- Service snapshots expose execution/status data, never automation configuration
  or environment maps. Secret-bearing idempotency fingerprints use the service's
  keyed `Store.Fingerprint`, not an unkeyed digest.
- Retain bounded active/completed metadata and history. Trim by parsed timestamps;
  capture updated results before trimming slices. Output retention and historical
  reads follow [Logging Guidelines](./logging-guidelines.md).

## Scenario: Change-Driven Sync and Service Notifications

`GET /v1/sync?after=<cursor>&since=<revision>&waitMs=<0..25000>` returns a bounded
`{revision, health, state, events}` snapshot or an empty HTTP 204. Revisions are
instance-scoped change tokens, separate from event cursors. Capture state and
events atomically; wake waiters after committed state changes. Preload serializes
sync, cancels stale waits on foreground reads or disable, drains event pages before
waiting, and backs off failures to 30 seconds. Older services retain 750ms polling.

Health `nativeNotifications` means the service owns notification delivery, not
that the OS displayed it. The service queues at most 32 completion notices and
sends serially with an 8-second wait. Underlying library calls cannot be cancelled;
do not start overlapping calls when one exceeds its wait. No durable retry exists.
Use `beeep` as the single cross-platform notification API and set its application
name once. Set task text as data. Platform backend behavior and OS policy may
suppress display or control notification history.

Ignore-missed validates and updates either the bounded execution or its exact
durable automation record; reject cleared/invalid records and do not emit another
completion notice. Persist the skipped status so history reload does not revive it.

On Windows, start the root suspended, assign it to an anonymous Job, then resume.
The run remains active until its script Job members exit, even after the root
exits. Exclude non-root PE GUI-subsystem processes and their currently identifiable
subtrees from stopping and waiting, including recovered-tree stops. This protects
desktop apps opened by scripts; GUI classification is a heuristic, not ownership.
Stop selected members with handle-based Job membership checks, not the whole Job.
Use a completion port plus member queries. The service owns the Job
and refuses shutdown with active runs (`409 active_runs`); do not add cross-restart
Job recovery or persistent helper processes. Exit status represents the root only. Keep
stdout/stderr decoding stateful across chunks, drain output after the process group
ends, and own stdin pipes until then. Preserve quotes in the raw `cmd /d /s /c`
command line. Other platforms retain root-process lifecycle semantics.

Windows service commands use a hidden console. Stop reuses the service executable
to send Ctrl+C only to a console whose members have validated script identities;
no PowerShell or additional executable is required. Allow 3.5 seconds for exit,
then log and force remaining Job members; force directly if no safe signal is
possible. Ignore exited Job members. The preload stop timeout is 15 seconds.
Direct Windows execution uses `taskkill /PID <pid> /T /F` without PowerShell or a
grace period; without Job ownership it cannot guarantee tracking orphaned children.
Unix owners retain SIGTERM, 3.5-second grace and SIGKILL. Manual stop stays stopped,
regardless of exit code. Never infer completion from a retained daemon's name.

Regression coverage must include sync wake/cancellation and old-service fallback;
notification serialization, timeout and queue bounds; ignored durable history;
and Windows child lifetime, redirected output, stdin, graceful cleanup, ignored
signals with forced fallback, GUI-child preservation, group stop, and shutdown
rejection. Real OS notification visibility requires host validation.

## Verification

`go -C service test ./...` covers state, API, process, scheduler, and recovery.
Bridge ownership/sync behavior is covered by
`tests/projectBridge.launchers.test.ts` and
`tests/projectBridge.uiPreferences.test.ts`; the catalog refresh test verifies
that reloaded scripts retain their active run identity. Use the existing release CI for target names,
checksums, and binary limits. Real uTools lifecycle behavior requires host smoke;
browser tests do not establish full host shutdown/reconnect behavior.
Protocol changes require old-protocol discovery tests for stale/reused PIDs,
matching live owners and unknown identity, with preserved state/token/install
assertions. `tests/serviceBuildVersion.test.ts` covers build version selection.
