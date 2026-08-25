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
	MaxCompletedRunsPerProject        = MaxRunLogFiles
	MinLogRetentionBytes        int64 = 1024
	MaxLogRetentionBytes        int64 = 1024 * 1024 * 1024
	MaxRunHistory                     = 200
	MaxIdempotencyKeys                = 512
	MaxAutomationHistoryPerTask       = 20
	MaxAutomationHistory              = 200
	RunLogFlushBytes                  = 64 * 1024
	RunLogFlushInterval               = 200 * time.Millisecond
	RunLogPageBytes             int64 = 256 * 1024
	MaxDurableWriteErrorBytes         = 1024
)

var ErrIdempotencyConflict = errors.New("idempotency key was reused with a different request")
var ErrActiveRunConflict = errors.New("an active run already exists for this project and script")
var ErrAutomationRevisionConflict = errors.New("automation revision is stale or conflicts with persisted configuration")
var ErrRunLogUnavailable = errors.New("run log is unavailable")
var ErrRunLogPageInvalid = errors.New("run log page parameters are invalid")
var ErrLogRetentionPolicyInvalid = errors.New("log retention policy is invalid")

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

func (status RunStatus) IsCompleted() bool {
	return status == RunStatusStopped || status == RunStatusExited || status == RunStatusFailed || status == RunStatusLost
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
	DurableWriteError     string    `json:"durableWriteError,omitempty"`
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

type LogRetentionPolicy struct {
	Persist                    bool  `json:"persist"`
	MaxCompletedRunsPerProject int   `json:"maxCompletedRunsPerProject"`
	MaxBytesPerRun             int64 `json:"maxBytesPerRun"`
	MaxBytesTotal              int64 `json:"maxBytesTotal"`
}

type LogUsage struct {
	FileCount  int   `json:"fileCount"`
	TotalBytes int64 `json:"totalBytes"`
}

type LogRetentionStatus struct {
	Policy LogRetentionPolicy `json:"policy"`
	Usage  LogUsage           `json:"usage"`
}

type LogDescriptor struct {
	RunID     string    `json:"runId"`
	ProjectID string    `json:"projectId"`
	ScriptID  string    `json:"scriptId"`
	Label     string    `json:"label"`
	Status    RunStatus `json:"status"`
	StartedAt string    `json:"startedAt"`
	EndedAt   string    `json:"endedAt,omitempty"`
	SizeBytes int64     `json:"sizeBytes"`
	Truncated bool      `json:"truncated"`
	Available bool      `json:"available"`
}

type LogClearResult struct {
	DeletedCount  int   `json:"deletedCount"`
	ReleasedBytes int64 `json:"releasedBytes"`
}

type LogPersistenceDiagnostics struct {
	StateWrites     uint64
	RetentionPasses uint64
	DirectoryScans  uint64
	OutputFlushes   uint64
}

type retainedLogFile struct {
	runID     string
	projectID string
	path      string
	size      int64
	modified  time.Time
	active    bool
}

type runLogWriter struct {
	file       *os.File
	pending    []byte
	timer      *time.Timer
	generation uint64
	failure    error
}

func DefaultLogRetentionPolicy() LogRetentionPolicy {
	return LogRetentionPolicy{
		Persist:                    true,
		MaxCompletedRunsPerProject: MaxCompletedRunsPerProject,
		MaxBytesPerRun:             MaxRunLogBytes,
		MaxBytesTotal:              MaxTotalLogBytes,
	}
}

func validateLogRetentionPolicy(policy LogRetentionPolicy) error {
	if policy.MaxCompletedRunsPerProject < 1 || policy.MaxCompletedRunsPerProject > MaxCompletedRunsPerProject {
		return fmt.Errorf("%w: max completed runs per project must be between 1 and %d", ErrLogRetentionPolicyInvalid, MaxCompletedRunsPerProject)
	}
	if policy.MaxBytesPerRun < MinLogRetentionBytes || policy.MaxBytesPerRun > MaxLogRetentionBytes {
		return fmt.Errorf("%w: max bytes per run must be between %d and %d", ErrLogRetentionPolicyInvalid, MinLogRetentionBytes, MaxLogRetentionBytes)
	}
	if policy.MaxBytesTotal < MinLogRetentionBytes || policy.MaxBytesTotal > MaxLogRetentionBytes {
		return fmt.Errorf("%w: max total bytes must be between %d and %d", ErrLogRetentionPolicyInvalid, MinLogRetentionBytes, MaxLogRetentionBytes)
	}
	return nil
}

type RuntimeState struct {
	SchemaVersion     int                         `json:"schemaVersion"`
	NextCursor        uint64                      `json:"nextCursor"`
	Runs              []Run                       `json:"runs"`
	Events            []Event                     `json:"events"`
	IdempotencyClaims map[string]IdempotencyClaim `json:"idempotencyClaims"`
	Automation        AutomationState             `json:"automation"`
	LogRetention      LogRetentionPolicy          `json:"logRetention"`
}

type AutomationState struct {
	Revision           uint64                 `json:"revision"`
	Config             json.RawMessage        `json:"-"`
	Plans              []AutomationPlan       `json:"-"`
	PendingSubmissions []AutomationSubmission `json:"-"`
	Executions         []AutomationExecution  `json:"executions,omitempty"`
	Upcoming           []AutomationUpcoming   `json:"upcoming,omitempty"`
}

type AutomationSubmissionKind string

const (
	AutomationSubmissionManual AutomationSubmissionKind = "manual"
	AutomationSubmissionEarly  AutomationSubmissionKind = "early"
)

type AutomationSubmission struct {
	Kind        AutomationSubmissionKind `json:"kind"`
	ProjectID   string                   `json:"projectId"`
	TaskID      string                   `json:"taskId"`
	PlanEntryID string                   `json:"planEntryId"`
	PlannedAt   string                   `json:"plannedAt,omitempty"`
}

type AutomationPlanEntryStatus string

const (
	AutomationPlanEntryPending   AutomationPlanEntryStatus = "pending"
	AutomationPlanEntryRunning   AutomationPlanEntryStatus = "running"
	AutomationPlanEntryCompleted AutomationPlanEntryStatus = "completed"
	AutomationPlanEntryFailed    AutomationPlanEntryStatus = "failed"
	AutomationPlanEntrySkipped   AutomationPlanEntryStatus = "skipped"
	AutomationPlanEntryMissed    AutomationPlanEntryStatus = "missed"
)

type AutomationPlan struct {
	ProjectID string                `json:"projectId"`
	TaskID    string                `json:"taskId"`
	Date      string                `json:"date"`
	Entries   []AutomationPlanEntry `json:"entries"`
}

type AutomationPlanTask struct {
	ProjectID string
	TaskID    string
}

type AutomationPlanEntry struct {
	ID        string                    `json:"id"`
	PlannedAt string                    `json:"plannedAt"`
	Status    AutomationPlanEntryStatus `json:"status"`
	RunEarly  bool                      `json:"runEarly,omitempty"`
}

type AutomationUpcoming struct {
	ProjectID   string `json:"projectId"`
	TaskID      string `json:"taskId"`
	PlanEntryID string `json:"planEntryId"`
	PlannedAt   string `json:"plannedAt"`
}

type persistedRuntimeState struct {
	SchemaVersion     int                         `json:"schemaVersion"`
	NextCursor        uint64                      `json:"nextCursor"`
	Runs              []Run                       `json:"runs"`
	Events            []Event                     `json:"events"`
	IdempotencyClaims map[string]IdempotencyClaim `json:"idempotencyClaims"`
	Automation        persistedAutomationState    `json:"automation"`
	LogRetention      LogRetentionPolicy          `json:"logRetention"`
}

type persistedAutomationState struct {
	Revision           uint64                 `json:"revision"`
	Config             json.RawMessage        `json:"config,omitempty"`
	EncryptedConfig    string                 `json:"encryptedConfig,omitempty"`
	Plans              []AutomationPlan       `json:"plans,omitempty"`
	PendingSubmissions []AutomationSubmission `json:"pendingSubmissions,omitempty"`
	Executions         []AutomationExecution  `json:"executions,omitempty"`
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
	AutomationScriptStarted   AutomationScriptResultStatus = "started"
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
	RunID      string  `json:"runId"`
	Events     []Event `json:"events"`
	Truncated  bool    `json:"truncated"`
	SizeBytes  int64   `json:"sizeBytes"`
	HasMore    bool    `json:"hasMore,omitempty"`
	NextOffset int64   `json:"nextOffset,omitempty"`
}

type Store struct {
	stateDir   string
	secretKey  [32]byte
	mutex      sync.RWMutex
	data       RuntimeState
	liveEvents []Event
	logFiles   map[string]retainedLogFile
	logUsage   LogUsage
	writers    map[string]*runLogWriter

	nextWriterGeneration  uint64
	logFlushInterval      time.Duration
	stateWriteCount       uint64
	retentionPassCount    uint64
	logDirectoryScanCount uint64
	outputFlushCount      uint64
}

func Open(stateDir string) (*Store, error) {
	if err := EnsureDirectory(stateDir); err != nil {
		return nil, err
	}
	token, err := LoadOrCreateToken(stateDir)
	if err != nil {
		return nil, err
	}

	store := &Store{
		stateDir:         stateDir,
		secretKey:        runtimeStateSecretKey(token),
		logFiles:         map[string]retainedLogFile{},
		writers:          map[string]*runLogWriter{},
		logFlushInterval: RunLogFlushInterval,
	}
	contents, err := os.ReadFile(store.statePath())
	if errors.Is(err, os.ErrNotExist) {
		store.data = newRuntimeState()
		store.liveEvents = []Event{}
		if err := store.initializeLogAccountingLocked(); err != nil {
			return nil, err
		}
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
	if store.data.LogRetention == (LogRetentionPolicy{}) {
		store.data.LogRetention = DefaultLogRetentionPolicy()
		migrated = true
	}
	if err := store.normalizeLoadedState(); err != nil {
		return nil, err
	}
	if store.discardPersistedOutputEventsLocked() {
		migrated = true
	}
	if err := store.initializeLogAccountingLocked(); err != nil {
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
	store.liveEvents = make([]Event, len(store.data.Events))
	for index, event := range store.data.Events {
		store.liveEvents[index] = cloneEvent(event)
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

	return store.automationSnapshotLocked()
}

func (store *Store) automationSnapshotLocked() AutomationState {
	return AutomationState{
		Revision:           store.data.Automation.Revision,
		Config:             append(json.RawMessage(nil), store.data.Automation.Config...),
		Plans:              cloneAutomationPlans(store.data.Automation.Plans),
		PendingSubmissions: cloneAutomationSubmissions(store.data.Automation.PendingSubmissions),
		Executions:         cloneAutomationExecutions(store.data.Automation.Executions),
	}
}

func (store *Store) LogRetention() LogRetentionPolicy {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	return store.data.LogRetention
}

func (store *Store) LogPersistenceDiagnostics() LogPersistenceDiagnostics {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	return LogPersistenceDiagnostics{
		StateWrites:     store.stateWriteCount,
		RetentionPasses: store.retentionPassCount,
		DirectoryScans:  store.logDirectoryScanCount,
		OutputFlushes:   store.outputFlushCount,
	}
}

func (store *Store) Flush() error {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	return store.flushAllRunLogWritersLocked()
}

func (store *Store) Close() error {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	flushErr := store.flushAllRunLogWritersLocked()
	closeErr := store.closeAllRunLogWritersLocked()
	retentionErr := store.trimRunLogsLocked()
	return errors.Join(flushErr, closeErr, retentionErr)
}

func (store *Store) ReportDurableWriteFailure(runID string, cause error) error {
	if cause == nil {
		return nil
	}
	store.mutex.Lock()
	defer store.mutex.Unlock()

	return store.recordDurableWriteFailureLocked(runID, cause)
}

func (store *Store) LogRetentionStatus() (LogRetentionStatus, error) {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	return LogRetentionStatus{
		Policy: store.data.LogRetention,
		Usage:  store.logUsage,
	}, nil
}

func (store *Store) UpdateLogRetention(policy LogRetentionPolicy) (LogRetentionPolicy, error) {
	if err := validateLogRetentionPolicy(policy); err != nil {
		return LogRetentionPolicy{}, err
	}

	store.mutex.Lock()
	defer store.mutex.Unlock()

	if err := store.flushAllRunLogWritersLocked(); err != nil {
		return LogRetentionPolicy{}, err
	}
	if err := store.closeAllRunLogWritersLocked(); err != nil {
		return LogRetentionPolicy{}, err
	}
	previous := store.data.LogRetention
	applyRetention := policy.Persist ||
		policy.MaxCompletedRunsPerProject != previous.MaxCompletedRunsPerProject ||
		policy.MaxBytesPerRun != previous.MaxBytesPerRun ||
		policy.MaxBytesTotal != previous.MaxBytesTotal
	if applyRetention {
		if _, _, err := store.enforceLogRetentionLocked(policy); err != nil {
			return LogRetentionPolicy{}, err
		}
	}
	store.data.LogRetention = policy
	if err := store.persistLocked(); err != nil {
		return LogRetentionPolicy{}, err
	}
	return store.data.LogRetention, nil
}

func (store *Store) RetainedLogDescriptors(projectID string) ([]LogDescriptor, error) {
	if strings.TrimSpace(projectID) == "" {
		return nil, errors.New("project id is required")
	}

	store.mutex.RLock()
	defer store.mutex.RUnlock()

	descriptors := make([]LogDescriptor, 0)
	for _, run := range store.data.Runs {
		if run.ProjectID != projectID || !run.Status.IsCompleted() || !isSafeRunID(run.ID) {
			continue
		}
		logPath := filepath.Join(store.logDirectoryPath(), run.ID+".log")
		info, err := os.Stat(logPath)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read retained run log metadata: %w", err)
		}
		logFile, err := os.Open(logPath)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("open retained run log: %w", err)
		}
		if err := logFile.Close(); err != nil {
			return nil, fmt.Errorf("close retained run log: %w", err)
		}
		descriptors = append(descriptors, LogDescriptor{
			RunID:     run.ID,
			ProjectID: run.ProjectID,
			ScriptID:  run.ScriptID,
			Label:     run.Label,
			Status:    run.Status,
			StartedAt: run.StartedAt,
			EndedAt:   run.EndedAt,
			SizeBytes: info.Size(),
			Truncated: run.OutputTruncated,
			Available: true,
		})
	}
	sort.Slice(descriptors, func(left, right int) bool {
		if descriptors[left].EndedAt == descriptors[right].EndedAt {
			return descriptors[left].RunID > descriptors[right].RunID
		}
		return descriptors[left].EndedAt > descriptors[right].EndedAt
	})

	return descriptors, nil
}

func (store *Store) ClearPersistedLogs() (LogClearResult, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	return store.clearPersistedLogsLocked("")
}

func (store *Store) ClearPersistedLogsForRun(runID string) (LogClearResult, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return LogClearResult{}, errors.New("run id is required")
	}

	store.mutex.Lock()
	defer store.mutex.Unlock()

	return store.clearPersistedLogsLocked(runID)
}

func (store *Store) clearPersistedLogsLocked(runID string) (LogClearResult, error) {

	if err := store.flushRunLogWritersForScopeLocked(runID); err != nil {
		return LogClearResult{}, err
	}
	if err := store.closeRunLogWritersForScopeLocked(runID); err != nil {
		return LogClearResult{}, err
	}
	files := store.retainedLogFilesLocked()
	result := LogClearResult{}
	runtimeStateChanged := false
	for _, file := range files {
		if runID != "" && file.runID != runID {
			continue
		}
		if file.active {
			logFile, err := os.OpenFile(file.path, os.O_WRONLY|os.O_TRUNC, 0)
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return result, fmt.Errorf("truncate active run log: %w", err)
			}
			if err := logFile.Close(); err != nil {
				return result, fmt.Errorf("close active run log: %w", err)
			}
			info, err := os.Stat(file.path)
			if err != nil {
				return result, fmt.Errorf("read truncated active run log metadata: %w", err)
			}
			store.recordRetainedLogFileLocked(file.runID, file.path, info)
			result.ReleasedBytes += file.size
			if store.markRunOutputTruncatedLocked(file.runID) {
				runtimeStateChanged = true
			}
			continue
		}
		if err := store.removeRetainedLogFileLocked(file, &result); err != nil {
			return result, err
		}
	}

	persistedEvents := make([]Event, 0, len(store.data.Events))
	for _, event := range store.data.Events {
		if isOutputEvent(event.Type) && (runID == "" || event.RunID == runID) {
			runtimeStateChanged = true
			continue
		}
		persistedEvents = append(persistedEvents, event)
	}
	store.data.Events = persistedEvents
	if runtimeStateChanged {
		if err := store.persistLocked(); err != nil {
			return result, err
		}
	}

	return result, nil
}

