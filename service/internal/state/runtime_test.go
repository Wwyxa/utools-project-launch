package state

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAutomationConfigurationPersistsAndRejectsStaleRevision(t *testing.T) {
	stateDir := t.TempDir()
	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	config := json.RawMessage(`{"tasks":[]}`)
	updated, err := store.ReplaceAutomation(1, config)
	if err != nil {
		t.Fatalf("replace automation config: %v", err)
	}
	if updated.Revision != 1 || !bytes.Equal(updated.Config, config) {
		t.Fatalf("automation state = %#v, want revision 1 and config", updated)
	}

	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"tasks":[1]}`)); err != ErrAutomationRevisionConflict {
		t.Fatalf("same revision conflict = %v, want %v", err, ErrAutomationRevisionConflict)
	}

	reopened, err := Open(stateDir)
	if err != nil {
		t.Fatalf("reopen state: %v", err)
	}
	persisted := reopened.Automation()
	if persisted.Revision != 1 || !bytes.Equal(persisted.Config, config) {
		t.Fatalf("reopened automation state = %#v, want persisted config", persisted)
	}
}

func TestAutomationSubmissionsSurviveConfigurationReplacementAndRestart(t *testing.T) {
	stateDir := t.TempDir()
	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	manual := AutomationSubmission{
		Kind:        AutomationSubmissionManual,
		ProjectID:   "project",
		TaskID:      "task",
		PlanEntryID: "manual-entry",
		PlannedAt:   "2026-08-15T10:00:00.000Z",
	}
	early := AutomationSubmission{
		Kind:        AutomationSubmissionEarly,
		ProjectID:   "project",
		TaskID:      "task",
		PlanEntryID: "early-entry",
	}
	if _, err := store.ReplaceAutomationWithSubmissions(
		1,
		json.RawMessage(`{"schemaVersion":1,"revision":1,"projects":[]}`),
		[]AutomationSubmission{manual, early},
	); err != nil {
		t.Fatalf("persist automation submissions: %v", err)
	}
	if _, err := store.ReplaceAutomationWithSubmissions(
		2,
		json.RawMessage(`{"schemaVersion":1,"revision":2,"projects":[]}`),
		nil,
	); err != nil {
		t.Fatalf("replace automation configuration without submissions: %v", err)
	}

	persisted := store.Automation()
	if len(persisted.PendingSubmissions) != 2 {
		t.Fatalf("pending submissions = %#v, want manual and early submissions", persisted.PendingSubmissions)
	}
	snapshot, err := json.Marshal(persisted)
	if err != nil {
		t.Fatalf("marshal automation snapshot: %v", err)
	}
	if strings.Contains(string(snapshot), "pendingSubmissions") || strings.Contains(string(snapshot), "manual-entry") {
		t.Fatalf("automation snapshot exposes pending submissions: %s", snapshot)
	}

	reopened, err := Open(stateDir)
	if err != nil {
		t.Fatalf("reopen state: %v", err)
	}
	if got := reopened.Automation().PendingSubmissions; len(got) != 2 || got[0] != manual || got[1] != early {
		t.Fatalf("reopened pending submissions = %#v, want %#v", got, []AutomationSubmission{manual, early})
	}
	if _, claimed, err := reopened.ClaimAutomationExecution(2, AutomationExecution{
		ID:          "manual-execution",
		ProjectID:   "project",
		TaskID:      "task",
		PlanEntryID: "manual-entry",
		Status:      AutomationExecutionRunning,
	}); err != nil || !claimed {
		t.Fatalf("claim manual execution: claimed=%t err=%v", claimed, err)
	}
	remaining := reopened.Automation().PendingSubmissions
	if len(remaining) != 1 || remaining[0] != early {
		t.Fatalf("remaining submissions = %#v, want early submission", remaining)
	}
}

func TestAutomationConfigurationEncryptsEnvironmentValuesAndHidesSnapshotConfig(t *testing.T) {
	stateDir := t.TempDir()
	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	config := json.RawMessage(`{"schemaVersion":1,"revision":1,"projects":[{"env":{"API_KEY":"state-file-secret"}}]}`)
	if _, err := store.ReplaceAutomation(1, config); err != nil {
		t.Fatalf("replace automation config: %v", err)
	}

	contents, err := os.ReadFile(StatePath(stateDir))
	if err != nil {
		t.Fatalf("read persisted state: %v", err)
	}
	if strings.Contains(string(contents), "state-file-secret") || strings.Contains(string(contents), `"config":`) {
		t.Fatalf("persisted state exposes plaintext automation configuration: %s", contents)
	}
	if !strings.Contains(string(contents), `"encryptedConfig":`) {
		t.Fatalf("persisted state is missing encrypted automation configuration: %s", contents)
	}

	snapshot, err := json.Marshal(store.Automation())
	if err != nil {
		t.Fatalf("marshal automation snapshot: %v", err)
	}
	if strings.Contains(string(snapshot), "state-file-secret") || strings.Contains(string(snapshot), `"config":`) {
		t.Fatalf("automation snapshot exposes configuration: %s", snapshot)
	}

	reopened, err := Open(stateDir)
	if err != nil {
		t.Fatalf("reopen state: %v", err)
	}
	if restored := reopened.Automation().Config; !bytes.Equal(restored, config) {
		t.Fatalf("reopened automation config = %s, want %s", restored, config)
	}
}

func TestOpenMigratesLegacyPlaintextAutomationConfiguration(t *testing.T) {
	stateDir := t.TempDir()
	legacy := []byte(`{"schemaVersion":1,"nextCursor":1,"runs":[],"events":[],"idempotencyClaims":{},"automation":{"revision":1,"config":{"schemaVersion":1,"revision":1,"projects":[{"env":{"TOKEN":"legacy-state-secret"}}]},"executions":[]}}`)
	if err := os.WriteFile(StatePath(stateDir), legacy, 0o600); err != nil {
		t.Fatalf("write legacy state: %v", err)
	}

	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open legacy state: %v", err)
	}
	if !strings.Contains(string(store.Automation().Config), "legacy-state-secret") {
		t.Fatalf("legacy automation config was not restored: %s", store.Automation().Config)
	}

	contents, err := os.ReadFile(StatePath(stateDir))
	if err != nil {
		t.Fatalf("read migrated state: %v", err)
	}
	if strings.Contains(string(contents), "legacy-state-secret") || strings.Contains(string(contents), `"config":`) {
		t.Fatalf("migrated state exposes plaintext automation configuration: %s", contents)
	}
}

func TestFingerprintUsesPersistentSecretKey(t *testing.T) {
	stateDir := t.TempDir()
	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	parts := []string{"project", "API_KEY=state-file-secret"}
	fingerprint := store.Fingerprint(parts...)
	payload, err := json.Marshal(parts)
	if err != nil {
		t.Fatalf("marshal fingerprint parts: %v", err)
	}
	if fingerprint == hashValue(string(payload)) {
		t.Fatal("fingerprint must not use an unkeyed hash")
	}

	reopened, err := Open(stateDir)
	if err != nil {
		t.Fatalf("reopen state: %v", err)
	}
	if restored := reopened.Fingerprint(parts...); restored != fingerprint {
		t.Fatalf("reopened fingerprint = %s, want %s", restored, fingerprint)
	}

	otherStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open independent state: %v", err)
	}
	if otherStore.Fingerprint(parts...) == fingerprint {
		t.Fatal("fingerprint must use the service-specific secret key")
	}
}

func TestReplaceAutomationPreservesExecutionClaimsAcrossRevisions(t *testing.T) {
	stateDir := t.TempDir()
	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"schemaVersion":1,"revision":1}`)); err != nil {
		t.Fatalf("write initial automation config: %v", err)
	}
	if _, claimed, err := store.ClaimAutomationExecution(1, AutomationExecution{
		ID:          "execution-1",
		ProjectID:   "project",
		TaskID:      "task",
		PlanEntryID: "entry",
		Status:      AutomationExecutionRunning,
	}); err != nil || !claimed {
		t.Fatalf("claim execution: claimed=%t err=%v", claimed, err)
	}

	updated, err := store.ReplaceAutomation(2, json.RawMessage(`{"schemaVersion":1,"revision":2}`))
	if err != nil {
		t.Fatalf("replace automation config: %v", err)
	}
	if len(updated.Executions) != 1 || updated.Executions[0].ID != "execution-1" {
		t.Fatalf("automation executions = %#v, want retained execution claim", updated.Executions)
	}
}

