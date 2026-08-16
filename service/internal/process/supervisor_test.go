package process

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"project-launch-service/internal/state"
)

func TestSupervisorCapturesOutputAndPersistsHashedIdempotency(t *testing.T) {
	stateDir := t.TempDir()
	store := openStoreAt(t, stateDir)
	supervisor, err := NewSupervisor(store)
	if err != nil {
		t.Fatalf("create supervisor: %v", err)
	}

	request := testStartRequest(t, "echo service-output")
	run, created, err := supervisor.Start(request)
	if err != nil || !created {
		t.Fatalf("start command: run=%#v created=%t err=%v", run, created, err)
	}

	waitForRunStatus(t, store, run.ID, state.RunStatusExited)
	batch := store.EventsAfter(0)
	if !hasEvent(batch.Events, run.ID, "stdout", "service-output") {
		t.Fatalf("expected stdout event for run %q, events=%#v", run.ID, batch.Events)
	}

	duplicate, created, err := supervisor.Start(request)
	if err != nil || created || duplicate.ID != run.ID {
		t.Fatalf("idempotent retry = %#v, created=%t, err=%v; want original run without a new launch", duplicate, created, err)
	}
	if len(store.Snapshot().Runs) != 1 {
		t.Fatalf("run count = %d, want 1", len(store.Snapshot().Runs))
	}

	contents, err := os.ReadFile(state.StatePath(stateDir))
	if err != nil {
		t.Fatalf("read persisted state: %v", err)
	}
	if strings.Contains(string(contents), request.IdempotencyKey) {
		t.Fatal("raw idempotency key was persisted")
	}
}

func TestSupervisorRejectsConcurrentRunForSameProjectAndScript(t *testing.T) {
	store := openStore(t)
	supervisor, err := NewSupervisor(store)
	if err != nil {
		t.Fatalf("create supervisor: %v", err)
	}

	request := testStartRequest(t, longRunningTestCommand())
	run, created, err := supervisor.Start(request)
	if err != nil || !created {
		t.Fatalf("start command: run=%#v created=%t err=%v", run, created, err)
	}
	waitForRunStatus(t, store, run.ID, state.RunStatusRunning)
	defer func() {
		_, _ = supervisor.Stop(run.ID)
		waitForRunStatus(t, store, run.ID, state.RunStatusStopped)
	}()

	duplicateRequest := request
	duplicateRequest.IdempotencyKey += "-second"
	duplicateRequest.RequestFingerprint += "-second"
	duplicate, created, err := supervisor.Start(duplicateRequest)
	if !errors.Is(err, state.ErrActiveRunConflict) || created || duplicate.ID != run.ID {
		t.Fatalf("duplicate start = %#v, created=%t, err=%v; want active-run conflict", duplicate, created, err)
	}
	if activeRuns := store.ActiveRuns(); len(activeRuns) != 1 || activeRuns[0].ID != run.ID {
		t.Fatalf("active runs = %#v, want only %q", activeRuns, run.ID)
	}
}

func TestSupervisorStopsACommandTree(t *testing.T) {
	store := openStore(t)
	supervisor, err := NewSupervisor(store)
	if err != nil {
		t.Fatalf("create supervisor: %v", err)
	}

	run, created, err := supervisor.Start(testStartRequest(t, longRunningTestCommand()))
	if err != nil || !created {
		t.Fatalf("start command: run=%#v created=%t err=%v", run, created, err)
	}
	waitForRunStatus(t, store, run.ID, state.RunStatusRunning)

	if _, err := supervisor.Stop(run.ID); err != nil {
		t.Fatalf("stop command: %v", err)
	}
	stopped := waitForRunStatus(t, store, run.ID, state.RunStatusStopped)
	if !stopped.StoppedByUser {
		t.Fatalf("stopped run did not retain user-stop state: %#v", stopped)
	}
}