func (store *Store) ReplaceAutomation(revision uint64, config json.RawMessage) (AutomationState, error) {
	return store.ReplaceAutomationWithSubmissions(revision, config, nil)
}

func (store *Store) ReplaceAutomationWithSubmissions(
	revision uint64,
	config json.RawMessage,
	submissions []AutomationSubmission,
) (AutomationState, error) {
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
	pendingSubmissions, err := mergeAutomationSubmissions(store.data.Automation.PendingSubmissions, submissions)
	if err != nil {
		return AutomationState{}, err
	}
	claimedEntries := make(map[string]struct{}, len(store.data.Automation.Executions))
	for _, execution := range store.data.Automation.Executions {
		claimedEntries[automationPlanEntryKey(execution.ProjectID, execution.TaskID, execution.PlanEntryID)] = struct{}{}
	}
	pendingSubmissions = filterUnclaimedAutomationSubmissions(pendingSubmissions, claimedEntries)
	if revision == store.data.Automation.Revision &&
		bytes.Equal(config, store.data.Automation.Config) &&
		automationSubmissionsEqual(store.data.Automation.PendingSubmissions, pendingSubmissions) {
		return store.automationSnapshotLocked(), nil
	}

	store.data.Automation = AutomationState{
		Revision:           revision,
		Config:             append(json.RawMessage(nil), config...),
		Plans:              cloneAutomationPlans(store.data.Automation.Plans),
		PendingSubmissions: pendingSubmissions,
		Executions:         cloneAutomationExecutions(store.data.Automation.Executions),
	}
	if err := store.persistLocked(); err != nil {
		return AutomationState{}, fmt.Errorf("write automation configuration: %w", err)
	}

	return store.automationSnapshotLocked(), nil
}