func TestAutomationHistoryIsGloballyBounded(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"schemaVersion":1,"revision":1}`)); err != nil {
		t.Fatalf("write automation config: %v", err)
	}
	for index := 0; index < MaxAutomationHistory+25; index++ {
		projectID := fmt.Sprintf("project-%03d", index)
		_, claimed, err := store.ClaimAutomationExecution(1, AutomationExecution{
			ID:          fmt.Sprintf("execution-%03d", index),
			ProjectID:   projectID,
			TaskID:      "task",
			PlanEntryID: "entry",
			Status:      AutomationExecutionSkipped,
		})
		if err != nil || !claimed {
			t.Fatalf("claim terminal execution %d: claimed=%t err=%v", index, claimed, err)
		}
	}

	terminalCount := 0
	for _, execution := range store.Automation().Executions {
		if execution.Status != AutomationExecutionRunning {
			terminalCount++
		}
	}
	if terminalCount > MaxAutomationHistory {
		t.Fatalf("terminal automation history = %d, want at most %d", terminalCount, MaxAutomationHistory)
	}
}

func TestAutomationReconcileRemovesDeletedHistoryAndPendingSubmissionsButKeepsRunning(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"schemaVersion":1,"revision":1}`)); err != nil {
		t.Fatalf("write initial automation config: %v", err)
	}
	if _, claimed, err := store.ClaimAutomationExecution(1, AutomationExecution{
		ID:          "deleted-terminal",
		ProjectID:   "deleted-project",
		TaskID:      "deleted-task",
		PlanEntryID: "terminal-entry",
		Status:      AutomationExecutionSkipped,
	}); err != nil || !claimed {
		t.Fatalf("claim deleted terminal execution: claimed=%t err=%v", claimed, err)
	}
	if _, claimed, err := store.ClaimAutomationExecution(1, AutomationExecution{
		ID:          "retained-running",
		ProjectID:   "running-project",
		TaskID:      "running-task",
		PlanEntryID: "running-entry",
		Status:      AutomationExecutionRunning,
	}); err != nil || !claimed {
		t.Fatalf("claim running execution: claimed=%t err=%v", claimed, err)
	}
	if _, err := store.ReplaceAutomationWithSubmissions(2, json.RawMessage(`{"schemaVersion":1,"revision":2}`), []AutomationSubmission{{
		Kind:        AutomationSubmissionEarly,
		ProjectID:   "deleted-project",
		TaskID:      "deleted-task",
		PlanEntryID: "pending-entry",
	}}); err != nil {
		t.Fatalf("replace automation with pending submission: %v", err)
	}

	if _, err := store.ReconcileAutomationPlans(2, nil, []AutomationPlanTask{{
		ProjectID: "current-project",
		TaskID:    "current-task",
	}}, "2026-08-01"); err != nil {
		t.Fatalf("reconcile deleted automation state: %v", err)
	}
	state := store.Automation()
	if len(state.PendingSubmissions) != 0 {
		t.Fatalf("pending submissions = %#v, want deleted submission removed", state.PendingSubmissions)
	}
	if len(state.Executions) != 1 || state.Executions[0].ID != "retained-running" {
		t.Fatalf("executions = %#v, want only the running execution", state.Executions)
	}
}

func TestReconcileAutomationPlansPersistsClaimedEntryStatusAcrossRestart(t *testing.T) {
	stateDir := t.TempDir()
	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"schemaVersion":1,"revision":1,"projects":[]}`)); err != nil {
		t.Fatalf("write automation config: %v", err)
	}

	plans := []AutomationPlan{{
		ProjectID: "project",
		TaskID:    "task",
		Date:      "2026-08-15",
		Entries: []AutomationPlanEntry{{
			ID:        "entry",
			PlannedAt: "2026-08-15T09:00:00.000Z",
			Status:    AutomationPlanEntryPending,
		}},
	}}
	if _, err := store.ReconcileAutomationPlans(
		1,
		plans,
		[]AutomationPlanTask{{ProjectID: "project", TaskID: "task"}},
		"2026-08-08",
	); err != nil {
		t.Fatalf("reconcile automation plans: %v", err)
	}
	if _, claimed, err := store.ClaimAutomationExecution(1, AutomationExecution{
		ID:          "execution",
		ProjectID:   "project",
		TaskID:      "task",
		PlanEntryID: "entry",
		PlannedAt:   "2026-08-15T09:00:00.000Z",
		Status:      AutomationExecutionRunning,
	}); err != nil || !claimed {
		t.Fatalf("claim execution: claimed=%t err=%v", claimed, err)
	}
	if _, err := store.UpdateAutomationExecution("execution", func(execution *AutomationExecution) {
		execution.Status = AutomationExecutionCompleted
	}); err != nil {
		t.Fatalf("complete execution: %v", err)
	}

	reopened, err := Open(stateDir)
	if err != nil {
		t.Fatalf("reopen state: %v", err)
	}
	persisted := reopened.Automation()
	if len(persisted.Plans) != 1 || len(persisted.Plans[0].Entries) != 1 {
		t.Fatalf("persisted plans = %#v", persisted.Plans)
	}
	if status := persisted.Plans[0].Entries[0].Status; status != AutomationPlanEntryCompleted {
		t.Fatalf("persisted plan status = %q, want %q", status, AutomationPlanEntryCompleted)
	}
}

func TestClaimAutomationExecutionSerializesProjects(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"schemaVersion":1,"revision":1}`)); err != nil {
		t.Fatalf("write automation config: %v", err)
	}
	first, claimed, err := store.ClaimAutomationExecution(1, AutomationExecution{
		ID:          "first-execution",
		ProjectID:   "project",
		TaskID:      "first-task",
		PlanEntryID: "first-entry",
		Status:      AutomationExecutionRunning,
	})
	if err != nil || !claimed {
		t.Fatalf("claim first execution: claimed=%t err=%v", claimed, err)
	}
	second, claimed, err := store.ClaimAutomationExecution(1, AutomationExecution{
		ID:          "second-execution",
		ProjectID:   "project",
		TaskID:      "second-task",
		PlanEntryID: "second-entry",
		Status:      AutomationExecutionRunning,
	})
	if err != nil || claimed || second.ID != first.ID {
		t.Fatalf("concurrent project claim = %#v, claimed=%t, err=%v; want existing active execution", second, claimed, err)
	}
	if _, err := store.UpdateAutomationExecution(first.ID, func(current *AutomationExecution) {
		current.Status = AutomationExecutionCompleted
	}); err != nil {
		t.Fatalf("complete first execution: %v", err)
	}
	if _, claimed, err := store.ClaimAutomationExecution(1, AutomationExecution{
		ID:          "second-execution",
		ProjectID:   "project",
		TaskID:      "second-task",
		PlanEntryID: "second-entry",
		Status:      AutomationExecutionRunning,
	}); err != nil || !claimed {
		t.Fatalf("claim second execution after completion: claimed=%t err=%v", claimed, err)
	}
}