func TestSupervisorStopsRecoveredRunOnlyAfterIdentityValidation(t *testing.T) {
	store := openStore(t)
	run := createActiveRun(t, store)
	terminationCalled := false
	supervisor := &Supervisor{
		store: store,
		identityMatches: func(pid int, expected string) (bool, error) {
			if pid != run.PID || expected != run.ProcessIdentity {
				t.Fatalf("identity validation received pid=%d expected=%q", pid, expected)
			}
			return false, nil
		},
		terminateTree: func(int) error {
			terminationCalled = true
			return nil
		},
		processes: map[string]*managedProcess{
			run.ID: {runID: run.ID, pid: run.PID, recovered: true},
		},
	}

	updated, err := supervisor.Stop(run.ID)
	if err != nil {
		t.Fatalf("stop recovered run: %v", err)
	}
	if terminationCalled {
		t.Fatal("identity mismatch invoked process termination")
	}
	if updated.Status != state.RunStatusLost {
		t.Fatalf("run status = %q, want %q", updated.Status, state.RunStatusLost)
	}
	persisted, found := store.Run(run.ID)
	if !found || persisted.Status != state.RunStatusLost {
		t.Fatalf("persisted run = %#v, found=%t; want lost", persisted, found)
	}
}

func TestSupervisorReconcilesEndedRecoveredRun(t *testing.T) {
	store := openStore(t)
	run := createActiveRun(t, store)
	supervisor := &Supervisor{
		store: store,
		identityMatches: func(pid int, expected string) (bool, error) {
			return pid == run.PID && expected == run.ProcessIdentity && false, nil
		},
		processes: map[string]*managedProcess{
			run.ID: {runID: run.ID, pid: run.PID, recovered: true},
		},
	}

	recoveredRuns, err := supervisor.ReconcileRecoveredRuns()
	if err != nil {
		t.Fatalf("reconcile recovered run: %v", err)
	}
	if len(recoveredRuns) != 1 || recoveredRuns[0].ID != run.ID || recoveredRuns[0].Status != state.RunStatusLost {
		t.Fatalf("recovered terminal runs = %#v, want lost run %q", recoveredRuns, run.ID)
	}
	if persisted, found := store.Run(run.ID); !found || persisted.Status != state.RunStatusLost {
		t.Fatalf("persisted run = %#v, found=%t; want lost", persisted, found)
	}
}

func TestSupervisorStopsRecoveredRunAndRecordsExit(t *testing.T) {
	store := openStore(t)
	run := createActiveRun(t, store)
	identityChecked := false
	terminationCalled := false
	supervisor := &Supervisor{
		store: store,
		identityMatches: func(pid int, expected string) (bool, error) {
			identityChecked = true
			return pid == run.PID && expected == run.ProcessIdentity, nil
		},
		terminateTree: func(pid int) error {
			if !identityChecked {
				t.Fatal("process termination occurred before identity validation")
			}
			if pid != run.PID {
				t.Fatalf("termination pid = %d, want %d", pid, run.PID)
			}
			terminationCalled = true
			return nil
		},
		processes: map[string]*managedProcess{
			run.ID: {runID: run.ID, pid: run.PID, recovered: true},
		},
	}

	updated, err := supervisor.Stop(run.ID)
	if err != nil {
		t.Fatalf("stop recovered run: %v", err)
	}
	if !terminationCalled {
		t.Fatal("recovered process was not terminated")
	}
	if updated.Status != state.RunStatusStopped || !updated.StoppedByUser || updated.EndedAt == "" {
		t.Fatalf("updated run = %#v, want stopped user-terminated run", updated)
	}
	if !hasEvent(store.EventsAfter(0).Events, run.ID, "exit", "") {
		t.Fatalf("expected exit event for recovered run %q", run.ID)
	}
}