func mergeAutomationSubmissions(
	existing []AutomationSubmission,
	requested []AutomationSubmission,
) ([]AutomationSubmission, error) {
	merged := cloneAutomationSubmissions(existing)
	known := make(map[string]struct{}, len(merged))
	for _, submission := range merged {
		known[automationSubmissionKey(submission)] = struct{}{}
	}
	for _, submission := range requested {
		if err := validateAutomationSubmission(submission); err != nil {
			return nil, err
		}
		key := automationSubmissionKey(submission)
		if _, found := known[key]; found {
			continue
		}
		known[key] = struct{}{}
		merged = append(merged, submission)
	}
	return merged, nil
}

func validateAutomationSubmission(submission AutomationSubmission) error {
	if strings.TrimSpace(submission.ProjectID) == "" ||
		strings.TrimSpace(submission.TaskID) == "" ||
		strings.TrimSpace(submission.PlanEntryID) == "" {
		return ErrAutomationExecutionInvalid
	}
	switch submission.Kind {
	case AutomationSubmissionManual:
		if _, err := time.Parse(time.RFC3339Nano, submission.PlannedAt); err != nil {
			return fmt.Errorf("manual automation submission planned time: %w", err)
		}
	case AutomationSubmissionEarly:
		if submission.PlannedAt != "" {
			return ErrAutomationExecutionInvalid
		}
	default:
		return ErrAutomationExecutionInvalid
	}
	return nil
}

func automationSubmissionKey(submission AutomationSubmission) string {
	return string(submission.Kind) + "\x00" + submission.ProjectID + "\x00" + submission.TaskID + "\x00" + submission.PlanEntryID
}

func filterUnclaimedAutomationSubmissions(
	submissions []AutomationSubmission,
	claimedEntries map[string]struct{},
) []AutomationSubmission {
	filtered := submissions[:0]
	for _, submission := range submissions {
		if _, claimed := claimedEntries[automationPlanEntryKey(submission.ProjectID, submission.TaskID, submission.PlanEntryID)]; claimed {
			continue
		}
		filtered = append(filtered, submission)
	}
	return filtered
}

func automationSubmissionsEqual(left []AutomationSubmission, right []AutomationSubmission) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func (store *Store) ReconcileAutomationPlans(
	revision uint64,
	desiredPlans []AutomationPlan,
	activeTasks []AutomationPlanTask,
	retainAfter string,
) (AutomationState, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	if revision == 0 || store.data.Automation.Revision != revision {
		return AutomationState{}, ErrAutomationRevisionConflict
	}

	activeTaskKeys := make(map[string]struct{}, len(activeTasks))
	for _, task := range activeTasks {
		activeTaskKeys[automationPlanTaskKey(task.ProjectID, task.TaskID)] = struct{}{}
	}
	stateChanged := store.pruneAutomationStateLocked(activeTaskKeys)
	claimedEntries := make(map[string]struct{}, len(store.data.Automation.Executions))
	for _, execution := range store.data.Automation.Executions {
		claimedEntries[automationPlanEntryKey(execution.ProjectID, execution.TaskID, execution.PlanEntryID)] = struct{}{}
	}
	existingPlans := make(map[string]AutomationPlan, len(store.data.Automation.Plans))
	for _, plan := range store.data.Automation.Plans {
		existingPlans[automationPlanKey(plan.ProjectID, plan.TaskID, plan.Date)] = plan
	}

	nextPlans := make([]AutomationPlan, 0, len(store.data.Automation.Plans)+len(desiredPlans))
	desiredKeys := make(map[string]struct{}, len(desiredPlans))
	for _, desired := range desiredPlans {
		key := automationPlanKey(desired.ProjectID, desired.TaskID, desired.Date)
		desiredKeys[key] = struct{}{}
		if existing, found := existingPlans[key]; found {
			nextPlans = append(nextPlans, mergeAutomationPlan(existing, desired, claimedEntries))
			continue
		}
		nextPlans = append(nextPlans, normalizedAutomationPlan(desired))
	}

	for _, existing := range store.data.Automation.Plans {
		key := automationPlanKey(existing.ProjectID, existing.TaskID, existing.Date)
		if _, desired := desiredKeys[key]; desired {
			continue
		}
		if _, activeTask := activeTaskKeys[automationPlanTaskKey(existing.ProjectID, existing.TaskID)]; !activeTask {
			continue
		}
		if existing.Date >= retainAfter || automationPlanHasClaimedEntry(existing, claimedEntries) {
			nextPlans = append(nextPlans, normalizedAutomationPlan(existing))
		}
	}

	sort.Slice(nextPlans, func(left, right int) bool {
		if nextPlans[left].ProjectID != nextPlans[right].ProjectID {
			return nextPlans[left].ProjectID < nextPlans[right].ProjectID
		}
		if nextPlans[left].TaskID != nextPlans[right].TaskID {
			return nextPlans[left].TaskID < nextPlans[right].TaskID
		}
		return nextPlans[left].Date < nextPlans[right].Date
	})
	if automationPlansEqual(store.data.Automation.Plans, nextPlans) && !stateChanged {
		return store.automationSnapshotLocked(), nil
	}

	store.data.Automation.Plans = nextPlans
	if err := store.persistLocked(); err != nil {
		return AutomationState{}, fmt.Errorf("write automation plans: %w", err)
	}
	return store.automationSnapshotLocked(), nil
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
	store.data.Automation.PendingSubmissions = removeAutomationSubmissionsForPlan(
		store.data.Automation.PendingSubmissions,
		execution.ProjectID,
		execution.TaskID,
		execution.PlanEntryID,
	)
	store.updateAutomationPlanEntryStatusLocked(
		execution.ProjectID,
		execution.TaskID,
		execution.PlanEntryID,
		automationPlanStatusForExecution(execution.Status),
	)
	store.trimAutomationExecutionsLocked()
	if err := store.persistLocked(); err != nil {
		return AutomationExecution{}, false, fmt.Errorf("write automation execution claim: %w", err)
	}

	return cloneAutomationExecution(execution), true, nil
}

