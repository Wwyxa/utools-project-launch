package process

import (
	"bufio"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"project-launch-service/internal/state"
)

func TestSupervisorStreamsLongOutputWithoutTruncation(t *testing.T) {
	store := openStore(t)
	run := createActiveRun(t, store)
	supervisor := &Supervisor{store: store}
	managed := &managedProcess{pid: run.PID}
	managed.outputDone.Add(1)
	want := strings.Repeat("x", state.MaxEventMessageBytes*3) + "\nlast line\n"
	supervisor.streamOutput(run, managed, "stdout", strings.NewReader(want))
	var output strings.Builder
	for _, event := range store.EventsAfter(0).Events {
		if event.Type == "error" {
			t.Fatalf("unexpected output error: %s", event.Message)
		}
		if event.Type == "stdout" {
			output.WriteString(event.Message)
		}
	}
	if output.String() != want {
		t.Fatalf("captured %d bytes, want %d exact output bytes", output.Len(), len(want))
	}
}

func TestSupervisorStreamsPromptBeforeNewline(t *testing.T) {
	store := openStore(t)
	run := createActiveRun(t, store)
	supervisor := &Supervisor{store: store}
	managed := &managedProcess{pid: run.PID}
	reader, writer := io.Pipe()
	managed.outputDone.Add(1)
	go supervisor.streamOutput(run, managed, "stdout", reader)
	defer func() {
		writer.Close()
		reader.Close()
		managed.outputDone.Wait()
	}()
	if _, err := io.WriteString(writer, "Password: "); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(time.Second)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if hasEvent(store.EventsAfter(0).Events, run.ID, "stdout", "Password: ") {
			writer.Close()
			managed.outputDone.Wait()
			return
		}
		select {
		case <-deadline:
			t.Fatal("prompt was buffered while the process waited for input")
		case <-ticker.C:
		}
	}
}

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

func TestSupervisorStopsLiveRecoveredAutomationRun(t *testing.T) {
	store := openStore(t)
	run := createActiveRun(t, store)
	if _, err := store.UpdateRun(run.ID, func(current *state.Run) {
		current.AutomationRunID = "recovered-automation-execution"
	}); err != nil {
		t.Fatalf("associate automation execution: %v", err)
	}
	terminated := false
	supervisor := &Supervisor{
		store: store,
		identityMatches: func(pid int, expected string) (bool, error) {
			return pid == run.PID && expected == run.ProcessIdentity, nil
		},
		terminateTree: func(pid int) error {
			if pid != run.PID {
				t.Fatalf("termination pid = %d, want %d", pid, run.PID)
			}
			terminated = true
			return nil
		},
		processes: map[string]*managedProcess{
			run.ID: {runID: run.ID, pid: run.PID, recovered: true},
		},
	}

	recoveredRuns, err := supervisor.ReconcileRecoveredRuns()
	if err != nil {
		t.Fatalf("reconcile recovered automation run: %v", err)
	}
	if !terminated {
		t.Fatal("live recovered automation process was not terminated")
	}
	if len(recoveredRuns) != 1 || recoveredRuns[0].ID != run.ID || recoveredRuns[0].Status != state.RunStatusExited {
		t.Fatalf("recovered terminal runs = %#v, want exited automation run %q", recoveredRuns, run.ID)
	}
	if persisted, found := store.Run(run.ID); !found || persisted.Status != state.RunStatusExited {
		t.Fatalf("persisted run = %#v, found=%t; want exited", persisted, found)
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

func TestSupervisorSendInputBoundsUnreadPipe(t *testing.T) {
	store := openStore(t)
	run := createActiveRun(t, store)
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	supervisor := &Supervisor{
		store: store,
		processes: map[string]*managedProcess{
			run.ID: {runID: run.ID, pid: run.PID, stdin: writer},
		},
	}
	finished := make(chan SendInputResult, 1)
	go func() {
		result, _ := supervisor.SendInput(run.ID, strings.Repeat("x", 1024*1024))
		finished <- result
	}()
	select {
	case result := <-finished:
		if result.Sent || !strings.Contains(result.Message, "in time") {
			t.Fatalf("blocked input result = %#v", result)
		}
	case <-time.After(4 * stdinWriteTimeout):
		t.Fatal("unread stdin blocked past its write timeout")
	}
	if hasEvent(store.EventsAfter(0).Events, run.ID, "stdin", "") {
		t.Fatal("timed out input was reported as sent")
	}
	result, err := supervisor.SendInput(run.ID, "later")
	if err != nil || result.Sent {
		t.Fatalf("closed input result = %#v, err = %v", result, err)
	}
}

func TestSupervisorKeepsRunningWhileChildOutlivesLauncher(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows Job Object lifecycle regression")
	}
	if os.Getenv("PROJECT_LAUNCH_CHILD_HELPER") == "1" {
		child := exec.Command(os.Args[0], "-test.run=^TestSupervisorLongRunningChildHelper$")
		child.Env = append(os.Environ(), "PROJECT_LAUNCH_LONG_RUNNING_CHILD=1")
		child.Stdin = os.Stdin
		if os.Getenv("PROJECT_LAUNCH_CHILD_DETACHED_OUTPUT") != "1" {
			child.Stdout = os.Stdout
			child.Stderr = os.Stderr
		}
		if err := child.Start(); err != nil {
			os.Exit(2)
		}
		os.Exit(0)
	}
	store := openStore(t)
	supervisor, err := NewSupervisor(store)
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	request := testStartRequest(t, `"`+executable+`" -test.run=^TestSupervisorKeepsRunningWhileChildOutlivesLauncher$`)
	request.Env["PROJECT_LAUNCH_CHILD_HELPER"] = "1"
	request.Env["PROJECT_LAUNCH_CHILD_INPUT"] = "1"
	request.Env["PROJECT_LAUNCH_CHILD_READY"] = filepath.Join(t.TempDir(), "ready")
	request.Env["PROJECT_LAUNCH_CHILD_RELEASE"] = filepath.Join(t.TempDir(), "release")
	run, _, err := supervisor.Start(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.WriteFile(request.Env["PROJECT_LAUNCH_CHILD_RELEASE"], nil, 0600)
		if runtime.GOOS == "windows" {
			contents, _ := os.ReadFile(request.Env["PROJECT_LAUNCH_CHILD_READY"])
			pid, _ := strconv.Atoi(string(contents))
			if pid > 0 {
				if child, err := os.FindProcess(pid); err == nil {
					_, _ = child.Wait()
				}
			}
		}
	})
	deadline := time.After(4 * time.Second)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		_, readyErr := os.Stat(request.Env["PROJECT_LAUNCH_CHILD_READY"])
		matches, identityErr := processIdentityMatches(run.PID, run.ProcessIdentity)
		if readyErr == nil && identityErr == nil && !matches {
			break
		}
		select {
		case <-deadline:
			current, _ := store.Run(run.ID)
			t.Fatalf("child did not start: run=%#v events=%#v", current, store.EventsAfter(0).Events)
		case <-ticker.C:
		}
	}
	timer := time.NewTimer(3 * outputDrainTimeout)
	defer timer.Stop()
	<-timer.C
	current, _ := store.Run(run.ID)
	if !current.Status.IsActive() || hasEvent(store.EventsAfter(0).Events, run.ID, "exit", "") {
		t.Fatalf("live child was reported as completed: %#v", current)
	}
	supervisor.mutex.Lock()
	managed := supervisor.processes[run.ID]
	supervisor.mutex.Unlock()
	result, err := supervisor.SendInput(run.ID, "child-input")
	if err != nil || !result.Sent {
		t.Fatalf("send input after launcher exit: result=%#v err=%v", result, err)
	}
	waitForRunStatus(t, store, run.ID, state.RunStatusExited)
	events := store.EventsAfter(0).Events
	if !hasEvent(events, run.ID, "stdout", "received:child-input") || !hasEvent(events, run.ID, "stdin", "") {
		t.Fatalf("child did not receive input before exit: %#v", events)
	}
	if _, err := io.WriteString(managed.stdin, "after-exit\n"); !errors.Is(err, os.ErrClosed) {
		t.Fatalf("completed run retained stdin: %v", err)
	}
}

