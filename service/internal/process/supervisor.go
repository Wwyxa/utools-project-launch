package process

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"project-launch-service/internal/state"
)

const (
	outputScannerBufferBytes = state.MaxEventMessageBytes + 1
	startedEventMessage      = "Process started."
	stdinEventMessage        = "Input sent to process."
)

type StartRequest struct {
	ProjectID          string
	ScriptID           string
	Command            string
	Cwd                string
	Env                map[string]string
	Label              string
	AutomationRunID    string
	IdempotencyKey     string
	RequestFingerprint string
}

type SendInputResult struct {
	Sent    bool   `json:"sent"`
	Message string `json:"message,omitempty"`
}

type StopOptions struct {
	StoppedByUser         bool
	AutomationExitMatched bool
}

type Supervisor struct {
	store           *state.Store
	identityMatches func(pid int, expected string) (bool, error)
	terminateTree   func(pid int) error

	mutex                 sync.Mutex
	processes             map[string]*managedProcess
	recoveredTerminalRuns []state.Run
}

type managedProcess struct {
	runID                 string
	pid                   int
	command               *exec.Cmd
	stdin                 io.WriteCloser
	recovered             bool
	outputDone            sync.WaitGroup
	inputMutex            sync.Mutex
	stateMutex            sync.Mutex
	stoppedByUser         bool
	automationExitMatched bool
}

func NewSupervisor(store *state.Store) (*Supervisor, error) {
	if store == nil {
		return nil, errors.New("runtime state store is required")
	}

	supervisor := &Supervisor{
		store:           store,
		identityMatches: processIdentityMatches,
		terminateTree:   terminateProcessTree,
		processes:       map[string]*managedProcess{},
	}
	if err := supervisor.Recover(); err != nil {
		return nil, err
	}

	return supervisor, nil
}

func (supervisor *Supervisor) Fingerprint(parts ...string) string {
	return supervisor.store.Fingerprint(parts...)
}

func (supervisor *Supervisor) Start(request StartRequest) (state.Run, bool, error) {
	if err := validateStartRequest(request); err != nil {
		return state.Run{}, false, err
	}

	runID, err := state.NewRunID()
	if err != nil {
		return state.Run{}, false, err
	}
	startedAt := time.Now().UTC().Format(time.RFC3339Nano)
	run, created, err := supervisor.store.CreateRun(state.Run{
		ID:              runID,
		ProjectID:       request.ProjectID,
		ScriptID:        request.ScriptID,
		Label:           request.Label,
		Command:         request.Command,
		Cwd:             request.Cwd,
		Status:          state.RunStatusStarting,
		StartedAt:       startedAt,
		AutomationRunID: request.AutomationRunID,
	}, request.IdempotencyKey, request.RequestFingerprint)
	if err != nil || !created {
		return run, created, err
	}

	command, stdin, stdout, stderr, err := newCommand(request)
	if err != nil {
		return supervisor.failStart(run, err)
	}
	if err := command.Start(); err != nil {
		return supervisor.failStart(run, fmt.Errorf("start command: %w", err))
	}

	pid := command.Process.Pid
	identity, identityErr := processIdentityForProcess(command.Process)
	if identityErr != nil {
		_ = stdout.Close()
		_ = stderr.Close()
		_ = supervisor.terminateTree(pid)
		_ = command.Wait()
		return supervisor.failStart(run, fmt.Errorf("read started process identity: %w", identityErr))
	}
	run, err = supervisor.store.UpdateRun(run.ID, func(current *state.Run) {
		current.PID = pid
		current.Status = state.RunStatusRunning
		current.ProcessIdentity = identity
	})
	if err != nil {
		_ = supervisor.terminateTree(pid)
		_ = command.Wait()
		return state.Run{}, false, fmt.Errorf("persist started process: %w", err)
	}

	managed := &managedProcess{
		runID:   run.ID,
		pid:     pid,
		command: command,
		stdin:   stdin,
	}
	supervisor.mutex.Lock()
	supervisor.processes[run.ID] = managed
	supervisor.mutex.Unlock()

	supervisor.appendEvent(run, "started", state.Event{
		PID:     pid,
		Message: startedEventMessage,
		Cwd:     run.Cwd,
	})
	managed.outputDone.Add(2)
	go supervisor.streamOutput(run, managed, "stdout", stdout)
	go supervisor.streamOutput(run, managed, "stderr", stderr)
	go supervisor.waitForExit(run, managed)

	return run, true, nil
}