func removeAutomationSubmissionsForPlan(
	submissions []AutomationSubmission,
	projectID string,
	taskID string,
	planEntryID string,
) []AutomationSubmission {
	retained := submissions[:0]
	for _, submission := range submissions {
		if submission.ProjectID == projectID && submission.TaskID == taskID && submission.PlanEntryID == planEntryID {
			continue
		}
		retained = append(retained, submission)
	}
	return retained
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
		current := store.data.Automation.Executions[index]
		store.updateAutomationPlanEntryStatusLocked(
			current.ProjectID,
			current.TaskID,
			current.PlanEntryID,
			automationPlanStatusForExecution(current.Status),
		)
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
		var eventErr error
		if store.data.LogRetention.Persist {
			if err := store.appendRunLogLocked(event); err != nil {
				eventErr = errors.Join(eventErr, store.recordDurableWriteFailureLocked(runID, err))
			}
		}
		if store.data.Runs[index].Status.IsCompleted() {
			if err := store.flushRunLogWriterLocked(runID, true); err != nil {
				eventErr = errors.Join(eventErr, err)
			}
			if err := store.closeRunLogWriterLocked(runID); err != nil {
				eventErr = errors.Join(eventErr, err)
			}
			if err := store.trimRunLogsLocked(); err != nil {
				eventErr = errors.Join(eventErr, err)
			}
		}
		return cloneRun(store.data.Runs[index]), eventErr
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
	if store.shouldPersistEventLocked(prepared) {
		if err := store.persistLocked(); err != nil {
			return Event{}, err
		}
	}
	if store.data.LogRetention.Persist {
		if err := store.appendRunLogLocked(prepared); err != nil {
			return cloneEvent(prepared), store.recordDurableWriteFailureLocked(prepared.RunID, err)
		}
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
	if messageWasTruncated && store.data.LogRetention.Persist {
		for index := range store.data.Runs {
			if store.data.Runs[index].ID == event.RunID {
				store.data.Runs[index].OutputTruncated = true
				break
			}
		}
	}

	store.liveEvents = append(store.liveEvents, cloneEvent(event))
	if len(store.liveEvents) > MaxPersistedEvents {
		store.liveEvents = append([]Event(nil), store.liveEvents[len(store.liveEvents)-MaxPersistedEvents:]...)
	}
	if store.shouldPersistEventLocked(event) {
		store.data.Events = append(store.data.Events, cloneEvent(event))
		if len(store.data.Events) > MaxPersistedEvents {
			store.data.Events = append([]Event(nil), store.data.Events[len(store.data.Events)-MaxPersistedEvents:]...)
		}
	}

	return cloneEvent(event), nil
}

func (store *Store) shouldPersistEventLocked(event Event) bool {
	return !isOutputEvent(event.Type)
}

func isOutputEvent(eventType string) bool {
	return eventType == "stdout" || eventType == "stderr"
}

func (store *Store) discardPersistedOutputEventsLocked() bool {
	retained := make([]Event, 0, len(store.data.Events))
	for _, event := range store.data.Events {
		if isOutputEvent(event.Type) {
			continue
		}
		retained = append(retained, event)
	}
	if len(retained) == len(store.data.Events) {
		return false
	}
	store.data.Events = retained
	return true
}

func (store *Store) Snapshot() Snapshot {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	return store.snapshotLocked()
}

func (store *Store) SnapshotAndEventsAfter(after uint64, maxBytes int) (Snapshot, EventBatch) {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	return store.snapshotLocked(), store.eventsAfterLocked(after, maxBytes)
}

func (store *Store) snapshotLocked() Snapshot {
	return Snapshot{
		Runs:           cloneRuns(store.data.Runs),
		LatestCursor:   latestCursor(store.data),
		EarliestCursor: earliestCursor(store.liveEvents),
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

	store.mutex.Lock()
	run, found := findRun(store.data.Runs, runID)
	if !found {
		store.mutex.Unlock()
		return RunLog{}, ErrRunLogUnavailable
	}
	if err := store.flushRunLogWriterLocked(runID, true); err != nil {
		durableErr := store.recordDurableWriteFailureLocked(runID, err)
		store.mutex.Unlock()
		return RunLog{}, durableErr
	}
	logPath := filepath.Join(store.logDirectoryPath(), runID+".log")
	logFile, err := os.Open(logPath)
	if err != nil {
		store.mutex.Unlock()
		if errors.Is(err, os.ErrNotExist) {
			return RunLog{}, ErrRunLogUnavailable
		}
		return RunLog{}, fmt.Errorf("open run log: %w", err)
	}
	maxBytes := store.data.LogRetention.MaxBytesPerRun
	contents, readErr := io.ReadAll(io.LimitReader(logFile, maxBytes+1))
	closeErr := logFile.Close()
	store.mutex.Unlock()
	if readErr != nil {
		return RunLog{}, fmt.Errorf("read run log: %w", readErr)
	}
	if closeErr != nil {
		return RunLog{}, fmt.Errorf("close run log: %w", closeErr)
	}
	if int64(len(contents)) > maxBytes {
		return RunLog{}, errors.New("run log exceeds the retained size limit")
	}

	events, truncated, err := decodeRunLogEvents(contents, runID, run.OutputTruncated)
	if err != nil {
		return RunLog{}, err
	}

	return RunLog{
		RunID:     runID,
		Events:    events,
		Truncated: truncated,
		SizeBytes: int64(len(contents)),
	}, nil
}

func (store *Store) ReadRunLogPage(runID string, beforeOffset int64) (RunLog, error) {
	if !isSafeRunID(runID) {
		return RunLog{}, ErrRunLogUnavailable
	}
	if beforeOffset < 0 {
		return RunLog{}, fmt.Errorf("%w: before offset must not be negative", ErrRunLogPageInvalid)
	}

	store.mutex.Lock()
	defer store.mutex.Unlock()

	run, found := findRun(store.data.Runs, runID)
	if !found {
		return RunLog{}, ErrRunLogUnavailable
	}
	if err := store.flushRunLogWriterLocked(runID, true); err != nil {
		return RunLog{}, store.recordDurableWriteFailureLocked(runID, err)
	}
	logPath := filepath.Join(store.logDirectoryPath(), runID+".log")
	logFile, err := os.Open(logPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return RunLog{}, ErrRunLogUnavailable
		}
		return RunLog{}, fmt.Errorf("open run log: %w", err)
	}
	defer logFile.Close()

	info, err := logFile.Stat()
	if err != nil {
		return RunLog{}, fmt.Errorf("read run log metadata: %w", err)
	}
	endOffset := info.Size()
	if beforeOffset > 0 {
		if beforeOffset > endOffset {
			return RunLog{}, fmt.Errorf("%w: before offset exceeds log size", ErrRunLogPageInvalid)
		}
		endOffset = beforeOffset
	}
	startOffset := max(endOffset-RunLogPageBytes, 0)
	contents := make([]byte, endOffset-startOffset)
	if len(contents) > 0 {
		if _, err := logFile.ReadAt(contents, startOffset); err != nil && !errors.Is(err, io.EOF) {
			return RunLog{}, fmt.Errorf("read run log page: %w", err)
		}
	}
	if startOffset > 0 {
		boundary := bytes.IndexByte(contents, '\n')
		if boundary < 0 {
			return RunLog{}, fmt.Errorf("%w: no record boundary in log page", ErrRunLogPageInvalid)
		}
		startOffset += int64(boundary + 1)
		contents = contents[boundary+1:]
	}

	events, truncated, err := decodeRunLogEvents(contents, runID, run.OutputTruncated)
	if err != nil {
		return RunLog{}, err
	}
	return RunLog{
		RunID:      runID,
		Events:     events,
		Truncated:  truncated,
		SizeBytes:  info.Size(),
		HasMore:    startOffset > 0,
		NextOffset: startOffset,
	}, nil
}

func decodeRunLogEvents(contents []byte, runID string, truncated bool) ([]Event, bool, error) {
	lines := bytes.Split(contents, []byte{'\n'})
	lastRecordIndex := -1
	for index, line := range lines {
		if len(bytes.TrimSpace(line)) > 0 {
			lastRecordIndex = index
		}
	}

	events := make([]Event, 0)
	for index, line := range lines {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var event Event
		if err := json.Unmarshal(line, &event); err != nil {
			if index == lastRecordIndex {
				return events, true, nil
			}
			return nil, false, fmt.Errorf("decode run log event: %w", err)
		}
		if event.RunID != runID {
			return nil, false, errors.New("run log contains an event for another run")
		}
		events = append(events, cloneEvent(event))
	}

	return events, truncated, nil
}

func (store *Store) eventsAfter(after uint64, maxBytes int) EventBatch {
	store.mutex.RLock()
	defer store.mutex.RUnlock()

	return store.eventsAfterLocked(after, maxBytes)
}

func (store *Store) eventsAfterLocked(after uint64, maxBytes int) EventBatch {
	earliest := earliestCursor(store.liveEvents)
	batch := EventBatch{
		LatestCursor:   latestCursor(store.data),
		EarliestCursor: earliest,
		Truncated:      earliest > 0 && after+1 < earliest,
		NextCursor:     after,
	}
	for _, event := range store.liveEvents {
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
	if store.data.LogRetention == (LogRetentionPolicy{}) {
		store.data.LogRetention = DefaultLogRetentionPolicy()
	}
	if err := validateLogRetentionPolicy(store.data.LogRetention); err != nil {
		return err
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
	store.stateWriteCount++

	return nil
}

func (store *Store) queueRunLogEventLocked(event Event) error {
	if !isSafeRunID(event.RunID) {
		return errors.New("event run id is not safe for log persistence")
	}
	contents, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("encode run event: %w", err)
	}

	writer, err := store.openRunLogWriterLocked(event.RunID)
	if err != nil {
		return err
	}
	if writer.failure != nil {
		return writer.failure
	}
	writer.pending = append(writer.pending, contents...)
	writer.pending = append(writer.pending, '\n')
	if len(writer.pending) >= RunLogFlushBytes {
		return store.flushRunLogWriterLocked(event.RunID, true)
	}
	store.scheduleRunLogFlushLocked(event.RunID, writer)
	return nil
}

func (store *Store) openRunLogWriterLocked(runID string) (*runLogWriter, error) {
	if writer, found := store.writers[runID]; found {
		return writer, nil
	}
	if err := os.MkdirAll(store.logDirectoryPath(), 0o700); err != nil {
		return nil, fmt.Errorf("create run log directory: %w", err)
	}
	logPath := filepath.Join(store.logDirectoryPath(), runID+".log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open run log: %w", err)
	}
	info, err := logFile.Stat()
	if err != nil {
		_ = logFile.Close()
		return nil, fmt.Errorf("read opened run log metadata: %w", err)
	}

	store.nextWriterGeneration++
	writer := &runLogWriter{file: logFile, generation: store.nextWriterGeneration}
	store.writers[runID] = writer
	store.recordRetainedLogFileLocked(runID, logPath, info)
	return writer, nil
}

func (store *Store) scheduleRunLogFlushLocked(runID string, writer *runLogWriter) {
	if writer.timer != nil {
		return
	}
	generation := writer.generation
	writer.timer = time.AfterFunc(store.logFlushInterval, func() {
		store.flushScheduledRunLog(runID, generation)
	})
}

func (store *Store) flushScheduledRunLog(runID string, generation uint64) {
	store.mutex.Lock()
	defer store.mutex.Unlock()

	writer, found := store.writers[runID]
	if !found || writer.generation != generation {
		return
	}
	writer.timer = nil
	if err := store.flushRunLogWriterLocked(runID, true); err != nil {
		_ = store.recordDurableWriteFailureLocked(runID, err)
	}
}

func (store *Store) flushRunLogWriterLocked(runID string, enforceThresholds bool) error {
	writer, found := store.writers[runID]
	if !found {
		return nil
	}
	store.stopRunLogWriterTimerLocked(writer)
	if writer.failure != nil {
		return writer.failure
	}
	if len(writer.pending) == 0 {
		return nil
	}

	pending := writer.pending
	written, err := writer.file.Write(pending)
	if err != nil || written != len(pending) {
		if err == nil {
			err = io.ErrShortWrite
		}
		return store.failRunLogWriterLocked(runID, writer, fmt.Errorf("append run log: %w", err))
	}
	if err := writer.file.Sync(); err != nil {
		return store.failRunLogWriterLocked(runID, writer, fmt.Errorf("sync run log: %w", err))
	}
	info, err := writer.file.Stat()
	if err != nil {
		return store.failRunLogWriterLocked(runID, writer, fmt.Errorf("read flushed run log metadata: %w", err))
	}
	writer.pending = nil
	store.recordRetainedLogFileLocked(runID, filepath.Join(store.logDirectoryPath(), runID+".log"), info)
	store.outputFlushCount++

	runtimeStateChanged := false
	if enforceThresholds {
		var err error
		runtimeStateChanged, err = store.enforceOutputRetentionAfterFlushLocked(runID)
		if err != nil {
			return err
		}
	}
	if runtimeStateChanged {
		if err := store.persistLocked(); err != nil {
			return err
		}
	}
	return nil
}

func (store *Store) failRunLogWriterLocked(runID string, writer *runLogWriter, failure error) error {
	writer.pending = nil
	writer.failure = failure
	if writer.file != nil {
		_ = writer.file.Close()
		writer.file = nil
	}
	logPath := filepath.Join(store.logDirectoryPath(), runID+".log")
	if info, err := os.Stat(logPath); err == nil {
		store.recordRetainedLogFileLocked(runID, logPath, info)
	}
	store.markRunOutputTruncatedLocked(runID)
	return failure
}

func (store *Store) flushAllRunLogWritersLocked() error {
	return store.flushRunLogWritersForScopeLocked("")
}

func (store *Store) flushRunLogWritersForScopeLocked(runID string) error {
	runIDs := make([]string, 0, len(store.writers))
	for candidateRunID := range store.writers {
		if runID != "" && candidateRunID != runID {
			continue
		}
		runIDs = append(runIDs, candidateRunID)
	}
	sort.Strings(runIDs)

	var flushErr error
	for _, runID := range runIDs {
		if err := store.flushRunLogWriterLocked(runID, false); err != nil {
			flushErr = errors.Join(flushErr, store.recordDurableWriteFailureLocked(runID, err))
		}
	}
	return flushErr
}

func (store *Store) closeRunLogWriterLocked(runID string) error {
	writer, found := store.writers[runID]
	if !found {
		return nil
	}
	delete(store.writers, runID)
	store.stopRunLogWriterTimerLocked(writer)
	if writer.file == nil {
		return nil
	}
	err := writer.file.Close()
	writer.file = nil
	return err
}

func (store *Store) closeAllRunLogWritersLocked() error {
	return store.closeRunLogWritersForScopeLocked("")
}

func (store *Store) closeRunLogWritersForScopeLocked(runID string) error {
	runIDs := make([]string, 0, len(store.writers))
	for candidateRunID := range store.writers {
		if runID != "" && candidateRunID != runID {
			continue
		}
		runIDs = append(runIDs, candidateRunID)
	}
	sort.Strings(runIDs)

	var closeErr error
	for _, runID := range runIDs {
		if err := store.closeRunLogWriterLocked(runID); err != nil {
			closeErr = errors.Join(closeErr, store.recordDurableWriteFailureLocked(runID, fmt.Errorf("close run log: %w", err)))
		}
	}
	return closeErr
}

func (store *Store) stopRunLogWriterTimerLocked(writer *runLogWriter) {
	if writer.timer == nil {
		return
	}
	writer.timer.Stop()
	writer.timer = nil
}

func (store *Store) enforceOutputRetentionAfterFlushLocked(runID string) (bool, error) {
	policy := store.data.LogRetention
	runtimeStateChanged := false
	file, found := store.logFiles[runID]
	if found && file.size > policy.MaxBytesPerRun {
		if err := store.closeRunLogWriterLocked(runID); err != nil {
			return runtimeStateChanged, fmt.Errorf("close oversized run log writer: %w", err)
		}
		truncated, _, err := store.truncateRetainedLogFileLocked(file, runLogLowWatermark(policy.MaxBytesPerRun))
		if err != nil {
			return runtimeStateChanged, err
		}
		if truncated && store.markRunOutputTruncatedLocked(runID) {
			runtimeStateChanged = true
		}
	}
	if store.logUsage.TotalBytes <= policy.MaxBytesTotal && store.logUsage.FileCount <= MaxRunLogFiles {
		return runtimeStateChanged, nil
	}
	if err := store.flushAllRunLogWritersLocked(); err != nil {
		return runtimeStateChanged, err
	}
	if err := store.closeAllRunLogWritersLocked(); err != nil {
		return runtimeStateChanged, err
	}
	_, retentionStateChanged, err := store.enforceLogRetentionLocked(policy)
	return runtimeStateChanged || retentionStateChanged, err
}

func runLogLowWatermark(limit int64) int64 {
	return limit * 4 / 5
}

func (store *Store) truncateRetainedLogFileLocked(file retainedLogFile, limit int64) (bool, int64, error) {
	truncated, err := truncateFileTail(file.path, limit)
	if err != nil {
		return false, 0, err
	}
	info, err := os.Stat(file.path)
	if err != nil {
		return false, 0, fmt.Errorf("read truncated run log metadata: %w", err)
	}
	released := file.size - info.Size()
	store.recordRetainedLogFileLocked(file.runID, file.path, info)
	return truncated, released, nil
}

func (store *Store) recordDurableWriteFailureLocked(runID string, cause error) error {
	if cause == nil {
		return nil
	}
	if store.setRunDurableWriteErrorLocked(runID, cause) {
		if err := store.persistLocked(); err != nil {
			return errors.Join(cause, err)
		}
	}
	return cause
}

func (store *Store) setRunDurableWriteErrorLocked(runID string, cause error) bool {
	message := strings.TrimSpace(cause.Error())
	message = strings.Map(func(character rune) rune {
		if character < ' ' {
			return -1
		}
		return character
	}, message)
	if len(message) > MaxDurableWriteErrorBytes {
		message = message[:MaxDurableWriteErrorBytes]
	}
	for index := range store.data.Runs {
		if store.data.Runs[index].ID != runID || store.data.Runs[index].DurableWriteError == message {
			continue
		}
		store.data.Runs[index].DurableWriteError = message
		return true
	}
	return false
}

func (store *Store) appendRunLogLocked(event Event) error {
	return store.queueRunLogEventLocked(event)
}

func (store *Store) trimRunLogsLocked() error {
	if !store.data.LogRetention.Persist {
		return nil
	}
	_, runtimeStateChanged, err := store.enforceLogRetentionLocked(store.data.LogRetention)
	if err != nil {
		return err
	}
	if runtimeStateChanged {
		return store.persistLocked()
	}
	return nil
}

func (store *Store) logUsageLocked() (LogUsage, error) {
	return store.logUsage, nil
}

func (store *Store) initializeLogAccountingLocked() error {
	store.logDirectoryScanCount++
	entries, err := os.ReadDir(store.logDirectoryPath())
	if errors.Is(err, os.ErrNotExist) {
		store.logFiles = map[string]retainedLogFile{}
		store.logUsage = LogUsage{}
		return nil
	}
	if err != nil {
		return fmt.Errorf("list run logs: %w", err)
	}

	runs := make(map[string]Run, len(store.data.Runs))
	for _, run := range store.data.Runs {
		runs[run.ID] = run
	}
	store.logFiles = map[string]retainedLogFile{}
	store.logUsage = LogUsage{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".log" {
			continue
		}
		runID := strings.TrimSuffix(entry.Name(), ".log")
		if !isSafeRunID(runID) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("read run log metadata: %w", err)
		}
		run, found := runs[runID]
		logPath := filepath.Join(store.logDirectoryPath(), entry.Name())
		store.recordRetainedLogFileLocked(runID, logPath, info)
		file := store.logFiles[runID]
		file.projectID = run.ProjectID
		file.active = found && run.Status.IsActive()
		store.logFiles[runID] = file
	}
	return nil
}

