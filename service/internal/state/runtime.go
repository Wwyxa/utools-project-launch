package state

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	LogDirectoryName                  = "logs"
	RuntimeStateSchema                = 2
	MaxPersistedEvents                = 512
	MaxEventMessageBytes              = 16 * 1024
	MaxRunLogBytes              int64 = 5 * 1024 * 1024
	MaxTotalLogBytes            int64 = 100 * 1024 * 1024
	MaxRunLogFiles                    = 200
	MaxRunHistory                     = 200
	MaxIdempotencyKeys                = 512
	MaxAutomationHistoryPerTask       = 20
)

var ErrIdempotencyConflict = errors.New("idempotency key was reused with a different request")
var ErrActiveRunConflict = errors.New("an active run already exists for this project and script")
var ErrAutomationRevisionConflict = errors.New("automation revision is stale or conflicts with persisted configuration")
var ErrRunLogUnavailable = errors.New("run log is unavailable")

var ErrAutomationExecutionInvalid = errors.New("automation execution is invalid")

type RunStatus string

const (
	RunStatusStarting RunStatus = "starting"
	RunStatusRunning  RunStatus = "running"
	RunStatusStopping RunStatus = "stopping"
	RunStatusStopped  RunStatus = "stopped"
	RunStatusExited   RunStatus = "exited"
	RunStatusFailed   RunStatus = "failed"
	RunStatusLost     RunStatus = "lost"
)

func (status RunStatus) IsActive() bool {
	return status == RunStatusStarting || status == RunStatusRunning || status == RunStatusStopping
}

type Run struct {
	ID                    string    `json:"id"`
	ProjectID             string    `json:"projectId"`
	ScriptID              string    `json:"scriptId"`
	Label                 string    `json:"label"`
	Command               string    `json:"command"`
	Cwd                   string    `json:"cwd"`
	PID                   int       `json:"pid,omitempty"`
	Status                RunStatus `json:"status"`
	StartedAt             string    `json:"startedAt"`
	EndedAt               string    `json:"endedAt,omitempty"`
	Code                  *int      `json:"code,omitempty"`
	Signal                string    `json:"signal,omitempty"`
	Error                 string    `json:"error,omitempty"`
	StoppedByUser         bool      `json:"stoppedByUser,omitempty"`
	AutomationExitMatched bool      `json:"automationExitMatched,omitempty"`
	AutomationRunID       string    `json:"automationRunId,omitempty"`
	ProcessIdentity       string    `json:"processIdentity,omitempty"`
	OutputTruncated       bool      `json:"outputTruncated,omitempty"`
}

type Event struct {
	Cursor                uint64 `json:"cursor"`
	Timestamp             string `json:"timestamp"`
	Type                  string `json:"type"`
	RunID                 string `json:"runId"`
	ProjectID             string `json:"projectId"`
	ScriptID              string `json:"scriptId"`
	PID                   int    `json:"pid,omitempty"`
	Message               string `json:"message,omitempty"`
	Cwd                   string `json:"cwd,omitempty"`
	Code                  *int   `json:"code,omitempty"`
	Signal                string `json:"signal,omitempty"`
	StoppedByUser         bool   `json:"stoppedByUser,omitempty"`
	AutomationExitMatched bool   `json:"automationExitMatched,omitempty"`
	AutomationRunID       string `json:"automationRunId,omitempty"`
}

type IdempotencyClaim struct {
	RequestFingerprint string `json:"requestFingerprint"`
	RunID              string `json:"runId"`
	CreatedAt          string `json:"createdAt"`
}

type RuntimeState struct {
	SchemaVersion     int                         `json:"schemaVersion"`
	NextCursor        uint64                      `json:"nextCursor"`
	Runs              []Run                       `json:"runs"`
	Events            []Event                     `json:"events"`
	IdempotencyClaims map[string]IdempotencyClaim `json:"idempotencyClaims"`
	Automation        AutomationState             `json:"automation"`
}

type AutomationState struct {
	Revision   uint64                `json:"revision"`
	Config     json.RawMessage       `json:"-"`
	Executions []AutomationExecution `json:"executions,omitempty"`
}

type persistedRuntimeState struct {
	SchemaVersion     int                         `json:"schemaVersion"`
	NextCursor        uint64                      `json:"nextCursor"`
	Runs              []Run                       `json:"runs"`
	Events            []Event                     `json:"events"`
	IdempotencyClaims map[string]IdempotencyClaim `json:"idempotencyClaims"`
	Automation        persistedAutomationState    `json:"automation"`
}

type persistedAutomationState struct {
	Revision        uint64                `json:"revision"`
	Config          json.RawMessage       `json:"config,omitempty"`
	EncryptedConfig string                `json:"encryptedConfig,omitempty"`
	Executions      []AutomationExecution `json:"executions,omitempty"`
}

type AutomationExecutionStatus string

