# Technical Design: Unified Project Launch Runtime

## 1. Design Decisions

### 1.1 Keep `ProjectBridge` As The Single Runtime Boundary

The existing `ProjectBridge` methods already provide the correct owner-selection boundary. Keep them as the public Store-facing API and make both implementations conform to the same runtime identity and event contract. Do not add a second general-purpose coordinator class until the shared contract cannot be expressed at the current bridge boundary.

The owner-neutral contract covers the logical capabilities of `start`, `stop`, `sendInput`, `snapshot/reconcile`, and `subscribe`. `ProjectBridge` coordinates those capabilities at the Store boundary; preload and service-specific adapters normalize their native process or HTTP details behind it. This keeps the architecture extensible without introducing a parallel class hierarchy or exposing raw service responses to Vue components.

The effective owner remains global:

```text
service disabled -> preload process runtime + renderer automation
service enabled  -> Go process runtime + Go automation scheduler
```

External terminal/editor launches remain separate preload capabilities.

### 1.2 Owner-Neutral Run Identity

Extend the preload-owned process record with a generated `runId` and `runtimeOwner: "preload"`. Every direct-process lifecycle event and `ProjectBridgeRunResult` carries that identity. The Go service continues using its persisted hexadecimal run ID and `runtimeOwner: "service"` at the bridge boundary.

The Store accepts terminal events only when they match the currently tracked run identity. A missing identity remains compatible with legacy browser fixtures, but real preload and service events always provide one.

### 1.3 Service State Delivery

Keep process output on the existing `project-bridge-event` stream. Add a typed service-state event for the background service poll, carrying the normalized `ProjectLaunchServiceStatus` snapshot without raw HTTP payloads. The Store applies the snapshot through the same reconciliation helper used at startup and explicit refresh.

The preload poll sequence is:

```text
request state -> request events -> advance cursor -> emit process events -> emit service snapshot
```

The snapshot includes runs, automation executions, cursors/truncation metadata, and scheduler status. The Store must not re-append process events already delivered by the event stream when applying the snapshot.

### 1.4 Scheduler Health As Separate State

Add a small scheduler status model in Go with:

- `state`: `running` or `degraded`;
- `lastRunAt`;
- `lastSuccessAt`;
- `lastError`.

`Runtime.Run` records iteration errors, keeps its ticker alive, and tries the next iteration. Successful iterations clear the error. `GET /v1/state` exposes scheduler status alongside runs and automation state. Process health remains independent, so a scheduler parse/configuration error does not incorrectly block manual process supervision.

### 1.5 Logical Duplicate Protection

Before creating a service run, `Supervisor.Start` checks active persisted runs for the same `projectId` and `scriptId`. A typed conflict is returned through the API. This matches the current Store/UI model, which has one runtime identity per script; it avoids invisible older processes that the UI cannot control.

### 1.6 Starting And Poll Failure State

The Store marks the service status as `starting` before invoking the bridge start operation. Background poll failures become a scoped unavailable status event on the next reconciliation rather than disappearing in a catch-all branch. Service mode remains enabled after a post-handoff failure and continues to fail closed.

### 1.7 Ownership Handoff Transaction

The enable path has four observable phases: `handoff` barrier, target runtime start and validation, complete automation revision synchronization, and owner commit. Renderer timers and manual renderer-owned automation are blocked throughout the barrier. Only the final commit persists `enabled: true`; a failure before that commit clears the barrier, keeps the preference disabled, and resumes renderer scheduling. After the commit, runtime failures report `unavailable` and never silently fall back to preload.

## 2. Data Flow

```text
User action / renderer scheduler
        |
        v
Pinia Store -> ProjectBridge contract
        |
        +--> preload runtime: spawn + in-memory run/event state
        |
        +--> service runtime: loopback HTTP -> Go Supervisor
                                      |
                                      +--> persisted Run / Event / Automation state
                                      +--> scheduler status
        |
        v
Owner-neutral process events + service snapshots
        |
        v
Store reconciliation -> ProjectScript / ProjectStatus / automation plan/history
```

Ownership handoff uses the same boundary:

```text
renderer owner -> handoff barrier -> target validation -> config revision ack -> owner commit
       ^                                                       |
       +---------------------- rollback on pre-commit failure-+
```

Boundary rules:

- `src/types.ts` owns shared runtime and service-state event types.
- `public/preload.js` validates and normalizes service payloads and owns the native process adapter.
- `service/internal/api` owns protocol mapping and typed conflict/state responses.
- `service/internal/process` owns process identity and logical duplicate enforcement.
- `service/internal/scheduler` owns automation execution and scheduler health.
- `src/store/useStore.ts` owns UI reconciliation and persistence decisions; components do not inspect raw service state.

## 3. Compatibility Notes

- Browser fallback keeps the service unavailable and preserves the existing no-service behavior. It may use a synthetic run ID for test/runtime consistency but must not claim a real process or healthy service.
- Existing service run IDs remain valid; no state-file migration is required for the new transient scheduler fields.
- Existing process event consumers continue handling the six process event kinds. Service-state events are handled before process-specific logic and never become terminal logs.
- `ProjectLaunchServiceStatus.scheduler` is optional at the TypeScript boundary so older fixtures and protocol-compatible status responses remain readable; the current protocol version is updated only if the response contract requires a breaking change.
- Environment values remain accepted for launch but are never copied into scheduler status, service-state events, or logs.

## 4. Error And Recovery Behavior

| Condition                                 | Process owner              | UI status                                                          | Recovery                                 |
| ----------------------------------------- | -------------------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| preload command exits non-zero            | preload                    | script `ERROR`                                                     | existing stop/relaunch path              |
| service command exits non-zero            | service                    | script `ERROR`, retained run                                       | existing run history/relaunch path       |
| service scheduler iteration fails         | service supervisor healthy | scheduler `degraded`, automation blocked or remains pending        | next valid iteration/config clears error |
| service discovery/API fails while enabled | service unavailable        | service `unavailable`, delegated work fail-closed                  | reconcile/recheck or explicit disable    |
| duplicate active logical run              | service                    | launch action reports conflict; existing run remains authoritative | stop/reuse existing run                  |
| stale process event                       | either                     | ignored for current script                                         | snapshot/reconcile remains authoritative |

## 5. Rollback

- The change is additive at the protocol/type boundaries and preserves the disabled owner path.
- If live snapshot delivery causes regressions, disable only the new service-state event emission while retaining explicit reconcile; process execution and persisted service runs remain unchanged.
- If scheduler health fields cannot be decoded by an older client, keep them optional and continue using process health for compatibility; do not fall back to renderer scheduling while enabled.
- No project configuration migration or destructive cleanup is required.