func (store *Store) retainedLogFilesLocked() []retainedLogFile {
	files := make([]retainedLogFile, 0, len(store.logFiles))
	runs := make(map[string]Run, len(store.data.Runs))
	for _, run := range store.data.Runs {
		runs[run.ID] = run
	}
	for runID, file := range store.logFiles {
		run, found := runs[runID]
		file.projectID = run.ProjectID
		file.active = found && run.Status.IsActive()
		store.logFiles[runID] = file
		files = append(files, file)
	}
	return files
}

func (store *Store) recordRetainedLogFileLocked(runID string, path string, info os.FileInfo) {
	previous, found := store.logFiles[runID]
	if found {
		store.logUsage.TotalBytes += info.Size() - previous.size
	} else {
		store.logUsage.FileCount++
		store.logUsage.TotalBytes += info.Size()
	}
	run, foundRun := findRun(store.data.Runs, runID)
	store.logFiles[runID] = retainedLogFile{
		runID:     runID,
		projectID: run.ProjectID,
		path:      path,
		size:      info.Size(),
		modified:  info.ModTime(),
		active:    foundRun && run.Status.IsActive(),
	}
}

func (store *Store) enforceLogRetentionLocked(policy LogRetentionPolicy) (LogClearResult, bool, error) {
	store.retentionPassCount++
	files := store.retainedLogFilesLocked()
	result := LogClearResult{}
	runtimeStateChanged := false
	for index := range files {
		if files[index].size <= policy.MaxBytesPerRun {
			continue
		}
		truncated, released, err := store.truncateRetainedLogFileLocked(files[index], runLogLowWatermark(policy.MaxBytesPerRun))
		if err != nil {
			return result, runtimeStateChanged, err
		}
		result.ReleasedBytes += released
		files[index] = store.logFiles[files[index].runID]
		if truncated && store.markRunOutputTruncatedLocked(files[index].runID) {
			runtimeStateChanged = true
		}
	}

	completedByProject := map[string][]retainedLogFile{}
	for _, file := range files {
		if !file.active {
			completedByProject[file.projectID] = append(completedByProject[file.projectID], file)
		}
	}
	for _, projectFiles := range completedByProject {
		sortRetainedLogFilesOldestFirst(projectFiles)
		excess := len(projectFiles) - policy.MaxCompletedRunsPerProject
		for _, file := range projectFiles[:max(excess, 0)] {
			if err := store.removeRetainedLogFileLocked(file, &result); err != nil {
				return result, runtimeStateChanged, err
			}
			files = withoutRetainedLogFile(files, file.path)
		}
	}

	for len(files) > MaxRunLogFiles {
		completed := completedRetainedLogFiles(files)
		if len(completed) == 0 {
			break
		}
		sortRetainedLogFilesOldestFirst(completed)
		if err := store.removeRetainedLogFileLocked(completed[0], &result); err != nil {
			return result, runtimeStateChanged, err
		}
		files = withoutRetainedLogFile(files, completed[0].path)
	}

	totalSize := retainedLogFileBytes(files)
	targetTotalSize := policy.MaxBytesTotal
	if totalSize > targetTotalSize {
		targetTotalSize = runLogLowWatermark(targetTotalSize)
	}
	for totalSize > targetTotalSize {
		completed := completedRetainedLogFiles(files)
		if len(completed) == 0 {
			break
		}
		sortRetainedLogFilesOldestFirst(completed)
		file := completed[0]
		if err := store.removeRetainedLogFileLocked(file, &result); err != nil {
			return result, runtimeStateChanged, err
		}
		totalSize -= file.size
		files = withoutRetainedLogFile(files, file.path)
	}
	if totalSize > targetTotalSize {
		active := activeRetainedLogFiles(files)
		sortRetainedLogFilesOldestFirst(active)
		for _, file := range active {
			if totalSize <= targetTotalSize {
				break
			}
			targetSize := file.size - (totalSize - targetTotalSize)
			if targetSize < 0 {
				targetSize = 0
			}
			truncated, released, err := store.truncateRetainedLogFileLocked(file, targetSize)
			if err != nil {
				return result, runtimeStateChanged, err
			}
			result.ReleasedBytes += released
			totalSize -= released
			for index := range files {
				if files[index].path == file.path {
					files[index] = store.logFiles[file.runID]
					break
				}
			}
			if truncated && store.markRunOutputTruncatedLocked(file.runID) {
				runtimeStateChanged = true
			}
		}
	}
	if totalSize > policy.MaxBytesTotal {
		return result, runtimeStateChanged, fmt.Errorf("retained run logs remain above total limit: %d > %d", totalSize, policy.MaxBytesTotal)
	}

	return result, runtimeStateChanged, nil
}