const (
	AutomationExecutionRunning   AutomationExecutionStatus = "running"
	AutomationExecutionCompleted AutomationExecutionStatus = "completed"
	AutomationExecutionFailed    AutomationExecutionStatus = "failed"
	AutomationExecutionSkipped   AutomationExecutionStatus = "skipped"
	AutomationExecutionMissed    AutomationExecutionStatus = "missed"
)

type AutomationScriptResultStatus string

const (
	AutomationScriptCompleted AutomationScriptResultStatus = "completed"
	AutomationScriptFailed    AutomationScriptResultStatus = "failed"
	AutomationScriptSkipped   AutomationScriptResultStatus = "skipped"
	AutomationScriptTimeout   AutomationScriptResultStatus = "timeout"
	AutomationScriptStopped   AutomationScriptResultStatus = "stopped"
)

type AutomationScriptResult struct {
	ScriptID   string                       `json:"scriptId"`
	ScriptName string                       `json:"scriptName,omitempty"`
	Status     AutomationScriptResultStatus `json:"status"`
	StartedAt  string                       `json:"startedAt,omitempty"`
	EndedAt    string                       `json:"endedAt,omitempty"`
	Reason     string                       `json:"reason,omitempty"`
}

type AutomationExecution struct {
	ID                 string                    `json:"id"`
	ProjectID          string                    `json:"projectId"`
	TaskID             string                    `json:"taskId"`
	PlanEntryID        string                    `json:"planEntryId"`
	PlannedAt          string                    `json:"plannedAt,omitempty"`
	Status             AutomationExecutionStatus `json:"status"`
	CurrentScriptIndex int                       `json:"currentScriptIndex"`
	ActiveRunID        string                    `json:"activeRunId,omitempty"`
	StartedAt          string                    `json:"startedAt,omitempty"`
	EndedAt            string                    `json:"endedAt,omitempty"`
	Reason             string                    `json:"reason,omitempty"`
	ScriptResults      []AutomationScriptResult  `json:"scriptResults"`
}

type Snapshot struct {
	Runs           []Run  `json:"runs"`
	LatestCursor   uint64 `json:"latestCursor"`
	EarliestCursor uint64 `json:"earliestCursor"`
}

type EventBatch struct {
	Events         []Event `json:"events"`
	LatestCursor   uint64  `json:"latestCursor"`
	EarliestCursor uint64  `json:"earliestCursor"`
	Truncated      bool    `json:"truncated"`
	NextCursor     uint64  `json:"nextCursor"`
	HasMore        bool    `json:"hasMore"`
}

type RunLog struct {
	RunID     string  `json:"runId"`
	Events    []Event `json:"events"`
	Truncated bool    `json:"truncated"`
	SizeBytes int64   `json:"sizeBytes"`
}

type Store struct {
	stateDir  string
	secretKey [32]byte
	mutex     sync.RWMutex
	data      RuntimeState
}

func Open(stateDir string) (*Store, error) {
	if err := EnsureDirectory(stateDir); err != nil {
		return nil, err
	}
	token, err := LoadOrCreateToken(stateDir)
	if err != nil {
		return nil, err
	}

	store := &Store{stateDir: stateDir, secretKey: runtimeStateSecretKey(token)}
	contents, err := os.ReadFile(store.statePath())
	if errors.Is(err, os.ErrNotExist) {
		store.data = newRuntimeState()
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read runtime state: %w", err)
	}
	data, migrated, err := decodePersistedRuntimeState(contents, store.secretKey)
	if err != nil {
		return nil, err
	}
	store.data = data
	if err := store.normalizeLoadedState(); err != nil {
		return nil, err
	}
	if err := store.trimRunLogsLocked(); err != nil {
		return nil, err
	}
	if migrated {
		if err := store.persistLocked(); err != nil {
			return nil, fmt.Errorf("migrate runtime state: %w", err)
		}
	}

	return store, nil
}

func NewRunID() (string, error) {
	randomBytes := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, randomBytes); err != nil {
		return "", fmt.Errorf("generate run id: %w", err)
	}

	return hex.EncodeToString(randomBytes), nil
}