func TestSupervisorLongRunningChildHelper(t *testing.T) {
	if os.Getenv("PROJECT_LAUNCH_LONG_RUNNING_CHILD") != "1" {
		return
	}
	if err := os.WriteFile(os.Getenv("PROJECT_LAUNCH_CHILD_READY"), []byte(strconv.Itoa(os.Getpid())), 0600); err != nil {
		os.Exit(2)
	}
	input := make(chan string, 1)
	if os.Getenv("PROJECT_LAUNCH_CHILD_INPUT") == "1" {
		go func() {
			line, err := bufio.NewReader(os.Stdin).ReadString('\n')
			if err != nil {
				os.Exit(3)
			}
			input <- line
		}()
	}
	deadline := time.After(8 * time.Second)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		if _, err := os.Stat(os.Getenv("PROJECT_LAUNCH_CHILD_RELEASE")); err == nil {
			return
		}
		select {
		case line := <-input:
			_, _ = io.WriteString(os.Stdout, "received:"+line)
			return
		case <-deadline:
			return
		case <-ticker.C:
		}
	}
}

func TestSupervisorSettlesExitWithInheritedOutputPipe(t *testing.T) {
	store := openStore(t)
	run := createActiveRun(t, store)
	supervisor := &Supervisor{store: store, processes: map[string]*managedProcess{}}
	command, stdin, stdout, stderr, err := newCommand(testStartRequest(t, "echo inherited-output"))
	if err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	defer closeCommandOutputWriters(command)
	defer stdout.Close()
	defer stderr.Close()
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	managed := &managedProcess{
		runID: run.ID, pid: command.Process.Pid, command: command,
		stdin: stdin, stdout: stdout, stderr: stderr,
	}
	managed.outputDone.Add(2)
	go supervisor.streamOutput(run, managed, "stdout", stdout)
	go supervisor.streamOutput(run, managed, "stderr", stderr)
	finished := make(chan struct{})
	go func() {
		supervisor.waitForExit(run, managed)
		close(finished)
	}()
	defer func() {
		stdout.Close()
		stderr.Close()
		command.Process.Kill()
		<-finished
	}()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("process exit waited for inherited output pipes to close")
	}
	completed, _ := store.Run(run.ID)
	if completed.Status != state.RunStatusExited {
		t.Fatalf("completed run = %#v", completed)
	}
	events := store.EventsAfter(0).Events
	if !hasEvent(events, run.ID, "stdout", "inherited-output") {
		t.Fatal("output preceding exit was lost")
	}
	if events[len(events)-1].Type != "exit" || hasEvent(events, run.ID, "error", "") {
		t.Fatalf("events = %#v, want output followed by clean exit", events)
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