func (store *Store) removeRetainedLogFileLocked(file retainedLogFile, result *LogClearResult) error {
	if err := os.Remove(file.path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			store.removeRetainedLogFileFromAccountingLocked(file.runID)
			return nil
		}
		return fmt.Errorf("remove retained run log: %w", err)
	}
	store.removeRetainedLogFileFromAccountingLocked(file.runID)
	result.DeletedCount++
	result.ReleasedBytes += file.size
	return nil
}

func (store *Store) removeRetainedLogFileFromAccountingLocked(runID string) {
	file, found := store.logFiles[runID]
	if !found {
		return
	}
	delete(store.logFiles, runID)
	store.logUsage.FileCount--
	store.logUsage.TotalBytes -= file.size
}

func completedRetainedLogFiles(files []retainedLogFile) []retainedLogFile {
	completed := make([]retainedLogFile, 0, len(files))
	for _, file := range files {
		if !file.active {
			completed = append(completed, file)
		}
	}
	return completed
}

func activeRetainedLogFiles(files []retainedLogFile) []retainedLogFile {
	active := make([]retainedLogFile, 0, len(files))
	for _, file := range files {
		if file.active {
			active = append(active, file)
		}
	}
	return active
}

func sortRetainedLogFilesOldestFirst(files []retainedLogFile) {
	sort.Slice(files, func(left, right int) bool {
		if files[left].modified.Equal(files[right].modified) {
			return files[left].runID < files[right].runID
		}
		return files[left].modified.Before(files[right].modified)
	})
}