func (store *Store) CreateRun(run Run, idempotencyKey string, requestFingerprint string) (Run, bool, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	if strings.TrimSpace(idempotencyKey) == "" {
		return Run{}, false, errors.New("idempotency key is required")
	}
	if strings.TrimSpace(requestFingerprint) == "" {
		return Run{}, false, errors.New("request fingerprint is required")
	}

	keyHash := hashValue(idempotencyKey)
	if claim, found := store.data.IdempotencyClaims[keyHash]; found {
		if claim.RequestFingerprint != requestFingerprint {
			return Run{}, false, ErrIdempotencyConflict
		}
		if existing, found := findRun(store.data.Runs, claim.RunID); found {
			return cloneRun(existing), false, nil
		}
		delete(store.data.IdempotencyClaims, keyHash)
	}
	for _, existing := range store.data.Runs {
		if existing.ProjectID == run.ProjectID && existing.ScriptID == run.ScriptID && existing.Status.IsActive() {
			return cloneRun(existing), false, ErrActiveRunConflict
		}
	}

	store.data.Runs = append(store.data.Runs, cloneRun(run))
	store.data.IdempotencyClaims[keyHash] = IdempotencyClaim{
		RequestFingerprint: requestFingerprint,
		RunID:              run.ID,
		CreatedAt:          time.Now().UTC().Format(time.RFC3339Nano),
	}
	store.trimRunHistoryLocked()
	store.trimIdempotencyClaimsLocked()
	if err := store.persistLocked(); err != nil {
		return Run{}, false, err
	}

	return cloneRun(run), true, nil
}

func (store *Store) Run(runID string) (Run, bool) {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	run, found := findRun(store.data.Runs, runID)
	return cloneRun(run), found
}

func (store *Store) ActiveRuns() []Run {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	runs := make([]Run, 0)
	for _, run := range store.data.Runs {
		if run.Status.IsActive() {
			runs = append(runs, cloneRun(run))
		}
	}
	return runs
}

func (store *Store) Automation() AutomationState {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	return AutomationState{
		Revision:   store.data.Automation.Revision,
		Config:     append(json.RawMessage(nil), store.data.Automation.Config...),
		Executions: cloneAutomationExecutions(store.data.Automation.Executions),
	}
}

func (store *Store) ReplaceAutomation(revision uint64, config json.RawMessage) (AutomationState, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	if revision == 0 {
		return AutomationState{}, errors.New("automation revision must be positive")
	}
	if len(config) == 0 {
		return AutomationState{}, errors.New("automation configuration is required")
	}
	if !json.Valid(config) {
		return AutomationState{}, errors.New("automation configuration must be valid JSON")
	}
	if revision < store.data.Automation.Revision {
		return AutomationState{}, ErrAutomationRevisionConflict
	}
	if revision == store.data.Automation.Revision && !bytes.Equal(config, store.data.Automation.Config) {
		return AutomationState{}, ErrAutomationRevisionConflict
	}

	store.data.Automation = AutomationState{
		Revision:   revision,
		Config:     append(json.RawMessage(nil), config...),
		Executions: cloneAutomationExecutions(store.data.Automation.Executions),
	}
	if err := store.persistLocked(); err != nil {
		return AutomationState{}, fmt.Errorf("write automation configuration: %w", err)
	}

	return AutomationState{
		Revision:   store.data.Automation.Revision,
		Config:     append(json.RawMessage(nil), store.data.Automation.Config...),
		Executions: cloneAutomationExecutions(store.data.Automation.Executions),
	}, nil
}

func (store *Store) ClaimAutomationExecution(revision uint64, execution AutomationExecution) (AutomationExecution, bool, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	if revision == 0 || store.data.Automation.Revision != revision {
		return AutomationExecution{}, false, ErrAutomationRevisionConflict
	}
	if strings.TrimSpace(execution.ID) == "" ||
		strings.TrimSpace(execution.ProjectID) == "" ||
		strings.TrimSpace(execution.TaskID) == "" ||
		strings.TrimSpace(execution.PlanEntryID) == "" {
		return AutomationExecution{}, false, ErrAutomationExecutionInvalid
	}
	if execution.Status == "" {
		execution.Status = AutomationExecutionRunning
	}
	if execution.Status != AutomationExecutionRunning &&
		execution.Status != AutomationExecutionSkipped &&
		execution.Status != AutomationExecutionMissed {
		return AutomationExecution{}, false, ErrAutomationExecutionInvalid
	}
	if execution.ScriptResults == nil {
		execution.ScriptResults = []AutomationScriptResult{}
	}

	for _, existing := range store.data.Automation.Executions {
		if existing.ProjectID == execution.ProjectID &&
			existing.TaskID == execution.TaskID &&
			existing.PlanEntryID == execution.PlanEntryID {
			return cloneAutomationExecution(existing), false, nil
		}
		if existing.ProjectID == execution.ProjectID &&
			existing.Status == AutomationExecutionRunning &&
			execution.Status == AutomationExecutionRunning {
			return cloneAutomationExecution(existing), false, nil
		}
	}

	store.data.Automation.Executions = append(store.data.Automation.Executions, cloneAutomationExecution(execution))
	store.trimAutomationExecutionsLocked()
	if err := store.persistLocked(); err != nil {
		return AutomationExecution{}, false, fmt.Errorf("write automation execution claim: %w", err)
	}

	return cloneAutomationExecution(execution), true, nil
}