func TestEventsAfterPageAdvancesCursorWithinResponseBudget(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)

	for index := 0; index < 4; index++ {
		if _, err := store.AppendEvent(Event{
			Type:      "stdout",
			RunID:     "1234567890abcdef1234567890abcdef",
			ProjectID: "project",
			ScriptID:  "script",
			Message:   strings.Repeat("x", MaxEventMessageBytes),
		}); err != nil {
			t.Fatalf("append event %d: %v", index, err)
		}
	}

	const maxBytes = MaxEventMessageBytes + 2*1024
	page := store.EventsAfterPage(0, maxBytes)
	encoded, err := json.Marshal(page)
	if err != nil {
		t.Fatalf("encode event page: %v", err)
	}
	if len(encoded) > maxBytes {
		t.Fatalf("event page size = %d, want at most %d", len(encoded), maxBytes)
	}
	if len(page.Events) == 0 || !page.HasMore {
		t.Fatalf("first event page = %#v, want a non-empty partial page", page)
	}
	if page.NextCursor != page.Events[len(page.Events)-1].Cursor {
		t.Fatalf("next cursor = %d, want %d", page.NextCursor, page.Events[len(page.Events)-1].Cursor)
	}

	nextPage := store.EventsAfterPage(page.NextCursor, maxBytes)
	if len(nextPage.Events) == 0 || nextPage.Events[0].Cursor <= page.NextCursor {
		t.Fatalf("next event page = %#v, want later retained events", nextPage)
	}
}

func TestSnapshotAndEventsAfterKeepsTerminalRunAndExitTogether(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)

	const runID = "abababababababababababababababab"
	if _, created, err := store.CreateRun(Run{
		ID:        runID,
		ProjectID: "project",
		ScriptID:  "script",
		Status:    RunStatusRunning,
	}, "snapshot-idempotency", "snapshot-request"); err != nil || !created {
		t.Fatalf("create run: created=%t err=%v", created, err)
	}
	exitCode := 0
	if _, err := store.UpdateRunAndAppendEvent(runID, func(current *Run) {
		current.Status = RunStatusExited
		current.EndedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}, "exit", Event{Code: &exitCode}); err != nil {
		t.Fatalf("complete run: %v", err)
	}

	snapshot, batch := store.SnapshotAndEventsAfter(0, 0)
	if len(snapshot.Runs) != 1 || snapshot.Runs[0].ID != runID || snapshot.Runs[0].Status != RunStatusExited {
		t.Fatalf("snapshot runs = %#v, want exited run %q", snapshot.Runs, runID)
	}
	if len(batch.Events) != 1 || batch.Events[0].RunID != runID || batch.Events[0].Type != "exit" {
		t.Fatalf("event batch = %#v, want exit for run %q", batch.Events, runID)
	}
	if snapshot.LatestCursor != batch.LatestCursor || batch.NextCursor != snapshot.LatestCursor {
		t.Fatalf("snapshot/event cursors = snapshot:%d batch:%#v, want one consistent read", snapshot.LatestCursor, batch)
	}
}

func TestAutomationSnapshotSerializesEmptyScriptResultsAsArray(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	if _, err := store.ReplaceAutomation(1, json.RawMessage(`{"schemaVersion":1,"revision":1}`)); err != nil {
		t.Fatalf("write automation config: %v", err)
	}
	if _, claimed, err := store.ClaimAutomationExecution(1, AutomationExecution{
		ID:          "execution",
		ProjectID:   "project",
		TaskID:      "task",
		PlanEntryID: "entry",
		Status:      AutomationExecutionRunning,
	}); err != nil || !claimed {
		t.Fatalf("claim execution: claimed=%t err=%v", claimed, err)
	}

	snapshot, err := json.Marshal(store.Automation())
	if err != nil {
		t.Fatalf("marshal automation snapshot: %v", err)
	}
	if strings.Contains(string(snapshot), `"scriptResults":null`) {
		t.Fatalf("automation snapshot serializes empty script results as null: %s", snapshot)
	}
	if !strings.Contains(string(snapshot), `"scriptResults":[]`) {
		t.Fatalf("automation snapshot is missing an empty script results array: %s", snapshot)
	}
}

func TestLogRetentionDefaultsMigrateAndPersist(t *testing.T) {
	stateDir := t.TempDir()
	legacyState := []byte(`{"schemaVersion":2,"nextCursor":1,"runs":[],"events":[],"idempotencyClaims":{},"automation":{"revision":0,"executions":[]}}`)
	if err := os.WriteFile(StatePath(stateDir), legacyState, 0o600); err != nil {
		t.Fatalf("write legacy state: %v", err)
	}

	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open migrated state: %v", err)
	}
	if policy := store.LogRetention(); policy != DefaultLogRetentionPolicy() {
		t.Fatalf("migrated policy = %#v, want %#v", policy, DefaultLogRetentionPolicy())
	}

	contents, err := os.ReadFile(StatePath(stateDir))
	if err != nil {
		t.Fatalf("read migrated state: %v", err)
	}
	if !strings.Contains(string(contents), `"logRetention"`) {
		t.Fatalf("migrated state is missing log retention: %s", contents)
	}
}

func TestAppendEventKeepsOutputInMemoryWhenLogPersistenceIsDisabled(t *testing.T) {
	stateDir := t.TempDir()
	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	policy := DefaultLogRetentionPolicy()
	policy.Persist = false
	if _, err := store.UpdateLogRetention(policy); err != nil {
		t.Fatalf("disable log persistence: %v", err)
	}

	const runID = "11111111111111111111111111111111"
	if _, err := store.AppendEvent(Event{
		Type:    "stdout",
		RunID:   runID,
		Message: "live-only output",
	}); err != nil {
		t.Fatalf("append live output: %v", err)
	}
	if events := store.EventsAfter(0).Events; len(events) != 1 || events[0].Message != "live-only output" {
		t.Fatalf("live events = %#v, want the output event", events)
	}

	contents, err := os.ReadFile(StatePath(stateDir))
	if err != nil {
		t.Fatalf("read state file: %v", err)
	}
	if strings.Contains(string(contents), "live-only output") {
		t.Fatalf("state file persisted disabled output: %s", contents)
	}
	if _, err := os.Stat(filepath.Join(stateDir, LogDirectoryName, runID+".log")); !os.IsNotExist(err) {
		t.Fatalf("disabled output log exists, err=%v", err)
	}

	reopened, err := Open(stateDir)
	if err != nil {
		t.Fatalf("reopen state: %v", err)
	}
	if events := reopened.EventsAfter(0).Events; len(events) != 0 {
		t.Fatalf("reopened events = %#v, want no disabled persisted output", events)
	}
}

