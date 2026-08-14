package state

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
}