func (store *Store) UpdateAutomationExecution(executionID string, mutate func(*AutomationExecution)) (AutomationExecution, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	for index := range store.data.Automation.Executions {
		if store.data.Automation.Executions[index].ID != executionID {
			continue
		}
		mutate(&store.data.Automation.Executions[index])
		if store.data.Automation.Executions[index].ScriptResults == nil {
			store.data.Automation.Executions[index].ScriptResults = []AutomationScriptResult{}
		}
		store.trimAutomationExecutionsLocked()
		if err := store.persistLocked(); err != nil {
			return AutomationExecution{}, fmt.Errorf("write automation execution: %w", err)
		}
		return cloneAutomationExecution(store.data.Automation.Executions[index]), nil
	}

	return AutomationExecution{}, fmt.Errorf("automation execution %q was not found", executionID)
}

func (store *Store) UpdateRun(runID string, mutate func(*Run)) (Run, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	for index := range store.data.Runs {
		if store.data.Runs[index].ID != runID {
			continue
		}
		mutate(&store.data.Runs[index])
		if err := store.persistLocked(); err != nil {
			return Run{}, err
		}
		return cloneRun(store.data.Runs[index]), nil
	}

	return Run{}, fmt.Errorf("run %q was not found", runID)
}

func (store *Store) UpdateRunAndAppendEvent(
	runID string,
	mutate func(*Run),
	eventType string,
	fields Event,
) (Run, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	for index := range store.data.Runs {
		if store.data.Runs[index].ID != runID {
			continue
		}

		mutate(&store.data.Runs[index])
		event, err := store.prepareEventLocked(Event{
			Timestamp:             time.Now().UTC().Format(time.RFC3339Nano),
			Type:                  eventType,
			RunID:                 store.data.Runs[index].ID,
			ProjectID:             store.data.Runs[index].ProjectID,
			ScriptID:              store.data.Runs[index].ScriptID,
			PID:                   fields.PID,
			Message:               fields.Message,
			Cwd:                   fields.Cwd,
			Code:                  fields.Code,
			Signal:                fields.Signal,
			StoppedByUser:         fields.StoppedByUser,
			AutomationExitMatched: fields.AutomationExitMatched,
			AutomationRunID:       store.data.Runs[index].AutomationRunID,
		})
		if err != nil {
			return Run{}, err
		}
		if err := store.persistLocked(); err != nil {
			return Run{}, err
		}
		if err := store.appendRunLogLocked(event); err != nil {
			return Run{}, err
		}
		return cloneRun(store.data.Runs[index]), nil
	}

	return Run{}, fmt.Errorf("run %q was not found", runID)
}

func (store *Store) AppendEvent(event Event) (Event, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	prepared, err := store.prepareEventLocked(event)
	if err != nil {
		return Event{}, err
	}
	if err := store.persistLocked(); err != nil {
		return Event{}, err
	}
	if err := store.appendRunLogLocked(prepared); err != nil {
		return cloneEvent(prepared), err
	}

	return cloneEvent(prepared), nil
}

func (store *Store) prepareEventLocked(event Event) (Event, error) {
	if strings.TrimSpace(event.Type) == "" {
		return Event{}, errors.New("event type is required")
	}
	if strings.TrimSpace(event.RunID) == "" {
		return Event{}, errors.New("event run id is required")
	}
	if strings.TrimSpace(event.Timestamp) == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}

	event.Cursor = store.data.NextCursor
	store.data.NextCursor += 1
	truncatedMessage, messageWasTruncated := truncateMessage(event.Message)
	event.Message = truncatedMessage
	if messageWasTruncated {
		for index := range store.data.Runs {
			if store.data.Runs[index].ID == event.RunID {
				store.data.Runs[index].OutputTruncated = true
				break
			}
		}
	}

	store.data.Events = append(store.data.Events, cloneEvent(event))
	if len(store.data.Events) > MaxPersistedEvents {
		store.data.Events = append([]Event(nil), store.data.Events[len(store.data.Events)-MaxPersistedEvents:]...)
	}

	return cloneEvent(event), nil
}

func (store *Store) Snapshot() Snapshot {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	return Snapshot{
		Runs:           cloneRuns(store.data.Runs),
		LatestCursor:   latestCursor(store.data),
		EarliestCursor: earliestCursor(store.data),
	}
}

func (store *Store) EventsAfter(after uint64) EventBatch {
	return store.eventsAfter(after, 0)
}

func (store *Store) EventsAfterPage(after uint64, maxBytes int) EventBatch {
	return store.eventsAfter(after, maxBytes)
}