func TestAppendEventKeepsPersistedOutputOutOfStateHistory(t *testing.T) {
	stateDir := t.TempDir()
	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)
	const runID = "11111111111111111111111111111111"
	if _, created, err := store.CreateRun(Run{
		ID:        runID,
		ProjectID: "project",
		ScriptID:  "script",
		Status:    RunStatusRunning,
	}, "idempotency", "request"); err != nil || !created {
		t.Fatalf("create run: created=%t err=%v", created, err)
	}
	if _, err := store.AppendEvent(Event{
		Type:      "stdout",
		RunID:     runID,
		ProjectID: "project",
		ScriptID:  "script",
		Message:   "jsonl-only output",
	}); err != nil {
		t.Fatalf("append live output: %v", err)
	}

	contents, err := os.ReadFile(StatePath(stateDir))
	if err != nil {
		t.Fatalf("read state file: %v", err)
	}
	if strings.Contains(string(contents), "jsonl-only output") {
		t.Fatalf("state file persisted output: %s", contents)
	}
	if events := store.EventsAfter(0).Events; len(events) != 1 || events[0].Message != "jsonl-only output" {
		t.Fatalf("live events = %#v, want output event", events)
	}
	if err := store.Flush(); err != nil {
		t.Fatalf("flush persisted output: %v", err)
	}
	logContents, err := os.ReadFile(filepath.Join(stateDir, LogDirectoryName, runID+".log"))
	if err != nil || !strings.Contains(string(logContents), "jsonl-only output") {
		t.Fatalf("persisted run log = %q, err=%v; want output", logContents, err)
	}
}

func TestOpenRemovesLegacyOutputEventsFromStateHistory(t *testing.T) {
	stateDir := t.TempDir()
	legacyState := []byte(`{"schemaVersion":2,"nextCursor":3,"runs":[],"events":[{"cursor":1,"type":"started","runId":"11111111111111111111111111111111"},{"cursor":2,"type":"stdout","runId":"11111111111111111111111111111111","message":"legacy-state-output"}],"idempotencyClaims":{},"automation":{"revision":0,"executions":[]}}`)
	if err := os.WriteFile(StatePath(stateDir), legacyState, 0o600); err != nil {
		t.Fatalf("write legacy state: %v", err)
	}

	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open migrated state: %v", err)
	}
	if events := store.EventsAfter(0).Events; len(events) != 1 || events[0].Type != "started" {
		t.Fatalf("migrated live events = %#v, want non-output event only", events)
	}
	contents, err := os.ReadFile(StatePath(stateDir))
	if err != nil {
		t.Fatalf("read migrated state: %v", err)
	}
	if strings.Contains(string(contents), "legacy-state-output") {
		t.Fatalf("migrated state retained output: %s", contents)
	}
}

func TestAppendEventBuffersOutputWithoutPerLineStateWritesOrRetentionPasses(t *testing.T) {
	stateDir := t.TempDir()
	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)
	const runID = "22222222222222222222222222222222"
	if _, created, err := store.CreateRun(Run{
		ID:        runID,
		ProjectID: "project",
		ScriptID:  "script",
		Status:    RunStatusRunning,
	}, "buffered-idempotency", "buffered-request"); err != nil || !created {
		t.Fatalf("create run: created=%t err=%v", created, err)
	}
	store.mutex.Lock()
	store.logFlushInterval = time.Hour
	store.mutex.Unlock()

	before := store.LogPersistenceDiagnostics()
	if before.DirectoryScans == 0 {
		t.Fatal("initial log accounting scan was not recorded")
	}
	for index := 0; index < 16; index++ {
		if _, err := store.AppendEvent(Event{
			Type:      "stdout",
			RunID:     runID,
			ProjectID: "project",
			ScriptID:  "script",
			Message:   "buffered-output",
		}); err != nil {
			t.Fatalf("append output %d: %v", index, err)
		}
	}
	afterAppend := store.LogPersistenceDiagnostics()
	if afterAppend.StateWrites != before.StateWrites ||
		afterAppend.RetentionPasses != before.RetentionPasses ||
		afterAppend.DirectoryScans != before.DirectoryScans ||
		afterAppend.OutputFlushes != before.OutputFlushes {
		t.Fatalf("append diagnostics = %#v, want no per-line durable work from %#v", afterAppend, before)
	}
	if err := store.Flush(); err != nil {
		t.Fatalf("flush buffered output: %v", err)
	}
	afterFlush := store.LogPersistenceDiagnostics()
	if afterFlush.StateWrites != before.StateWrites || afterFlush.OutputFlushes != before.OutputFlushes+1 {
		t.Fatalf("flush diagnostics = %#v, want exactly one output flush and no state write from %#v", afterFlush, before)
	}
	contents, err := os.ReadFile(StatePath(stateDir))
	if err != nil {
		t.Fatalf("read state file: %v", err)
	}
	if strings.Contains(string(contents), "buffered-output") {
		t.Fatalf("state file persisted buffered output: %s", contents)
	}
}

func TestReadRunLogPageReturnsNewestCompleteRecordsWithoutDuplicates(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)
	const runID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, created, err := store.CreateRun(Run{
		ID:        runID,
		ProjectID: "project",
		ScriptID:  "script",
		Status:    RunStatusExited,
	}, "paged-idempotency", "paged-request"); err != nil || !created {
		t.Fatalf("create run: created=%t err=%v", created, err)
	}
	for index := 0; index < 24; index++ {
		if _, err := store.AppendEvent(Event{
			Type:      "stdout",
			RunID:     runID,
			ProjectID: "project",
			ScriptID:  "script",
			Message:   strings.Repeat(string(rune('a'+rune(index))), 16*1024),
		}); err != nil {
			t.Fatalf("append output %d: %v", index, err)
		}
	}
	if err := store.Flush(); err != nil {
		t.Fatalf("flush paged output: %v", err)
	}

	newest, err := store.ReadRunLogPage(runID, 0)
	if err != nil {
		t.Fatalf("read newest log page: %v", err)
	}
	if !newest.HasMore || newest.NextOffset <= 0 || len(newest.Events) == 0 {
		t.Fatalf("newest page = %#v, want a bounded page with older output", newest)
	}
	older, err := store.ReadRunLogPage(runID, newest.NextOffset)
	if err != nil {
		t.Fatalf("read older log page: %v", err)
	}
	if len(older.Events) == 0 {
		t.Fatalf("older page = %#v, want retained output", older)
	}
	if older.Events[len(older.Events)-1].Cursor >= newest.Events[0].Cursor {
		t.Fatalf("page order overlaps: older=%#v newest=%#v", older.Events, newest.Events)
	}
	seen := map[uint64]bool{}
	for _, event := range append(older.Events, newest.Events...) {
		if seen[event.Cursor] {
			t.Fatalf("duplicate event cursor %d across pages", event.Cursor)
		}
		seen[event.Cursor] = true
	}
}

func TestClearPersistedLogsDiscardsPendingWriterOutput(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)
	const runID = "33333333333333333333333333333333"
	if _, created, err := store.CreateRun(Run{
		ID:        runID,
		ProjectID: "project",
		ScriptID:  "script",
		Status:    RunStatusRunning,
	}, "clear-idempotency", "clear-request"); err != nil || !created {
		t.Fatalf("create run: created=%t err=%v", created, err)
	}
	store.mutex.Lock()
	store.logFlushInterval = time.Hour
	store.mutex.Unlock()
	if _, err := store.AppendEvent(Event{Type: "stdout", RunID: runID, Message: "discarded before clear"}); err != nil {
		t.Fatalf("append old output: %v", err)
	}
	store.mutex.RLock()
	generation := store.writers[runID].generation
	store.mutex.RUnlock()
	if _, err := store.ClearPersistedLogs(); err != nil {
		t.Fatalf("clear persisted logs: %v", err)
	}
	store.flushScheduledRunLog(runID, generation)
	if _, err := store.AppendEvent(Event{Type: "stdout", RunID: runID, Message: "retained after clear"}); err != nil {
		t.Fatalf("append new output: %v", err)
	}
	if err := store.Flush(); err != nil {
		t.Fatalf("flush new output: %v", err)
	}
	runLog, err := store.ReadRunLog(runID)
	if err != nil {
		t.Fatalf("read active run log: %v", err)
	}
	if len(runLog.Events) != 1 || runLog.Events[0].Message != "retained after clear" {
		t.Fatalf("run log after clear = %#v, want only post-clear output", runLog)
	}
}