func retainedLogFileBytes(files []retainedLogFile) int64 {
	var total int64
	for _, file := range files {
		total += file.size
	}
	return total
}

func withoutRetainedLogFile(files []retainedLogFile, path string) []retainedLogFile {
	for index, file := range files {
		if file.path == path {
			return append(files[:index], files[index+1:]...)
		}
	}
	return files
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

	store.logDirectoryScanCount++
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
	terminalTotal := 0
	for index := len(store.data.Automation.Executions) - 1; index >= 0; index-- {
		execution := store.data.Automation.Executions[index]
		if execution.Status == AutomationExecutionRunning {
			retained = append(retained, execution)
			continue
		}
		key := execution.ProjectID + "\x00" + execution.TaskID
		if terminalCounts[key] >= MaxAutomationHistoryPerTask || terminalTotal >= MaxAutomationHistory {
			continue
		}
		terminalCounts[key] += 1
		terminalTotal++
		retained = append(retained, execution)
	}

	for left, right := 0, len(retained)-1; left < right; left, right = left+1, right-1 {
		retained[left], retained[right] = retained[right], retained[left]
	}
	store.data.Automation.Executions = retained
}

func (store *Store) pruneAutomationStateLocked(activeTaskKeys map[string]struct{}) bool {
	stateChanged := false
	retainedSubmissions := make([]AutomationSubmission, 0, len(store.data.Automation.PendingSubmissions))
	for _, submission := range store.data.Automation.PendingSubmissions {
		if _, active := activeTaskKeys[automationPlanTaskKey(submission.ProjectID, submission.TaskID)]; !active {
			stateChanged = true
			continue
		}
		retainedSubmissions = append(retainedSubmissions, submission)
	}
	if len(retainedSubmissions) != len(store.data.Automation.PendingSubmissions) {
		store.data.Automation.PendingSubmissions = retainedSubmissions
	}

	retainedExecutions := make([]AutomationExecution, 0, len(store.data.Automation.Executions))
	for _, execution := range store.data.Automation.Executions {
		if execution.Status != AutomationExecutionRunning {
			if _, active := activeTaskKeys[automationPlanTaskKey(execution.ProjectID, execution.TaskID)]; !active {
				stateChanged = true
				continue
			}
		}
		retainedExecutions = append(retainedExecutions, execution)
	}
	if len(retainedExecutions) != len(store.data.Automation.Executions) {
		store.data.Automation.Executions = retainedExecutions
	}
	beforeTrim := len(store.data.Automation.Executions)
	store.trimAutomationExecutionsLocked()
	return stateChanged || len(store.data.Automation.Executions) != beforeTrim
}