func (store *Store) ReadRunLog(runID string) (RunLog, error) {
	if !isSafeRunID(runID) {
		return RunLog{}, ErrRunLogUnavailable
	}

	store.mutex.RLock()
	run, found := findRun(store.data.Runs, runID)
	if !found {
		store.mutex.RUnlock()
		return RunLog{}, ErrRunLogUnavailable
	}
	logPath := filepath.Join(store.logDirectoryPath(), runID+".log")
	logFile, err := os.Open(logPath)
	if err != nil {
		store.mutex.RUnlock()
		if errors.Is(err, os.ErrNotExist) {
			return RunLog{}, ErrRunLogUnavailable
		}
		return RunLog{}, fmt.Errorf("open run log: %w", err)
	}
	contents, readErr := io.ReadAll(io.LimitReader(logFile, MaxRunLogBytes+1))
	closeErr := logFile.Close()
	store.mutex.RUnlock()
	if readErr != nil {
		return RunLog{}, fmt.Errorf("read run log: %w", readErr)
	}
	if closeErr != nil {
		return RunLog{}, fmt.Errorf("close run log: %w", closeErr)
	}
	if int64(len(contents)) > MaxRunLogBytes {
		return RunLog{}, errors.New("run log exceeds the retained size limit")
	}

	lines := bytes.Split(contents, []byte{'\n'})
	lastRecordIndex := -1
	for index, line := range lines {
		if len(bytes.TrimSpace(line)) > 0 {
			lastRecordIndex = index
		}
	}

	events := make([]Event, 0)
	truncated := run.OutputTruncated
	for index, line := range lines {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var event Event
		if err := json.Unmarshal(line, &event); err != nil {
			if index == lastRecordIndex {
				truncated = true
				break
			}
			return RunLog{}, fmt.Errorf("decode run log event: %w", err)
		}
		if event.RunID != runID {
			return RunLog{}, errors.New("run log contains an event for another run")
		}
		events = append(events, cloneEvent(event))
	}

	return RunLog{
		RunID:     runID,
		Events:    events,
		Truncated: truncated,
		SizeBytes: int64(len(contents)),
	}, nil
}

func (store *Store) eventsAfter(after uint64, maxBytes int) EventBatch {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	earliest := earliestCursor(store.data)
	batch := EventBatch{
		LatestCursor:   latestCursor(store.data),
		EarliestCursor: earliest,
		Truncated:      earliest > 0 && after+1 < earliest,
		NextCursor:     after,
	}
	for _, event := range store.data.Events {
		if event.Cursor <= after {
			continue
		}

		candidate := cloneEvent(event)
		candidateBatch := batch
		candidateBatch.Events = append(candidateBatch.Events, candidate)
		candidateBatch.NextCursor = candidate.Cursor
		candidateBatch.HasMore = true
		if maxBytes > 0 && len(batch.Events) > 0 && eventBatchJSONSize(candidateBatch) > maxBytes {
			batch.HasMore = true
			break
		}
		candidateBatch.HasMore = false
		batch.Events = candidateBatch.Events
		batch.NextCursor = candidate.Cursor
	}

	return batch
}

func eventBatchJSONSize(batch EventBatch) int {
	encoded, err := json.Marshal(batch)
	if err != nil {
		return 0
	}
	return len(encoded)
}

func (store *Store) statePath() string {
	return filepath.Join(store.stateDir, StateFileName)
}

func (store *Store) logDirectoryPath() string {
	return filepath.Join(store.stateDir, LogDirectoryName)
}

func (store *Store) normalizeLoadedState() error {
	if store.data.SchemaVersion != RuntimeStateSchema {
		return fmt.Errorf("unsupported runtime state schema %d", store.data.SchemaVersion)
	}
	if store.data.Runs == nil {
		store.data.Runs = []Run{}
	}
	if store.data.Events == nil {
		store.data.Events = []Event{}
	}
	if store.data.IdempotencyClaims == nil {
		store.data.IdempotencyClaims = map[string]IdempotencyClaim{}
	}
	if store.data.Automation.Executions == nil {
		store.data.Automation.Executions = []AutomationExecution{}
	}
	if store.data.NextCursor == 0 {
		store.data.NextCursor = 1
	}
	if store.data.Automation.Revision > 0 && len(store.data.Automation.Config) == 0 {
		return errors.New("runtime state automation configuration is missing")
	}
	if len(store.data.Automation.Config) > 0 && !json.Valid(store.data.Automation.Config) {
		return errors.New("runtime state automation configuration is invalid")
	}

	return nil
}

func (store *Store) persistLocked() error {
	contents, err := marshalPersistedRuntimeState(store.data, store.secretKey)
	if err != nil {
		return fmt.Errorf("encode runtime state: %w", err)
	}
	if err := writeFileAtomic(store.statePath(), append(contents, '\n'), 0o600); err != nil {
		return fmt.Errorf("write runtime state: %w", err)
	}

	return nil
}