func TestTerminalRunEventFlushesAndClosesPendingOutput(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)
	const runID = "44444444444444444444444444444444"
	if _, created, err := store.CreateRun(Run{
		ID:        runID,
		ProjectID: "project",
		ScriptID:  "script",
		Status:    RunStatusRunning,
	}, "terminal-idempotency", "terminal-request"); err != nil || !created {
		t.Fatalf("create run: created=%t err=%v", created, err)
	}
	store.mutex.Lock()
	store.logFlushInterval = time.Hour
	store.mutex.Unlock()
	if _, err := store.AppendEvent(Event{Type: "stdout", RunID: runID, Message: "pending terminal output"}); err != nil {
		t.Fatalf("append pending output: %v", err)
	}
	if _, err := store.UpdateRunAndAppendEvent(runID, func(current *Run) {
		current.Status = RunStatusExited
		current.EndedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}, "exit", Event{}); err != nil {
		t.Fatalf("complete run: %v", err)
	}
	store.mutex.RLock()
	writerCount := len(store.writers)
	store.mutex.RUnlock()
	if writerCount != 0 {
		t.Fatalf("open writer count = %d, want terminal writer closed", writerCount)
	}
	runLog, err := store.ReadRunLog(runID)
	if err != nil {
		t.Fatalf("read terminal run log: %v", err)
	}
	if !hasRunLogEvent(runLog.Events, "stdout", "pending terminal output") || !hasRunLogEvent(runLog.Events, "exit", "") {
		t.Fatalf("terminal run log = %#v, want pending output and exit", runLog)
	}
}

func TestTerminalRunEventKeepsOtherActiveWriterBuffered(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)
	const (
		completedRunID = "77777777777777777777777777777777"
		activeRunID    = "88888888888888888888888888888888"
	)
	for _, runID := range []string{completedRunID, activeRunID} {
		if _, created, err := store.CreateRun(Run{
			ID:        runID,
			ProjectID: "project-" + runID,
			ScriptID:  "script-" + runID,
			Status:    RunStatusRunning,
		}, "terminal-writer-"+runID, "terminal-writer-request-"+runID); err != nil || !created {
			t.Fatalf("create run %s: created=%t err=%v", runID, created, err)
		}
	}
	store.mutex.Lock()
	store.logFlushInterval = time.Hour
	store.mutex.Unlock()
	for _, runID := range []string{completedRunID, activeRunID} {
		if _, err := store.AppendEvent(Event{Type: "stdout", RunID: runID, Message: "pending output"}); err != nil {
			t.Fatalf("append %s output: %v", runID, err)
		}
	}
	before := store.LogPersistenceDiagnostics()
	if _, err := store.UpdateRunAndAppendEvent(completedRunID, func(current *Run) {
		current.Status = RunStatusExited
		current.EndedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}, "exit", Event{}); err != nil {
		t.Fatalf("complete run: %v", err)
	}
	store.mutex.RLock()
	activeWriter, found := store.writers[activeRunID]
	store.mutex.RUnlock()
	if !found || len(activeWriter.pending) == 0 {
		t.Fatalf("active writer = %#v, found=%t; want pending active output", activeWriter, found)
	}
	after := store.LogPersistenceDiagnostics()
	if after.OutputFlushes != before.OutputFlushes+1 {
		t.Fatalf("output flushes = %d, want %d", after.OutputFlushes, before.OutputFlushes+1)
	}
}

func TestBufferedOutputTrimsToLowWatermark(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)
	policy := DefaultLogRetentionPolicy()
	policy.MaxBytesPerRun = 4 * 1024
	if _, err := store.UpdateLogRetention(policy); err != nil {
		t.Fatalf("update log retention: %v", err)
	}
	const runID = "55555555555555555555555555555555"
	if _, created, err := store.CreateRun(Run{ID: runID, Status: RunStatusRunning}, "watermark-idempotency", "watermark-request"); err != nil || !created {
		t.Fatalf("create run: created=%t err=%v", created, err)
	}
	store.mutex.Lock()
	store.logFlushInterval = time.Hour
	store.mutex.Unlock()
	for index := 0; index < 3; index++ {
		if _, err := store.AppendEvent(Event{Type: "stdout", RunID: runID, Message: strings.Repeat("x", 2*1024)}); err != nil {
			t.Fatalf("append output %d: %v", index, err)
		}
	}
	beforeFlush := store.LogPersistenceDiagnostics()
	store.mutex.Lock()
	err = store.flushRunLogWriterLocked(runID, true)
	store.mutex.Unlock()
	if err != nil {
		t.Fatalf("flush oversized output: %v", err)
	}
	afterFlush := store.LogPersistenceDiagnostics()
	if afterFlush.StateWrites != beforeFlush.StateWrites+1 {
		t.Fatalf("truncating flush state writes = %d, want %d", afterFlush.StateWrites, beforeFlush.StateWrites+1)
	}
	info, err := os.Stat(filepath.Join(store.logDirectoryPath(), runID+".log"))
	if err != nil {
		t.Fatalf("read trimmed log metadata: %v", err)
	}
	if info.Size() > runLogLowWatermark(policy.MaxBytesPerRun) {
		t.Fatalf("trimmed log size = %d, want at most %d", info.Size(), runLogLowWatermark(policy.MaxBytesPerRun))
	}
	if run, found := store.Run(runID); !found || !run.OutputTruncated {
		t.Fatalf("trimmed run = %#v, found=%t; want truncation marker", run, found)
	}
}

func TestCloseEnforcesRetentionAfterFlushingPendingOutput(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	policy := DefaultLogRetentionPolicy()
	policy.MaxBytesPerRun = 8 * 1024
	policy.MaxBytesTotal = 4 * 1024
	if _, err := store.UpdateLogRetention(policy); err != nil {
		t.Fatalf("update log retention: %v", err)
	}
	const runID = "56565656565656565656565656565656"
	if _, created, err := store.CreateRun(Run{ID: runID, Status: RunStatusRunning}, "close-retention-idempotency", "close-retention-request"); err != nil || !created {
		t.Fatalf("create run: created=%t err=%v", created, err)
	}
	store.mutex.Lock()
	store.logFlushInterval = time.Hour
	store.mutex.Unlock()
	for index := 0; index < 3; index++ {
		if _, err := store.AppendEvent(Event{Type: "stdout", RunID: runID, Message: strings.Repeat("x", 2*1024)}); err != nil {
			t.Fatalf("append output %d: %v", index, err)
		}
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}
	info, err := os.Stat(filepath.Join(store.logDirectoryPath(), runID+".log"))
	if err != nil {
		t.Fatalf("read retained log metadata: %v", err)
	}
	if info.Size() > runLogLowWatermark(policy.MaxBytesTotal) {
		t.Fatalf("closed log size = %d, want at most %d", info.Size(), runLogLowWatermark(policy.MaxBytesTotal))
	}
	if run, found := store.Run(runID); !found || !run.OutputTruncated {
		t.Fatalf("closed run = %#v, found=%t; want truncation marker", run, found)
	}
}