func (supervisor *Supervisor) Stop(runID string) (state.Run, error) {
	return supervisor.StopWithOptions(runID, StopOptions{StoppedByUser: true})
}

func (supervisor *Supervisor) StopAutomation(runID string) (state.Run, error) {
	return supervisor.StopWithOptions(runID, StopOptions{AutomationExitMatched: true})
}

func (supervisor *Supervisor) StopWithOptions(runID string, options StopOptions) (state.Run, error) {
	run, found := supervisor.store.Run(runID)
	if !found {
		return state.Run{}, fmt.Errorf("run %q was not found", runID)
	}
	if !run.Status.IsActive() {
		return run, nil
	}
	if run.PID <= 0 {
		return supervisor.markLost(run, "The service cannot stop a run that never received a process identifier.")
	}
	supervisor.mutex.Lock()
	managed := supervisor.processes[runID]
	recovered := managed != nil && managed.recovered
	supervisor.mutex.Unlock()

	matches, identityErr := supervisor.identityMatches(run.PID, run.ProcessIdentity)
	if identityErr != nil || !matches {
		updated, err := supervisor.markLost(run, "The persisted process identity no longer matches a running process.")
		if recovered && err == nil {
			supervisor.recordRecoveredTerminalRun(updated)
		}
		return updated, err
	}

	supervisor.mutex.Lock()
	managed = supervisor.processes[runID]
	supervisor.mutex.Unlock()
	if managed == nil || managed.recovered {
		if err := supervisor.terminateTree(run.PID); err != nil {
			return run, fmt.Errorf("stop recovered process tree: %w", err)
		}
		return supervisor.completeRecoveredStop(run, options)
	}

	managed.stateMutex.Lock()
	managed.stoppedByUser = options.StoppedByUser
	managed.automationExitMatched = options.AutomationExitMatched
	managed.stateMutex.Unlock()
	run, err := supervisor.store.UpdateRun(runID, func(current *state.Run) {
		current.Status = state.RunStatusStopping
		current.StoppedByUser = options.StoppedByUser
		current.AutomationExitMatched = options.AutomationExitMatched
	})
	if err != nil {
		return state.Run{}, err
	}
	if err := supervisor.terminateTree(run.PID); err != nil {
		return run, fmt.Errorf("stop process tree: %w", err)
	}

	return run, nil
}

func (supervisor *Supervisor) SendInput(runID string, input string) (SendInputResult, error) {
	supervisor.mutex.Lock()
	managed := supervisor.processes[runID]
	supervisor.mutex.Unlock()
	if managed == nil || managed.recovered || managed.stdin == nil {
		return SendInputResult{Sent: false, Message: "The selected process cannot receive input."}, nil
	}

	managed.inputMutex.Lock()
	defer managed.inputMutex.Unlock()
	if _, err := io.WriteString(managed.stdin, input+"\n"); err != nil {
		return SendInputResult{Sent: false, Message: "The selected process is no longer accepting input."}, nil
	}

	run, found := supervisor.store.Run(runID)
	if !found {
		return SendInputResult{Sent: false, Message: "The selected process is no longer available."}, nil
	}
	supervisor.appendEvent(run, "stdin", state.Event{PID: run.PID, Message: stdinEventMessage})
	return SendInputResult{Sent: true, Message: stdinEventMessage}, nil
}

func (supervisor *Supervisor) Recover() error {
	for _, run := range supervisor.store.ActiveRuns() {
		matches, err := supervisor.identityMatches(run.PID, run.ProcessIdentity)
		if err != nil || !matches {
			updated, markErr := supervisor.markLost(run, "The persisted process identity could not be verified after service restart.")
			if markErr != nil {
				return markErr
			}
			supervisor.recordRecoveredTerminalRun(updated)
			continue
		}

		supervisor.mutex.Lock()
		supervisor.processes[run.ID] = &managedProcess{runID: run.ID, pid: run.PID, recovered: true}
		supervisor.mutex.Unlock()
	}

	return nil
}