func automationPlanKey(projectID string, taskID string, date string) string {
	return projectID + "\x00" + taskID + "\x00" + date
}

func automationPlanTaskKey(projectID string, taskID string) string {
	return projectID + "\x00" + taskID
}

func automationPlanEntryKey(projectID string, taskID string, entryID string) string {
	return projectID + "\x00" + taskID + "\x00" + entryID
}

func mergeAutomationPlan(
	existing AutomationPlan,
	desired AutomationPlan,
	claimedEntries map[string]struct{},
) AutomationPlan {
	existingEntries := make(map[string]AutomationPlanEntry, len(existing.Entries))
	for _, entry := range existing.Entries {
		existingEntries[entry.ID] = entry
	}

	merged := AutomationPlan{
		ProjectID: desired.ProjectID,
		TaskID:    desired.TaskID,
		Date:      desired.Date,
		Entries:   make([]AutomationPlanEntry, 0, len(desired.Entries)+len(existing.Entries)),
	}
	desiredEntryIDs := make(map[string]struct{}, len(desired.Entries))
	for _, entry := range desired.Entries {
		desiredEntryIDs[entry.ID] = struct{}{}
		if current, found := existingEntries[entry.ID]; found &&
			(current.Status != AutomationPlanEntryPending || hasAutomationPlanEntryClaim(claimedEntries, existing, current)) {
			merged.Entries = append(merged.Entries, current)
			continue
		}
		merged.Entries = append(merged.Entries, normalizedAutomationPlanEntry(entry))
	}
	for _, entry := range existing.Entries {
		if _, desired := desiredEntryIDs[entry.ID]; desired ||
			(entry.Status == AutomationPlanEntryPending && !hasAutomationPlanEntryClaim(claimedEntries, existing, entry)) {
			continue
		}
		merged.Entries = append(merged.Entries, entry)
	}
	return normalizedAutomationPlan(merged)
}

func normalizedAutomationPlan(plan AutomationPlan) AutomationPlan {
	normalized := plan
	normalized.Entries = make([]AutomationPlanEntry, 0, len(plan.Entries))
	for _, entry := range plan.Entries {
		normalized.Entries = append(normalized.Entries, normalizedAutomationPlanEntry(entry))
	}
	sort.Slice(normalized.Entries, func(left, right int) bool {
		if normalized.Entries[left].PlannedAt != normalized.Entries[right].PlannedAt {
			return normalized.Entries[left].PlannedAt < normalized.Entries[right].PlannedAt
		}
		return normalized.Entries[left].ID < normalized.Entries[right].ID
	})
	return normalized
}

func normalizedAutomationPlanEntry(entry AutomationPlanEntry) AutomationPlanEntry {
	if entry.Status == "" {
		entry.Status = AutomationPlanEntryPending
	}
	return entry
}

func automationPlanHasClaimedEntry(plan AutomationPlan, claimedEntries map[string]struct{}) bool {
	for _, entry := range plan.Entries {
		if entry.Status != AutomationPlanEntryPending || hasAutomationPlanEntryClaim(claimedEntries, plan, entry) {
			return true
		}
	}
	return false
}

func hasAutomationPlanEntryClaim(
	claimedEntries map[string]struct{},
	plan AutomationPlan,
	entry AutomationPlanEntry,
) bool {
	_, claimed := claimedEntries[automationPlanEntryKey(plan.ProjectID, plan.TaskID, entry.ID)]
	return claimed
}

func automationPlansEqual(left []AutomationPlan, right []AutomationPlan) bool {
	if len(left) != len(right) {
		return false
	}
	for planIndex := range left {
		if left[planIndex].ProjectID != right[planIndex].ProjectID ||
			left[planIndex].TaskID != right[planIndex].TaskID ||
			left[planIndex].Date != right[planIndex].Date ||
			len(left[planIndex].Entries) != len(right[planIndex].Entries) {
			return false
		}
		for entryIndex := range left[planIndex].Entries {
			if left[planIndex].Entries[entryIndex] != right[planIndex].Entries[entryIndex] {
				return false
			}
		}
	}
	return true
}

func (store *Store) updateAutomationPlanEntryStatusLocked(
	projectID string,
	taskID string,
	planEntryID string,
	status AutomationPlanEntryStatus,
) {
	for planIndex := range store.data.Automation.Plans {
		plan := &store.data.Automation.Plans[planIndex]
		if plan.ProjectID != projectID || plan.TaskID != taskID {
			continue
		}
		for entryIndex := range plan.Entries {
			if plan.Entries[entryIndex].ID == planEntryID {
				plan.Entries[entryIndex].Status = status
				return
			}
		}
	}
}

func automationPlanStatusForExecution(status AutomationExecutionStatus) AutomationPlanEntryStatus {
	switch status {
	case AutomationExecutionRunning:
		return AutomationPlanEntryRunning
	case AutomationExecutionCompleted:
		return AutomationPlanEntryCompleted
	case AutomationExecutionFailed:
		return AutomationPlanEntryFailed
	case AutomationExecutionSkipped:
		return AutomationPlanEntrySkipped
	case AutomationExecutionMissed:
		return AutomationPlanEntryMissed
	default:
		return AutomationPlanEntryPending
	}
}

func newRuntimeState() RuntimeState {
	return RuntimeState{
		SchemaVersion:     RuntimeStateSchema,
		NextCursor:        1,
		Runs:              []Run{},
		Events:            []Event{},
		IdempotencyClaims: map[string]IdempotencyClaim{},
		Automation:        AutomationState{},
		LogRetention:      DefaultLogRetentionPolicy(),
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

func earliestCursor(events []Event) uint64 {
	if len(events) == 0 {
		return 0
	}
	return events[0].Cursor
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
		LogRetention:      persisted.LogRetention,
		Automation: AutomationState{
			Revision:           persisted.Automation.Revision,
			Plans:              persisted.Automation.Plans,
			PendingSubmissions: persisted.Automation.PendingSubmissions,
			Executions:         persisted.Automation.Executions,
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
		LogRetention:      data.LogRetention,
		Automation: persistedAutomationState{
			Revision:           data.Automation.Revision,
			EncryptedConfig:    encryptedConfig,
			Plans:              data.Automation.Plans,
			PendingSubmissions: data.Automation.PendingSubmissions,
			Executions:         data.Automation.Executions,
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

func cloneAutomationPlans(plans []AutomationPlan) []AutomationPlan {
	cloned := make([]AutomationPlan, len(plans))
	for index, plan := range plans {
		cloned[index] = plan
		cloned[index].Entries = append([]AutomationPlanEntry(nil), plan.Entries...)
	}
	return cloned
}

func cloneAutomationSubmissions(submissions []AutomationSubmission) []AutomationSubmission {
	return append([]AutomationSubmission(nil), submissions...)
}

func cloneAutomationExecution(execution AutomationExecution) AutomationExecution {
	cloned := execution
	cloned.ScriptResults = make([]AutomationScriptResult, len(execution.ScriptResults))
	copy(cloned.ScriptResults, execution.ScriptResults)
	return cloned
}