func TestAppendEventSurfacesDurableWriterFailure(t *testing.T) {
	stateDir := t.TempDir()
	store, err := Open(stateDir)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)
	const runID = "66666666666666666666666666666666"
	if _, created, err := store.CreateRun(Run{ID: runID, Status: RunStatusRunning}, "failure-idempotency", "failure-request"); err != nil || !created {
		t.Fatalf("create run: created=%t err=%v", created, err)
	}
	if err := os.WriteFile(store.logDirectoryPath(), []byte("not a directory"), 0o600); err != nil {
		t.Fatalf("block log directory: %v", err)
	}
	if _, err := store.AppendEvent(Event{Type: "stdout", RunID: runID, Message: "live despite disk failure"}); err == nil {
		t.Fatal("append output unexpectedly succeeded with an invalid log directory")
	}
	if events := store.EventsAfter(0).Events; len(events) != 1 || events[0].Message != "live despite disk failure" {
		t.Fatalf("live events = %#v, want output despite disk failure", events)
	}
	run, found := store.Run(runID)
	if !found || run.DurableWriteError == "" {
		t.Fatalf("run = %#v, found=%t; want durable write error", run, found)
	}
	contents, err := os.ReadFile(StatePath(stateDir))
	if err != nil {
		t.Fatalf("read persisted state: %v", err)
	}
	if !strings.Contains(string(contents), "durableWriteError") || strings.Contains(string(contents), "live despite disk failure") {
		t.Fatalf("persisted state = %s, want only bounded durable error", contents)
	}
}

func TestUpdateLogRetentionRejectsOutOfRangePolicy(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	policy := DefaultLogRetentionPolicy()
	policy.MaxBytesTotal = MinLogRetentionBytes - 1
	if _, err := store.UpdateLogRetention(policy); !errors.Is(err, ErrLogRetentionPolicyInvalid) {
		t.Fatalf("invalid policy error = %v, want %v", err, ErrLogRetentionPolicyInvalid)
	}

	policy = DefaultLogRetentionPolicy()
	policy.MaxBytesPerRun = MinLogRetentionBytes * 2
	policy.MaxBytesTotal = MinLogRetentionBytes
	if _, err := store.UpdateLogRetention(policy); err != nil {
		t.Fatalf("update independent total limit: %v", err)
	}
}

func TestRetainedLogDescriptorsOnlyListReadableCompletedLogs(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	const (
		retainedRunID = "11111111111111111111111111111111"
		missingRunID  = "22222222222222222222222222222222"
		activeRunID   = "33333333333333333333333333333333"
	)
	store.data.Runs = []Run{
		{ID: retainedRunID, ProjectID: "project", ScriptID: "retained", Label: "Retained", Status: RunStatusExited, StartedAt: "2026-08-16T00:00:00Z", EndedAt: "2026-08-16T00:01:00Z", OutputTruncated: true},
		{ID: missingRunID, ProjectID: "project", ScriptID: "missing", Label: "Missing", Status: RunStatusFailed, StartedAt: "2026-08-16T00:00:00Z", EndedAt: "2026-08-16T00:02:00Z"},
		{ID: activeRunID, ProjectID: "project", ScriptID: "active", Label: "Active", Status: RunStatusRunning, StartedAt: "2026-08-16T00:00:00Z"},
	}
	if err := os.MkdirAll(store.logDirectoryPath(), 0o700); err != nil {
		t.Fatalf("create log directory: %v", err)
	}
	legacyEvent, err := json.Marshal(Event{Type: "stdout", RunID: retainedRunID, Message: "legacy JSONL output"})
	if err != nil {
		t.Fatalf("encode legacy event: %v", err)
	}
	if err := os.WriteFile(filepath.Join(store.logDirectoryPath(), retainedRunID+".log"), append(legacyEvent, '\n'), 0o600); err != nil {
		t.Fatalf("write retained log: %v", err)
	}
	if err := os.WriteFile(filepath.Join(store.logDirectoryPath(), activeRunID+".log"), []byte("active\n"), 0o600); err != nil {
		t.Fatalf("write active log: %v", err)
	}

	descriptors, err := store.RetainedLogDescriptors("project")
	if err != nil {
		t.Fatalf("list retained logs: %v", err)
	}
	if len(descriptors) != 1 {
		t.Fatalf("descriptors = %#v, want one readable completed log", descriptors)
	}
	descriptor := descriptors[0]
	if descriptor.RunID != retainedRunID || descriptor.ScriptID != "retained" || !descriptor.Truncated || !descriptor.Available || descriptor.SizeBytes <= 0 {
		t.Fatalf("descriptor = %#v, want retained run metadata and availability", descriptor)
	}
	runLog, err := store.ReadRunLog(retainedRunID)
	if err != nil || len(runLog.Events) != 1 || runLog.Events[0].Message != "legacy JSONL output" {
		t.Fatalf("legacy run log = %#v, err=%v", runLog, err)
	}
}

func TestUpdateLogRetentionCleansOldCompletedLogsPerProject(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	const (
		oldRunID   = "11111111111111111111111111111111"
		newRunID   = "22222222222222222222222222222222"
		otherRunID = "33333333333333333333333333333333"
	)
	store.data.Runs = []Run{
		{ID: oldRunID, ProjectID: "project-a", Status: RunStatusExited},
		{ID: newRunID, ProjectID: "project-a", Status: RunStatusExited},
		{ID: otherRunID, ProjectID: "project-b", Status: RunStatusExited},
	}
	if err := os.MkdirAll(store.logDirectoryPath(), 0o700); err != nil {
		t.Fatalf("create log directory: %v", err)
	}
	baseTime := time.Now().Add(-time.Hour)
	for index, runID := range []string{oldRunID, newRunID, otherRunID} {
		logPath := filepath.Join(store.logDirectoryPath(), runID+".log")
		if err := os.WriteFile(logPath, []byte(strings.Repeat("x", 1024)), 0o600); err != nil {
			t.Fatalf("write %s log: %v", runID, err)
		}
		modifiedAt := baseTime.Add(time.Duration(index) * time.Minute)
		if err := os.Chtimes(logPath, modifiedAt, modifiedAt); err != nil {
			t.Fatalf("set %s log time: %v", runID, err)
		}
	}
	store.mutex.Lock()
	err = store.initializeLogAccountingLocked()
	store.mutex.Unlock()
	if err != nil {
		t.Fatalf("initialize log accounting: %v", err)
	}
	policy := DefaultLogRetentionPolicy()
	policy.MaxCompletedRunsPerProject = 1
	if _, err := store.UpdateLogRetention(policy); err != nil {
		t.Fatalf("update log retention: %v", err)
	}
	if _, err := os.Stat(filepath.Join(store.logDirectoryPath(), oldRunID+".log")); !os.IsNotExist(err) {
		t.Fatalf("old project log still exists, err=%v", err)
	}
	for _, runID := range []string{newRunID, otherRunID} {
		if _, err := os.Stat(filepath.Join(store.logDirectoryPath(), runID+".log")); err != nil {
			t.Fatalf("retained log %s is unavailable: %v", runID, err)
		}
	}
	status, err := store.LogRetentionStatus()
	if err != nil {
		t.Fatalf("read log retention status: %v", err)
	}
	if status.Policy != policy || status.Usage.FileCount != 2 || status.Usage.TotalBytes != 2*1024 {
		t.Fatalf("retention status = %#v, want policy with two retained logs", status)
	}
}