func (store *Store) appendRunLogLocked(event Event) error {
	if !isSafeRunID(event.RunID) {
		return errors.New("event run id is not safe for log persistence")
	}
	if err := os.MkdirAll(store.logDirectoryPath(), 0o700); err != nil {
		return fmt.Errorf("create run log directory: %w", err)
	}

	contents, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("encode run event: %w", err)
	}
	logPath := filepath.Join(store.logDirectoryPath(), event.RunID+".log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open run log: %w", err)
	}
	if _, err := logFile.Write(append(contents, '\n')); err != nil {
		_ = logFile.Close()
		return fmt.Errorf("append run log: %w", err)
	}
	if err := logFile.Close(); err != nil {
		return fmt.Errorf("close run log: %w", err)
	}
	truncated, err := truncateFileTail(logPath, MaxRunLogBytes)
	if err != nil {
		return err
	}
	if truncated && store.markRunOutputTruncatedLocked(event.RunID) {
		if err := store.persistLocked(); err != nil {
			return err
		}
	}
	if err := store.trimRunLogsLocked(); err != nil {
		return err
	}

	return nil
}

func (store *Store) trimRunLogsLocked() error {
	return store.trimRunLogsToLimitsLocked(MaxTotalLogBytes, MaxRunLogFiles)
}

func (store *Store) trimTotalLogsToLimitLocked(maxTotalLogBytes int64) error {
	return store.trimRunLogsToLimitsLocked(maxTotalLogBytes, MaxRunLogFiles)
}

func (store *Store) trimRunLogsToLimitsLocked(maxTotalLogBytes int64, maxLogFiles int) error {
	if maxTotalLogBytes < 0 {
		return errors.New("total run log limit must not be negative")
	}
	if maxLogFiles < 0 {
		return errors.New("run log file limit must not be negative")
	}

	entries, err := os.ReadDir(store.logDirectoryPath())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("list run logs: %w", err)
	}

	activeRunIDs := make(map[string]bool)
	for _, run := range store.data.Runs {
		if run.Status.IsActive() {
			activeRunIDs[run.ID] = true
		}
	}
	type logFileInfo struct {
		runID    string
		path     string
		size     int64
		modified time.Time
		active   bool
	}
	files := make([]logFileInfo, 0, len(entries))
	var totalSize int64
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".log" {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("read run log metadata: %w", err)
		}
		runID := strings.TrimSuffix(entry.Name(), ".log")
		files = append(files, logFileInfo{
			runID:    runID,
			path:     filepath.Join(store.logDirectoryPath(), entry.Name()),
			size:     info.Size(),
			modified: info.ModTime(),
			active:   activeRunIDs[runID],
		})
		totalSize += info.Size()
	}
	sort.Slice(files, func(left, right int) bool {
		if files[left].active != files[right].active {
			return !files[left].active
		}
		return files[left].modified.Before(files[right].modified)
	})

	retainedFileCount := len(files)
	runtimeStateChanged := false
	for index := range files {
		if totalSize <= maxTotalLogBytes && retainedFileCount <= maxLogFiles {
			break
		}
		file := files[index]
		if !file.active {
			if err := os.Remove(file.path); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove retained run log: %w", err)
			}
			totalSize -= file.size
			retainedFileCount -= 1
			continue
		}
		if totalSize <= maxTotalLogBytes {
			break
		}

		targetSize := file.size - (totalSize - maxTotalLogBytes)
		if targetSize < 0 {
			targetSize = 0
		}
		truncated, err := truncateFileTail(file.path, targetSize)
		if err != nil {
			return err
		}
		if truncated && store.markRunOutputTruncatedLocked(file.runID) {
			runtimeStateChanged = true
		}
		updatedInfo, err := os.Stat(file.path)
		if err != nil {
			return fmt.Errorf("read truncated run log metadata: %w", err)
		}
		totalSize -= file.size - updatedInfo.Size()
	}
	if runtimeStateChanged {
		if err := store.persistLocked(); err != nil {
			return err
		}
	}
	if totalSize > maxTotalLogBytes {
		return fmt.Errorf("retained run logs remain above total limit: %d > %d", totalSize, maxTotalLogBytes)
	}

	return nil
}

func (store *Store) markRunOutputTruncatedLocked(runID string) bool {
	for index := range store.data.Runs {
		if store.data.Runs[index].ID == runID && !store.data.Runs[index].OutputTruncated {
			store.data.Runs[index].OutputTruncated = true
			return true
		}
	}
	return false
}

func (store *Store) trimRunHistoryLocked() {
	if len(store.data.Runs) <= MaxRunHistory {
		return
	}
	activeRuns := make([]Run, 0, len(store.data.Runs))
	completedRuns := make([]Run, 0, len(store.data.Runs))
	for _, run := range store.data.Runs {
		if run.Status.IsActive() {
			activeRuns = append(activeRuns, run)
			continue
		}
		completedRuns = append(completedRuns, run)
	}
	remainingCompleted := MaxRunHistory - len(activeRuns)
	if remainingCompleted < 0 {
		remainingCompleted = 0
	}
	if len(completedRuns) > remainingCompleted {
		completedRuns = completedRuns[len(completedRuns)-remainingCompleted:]
	}
	store.data.Runs = append(activeRuns, completedRuns...)
}