func (supervisor *Supervisor) ReconcileRecoveredRuns() ([]state.Run, error) {
	supervisor.mutex.Lock()
	terminalRuns := append([]state.Run(nil), supervisor.recoveredTerminalRuns...)
	supervisor.recoveredTerminalRuns = nil
	recovered := make([]*managedProcess, 0)
	for _, managed := range supervisor.processes {
		if managed.recovered {
			recovered = append(recovered, managed)
		}
	}
	supervisor.mutex.Unlock()

	var reconciliationErr error
	for _, managed := range recovered {
		run, found := supervisor.store.Run(managed.runID)
		if !found || !run.Status.IsActive() {
			supervisor.removeManagedProcess(managed.runID)
			continue
		}

		matches, err := supervisor.identityMatches(run.PID, run.ProcessIdentity)
		if err == nil && matches {
			continue
		}
		updated, markErr := supervisor.markLost(run, "The persisted process identity could not be verified after service restart.")
		if markErr != nil {
			reconciliationErr = errors.Join(reconciliationErr, markErr)
			continue
		}
		terminalRuns = append(terminalRuns, updated)
	}

	return terminalRuns, reconciliationErr
}

func (supervisor *Supervisor) HasActiveRuns() bool {
	return len(supervisor.store.ActiveRuns()) > 0
}

func (supervisor *Supervisor) Run(runID string) (state.Run, bool) {
	return supervisor.store.Run(runID)
}

func (supervisor *Supervisor) FindAutomationRun(automationRunID string) (state.Run, bool) {
	if strings.TrimSpace(automationRunID) == "" {
		return state.Run{}, false
	}
	for _, run := range supervisor.store.Snapshot().Runs {
		if run.AutomationRunID == automationRunID {
			return run, true
		}
	}
	return state.Run{}, false
}

func (supervisor *Supervisor) StoreSnapshot() state.Snapshot {
	return supervisor.store.Snapshot()
}

func (supervisor *Supervisor) EventsAfter(after uint64) state.EventBatch {
	return supervisor.store.EventsAfter(after)
}

func (supervisor *Supervisor) EventsAfterPage(after uint64, maxBytes int) state.EventBatch {
	return supervisor.store.EventsAfterPage(after, maxBytes)
}

func (supervisor *Supervisor) AutomationSnapshot() state.AutomationState {
	return supervisor.store.Automation()
}

func (supervisor *Supervisor) ReplaceAutomation(revision uint64, config json.RawMessage) (state.AutomationState, error) {
	return supervisor.store.ReplaceAutomation(revision, config)
}

func (supervisor *Supervisor) failStart(run state.Run, startErr error) (state.Run, bool, error) {
	endedAt := time.Now().UTC().Format(time.RFC3339Nano)
	updated, updateErr := supervisor.store.UpdateRunAndAppendEvent(run.ID, func(current *state.Run) {
		current.Status = state.RunStatusFailed
		current.Error = startErr.Error()
		current.EndedAt = endedAt
	}, "error", state.Event{Message: startErr.Error()})
	if updateErr != nil {
		return state.Run{}, false, errors.Join(startErr, updateErr)
	}
	return updated, true, startErr
}

func (supervisor *Supervisor) streamOutput(run state.Run, managed *managedProcess, eventType string, reader io.Reader) {
	defer managed.outputDone.Done()
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), outputScannerBufferBytes)
	for scanner.Scan() {
		supervisor.appendEvent(run, eventType, state.Event{PID: managed.pid, Message: scanner.Text()})
	}
	if err := scanner.Err(); err != nil {
		supervisor.appendEvent(run, "error", state.Event{PID: managed.pid, Message: fmt.Sprintf("read %s: %v", eventType, err)})
	}
}

func (supervisor *Supervisor) waitForExit(run state.Run, managed *managedProcess) {
	managed.outputDone.Wait()
	waitErr := managed.command.Wait()
	managed.stateMutex.Lock()
	stoppedByUser := managed.stoppedByUser
	automationExitMatched := managed.automationExitMatched
	managed.stateMutex.Unlock()

	endedAt := time.Now().UTC().Format(time.RFC3339Nano)
	exitCode := managed.command.ProcessState.ExitCode()
	signal := exitSignal(waitErr)
	_, _ = supervisor.store.UpdateRunAndAppendEvent(run.ID, func(current *state.Run) {
		current.EndedAt = endedAt
		current.Code = &exitCode
		current.Signal = signal
		current.StoppedByUser = stoppedByUser
		current.AutomationExitMatched = automationExitMatched
		if stoppedByUser {
			current.Status = state.RunStatusStopped
			return
		}
		if automationExitMatched {
			current.Status = state.RunStatusExited
			return
		}
		if waitErr == nil && exitCode == 0 {
			current.Status = state.RunStatusExited
			return
		}
		current.Status = state.RunStatusFailed
		if waitErr != nil {
			current.Error = waitErr.Error()
		}
	}, "exit", state.Event{
		PID:                   managed.pid,
		Code:                  &exitCode,
		Signal:                signal,
		StoppedByUser:         stoppedByUser,
		AutomationExitMatched: automationExitMatched,
	})

	supervisor.mutex.Lock()
	delete(supervisor.processes, run.ID)
	supervisor.mutex.Unlock()
}