func TestClearPersistedLogsDeletesCompletedOutputAndTruncatesActiveOutput(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)
	const (
		completedRunID = "11111111111111111111111111111111"
		activeRunID    = "22222222222222222222222222222222"
	)
	store.data.Runs = []Run{
		{ID: completedRunID, ProjectID: "project", ScriptID: "completed", Status: RunStatusExited},
		{ID: activeRunID, ProjectID: "project", ScriptID: "active", Status: RunStatusRunning},
	}
	for _, event := range []Event{
		{Type: "stdout", RunID: completedRunID, ProjectID: "project", ScriptID: "completed", Message: "completed output"},
		{Type: "stderr", RunID: activeRunID, ProjectID: "project", ScriptID: "active", Message: "active output"},
	} {
		if _, err := store.AppendEvent(event); err != nil {
			t.Fatalf("append persisted output: %v", err)
		}
	}
	if err := store.Flush(); err != nil {
		t.Fatalf("flush persisted output: %v", err)
	}
	completedLogPath := filepath.Join(store.logDirectoryPath(), completedRunID+".log")
	activeLogPath := filepath.Join(store.logDirectoryPath(), activeRunID+".log")
	completedInfo, err := os.Stat(completedLogPath)
	if err != nil {
		t.Fatalf("read completed log metadata: %v", err)
	}
	activeInfo, err := os.Stat(activeLogPath)
	if err != nil {
		t.Fatalf("read active log metadata: %v", err)
	}

	result, err := store.ClearPersistedLogs()
	if err != nil {
		t.Fatalf("clear persisted logs: %v", err)
	}
	if result.DeletedCount != 1 || result.ReleasedBytes != completedInfo.Size()+activeInfo.Size() {
		t.Fatalf("clear result = %#v, want one deleted log and released bytes", result)
	}
	if _, err := os.Stat(completedLogPath); !os.IsNotExist(err) {
		t.Fatalf("completed log still exists, err=%v", err)
	}
	if info, err := os.Stat(activeLogPath); err != nil || info.Size() != 0 {
		t.Fatalf("active log = %#v, err=%v; want an empty retained file", info, err)
	}
	if !store.data.Runs[1].OutputTruncated || len(store.data.Events) != 0 {
		t.Fatalf("cleared state = %#v, events=%#v; want active truncation and no persisted output", store.data.Runs[1], store.data.Events)
	}
	if events := store.EventsAfter(0).Events; len(events) != 2 {
		t.Fatalf("live events = %#v, want existing in-memory output", events)
	}
	contents, err := os.ReadFile(StatePath(store.stateDir))
	if err != nil {
		t.Fatalf("read cleared state: %v", err)
	}
	if strings.Contains(string(contents), "completed output") || strings.Contains(string(contents), "active output") {
		t.Fatalf("cleared state retained output: %s", contents)
	}

	retry, err := store.ClearPersistedLogs()
	if err != nil {
		t.Fatalf("retry clear persisted logs: %v", err)
	}
	if retry.DeletedCount != 0 || retry.ReleasedBytes != 0 {
		t.Fatalf("retry result = %#v, want idempotent empty result", retry)
	}
	if _, err := store.AppendEvent(Event{Type: "stdout", RunID: activeRunID, ProjectID: "project", ScriptID: "active", Message: "after clear"}); err != nil {
		t.Fatalf("append output after clear: %v", err)
	}
	if err := store.Flush(); err != nil {
		t.Fatalf("flush output after clear: %v", err)
	}
	runLog, err := store.ReadRunLog(activeRunID)
	if err != nil || !runLog.Truncated || len(runLog.Events) != 1 || runLog.Events[0].Message != "after clear" {
		t.Fatalf("active log after clear = %#v, err=%v", runLog, err)
	}
}

func TestClearPersistedLogsForRunPreservesOtherRunsOfTheSameScript(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	closeStore(t, store)
	const (
		targetRunID = "33333333333333333333333333333333"
		otherRunID  = "44444444444444444444444444444444"
	)
	store.data.Runs = []Run{
		{ID: targetRunID, ProjectID: "project", ScriptID: "script", Status: RunStatusExited},
		{ID: otherRunID, ProjectID: "project", ScriptID: "script", Status: RunStatusExited},
	}
	for _, event := range []Event{
		{Type: "stdout", RunID: targetRunID, ProjectID: "project", ScriptID: "script", Message: "target output"},
		{Type: "stdout", RunID: otherRunID, ProjectID: "project", ScriptID: "script", Message: "other output"},
	} {
		if _, err := store.AppendEvent(event); err != nil {
			t.Fatalf("append persisted output: %v", err)
		}
	}
	if err := store.Flush(); err != nil {
		t.Fatalf("flush persisted output: %v", err)
	}

	result, err := store.ClearPersistedLogsForRun(targetRunID)
	if err != nil {
		t.Fatalf("clear target run log: %v", err)
	}
	if result.DeletedCount != 1 || result.ReleasedBytes <= 0 {
		t.Fatalf("clear result = %#v, want one deleted target log", result)
	}
	if _, err := store.ReadRunLog(targetRunID); !errors.Is(err, ErrRunLogUnavailable) {
		t.Fatalf("target run log error = %v, want %v", err, ErrRunLogUnavailable)
	}
	otherLog, err := store.ReadRunLog(otherRunID)
	if err != nil || len(otherLog.Events) != 1 || otherLog.Events[0].Message != "other output" {
		t.Fatalf("other run log = %#v, err=%v; want retained other-script output", otherLog, err)
	}
	if events := store.EventsAfter(0).Events; len(events) != 2 {
		t.Fatalf("live events = %#v, want both existing outputs", events)
	}
	if _, err := store.ClearPersistedLogsForRun(""); err == nil {
		t.Fatal("clear run log unexpectedly accepted an empty run id")
	}
}

func TestTrimTotalLogsConvergesAfterEvictingCompletedLogs(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}

	const (
		activeOne = "11111111111111111111111111111111"
		activeTwo = "22222222222222222222222222222222"
		completed = "33333333333333333333333333333333"
		logLimit  = int64(1)
	)
	store.data.Runs = []Run{
		{ID: activeOne, Status: RunStatusRunning},
		{ID: activeTwo, Status: RunStatusStopping},
		{ID: completed, Status: RunStatusExited},
	}
	if err := os.MkdirAll(store.logDirectoryPath(), 0o700); err != nil {
		t.Fatalf("create log directory: %v", err)
	}
	for _, runID := range []string{activeOne, activeTwo, completed} {
		if err := os.WriteFile(filepath.Join(store.logDirectoryPath(), runID+".log"), []byte(strings.Repeat("x", 60)), 0o600); err != nil {
			t.Fatalf("write %s log: %v", runID, err)
		}
	}

	store.mutex.Lock()
	err = store.trimTotalLogsToLimitLocked(logLimit)
	store.mutex.Unlock()
	if err != nil {
		t.Fatalf("trim logs: %v", err)
	}
	if _, err := os.Stat(filepath.Join(store.logDirectoryPath(), completed+".log")); !os.IsNotExist(err) {
		t.Fatalf("completed log still exists, err=%v", err)
	}

	entries, err := os.ReadDir(store.logDirectoryPath())
	if err != nil {
		t.Fatalf("read log directory: %v", err)
	}
	var totalSize int64
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			t.Fatalf("read %s metadata: %v", entry.Name(), err)
		}
		totalSize += info.Size()
	}
	if totalSize > logLimit {
		t.Fatalf("total log size = %d, want at most %d", totalSize, logLimit)
	}
	for _, run := range store.data.Runs {
		if run.Status.IsActive() && !run.OutputTruncated {
			t.Fatalf("active run %q was truncated without retaining the marker", run.ID)
		}
	}
}