func (store *Store) trimIdempotencyClaimsLocked() {
	if len(store.data.IdempotencyClaims) <= MaxIdempotencyKeys {
		return
	}
	validRunIDs := make(map[string]bool, len(store.data.Runs))
	for _, run := range store.data.Runs {
		validRunIDs[run.ID] = true
	}
	for key, claim := range store.data.IdempotencyClaims {
		if !validRunIDs[claim.RunID] {
			delete(store.data.IdempotencyClaims, key)
		}
	}
	if len(store.data.IdempotencyClaims) <= MaxIdempotencyKeys {
		return
	}

	keys := make([]string, 0, len(store.data.IdempotencyClaims))
	for key := range store.data.IdempotencyClaims {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys[:len(store.data.IdempotencyClaims)-MaxIdempotencyKeys] {
		delete(store.data.IdempotencyClaims, key)
	}
}

func (store *Store) trimAutomationExecutionsLocked() {
	if len(store.data.Automation.Executions) == 0 {
		return
	}

	retained := make([]AutomationExecution, 0, len(store.data.Automation.Executions))
	terminalCounts := map[string]int{}
	for index := len(store.data.Automation.Executions) - 1; index >= 0; index-- {
		execution := store.data.Automation.Executions[index]
		if execution.Status == AutomationExecutionRunning {
			retained = append(retained, execution)
			continue
		}
		key := execution.ProjectID + "\x00" + execution.TaskID
		if terminalCounts[key] >= MaxAutomationHistoryPerTask {
			continue
		}
		terminalCounts[key] += 1
		retained = append(retained, execution)
	}

	for left, right := 0, len(retained)-1; left < right; left, right = left+1, right-1 {
		retained[left], retained[right] = retained[right], retained[left]
	}
	store.data.Automation.Executions = retained
}

func newRuntimeState() RuntimeState {
	return RuntimeState{
		SchemaVersion:     RuntimeStateSchema,
		NextCursor:        1,
		Runs:              []Run{},
		Events:            []Event{},
		IdempotencyClaims: map[string]IdempotencyClaim{},
		Automation:        AutomationState{},
	}
}

func findRun(runs []Run, runID string) (Run, bool) {
	for _, run := range runs {
		if run.ID == runID {
			return run, true
		}
	}
	return Run{}, false
}

func latestCursor(data RuntimeState) uint64 {
	if data.NextCursor == 0 {
		return 0
	}
	return data.NextCursor - 1
}

func earliestCursor(data RuntimeState) uint64 {
	if len(data.Events) == 0 {
		return 0
	}
	return data.Events[0].Cursor
}

func truncateMessage(message string) (string, bool) {
	if len(message) <= MaxEventMessageBytes {
		return message, false
	}
	return message[:MaxEventMessageBytes] + "\n[output truncated]", true
}

func truncateFileTail(filePath string, limit int64) (bool, error) {
	if limit < 0 {
		return false, errors.New("run log limit must not be negative")
	}
	info, err := os.Stat(filePath)
	if err != nil {
		return false, fmt.Errorf("read run log size: %w", err)
	}
	if info.Size() <= limit {
		return false, nil
	}

	file, err := os.Open(filePath)
	if err != nil {
		return false, fmt.Errorf("open oversized run log: %w", err)
	}
	startOffset := info.Size() - limit
	startsAtRecordBoundary := startOffset == 0
	if startOffset > 0 {
		if _, err := file.Seek(startOffset-1, io.SeekStart); err != nil {
			_ = file.Close()
			return false, fmt.Errorf("seek oversized run log boundary: %w", err)
		}
		previousByte := []byte{0}
		if _, err := io.ReadFull(file, previousByte); err != nil {
			_ = file.Close()
			return false, fmt.Errorf("read oversized run log boundary: %w", err)
		}
		startsAtRecordBoundary = previousByte[0] == '\n'
	}
	if _, err := file.Seek(startOffset, io.SeekStart); err != nil {
		_ = file.Close()
		return false, fmt.Errorf("seek oversized run log: %w", err)
	}
	tail, err := io.ReadAll(file)
	if err != nil {
		_ = file.Close()
		return false, fmt.Errorf("read oversized run log: %w", err)
	}
	if err := file.Close(); err != nil {
		return false, fmt.Errorf("close oversized run log: %w", err)
	}
	if !startsAtRecordBoundary {
		if newlineIndex := bytes.IndexByte(tail, '\n'); newlineIndex >= 0 {
			tail = tail[newlineIndex+1:]
		} else {
			tail = nil
		}
	}
	if lastNewlineIndex := bytes.LastIndexByte(tail, '\n'); lastNewlineIndex >= 0 {
		tail = tail[:lastNewlineIndex+1]
	} else {
		tail = nil
	}
	if err := writeFileAtomic(filePath, tail, 0o600); err != nil {
		return false, fmt.Errorf("truncate run log: %w", err)
	}

	return true, nil
}

func isSafeRunID(runID string) bool {
	if len(runID) != 32 {
		return false
	}
	for _, character := range runID {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}

func hashValue(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func (store *Store) Fingerprint(parts ...string) string {
	payload, _ := json.Marshal(parts)
	mac := hmac.New(sha256.New, store.secretKey[:])
	_, _ = mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

func runtimeStateSecretKey(token string) [32]byte {
	return sha256.Sum256([]byte("project-launch-service/runtime-state/v1\x00" + token))
}

func decodePersistedRuntimeState(contents []byte, secretKey [32]byte) (RuntimeState, bool, error) {
	var persisted persistedRuntimeState
	if err := json.Unmarshal(contents, &persisted); err != nil {
		return RuntimeState{}, false, fmt.Errorf("parse runtime state: %w", err)
	}

	data := RuntimeState{
		SchemaVersion:     persisted.SchemaVersion,
		NextCursor:        persisted.NextCursor,
		Runs:              persisted.Runs,
		Events:            persisted.Events,
		IdempotencyClaims: persisted.IdempotencyClaims,
		Automation: AutomationState{
			Revision:   persisted.Automation.Revision,
			Executions: persisted.Automation.Executions,
		},
	}

	switch persisted.SchemaVersion {
	case 1:
		data.SchemaVersion = RuntimeStateSchema
		data.Automation.Config = append(json.RawMessage(nil), persisted.Automation.Config...)
		return data, true, nil
	case RuntimeStateSchema:
		if len(persisted.Automation.Config) > 0 {
			return RuntimeState{}, false, errors.New("runtime state automation configuration must be encrypted")
		}
		if persisted.Automation.EncryptedConfig != "" {
			config, err := decryptAutomationConfig(secretKey, persisted.Automation.EncryptedConfig)
			if err != nil {
				return RuntimeState{}, false, fmt.Errorf("decrypt runtime state automation configuration: %w", err)
			}
			data.Automation.Config = config
		}
		return data, false, nil
	default:
		return RuntimeState{}, false, fmt.Errorf("unsupported runtime state schema %d", persisted.SchemaVersion)
	}
}

func marshalPersistedRuntimeState(data RuntimeState, secretKey [32]byte) ([]byte, error) {
	encryptedConfig := ""
	if len(data.Automation.Config) > 0 {
		var err error
		encryptedConfig, err = encryptAutomationConfig(secretKey, data.Automation.Config)
		if err != nil {
			return nil, err
		}
	}

	return json.Marshal(persistedRuntimeState{
		SchemaVersion:     RuntimeStateSchema,
		NextCursor:        data.NextCursor,
		Runs:              data.Runs,
		Events:            data.Events,
		IdempotencyClaims: data.IdempotencyClaims,
		Automation: persistedAutomationState{
			Revision:        data.Automation.Revision,
			EncryptedConfig: encryptedConfig,
			Executions:      data.Automation.Executions,
		},
	})
}

func encryptAutomationConfig(secretKey [32]byte, config json.RawMessage) (string, error) {
	block, err := aes.NewCipher(secretKey[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate automation configuration nonce: %w", err)
	}
	sealed := gcm.Seal(nonce, nonce, config, []byte("project-launch-service/automation-config/v1"))
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func decryptAutomationConfig(secretKey [32]byte, encoded string) (json.RawMessage, error) {
	sealed, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(secretKey[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(sealed) < gcm.NonceSize() {
		return nil, errors.New("encrypted automation configuration is too short")
	}
	config, err := gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], []byte("project-launch-service/automation-config/v1"))
	if err != nil {
		return nil, err
	}
	if !json.Valid(config) {
		return nil, errors.New("encrypted automation configuration is not valid JSON")
	}
	return json.RawMessage(config), nil
}

func cloneRuns(runs []Run) []Run {
	cloned := make([]Run, len(runs))
	for index, run := range runs {
		cloned[index] = cloneRun(run)
	}
	return cloned
}

func cloneRun(run Run) Run {
	cloned := run
	if run.Code != nil {
		code := *run.Code
		cloned.Code = &code
	}
	return cloned
}

func cloneEvent(event Event) Event {
	cloned := event
	if event.Code != nil {
		code := *event.Code
		cloned.Code = &code
	}
	return cloned
}

func cloneAutomationExecutions(executions []AutomationExecution) []AutomationExecution {
	cloned := make([]AutomationExecution, len(executions))
	for index, execution := range executions {
		cloned[index] = cloneAutomationExecution(execution)
	}
	return cloned
}

func cloneAutomationExecution(execution AutomationExecution) AutomationExecution {
	cloned := execution
	cloned.ScriptResults = append([]AutomationScriptResult(nil), execution.ScriptResults...)
	return cloned
}