func TestSupervisorSendInputRedactsPersistedEvent(t *testing.T) {
	stateDir := t.TempDir()
	store := openStoreAt(t, stateDir)
	run := createActiveRun(t, store)
	stdin := &recordingWriteCloser{}
	supervisor := &Supervisor{
		store: store,
		processes: map[string]*managedProcess{
			run.ID: {runID: run.ID, pid: run.PID, stdin: stdin},
		},
	}
	secret := "super-secret-stdin-value"

	result, err := supervisor.SendInput(run.ID, secret)
	if err != nil {
		t.Fatalf("send input: %v", err)
	}
	if !result.Sent || result.Message != stdinEventMessage {
		t.Fatalf("send input result = %#v", result)
	}
	if got := string(stdin.contents); got != secret+"\n" {
		t.Fatalf("stdin contents = %q, want %q", got, secret+"\n")
	}
	for _, event := range store.EventsAfter(0).Events {
		if event.RunID == run.ID && event.Type == "stdin" && event.Message != stdinEventMessage {
			t.Fatalf("stdin event message = %q, want redacted status", event.Message)
		}
	}
	contents, err := os.ReadFile(state.StatePath(stateDir))
	if err != nil {
		t.Fatalf("read persisted state: %v", err)
	}
	if strings.Contains(string(contents), secret) {
		t.Fatal("stdin secret was persisted")
	}
	if err := store.Flush(); err != nil {
		t.Fatalf("flush persisted stdin status: %v", err)
	}
	logContents, err := os.ReadFile(filepath.Join(stateDir, state.LogDirectoryName, run.ID+".log"))
	if err != nil {
		t.Fatalf("read persisted run log: %v", err)
	}
	if strings.Contains(string(logContents), secret) {
		t.Fatal("stdin secret was persisted in the run log")
	}
}

func openStore(t *testing.T) *state.Store {
	t.Helper()
	return openStoreAt(t, t.TempDir())
}

func openStoreAt(t *testing.T, stateDir string) *state.Store {
	t.Helper()
	store, err := state.Open(stateDir)
	if err != nil {
		t.Fatalf("open runtime state: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close runtime state: %v", err)
		}
	})
	return store
}

func createActiveRun(t *testing.T, store *state.Store) state.Run {
	t.Helper()
	runID, err := state.NewRunID()
	if err != nil {
		t.Fatalf("create run id: %v", err)
	}
	run, created, err := store.CreateRun(state.Run{
		ID:              runID,
		ProjectID:       "project",
		ScriptID:        "script",
		Label:           "Project / Script",
		Command:         "test command",
		Cwd:             t.TempDir(),
		PID:             4242,
		Status:          state.RunStatusRunning,
		StartedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		ProcessIdentity: "expected-process-identity",
	}, "test-idempotency-key-"+runID, "test-request-fingerprint-"+runID)
	if err != nil || !created {
		t.Fatalf("create active run: run=%#v created=%t err=%v", run, created, err)
	}
	return run
}

type recordingWriteCloser struct {
	contents []byte
}

func (writer *recordingWriteCloser) Write(contents []byte) (int, error) {
	writer.contents = append(writer.contents, contents...)
	return len(contents), nil
}

func (writer *recordingWriteCloser) Close() error {
	return nil
}

func testStartRequest(t *testing.T, command string) StartRequest {
	t.Helper()
	return StartRequest{
		ProjectID:          "project",
		ScriptID:           "script",
		Command:            command,
		Cwd:                t.TempDir(),
		Env:                map[string]string{},
		Label:              "Project / Script",
		IdempotencyKey:     "test-idempotency-key-" + strings.ReplaceAll(t.Name(), "/", "-"),
		RequestFingerprint: "test-request-fingerprint-" + command,
	}
}

func longRunningTestCommand() string {
	if runtime.GOOS == "windows" {
		return "ping -n 30 127.0.0.1 >nul"
	}
	return "sleep 30"
}

func waitForRunStatus(t *testing.T, store *state.Store, runID string, expected state.RunStatus) state.Run {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if run, found := store.Run(runID); found && run.Status == expected {
			return run
		}
		time.Sleep(25 * time.Millisecond)
	}
	run, _ := store.Run(runID)
	t.Fatalf("run %q did not reach %q: %#v", runID, expected, run)
	return state.Run{}
}

func hasEvent(events []state.Event, runID string, eventType string, message string) bool {
	for _, event := range events {
		if event.RunID == runID && event.Type == eventType && strings.Contains(event.Message, message) {
			return true
		}
	}
	return false
}