func TestTotalLogRetentionTrimsActiveOutputToLowWatermark(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}

	const runID = "12121212121212121212121212121212"
	policy := DefaultLogRetentionPolicy()
	policy.MaxBytesPerRun = 8 * 1024
	policy.MaxBytesTotal = 4 * 1024
	store.data.Runs = []Run{{ID: runID, Status: RunStatusRunning}}
	store.data.LogRetention = policy
	if err := os.MkdirAll(store.logDirectoryPath(), 0o700); err != nil {
		t.Fatalf("create log directory: %v", err)
	}

	var contents []byte
	for index := 0; index < 18; index++ {
		event, err := json.Marshal(Event{Type: "stdout", RunID: runID, Message: strings.Repeat("x", 256)})
		if err != nil {
			t.Fatalf("encode log event %d: %v", index, err)
		}
		contents = append(contents, event...)
		contents = append(contents, '\n')
	}
	logPath := filepath.Join(store.logDirectoryPath(), runID+".log")
	if err := os.WriteFile(logPath, contents, 0o600); err != nil {
		t.Fatalf("write active run log: %v", err)
	}

	store.mutex.Lock()
	err = store.initializeLogAccountingLocked()
	if err == nil {
		_, _, err = store.enforceLogRetentionLocked(policy)
	}
	store.mutex.Unlock()
	if err != nil {
		t.Fatalf("enforce log retention: %v", err)
	}

	info, err := os.Stat(logPath)
	if err != nil {
		t.Fatalf("read trimmed log metadata: %v", err)
	}
	if info.Size() > runLogLowWatermark(policy.MaxBytesTotal) {
		t.Fatalf("trimmed log size = %d, want at most %d", info.Size(), runLogLowWatermark(policy.MaxBytesTotal))
	}
	if run, found := store.Run(runID); !found || !run.OutputTruncated {
		t.Fatalf("trimmed run = %#v, found=%t; want truncation marker", run, found)
	}
}

func TestTrimActiveRunLogKeepsReadableRecords(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}

	const (
		runID    = "11111111111111111111111111111111"
		logLimit = int64(64)
	)
	store.data.Runs = []Run{{ID: runID, Status: RunStatusRunning}}
	if _, err := store.AppendEvent(Event{
		Type:    "stdout",
		RunID:   runID,
		Message: strings.Repeat("x", 256),
	}); err != nil {
		t.Fatalf("append event: %v", err)
	}
	if err := store.Flush(); err != nil {
		t.Fatalf("flush event: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close active writer before trim: %v", err)
	}

	store.mutex.Lock()
	err = store.trimTotalLogsToLimitLocked(logLimit)
	store.mutex.Unlock()
	if err != nil {
		t.Fatalf("trim logs: %v", err)
	}

	runLog, err := store.ReadRunLog(runID)
	if err != nil {
		t.Fatalf("read trimmed log: %v", err)
	}
	if runLog.SizeBytes > logLimit {
		t.Fatalf("trimmed log size = %d, want at most %d", runLog.SizeBytes, logLimit)
	}
	if !runLog.Truncated {
		t.Fatal("trimmed active log is missing its truncation marker")
	}
}

func TestReadRunLogIgnoresIncompleteTrailingRecord(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}

	const runID = "11111111111111111111111111111111"
	store.data.Runs = []Run{{ID: runID, Status: RunStatusExited}}
	if err := os.MkdirAll(store.logDirectoryPath(), 0o700); err != nil {
		t.Fatalf("create log directory: %v", err)
	}
	validEvent, err := json.Marshal(Event{Type: "stdout", RunID: runID, Message: "retained output"})
	if err != nil {
		t.Fatalf("encode valid event: %v", err)
	}
	logContents := append(append(validEvent, '\n'), []byte(`{"type":"stdout"`)...)
	if err := os.WriteFile(filepath.Join(store.logDirectoryPath(), runID+".log"), logContents, 0o600); err != nil {
		t.Fatalf("write incomplete log: %v", err)
	}

	runLog, err := store.ReadRunLog(runID)
	if err != nil {
		t.Fatalf("read log with an incomplete tail: %v", err)
	}
	if len(runLog.Events) != 1 || runLog.Events[0].Message != "retained output" {
		t.Fatalf("retained log events = %#v, want the complete event", runLog.Events)
	}
	if !runLog.Truncated {
		t.Fatal("incomplete trailing event is missing truncation metadata")
	}
}

func TestTrimRunLogsLimitsCompletedFileCount(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open state: %v", err)
	}

	const (
		activeRun       = "11111111111111111111111111111111"
		oldCompleted    = "22222222222222222222222222222222"
		middleCompleted = "33333333333333333333333333333333"
		newCompleted    = "44444444444444444444444444444444"
	)
	store.data.Runs = []Run{
		{ID: activeRun, Status: RunStatusRunning},
		{ID: oldCompleted, Status: RunStatusExited},
		{ID: middleCompleted, Status: RunStatusFailed},
		{ID: newCompleted, Status: RunStatusStopped},
	}
	if err := os.MkdirAll(store.logDirectoryPath(), 0o700); err != nil {
		t.Fatalf("create log directory: %v", err)
	}
	baseTime := time.Now().Add(-time.Hour)
	for index, runID := range []string{oldCompleted, middleCompleted, newCompleted, activeRun} {
		logPath := filepath.Join(store.logDirectoryPath(), runID+".log")
		if err := os.WriteFile(logPath, []byte("log\n"), 0o600); err != nil {
			t.Fatalf("write %s log: %v", runID, err)
		}
		modifiedAt := baseTime.Add(time.Duration(index) * time.Minute)
		if err := os.Chtimes(logPath, modifiedAt, modifiedAt); err != nil {
			t.Fatalf("set %s log time: %v", runID, err)
		}
	}

	store.mutex.Lock()
	err = store.trimRunLogsToLimitsLocked(1024, 2)
	store.mutex.Unlock()
	if err != nil {
		t.Fatalf("trim logs: %v", err)
	}

	for _, runID := range []string{activeRun, newCompleted} {
		if _, err := os.Stat(filepath.Join(store.logDirectoryPath(), runID+".log")); err != nil {
			t.Fatalf("retained log %s is unavailable: %v", runID, err)
		}
	}
	for _, runID := range []string{oldCompleted, middleCompleted} {
		if _, err := os.Stat(filepath.Join(store.logDirectoryPath(), runID+".log")); !os.IsNotExist(err) {
			t.Fatalf("old completed log %s still exists, err=%v", runID, err)
		}
	}
}

func closeStore(t *testing.T, store *Store) {
	t.Helper()
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close state store: %v", err)
		}
	})
}

func hasRunLogEvent(events []Event, eventType string, message string) bool {
	for _, event := range events {
		if event.Type == eventType && strings.Contains(event.Message, message) {
			return true
		}
	}
	return false
}