func (supervisor *Supervisor) completeRecoveredStop(run state.Run, options StopOptions) (state.Run, error) {
	endedAt := time.Now().UTC().Format(time.RFC3339Nano)
	updated, err := supervisor.store.UpdateRunAndAppendEvent(run.ID, func(current *state.Run) {
		current.Status = state.RunStatusStopped
		current.EndedAt = endedAt
		current.StoppedByUser = options.StoppedByUser
		current.AutomationExitMatched = options.AutomationExitMatched
		if options.AutomationExitMatched {
			current.Status = state.RunStatusExited
		}
	}, "exit", state.Event{
		PID:                   run.PID,
		StoppedByUser:         options.StoppedByUser,
		AutomationExitMatched: options.AutomationExitMatched,
	})
	if err != nil {
		return state.Run{}, err
	}
	supervisor.mutex.Lock()
	delete(supervisor.processes, run.ID)
	supervisor.mutex.Unlock()
	supervisor.recordRecoveredTerminalRun(updated)
	return updated, nil
}

func (supervisor *Supervisor) recordRecoveredTerminalRun(run state.Run) {
	supervisor.mutex.Lock()
	supervisor.recoveredTerminalRuns = append(supervisor.recoveredTerminalRuns, run)
	supervisor.mutex.Unlock()
}

func (supervisor *Supervisor) removeManagedProcess(runID string) {
	supervisor.mutex.Lock()
	delete(supervisor.processes, runID)
	supervisor.mutex.Unlock()
}

func (supervisor *Supervisor) markLost(run state.Run, message string) (state.Run, error) {
	endedAt := time.Now().UTC().Format(time.RFC3339Nano)
	updated, err := supervisor.store.UpdateRunAndAppendEvent(run.ID, func(current *state.Run) {
		current.Status = state.RunStatusLost
		current.EndedAt = endedAt
		current.Error = message
	}, "error", state.Event{PID: run.PID, Message: message})
	if err != nil {
		return state.Run{}, err
	}
	supervisor.mutex.Lock()
	delete(supervisor.processes, run.ID)
	supervisor.mutex.Unlock()
	return updated, nil
}

func (supervisor *Supervisor) appendEvent(run state.Run, eventType string, fields state.Event) {
	_, _ = supervisor.store.AppendEvent(state.Event{
		Timestamp:             time.Now().UTC().Format(time.RFC3339Nano),
		Type:                  eventType,
		RunID:                 run.ID,
		ProjectID:             run.ProjectID,
		ScriptID:              run.ScriptID,
		PID:                   fields.PID,
		Message:               fields.Message,
		Cwd:                   fields.Cwd,
		Code:                  fields.Code,
		Signal:                fields.Signal,
		StoppedByUser:         fields.StoppedByUser,
		AutomationExitMatched: fields.AutomationExitMatched,
		AutomationRunID:       run.AutomationRunID,
	})
}

func validateStartRequest(request StartRequest) error {
	if strings.TrimSpace(request.ProjectID) == "" || strings.TrimSpace(request.ScriptID) == "" {
		return errors.New("project and script ids are required")
	}
	if strings.TrimSpace(request.Command) == "" {
		return errors.New("command is required")
	}
	if strings.TrimSpace(request.Cwd) == "" {
		return errors.New("working directory is required")
	}
	if strings.TrimSpace(request.Label) == "" {
		return errors.New("run label is required")
	}
	if strings.TrimSpace(request.IdempotencyKey) == "" {
		return errors.New("idempotency key is required")
	}
	if strings.TrimSpace(request.RequestFingerprint) == "" {
		return errors.New("request fingerprint is required")
	}
	directoryInfo, err := os.Stat(request.Cwd)
	if err != nil {
		return fmt.Errorf("read working directory: %w", err)
	}
	if !directoryInfo.IsDir() {
		return errors.New("working directory must be a directory")
	}
	for key := range request.Env {
		if strings.TrimSpace(key) == "" || strings.ContainsAny(key, "=\x00") {
			return fmt.Errorf("environment key %q is invalid", key)
		}
	}

	return nil
}
